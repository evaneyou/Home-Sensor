from __future__ import annotations

import hashlib
import random
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, joinedload

from app.auth import hash_password
from app.config import get_settings
from app.db import SessionLocal, engine
from app.models import (
    Base,
    Group,
    Issue,
    IssueSeverity,
    IssueStatus,
    Network,
    NetworkKind,
    ResultStatus,
    Sensor,
    SensorStatus,
    Test,
    TestKind,
    TestResult,
    User,
    UserRole,
)

DEMO_GROUP_SLUG = "demo-home"

# Stable UUIDs so re-seed is idempotent via upsert-by-id
IDS = {
    "group": uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
    "sensor_lr": uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1"),
    "sensor_of": uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2"),
    "net_wan": uuid.UUID("cccccccc-cccc-cccc-cccc-ccccccccccc1"),
    "net_lan": uuid.UUID("cccccccc-cccc-cccc-cccc-ccccccccccc2"),
    "net_wifi": uuid.UUID("cccccccc-cccc-cccc-cccc-ccccccccccc3"),
    "admin": uuid.UUID("dddddddd-dddd-dddd-dddd-ddddddddddd1"),
    "viewer": uuid.UUID("dddddddd-dddd-dddd-dddd-ddddddddddd2"),
}


def _stable_uuid(key: str) -> uuid.UUID:
    return uuid.UUID(hashlib.md5(key.encode()).hexdigest())


def _sensor_token(slug: str) -> str:
    return f"sensor-token-{slug}"


STAGE_TEMPLATES = {
    TestKind.http: ["dns", "tcp", "tls", "ttfb", "download"],
    TestKind.dns: ["resolve"],
    TestKind.ping: ["icmp"],
    TestKind.wifi: ["associate", "dhcp", "dns", "http"],
}


def _gen_stages(kind: TestKind, status: ResultStatus, rng: random.Random) -> list[dict]:
    names = STAGE_TEMPLATES[kind]
    stages = []
    fail_at = None
    if status == ResultStatus.fail:
        fail_at = rng.choice(names)
    elif status == ResultStatus.degraded:
        fail_at = names[-1] if len(names) > 1 else names[0]

    for name in names:
        base = {
            "dns": rng.uniform(8, 40),
            "tcp": rng.uniform(5, 30),
            "tls": rng.uniform(20, 80),
            "ttfb": rng.uniform(30, 150),
            "download": rng.uniform(40, 200),
            "resolve": rng.uniform(5, 35),
            "icmp": rng.uniform(2, 25),
            "associate": rng.uniform(50, 200),
            "dhcp": rng.uniform(30, 120),
            "http": rng.uniform(40, 180),
        }.get(name, rng.uniform(10, 50))
        if status == ResultStatus.degraded:
            base *= rng.uniform(1.8, 3.0)
        st = "ok"
        if fail_at and name == fail_at:
            st = "fail" if status == ResultStatus.fail else "degraded"
            if status == ResultStatus.fail:
                base *= rng.uniform(2.0, 5.0)
        stages.append({"name": name, "duration_ms": round(base, 1), "status": st})
        if st == "fail":
            break
    return stages


def _gen_metrics(kind: TestKind, status: ResultStatus, stages: list[dict], rng: random.Random) -> dict:
    total = sum(s["duration_ms"] for s in stages)
    rtt = total if kind in (TestKind.ping, TestKind.dns) else rng.uniform(15, 80)
    if status == ResultStatus.degraded:
        rtt *= rng.uniform(2.0, 4.0)
    elif status == ResultStatus.fail:
        rtt *= rng.uniform(5.0, 10.0)
    loss = 0.0
    if status == ResultStatus.degraded:
        loss = rng.uniform(2, 8)
    elif status == ResultStatus.fail:
        loss = rng.uniform(20, 100)
    return {"rtt_ms": round(rtt, 2), "loss_pct": round(loss, 2), "total_ms": round(total, 1)}


def wipe_demo(db: Session) -> None:
    group = db.scalar(select(Group).where(Group.slug == DEMO_GROUP_SLUG))
    if group:
        # Cascades handle children when FK ondelete=CASCADE; delete issues/tests/results explicitly for safety
        sensor_ids = [s.id for s in db.scalars(select(Sensor).where(Sensor.group_id == group.id)).all()]
        network_ids = [n.id for n in db.scalars(select(Network).where(Network.group_id == group.id)).all()]
        test_ids = []
        if sensor_ids:
            test_ids = [t.id for t in db.scalars(select(Test).where(Test.sensor_id.in_(sensor_ids))).all()]
        if test_ids:
            db.execute(delete(TestResult).where(TestResult.test_id.in_(test_ids)))
            db.execute(delete(Test).where(Test.id.in_(test_ids)))
        db.execute(delete(Issue).where(Issue.group_id == group.id))
        if sensor_ids:
            db.execute(delete(Sensor).where(Sensor.id.in_(sensor_ids)))
        if network_ids:
            db.execute(delete(Network).where(Network.id.in_(network_ids)))
        db.execute(delete(Group).where(Group.id == group.id))
        db.flush()


def seed(db: Session) -> None:
    settings = get_settings()
    wipe_demo(db)

    # Users (upsert by username)
    for uid, username, password, role in [
        (IDS["admin"], settings.bootstrap_admin_username, settings.bootstrap_admin_password, UserRole.admin),
        (IDS["viewer"], settings.bootstrap_viewer_username, settings.bootstrap_viewer_password, UserRole.viewer),
    ]:
        existing = db.scalar(select(User).where(User.username == username))
        if existing:
            existing.password_hash = hash_password(password)
            existing.role = role
            existing.is_active = True
        else:
            db.add(
                User(
                    id=uid,
                    username=username,
                    password_hash=hash_password(password),
                    role=role,
                )
            )

    group = Group(id=IDS["group"], slug=DEMO_GROUP_SLUG, name="Demo Home")
    db.add(group)

    sensors = [
        Sensor(
            id=IDS["sensor_lr"],
            group_id=group.id,
            slug="pi-living-room",
            name="Pi Living Room",
            token_hash=hash_password(_sensor_token("pi-living-room")),
            status=SensorStatus.online,
            last_seen_at=datetime.now(timezone.utc),
        ),
        Sensor(
            id=IDS["sensor_of"],
            group_id=group.id,
            slug="pi-office",
            name="Pi Office",
            token_hash=hash_password(_sensor_token("pi-office")),
            status=SensorStatus.online,
            last_seen_at=datetime.now(timezone.utc) - timedelta(minutes=2),
        ),
    ]
    db.add_all(sensors)

    networks = [
        Network(id=IDS["net_wan"], group_id=group.id, slug="wan", name="WAN / Internet", kind=NetworkKind.wired),
        Network(id=IDS["net_lan"], group_id=group.id, slug="lan", name="LAN Wired", kind=NetworkKind.wired),
        Network(id=IDS["net_wifi"], group_id=group.id, slug="wifi-main", name="Wi-Fi Main", kind=NetworkKind.wifi),
    ]
    db.add_all(networks)
    db.flush()

    # Tests: each sensor × relevant networks
    test_defs: list[tuple[Sensor, Network, str, str, TestKind, str]] = []
    for sensor in sensors:
        test_defs.extend(
            [
                (sensor, networks[0], "http-cloudflare", "HTTP Cloudflare", TestKind.http, "https://1.1.1.1"),
                (sensor, networks[0], "dns-resolver", "DNS Resolver", TestKind.dns, "1.1.1.1"),
                (sensor, networks[0], "ping-gateway", "Ping Gateway", TestKind.ping, "192.168.1.1"),
                (sensor, networks[1], "ping-nas", "Ping NAS", TestKind.ping, "192.168.1.50"),
                (sensor, networks[2], "wifi-assoc", "Wi-Fi Association", TestKind.wifi, "HomeMain"),
                (sensor, networks[2], "http-local", "HTTP Router UI", TestKind.http, "http://192.168.1.1"),
            ]
        )

    tests: list[Test] = []
    for sensor, network, slug, name, kind, target in test_defs:
        t = Test(
            id=_stable_uuid(f"test:{sensor.slug}:{network.slug}:{slug}"),
            sensor_id=sensor.id,
            network_id=network.id,
            slug=slug,
            name=name,
            kind=kind,
            target=target,
            interval_seconds=300,
        )
        tests.append(t)
    db.add_all(tests)
    db.flush()

    now = datetime.now(timezone.utc)
    rng = random.Random(42)
    results: list[TestResult] = []
    # Interval: 2 hours → ~360 points/test × 12 tests ≈ 4.3k rows (manageable)
    interval = timedelta(hours=2)
    days = 30
    start = now - timedelta(days=days)

    fail_windows = [
        (24 * 3, 24 * 3 + 6, ResultStatus.fail, "http-cloudflare", "pi-living-room", "wan"),
        (24 * 10, 24 * 10 + 4, ResultStatus.degraded, "dns-resolver", "pi-office", "wan"),
        (24 * 20, 24 * 20 + 8, ResultStatus.fail, "wifi-assoc", "pi-living-room", "wifi-main"),
        (24 * 27, 24 * 27 + 3, ResultStatus.degraded, "ping-gateway", "pi-office", "wan"),
    ]

    tests_loaded = db.scalars(
        select(Test).options(joinedload(Test.sensor), joinedload(Test.network))
    ).unique().all()
    for test in tests_loaded:
        t = start
        idx = 0
        while t < now:
            status = ResultStatus.ok
            for wh_start, wh_end, wh_status, slug, sensor_slug, net_slug in fail_windows:
                hours = (t - start).total_seconds() / 3600
                if (
                    wh_start <= hours <= wh_end
                    and test.slug == slug
                    and test.sensor.slug == sensor_slug
                    and test.network.slug == net_slug
                ):
                    status = wh_status
                    break
            if status == ResultStatus.ok and rng.random() < 0.03:
                status = ResultStatus.degraded if rng.random() < 0.7 else ResultStatus.fail

            stages = _gen_stages(test.kind, status, rng)
            metrics = _gen_metrics(test.kind, status, stages, rng)
            finished = t + timedelta(milliseconds=metrics["total_ms"])
            ext = f"seed-{test.id.hex[:8]}-{idx}"
            results.append(
                TestResult(
                    id=_stable_uuid(ext),
                    external_id=ext,
                    test_id=test.id,
                    started_at=t,
                    finished_at=finished,
                    status=status,
                    stages=stages,
                    metrics=metrics,
                    message=None if status == ResultStatus.ok else f"{status.value} during staged run",
                )
            )
            t += interval
            idx += 1

    db.add_all(results)

    # Sample issues tied to failure windows
    issue_defs = [
        (
            "Critical WAN HTTP failures on living-room Pi",
            "HTTP Cloudflare checks failed for ~6 hours; TLS stage elevated then timed out.",
            IssueSeverity.critical,
            IssueStatus.open,
            "tls",
            sensors[0],
            networks[0],
            next(t for t in tests_loaded if t.slug == "http-cloudflare" and t.sensor_id == sensors[0].id),
            now - timedelta(days=27),
            None,
        ),
        (
            "Wi-Fi association flapping",
            "Association stage failing on Main SSID from living-room sensor.",
            IssueSeverity.warning,
            IssueStatus.open,
            "associate",
            sensors[0],
            networks[2],
            next(t for t in tests_loaded if t.slug == "wifi-assoc" and t.sensor_id == sensors[0].id),
            now - timedelta(days=10),
            None,
        ),
        (
            "DNS resolver elevated latency",
            "Office Pi DNS resolve stage degraded for several hours; recovered.",
            IssueSeverity.warning,
            IssueStatus.resolved,
            "resolve",
            sensors[1],
            networks[0],
            next(t for t in tests_loaded if t.slug == "dns-resolver" and t.sensor_id == sensors[1].id),
            now - timedelta(days=20),
            now - timedelta(days=19, hours=20),
        ),
        (
            "Gateway ping degradation",
            "ICMP RTT spiked from office sensor; brief window, auto-resolved.",
            IssueSeverity.info,
            IssueStatus.resolved,
            "icmp",
            sensors[1],
            networks[0],
            next(t for t in tests_loaded if t.slug == "ping-gateway" and t.sensor_id == sensors[1].id),
            now - timedelta(days=3),
            now - timedelta(days=2, hours=21),
        ),
    ]
    for title, summary, sev, st, root, sensor, network, test, opened, resolved in issue_defs:
        db.add(
            Issue(
                id=_stable_uuid(f"issue:{title}"),
                group_id=group.id,
                sensor_id=sensor.id,
                network_id=network.id,
                test_id=test.id,
                title=title,
                summary=summary,
                severity=sev,
                status=st,
                root_cause_stage=root,
                opened_at=opened,
                resolved_at=resolved,
            )
        )

    db.commit()
    print(
        f"Seeded demo group '{DEMO_GROUP_SLUG}': "
        f"{len(sensors)} sensors, {len(networks)} networks, {len(tests_loaded)} tests, "
        f"{len(results)} results, {len(issue_defs)} issues."
    )
    print(f"Admin login: {settings.bootstrap_admin_username} / {settings.bootstrap_admin_password}")
    print(f"Sensor tokens: sensor-token-<slug> e.g. {_sensor_token('pi-living-room')}")


def main() -> None:
    # Ensure tables exist if migrations not run (dev convenience)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed(db)
    finally:
        db.close()


if __name__ == "__main__":
    main()
