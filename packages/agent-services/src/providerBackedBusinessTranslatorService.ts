import type { ProviderRouter } from "@linkedin-brand-os/ai-providers";
import type { Signal } from "@linkedin-brand-os/shared";
import { businessTranslatorAgent } from "./businessTranslatorAgent";

export async function providerBackedBusinessTranslatorService(input: {
  signal: Signal;
  router?: ProviderRouter;
}) {
  const fallback = async () => businessTranslatorAgent({ signal: input.signal });
  if (!input.router) {
    return fallback();
  }

  return input.router.translateToBusiness({
    signal: input.signal,
    fallback
  });
}
