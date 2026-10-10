# Home Network Sensor

UXI-style home network monitoring. Remote agents on a Raspberry Pi (or Linux PC) run staged connectivity tests and push results to a FastAPI + Postgres server. The React dashboard reads those APIs — it never talks to the Pi.

This repo ships the dashboard, the server, and a Pi package in `monitor/`. The package enrolls a device and posts its health. Staged tests on the Pi come later.

## Install on your PC (recommended)

Cloud agent links to `127.0.0.1` only work inside that VM. To use the app in your normal browser, run Compose **locally**.

### 1. Install Docker

- **macOS / Windows:** [Docker Desktop](https://docs.docker.com/get-docker/) — install, start it, wait until it says running.
- **Ubuntu/Debian:**

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker "$USER"   # then log out/in
sudo systemctl enable --now docker
```

Confirm: `docker compose version` and `docker info`.

### 2. Get this repo

Create a real Git repo from the New Project “Create repo” pill if you have not yet, then clone and check out:

```bash
git clone <your-repo-url>
cd <repo>
git checkout cursor/dashboard-first-slice-7ea9
```

### 3. Start + seed

```bash
chmod +x scripts/local-up.sh
./scripts/local-up.sh
```

Or manually:

```bash
cp .env.example .env
docker compose up --build -d
docker compose exec server python -m app.seed
```

Open **http://127.0.0.1:3847** → login `admin` / `admin-change-me`.

## Quick start (already have Docker)

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
- Phase 2: Linux remote agent on the Pi
- Phase 3: Airwaves. A second radio adapter scans when one is present. The link adapter scans only when it is the only radio, at most every 15 minutes, and never during a test.
- Phase 4: same Compose stack on a small VPS

See [SPEC.md](./SPEC.md) for the full phase map.
