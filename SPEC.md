# Home Network Sensor — SPEC v2

Ops-style UXI-inspired monitoring for a home LAN: Raspberry Pi (or Linux PC) sensors run staged connectivity tests and push results to a central FastAPI + Postgres server. A React dashboard reads those APIs only — the sensor never talks to the browser.

## Topology

| Piece | Where | Role |
|---|---|---|
| **Sensor agent** | Home Pi / Linux PC | Runs tests, pulls config, pushes ingest (Bearer). Offline SQLite spool. |
| **Central server** | PC now → cloud later | Enrollment, config, ingest, issues, read APIs. FastAPI + Postgres. |
| **Dashboard** | Served with server | React UI; cookie auth; reads APIs only. |

```
Sensor ──pull config / push ingest──▶ Server ◀──read APIs── Dashboard ◀── Browser
```

The Pi stays on the LAN and reaches the server over outbound HTTPS. Only server + dashboard move to the cloud.

## Stack

- **Server:** FastAPI, SQLAlchemy, Alembic, Postgres 16, cookie session auth (`admin` / `viewer`)
- **Dashboard:** React + Vite + TypeScript, TanStack Query, **Recharts** (no Grafana in this product slice)
- **Dev:** Docker Compose (db + server + dashboard)

## Data model (core)

- `groups` — tenancy / home site
- `sensors` — enrolled Pi agents (`pi-living-room`, …)
- `networks` — wired / Wi-Fi targets under a group
- `tests` — `http`, `dns`, `ping`, `wifi`, … bound to sensor+network
- `test_results` — staged timings + metrics + status (`ok` / `degraded` / `fail`)
- `users` — admin/viewer with password hash
- `issues` — open/resolved problems with optional `root_cause_stage`

## API surface (dashboard-first)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/healthz` | Liveness |
| `POST` | `/api/v1/auth/login` | Cookie session |
| `POST` | `/api/v1/auth/logout` | Clear cookie |
| `GET` | `/api/v1/auth/me` | Current user |
| `POST` | `/api/v1/ingest` | Sensor Bearer ingest (idempotent by result id) |
| `GET` | `/api/v1/summary` | Sensor × network health matrix + open issues |
| `GET` | `/api/v1/results` | Filtered test results |
| `GET` | `/api/v1/metrics` | Time-series metrics for charts |
| `GET` | `/api/v1/issues` | Issue list |
| `GET` | `/api/v1/issues/{id}` | Issue detail |

Enrollment / config ETag matrix and webhooks are deferred.

## Dashboard screens (this slice)

1. **Overview** — open-issue severity banner; sensor × network health matrix; last test time
2. **Sensor detail** — per-network tabs; test status; recent results
3. **Test detail** — range picker; stage waterfall; pass/fail strip; RTT/loss charts
4. **Issues** — open/resolved list + detail (`root_cause_stage`, recent failures)

Loading / empty states required. Dark/light theme when cheap. Viewer role hides write controls.

## Phases

| Phase | Scope |
|---|---|
| **0 — Dashboard-first (this repo slice)** | Thin server + seed + core UI on Compose. No Pi required. |
| **1 — Server hardening** | Full enrollment, config ETag, auth polish, issue engine |
| **2 — Sensor agent** | Linux agent on Pi: staged tests, spool, Bearer ingest |
| **3 — Wireless / RF** | WiFiman-style spectrum, channel congestion, roam markers (full wireless later) |
| **4 — Cloud** | Same Compose on a small VPS (Hetzner CX / DO droplet) + TLS |

## Out of scope for this slice

Sensor agent binary, Grafana, Wi-Fi/RF pages, webhooks, full enrollment ETag test matrix, Playwright journeys.

## Design principles

- Health color is the primary signal (green / amber / red).
- Stage waterfall on Test detail is the distinctive UXI-like moment.
- Charts live in the React app via Recharts — not an external Grafana stack.
- Dense but readable ops UI; real copy; no marketing fluff inside the product.
