from __future__ import annotations

import asyncio
import hashlib
import json
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .scraping.service import DEVPOST_HACKATHON_SEARCH_API_URL, DevpostScraper
from .scraping.url_utils import normalize_hackathon_url
from .time_utils import utcnow_iso

SNAPSHOT_VERSION = "v1"


def snapshot_shard_relative_path(hackathon_url: str) -> str:
    normalized = normalize_hackathon_url(hackathon_url)
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return f"shards/{digest}.json"


def _is_ended_hackathon(raw: dict[str, Any]) -> bool:
    open_state = raw.get("open_state")
    state = open_state.lower().strip() if isinstance(open_state, str) else ""
    winners_announced = raw.get("winners_announced") is True
    return state in {"ended", "complete", "completed", "closed", "past"} or winners_announced


def _extract_candidate(raw: dict[str, Any]) -> dict[str, Any] | None:
    raw_url = raw.get("url")
    if not isinstance(raw_url, str) or not raw_url.strip():
        return None

    title = raw.get("title")
    normalized_url = normalize_hackathon_url(raw_url)
    return {
        "hackathon_url": normalized_url,
        "title": title.strip() if isinstance(title, str) else normalized_url,
        "open_state": raw.get("open_state") if isinstance(raw.get("open_state"), str) else None,
        "winners_announced": raw.get("winners_announced") if isinstance(raw.get("winners_announced"), bool) else None,
    }


async def discover_hackathon_targets(
    http_client: Any,
    *,
    limit: int,
    max_pages: int,
) -> list[str]:
    seen_urls: set[str] = set()
    ended_candidates: list[dict[str, Any]] = []
    other_candidates: list[dict[str, Any]] = []

    for page in range(1, max_pages + 1):
        payload = await http_client.fetch_json(
            DEVPOST_HACKATHON_SEARCH_API_URL,
            params={"page": page},
        )

        raw_hackathons = payload.get("hackathons")
        if not isinstance(raw_hackathons, list) or len(raw_hackathons) == 0:
            break

        for raw in raw_hackathons:
            if not isinstance(raw, dict):
                continue

            try:
                candidate = _extract_candidate(raw)
            except Exception:
                continue

            if candidate is None:
                continue

            hackathon_url = candidate["hackathon_url"]
            if hackathon_url in seen_urls:
                continue
            seen_urls.add(hackathon_url)

            if _is_ended_hackathon(raw):
                ended_candidates.append(candidate)
            else:
                other_candidates.append(candidate)

        if len(ended_candidates) >= limit:
            break

        meta = payload.get("meta")
        if isinstance(meta, dict):
            total_count = meta.get("total_count")
            per_page = meta.get("per_page")
            if isinstance(total_count, int) and isinstance(per_page, int) and per_page > 0:
                if page * per_page >= total_count:
                    break

    selected_urls = [candidate["hackathon_url"] for candidate in ended_candidates[:limit]]
    if len(selected_urls) < limit:
        for candidate in other_candidates:
            selected_urls.append(candidate["hackathon_url"])
            if len(selected_urls) >= limit:
                break

    return selected_urls


def _resolve_git_commit() -> str:
    try:
        output = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
        if output:
            return output
    except Exception:
        pass
    return "unknown"


@dataclass
class SnapshotBuildReport:
    selected_count: int
    success_count: int
    failure_count: int
    pruned_shard_count: int
    duration_seconds: float
    total_output_bytes: int
    manifest_path: str
    failed_targets: list[dict[str, str]]


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def _directory_size_bytes(path: Path) -> int:
    if not path.exists():
        return 0
    total = 0
    for child in path.rglob("*"):
        if child.is_file():
            total += child.stat().st_size
    return total


def prune_stale_shards(output_dir: Path, active_relative_paths: set[str]) -> int:
    shards_dir = output_dir / "shards"
    if not shards_dir.exists():
        return 0

    pruned_count = 0
    active_filenames = {Path(relative_path).name for relative_path in active_relative_paths}
    for candidate in shards_dir.glob("*.json"):
        if candidate.name in active_filenames:
            continue
        candidate.unlink()
        pruned_count += 1

    return pruned_count


async def build_snapshot_from_targets(
    scraper: DevpostScraper,
    *,
    targets: list[str],
    output_dir: Path,
    scrape_concurrency: int = 4,
    source_commit: str | None = None,
    scope: dict[str, Any] | None = None,
) -> SnapshotBuildReport:
    started_at = time.perf_counter()
    selected_count = len(targets)
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "shards").mkdir(parents=True, exist_ok=True)

    fetch_semaphore = asyncio.Semaphore(max(1, scrape_concurrency))
    entries: list[tuple[int, dict[str, Any]]] = []
    failures: list[dict[str, str]] = []

    async def progress_noop(event_type: str, payload: dict[str, Any]) -> None:
        _ = event_type
        _ = payload

    async def scrape_target(index: int, hackathon_url: str) -> tuple[int, dict[str, Any]] | None:
        async with fetch_semaphore:
            try:
                result = await scraper.scrape_hackathon(hackathon_url, progress_noop)
            except Exception as error:
                failures.append(
                    {
                        "hackathon_url": hackathon_url,
                        "error": str(error),
                    }
                )
                return None

            shard_generated_at = utcnow_iso()
            shard_path = snapshot_shard_relative_path(hackathon_url)
            shard_payload = {
                "version": SNAPSHOT_VERSION,
                "hackathon_url": hackathon_url,
                "generated_at": shard_generated_at,
                "result": result,
            }
            _write_json(output_dir / shard_path, shard_payload)

            hackathon = result.get("hackathon", {})
            entry = {
                "hackathon_url": hackathon_url,
                "hackathon_title": hackathon.get("name") if isinstance(hackathon.get("name"), str) else None,
                "shard_path": shard_path,
                "generated_at": shard_generated_at,
                "winner_count": int(hackathon.get("winner_count") or len(result.get("winners", []))),
                "scanned_pages": int(hackathon.get("scanned_pages") or 0),
                "scanned_projects": int(hackathon.get("scanned_projects") or 0),
            }
            return index, entry

    tasks = [asyncio.create_task(scrape_target(index, target)) for index, target in enumerate(targets)]
    try:
        for task in asyncio.as_completed(tasks):
            task_result = await task
            if task_result is None:
                continue
            entries.append(task_result)
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    entries.sort(key=lambda item: item[0])
    ordered_entries = [entry for _, entry in entries]
    active_shard_paths = {entry["shard_path"] for entry in ordered_entries}
    pruned_count = prune_stale_shards(output_dir, active_shard_paths)

    manifest_payload = {
        "version": SNAPSHOT_VERSION,
        "generated_at": utcnow_iso(),
        "source_commit": source_commit or _resolve_git_commit(),
        "scope": scope
        if scope is not None
        else {
            "selection_mode": "manual_targets",
            "limit": len(targets),
        },
        "entries": ordered_entries,
    }
    manifest_path = output_dir / "manifest.json"
    _write_json(manifest_path, manifest_payload)

    duration = time.perf_counter() - started_at
    return SnapshotBuildReport(
        selected_count=selected_count,
        success_count=len(ordered_entries),
        failure_count=len(failures),
        pruned_shard_count=pruned_count,
        duration_seconds=duration,
        total_output_bytes=_directory_size_bytes(output_dir),
        manifest_path=str(manifest_path),
        failed_targets=failures,
    )
