import asyncio
from pathlib import Path

import pytest
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.main import create_app


def _fake_result(hackathon_url: str) -> dict:
    return {
        "hackathon": {
            "name": "SampleHack",
            "url": hackathon_url,
            "gallery_url": f"{hackathon_url}/project-gallery",
            "scanned_pages": 1,
            "scanned_projects": 3,
            "winner_count": 0,
        },
        "winners": [],
        "generated_at": "2026-01-01T00:00:00.000000Z",
    }


@pytest.mark.asyncio
async def test_create_lookup_reuses_active_job(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("HACKAPLAN_DATABASE_PATH", str(tmp_path / "reuse-active.db"))
    monkeypatch.setenv("HACKAPLAN_IP_HASH_SALT", "reuse-active-salt")
    monkeypatch.setenv("HACKAPLAN_RATE_LIMIT_HOURLY", "50")
    monkeypatch.setenv("HACKAPLAN_RATE_LIMIT_DAILY", "500")
    monkeypatch.setenv("HACKAPLAN_LOOKUP_RESULT_CACHE_TTL_SECONDS", "0")
    get_settings.cache_clear()

    app = create_app()

    async def fake_scrape(hackathon_url: str, progress_callback):
        await progress_callback("gallery_page_scanned", {"page_number": 1})
        await asyncio.sleep(0.35)
        return _fake_result(hackathon_url)

    app.state.orchestrator.scraper.scrape_hackathon = fake_scrape

    transport = ASGITransport(app=app)
    async with LifespanManager(app):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            first = await client.post("/api/v1/lookups", json={"hackathon_url": "https://samplehack.devpost.com"})
            assert first.status_code == 200
            first_payload = first.json()

            second = await client.post("/api/v1/lookups", json={"hackathon_url": "https://samplehack.devpost.com"})
            assert second.status_code == 200
            second_payload = second.json()

            assert first_payload["lookup_id"] == second_payload["lookup_id"]
            assert second_payload["status"] in {"queued", "started"}
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_create_lookup_reuses_recent_completed_job(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("HACKAPLAN_DATABASE_PATH", str(tmp_path / "reuse-completed.db"))
    monkeypatch.setenv("HACKAPLAN_IP_HASH_SALT", "reuse-completed-salt")
    monkeypatch.setenv("HACKAPLAN_RATE_LIMIT_HOURLY", "50")
    monkeypatch.setenv("HACKAPLAN_RATE_LIMIT_DAILY", "500")
    monkeypatch.setenv("HACKAPLAN_LOOKUP_RESULT_CACHE_TTL_SECONDS", "3600")
    get_settings.cache_clear()

    app = create_app()

    async def fake_scrape(hackathon_url: str, progress_callback):
        await progress_callback("gallery_page_scanned", {"page_number": 1})
        return _fake_result(hackathon_url)

    app.state.orchestrator.scraper.scrape_hackathon = fake_scrape

    transport = ASGITransport(app=app)
    async with LifespanManager(app):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            first = await client.post("/api/v1/lookups", json={"hackathon_url": "https://samplehack.devpost.com"})
            assert first.status_code == 200
            first_payload = first.json()
            lookup_id = first_payload["lookup_id"]

            completed = False
            for _ in range(40):
                lookup = await client.get(f"/api/v1/lookups/{lookup_id}")
                assert lookup.status_code == 200
                if lookup.json()["status"] == "completed":
                    completed = True
                    break
                await asyncio.sleep(0.05)
            assert completed

            second = await client.post("/api/v1/lookups", json={"hackathon_url": "https://samplehack.devpost.com"})
            assert second.status_code == 200
            second_payload = second.json()

            assert second_payload["lookup_id"] == lookup_id
            assert second_payload["status"] == "completed"
    get_settings.cache_clear()
