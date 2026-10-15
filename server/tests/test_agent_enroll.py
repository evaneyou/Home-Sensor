"""Remote agent enrollment: signed check-in, TLS key pin, and the approved tunnel."""

import base64
import datetime
import importlib.util
import json
import os
import ssl
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import load_pem_private_key
from cryptography.x509.oid import NameOID

from app.enrollment import signed_message, verify_signature
from app.tls import spki_pin
from app.wireguard_tunnel import client_config


def _load_agent(tmp_path: Path):
    os.environ["MONITOR_CONFIG"] = str(tmp_path / "config.json")
    os.environ["MONITOR_WIREGUARD_DIR"] = str(tmp_path / "wireguard")
    for name in ("agent_state", "enrollment", "health", "radio", "scheduler"):
        sys.modules.pop(name, None)
    here = Path(__file__).resolve()
    candidates = [here.parents[2] / "monitor" / "agent.py", Path("/monitor/agent.py")]
    path = next(item for item in candidates if item.is_file())
    sys.path.insert(0, str(path.parent))
    spec = importlib.util.spec_from_file_location(f"monitor_agent_{tmp_path.name}", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _certificate(key: ec.EllipticCurvePrivateKey) -> bytes:
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "hns-server")])
    start = datetime.datetime(2020, 1, 1, tzinfo=datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(start)
        .not_valid_after(start + datetime.timedelta(days=3650))
        .sign(key, hashes.SHA256())
    )
    return cert.public_bytes(serialization.Encoding.DER)


def test_signed_check_in_matches_the_server(tmp_path: Path):
    agent = _load_agent(tmp_path)
    identity = agent.ensure_identity()
    _wired_private, wired_public, _wireless_private, wireless_public = agent.ensure_wireguard_keys()
    code = agent.new_installer_code()
    nonce = "nonce-value"
    body = agent.check_in_payload(identity, wired_public, wireless_public, code, "remote-agent", "192.168.1.40", nonce)
    fields = [body["wg_public_key"], body["wg_wireless_public_key"], body["installer_code"], body["hostname"], body["lan_ip"]]
    message = signed_message(agent.CHECK_IN_PATH, nonce, [identity, *fields])
    assert agent.signed_message(agent.CHECK_IN_PATH, nonce, [identity, *fields]) == message
    assert verify_signature(identity, message, body["signature"])
    poll = agent.poll_payload(identity, False, nonce)
    assert verify_signature(identity, signed_message(agent.POLL_PATH, nonce, [identity, "0"]), poll["signature"])
    wired_pem = agent.wireguard_secret_path("wired").read_bytes()
    key = load_pem_private_key(wired_pem, password=None)
    assert base64.b64encode(key.private_bytes_raw()).decode("ascii") == _wired_private
    assert base64.b64encode(key.public_key().public_bytes_raw()).decode("ascii") == wired_public


def test_tls_pin_matches_the_server_key_and_rejects_another(tmp_path: Path):
    agent = _load_agent(tmp_path)
    key = ec.generate_private_key(ec.SECP256R1())
    other = ec.generate_private_key(ec.SECP256R1())
    der = _certificate(key)
    assert agent.certificate_pin(der) == spki_pin(key.public_key())
    assert agent.certificate_pin(der) != spki_pin(other.public_key())

    directory = tmp_path / "tls"
    directory.mkdir()
    key_path = directory / "key.pem"
    cert_path = directory / "cert.pem"
    key_path.write_bytes(
        key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    )
    cert_path.write_bytes(
        x509.load_der_x509_certificate(der).public_bytes(serialization.Encoding.PEM)
    )
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert_path, key_path)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args) -> None:
            return

        def do_POST(self) -> None:
            length = int(self.headers.get("Content-Length") or "0")
            self.rfile.read(length)
            body = b'{"ok":true}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)

    def handle_error(request, client_address) -> None:
        return

    server.handle_error = handle_error
    server.socket = context.wrap_socket(server.socket, server_side=True)
    port = server.server_address[1]
    thread = threading.Thread(target=lambda: (server.handle_request(), server.handle_request()), daemon=True)
    thread.start()
    url = f"https://127.0.0.1:{port}/api/v1/agents/nonce"
    assert agent.post_pinned(url, {"hello": "there"}, [spki_pin(key.public_key())]) == {"ok": True}
    with pytest.raises(ssl.SSLError, match="not pinned"):
        agent.post_pinned(url, {"hello": "there"}, [spki_pin(other.public_key())])
    thread.join(timeout=5)


def test_approval_writes_the_tunnel_and_drops_the_installer_code(tmp_path: Path):
    agent = _load_agent(tmp_path)
    import agent_state
    import enrollment
    import health

    agent_state.ensure_health_loop = lambda: None
    code = agent.new_installer_code()
    agent.save_config(
        {
            "enrollment_url": "https://home.example",
            "tls_pins": [spki_pin(ec.generate_private_key(ec.SECP256R1()).public_key())],
            "installer_code": code,
        }
    )
    seen: list[dict] = []

    def fake_post(url: str, payload: dict, pins: list[str]) -> dict:
        if url.endswith("/nonce"):
            return {"nonce": "nonce-value"}
        seen.append(payload)
        if url.endswith("/check-in"):
            return {"state": "waiting_for_approval", "conflict": False}
        return {
            "state": "approved",
            "name": "Living Room",
            "token": "approved-token",
            "tunnels": [
                {
                    "link": "wired",
                    "address": "10.7.0.5",
                    "server_public_key": "server-public",
                    "endpoint": "203.0.113.8:51820",
                    "allowed_ips": "10.7.0.1/32",
                    "persistent_keepalive": 25,
                    "preshared_key": "pre-shared",
                }
            ],
        }

    enrollment.post_pinned = fake_post
    health.lan_ip = lambda _url: "192.168.1.40"
    agent.enroll_once(agent.load_config())
    check = seen[0]
    assert verify_signature(
        check["identity_public_key"],
        signed_message(
            agent.CHECK_IN_PATH,
            "nonce-value",
            [
                check["identity_public_key"],
                check["wg_public_key"],
                check["wg_wireless_public_key"],
                check["installer_code"],
                check["hostname"],
                check["lan_ip"],
            ],
        ),
        check["signature"],
    )
    saved = json.loads((tmp_path / "config.json").read_text(encoding="utf-8"))
    assert saved["name"] == "Living Room"
    assert saved["token"] == "approved-token"
    assert saved["server_url"] == "http://10.7.0.1:8847"
    assert "installer_code" not in saved
    wired_private = base64.b64encode(
        load_pem_private_key(agent.wireguard_secret_path("wired").read_bytes(), password=None).private_bytes_raw()
    ).decode("ascii")
    tunnel = (tmp_path / "wireguard" / "wg0.conf").read_text(encoding="utf-8")
    assert tunnel == client_config(
        link="wired",
        private_key=wired_private,
        address="10.7.0.5",
        server_public_key="server-public",
        endpoint_host="203.0.113.8:51820",
        preshared_key="pre-shared",
    )
    assert wired_private not in (tmp_path / "config.json").read_text(encoding="utf-8")
    assert code not in (tmp_path / "config.json").read_text(encoding="utf-8")
    wireless_private = base64.b64encode(
        load_pem_private_key(agent.wireguard_secret_path("wireless").read_bytes(), password=None).private_bytes_raw()
    ).decode("ascii")
    assert agent.tunnel_config_text(
        link="wireless",
        private_key=wireless_private,
        address="10.7.1.5",
        server_public_key="server-public",
        endpoint="203.0.113.8:51820",
        allowed_ips="10.7.1.1/32",
        persistent_keepalive=25,
        preshared_key="pre-shared",
    ) == client_config(
        link="wireless",
        private_key=wireless_private,
        address="10.7.1.5",
        server_public_key="server-public",
        endpoint_host="203.0.113.8:51820",
        preshared_key="pre-shared",
    )
    assert agent.enrollment_base("https://home.example/ignored") == "https://home.example:8848"
    assert "id=\"installer-code\"" in agent.PAGE
    assert "sudo hnw-reset" in agent.PAGE
    assert "device_key" not in agent.PAGE
