from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import Any

import httpx

from ..config import Settings
from ..errors import BlockedAppError, NetworkAppError, TimeoutAppError


class RetryHttpClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = httpx.AsyncClient(
            follow_redirects=True,
            timeout=httpx.Timeout(settings.request_timeout_seconds),
            headers={"User-Agent": settings.user_agent},
        )

    async def close(self) -> None:
        await self.client.aclose()

    async def fetch_text(self, url: str) -> str:
        response = await self._fetch_with_retries(url)
        return response.text

    async def fetch_text_with_options(
        self,
        url: str,
        *,
        timeout_seconds: float | None = None,
        max_retries: int | None = None,
        retry_backoff_base_seconds: float | None = None,
    ) -> str:
        response = await self._fetch_with_retries(
            url,
            timeout_seconds=timeout_seconds,
            max_retries=max_retries,
            retry_backoff_base_seconds=retry_backoff_base_seconds,
        )
        return response.text

    async def fetch_json(self, url: str, params: Mapping[str, str | int] | None = None) -> dict[str, Any]:
        response = await self._fetch_with_retries(url, params=params)
        try:
            payload = response.json()
        except ValueError as exc:
            raise NetworkAppError(f"Invalid JSON response while fetching {url}") from exc

        if not isinstance(payload, dict):
            raise NetworkAppError(f"Unexpected JSON payload while fetching {url}")
        return payload

    async def _fetch_with_retries(
        self,
        url: str,
        params: Mapping[str, str | int] | None = None,
        *,
        timeout_seconds: float | None = None,
        max_retries: int | None = None,
        retry_backoff_base_seconds: float | None = None,
    ) -> httpx.Response:
        last_error: Exception | None = None
        retry_count = max_retries if max_retries is not None else self.settings.max_retries
        backoff_base_seconds = (
            retry_backoff_base_seconds
            if retry_backoff_base_seconds is not None
            else self.settings.retry_backoff_base_seconds
        )
        request_timeout = httpx.Timeout(timeout_seconds) if timeout_seconds is not None else None

        for attempt in range(1, retry_count + 1):
            try:
                response = await self.client.get(url, params=params, timeout=request_timeout)

                if response.status_code in {403, 429}:
                    raise BlockedAppError(
                        f"Devpost denied access while fetching {url} (status {response.status_code})"
                    )

                if 500 <= response.status_code < 600:
                    raise NetworkAppError(
                        f"Devpost returned {response.status_code} for {url}"
                    )

                if response.status_code >= 400:
                    raise NetworkAppError(
                        f"Unable to fetch {url}; received {response.status_code}"
                    )

                return response
            except BlockedAppError:
                raise
            except httpx.TimeoutException as exc:
                last_error = exc
                if attempt == retry_count:
                    break
            except (httpx.RequestError, NetworkAppError) as exc:
                last_error = exc
                if attempt == retry_count:
                    break

            await asyncio.sleep(backoff_base_seconds * (2 ** (attempt - 1)))

        if isinstance(last_error, httpx.TimeoutException):
            raise TimeoutAppError(f"Request timeout while fetching {url}")
        if isinstance(last_error, NetworkAppError):
            raise last_error
        if last_error is not None:
            raise NetworkAppError(f"Network error while fetching {url}: {last_error}")
        raise NetworkAppError(f"Network error while fetching {url}")
