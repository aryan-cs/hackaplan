import asyncio
from pathlib import Path

import pytest
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.main import create_app


@pytest.mark.asyncio
async def test_lookup_job_flow(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("HACKAPLAN_DATABASE_PATH", str(tmp_path / "integration.db"))
    monkeypatch.setenv("HACKAPLAN_IP_HASH_SALT", "integration-salt")
    monkeypatch.setenv("HACKAPLAN_RATE_LIMIT_HOURLY", "10")
    monkeypatch.setenv("HACKAPLAN_RATE_LIMIT_DAILY", "100")
    get_settings.cache_clear()

    app = create_app()

    async def fake_scrape(hackathon_url: str, progress_callback):
        await progress_callback(
            "gallery_page_scanned",
            {
                "page_url": "https://samplehack.devpost.com/project-gallery",
                "page_number": 1,
                "scanned_projects": 3,
                "winners_found_on_page": 1,
                "next_page_url": None,
            },
        )
        await progress_callback(
            "winner_project_found",
            {
                "project_title": "Example Winner",
                "project_url": "https://devpost.com/software/example-winner",
                "software_id": "101",
            },
        )
        await progress_callback(
            "winner_project_scraped",
            {
                "index": 1,
                "total": 1,
                "project_title": "Example Winner",
                "project_url": "https://devpost.com/software/example-winner",
                "prize_count": 1,
            },
        )
        return {
            "hackathon": {
                "name": "SampleHack",
                "url": hackathon_url,
                "gallery_url": f"{hackathon_url}/project-gallery",
                "scanned_pages": 1,
                "scanned_projects": 3,
                "winner_count": 1,
            },
            "winners": [
                {
                    "project_title": "Example Winner",
                    "project_url": "https://devpost.com/software/example-winner",
                    "tagline": "A winner project",
                    "prizes": [
                        {
                            "hackathon_name": "SampleHack",
                            "hackathon_url": hackathon_url,
                            "prize_name": "First Place",
                        }
                    ],
                    "team_members": [
                        {"name": "Alice", "profile_url": "https://devpost.com/alice"},
                    ],
                    "built_with": [{"name": "python", "url": None}],
                    "external_links": [{"label": "github", "url": "https://github.com/example/project"}],
                    "description_sections": [{"heading": "Inspiration", "content": "A"}],
                }
            ],
            "generated_at": "2026-01-01T00:00:00.000000Z",
        }

    app.state.orchestrator.scraper.scrape_hackathon = fake_scrape

    transport = ASGITransport(app=app)
    async with LifespanManager(app):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            create_response = await client.post(
                "/api/v1/lookups",
                json={"hackathon_url": "https://samplehack.devpost.com"},
            )
            assert create_response.status_code == 200
            lookup_id = create_response.json()["lookup_id"]

            lookup_payload = None
            for _ in range(50):
                response = await client.get(f"/api/v1/lookups/{lookup_id}")
                assert response.status_code == 200
                lookup_payload = response.json()
                if lookup_payload["status"] == "completed":
                    break
                await asyncio.sleep(0.05)

            assert lookup_payload is not None
            assert lookup_payload["status"] == "completed"
            assert lookup_payload["result"]["hackathon"]["name"] == "SampleHack"
            assert len(lookup_payload["progress_events"]) >= 5
