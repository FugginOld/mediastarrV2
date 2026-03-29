# frontend

React + TypeScript UI scaffold for MediaHunter.

## Prerequisites
- Node.js 20+
- npm (or pnpm/yarn)

## Install and run

```bash
npm install
npm run dev
```

Dev server default: http://localhost:5173

## Build and test

```bash
npm run verify
```

This runs the production build and the frontend test suite (`build` + `test:run`).

## Backend + SPA smoke check

From repo root:

```bash
powershell -ExecutionPolicy Bypass -File scripts/react-spa-smoke.ps1
```

This validates core SPA routes, API availability, and built asset delivery.

## Notes
- Backend API remains in src/mediahunter/main.py
- This is Phase 1 scaffold (routing + API client + providers)
- Theme tokens are sourced from frontend/src/styles/theme-system.css (ported from static/theme-system.css)
- Selected theme is persisted in localStorage (key: mh-theme)
