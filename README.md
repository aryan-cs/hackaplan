# Hackaplan

Hackaplan is a hackathon brainstorming web tool focused on one MVP feature: fetching and exploring past Devpost winners for a given hackathon URL.

## Stack

- Frontend: React + Vite (`frontend/`)
- Backend tools: FastAPI + SQLite + scraper scripts (`backend/`) for generating snapshots
- Runtime site mode: GitHub Pages static app + snapshot JSON shards (`frontend/public/snapshots`)

## Features Implemented

- Search-first frontend UX:
  - centered Google-style search screen
  - autocomplete suggestions from snapshot cache, with Devpost API browser fallback
  - image-grid winner cards after selection
  - snapshot-driven rendering (no runtime writes)
- Devpost scraping pipeline:
  - URL normalization/validation
  - Hackathon page fetch + gallery discovery
  - Project gallery crawl (pagination)
  - Winner filtering
  - Winner project scraping (prizes, team, built-with, links, sections)
- Reliability:
  - request timeouts
  - retries with exponential backoff
  - single-worker queue (global concurrency = 1)
  - job hard timeout
  - structured failure codes
- Persistence:
  - `lookup_jobs`
  - `lookup_progress_events`
  - `lookup_results`
  - `rate_limit_events`

## Quick Start

### Backend

```bash
cd backend
python3 -m pip install -r requirements.txt
cp .env.example .env
PYTHONPATH=. uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Optional snapshot env vars:

- `VITE_SNAPSHOT_BASE_URL` (default: current site base URL)
- `VITE_SNAPSHOT_MANIFEST_PATH` (default: `snapshots/manifest.json`)
- `VITE_ENABLE_LIVE_LOOKUPS` (default: `false`)

If you explicitly want backend live lookup behavior for local development:

```bash
VITE_ENABLE_LIVE_LOOKUPS=true npm run dev
```

## Manual Snapshot Build

Build and commit static snapshot shards for instant frontend render on covered hackathons:

```bash
cd backend
PYTHONPATH=. .venv/bin/python scripts/build_snapshot_shards.py --limit 1000 --output ../frontend/public/snapshots
```

Or export from your existing local SQLite cached results:

```bash
./cache_results.sh
```

## Tests

### Backend tests

```bash
cd backend
PYTHONPATH=. pytest
```

Includes:

- Unit tests for URL normalization and parser behavior
- Unit tests for IP rate limiting
- Integration test for async lookup lifecycle

## Deployment

- Frontend GitHub Pages workflow: `.github/workflows/frontend-pages.yml`
- Render backend blueprint: `render.yaml`
- Backend test workflow: `.github/workflows/backend-tests.yml`
- VM service template: `backend/deploy/systemd/hackaplan-backend.service`
- Nginx reverse proxy template: `backend/deploy/nginx/hackaplan.conf`
- SQLite backup script: `scripts/backup_sqlite.sh`

### Render + GitHub Pages (No-Cost MVP)

1. Create backend on Render:
   - In Render dashboard, use Blueprint and point to this repo (it will read `render.yaml`).
   - After service is created, set:
     - `HACKAPLAN_CORS_ORIGINS=https://aryan-cs.github.io`
       - add `,http://localhost:5173` if you also want local frontend access
     - `HACKAPLAN_IP_HASH_SALT=<any-random-secret-string>`
2. Get your Render backend URL, e.g. `https://hackaplan-api.onrender.com`
3. In GitHub repo settings, add variable:
   - `VITE_API_BASE_URL=https://hackaplan-api.onrender.com`
4. Push to `main`:
   - Pages workflow uses that variable and enables live lookups.
5. Optional cache warmup:
   - Run `./cache_results.sh`
   - Commit `frontend/public/snapshots/manifest.json` and `frontend/public/snapshots/shards/*.json`
   - Push again so Pages serves updated snapshot cache.

Notes:
- Render free web services can cold-start and have ephemeral filesystem behavior.
- Snapshot files in GitHub remain your durable, shared cache for users.

## Important Note

This implementation follows your selected direct-fetch approach. Devpost terms include anti-scraping language. Review legal/policy implications before public launch.
