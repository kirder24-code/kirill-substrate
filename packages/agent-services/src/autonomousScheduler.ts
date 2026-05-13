import type {
  AutonomousWatchlist,
  ScoutFeedInput
} from "@linkedin-brand-os/shared";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export function computeNextAutonomousWatchlistRunAt(
  cadence: AutonomousWatchlist["refreshCadence"],
  now: string
): string | undefined {
  const base = new Date(now).getTime();
  if (Number.isNaN(base)) {
    return undefined;
  }

  if (cadence === "daily_candidate") {
    return new Date(base + DAY_IN_MS).toISOString();
  }

  if (cadence === "weekly_candidate") {
    return new Date(base + 7 * DAY_IN_MS).toISOString();
  }

  return undefined;
}

export function isAutonomousWatchlistDue(
  watchlist: AutonomousWatchlist,
  now: string
): boolean {
  if (!watchlist.isActive || watchlist.refreshCadence === "manual_only") {
    return false;
  }

  const nowMs = new Date(now).getTime();
  if (Number.isNaN(nowMs)) {
    return false;
  }

  if (watchlist.nextRunAt) {
    return new Date(watchlist.nextRunAt).getTime() <= nowMs;
  }

  if (!watchlist.lastRunAt) {
    return true;
  }

  const inferredNext = computeNextAutonomousWatchlistRunAt(
    watchlist.refreshCadence,
    watchlist.lastRunAt
  );

  return inferredNext ? new Date(inferredNext).getTime() <= nowMs : false;
}

export function buildScoutFeedInputFromAutonomousWatchlist(
  watchlist: AutonomousWatchlist
): ScoutFeedInput {
  return {
    mode: mapAutonomousWatchlistMode(watchlist.sourceKind),
    items: [
      {
        sourceType: mapAutonomousWatchlistSourceType(watchlist.sourceKind),
        sourceLabel: watchlist.label,
        sourceUrl: watchlist.sourceUrl,
        excerpt: watchlist.seedExcerpt,
        targetProblem: watchlist.targetProblem
      }
    ]
  };
}

function mapAutonomousWatchlistMode(
  sourceKind: AutonomousWatchlist["sourceKind"]
): ScoutFeedInput["mode"] {
  if (sourceKind === "public_discussion_source") {
    return "audience";
  }

  if (
    sourceKind === "github_repo" ||
    sourceKind === "github_release" ||
    sourceKind === "github_issue" ||
    sourceKind === "article_source"
  ) {
    return "solution";
  }

  return "mixed";
}

function mapAutonomousWatchlistSourceType(
  sourceKind: AutonomousWatchlist["sourceKind"]
): ScoutFeedInput["items"][number]["sourceType"] {
  if (
    sourceKind === "github_repo" ||
    sourceKind === "github_release" ||
    sourceKind === "github_issue"
  ) {
    return "github";
  }

  if (sourceKind === "article_source") {
    return "article";
  }

  if (sourceKind === "public_discussion_source" || sourceKind === "watched_url") {
    return "public_web";
  }

  return "mixed";
}
