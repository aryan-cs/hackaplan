from __future__ import annotations

from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings, get_settings
from .db import Database
from .errors import AppError, ValidationAppError
from .job_orchestrator import JobOrchestrator
from .rate_limit import enforce_lookup_rate_limit
from .schemas import (
    HackathonSearchResponse,
    LookupCreateRequest,
    LookupCreateResponse,
    LookupJobResponse,
    ScrapeError,
)
from .scraping.http_client import RetryHttpClient
from .scraping.service import DevpostScraper
from .scraping.url_utils import normalize_hackathon_url
from .time_utils import utc_seconds_ago_iso


def _build_dependencies(settings: Settings) -> tuple[Database, RetryHttpClient, DevpostScraper, JobOrchestrator]:
    db = Database(settings.sqlite_path)
    db.init_schema()

    http_client = RetryHttpClient(settings)
    scraper = DevpostScraper(http_client=http_client, settings=settings)
    orchestrator = JobOrchestrator(db=db, settings=settings, scraper=scraper)
    return db, http_client, scraper, orchestrator


def create_app() -> FastAPI:
    settings = get_settings()
    db, http_client, scraper, orchestrator = _build_dependencies(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await orchestrator.start()
        yield
        await orchestrator.stop()
        await http_client.close()

    app = FastAPI(title=settings.app_name, lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.state.settings = settings
    app.state.db = db
    app.state.http_client = http_client
    app.state.scraper = scraper
    app.state.orchestrator = orchestrator

    @app.get("/health")
    async def healthcheck() -> dict[str, str]:
        return {"status": "ok"}

    @app.get(f"{settings.api_prefix}/hackathons/search", response_model=HackathonSearchResponse)
    async def search_hackathons(query: str, limit: int = 8) -> HackathonSearchResponse:
        trimmed = query.strip()
        if len(trimmed) < 2:
            return HackathonSearchResponse(query=trimmed, suggestions=[])

        bounded_limit = max(1, min(limit, 20))
        try:
            suggestions = await scraper.search_hackathons(trimmed, bounded_limit)
        except AppError as error:
            raise HTTPException(
                status_code=502,
                detail={"code": error.code, "message": error.message},
            ) from error

        return HackathonSearchResponse(query=trimmed, suggestions=suggestions)

    @app.post(f"{settings.api_prefix}/lookups", response_model=LookupCreateResponse)
    async def create_lookup(payload: LookupCreateRequest, request: Request) -> LookupCreateResponse:
        enforce_lookup_rate_limit(request, db, settings)

        try:
            normalized = normalize_hackathon_url(payload.hackathon_url)
        except ValidationAppError as error:
            raise HTTPException(
                status_code=422,
                detail={"code": error.code, "message": error.message},
            ) from error

        active_lookup = db.get_latest_active_lookup_for_url(normalized)
        if active_lookup is not None:
            if active_lookup.get("status") == "queued":
                # Ensure a recovered/deduped queued lookup is actually present in the in-memory worker queue.
                await orchestrator.enqueue_lookup(active_lookup["id"])
            return LookupCreateResponse(lookup_id=active_lookup["id"], status=active_lookup["status"])

        if settings.lookup_result_cache_ttl_seconds > 0:
            finished_since = utc_seconds_ago_iso(settings.lookup_result_cache_ttl_seconds)
            cached_lookup = db.get_recent_completed_lookup_for_url(normalized, finished_since)
            if cached_lookup is not None:
                return LookupCreateResponse(lookup_id=cached_lookup["id"], status=cached_lookup["status"])

        lookup_id = uuid4().hex
        db.create_lookup_job(lookup_id, normalized)

        await orchestrator.publish_event(
            lookup_id,
            "queued",
            {
                "lookup_id": lookup_id,
                "hackathon_url": normalized,
            },
        )
        await orchestrator.enqueue_lookup(lookup_id)

        return LookupCreateResponse(lookup_id=lookup_id, status="queued")

    @app.get(f"{settings.api_prefix}/lookups/{{lookup_id}}", response_model=LookupJobResponse)
    async def get_lookup(lookup_id: str) -> LookupJobResponse:
        lookup = db.get_lookup_job(lookup_id)
        if lookup is None:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Lookup not found"})

        progress_events = db.list_progress_events(lookup_id)
        result_payload = db.get_lookup_result(lookup_id)

        error = None
        if lookup.get("error_code"):
            error = ScrapeError(code=lookup["error_code"], message=lookup.get("error_message") or "")

        return LookupJobResponse(
            lookup_id=lookup["id"],
            hackathon_url=lookup["hackathon_url"],
            status=lookup["status"],
            created_at=lookup["created_at"],
            started_at=lookup.get("started_at"),
            finished_at=lookup.get("finished_at"),
            error=error,
            progress_events=progress_events,
            result=result_payload,
        )

    @app.websocket(f"{settings.api_prefix}/lookups/{{lookup_id}}/ws")
    async def lookup_events(lookup_id: str, websocket: WebSocket) -> None:
        lookup = db.get_lookup_job(lookup_id)
        if lookup is None:
            await websocket.close(code=4404)
            return

        await websocket.accept()
        await orchestrator.subscribe(lookup_id, websocket)

        for event in db.list_progress_events(lookup_id):
            await websocket.send_json(event)

        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            await orchestrator.unsubscribe(lookup_id, websocket)

    return app


app = create_app()
