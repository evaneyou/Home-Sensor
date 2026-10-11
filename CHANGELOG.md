# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The repository version lives in [`VERSION`](./VERSION). The Pi agent in `monitor/`
reports its own `AGENT_VERSION` so it can be updated independently of the server.

## [Unreleased]

### Fixed

- Pi agent iperf3 check: the download test was often cut off by the server ("Connection reset by
  peer") right after the upload test, so it reported 0 Mbps. The agent now pauses between the two
  directions and retries a direction that fails this way, and the result message shows iperf3's
  real error instead of the last line of its JSON output.

### Added

- Open-source project files: `LICENSE` (MIT), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
  `SECURITY.md`, issue and pull request templates, and Dependabot configuration.
- GitHub Actions CI for the server tests and the dashboard build.
- `VERSION` file and `scripts/bump-version.sh` to keep the server and dashboard versions in step.
- `monitor/README.md` with Pi agent install and enrollment steps.
- `.editorconfig` and `.gitattributes` (shell scripts always use LF line endings).

- Production deployment: `docker-compose.prod.yml` (Caddy with automatic HTTPS, internal ports closed),
  `deploy/Caddyfile`, `scripts/backup.sh`, and `docs/deploy-oracle.md`.
- `python -m app.seed --users-only` creates only the admin and viewer accounts, and refuses default passwords.

### Changed

- Rewrote the root `README.md` and replaced the Vite template `dashboard/README.md`.
- The API now reports the installed package version instead of a hard-coded string, and its
  title is "HomeNetWatch".
- Added package metadata (license, URLs, classifiers) to `server/pyproject.toml` and `dashboard/package.json`.
- Corrected `SPEC.md`: iperf3 runs against the server over the tunnel, not a public host.

### Fixed

- `server/uv.lock` was missing the `cryptography` dependency; regenerated.
- `test_health_assigns_iperf_and_web_services` expected the `wan` network, but link tests are
  assigned to `wired`.

## [0.1.0] - 2026-10-09

First tagged baseline of the project.

### Added

- **Server:** FastAPI + Postgres API with cookie-session auth (admin and viewer roles),
  Alembic migrations, idempotent demo seed, ingest endpoint, issue tracking, and
  data retention (raw, hourly, then daily rollups).
- **Enrollment:** signed remote-agent check-in with a pinned TLS key on port 8848,
  installer codes, admin approval, and WireGuard tunnel provisioning.
- **Dashboard:** React + Vite + TypeScript UI with overview matrix, remote-agent detail,
  test detail with stage waterfall, issues, Wi-Fi scans, internet path view, and settings.
- **Pi agent:** LAN setup page, device-health reporting, and HTTP, ping, MTR, and iperf3 checks.
- Docker Compose stack: Postgres, server, agent API, WireGuard hub, and dashboard.

[Unreleased]: https://github.com/evaneyou/Home-Sensor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/evaneyou/Home-Sensor/releases/tag/v0.1.0
