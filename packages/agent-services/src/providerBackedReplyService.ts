import type { ProviderRouter } from "@linkedin-brand-os/ai-providers";
import type { GeneratedReply, GenerateReplyInput } from "@linkedin-brand-os/shared";
import { replyWriter } from "./replyWriter";

function clean(text: string): string {
  return text
    .replace(/great point!?/gi, "")
    .replace(/absolutely agree with your insightful comment/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
}

export async function providerBackedReplyService(input: GenerateReplyInput & {
  router?: ProviderRouter;
}): Promise<GeneratedReply> {
  const fallback = async () => replyWriter(input);
  const fallbackResult = await fallback();

  if (fallbackResult.shouldGenerate === false) {
    return fallbackResult;
  }

  if (!input.router) {
    return fallbackResult;
  }

  const summary = input.router.getSummary();
  if (summary.mode === "deterministic" || summary.textProviderStatus?.available === false) {
    return fallbackResult;
  }

  const syntheticContent = {
    id: "reply-content",
    ideaId: "reply-idea",
    contentType: "linkedin-post" as const,
    hook: input.ourPostText,
    body: input.incomingCommentText,
    cta: input.context ?? "",
    status: "draft" as const,
    createdAt: new Date(0).toISOString()
  };

  const generated = await input.router.refinePostDraft({
    content: syntheticContent,
    fallback: async () => ({
      refinedHook: (await fallback()).text,
      refinedBody: (await fallback()).text,
      refinedCta: "",
      refinementStatus: "refined" as const
    })
  });

  return {
    text: clean(generated.refinedBody || generated.refinedHook),
    mode: "provider",
    adaptationPlan: fallbackResult.adaptationPlan,
    engagementMode: fallbackResult.engagementMode,
    shouldGenerate: fallbackResult.shouldGenerate,
    appliedAngle: fallbackResult.appliedAngle
  };
}
