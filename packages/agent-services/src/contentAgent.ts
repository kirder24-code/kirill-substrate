/**
 * @deprecated This deterministic agent has been superseded by providerBackedContentService.
 * Use the provider-backed service instead for AI-powered content generation with deterministic fallback.
 * This agent will be removed in a future version.
 */

import type { ContentStatus, ContentType, Idea } from "@linkedin-brand-os/shared";

export interface ContentAgentInput {
  idea: Idea;
  voice?: string;
}

export interface ContentAgentOutput {
  contentType: ContentType;
  hook: string;
  body: string;
  cta: string;
  status: ContentStatus;
}

/**
 * @deprecated Use providerBackedContentService instead.
 */
export async function contentAgent(
  input: ContentAgentInput
): Promise<ContentAgentOutput> {
  return {
    contentType: "linkedin-post",
    hook: `Most teams miss this about ${input.idea.title.toLowerCase()}`,
    body: [
      `${input.idea.title}`,
      input.idea.coreInsight,
      input.idea.businessRelevance,
      `Audience: ${input.idea.targetAudience}.`,
      `Voice: ${input.voice ?? "default"}.`
    ].join(" "),
    cta: "If this matches what you are seeing, compare notes in the comments.",
    status: "draft"
  };
}
