from __future__ import annotations

from datetime import datetime, timedelta, timezone


ISO_FORMAT = "%Y-%m-%dT%H:%M:%S.%fZ"


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime(ISO_FORMAT)


def utc_seconds_ago_iso(seconds: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(seconds=seconds)).strftime(ISO_FORMAT)
