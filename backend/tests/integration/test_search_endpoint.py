from __future__ import annotations

import pytest
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.main import create_app


@pytest.mark.asyncio
async def test_hackathon_search_endpoint_returns_suggestions(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    monkeypatch.setenv("HACKAPLAN_DATABASE_PATH", str(tmp_path / "search-integration.db"))
    monkeypatch.setenv("HACKAPLAN_IP_HASH_SALT", "integration-salt")
    get_settings.cache_clear()

    app = create_app()

    async def fake_search_hackathons(query: str, limit: int):
        assert query == "tree hacks"
        assert limit == 4
        return [
            {
                "title": "TreeHacks 2026",
                "hackathon_url": "https://treehacks-2026.devpost.com",
                "gallery_url": "https://treehacks-2026.devpost.com/project-gallery",
                "thumbnail_url": "https://example.com/treehacks.png",
                "open_state": "ended",
                "winners_announced": True,
                "submission_period_dates": "Feb 14 - 16, 2026",
                "organization_name": "TreeHacks",
            }
        ]

    app.state.scraper.search_hackathons = fake_search_hackathons

    transport = ASGITransport(app=app)
    async with LifespanManager(app):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get(
                "/api/v1/hackathons/search",
                params={"query": "tree hacks", "limit": 4},
            )

    assert response.status_code == 200
    payload = response.json()
    assert payload["query"] == "tree hacks"
    assert len(payload["suggestions"]) == 1
    assert payload["suggestions"][0]["title"] == "TreeHacks 2026"


@pytest.mark.asyncio
async def test_hackathon_search_endpoint_short_query_returns_empty(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    monkeypatch.setenv("HACKAPLAN_DATABASE_PATH", str(tmp_path / "search-short.db"))
    monkeypatch.setenv("HACKAPLAN_IP_HASH_SALT", "integration-salt")
    get_settings.cache_clear()

    app = create_app()

    async def fail_if_called(query: str, limit: int):
        raise AssertionError("search_hackathons should not be called for short query")

    app.state.scraper.search_hackathons = fail_if_called

    transport = ASGITransport(app=app)
    async with LifespanManager(app):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get(
                "/api/v1/hackathons/search",
                params={"query": "a"},
            )

    assert response.status_code == 200
    payload = response.json()
    assert payload["query"] == "a"
    assert payload["suggestions"] == []
