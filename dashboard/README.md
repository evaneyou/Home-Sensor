# Dashboard

React + TypeScript single-page app for HomeNetWatch. It reads the server's REST API and
never talks to a Pi directly.

## Stack

React 19, Vite 7, TypeScript, TanStack Query, React Router, Recharts, Leaflet.

## Develop

```bash
npm ci
npm run dev          # http://127.0.0.1:3847
```

The API address comes from `VITE_API_BASE_URL` (default `http://127.0.0.1:8847`). Start the server
first; the root [README](../README.md) shows how.

## Build

```bash
npm run build        # type-check (tsc -b) then bundle to dist/
npm run preview      # serve the production build on port 3847
```

The Docker image builds the app and serves `dist/` with `serve`. `VITE_API_BASE_URL` is baked in
at build time, so rebuild the image if it changes.

## Screens

| Route | Screen |
|-------|--------|
| `/` | Overview: open-issue banner and remote agent by network health matrix |
| `/monitors/:id` | Remote agent detail: device health, networks, test status |
| `/monitors/:id/log` | Result log for a remote agent |
| `/tests/:id` | Test detail: stage waterfall, pass/fail strip, latency and loss charts |
| `/issues`, `/issues/:id` | Open and resolved issues |
| `/settings/onboarding` | Remote agent onboarding and tunnels |
| `/settings/internet-service` | Internet service checks |
| `/settings/web-services` | Web-service HTTP checks |

Viewers get a read-only UI; write controls are hidden.

## Layout

```
src/pages/        Route-level screens
src/components/   Shared UI (charts, map, dialogs, device panel)
src/api.ts        API client
src/types.ts      API types
```
