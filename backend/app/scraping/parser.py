from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from ..errors import ParseAppError
from .url_utils import same_hackathon


@dataclass
class WinnerCandidate:
    project_title: str
    project_url: str
    software_id: str | None
    preview_image_url: str | None


@dataclass
class GalleryParseResult:
    all_entries: list[WinnerCandidate]
    winner_entries: list[WinnerCandidate]
    scanned_projects: int
    next_page_url: str | None


def _clean_text(value: str) -> str:
    return " ".join(value.split()).strip()


def _normalize_image_url(value: str, base_url: str) -> str:
    cleaned = _clean_text(value)
    if cleaned.startswith("//"):
        return f"https:{cleaned}"
    return urljoin(base_url, cleaned)


def _extract_gallery_preview_image(item, page_url: str) -> str | None:
    image = item.select_one("img")
    if image is None:
        return None

    for attr in ("src", "data-src", "data-cfsrc"):
        raw_value = image.get(attr)
        if isinstance(raw_value, str) and raw_value.strip():
            return _normalize_image_url(raw_value, page_url)

    srcset = image.get("srcset")
    if isinstance(srcset, str) and srcset.strip():
        first_candidate = srcset.split(",", 1)[0].strip().split(" ", 1)[0].strip()
        if first_candidate:
            return _normalize_image_url(first_candidate, page_url)

    return None


def parse_hackathon_name(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    title_tag = soup.find("title")
    if not title_tag or not title_tag.get_text(strip=True):
        return "Unknown Hackathon"

    title = _clean_text(title_tag.get_text())
    if " - Devpost" in title:
        title = title.replace(" - Devpost", "")
    if ":" in title:
        return _clean_text(title.split(":", 1)[0])
    return title


def winners_are_announced(hackathon_html: str) -> bool:
    soup = BeautifulSoup(hackathon_html, "html.parser")

    if soup.select_one(".challenge-pre-winners-announced-primary-cta"):
        return False

    page_text = _clean_text(soup.get_text(" ", strip=True)).lower()
    if "winners announced soon" in page_text:
        return False

    return True


def resolve_gallery_url(hackathon_url: str, hackathon_html: str) -> str:
    soup = BeautifulSoup(hackathon_html, "html.parser")

    for anchor in soup.find_all("a", href=True):
        href = anchor.get("href", "")
        if "project-gallery" in href:
            return urljoin(hackathon_url, href)

    base = hackathon_url if hackathon_url.endswith("/") else f"{hackathon_url}/"
    return urljoin(base, "project-gallery")


def parse_gallery_page(page_url: str, html: str) -> GalleryParseResult:
    soup = BeautifulSoup(html, "html.parser")

    all_entries: list[WinnerCandidate] = []
    winner_entries: list[WinnerCandidate] = []
    scanned = 0

    for item in soup.select("div.gallery-item"):
        scanned += 1

        link = item.select_one("a.link-to-software") or item.select_one("a.block-wrapper-link")
        if link is None or not link.get("href"):
            continue

        title_node = item.select_one("h5")
        title = _clean_text(title_node.get_text()) if title_node else "Untitled"

        entry = WinnerCandidate(
            project_title=title,
            project_url=urljoin(page_url, link["href"]),
            software_id=item.get("data-software-id"),
            preview_image_url=_extract_gallery_preview_image(item, page_url),
        )
        all_entries.append(entry)

        winner_badge = item.select_one("aside.entry-badge .winner")
        if winner_badge is None:
            winner_badge = item.select_one(".winner.label")
        is_winner = winner_badge is not None
        if not is_winner:
            continue

        winner_entries.append(entry)

    next_link = soup.select_one("ul.pagination a[rel='next']")
    next_page_url = None
    if next_link and next_link.get("href") and next_link["href"] != "#":
        next_page_url = urljoin(page_url, next_link["href"])

    return GalleryParseResult(
        all_entries=all_entries,
        winner_entries=winner_entries,
        scanned_projects=scanned,
        next_page_url=next_page_url,
    )


def _parse_description_sections(soup: BeautifulSoup) -> list[dict[str, str]]:
    left = soup.select_one("#app-details-left")
    if left is None:
        return []

    sections: list[dict[str, str]] = []

    for heading in left.select("h2"):
        heading_text = _clean_text(heading.get_text())
        if not heading_text:
            continue

        parts: list[str] = []
        sibling = heading
        while True:
            sibling = sibling.find_next_sibling()
            if sibling is None or getattr(sibling, "name", None) == "h2":
                break
            text = _clean_text(sibling.get_text(" ", strip=True))
            if text:
                parts.append(text)

        if parts:
            sections.append({"heading": heading_text, "content": "\n\n".join(parts)})

    return sections


def _parse_built_with(soup: BeautifulSoup) -> list[dict[str, str | None]]:
    tags: list[dict[str, str | None]] = []
    for tag in soup.select("#built-with .cp-tag"):
        name = _clean_text(tag.get_text())
        if not name:
            continue
        anchor = tag.find("a")
        tags.append({"name": name, "url": anchor.get("href") if anchor else None})
    return tags


def _parse_external_links(soup: BeautifulSoup) -> list[dict[str, str]]:
    links: list[dict[str, str]] = []
    for anchor in soup.select("nav.app-links a[href]"):
        href = anchor.get("href", "").strip()
        if not href:
            continue
        label = _clean_text(anchor.get_text(" ", strip=True)) or urlparse(href).netloc or href
        links.append({"label": label, "url": href})
    return links


def _parse_team_members(soup: BeautifulSoup) -> list[dict[str, str | None]]:
    members: list[dict[str, str | None]] = []
    for member in soup.select("#app-team li.software-team-member"):
        profile = member.select_one("a.user-profile-link[href]")
        if profile is None:
            continue

        name = _clean_text(profile.get_text())
        href = profile.get("href")
        if href and href.startswith("/"):
            href = urljoin("https://devpost.com", href)

        if name:
            members.append({"name": name, "profile_url": href})

    return members


def _parse_prizes(soup: BeautifulSoup, target_hackathon_url: str) -> list[dict[str, str | None]]:
    prizes: list[dict[str, str | None]] = []

    for submission in soup.select("#submissions ul.software-list-with-thumbnail > li"):
        challenge_link = submission.select_one(".software-list-content > p a[href]")
        if challenge_link is None:
            continue

        challenge_name = _clean_text(challenge_link.get_text())
        challenge_url = challenge_link.get("href", "")
        if challenge_url.startswith("/"):
            challenge_url = urljoin("https://devpost.com", challenge_url)

        for prize_li in submission.select(".software-list-content ul.no-bullet li"):
            raw_text = _clean_text(prize_li.get_text(" ", strip=True))
            if not raw_text:
                continue
            prize_name = raw_text.replace("Winner", "").strip() or raw_text
            prizes.append(
                {
                    "hackathon_name": challenge_name,
                    "hackathon_url": challenge_url,
                    "prize_name": prize_name,
                }
            )

    if not prizes:
        return []

    filtered = [
        prize
        for prize in prizes
        if prize["hackathon_url"] and same_hackathon(target_hackathon_url, str(prize["hackathon_url"]))
    ]

    return filtered


def parse_project_page(project_url: str, html: str, target_hackathon_url: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")

    title_node = soup.select_one("meta[property='og:title']")
    title = title_node.get("content") if title_node and title_node.get("content") else None
    if not title:
        h1 = soup.select_one("h1")
        title = _clean_text(h1.get_text()) if h1 else None

    if not title:
        raise ParseAppError(f"Unable to parse project title from {project_url}")

    tagline = None
    description_meta = soup.select_one("meta[property='og:description']")
    if description_meta and description_meta.get("content"):
        tagline = _clean_text(description_meta["content"])

    preview_image_url = None
    image_meta = soup.select_one("meta[property='og:image']")
    if image_meta and image_meta.get("content"):
        preview_image_url = _clean_text(image_meta["content"])
        if preview_image_url.startswith("//"):
            preview_image_url = f"https:{preview_image_url}"

    description_sections = _parse_description_sections(soup)
    built_with = _parse_built_with(soup)
    external_links = _parse_external_links(soup)
    team_members = _parse_team_members(soup)
    prizes = _parse_prizes(soup, target_hackathon_url)

    return {
        "project_title": title,
        "project_url": project_url,
        "tagline": tagline,
        "preview_image_url": preview_image_url,
        "prizes": prizes,
        "team_members": team_members,
        "built_with": built_with,
        "external_links": external_links,
        "description_sections": description_sections,
    }
