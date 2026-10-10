"""Trust every access point that advertises the SSID the Pi is joined to."""

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import ApInventory, Monitor, WifiObservation


def matches_link(monitor: Monitor, ssid: str) -> bool:
    joined = (monitor.link_ssid or "").strip()
    return bool(joined) and ssid[:64] == joined


def remember_link_ssid(db: Session, monitor: Monitor, ssid: str | None, seen: datetime) -> None:
    cleaned = (ssid or "").strip()[:64]
    monitor.link_ssid = cleaned or None
    if monitor.link_ssid is None:
        return
    bssids = db.scalars(
        select(WifiObservation.bssid)
        .where(WifiObservation.monitor_id == monitor.id, WifiObservation.ssid == monitor.link_ssid)
        .distinct()
    ).all()
    for bssid in bssids:
        key = bssid.lower()
        row = db.scalar(
            select(ApInventory).where(ApInventory.monitor_id == monitor.id, func.lower(ApInventory.bssid) == key)
        )
        if row is None:
            db.add(
                ApInventory(
                    monitor_id=monitor.id,
                    bssid=key,
                    trusted=True,
                    label="",
                    first_seen=seen,
                    last_seen=seen,
                )
            )
            continue
        row.trusted = True
        if seen > row.last_seen:
            row.last_seen = seen
