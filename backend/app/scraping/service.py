from __future__ import annotations

import asyncio
import re
from collections.abc import Awaitable, Callable
from urllib.parse import urlparse

from ..config import Settings
from ..errors import ParseAppError, ValidationAppError
from ..time_utils import utcnow_iso
from .http_client import RetryHttpClient
from .parser import (
    WinnerCandidate,
    parse_gallery_page,
    parse_hackathon_name,
    parse_project_page,
    resolve_gallery_url,
    winners_are_announced,
)
from .url_utils import normalize_hackathon_url

ProgressCallback = Callable[[str, dict], Awaitable[None]]
DEVPOST_HACKATHON_SEARCH_API_URL = "https://devpost.com/api/hackathons"


def _normalize_match_key(value: str) -> str:
    return "".join(char for char in value.lower() if char.isalnum())


def _build_search_query_variants(query: str) -> list[str]:
    collapsed_whitespace = " ".join(query.split())
    variants: list[str] = []
    seen: set[str] = set()

    def add_variant(candidate: str) -> None:
        normalized_candidate = candidate.strip()
        if len(normalized_candidate) < 2:
            return
        lower = normalized_candidate.lower()
        if lower in seen:
            return
        seen.add(lower)
        variants.append(normalized_candidate)

    add_variant(collapsed_whitespace)
    add_variant(_normalize_match_key(collapsed_whitespace))

    if " " in collapsed_whitespace:
        add_variant(collapsed_whitespace.replace(" ", ""))
        add_variant(collapsed_whitespace.replace(" ", "-"))

    return variants


def _score_suggestion(suggestion: dict, original_query: str) -> int:
    title = str(suggestion.get("title") or "")
    hackathon_url = str(suggestion.get("hackathon_url") or "")

    parsed_url = urlparse(hackathon_url)
    host = parsed_url.netloc.lower()
    subdomain = host.split(".")[0] if host else ""

    title_lower = title.lower()
    title_key = _normalize_match_key(title)
    subdomain_key = _normalize_match_key(subdomain)

    query_lower = original_query.lower()
    query_key = _normalize_match_key(original_query)
    query_tokens = [token for token in re.split(r"[^a-z0-9]+", query_lower) if token]

    score = 0
    if query_key:
        if title_key.startswith(query_key) or subdomain_key.startswith(query_key):
            score += 120
        elif query_key in title_key or query_key in subdomain_key:
            score += 80

    token_matches = 0
    for token in query_tokens:
        if token in title_lower or token in subdomain:
            token_matches += 1
    score += token_matches * 12

    return score


def _extract_hackathon_year(suggestion: dict) -> int:
    title = str(suggestion.get("title") or "")
    hackathon_url = str(suggestion.get("hackathon_url") or "")

    candidates = re.findall(r"\b(19\d{2}|20\d{2})\b", f"{title} {hackathon_url}")
    if not candidates:
        return 0

    return max(int(candidate) for candidate in candidates)


class DevpostScraper:
    def __init__(self, http_client: RetryHttpClient, settings: Settings | None = None):
        self.http_client = http_client
        self.settings = settings or getattr(http_client, "settings", None) or Settings()

    async def scrape_hackathon(self, hackathon_url: str, progress_callback: ProgressCallback) -> dict:
        normalized_hackathon_url = normalize_hackathon_url(hackathon_url)

        hackathon_html = await self.http_client.fetch_text(normalized_hackathon_url)
        hackathon_name = parse_hackathon_name(hackathon_html)
        should_run_deep_fallback = winners_are_announced(hackathon_html)
        gallery_url = resolve_gallery_url(normalized_hackathon_url, hackathon_html)

        all_candidates: list[WinnerCandidate] = []
        scanned_pages = 0
        scanned_projects = 0
        winners: list[dict] = []

        visited_pages: set[str] = set()
        page_url: str | None = gallery_url
        found_gallery_winners = False

        fetch_semaphore = asyncio.Semaphore(self.settings.project_fetch_concurrency)
        pending_scrape_tasks: set[asyncio.Task[dict | None]] = set()
        scheduled_project_urls: set[str] = set()
        total_candidates_scheduled = 0

        async def scrape_candidate(
            candidate: WinnerCandidate,
            *,
            requires_prize_confirmation: bool,
        ) -> dict | None:
            project_html = await self.http_client.fetch_text_with_options(
                candidate.project_url,
                timeout_seconds=self.settings.project_request_timeout_seconds,
                max_retries=self.settings.project_max_retries,
                retry_backoff_base_seconds=self.settings.project_retry_backoff_base_seconds,
            )
            project = parse_project_page(
                project_url=candidate.project_url,
                html=project_html,
                target_hackathon_url=normalized_hackathon_url,
            )

            if requires_prize_confirmation and not project.get("prizes"):
                return None

            if not requires_prize_confirmation and not project.get("prizes"):
                # Keep gallery-tagged winners even when prize labels are unavailable.
                project["prizes"] = [
                    {
                        "hackathon_name": hackathon_name,
                        "hackathon_url": normalized_hackathon_url,
                        "prize_name": "Winner",
                    }
                ]

            if requires_prize_confirmation:
                await progress_callback(
                    "winner_project_found",
                    {
                        "project_title": project["project_title"],
                        "project_url": project["project_url"],
                        "software_id": candidate.software_id,
                        "source": "project_page_prize_confirmation",
                        "preview_image_url": project.get("preview_image_url"),
                    },
                )

            return {
                "software_id": candidate.software_id,
                "project": project,
            }

        async def scrape_candidate_with_limit(
            candidate: WinnerCandidate,
            *,
            requires_prize_confirmation: bool,
        ) -> dict | None:
            async with fetch_semaphore:
                return await scrape_candidate(
                    candidate,
                    requires_prize_confirmation=requires_prize_confirmation,
                )

        def schedule_candidate(
            candidate: WinnerCandidate,
            *,
            requires_prize_confirmation: bool,
        ) -> None:
            nonlocal total_candidates_scheduled
            if candidate.project_url in scheduled_project_urls:
                return

            scheduled_project_urls.add(candidate.project_url)
            total_candidates_scheduled += 1
            pending_scrape_tasks.add(
                asyncio.create_task(
                    scrape_candidate_with_limit(
                        candidate,
                        requires_prize_confirmation=requires_prize_confirmation,
                    )
                )
            )

        async def drain_completed_scrapes(*, wait_for_all: bool) -> None:
            while pending_scrape_tasks:
                done = {task for task in pending_scrape_tasks if task.done()}
                if not done:
                    if wait_for_all:
                        done, _ = await asyncio.wait(
                            pending_scrape_tasks,
                            return_when=asyncio.FIRST_COMPLETED,
                        )
                    else:
                        break

                for task in done:
                    pending_scrape_tasks.remove(task)
                    candidate_result = task.result()
                    if candidate_result is None:
                        continue

                    project = candidate_result["project"]
                    winners.append(project)
                    winner_index = len(winners)

                    await progress_callback(
                        "winner_project_scraped",
                        {
                            "index": winner_index,
                            "total": max(total_candidates_scheduled, winner_index),
                            "project_title": project["project_title"],
                            "project_url": project["project_url"],
                            "prize_count": len(project["prizes"]),
                            "winner_project": project,
                        },
                    )

        try:
            while page_url and page_url not in visited_pages:
                visited_pages.add(page_url)

                page_html = await self.http_client.fetch_text(page_url)
                parsed_page = parse_gallery_page(page_url, page_html)

                scanned_pages += 1
                scanned_projects += parsed_page.scanned_projects
                all_candidates.extend(parsed_page.all_entries)

                for entry in parsed_page.winner_entries:
                    found_gallery_winners = True
                    await progress_callback(
                        "winner_project_found",
                        {
                            "project_title": entry.project_title,
                            "project_url": entry.project_url,
                            "software_id": entry.software_id,
                            "preview_image_url": entry.preview_image_url,
                        },
                    )
                    schedule_candidate(entry, requires_prize_confirmation=False)

                await progress_callback(
                    "gallery_page_scanned",
                    {
                        "page_url": page_url,
                        "page_number": scanned_pages,
                        "scanned_projects": parsed_page.scanned_projects,
                        "winners_found_on_page": len(parsed_page.winner_entries),
                        "next_page_url": parsed_page.next_page_url,
                    },
                )
                await drain_completed_scrapes(wait_for_all=False)

                page_url = parsed_page.next_page_url

            if not found_gallery_winners and should_run_deep_fallback:
                unique_all_candidates: list[WinnerCandidate] = []
                seen_project_urls: set[str] = set()
                for candidate in all_candidates:
                    if candidate.project_url in seen_project_urls:
                        continue
                    seen_project_urls.add(candidate.project_url)
                    unique_all_candidates.append(candidate)

                await progress_callback(
                    "winner_detection_fallback",
                    {
                        "reason": "gallery_badges_missing",
                        "candidate_projects": len(unique_all_candidates),
                    },
                )
                for candidate in unique_all_candidates:
                    schedule_candidate(candidate, requires_prize_confirmation=True)
            elif not found_gallery_winners:
                await progress_callback(
                    "winners_not_announced",
                    {
                        "message": "Hackathon page indicates winners are not announced yet.",
                    },
                )

            await drain_completed_scrapes(wait_for_all=True)
        finally:
            pending_tasks = list(pending_scrape_tasks)
            for task in pending_tasks:
                if not task.done():
                    task.cancel()
            if pending_tasks:
                await asyncio.gather(*pending_tasks, return_exceptions=True)

        if scanned_pages == 0:
            raise ParseAppError("Unable to locate or parse the project gallery page")

        return {
            "hackathon": {
                "name": hackathon_name,
                "url": normalized_hackathon_url,
                "gallery_url": gallery_url,
                "scanned_pages": scanned_pages,
                "scanned_projects": scanned_projects,
                "winner_count": len(winners),
            },
            "winners": winners,
            "generated_at": utcnow_iso(),
        }

    async def search_hackathons(self, query: str, limit: int = 8) -> list[dict]:
        trimmed_query = query.strip()
        if len(trimmed_query) < 2:
            return []

        bounded_limit = max(1, min(limit, 20))
        search_variants = _build_search_query_variants(trimmed_query)
        suggestions_by_url: dict[str, dict] = {}

        for variant in search_variants:
            payload = await self.http_client.fetch_json(
                DEVPOST_HACKATHON_SEARCH_API_URL,
                params={"search": variant, "page": 1},
            )

            raw_hackathons = payload.get("hackathons")
            if not isinstance(raw_hackathons, list):
                continue

            for raw in raw_hackathons:
                if not isinstance(raw, dict):
                    continue

                title = str(raw.get("title") or "").strip()
                hackathon_url_raw = str(raw.get("url") or "").strip()
                if not title or not hackathon_url_raw:
                    continue

                try:
                    hackathon_url = normalize_hackathon_url(hackathon_url_raw)
                except ValidationAppError:
                    continue

                gallery_url: str | None = None
                submission_gallery_url = raw.get("submission_gallery_url")
                if isinstance(submission_gallery_url, str) and submission_gallery_url.strip():
                    gallery_url = submission_gallery_url.strip()

                thumbnail_url: str | None = None
                raw_thumbnail_url = raw.get("thumbnail_url")
                if isinstance(raw_thumbnail_url, str) and raw_thumbnail_url.strip():
                    thumbnail_url = raw_thumbnail_url.strip()
                    if thumbnail_url.startswith("//"):
                        thumbnail_url = f"https:{thumbnail_url}"

                open_state = raw.get("open_state") if isinstance(raw.get("open_state"), str) else None
                winners_announced = raw.get("winners_announced")
                if not isinstance(winners_announced, bool):
                    winners_announced = None
                submission_period_dates = (
                    raw.get("submission_period_dates")
                    if isinstance(raw.get("submission_period_dates"), str)
                    else None
                )
                organization_name = (
                    raw.get("organization_name") if isinstance(raw.get("organization_name"), str) else None
                )

                suggestion = {
                    "title": title,
                    "hackathon_url": hackathon_url,
                    "gallery_url": gallery_url,
                    "thumbnail_url": thumbnail_url,
                    "open_state": open_state,
                    "winners_announced": winners_announced,
                    "submission_period_dates": submission_period_dates,
                    "organization_name": organization_name,
                }

                existing = suggestions_by_url.get(hackathon_url)
                if existing is None:
                    suggestions_by_url[hackathon_url] = suggestion
                    continue

                for key, value in suggestion.items():
                    if existing.get(key) in (None, "") and value not in (None, ""):
                        existing[key] = value

        ranked_suggestions = sorted(
            suggestions_by_url.values(),
            key=lambda suggestion: (
                _score_suggestion(suggestion, trimmed_query),
                _extract_hackathon_year(suggestion),
                str(suggestion.get("title") or "").lower(),
            ),
            reverse=True,
        )
        return ranked_suggestions[:bounded_limit]
