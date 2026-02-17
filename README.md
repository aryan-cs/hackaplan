# Hackaplan

Hackaplan is a hackathon brainstorming web tool focused on one MVP feature: fetching and exploring past Devpost winners for a given hackathon URL.

## Stack

- Frontend: React + Vite (`frontend/`)
- Backend: FastAPI + SQLite + background worker (`backend/`)
- Real-time updates: WebSocket stream per lookup job
- Snapshot fast path: GitHub-hosted JSON shards (`frontend/public/snapshots`)
- Rate limiting: IP-based, no auth

## Features Implemented

- `GET /api/v1/hackathons/search?query=...` for hackathon autocomplete suggestions
- `POST /api/v1/lookups` to queue a hackathon lookup
- `GET /api/v1/lookups/{lookup_id}` to fetch status/results/errors/events
- `WS /api/v1/lookups/{lookup_id}/ws` for live progress events
- Search-first frontend UX:
  - centered Google-style search screen
  - autocomplete suggestions from Devpost hackathon search
  - image-grid winner cards after selection
  - snapshot-first rendering with live refresh replacement
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

Set `VITE_API_BASE_URL` to your backend URL if not using `http://localhost:8000`.

Optional snapshot env vars:

- `VITE_SNAPSHOT_BASE_URL` (default: current site base URL)
- `VITE_SNAPSHOT_MANIFEST_PATH` (default: `snapshots/manifest.json`)

## Manual Snapshot Build

Build and commit static snapshot shards for instant frontend render on covered hackathons:

```bash
cd backend
PYTHONPATH=. .venv/bin/python scripts/build_snapshot_shards.py --limit 1000 --output ../frontend/public/snapshots
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
- Backend test workflow: `.github/workflows/backend-tests.yml`
- VM service template: `backend/deploy/systemd/hackaplan-backend.service`
- Nginx reverse proxy template: `backend/deploy/nginx/hackaplan.conf`
- SQLite backup script: `scripts/backup_sqlite.sh`

## Important Note

This implementation follows your selected direct-fetch approach. Devpost terms include anti-scraping language. Review legal/policy implications before public launch.
