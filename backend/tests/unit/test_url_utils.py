from app.errors import ValidationAppError
from app.scraping.url_utils import normalize_hackathon_url, same_hackathon


def test_normalize_hackathon_url_adds_https_and_removes_query() -> None:
    normalized = normalize_hackathon_url("samplehack.devpost.com/?x=1")
    assert normalized == "https://samplehack.devpost.com"


def test_normalize_hackathon_url_rejects_non_devpost() -> None:
    try:
        normalize_hackathon_url("https://example.com/hack")
    except ValidationAppError as error:
        assert error.code == "validation_error"
    else:
        raise AssertionError("Expected validation error")


def test_same_hackathon_matches_subdomain() -> None:
    assert same_hackathon("https://samplehack.devpost.com", "https://samplehack.devpost.com/")
    assert not same_hackathon("https://samplehack.devpost.com", "https://otherhack.devpost.com/")
