# HNS Server

FastAPI central server for Home Network Sensor.

```bash
uv sync --extra dev
uv run alembic upgrade head
uv run python -m app.seed
uv run uvicorn app.main:app --reload --port 8847
uv run pytest -q
```
