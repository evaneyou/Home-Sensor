"""LAN setup page and device-health reporter for a Raspberry Pi remote agent."""

from __future__ import annotations

import base64
import ipaddress
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from checks import link_is_busy, link_lock, parse_link_bssid, parse_link_ssid, run_check, scan_may_run, wifi_roles
from kismet_view import (
    DEVICE_FIELDS,
    iw_scan_skipped,
    map_kismet_capture,
    prefer_survey,
    survey_channels,
    visible_clients,
    with_busy,
)
import rf_spool

AGENT_VERSION = "0.3.10"
# Latency checks wait on the network, so a few of them run at once.
# Bandwidth and the video call stay alone: running them together would slow each other down.
PROBE_WORKERS = 6
HEAVY_KINDS = {"iperf3", "librespeed", "webrtc"}
CONFIG_PATH = Path(os.environ.get("MONITOR_CONFIG", "/etc/monitor/config.json"))
PORT = int(os.environ.get("MONITOR_PORT", "80"))

_lock = threading.Lock()
_scan_lock = threading.Lock()
_stop = threading.Event()
_health_started = False
_tests_started = False
_scan_started = False
_kismet_started = False
_last_link_scan = 0.0
_trusted_bssids: set[str] = set()
_airwave_mode = "off"
_kismet_devices_since = 0
_kismet_alerts_since = 0
KISMET_PATH = CONFIG_PATH.with_name("kismet.json")
SPOOL_PATH = CONFIG_PATH.with_name("rf-capture.sqlite")
_restarting = False
_last_error = ""
_last_health_at = ""
_assigned_tests: list[dict] = []
_next_run: dict[str, float] = {}
_probes = ThreadPoolExecutor(max_workers=PROBE_WORKERS, thread_name_prefix="probe")
_public_lock = threading.Lock()
_public_cached: tuple[str, str | None] | None = None
_public_cached_at = 0.0
PUBLIC_LOOKUP_URL = "http://ip-api.com/json/?fields=status,query,isp"
PUBLIC_LOOKUP_TTL = 24 * 60 * 60
PUBLIC_CACHE_PATH = CONFIG_PATH.with_name("public-cache.json")


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        return {}
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def save_config(config: dict) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = CONFIG_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    os.chmod(tmp, 0o640)
    tmp.replace(CONFIG_PATH)


def server_allowed(url: str) -> bool:
    parsed = urllib.parse.urlparse(url.strip())
    if parsed.scheme == "https" and parsed.hostname:
        return True
    if parsed.scheme != "http" or not parsed.hostname:
        return False
    try:
        address = ipaddress.ip_address(parsed.hostname)
    except ValueError:
        return False
    return address.is_private or address.is_loopback


def _read_cpu() -> tuple[int, int]:
    parts = Path("/proc/stat").read_text(encoding="utf-8").splitlines()[0].split()
    numbers = [int(part) for part in parts[1:]]
    idle = numbers[3]
    return idle, sum(numbers)


def cpu_percent() -> float:
    try:
        idle_a, total_a = _read_cpu()
        time.sleep(0.2)
        idle_b, total_b = _read_cpu()
    except OSError:
        return 0.0
    total = total_b - total_a
    if total <= 0:
        return 0.0
    return round((1 - (idle_b - idle_a) / total) * 100, 1)


def memory_mb() -> tuple[int, int]:
    info: dict[str, int] = {}
    for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
        key, value = line.split(":", 1)
        info[key] = int(value.strip().split()[0])
    total = info.get("MemTotal", 0) // 1024
    available = info.get("MemAvailable", info.get("MemFree", 0)) // 1024
    return max(total - available, 0), total


def disk_mb() -> tuple[int, int]:
    usage = shutil.disk_usage("/")
    return usage.used // (1024 * 1024), usage.total // (1024 * 1024)


def temperature_c() -> float | None:
    path = Path("/sys/class/thermal/thermal_zone0/temp")
    if not path.exists():
        return None
    return round(int(path.read_text(encoding="utf-8").strip()) / 1000, 1)


def uptime_seconds() -> int:
    return int(float(Path("/proc/uptime").read_text(encoding="utf-8").split()[0]))


def load_1() -> float:
    return float(Path("/proc/loadavg").read_text(encoding="utf-8").split()[0])


def lan_ip(server_url: str) -> str | None:
    parsed = urllib.parse.urlparse(server_url)
    host = parsed.hostname
    if not host:
        return None
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect((host, port))
        return sock.getsockname()[0]
    except OSError:
        return None
    finally:
        sock.close()


def _global_ip(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        address = ipaddress.ip_address(value.strip())
    except ValueError:
        return None
    if not address.is_global:
        return None
    return str(address)


def _lookup_public() -> tuple[str, str | None] | None:
    request = urllib.request.Request(PUBLIC_LOOKUP_URL, headers={"User-Agent": "home-sensor-agent"})
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            body = json.loads(response.read().decode("utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(body, dict) or body.get("status") != "success":
        return None
    address = _global_ip(body.get("query"))
    if address is None:
        return None
    provider = body.get("isp")
    if not isinstance(provider, str):
        return address, None
    cleaned = " ".join(provider.split())[:128]
    return address, cleaned or None


def _read_public_cache() -> tuple[str, str | None, float] | None:
    try:
        body = json.loads(PUBLIC_CACHE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(body, dict):
        return None
    address = _global_ip(body.get("public_ip"))
    checked = body.get("checked_at")
    if address is None or not isinstance(checked, (int, float)):
        return None
    provider = body.get("isp")
    if isinstance(provider, str):
        provider = " ".join(provider.split())[:128] or None
    else:
        provider = None
    return address, provider, float(checked)


def _write_public_cache(address: str, provider: str | None, checked: float) -> None:
    payload = {"public_ip": address, "isp": provider, "checked_at": checked}
    try:
        PUBLIC_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = PUBLIC_CACHE_PATH.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload) + "\n", encoding="utf-8")
        os.chmod(tmp, 0o640)
        tmp.replace(PUBLIC_CACHE_PATH)
    except OSError:
        return


def public_network() -> tuple[str | None, str | None]:
    """Public address and service provider, cached on this agent for 24 hours."""
    global _public_cached, _public_cached_at
    now = time.time()
    with _public_lock:
        cached = _public_cached
        fresh = cached is not None and now - _public_cached_at < PUBLIC_LOOKUP_TTL
    if fresh and cached is not None:
        return cached
    stored = _read_public_cache()
    if stored is not None and now - stored[2] < PUBLIC_LOOKUP_TTL:
        with _public_lock:
            _public_cached = (stored[0], stored[1])
            _public_cached_at = stored[2]
        return stored[0], stored[1]
    found = _lookup_public()
    if found is None:
        if stored is not None:
            return stored[0], stored[1]
        return cached if cached is not None else (None, None)
    _write_public_cache(found[0], found[1], now)
    with _public_lock:
        _public_cached = found
        _public_cached_at = now
    return found


def _device_headers(token: str | None, device_name: str | None) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if device_name:
        headers["X-Monitor-Name"] = urllib.parse.quote(device_name, safe="")
    return headers


def get_json(url: str, token: str | None = None, device_name: str | None = None) -> dict:
    request = urllib.request.Request(url, headers=_device_headers(token, device_name), method="GET")
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def post_json(url: str, payload: dict, token: str | None = None, device_name: str | None = None, timeout: int = 10) -> dict:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=_device_headers(token, device_name), method="POST")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def honor_restart(config: dict, restart: bool) -> None:
    """Ack a queued restart, then replace this process so the new code is what runs."""
    global _restarting
    if not restart:
        return
    with _lock:
        if _restarting:
            return
        _restarting = True
    try:
        post_json(
            f"{config['server_url'].rstrip('/')}/api/v1/monitors/command",
            {},
            config.get("token"),
            config.get("name"),
        )
        os.execv(sys.executable, [sys.executable, *sys.argv])
    except (OSError, urllib.error.URLError, TimeoutError, ValueError):
        with _lock:
            _restarting = False
        raise


def poll_restart(config: dict) -> None:
    try:
        body = get_json(
            f"{config['server_url'].rstrip('/')}/api/v1/monitors/command",
            config.get("token"),
            config.get("name"),
        )
    except (OSError, urllib.error.URLError, TimeoutError, ValueError):
        return
    remember_trusted(body)
    honor_restart(config, bool(body.get("restart")))
    if body.get("scan"):
        upload_wifi_scan(config, forced=True)


def sample(config: dict) -> dict:
    mem_used, mem_total = memory_mb()
    disk_used, disk_total = disk_mb()
    public_ip, isp = public_network()
    ssid, bssid = joined_link()
    return {
        "hostname": socket.gethostname(),
        "agent_version": AGENT_VERSION,
        "uptime_seconds": uptime_seconds(),
        "cpu_percent": cpu_percent(),
        "load_1": load_1(),
        "mem_used_mb": mem_used,
        "mem_total_mb": mem_total,
        "disk_used_mb": disk_used,
        "disk_total_mb": disk_total,
        "temp_c": temperature_c(),
        "lan_ip": lan_ip(config.get("server_url", "")),
        "public_ip": public_ip,
        "isp": isp,
        "config_version": int(config.get("config_version") or 0),
        "airwave_mode": airwave_mode(),
        "link_ssid": ssid,
        "link_bssid": bssid,
    }


def joined_link() -> tuple[str, str]:
    iface = wifi_roles().get("link")
    if not iface:
        return "", ""
    try:
        text = subprocess.check_output(
            ["iw", "dev", iface, "link"],
            text=True,
            timeout=5,
            stderr=subprocess.DEVNULL,
        )
    except (OSError, subprocess.TimeoutExpired, subprocess.CalledProcessError):
        return "", ""
    return parse_link_ssid(text), parse_link_bssid(text)


def setup_allowed(enrolled: bool, host: str, current_key: str, stored_token: str) -> bool:
    """An enrolled agent accepts a LAN change only when the current device key is presented."""
    if not enrolled:
        return True
    if host in {"127.0.0.1", "::1"}:
        return True
    return bool(stored_token) and current_key == stored_token


def remember_trusted(body: dict) -> None:
    global _trusted_bssids
    raw = body.get("trusted_bssids")
    if isinstance(raw, list):
        _trusted_bssids = {str(item).lower() for item in raw}


def airwave_mode() -> str:
    if _airwave_mode == "kismet":
        return "kismet"
    roles = wifi_roles()
    if roles["radio"] or roles["link"]:
        return "scan"
    return "off"


def apply_config(config: dict, body: dict) -> bool:
    changed = False
    if body.get("name") and body["name"] != config.get("name"):
        config["name"] = body["name"]
        changed = True
    interval = body.get("health_interval_seconds")
    if interval and int(interval) != int(config.get("health_interval_seconds") or 60):
        config["health_interval_seconds"] = int(interval)
        changed = True
    scan_interval = body.get("scan_interval_seconds")
    if scan_interval and int(scan_interval) != int(config.get("scan_interval_seconds") or 300):
        config["scan_interval_seconds"] = int(scan_interval)
        changed = True
    version = body.get("config_version")
    if version is not None and int(version) != int(config.get("config_version") or 0):
        config["config_version"] = int(version)
        changed = True
    return changed


def report_once(config: dict) -> None:
    global _last_error, _last_health_at
    server = config["server_url"].rstrip("/")
    sent = int(config.get("config_version") or 0)
    body = post_json(
        f"{server}/api/v1/monitors/health",
        sample(config),
        config.get("token"),
        config.get("name"),
    )
    remember_trusted(body)
    if apply_config(config, body):
        save_config(config)
        if int(config.get("config_version") or 0) != sent:
            body = post_json(
                f"{server}/api/v1/monitors/health",
                sample(config),
                config.get("token"),
                config.get("name"),
            )
    remember_tests(body.get("tests"))
    _last_error = ""
    _last_health_at = time.strftime("%Y-%m-%d %H:%M:%S")
    honor_restart(config, bool(body.get("restart")))


def wifi_scan_text(iface: str) -> str | None:
    try:
        return subprocess.check_output(["iw", "dev", iface, "scan"], text=True, timeout=25, stderr=subprocess.STDOUT)
    except (OSError, subprocess.TimeoutExpired, subprocess.CalledProcessError):
        return None


def wifi_survey_text(iface: str) -> str:
    try:
        return subprocess.check_output(
            ["iw", "dev", iface, "survey", "dump"],
            text=True,
            timeout=10,
            stderr=subprocess.DEVNULL,
        )
    except (OSError, subprocess.TimeoutExpired, subprocess.CalledProcessError):
        return ""


def upload_wifi_scan(config: dict, forced: bool = False) -> None:
    """Post one real scan. The radio adapter is used whenever a second NIC exists."""
    global _last_link_scan
    if not _scan_lock.acquire(blocking=False):
        return
    link_held = False
    try:
        roles = wifi_roles()
        if iw_scan_skipped(airwave_mode(), roles["radio"]):
            return
        iface = roles["radio"] or roles["link"]
        role = "radio" if roles["radio"] else "link" if roles["link"] else ""
        if not iface or not role:
            return
        now = time.monotonic()
        if not scan_may_run(
            role=role,
            last_link_scan=_last_link_scan,
            now=now,
            link_busy=link_is_busy(),
            forced=forced,
        ):
            return
        if role == "link" and not link_lock.acquire(blocking=False):
            return
        if role == "link":
            link_held = True
        text = wifi_scan_text(iface)
        if text is None:
            return
        post_json(
            f"{config['server_url'].rstrip('/')}/api/v1/monitors/wifi-scans",
            {
                "scanned_at": datetime.now(timezone.utc).isoformat(),
                "raw": text,
                "survey": wifi_survey_text(iface),
                "scan_iface_role": role,
            },
            config.get("token"),
            config.get("name"),
            timeout=30,
        )
        if role == "link":
            _last_link_scan = time.monotonic()
    except (OSError, urllib.error.URLError, TimeoutError, ValueError):
        return
    finally:
        if link_held:
            link_lock.release()
        _scan_lock.release()


def remember_tests(tests: object) -> None:
    global _assigned_tests
    if not isinstance(tests, list):
        return
    assigned = []
    for item in tests:
        if not isinstance(item, dict):
            continue
        if item.get("kind") not in {"http", "iperf3", "librespeed", "webrtc", "ping", "mtr"}:
            continue
        if not item.get("slug") or not item.get("target"):
            continue
        assigned.append(item)
    with _lock:
        _assigned_tests = assigned


def _test_key(test: dict) -> str:
    return f"{test.get('network_slug')}:{test.get('slug')}"


def _interval_seconds(test: dict) -> int:
    interval = int(test.get("interval_seconds") or 300)
    kind = test.get("kind")
    if kind in HEAVY_KINDS:
        return max(interval, 300)
    if kind == "mtr":
        return max(interval, 120)
    return max(interval, 60)


def due_tests(now: float) -> list[dict]:
    with _lock:
        assigned = list(_assigned_tests)
        live = {_test_key(test) for test in assigned}
        for key in list(_next_run):
            if key not in live:
                _next_run.pop(key, None)
        ready = [test for test in assigned if now >= _next_run.get(_test_key(test), 0)]
    return ready


def _mark_ran(test: dict) -> None:
    with _lock:
        _next_run[_test_key(test)] = time.monotonic() + _interval_seconds(test)


def _run_one(test: dict) -> dict | None:
    global _last_error
    result = None
    try:
        result = run_check(test)
    except (OSError, TimeoutError, ValueError) as exc:
        with _lock:
            _last_error = str(exc)
    finally:
        _mark_ran(test)
    return result


def _idle_seconds() -> float:
    """Sleep until the next check is due, but wake at least every 15s for a new assignment."""
    now = time.monotonic()
    with _lock:
        assigned = list(_assigned_tests)
        upcoming = [_next_run.get(_test_key(test), 0) for test in assigned]
    if not upcoming:
        return 15
    return min(15.0, max(0.5, min(upcoming) - now))


def run_due_tests(config: dict) -> None:
    ready = due_tests(time.monotonic())
    if not ready:
        return
    with link_lock:
        _run_due_tests(config, ready)


def _run_due_tests(config: dict, ready: list[dict]) -> None:
    latency = [test for test in ready if test.get("kind") not in HEAVY_KINDS | {"mtr"}]
    traces = [test for test in ready if test.get("kind") == "mtr"]
    heavy = [test for test in ready if test.get("kind") in HEAVY_KINDS]
    results = [result for result in _probes.map(_run_one, latency) if result]
    # A trace shares the link with nothing else, so its timing is the path, not the other probes.
    results.extend(result for result in _probes.map(_run_one, traces) if result)
    results.extend(result for result in (_run_one(test) for test in heavy) if result)
    if not results:
        return
    post_json(
        f"{config['server_url'].rstrip('/')}/api/v1/ingest",
        {"results": results},
        config.get("token"),
        config.get("name"),
    )


def test_loop() -> None:
    global _last_error
    while not _stop.is_set():
        with _lock:
            config = load_config()
        if config.get("token") and config.get("name") and config.get("server_url"):
            try:
                snapshot = dict(config)
                poll_restart(snapshot)
                run_due_tests(snapshot)
            except (OSError, urllib.error.URLError, TimeoutError, ValueError, KeyError) as exc:
                _last_error = str(exc)
        _stop.wait(_idle_seconds())


def health_loop() -> None:
    global _last_error
    while not _stop.is_set():
        with _lock:
            config = load_config()
        if config.get("token") and config.get("name") and config.get("server_url"):
            try:
                report_once(dict(config))
            except (OSError, urllib.error.URLError, TimeoutError, ValueError, KeyError) as exc:
                _last_error = str(exc)
        with _lock:
            interval = int(load_config().get("health_interval_seconds") or 60)
        _stop.wait(max(interval, 15))


def _kismet_auth(user: str, password: str) -> str:
    token = base64.b64encode(f"{user}:{password}".encode()).decode("ascii")
    return f"Basic {token}"


def kismet_get(base: str, user: str, password: str, path: str) -> object:
    request = urllib.request.Request(
        base.rstrip("/") + path,
        headers={"Authorization": _kismet_auth(user, password)},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def kismet_devices(base: str, user: str, password: str, since: int) -> object:
    """Ask Kismet for the device fields we map, instead of a full record."""
    body = urllib.parse.urlencode({"json": json.dumps({"fields": DEVICE_FIELDS})}).encode()
    request = urllib.request.Request(
        f"{base.rstrip('/')}/devices/last-time/{since}/devices.json",
        data=body,
        headers={
            "Authorization": _kismet_auth(user, password),
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def kismet_survey_text() -> str:
    roles = wifi_roles()
    radio = str(roles.get("radio") or "")
    link = str(roles.get("link") or "")
    radio_text = wifi_survey_text(radio) if radio else ""
    link_text = "" if not link or link == radio else wifi_survey_text(link)
    return prefer_survey(radio_text, link_text)


def _capture_body(devices: object, channels: object, alerts: object) -> dict:
    mapped = map_kismet_capture(devices, channels, alerts)
    return {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "aps": mapped["aps"],
        "clients": visible_clients(mapped["clients"], _trusted_bssids),
        "channels": with_busy(mapped["channels"], survey_channels(kismet_survey_text())),
        "alerts": mapped["alerts"],
    }


def _post_capture(config: dict, payload: dict) -> None:
    post_json(
        f"{config['server_url'].rstrip('/')}/api/v1/monitors/rf-capture",
        payload,
        config.get("token"),
        config.get("name"),
        timeout=30,
    )


def _drain_spool(config: dict) -> None:
    for row_id, payload in rf_spool.pending(SPOOL_PATH):
        _post_capture(config, payload)
        rf_spool.drop(SPOOL_PATH, row_id)


def kismet_once(config: dict) -> None:
    global _airwave_mode, _kismet_devices_since, _kismet_alerts_since
    if not KISMET_PATH.is_file():
        _airwave_mode = "off"
        return
    try:
        creds = json.loads(KISMET_PATH.read_text(encoding="utf-8"))
        base = str(creds.get("url") or "http://127.0.0.1:2501")
        user = str(creds["username"])
        password = str(creds["password"])
        kismet_get(base, user, password, "/system/status.json")
    except (OSError, urllib.error.URLError, TimeoutError, ValueError, KeyError, json.JSONDecodeError):
        _airwave_mode = "off"
        return
    _airwave_mode = "kismet"
    now = int(time.time())
    device_since = _kismet_devices_since or now - 60
    alert_since = _kismet_alerts_since or now - 60
    try:
        devices = kismet_devices(base, user, password, device_since)
        channels = kismet_get(base, user, password, "/channels/channels.json")
        alerts = kismet_get(base, user, password, f"/alerts/last-time/{alert_since}/alerts.json")
        payload = _capture_body(devices, channels, alerts)
        try:
            _drain_spool(config)
            _post_capture(config, payload)
        except (OSError, urllib.error.URLError, TimeoutError, ValueError):
            rf_spool.push(SPOOL_PATH, payload)
        _kismet_devices_since = now
        _kismet_alerts_since = now
    except (OSError, urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError):
        return


def kismet_loop() -> None:
    global _last_error
    while not _stop.is_set():
        with _lock:
            config = load_config()
        if config.get("token") and config.get("name") and config.get("server_url"):
            try:
                kismet_once(dict(config))
            except (OSError, urllib.error.URLError, TimeoutError, ValueError, KeyError) as exc:
                _last_error = str(exc)
        _stop.wait(60)


def scan_loop() -> None:
    global _last_error
    while not _stop.is_set():
        with _lock:
            config = load_config()
        if config.get("token") and config.get("name") and config.get("server_url"):
            try:
                upload_wifi_scan(dict(config))
            except (OSError, urllib.error.URLError, TimeoutError, ValueError, KeyError) as exc:
                _last_error = str(exc)
        with _lock:
            interval = int(load_config().get("scan_interval_seconds") or 300)
        _stop.wait(max(interval, 15))


def ensure_health_loop() -> None:
    global _health_started, _tests_started, _scan_started, _kismet_started
    with _lock:
        start_health = not _health_started
        start_tests = not _tests_started
        start_scan = not _scan_started
        start_kismet = not _kismet_started
        _health_started = True
        _tests_started = True
        _scan_started = True
        _kismet_started = True
    if start_health:
        threading.Thread(target=health_loop, name="health", daemon=True).start()
    if start_tests:
        threading.Thread(target=test_loop, name="internet", daemon=True).start()
    if start_scan:
        threading.Thread(target=scan_loop, name="wifi-scan", daemon=True).start()
    if start_kismet:
        threading.Thread(target=kismet_loop, name="kismet", daemon=True).start()


PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Remote Agent setup</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font: 16px/1.4 system-ui, sans-serif; background: #141414; color: #e4e4e4; }
    main { max-width: 28rem; margin: 3rem auto; padding: 0 1rem; }
    h1 { font-size: 1.4rem; margin: 0 0 0.4rem; }
    p { color: #8a8a8a; }
    label { display: block; margin: 0.9rem 0 0.3rem; color: #8a8a8a; font-size: 0.85rem; }
    input { width: 100%; box-sizing: border-box; padding: 0.55rem 0.7rem; border-radius: 6px;
      border: 1px solid #2a2a2a; background: #181818; color: inherit; }
    button { margin-top: 1rem; padding: 0.55rem 0.9rem; border: 0; border-radius: 6px;
      background: #4c9df3; color: #0d0d0d; font: inherit; }
    .error { color: #e34671; }
    .ok { color: #3fa266; }
  </style>
</head>
<body>
  <main>
    <h1>Remote Agent setup</h1>
    <p id="lead">Enter the device name and key from Remote Agent Onboarding. The name must match exactly, including capital letters.</p>
    <form id="setup">
      <label for="name">Device name</label>
      <input id="name" name="name" required autocomplete="off" />
      <label for="server">Server</label>
      <input id="server" name="server_url" placeholder="http://10.0.0.123:8847" required />
      <label for="key">Device key</label>
      <input id="key" name="device_key" required autocomplete="off" spellcheck="false" />
      <label id="current-label" for="current" hidden>Current device key</label>
      <input id="current" name="current_key" hidden autocomplete="off" spellcheck="false" />
      <button type="submit">Connect</button>
    </form>
    <button id="replace" type="button" hidden>Update name and key</button>
    <p id="reset-note" hidden>To start over, run sudo hnw-reset on this Pi. That clears /etc/monitor/config.json.</p>
    <p id="message"></p>
  </main>
  <script>
    const form = document.getElementById("setup");
    const message = document.getElementById("message");
    const lead = document.getElementById("lead");
    const replace = document.getElementById("replace");
    const currentLabel = document.getElementById("current-label");
    const currentKey = document.getElementById("current");
    const resetNote = document.getElementById("reset-note");
    let editing = false;
    replace.addEventListener("click", () => {
      editing = true;
      form.hidden = false;
      replace.hidden = true;
      currentLabel.hidden = false;
      currentKey.hidden = false;
      resetNote.hidden = false;
    });
    async function refresh() {
      const status = await fetch("/api/status").then((r) => r.json());
      if (!status.enrolled) return;
      if (!editing) {
        form.hidden = true;
        replace.hidden = false;
      }
      lead.textContent = status.name + " is connected to " + status.server_url + ". The name and key must still match the server.";
      message.className = status.last_error ? "error" : "ok";
      const mode = status.airwave_mode ? " Airwave capture is " + status.airwave_mode + "." : "";
      message.textContent = status.last_error || (status.last_health_at ? "Last report " + status.last_health_at + "." + mode : "Waiting for the first report." + mode);
    }
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      message.className = "";
      message.textContent = "Connecting…";
      const body = Object.fromEntries(new FormData(form).entries());
      const response = await fetch("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        message.className = "error";
        message.textContent = payload.detail || "Could not connect";
        return;
      }
      editing = false;
      await refresh();
    });
    refresh();
    setInterval(refresh, 5000);
  </script>
</body>
</html>
"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        return

    def _send(self, code: int, body: bytes, content_type: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path.startswith("/api/status"):
            with _lock:
                config = load_config()
            payload = {
                "enrolled": bool(config.get("token")),
                "name": config.get("name") or "",
                "server_url": config.get("server_url") or "",
                "last_health_at": _last_health_at,
                "last_error": _last_error,
                "airwave_mode": airwave_mode(),
            }
            self._send(200, json.dumps(payload).encode("utf-8"), "application/json")
            return
        self._send(200, PAGE.encode("utf-8"), "text/html; charset=utf-8")

    def do_POST(self) -> None:
        if not self.path.startswith("/api/setup"):
            self._send(404, b"{}", "application/json")
            return
        length = int(self.headers.get("Content-Length") or "0")
        try:
            incoming = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError):
            self._send(400, json.dumps({"detail": "Invalid request"}).encode("utf-8"), "application/json")
            return
        name = str(incoming.get("name") or "").strip()
        server_url = str(incoming.get("server_url") or "").strip().rstrip("/")
        device_key = str(incoming.get("device_key") or "").strip()
        current_key = str(incoming.get("current_key") or "")
        with _lock:
            config = load_config()
        if not setup_allowed(bool(config.get("token")), self.client_address[0], current_key, str(config.get("token") or "")):
            self._send(
                403,
                json.dumps({"detail": "This remote agent is already enrolled. Enter the current device key, or run sudo hnw-reset on the Pi."}).encode("utf-8"),
                "application/json",
            )
            return
        if not name or not server_url or not device_key:
            self._send(400, json.dumps({"detail": "Name, server, and device key are required"}).encode("utf-8"), "application/json")
            return
        if not server_allowed(server_url):
            self._send(400, json.dumps({"detail": "Use HTTPS, or HTTP to a private LAN address"}).encode("utf-8"), "application/json")
            return
        preview = {"name": name, "server_url": server_url, "token": device_key, "config_version": 0}
        try:
            accepted = post_json(
                f"{server_url}/api/v1/monitors/health",
                sample(preview),
                device_key,
                name,
            )
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            try:
                detail = json.loads(detail).get("detail", detail)
            except json.JSONDecodeError:
                pass
            self._send(exc.code, json.dumps({"detail": detail}).encode("utf-8"), "application/json")
            return
        except (OSError, urllib.error.URLError, ValueError):
            self._send(502, json.dumps({"detail": "Could not reach the server"}).encode("utf-8"), "application/json")
            return
        config = {
            "name": name,
            "server_url": server_url,
            "token": device_key,
            "health_interval_seconds": int(accepted.get("health_interval_seconds") or 60),
            "scan_interval_seconds": int(accepted.get("scan_interval_seconds") or 300),
            "config_version": int(accepted.get("config_version") or 1),
        }
        with _lock:
            save_config(config)
        ensure_health_loop()
        self._send(200, json.dumps({"ok": True, "name": config["name"]}).encode("utf-8"), "application/json")


def main() -> None:
    if load_config().get("token"):
        ensure_health_loop()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
