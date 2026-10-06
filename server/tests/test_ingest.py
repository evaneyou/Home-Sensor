from __future__ import annotations

import os
import uuid
from collections.abc import Generator
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg://hns:hns-dev-password@127.0.0.1:55432/hns",
)
os.environ.setdefault("SECRET_KEY", "test-secret")

from app.auth import hash_password  # noqa: E402
from app.db import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import (  # noqa: E402
    Group,
    Network,
    NetworkKind,
    Sensor,
    SensorStatus,
    Test,
    TestKind,
    TestResult,
)
from app.seed import _sensor_token  # noqa: E402


@pytest.fixture(scope="session")
def engine():
    url = os.environ["DATABASE_URL"]
    eng = create_engine(url, pool_pre_ping=True)
    with eng.connect() as conn:
        conn.execute(text("SELECT 1"))
    yield eng


@pytest.fixture
def db(engine) -> Generator[Session, None, None]:
    SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)
    session = SessionLocal()
    suffix = uuid.uuid4().hex[:8]
    group = Group(slug=f"test-home-{suffix}", name=f"Test Home {suffix}")
    session.add(group)
    session.flush()
    sensor = Sensor(
        group_id=group.id,
        slug=f"pi-test-{suffix}",
        name="Pi Test",
        token_hash=hash_password(_sensor_token(f"pi-test-{suffix}")),
        status=SensorStatus.online,
    )
    network = Network(
        group_id=group.id,
        slug="wan",
        name="WAN",
        kind=NetworkKind.wired,
    )
    session.add_all([sensor, network])
    session.flush()
    test = Test(
        sensor_id=sensor.id,
        network_id=network.id,
        slug="http-cloudflare",
        name="HTTP Cloudflare",
        kind=TestKind.http,
        target="https://1.1.1.1",
    )
    session.add(test)
    session.commit()

    # stash for cleanup / token
    session.info["sensor_slug"] = sensor.slug
    session.info["group_id"] = group.id

    def _override():
        try:
            yield session
        finally:
            pass

    app.dependency_overrides[get_db] = _override
    yield session
    app.dependency_overrides.clear()

    # Cleanup only this fixture's rows (do not wipe demo seed)
    session.execute(text("DELETE FROM test_results WHERE test_id IN (SELECT id FROM tests WHERE sensor_id IN (SELECT id FROM sensors WHERE group_id = :gid))"), {"gid": group.id})
    session.execute(text("DELETE FROM tests WHERE sensor_id IN (SELECT id FROM sensors WHERE group_id = :gid)"), {"gid": group.id})
    session.execute(text("DELETE FROM sensors WHERE group_id = :gid"), {"gid": group.id})
    session.execute(text("DELETE FROM networks WHERE group_id = :gid"), {"gid": group.id})
    session.execute(text("DELETE FROM groups WHERE id = :gid"), {"gid": group.id})
    session.commit()
    session.close()


@pytest.fixture
def client(db) -> TestClient:
    return TestClient(app)


@pytest.fixture
def sensor_token(db) -> str:
    return _sensor_token(db.info["sensor_slug"])


def _payload(result_id: str = "res-1") -> dict:
    now = datetime.now(timezone.utc)
    return {
        "results": [
            {
                "id": result_id,
                "test_slug": "http-cloudflare",
                "network_slug": "wan",
                "started_at": (now - timedelta(seconds=1)).isoformat(),
                "finished_at": now.isoformat(),
                "status": "ok",
                "stages": [
                    {"name": "dns", "duration_ms": 12.0, "status": "ok"},
                    {"name": "tcp", "duration_ms": 8.0, "status": "ok"},
                    {"name": "tls", "duration_ms": 40.0, "status": "ok"},
                ],
                "metrics": {"rtt_ms": 60.0, "loss_pct": 0.0},
            }
        ]
    }


def test_ingest_happy_path(client: TestClient, sensor_token: str):
    r = client.post(
        "/api/v1/ingest",
        json=_payload(f"happy-{uuid.uuid4().hex[:8]}"),
        headers={"Authorization": f"Bearer {sensor_token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accepted"] == 1
    assert body["duplicates"] == 0


def test_ingest_duplicate(client: TestClient, sensor_token: str):
    rid = f"dup-{uuid.uuid4().hex[:8]}"
    headers = {"Authorization": f"Bearer {sensor_token}"}
    r1 = client.post("/api/v1/ingest", json=_payload(rid), headers=headers)
    assert r1.status_code == 200
    assert r1.json()["accepted"] == 1

    r2 = client.post("/api/v1/ingest", json=_payload(rid), headers=headers)
    assert r2.status_code == 200
    body = r2.json()
    assert body["accepted"] == 0
    assert body["duplicates"] == 1


def test_healthz(client: TestClient):
    r = client.get("/api/v1/healthz")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


# Silence unused import
_ = TestResult
