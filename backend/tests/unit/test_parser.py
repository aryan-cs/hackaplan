from pathlib import Path

from app.scraping.parser import parse_gallery_page, parse_project_page, winners_are_announced


FIXTURES_DIR = Path(__file__).resolve().parents[1] / "fixtures"


def _load_fixture(name: str) -> str:
    return (FIXTURES_DIR / name).read_text(encoding="utf-8")


def test_parse_gallery_page_extracts_winners_and_next_page() -> None:
    html = _load_fixture("gallery_page.html")
    parsed = parse_gallery_page("https://samplehack.devpost.com/project-gallery", html)

    assert parsed.scanned_projects == 3
    assert len(parsed.all_entries) == 3
    assert len(parsed.winner_entries) == 2
    assert parsed.winner_entries[0].project_title == "First Winner"
    assert parsed.winner_entries[0].preview_image_url == "https://samplehack.devpost.com/images/first-winner.png"
    assert parsed.winner_entries[1].preview_image_url == "https://cdn.devpost.com/images/second-winner.png"
    assert parsed.next_page_url == "https://samplehack.devpost.com/project-gallery?page=2"


def test_parse_project_page_extracts_details() -> None:
    html = _load_fixture("project_page.html")
    parsed = parse_project_page(
        project_url="https://devpost.com/software/example-winner",
        html=html,
        target_hackathon_url="https://samplehack.devpost.com",
    )

    assert parsed["project_title"] == "Example Winner"
    assert parsed["team_members"][0]["name"] == "Alice"
    assert parsed["built_with"][0]["name"] == "python"
    assert parsed["external_links"][0]["url"] == "https://github.com/example/project"
    assert parsed["prizes"][0]["prize_name"] == "First Place"
    assert parsed["prizes"][0]["hackathon_name"] == "SampleHack"
    assert parsed["preview_image_url"] == "https://example.com/images/example-winner.png"


def test_parse_project_page_ignores_other_hackathon_prizes() -> None:
    html = _load_fixture("project_page.html")
    parsed = parse_project_page(
        project_url="https://devpost.com/software/example-winner",
        html=html,
        target_hackathon_url="https://unrelated.devpost.com",
    )

    assert parsed["prizes"] == []


def test_winners_are_announced_detects_pre_announcement_state() -> None:
    html = """
    <html>
      <body>
        <div class="challenge-pre-winners-announced-primary-cta">Winners announced soon</div>
      </body>
    </html>
    """
    assert winners_are_announced(html) is False


def test_winners_are_announced_true_without_pre_announcement_banner() -> None:
    html = "<html><body><div>Winners are available.</div></body></html>"
    assert winners_are_announced(html) is True
