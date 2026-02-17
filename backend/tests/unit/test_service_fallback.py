from __future__ import annotations

from pathlib import Path

import pytest

from app.scraping.service import DevpostScraper


FIXTURES_DIR = Path(__file__).resolve().parents[1] / "fixtures"


def _load_fixture(name: str) -> str:
    return (FIXTURES_DIR / name).read_text(encoding="utf-8")


class FakeHttpClient:
    def __init__(self, payloads: dict[str, str]):
        self.payloads = payloads

    async def fetch_text(self, url: str) -> str:
        if url not in self.payloads:
            raise AssertionError(f"Unexpected URL fetch: {url}")
        return self.payloads[url]

    async def fetch_text_with_options(
        self,
        url: str,
        *,
        timeout_seconds: float | None = None,
        max_retries: int | None = None,
        retry_backoff_base_seconds: float | None = None,
    ) -> str:
        return await self.fetch_text(url)


@pytest.mark.asyncio
async def test_scrape_falls_back_to_project_page_prize_confirmation() -> None:
    hackathon_url = "https://samplehack.devpost.com"
    gallery_url = f"{hackathon_url}/project-gallery"
    winner_url = "https://devpost.com/software/example-winner"
    non_winner_url = "https://devpost.com/software/not-winner"

    hackathon_html = """
    <html>
      <head><title>SampleHack - Devpost</title></head>
      <body><a href="/project-gallery">Project gallery</a></body>
    </html>
    """

    client = FakeHttpClient(
        {
            hackathon_url: hackathon_html,
            gallery_url: _load_fixture("gallery_page_no_badges.html"),
            winner_url: _load_fixture("project_page.html"),
            non_winner_url: _load_fixture("project_page_non_winner.html"),
        }
    )
    scraper = DevpostScraper(http_client=client)

    events: list[tuple[str, dict]] = []

    async def progress_callback(event_type: str, payload: dict) -> None:
        events.append((event_type, payload))

    result = await scraper.scrape_hackathon(hackathon_url, progress_callback)

    assert result["hackathon"]["winner_count"] == 1
    assert len(result["winners"]) == 1
    assert result["winners"][0]["project_title"] == "Example Winner"

    event_types = [event_type for event_type, _ in events]
    assert "winner_detection_fallback" in event_types

    found_events = [payload for event_type, payload in events if event_type == "winner_project_found"]
    assert len(found_events) == 1
    assert found_events[0]["project_url"] == winner_url
    assert found_events[0]["source"] == "project_page_prize_confirmation"

    scraped_events = [payload for event_type, payload in events if event_type == "winner_project_scraped"]
    assert len(scraped_events) == 1
    assert scraped_events[0]["winner_project"]["project_url"] == winner_url
    assert scraped_events[0]["winner_project"]["project_title"] == "Example Winner"


@pytest.mark.asyncio
async def test_scrape_skips_deep_fallback_when_winners_not_announced() -> None:
    hackathon_url = "https://samplehack.devpost.com"
    gallery_url = f"{hackathon_url}/project-gallery"

    hackathon_html = """
    <html>
      <head><title>SampleHack - Devpost</title></head>
      <body>
        <a href="/project-gallery">Project gallery</a>
        <div class="challenge-pre-winners-announced-primary-cta">Winners announced soon</div>
      </body>
    </html>
    """

    client = FakeHttpClient(
        {
            hackathon_url: hackathon_html,
            gallery_url: _load_fixture("gallery_page_no_badges.html"),
        }
    )
    scraper = DevpostScraper(http_client=client)

    events: list[tuple[str, dict]] = []

    async def progress_callback(event_type: str, payload: dict) -> None:
        events.append((event_type, payload))

    result = await scraper.scrape_hackathon(hackathon_url, progress_callback)

    assert result["hackathon"]["winner_count"] == 0
    event_types = [event_type for event_type, _ in events]
    assert "winner_detection_fallback" not in event_types
    assert "winners_not_announced" in event_types
