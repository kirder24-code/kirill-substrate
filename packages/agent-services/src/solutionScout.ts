import type {
  RelevanceAnalysis,
  SolutionScoutInput,
  SolutionScoutItem,
  SolutionScoutResult
} from "@linkedin-brand-os/shared";

const SOLUTION_SCOUT_CREATED_AT = "2026-03-15T00:00:00.000Z";

type SolutionPattern =
  | "workflow_automation"
  | "exception_recovery"
  | "orchestration_state"
  | "support_reduction"
  | "visibility_coordination"
  | "adoption_rollout"
  | "general";

interface ScoredSolutionSignal {
  score: number;
  strength: NonNullable<SolutionScoutItem["signalStrength"]>;
  confidence: SolutionScoutItem["confidence"];
  notes: string[];
}

function normalizeText(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function classifySolutionPattern(input: SolutionScoutInput): SolutionPattern {
  const corpus = normalizeText(
    [
      input.sourceType,
      input.targetProblem,
      input.sourceLabel,
      input.sourceExcerpt,
      input.operatorNotes
    ]
      .filter(Boolean)
      .join(" ")
  );

  if (/\b(retry|retries|recover|recovery|fallback|failed run|stalled)\b/.test(corpus)) {
    return "exception_recovery";
  }

  if (/\b(state|orchestration|coordination|worker|cache|reliability|boundary)\b/.test(corpus)) {
    return "orchestration_state";
  }

  if (/\b(visibility|audit|status|dashboard|trace|ownership)\b/.test(corpus)) {
    return "visibility_coordination";
  }

  if (/\b(support|confusion|ticket|friction|escalation)\b/.test(corpus)) {
    return "support_reduction";
  }

  if (/\b(rollout|adoption|enablement|launch|pilot|onboarding)\b/.test(corpus)) {
    return "adoption_rollout";
  }

  if (/\b(automation|workflow|manual|handoff|approval|queue)\b/.test(corpus)) {
    return "workflow_automation";
  }

  return "general";
}

function suggestedAngleForPattern(pattern: SolutionPattern): RelevanceAnalysis["bestAngle"] {
  switch (pattern) {
    case "exception_recovery":
      return "exception_handling";
    case "orchestration_state":
      return "workflow_accountability";
    case "support_reduction":
      return "handoff_failure";
    case "adoption_rollout":
      return "operational_roi";
    case "visibility_coordination":
      return "workflow_accountability";
    case "workflow_automation":
      return "ownership_gap";
    default:
      return "workflow_accountability";
  }
}

function suggestedActionForPattern(
  pattern: SolutionPattern,
  targetProblem?: string
): SolutionScoutItem["suggestedActionType"] {
  if (pattern === "general") {
    return "later";
  }

  if (targetProblem && targetProblem.trim().length > 0) {
    return "post_candidate";
  }

  if (pattern === "support_reduction" || pattern === "adoption_rollout") {
    return "comment_opportunity";
  }

  if (pattern === "exception_recovery" || pattern === "visibility_coordination") {
    return "reply_opportunity";
  }

  return "post_candidate";
}

function confidenceForSolutionStrength(
  strength: NonNullable<SolutionScoutItem["signalStrength"]>
): SolutionScoutItem["confidence"] {
  if (strength === "strong") {
    return "high";
  }

  if (strength === "medium") {
    return "medium";
  }

  return "low";
}

function strengthForSolutionScore(
  score: number
): NonNullable<SolutionScoutItem["signalStrength"]> {
  if (score >= 5) {
    return "strong";
  }

  if (score >= 3) {
    return "medium";
  }

  return "weak";
}

function scoreSolutionSignal(
  input: SolutionScoutInput,
  pattern: SolutionPattern
): ScoredSolutionSignal {
  const excerpt = normalizeText(input.sourceExcerpt);
  const combined = normalizeText(
    [input.targetProblem, input.sourceLabel, input.operatorNotes, input.sourceType].filter(Boolean).join(" ")
  );
  let score = 0;
  const notes: string[] = [];

  if (pattern !== "general") {
    score += 2;
    notes.push("Concrete implementation lesson");
  }

  if (
    input.sourceExcerpt.trim().length >= 90 ||
    /\b(adds|added|exposes|retry|recovery|state|ownership|queue|visibility|workflow|approval)\b/.test(
      excerpt
    )
  ) {
    score += 1;
    notes.push("Implementation details are concrete");
  }

  if (
    /\b(but|however|tradeoff|constraint|overhead|complexity|rigid|noise|clarity)\b/.test(excerpt)
  ) {
    score += 1;
    notes.push("Tradeoff is explicit");
  }

  if (
    /\b(support|escalation|recovery|stalled|adoption|rollout|reliability|ownership|coordination)\b/.test(
      excerpt
    )
  ) {
    score += 1;
    notes.push("Business consequence is visible");
  }

  if (input.targetProblem && input.targetProblem.trim().length > 0) {
    score += 1;
    notes.push("Target problem alignment");
  }

  if (input.sourceType === "github" || input.sourceType === "article") {
    score += 1;
    notes.push("Source framing is specific");
  } else if (/\b(github|release|issue|case study|blog|report)\b/.test(combined)) {
    score += 1;
    notes.push("Source framing is specific");
  }

  const strength = strengthForSolutionScore(score);
  return {
    score,
    strength,
    confidence: confidenceForSolutionStrength(strength),
    notes
  };
}

/**
 * Extract key capability from source excerpt
 * Preserves specific tool/solution details instead of generic pattern
 */
function extractCapability(sourceExcerpt: string, sourceLabel?: string): string {
  const excerpt = sourceExcerpt.trim();

  // If excerpt is short and specific, use it directly
  if (excerpt.length > 0 && excerpt.length <= 120) {
    return excerpt;
  }

  // Extract first sentence or key phrase
  const firstSentence = excerpt.split(/[.!?]\s/)[0];
  if (firstSentence && firstSentence.length > 0 && firstSentence.length <= 120) {
    return firstSentence;
  }

  // Fallback: use source label if available
  if (sourceLabel && sourceLabel.length > 0) {
    return sourceLabel;
  }

  // Last resort: truncate excerpt
  return excerpt.substring(0, 100);
}

function derivePatternLabel(pattern: SolutionPattern, sourceExcerpt: string, sourceLabel?: string): string {
  const capability = extractCapability(sourceExcerpt, sourceLabel);

  // Use actual capability instead of generic pattern
  return capability;
}

function deriveImplementationLesson(pattern: SolutionPattern, sourceExcerpt: string, sourceLabel?: string): string {
  const capability = extractCapability(sourceExcerpt, sourceLabel);

  // If we have specific capability, use it with pattern context
  if (capability && capability.length > 0 && capability !== sourceExcerpt.substring(0, 100)) {
    // Use the specific capability as the lesson
    return capability;
  }

  // Extract longer excerpt for more detail if available
  if (sourceExcerpt.length > 120) {
    const sentences = sourceExcerpt.split(/[.!?]\s/);
    if (sentences.length > 1 && sentences[1]) {
      return sentences.slice(0, 2).join('. ').trim();
    }
  }

  // Fallback to pattern-based lesson only if no specific content available
  switch (pattern) {
    case "workflow_automation":
      return "Automate only after the owner, approval path, and handoff are explicit.";
    case "exception_recovery":
      return "Make recovery ownership visible before the workflow hits its first failure path.";
    case "orchestration_state":
      return "Keep state boundaries and coordination rules explicit before scaling orchestration.";
    case "support_reduction":
      return "Reduce support load by making the real workflow legible in the product, not just in docs.";
    case "visibility_coordination":
      return "Expose status and ownership early so operators can intervene before work stalls.";
    case "adoption_rollout":
      return "Ship rollout and enablement discipline alongside the feature, not after adoption slips.";
    default:
      return "The solution pattern is still broad and needs clearer implementation detail.";
  }
}

function deriveTradeoff(pattern: SolutionPattern): string {
  switch (pattern) {
    case "workflow_automation":
      return "Automation adds value only if the surrounding workflow is stable enough to absorb it.";
    case "exception_recovery":
      return "Recovery guardrails add reliability, but they also add operational complexity to maintain.";
    case "orchestration_state":
      return "Clear state boundaries improve scale, but they can slow iteration if the design is too rigid.";
    case "support_reduction":
      return "Reducing friction often requires extra product clarity and implementation effort up front.";
    case "visibility_coordination":
      return "Visibility helps coordination, but it can create noise if ownership is still undefined.";
    case "adoption_rollout":
      return "Rollout discipline improves adoption, but it demands more structured enablement than a quick launch.";
    default:
      return "The tradeoff is still unclear because the source material is too broad.";
  }
}

function deriveWhyItMatters(pattern: SolutionPattern, targetProblem?: string): string {
  const targetClause =
    targetProblem && targetProblem.trim().length > 0
      ? ` against the stated problem of ${targetProblem.trim()}`
      : "";

  switch (pattern) {
    case "workflow_automation":
      return `This turns a solution into an operator lesson about ownership, automation boundaries, and practical rollout discipline${targetClause}.`;
    case "exception_recovery":
      return `This gives the operator a concrete resilience lesson about failures, retries, and visible recovery paths${targetClause}.`;
    case "orchestration_state":
      return `This surfaces a system-design lesson about coordination, state, and scaling tradeoffs${targetClause}.`;
    case "support_reduction":
      return `This is useful because it connects product clarity to lower support drag and cleaner execution${targetClause}.`;
    case "visibility_coordination":
      return `This gives the operator a strong way to explain why visibility and coordination matter before work breaks${targetClause}.`;
    case "adoption_rollout":
      return `This gives the operator a practical solution angle around rollout discipline, enablement, and adoption${targetClause}.`;
    default:
      return "This source needs clearer implementation detail before it becomes a strong solution signal.";
  }
}

function summarizeId(input: SolutionScoutInput): string {
  return normalizeText(
    [input.sourceType, input.sourceLabel, input.targetProblem, input.sourceExcerpt]
      .filter(Boolean)
      .join(" ")
  )
    .replace(/\s+/g, "-")
    .slice(0, 48);
}

export function buildSolutionScoutResult(input: SolutionScoutInput): SolutionScoutResult {
  const excerpt = input.sourceExcerpt.trim();
  if (!excerpt) {
    return {
      items: [],
      summary: "No strong solution signals found for review yet.",
      notes:
        "Solution Scout needs at least one usable source excerpt. It stays operator-reviewed and deterministic."
    };
  }

  const pattern = classifySolutionPattern(input);
  const scored = scoreSolutionSignal(input, pattern);
  const item: SolutionScoutItem = {
    id: `solution-${summarizeId(input) || "signal"}`,
    sourceType: input.sourceType ?? "mixed",
    sourceLabel: input.sourceLabel?.trim() || undefined,
    sourceUrl: input.sourceUrl?.trim() || undefined,
    rawExcerpt: excerpt,
    solutionPattern: derivePatternLabel(pattern, excerpt, input.sourceLabel),
    implementationLesson: deriveImplementationLesson(pattern, excerpt, input.sourceLabel),
    tradeoffOrConstraint: deriveTradeoff(pattern),
    whyItMatters: deriveWhyItMatters(pattern, input.targetProblem),
    suggestedAngle: suggestedAngleForPattern(pattern),
    suggestedActionType:
      scored.strength === "weak"
        ? "later"
        : suggestedActionForPattern(pattern, input.targetProblem),
    confidence: scored.confidence,
    signalStrength: scored.strength,
    scoreNotes: scored.notes,
    createdAt: SOLUTION_SCOUT_CREATED_AT
  };

  return {
    items: [item],
    summary:
      scored.confidence === "low"
        ? "1 low-confidence solution pattern captured for review."
        : "1 solution pattern shortlisted for review.",
    notes:
      "Solution Scout is review-first. Send useful items into Source Intake, the queue, or Decision Planner before any generation step."
  };
}

export { classifySolutionPattern };
