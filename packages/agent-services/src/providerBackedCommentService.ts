import type { ProviderRouter } from "@linkedin-brand-os/ai-providers";
import type { GeneratedComment, GenerateCommentInput } from "@linkedin-brand-os/shared";
import { commentWriter } from "./commentWriter";

function clean(text: string): string {
  return text
    .replace(/great post!?/gi, "")
    .replace(/love this/gi, "")
    .replace(/so true/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
}

export async function providerBackedCommentService(input: GenerateCommentInput & {
  router?: ProviderRouter;
}): Promise<GeneratedComment> {
  const fallback = async () => commentWriter(input);
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

  const syntheticIdea = {
    id: "comment-idea",
    signalId: "comment-signal",
    title: "Useful comment angle",
    coreInsight: input.sourcePostText,
    businessRelevance: input.positioningContext ?? "Keep it grounded in operations.",
    targetAudience: "Founders and operators",
    status: "draft" as const,
    createdAt: new Date(0).toISOString()
  };

  const generated = await input.router.generatePostFromIdea({
    idea: syntheticIdea,
    fallback: async () => ({
      contentType: "linkedin-post" as const,
      hook: (await fallback()).text,
      body: (await fallback()).text,
      cta: "",
      status: "draft" as const
    })
  });

  return {
    text: clean(generated.hook || generated.body),
    mode: "provider",
    adaptationPlan: fallbackResult.adaptationPlan,
    engagementMode: fallbackResult.engagementMode,
    shouldGenerate: fallbackResult.shouldGenerate,
    appliedAngle: fallbackResult.appliedAngle
  };
}
