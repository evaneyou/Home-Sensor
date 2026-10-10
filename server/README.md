# Server

FastAPI central server for HomeNetWatch (package `hns-server`). It stores results in
Postgres, runs enrollment and the WireGuard tunnel hub, and serves the API the dashboard reads.
The interactive API docs are at `/docs` when the server is running.

The package version is in `pyproject.toml` and is reported as the API version.

## Run

```bash
uv sync --extra dev
uv run alembic upgrade head
uv run python -m app.seed
uv run uvicorn app.main:app --reload --port 8847
uv run pytest -q
```

With the compose stack running, `../scripts/test-server.sh` runs the tests in a container against a separate `hns_test` database.

Remote agents enroll over the HTTPS port 8848 (`agent-api` in compose) and pin its key. Print the pins for the Pi package with:

```bash
docker compose exec agent-api python -m app.tls pins
```

Keep a copy of `backup-key.pem` from the `servertls` volume somewhere off the server. It is the backup pin, so you can switch to it without reinstalling every Pi.
