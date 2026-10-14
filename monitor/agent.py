"""LAN setup page and device-health reporter for a Raspberry Pi remote agent."""

from __future__ import annotations

import base64
import binascii
import hashlib
import http.client
import io
import ipaddress
import json
import os
import re
import secrets
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from checks import (
    interface_roles,
    link_is_busy,
    link_lock,
    parse_link_bssid,
    parse_link_ssid,
    run_check,
    scan_may_run,
    wifi_roles,
)
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
import synthetic

AGENT_VERSION = "0.5.0"
# Latency checks wait on the network, so a few of them run at once.
# File Transfer stays alone: running it beside others would slow them all down.
PROBE_WORKERS = 6
HEAVY_KINDS = {"librespeed"}
CONFIG_PATH = Path(os.environ.get("MONITOR_CONFIG", "/etc/monitor/config.json"))
PORT = int(os.environ.get("MONITOR_PORT", "80"))
ENROLL_PORT = 8848
SIGNATURE_CONTEXT = "hns-agent-v1"
NONCE_PATH = "/api/v1/agents/nonce"
CHECK_IN_PATH = "/api/v1/agents/check-in"
POLL_PATH = "/api/v1/agents/poll"
_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
CODE_LENGTH = 12
TUNNEL_SERVER_IP = "10.7.0.1"
WIRELESS_SERVER_IP = "10.7.1.1"
_TUNNELS = {
    "wired": (TUNNEL_SERVER_IP, 51820, 100, "wg0"),
    "wireless": (WIRELESS_SERVER_IP, 51821, 101, "wg1"),
}

_lock = threading.Lock()
_scan_lock = threading.Lock()
_stop = threading.Event()
_health_started = False
_enroll_started = False
_tests_started = False
_scan_started = False
_kismet_started = False
_synthetic_started = False
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


def signed_message(path: str, nonce: str, fields: list[str]) -> bytes:
    parts = [SIGNATURE_CONTEXT, path, nonce, *fields]
    if any("\n" in part for part in parts):
        raise ValueError("Signed fields cannot contain newlines")
    return "\n".join(parts).encode()


def new_installer_code() -> str:
    raw = "".join(secrets.choice(_CROCKFORD) for _ in range(CODE_LENGTH))
    return f"{raw[:4]}-{raw[4:8]}-{raw[8:]}"


def identity_path() -> Path:
    return CONFIG_PATH.with_name("identity.pem")


def wireguard_secret_path(link: str) -> Path:
    name = "wg.key" if link == "wired" else "wg-wireless.key"
    return CONFIG_PATH.with_name(name)


def wireguard_dir() -> Path:
    return Path(os.environ.get("MONITOR_WIREGUARD_DIR", "/etc/wireguard"))


def _write_secret(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(text)
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def _openssl(args: list[str], payload: bytes | None = None) -> bytes:
    try:
        result = subprocess.run(["openssl", *args], input=payload, capture_output=True, check=False)
    except OSError as exc:
        raise RuntimeError("openssl is required for enrollment") from exc
    if result.returncode != 0:
        raise RuntimeError("openssl is required for enrollment")
    return result.stdout


def _raw_public(pem_path: Path) -> str:
    der = _openssl(["pkey", "-in", str(pem_path), "-pubout", "-outform", "DER"])
    if len(der) < 32:
        raise RuntimeError("openssl is required for enrollment")
    return base64.b64encode(der[-32:]).decode("ascii")


def _raw_private(pem_path: Path) -> str:
    der = _openssl(["pkey", "-in", str(pem_path), "-outform", "DER"])
    return base64.b64encode(_pkcs8_seed(der)).decode("ascii")


def _pkcs8_seed(der: bytes) -> bytes:
    content, _end = _tlv_end(der, 0)
    _value, content = _tlv_end(der, content)
    _value, content = _tlv_end(der, content)
    secret_start, secret_end = _tlv_end(der, content)
    secret = der[secret_start:secret_end]
    if secret[:1] == b"\x04":
        inner_start, inner_end = _tlv_end(secret, 0)
        secret = secret[inner_start:inner_end]
    if len(secret) != 32:
        raise RuntimeError("openssl is required for enrollment")
    return secret


def ensure_identity() -> str:
    path = identity_path()
    if not path.is_file():
        _write_secret(path, _openssl(["genpkey", "-algorithm", "ED25519"]).decode("ascii"))
    return _raw_public(path)


def ensure_wireguard_keys() -> tuple[str, str, str, str]:
    """Wired private, wired public, wireless private, wireless public. Private keys stay on disk."""
    pairs: list[tuple[str, str]] = []
    for link in ("wired", "wireless"):
        path = wireguard_secret_path(link)
        if not path.is_file():
            _write_secret(path, _openssl(["genpkey", "-algorithm", "X25519"]).decode("ascii"))
        pairs.append((_raw_private(path), _raw_public(path)))
    return pairs[0][0], pairs[0][1], pairs[1][0], pairs[1][1]


def sign_identity(message: bytes) -> str:
    fd, name = tempfile.mkstemp(prefix="hns-sign-")
    try:
        os.write(fd, message)
        os.close(fd)
        fd = -1
        signature = _openssl(["pkeyutl", "-sign", "-inkey", str(identity_path()), "-rawin", "-in", name])
    finally:
        if fd >= 0:
            os.close(fd)
        os.unlink(name)
    return base64.b64encode(signature).decode("ascii")


def ensure_installer_code(config: dict) -> dict:
    if config.get("token"):
        return config
    if config.get("installer_code"):
        return config
    config["installer_code"] = new_installer_code()
    save_config(config)
    return config


def enrollment_base(url: str) -> str:
    parsed = urllib.parse.urlparse(url.strip())
    host = parsed.hostname
    if parsed.scheme != "https" or not host:
        raise ValueError("Enrollment uses HTTPS")
    if ":" in host:
        host = f"[{host}]"
    return f"https://{host}:{ENROLL_PORT}"


def parse_pins(raw: str) -> list[str]:
    pins: list[str] = []
    for part in re.split(r"[\s,]+", raw.strip()):
        if not part:
            continue
        if part.startswith("sha256/"):
            part = part[len("sha256/") :]
        try:
            digest = base64.b64decode(part, validate=True)
        except (ValueError, binascii.Error):
            raise ValueError("TLS pins look like sha256/ and a SHA-256 value") from None
        if len(digest) != 32:
            raise ValueError("TLS pins are SHA-256")
        pins.append(part)
    if not pins:
        raise ValueError("Enter the server TLS key pin")
    return pins


def _tlv_end(data: bytes, offset: int) -> tuple[int, int]:
    if offset + 2 > len(data):
        raise ValueError("Certificate is truncated")
    length = data[offset + 1]
    header = offset + 2
    if length & 0x80:
        count = length & 0x7F
        if count == 0 or header + count > len(data):
            raise ValueError("Certificate is truncated")
        length = int.from_bytes(data[header : header + count], "big")
        header += count
    end = header + length
    if end > len(data):
        raise ValueError("Certificate is truncated")
    return header, end


def certificate_pin(cert_der: bytes) -> str:
    """SHA-256 of the certificate subject public key, the same pin the server prints."""
    value, _ = _tlv_end(cert_der, 0)
    tbs, _ = _tlv_end(cert_der, value)
    offset = tbs
    if cert_der[offset] == 0xA0:
        _, offset = _tlv_end(cert_der, offset)
    for _ in range(5):
        _, offset = _tlv_end(cert_der, offset)
    _, spki_end = _tlv_end(cert_der, offset)
    digest = hashlib.sha256(cert_der[offset:spki_end]).digest()
    return base64.b64encode(digest).decode("ascii")


def agent_hostname() -> str:
    name = socket.gethostname().split(".")[0].strip().lower()
    cleaned = re.sub(r"[^a-z0-9-]", "", name).strip("-")
    return cleaned[:63] or "remote-agent"


def check_in_payload(
    identity_public: str,
    wg_public: str,
    wg_wireless_public: str,
    installer_code: str,
    hostname: str,
    lan: str,
    nonce: str,
) -> dict:
    fields = [wg_public, wg_wireless_public, installer_code, hostname, lan]
    return {
        "identity_public_key": identity_public,
        "wg_public_key": wg_public,
        "wg_wireless_public_key": wg_wireless_public,
        "installer_code": installer_code,
        "hostname": hostname,
        "lan_ip": lan,
        "nonce": nonce,
        "signature": sign_identity(signed_message(CHECK_IN_PATH, nonce, [identity_public, *fields])),
    }


def poll_payload(identity_public: str, have_token: bool, nonce: str) -> dict:
    flag = "1" if have_token else "0"
    return {
        "identity_public_key": identity_public,
        "have_token": have_token,
        "nonce": nonce,
        "signature": sign_identity(signed_message(POLL_PATH, nonce, [identity_public, flag])),
    }


def post_pinned(url: str, payload: dict, pins: list[str], timeout: int = 10) -> dict:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("Enrollment uses HTTPS")
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    connection = http.client.HTTPSConnection(parsed.hostname, parsed.port or 443, timeout=timeout, context=context)
    try:
        connection.connect()
        peer = connection.sock.getpeercert(binary_form=True) if connection.sock is not None else None
        if not peer or certificate_pin(peer) not in set(pins):
            raise ssl.SSLError("Server key is not pinned")
        body = json.dumps(payload).encode("utf-8")
        connection.request("POST", parsed.path or "/", body=body, headers={"Content-Type": "application/json"})
        response = connection.getresponse()
        data = response.read()
        if response.status >= 400:
            raise urllib.error.HTTPError(url, response.status, response.reason, response.headers, io.BytesIO(data))
        if not data:
            return {}
        return json.loads(data.decode("utf-8"))
    finally:
        connection.close()


def http_detail(exc: urllib.error.HTTPError, secret: str = "") -> str:
    raw = ""
    if exc.fp is not None:
        raw = exc.fp.read().decode("utf-8", errors="replace")
    detail = raw
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict) and isinstance(parsed.get("detail"), str):
            detail = parsed["detail"]
    except json.JSONDecodeError:
        detail = raw
    if not isinstance(detail, str) or not detail.strip():
        return "Could not enroll"
    if secret and secret in detail:
        return "Could not enroll"
    return detail.strip()[:300]


def _pin_command(link: str, table: int, source_priority: int) -> str:
    if link == "wired":
        discover = (
            "DEV=$(ip -o link show | awk -F': ' "
            "'$2 ~ /^(eth|enp|end|eno|ens)/ { sub(/@.*/, \"\", $2); print $2; exit }')"
        )
    else:
        discover = (
            "DEV=$(for pass in builtin usb; do "
            "for n in /sys/class/net/*; do "
            "[ -d \"$n/wireless\" ] || continue; "
            "b=$(basename \"$n\"); "
            "case $b in lo|wg*|tun*|docker*|veth*|br-*) continue;; esac; "
            "[ \"$(cat \"$n/carrier\" 2>/dev/null)\" = 1 ] || continue; "
            "ip -4 -o addr show dev \"$b\" | grep -q . || continue; "
            "case $(readlink -f \"$n/device\" 2>/dev/null) in */usb*) kind=usb;; *) kind=builtin;; esac; "
            "[ \"$kind\" = \"$pass\" ] || continue; "
            "printf %s \"$b\"; break 2; done; done)"
        )
    return (
        f"{discover}; "
        "GW=$(ip route show default dev \"$DEV\" 2>/dev/null | awk '{print $3; exit}'); "
        "SRC=$(ip -4 -o addr show dev \"$DEV\" 2>/dev/null | awk '{print $4; exit}' | cut -d/ -f1); "
        "if [ -n \"$DEV\" ]; then "
        "LINK=$(ip -4 route show dev \"$DEV\" scope link | awk '{print $1; exit}'); "
        f"if [ -n \"$LINK\" ]; then ip route replace \"$LINK\" dev \"$DEV\" table {table}; fi; "
        f"if [ -n \"$GW\" ]; then ip route replace default via \"$GW\" dev \"$DEV\" table {table}; "
        f"else ip route replace default dev \"$DEV\" table {table}; fi; "
        f"if [ -n \"$SRC\" ]; then ip rule del from \"$SRC\" lookup {table} priority {table} 2>/dev/null || true; "
        f"ip rule del from \"$SRC\" lookup {table} priority {source_priority} 2>/dev/null || true; "
        f"ip rule add from \"$SRC\" lookup {table} priority {source_priority}; fi; fi"
    )


def tunnel_config_text(
    *,
    link: str,
    private_key: str,
    address: str,
    server_public_key: str,
    endpoint: str,
    allowed_ips: str,
    persistent_keepalive: int,
    preshared_key: str,
) -> str:
    server_ip, fwmark, table, _iface = _TUNNELS["wireless" if link == "wireless" else "wired"]
    rule_priority = table
    source_priority = table + 1000
    chosen = link if link == "wireless" else "wired"
    lines = [
        "[Interface]",
        f"PrivateKey = {private_key}",
        f"Address = {address}/32",
        f"FwMark = {fwmark}",
        "Table = off",
        f"PostUp = ip route replace {server_ip}/32 dev %i",
        f"PostUp = ip rule del fwmark {fwmark} lookup {table} priority {fwmark} 2>/dev/null || true",
        f"PostUp = ip rule del fwmark {fwmark} lookup {table} priority {rule_priority} 2>/dev/null || true",
        f"PostUp = ip rule add fwmark {fwmark} lookup {table} priority {rule_priority}",
        f"PostUp = {_pin_command(chosen, table, source_priority)}",
        f"PostDown = ip rule del fwmark {fwmark} lookup {table} priority {rule_priority} 2>/dev/null || true",
        f"PostDown = ip route del {server_ip}/32 dev %i 2>/dev/null || true",
        "",
        "[Peer]",
        f"PublicKey = {server_public_key}",
        f"PresharedKey = {preshared_key}",
        f"Endpoint = {endpoint}",
        f"AllowedIPs = {allowed_ips}",
        f"PersistentKeepalive = {persistent_keepalive}",
        "",
    ]
    return "\n".join(lines)


def apply_tunnels(wired_private: str, wireless_private: str, tunnels: list[dict]) -> bool:
    wrote = False
    directory = wireguard_dir()
    for tunnel in tunnels:
        link = "wireless" if tunnel.get("link") == "wireless" else "wired"
        preshared = str(tunnel.get("preshared_key") or "")
        private_key = wireless_private if link == "wireless" else wired_private
        address = str(tunnel.get("address") or "")
        server_public = str(tunnel.get("server_public_key") or "")
        endpoint = str(tunnel.get("endpoint") or "")
        allowed = str(tunnel.get("allowed_ips") or "")
        if not preshared or not private_key or not address or not server_public or not endpoint or not allowed:
            continue
        _server_ip, _fwmark, _table, iface = _TUNNELS[link]
        text = tunnel_config_text(
            link=link,
            private_key=private_key,
            address=address,
            server_public_key=server_public,
            endpoint=endpoint,
            allowed_ips=allowed,
            persistent_keepalive=int(tunnel.get("persistent_keepalive") or 25),
            preshared_key=preshared,
        )
        _write_secret(directory / f"{iface}.conf", text)
        wrote = True
        if directory == Path("/etc/wireguard"):
            subprocess.run(["systemctl", "enable", f"wg-quick@{iface}"], check=False)
            subprocess.run(["systemctl", "restart", f"wg-quick@{iface}"], check=False)
    return wrote


def _safe_error(detail: str, config: dict) -> str:
    secret = str(config.get("installer_code") or "")
    if secret and secret in detail:
        return "Could not enroll"
    return detail


def enroll_once(config: dict) -> None:
    global _last_error
    base = enrollment_base(str(config.get("enrollment_url") or ""))
    pins = [str(pin) for pin in config.get("tls_pins") or []]
    if not pins:
        raise ValueError("Enter the server TLS key pin")
    identity_public = ensure_identity()
    wired_private, wired_public, wireless_private, wireless_public = ensure_wireguard_keys()
    installer_code = str(config.get("installer_code") or "")
    if not installer_code:
        raise ValueError("The installer code is missing")
    hostname = agent_hostname()
    lan = lan_ip(base)
    if not lan:
        _last_error = "Could not find a LAN address for the server"
        return
    try:
        issued = post_pinned(f"{base}{NONCE_PATH}", {"identity_public_key": identity_public}, pins)
        nonce = str(issued["nonce"])
        check = post_pinned(
            f"{base}{CHECK_IN_PATH}",
            check_in_payload(identity_public, wired_public, wireless_public, installer_code, hostname, lan, nonce),
            pins,
        )
    except urllib.error.HTTPError as exc:
        _last_error = _safe_error(http_detail(exc, installer_code), config)
        return
    if check.get("conflict"):
        _last_error = "More than one device used this code. Start over on the dashboard."
    elif check.get("state") == "waiting_for_approval":
        _last_error = ""
    have_token = bool(config.get("token"))
    try:
        issued = post_pinned(f"{base}{NONCE_PATH}", {"identity_public_key": identity_public}, pins)
        poll = post_pinned(
            f"{base}{POLL_PATH}",
            poll_payload(identity_public, have_token, str(issued["nonce"])),
            pins,
        )
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            _last_error = _safe_error(http_detail(exc, installer_code), config)
        return
    if poll.get("state") != "approved":
        return
    remember_approval(config, poll, wired_private, wireless_private)


def remember_approval(config: dict, poll: dict, wired_private: str, wireless_private: str) -> None:
    tunnels = list(poll.get("tunnels") or [])
    if not tunnels and isinstance(poll.get("tunnel"), dict):
        tunnels = [poll["tunnel"]]
    wrote = apply_tunnels(wired_private, wireless_private, tunnels)
    token = poll.get("token") or config.get("token")
    name = poll.get("name") or config.get("name")
    updated = dict(config)
    if token:
        updated["token"] = token
    if name:
        updated["name"] = name
    if wrote and any(item.get("link") != "wireless" for item in tunnels):
        updated["server_url"] = f"http://{TUNNEL_SERVER_IP}:8847"
    elif wrote:
        updated["server_url"] = f"http://{WIRELESS_SERVER_IP}:8847"
    for item in tunnels:
        endpoint = str(item.get("endpoint") or "")
        host = endpoint.split(":")[0]
        if host.startswith("[") or ":" in host:
            continue
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            continue
        if address.version == 4 and not synthetic.is_tunnel_target(host):
            updated["measurement_host"] = host
            break
    if updated.get("token") and str(updated.get("server_url") or "").startswith("http://10.7."):
        updated.pop("installer_code", None)
        updated.setdefault("health_interval_seconds", 60)
        updated.setdefault("scan_interval_seconds", 300)
        updated.setdefault("config_version", 0)
    with _lock:
        save_config(updated)
    if updated.get("token") and updated.get("name") and updated.get("server_url"):
        ensure_health_loop()


def enrollment_loop() -> None:
    global _last_error
    while not _stop.is_set():
        with _lock:
            config = load_config()
        if config.get("token") and str(config.get("server_url") or "").startswith("http://10.7."):
            return
        if config.get("enrollment_url") and config.get("tls_pins") and config.get("installer_code"):
            try:
                enroll_once(dict(config))
            except (OSError, urllib.error.URLError, TimeoutError, ValueError, ssl.SSLError, RuntimeError, KeyError) as exc:
                message = str(exc)
                secret = str(config.get("installer_code") or "")
                if secret and secret in message:
                    message = "Could not enroll"
                _last_error = message
        with _lock:
            done = bool(load_config().get("token")) and str(load_config().get("server_url") or "").startswith("http://10.7.")
        if done:
            return
        _stop.wait(15)


def ensure_enrollment_loop() -> None:
    global _enroll_started
    with _lock:
        start = not _enroll_started
        _enroll_started = True
    if start:
        threading.Thread(target=enrollment_loop, name="enroll", daemon=True).start()


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
    try:
        ifaces = interface_roles()
    except OSError:
        ifaces = {"wired": None, "link": None, "radio": None}
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
        "wired_iface": ifaces["wired"],
        "wifi_link_iface": ifaces["link"],
        "wifi_radio_iface": ifaces["radio"],
        "link_ssid": ssid,
        "link_bssid": bssid,
        "last_error": synthetic.tunnel_warning() or synthetic.last_failure() or _last_error,
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
    if not _last_error.startswith("Kismet HTTP"):
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
        if item.get("kind") not in {"http", "librespeed", "ping", "mtr"}:
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


def kismet_error_text(exc: BaseException) -> str:
    """HTTP status and body, so a rejected field list is visible instead of an empty failure."""
    if isinstance(exc, urllib.error.HTTPError):
        body = ""
        try:
            body = exc.read().decode("utf-8", errors="replace")
        except Exception:
            body = ""
        body = " ".join(body.split())[:500]
        if body:
            return f"Kismet HTTP {exc.code}: {body}"
        return f"Kismet HTTP {exc.code}"
    return str(exc)


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
    global _airwave_mode, _kismet_devices_since, _kismet_alerts_since, _last_error
    if not KISMET_PATH.is_file():
        _airwave_mode = "off"
        return
    try:
        creds = json.loads(KISMET_PATH.read_text(encoding="utf-8"))
        base = str(creds.get("url") or "http://127.0.0.1:2501")
        user = str(creds["username"])
        password = str(creds["password"])
        kismet_get(base, user, password, "/system/status.json")
    except urllib.error.HTTPError as exc:
        _airwave_mode = "off"
        _last_error = kismet_error_text(exc)
        return
    except (OSError, urllib.error.URLError, TimeoutError, ValueError, KeyError, json.JSONDecodeError) as exc:
        _airwave_mode = "off"
        _last_error = kismet_error_text(exc)
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
        if _last_error.startswith("Kismet HTTP"):
            _last_error = ""
    except (OSError, urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
        _last_error = kismet_error_text(exc)
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


def synthetic_loop() -> None:
    global _last_error
    while not _stop.is_set():
        with _lock:
            config = load_config()
        if config.get("token") and config.get("name") and config.get("server_url"):
            try:
                synthetic.sync(dict(config), get_json, post_json)
            except (OSError, urllib.error.URLError, TimeoutError, ValueError, KeyError) as exc:
                _last_error = str(exc)
        _stop.wait(15)


def ensure_health_loop() -> None:
    global _health_started, _tests_started, _scan_started, _kismet_started, _synthetic_started
    with _lock:
        start_health = not _health_started
        start_tests = not _tests_started
        start_scan = not _scan_started
        start_kismet = not _kismet_started
        start_synthetic = not _synthetic_started
        _health_started = True
        _tests_started = True
        _scan_started = True
        _kismet_started = True
        _synthetic_started = True
    if start_health:
        threading.Thread(target=health_loop, name="health", daemon=True).start()
    if start_tests:
        threading.Thread(target=test_loop, name="internet", daemon=True).start()
    if start_scan:
        threading.Thread(target=scan_loop, name="wifi-scan", daemon=True).start()
    if start_kismet:
        threading.Thread(target=kismet_loop, name="kismet", daemon=True).start()
    if start_synthetic:
        threading.Thread(target=synthetic_loop, name="synthetic", daemon=True).start()


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
    .code { font: 1.25rem/1.4 ui-monospace, monospace; letter-spacing: 0.04em; color: #e4e4e4; }
    textarea { width: 100%; box-sizing: border-box; min-height: 4.5rem; padding: 0.55rem 0.7rem;
      border-radius: 6px; border: 1px solid #2a2a2a; background: #181818; color: inherit; font: inherit; }
  </style>
</head>
<body>
  <main>
    <h1>Remote Agent setup</h1>
    <p id="lead">Register this installer code in Remote Agent Onboarding, then enter the server and its TLS key pins.</p>
    <p id="installer-code" class="code"></p>
    <form id="setup">
      <label for="server">Server</label>
      <input id="server" name="server_url" placeholder="https://home.example" required />
      <label for="pins">TLS key pins</label>
      <textarea id="pins" name="tls_pins" required spellcheck="false" placeholder="sha256/…"></textarea>
      <label id="current-label" for="current" hidden>Current device key</label>
      <input id="current" name="current_key" hidden autocomplete="off" spellcheck="false" />
      <button type="submit">Connect</button>
    </form>
    <button id="replace" type="button" hidden>Update server</button>
    <p id="reset-note" hidden>To start over, run sudo hnw-reset on this Pi. That clears /etc/monitor/config.json.</p>
    <p id="message"></p>
  </main>
  <script>
    const form = document.getElementById("setup");
    const message = document.getElementById("message");
    const lead = document.getElementById("lead");
    const installer = document.getElementById("installer-code");
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
      installer.hidden = !status.installer_code;
      installer.textContent = status.installer_code || "";
      if (!status.enrolled) {
        if (status.state === "waiting") {
          lead.textContent = "Waiting for approval. The installer code stays here until the server accepts this Pi.";
        }
        message.className = status.last_error ? "error" : "";
        message.textContent = status.last_error || "";
        return;
      }
      if (!editing) {
        form.hidden = true;
        replace.hidden = false;
      }
      lead.textContent = status.name + " is connected to " + status.server_url + ".";
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
                config = ensure_installer_code(load_config())
            try:
                ensure_identity()
            except (OSError, RuntimeError):
                pass
            enrolled = bool(config.get("token")) and str(config.get("server_url") or "").startswith("http://10.7.")
            waiting = bool(config.get("enrollment_url")) and not enrolled
            payload = {
                "enrolled": enrolled,
                "state": "enrolled" if enrolled else "waiting" if waiting else "setup",
                "name": config.get("name") or "",
                "server_url": config.get("server_url") or config.get("enrollment_url") or "",
                "installer_code": "" if enrolled else config.get("installer_code") or "",
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
        server_url = str(incoming.get("server_url") or "").strip().rstrip("/")
        current_key = str(incoming.get("current_key") or "")
        with _lock:
            config = ensure_installer_code(load_config())
        if not setup_allowed(bool(config.get("token")), self.client_address[0], current_key, str(config.get("token") or "")):
            self._send(
                403,
                json.dumps({"detail": "This remote agent is already enrolled. Enter the current device key, or run sudo hnw-reset on the Pi."}).encode("utf-8"),
                "application/json",
            )
            return
        try:
            pins = parse_pins(str(incoming.get("tls_pins") or ""))
            enrollment_base(server_url)
        except ValueError as exc:
            self._send(400, json.dumps({"detail": str(exc)}).encode("utf-8"), "application/json")
            return
        try:
            ensure_identity()
            ensure_wireguard_keys()
        except (OSError, RuntimeError):
            self._send(500, json.dumps({"detail": "Could not prepare the identity key"}).encode("utf-8"), "application/json")
            return
        config["enrollment_url"] = server_url
        config["tls_pins"] = pins
        with _lock:
            save_config(config)
        ensure_enrollment_loop()
        self._send(200, json.dumps({"ok": True}).encode("utf-8"), "application/json")


def main() -> None:
    config = load_config()
    if config.get("token"):
        ensure_health_loop()
    if config.get("enrollment_url") and not (config.get("token") and str(config.get("server_url") or "").startswith("http://10.7.")):
        ensure_enrollment_loop()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
