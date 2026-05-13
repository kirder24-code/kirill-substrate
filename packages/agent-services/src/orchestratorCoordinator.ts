import type {
  GrowthRhythmCandidate,
  MatchedOpportunity,
  OrchestratedRecommendation,
  OrchestratedRecommendationInput,
  PersistedMatchedOpportunity,
  StrategyRecommendation
} from "@linkedin-brand-os/shared";

function topEngagementCandidate(
  input: OrchestratedRecommendationInput
): GrowthRhythmCandidate | undefined {
  return input.growthRhythmPlan?.topCommentCandidates?.[0];
}

function topPostCandidate(
  input: OrchestratedRecommendationInput
): GrowthRhythmCandidate | undefined {
  return input.growthRhythmPlan?.topPostCandidates?.[0];
}

function hasStrategyTitle(
  recommendations: StrategyRecommendation[] | Array<Pick<StrategyRecommendation, "id" | "title" | "priority" | "description">> | undefined,
  pattern: RegExp
): boolean {
  return Boolean(recommendations?.some((recommendation) => pattern.test(recommendation.title)));
}

function confidenceFromSignals(signalCount: number): OrchestratedRecommendation["confidence"] {
  if (signalCount >= 4) return "high";
  if (signalCount >= 2) return "medium";
  return "low";
}

function scoutStrengthWeight(value: MatchedOpportunity["opportunityStrength"] | undefined): number {
  if (value === "strong") return 3;
  if (value === "medium") return 2;
  if (value === "weak") return 1;
  return 0;
}

function scoutConfidenceWeight(value: MatchedOpportunity["confidence"]): number {
  if (value === "high") return 3;
  if (value === "medium") return 2;
  return 1;
}

function scoutSupportPriorityScore(
  match: MatchedOpportunity,
  origin: "direct_match" | "reviewed_saved_match"
): number {
  return (
    scoutStrengthWeight(match.opportunityStrength) +
    scoutConfidenceWeight(match.confidence) +
    (origin === "reviewed_saved_match" ? 1 : 0)
  );
}

function getStrongScoutMatches(input: OrchestratedRecommendationInput) {
  const directMatches =
    input.scoutOpportunityContext?.matchedOpportunities.filter(
      (item) => item.confidence === "high" || item.confidence === "medium"
    ).sort(
      (left, right) =>
        scoutSupportPriorityScore(right, "direct_match") -
        scoutSupportPriorityScore(left, "direct_match")
    ) ?? [];
  const savedMatches =
    input.scoutOpportunityContext?.savedMatches?.filter(
      (item) =>
        (item.status === "reviewed" || item.status === "converted") &&
        (item.match.confidence === "high" || item.match.confidence === "medium")
    ).sort(
      (left, right) =>
        scoutSupportPriorityScore(right.match, "reviewed_saved_match") -
        scoutSupportPriorityScore(left.match, "reviewed_saved_match")
    ) ?? [];

  return {
    directMatches,
    savedMatches
  };
}

function buildScoutSupportLine(match: {
  matchedPain: string;
  matchedSolutionPattern: string;
  recommendedAction: string;
}) {
  return `Scout match: ${match.matchedPain} + ${match.matchedSolutionPattern} (${match.recommendedAction})`;
}

function scoutInfluenceForCount(count: number): NonNullable<OrchestratedRecommendation["scoutInfluence"]> {
  if (count >= 2) return "strong";
  if (count === 1) return "moderate";
  return "weak";
}

function scoutInfluenceFromQuality(args: {
  strongestDirectMatch?: MatchedOpportunity;
  strongestSavedMatch?: PersistedMatchedOpportunity;
  scoutSupportCount: number;
}): NonNullable<OrchestratedRecommendation["scoutInfluence"]> | undefined {
  const directScore = args.strongestDirectMatch
    ? scoutSupportPriorityScore(args.strongestDirectMatch, "direct_match")
    : 0;
  const savedScore = args.strongestSavedMatch
    ? scoutSupportPriorityScore(args.strongestSavedMatch.match, "reviewed_saved_match")
    : 0;

  if (directScore >= 5 && savedScore >= 5) {
    return "strong";
  }

  if (Math.max(directScore, savedScore) >= 6) {
    return "strong";
  }

  if (Math.max(directScore, savedScore) >= 4 || args.scoutSupportCount >= 2) {
    return "moderate";
  }

  if (args.scoutSupportCount > 0) {
    return scoutInfluenceForCount(args.scoutSupportCount);
  }

  return undefined;
}

export function buildOrchestratedRecommendation(
  input: OrchestratedRecommendationInput
): OrchestratedRecommendation {
  const supportingSignals: string[] = [];
  const coordinationNotes: string[] = [];
  const scoutSupport: string[] = [];
  const decisionPlan = input.currentDecisionPlan;
  const postCandidate = topPostCandidate(input);
  const engagementCandidate = topEngagementCandidate(input);
  const postTargetTitle = postCandidate ? postCandidate.title : undefined;
  const engagementTargetTitle = engagementCandidate ? engagementCandidate.title : undefined;
  const strategyRecommendations = input.strategyRecommendations ?? [];
  const feedbackSummary = input.feedbackSummary;
  const patternMemorySummary = input.patternMemorySummary;
  const { directMatches, savedMatches } = getStrongScoutMatches(input);
  const strongestDirectMatch = directMatches[0];
  const strongestSavedMatch = savedMatches[0];
  const strongestScoutMatch = strongestDirectMatch ?? strongestSavedMatch?.match;

  if (decisionPlan?.recommendedNextAction === "generate_post_candidate") {
    supportingSignals.push("Decision Planner is already leaning post-first.");
  }
  if (decisionPlan?.recommendedNextAction === "generate_comment") {
    supportingSignals.push("Decision Planner is leaning toward comment engagement.");
  }
  if (decisionPlan?.recommendedNextAction === "generate_reply") {
    supportingSignals.push("Decision Planner sees a reply-safe opportunity.");
  }
  if (postCandidate) {
    supportingSignals.push(`LinkedIn Action Plan top post candidate: ${postCandidate.title}`);
  }
  if (engagementCandidate) {
    supportingSignals.push(`LinkedIn Action Plan top engagement candidate: ${engagementCandidate.title}`);
  }
  if (feedbackSummary && feedbackSummary.totalRecords > 0) {
    coordinationNotes.push(feedbackSummary.reasoningSummary);
  }
  if (patternMemorySummary && patternMemorySummary.totalPatterns > 0) {
    coordinationNotes.push(patternMemorySummary.notes);
  }
  if (strongestDirectMatch) {
    scoutSupport.push(buildScoutSupportLine(strongestDirectMatch));
  }
  if (strongestSavedMatch) {
    scoutSupport.push(
      `Saved scout match (${strongestSavedMatch.status}): ${strongestSavedMatch.match.matchedSolutionPattern}`
    );
  }
  const scoutInfluence = scoutInfluenceFromQuality({
    strongestDirectMatch,
    strongestSavedMatch,
    scoutSupportCount: scoutSupport.length
  });
  if (scoutInfluence === "strong") {
    supportingSignals.push(
      directMatches.length > 0 && savedMatches.length > 0
        ? "Corroborated scout evidence is reinforcing the current downstream priority."
        : "Strong scout evidence is reinforcing the current downstream priority."
    );
  }
  if (strongestScoutMatch?.recommendedAction === "write_post") {
    supportingSignals.push("Scout intelligence reinforces a post-worthy pain-to-solution angle.");
  }
  if (strongestScoutMatch?.recommendedAction === "write_comment") {
    supportingSignals.push("Scout intelligence reinforces a comment opportunity.");
  }
  if (strongestScoutMatch?.recommendedAction === "write_reply") {
    supportingSignals.push("Scout intelligence reinforces a reply-safe operator opportunity.");
  }
  if (strongestScoutMatch?.recommendedAction === "save_for_later") {
    coordinationNotes.push("Scout intelligence suggests holding the match for later review instead of forcing action now.");
  }

  const prefersRepeatThemes =
    hasStrategyTitle(strategyRecommendations, /repeat|reinforce recurring long-term themes/i) ||
    (patternMemorySummary?.recurringThemes.length ?? 0) > 0;
  const cautionsWeakThemes =
    hasStrategyTitle(strategyRecommendations, /deprioritize|weak themes/i) ||
    (patternMemorySummary?.weakThemes.length ?? 0) > 0;

  if (
    decisionPlan?.recommendedNextAction === "generate_reply" ||
    engagementCandidate?.suggestedAction === "generate_reply"
  ) {
    if (engagementCandidate) {
      supportingSignals.push("LinkedIn Action Plan has a reply-ready engagement target.");
    }

    return {
      recommendedAction: "write_reply",
      recommendationReason:
        "Reply now because engagement context is specific enough to support a direct operator response.",
      primaryTarget: engagementCandidate?.title ?? "Current reply-safe thread",
      supportingSignals,
      confidence: confidenceFromSignals(supportingSignals.length),
      coordinationNotes,
      scoutSupport: scoutSupport.length > 0 ? scoutSupport : undefined,
      scoutInfluence
    };
  }

  if (
    decisionPlan?.recommendedNextAction === "generate_comment" ||
    engagementCandidate?.suggestedAction === "generate_comment"
  ) {
    if (engagementCandidate) {
      supportingSignals.push("LinkedIn Action Plan is prioritizing a comment opportunity.");
    }

    return {
      recommendedAction: "write_comment",
      recommendationReason:
        "Comment next because engagement-first context is stronger than the current post inventory.",
      primaryTarget: engagementCandidate?.title ?? "Current engagement opportunity",
      supportingSignals,
      confidence: confidenceFromSignals(supportingSignals.length),
      coordinationNotes,
      scoutSupport: scoutSupport.length > 0 ? scoutSupport : undefined,
      scoutInfluence
    };
  }

  if (
    decisionPlan?.recommendedNextAction === "generate_post_candidate" ||
    postCandidate ||
    prefersRepeatThemes
  ) {
    if (prefersRepeatThemes) {
      supportingSignals.push("Strategy and memory both reinforce repeating stronger themes.");
    }
    if (decisionPlan?.shouldEscalateToPost) {
      coordinationNotes.push("Decision Planner already marked this signal as worth escalating to a post.");
    }

    return {
      recommendedAction: "write_post",
      recommendationReason:
        "Write a post next because the strongest coordination signal still points toward publishable operator insight.",
      primaryTarget:
        postCandidate?.title ??
        input.currentSourceSignal?.title ??
        "Current post-worthy workflow theme",
      supportingSignals,
      confidence: confidenceFromSignals(supportingSignals.length),
      coordinationNotes,
      scoutSupport: scoutSupport.length > 0 ? scoutSupport : undefined,
      scoutInfluence
    };
  }

  if (cautionsWeakThemes) {
    supportingSignals.push("Recent strategy, feedback, or memory signals caution against forcing a weak move.");
    return {
      recommendedAction: "save_for_later",
      recommendationReason:
        "Hold this for later because the strongest coordination signal is caution, not immediate execution.",
      primaryTarget:
        input.currentSourceSignal?.title ??
        postTargetTitle ??
        engagementTargetTitle ??
        "Current mixed-signal item",
      supportingSignals,
      confidence: confidenceFromSignals(supportingSignals.length),
      coordinationNotes,
      scoutSupport: scoutSupport.length > 0 ? scoutSupport : undefined,
      scoutInfluence
    };
  }

  return {
    recommendedAction: "revisit_signal",
    recommendationReason:
      "Revisit the signal before acting because the current planner, rhythm, and strategy context is still too thin or mixed.",
    primaryTarget: input.currentSourceSignal?.title ?? "Current signal",
    supportingSignals,
    confidence: confidenceFromSignals(supportingSignals.length),
    coordinationNotes,
    scoutSupport: scoutSupport.length > 0 ? scoutSupport : undefined,
    scoutInfluence
  };
}
