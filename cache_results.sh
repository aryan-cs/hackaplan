#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"

if [[ ! -x "$BACKEND_DIR/.venv/bin/python" ]]; then
  echo "Missing backend virtualenv python at: $BACKEND_DIR/.venv/bin/python" >&2
  echo "Run start.sh once or create the venv/deps in backend/ first." >&2
  exit 1
fi

cd "$BACKEND_DIR"
PYTHONPATH=. .venv/bin/python scripts/export_cached_lookups_to_snapshots.py --output ../frontend/public/snapshots --limit 500 --prune
