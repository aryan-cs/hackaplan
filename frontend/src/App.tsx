import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

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
  PrizeAward,
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
type SearchCommandMode = "hackathons" | "find";

const THEME_STORAGE_KEY = "hackaplan-theme";
const LIVE_LOOKUPS_ENABLED = isLiveLookupEnabled();
const FIND_LOOKUP_POLL_INTERVAL_MS = 1400;
const FIND_LOOKUP_TIMEOUT_MS = 60_000;

const FIND_TRACK_PRIZE_HACKATHONS: HackathonSearchSuggestion[] = [
  { title: "Cal Hacks 12.0", hackathon_url: "https://cal-hacks-12-0.devpost.com/" },
  { title: "Cal Hacks 11.0", hackathon_url: "https://cal-hacks-11-0.devpost.com/" },
  { title: "Cal Hacks 10.0", hackathon_url: "https://cal-hacks-10.devpost.com/" },
  { title: "Cal Hacks 9.0", hackathon_url: "https://calhacks90.devpost.com/" },
  { title: "Cal Hacks 8.0", hackathon_url: "https://cal-hacks-8.devpost.com/" },
  { title: "Cal Hacks 6.0", hackathon_url: "https://cal-hacks-6.devpost.com/" },
  { title: "Cal Hacks 4.0", hackathon_url: "https://calhacks4.devpost.com/" },
  { title: "Cal Hacks 2.0", hackathon_url: "https://calhacks2.devpost.com/" },
  { title: "HackIllinois 2025", hackathon_url: "https://hackillinois-2025.devpost.com/" },
  { title: "HackIllinois 2024", hackathon_url: "https://hackillinois-2024.devpost.com/" },
  { title: "HackIllinois 2023", hackathon_url: "https://hackillinois-2023.devpost.com/" },
  { title: "HackIllinois 2019", hackathon_url: "https://hackillinois2019.devpost.com/" },
  { title: "HackIllinois 2018", hackathon_url: "https://hackillinois-2018.devpost.com/" },
  { title: "HackIllinois 2017", hackathon_url: "https://hackillinois-2017.devpost.com/" },
  { title: "HackIllinois 2016", hackathon_url: "https://hackillinois2016s.devpost.com/" },
  { title: "HackIllinois 2015", hackathon_url: "https://hackillinois2015s.devpost.com/" },
  { title: "HackIllinois", hackathon_url: "https://hackillinois2014s.devpost.com/" },
  { title: "BoilerMake 2014", hackathon_url: "https://boilermake2014.devpost.com/" },
  { title: "BoilerMake XII", hackathon_url: "https://boilermake-xii.devpost.com/" },
  { title: "BoilerMake XI", hackathon_url: "https://boilermake-xi.devpost.com/" },
  { title: "BoilerMake X", hackathon_url: "https://boilermake-x.devpost.com/" },
  { title: "BoilerMake VII", hackathon_url: "https://boilermake-vii.devpost.com/" },
  { title: "BoilerMake VI", hackathon_url: "https://boilermake-vi.devpost.com/" },
  { title: "BoilerMake IV", hackathon_url: "https://boilermake-iv.devpost.com/" },
  { title: "BoilerMake 2015", hackathon_url: "https://boilermake2015.devpost.com/" },
  { title: "BoilerMake", hackathon_url: "https://boilermake.devpost.com/" },
  { title: "HackPrinceton Fall 2025", hackathon_url: "https://hackprinceton-fall-2025.devpost.com/" },
  { title: "HackPrinceton Spring 2024", hackathon_url: "https://hackprinceton-spring-2024.devpost.com/" },
  { title: "HackPrinceton Fall 2023", hackathon_url: "https://hackprinceton-fall-2023.devpost.com/" },
  { title: "HackPrinceton Fall 2016", hackathon_url: "https://hackprinceton-fall16.devpost.com/" },
  { title: "HackGT Presents: Horizons 2020", hackathon_url: "https://horizons2020.devpost.com/" },
  { title: "HackGT Presents: BuildGT 2", hackathon_url: "https://buildgt-2019.devpost.com/" },
  { title: "HackGT Presents: BuildGT", hackathon_url: "https://buildgt-2018.devpost.com/" },
  { title: "HackGT 2017", hackathon_url: "https://hackgt2017.devpost.com/" },
  { title: "HackGT@UPC 2016", hackathon_url: "https://hack-gtupc.devpost.com/" },
  { title: "HackGT 2016", hackathon_url: "https://hackgt2016.devpost.com/" },
  { title: "HackGT 9", hackathon_url: "https://hackgt-9.devpost.com/" },
  { title: "HackGT 7", hackathon_url: "https://hackgt2020.devpost.com/" },
  { title: "HackGT", hackathon_url: "https://hackgt2014.devpost.com/" },
  { title: "Hack the North 2025", hackathon_url: "https://hackthenorth2025.devpost.com/" },
  { title: "Hack the North 2024", hackathon_url: "https://hackthenorth2024.devpost.com/" },
  { title: "Hack the North 2023", hackathon_url: "https://hackthenorth2023.devpost.com/" },
  { title: "Hack the North 2022", hackathon_url: "https://hackthenorth2022.devpost.com/" },
  { title: "Hack the North 2021", hackathon_url: "https://hackthenorth2021.devpost.com/" },
  { title: "Hack the North 2020++", hackathon_url: "https://hackthenorth2020.devpost.com/" },
  { title: "Hack the North 2019", hackathon_url: "https://hackthenorth2019.devpost.com/" },
  { title: "Hack the North 2018", hackathon_url: "https://hackthenorth2018.devpost.com/" },
  { title: "Hack the North 2015", hackathon_url: "https://hackthenorth2015.devpost.com/" },
  { title: "TreeHacks 2025", hackathon_url: "https://treehacks-2025.devpost.com/" },
  { title: "TreeHacks 2024", hackathon_url: "https://treehacks-2024.devpost.com/" },
  { title: "TreeHacks 2023", hackathon_url: "https://treehacks-2023.devpost.com/" },
  { title: "TreeHacks 2022", hackathon_url: "https://treehacks-2022.devpost.com/" },
  { title: "TreeHacks 2021", hackathon_url: "https://treehacks-2021.devpost.com/" },
  { title: "TreeHacks 2020", hackathon_url: "https://treehacks-2020.devpost.com/" },
  { title: "TreeHacks 2019", hackathon_url: "https://treehacks-2019.devpost.com/" },
  { title: "TreeHacks 2018", hackathon_url: "https://treehacks-2018.devpost.com/" },
  { title: "TreeHacks 2017", hackathon_url: "https://treehacks-2017.devpost.com/" },
  { title: "HackMIT 2023", hackathon_url: "https://hackmit-2023.devpost.com/" },
  { title: "HackMIT 2020", hackathon_url: "https://hackmit-2020.devpost.com/" },
  { title: "HackMIT 2019", hackathon_url: "https://hackmit-2019.devpost.com/" },
  { title: "HackMIT 2018", hackathon_url: "https://hackmit-2018.devpost.com/" },
  { title: "HackMIT 2017", hackathon_url: "https://hackmit-2017.devpost.com/" },
  { title: "HackMIT", hackathon_url: "https://hackmit.devpost.com/" },
];

type ParsedSearchCommand = {
  mode: SearchCommandMode;
  queryText: string;
  explicitCommand: SearchCommandMode | null;
};

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

function buildPublicIconUrl(fileName: string): string {
  const base = import.meta.env.BASE_URL ?? "/";
  return `${base}icons/${fileName}`;
}

function IconMask({ fileName, className }: { fileName: string; className?: string }) {
  const iconStyle = {
    "--icon-url": `url("${buildPublicIconUrl(fileName)}")`,
  } as CSSProperties;

  return <span className={className ? `icon-mask ${className}` : "icon-mask"} style={iconStyle} aria-hidden="true" />;
}

function ThemeToggleIcon({ theme }: { theme: ThemeMode }) {
  return <IconMask fileName={theme === "light" ? "dark-mode.svg" : "light-mode.svg"} />;
}

function HomeIcon() {
  return <IconMask fileName="home.svg" />;
}

function HelpIcon() {
  return <IconMask fileName="help.svg" />;
}

function RobotIcon() {
  return <IconMask fileName="robot.svg" />;
}

function RepoLinkIcon() {
  return <IconMask fileName="code.svg" />;
}

function PublicOpinionIcon() {
  return <IconMask fileName="public.svg" />;
}

function SearchIcon() {
  return <IconMask fileName="search.svg" className="search-button-icon" />;
}

function ActionButtons({
  className,
  theme,
  nextThemeLabel,
  onGoHome,
  onOpenHelp,
  onOpenRepoShortcut,
  onOpenPublicOpinion,
  onOpenRobot,
  onToggleTheme,
}: {
  className: string;
  theme: ThemeMode;
  nextThemeLabel: ThemeMode;
  onGoHome: () => void;
  onOpenHelp: () => void;
  onOpenRepoShortcut: () => void;
  onOpenPublicOpinion: () => void;
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
      <button
        type="button"
        className="repo-button"
        onClick={onOpenRepoShortcut}
        aria-label="Repository"
        title="Repository"
      >
        <RepoLinkIcon />
      </button>
      <button
        type="button"
        className="public-opinion-button"
        onClick={onOpenPublicOpinion}
        aria-label="Public opinion"
        title="Public opinion"
      >
        <PublicOpinionIcon />
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

type SearchCommandInputProps = {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
};

function getCommandStyledSegments(value: string): Array<{ text: string; isCommand: boolean }> {
  const commandMatch = value.match(/^(\s*)(\/\S*)/);
  if (!commandMatch) {
    return [{ text: value, isCommand: false }];
  }

  const leadingWhitespace = commandMatch[1] ?? "";
  const commandToken = commandMatch[2] ?? "";
  const commandEndIndex = leadingWhitespace.length + commandToken.length;
  const trailingText = value.slice(commandEndIndex);
  const segments: Array<{ text: string; isCommand: boolean }> = [];

  if (leadingWhitespace.length > 0) {
    segments.push({ text: leadingWhitespace, isCommand: false });
  }
  if (commandToken.length > 0) {
    segments.push({ text: commandToken, isCommand: true });
  }
  if (trailingText.length > 0) {
    segments.push({ text: trailingText, isCommand: false });
  }

  return segments;
}

function SearchCommandInput({
  value,
  placeholder,
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  autoFocus = false,
}: SearchCommandInputProps) {
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const normalMeasureRef = useRef<HTMLSpanElement | null>(null);
  const commandMeasureRef = useRef<HTMLSpanElement | null>(null);
  const highlightedSegments = useMemo(() => getCommandStyledSegments(value), [value]);
  const commandToken = useMemo(() => {
    const commandMatch = value.match(/^\s*(\/\S*)/);
    return commandMatch?.[1] ?? "";
  }, [value]);
  const [commandCaretOffsetPx, setCommandCaretOffsetPx] = useState(0);

  useEffect(() => {
    const normalMeasure = normalMeasureRef.current;
    const commandMeasure = commandMeasureRef.current;
    if (!normalMeasure || !commandMeasure || commandToken.length === 0) {
      setCommandCaretOffsetPx(0);
      return;
    }

    const measureOffset = () => {
      normalMeasure.textContent = commandToken;
      commandMeasure.textContent = commandToken;
      const normalWidth = normalMeasure.getBoundingClientRect().width;
      const commandWidth = commandMeasure.getBoundingClientRect().width;
      const delta = commandWidth - normalWidth;
      setCommandCaretOffsetPx(Number.isFinite(delta) ? delta : 0);
    };

    measureOffset();
    if ("fonts" in document) {
      void document.fonts.ready.then(measureOffset);
    }
  }, [commandToken]);

  function updateSelectionState(inputElement: HTMLInputElement): void {
    const selectionStart = inputElement.selectionStart ?? 0;
    const selectionEnd = inputElement.selectionEnd ?? 0;
    setHasSelection(selectionEnd > selectionStart);
  }

  function syncHighlightScroll(inputElement: HTMLInputElement): void {
    if (!highlightRef.current) {
      return;
    }
    highlightRef.current.scrollLeft = inputElement.scrollLeft;
  }

  const [hasSelection, setHasSelection] = useState(false);
  const inputClassName = [
    "search-input-native",
    commandToken.length > 0 ? "has-command-prefix" : "",
    hasSelection ? "has-selection" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const commandCaretOffsetStyle = { "--command-caret-offset": `${commandCaretOffsetPx}px` } as CSSProperties;

  return (
    <div
      className={hasSelection ? "search-input-layered selection-active" : "search-input-layered"}
      style={commandCaretOffsetStyle}
    >
      <div className="search-input-highlight" aria-hidden="true" ref={highlightRef}>
        {value.length > 0 ? (
          highlightedSegments.map((segment, index) => (
            <span key={`${index}:${segment.text}`} className={segment.isCommand ? "search-command-text" : undefined}>
              {segment.text}
            </span>
          ))
        ) : (
          <span className="search-input-empty" />
        )}
      </div>
      <input
        className={inputClassName}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(targetEvent) => {
          onChange(targetEvent.currentTarget.value);
          syncHighlightScroll(targetEvent.currentTarget);
          updateSelectionState(targetEvent.currentTarget);
        }}
        onFocus={(focusEvent) => {
          onFocus();
          updateSelectionState(focusEvent.currentTarget);
        }}
        onBlur={() => {
          onBlur();
          setHasSelection(false);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(keyEvent) => updateSelectionState(keyEvent.currentTarget)}
        onMouseUp={(mouseEvent) => updateSelectionState(mouseEvent.currentTarget)}
        onSelect={(selectEvent) => updateSelectionState(selectEvent.currentTarget)}
        onScroll={(targetEvent) => syncHighlightScroll(targetEvent.currentTarget)}
        autoFocus={autoFocus}
      />
      <div className="search-command-measurements" aria-hidden="true">
        <span ref={normalMeasureRef} className="search-command-measure-normal" />
        <span ref={commandMeasureRef} className="search-command-measure-code" />
      </div>
    </div>
  );
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

function parseSearchCommandInput(rawValue: string): ParsedSearchCommand {
  const leftTrimmed = rawValue.replace(/^\s+/, "");
  const hackathonsMatch = leftTrimmed.match(/^\/hackathons(?:\s+|$)(.*)$/i);
  if (hackathonsMatch) {
    return {
      mode: "hackathons",
      queryText: (hackathonsMatch[1] ?? "").trim(),
      explicitCommand: "hackathons",
    };
  }

  const findMatch = leftTrimmed.match(/^\/find(?:\s+|$)(.*)$/i);
  if (findMatch) {
    return {
      mode: "find",
      queryText: (findMatch[1] ?? "").trim(),
      explicitCommand: "find",
    };
  }

  const commandMatch = leftTrimmed.match(/^\/([a-zA-Z]+)\b(.*)$/);
  if (!commandMatch) {
    return {
      mode: "hackathons",
      queryText: rawValue.trim(),
      explicitCommand: null,
    };
  }

  // If input starts with an unknown slash command, suppress normal search/autocomplete
  // until a supported command is fully used.
  return {
    mode: "hackathons",
    queryText: "",
    explicitCommand: null,
  };
}

function formatQueryForMode(
  mode: SearchCommandMode,
  queryText: string,
  explicitCommand: SearchCommandMode | null,
): string {
  const trimmedQuery = queryText.trim();
  if (mode === "find") {
    return trimmedQuery.length > 0 ? `/find ${trimmedQuery}` : "/find";
  }
  if (explicitCommand === "hackathons") {
    return trimmedQuery.length > 0 ? `/hackathons ${trimmedQuery}` : "/hackathons";
  }
  return trimmedQuery;
}

function doesPrizeMatchFindQuery(prizeName: string, queryText: string): boolean {
  const normalizedQuery = normalizeSearchText(queryText);
  if (!normalizedQuery) {
    return false;
  }
  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (queryTokens.length === 0) {
    return false;
  }

  const normalizedPrizeName = normalizeSearchText(prizeName);
  return queryTokens.every((token) => normalizedPrizeName.includes(token));
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

async function fetchFindHackathonResult(
  suggestion: HackathonSearchSuggestion,
  snapshotManifest: SnapshotManifestV1 | null,
  liveLookupsEnabled: boolean,
  signal: AbortSignal,
): Promise<HackathonResult | null> {
  let snapshotResult: HackathonResult | null = null;
  try {
    const snapshotShard = await getSnapshotShard(suggestion.hackathon_url, {
      manifest: snapshotManifest,
      signal,
    });
    snapshotResult = snapshotShard?.result ?? null;
  } catch {
    snapshotResult = null;
  }

  if (snapshotResult || !liveLookupsEnabled || signal.aborted) {
    return snapshotResult;
  }

  try {
    const createPayload = await createLookup(suggestion.hackathon_url);
    const startedAt = Date.now();
    while (!signal.aborted && Date.now() - startedAt < FIND_LOOKUP_TIMEOUT_MS) {
      try {
        const lookupPayload = await getLookup(createPayload.lookup_id);
        if (lookupPayload.status === "completed") {
          return lookupPayload.result ?? null;
        }
        if (lookupPayload.status === "failed") {
          return null;
        }
      } catch {
        // Continue polling on transient lookup fetch failures.
      }

      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, FIND_LOOKUP_POLL_INTERVAL_MS);
      });
    }
  } catch {
    return snapshotResult;
  }

  return snapshotResult;
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

type FindPrizeMatch = {
  id: string;
  hackathonTitle: string;
  winner: WinnerProject;
  matchedPrizes: PrizeAward[];
};

function FindTrackPrizeSection({
  query,
  snapshotManifest,
  liveLookupsEnabled,
}: {
  query: string;
  snapshotManifest: SnapshotManifestV1 | null;
  liveLookupsEnabled: boolean;
}) {
  const [matches, setMatches] = useState<FindPrizeMatch[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) {
      setMatches([]);
      setIsLoading(false);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    setIsLoading(true);
    setLoadError(null);

    void (async () => {
      try {
        const allResults = await Promise.all(
          FIND_TRACK_PRIZE_HACKATHONS.map(async (suggestion) => {
            const result = await fetchFindHackathonResult(suggestion, snapshotManifest, liveLookupsEnabled, controller.signal);
            return { suggestion, result };
          }),
        );

        if (cancelled) {
          return;
        }

        const nextMatches: FindPrizeMatch[] = [];
        for (const item of allResults) {
          if (!item.result) {
            continue;
          }

          const hackathonTitle = item.result.hackathon.name || item.suggestion.title;
          for (const winner of item.result.winners) {
            const matchedPrizes = winner.prizes.filter((prize) => doesPrizeMatchFindQuery(prize.prize_name, query));
            if (matchedPrizes.length === 0) {
              continue;
            }

            nextMatches.push({
              id: `${item.result.hackathon.url}:${winner.project_url}`,
              hackathonTitle,
              winner,
              matchedPrizes,
            });
          }
        }

        nextMatches.sort((left, right) => {
          const leftYear = extractYearFromText(`${left.hackathonTitle} ${left.id}`) ?? -1;
          const rightYear = extractYearFromText(`${right.hackathonTitle} ${right.id}`) ?? -1;
          if (leftYear !== rightYear) {
            return rightYear - leftYear;
          }
          return left.winner.project_title.localeCompare(right.winner.project_title, undefined, { sensitivity: "base" });
        });

        setMatches(nextMatches);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setLoadError(parseErrorMessage(error, "Failed to load /find prize matches."));
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [query, snapshotManifest, liveLookupsEnabled]);

  return (
    <section className="lookup-section">
      <section className="results-meta">
        <h2>Track and Prize Matches</h2>
        <p>
          {matches.length} matching winner project(s) in TreeHacks, Cal Hacks, HackIllinois, Boilermake, HackPrinceton, HackGT, and Hack the North for "{query}".
        </p>
      </section>

      {loadError ? <p className="inline-error">{loadError}</p> : null}

      {isLoading && matches.length === 0 ? (
        <section className="inline-spinner-only lookup-section-spinner">
          <LoadingSpinner />
        </section>
      ) : null}

      {!isLoading && !loadError && matches.length === 0 ? (
        <section className="empty-state">
          <h2>No track or prize matches found</h2>
          <p>Try a broader keyword for /find.</p>
        </section>
      ) : null}

      {matches.length > 0 ? (
        <section className="winner-image-grid">
          {matches.map((match) => {
            const winnerForCard: WinnerProject = {
              ...match.winner,
              prizes: match.matchedPrizes,
              tagline: match.winner.tagline ? `${match.hackathonTitle} · ${match.winner.tagline}` : match.hackathonTitle,
            };
            return <WinnerCard key={match.id} winner={winnerForCard} />;
          })}
        </section>
      ) : null}

      {isLoading && matches.length > 0 ? (
        <div className="cards-loading-indicator">
          <LoadingSpinner small />
        </div>
      ) : null}
    </section>
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
          <p>This hackathon did not list any winners.</p>
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
  const [activeCommandMode, setActiveCommandMode] = useState<SearchCommandMode>("hackathons");
  const [activeFindQuery, setActiveFindQuery] = useState<string | null>(null);
  const [snapshotManifest, setSnapshotManifest] = useState<SnapshotManifestV1 | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());

  const closeSuggestionsTimeout = useRef<number | null>(null);
  const suggestionsDropdownRef = useRef<HTMLDivElement | null>(null);
  const suggestionOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const hasKeyboardSuggestionSelection = useRef(false);
  const lastLookupSubmission = useRef<{ signature: string; createdAt: number } | null>(null);

  const hasActiveSearch = lookupTargets.length > 0;
  const parsedSearchInput = useMemo(() => parseSearchCommandInput(query), [query]);
  const effectiveSearchQuery = parsedSearchInput.queryText;
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
    const trimmedQuery = effectiveSearchQuery.trim();
    if (trimmedQuery.length < 2) {
      return [];
    }

    const options: SearchAutocompleteOption[] = [];
    const isDirectUrl = normalizeDevpostHackathonUrl(trimmedQuery) !== null;
    if (!isDirectUrl && sortedSuggestions.length > 0) {
      const searchAllTitle = parsedSearchInput.mode === "find" ? `Find "${trimmedQuery}"` : `Search "${trimmedQuery}"`;
      const searchAllSubtitle =
        parsedSearchInput.mode === "find"
          ? "Search for related hackathons & track matches from popular hackathons"
          : "Load all matching years";
      options.push({
        kind: "search_all",
        key: `search-all:${parsedSearchInput.mode}:${normalizeSearchText(trimmedQuery)}`,
        title: searchAllTitle,
        subtitle: searchAllSubtitle,
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
  }, [effectiveSearchQuery, parsedSearchInput.mode, sortedSuggestions]);

  useEffect(() => {
    const trimmed = effectiveSearchQuery.trim();

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
  }, [effectiveSearchQuery]);

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

  function applyLookupTargets(
    targets: HackathonSearchSuggestion[],
    options?: { queryValue?: string; commandMode?: SearchCommandMode; findQuery?: string | null },
  ): void {
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
    const commandMode = options?.commandMode ?? "hackathons";
    setActiveCommandMode(commandMode);
    setActiveFindQuery(commandMode === "find" ? (options?.findQuery ?? null) : null);
    setQuery(options?.queryValue ?? query);
    setIsSuggestionsOpen(false);
    hasKeyboardSuggestionSelection.current = false;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    });
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const parsedInput = parseSearchCommandInput(query);
    const trimmedQuery = parsedInput.queryText.trim();
    if (!trimmedQuery) {
      setLookupError(
        parsedInput.mode === "find"
          ? 'Type a keyword after "/find".'
          : "Select a suggestion or enter a direct Devpost hackathon URL.",
      );
      return;
    }

    const directUrl = normalizeDevpostHackathonUrl(trimmedQuery);
    if (directUrl) {
      const nextQueryValue = formatQueryForMode(parsedInput.mode, directUrl, parsedInput.explicitCommand);
      applyLookupTargets(
        [
          {
            title: guessHackathonTitleFromUrl(directUrl),
            hackathon_url: directUrl,
          },
        ],
        {
          queryValue: nextQueryValue,
          commandMode: parsedInput.mode,
          findQuery: parsedInput.mode === "find" ? trimmedQuery : null,
        },
      );
      return;
    }

    if (sortedSuggestions.length === 0) {
      setLookupError("Select a suggestion or enter a direct Devpost hackathon URL.");
      return;
    }

    if (parsedInput.mode === "find") {
      applyLookupTargets(sortedSuggestions, {
        queryValue: formatQueryForMode("find", trimmedQuery, parsedInput.explicitCommand),
        commandMode: "find",
        findQuery: trimmedQuery,
      });
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
      applyLookupTargets([exactMatch], {
        queryValue: formatQueryForMode("hackathons", exactMatch.title, parsedInput.explicitCommand),
        commandMode: "hackathons",
        findQuery: null,
      });
      return;
    }

    const requestedYear = extractYearFromText(trimmedQuery);
    if (requestedYear !== null) {
      const sameYearMatch = sortedSuggestions.find((suggestion) => {
        return extractYearFromText(`${suggestion.title} ${suggestion.hackathon_url}`) === requestedYear;
      });
      if (sameYearMatch) {
        applyLookupTargets([sameYearMatch], {
          queryValue: formatQueryForMode("hackathons", sameYearMatch.title, parsedInput.explicitCommand),
          commandMode: "hackathons",
          findQuery: null,
        });
        return;
      }
    }

    applyLookupTargets(sortedSuggestions, {
      queryValue: formatQueryForMode("hackathons", trimmedQuery, parsedInput.explicitCommand),
      commandMode: "hackathons",
      findQuery: null,
    });
  }

  function handleSuggestionPick(suggestion: HackathonSearchSuggestion): void {
    const parsedInput = parseSearchCommandInput(query);
    if (parsedInput.mode === "find") {
      const findQuery = parsedInput.queryText.trim() || suggestion.title;
      applyLookupTargets([suggestion], {
        queryValue: formatQueryForMode("find", suggestion.title, parsedInput.explicitCommand),
        commandMode: "find",
        findQuery,
      });
      return;
    }

    applyLookupTargets([suggestion], {
      queryValue: formatQueryForMode("hackathons", suggestion.title, parsedInput.explicitCommand),
      commandMode: "hackathons",
      findQuery: null,
    });
  }

  function handleSearchAllPick(queryValue?: string): void {
    const parsedInput = parseSearchCommandInput(query);
    if (sortedSuggestions.length === 0) {
      setLookupError("No matching hackathons were found.");
      return;
    }

    const normalizedQueryValue = queryValue ?? parsedInput.queryText.trim() ?? query.trim();
    applyLookupTargets(sortedSuggestions, {
      queryValue: formatQueryForMode(parsedInput.mode, normalizedQueryValue, parsedInput.explicitCommand),
      commandMode: parsedInput.mode,
      findQuery: parsedInput.mode === "find" ? normalizedQueryValue : null,
    });
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
    setIsSuggestionsOpen(parseSearchCommandInput(value).queryText.trim().length >= 2);
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

    if (parsedSearchInput.queryText.trim().length >= 2) {
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
    setActiveCommandMode("hackathons");
    setActiveFindQuery(null);
  }

  function handleOpenHelp(): void {
    window.open("https://github.com/aryan-cs/hackaplan#readme", "_blank", "noopener,noreferrer");
  }

  function handleOpenRepoShortcut(): void {
    window.open("https://github.com/aryan-cs/hackaplan", "_blank", "noopener,noreferrer");
  }

  function handleOpenPublicOpinion(): void {
    window.open("https://github.com/aryan-cs/hackaplan/issues", "_blank", "noopener,noreferrer");
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
        onOpenRepoShortcut={handleOpenRepoShortcut}
        onOpenPublicOpinion={handleOpenPublicOpinion}
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
              onOpenRepoShortcut={handleOpenRepoShortcut}
              onOpenPublicOpinion={handleOpenPublicOpinion}
              onOpenRobot={handleOpenRobot}
              onToggleTheme={handleThemeToggle}
            />
            <div className="search-input-shell">
              <SearchCommandInput
                value={query}
                placeholder="Search hackathons (example: Tree Hacks)"
                onChange={handleQueryChange}
                onFocus={handleInputFocus}
                onBlur={handleInputBlur}
                onKeyDown={handleInputKeyDown}
                autoFocus
              />
              <button type="submit" aria-label="Search">
                <SearchIcon />
              </button>
            </div>

            {isSuggestionsOpen ? (
              <div className="suggestions-dropdown" ref={suggestionsDropdownRef}>
                {isLoadingSuggestions ? <p className="suggestions-message">Loading suggestions...</p> : null}
                {!isLoadingSuggestions && suggestions.length === 0 && effectiveSearchQuery.trim().length >= 2 ? (
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
                onOpenRepoShortcut={handleOpenRepoShortcut}
                onOpenPublicOpinion={handleOpenPublicOpinion}
                onOpenRobot={handleOpenRobot}
                onToggleTheme={handleThemeToggle}
              />
              <div className="search-input-shell">
                <SearchCommandInput
                  value={query}
                  placeholder="Search another hackathon"
                  onChange={handleQueryChange}
                  onFocus={handleInputFocus}
                  onBlur={handleInputBlur}
                  onKeyDown={handleInputKeyDown}
                />
                <button type="submit" aria-label="Search">
                  <SearchIcon />
                </button>
              </div>

              {isSuggestionsOpen ? (
                <div className="suggestions-dropdown" ref={suggestionsDropdownRef}>
                  {isLoadingSuggestions ? <p className="suggestions-message">Loading suggestions...</p> : null}
                  {!isLoadingSuggestions && suggestions.length === 0 && effectiveSearchQuery.trim().length >= 2 ? (
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
          {activeCommandMode === "find" && activeFindQuery ? (
            <>
              <FindTrackPrizeSection
                query={activeFindQuery}
                snapshotManifest={snapshotManifest}
                liveLookupsEnabled={LIVE_LOOKUPS_ENABLED}
              />
              {lookupTargets.length > 0 ? <hr className="lookup-divider" /> : null}
            </>
          ) : null}
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
