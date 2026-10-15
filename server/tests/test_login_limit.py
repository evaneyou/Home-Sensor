from fastapi.testclient import TestClient

from app.auth import LOGIN_FAILURE_LIMIT, login_failures


def test_a_missing_name_and_a_wrong_password_look_the_same(client: TestClient):
    missing = client.post("/api/v1/auth/login", json={"username": "nobody-xyz", "password": "wrong-password"})
    wrong = client.post("/api/v1/auth/login", json={"username": "admin", "password": "wrong-password"})
    assert missing.status_code == 401
    assert wrong.status_code == 401
    assert missing.json()["detail"] == wrong.json()["detail"] == "Invalid credentials"


def test_failures_from_one_address_stop_being_accepted(client: TestClient):
    login_failures.limit = 3
    for _ in range(2):
        denied = client.post("/api/v1/auth/login", json={"username": "admin", "password": "nope"})
        assert denied.status_code == 401
    blocked = client.post("/api/v1/auth/login", json={"username": "nobody-xyz", "password": "nope"})
    assert blocked.status_code == 429
    still = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin-change-me"})
    assert still.status_code == 429
    login_failures.clear()
    login_failures.limit = LOGIN_FAILURE_LIMIT
    accepted = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin-change-me"})
    assert accepted.status_code == 200, accepted.text
