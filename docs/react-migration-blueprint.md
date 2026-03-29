# React Migration Blueprint (MediaHunter)

## Goal
Keep the React frontend and Python backend integration stable and fully tested.

## Current State (Verified)
- Backend app entry: src/mediahunter/main.py
- Current UI is React SPA served from `frontend-dist/` by Flask.
- Shared CSS/UI tokens:
  - static/theme-system.css
  - static/ui-primitives.css
  - static/auth-common.css
  - static/status-primitives.css
- API-first endpoints already exist and are sufficient for a staged migration.

## Recommended Frontend Target
Use Vite + React + TypeScript.

Proposed structure:

```text
frontend/
  package.json
  vite.config.ts
  tsconfig.json
  index.html
  src/
    main.tsx
    app/
      App.tsx
      router.tsx
      providers/
        AuthProvider.tsx
        ThemeProvider.tsx
        QueryProvider.tsx
    pages/
      DashboardPage.tsx
      SetupPage.tsx
      LoginPage.tsx
    components/
      layout/
      cards/
      forms/
      status/
      tables/
      modals/
    api/
      client.ts
      endpoints.ts
      types.ts
    styles/
      tokens.css
      base.css
      utilities.css
    hooks/
      useAuth.ts
      useCsrf.ts
      useStatePoll.ts
      useInstances.ts
      useConfig.ts
      useHistory.ts
```

Suggested libraries:
- react
- react-router-dom
- @tanstack/react-query
- zod
- axios (or fetch wrapper)
- vitest + @testing-library/react

## Route and Screen Mapping
Map Flask pages to React routes:
- / -> DashboardPage
- /setup -> SetupPage
- /login -> LoginPage

Keep Flask serving API routes under /api/* unchanged.

## API Contract Mapping
Primary backend file: src/mediahunter/main.py

Setup and auth:
- POST /api/setup/ping
- POST /api/setup/complete
- POST /api/setup/reset
- POST /logout

Runtime control/config:
- GET /api/state
- POST /api/control
- POST /api/config

Instances:
- GET /api/instances
- POST /api/instances
- PATCH /api/instances/{id}
- DELETE /api/instances/{id}
- GET /api/instances/{id}/ping

History:
- GET /api/history
- GET /api/history/stats
- POST /api/history/clear
- POST /api/history/clear/{id}

Timezone/Discord/Queue:
- GET /api/timezones
- POST /api/discord/test
- POST /api/discord/stats
- POST /api/queue/scan
- GET /api/queue/stats

## Backend Changes Needed for SPA Friendliness
Minimal, targeted improvements only:

1. API auth behavior consistency
- Current behavior can redirect/return mixed responses in some flows.
- For all /api/* unauthenticated requests, always return JSON 401.

2. CSRF ergonomics
- Keep current CSRF protection.
- Add one lightweight endpoint, for example GET /api/auth/csrf, returning token in JSON so React can bootstrap safely.
- Store token in memory and attach X-CSRF-Token on mutating requests.

3. Login API (optional but recommended)
- Add POST /api/auth/login and POST /api/auth/logout for SPA use.
- Keep existing /login and /logout for compatibility during migration.

4. Static serving for React build (if single-container deploy)
- Add Flask route(s) to serve frontend dist output and client-side routing fallback.

## CSS and Theme Migration Strategy
Do not redesign first. Port behavior first.

1. Move existing tokens from static/theme-system.css into frontend/src/styles/tokens.css.
2. Port primitive classes from static/ui-primitives.css and static/status-primitives.css.
3. Port auth styles from static/auth-common.css.
4. Keep theme names unchanged:
- system
- github-inspired
- discord-inspired
- plex-inspired
5. Ensure theme persistence uses existing backend config fields.

## State and Data Flow Design
- React Query for all server state and polling.
- Central API client with:
  - credentials: include
  - CSRF header injection for POST/PATCH/DELETE
  - uniform error shape handling
- Polling:
  - /api/state every 2-5 seconds on Dashboard
  - pause polling when tab hidden

## Incremental Migration Plan (Low Risk)

Phase 1: Bootstrap frontend project
- Create frontend app and base routing.
- Add API client + CSRF plumbing.
- Add build scripts and lint/test scripts.

Phase 2: Build Dashboard in React
- Implement read-only dashboard from /api/state and /api/history.
- Match current visual tokens and status cards.

Phase 3: Build Setup flow
- Port setup wizard UI and validation.
- Use /api/setup/ping and /api/setup/complete.

Phase 4: Build Login/Auth flow
- Implement SPA login/logout flow.
- Keep compatibility with existing session cookie behavior.

Phase 5: Feature parity and cleanup
- Port all controls (instances, config, queue scan, discord test, history clear).
- Add frontend tests for critical flows.

Phase 6: Cutover
- Serve React build by default.
- Keep Flask non-UI API routes stable and backward compatible.

## Suggested Build/Run Integration
Root-level scripts (example):

```text
scripts/
  dev-frontend.ps1
  build-frontend.ps1
```

Add VS Code task candidates:
- Frontend: install deps
- Frontend: dev server
- Frontend: build
- Full stack: backend + frontend dev

Docker options:
- Option A (recommended): multi-stage build, copy frontend dist into Flask static hosting path.
- Option B: separate frontend container behind reverse proxy.

## Testing Plan
1. API contract tests remain on backend.
2. Frontend unit tests for components/hooks.
3. Integration tests for:
- login/logout
- setup complete
- start/stop/run_now
- instance CRUD
- config save
- history clear
- queue scan
4. Visual smoke checks for all themes.

## Rollback Plan
- Rebuild `frontend-dist/` from the current `frontend/` source and redeploy backend.
- If issues occur, roll back to a previously known-good application image or commit.

## Rough Effort
- MVP parity (no redesign): 1-2 weeks
- Production-ready with tests/polish: 2-4 weeks
- Additional UX redesign: +1-2 weeks

## First 5 Concrete Tasks
1. Scaffold frontend Vite React TypeScript app under frontend.
2. Implement typed API client with credentials + CSRF header support.
3. Build DashboardPage from /api/state with polling.
4. Port theme token CSS and wire theme switching.
5. Add a Flask config flag and route to serve React build in non-dev mode.
