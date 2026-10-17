"""The guest check must not hold up the API: it runs before the endpoint and is cached."""

from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from app import redact as redact_mod
from app.models import User
from tests.conftest import login
from tests.test_guest_login import _ensure_guest


def test_the_guest_lookup_is_cached(db, monkeypatch):
    _ensure_guest(db)
    guest = db.scalar(select(User).where(User.username == "guest"))
    opened = []
    from app import db as db_module

    original = db_module.SessionLocal

    def counting():
        opened.append(1)
        return original()

    monkeypatch.setattr(db_module, "SessionLocal", counting)
    redact_mod._guest_cache.clear()
    assert redact_mod._user_is_guest(guest.id) is True
    assert redact_mod._user_is_guest(guest.id) is True
    assert redact_mod._user_is_guest(guest.id) is True
    assert len(opened) == 1, "repeat checks inside the cache window must not open a connection"
    assert redact_mod._user_is_guest(uuid4()) is False


def test_the_check_runs_before_the_endpoint_takes_its_connection(client: TestClient, db, monkeypatch):
    _ensure_guest(db)
    order: list[str] = []
    real_check = redact_mod._request_is_guest
    monkeypatch.setattr(redact_mod, "_request_is_guest", lambda request: (order.append("check"), real_check(request))[1])

    from app.db import get_db
    from app.main import app

    def watched_db():
        order.append("endpoint")
        yield from get_db()

    app.dependency_overrides[get_db] = watched_db
    try:
        guest = TestClient(app, base_url="https://testserver")
        login(guest, "guest", "guest")
        order.clear()
        assert guest.get("/api/v1/auth/me").status_code == 200
    finally:
        app.dependency_overrides.pop(get_db, None)
    assert order.index("check") < order.index("endpoint") if "endpoint" in order else order == ["check"]
