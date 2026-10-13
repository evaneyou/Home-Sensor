# HomeNetWatch: notes for Claude Code

Home network monitoring. Pi remote agents push test results to a FastAPI + Postgres server. A React dashboard reads the server's API. `SPEC.md` is the source of truth for architecture, API shape and phases; read it before larger changes.

## Architecture rules

- Remote agent -> server (ingest). Browser -> dashboard -> server (read). The remote agent never talks to the dashboard.
- Stack: FastAPI, Postgres, React + Vite + TypeScript, TanStack Query, Recharts. No Grafana.
- Prefer thin APIs. Charts use Recharts only.
- Auth is cookie based with CSRF. Roles are enforced **server-side**; never rely on the UI to hide or block something.
- Out of scope unless asked: staged test runner, webhooks, full enrollment ETag matrix, Playwright journeys, Grafana.

## Layout

- `server/`: FastAPI app (`app/`), Alembic migrations (`alembic/`), seed, tests (`tests/`)
- `dashboard/`: Vite React UI (`src/`)
- `monitor/`: Raspberry Pi agent package (setup page, enrollment, checks, install scripts)
- `deploy/`, `docker-compose.yml`, `docker-compose.prod.yml`, `wireguard/`: stack and production deployment
- `docs/deploy-oracle.md`: production deployment guide
- `scripts/`: backup, local-up, test-server, bump-version

## Commands

```bash
cp .env.example .env
docker compose up -d db                      # Postgres on 127.0.0.1:55432

cd server
uv sync --extra dev
uv run alembic upgrade head
uv run python -m app.seed                    # demo seed, dev only
uv run pytest -q                             # server tests
uv run uvicorn app.main:app --reload --port 8847

./scripts/test-server.sh                     # same tests in a throwaway container (hns_test database)

cd dashboard
npm ci
npm run dev                                  # http://127.0.0.1:3847
npm run build                                # type-check + production build (CI runs this)
```

CI (`.github/workflows/ci.yml`) runs server tests, the dashboard build and `docker compose config`. Run the same checks before opening a PR.

## Conventions

- Conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`.
- Add or update tests for any behavior change. Server tests live in `server/tests/`.
- Update `README.md`, `SPEC.md` or the component README when behavior changes.
- New database changes need an Alembic migration. Check that dev and prod would end at the same head.
- Seeds are idempotent. Production is seeded with `python -m app.seed --users-only`, never the demo seed.

## Ground rules

- Work on a feature branch (for example `feat/enrollment-ui`) and open a PR. Do not push to `main`; merge only after review.
- The production server runs the live stack from its own checkout on `main`. Never edit that folder by hand. Develop in a separate dev folder, deploy by merging to `main`, taking a backup first (`./scripts/backup.sh`), then `git pull && docker compose up --build -d`.
- **This repository is public.** Never commit or paste secrets, device keys, installer codes, `.env` values, WireGuard or TLS keys, real home IP addresses, device MACs, SSIDs or location data. Use `.env.example` for placeholders.
- Keep dashboard changes shared-component safe: the Home page must not change unless the task says so.
- Do not copy dev data (users, audit events, installer codes, check-ins) into production.
