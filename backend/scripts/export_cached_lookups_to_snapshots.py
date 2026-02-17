#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sqlite3
import subprocess
from pathlib import Path
from typing import Any

from app.config import get_settings
from app.snapshot_builder import SNAPSHOT_VERSION, prune_stale_shards, snapshot_shard_relative_path
from app.time_utils import utcnow_iso


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export completed cached lookup results from SQLite into frontend snapshot shards."
    )
    parser.add_argument(
        "--output",
        type=str,
        default="../frontend/public/snapshots",
        help="Snapshot output directory (default: ../frontend/public/snapshots).",
    )
    parser.add_argument(
        "--database",
        type=str,
        default="",
        help="Path to SQLite DB. Defaults to configured HACKAPLAN_DATABASE_PATH.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=500,
        help="Max unique hackathon URLs to export, newest first (default: 500).",
    )
    parser.add_argument(
        "--prune",
        action="store_true",
        help="Delete shard files not referenced by the newly generated manifest.",
    )
    return parser.parse_args()


def resolve_git_commit() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip() or "unknown"
    except Exception:
        return "unknown"


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def directory_size_bytes(path: Path) -> int:
    if not path.exists():
        return 0
    total = 0
    for child in path.rglob("*"):
        if child.is_file():
            total += child.stat().st_size
    return total


def load_rows(db_path: Path) -> list[sqlite3.Row]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT jobs.hackathon_url, jobs.finished_at, results.result_json
            FROM lookup_jobs AS jobs
            INNER JOIN lookup_results AS results
              ON results.lookup_job_id = jobs.id
            WHERE jobs.status = 'completed'
              AND jobs.finished_at IS NOT NULL
            ORDER BY jobs.finished_at DESC
            """
        ).fetchall()
        return list(rows)
    finally:
        conn.close()


def main() -> None:
    args = parse_args()
    if args.limit < 1:
        raise SystemExit("--limit must be >= 1")

    settings = get_settings()
    db_path = Path(args.database).expanduser().resolve() if args.database else settings.sqlite_path
    output_dir = Path(args.output).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "shards").mkdir(parents=True, exist_ok=True)

    if not db_path.exists():
        raise SystemExit(f"Database file not found: {db_path}")

    rows = load_rows(db_path)

    entries: list[dict[str, Any]] = []
    active_relative_paths: set[str] = set()
    seen_urls: set[str] = set()
    failed_rows = 0

    for row in rows:
        hackathon_url = str(row["hackathon_url"] or "").strip()
        if not hackathon_url or hackathon_url in seen_urls:
            continue

        seen_urls.add(hackathon_url)
        try:
            result = json.loads(row["result_json"])
        except Exception:
            failed_rows += 1
            continue

        if not isinstance(result, dict):
            failed_rows += 1
            continue

        shard_generated_at = (
            str(result.get("generated_at"))
            if isinstance(result.get("generated_at"), str) and result.get("generated_at")
            else str(row["finished_at"])
        )
        if not shard_generated_at:
            shard_generated_at = utcnow_iso()

        shard_path = snapshot_shard_relative_path(hackathon_url)
        shard_payload = {
            "version": SNAPSHOT_VERSION,
            "hackathon_url": hackathon_url,
            "generated_at": shard_generated_at,
            "result": result,
        }
        write_json(output_dir / shard_path, shard_payload)
        active_relative_paths.add(shard_path)

        hackathon = result.get("hackathon", {}) if isinstance(result.get("hackathon"), dict) else {}
        winners = result.get("winners", []) if isinstance(result.get("winners"), list) else []
        entry = {
            "hackathon_url": hackathon_url,
            "shard_path": shard_path,
            "generated_at": shard_generated_at,
            "winner_count": int(hackathon.get("winner_count") or len(winners)),
            "scanned_pages": int(hackathon.get("scanned_pages") or 0),
            "scanned_projects": int(hackathon.get("scanned_projects") or 0),
        }
        entries.append(entry)

        if len(entries) >= args.limit:
            break

    pruned_count = prune_stale_shards(output_dir, active_relative_paths) if args.prune else 0

    manifest_payload = {
        "version": SNAPSHOT_VERSION,
        "generated_at": utcnow_iso(),
        "source_commit": resolve_git_commit(),
        "scope": {
            "selection_mode": "cached_completed_lookups",
            "limit": args.limit,
            "database_path": str(db_path),
            "pruned": args.prune,
        },
        "entries": entries,
    }
    manifest_path = output_dir / "manifest.json"
    write_json(manifest_path, manifest_payload)

    print("Snapshot export complete.")
    print(f"Database: {db_path}")
    print(f"Manifest: {manifest_path}")
    print(f"Exported entries: {len(entries)}")
    print(f"Invalid/failed rows skipped: {failed_rows}")
    if args.prune:
        print(f"Pruned stale shards: {pruned_count}")
    print(f"Output size: {directory_size_bytes(output_dir)} bytes")


if __name__ == "__main__":
    main()
