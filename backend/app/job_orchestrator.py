from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import WebSocket

from .config import Settings
from .db import Database
from .errors import AppError, ParseAppError
from .scraping.service import DevpostScraper

ProgressCallback = Callable[[str, dict[str, Any]], Awaitable[None]]


class JobOrchestrator:
    def __init__(self, db: Database, settings: Settings, scraper: DevpostScraper):
        self.db = db
        self.settings = settings
        self.scraper = scraper

        # asyncio primitives must be created on the running app loop, not at import time.
        self._queue: asyncio.Queue[str] | None = None
        self._worker_task: asyncio.Task[None] | None = None
        self._subscribers: dict[str, set[WebSocket]] = defaultdict(set)
        self._subscribers_lock: asyncio.Lock | None = None

    async def start(self) -> None:
        if self._worker_task is not None:
            return
        self._queue = asyncio.Queue()
        self._subscribers_lock = asyncio.Lock()
        self._worker_task = asyncio.create_task(self._worker_loop(), name="lookup-worker")

    async def stop(self) -> None:
        if self._worker_task is None:
            return
        self._worker_task.cancel()
        try:
            await self._worker_task
        except asyncio.CancelledError:
            pass
        self._worker_task = None
        self._queue = None
        self._subscribers_lock = None
        self._subscribers.clear()

    async def enqueue_lookup(self, lookup_id: str) -> None:
        if self._queue is None:
            raise RuntimeError("Lookup worker has not been started.")
        await self._queue.put(lookup_id)

    async def subscribe(self, lookup_id: str, websocket: WebSocket) -> None:
        if self._subscribers_lock is None:
            raise RuntimeError("Lookup worker has not been started.")
        async with self._subscribers_lock:
            self._subscribers[lookup_id].add(websocket)

    async def unsubscribe(self, lookup_id: str, websocket: WebSocket) -> None:
        if self._subscribers_lock is None:
            return
        async with self._subscribers_lock:
            if lookup_id in self._subscribers and websocket in self._subscribers[lookup_id]:
                self._subscribers[lookup_id].remove(websocket)
            if lookup_id in self._subscribers and not self._subscribers[lookup_id]:
                self._subscribers.pop(lookup_id, None)

    async def publish_event(self, lookup_id: str, event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        event = self.db.insert_progress_event(lookup_id, event_type, payload)
        await self._broadcast(lookup_id, event)
        return event

    async def _broadcast(self, lookup_id: str, event: dict[str, Any]) -> None:
        if self._subscribers_lock is None:
            return
        async with self._subscribers_lock:
            sockets = list(self._subscribers.get(lookup_id, set()))

        if not sockets:
            return

        stale: list[WebSocket] = []
        for socket in sockets:
            try:
                await socket.send_json(event)
            except Exception:
                stale.append(socket)

        if stale:
            if self._subscribers_lock is None:
                return
            async with self._subscribers_lock:
                current = self._subscribers.get(lookup_id, set())
                for socket in stale:
                    current.discard(socket)

    async def _worker_loop(self) -> None:
        if self._queue is None:
            return
        while True:
            lookup_id = await self._queue.get()
            try:
                await self._process_lookup(lookup_id)
            finally:
                self._queue.task_done()

    async def _process_lookup(self, lookup_id: str) -> None:
        job = self.db.get_lookup_job(lookup_id)
        if job is None:
            return

        self.db.set_lookup_started(lookup_id)
        await self.publish_event(lookup_id, "started", {"lookup_id": lookup_id})

        async def progress_callback(event_type: str, payload: dict[str, Any]) -> None:
            await self.publish_event(lookup_id, event_type, payload)

        try:
            result = await asyncio.wait_for(
                self.scraper.scrape_hackathon(job["hackathon_url"], progress_callback),
                timeout=self.settings.job_timeout_seconds,
            )

            self.db.save_lookup_result(lookup_id, result)
            self.db.set_lookup_completed(lookup_id)
            await self.publish_event(
                lookup_id,
                "completed",
                {
                    "lookup_id": lookup_id,
                    "winner_count": len(result.get("winners", [])),
                },
            )
        except asyncio.TimeoutError:
            self.db.set_lookup_failed(lookup_id, "timeout_error", "Lookup timed out")
            await self.publish_event(
                lookup_id,
                "failed",
                {"code": "timeout_error", "message": "Lookup timed out"},
            )
        except AppError as error:
            self.db.set_lookup_failed(lookup_id, error.code, error.message)
            await self.publish_event(
                lookup_id,
                "failed",
                {"code": error.code, "message": error.message},
            )
        except Exception as error:  # pragma: no cover - defensive fallback
            fallback = ParseAppError(f"Unexpected scraping failure: {error}")
            self.db.set_lookup_failed(lookup_id, fallback.code, fallback.message)
            await self.publish_event(
                lookup_id,
                "failed",
                {"code": fallback.code, "message": fallback.message},
            )
