from __future__ import annotations

from urllib.parse import urlparse, urlunparse

from ..errors import ValidationAppError


def normalize_hackathon_url(raw_url: str) -> str:
    candidate = raw_url.strip()
    if not candidate:
        raise ValidationAppError("Hackathon URL is required")

    if not candidate.startswith(("http://", "https://")):
        candidate = f"https://{candidate}"

    parsed = urlparse(candidate)
    if not parsed.netloc:
        raise ValidationAppError("Invalid hackathon URL")

    host = parsed.netloc.lower()
    if not host.endswith("devpost.com"):
        raise ValidationAppError("Only Devpost URLs are allowed")

    if parsed.path in {"", "/"}:
        cleaned_path = ""
    else:
        cleaned_path = parsed.path.rstrip("/")

    normalized = parsed._replace(path=cleaned_path, params="", query="", fragment="")
    return urlunparse(normalized)


def same_hackathon(target_url: str, challenge_url: str) -> bool:
    target = urlparse(target_url)
    challenge = urlparse(challenge_url)

    if target.netloc.lower() != challenge.netloc.lower():
        return False

    target_path = target.path.rstrip("/")
    challenge_path = challenge.path.rstrip("/")

    if not target_path or target_path == "/":
        return True

    return challenge_path.startswith(target_path)
