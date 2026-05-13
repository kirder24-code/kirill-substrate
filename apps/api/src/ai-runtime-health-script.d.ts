declare module "../../../../packages/ai-providers/scripts/ai-runtime-health.mjs" {
  import type {
    AIRuntimeHealthSummary,
    ProviderConfigSummary
  } from "@linkedin-brand-os/shared";

  export function buildAiRuntimeHealthSummary(
    providerSummary: ProviderConfigSummary,
    schedulerRuntimeEnabled: boolean
  ): AIRuntimeHealthSummary;
}
