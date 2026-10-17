"""The Pi's speed test client, run against a small local server that behaves like LibreSpeed."""

import importlib.util
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

MONITOR = Path(__file__).resolve().parents[2] / "monitor"
pytestmark = pytest.mark.skipif(not (MONITOR / "speedtest.py").is_file(), reason="the agent code is not mounted")


def _load():
    spec = importlib.util.spec_from_file_location("monitor_speedtest", MONITOR / "speedtest.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(MONITOR))
    try:
        spec.loader.exec_module(module)
    finally:
        sys.path.remove(str(MONITOR))
    return module


class FakeLibreSpeed(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        return

    def do_GET(self):
        if self.path.startswith("/garbage.php"):
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.end_headers()
            block = b"\0" * 65536
            try:
                while True:
                    self.wfile.write(block)
            except OSError:
                return
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        left = int(self.headers.get("Content-Length") or 0)
        try:
            while left > 0:
                data = self.rfile.read(min(65536, left))
                if not data:
                    return
                left -= len(data)
            self.send_response(200)
            self.send_header("Content-Length", "0")
            self.end_headers()
        except OSError:
            return


@pytest.fixture
def lab(monkeypatch):
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeLibreSpeed)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    module = _load()
    monkeypatch.setattr(module, "PORT", server.server_address[1])
    monkeypatch.setattr(module, "HOSTS", {"wired": "127.0.0.1", "wireless": "127.0.0.1"})
    yield module
    server.shutdown()


def test_ping_reports_a_round_trip_and_jitter(lab):
    ping, jitter = lab.measure_ping("127.0.0.1", count=5)
    assert ping is not None and 0 <= ping < 500 and jitter is not None and jitter >= 0


def test_download_and_upload_report_a_reading_every_half_second(lab):
    for phase in ("download", "upload"):
        readings = []
        steady, next_seq = lab.run_phase("127.0.0.1", phase, 1.7, lambda seq, p, t, mbps: readings.append((seq, p, t, mbps)), threading.Event())
        assert len(readings) >= 2, phase
        assert all(item[1] == phase and item[3] > 0 for item in readings), readings
        assert [item[0] for item in readings] == list(range(len(readings)))
        assert readings[0][2] < readings[-1][2], "time moves forward"
        assert steady is not None and steady > 0 and next_seq == len(readings)


def test_stop_ends_a_phase_early(lab):
    stop = threading.Event()
    threading.Timer(0.6, stop.set).start()
    started = time.perf_counter()
    lab.run_phase("127.0.0.1", "download", 10, lambda *_args: None, stop)
    assert time.perf_counter() - started < 3


def _run(lab, link="wired", reply=None, seconds=1.2):
    posted = []

    def post_json(url, payload, token=None, name=None, timeout=10):
        posted.append((url, payload))
        return reply(url, payload) if reply else {"cancel": False}

    lab.run({"server_url": "https://example.test", "token": "t", "name": "Pi"}, {"id": "abc", "link": link, "down_seconds": seconds, "up_seconds": seconds}, post_json)
    return posted


def test_a_whole_test_reports_both_directions_and_finishes(lab):
    posted = _run(lab)
    samples = [item for url, body in posted if url.endswith("/samples") for item in body.get("samples", [])]
    assert {item["phase"] for item in samples} == {"download", "upload"}
    assert [item["seq"] for item in samples] == sorted({item["seq"] for item in samples}), "numbers never repeat and keep rising"
    pings = [body for url, body in posted if url.endswith("/samples") and "ping_ms" in body]
    assert pings and pings[0]["ping_ms"] >= 0
    finish = [body for url, body in posted if url.endswith("/finish")]
    assert len(finish) == 1 and finish[0]["status"] == "finished"
    assert finish[0]["down_mbps"] > 0 and finish[0]["up_mbps"] > 0 and finish[0]["error"] == ""
    assert all(url.startswith("https://example.test/api/v1/monitors/speedtest/abc/") for url, _body in posted)


def test_an_unreachable_server_fails_with_a_clear_reason(lab, monkeypatch):
    monkeypatch.setattr(lab, "PORT", 1)  # nothing listens here
    posted = _run(lab)
    finish = [body for url, body in posted if url.endswith("/finish")]
    assert len(finish) == 1 and finish[0]["status"] == "failed" and "Wired" in finish[0]["error"]
    wifi = [body for url, body in _run(lab, link="wireless") if url.endswith("/finish")]
    assert wifi and "Wi-Fi" in wifi[0]["error"]


def test_pressing_stop_ends_the_test_and_sends_no_result(lab):
    posted = _run(lab, reply=lambda url, body: {"cancel": True}, seconds=10)
    assert not [1 for url, _body in posted if url.endswith("/finish")]


def test_an_unknown_link_is_ignored(lab):
    assert _run(lab, link="satellite") == []
