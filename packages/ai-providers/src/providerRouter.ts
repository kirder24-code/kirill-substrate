import type {
  BusinessTranslationResult,
  ContentCriticResult,
  GeneratedPostResult,
  ProviderRouterConfig,
  ProviderRouterSummary,
  RefinedPostResult,
  SourceSummaryResult,
  TextProvider,
  VisualBriefResult,
  VisualProvider
} from "./types";
import type { AIProviderProbeResult } from "@linkedin-brand-os/shared";
import { ProviderRegistry } from "./providerRegistry";

export class ProviderRouter {
  private readonly config: ProviderRouterConfig;

  constructor(
    private readonly registry: ProviderRegistry,
    config: ProviderRouterConfig
  ) {
    this.config = config;
  }

  getSummary(): ProviderRouterSummary {
    const textProvider = this.registry.getTextProvider(this.config.textProvider);
    const visualProvider = this.registry.getVisualProvider(this.config.visualProvider);

    return {
      mode: this.config.mode,
      textProvider: this.config.textProvider ?? null,
      visualProvider: this.config.visualProvider ?? null,
      fallbackEnabled: this.config.fallbackEnabled,
      textProviderStatus: this.describeProvider(this.config.textProvider ?? null, textProvider),
      visualProviderStatus: this.describeProvider(
        this.config.visualProvider ?? null,
        visualProvider
      )
    };
  }

  async probeTextProvider(): Promise<AIProviderProbeResult> {
    const summary = this.getSummary();
    const provider = this.registry.getTextProvider(this.config.textProvider);
    const fallbackActive = this.config.fallbackEnabled;

    if (this.config.mode === "deterministic") {
      return {
        providerMode: summary.mode,
        textProvider: summary.textProvider,
        aiActive: false,
        fallbackActive,
        probeStatus: this.config.fallbackEnabled ? "inactive" : "failed",
        probeMessage: this.config.fallbackEnabled
          ? "Deterministic fallback mode is active; no text provider probe was executed."
          : "Deterministic mode is configured with fallback disabled."
      };
    }

    if (!provider || !this.config.textProvider) {
      return {
        providerMode: summary.mode,
        textProvider: summary.textProvider,
        aiActive: false,
        fallbackActive,
        probeStatus: this.config.fallbackEnabled ? "inactive" : "failed",
        probeMessage: this.config.fallbackEnabled
          ? "No registered text provider is active; deterministic fallback remains available."
          : "Configured text provider is not registered."
      };
    }

    const availability = provider.getAvailability();
    if (!availability.available) {
      return {
        providerMode: summary.mode,
        textProvider: summary.textProvider,
        aiActive: false,
        fallbackActive,
        probeStatus: this.config.fallbackEnabled ? "inactive" : "failed",
        probeMessage: availability.reason
      };
    }

    try {
      await provider.generatePostFromIdea({
        idea: {
          id: "probe-idea",
          signalId: "probe-signal",
          title: "Provider reachability probe",
          coreInsight: "Verify the configured text provider responds to an explicit server-side probe.",
          businessRelevance: "Launch diagnostics should confirm provider responsiveness without changing execution flow.",
          targetAudience: "Operators",
          status: "draft",
          createdAt: new Date().toISOString()
        }
      });

      return {
        providerMode: summary.mode,
        textProvider: summary.textProvider,
        aiActive: true,
        fallbackActive: false,
        probeStatus: "success",
        probeMessage: `Provider '${provider.id}' responded to the explicit probe.`
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Provider execution failed during probe.";
      return {
        providerMode: summary.mode,
        textProvider: summary.textProvider,
        aiActive: true,
        fallbackActive,
        probeStatus: "failed",
        probeMessage: message
      };
    }
  }

  async translateToBusiness(input: {
    signal: import("@linkedin-brand-os/shared").Signal;
    fallback: () => Promise<BusinessTranslationResult>;
  }): Promise<BusinessTranslationResult> {
    return this.runTextTaskWithTier(
      "writer",
      (provider) => provider.translateToBusiness({ signal: input.signal }),
      input.fallback
    );
  }

  async generatePostFromIdea(input: {
    idea: import("@linkedin-brand-os/shared").Idea;
    fallback: () => Promise<GeneratedPostResult>;
  }): Promise<GeneratedPostResult> {
    return this.runTextTaskWithTier(
      "writer",
      (provider) => provider.generatePostFromIdea({ idea: input.idea }),
      input.fallback
    );
  }

  async refinePostDraft(input: {
    content: import("@linkedin-brand-os/shared").ContentAsset;
    fallback: () => Promise<RefinedPostResult>;
  }): Promise<RefinedPostResult> {
    return this.runTextTaskWithTier(
      "writer",
      (provider) => provider.refinePostDraft({ content: input.content }),
      input.fallback
    );
  }

  async summarizeSource(input: {
    source: import("@linkedin-brand-os/shared").CreateSourceItemInput;
    fallback: () => Promise<SourceSummaryResult>;
  }): Promise<SourceSummaryResult> {
    return this.runTextTaskWithTier(
      "utility",
      (provider) => provider.summarizeSource({ source: input.source }),
      input.fallback
    );
  }

  async positionSignal(input: {
    signal: import("@linkedin-brand-os/shared").Signal;
    fallback: () => Promise<import("./types").SignalPositioningResult>;
  }): Promise<import("./types").SignalPositioningResult> {
    return this.runTextTaskWithTier(
      "utility",
      (provider) => provider.positionSignal({ signal: input.signal }),
      input.fallback
    );
  }

  async reviewContentAsset(input: {
    content: import("@linkedin-brand-os/shared").ContentAsset;
    fallback: () => Promise<ContentCriticResult>;
  }): Promise<ContentCriticResult> {
    return this.runTextTaskWithTier(
      "utility",
      (provider) => provider.reviewContentAsset({ content: input.content }),
      input.fallback
    );
  }

  async enrichScoutOutput(input: {
    scout: import("./types").ScoutEnrichmentInput;
    fallback: () => Promise<import("@linkedin-brand-os/shared").AIScoutEnrichment | undefined>;
  }): Promise<import("@linkedin-brand-os/shared").AIScoutEnrichment | undefined> {
    return this.runTextTaskWithTier(
      "fallback",
      (provider) => provider.enrichScoutOutput({ scout: input.scout }),
      input.fallback
    );
  }

  async generateMatchContent(input: {
    content: import("@linkedin-brand-os/shared").GenerateMatchContentInput;
    fallback: () => Promise<import("@linkedin-brand-os/shared").AIContentGeneration | undefined>;
  }): Promise<import("@linkedin-brand-os/shared").AIContentGeneration | undefined> {
    return this.runTextTaskWithTier(
      "writer",
      (provider) => provider.generateMatchContent({ content: input.content }),
      input.fallback
    );
  }

  async generateVisualBrief(input: {
    content: import("@linkedin-brand-os/shared").ContentAsset;
    fallback: () => Promise<VisualBriefResult>;
  }): Promise<VisualBriefResult> {
    return this.runVisualTask(
      (provider) => provider.generateVisualBrief({ content: input.content }),
      input.fallback
    );
  }

  private describeProvider(
    id: string | null,
    provider: TextProvider | VisualProvider | null
  ): ProviderRouterSummary["textProviderStatus"] {
    if (!id) return null;
    if (!provider) {
      return {
        id,
        available: false,
        reason: "Configured provider is not registered."
      };
    }

    const availability = provider.getAvailability();
    return {
      id,
      available: availability.available,
      reason: availability.reason,
      capabilities: provider.getCapabilities()
    };
  }

  private async runTextTaskWithTier<T>(
    tier: import("./types").ModelTier,
    execute: (provider: TextProvider) => Promise<T>,
    fallback: () => Promise<T>
  ): Promise<T> {
    const providerName = this.resolveProviderForTier(tier);
    const provider = this.registry.getTextProvider(providerName);

    // Extract task name from execution function for logging
    const taskName = execute.toString().match(/provider\.(\w+)/)?.[1] || "unknown";
    const modelInfo = provider && 'model' in provider ? ` | Model: ${(provider as any).model}` : '';

    console.log(`[TIER ROUTING] Task: ${taskName} | Tier: ${tier} | Provider: ${providerName ?? 'none'}${modelInfo}`);

    // If tier-specific provider unavailable and tier is writer, block instead of degrading
    if (tier === "writer" && !provider && this.config.mode === "external") {
      console.log(`[TIER ROUTING WARNING] Writer-tier provider unavailable. Falling back to deterministic agent instead of degrading to weak local model.`);
      return this.runFallback(fallback);
    }

    if (!provider && tier === "writer") {
      console.log(`[TIER ROUTING WARNING] Writer-tier task assigned but no strong provider available. Using fallback.`);
    }

    return this.runTask(provider, execute, fallback);
  }

  private resolveProviderForTier(tier: import("./types").ModelTier): string | null {
    if (tier === "writer" && this.config.writerProvider) {
      console.log(`[TIER RESOLUTION] Tier: ${tier} → Provider: ${this.config.writerProvider} (tier-specific writer)`);
      return this.config.writerProvider;
    }
    if (tier === "utility" && this.config.utilityProvider) {
      console.log(`[TIER RESOLUTION] Tier: ${tier} → Provider: ${this.config.utilityProvider} (tier-specific utility)`);
      return this.config.utilityProvider;
    }
    // Fallback to configured text provider or local for fallback tier
    if (tier === "fallback") {
      const resolved = this.config.mode === "local" ? "mirai" : this.config.textProvider ?? null;
      console.log(`[TIER RESOLUTION] Tier: ${tier} → Provider: ${resolved} (fallback tier)`);
      return resolved;
    }
    const fallbackProvider = this.config.textProvider ?? null;
    console.log(`[TIER RESOLUTION] Tier: ${tier} → Provider: ${fallbackProvider} (no tier-specific provider, using default)`);
    return fallbackProvider;
  }

  private async runTextTask<T>(
    execute: (provider: TextProvider) => Promise<T>,
    fallback: () => Promise<T>
  ): Promise<T> {
    const provider = this.registry.getTextProvider(this.config.textProvider);
    return this.runTask(provider, execute, fallback);
  }

  private async runVisualTask<T>(
    execute: (provider: VisualProvider) => Promise<T>,
    fallback: () => Promise<T>
  ): Promise<T> {
    const provider = this.registry.getVisualProvider(this.config.visualProvider);
    return this.runTask(provider, execute, fallback);
  }

  private async runTask<T, TProvider extends TextProvider | VisualProvider>(
    provider: TProvider | null,
    execute: (provider: TProvider) => Promise<T>,
    fallback: () => Promise<T>
  ): Promise<T> {
    console.log('[DEBUG runTask] mode:', this.config.mode, 'provider:', provider?.id);
    if (this.config.mode === "deterministic") {
      console.log('[DEBUG runTask] Using fallback: deterministic mode');
      return this.runFallback(fallback);
    }

    if (!provider) {
      console.log('[DEBUG runTask] Using fallback: no provider');
      return this.handleProviderFailure("Configured provider is not registered.", fallback);
    }

    const availability = provider.getAvailability();
    console.log('[DEBUG runTask] Provider availability:', availability);
    if (!availability.available) {
      console.log('[DEBUG runTask] Using fallback: provider not available');
      return this.handleProviderFailure(availability.reason, fallback);
    }

    try {
      console.log('[DEBUG runTask] Executing provider...');
      const result = await execute(provider);
      console.log('[DEBUG runTask] Provider execution succeeded');
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Provider execution failed.";
      console.log('[DEBUG runTask] Provider execution failed:', message);
      return this.handleProviderFailure(message, fallback);
    }
  }

  private async handleProviderFailure<T>(
    message: string,
    fallback: () => Promise<T>
  ): Promise<T> {
    if (!this.config.fallbackEnabled) {
      console.log(`[TIER ROUTING ERROR] Provider failed: ${message}. Fallback disabled, throwing error.`);
      throw new Error(message);
    }
    console.log(`[TIER ROUTING FALLBACK] Provider failed: ${message}. Using deterministic fallback.`);
    return fallback();
  }

  private async runFallback<T>(fallback: () => Promise<T>): Promise<T> {
    if (!this.config.fallbackEnabled) {
      throw new Error("Provider fallback is disabled.");
    }
    return fallback();
  }
}
