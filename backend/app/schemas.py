from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


LookupStatus = Literal["queued", "started", "completed", "failed"]


class LookupCreateRequest(BaseModel):
    hackathon_url: str = Field(min_length=5, max_length=2048)


class LookupCreateResponse(BaseModel):
    lookup_id: str
    status: LookupStatus


class ScrapeError(BaseModel):
    code: str
    message: str


class ProgressEvent(BaseModel):
    event_type: str
    timestamp: str
    payload: dict[str, Any]


class PrizeAward(BaseModel):
    hackathon_name: str
    hackathon_url: str | None = None
    prize_name: str


class TeamMember(BaseModel):
    name: str
    profile_url: str | None = None


class TechTag(BaseModel):
    name: str
    url: str | None = None


class ExternalLink(BaseModel):
    label: str
    url: str


class DescriptionSection(BaseModel):
    heading: str
    content: str


class WinnerProject(BaseModel):
    project_title: str
    project_url: str
    tagline: str | None = None
    preview_image_url: str | None = None
    prizes: list[PrizeAward]
    team_members: list[TeamMember]
    built_with: list[TechTag]
    external_links: list[ExternalLink]
    description_sections: list[DescriptionSection]


class HackathonMetadata(BaseModel):
    name: str
    url: str
    gallery_url: str
    scanned_pages: int
    scanned_projects: int
    winner_count: int


class HackathonResult(BaseModel):
    hackathon: HackathonMetadata
    winners: list[WinnerProject]
    generated_at: str


class LookupJobResponse(BaseModel):
    lookup_id: str
    hackathon_url: str
    status: LookupStatus
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    error: ScrapeError | None = None
    progress_events: list[ProgressEvent]
    result: HackathonResult | None = None


class HackathonSearchSuggestion(BaseModel):
    title: str
    hackathon_url: str
    gallery_url: str | None = None
    thumbnail_url: str | None = None
    open_state: str | None = None
    winners_announced: bool | None = None
    submission_period_dates: str | None = None
    organization_name: str | None = None


class HackathonSearchResponse(BaseModel):
    query: str
    suggestions: list[HackathonSearchSuggestion]
