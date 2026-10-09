"""Internet checks assigned to every monitor: path, iperf3, and web services."""

from __future__ import annotations

import re

from sqlalchemy import and_, desc, or_, select
from sqlalchemy.orm import Session, joinedload

from app.models import (
    InternetServiceSetting,
    Monitor,
    Network,
    NetworkKind,
    ResultStatus,
    Test,
    TestKind,
    TestResult,
    WebServiceSetting,
)
from app.wireguard_tunnel import TUNNEL_SERVER_IP, WIRELESS_SERVER_IP

# Path checks and iperf3 use the tunnel address.
# Web services probe each service's own hostname.
IPERF_HOST = TUNNEL_SERVER_IP
IPERF_TARGET = TUNNEL_SERVER_IP
SERVER_HTTP = f"http://{TUNNEL_SERVER_IP}:8847/api/v1/healthz"
IPERF_INTERVAL_SECONDS = 900
PATH_HTTP_INTERVAL_SECONDS = 60
PATH_ICMP_INTERVAL_SECONDS = 60
PATH_MTR_INTERVAL_SECONDS = 300
WEB_HTTP_INTERVAL_SECONDS = 300

# ISP path checks. The Internet page reads these slugs.
PATH_TESTS: tuple[tuple[str, str, TestKind, str, int], ...] = (
    ("http-path", "HTTP", TestKind.http, SERVER_HTTP, PATH_HTTP_INTERVAL_SECONDS),
    ("icmp-path", "ICMP", TestKind.ping, IPERF_HOST, PATH_ICMP_INTERVAL_SECONDS),
    ("mtr-path", "MTR", TestKind.mtr, IPERF_HOST, PATH_MTR_INTERVAL_SECONDS),
)

# Same destinations the Internet page labels as Web Services.
# Each one gets HTTP, ICMP, and MTR. ICMP and MTR use the hostname.
WEB_SERVICES: tuple[tuple[str, str, str, str], ...] = (
    ("youtube", "YouTube", "https://www.youtube.com/generate_204", "www.youtube.com"),
    ("google", "Google", "https://www.google.com/generate_204", "www.google.com"),
    ("microsoft", "Microsoft", "http://www.msftconnecttest.com/connecttest.txt", "www.msftconnecttest.com"),
    ("hulu", "Hulu", "https://www.hulu.com", "www.hulu.com"),
    ("zoom", "Zoom", "https://zoom.us", "zoom.us"),
    ("netflix", "Netflix", "https://www.netflix.com", "www.netflix.com"),
    ("teams", "Microsoft Teams", "https://teams.microsoft.com", "teams.microsoft.com"),
    ("facebook", "Facebook", "https://www.facebook.com", "www.facebook.com"),
)
RETIRED_WEB_SLUGS = ("http-slack", "icmp-slack", "mtr-slack")

INTERNET_SLUGS = frozenset(
    {
        "iperf3",
        *(slug for slug, _, _, _, _ in PATH_TESTS),
        *(f"http-{key}" for key, _, _, _ in WEB_SERVICES),
        *(f"icmp-{key}" for key, _, _, _ in WEB_SERVICES),
        *(f"mtr-{key}" for key, _, _, _ in WEB_SERVICES),
    }
)


def _ensure_test(
    monitor: Monitor,
    network: Network,
    existing_rows: list[Test],
    rows: list[Test],
    slug: str,
    name: str,
    kind: TestKind,
    target: str,
    interval: int,
    enabled: bool = True,
) -> None:
    current = next((test for test in existing_rows if test.slug == slug), None)
    if current is None:
        rows.append(
            Test(
                monitor_id=monitor.id,
                network_id=network.id,
                slug=slug,
                name=name,
                kind=kind,
                target=target,
                interval_seconds=interval,
                enabled=enabled,
            )
        )
        return
    if current.target != target:
        current.target = target
    if current.interval_seconds != interval:
        current.interval_seconds = interval
    if current.enabled != enabled:
        current.enabled = enabled


def _disable_test(existing_rows: list[Test], slug: str) -> None:
    current = next((test for test in existing_rows if test.slug == slug), None)
    if current is not None and current.enabled:
        current.enabled = False


def _network(db: Session, monitor: Monitor, slug: str, name: str, kind: NetworkKind) -> Network:
    network = db.scalar(select(Network).where(Network.group_id == monitor.group_id, Network.slug == slug))
    if network is None:
        network = Network(group_id=monitor.group_id, slug=slug, name=name, kind=kind)
        db.add(network)
        db.flush()
    return network


def ensure_internet_tests(db: Session, monitor: Monitor) -> None:
    _sync_link_tests(db, monitor, _network(db, monitor, "wan", "Internet", NetworkKind.wired), TUNNEL_SERVER_IP)
    _sync_link_tests(db, monitor, _network(db, monitor, "wired", "Wired", NetworkKind.wired), TUNNEL_SERVER_IP)
    _sync_link_tests(
        db, monitor, _network(db, monitor, "wifi", "Wireless", NetworkKind.wifi), WIRELESS_SERVER_IP
    )


def _sync_link_tests(db: Session, monitor: Monitor, network: Network, server_ip: str) -> None:
    existing_rows = list(
        db.scalars(select(Test).where(Test.monitor_id == monitor.id, Test.network_id == network.id))
    )
    server_http = f"http://{server_ip}:8847/api/v1/healthz"
    path = load_internet_service(db)
    path_interval = max(path.interval_seconds, 60)
    rows: list[Test] = []
    _ensure_test(
        monitor,
        network,
        existing_rows,
        rows,
        "iperf3",
        "iperf3",
        TestKind.iperf3,
        server_ip,
        max(path.iperf_interval_seconds, 300),
        path.iperf_enabled,
    )
    for slug, name, kind, _target, _interval in PATH_TESTS:
        target = server_http if kind == TestKind.http else server_ip
        if kind == TestKind.http:
            enabled = path.http_enabled
            interval = path_interval
        elif kind == TestKind.ping:
            enabled = path.icmp_enabled
            interval = path_interval
        else:
            enabled = path.mtr_enabled
            interval = max(path_interval, 120)
        _ensure_test(monitor, network, existing_rows, rows, slug, name, kind, target, interval, enabled)
    for service in load_web_services(db):
        interval = max(service.interval_seconds, 60)
        _ensure_test(
            monitor,
            network,
            existing_rows,
            rows,
            f"http-{service.key}",
            f"{service.label} HTTP",
            TestKind.http,
            service.http_url,
            interval,
            service.http_enabled,
        )
        _ensure_test(
            monitor,
            network,
            existing_rows,
            rows,
            f"icmp-{service.key}",
            f"{service.label} ICMP",
            TestKind.ping,
            service.host,
            interval,
            service.icmp_enabled,
        )
        _disable_test(existing_rows, f"mtr-{service.key}")
    for slug in RETIRED_WEB_SLUGS:
        _disable_test(existing_rows, slug)
    if rows:
        db.add_all(rows)
        db.flush()


def scheduled_tests(db: Session, monitor: Monitor) -> list[dict]:
    rows = db.scalars(
        select(Test)
        .where(Test.monitor_id == monitor.id, Test.enabled.is_(True))
        .options(joinedload(Test.network))
    ).unique()
    assigned: list[dict] = []
    for test in rows:
        if test.slug not in INTERNET_SLUGS:
            continue
        if test.kind not in (TestKind.http, TestKind.iperf3, TestKind.ping, TestKind.mtr):
            continue
        link = {"wired": "wired", "wifi": "wireless"}.get(test.network.slug, "wan")
        item = {
            "slug": test.slug,
            "name": test.name,
            "kind": test.kind.value,
            "target": test.target,
            "network_slug": test.network.slug,
            "interval_seconds": test.interval_seconds,
            "link": link,
        }
        assigned.append(item)
    if any(item["link"] in {"wired", "wireless"} for item in assigned):
        assigned = [item for item in assigned if item["link"] != "wan"]
    assigned.sort(key=lambda item: (item["link"], item["slug"]))
    return assigned


PATH_SLUGS = frozenset({"http-path", "icmp-path", "mtr-path", "iperf3"})


def matrix_column(network_slug: str, test_slug: str) -> str | None:
    """Dashboard column for a test. Internet path checks and web services are separate."""
    if network_slug not in {"wan", "wired", "wifi"}:
        return network_slug
    if test_slug in PATH_SLUGS:
        return "internet"
    kind, _, key = test_slug.partition("-")
    if kind in {"http", "icmp", "mtr"} and key and key != "path":
        return "web"
    return None


def service_variance(settings: dict[str, WebServiceSetting], slug: str) -> tuple[int, int | None] | None:
    """Primary variance and, for ICMP, the jitter variance when that check is on."""
    kind, _, key = slug.partition("-")
    service = settings.get(key)
    if service is None or kind not in {"http", "icmp", "mtr"} or key == "path":
        return None
    if kind == "http":
        return service.http_variance_pct, None
    jitter = service.jitter_variance_pct if service.jitter_enabled else None
    return service.icmp_variance_pct, jitter


def path_variance(setting: InternetServiceSetting, slug: str) -> tuple[int, int | None] | None:
    if slug == "http-path":
        return setting.http_variance_pct, None
    if slug == "icmp-path":
        return setting.icmp_variance_pct, setting.icmp_variance_pct
    if slug == "mtr-path":
        return setting.mtr_variance_pct, None
    if slug == "iperf3":
        return setting.iperf_variance_pct, None
    return None


def classify_iperf(db: Session, test: Test, metrics: dict, variance_pct: int) -> tuple[ResultStatus, str]:
    """Amber when throughput falls past the variance. Red when neither direction answers."""
    down = _number(metrics.get("down_mbps"))
    up = _number(metrics.get("up_mbps"))
    down_ok = down is not None and down > 0
    up_ok = up is not None and up > 0
    if not down_ok and not up_ok:
        return ResultStatus.fail, "Neither download nor upload answered."
    if not down_ok or not up_ok or down is None or up is None:
        if down_ok and down is not None:
            return ResultStatus.degraded, f"Download answered at {_mbps(down)}. Upload did not."
        if up_ok and up is not None:
            return ResultStatus.degraded, f"Upload answered at {_mbps(up)}. Download did not."
        return ResultStatus.degraded, "Only one direction answered."
    base_down = _baseline_value(db, test, "down_mbps")
    base_up = _baseline_value(db, test, "up_mbps")
    floor = max(0.0, 1 - variance_pct / 100)
    notes: list[str] = []
    if base_down is not None and down < base_down * floor:
        notes.append(
            f"Download {_mbps(down)} is more than {variance_pct}% below the recent normal of {_mbps(base_down)}"
        )
    if base_up is not None and up < base_up * floor:
        notes.append(
            f"Upload {_mbps(up)} is more than {variance_pct}% below the recent normal of {_mbps(base_up)}"
        )
    if notes:
        return ResultStatus.degraded, ". ".join(notes) + "."
    if base_down is None and base_up is None:
        return (
            ResultStatus.ok,
            f"Download {_mbps(down)} and upload {_mbps(up)}. Not enough recent results to compare yet.",
        )
    return (
        ResultStatus.ok,
        f"Download {_mbps(down)} and upload {_mbps(up)}, within {variance_pct}% of the recent normal.",
    )


def classify_web_service(
    db: Session,
    test: Test,
    metrics: dict,
    message: str | None,
    variance_pct: int,
    jitter_variance_pct: int | None = None,
) -> tuple[ResultStatus, str]:
    """Green inside the recent normal, amber past the variance, red with no response."""
    responded, value, imperfect = _response_sample(test.kind, metrics, message)
    label = _check_label(test.kind)
    if not responded:
        if test.kind == TestKind.http:
            return ResultStatus.fail, "No HTTP response."
        if test.kind == TestKind.mtr:
            return ResultStatus.fail, "The trace got no response."
        return ResultStatus.fail, "No ICMP response."
    if imperfect:
        if test.kind == TestKind.http:
            code = _http_code(message)
            shown = f"HTTP {code}" if code is not None else "HTTP"
            return ResultStatus.degraded, f"{shown}. The service answered with an error."
        loss = _number(metrics.get("loss_pct")) or 0
        return ResultStatus.degraded, f"{label} answered in {_ms(value)} with {_pct(loss)} packet loss."
    metric = "total_ms" if test.kind == TestKind.http else "rtt_ms"
    baseline = _baseline_value(db, test, metric)
    if baseline is None and test.kind == TestKind.http:
        baseline = _baseline_value(db, test, "rtt_ms")
    notes: list[str] = []
    if baseline is not None and value is not None and value > baseline * (1 + variance_pct / 100):
        notes.append(
            f"{label} {_ms(value)} is more than {variance_pct}% slower than the recent normal of {_ms(baseline)}"
        )
    if test.kind == TestKind.ping and jitter_variance_pct is not None:
        jitter_note = _jitter_note(db, test, metrics, jitter_variance_pct)
        if jitter_note:
            notes.append(jitter_note)
    if notes:
        return ResultStatus.degraded, ". ".join(notes) + "."
    if baseline is None or value is None:
        return ResultStatus.ok, f"{label} answered. Not enough recent results to compare yet."
    sentence = f"{label} {_ms(value)}, within {variance_pct}% of the recent normal of {_ms(baseline)}"
    if test.kind == TestKind.ping:
        jitter = _number(metrics.get("jitter_ms"))
        if jitter is not None:
            sentence += f". Jitter {_ms(jitter)}"
    return ResultStatus.ok, sentence + "."


def _jitter_note(db: Session, test: Test, metrics: dict, variance_pct: int) -> str | None:
    jitter = _number(metrics.get("jitter_ms"))
    baseline = _baseline_value(db, test, "jitter_ms")
    if jitter is None or baseline is None or jitter <= baseline * (1 + variance_pct / 100):
        return None
    return f"Jitter {_ms(jitter)} is more than {variance_pct}% above the recent normal of {_ms(baseline)}"


_PROBE_KEY = re.compile(r"[a-z0-9-]{1,40}")
_PROBE_SLUG = re.compile(r"[a-z0-9-]{1,64}")


def log_slug_filter(probe: str):
    """SQLAlchemy filter for the log. None means every result."""
    if probe in ("", "all"):
        return None
    if probe == "internet":
        return Test.slug.in_(tuple(PATH_SLUGS))
    if probe == "web":
        return and_(
            or_(
                Test.slug.startswith("http-"),
                Test.slug.startswith("icmp-"),
                Test.slug.startswith("mtr-"),
            ),
            Test.slug.notin_(tuple(PATH_SLUGS)),
        )
    if probe.startswith("svc:"):
        key = probe[4:]
        if _PROBE_KEY.fullmatch(key) is None:
            raise ValueError("Invalid probe filter")
        return Test.slug.in_((f"http-{key}", f"icmp-{key}", f"mtr-{key}"))
    if probe.startswith("slug:"):
        slug = probe[5:]
        if _PROBE_SLUG.fullmatch(slug) is None:
            raise ValueError("Invalid probe filter")
        return Test.slug == slug
    raise ValueError("Invalid probe filter")


def explain_result(
    kind: str,
    status: str,
    metrics: dict | None,
    stages: list | None,
    message: str | None,
) -> str:
    """Reason for a result saved before reasons were stored on the row."""
    metrics = metrics or {}
    stages = stages or []
    if status == "fail":
        if kind == "http":
            return "No HTTP response."
        if kind == "mtr":
            return "The trace got no response."
        if kind == "iperf3":
            return "Neither download nor upload answered."
        if kind == "ping":
            return "No ICMP response."
        return "No response."
    if status == "degraded":
        return _degraded_fallback(kind, metrics, stages, message)
    if status == "ok":
        return _ok_fallback(kind, metrics, message)
    return "Status was not recorded."


def _degraded_fallback(kind: str, metrics: dict, stages: list, message: str | None) -> str:
    if kind == "http":
        code = _http_code(message)
        if code is not None and code >= 400:
            return f"HTTP {code}. The service answered with an error."
        total = _number(metrics.get("total_ms")) or _number(metrics.get("rtt_ms"))
        ttfb = _stage_ms(stages, "ttfb")
        sentence = "HTTP answered"
        if total is not None:
            sentence += f" in {_ms(total)}"
        sentence += ", slower than the recent normal"
        if ttfb is not None and ttfb > 0:
            sentence += f". Time to first byte was {_ms(ttfb)}"
        return sentence + "."
    if kind == "iperf3":
        down = _number(metrics.get("down_mbps"))
        up = _number(metrics.get("up_mbps"))
        if down is not None and down > 0 and (up is None or up <= 0):
            return f"Download answered at {_mbps(down)}. Upload did not."
        if up is not None and up > 0 and (down is None or down <= 0):
            return f"Upload answered at {_mbps(up)}. Download did not."
        parts = []
        if down is not None:
            parts.append(f"download {_mbps(down)}")
        if up is not None:
            parts.append(f"upload {_mbps(up)}")
        measured = " and ".join(parts) if parts else "throughput"
        return f"{_sentence(measured)} was below the recent normal."
    loss = _number(metrics.get("loss_pct"))
    rtt = _number(metrics.get("rtt_ms"))
    label = "Trace" if kind == "mtr" else "ICMP"
    if loss is not None and loss > 0:
        shown = f" in {_ms(rtt)}" if rtt is not None else ""
        return f"{label} answered{shown} with {_pct(loss)} packet loss."
    jitter = _number(metrics.get("jitter_ms"))
    bits = []
    if rtt is not None:
        bits.append(f"round-trip {_ms(rtt)}")
    if jitter is not None:
        bits.append(f"jitter {_ms(jitter)}")
    measured = " and ".join(bits) if bits else "the sample"
    return f"{label} {measured} was outside the recent normal."


def _ok_fallback(kind: str, metrics: dict, message: str | None) -> str:
    if kind == "http":
        code = _http_code(message)
        total = _number(metrics.get("total_ms")) or _number(metrics.get("rtt_ms"))
        head = f"HTTP {code}" if code is not None else "HTTP"
        if total is None:
            return f"{head} answered within the recent normal."
        return f"{head} answered in {_ms(total)}, within the recent normal."
    if kind == "iperf3":
        down = _number(metrics.get("down_mbps"))
        up = _number(metrics.get("up_mbps"))
        if down is None and up is None:
            return "Throughput was within the recent normal."
        parts = []
        if down is not None:
            parts.append(f"download {_mbps(down)}")
        if up is not None:
            parts.append(f"upload {_mbps(up)}")
        return f"{_sentence(' and '.join(parts))}, within the recent normal."
    rtt = _number(metrics.get("rtt_ms"))
    label = "Trace" if kind == "mtr" else "ICMP" if kind == "ping" else "Check"
    if rtt is None:
        return f"{label} was within the recent normal."
    sentence = f"{label} {_ms(rtt)}"
    jitter = _number(metrics.get("jitter_ms"))
    if kind == "ping" and jitter is not None:
        sentence += f", jitter {_ms(jitter)}"
    return sentence + ", within the recent normal."


def _check_label(kind: TestKind) -> str:
    if kind == TestKind.http:
        return "HTTP"
    if kind == TestKind.mtr:
        return "Trace"
    return "Round-trip"


def _stage_ms(stages: list, name: str) -> float | None:
    for stage in stages:
        if isinstance(stage, dict) and stage.get("name") == name:
            return _number(stage.get("duration_ms"))
    return None


def _ms(value: float | None) -> str:
    if value is None:
        return "an unknown time"
    return f"{value:.1f} ms"


def _sentence(text: str) -> str:
    if not text:
        return text
    return text[0].upper() + text[1:]


def _mbps(value: float) -> str:
    return f"{value:.1f} Mbps"


def _pct(value: float) -> str:
    return f"{value:.0f}%" if value == int(value) else f"{value:.1f}%"


def _response_sample(
    kind: TestKind, metrics: dict, message: str | None
) -> tuple[bool, float | None, bool]:
    if kind == TestKind.http:
        code = _http_code(message)
        if code is None:
            return False, None, False
        value = _number(metrics.get("total_ms"))
        if value is None:
            value = _number(metrics.get("rtt_ms"))
        return True, value, code >= 400
    value = _number(metrics.get("rtt_ms"))
    loss = _number(metrics.get("loss_pct"))
    if value is None or value <= 0 or loss is None or loss >= 100:
        return False, None, False
    return True, value, loss > 0


def _http_code(message: str | None) -> int | None:
    if not message:
        return None
    parts = message.split()
    if len(parts) >= 2 and parts[0].startswith("HTTP/") and parts[1].isdigit():
        return int(parts[1])
    return None


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _baseline_value(db: Session, test: Test, metric: str) -> float | None:
    rows = db.scalars(
        select(TestResult)
        .where(TestResult.test_id == test.id, TestResult.status == ResultStatus.ok)
        .order_by(desc(TestResult.started_at))
        .limit(12)
    ).all()
    values: list[float] = []
    for row in rows:
        sample = _number((row.metrics or {}).get(metric))
        if sample is not None and sample > 0:
            values.append(sample)
    if len(values) < 3:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def load_web_services(db: Session) -> list[WebServiceSetting]:
    rows = list(db.scalars(select(WebServiceSetting).order_by(WebServiceSetting.position, WebServiceSetting.key)))
    known = {row.key for row in rows}
    added = False
    for index, (key, label, url, host) in enumerate(WEB_SERVICES):
        if key in known:
            continue
        db.add(
            WebServiceSetting(
                key=key,
                label=label,
                http_url=url,
                host=host,
                position=index,
                interval_seconds=WEB_HTTP_INTERVAL_SECONDS,
                http_enabled=True,
                icmp_enabled=True,
                jitter_enabled=True,
                mtr_enabled=False,
                variance_pct=25,
                http_variance_pct=25,
                icmp_variance_pct=25,
                jitter_variance_pct=25,
            )
        )
        added = True
    if added:
        db.flush()
        rows = list(db.scalars(select(WebServiceSetting).order_by(WebServiceSetting.position, WebServiceSetting.key)))
    return rows


def save_web_services(db: Session, updates: list[dict]) -> list[WebServiceSetting]:
    rows = {row.key: row for row in load_web_services(db)}
    if {item["key"] for item in updates} != set(rows):
        raise ValueError("Web service list does not match")
    for item in updates:
        row = rows[item["key"]]
        row.interval_seconds = int(item["interval_seconds"])
        row.http_enabled = bool(item["http_enabled"])
        row.icmp_enabled = bool(item["icmp_enabled"])
        row.jitter_enabled = bool(item["jitter_enabled"])
        row.mtr_enabled = False
        row.http_variance_pct = int(item["http_variance_pct"])
        row.icmp_variance_pct = int(item["icmp_variance_pct"])
        row.jitter_variance_pct = int(item["jitter_variance_pct"])
        row.variance_pct = row.icmp_variance_pct
    db.flush()
    for monitor in db.scalars(select(Monitor)):
        ensure_internet_tests(db, monitor)
    return load_web_services(db)


def load_internet_service(db: Session) -> InternetServiceSetting:
    row = db.get(InternetServiceSetting, 1)
    if row is not None:
        return row
    row = InternetServiceSetting(
        id=1,
        interval_seconds=PATH_HTTP_INTERVAL_SECONDS,
        http_enabled=True,
        icmp_enabled=True,
        mtr_enabled=True,
        variance_pct=25,
        http_variance_pct=25,
        icmp_variance_pct=25,
        mtr_variance_pct=25,
        iperf_variance_pct=25,
        iperf_enabled=True,
        iperf_interval_seconds=IPERF_INTERVAL_SECONDS,
    )
    db.add(row)
    db.flush()
    return row


def save_internet_service(db: Session, update: dict) -> InternetServiceSetting:
    row = load_internet_service(db)
    row.interval_seconds = max(int(update["interval_seconds"]), 60)
    row.http_enabled = bool(update["http_enabled"])
    row.icmp_enabled = bool(update["icmp_enabled"])
    row.mtr_enabled = bool(update["mtr_enabled"])
    row.http_variance_pct = int(update["http_variance_pct"])
    row.icmp_variance_pct = int(update["icmp_variance_pct"])
    row.mtr_variance_pct = int(update["mtr_variance_pct"])
    row.iperf_variance_pct = int(update["iperf_variance_pct"])
    row.variance_pct = row.http_variance_pct
    row.iperf_enabled = bool(update["iperf_enabled"])
    row.iperf_interval_seconds = max(int(update["iperf_interval_seconds"]), 300)
    db.flush()
    for monitor in db.scalars(select(Monitor)):
        ensure_internet_tests(db, monitor)
    return row
