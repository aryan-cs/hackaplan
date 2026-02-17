import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  buildLookupWebSocketUrl,
  createLookup,
  getLookup,
  getSnapshotManifest,
  getSnapshotShard,
  isLiveLookupEnabled,
  searchHackathons,
} from "./api";
import type {
  HackathonResult,
  HackathonSearchSuggestion,
  LookupJobResponse,
  ProgressEvent,
  SnapshotManifestV1,
  WinnerProject,
} from "./types";

type SearchAutocompleteOption =
  | {
      kind: "search_all";
      key: string;
      title: string;
      subtitle: string;
      query: string;
    }
  | {
      kind: "suggestion";
      key: string;
      suggestion: HackathonSearchSuggestion;
    };

type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "hackaplan-theme";
const LIVE_LOOKUPS_ENABLED = isLiveLookupEnabled();

function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === "dark" || storedTheme === "light") {
    return storedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function ThemeToggleIcon({ theme }: { theme: ThemeMode }) {
  if (theme === "light") {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        height="24px"
        viewBox="0 -960 960 960"
        width="24px"
        fill="#e3e3e3"
        aria-hidden="true"
      >
        <path d="M480-120q-150 0-255-105T120-480q0-150 105-255t255-105q14 0 27.5 1t26.5 3q-41 29-65.5 75.5T444-660q0 90 63 153t153 63q55 0 101-24.5t75-65.5q2 13 3 26.5t1 27.5q0 150-105 255T480-120Zm0-80q88 0 158-48.5T740-375q-20 5-40 8t-40 3q-123 0-209.5-86.5T364-660q0-20 3-40t8-40q-78 32-126.5 102T200-480q0 116 82 198t198 82Zm-10-270Z" />
      </svg>
    );
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      height="24px"
      viewBox="0 -960 960 960"
      width="24px"
      fill="#e3e3e3"
      aria-hidden="true"
    >
      <path d="M565-395q35-35 35-85t-35-85q-35-35-85-35t-85 35q-35 35-35 85t35 85q35 35 85 35t85-35Zm-226.5 56.5Q280-397 280-480t58.5-141.5Q397-680 480-680t141.5 58.5Q680-563 680-480t-58.5 141.5Q563-280 480-280t-141.5-58.5ZM200-440H40v-80h160v80Zm720 0H760v-80h160v80ZM440-760v-160h80v160h-80Zm0 720v-160h80v160h-80ZM256-650l-101-97 57-59 96 100-52 56Zm492 496-97-101 53-55 101 97-57 59Zm-98-550 97-101 59 57-100 96-56-52ZM154-212l101-97 55 53-97 101-59-57Zm326-268Z" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" height="22px" viewBox="0 -960 960 960" width="22px" aria-hidden="true">
      <path d="M240-200h160v-240h160v240h160v-360L480-740 240-560v360Zm-80 80v-480l320-240 320 240v480H480v-240h-80v240H160Zm320-350Z" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" height="22px" viewBox="0 -960 960 960" width="22px" aria-hidden="true">
      <path d="M478-240q17 0 29.5-12.5T520-282q0-17-12.5-29.5T478-324q-17 0-29.5 12.5T436-282q0 17 12.5 29.5T478-240Zm-36-154h74q0-35 12.5-58.5T574-498q35-33 48.5-58t13.5-55q0-61-40-99.5T484-749q-56 0-95 27t-58 79l66 26q9-30 30-48t53-18q35 0 56.5 18.5T558-611q0 23-12.5 40.5T506-531q-35 30-49.5 62T442-394Zm36 314q-82 0-155-31.5t-127.5-86Q141-252 109.5-325T78-480q0-83 31.5-156t86-127.5Q250-818 323-849.5T478-881q83 0 156 31.5t127.5 86Q816-709 847.5-636T879-480q0 82-31.5 155T761-197.5Q707-143 634-111.5T478-80Zm2-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z" />
    </svg>
  );
}

function RobotIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" height="22px" viewBox="0 -960 960 960" width="22px" aria-hidden="true">
      <path d="M400-480q33 0 56.5-23.5T480-560q0-33-23.5-56.5T400-640q-33 0-56.5 23.5T320-560q0 33 23.5 56.5T400-480Zm160 0q33 0 56.5-23.5T640-560q0-33-23.5-56.5T560-640q-33 0-56.5 23.5T480-560q0 33 23.5 56.5T560-480ZM320-280h320v-80H320v80Zm160-440q-17 0-28.5-11.5T440-760v-40l-50-50 28-28 62 62v56h80v-56l62-62 28 28-50 50v40q0 17-11.5 28.5T560-720h-80Zm-200 80h400q33 0 56.5 23.5T760-560v280q0 33-23.5 56.5T680-200h-40v80h-80v-80H400v80h-80v-80h-40q-33 0-56.5-23.5T200-280v-280q0-33 23.5-56.5T280-640Z" />
    </svg>
  );
}

function ActionButtons({
  className,
  theme,
  nextThemeLabel,
  onGoHome,
  onOpenHelp,
  onOpenRobot,
  onToggleTheme,
}: {
  className: string;
  theme: ThemeMode;
  nextThemeLabel: ThemeMode;
  onGoHome: () => void;
  onOpenHelp: () => void;
  onOpenRobot: () => void;
  onToggleTheme: () => void;
}) {
  return (
    <nav className={className} aria-label="Actions">
      <button type="button" className="home-button" onClick={onGoHome} aria-label="Home" title="Home">
        <HomeIcon />
      </button>
      <button type="button" className="help-button" onClick={onOpenHelp} aria-label="Help" title="Help">
        <HelpIcon />
      </button>
      <button type="button" className="robot-button" onClick={onOpenRobot} aria-label="GitHub" title="GitHub">
        <RobotIcon />
      </button>
      <button
        type="button"
        className="theme-toggle"
        onClick={onToggleTheme}
        aria-label={`Switch to ${nextThemeLabel} mode`}
        title={`Switch to ${nextThemeLabel} mode`}
      >
        <ThemeToggleIcon theme={theme} />
      </button>
    </nav>
  );
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

function normalizeDevpostHackathonUrl(value: string): string | null {
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

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function extractYearFromText(value: string): number | null {
  const match = value.match(/\b(19|20)\d{2}\b/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function sortSuggestionsByNewestYear(suggestions: HackathonSearchSuggestion[]): HackathonSearchSuggestion[] {
  return [...suggestions].sort((left, right) => {
    const leftYear = extractYearFromText(`${left.title} ${left.hackathon_url}`) ?? -1;
    const rightYear = extractYearFromText(`${right.title} ${right.hackathon_url}`) ?? -1;

    if (leftYear !== rightYear) {
      return rightYear - leftYear;
    }

    return right.title.localeCompare(left.title, undefined, { sensitivity: "base" });
  });
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

function parseWinnerProjectValue(value: unknown): WinnerProject | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.project_title !== "string" || typeof candidate.project_url !== "string") {
    return null;
  }

  return {
    project_title: candidate.project_title,
    project_url: candidate.project_url,
    tagline: typeof candidate.tagline === "string" ? candidate.tagline : null,
    preview_image_url: typeof candidate.preview_image_url === "string" ? candidate.preview_image_url : null,
    prizes: Array.isArray(candidate.prizes) ? (candidate.prizes as WinnerProject["prizes"]) : [],
    team_members: Array.isArray(candidate.team_members) ? (candidate.team_members as WinnerProject["team_members"]) : [],
    built_with: Array.isArray(candidate.built_with) ? (candidate.built_with as WinnerProject["built_with"]) : [],
    external_links: Array.isArray(candidate.external_links)
      ? (candidate.external_links as WinnerProject["external_links"])
      : [],
    description_sections: Array.isArray(candidate.description_sections)
      ? (candidate.description_sections as WinnerProject["description_sections"])
      : [],
  };
}

function progressEventKey(event: ProgressEvent): string {
  return `${event.timestamp}:${event.event_type}:${JSON.stringify(event.payload)}`;
}

function mergeProgressEvents(baseEvents: ProgressEvent[], incomingEvents: ProgressEvent[]): ProgressEvent[] {
  const seen = new Set(baseEvents.map(progressEventKey));
  const merged = [...baseEvents];

  for (const event of incomingEvents) {
    const key = progressEventKey(event);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(event);
  }

  merged.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  return merged;
}

function LoadingSpinner({ small = false }: { small?: boolean }) {
  return <span className={small ? "loading-spinner small" : "loading-spinner"} aria-hidden="true" />;
}

function WinnerCard({
  winner,
}: {
  winner: WinnerProject;
}) {
  const prizeLabel = winner.prizes.map((prize) => prize.prize_name).join(" - ") || "Winner";
  const taglineText = winner.tagline ? winner.tagline.replace(/\s+/g, " ").trim() : null;
  const hasPreviewImage = Boolean(winner.preview_image_url);
  const [imageLoaded, setImageLoaded] = useState(!hasPreviewImage);
  const [imageFailed, setImageFailed] = useState(false);
  const [isTitleOverflowing, setIsTitleOverflowing] = useState(false);
  const [isPrizeOverflowing, setIsPrizeOverflowing] = useState(false);
  const titleLinkRef = useRef<HTMLAnchorElement | null>(null);
  const titleStaticRef = useRef<HTMLSpanElement | null>(null);
  const prizeChipRef = useRef<HTMLSpanElement | null>(null);
  const prizeStaticRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const hasImage = Boolean(winner.preview_image_url);
    setImageLoaded(!hasImage);
    setImageFailed(false);
  }, [winner.preview_image_url, winner.project_url]);

  useEffect(() => {
    const titleLink = titleLinkRef.current;
    const titleStatic = titleStaticRef.current;
    if (!titleLink || !titleStatic) {
      setIsTitleOverflowing(false);
      return;
    }

    let frame = 0;
    const measureOverflow = () => {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        const availableTextWidth = Math.max(titleLink.clientWidth, 0);
        const contentWidth = titleStatic.scrollWidth;
        const overflowing = contentWidth - availableTextWidth > 0.25;
        setIsTitleOverflowing((previous) => (previous === overflowing ? previous : overflowing));
      });
    };

    measureOverflow();
    const resizeObserver = new ResizeObserver(measureOverflow);
    resizeObserver.observe(titleLink);
    resizeObserver.observe(titleStatic);

    if ("fonts" in document) {
      void document.fonts.ready.then(measureOverflow);
    }

    return () => {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      resizeObserver.disconnect();
    };
  }, [winner.project_title]);

  useEffect(() => {
    const chip = prizeChipRef.current;
    const staticText = prizeStaticRef.current;
    if (!chip || !staticText) {
      setIsPrizeOverflowing(false);
      return;
    }

    let frame = 0;
    const measureOverflow = () => {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        const chipStyles = getComputedStyle(chip);
        const horizontalPadding =
          (Number.parseFloat(chipStyles.paddingLeft) || 0) + (Number.parseFloat(chipStyles.paddingRight) || 0);
        const availableTextWidth = Math.max(chip.clientWidth - horizontalPadding, 0);
        const overflowing = staticText.scrollWidth > availableTextWidth + 1;
        setIsPrizeOverflowing((previous) => (previous === overflowing ? previous : overflowing));
      });
    };

    measureOverflow();
    const resizeObserver = new ResizeObserver(measureOverflow);
    resizeObserver.observe(chip);
    resizeObserver.observe(staticText);

    if ("fonts" in document) {
      void document.fonts.ready.then(measureOverflow);
    }

    return () => {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      resizeObserver.disconnect();
    };
  }, [prizeLabel]);

  const canAttemptImageLoad = hasPreviewImage && !imageFailed;

  return (
    <article className="winner-image-card">
      <a href={winner.project_url} target="_blank" rel="noreferrer" className="winner-image-link">
        <div className="winner-image-frame">
          {canAttemptImageLoad ? (
            <>
              {!imageLoaded ? (
                <div className="winner-image-loader">
                  <LoadingSpinner />
                </div>
              ) : null}
              <img
                src={winner.preview_image_url ?? undefined}
                alt={winner.project_title}
                loading="lazy"
                className={imageLoaded ? "" : "loading"}
                onLoad={() => {
                  setImageLoaded(true);
                }}
                onError={() => {
                  setImageLoaded(true);
                  setImageFailed(true);
                }}
              />
            </>
          ) : (
            <div className="winner-image-placeholder">
              <LoadingSpinner />
            </div>
          )}
        </div>
      </a>

      <div className="winner-image-meta">
        <a
          href={winner.project_url}
          target="_blank"
          rel="noreferrer"
          className={isTitleOverflowing ? "winner-title-link is-overflowing" : "winner-title-link"}
          title={winner.project_title}
          ref={titleLinkRef}
        >
          <span className="winner-title-static" ref={titleStaticRef}>
            {winner.project_title}
          </span>
          {isTitleOverflowing ? (
            <span className="winner-title-marquee" aria-hidden="true">
              <span>{winner.project_title}</span>
              <span>{winner.project_title}</span>
            </span>
          ) : null}
        </a>
        {taglineText ? <p className="winner-tagline">{taglineText}</p> : null}
        <span
          className={isPrizeOverflowing ? "winner-prize is-overflowing" : "winner-prize"}
          title={prizeLabel}
          ref={prizeChipRef}
        >
          <span className="winner-prize-static" ref={prizeStaticRef}>
            {prizeLabel}
          </span>
          <span className="winner-prize-marquee" aria-hidden="true">
            <span>{prizeLabel}</span>
            <span>{prizeLabel}</span>
          </span>
        </span>
      </div>
    </article>
  );
}

function LookupResultSection({
  suggestion,
  snapshotManifest,
  liveLookupsEnabled,
}: {
  suggestion: HackathonSearchSuggestion;
  snapshotManifest: SnapshotManifestV1 | null;
  liveLookupsEnabled: boolean;
}) {
  const [lookupId, setLookupId] = useState<string | null>(null);
  const [lookup, setLookup] = useState<LookupJobResponse | null>(null);
  const [progressEvents, setProgressEvents] = useState<ProgressEvent[]>([]);
  const [isLookupSubmitting, setIsLookupSubmitting] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [isWebSocketConnected, setIsWebSocketConnected] = useState(false);
  const [snapshotResult, setSnapshotResult] = useState<HackathonResult | null>(null);
  const [snapshotGeneratedAt, setSnapshotGeneratedAt] = useState<string | null>(null);
  const [snapshotStatus, setSnapshotStatus] = useState<"idle" | "loading" | "loaded" | "missing" | "error">("idle");

  const isTerminal = lookup?.status === "completed" || lookup?.status === "failed";
  const isLookupRunning =
    liveLookupsEnabled && (isLookupSubmitting || lookup?.status === "queued" || lookup?.status === "started");

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function loadSnapshot(): Promise<void> {
      setSnapshotResult(null);
      setSnapshotGeneratedAt(null);
      setSnapshotStatus("loading");

      try {
        const shard = await getSnapshotShard(suggestion.hackathon_url, {
          manifest: snapshotManifest,
          signal: controller.signal,
        });
        if (cancelled) {
          return;
        }

        if (!shard) {
          setSnapshotStatus("missing");
          return;
        }

        setSnapshotResult(shard.result);
        setSnapshotGeneratedAt(shard.generated_at);
        setSnapshotStatus("loaded");
      } catch (error) {
        if (cancelled) {
          return;
        }
        if ((error as { name?: string }).name === "AbortError") {
          return;
        }
        setSnapshotStatus("error");
      }
    }

    void loadSnapshot();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [snapshotManifest, suggestion.hackathon_url]);

  useEffect(() => {
    if (!liveLookupsEnabled) {
      setIsLookupSubmitting(false);
      setLookupError(null);
      setLookupId(null);
      setLookup(null);
      setProgressEvents([]);
      setIsWebSocketConnected(false);
      return;
    }

    let cancelled = false;

    async function startLookupForSection(): Promise<void> {
      setIsLookupSubmitting(true);
      setLookupError(null);
      setLookupId(null);
      setLookup(null);
      setProgressEvents([]);
      setIsWebSocketConnected(false);

      try {
        const createResponse = await createLookup(suggestion.hackathon_url);
        if (cancelled) {
          return;
        }

        setLookupId(createResponse.lookup_id);
        const payload = await getLookup(createResponse.lookup_id);
        if (cancelled) {
          return;
        }
        setLookup(payload);
        setProgressEvents(payload.progress_events);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setLookupError(parseErrorMessage(error, "Failed to start winner lookup."));
      } finally {
        if (!cancelled) {
          setIsLookupSubmitting(false);
        }
      }
    }

    void startLookupForSection();

    return () => {
      cancelled = true;
    };
  }, [liveLookupsEnabled, suggestion.hackathon_url]);

  useEffect(() => {
    if (!liveLookupsEnabled || !lookupId || isTerminal || isWebSocketConnected) {
      return;
    }

    let cancelled = false;
    const interval = window.setInterval(async () => {
      try {
        const payload = await getLookup(lookupId);
        if (cancelled) {
          return;
        }
        setLookup(payload);
        setProgressEvents((previous) => mergeProgressEvents(previous, payload.progress_events));
      } catch {
        // Keep polling on transient failures.
      }
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isTerminal, isWebSocketConnected, liveLookupsEnabled, lookupId]);

  useEffect(() => {
    if (!liveLookupsEnabled || !lookupId || isTerminal) {
      return;
    }

    let cancelled = false;
    const socket = new WebSocket(buildLookupWebSocketUrl(lookupId));
    socket.onopen = () => {
      if (!cancelled) {
        setIsWebSocketConnected(true);
      }
    };
    socket.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as ProgressEvent;
        if (cancelled) {
          return;
        }
        setProgressEvents((previous) => mergeProgressEvents(previous, [event]));
        if (event.event_type === "completed" || event.event_type === "failed") {
          void (async () => {
            try {
              const payload = await getLookup(lookupId);
              if (cancelled) {
                return;
              }
              setLookup(payload);
              setProgressEvents((previous) => mergeProgressEvents(previous, payload.progress_events));
            } catch {
              // Poll fallback will recover if this fetch fails.
            }
          })();
        }
      } catch {
        // Ignore malformed event payloads.
      }
    };
    socket.onerror = () => {
      if (!cancelled) {
        setIsWebSocketConnected(false);
      }
    };
    socket.onclose = () => {
      if (!cancelled) {
        setIsWebSocketConnected(false);
      }
    };

    return () => {
      cancelled = true;
      setIsWebSocketConnected(false);
      socket.close();
    };
  }, [lookupId, isTerminal, liveLookupsEnabled]);

  const streamedWinners = useMemo(() => {
    const winnersByUrl = new Map<string, WinnerProject>();

    const ensureWinner = (
      projectUrl: string,
      projectTitle: string,
      patch?: Partial<WinnerProject>,
    ): WinnerProject => {
      const existing = winnersByUrl.get(projectUrl);
      const nextWinner: WinnerProject = {
        project_title: patch?.project_title ?? existing?.project_title ?? projectTitle,
        project_url: projectUrl,
        tagline: patch?.tagline ?? existing?.tagline ?? null,
        preview_image_url: patch?.preview_image_url ?? existing?.preview_image_url ?? null,
        prizes: patch?.prizes ?? existing?.prizes ?? [],
        team_members: patch?.team_members ?? existing?.team_members ?? [],
        built_with: patch?.built_with ?? existing?.built_with ?? [],
        external_links: patch?.external_links ?? existing?.external_links ?? [],
        description_sections: patch?.description_sections ?? existing?.description_sections ?? [],
      };
      winnersByUrl.set(projectUrl, nextWinner);
      return nextWinner;
    };

    for (const progressEvent of progressEvents) {
      if (progressEvent.event_type === "winner_project_found") {
        const title = progressEvent.payload.project_title;
        const projectUrl = progressEvent.payload.project_url;
        const previewImageUrl = progressEvent.payload.preview_image_url;
        if (typeof title === "string" && typeof projectUrl === "string") {
          ensureWinner(projectUrl, title, {
            preview_image_url: typeof previewImageUrl === "string" ? previewImageUrl : undefined,
          });
        }
        continue;
      }

      if (progressEvent.event_type !== "winner_project_scraped") {
        continue;
      }

      const detailedWinner = parseWinnerProjectValue(progressEvent.payload.winner_project);
      if (detailedWinner) {
        ensureWinner(detailedWinner.project_url, detailedWinner.project_title, detailedWinner);
        continue;
      }

      const title = progressEvent.payload.project_title;
      const projectUrl = progressEvent.payload.project_url;
      const previewImageUrl = progressEvent.payload.preview_image_url;
      if (typeof title !== "string" || typeof projectUrl !== "string") {
        continue;
      }

      ensureWinner(projectUrl, title, {
        preview_image_url: typeof previewImageUrl === "string" ? previewImageUrl : undefined,
      });
    }

    return Array.from(winnersByUrl.values());
  }, [progressEvents]);

  const liveResult = lookup?.result ?? null;
  const result = liveResult ?? snapshotResult;
  const visibleWinners = useMemo(() => {
    if (liveResult) {
      const streamedByUrl = new Map(streamedWinners.map((winner) => [winner.project_url, winner]));
      return liveResult.winners.map((winner) => {
        const streamed = streamedByUrl.get(winner.project_url);
        if (!streamed) {
          return winner;
        }
        return {
          ...streamed,
          ...winner,
          preview_image_url: winner.preview_image_url ?? streamed.preview_image_url ?? null,
        };
      });
    }

    if (snapshotResult) {
      return snapshotResult.winners;
    }

    if (!result) {
      return streamedWinners;
    }

    return streamedWinners;
  }, [liveResult, result, snapshotResult, streamedWinners]);

  const displayHackathonName = result ? result.hackathon.name : suggestion.title;
  const displayHackathonUrl = result ? result.hackathon.url : suggestion.hackathon_url;
  const snapshotHintVisible =
    liveLookupsEnabled && snapshotStatus === "loaded" && snapshotResult !== null && liveResult === null && isLookupRunning;
  const liveFailureMessage =
    liveLookupsEnabled && (lookup?.status === "failed" || lookupError)
      ? lookup?.error?.message ?? lookupError ?? "Lookup failed unexpectedly."
      : null;
  const hasSnapshotFallback = snapshotResult !== null;
  const showEmptyState = result !== null && result.winners.length === 0 && !isLookupRunning && snapshotStatus !== "loading";
  const showSnapshotMiss =
    !liveLookupsEnabled && snapshotStatus === "missing" && snapshotResult === null && visibleWinners.length === 0;
  const showSnapshotError =
    !liveLookupsEnabled && snapshotStatus === "error" && snapshotResult === null && visibleWinners.length === 0;
  const showSnapshotLoading =
    !liveLookupsEnabled && (snapshotStatus === "idle" || snapshotStatus === "loading") && visibleWinners.length === 0;
  const showPrimarySpinner =
    (isLookupRunning || showSnapshotLoading) &&
    visibleWinners.length === 0 &&
    !(snapshotStatus === "loaded" && snapshotResult !== null && snapshotResult.winners.length > 0);

  return (
    <section className="lookup-section">
      <section className="results-meta">
        <h2>
          {displayHackathonUrl ? (
            <a href={displayHackathonUrl} target="_blank" rel="noreferrer" className="hackathon-title-link">
              <span>{displayHackathonName}</span>
              <svg className="hackathon-title-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" aria-hidden="true">
                <path d="M318-120q-82 0-140-58t-58-140q0-40 15-76t43-64l134-133 56 56-134 134q-17 17-25.5 38.5T200-318q0 49 34.5 83.5T318-200q23 0 45-8.5t39-25.5l133-134 57 57-134 133q-28 28-64 43t-76 15Zm79-220-57-57 223-223 57 57-223 223Zm251-28-56-57 134-133q17-17 25-38t8-44q0-50-34-85t-84-35q-23 0-44.5 8.5T558-726L425-592l-57-56 134-134q28-28 64-43t76-15q82 0 139.5 58T839-641q0 39-14.5 75T782-502L648-368Z" />
              </svg>
            </a>
          ) : (
            displayHackathonName
          )}
        </h2>
        {result ? (
          <p>
            {result.hackathon.winner_count} winners, {result.hackathon.scanned_projects} projects scanned across{" "}
            {result.hackathon.scanned_pages} page(s).
          </p>
        ) : (
          <p>
            {liveLookupsEnabled
              ? `${visibleWinners.length} winning project(s) loaded so far. More may appear while scanning.`
              : "Loading cached winners..."}
          </p>
        )}
        {snapshotHintVisible ? (
          <p className="snapshot-note">
            Snapshot loaded, refreshing live{snapshotGeneratedAt ? ` (snapshot generated ${new Date(snapshotGeneratedAt).toLocaleString()})` : ""}
            ...
          </p>
        ) : null}
      </section>

      {liveFailureMessage && hasSnapshotFallback ? (
        <p className="inline-warning">Live refresh failed. Showing snapshot data. Details: {liveFailureMessage}</p>
      ) : null}
      {liveFailureMessage && !hasSnapshotFallback ? <p className="inline-error">{liveFailureMessage}</p> : null}
      {showSnapshotMiss ? (
        <p className="inline-warning">
          This hackathon is not in the published snapshot cache yet. Add it via your manual snapshot export and redeploy GitHub Pages.
        </p>
      ) : null}
      {showSnapshotError ? <p className="inline-error">Unable to load cached snapshot for this hackathon.</p> : null}

      {showPrimarySpinner ? (
        <section className="inline-spinner-only lookup-section-spinner">
          <div className="loading-status-stack">
            <LoadingSpinner />
            <p className="loading-status-text">Searching...</p>
          </div>
        </section>
      ) : null}

      {showEmptyState ? (
        <section className="empty-state">
          <h2>No winners found</h2>
          <p>This hackathon did not expose winning entries in the scanned data.</p>
        </section>
      ) : null}

      {visibleWinners.length > 0 ? (
        <section className="winner-image-grid">
          {visibleWinners.map((winner) => {
            return <WinnerCard key={winner.project_url} winner={winner} />;
          })}
        </section>
      ) : null}

      {isLookupRunning && visibleWinners.length > 0 ? (
        <div className="cards-loading-indicator">
          <LoadingSpinner small />
        </div>
      ) : null}
    </section>
  );
}

export default function App() {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<HackathonSearchSuggestion[]>([]);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [lookupTargets, setLookupTargets] = useState<HackathonSearchSuggestion[]>([]);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [snapshotManifest, setSnapshotManifest] = useState<SnapshotManifestV1 | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());

  const closeSuggestionsTimeout = useRef<number | null>(null);
  const suggestionsDropdownRef = useRef<HTMLDivElement | null>(null);
  const suggestionOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const hasKeyboardSuggestionSelection = useRef(false);
  const lastLookupSubmission = useRef<{ signature: string; createdAt: number } | null>(null);

  const hasActiveSearch = lookupTargets.length > 0;
  const sortedSuggestions = useMemo(() => sortSuggestionsByNewestYear(suggestions), [suggestions]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const manifest = await getSnapshotManifest();
      if (!cancelled) {
        setSnapshotManifest(manifest);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const autocompleteOptions = useMemo<SearchAutocompleteOption[]>(() => {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 2) {
      return [];
    }

    const options: SearchAutocompleteOption[] = [];
    const isDirectUrl = normalizeDevpostHackathonUrl(trimmedQuery) !== null;
    if (!isDirectUrl && sortedSuggestions.length > 0) {
      options.push({
        kind: "search_all",
        key: `search-all:${normalizeSearchText(trimmedQuery)}`,
        title: `Search "${trimmedQuery}"`,
        subtitle: "Load all matching years",
        query: trimmedQuery,
      });
    }

    for (const suggestion of sortedSuggestions) {
      options.push({
        kind: "suggestion",
        key: `${suggestion.hackathon_url}:${suggestion.title}`,
        suggestion,
      });
    }

    return options;
  }, [query, sortedSuggestions]);

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < 2) {
      setIsSuggestionsOpen(false);
      setSuggestions([]);
      setActiveSuggestionIndex(-1);
      setSearchError(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setIsLoadingSuggestions(true);
      setSearchError(null);
      try {
        const payload = await searchHackathons(trimmed, 24);
        if (cancelled) {
          return;
        }
        setSuggestions(payload.suggestions);
        setActiveSuggestionIndex(payload.suggestions.length > 0 ? 0 : -1);
        hasKeyboardSuggestionSelection.current = false;
      } catch (error) {
        if (cancelled) {
          return;
        }
        setSuggestions([]);
        setActiveSuggestionIndex(-1);
        hasKeyboardSuggestionSelection.current = false;
        setSearchError(parseErrorMessage(error, "Failed to load autocomplete options."));
      } finally {
        if (!cancelled) {
          setIsLoadingSuggestions(false);
        }
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    return () => {
      if (closeSuggestionsTimeout.current !== null) {
        window.clearTimeout(closeSuggestionsTimeout.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isSuggestionsOpen || activeSuggestionIndex < 0) {
      return;
    }

    const activeOption = suggestionOptionRefs.current[activeSuggestionIndex];
    if (!activeOption) {
      return;
    }

    const dropdown = suggestionsDropdownRef.current;
    if (dropdown && !dropdown.contains(activeOption)) {
      return;
    }

    activeOption.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [activeSuggestionIndex, autocompleteOptions.length, isSuggestionsOpen]);

  useEffect(() => {
    if (autocompleteOptions.length === 0) {
      if (activeSuggestionIndex !== -1) {
        setActiveSuggestionIndex(-1);
      }
      return;
    }

    if (activeSuggestionIndex >= autocompleteOptions.length) {
      setActiveSuggestionIndex(autocompleteOptions.length - 1);
    }
  }, [activeSuggestionIndex, autocompleteOptions.length]);

  function applyLookupTargets(targets: HackathonSearchSuggestion[], options?: { queryValue?: string }): void {
    const deduped = dedupeSuggestionsByUrl(targets);
    if (deduped.length === 0) {
      setLookupError("No matching hackathons were found.");
      return;
    }

    const ordered = sortSuggestionsByNewestYear(deduped);
    const signature = ordered.map((target) => target.hackathon_url).join("|");
    const now = Date.now();
    if (
      lastLookupSubmission.current &&
      lastLookupSubmission.current.signature === signature &&
      now - lastLookupSubmission.current.createdAt < 1200
    ) {
      return;
    }
    lastLookupSubmission.current = { signature, createdAt: now };

    setLookupError(null);
    setLookupTargets(ordered);
    setQuery(options?.queryValue ?? query);
    setIsSuggestionsOpen(false);
    hasKeyboardSuggestionSelection.current = false;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    });
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const trimmedQuery = query.trim();
    const directUrl = normalizeDevpostHackathonUrl(query);
    if (directUrl) {
      applyLookupTargets(
        [
          {
            title: guessHackathonTitleFromUrl(directUrl),
            hackathon_url: directUrl,
          },
        ],
        { queryValue: directUrl },
      );
      return;
    }

    if (sortedSuggestions.length === 0) {
      setLookupError("Select a suggestion or enter a direct Devpost hackathon URL.");
      return;
    }

    const normalizedQuery = normalizeSearchText(trimmedQuery);
    const exactMatch = sortedSuggestions.find((suggestion) => {
      return (
        normalizeSearchText(suggestion.title) === normalizedQuery ||
        normalizeSearchText(suggestion.hackathon_url) === normalizedQuery
      );
    });
    if (exactMatch) {
      applyLookupTargets([exactMatch], { queryValue: exactMatch.title });
      return;
    }

    const requestedYear = extractYearFromText(trimmedQuery);
    if (requestedYear !== null) {
      const sameYearMatch = sortedSuggestions.find((suggestion) => {
        return extractYearFromText(`${suggestion.title} ${suggestion.hackathon_url}`) === requestedYear;
      });
      if (sameYearMatch) {
        applyLookupTargets([sameYearMatch], { queryValue: sameYearMatch.title });
        return;
      }
    }

    applyLookupTargets(sortedSuggestions, { queryValue: trimmedQuery });
  }

  function handleSuggestionPick(suggestion: HackathonSearchSuggestion): void {
    applyLookupTargets([suggestion], { queryValue: suggestion.title });
  }

  function handleSearchAllPick(queryValue?: string): void {
    if (sortedSuggestions.length === 0) {
      setLookupError("No matching hackathons were found.");
      return;
    }
    applyLookupTargets(sortedSuggestions, { queryValue: queryValue ?? query.trim() });
  }

  function handleAutocompleteOptionPick(option: SearchAutocompleteOption): void {
    if (option.kind === "search_all") {
      handleSearchAllPick(option.query);
      return;
    }
    handleSuggestionPick(option.suggestion);
  }

  function handleQueryChange(value: string): void {
    setQuery(value);
    setLookupError(null);
    setIsSuggestionsOpen(value.trim().length >= 2);
    hasKeyboardSuggestionSelection.current = false;
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (
      event.key === "Enter" &&
      isSuggestionsOpen &&
      hasKeyboardSuggestionSelection.current &&
      activeSuggestionIndex >= 0 &&
      autocompleteOptions.length > 0
    ) {
      event.preventDefault();
      const selected = autocompleteOptions[activeSuggestionIndex] ?? autocompleteOptions[0];
      if (selected) {
        handleAutocompleteOptionPick(selected);
      }
      return;
    }

    if (autocompleteOptions.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsSuggestionsOpen(true);
      hasKeyboardSuggestionSelection.current = true;
      setActiveSuggestionIndex((previous) => {
        if (previous < 0) {
          return 0;
        }
        return (previous + 1) % autocompleteOptions.length;
      });
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setIsSuggestionsOpen(true);
      hasKeyboardSuggestionSelection.current = true;
      setActiveSuggestionIndex((previous) => {
        if (previous <= 0) {
          return autocompleteOptions.length - 1;
        }
        return previous - 1;
      });
      return;
    }

    if (event.key === "Escape") {
      setIsSuggestionsOpen(false);
    }
  }

  function handleInputFocus(): void {
    if (closeSuggestionsTimeout.current !== null) {
      window.clearTimeout(closeSuggestionsTimeout.current);
      closeSuggestionsTimeout.current = null;
    }

    if (query.trim().length >= 2) {
      setIsSuggestionsOpen(true);
    }
  }

  function handleInputBlur(): void {
    closeSuggestionsTimeout.current = window.setTimeout(() => {
      setIsSuggestionsOpen(false);
    }, 120);
  }

  function handleThemeToggle(): void {
    setTheme((previous) => (previous === "light" ? "dark" : "light"));
  }

  function handleGoHome(): void {
    setLookupTargets([]);
    setLookupError(null);
    setSearchError(null);
    setIsSuggestionsOpen(false);
  }

  function handleOpenHelp(): void {
    window.open("https://github.com/aryan-cs/hackaplan#readme", "_blank", "noopener,noreferrer");
  }

  function handleOpenRobot(): void {
    window.open("https://github.com/aryan-cs/hackaplan", "_blank", "noopener,noreferrer");
  }

  const nextThemeLabel = theme === "light" ? "dark" : "light";

  return (
    <div className={hasActiveSearch ? "app results-mode" : "app home-mode"}>
      <ActionButtons
        className="desktop-floating-actions"
        theme={theme}
        nextThemeLabel={nextThemeLabel}
        onGoHome={handleGoHome}
        onOpenHelp={handleOpenHelp}
        onOpenRobot={handleOpenRobot}
        onToggleTheme={handleThemeToggle}
      />

      {!hasActiveSearch ? (
        <main className="home-layout">
          <div className="home-brand">Hackaplan</div>
          <h1>Find winning ideas.</h1>

          <form className="search-form" onSubmit={handleSearchSubmit}>
            <ActionButtons
              className="mobile-action-bar"
              theme={theme}
              nextThemeLabel={nextThemeLabel}
              onGoHome={handleGoHome}
              onOpenHelp={handleOpenHelp}
              onOpenRobot={handleOpenRobot}
              onToggleTheme={handleThemeToggle}
            />
            <div className="search-input-shell">
              <input
                type="text"
                value={query}
                placeholder="Search hackathons (example: Tree Hacks)"
                onChange={(targetEvent) => handleQueryChange(targetEvent.currentTarget.value)}
                onFocus={handleInputFocus}
                onBlur={handleInputBlur}
                onKeyDown={handleInputKeyDown}
                autoFocus
              />
              <button type="submit" aria-label="Search">
                <svg
                  className="search-button-icon"
                  xmlns="http://www.w3.org/2000/svg"
                  height="24px"
                  viewBox="0 -960 960 960"
                  width="24px"
                  fill="#e3e3e3"
                  aria-hidden="true"
                >
                  <path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z" />
                </svg>
              </button>
            </div>

            {isSuggestionsOpen ? (
              <div className="suggestions-dropdown" ref={suggestionsDropdownRef}>
                {isLoadingSuggestions ? <p className="suggestions-message">Loading suggestions...</p> : null}
                {!isLoadingSuggestions && suggestions.length === 0 && query.trim().length >= 2 ? (
                  <p className="suggestions-message">No matching hackathons found.</p>
                ) : null}
                {autocompleteOptions.length > 0 ? (
                  <ul>
                    {autocompleteOptions.map((option, index) => {
                      const isActive = index === activeSuggestionIndex;
                      const title = option.kind === "search_all" ? option.title : option.suggestion.title;
                      const subtitle = option.kind === "search_all" ? option.subtitle : option.suggestion.hackathon_url;
                      return (
                        <li key={option.key}>
                          <button
                            type="button"
                            className={isActive ? "suggestion-option active" : "suggestion-option"}
                            ref={(node) => {
                              suggestionOptionRefs.current[index] = node;
                            }}
                            onMouseDown={(mouseEvent) => mouseEvent.preventDefault()}
                            onClick={() => handleAutocompleteOptionPick(option)}
                          >
                            <span className="suggestion-title">{title}</span>
                            <span className="suggestion-subtitle">{subtitle}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </form>

          {searchError ? <p className="inline-error">{searchError}</p> : null}
          {lookupError ? <p className="inline-error">{lookupError}</p> : null}
        </main>
      ) : (
        <main className="results-layout">
          <header className="results-search-header">
            <form className="search-form compact" onSubmit={handleSearchSubmit}>
              <ActionButtons
                className="mobile-action-bar"
                theme={theme}
                nextThemeLabel={nextThemeLabel}
                onGoHome={handleGoHome}
                onOpenHelp={handleOpenHelp}
                onOpenRobot={handleOpenRobot}
                onToggleTheme={handleThemeToggle}
              />
              <div className="search-input-shell">
                <input
                  type="text"
                  value={query}
                  placeholder="Search another hackathon"
                  onChange={(targetEvent) => handleQueryChange(targetEvent.currentTarget.value)}
                  onFocus={handleInputFocus}
                  onBlur={handleInputBlur}
                  onKeyDown={handleInputKeyDown}
                />
                <button type="submit" aria-label="Search">
                  <svg
                    className="search-button-icon"
                    xmlns="http://www.w3.org/2000/svg"
                    height="24px"
                    viewBox="0 -960 960 960"
                    width="24px"
                    fill="#e3e3e3"
                    aria-hidden="true"
                  >
                    <path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z" />
                  </svg>
                </button>
              </div>

              {isSuggestionsOpen ? (
                <div className="suggestions-dropdown" ref={suggestionsDropdownRef}>
                  {isLoadingSuggestions ? <p className="suggestions-message">Loading suggestions...</p> : null}
                  {!isLoadingSuggestions && suggestions.length === 0 && query.trim().length >= 2 ? (
                    <p className="suggestions-message">No matching hackathons found.</p>
                  ) : null}
                  {autocompleteOptions.length > 0 ? (
                    <ul>
                      {autocompleteOptions.map((option, index) => {
                        const isActive = index === activeSuggestionIndex;
                        const title = option.kind === "search_all" ? option.title : option.suggestion.title;
                        const subtitle = option.kind === "search_all" ? option.subtitle : option.suggestion.hackathon_url;
                        return (
                          <li key={option.key}>
                            <button
                              type="button"
                              className={isActive ? "suggestion-option active" : "suggestion-option"}
                              ref={(node) => {
                                suggestionOptionRefs.current[index] = node;
                              }}
                              onMouseDown={(mouseEvent) => mouseEvent.preventDefault()}
                              onClick={() => handleAutocompleteOptionPick(option)}
                            >
                              <span className="suggestion-title">{title}</span>
                              <span className="suggestion-subtitle">{subtitle}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </form>
          </header>

          {searchError ? <p className="inline-error">{searchError}</p> : null}
          {lookupError ? <p className="inline-error">{lookupError}</p> : null}
          {lookupTargets.map((target, index) => (
            <div key={target.hackathon_url}>
              {index > 0 ? <hr className="lookup-divider" /> : null}
              <LookupResultSection
                suggestion={target}
                snapshotManifest={snapshotManifest}
                liveLookupsEnabled={LIVE_LOOKUPS_ENABLED}
              />
            </div>
          ))}
        </main>
      )}
    </div>
  );
}
