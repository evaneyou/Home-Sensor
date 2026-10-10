"""Trust a new access point of the joined SSID only when it belongs to the radio the Pi is on."""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ApInventory, Issue, IssueSeverity, IssueStatus, Monitor


def mac_prefix(mac: str) -> str:
    parts = (mac or "").lower().split(":")
    if len(parts) < 5:
        return ""
    return ":".join(parts[:5])


def matches_link(monitor: Monitor, ssid: str) -> bool:
    joined = (monitor.link_ssid or "").strip()
    return bool(joined) and ssid[:64] == joined


def remember_association(
    monitor: Monitor,
    ssid: str | None,
    bssid: str | None,
    *,
    ssid_set: bool,
    bssid_set: bool,
) -> None:
    """Store the link the Pi reported. An omitted field is left alone."""
    if ssid_set:
        cleaned = (ssid or "").strip()[:64]
        monitor.link_ssid = cleaned or None
    if bssid_set:
        cleaned = (bssid or "").strip().lower()[:17]
        monitor.link_bssid = cleaned or None


def note_new_ap(db: Session, monitor: Monitor, record: ApInventory, ssid: str, created: bool, seen: datetime) -> None:
    """Decide trust once, when the inventory row is created."""
    if not created or record.trust_source == "manual" or not matches_link(monitor, ssid):
        return
    associated = (monitor.link_bssid or "").lower()
    if not associated:
        return
    if mac_prefix(record.bssid) and mac_prefix(record.bssid) == mac_prefix(associated):
        record.trusted = True
        record.trust_source = "auto"
        return
    record.trusted = False
    record.trust_source = "auto"
    _open_evil_twin(db, monitor, ssid.strip()[:64], record.bssid, seen)


def _open_evil_twin(db: Session, monitor: Monitor, ssid: str, bssid: str, when: datetime) -> None:
    title = f"Possible evil twin {ssid} on {bssid.lower()}"[:255]
    existing = db.scalar(
        select(Issue.id).where(
            Issue.monitor_id == monitor.id,
            Issue.status == IssueStatus.open,
            Issue.root_cause_stage == "airwave",
            Issue.title == title,
        )
    )
    if existing is not None:
        return
    db.add(
        Issue(
            group_id=monitor.group_id,
            monitor_id=monitor.id,
            title=title,
            summary=title,
            severity=IssueSeverity.warning,
            status=IssueStatus.open,
            root_cause_stage="airwave",
            opened_at=when,
        )
    )
