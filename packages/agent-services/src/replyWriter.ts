import type { GeneratedReply, GenerateReplyInput } from "@linkedin-brand-os/shared";
import {
  buildEngagementAdaptationPlan,
  resolveEngagementAdaptationInput
} from "./engagementAdaptation";

function clean(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\s+([,.!?;:])/g, "$1").trim();
}

function firstSentence(text: string): string {
  return clean(text).split(/(?<=[.!?])\s+/)[0] ?? clean(text);
}

export async function replyWriter(
  input: GenerateReplyInput
): Promise<GeneratedReply> {
  const comment = clean(input.incomingCommentText);
  const post = clean(input.ourPostText);
  const context = clean(input.context ?? "");
  const adaptationInput = resolveEngagementAdaptationInput(input, "reply");
  const adaptationPlan = adaptationInput
    ? buildEngagementAdaptationPlan(adaptationInput)
    : null;

  if (adaptationPlan && !adaptationPlan.shouldGenerate) {
    return {
      text: "Skip this one. It is not the right thread for a useful operator reply.",
      mode: "deterministic",
      adaptationPlan,
      engagementMode: adaptationPlan.engagementMode,
      shouldGenerate: adaptationPlan.shouldGenerate,
      appliedAngle: adaptationPlan.angleDirective
    };
  }

  const acknowledgement = adaptationPlan?.engagementMode === "bridge_outreach_aware"
    ? "That makes sense."
    : /same thing|we saw/i.test(comment)
      ? "That tracks."
      : /support|onboarding|ops|workflow|owner/i.test(comment)
        ? "Yes, that is usually where it shows up first."
        : "Fair point.";

  const directResponse = /support/i.test(comment)
    ? "Support is usually where the ownership gap shows up first because the exceptions pile up fast."
    : /queue/i.test(comment)
      ? "Queue design exposes the problem fast because weak ownership creates cleanup instead of throughput."
      : /owner|workflow/i.test(comment)
        ? "Once the workflow loses an owner, the model turns into extra work instead of leverage."
        : `That is the same pattern behind this post: ${firstSentence(post).toLowerCase()}.`;

  const closer = adaptationPlan?.engagementMode === "bridge_outreach_aware"
    ? "That is usually where the operating gap becomes obvious."
    : /concise|short/i.test(context)
      ? ""
      : "That is usually the real operating issue.";

  return {
    text: clean([acknowledgement, directResponse, closer].filter(Boolean).join(" ")),
    mode: "deterministic",
    adaptationPlan: adaptationPlan ?? undefined,
    engagementMode: adaptationPlan?.engagementMode,
    shouldGenerate: adaptationPlan?.shouldGenerate,
    appliedAngle: adaptationPlan?.angleDirective
  };
}
