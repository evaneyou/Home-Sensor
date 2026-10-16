"""Stress tests: the catalog, starting and changing a run, the five-minute cap, and what the agent is told."""

import importlib.util
import sys
from datetime import timedelta
from pathlib import Path
from urllib.parse import quote

import pytest
from sqlalchemy import select

from app import stress
from app.auth import hash_password
from app.models import Monitor, StressRun, SyntheticRun, User, UserRole
from conftest import login


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "X-Monitor-Name": quote("Pi Test", safe="")}


def _setup(client, db):
    if db.scalar(select(User).where(User.username == "admin")) is None:
        db.add(User(username="admin", password_hash=hash_password("admin-change-me"), role=UserRole.admin, is_active=True))
        db.commit()
    monitor = db.scalar(select(Monitor).where(Monitor.slug == db.info["monitor_slug"]))
    assert monitor is not None
    return monitor, login(client)


def _start(client, headers, monitor, sessions=None, seconds=60, links=None):
    return client.post(
        "/api/v1/stress",
        headers=headers,
        json={
            "monitor_id": str(monitor.id),
            "links": links or ["wired"],
            "duration_seconds": seconds,
            "sessions": sessions or [{"kind": "voice", "params": {}, "count": 2}, {"kind": "flood", "params": {"mbps": 20}}],
        },
    )


def test_catalog_lists_every_test_but_the_games():
    kinds = [item["kind"] for item in stress.TESTS]
    assert kinds == ["voice", "video", "desktop", "market", "rtt", "flood"]
    text = repr(stress.TESTS).lower()
    assert "fortnite" not in text and "call-of-duty" not in text
    assert stress.MAX_SECONDS == 300


def test_session_options_are_checked_and_mapped():
    options, label = stress.build_session("flood", {"mbps": 10, "size": 1250})
    assert options["rate_pps"] == 1000 and options["size"] == 1250 and options["proto"] == "udp"
    assert "10 Mbit/s" in label
    options, _ = stress.build_session("voice", {"codec": "g729", "dscp": 46})
    assert options["preset"] == "voip-g729" and options["tos"] == 184 and options["bidir"] is True
    options, _ = stress.build_session("voice", {"codec": "g723"})
    assert options["ptime_ms"] == 30
    with pytest.raises(ValueError):
        stress.build_session("voice", {"vad": True})  # two-way and talk/silence together
    with pytest.raises(ValueError):
        stress.build_session("voice", {"codec": "g729", "ptime_ms": 25, "bidir": False})
    with pytest.raises(ValueError):
        stress.build_session("flood", {"mbps": 0})
    with pytest.raises(ValueError):
        stress.build_session("flood", {"mbps": 10, "rate": 5})
    with pytest.raises(ValueError):
        stress.build_session("fortnite", {})


def test_only_an_admin_with_csrf_can_start(client, db):
    monitor, headers = _setup(client, db)
    body = {"monitor_id": str(monitor.id), "links": ["wired"], "duration_seconds": 60, "sessions": [{"kind": "market"}]}
    assert client.post("/api/v1/stress", json=body).status_code in (401, 403)
    client.cookies.clear()
    assert client.post("/api/v1/stress", json=body, headers={"X-CSRF-Token": "x"}).status_code in (401, 403)


def test_start_add_remove_and_stop(client, db):
    monitor, headers = _setup(client, db)
    started = _start(client, headers, monitor)
    assert started.status_code == 200, started.text
    stress_id = started.json()["stress_id"]
    assert _start(client, headers, monitor).status_code == 409  # one test per agent

    live = client.get(f"/api/v1/stress/{stress_id}/live").json()
    assert live["status"] == "running" and len(live["sessions"]) == 3
    assert client.get(f"/api/v1/stress/active?monitor_id={monitor.id}").json()["stress_id"] == stress_id

    added = client.post(f"/api/v1/stress/{stress_id}/sessions", headers=headers, json={"kind": "rtt", "params": {"pps": 10}, "count": 2})
    assert added.status_code == 200, added.text
    sessions = client.get(f"/api/v1/stress/{stress_id}/live").json()["sessions"]
    assert len(sessions) == 5

    gone = client.delete(f"/api/v1/stress/{stress_id}/sessions/{sessions[0]['id']}", headers=headers)
    assert gone.json()["status"] == "stopped"
    sessions = client.get(f"/api/v1/stress/{stress_id}/live").json()["sessions"]
    assert [item["status"] for item in sessions].count("running") == 4

    stopped = client.post(f"/api/v1/stress/{stress_id}/stop", headers=headers)
    assert stopped.json()["status"] == "stopped"
    sessions = client.get(f"/api/v1/stress/{stress_id}/live").json()["sessions"]
    assert all(item["status"] == "stopped" for item in sessions)
    assert client.get(f"/api/v1/stress/active?monitor_id={monitor.id}").json()["stress_id"] is None
    assert client.post(f"/api/v1/stress/{stress_id}/sessions", headers=headers, json={"kind": "market"}).status_code == 409


def test_a_run_cannot_be_longer_than_five_minutes_or_hold_too_many_sessions(client, db):
    monitor, headers = _setup(client, db)
    assert _start(client, headers, monitor, seconds=301).status_code == 422
    too_many = [{"kind": "market", "count": 20}] * 4
    assert _start(client, headers, monitor, sessions=too_many).status_code == 400
    assert _start(client, headers, monitor, sessions=[{"kind": "voice", "params": {"codec": "x"}}]).status_code == 400


def test_the_five_minute_cap_ends_the_run_and_the_assignment(client, db, monitor_token):
    monitor, headers = _setup(client, db)
    stress_id = _start(client, headers, monitor).json()["stress_id"]

    jobs = client.get("/api/v1/synthetic/assignment", headers=_headers(monitor_token)).json()
    assert jobs["fast"] is True
    mine = [job for job in jobs["jobs"] if job["mode"] == "stress"]
    assert len(mine) == 3 and all(0 < job["ends_in_s"] <= 60 for job in mine)

    row = db.get(StressRun, stress_id)
    row.ends_at = row.ends_at - timedelta(seconds=120)
    db.commit()
    jobs = client.get("/api/v1/synthetic/assignment", headers=_headers(monitor_token)).json()
    assert jobs["fast"] is False and [job for job in jobs["jobs"] if job["mode"] == "stress"] == []
    db.expire_all()
    assert db.get(StressRun, stress_id).status == "finished"
    runs = db.scalars(select(SyntheticRun).where(SyntheticRun.stress_id == row.id)).all()
    assert runs and all(run.status == "stopped" for run in runs)


def test_samples_become_a_live_series_and_stay_out_of_application_health(client, db, monitor_token):
    monitor, headers = _setup(client, db)
    stress_id = _start(client, headers, monitor, sessions=[{"kind": "voice", "params": {}, "count": 2}]).json()["stress_id"]
    sessions = client.get(f"/api/v1/stress/{stress_id}/live").json()["sessions"]
    for index, session in enumerate(sessions):
        posted = client.post(
            "/api/v1/synthetic/samples",
            headers=_headers(monitor_token),
            json={
                "run_id": session["id"],
                "link": "wired",
                "interval_index": 0,
                "recorded_at": "2026-10-15T12:00:00+00:00",
                "metrics": {
                    "flows": [
                        {
                            "tx_kbps": 100.0,
                            "rx": {"bitrate_kbps": 90.0, "jitter_rfc3550_ms": 2.0 + index, "loss_pct": 1.0 * index},
                            "rtt": {"avg_ms": 20.0 + index * 10, "jitter_ms": 2.0 + index},
                        }
                    ]
                },
            },
        )
        assert posted.status_code == 200, posted.text
    live = client.get(f"/api/v1/stress/{stress_id}/live").json()
    assert len(live["series"]) == 1
    point = live["series"][0]
    assert point["link"] == "wired" and point["sessions"] == 2
    assert point["tx_mbps"] == pytest.approx(0.2) and point["rtt_ms"] == pytest.approx(25.0)
    assert point["rtt_max_ms"] == 30.0 and point["loss_pct"] == 1.0
    assert all(item["links"]["wired"]["rtt_ms"] is not None for item in live["sessions"])
    # Only newer points come back when a time is given.
    later = client.get(f"/api/v1/stress/{stress_id}/live", params={"since": "2026-10-15T12:00:00+00:00"}).json()
    assert later["series"] == []
    # The application-health log does not show stress traffic.
    log = client.get(f"/api/v1/monitors/{monitor.id}/log?probe=rtnp")
    assert log.status_code == 200
    assert "stress" not in log.text


def test_a_failed_session_keeps_the_reason(client, db, monitor_token):
    monitor, headers = _setup(client, db)
    stress_id = _start(client, headers, monitor, sessions=[{"kind": "rtt", "params": {"proto": "icmp"}}]).json()["stress_id"]
    session = client.get(f"/api/v1/stress/{stress_id}/live").json()["sessions"][0]
    done = client.post(
        f"/api/v1/synthetic/runs/{session['id']}/finish",
        headers=_headers(monitor_token),
        json={"link": "wired", "status": "failed", "message": "ICMP needs privileges"},
    )
    assert done.status_code == 200
    session = client.get(f"/api/v1/stress/{stress_id}/live").json()["sessions"][0]
    assert session["status"] == "failed" and session["error"] == "ICMP needs privileges"


def _agent():
    path = Path(__file__).resolve().parents[2] / "monitor" / "synthetic.py"
    spec = importlib.util.spec_from_file_location("monitor_synthetic_stress", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(path.parent))
    try:
        spec.loader.exec_module(module)
    finally:
        sys.path.remove(str(path.parent))
    return module


def test_agent_builds_each_stress_session_and_refuses_the_dangerous_ones():
    path = Path(__file__).resolve().parents[2] / "monitor" / "synthetic.py"
    if not path.is_file():
        return
    agent = _agent()
    kwargs = dict(control_host="10.7.0.1", key_file="/k", srtp_key_file="/s")
    for kind, params in (("voice", {}), ("video", {}), ("desktop", {}), ("market", {}), ("rtt", {}), ("rtt", {"proto": "icmp"}), ("flood", {"mbps": 50})):
        options, _ = stress.build_session(kind, params)
        args = agent.stress_args("/bin/rtnp-send", options, "203.0.113.7", **kwargs)
        assert args[:2] == ["/bin/rtnp-send", "flow"] and "--forever" in args
        assert "10.7.0.1:8998" not in " ".join(args)
    flood, _ = stress.build_session("flood", {"mbps": 50, "size": 1250})
    args = agent.stress_args("/bin/rtnp-send", flood, "203.0.113.7", **kwargs)
    assert args[args.index("--rate-pps") + 1] == "5000" and "203.0.113.7:8998" in args
    ping, _ = stress.build_session("rtt", {"proto": "icmp"})
    assert agent.stress_args("/bin/rtnp-send", ping, "203.0.113.7", **kwargs)[2:6] == ["-t", "203.0.113.7", "-p", "icmp"]
    for bad in (
        {**flood, "payload": "file:/etc/passwd"},
        {**flood, "proto": "tcp"},
        {**flood, "rate_pps": 10_000_000},
        {**flood, "preset": "fortnite"},
        {**flood, "agent": "x:1"},
    ):
        with pytest.raises(ValueError):
            agent.stress_args("/bin/rtnp-send", bad, "203.0.113.7", **kwargs)
    with pytest.raises(ValueError):
        agent.stress_args("/bin/rtnp-send", flood, "10.7.0.1", **kwargs)
