"""Live speed test: start, hand to the Pi, readings, finish, cancel, and the safety limits."""

from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.api import speedtest_routes
from app.main import app
from app.models import Monitor, SpeedSample, SpeedTest
from tests.conftest import login
from tests.test_guest_login import _ensure_guest


def _agent(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "X-Monitor-Name": quote("Pi Test", safe="")}


@pytest.fixture
def pi(db, monitor_token):
    monitor = db.scalar(select(Monitor).where(Monitor.slug == db.info["monitor_slug"]))
    monitor.last_seen_at = datetime.now(timezone.utc)
    db.execute(delete(SpeedTest).where(SpeedTest.monitor_id == monitor.id))
    db.commit()
    yield monitor
    db.rollback()
    db.execute(delete(SpeedTest).where(SpeedTest.monitor_id == monitor.id))
    db.commit()


def _start(client, headers, monitor, link="wired"):
    return client.post("/api/v1/speedtest", headers=headers, json={"monitor_id": str(monitor.id), "link": link})


def test_a_full_test_from_start_to_finish(client: TestClient, db, pi, monitor_token):
    headers = login(client)
    started = _start(client, headers, pi)
    assert started.status_code == 200, started.text
    test_id = started.json()["id"]
    assert started.json()["status"] == "pending" and started.json()["link"] == "wired"
    assert _start(client, headers, pi).status_code == 409, "one test at a time"

    # The Pi asks, is handed the test once, and then reports.
    first = client.get("/api/v1/monitors/speedtest", headers=_agent(monitor_token)).json()["test"]
    assert first == {"id": test_id, "link": "wired", "down_seconds": 15, "up_seconds": 15}
    assert client.get("/api/v1/monitors/speedtest", headers=_agent(monitor_token)).json()["test"] is None

    posted = client.post(
        f"/api/v1/monitors/speedtest/{test_id}/samples",
        headers=_agent(monitor_token),
        json={"ping_ms": 8.5, "jitter_ms": 1.2, "samples": [{"seq": 0, "phase": "download", "t_ms": 500, "mbps": 120.5}, {"seq": 1, "phase": "download", "t_ms": 1000, "mbps": 310.0}]},
    )
    assert posted.json() == {"cancel": False}
    # The same reading sent twice is kept once.
    client.post(f"/api/v1/monitors/speedtest/{test_id}/samples", headers=_agent(monitor_token), json={"samples": [{"seq": 1, "phase": "download", "t_ms": 1000, "mbps": 310.0}]})

    live = client.get(f"/api/v1/speedtest/{test_id}").json()
    assert live["status"] == "running" and live["phase"] == "download" and live["ping_ms"] == 8.5
    assert [item["seq"] for item in live["samples"]] == [0, 1]
    assert [item["seq"] for item in client.get(f"/api/v1/speedtest/{test_id}?since=0").json()["samples"]] == [1]

    done = client.post(
        f"/api/v1/monitors/speedtest/{test_id}/finish",
        headers=_agent(monitor_token),
        json={"status": "finished", "down_mbps": 455.2, "up_mbps": 33.4, "ping_ms": 8.5, "jitter_ms": 1.2},
    )
    assert done.json() == {"status": "finished"}
    final = client.get(f"/api/v1/speedtest/{test_id}").json()
    assert (final["status"], final["down_mbps"], final["up_mbps"], final["phase"]) == ("finished", 455.2, 33.4, "done")
    listed = client.get(f"/api/v1/speedtest/history?monitor_id={pi.id}").json()
    assert listed and listed[0]["id"] == test_id
    assert client.get(f"/api/v1/speedtest/active?monitor_id={pi.id}").json()["test"] is None
    assert _start(client, headers, pi, "wireless").status_code == 200, "a new test can start once the last one is over"


def test_only_an_admin_with_csrf_can_start_and_the_input_is_checked(client: TestClient, db, pi):
    _ensure_guest(db)
    assert client.post("/api/v1/speedtest", json={"monitor_id": str(pi.id)}).status_code in (401, 403)
    guest = TestClient(app, base_url="https://testserver")
    login(guest, "guest", "guest")
    assert guest.post("/api/v1/speedtest", json={"monitor_id": str(pi.id)}).status_code == 403
    assert guest.get(f"/api/v1/speedtest/history?monitor_id={pi.id}").status_code == 200, "guests can watch"
    login(client)
    assert client.post("/api/v1/speedtest", json={"monitor_id": str(pi.id)}).status_code == 403, "no CSRF token"
    headers = login(client)
    assert _start(client, headers, pi, "satellite").status_code == 400
    assert client.post("/api/v1/speedtest", headers=headers, json={"monitor_id": "00000000-0000-0000-0000-000000000000"}).status_code == 404


def test_an_offline_pi_and_the_hourly_limit(client: TestClient, db, pi, monkeypatch):
    headers = login(client)
    pi.last_seen_at = datetime.now(timezone.utc) - timedelta(minutes=30)
    db.commit()
    refused = _start(client, headers, pi)
    assert refused.status_code == 409 and "offline" in refused.json()["detail"]
    pi.last_seen_at = datetime.now(timezone.utc)
    db.commit()
    monkeypatch.setattr(speedtest_routes, "MAX_PER_HOUR", 1)
    first = _start(client, headers, pi)
    assert first.status_code == 200
    client.post(f"/api/v1/speedtest/{first.json()['id']}/cancel", headers=headers)
    assert _start(client, headers, pi).status_code == 429


def test_cancel_stops_the_pi_and_a_stuck_test_expires(client: TestClient, db, pi, monitor_token):
    headers = login(client)
    test_id = _start(client, headers, pi).json()["id"]
    client.get("/api/v1/monitors/speedtest", headers=_agent(monitor_token))
    assert client.post(f"/api/v1/speedtest/{test_id}/cancel", headers=headers).json()["status"] == "cancelled"
    told = client.post(f"/api/v1/monitors/speedtest/{test_id}/samples", headers=_agent(monitor_token), json={"samples": []})
    assert told.json() == {"cancel": True}, "the Pi learns about the cancel from its next report"

    # A test the Pi never picks up fails by itself, so it cannot block the next one.
    waiting = _start(client, headers, pi).json()["id"]
    row = db.get(SpeedTest, waiting)
    row.requested_at = datetime.now(timezone.utc) - timedelta(seconds=120)
    db.commit()
    assert client.get(f"/api/v1/speedtest/{waiting}").json()["status"] == "failed"
    # So does one that started and never finished.
    running = _start(client, headers, pi).json()["id"]
    client.get("/api/v1/monitors/speedtest", headers=_agent(monitor_token))
    db.expire_all()
    db.get(SpeedTest, running).started_at = datetime.now(timezone.utc) - timedelta(seconds=300)
    db.commit()
    stuck = client.get(f"/api/v1/speedtest/{running}").json()
    assert stuck["status"] == "failed" and stuck["error"]


def test_the_pi_cannot_send_nonsense_or_skip_authentication(client: TestClient, db, pi, monitor_token):
    headers = login(client)
    test_id = _start(client, headers, pi).json()["id"]
    client.get("/api/v1/monitors/speedtest", headers=_agent(monitor_token))
    bad = client.post(f"/api/v1/monitors/speedtest/{test_id}/samples", headers=_agent(monitor_token), json={"samples": [{"seq": 0, "phase": "download", "t_ms": 1, "mbps": -5}]})
    assert bad.status_code == 422
    sideways = client.post(f"/api/v1/monitors/speedtest/{test_id}/samples", headers=_agent(monitor_token), json={"samples": [{"seq": 0, "phase": "sideways", "t_ms": 1, "mbps": 5}]})
    assert sideways.status_code == 422
    assert client.post(f"/api/v1/monitors/speedtest/{test_id}/samples", json={"samples": []}).status_code in (401, 403)
    empty = client.post(f"/api/v1/monitors/speedtest/{test_id}/finish", headers=_agent(monitor_token), json={"status": "finished"})
    assert empty.json() == {"status": "failed"}, "a finish with no numbers is a failure"
    assert db.scalar(select(SpeedSample).where(SpeedSample.test_id == test_id)) is None
