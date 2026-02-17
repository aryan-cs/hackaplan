from pathlib import Path

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.config import Settings
from app.db import Database
from app.rate_limit import enforce_lookup_rate_limit


def _build_request(ip: str = "127.0.0.1") -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/v1/lookups",
        "headers": [],
        "client": (ip, 12345),
        "scheme": "http",
        "query_string": b"",
    }
    return Request(scope)


def test_enforce_lookup_rate_limit_blocks_after_hourly_limit(tmp_path: Path) -> None:
    settings = Settings(
        database_path=str(tmp_path / "rate-limit.db"),
        rate_limit_enabled=True,
        ip_hash_salt="test-salt",
        rate_limit_hourly=2,
        rate_limit_daily=5,
    )
    db = Database(settings.sqlite_path)
    db.init_schema()

    request = _build_request()
    enforce_lookup_rate_limit(request, db, settings)
    enforce_lookup_rate_limit(request, db, settings)

    with pytest.raises(HTTPException) as exc:
        enforce_lookup_rate_limit(request, db, settings)

    assert exc.value.status_code == 429
    assert exc.value.detail["code"] == "rate_limit_exceeded"


def test_enforce_lookup_rate_limit_noops_when_disabled(tmp_path: Path) -> None:
    settings = Settings(
        database_path=str(tmp_path / "rate-limit-disabled.db"),
        rate_limit_enabled=False,
        ip_hash_salt="test-salt",
        rate_limit_hourly=1,
        rate_limit_daily=1,
    )
    db = Database(settings.sqlite_path)
    db.init_schema()

    request = _build_request()
    for _ in range(5):
        enforce_lookup_rate_limit(request, db, settings)
