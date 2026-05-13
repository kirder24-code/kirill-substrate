import type {
  NormalizedSourceSignal,
  RelevanceAnalysis,
  SourceIntakeInput
} from "@linkedin-brand-os/shared";

const SENTENCE_SPLIT_PATTERN = /(?<=[.!?])\s+/;

interface GitHubSignalLens {
  changeKind: GitHubChangeKind;
  suggestedAngle: RelevanceAnalysis["bestAngle"];
  technicalChangeKind: string;
  executionImplication: string;
  workflowImplication: string;
  businessImplication: string;
  positioningAngle: string;
}

type GitHubChangeKind =
  | "rollout_adoption"
  | "exception_recovery"
  | "orchestration_state"
  | "support_friction"
  | "system_tradeoff"
  | "general_change";

type SourcePattern =
  | "workflow_pain"
  | "execution_lesson"
  | "field_pattern"
  | "system_tradeoff"
  | "resilience_recovery"
  | "adoption_momentum"
  | "support_friction"
  | "operational_visibility"
  | "general_pattern";

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function cleanSentence(value: string): string {
  return normalizeWhitespace(value).replace(/\s+([,.;:!?])/g, "$1");
}

function splitSentences(value: string): string[] {
  return normalizeWhitespace(value)
    .split(SENTENCE_SPLIT_PATTERN)
    .map(cleanSentence)
    .filter(Boolean);
}

function inferAngle(corpus: string): RelevanceAnalysis["bestAngle"] {
  if (/\b(retry|retries|recovery|fallback|fallbacks|visibility|queue-state|queue state)\b/i.test(corpus)) {
    return "workflow_accountability";
  }

  if (/\b(owner|owns|ownership|accountability|accountable)\b/i.test(corpus)) {
    return "ownership_gap";
  }

  if (/\b(handoff|handoffs|handover)\b/i.test(corpus)) {
    return "handoff_failure";
  }

  if (/\b(exception|exceptions|edge case|edge cases|fallback)\b/i.test(corpus)) {
    return "exception_handling";
  }

  if (/\b(roi|throughput|margin|cost|pipeline|revenue)\b/i.test(corpus)) {
    return "operational_roi";
  }

  return "workflow_accountability";
}

export function classifySourcePattern(input: SourceIntakeInput): SourcePattern {
  const lowered = [
    input.title,
    input.summaryText,
    input.operatorNotes,
    input.repoName,
    input.repoContext,
    input.releaseOrChangeType,
    input.githubSubtype,
    input.companyContext
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (input.sourceType === "github") {
    const changeKind = classifyGitHubChangeKind(input);

    if (changeKind === "rollout_adoption") {
      return "adoption_momentum";
    }

    if (changeKind === "exception_recovery") {
      return "resilience_recovery";
    }

    if (changeKind === "support_friction") {
      return "support_friction";
    }

    if (changeKind === "orchestration_state") {
      return "operational_visibility";
    }

    if (changeKind === "system_tradeoff") {
      return "system_tradeoff";
    }

    return "execution_lesson";
  }

  if (
    /\b(repeat|repeatedly|same pattern|keeps surfacing|manual interviews|field lesson|field note|keeps seeing)\b/.test(
      lowered
    )
  ) {
    return "field_pattern";
  }

  if (/\b(recovery|recover|retry|retries|fallback|resilience)\b/.test(lowered)) {
    return "resilience_recovery";
  }

  if (/\b(owner|ownership|handoff|handoffs|exception|workflow|stall|stalls|pilot)\b/.test(lowered)) {
    return "workflow_pain";
  }

  if (/\b(visibility|visible|audit trail|audit history|observability|queue visibility)\b/.test(lowered)) {
    return "operational_visibility";
  }

  if (/\b(adoption|rollout|launch|shipping|ship|momentum|distribution|usability)\b/.test(lowered)) {
    return "adoption_momentum";
  }

  if (/\b(architecture|tradeoff|tradeoffs|scaling|distributed|coordination|orchestration|state)\b/.test(lowered)) {
    return "system_tradeoff";
  }

  if (/\b(friction|support burden|support|confusion|ux friction|pain)\b/.test(lowered)) {
    return "support_friction";
  }

  return "execution_lesson";
}

function sourcePatternAngle(
  input: SourceIntakeInput,
  corpus: string,
  pattern: SourcePattern
): RelevanceAnalysis["bestAngle"] {
  if (input.sourceType === "github") {
    return inferGithubAngle(input, corpus);
  }

  if (pattern === "workflow_pain") {
    return inferAngle(corpus);
  }

  if (pattern === "resilience_recovery") {
    return "workflow_accountability";
  }

  if (pattern === "adoption_momentum") {
    return "operational_roi";
  }

  if (pattern === "system_tradeoff") {
    return "workflow_accountability";
  }

  if (pattern === "support_friction") {
    return "exception_handling";
  }

  if (pattern === "operational_visibility") {
    return "workflow_accountability";
  }

  if (pattern === "field_pattern") {
    return inferAngle(corpus);
  }

  return inferAngle(corpus);
}

export function classifyGitHubChangeKind(input: SourceIntakeInput): GitHubChangeKind {
  const lowered = [
    input.title,
    input.summaryText,
    input.operatorNotes,
    input.repoName,
    input.repoContext,
    input.releaseOrChangeType,
    input.githubSubtype
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const isRollout = /\b(rollout|adoption|launch|ship|shipping|distribution|packaging|usability|release train|release)\b/.test(
    lowered
  );
  const isExceptionRecovery =
    /\b(retry|retries|recovery|recover|failure handling|failed runs|failed run|resilience|fallback|fallbacks)\b/.test(
      lowered
    );
  const isSupportFriction =
    /\b(support burden|support|confusion|ux friction|friction|pain|escalation|escalations)\b/.test(
      lowered
    );
  const isOrchestrationState =
    /\b(state|orchestration|coordination|async|workers|caching|cache|reliability)\b/.test(lowered);
  const isSystemTradeoff =
    /\b(architecture|tradeoff|tradeoffs|scaling|boundaries|boundary|distributed)\b/.test(lowered);

  if (input.githubSubtype === "repo_change") {
    if (isOrchestrationState) {
      return "orchestration_state";
    }

    if (isSystemTradeoff) {
      return "system_tradeoff";
    }

    if (isExceptionRecovery) {
      return "exception_recovery";
    }
  }

  if (input.githubSubtype === "issue") {
    if (isExceptionRecovery) {
      return "exception_recovery";
    }

    if (isSupportFriction) {
      return "support_friction";
    }
  }

  if (input.githubSubtype === "release") {
    if (isRollout) {
      return "rollout_adoption";
    }
  }

  if (isExceptionRecovery) {
    return "exception_recovery";
  }

  if (isSupportFriction) {
    return "support_friction";
  }

  if (isOrchestrationState) {
    return "orchestration_state";
  }

  if (isSystemTradeoff) {
    return "system_tradeoff";
  }

  if (isRollout) {
    return "rollout_adoption";
  }

  return "general_change";
}

function inferGithubAngle(input: SourceIntakeInput, corpus: string): RelevanceAnalysis["bestAngle"] {
  const lowered = corpus.toLowerCase();
  const changeKind = classifyGitHubChangeKind(input);

  if (changeKind === "rollout_adoption") {
    return "operational_roi";
  }

  if (changeKind === "exception_recovery") {
    return "workflow_accountability";
  }

  if (changeKind === "orchestration_state") {
    return "workflow_accountability";
  }

  if (changeKind === "support_friction") {
    return "exception_handling";
  }

  if (changeKind === "system_tradeoff") {
    return "workflow_accountability";
  }

  if (input.githubSubtype === "release") {
    if (/\b(ship|shipping|release|rollout|adoption|launch|packaging|momentum)\b/.test(lowered)) {
      return "operational_roi";
    }
  }

  if (input.githubSubtype === "issue") {
    if (/\b(issue|bug|friction|pain|stall|stalls|support|edge case|edge cases|exception)\b/.test(lowered)) {
      return "exception_handling";
    }
  }

  if (input.githubSubtype === "repo_change") {
    if (/\b(state|orchestration|architecture|tradeoff|tradeoffs|scaling|workers|async)\b/.test(lowered)) {
      return "workflow_accountability";
    }
  }

  return inferAngle(corpus);
}

function deriveGitHubSignalLens(input: SourceIntakeInput, corpus: string): GitHubSignalLens {
  const lowered = corpus.toLowerCase();
  const changeKind = classifyGitHubChangeKind(input);
  const suggestedAngle = inferGithubAngle(input, corpus);

  if (changeKind === "rollout_adoption") {
    if (/\b(rollout|adoption|launch|ship|shipping|distribution|packaging|simpler|usability)\b/.test(lowered)) {
      return {
        changeKind,
        suggestedAngle,
        technicalChangeKind: "release packaging and rollout controls",
        executionImplication: "teams can ship with less operator confusion and less rollout drag",
        workflowImplication: "operators get clearer visibility into what needs intervention during adoption",
        businessImplication: "product momentum is easier to convert into usable adoption when rollout discipline is built in",
        positioningAngle: "shipping discipline matters more than feature volume"
      };
    }

    return {
      changeKind,
      suggestedAngle,
      technicalChangeKind: "release packaging",
      executionImplication: "shipping gets easier when rollout friction is reduced",
      workflowImplication: "operators spend less time translating product change into manual coordination",
      businessImplication: "better packaging turns product movement into adoption instead of confusion",
      positioningAngle: "release quality is an adoption lever"
    };
  }

  if (changeKind === "exception_recovery") {
    if (/\b(exception|edge case|edge cases|stall|stalls|support|escalation|recovery|retry|retries)\b/.test(lowered)) {
      return {
        changeKind,
        suggestedAngle,
        technicalChangeKind: "failure handling and recovery paths",
        executionImplication: "teams lose momentum when retries and recovery ownership are unclear",
        workflowImplication: "the workflow stalls at the exact moment the system needs a visible recovery path",
        businessImplication: "operational resilience stays weak when exception recovery depends on manual guesswork",
        positioningAngle: "recovery design is part of workflow accountability"
      };
    }
  }

  if (changeKind === "support_friction") {
    return {
      changeKind,
      suggestedAngle,
      technicalChangeKind: "issue traffic and repeated support pain",
      executionImplication: "technical friction spills into daily operator work and repeated support loops",
      workflowImplication: "the system keeps pushing users into avoidable confusion and support-heavy handoffs",
      businessImplication: "unresolved friction compounds into support cost, slower execution, and operator drag",
      positioningAngle: "support pain is often a workflow design signal"
    };
  }

  if (changeKind === "orchestration_state") {
    return {
      changeKind,
      suggestedAngle,
      technicalChangeKind: "repo-level orchestration and state design changes",
      executionImplication: "scaling flexibility increases the need for stronger operating discipline",
      workflowImplication: "distributed state raises the cost of unclear ownership and coordination boundaries",
      businessImplication: "reliability depends on system discipline, not just more infrastructure",
      positioningAngle: "architecture choices shape operator clarity"
    };
  }

  if (changeKind === "system_tradeoff") {
    return {
      changeKind,
      suggestedAngle,
      technicalChangeKind: "architecture and scaling tradeoffs",
      executionImplication: "more system flexibility raises the cost of unclear coordination boundaries",
      workflowImplication: "teams need cleaner ownership and reliability discipline as the architecture gets more distributed",
      businessImplication: "scaling tradeoffs matter because reliability and coordination costs compound quietly",
      positioningAngle: "system tradeoffs shape operator clarity long before customers see the architecture"
    };
  }

  return {
    changeKind,
    suggestedAngle,
    technicalChangeKind: "implementation changes",
    executionImplication: "technical updates matter most when they change how work gets executed in production",
    workflowImplication: "workflow visibility and ownership decide whether systems stay usable under pressure",
    businessImplication: "operational clarity is what turns engineering improvement into real leverage",
    positioningAngle: "engineering changes become business signals when they reshape execution"
  };
}

function buildGithubSignalText(input: SourceIntakeInput, corpus: string): string {
  const lens = deriveGitHubSignalLens(input, corpus);

  if (lens.changeKind === "rollout_adoption") {
    return cleanSentence(
      `Shipping momentum only matters when rollout clarity and operator visibility make adoption easier in real teams. ${lens.businessImplication}.`
    );
  }

  if (lens.changeKind === "exception_recovery") {
    return cleanSentence(
      `Recovery design shows up in execution before it shows up in dashboards: ${lens.executionImplication}. ${lens.businessImplication}.`
    );
  }

  if (lens.changeKind === "support_friction") {
    return cleanSentence(
      `Support-heavy issue patterns expose where the workflow keeps leaking pain back to operators and users. ${lens.businessImplication}.`
    );
  }

  if (lens.changeKind === "orchestration_state") {
    return cleanSentence(
      `State and orchestration changes reveal how much operator clarity depends on visible coordination boundaries. ${lens.businessImplication}.`
    );
  }

  if (lens.changeKind === "system_tradeoff") {
    return cleanSentence(
      `Architecture tradeoffs stop being abstract when they reshape reliability, coordination, and ownership under scale. ${lens.businessImplication}.`
    );
  }

  return cleanSentence(
    `Technical updates are most useful when they reveal an execution lesson operators can act on. ${lens.workflowImplication}.`
  );
}

function buildNormalizedSignalText(input: SourceIntakeInput, corpus: string): string {
  const pattern = classifySourcePattern(input);

  if (input.sourceType === "github") {
    return buildGithubSignalText(input, corpus);
  }

  const sentences = splitSentences(corpus);
  const title = cleanSentence(input.title);
  const firstSentence = sentences[0] ?? title;
  const secondSentence = sentences[1];
  const lowered = `${title} ${sentences.join(" ")}`.toLowerCase();

  const titleLead = /^why\s+/i.test(title)
    ? title.replace(/^why\s+/i, "").replace(/\?+$/, "")
    : title;

  if (/\bdemo\b/.test(lowered) && /\bowner|ownership\b/.test(lowered)) {
    return cleanSentence(
      `${titleLead} because nobody owns the surrounding workflow or exception path.`
    );
  }

  if (/\bapproval|approvals\b/.test(lowered) && /\bexception\b/.test(lowered)) {
    return cleanSentence(
      "Approval workflows stall when exception handling is undefined and nobody owns the next step after the pilot."
    );
  }

  if (pattern === "field_pattern") {
    return cleanSentence(
      "Field notes keep pointing to the same execution lesson: teams ship faster when ownership, adoption, and recovery are clarified before the workflow gets messy."
    );
  }

  if (pattern === "resilience_recovery") {
    return cleanSentence(
      "Execution breaks down when recovery paths stay vague and operators have to guess who owns the next step after failure."
    );
  }

  if (pattern === "operational_visibility") {
    return cleanSentence(
      "Operational visibility matters because teams move faster when workflow state, ownership, and intervention points are easier to see."
    );
  }

  if (pattern === "adoption_momentum") {
    return cleanSentence(
      "Adoption momentum improves when teams reduce rollout confusion and make the workflow easier to use in real operating conditions."
    );
  }

  if (secondSentence) {
    return cleanSentence(`${firstSentence} ${secondSentence}`);
  }

  return cleanSentence(firstSentence);
}

export function normalizeSourceIntake(input: SourceIntakeInput): NormalizedSourceSignal {
  const summaryText = cleanSentence(input.summaryText);
  const operatorNotes = input.operatorNotes ? cleanSentence(input.operatorNotes) : "";
  const repoName = input.repoName ? cleanSentence(input.repoName) : "";
  const repoContext = input.repoContext ? cleanSentence(input.repoContext) : "";
  const releaseOrChangeType = input.releaseOrChangeType
    ? cleanSentence(input.releaseOrChangeType)
    : "";
  const companyContext = input.companyContext ? cleanSentence(input.companyContext) : "";
  const corpus = [
    input.title,
    summaryText,
    operatorNotes,
    input.githubSubtype ?? "",
    repoName,
    repoContext,
    releaseOrChangeType,
    companyContext
  ]
    .filter(Boolean)
    .join(" ");
  const sourcePattern = classifySourcePattern(input);
  const suggestedAngle = sourcePatternAngle(input, corpus, sourcePattern);
  const normalizedSignalText = buildNormalizedSignalText(input, corpus);

  const sourceLabel =
    input.sourceType === "article"
      ? "article"
      : input.sourceType === "github"
        ? "GitHub"
        : "manual research";
  const reasoningSummary =
    input.sourceType === "github"
      ? (() => {
          const lens = deriveGitHubSignalLens(input, corpus);
          if (input.githubSubtype === "release") {
            return `This GitHub release intake turns ${lens.technicalChangeKind} into a rollout and adoption signal for operators because ${lens.businessImplication}.`;
          }

          if (input.githubSubtype === "issue") {
            return `This GitHub issue intake translates ${lens.technicalChangeKind} into a workflow-friction signal because ${lens.businessImplication}.`;
          }

          if (input.githubSubtype === "repo_change") {
            return `This GitHub repo-change intake turns ${lens.technicalChangeKind} into a system-discipline lesson because ${lens.workflowImplication}.`;
          }

          return suggestedAngle === "ownership_gap"
            ? "This GitHub intake translates release or repo changes into an ownership lesson for real workflows."
            : suggestedAngle === "exception_handling"
              ? "This GitHub intake translates technical change notes into an exception-handling lesson for operators."
              : suggestedAngle === "handoff_failure"
                ? "This GitHub intake points to a handoff failure between systems, teams, or workflow steps."
                : suggestedAngle === "operational_roi"
                  ? "This GitHub intake links the change to operational drag or payoff instead of raw release detail."
                : "This GitHub intake turns implementation changes into a workflow accountability signal for operators.";
        })()
      : sourcePattern === "field_pattern"
        ? `This ${sourceLabel} intake surfaces a repeat field pattern, not a one-off anecdote, which makes the execution lesson more reusable.`
        : sourcePattern === "resilience_recovery"
          ? `This ${sourceLabel} intake highlights recovery ownership and resilience as the real workflow bottleneck.`
          : sourcePattern === "operational_visibility"
            ? `This ${sourceLabel} intake points to operational visibility as the leverage point for better workflow decisions.`
            : sourcePattern === "adoption_momentum"
              ? `This ${sourceLabel} intake ties the signal to adoption momentum, rollout clarity, and usable execution.`
              : sourcePattern === "support_friction"
                ? `This ${sourceLabel} intake shows how workflow friction turns into avoidable support burden and operator drag.`
                : sourcePattern === "system_tradeoff"
                  ? `This ${sourceLabel} intake turns a system tradeoff into an operator-facing execution lesson.`
                  : suggestedAngle === "ownership_gap"
                    ? `This ${sourceLabel} intake points to an ownership gap in a live workflow.`
                    : suggestedAngle === "exception_handling"
                      ? `This ${sourceLabel} intake points to missing exception handling in the workflow.`
                      : suggestedAngle === "handoff_failure"
                        ? `This ${sourceLabel} intake points to a handoff failure between teams or steps.`
                        : suggestedAngle === "operational_roi"
                          ? `This ${sourceLabel} intake ties the signal to operational payoff or business drag.`
                          : `This ${sourceLabel} intake points to a workflow accountability problem worth testing.`;

  return {
    sourceType: input.sourceType,
    title: cleanSentence(input.title),
    sourceUrl: input.sourceUrl || undefined,
    rawSummary: summaryText,
    normalizedSignalText,
    suggestedAngle,
    reasoningSummary,
    ...(input.githubSubtype ? { githubSubtype: input.githubSubtype } : {}),
    ...(repoName ? { repoName } : {}),
    ...(repoContext ? { repoContext } : {}),
    ...(releaseOrChangeType ? { releaseOrChangeType } : {}),
    targetRole: input.targetRole || undefined,
    companyContext: companyContext || undefined,
    plannerReadyPayload: {
      signalText: normalizedSignalText,
      sourceType:
        input.sourceType === "article"
          ? "article"
          : input.sourceType === "github"
            ? "github"
            : "note",
      targetRole: input.targetRole || undefined,
      companyContext: companyContext || undefined,
      bestAngle: suggestedAngle,
      reasoningSummary
    }
  };
}
