# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The repository version lives in [`VERSION`](./VERSION). The Pi agent in `monitor/`
reports its own `AGENT_VERSION` so it can be updated independently of the server.

## [Unreleased]

### Changed

- Sign-in limits attempts per address and always checks the password hash, so a missing name is not faster than a wrong password.
- A trace name is resolved on the server, and refused when it does not point at a public address.
- Health cleanup, the monitor page, and metrics queries stay bounded to the monitor or a capped series.
- Admin changes send the same CSRF token that delete and trace already required.
- The connection chart has more room above and below so the bottom row is not clipped.
- The landing page matches the live copy, including the decisions and the Telegram roadmap item.
- A guest sees each letter and digit of an identifying field replaced with `#`, so an address still has the shape of an address. The measurements stay visible.
- Auth, settings, agent check-in, and dashboard readings each have their own API module. The paths are unchanged.
- The Pi agent is split into enrollment, health, radio, and the test scheduler. The setup page stays in `agent.py`. The agent reports version 0.6.1.
- The internet path screen keeps the service grid in one file and the detail charts in another.
- The Pi agent reports version 0.6.0 (on-demand host traces, and traces bound to a link run over IPv4). Install it on each Pi to update.
- `monitor/update.sh` replaces the agent code and restarts `monitor`. Enrollment, tunnels, and `/etc/monitor` stay as they are.

### Added

- **Guest visits reporting:** sign-ins are stored in their own `guest_visits` table with the place saved at sign-in, and kept for a year (the retention job deletes older rows). The page has 7 day, 30 day, 90 day and 1 year ranges, totals with the change against the previous period, a chart per day (per week for a year), top countries and cities, and a latest list that scrolls and loads more. Visits from an address a Pi reports as its own public address are not stored or shown; existing visits were copied across without them. Migration `0036_guest_visits`.
- **Network Test (stress run):** pick tests (voice call, video conference, remote desktop, market data, round-trip probe, throughput flood) with their options and as many sessions of each as you like, choose Wired, Wi-Fi or both and a run length of up to 5 minutes, and press Run Stress Test. Live charts show throughput, round trip, jitter and loss per link, and a session list shows each session. Tests can be added and sessions removed while it runs, and Stop all ends it. Traffic stays on the physical NIC and the public address; only the control channel uses WireGuard. TCP is not offered because only UDP 8998 is published. The Pi agent reports version 0.7.0 and must be updated to run stress sessions. Scheduling a run and the finished-run report are the next step.
- **Airwaves redesign:** a compact header (agent, refresh, scan), one row of tabs, one-line band stats, a fixed-height alerts list that scrolls, pill filters with search, one-line network rows with signal bars, and a channel graph that keeps the strongest four networks with a See all button. A phone gets a segmented tab bar; a wide screen gets an underline bar, a three-column overview and a two-column channel graph.
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
