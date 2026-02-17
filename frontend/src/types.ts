export type LookupStatus = "queued" | "started" | "completed" | "failed";

export interface LookupCreateResponse {
  lookup_id: string;
  status: LookupStatus;
}

export interface ScrapeError {
  code: string;
  message: string;
}

export interface ProgressEvent {
  event_type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface PrizeAward {
  hackathon_name: string;
  hackathon_url?: string | null;
  prize_name: string;
}

export interface TeamMember {
  name: string;
  profile_url?: string | null;
}

export interface TechTag {
  name: string;
  url?: string | null;
}

export interface ExternalLink {
  label: string;
  url: string;
}

export interface DescriptionSection {
  heading: string;
  content: string;
}

export interface WinnerProject {
  project_title: string;
  project_url: string;
  tagline?: string | null;
  preview_image_url?: string | null;
  prizes: PrizeAward[];
  team_members: TeamMember[];
  built_with: TechTag[];
  external_links: ExternalLink[];
  description_sections: DescriptionSection[];
}

export interface HackathonMetadata {
  name: string;
  url: string;
  gallery_url: string;
  scanned_pages: number;
  scanned_projects: number;
  winner_count: number;
}

export interface HackathonResult {
  hackathon: HackathonMetadata;
  winners: WinnerProject[];
  generated_at: string;
}

export interface LookupJobResponse {
  lookup_id: string;
  hackathon_url: string;
  status: LookupStatus;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  error?: ScrapeError | null;
  progress_events: ProgressEvent[];
  result?: HackathonResult | null;
}

export interface HackathonSearchSuggestion {
  title: string;
  hackathon_url: string;
  gallery_url?: string | null;
  thumbnail_url?: string | null;
  open_state?: string | null;
  winners_announced?: boolean | null;
  submission_period_dates?: string | null;
  organization_name?: string | null;
}

export interface HackathonSearchResponse {
  query: string;
  suggestions: HackathonSearchSuggestion[];
}

export interface SnapshotManifestEntryV1 {
  hackathon_url: string;
  hackathon_title?: string;
  shard_path: string;
  generated_at: string;
  winner_count: number;
  scanned_pages: number;
  scanned_projects: number;
}

export interface SnapshotManifestV1 {
  version: "v1";
  generated_at: string;
  source_commit: string;
  scope: Record<string, unknown>;
  entries: SnapshotManifestEntryV1[];
}

export interface SnapshotShardV1 {
  version: "v1";
  hackathon_url: string;
  generated_at: string;
  result: HackathonResult;
}
