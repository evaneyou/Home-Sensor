"""The SSID on the Pi's link adapter is trusted on every channel."""

from datetime import datetime, timezone
from urllib.parse import quote

from sqlalchemy import select

from app.models import ApInventory, Monitor, WifiObservation

SEEN = datetime(2026, 10, 9, 20, 0, tzinfo=timezone.utc)
LATER = datetime(2026, 10, 9, 20, 5, tzinfo=timezone.utc)

EXTRA = """
BSS 10:00:00:00:00:03(on wlan0)
	freq: 5745
	signal: -40.00 dBm
	SSID: GenZen-WiFi
	DS Parameter set: channel 149
BSS 10:00:00:00:00:09(on wlan0)
	freq: 2412
	signal: -50.00 dBm
	SSID: Neighbor
	DS Parameter set: channel 1
"""


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "X-Monitor-Name": quote("Pi Test", safe="")}


def _health(ssid: str | None = None) -> dict:
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
    return body


def _observe(db, monitor_id, ssid: str, bssid: str, channel: int, band: str) -> None:
    db.add(
        WifiObservation(
            monitor_id=monitor_id,
            scanned_at=SEEN,
            ssid=ssid,
            bssid=bssid,
            vendor="Unknown",
            band=band,
            channel=channel,
            channel_width=20,
            rssi_dbm=-40,
            security="WPA2",
            phy="n",
            max_link_rate_mbps=0,
        )
    )


def _trusted(db, monitor_id) -> set[str]:
    rows = db.scalars(select(ApInventory.bssid).where(ApInventory.monitor_id == monitor_id, ApInventory.trusted.is_(True)))
    return {row.lower() for row in rows.all()}


def test_joined_ssid_is_trusted_on_every_channel(client, db, monitor_token):
    monitor = db.scalar(select(Monitor).where(Monitor.slug == db.info["monitor_slug"]))
    _observe(db, monitor.id, "GenZen-WiFi", "7c:9a:54:76:24:55", 11, "2.4")
    _observe(db, monitor.id, "GenZen-WiFi", "7c:9a:54:76:24:5d", 157, "5")
    _observe(db, monitor.id, "Neighbor", "aa:bb:cc:dd:ee:10", 6, "2.4")
    db.commit()

    reported = client.post("/api/v1/monitors/health", headers=_headers(monitor_token), json=_health("GenZen-WiFi"))
    assert reported.status_code == 200, reported.text
    assert set(reported.json()["trusted_bssids"]) == {"7c:9a:54:76:24:55", "7c:9a:54:76:24:5d"}
    db.expire_all()
    assert monitor.link_ssid == "GenZen-WiFi"
    assert _trusted(db, monitor.id) == {"7c:9a:54:76:24:55", "7c:9a:54:76:24:5d"}

    kept = client.post("/api/v1/monitors/health", headers=_headers(monitor_token), json=_health())
    assert kept.status_code == 200
    db.expire_all()
    assert monitor.link_ssid == "GenZen-WiFi"

    scanned = client.post(
        "/api/v1/monitors/wifi-scans",
        headers=_headers(monitor_token),
        json={"scanned_at": LATER.isoformat(), "raw": EXTRA},
    )
    assert scanned.status_code == 200, scanned.text
    db.expire_all()
    assert _trusted(db, monitor.id) == {"7c:9a:54:76:24:55", "7c:9a:54:76:24:5d", "10:00:00:00:00:03"}

    cleared = client.post("/api/v1/monitors/health", headers=_headers(monitor_token), json=_health(""))
    assert cleared.status_code == 200
    db.expire_all()
    assert monitor.link_ssid is None
    assert "7c:9a:54:76:24:55" in _trusted(db, monitor.id)
