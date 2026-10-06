# Home Network Sensor

UXI-style home network monitoring. Sensors on a Raspberry Pi (or Linux PC) run staged connectivity tests and push results to a FastAPI + Postgres server. The React dashboard reads those APIs — it never talks to the Pi.

This repo ships the **dashboard-first slice**: thin server, idempotent dummy seed (~30 days of synthetic results), and an ops UI (Overview matrix, Sensor/Test detail with stage waterfall, Issues). The real sensor agent comes later.

## Quick start

```bash
cp .env.example .env
docker compose up --build -d
# wait for health, then seed
docker compose exec server python -m app.seed
```

Open the dashboard: [http://127.0.0.1:3847](http://127.0.0.1:3847)

API health: [http://127.0.0.1:8847/api/v1/healthz](http://127.0.0.1:8847/api/v1/healthz)

### Bootstrap login

| Role | Username | Password |
|------|----------|----------|
| Admin | `admin` | `admin-change-me` |
| Viewer | `viewer` | `viewer-change-me` |

Change these via env (`BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_VIEWER_PASSWORD`) before any real deployment.

## Ports

| Service | Host port |
|---------|-----------|
| Dashboard (Vite) | `3847` |
| API (FastAPI) | `8847` |
| Postgres | `55432` |

## Local development (without rebuilding images)

```bash
# DB only
docker compose up -d db

# Server
cd server && uv sync && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8847

# Seed
cd server && uv run python -m app.seed

# Dashboard
cd dashboard && npm install && npm run dev -- --host 0.0.0.0 --port 3847
```

## Tests

```bash
cd server && uv run pytest -q
```

Ingest happy-path and duplicate-id cases are covered at minimum.

## Layout

```
SPEC.md                 Product / architecture source of truth
server/                 FastAPI + Alembic + seed + pytest
dashboard/              React + Vite + TS + Recharts
docker-compose.yml      db + server + dashboard
```

## What’s next

- Phase 1: enrollment / config ETag, issue engine hardening
- Phase 2: Linux sensor agent on the Pi
- Phase 3: wireless / RF pages
- Phase 4: same Compose stack on a small VPS

See [SPEC.md](./SPEC.md) for the full phase map.
