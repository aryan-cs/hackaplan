from __future__ import annotations

import pytest

from app.scraping.service import DevpostScraper


class FakeHttpClient:
    def __init__(self, payloads_by_search: dict[str, dict]):
        self.payloads_by_search = payloads_by_search
        self.calls: list[str] = []

    async def fetch_json(self, url: str, params: dict[str, str | int] | None = None) -> dict:
        search_key = str((params or {}).get("search") or "")
        self.calls.append(search_key)
        return self.payloads_by_search.get(search_key, {"hackathons": []})


@pytest.mark.asyncio
async def test_search_hackathons_returns_normalized_suggestions() -> None:
    client = FakeHttpClient(
        {
            "tree hacks": {
                "hackathons": [
                    {
                        "title": "TreeLine Hacks",
                        "url": "https://treelinev1.devpost.com/",
                    },
                ]
            },
            "treehacks": {
                "hackathons": [
                    {
                        "title": "TreeHacks 2026",
                        "url": "https://treehacks-2026.devpost.com/",
                        "submission_gallery_url": "https://treehacks-2026.devpost.com/project-gallery",
                        "thumbnail_url": "//images.example.com/treehacks.png",
                        "open_state": "ended",
                        "winners_announced": True,
                        "submission_period_dates": "Feb 14 - 16, 2026",
                        "organization_name": "TreeHacks",
                    },
                    {
                        "title": "Not Devpost",
                        "url": "https://example.com/not-devpost",
                    },
                    {
                        "title": "",
                        "url": "https://ignored.devpost.com/",
                    },
                ]
            },
        }
    )
    scraper = DevpostScraper(http_client=client)

    suggestions = await scraper.search_hackathons("tree hacks", limit=5)

    assert len(suggestions) == 2
    assert suggestions[0]["title"] == "TreeHacks 2026"
    assert suggestions[0]["hackathon_url"] == "https://treehacks-2026.devpost.com"
    assert suggestions[0]["gallery_url"] == "https://treehacks-2026.devpost.com/project-gallery"
    assert suggestions[0]["thumbnail_url"] == "https://images.example.com/treehacks.png"
    assert suggestions[0]["open_state"] == "ended"
    assert suggestions[0]["winners_announced"] is True
    assert suggestions[0]["submission_period_dates"] == "Feb 14 - 16, 2026"
    assert suggestions[0]["organization_name"] == "TreeHacks"
    assert suggestions[1]["title"] == "TreeLine Hacks"
    assert "tree hacks" in client.calls
    assert "treehacks" in client.calls


@pytest.mark.asyncio
async def test_search_hackathons_returns_empty_for_short_query() -> None:
    client = FakeHttpClient({"a": {"hackathons": []}})
    scraper = DevpostScraper(http_client=client)

    suggestions = await scraper.search_hackathons("a")

    assert suggestions == []
    assert client.calls == []


@pytest.mark.asyncio
async def test_search_hackathons_orders_reverse_alphabetical_within_matches() -> None:
    client = FakeHttpClient(
        {
            "treehacks": {
                "hackathons": [
                    {
                        "title": "TreeHacks 2024",
                        "url": "https://treehacks-2024.devpost.com/",
                        "winners_announced": True,
                        "open_state": "ended",
                    },
                    {
                        "title": "TreeHacks 2026",
                        "url": "https://treehacks-2026.devpost.com/",
                        "winners_announced": False,
                        "open_state": "upcoming",
                    },
                    {
                        "title": "TreeHacks 2025",
                        "url": "https://treehacks-2025.devpost.com/",
                        "winners_announced": False,
                        "open_state": "upcoming",
                    },
                ]
            }
        }
    )
    scraper = DevpostScraper(http_client=client)

    suggestions = await scraper.search_hackathons("treehacks", limit=5)

    assert [suggestion["title"] for suggestion in suggestions] == [
        "TreeHacks 2026",
        "TreeHacks 2025",
        "TreeHacks 2024",
    ]
