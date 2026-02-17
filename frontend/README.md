# Hackaplan Frontend

React SPA for searching and viewing winner snapshots from `frontend/public/snapshots`.

## Local Run

```bash
npm install
npm run dev
```

Set optional env vars in a `.env` file:

```bash
VITE_BASE_PATH=/
VITE_API_BASE_URL=http://localhost:8000
VITE_ENABLE_LIVE_LOOKUPS=true
VITE_SNAPSHOT_MANIFEST_PATH=snapshots/manifest.json
```

Notes:
- `VITE_ENABLE_LIVE_LOOKUPS` defaults to `true`.
- Set `VITE_ENABLE_LIVE_LOOKUPS=false` for snapshot-only static mode.

## Build

```bash
npm run build
```

## Deploy

- `../.github/workflows/frontend-pages.yml` deploys `dist/` to GitHub Pages on `main`.
