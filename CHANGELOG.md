# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The repository version lives in [`VERSION`](./VERSION). The Pi agent in `monitor/`
reports its own `AGENT_VERSION` so it can be updated independently of the server.

## [Unreleased]

### Added

- **Guest visits dashboard:** a summary (sign-ins, different addresses, countries, busiest day), sign-ins per day, sign-ins by country, and a country and city for each visit, looked up in a local DB-IP City Lite file. Install it with `scripts/update-geoip.sh`.

## [0.2.0] - 2026-10-14

### Added

- **Network Path Diagram:** an animated React Flow diagram of the path each test takes (direct, or signalling through the tunnel), with hover details, zoom, one merged "Web services" group, and steady-speed pulses that stay visible on dashed lines. The Internet Connection overview diagram is live and drawn the same way.
- **Path View:** the Network path and BGP comparison are React Flow diagrams that fit a phone. The latency chart and hop detail are folded into the path: each network box is selectable, hops show a latency bar, and details sit below.
- **Trace any host:** type a host name or public IP into Path View and the agent traces to it on demand over the chosen link. Admin only, private addresses refused (migration 0034).
- **Zoom:** the real-time application health charts zoom by drag, wheel and double-click.
- Agent reports its Ethernet, Wi-Fi and radio interface names and a real LAN address.
- `scripts/deploy.sh`, which recreates `rtnp` whenever `wireguard` is recreated.
- **Security headers:** HSTS (`HSTS_MAX_AGE`, starting at 300 seconds), an enforced Content-Security-Policy and a Permissions-Policy on every response, set by Caddy. See the Security headers section of `docs/deploy.md`.
- **Landing page:** `site/`, served at `/welcome/` and on the bare domain and `www`: a short description of the app, documents, an author bio and a one-click read-only guest demo.

### Changed

- Path View and the Remote agent pages use a compact layout: one summary line, controls on one row, and the time range on the Web, Wired and Wi-Fi row.
- "File Transfer" is now "Bandwidth Test". The product is named HomeNetWatch.
- A shared monitor tab bar on every monitor page. Home shows Web first and no longer has the Internet chip.
- Several flows can run at once on a link; Wi-Fi measurements are bound to the Wi-Fi interface.
- Rows that open a detail view (Internet Connection and the real-time application checks) show a chevron and a hover highlight. Real-Time Application Health is in its own box.
- A guest who tries a host trace gets the read-only notice instead of an error.

### Removed

- draw.io, the web-service MTR checks, and the Video call check (migration 0032).

## [0.1.0] - 2026-10-13

First release.

### Added

- **Server:** FastAPI and Postgres, cookie auth for admin and viewer, enrollment with a pinned TLS key, WireGuard tunnels, and retention of raw results.
- **Dashboard:** overview, remote-agent detail, internet path with public traceroute hops and AS numbers, airwaves, issues, and settings. Every page except Home uses the compact layout.
- **Pi agent:** LAN setup page, device health, and HTTP, ping, MTR, Bandwidth Test, and video-call checks.
- **Bandwidth Test:** Rust LibreSpeed backend. The agent calls `/backend/garbage` and `/backend/empty`.
- **Airwaves:** Wi-Fi scans and Kismet capture, with trusted access points and nearby clients.

### Fixed

- The recent normal adapts when a path stays slower and the latest samples agree, so a moved server does not stay "slow" forever.
- A silent last hop on the path trace no longer turns the home tiles red by itself.

### Removed

- iperf3 bandwidth checks. Bandwidth Test is the throughput check.

[0.1.0]: https://github.com/evaneyou/homenetwatch/releases/tag/v0.1.0
