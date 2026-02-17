# Hackaplan Backend

FastAPI service for Devpost winner lookup jobs.

## Local Run

1. Install dependencies:

```bash
python3 -m pip install -r requirements.txt
```

2. Set env vars (optional):

```bash
cp .env.example .env
```

3. Start server:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## API Endpoints

- `GET /api/v1/hackathons/search`
- `POST /api/v1/lookups`
- `GET /api/v1/lookups/{lookup_id}`
- `WS /api/v1/lookups/{lookup_id}/ws`

## Tests

```bash
PYTHONPATH=. pytest
```

## Production

- `Dockerfile` for container deployment.
- `deploy/systemd/hackaplan-backend.service` for VM service setup.
- `deploy/nginx/hackaplan.conf` for reverse proxy + websocket support.
- `../scripts/backup_sqlite.sh` for daily SQLite backups.
