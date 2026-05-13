import type {
  AutonomousWatchlist,
  CreateAutonomousIngestionArtifactInput,
  ScoutFeedInput,
  SourceIntakeInput
} from "@linkedin-brand-os/shared";
import { normalizeSourceIntake } from "./sourceIntakeNormalizer";

export interface WatchlistSourceIngestionDependencies {
  fetchImpl?: typeof fetch;
}

export interface WatchlistSourceIngestionResult {
  artifacts: CreateAutonomousIngestionArtifactInput[];
  scoutFeedInput?: ScoutFeedInput;
}

export async function ingestWatchlistSources(
  watchlist: AutonomousWatchlist,
  autonomousRunId: string,
  dependencies: WatchlistSourceIngestionDependencies = {}
): Promise<WatchlistSourceIngestionResult> {
  if (!supportsAutomatedUrlIngestion(watchlist)) {
    return { artifacts: [] };
  }

  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    return {
      artifacts: [
        buildArtifact(watchlist, autonomousRunId, {
          sourceType: mapWatchlistToSourceIntakeType(watchlist),
          title: watchlist.label,
          rawText: "",
          status: "failed",
          errorSummary: "No fetch implementation available for automated ingestion."
        })
      ]
    };
  }

  try {
    const response = await fetchImpl(watchlist.sourceUrl as string);
    if (!response.ok) {
      return {
        artifacts: [
          buildArtifact(watchlist, autonomousRunId, {
            sourceType: mapWatchlistToSourceIntakeType(watchlist),
            title: watchlist.label,
            rawText: "",
            status: "failed",
            errorSummary: `HTTP ${response.status} while fetching automated intake source.`
          })
        ]
      };
    }

    const rawPayload = await response.text();
    const snapshot = extractUrlSnapshot(rawPayload, watchlist.label);
    if (!snapshot.bodyText) {
      return {
        artifacts: [
          buildArtifact(watchlist, autonomousRunId, {
            sourceType: mapWatchlistToSourceIntakeType(watchlist),
            title: snapshot.title,
            rawText: "",
            status: "empty",
            errorSummary: "Fetched source did not contain usable text."
          })
        ]
      };
    }

    const intake = buildSourceIntakeInput(watchlist, snapshot);
    const normalized = normalizeSourceIntake(intake);
    const artifact = buildArtifact(watchlist, autonomousRunId, {
      sourceType: intake.sourceType,
      title: intake.title,
      rawText: snapshot.bodyText,
      normalizedSignalText: normalized.normalizedSignalText,
      suggestedAngle: normalized.suggestedAngle,
      reasoningSummary: normalized.reasoningSummary,
      status: "ingested"
    });

    return {
      artifacts: [artifact],
      scoutFeedInput: {
        mode: mapWatchlistToScoutFeedMode(watchlist),
        items: [
          {
            sourceType: mapWatchlistToScoutFeedSourceType(watchlist),
            sourceLabel: watchlist.label,
            sourceUrl: watchlist.sourceUrl,
            excerpt: normalized.normalizedSignalText,
            targetProblem: watchlist.targetProblem
          }
        ]
      }
    };
  } catch (error) {
    return {
      artifacts: [
        buildArtifact(watchlist, autonomousRunId, {
          sourceType: mapWatchlistToSourceIntakeType(watchlist),
          title: watchlist.label,
          rawText: "",
          status: "failed",
          errorSummary:
            error instanceof Error ? error.message : "Automated ingestion failed."
        })
      ]
    };
  }
}

export function supportsAutomatedUrlIngestion(
  watchlist: AutonomousWatchlist
): boolean {
  return Boolean(
    watchlist.sourceUrl &&
      (watchlist.sourceKind === "watched_url" ||
        watchlist.sourceKind === "article_source" ||
        watchlist.sourceKind === "public_discussion_source")
  );
}

export function buildSourceIntakeInput(
  watchlist: AutonomousWatchlist,
  snapshot: UrlSnapshot
): SourceIntakeInput {
  return {
    sourceType: mapWatchlistToSourceIntakeType(watchlist),
    title: snapshot.title,
    sourceUrl: watchlist.sourceUrl,
    summaryText: snapshot.bodyText,
    operatorNotes: watchlist.notes
  };
}

interface UrlSnapshot {
  title: string;
  bodyText: string;
}

function buildArtifact(
  watchlist: AutonomousWatchlist,
  autonomousRunId: string,
  input: Omit<CreateAutonomousIngestionArtifactInput, "watchlistId" | "autonomousRunId" | "sourceUrl">
): CreateAutonomousIngestionArtifactInput {
  return {
    watchlistId: watchlist.id,
    autonomousRunId,
    sourceUrl: watchlist.sourceUrl,
    ...input
  };
}

function extractUrlSnapshot(rawPayload: string, fallbackTitle: string): UrlSnapshot {
  const titleMatch = rawPayload.match(/<title[^>]*>(.*?)<\/title>/i);
  const bodyMatch = rawPayload.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodySource = bodyMatch?.[1] ?? rawPayload;
  const withoutScripts = bodySource
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const bodyText = normalizeSnapshotText(withoutScripts).slice(0, 800);

  return {
    title: normalizeSnapshotText(titleMatch?.[1] ?? "") || fallbackTitle,
    bodyText
  };
}

function normalizeSnapshotText(value: string): string {
  return value.replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

function mapWatchlistToSourceIntakeType(
  watchlist: AutonomousWatchlist
): SourceIntakeInput["sourceType"] {
  if (watchlist.sourceKind === "article_source") {
    return "article";
  }

  return "manual_research";
}

function mapWatchlistToScoutFeedMode(
  watchlist: AutonomousWatchlist
): ScoutFeedInput["mode"] {
  if (watchlist.sourceKind === "public_discussion_source") {
    return "audience";
  }

  if (watchlist.sourceKind === "article_source") {
    return "solution";
  }

  return "mixed";
}

function mapWatchlistToScoutFeedSourceType(
  watchlist: AutonomousWatchlist
): ScoutFeedInput["items"][number]["sourceType"] {
  if (watchlist.sourceKind === "article_source") {
    return "article";
  }

  return "public_web";
}
