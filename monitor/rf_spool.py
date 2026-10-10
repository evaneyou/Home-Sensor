"""SQLite queue for airwave uploads. Five days, and at most 50 MB of payloads."""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

MAX_AGE_SECONDS = 5 * 24 * 60 * 60
MAX_BYTES = 50 * 1024 * 1024


def _connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS capture (id INTEGER PRIMARY KEY, created_at REAL NOT NULL, payload TEXT NOT NULL)"
    )
    return conn


def push(path: Path, payload: dict, now: float | None = None) -> None:
    moment = time.time() if now is None else now
    with _connect(path) as conn:
        conn.execute(
            "INSERT INTO capture (created_at, payload) VALUES (?, ?)",
            (moment, json.dumps(payload, separators=(",", ":"))),
        )
        trim(conn, moment)


def pending(path: Path) -> list[tuple[int, dict]]:
    if not path.exists():
        return []
    with _connect(path) as conn:
        rows = conn.execute("SELECT id, payload FROM capture ORDER BY id").fetchall()
    found = []
    for row_id, raw in rows:
        try:
            found.append((int(row_id), json.loads(raw)))
        except json.JSONDecodeError:
            continue
    return found


def drop(path: Path, row_id: int) -> None:
    with _connect(path) as conn:
        conn.execute("DELETE FROM capture WHERE id = ?", (row_id,))


def trim(conn: sqlite3.Connection, now: float) -> None:
    conn.execute("DELETE FROM capture WHERE created_at < ?", (now - MAX_AGE_SECONDS,))
    while True:
        total = conn.execute("SELECT COALESCE(SUM(LENGTH(payload)), 0) FROM capture").fetchone()[0]
        if total <= MAX_BYTES:
            return
        oldest = conn.execute("SELECT id FROM capture ORDER BY id LIMIT 1").fetchone()
        if oldest is None:
            return
        conn.execute("DELETE FROM capture WHERE id = ?", (oldest[0],))
