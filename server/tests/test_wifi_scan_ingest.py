"""Wi-Fi scan upload stores survey noise when it is present."""

from datetime import datetime, timezone
from urllib.parse import quote

from sqlalchemy import func, select

from app.models import Monitor, RfChannelStat, WifiObservation
from test_rf_view import SCAN, SURVEY


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "X-Monitor-Name": quote("Pi Test", safe="")}


def test_scan_without_survey_leaves_noise_empty(client, db, monitor_token):
    scanned = datetime(2026, 10, 9, 18, 0, tzinfo=timezone.utc)
    response = client.post(
        "/api/v1/monitors/wifi-scans",
        headers=_headers(monitor_token),
        json={"scanned_at": scanned.isoformat(), "raw": SCAN},
    )
    assert response.status_code == 200, response.text
    monitor = db.scalar(select(Monitor).where(Monitor.slug == db.info["monitor_slug"]))
    db.expire_all()
    row = db.scalar(
        select(WifiObservation).where(WifiObservation.monitor_id == monitor.id, WifiObservation.ssid == "Home")
    )
    assert row is not None
    assert row.noise_dbm is None
    assert db.scalar(select(func.count()).select_from(RfChannelStat).where(RfChannelStat.monitor_id == monitor.id)) == 0


def test_scan_with_survey_stores_noise_and_busy_percent(client, db, monitor_token):
    scanned = datetime(2026, 10, 9, 18, 5, tzinfo=timezone.utc)
    monitor = db.scalar(select(Monitor).where(Monitor.slug == db.info["monitor_slug"]))
    monitor.scan_requested_at = scanned
    db.commit()
    response = client.post(
        "/api/v1/monitors/wifi-scans",
        headers=_headers(monitor_token),
        json={"scanned_at": scanned.isoformat(), "raw": SCAN, "survey": SURVEY, "scan_iface_role": "radio"},
    )
    assert response.status_code == 200, response.text
    db.expire_all()
    home = db.scalar(
        select(WifiObservation).where(
            WifiObservation.monitor_id == monitor.id,
            WifiObservation.ssid == "Home",
            WifiObservation.scanned_at == scanned,
        )
    )
    assert home.noise_dbm == -90
    hidden = db.scalar(
        select(WifiObservation).where(
            WifiObservation.monitor_id == monitor.id,
            WifiObservation.bssid == "aa:bb:cc:dd:ee:01",
            WifiObservation.scanned_at == scanned,
        )
    )
    assert hidden.noise_dbm == -95
    busy = {
        row.channel: row.busy_pct
        for row in db.scalars(select(RfChannelStat).where(RfChannelStat.monitor_id == monitor.id)).all()
    }
    assert busy[1] == 25
    assert busy[6] is None
    assert busy[36] == 10
    db.refresh(monitor)
    assert monitor.scan_requested_at is None
    again = client.post(
        "/api/v1/monitors/wifi-scans",
        headers=_headers(monitor_token),
        json={"scanned_at": scanned.isoformat(), "raw": SCAN, "survey": SURVEY},
    )
    assert again.status_code == 200
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(RfChannelStat).where(RfChannelStat.monitor_id == monitor.id)) == 3
