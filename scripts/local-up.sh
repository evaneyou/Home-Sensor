#!/usr/bin/env bash
# Boot the dashboard-first stack on your PC (Docker required).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or not on PATH."
  echo "Install Docker Desktop: https://docs.docker.com/get-docker/"
  echo "Then re-run: ./scripts/local-up.sh"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required (docker compose ...)."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running. Start Docker Desktop (or dockerd), then retry."
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

echo "Building and starting db + server + dashboard..."
docker compose up --build -d

echo "Waiting for API health..."
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:8847/api/v1/healthz >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if ! curl -sf http://127.0.0.1:8847/api/v1/healthz >/dev/null 2>&1; then
  echo "API did not become healthy. Check: docker compose logs server"
  exit 1
fi

echo "Seeding demo data (idempotent)..."
docker compose exec -T server python -m app.seed

cat <<'EOF'

Ready.

  Dashboard: http://127.0.0.1:3847
  API:       http://127.0.0.1:8847/api/v1/healthz
  Login:     admin / admin-change-me

Stop with: docker compose down
EOF
