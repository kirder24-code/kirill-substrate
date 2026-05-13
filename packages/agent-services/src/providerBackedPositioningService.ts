import type { ProviderRouter } from "@linkedin-brand-os/ai-providers";
import type { Signal, SignalAnalysis } from "@linkedin-brand-os/shared";
import { positioningAgent } from "./positioningAgent";

export async function providerBackedPositioningService(input: {
  signal: Signal;
  analysis: SignalAnalysis;
  router?: ProviderRouter;
}) {
  const fallback = async () =>
    positioningAgent({ signal: input.signal, analysis: input.analysis });

  if (!input.router) {
    return fallback();
  }

  return input.router.positionSignal({
    signal: input.signal,
    fallback
  });
}
