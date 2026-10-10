"""A new sibling of the associated BSSID is trusted once. A different prefix is an evil twin."""

from datetime import datetime, timezone
from urllib.parse import quote

from sqlalchemy import select

from app.models import ApInventory, Issue, Monitor
from conftest import login

SEEN = datetime(2026, 10, 9, 20, 0, tzinfo=timezone.utc)
LATER = datetime(2026, 10, 9, 20, 5, tzinfo=timezone.utc)
HOME = "7c:9a:54:76:24:5d"
SIBLING = "7c:9a:54:76:24:55"
TWIN = "10:00:00:00:00:03"

HOME_SCAN = """
BSS 7c:9a:54:76:24:55(on wlan0)
	freq: 2462
	signal: -40.00 dBm
	SSID: GenZen-WiFi
	DS Parameter set: channel 11
BSS 7c:9a:54:76:24:5d(on wlan0)
	freq: 5785
	signal: -42.00 dBm
	SSID: GenZen-WiFi
	DS Parameter set: channel 157
BSS aa:bb:cc:dd:ee:10(on wlan0)
	freq: 2412
	signal: -50.00 dBm
	SSID: Neighbor
	DS Parameter set: channel 1
"""

TWIN_SCAN = """
BSS 10:00:00:00:00:03(on wlan0)
	freq: 5745
	signal: -40.00 dBm
	SSID: GenZen-WiFi
	DS Parameter set: channel 149
"""


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "X-Monitor-Name": quote("Pi Test", safe="")}


def _health(ssid: str | None = None, bssid: str | None = None) -> dict:
    body = {
        "hostname": "pi-test",
        "agent_version": "0.3.10",
        "uptime_seconds": 10,
        "cpu_percent": 1,
        "load_1": 0.1,
        "mem_used_mb": 100,
        "mem_total_mb": 1000,
        "disk_used_mb": 100,
        "disk_total_mb": 1000,
        "config_version": 0,
    }
    if ssid is not None:
        body["link_ssid"] = ssid
    if bssid is not None:
        body["link_bssid"] = bssid
    return body


def _trusted(db, monitor_id) -> set[str]:
    rows = db.scalars(select(ApInventory.bssid).where(ApInventory.monitor_id == monitor_id, ApInventory.trusted.is_(True)))
    return {row.lower() for row in rows.all()}


def _scan(client, token, raw: str, when: datetime):
    return client.post(
        "/api/v1/monitors/wifi-scans",
        headers=_headers(token),
        json={"scanned_at": when.isoformat(), "raw": raw},
    )


def test_sibling_bssids_trust_once_and_a_different_prefix_is_an_evil_twin(client, db, monitor_token):
    monitor = db.scalar(select(Monitor).where(Monitor.slug == db.info["monitor_slug"]))
    assert monitor is not None

    reported = client.post(
        "/api/v1/monitors/health",
        headers=_headers(monitor_token),
        json=_health("GenZen-WiFi", HOME),
    )
    assert reported.status_code == 200, reported.text
    db.expire_all()
    assert monitor.link_ssid == "GenZen-WiFi"
    assert monitor.link_bssid == HOME
    assert _trusted(db, monitor.id) == set()

    scanned = _scan(client, monitor_token, HOME_SCAN, SEEN)
    assert scanned.status_code == 200, scanned.text
    db.expire_all()
    assert _trusted(db, monitor.id) == {HOME, SIBLING}

    kept = client.post("/api/v1/monitors/health", headers=_headers(monitor_token), json=_health())
    assert kept.status_code == 200
    db.expire_all()
    assert monitor.link_ssid == "GenZen-WiFi"
    assert monitor.link_bssid == HOME

    admin = login(client)
    removed = client.delete(f"/api/v1/rf/aps/{SIBLING}/trust", params={"agent_id": str(monitor.id)}, headers=admin)
    assert removed.status_code == 200, removed.text
    again = _scan(client, monitor_token, HOME_SCAN, LATER)
    assert again.status_code == 200, again.text
    db.expire_all()
    assert SIBLING not in _trusted(db, monitor.id)
    assert HOME in _trusted(db, monitor.id)
    row = db.scalar(select(ApInventory).where(ApInventory.monitor_id == monitor.id, ApInventory.bssid == SIBLING))
    assert row is not None
    assert row.trust_source == "manual"

    twin = _scan(client, monitor_token, TWIN_SCAN, LATER.replace(minute=6))
    assert twin.status_code == 200, twin.text
    db.expire_all()
    assert TWIN not in _trusted(db, monitor.id)
    title = f"Possible evil twin GenZen-WiFi on {TWIN}"
    issue = db.scalar(select(Issue).where(Issue.monitor_id == monitor.id, Issue.title == title))
    assert issue is not None
    assert issue.severity.value == "warning"
    assert issue.root_cause_stage == "airwave"

    cleared = client.post(
        "/api/v1/monitors/health",
        headers=_headers(monitor_token),
        json=_health("", ""),
    )
    assert cleared.status_code == 200
    db.expire_all()
    assert monitor.link_ssid is None
    assert monitor.link_bssid is None
    assert HOME in _trusted(db, monitor.id)
