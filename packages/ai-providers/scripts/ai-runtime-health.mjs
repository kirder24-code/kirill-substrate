/** @typedef {import("@linkedin-brand-os/shared").ProviderConfigSummary} ProviderConfigSummary */
/** @typedef {import("@linkedin-brand-os/shared").AIRuntimeHealthSummary} AIRuntimeHealthSummary */

/**
 * @param {ProviderConfigSummary} providerSummary
 * @param {boolean} schedulerRuntimeEnabled
 * @returns {AIRuntimeHealthSummary}
 */
export function buildAiRuntimeHealthSummary(
  providerSummary,
  schedulerRuntimeEnabled
) {
  const issues = [];
  const statuses = [
    providerSummary.textProviderStatus,
    providerSummary.visualProviderStatus
  ].filter((status) => status !== null && status !== undefined);

  for (const status of statuses) {
    if (!status.available) {
      issues.push(`${status.id ?? "unknown"}: ${status.reason}`);
    }
  }

  if (providerSummary.mode === "deterministic" && !providerSummary.fallbackEnabled) {
    issues.push("Deterministic mode is configured with fallback disabled.");
  }

  const aiActive =
    providerSummary.mode !== "deterministic" &&
    statuses.some((status) => status.available);
  const fallbackActive = !aiActive && providerSummary.fallbackEnabled;

  return {
    providerMode: providerSummary.mode,
    textProvider: providerSummary.textProvider,
    visualProvider: providerSummary.visualProvider,
    aiActive,
    fallbackActive,
    runtimeEnabled: true,
    schedulerRuntimeEnabled,
    fallbackEnabled: providerSummary.fallbackEnabled,
    configStatus: aiActive
      ? "ai_active"
      : fallbackActive
        ? "fallback_active"
        : "invalid",
    issues,
    textProviderStatus: providerSummary.textProviderStatus,
    visualProviderStatus: providerSummary.visualProviderStatus
  };
}

/**
 * @param {{
 *   mode: ProviderConfigSummary["mode"];
 *   textProvider: string | null;
 *   visualProvider?: string | null;
 *   fallbackEnabled: boolean;
 *   textProviderStatus?: ProviderConfigSummary["textProviderStatus"];
 *   visualProviderStatus?: ProviderConfigSummary["visualProviderStatus"];
 * }} input
 * @returns {ProviderConfigSummary}
 */
export function buildProviderConfigSummary(input) {
  return {
    mode: input.mode,
    textProvider: input.textProvider,
    visualProvider: input.visualProvider ?? null,
    fallbackEnabled: input.fallbackEnabled,
    textProviderStatus: input.textProviderStatus ?? null,
    visualProviderStatus: input.visualProviderStatus ?? null
  };
}
