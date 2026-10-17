"""Guest visits for reporting: the Pi's own address is left out, a year is kept, and ranges and paging work."""

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app import geoip
from app.models import AuditEvent, GuestVisit, Monitor
from app.services.retention import apply_retention
from tests.conftest import login
from tests.test_guest_login import _ensure_guest
from tests.test_guest_summary import _guest_in

OWN = "198.51.100.80"


def _monitor(db) -> Monitor:
    monitor = db.scalar(select(Monitor).where(Monitor.slug == db.info["monitor_slug"]))
    assert monitor is not None
    return monitor


def _visit(db, address: str, days_ago: float, country: str = "Testland", code: str = "TL", city: str = "Alphaville") -> None:
    db.add(
        GuestVisit(
            address=address,
            visited_at=datetime.now(timezone.utc) - timedelta(days=days_ago),
            country=country,
            country_code=code,
            city=city,
        )
    )


def test_the_pi_address_is_neither_stored_nor_shown(client: TestClient, db, monkeypatch):
    _ensure_guest(db)
    monkeypatch.setattr(geoip, "lookup", lambda _address: None)
    monitor = _monitor(db)
    monitor.public_ip = OWN
    db.commit()
    login(client)

    _guest_in(client, OWN)
    _guest_in(client, "198.51.100.81")
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(GuestVisit).where(GuestVisit.address == OWN)) == 0
    assert db.scalar(select(func.count()).select_from(GuestVisit).where(GuestVisit.address == "198.51.100.81")) == 1
    # The audit trail still records the sign-in.
    assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.detail == OWN)) >= 1

    # A visit stored before the Pi reported its address is hidden too.
    _visit(db, "198.51.100.82", 1)
    db.commit()
    monitor.public_ip = "198.51.100.82"
    db.commit()
    listed = client.get("/api/v1/settings/guest-visits").json()
    assert "198.51.100.82" not in [row["address"] for row in listed]
    assert "198.51.100.81" in [row["address"] for row in listed]

    db.execute(AuditEvent.__table__.delete().where(AuditEvent.detail == OWN))
    monitor.public_ip = None
    db.commit()


def test_a_year_is_kept_and_older_visits_are_deleted(db):
    _visit(db, "198.51.100.90", 364)
    _visit(db, "198.51.100.91", 366)
    db.commit()
    summary = apply_retention(db, datetime.now(timezone.utc))
    db.commit()
    assert summary["deleted_guest_visits"] >= 1
    kept = {row for row in db.scalars(select(GuestVisit.address).where(GuestVisit.address.in_(["198.51.100.90", "198.51.100.91"]))).all()}
    assert kept == {"198.51.100.90"}


def test_summary_ranges_and_the_previous_period(client: TestClient, db):
    login(client)
    before = {name: client.get(f"/api/v1/settings/guest-visits/summary?range={name}").json() for name in ("7d", "30d", "1y")}
    _visit(db, "198.51.100.92", 2)
    _visit(db, "198.51.100.93", 20, country="Otherland", code="OL", city="Gammaport")
    _visit(db, "198.51.100.93", 45)  # previous 30 days
    _visit(db, "198.51.100.94", 200)
    db.commit()
    after = {name: client.get(f"/api/v1/settings/guest-visits/summary?range={name}").json() for name in ("7d", "30d", "1y")}
    assert after["7d"]["total"] - before["7d"]["total"] == 1
    assert after["30d"]["total"] - before["30d"]["total"] == 2
    assert after["30d"]["previous_total"] - before["30d"]["previous_total"] == 1
    assert after["1y"]["total"] - before["1y"]["total"] == 4
    assert after["30d"]["bucket"] == "day" and len(after["30d"]["by_period"]) in (30, 31)
    assert after["1y"]["bucket"] == "week" and 52 <= len(after["1y"]["by_period"]) <= 54
    cities = {row["city"] for row in after["30d"]["by_city"]}
    assert {"Alphaville", "Gammaport"} <= cities
    assert after["30d"]["retention_days"] == 365
    assert client.get("/api/v1/settings/guest-visits/summary?range=5y").status_code == 422


def test_the_list_pages_by_time_without_repeats(client: TestClient, db):
    for index in range(5):
        _visit(db, f"198.51.100.{100 + index}", 0.1 + index * 0.01)
    db.commit()
    login(client)
    first = client.get("/api/v1/settings/guest-visits?limit=2").json()
    second = client.get(f"/api/v1/settings/guest-visits?limit=2&before={first[-1]['created_at']}").json()
    assert len(first) == 2 and len(second) == 2
    assert {row["created_at"] for row in first}.isdisjoint({row["created_at"] for row in second})
    assert first[-1]["created_at"] > second[0]["created_at"]
    assert client.get("/api/v1/settings/guest-visits?limit=500").status_code == 422
