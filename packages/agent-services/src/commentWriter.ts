import type { GeneratedComment, GenerateCommentInput } from "@linkedin-brand-os/shared";
import {
  buildEngagementAdaptationPlan,
  resolveEngagementAdaptationInput
} from "./engagementAdaptation";

const genericPraisePatterns = [/great post!?/gi, /love this/gi, /so true/gi, /spot on/gi];

function clean(text: string): string {
  let next = text.replace(/\s+/g, " ").trim();
  for (const pattern of genericPraisePatterns) {
    next = next.replace(pattern, "");
  }
  return next.replace(/\s+([,.!?;:])/g, "$1").trim();
}

function firstMatchingSentence(text: string, pattern: RegExp, fallback: string): string {
  const sentences = clean(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  return sentences.find((sentence) => pattern.test(sentence)) ?? fallback;
}

export async function commentWriter(
  input: GenerateCommentInput
): Promise<GeneratedComment> {
  const source = input.sourcePostText;
  const context = clean(input.positioningContext ?? "");
  const adaptationInput = resolveEngagementAdaptationInput(input, "comment");
  const adaptationPlan = adaptationInput
    ? buildEngagementAdaptationPlan(adaptationInput)
    : null;

  if (adaptationPlan && !adaptationPlan.shouldGenerate) {
    return {
      text: "Skip this one. The fit is too weak to add a useful operator comment.",
      mode: "deterministic",
      adaptationPlan,
      engagementMode: adaptationPlan.engagementMode,
      shouldGenerate: adaptationPlan.shouldGenerate,
      appliedAngle: adaptationPlan.angleDirective
    };
  }

  const operationalPoint = firstMatchingSentence(
    source,
    /owner|workflow|handoff|ops|support|exception|accountability/i,
    "The workflow usually breaks before the model does."
  )
    .replace(/^most teams/i, "Teams")
    .replace(/^the demo looks great, but /i, "");

  const angle = adaptationPlan?.engagementMode === "strategic_execution"
    ? "That is usually the execution gap between a strong demo and a system the business can actually run."
    : adaptationPlan?.engagementMode === "insight_light_positioning"
      ? "That is usually where the rollout either settles into real work or slides back into cleanup."
      : adaptationPlan?.engagementMode === "bridge_outreach_aware"
        ? "That is usually the point where a useful operating conversation starts."
        : /context|positioning|operator|rollout/i.test(context)
          ? "That is usually the difference between a good demo and a system people can actually run."
          : "That is usually where the rollout succeeds or stalls.";

  return {
    text: clean(`${operationalPoint} ${angle}`),
    mode: "deterministic",
    adaptationPlan: adaptationPlan ?? undefined,
    engagementMode: adaptationPlan?.engagementMode,
    shouldGenerate: adaptationPlan?.shouldGenerate,
    appliedAngle: adaptationPlan?.angleDirective
  };
}
