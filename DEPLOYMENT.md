# Deployment Guide - MediaHunter React SPA

## Overview
MediaHunter serves a React Single Page Application (SPA) from Flask using assets from `frontend-dist/`. This guide explains the current build and deployment flow.

## Architecture

### Development Mode
- React dev server runs on `http://localhost:5173`
- Flask API backend runs on `http://localhost:7979`
- React dev server proxies `/api/*` to Flask

### Production Mode
- Frontend built to `frontend-dist/` folder
- Flask serves React build files from `frontend-dist/`
- All routing handled by Flask with client-side routing fallback
- Single container deployment

## Build Steps

### 1. Install Frontend Dependencies
```bash
cd frontend
npm install
```

### 2. Build React Frontend
```bash
npm run build
```

This creates:
- `frontend-dist/` folder with optimized build
- Output directory configured in `vite.config.ts`
- Ready to be served by Flask

### 3. Start Flask Backend
```bash
# In project root
python3.13.exe -m flask --app src.mediahunter.main run --host 127.0.0.1 --port 7979
```

Flask serves the UI from `frontend-dist/` and handles:
- Static files (JS, CSS, assets) from the build folder
- API routes from `/api/*` (preserved for backend)
- Catch-all route that serves `index.html` for client-side routing

## File Structure After Build

```
MediaHunter/
├── frontend-dist/           # ← Generated React build
│   ├── index.html          # Entry point
│   ├── assets/
│   │   ├── app-*.js
│   │   ├── app-*.css
│   │   └── ...
│   └── (other assets)
├── frontend/               # Source code
├── src/mediahunter/main.py # Flask backend
├── static/                 # Static assets (CSS, etc)
└── ...
```

## Flask SPA Serving

The backend serves the React index and built assets from `frontend-dist/`.

Key behavior:
1. Serves React build as the primary UI.
2. Routes all non-API requests to `index.html`.
3. Preserves `/api/*` for backend endpoints.
4. Serves `/assets/*` from `frontend-dist/assets/`.

## Routing Behavior

### With React Build (Production)
```
GET /              → index.html (React Router takes over)
GET /setup         → index.html (React handles routing)
GET /login         → index.html
GET /api/state     → Flask API endpoint
GET /static/...    → Static assets
```

## Development Workflow

### Option 1: React Dev Server (Recommended)
```bash
# Terminal 1: Start Flask backend
cd MediaHunter
python3.13.exe -m flask --app src.mediahunter.main run --host 127.0.0.1 --port 7979

# Terminal 2: Start React dev server
cd frontend
npm run dev

# Access at http://localhost:5173
```

Dev server has:
- Hot module reload (HMR)
- Fast refresh
- API proxy to Flask
- Detailed error messages

### Option 2: Production Build Locally
```bash
# Build React
cd frontend
npm run build

# Run Flask (which now serves React build)
cd ..
python3.13.exe -m flask --app src.mediahunter.main run

# Access at http://localhost:7979 (same as API)
```

## Client-Side Routing

Flask provides non-API fallback behavior that returns the SPA index for unknown frontend routes.

This allows:
- Direct navigation to any route (e.g., `/setup`, `/login`, `/dashboard`)
- Browser refresh without errors
- Bookmarking specific pages
- React Router handling all URL updates

## Docker Deployment

### Single Container (Current)

Current Dockerfile expects `frontend-dist/` to already exist in the repository context and copies it directly.

```dockerfile
COPY frontend-dist/ ./frontend-dist/
```

**Build:**
```bash
docker build -t mediahunter:latest .
```

**Run:**
```bash
docker run -p 7979:7979 mediahunter:latest
```

## Troubleshooting

### React build not being served
- Verify `frontend-dist/` exists in project root
- Restart Flask to detect the new build
- Ensure `frontend-dist/index.html` exists and contains the React root element

### Routes returning 404 after refresh
- Ensure Flask 404 handler is configured
- Check that `SERVE_REACT_SPA` is True
- Verify `frontend-dist/index.html` exists

### API calls return 401 after login
- Check that `/api/auth/csrf` is accessible
- Verify CSRF token is being sent in request headers
- Check session cookies are being set correctly

### Static assets not loading
- Check `frontend-dist/assets/` folder exists
- Verify Vite build output path in `vite.config.ts`
- Check browser Network tab for asset URLs

## React Build Requirement

`frontend-dist/` must be present for UI routes to load.

```bash
# Build React bundle
cd frontend
npm run build

# Start backend
cd ..
python3.13.exe -m flask --app src.mediahunter.main run
```

## Testing Before Deployment

### Type Checking
```bash
cd frontend
npm run typecheck
```

### Building
```bash
cd frontend
npm run build
```

### Testing
```bash
cd frontend
npm run verify
```

### Local Testing
```bash
# Build frontend
cd frontend
npm run verify && cd ..

# Run Flask
python3.13.exe -m flask --app src.mediahunter.main run

# Test all flows manually:
# 1. Navigate to http://localhost:7979/login
# 2. Test login flow
# 3. Navigate to /setup for setup wizard
# 4. Test dashboard controls
# 5. Test theme switching
# 6. Run SPA smoke checks
#    powershell -ExecutionPolicy Bypass -File scripts/react-spa-smoke.ps1
```

## Performance Considerations

- React build output is minified (~50-100KB gzipped)
- Static files are served directly by Flask (efficient)
- API calls remain unchanged
- Theme system uses CSS variables (no additional load)
- Client-side routing eliminates full page reloads

## Next Steps

1. **Verify frontend build + tests**
   ```bash
   cd frontend
   npm run verify
   ```

2. **Run backend + SPA smoke checks**
   ```bash
   cd ..
   python3.13.exe -m flask --app src.mediahunter.main run
   powershell -ExecutionPolicy Bypass -File scripts/react-spa-smoke.ps1
   ```

3. **Build Docker image and test**
   ```bash
   docker build -t mediahunter .
   docker run -p 7979:7979 mediahunter
   ```

4. **Deploy to server/cloud**
   - Push to container registry
   - Deploy with your orchestration platform
   - Ensure `frontend-dist/` is included in image build context

## Support

For issues or questions about the React runtime:
- Check [TESTING.md](./frontend/TESTING.md) for test setup
- Review [vite.config.ts](./frontend/vite.config.ts) for build configuration
- Check [src/mediahunter/main.py](./src/mediahunter/main.py) for Flask SPA routing
