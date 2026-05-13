import type {
  AudienceScoutItem,
  ScoutFeedAdapterFamily,
  ScoutFeedAdapterSummary,
  ScoutFeedGroupAdapterSummary,
  ScoutFeedInput,
  ScoutItemAdapterSummary,
  ScoutFeedResult,
  SolutionScoutInput,
  SolutionScoutItem
} from "@linkedin-brand-os/shared";
import { buildAudienceScoutResult } from "./audienceScout";
import { buildSolutionScoutResult } from "./solutionScout";

function normalizeText(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

type SourceAdapterKind = ScoutFeedAdapterFamily;

interface AdaptedScoutFeedItem {
  adapterKind: SourceAdapterKind;
  route: "audience" | "solution";
  sourceType: SolutionScoutInput["sourceType"];
  adapterNote: string;
  usedFallback: boolean;
}

function hasPattern(corpus: string, pattern: RegExp): boolean {
  return pattern.test(corpus);
}

function adaptScoutFeedItem(item: ScoutFeedInput["items"][number]): AdaptedScoutFeedItem {
  const normalizedUrl = normalizeText(item.sourceUrl);
  const corpus = normalizeText(`${item.sourceLabel ?? ""} ${item.sourceUrl ?? ""} ${item.excerpt}`);
  const hasGithubSignals =
    item.sourceType === "github" ||
    normalizedUrl.includes("github com") ||
    hasPattern(corpus, /\b(github|repo|release|issue|pull request|pr|changelog|commit|branch)\b/);
  const hasArticleSignals =
    item.sourceType === "article" ||
    hasPattern(corpus, /\b(article|blog|case study|newsletter|guide|report|essay|published)\b/) ||
    /(substack|medium|blog|news|insights)/.test(normalizedUrl);
  const hasDiscussionSignals =
    hasPattern(
      corpus,
      /\b(linkedin|reddit|community|thread|post|comment|reply|discussion|complaint|friction|stuck|confusing|manual work|escalation)\b/
    );
  const hasSolutionSignals = hasPattern(
    corpus,
    /\b(implementation|retry|recovery|state|orchestration|visibility|rollout|automation|playbook|ownership)\b/
  );

  if (hasGithubSignals) {
    return {
      adapterKind: "github_snapshot",
      route: "solution",
      sourceType: "github",
      adapterNote: "Routed as GitHub snapshot.",
      usedFallback: false
    };
  }

  if (hasArticleSignals && !hasDiscussionSignals) {
    return {
      adapterKind: "article_snapshot",
      route: "solution",
      sourceType: "article",
      adapterNote: "Routed as article snapshot.",
      usedFallback: false
    };
  }

  if (item.sourceType === "manual_research") {
    if (hasDiscussionSignals && !hasSolutionSignals) {
      return {
        adapterKind: "manual_feed",
        route: "audience",
        sourceType: "manual_research",
        adapterNote: "Routed manual feed as audience-style discussion.",
        usedFallback: false
      };
    }

    return {
      adapterKind: "manual_feed",
      route: "solution",
      sourceType: "manual_research",
      adapterNote: "Routed as manual feed snapshot.",
      usedFallback: !hasSolutionSignals
    };
  }

  if (item.sourceType === "public_web") {
    if (hasArticleSignals && !hasDiscussionSignals) {
      return {
        adapterKind: "article_snapshot",
        route: "solution",
        sourceType: "article",
        adapterNote: "Routed as article snapshot.",
        usedFallback: false
      };
    }

    if (hasDiscussionSignals && !hasSolutionSignals) {
      return {
        adapterKind: "watched_url_snapshot",
        route: "audience",
        sourceType: "mixed",
        adapterNote: "Routed watched URL snapshot as public discussion.",
        usedFallback: false
      };
    }

    if (hasArticleSignals || hasSolutionSignals) {
      return {
        adapterKind: "watched_url_snapshot",
        route: "solution",
        sourceType: hasArticleSignals ? "article" : "mixed",
        adapterNote: "Routed watched URL snapshot toward solution scouting.",
        usedFallback: false
      };
    }

    return {
      adapterKind: "watched_url_snapshot",
      route: "audience",
      sourceType: "mixed",
      adapterNote: "Routed watched URL snapshot as public discussion.",
      usedFallback: true
    };
  }

  if (hasDiscussionSignals && !hasSolutionSignals) {
    return {
      adapterKind: "public_discussion",
      route: "audience",
      sourceType: "mixed",
      adapterNote: "Routed as public discussion.",
      usedFallback: false
    };
  }

  if (hasArticleSignals) {
    return {
      adapterKind: "article_snapshot",
      route: "solution",
      sourceType: "article",
      adapterNote: "Routed as article snapshot.",
      usedFallback: false
    };
  }

  if (hasSolutionSignals) {
    return {
      adapterKind: "manual_feed",
      route: "solution",
      sourceType: "mixed",
      adapterNote: "Used deterministic fallback for ambiguous solution-oriented input.",
      usedFallback: true
    };
  }

  return {
    adapterKind: "public_discussion",
    route: "audience",
    sourceType: "mixed",
    adapterNote: "Used deterministic fallback for ambiguous discussion-like input.",
    usedFallback: true
  };
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

function signalStrengthWeight(value: "strong" | "medium" | "weak" | undefined): number {
  if (value === "strong") {
    return 3;
  }

  if (value === "medium") {
    return 2;
  }

  return 1;
}

function confidenceWeight(value: "high" | "medium" | "low"): number {
  if (value === "high") {
    return 3;
  }

  if (value === "medium") {
    return 2;
  }

  return 1;
}

const scoutFeedAdapterFamilyOrder: ScoutFeedAdapterFamily[] = [
  "public_discussion",
  "github_snapshot",
  "article_snapshot",
  "watched_url_snapshot",
  "manual_feed"
];

function formatScoutFeedAdapterCompactLabel(
  families: ScoutFeedAdapterFamily[],
  usedDeterministicFallback: boolean
): string | undefined {
  if (families.length === 1) {
    const family = families[0];
    if (family === "github_snapshot") {
      return "Routed as GitHub snapshot.";
    }

    if (family === "article_snapshot") {
      return "Routed as article snapshot.";
    }

    if (family === "public_discussion") {
      return "Routed as public discussion.";
    }

    if (family === "watched_url_snapshot") {
      return "Routed as watched URL snapshot.";
    }

    if (family === "manual_feed") {
      return "Routed as manual feed.";
    }
  }

  if (families.length > 1) {
    return "Routed through mixed source adapters.";
  }

  if (usedDeterministicFallback) {
    return "Used deterministic fallback.";
  }

  return undefined;
}

function buildStructuredScoutFeedAdapterSummary(
  adapterCounts: Map<SourceAdapterKind, number>,
  fallbackCount: number
): ScoutFeedGroupAdapterSummary | undefined {
  const adapterFamilies = scoutFeedAdapterFamilyOrder.filter((family) => adapterCounts.has(family));

  if (adapterFamilies.length === 0 && fallbackCount === 0) {
    return undefined;
  }

  return {
    families: adapterFamilies,
    usedDeterministicFallback: fallbackCount > 0,
    compactLabel: formatScoutFeedAdapterCompactLabel(adapterFamilies, fallbackCount > 0)
  };
}

function buildScoutFeedItemAdapterSummary(adapted: AdaptedScoutFeedItem): ScoutItemAdapterSummary {
  return {
    family: adapted.adapterKind,
    usedDeterministicFallback: adapted.usedFallback,
    compactLabel: formatScoutFeedAdapterCompactLabel([adapted.adapterKind], adapted.usedFallback)
  };
}

export function buildScoutFeedResult(input: ScoutFeedInput): ScoutFeedResult {
  const normalizedItems = input.items
    .map((item) => ({
      sourceType: item.sourceType,
      sourceLabel: item.sourceLabel?.trim() || undefined,
      sourceUrl: item.sourceUrl?.trim() || undefined,
      excerpt: item.excerpt.trim(),
      targetProblem: item.targetProblem?.trim() || undefined
    }))
    .filter((item) => item.excerpt.length > 0);

  if (normalizedItems.length === 0) {
    return {
      summary: "No strong scout feed items found for review yet.",
      notes:
        "Scout Feed needs at least one usable excerpt. It stays deterministic, review-first, and does not fetch external sources."
    };
  }

  const audienceItems: AudienceScoutItem[] = [];
  const solutionItems: SolutionScoutItem[] = [];
  const adapterCounts = new Map<SourceAdapterKind, number>();
  const audienceAdapterCounts = new Map<SourceAdapterKind, number>();
  const solutionAdapterCounts = new Map<SourceAdapterKind, number>();
  let fallbackCount = 0;
  let audienceFallbackCount = 0;
  let solutionFallbackCount = 0;

  for (const item of normalizedItems) {
    const adapted =
      input.mode === "audience"
        ? {
            adapterKind: "public_discussion" as const,
            route: "audience" as const,
            sourceType: "mixed" as const,
            adapterNote: "Routed as public discussion.",
            usedFallback: false
          }
        : input.mode === "solution"
          ? {
              adapterKind:
                item.sourceType === "github"
                  ? ("github_snapshot" as const)
                  : item.sourceType === "article"
                    ? ("article_snapshot" as const)
                    : ("manual_feed" as const),
              route: "solution" as const,
              sourceType:
                item.sourceType === "public_web" || item.sourceType === undefined
                  ? ("mixed" as const)
                  : item.sourceType,
              adapterNote:
                item.sourceType === "github"
                  ? "Routed as GitHub snapshot."
                  : item.sourceType === "article"
                    ? "Routed as article snapshot."
                    : "Routed as manual feed snapshot.",
              usedFallback: false
            }
          : adaptScoutFeedItem(item);

    adapterCounts.set(adapted.adapterKind, (adapterCounts.get(adapted.adapterKind) ?? 0) + 1);
    if (adapted.usedFallback) {
      fallbackCount += 1;
    }

    if (adapted.route === "audience") {
      const itemAdapterSummary = buildScoutFeedItemAdapterSummary(adapted);
      audienceAdapterCounts.set(
        adapted.adapterKind,
        (audienceAdapterCounts.get(adapted.adapterKind) ?? 0) + 1
      );
      if (adapted.usedFallback) {
        audienceFallbackCount += 1;
      }
      const result = buildAudienceScoutResult({
        targetTopics: [],
        publicInputs: [
          {
            sourceLabel: item.sourceLabel,
            sourceUrl: item.sourceUrl,
            excerpt: item.excerpt
          }
        ],
        maxResults: 1
      });
      audienceItems.push(
        ...result.items.map((resultItem) => ({
          ...resultItem,
          adapterSummary: itemAdapterSummary
        }))
      );
      continue;
    }

    const itemAdapterSummary = buildScoutFeedItemAdapterSummary(adapted);
    solutionAdapterCounts.set(
      adapted.adapterKind,
      (solutionAdapterCounts.get(adapted.adapterKind) ?? 0) + 1
    );
    if (adapted.usedFallback) {
      solutionFallbackCount += 1;
    }
    const result = buildSolutionScoutResult({
      sourceType: adapted.sourceType,
      sourceLabel: item.sourceLabel,
      sourceUrl: item.sourceUrl,
      sourceExcerpt: item.excerpt,
      targetProblem: item.targetProblem
    });
    solutionItems.push(
      ...result.items.map((resultItem) => ({
        ...resultItem,
        adapterSummary: itemAdapterSummary
      }))
    );
  }

  const uniqueAudienceItems = uniqueById(audienceItems).sort(
    (left, right) =>
      signalStrengthWeight(right.signalStrength) - signalStrengthWeight(left.signalStrength) ||
      confidenceWeight(right.confidence) - confidenceWeight(left.confidence)
  );
  const uniqueSolutionItems = uniqueById(solutionItems).sort(
    (left, right) =>
      signalStrengthWeight(right.signalStrength) - signalStrengthWeight(left.signalStrength) ||
      confidenceWeight(right.confidence) - confidenceWeight(left.confidence)
  );
  const total = uniqueAudienceItems.length + uniqueSolutionItems.length;
  const adapterSummary = Array.from(adapterCounts.entries())
    .map(([kind, count]) => `${count} ${kind.replace(/_/g, " ")}`)
    .join(", ");
  const structuredAdapterSummary: ScoutFeedAdapterSummary | undefined =
    buildStructuredScoutFeedAdapterSummary(adapterCounts, fallbackCount);
  const audienceAdapterSummary = buildStructuredScoutFeedAdapterSummary(
    audienceAdapterCounts,
    audienceFallbackCount
  );
  const solutionAdapterSummary = buildStructuredScoutFeedAdapterSummary(
    solutionAdapterCounts,
    solutionFallbackCount
  );

  return {
    audienceItems: uniqueAudienceItems.length > 0 ? uniqueAudienceItems : undefined,
    solutionItems: uniqueSolutionItems.length > 0 ? uniqueSolutionItems : undefined,
    adapterSummary: structuredAdapterSummary,
    audienceAdapterSummary,
    solutionAdapterSummary,
    summary:
      total > 0
        ? `${total} scout feed items processed: ${uniqueAudienceItems.length} audience and ${uniqueSolutionItems.length} solution signals.`
        : "No strong scout feed items found for review yet.",
    notes:
      `${adapterSummary ? `Adapter routing: ${adapterSummary}. ` : ""}${
        fallbackCount > 0
          ? `${fallbackCount} item${fallbackCount === 1 ? "" : "s"} used deterministic fallback routing. `
          : ""
      }Scout Feed stays review-first. Feed items reuse the existing scout item models and can flow into matching or downstream handoffs after operator review.`
  };
}
