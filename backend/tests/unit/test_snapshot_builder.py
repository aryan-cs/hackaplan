from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.snapshot_builder import (
    build_snapshot_from_targets,
    discover_hackathon_targets,
    prune_stale_shards,
    snapshot_shard_relative_path,
)


class FakeHttpClient:
    def __init__(self, payloads_by_page: dict[int, dict]):
        self.payloads_by_page = payloads_by_page
        self.requested_pages: list[int] = []

    async def fetch_json(self, url: str, params: dict | None = None) -> dict:
        _ = url
        page = int((params or {}).get("page", 1))
        self.requested_pages.append(page)
        return self.payloads_by_page.get(page, {"hackathons": [], "meta": {"total_count": 0, "per_page": 9}})


class FakeScraper:
    async def scrape_hackathon(self, hackathon_url: str, progress_callback) -> dict:
        await progress_callback("started", {"hackathon_url": hackathon_url})
        if "failme" in hackathon_url:
            raise RuntimeError("intentional scrape failure")

        return {
            "hackathon": {
                "name": "SampleHack",
                "url": hackathon_url,
                "gallery_url": f"{hackathon_url}/project-gallery",
                "scanned_pages": 2,
                "scanned_projects": 20,
                "winner_count": 1,
            },
            "winners": [
                {
                    "project_title": "Winner",
                    "project_url": "https://devpost.com/software/winner",
                    "tagline": "hello",
                    "preview_image_url": None,
                    "prizes": [],
                    "team_members": [],
                    "built_with": [],
                    "external_links": [],
                    "description_sections": [],
                }
            ],
            "generated_at": "2026-01-01T00:00:00.000000Z",
        }


def test_snapshot_shard_relative_path_is_deterministic_for_normalized_url() -> None:
    left = snapshot_shard_relative_path("https://treehacks-2026.devpost.com/")
    right = snapshot_shard_relative_path("treehacks-2026.devpost.com")
    assert left == right
    assert left.startswith("shards/")
    assert left.endswith(".json")


@pytest.mark.asyncio
async def test_discover_hackathon_targets_prefers_ended() -> None:
    client = FakeHttpClient(
        {
            1: {
                "hackathons": [
                    {"title": "Upcoming One", "url": "https://upcoming-1.devpost.com", "open_state": "upcoming"},
                    {"title": "Ended One", "url": "https://ended-1.devpost.com", "open_state": "ended"},
                    {"title": "Ended Two", "url": "https://ended-2.devpost.com", "winners_announced": True},
                    {"title": "Upcoming Two", "url": "https://upcoming-2.devpost.com", "open_state": "upcoming"},
                ],
                "meta": {"total_count": 4, "per_page": 9},
            }
        }
    )

    targets = await discover_hackathon_targets(client, limit=3, max_pages=5)

    assert targets == [
        "https://ended-1.devpost.com",
        "https://ended-2.devpost.com",
        "https://upcoming-1.devpost.com",
    ]


def test_prune_stale_shards_removes_files_not_in_manifest(tmp_path: Path) -> None:
    shards = tmp_path / "shards"
    shards.mkdir(parents=True, exist_ok=True)
    keep = shards / "keep.json"
    remove = shards / "remove.json"
    keep.write_text("{}", encoding="utf-8")
    remove.write_text("{}", encoding="utf-8")

    pruned = prune_stale_shards(tmp_path, {"shards/keep.json"})

    assert pruned == 1
    assert keep.exists()
    assert not remove.exists()


@pytest.mark.asyncio
async def test_build_snapshot_from_targets_keeps_successes_when_some_fail(tmp_path: Path) -> None:
    scraper = FakeScraper()
    targets = [
        "https://ok-1.devpost.com",
        "https://failme-1.devpost.com",
        "https://ok-2.devpost.com",
    ]

    report = await build_snapshot_from_targets(
        scraper,
        targets=targets,
        output_dir=tmp_path,
        scrape_concurrency=2,
        source_commit="test-commit",
        scope={"selection_mode": "unit-test", "limit": 3},
    )

    manifest = json.loads((tmp_path / "manifest.json").read_text(encoding="utf-8"))
    assert report.selected_count == 3
    assert report.success_count == 2
    assert report.failure_count == 1
    assert len(report.failed_targets) == 1
    assert manifest["source_commit"] == "test-commit"
    assert len(manifest["entries"]) == 2
    for entry in manifest["entries"]:
        assert (tmp_path / entry["shard_path"]).exists()
