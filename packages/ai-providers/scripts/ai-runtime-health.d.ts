import type {
  AIRuntimeHealthSummary,
  ProviderConfigSummary
} from "@linkedin-brand-os/shared";

export declare function buildAiRuntimeHealthSummary(
  providerSummary: ProviderConfigSummary,
  schedulerRuntimeEnabled: boolean
): AIRuntimeHealthSummary;

export declare function buildProviderConfigSummary(input: {
  mode: ProviderConfigSummary["mode"];
  textProvider: string | null;
  visualProvider?: string | null;
  fallbackEnabled: boolean;
  textProviderStatus?: ProviderConfigSummary["textProviderStatus"];
  visualProviderStatus?: ProviderConfigSummary["visualProviderStatus"];
}): ProviderConfigSummary;
