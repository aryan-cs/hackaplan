from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Hackaplan API"
    api_prefix: str = "/api/v1"

    database_path: str = "data/hackaplan.db"

    cors_origins: str = "http://localhost:5173"

    request_timeout_seconds: float = 20.0
    max_retries: int = 3
    retry_backoff_base_seconds: float = 0.6
    project_request_timeout_seconds: float = 8.0
    project_max_retries: int = 2
    project_retry_backoff_base_seconds: float = 0.25
    project_fetch_concurrency: int = 6

    job_timeout_seconds: int = 300
    lookup_result_cache_ttl_seconds: int = 1800
    lookup_worker_concurrency: int = 4

    rate_limit_enabled: bool = False
    rate_limit_hourly: int = 3
    rate_limit_daily: int = 10
    ip_hash_salt: str = "change-me"

    user_agent: str = "HackaplanBot/1.0 (+https://github.com/)"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="HACKAPLAN_",
        case_sensitive=False,
        extra="ignore",
    )

    @field_validator("max_retries")
    @classmethod
    def validate_max_retries(cls, value: int) -> int:
        if value < 1:
            raise ValueError("max_retries must be >= 1")
        return value

    @field_validator("project_max_retries", "project_fetch_concurrency", "lookup_worker_concurrency")
    @classmethod
    def validate_positive_int_settings(cls, value: int) -> int:
        if value < 1:
            raise ValueError("value must be >= 1")
        return value

    @field_validator("request_timeout_seconds", "retry_backoff_base_seconds", "project_request_timeout_seconds", "project_retry_backoff_base_seconds")
    @classmethod
    def validate_positive_float_settings(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("value must be > 0")
        return value

    @field_validator("lookup_result_cache_ttl_seconds")
    @classmethod
    def validate_non_negative_cache_ttl(cls, value: int) -> int:
        if value < 0:
            raise ValueError("lookup_result_cache_ttl_seconds must be >= 0")
        return value

    @field_validator("rate_limit_hourly", "rate_limit_daily")
    @classmethod
    def validate_rate_limits(cls, value: int) -> int:
        if value < 1:
            raise ValueError("rate limits must be >= 1")
        return value

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def sqlite_path(self) -> Path:
        path = Path(self.database_path)
        if not path.is_absolute():
            path = Path.cwd() / path
        return path


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    return settings
