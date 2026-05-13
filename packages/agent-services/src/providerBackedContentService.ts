import type { ProviderRouter } from "@linkedin-brand-os/ai-providers";
import type { Idea } from "@linkedin-brand-os/shared";
import { contentAgent } from "./contentAgent";

export async function providerBackedContentService(input: {
  idea: Idea;
  router?: ProviderRouter;
}) {
  const fallback = async () => {
    console.log('[DEBUG providerBackedContentService] Using fallback (contentAgent)');
    return contentAgent({ idea: input.idea });
  };
  if (!input.router) {
    console.log('[DEBUG providerBackedContentService] No router, using fallback');
    return fallback();
  }

  console.log('[DEBUG providerBackedContentService] Calling router.generatePostFromIdea');
  try {
    const result = await input.router.generatePostFromIdea({
      idea: input.idea,
      fallback
    });
    console.log('[DEBUG providerBackedContentService] Router returned result, body length:', result.body.length);
    return result;
  } catch (error) {
    console.log('[DEBUG providerBackedContentService] Router threw error:', error);
    throw error;
  }
}
