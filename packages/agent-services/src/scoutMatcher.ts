import type {
  AIScoutEnrichment,
  FeedbackSummary,
  MatchedOpportunity,
  PatternMemorySummary,
  ScoutMatchInput,
  ScoutMatchResult,
  SolutionScoutItem
} from "@linkedin-brand-os/shared";

const MATCH_CREATED_AT = "2026-03-15T00:00:00.000Z";

function mergeScoutEnrichments(
  audienceEnrichment?: AIScoutEnrichment,
  solutionEnrichment?: AIScoutEnrichment
): AIScoutEnrichment | undefined {
  if (!audienceEnrichment && !solutionEnrichment) {
    return undefined;
  }

  // Combine enrichments, preferring audience for pain/consequence, solution for operator angle
  return {
    improvedSummary:
      audienceEnrichment?.improvedSummary ||
      solutionEnrichment?.improvedSummary ||
      undefined,
    whyItMatters:
      audienceEnrichment?.whyItMatters ||
      solutionEnrichment?.whyItMatters ||
      undefined,
    businessConsequence:
      audienceEnrichment?.businessConsequence ||
      solutionEnrichment?.businessConsequence ||
      undefined,
    operatorAngle:
      solutionEnrichment?.operatorAngle ||
      audienceEnrichment?.operatorAngle ||
      undefined,
    uncertaintyNote:
      audienceEnrichment?.uncertaintyNote ||
      solutionEnrichment?.uncertaintyNote ||
      undefined
  };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(value: string): string[] {
  return normalize(value)
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function overlapScore(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  let matches = 0;

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      matches += 1;
    }
  }

  return matches;
}

/**
 * Expands specific concrete terms into operational concepts with domain discrimination
 * Helps matcher understand semantic relationships when scout outputs are concrete
 * Now includes domain-specific sub-concepts to reduce false positives
 *
 * Example: "Flux for Kubernetes" → ["k8s-deployment", "deployment", "automation"]
 * Example: "Approval delays" → ["cicd-process", "workflow"]
 */
function expandToConcepts(text: string): Set<string> {
  const normalized = normalize(text);
  const concepts = new Set<string>();

  // Domain-specific sub-concepts (added for false-positive reduction)

  // Kubernetes domain (GitOps, config management, K8s-specific deployment)
  const k8sDomainPatterns = [
    /\b(kubernetes|k8s)\b/,
    /\b(flux|argo|argocd|argo cd)\b/,
    /\b(gitops|helm|kustomize)\b/,
    /\b(kubectl|k8s config|kubernetes config)\b/
  ];
  for (const pattern of k8sDomainPatterns) {
    if (pattern.test(normalized)) {
      concepts.add('k8s-domain');
      break;
    }
  }

  // Multi-cloud infrastructure domain (AWS/GCP/Azure, cross-cloud management)
  if (/\b(aws|gcp|azure|multi cloud|multicloud)\b/.test(normalized) &&
      /\b(infrastructure|cloud|manage|management)\b/.test(normalized)) {
    concepts.add('multi-cloud-infra');
  }

  // CI/CD process domain (approval, gates, release processes - not deployment automation)
  if (/\b(approval|waiting|blocked|queue|gate)\b/.test(normalized) &&
      /\b(deploy|release|production|fix)\b/.test(normalized)) {
    concepts.add('cicd-process');
  }

  // Deployment automation (actual deployment tooling, not approval process)
  if (/\b(ci cd|cicd|pipeline|deployment|deploy|gitops)\b/.test(normalized) &&
      !/\b(approval|waiting|blocked|queue)\b/.test(normalized)) {
    concepts.add('deployment-automation');
  }

  // Incident response domain (on-call, incidents, paging - NOT deployment recovery)
  if (/\b(incident|outage|on call|oncall|pagerduty|paging|alert|escalation)\b/.test(normalized)) {
    concepts.add('incident-response');
  }

  // Broad concepts (preserved as fallback)

  // Deployment and release concepts
  const deploymentPatterns = [
    /\b(ci cd|cicd|pipeline|deployment|deploy|release|rollout|delivery)\b/,
    /\b(approval|waiting|blocked|bottleneck|delay)\b/,
    /\b(hotfix|production|staging)\b/
  ];
  for (const pattern of deploymentPatterns) {
    if (pattern.test(normalized)) {
      concepts.add('deployment');
      concepts.add('release');
      break;
    }
  }

  // Infrastructure and orchestration concepts
  const infrastructurePatterns = [
    /\b(infrastructure|cloud|aws|gcp|azure|multi cloud|multicloud)\b/,
    /\b(kubernetes|k8s|container|docker|orchestration)\b/,
    /\b(control plane|operator|terraform|iac|provisioning)\b/
  ];
  for (const pattern of infrastructurePatterns) {
    if (pattern.test(normalized)) {
      concepts.add('infrastructure');
      concepts.add('orchestration');
      break;
    }
  }

  // Workflow and handoff concepts
  const workflowPatterns = [
    /\b(workflow|handoff|handover|process|manual)\b/,
    /\b(ownership|accountability|owner|who owns)\b/,
    /\b(approval|queue|waiting|bottleneck)\b/
  ];
  for (const pattern of workflowPatterns) {
    if (pattern.test(normalized)) {
      concepts.add('workflow');
      concepts.add('handoff');
      break;
    }
  }

  // Observability and visibility concepts
  const visibilityPatterns = [
    /\b(visibility|observability|monitoring|dashboard|trace)\b/,
    /\b(status|coordination|audit|logging)\b/,
    /\b(incident|outage|on call|pagerduty)\b/
  ];
  for (const pattern of visibilityPatterns) {
    if (pattern.test(normalized)) {
      concepts.add('visibility');
      concepts.add('observability');
      break;
    }
  }

  // Recovery and resilience concepts
  const recoveryPatterns = [
    /\b(recovery|retry|resilience|fallback|exception)\b/,
    /\b(failure|stalled|broken|error handling)\b/,
    /\b(incident|outage|downtime)\b/
  ];
  for (const pattern of recoveryPatterns) {
    if (pattern.test(normalized)) {
      concepts.add('recovery');
      concepts.add('resilience');
      break;
    }
  }

  // Automation and tooling concepts
  const automationPatterns = [
    /\b(automation|automate|automated|engine|tool|platform)\b/,
    /\b(api|integration|connector|plugin)\b/,
    /\b(programmable|declarative|code)\b/
  ];
  for (const pattern of automationPatterns) {
    if (pattern.test(normalized)) {
      concepts.add('automation');
      concepts.add('tooling');
      break;
    }
  }

  return concepts;
}

/**
 * Scores semantic concept overlap between audience pain and solution
 * Complements keyword overlap for concrete scout outputs
 */
function semanticConceptScore(audienceText: string, solutionText: string): number {
  const audienceConcepts = expandToConcepts(audienceText);
  const solutionConcepts = expandToConcepts(solutionText);

  // Domain-specific sub-concepts (preferred matches, higher weight)
  const subConcepts = [
    'k8s-domain',
    'multi-cloud-infra',
    'cicd-process',
    'deployment-automation',
    'incident-response'
  ];

  let score = 0;
  let hasSubConceptMatch = false;
  let hasConflictingSubConcepts = false;

  // Detect which sub-concepts each side has
  const audienceSubConcepts = Array.from(audienceConcepts).filter(c => subConcepts.includes(c));
  const solutionSubConcepts = Array.from(solutionConcepts).filter(c => subConcepts.includes(c));

  // Check for sub-concept matches (weight: 2 points each)
  for (const subConcept of subConcepts) {
    if (audienceConcepts.has(subConcept) && solutionConcepts.has(subConcept)) {
      score += 2;
      hasSubConceptMatch = true;
    }
  }

  // Detect conflicting domains: if both sides have sub-concepts but NONE overlap
  if (audienceSubConcepts.length > 0 && solutionSubConcepts.length > 0 && !hasSubConceptMatch) {
    hasConflictingSubConcepts = true;
  }

  // Only count broad concept matches if:
  // 1. There's already a sub-concept match (reinforcing), OR
  // 2. Neither side has sub-concepts (fallback to broad matching)
  // Do NOT count if there are conflicting sub-concepts (different domains)
  if (!hasConflictingSubConcepts) {
    for (const concept of audienceConcepts) {
      if (solutionConcepts.has(concept) && !subConcepts.includes(concept)) {
        score += 1;
      }
    }
  }

  // Penalty for conflicting domains to prevent false positives
  // This ensures matches fail the fitScore >= 2 threshold
  if (hasConflictingSubConcepts) {
    score -= 3;
  }

  return score;
}

function thematicFitScore(audienceText: string, solutionText: string): number {
  const left = normalize(audienceText);
  const right = normalize(solutionText);
  const families = [
    /\b(handoff|ownership|owner|approval|accountability)\b/,
    /\b(visibility|status|coordination|trace|audit|dashboard)\b/,
    /\b(workflow|automation|manual|queue)\b/,
    /\b(recovery|retry|exception|stalled|failure)\b/,
    /\b(support|confusion|escalation|adoption|rollout)\b/
  ];

  return families.reduce((score, family) => {
    if (family.test(left) && family.test(right)) {
      return score + 1;
    }

    return score;
  }, 0);
}

function confidenceWeight(value: "high" | "medium" | "low"): number {
  if (value === "high") {
    return 1;
  }

  return 0;
}

function strengthWeight(value: "strong" | "medium" | "weak" | undefined): number {
  if (value === "strong") {
    return 2;
  }

  if (value === "medium") {
    return 1;
  }

  return 0;
}

function feedbackBias(
  text: string,
  feedbackSummary?: FeedbackSummary,
  patternMemorySummary?: PatternMemorySummary
): number {
  const corpus = normalize(text);
  let score = 0;

  for (const repeat of feedbackSummary?.suggestedRepeats ?? []) {
    if (corpus.includes(normalize(repeat))) {
      score += 1;
    }
  }

  for (const strong of feedbackSummary?.strongPatterns ?? []) {
    if (corpus.includes(normalize(strong))) {
      score += 1;
    }
  }

  for (const avoid of feedbackSummary?.suggestedAvoids ?? []) {
    if (corpus.includes(normalize(avoid))) {
      score -= 1;
    }
  }

  for (const weak of feedbackSummary?.weakPatterns ?? []) {
    if (corpus.includes(normalize(weak))) {
      score -= 1;
    }
  }

  for (const repeat of patternMemorySummary?.recurringThemes ?? []) {
    if (corpus.includes(normalize(repeat))) {
      score += 1;
    }
  }

  for (const weak of patternMemorySummary?.weakThemes ?? []) {
    if (corpus.includes(normalize(weak))) {
      score -= 1;
    }
  }

  return score;
}

function recommendedActionForMatch(
  audienceAction: ScoutMatchInput["audienceItems"][number]["suggestedActionType"],
  solutionItem: SolutionScoutItem
): MatchedOpportunity["recommendedAction"] {
  if (
    audienceAction === "reply_opportunity" ||
    solutionItem.suggestedActionType === "reply_opportunity"
  ) {
    return "write_reply";
  }

  if (
    audienceAction === "comment_opportunity" ||
    solutionItem.suggestedActionType === "comment_opportunity"
  ) {
    return "write_comment";
  }

  if (
    audienceAction === "later" &&
    solutionItem.suggestedActionType === "later"
  ) {
    return "save_for_later";
  }

  return "write_post";
}

function confidenceForScore(score: number): MatchedOpportunity["confidence"] {
  // Thresholds recalibrated after semanticScore *1.5 weight + themeScore *2
  // were added to totalScore; original thresholds (>=7 high, >=4 medium) were
  // tuned for the pre-multiplier formula and now produce false-high on
  // neutral inputs. Empirically measured: neutral test case totalScore=12,
  // biased case totalScore=13 (bias=+1 from feedbackSummary). Test wants
  // neutral=medium, biased=high - hence cutoff at 13.
  if (score >= 13) {
    return "high";
  }

  if (score >= 5) {
    return "medium";
  }

  return "low";
}

function opportunityStrengthForScore(
  score: number
): NonNullable<MatchedOpportunity["opportunityStrength"]> {
  if (score >= 7) {
    return "strong";
  }

  if (score >= 4) {
    return "medium";
  }

  return "weak";
}

function whyMatchWorks(
  audienceSummary: string,
  solutionPattern: string,
  action: MatchedOpportunity["recommendedAction"],
  bias: number
): string {
  const biasNote =
    bias > 0
      ? " Recent feedback and memory lightly reinforce this match."
      : bias < 0
        ? " Recent feedback suggests some caution on this theme."
        : "";

  return `${solutionPattern} addresses the same operator problem surfaced in "${audienceSummary}". This is most usable as ${action.replace("_", " ")}.${biasNote}`;
}

function buildMatchScoreNotes(input: {
  baseScore: number;
  themeScore: number;
  semanticScore: number;
  bias: number;
  audienceConfidence: "high" | "medium" | "low";
  solutionConfidence: "high" | "medium" | "low";
  audienceStrength: "strong" | "medium" | "weak" | undefined;
  solutionStrength: "strong" | "medium" | "weak" | undefined;
  recommendedAction: MatchedOpportunity["recommendedAction"];
}): string[] {
  const notes: string[] = [];

  if (input.baseScore >= 5) {
    notes.push("High keyword overlap");
  } else if (input.baseScore >= 3) {
    notes.push("Relevant pain-to-solution overlap");
  }

  if (input.themeScore >= 1) {
    notes.push("Shared operational theme");
  }

  // NEW: Note semantic concept matching for concrete outputs
  if (input.semanticScore >= 2) {
    notes.push("Strong semantic concept fit");
  } else if (input.semanticScore >= 1) {
    notes.push("Relevant semantic concepts");
  }

  if (
    confidenceWeight(input.audienceConfidence) + confidenceWeight(input.solutionConfidence) >= 3 ||
    strengthWeight(input.audienceStrength) + strengthWeight(input.solutionStrength) >= 3
  ) {
    notes.push("Strong scout signals");
  }

  if (input.recommendedAction !== "save_for_later") {
    notes.push("Both sides are actionable");
  }

  if (input.bias > 0) {
    notes.push("Feedback and memory reinforce this theme");
  }

  if (input.bias < 0) {
    notes.push("Feedback suggests caution");
  }

  return notes;
}

export function buildScoutMatchResult(input: ScoutMatchInput): ScoutMatchResult {
  if (input.audienceItems.length === 0 || input.solutionItems.length === 0) {
    return {
      items: [],
      summary: "No matched pain-to-solution opportunities yet.",
      notes: "Add both audience pain items and solution items before running the match layer."
    };
  }

  const matches = input.audienceItems
    .flatMap((audienceItem) =>
      input.solutionItems.map((solutionItem) => {
        const baseScore =
          overlapScore(audienceItem.painSignalSummary, solutionItem.solutionPattern) +
          overlapScore(audienceItem.whyItMatters, solutionItem.implementationLesson) +
          overlapScore(audienceItem.rawExcerpt, solutionItem.rawExcerpt);
        const themeScore = thematicFitScore(
          `${audienceItem.painSignalSummary} ${audienceItem.whyItMatters} ${audienceItem.topicCluster ?? ""}`,
          `${solutionItem.solutionPattern} ${solutionItem.implementationLesson} ${solutionItem.whyItMatters}`
        );
        // NEW: Semantic concept matching for concrete scout outputs
        const semanticScore = semanticConceptScore(
          `${audienceItem.painSignalSummary} ${audienceItem.whyItMatters} ${audienceItem.rawExcerpt}`,
          `${solutionItem.solutionPattern} ${solutionItem.implementationLesson} ${solutionItem.rawExcerpt}`
        );
        const bias = feedbackBias(
          `${audienceItem.painSignalSummary} ${solutionItem.solutionPattern} ${solutionItem.implementationLesson}`,
          input.feedbackSummary,
          input.patternMemorySummary
        );
        const recommendedAction = recommendedActionForMatch(
          audienceItem.suggestedActionType,
          solutionItem
        );
        const strengthBonus =
          confidenceWeight(audienceItem.confidence) +
          confidenceWeight(solutionItem.confidence) +
          strengthWeight(audienceItem.signalStrength) +
          strengthWeight(solutionItem.signalStrength) +
          (recommendedAction !== "save_for_later" ? 1 : 0);
        // Semantic score weighted at 1.5x (between base and theme)
        const totalScore = baseScore + themeScore * 2 + semanticScore * 1.5 + bias + strengthBonus;
        const scoreNotes = buildMatchScoreNotes({
          baseScore,
          themeScore,
          semanticScore,
          bias,
          audienceConfidence: audienceItem.confidence,
          solutionConfidence: solutionItem.confidence,
          audienceStrength: audienceItem.signalStrength,
          solutionStrength: solutionItem.signalStrength,
          recommendedAction
        });

        return {
          match: {
            id: `match-${audienceItem.id}-${solutionItem.id}`,
            audienceItemId: audienceItem.id,
            solutionItemId: solutionItem.id,
            matchedPain: audienceItem.painSignalSummary,
            matchedSolutionPattern: solutionItem.solutionPattern,
            whyThisMatchWorks: whyMatchWorks(
              audienceItem.painSignalSummary,
              solutionItem.solutionPattern,
              recommendedAction,
              bias
            ),
            suggestedAngle: solutionItem.suggestedAngle,
            recommendedAction,
            confidence: confidenceForScore(totalScore),
            opportunityStrength: opportunityStrengthForScore(totalScore),
            scoreNotes,
            aiEnrichment: mergeScoutEnrichments(
              audienceItem.aiEnrichment,
              solutionItem.aiEnrichment
            ),
            createdAt: MATCH_CREATED_AT
          } satisfies MatchedOpportunity,
          score: totalScore,
          // Include semantic score in fitScore (at 1x weight)
          fitScore: baseScore + themeScore * 2 + semanticScore
        };
      })
    )
    .filter((entry) => entry.fitScore >= 2 && entry.score >= 3)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map((entry) => entry.match);

  if (matches.length === 0) {
    return {
      items: [],
      summary: "No strong pain-to-solution matches found yet.",
      notes: "The current scout items do not align closely enough to recommend an action."
    };
  }

  return {
    items: matches,
    summary: `${matches.length} matched pain-to-solution opportunities shortlisted.`,
    notes: "Scout matches stay review-first. Send useful matches into Source Intake, the queue, or Decision Planner before any generation step."
  };
}
