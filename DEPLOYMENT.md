# Deployment Guide - MediaHunter React SPA

## Overview
MediaHunter serves a React Single Page Application (SPA) from Flask. This guide explains how to build and deploy the React frontend.

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

Flask automatically detects if `frontend-dist/` exists and serves it with:
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

## Flask React Detection

The Flask backend automatically detects the React build:

```python
# In src/mediahunter/main.py
REACT_BUILD_PATH = Path(__file__).resolve().parents[2] / "frontend-dist"
SERVE_REACT_SPA = REACT_BUILD_PATH.exists()
```

If `frontend-dist/` exists, Flask:
1. Serves React build as the primary UI
2. Routes all non-API requests to `index.html`
3. Enables React Router for client-side navigation

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

Flask provides a **404 error handler** that enables client-side routing:

```python
@app.errorhandler(404)
def e404(e):
    """For React SPA, serve index.html for non-API routes."""
    if SERVE_REACT_SPA and not request.path.startswith("/api/"):
        try:
            return app.send_static_file("index.html")
        except:
            pass
    return jsonify({"ok":False,"error":"Not found"}),404
```

This allows:
- Direct navigation to any route (e.g., `/setup`, `/login`, `/dashboard`)
- Browser refresh without errors
- Bookmarking specific pages
- React Router handling all URL updates

## Docker Deployment

### Single Container (Recommended)

```dockerfile
FROM node:20-alpine AS frontend-builder
WORKDIR /build
COPY frontend/ .
RUN npm install && npm run build

FROM python:3.13-slim
WORKDIR /app
COPY . .
COPY --from=frontend-builder /build/dist ./frontend-dist
RUN pip install -r requirements.txt
EXPOSE 7979
CMD ["python", "-m", "flask", "--app", "src.mediahunter.main", "run", "--host", "0.0.0.0"]
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
- Check Flask logs for `SERVE_REACT_SPA = True`

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
npm run test:run
```

### Local Testing
```bash
# Build frontend
cd frontend
npm run build && cd ..

# Run Flask
python3.13.exe -m flask --app src.mediahunter.main run

# Test all flows manually:
# 1. Navigate to http://localhost:7979/login
# 2. Test login flow
# 3. Navigate to /setup for setup wizard
# 4. Test dashboard controls
# 5. Test theme switching
```

## Performance Considerations

- React build output is minified (~50-100KB gzipped)
- Static files are served directly by Flask (efficient)
- API calls remain unchanged
- Theme system uses CSS variables (no additional load)
- Client-side routing eliminates full page reloads

## Next Steps

1. **Verify production build locally**
   ```bash
   npm run build
   python3.13.exe -m flask --app src.mediahunter.main run
   ```

2. **Run test suite**
   ```bash
   cd frontend
   npm run test:run
   ```

3. **Build Docker image and test**
   ```bash
   docker build -t mediahunter .
   docker run -p 7979:7979 mediahunter
   ```

4. **Deploy to server/cloud**
   - Push to container registry
   - Deploy with your orchestration platform
   - Ensure `frontend-dist/` is included in build

## Support

For issues or questions about the React migration:
- Check [TESTING.md](./frontend/TESTING.md) for test setup
- Review [vite.config.ts](./frontend/vite.config.ts) for build configuration
- Check [src/mediahunter/main.py](./src/mediahunter/main.py) for Flask SPA routing
