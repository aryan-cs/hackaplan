import type {
  HackathonSearchSuggestion,
  HackathonSearchResponse,
  SnapshotManifestV1,
  SnapshotManifestEntryV1,
  SnapshotShardV1,
  LookupCreateResponse,
  LookupJobResponse,
} from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const API_PREFIX = import.meta.env.VITE_API_PREFIX ?? "/api/v1";
const SNAPSHOT_MANIFEST_PATH = import.meta.env.VITE_SNAPSHOT_MANIFEST_PATH ?? "snapshots/manifest.json";
const DEVPOST_SEARCH_API_URL = "https://devpost.com/api/hackathons";
const LIVE_LOOKUPS_ENABLED = resolveLiveLookupsEnabled();

let snapshotManifestPromise: Promise<SnapshotManifestV1 | null> | null = null;
let snapshotManifestValue: SnapshotManifestV1 | null | undefined;
const snapshotShardPromiseByUrl = new Map<string, Promise<SnapshotShardV1 | null>>();
const snapshotShardValueByUrl = new Map<string, SnapshotShardV1 | null>();

function resolveLiveLookupsEnabled(): boolean {
  const raw = import.meta.env.VITE_ENABLE_LIVE_LOOKUPS;
  if (typeof raw !== "string") {
    return true;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  return true;
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function guessHackathonTitleFromUrl(hackathonUrl: string): string {
  try {
    const parsed = new URL(hackathonUrl);
    const slug = parsed.hostname.split(".")[0] ?? "";
    const spaced = slug.replace(/[-_]+/g, " ").trim();
    if (!spaced) {
      return hackathonUrl;
    }
    return spaced.replace(/\b\w/g, (letter) => letter.toUpperCase());
  } catch {
    return hackathonUrl;
  }
}

function scoreSuggestion(query: string, suggestion: HackathonSearchSuggestion): number {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return -1;
  }

  const normalizedTitle = normalizeSearchText(suggestion.title);
  const normalizedUrl = normalizeSearchText(suggestion.hackathon_url);
  const compactQuery = normalizedQuery.replace(/\s+/g, "");
  const compactTitle = normalizedTitle.replace(/\s+/g, "");
  const compactUrl = normalizedUrl.replace(/\s+/g, "");

  if (normalizedTitle === normalizedQuery || normalizedUrl === normalizedQuery) {
    return 400;
  }
  if (compactQuery && (compactTitle === compactQuery || compactUrl === compactQuery)) {
    return 380;
  }
  if (normalizedTitle.startsWith(normalizedQuery)) {
    return 330;
  }
  if (compactQuery && compactTitle.startsWith(compactQuery)) {
    return 310;
  }
  if (normalizedTitle.includes(normalizedQuery)) {
    return 280;
  }
  if (normalizedUrl.includes(normalizedQuery)) {
    return 250;
  }
  if (compactQuery && (compactTitle.includes(compactQuery) || compactUrl.includes(compactQuery))) {
    return 220;
  }

  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (queryTokens.length > 1) {
    const allTokensMatch = queryTokens.every((token) => normalizedTitle.includes(token) || normalizedUrl.includes(token));
    if (allTokensMatch) {
      return 150;
    }
  }

  return -1;
}

function buildSuggestionFromManifestEntry(entry: SnapshotManifestEntryV1): HackathonSearchSuggestion {
  return {
    title:
      typeof entry.hackathon_title === "string" && entry.hackathon_title.trim().length > 0
        ? entry.hackathon_title.trim()
        : guessHackathonTitleFromUrl(entry.hackathon_url),
    hackathon_url: entry.hackathon_url,
  };
}

function dedupeSuggestionsByUrl(suggestions: HackathonSearchSuggestion[]): HackathonSearchSuggestion[] {
  const unique = new Map<string, HackathonSearchSuggestion>();
  for (const suggestion of suggestions) {
    if (!unique.has(suggestion.hackathon_url)) {
      unique.set(suggestion.hackathon_url, suggestion);
    }
  }
  return Array.from(unique.values());
}

function buildHttpUrl(path: string): string {
  return `${API_BASE_URL}${API_PREFIX}${path}`;
}

function buildSnapshotBaseUrl(): string {
  const configured = import.meta.env.VITE_SNAPSHOT_BASE_URL;
  const runtimeOrigin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
  if (configured && configured.trim().length > 0) {
    return new URL(configured, runtimeOrigin).toString();
  }
  return new URL(import.meta.env.BASE_URL ?? "/", runtimeOrigin).toString();
}

function buildSnapshotUrl(path: string): string {
  const cleaned = path.replace(/^\/+/, "");
  return new URL(cleaned, buildSnapshotBaseUrl()).toString();
}

function resolveSnapshotAssetPath(path: string): string {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return trimmedPath;
  }

  if (/^https?:\/\//i.test(trimmedPath)) {
    return trimmedPath;
  }

  const cleaned = trimmedPath.replace(/^\/+/, "");
  const manifestPath = SNAPSHOT_MANIFEST_PATH.replace(/^\/+/, "");
  const manifestLastSlash = manifestPath.lastIndexOf("/");
  if (manifestLastSlash < 0) {
    return cleaned;
  }

  const manifestDir = manifestPath.slice(0, manifestLastSlash + 1);
  if (cleaned.startsWith(manifestDir)) {
    return cleaned;
  }

  return `${manifestDir}${cleaned}`;
}

function createAbortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function withAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      reject(createAbortError());
    };

    signal.addEventListener("abort", handleAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      },
    );
  });
}

function parseErrorMessage(error: unknown, fallback: string): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return fallback;
}

async function searchHackathonsFromSnapshots(query: string, limit: number): Promise<HackathonSearchResponse> {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return {
      query,
      suggestions: [],
    };
  }

  const manifest = await getSnapshotManifest();
  if (!manifest || !Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    return {
      query,
      suggestions: [],
    };
  }

  const scoredSuggestions = manifest.entries
    .map((entry) => {
      const suggestion = buildSuggestionFromManifestEntry(entry);
      return {
        suggestion,
        score: scoreSuggestion(query, suggestion),
      };
    })
    .filter((item) => item.score >= 0)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.suggestion.title.localeCompare(right.suggestion.title, undefined, { sensitivity: "base" });
    })
    .map((item) => item.suggestion);

  return {
    query,
    suggestions: dedupeSuggestionsByUrl(scoredSuggestions).slice(0, limit),
  };
}

async function searchHackathonsFromDevpost(query: string, limit: number): Promise<HackathonSearchResponse> {
  const response = await fetch(`${DEVPOST_SEARCH_API_URL}?${new URLSearchParams({ query, page: "1" }).toString()}`, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Devpost search failed with status ${response.status}.`);
  }

  const payload = await response.json();
  const rawHackathons = Array.isArray(payload?.hackathons) ? payload.hackathons : [];
  const suggestions: HackathonSearchSuggestion[] = [];

  for (const rawHackathon of rawHackathons) {
    if (typeof rawHackathon !== "object" || rawHackathon === null) {
      continue;
    }
    const candidate = rawHackathon as Record<string, unknown>;
    const rawUrl = typeof candidate.url === "string" ? candidate.url : "";
    const normalizedUrl = normalizeHackathonUrl(rawUrl);
    if (!normalizedUrl) {
      continue;
    }

    const title =
      typeof candidate.title === "string" && candidate.title.trim().length > 0
        ? candidate.title.trim()
        : guessHackathonTitleFromUrl(normalizedUrl);

    suggestions.push({
      title,
      hackathon_url: normalizedUrl,
      gallery_url: typeof candidate.projects_url === "string" ? candidate.projects_url : null,
      thumbnail_url: typeof candidate.thumbnail_url === "string" ? candidate.thumbnail_url : null,
      open_state: typeof candidate.open_state === "string" ? candidate.open_state : null,
      winners_announced: typeof candidate.winners_announced === "boolean" ? candidate.winners_announced : null,
      submission_period_dates:
        typeof candidate.submission_period_dates === "string" ? candidate.submission_period_dates : null,
      organization_name: typeof candidate.organization_name === "string" ? candidate.organization_name : null,
    });
  }

  const ranked = dedupeSuggestionsByUrl(suggestions)
    .map((suggestion) => ({
      suggestion,
      score: scoreSuggestion(query, suggestion),
    }))
    .filter((item) => item.score >= 0)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return left.suggestion.title.localeCompare(right.suggestion.title, undefined, { sensitivity: "base" });
    })
    .map((item) => item.suggestion)
    .slice(0, limit);

  return {
    query,
    suggestions: ranked,
  };
}

export async function createLookup(hackathonUrl: string): Promise<LookupCreateResponse> {
  if (!LIVE_LOOKUPS_ENABLED) {
    throw new Error("Live lookup backend is disabled for this deployment.");
  }

  const response = await fetch(buildHttpUrl("/lookups"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ hackathon_url: hackathonUrl }),
  });

  const payload = await response.json();
  if (!response.ok) {
    const errorMessage =
      payload?.detail?.message ?? payload?.detail ?? parseErrorMessage(payload, "Failed to create lookup");
    throw new Error(errorMessage);
  }

  return payload as LookupCreateResponse;
}

export async function getLookup(lookupId: string): Promise<LookupJobResponse> {
  if (!LIVE_LOOKUPS_ENABLED) {
    throw new Error("Live lookup backend is disabled for this deployment.");
  }

  const response = await fetch(buildHttpUrl(`/lookups/${lookupId}`));
  const payload = await response.json();

  if (!response.ok) {
    const errorMessage =
      payload?.detail?.message ?? payload?.detail ?? parseErrorMessage(payload, "Failed to fetch lookup");
    throw new Error(errorMessage);
  }

  return payload as LookupJobResponse;
}

export async function searchHackathons(query: string, limit = 8): Promise<HackathonSearchResponse> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return {
      query,
      suggestions: [],
    };
  }

  const snapshotPayload = await searchHackathonsFromSnapshots(normalizedQuery, limit);
  if (snapshotPayload.suggestions.length > 0) {
    return snapshotPayload;
  }

  if (LIVE_LOOKUPS_ENABLED) {
    const searchParams = new URLSearchParams({
      query: normalizedQuery,
      limit: String(limit),
    });
    const response = await fetch(buildHttpUrl(`/hackathons/search?${searchParams.toString()}`));
    const payload = await response.json();

    if (!response.ok) {
      const errorMessage =
        payload?.detail?.message ?? payload?.detail ?? parseErrorMessage(payload, "Failed to search hackathons");
      throw new Error(errorMessage);
    }

    return payload as HackathonSearchResponse;
  }

  try {
    return await searchHackathonsFromDevpost(normalizedQuery, limit);
  } catch (error) {
    const parsedMessage = parseErrorMessage(error, "");
    if (/failed to fetch|networkerror/i.test(parsedMessage)) {
      throw new Error("No cached results found and Devpost browser search is unavailable (likely CORS restrictions).");
    }
    throw new Error(
      parsedMessage || "No cached results found and Devpost browser search is unavailable (likely CORS restrictions).",
    );
  }
}

export function buildLookupWebSocketUrl(lookupId: string): string {
  if (!LIVE_LOOKUPS_ENABLED) {
    return "";
  }

  const raw = buildHttpUrl(`/lookups/${lookupId}/ws`);
  if (raw.startsWith("https://")) {
    return `wss://${raw.slice("https://".length)}`;
  }
  if (raw.startsWith("http://")) {
    return `ws://${raw.slice("http://".length)}`;
  }
  return raw;
}

function normalizeHackathonUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const prefixed = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(prefixed);
    if (!parsed.hostname.toLowerCase().endsWith("devpost.com")) {
      return null;
    }

    const cleanedPath = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.host}${cleanedPath}`;
  } catch {
    return null;
  }
}

function isSnapshotManifestV1(value: unknown): value is SnapshotManifestV1 {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate.version === "v1" && Array.isArray(candidate.entries);
}

function isSnapshotShardV1(value: unknown): value is SnapshotShardV1 {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate.version === "v1" && typeof candidate.hackathon_url === "string" && typeof candidate.result === "object";
}

export async function getSnapshotManifest(options?: {
  signal?: AbortSignal;
  forceReload?: boolean;
}): Promise<SnapshotManifestV1 | null> {
  const forceReload = options?.forceReload === true;
  if (!forceReload && snapshotManifestValue !== undefined) {
    return snapshotManifestValue;
  }

  if (!forceReload && snapshotManifestPromise) {
    return withAbortSignal(snapshotManifestPromise, options?.signal);
  }

  snapshotManifestPromise = (async () => {
    try {
      const response = await fetch(buildSnapshotUrl(SNAPSHOT_MANIFEST_PATH), {
        cache: "no-cache",
      });
      if (response.status === 404) {
        snapshotManifestValue = null;
        return null;
      }
      if (!response.ok) {
        snapshotManifestValue = null;
        return null;
      }

      const payload = await response.json();
      if (!isSnapshotManifestV1(payload)) {
        snapshotManifestValue = null;
        return null;
      }

      snapshotManifestValue = payload;
      return payload;
    } catch {
      snapshotManifestValue = null;
      return null;
    } finally {
      snapshotManifestPromise = null;
    }
  })();

  return withAbortSignal(snapshotManifestPromise, options?.signal);
}

export async function getSnapshotShard(
  hackathonUrl: string,
  options?: {
    manifest?: SnapshotManifestV1 | null;
    signal?: AbortSignal;
    forceReload?: boolean;
  },
): Promise<SnapshotShardV1 | null> {
  const normalizedUrl = normalizeHackathonUrl(hackathonUrl);
  if (!normalizedUrl) {
    return null;
  }

  if (!options?.forceReload && snapshotShardValueByUrl.has(normalizedUrl)) {
    return snapshotShardValueByUrl.get(normalizedUrl) ?? null;
  }

  const manifest = options?.manifest ?? (await getSnapshotManifest({ signal: options?.signal }));
  if (!manifest || manifest.entries.length === 0) {
    snapshotShardValueByUrl.set(normalizedUrl, null);
    return null;
  }

  const manifestEntry = manifest.entries.find((entry) => normalizeHackathonUrl(entry.hackathon_url) === normalizedUrl);
  if (!manifestEntry) {
    snapshotShardValueByUrl.set(normalizedUrl, null);
    return null;
  }

  if (!options?.forceReload) {
    const inFlight = snapshotShardPromiseByUrl.get(normalizedUrl);
    if (inFlight) {
      return withAbortSignal(inFlight, options?.signal);
    }
  }

  const shardPromise = (async () => {
    try {
      const resolvedShardPath = resolveSnapshotAssetPath(manifestEntry.shard_path);
      const response = await fetch(buildSnapshotUrl(resolvedShardPath), {
        cache: "force-cache",
      });
      if (response.status === 404 || !response.ok) {
        snapshotShardValueByUrl.set(normalizedUrl, null);
        return null;
      }

      const payload = await response.json();
      if (!isSnapshotShardV1(payload)) {
        snapshotShardValueByUrl.set(normalizedUrl, null);
        return null;
      }

      const payloadUrl = normalizeHackathonUrl(payload.hackathon_url);
      if (!payloadUrl || payloadUrl !== normalizedUrl) {
        snapshotShardValueByUrl.set(normalizedUrl, null);
        return null;
      }

      snapshotShardValueByUrl.set(normalizedUrl, payload);
      return payload;
    } catch {
      snapshotShardValueByUrl.set(normalizedUrl, null);
      return null;
    } finally {
      snapshotShardPromiseByUrl.delete(normalizedUrl);
    }
  })();

  snapshotShardPromiseByUrl.set(normalizedUrl, shardPromise);
  return withAbortSignal(shardPromise, options?.signal);
}

export function isLiveLookupEnabled(): boolean {
  return LIVE_LOOKUPS_ENABLED;
}
