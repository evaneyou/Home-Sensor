import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.path_view import clean_trace_target
from tests.conftest import login
from tests.test_ingest import _make_monitor, _token_headers


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Example.com", "example.com"),
        ("https://www.example.com/a/b?x=1", "www.example.com"),
        ("example.com:8443/path", "example.com"),
        ("8.8.8.8", "8.8.8.8"),
        ("2001:4860:4860::8888", "2001:4860:4860::8888"),
        ("192.168.1.1", None),
        ("10.0.0.5", None),
        ("127.0.0.1", None),
        ("169.254.1.1", None),
        ("224.0.0.1", None),
        ("localhost", None),
        ("not a host", None),
        ("", None),
        ("-bad.example.com", None),
    ],
)
def test_trace_target_is_a_public_host(raw, expected):
    assert clean_trace_target(raw) == expected


def test_trace_on_demand_round_trip(client: TestClient, db):
    monitor, token = _make_monitor(db, f"Trace {uuid.uuid4().hex[:6]}")
    headers = _token_headers(token)
    admin = login(client)

    refused = client.post(f"/api/v1/monitors/{monitor.id}/traces", json={"link": "wired", "target": "192.168.1.1"}, headers=admin)
    assert refused.status_code == 422

    viewer = TestClient(app, base_url="https://testserver")
    login(viewer, "viewer", "viewer-change-me")
    assert viewer.post(f"/api/v1/monitors/{monitor.id}/traces", json={"link": "wired", "target": "example.com"}).status_code == 403

    queued = client.post(f"/api/v1/monitors/{monitor.id}/traces", json={"link": "wireless", "target": "https://Example.com/x"}, headers=admin)
    assert queued.status_code == 200, queued.text
    trace_id = queued.json()["id"]
    assert queued.json()["target"] == "example.com"

    again = client.post(f"/api/v1/monitors/{monitor.id}/traces", json={"link": "wired", "target": "example.org"}, headers=admin)
    assert again.status_code == 409

    waiting = client.get(f"/api/v1/monitors/{monitor.id}/traces/{trace_id}")
    assert waiting.json()["state"] == "pending"

    handed = client.get("/api/v1/monitors/command", headers=headers).json()["traces"]
    assert handed == [{"id": trace_id, "target": "example.com", "link": "wireless"}]
    assert client.get("/api/v1/monitors/command", headers=headers).json()["traces"] == []

    hops = [
        {"hop": 1, "host": "192.168.1.1", "loss_pct": 0, "avg_ms": 1.0, "best_ms": 0.8, "worst_ms": 1.4},
        {"hop": 2, "host": "93.184.216.34", "loss_pct": 0, "avg_ms": 12.0, "best_ms": 11.0, "worst_ms": 13.0},
    ]
    done = client.post(f"/api/v1/monitors/traces/{trace_id}/result", json={"hops": hops}, headers=headers)
    assert done.status_code == 200, done.text
    body = client.get(f"/api/v1/monitors/{monitor.id}/traces/{trace_id}").json()
    assert body["state"] == "done"
    assert len(body["hops"]) == 2
    assert body["target"]["name"] == "example.com"


def test_trace_result_needs_the_agent_that_was_asked(client: TestClient, db):
    monitor, _token = _make_monitor(db, f"Own {uuid.uuid4().hex[:6]}")
    other, other_token = _make_monitor(db, f"Other {uuid.uuid4().hex[:6]}")
    admin = login(client)
    queued = client.post(f"/api/v1/monitors/{monitor.id}/traces", json={"link": "wired", "target": "example.com"}, headers=admin)
    trace_id = queued.json()["id"]
    wrong = client.post(f"/api/v1/monitors/traces/{trace_id}/result", json={"hops": []}, headers=_token_headers(other_token))
    assert wrong.status_code == 404
