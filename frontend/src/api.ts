import type {
  HackathonSearchResponse,
  SnapshotManifestV1,
  SnapshotShardV1,
  LookupCreateResponse,
  LookupJobResponse,
} from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const API_PREFIX = import.meta.env.VITE_API_PREFIX ?? "/api/v1";
const SNAPSHOT_MANIFEST_PATH = import.meta.env.VITE_SNAPSHOT_MANIFEST_PATH ?? "snapshots/manifest.json";

let snapshotManifestPromise: Promise<SnapshotManifestV1 | null> | null = null;
let snapshotManifestValue: SnapshotManifestV1 | null | undefined;
const snapshotShardPromiseByUrl = new Map<string, Promise<SnapshotShardV1 | null>>();
const snapshotShardValueByUrl = new Map<string, SnapshotShardV1 | null>();

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

export async function createLookup(hackathonUrl: string): Promise<LookupCreateResponse> {
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
  const searchParams = new URLSearchParams({
    query,
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

export function buildLookupWebSocketUrl(lookupId: string): string {
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
      const response = await fetch(buildSnapshotUrl(manifestEntry.shard_path), {
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
