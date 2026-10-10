"""Airwave reads and the Wi-Fi scan upload from a remote agent."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.routes import _resolve_monitor_identity
from app.auth import get_current_user, require_admin
from app.db import get_db
from app.models import ApInventory, Monitor, RfChannelStat, User, WifiObservation
from app.rf_view import (
    bucket_seconds,
    bucket_start,
    hill_points,
    noise_by_frequency,
    parse_iw_scan,
    parse_iw_survey,
    range_start,
    recommend_band,
)
from app.schemas import (
    RfApOut,
    RfChannelBusy,
    RfChannelSnapshotOut,
    RfHillSeries,
    RfHistoryPoint,
    RfOverviewOut,
    RfScanRequestOut,
    RfSparkPoint,
    WifiScanIn,
)

router = APIRouter(prefix="/api/v1")

_RANGES = "^(1h|6h|24h|7d)$"


def _monitor_or_404(db: Session, agent_id: UUID) -> Monitor:
    monitor = db.get(Monitor, agent_id)
    if monitor is None:
        raise HTTPException(status_code=404, detail="Remote agent not found")
    return monitor


def _remember(db: Session, monitor_id: UUID, bssid: str, seen: datetime) -> ApInventory:
    key = bssid.lower()
    row = db.scalar(
        select(ApInventory).where(ApInventory.monitor_id == monitor_id, func.lower(ApInventory.bssid) == key)
    )
    if row is None:
        row = ApInventory(
            monitor_id=monitor_id,
            bssid=key,
            trusted=False,
            label="",
            first_seen=seen,
            last_seen=seen,
        )
        db.add(row)
        return row
    if seen < row.first_seen:
        row.first_seen = seen
    if seen > row.last_seen:
        row.last_seen = seen
    return row


@router.post("/monitors/wifi-scans")
def post_wifi_scans(
    body: WifiScanIn,
    db: Annotated[Session, Depends(get_db)],
    authorization: Annotated[Optional[str], Header()] = None,
    x_monitor_name: Annotated[Optional[str], Header()] = None,
) -> dict[str, int]:
    monitor = _resolve_monitor_identity(db, authorization, x_monitor_name)
    scanned_at = body.scanned_at
    if scanned_at.tzinfo is None:
        scanned_at = scanned_at.replace(tzinfo=timezone.utc)
    survey = parse_iw_survey(body.survey)
    aps = parse_iw_scan(body.raw, noise_by_frequency(survey))
    stored = 0
    for ap in aps:
        bssid = ap["bssid"]
        exists = db.scalar(
            select(WifiObservation.id).where(
                WifiObservation.monitor_id == monitor.id,
                WifiObservation.bssid == bssid,
                WifiObservation.scanned_at == scanned_at,
            )
        )
        if exists is None:
            db.add(
                WifiObservation(
                    monitor_id=monitor.id,
                    scanned_at=scanned_at,
                    ssid=ap["ssid"][:64],
                    bssid=bssid,
                    vendor=ap["vendor"][:64],
                    band=ap["band"][:8],
                    channel=int(ap["channel"]),
                    channel_width=int(ap["channel_width"]),
                    rssi_dbm=float(ap["rssi_dbm"]),
                    noise_dbm=ap["noise_dbm"],
                    security=ap["security"][:32],
                    phy=ap["phy"][:8],
                    max_link_rate_mbps=int(ap["max_link_rate_mbps"]),
                )
            )
            stored += 1
        _remember(db, monitor.id, bssid, scanned_at)
    for row in survey:
        band_name = str(row["band"])[:8]
        channel = int(row["channel"])
        exists = db.scalar(
            select(RfChannelStat.id).where(
                RfChannelStat.monitor_id == monitor.id,
                RfChannelStat.measured_at == scanned_at,
                RfChannelStat.band == band_name,
                RfChannelStat.channel == channel,
            )
        )
        if exists is None:
            db.add(
                RfChannelStat(
                    monitor_id=monitor.id,
                    measured_at=scanned_at,
                    band=band_name,
                    channel=channel,
                    noise_dbm=row["noise_dbm"],
                    busy_pct=row["busy_pct"],
                )
            )
    monitor.scan_requested_at = None
    db.commit()
    return {"stored": stored}


def _latest_rows(db: Session, monitor_id: UUID) -> tuple[datetime | None, list[WifiObservation]]:
    latest = db.scalar(select(func.max(WifiObservation.scanned_at)).where(WifiObservation.monitor_id == monitor_id))
    if latest is None:
        return None, []
    rows = db.scalars(
        select(WifiObservation).where(
            WifiObservation.monitor_id == monitor_id,
            WifiObservation.scanned_at == latest,
        )
    ).all()
    return latest, list(rows)


def _as_ap(row: WifiObservation) -> dict:
    return {
        "bssid": row.bssid,
        "ssid": row.ssid,
        "hidden": row.ssid == "",
        "band": row.band,
        "channel": row.channel,
        "channel_width": row.channel_width,
        "rssi_dbm": row.rssi_dbm,
        "security": row.security,
        "vendor": row.vendor,
        "phy": row.phy,
    }


def _inventory_map(db: Session, monitor_id: UUID) -> dict[str, ApInventory]:
    rows = db.scalars(select(ApInventory).where(ApInventory.monitor_id == monitor_id)).all()
    return {row.bssid.lower(): row for row in rows}


def _ap_out(row: WifiObservation, inventory: ApInventory | None, latest: datetime) -> RfApOut:
    return RfApOut(
        bssid=row.bssid,
        ssid=row.ssid,
        hidden=row.ssid == "",
        band=row.band,
        channel=row.channel,
        channel_width=row.channel_width,
        rssi_dbm=row.rssi_dbm,
        security=row.security,
        vendor=row.vendor,
        phy=row.phy,
        first_seen=inventory.first_seen if inventory is not None else latest,
        last_seen=inventory.last_seen if inventory is not None else latest,
        trusted=bool(inventory.trusted) if inventory is not None else False,
        label=inventory.label if inventory is not None else "",
    )


@router.get("/rf/overview", response_model=RfOverviewOut)
def rf_overview(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
    agent_id: UUID = Query(...),
    range_key: str = Query("24h", alias="range", pattern=_RANGES),
) -> RfOverviewOut:
    monitor = _monitor_or_404(db, agent_id)
    latest, rows = _latest_rows(db, monitor.id)
    advice = [recommend_band([_as_ap(row) for row in rows], band) for band in ("2.4", "5")]
    crowded = max(advice, key=lambda item: item["ap_count"])
    start = range_start(range_key)
    seconds = bucket_seconds(range_key)
    history = db.scalars(
        select(WifiObservation).where(
            WifiObservation.monitor_id == monitor.id,
            WifiObservation.scanned_at >= start,
        )
    ).all()
    counts: dict[datetime, dict[str, set[str]]] = {}
    for row in history:
        bucket = counts.setdefault(bucket_start(row.scanned_at, seconds), {"all": set(), "2.4": set(), "5": set()})
        bucket["all"].add(row.bssid)
        if row.band in bucket:
            bucket[row.band].add(row.bssid)
    sparkline = [
        RfSparkPoint(
            t=moment,
            ap_count=len(groups["all"]),
            count_24=len(groups["2.4"]),
            count_5=len(groups["5"]),
        )
        for moment, groups in sorted(counts.items())
    ]
    return RfOverviewOut(
        agent_id=monitor.id,
        agent_name=monitor.name,
        location_label=monitor.location_label,
        last_scan_at=latest,
        scan_requested=monitor.scan_requested_at is not None,
        bands=advice,
        headline=crowded["reason"],
        sparkline=sparkline,
    )


@router.get("/rf/aps", response_model=list[RfApOut])
def rf_aps(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
    agent_id: UUID = Query(...),
    band: str = "",
    security: str = "",
    hidden: Optional[bool] = None,
    q: str = "",
    sort: str = "rssi",
) -> list[RfApOut]:
    monitor = _monitor_or_404(db, agent_id)
    latest, rows = _latest_rows(db, monitor.id)
    if latest is None:
        return []
    inventory = _inventory_map(db, monitor.id)
    found = [_ap_out(row, inventory.get(row.bssid.lower()), latest) for row in rows]
    needle = q.strip().lower()
    if band:
        found = [ap for ap in found if ap.band == band]
    if security:
        found = [ap for ap in found if ap.security.lower() == security.lower()]
    if hidden is not None:
        found = [ap for ap in found if ap.hidden is hidden]
    if needle:
        found = [ap for ap in found if needle in ap.ssid.lower() or needle in ap.bssid]
    if sort == "ssid":
        found.sort(key=lambda ap: (ap.ssid.lower(), ap.bssid))
    elif sort == "channel":
        found.sort(key=lambda ap: (ap.channel, ap.bssid))
    elif sort == "last_seen":
        found.sort(key=lambda ap: ap.last_seen, reverse=True)
    else:
        found.sort(key=lambda ap: ap.rssi_dbm, reverse=True)
    return found


@router.get("/rf/aps/{bssid}/history", response_model=list[RfHistoryPoint])
def rf_ap_history(
    bssid: str,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
    agent_id: UUID = Query(...),
    range_key: str = Query("24h", alias="range", pattern=_RANGES),
) -> list[RfHistoryPoint]:
    _monitor_or_404(db, agent_id)
    key = bssid.lower()
    seconds = bucket_seconds(range_key)
    rows = db.scalars(
        select(WifiObservation)
        .where(
            WifiObservation.monitor_id == agent_id,
            func.lower(WifiObservation.bssid) == key,
            WifiObservation.scanned_at >= range_start(range_key),
        )
        .order_by(WifiObservation.scanned_at)
    ).all()
    buckets: dict[datetime, list[WifiObservation]] = {}
    for row in rows:
        buckets.setdefault(bucket_start(row.scanned_at, seconds), []).append(row)
    points = []
    for moment, group in sorted(buckets.items()):
        last = group[-1]
        rssi = sum(item.rssi_dbm for item in group) / len(group)
        points.append(RfHistoryPoint(t=moment, rssi_dbm=round(rssi, 1), channel=last.channel))
    return points


def _busy_channels(db: Session, monitor_id: UUID, band: str, latest: datetime | None) -> list[RfChannelBusy]:
    if latest is None:
        return []
    moment = db.scalar(
        select(func.max(RfChannelStat.measured_at)).where(
            RfChannelStat.monitor_id == monitor_id,
            RfChannelStat.band == band,
            RfChannelStat.measured_at <= latest,
        )
    )
    if moment is None:
        return []
    rows = db.scalars(
        select(RfChannelStat)
        .where(
            RfChannelStat.monitor_id == monitor_id,
            RfChannelStat.band == band,
            RfChannelStat.measured_at == moment,
        )
        .order_by(RfChannelStat.channel)
    ).all()
    return [
        RfChannelBusy(channel=row.channel, noise_dbm=row.noise_dbm, busy_pct=row.busy_pct)
        for row in rows
        if row.busy_pct is not None or row.noise_dbm is not None
    ]


@router.get("/rf/channel-snapshot", response_model=RfChannelSnapshotOut)
def rf_channel_snapshot(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
    agent_id: UUID = Query(...),
    band: str = Query("2.4", pattern="^(2\\.4|5)$"),
) -> RfChannelSnapshotOut:
    monitor = _monitor_or_404(db, agent_id)
    _latest, rows = _latest_rows(db, monitor.id)
    group = [_as_ap(row) for row in rows if row.band == band]
    advice = recommend_band(group, band)
    inventory = _inventory_map(db, monitor.id)
    series = []
    for ap in sorted(group, key=lambda item: item["rssi_dbm"], reverse=True):
        record = inventory.get(ap["bssid"].lower())
        series.append(
            RfHillSeries(
                bssid=ap["bssid"],
                ssid=ap["ssid"] or "Hidden network",
                hidden=ap["hidden"],
                trusted=bool(record.trusted) if record is not None else False,
                channel=ap["channel"],
                channel_width=ap["channel_width"],
                rssi_dbm=ap["rssi_dbm"],
                security=ap["security"],
                points=hill_points(ap),
            )
        )
    return RfChannelSnapshotOut(
        band=band,
        recommended_channel=advice["recommended_channel"],
        reason=advice["reason"],
        series=series,
        channels=_busy_channels(db, monitor.id, band, _latest),
    )


@router.post("/rf/scan-now", response_model=RfScanRequestOut)
def rf_scan_now(
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[User, Depends(require_admin)],
    agent_id: UUID = Query(...),
) -> RfScanRequestOut:
    monitor = _monitor_or_404(db, agent_id)
    if monitor.scan_requested_at is None:
        monitor.scan_requested_at = datetime.now(timezone.utc)
    db.commit()
    return RfScanRequestOut(
        agent_id=monitor.id,
        agent_name=monitor.name,
        scan_requested_at=monitor.scan_requested_at,
    )


def _set_trust(db: Session, agent_id: UUID, bssid: str, trusted: bool) -> RfApOut:
    monitor = _monitor_or_404(db, agent_id)
    key = bssid.lower()
    latest, rows = _latest_rows(db, monitor.id)
    row = next((item for item in rows if item.bssid.lower() == key), None)
    if row is None or latest is None:
        raise HTTPException(status_code=404, detail="Access point not found")
    record = _remember(db, monitor.id, key, latest)
    record.trusted = trusted
    db.commit()
    db.refresh(record)
    return _ap_out(row, record, latest)


@router.post("/rf/aps/{bssid}/trust", response_model=RfApOut)
def trust_ap(
    bssid: str,
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[User, Depends(require_admin)],
    agent_id: UUID = Query(...),
) -> RfApOut:
    return _set_trust(db, agent_id, bssid, True)


@router.delete("/rf/aps/{bssid}/trust", response_model=RfApOut)
def untrust_ap(
    bssid: str,
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[User, Depends(require_admin)],
    agent_id: UUID = Query(...),
) -> RfApOut:
    return _set_trust(db, agent_id, bssid, False)
