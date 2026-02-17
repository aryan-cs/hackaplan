from __future__ import annotations


class AppError(Exception):
    """Base class for app-level structured errors."""

    code: str = "app_error"

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class ValidationAppError(AppError):
    code = "validation_error"


class NetworkAppError(AppError):
    code = "network_error"


class ParseAppError(AppError):
    code = "parse_error"


class BlockedAppError(AppError):
    code = "blocked_error"


class TimeoutAppError(AppError):
    code = "timeout_error"


class NotFoundAppError(AppError):
    code = "not_found_error"


def error_to_payload(error: AppError) -> dict[str, str]:
    return {"code": error.code, "message": error.message}
