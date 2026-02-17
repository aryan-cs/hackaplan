#!/usr/bin/env bash
set -euo pipefail

DB_PATH="${1:-/var/lib/hackaplan/hackaplan.db}"
BACKUP_DIR="${2:-/var/backups/hackaplan}"

mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/hackaplan-${TIMESTAMP}.db"

sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"
gzip "$BACKUP_FILE"

echo "Created backup: ${BACKUP_FILE}.gz"
