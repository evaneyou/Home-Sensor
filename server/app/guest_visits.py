"""Guest sign-ins: recording, the paged list, and the range summary for reporting.

A visit from an address a Pi reports as its own public address is the owner at home, so it is
never stored and never shown.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import Date, cast, desc, func, select
from sqlalchemy.orm import Session

from app import geoip
from app.models import GuestVisit, Monitor

RETENTION_DAYS = 365
RANGES = {"7d": 7, "30d": 30, "90d": 90, "1y": 365}
DEFAULT_RANGE = "30d"
WEEKLY_AFTER_DAYS = 90


def owner_addresses(db: Session) -> set[str]:
    """Public addresses the Pi agents report, which is where the owner browses from."""
    rows = db.scalars(select(Monitor.public_ip).where(Monitor.public_ip.is_not(None))).all()
    return {row.strip() for row in rows if row and row.strip()}


def record(db: Session, address: str) -> bool:
    """Store one sign-in with its place. Returns False when it is the owner's own address."""
    if address in owner_addresses(db):
        return False
    place = geoip.lookup(address) or {}
    db.add(
        GuestVisit(
            address=address,
            country=place.get("country", ""),
            country_code=place.get("country_code", ""),
            region=place.get("region", ""),
            city=place.get("city", ""),
        )
    )
    return True


def _visible(db: Session):
    own = owner_addresses(db)
    return [GuestVisit.address.not_in(sorted(own))] if own else []


def range_days(name: str) -> int:
    return RANGES.get(name, RANGES[DEFAULT_RANGE])


def latest(db: Session, *, limit: int, before: Optional[datetime], since: Optional[datetime]) -> list[GuestVisit]:
    query = select(GuestVisit).where(*_visible(db))
    if before is not None:
        query = query.where(GuestVisit.visited_at < before)
    if since is not None:
        query = query.where(GuestVisit.visited_at >= since)
    return list(db.scalars(query.order_by(desc(GuestVisit.visited_at)).limit(limit)).all())


def _count_between(db: Session, start: datetime, end: datetime) -> tuple[int, int]:
    total, unique = db.execute(
        select(func.count(), func.count(func.distinct(GuestVisit.address))).where(
            *_visible(db), GuestVisit.visited_at >= start, GuestVisit.visited_at < end
        )
    ).one()
    return int(total), int(unique)


def summary(db: Session, name: str, now: Optional[datetime] = None) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    days = range_days(name)
    start = now - timedelta(days=days)
    previous_start = start - timedelta(days=days)
    visible = _visible(db)
    in_range = [*visible, GuestVisit.visited_at >= start, GuestVisit.visited_at <= now]

    total, unique = _count_between(db, start, now + timedelta(seconds=1))
    previous_total, previous_unique = _count_between(db, previous_start, start)

    weekly = days > WEEKLY_AFTER_DAYS
    if weekly:
        bucket = cast(func.date_trunc("week", func.timezone("UTC", GuestVisit.visited_at)), Date)
    else:
        bucket = cast(func.timezone("UTC", GuestVisit.visited_at), Date)
    counts: dict[date, int] = {
        row[0]: int(row[1])
        for row in db.execute(select(bucket, func.count()).where(*in_range).group_by(bucket)).all()
    }
    series: list[dict[str, Any]] = []
    cursor = start.astimezone(timezone.utc).date()
    last = now.astimezone(timezone.utc).date()
    if weekly:
        cursor -= timedelta(days=cursor.weekday())
    step = timedelta(days=7 if weekly else 1)
    while cursor <= last:
        series.append({"date": cursor.isoformat(), "count": counts.get(cursor, 0)})
        cursor += step
    busiest = max(series, key=lambda item: item["count"], default=None)

    countries = db.execute(
        select(
            GuestVisit.country,
            GuestVisit.country_code,
            func.count(),
            func.count(func.distinct(GuestVisit.address)),
        )
        .where(*in_range)
        .group_by(GuestVisit.country, GuestVisit.country_code)
        .order_by(desc(func.count()), GuestVisit.country)
    ).all()
    cities = db.execute(
        select(GuestVisit.city, GuestVisit.region, GuestVisit.country, func.count())
        .where(*in_range, GuestVisit.city != "")
        .group_by(GuestVisit.city, GuestVisit.region, GuestVisit.country)
        .order_by(desc(func.count()), GuestVisit.city)
        .limit(10)
    ).all()
    first_at, last_at = db.execute(
        select(func.min(GuestVisit.visited_at), func.max(GuestVisit.visited_at)).where(*visible)
    ).one()
    named = [row for row in countries if row[0] not in ("", "Unknown", "Private network")]
    return {
        "range": name if name in RANGES else DEFAULT_RANGE,
        "days": days,
        "since": start,
        "until": now,
        "bucket": "week" if weekly else "day",
        "total": total,
        "previous_total": previous_total,
        "unique_addresses": unique,
        "previous_unique": previous_unique,
        "countries": len(named),
        "first_at": first_at,
        "last_at": last_at,
        "busiest": busiest if busiest and busiest["count"] else None,
        "by_period": series,
        "by_country": [
            {"country": row[0] or "Unknown", "country_code": row[1], "count": int(row[2]), "unique": int(row[3])} for row in countries
        ],
        "by_city": [{"city": row[0], "region": row[1], "country": row[2], "count": int(row[3])} for row in cities],
        "retention_days": RETENTION_DAYS,
        "located": geoip.available(),
    }
