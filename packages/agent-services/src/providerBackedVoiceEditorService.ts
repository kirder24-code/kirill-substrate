import type { ProviderRouter } from "@linkedin-brand-os/ai-providers";
import type { ContentAsset } from "@linkedin-brand-os/shared";
import { voiceEditorAgent } from "./voiceEditorAgent";

export async function providerBackedVoiceEditorService(input: {
  content: ContentAsset;
  router?: ProviderRouter;
}) {
  const fallback = async () => voiceEditorAgent({ content: input.content });
  if (!input.router) {
    return fallback();
  }

  return input.router.refinePostDraft({
    content: input.content,
    fallback
  });
}
