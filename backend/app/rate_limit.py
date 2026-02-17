from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request

from .config import Settings
from .db import Database
from .time_utils import ISO_FORMAT


LOOKUP_ENDPOINT_KEY = "POST:/api/v1/lookups"


def _get_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _hash_ip(ip: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{ip}".encode("utf-8")).hexdigest()


def enforce_lookup_rate_limit(request: Request, db: Database, settings: Settings) -> None:
    if not settings.rate_limit_enabled:
        return

    ip = _get_client_ip(request)
    ip_hash = _hash_ip(ip, settings.ip_hash_salt)

    now = datetime.now(timezone.utc)
    one_hour_ago = (now - timedelta(hours=1)).strftime(ISO_FORMAT)
    one_day_ago = (now - timedelta(days=1)).strftime(ISO_FORMAT)

    hourly = db.count_rate_limit_events(ip_hash, LOOKUP_ENDPOINT_KEY, one_hour_ago)
    if hourly >= settings.rate_limit_hourly:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "rate_limit_exceeded",
                "message": f"Hourly limit exceeded ({settings.rate_limit_hourly} lookups/hour)",
            },
        )

    daily = db.count_rate_limit_events(ip_hash, LOOKUP_ENDPOINT_KEY, one_day_ago)
    if daily >= settings.rate_limit_daily:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "rate_limit_exceeded",
                "message": f"Daily limit exceeded ({settings.rate_limit_daily} lookups/day)",
            },
        )

    db.insert_rate_limit_event(ip_hash, LOOKUP_ENDPOINT_KEY)
