import type {
  FeedbackAwareThemeTag,
  FeedbackSummary,
  GrowthRhythmCandidate,
  GrowthRhythmInput,
  GrowthRhythmPlan,
  PatternMemorySummary
} from "@linkedin-brand-os/shared";
import { extractFeedbackAwareThemeTags } from "@linkedin-brand-os/shared";

function priorityScore(priority: GrowthRhythmCandidate["priority"]): number {
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

function statusScore(status: GrowthRhythmCandidate["status"]): number {
  switch (status) {
    case "new":
      return 4;
    case "queued":
      return 3;
    case "sent":
    case "in_progress":
      return 2;
    case "done":
      return 1;
    case "archived":
    default:
      return 0;
  }
}

function postActionScore(action: GrowthRhythmCandidate["suggestedAction"]): number {
  if (action === "generate_post_candidate") return 6;
  if (action === "write_post") return 5;
  if (action === "refine_post") return 3;
  return 0;
}

function engagementActionScore(action: GrowthRhythmCandidate["suggestedAction"]): number {
  if (action === "generate_comment") return 6;
  if (action === "generate_reply") return 5;
  return 0;
}

function candidateText(candidate: GrowthRhythmCandidate): string {
  return `${candidate.title} ${candidate.reasoningSummary ?? ""} ${candidate.bestAngle ?? ""}`.toLowerCase();
}

function normalizedKeywords(lines: string[]): string[] {
  return Array.from(
    new Set(
      lines
        .join(" ")
        .toLowerCase()
        .split(/[^a-z_]+/)
        .filter((token) => token.length >= 4)
    )
  );
}

function feedbackBias(
  candidate: GrowthRhythmCandidate,
  feedbackSummary?: FeedbackSummary
): { score: number; alignment: GrowthRhythmCandidate["feedbackAlignment"]; reason?: string } {
  if (!feedbackSummary || feedbackSummary.totalRecords === 0) {
    return { score: 0, alignment: "neutral" };
  }

  const text = candidateText(candidate);
  const positiveKeywords = normalizedKeywords([
    ...feedbackSummary.strongPatterns,
    ...feedbackSummary.suggestedRepeats
  ]);
  const negativeKeywords = normalizedKeywords([
    ...feedbackSummary.weakPatterns,
    ...feedbackSummary.suggestedAvoids
  ]);

  const positiveHits = positiveKeywords.filter((keyword) => text.includes(keyword)).length;
  const negativeHits = negativeKeywords.filter((keyword) => text.includes(keyword)).length;
  const score = Math.min(3, positiveHits) - Math.min(3, negativeHits);

  if (score > 0) {
    return {
      score,
      alignment: "positive",
      reason: "Matches recent strong or repeat-worthy feedback patterns."
    };
  }

  if (score < 0) {
    return {
      score,
      alignment: "negative",
      reason: "Resembles weaker patterns the operator marked to avoid."
    };
  }

  return { score: 0, alignment: "neutral" };
}

function patternMemoryBias(
  candidate: GrowthRhythmCandidate,
  patternMemorySummary?: PatternMemorySummary
): { score: number; alignment: GrowthRhythmCandidate["feedbackAlignment"]; reason?: string } {
  if (!patternMemorySummary || patternMemorySummary.totalPatterns === 0) {
    return { score: 0, alignment: "neutral" };
  }

  const text = candidateText(candidate);
  const positiveHits = patternMemorySummary.recurringThemes.filter((theme) =>
    text.includes(theme.toLowerCase())
  ).length;
  const negativeHits = patternMemorySummary.weakThemes.filter((theme) =>
    text.includes(theme.toLowerCase())
  ).length;
  const score = Math.min(2, positiveHits) - Math.min(2, negativeHits);

  if (score > 0) {
    return {
      score,
      alignment: "positive",
      reason: "Matches recurring long-term repeat patterns."
    };
  }

  if (score < 0) {
    return {
      score,
      alignment: "negative",
      reason: "Matches recurring long-term weak patterns."
    };
  }

  return { score: 0, alignment: "neutral" };
}

function hintForCandidate(
  candidate: GrowthRhythmCandidate,
  feedbackSummary?: FeedbackSummary,
  alignment: GrowthRhythmCandidate["feedbackAlignment"] = "neutral",
  patternMemorySummary?: PatternMemorySummary
): Pick<GrowthRhythmCandidate, "feedbackHint" | "feedbackHintKind"> {
  const text = candidateText(candidate);
  const tags = feedbackSummary ? extractFeedbackAwareThemeTags(feedbackSummary) : [];
  const matchedTag = tags.find((tag) => text.includes(tag.label));
  const memoryRepeat = patternMemorySummary?.recurringThemes.find((theme) =>
    text.includes(theme.toLowerCase())
  );
  const memoryAvoid = patternMemorySummary?.weakThemes.find((theme) =>
    text.includes(theme.toLowerCase())
  );

  if (!matchedTag) {
    if (memoryRepeat && alignment === "positive") {
      return {
        feedbackHintKind: "repeat",
        feedbackHint: `Aligned with repeat: ${memoryRepeat}`
      };
    }

    if (memoryAvoid && alignment === "negative") {
      return {
        feedbackHintKind: "avoid",
        feedbackHint: `Watch: avoid ${memoryAvoid}`
      };
    }

    if (alignment === "positive") {
      return {
        feedbackHintKind: "repeat",
        feedbackHint: "Aligned with repeat: recent strong pattern"
      };
    }

    if (alignment === "negative") {
      return {
        feedbackHintKind: "avoid",
        feedbackHint: "Watch: similar to weaker recent pattern"
      };
    }

    return {};
  }

  if (matchedTag.kind === "repeat") {
    return {
      feedbackHintKind: "repeat",
      feedbackHint: `Aligned with repeat: ${matchedTag.label}`
    };
  }

  return {
    feedbackHintKind: "avoid",
    feedbackHint: `Watch: avoid ${matchedTag.label}`
  };
}

function memoryBadgeForCandidate(
  candidate: GrowthRhythmCandidate,
  patternMemorySummary?: PatternMemorySummary
): Pick<GrowthRhythmCandidate, "memoryBadge" | "memoryBadgeKind"> {
  if (!patternMemorySummary || patternMemorySummary.totalPatterns === 0) {
    return {};
  }

  const text = candidateText(candidate);
  const matchedRepeat = patternMemorySummary.recurringThemes.find((theme) =>
    text.includes(theme.toLowerCase())
  );
  if (matchedRepeat) {
    return {
      memoryBadge: "Long-term repeat",
      memoryBadgeKind: "repeat"
    };
  }

  const matchedAvoid = patternMemorySummary.weakThemes.find((theme) =>
    text.includes(theme.toLowerCase())
  );
  if (matchedAvoid) {
    return {
      memoryBadge: "Recurring weak pattern",
      memoryBadgeKind: "avoid"
    };
  }

  return {};
}

function rankPostCandidate(
  candidate: GrowthRhythmCandidate,
  feedbackSummary?: FeedbackSummary,
  patternMemorySummary?: PatternMemorySummary
): number {
  const feedback = feedbackBias(candidate, feedbackSummary);
  const memory = patternMemoryBias(candidate, patternMemorySummary);
  return (
    postActionScore(candidate.suggestedAction) +
    priorityScore(candidate.priority) +
    statusScore(candidate.status) +
    (candidate.bestAngle === "ownership_gap" || candidate.bestAngle === "workflow_accountability"
      ? 1
      : 0) +
    feedback.score +
    memory.score
  );
}

function rankEngagementCandidate(
  candidate: GrowthRhythmCandidate,
  feedbackSummary?: FeedbackSummary,
  patternMemorySummary?: PatternMemorySummary
): number {
  const feedback = feedbackBias(candidate, feedbackSummary);
  const memory = patternMemoryBias(candidate, patternMemorySummary);
  return (
    engagementActionScore(candidate.suggestedAction) +
    priorityScore(candidate.priority) +
    statusScore(candidate.status) +
    feedback.score +
    memory.score
  );
}

function sortCandidates(
  candidates: GrowthRhythmCandidate[],
  scorer: (candidate: GrowthRhythmCandidate) => number
): GrowthRhythmCandidate[] {
  return [...candidates].sort(
    (left, right) =>
      scorer(right) - scorer(left) ||
      priorityScore(right.priority) - priorityScore(left.priority) ||
      left.title.localeCompare(right.title)
  );
}

export function buildGrowthRhythmPlan(input: GrowthRhythmInput): GrowthRhythmPlan {
  const queueItems = input.queueItems ?? [];
  const savedCandidates = input.savedCandidates ?? [];
  const allCandidates = [...queueItems, ...savedCandidates].map((candidate) => {
    const feedback = feedbackBias(candidate, input.feedbackSummary);
    const memory = patternMemoryBias(candidate, input.patternMemorySummary);
    const alignment: NonNullable<GrowthRhythmCandidate["feedbackAlignment"]> =
      feedback.alignment === "negative" || memory.alignment === "negative"
        ? "negative"
        : feedback.alignment === "positive" || memory.alignment === "positive"
          ? "positive"
          : "neutral";
    const hint = hintForCandidate(
      candidate,
      input.feedbackSummary,
      alignment,
      input.patternMemorySummary
    );
    const memoryBadge = memoryBadgeForCandidate(candidate, input.patternMemorySummary);
    return {
      ...candidate,
      feedbackAlignment: alignment,
      feedbackReason: [feedback.reason, memory.reason].filter(Boolean).join(" "),
      ...hint
      ,
      ...memoryBadge
    };
  });

  const topPostCandidates = sortCandidates(
    allCandidates.filter((candidate) => postActionScore(candidate.suggestedAction) > 0),
    (candidate) => rankPostCandidate(candidate, input.feedbackSummary, input.patternMemorySummary)
  ).slice(0, 3);

  const topCommentCandidates = sortCandidates(
    allCandidates.filter((candidate) => engagementActionScore(candidate.suggestedAction) > 0),
    (candidate) =>
      rankEngagementCandidate(candidate, input.feedbackSummary, input.patternMemorySummary)
  ).slice(0, 3);

  const usedIds = new Set([
    ...topPostCandidates.map((candidate) => candidate.id),
    ...topCommentCandidates.map((candidate) => candidate.id)
  ]);

  const keepForLater = sortCandidates(
    allCandidates.filter(
      (candidate) =>
        (!usedIds.has(candidate.id) &&
          (candidate.priority === "low" ||
          candidate.status === "done" ||
          candidate.status === "archived" ||
          candidate.suggestedAction === "save_for_later" ||
          candidate.suggestedAction === "analyze_market")) ||
        candidate.feedbackAlignment === "negative"
    ),
    (candidate) => priorityScore(candidate.priority) + statusScore(candidate.status)
  ).slice(0, 3);

  const feedbackAware =
    Boolean(input.feedbackSummary) && (input.feedbackSummary?.totalRecords ?? 0) > 0;
  const memoryAware =
    Boolean(input.patternMemorySummary) && (input.patternMemorySummary?.totalPatterns ?? 0) > 0;
  const weeklyFocus =
    topPostCandidates.length > 0
      ? feedbackAware
        ? `This week leans toward ${topPostCandidates[0]?.bestAngle ?? "operator-fit"} themes because recent feedback marked similar patterns as stronger.`
        : memoryAware
          ? `This week leans toward ${input.patternMemorySummary?.recurringThemes[0] ?? topPostCandidates[0]?.bestAngle ?? "operator-fit"} because long-term memory keeps reinforcing that pattern.`
        : `Lead with ${topPostCandidates[0]?.bestAngle ?? "operator-fit"} themes and convert the clearest workflow pain into publishable posts.`
      : topCommentCandidates.length > 0
        ? "Lean into engagement this week and use comments to test sharper operator angles."
        : "No strong growth rhythm signal yet. Keep collecting stronger workflow pain and operator-fit ideas.";

  const suggestedCadence = `${topPostCandidates.length} post candidate${topPostCandidates.length === 1 ? "" : "s"}, ${topCommentCandidates.length} comment opportunit${topCommentCandidates.length === 1 ? "y" : "ies"}, ${keepForLater.length} to revisit later.`;

  const reasoningSummary =
    topPostCandidates.length > 0 || topCommentCandidates.length > 0
      ? feedbackAware
        ? "The rhythm plan favors active, higher-priority items first, then adds a light feedback bias toward stronger repeat patterns and away from weaker ones."
        : memoryAware
          ? "The rhythm plan favors active, higher-priority items first, then adds a light long-term memory bias toward recurring repeat patterns and away from recurring weak ones."
        : "The rhythm plan favors active, higher-priority items first, then keeps weaker inventory in a later bucket."
      : "There is not enough active post or engagement inventory yet, so the plan stays deliberately light.";

  return {
    topPostCandidates,
    topCommentCandidates,
    keepForLater,
    weeklyFocus,
    suggestedCadence,
    reasoningSummary
  };
}
