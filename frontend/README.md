# Hackaplan Frontend

React SPA for creating lookup jobs and viewing live progress/results.

## Local Run

```bash
npm install
npm run dev
```

Set optional env vars in a `.env` file:

```bash
VITE_API_BASE_URL=http://localhost:8000
VITE_API_PREFIX=/api/v1
VITE_BASE_PATH=/
```

## Build

```bash
npm run build
```

## Deploy

- `../.github/workflows/frontend-pages.yml` deploys `dist/` to GitHub Pages on `main`.
