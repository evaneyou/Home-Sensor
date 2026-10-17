"""The guest visit list carries a place for each address, and the summary counts visits by day and country."""

from fastapi.testclient import TestClient

from app import geoip
from app.main import app
from tests.conftest import login
from tests.test_guest_login import _ensure_guest

PLACES = {
    "198.51.100.71": {"country": "Testland", "country_code": "TL", "region": "North", "city": "Alphaville"},
    "198.51.100.72": {"country": "Testland", "country_code": "TL", "region": "South", "city": "Betatown"},
    "198.51.100.73": {"country": "Otherland", "country_code": "OL", "region": "", "city": "Gammaport"},
}


def _fake_lookup(address: str):
    return PLACES.get(address)


def _guest_in(client: TestClient, address: str) -> None:
    guest = TestClient(client.app, base_url="https://testserver")
    response = guest.post(
        "/api/v1/auth/login",
        json={"username": "guest", "password": "guest"},
        headers={"X-Forwarded-For": address},
    )
    assert response.status_code == 200, response.text


def test_summary_counts_visits_by_country_and_day(client: TestClient, db, monkeypatch):
    _ensure_guest(db)
    monkeypatch.setattr(geoip, "lookup", _fake_lookup)
    monkeypatch.setattr(geoip, "available", lambda: True)
    admin = login(client)
    before = client.get("/api/v1/settings/guest-visits/summary").json()
    for address in ("198.51.100.71", "198.51.100.72", "198.51.100.71", "198.51.100.73"):
        _guest_in(client, address)

    after = client.get("/api/v1/settings/guest-visits/summary").json()
    assert after["total"] == before["total"] + 4
    assert after["located"] is True
    by_country = {row["country"]: row["count"] for row in after["by_country"]}
    was = {row["country"]: row["count"] for row in before["by_country"]}
    assert by_country["Testland"] - was.get("Testland", 0) == 3
    assert by_country["Otherland"] - was.get("Otherland", 0) == 1
    assert after["by_period"], "a series is returned once there are visits"
    assert after["bucket"] == "day"
    assert after["by_period"][-1]["count"] >= 4
    assert after["first_at"] and after["last_at"]

    visits = client.get("/api/v1/settings/guest-visits").json()
    row = next(item for item in visits if item["address"] == "198.51.100.72")
    assert (row["country"], row["city"], row["region"]) == ("Testland", "Betatown", "South")
    assert admin  # the admin session made these reads


def test_summary_is_admin_only(client: TestClient, db):
    _ensure_guest(db)
    guest = TestClient(client.app, base_url="https://testserver")
    guest.post("/api/v1/auth/login", json={"username": "guest", "password": "guest"})
    assert guest.get("/api/v1/settings/guest-visits/summary").status_code == 403


def test_private_and_unknown_addresses_have_a_label():
    place = geoip.lookup("10.1.2.3")
    assert place is not None and place["country"] == "Private network"
    assert geoip.lookup("not an address") is None
