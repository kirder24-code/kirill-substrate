import type {
  AIContentGeneration,
  AIScoutEnrichment,
  ContentAsset,
  ContentType,
  CreateSourceItemInput,
  GenerateMatchContentInput,
  Idea,
  ProviderConfigSummary,
  ProviderExecutionMode,
  SignalPositioningAgentOutput,
  Signal,
  VisualStatus,
  VisualType
} from "@linkedin-brand-os/shared";

export interface BusinessTranslationResult {
  title: string;
  coreInsight: string;
  businessRelevance: string;
  targetAudience: string;
  status: Idea["status"];
}

export interface GeneratedPostResult {
  contentType: ContentType;
  hook: string;
  body: string;
  cta: string;
  status: ContentAsset["status"];
}

export interface RefinedPostResult {
  refinedHook: string;
  refinedBody: string;
  refinedCta: string;
  refinementStatus: NonNullable<ContentAsset["refinementStatus"]>;
}

export interface SourceSummaryResult {
  normalizedSummary: string;
  tags: string[];
  status: "normalized" | "archived";
}

export interface SignalPositioningResult extends SignalPositioningAgentOutput {}

export interface ContentCriticResult {
  qualitySignal: "strong" | "mixed" | "weak";
  genericnessRisk: "low" | "medium" | "high";
  businessValueSignal: "strong" | "mixed" | "weak";
  differentiationSignal: "strong" | "mixed" | "weak";
  publishReadyHint: boolean;
  rewriteSuggestions: string[];
  criticNotes: string;
}

export interface ScoutEnrichmentInput {
  kind: "audience" | "solution" | "match";
  subject: string;
  whyItMatters: string;
  supportingContext?: string;
  rawExcerpt?: string;
  operatorAction?: string;
}

export interface VisualBriefResult {
  title: string;
  visualType: VisualType;
  prompt: string;
  status: VisualStatus;
}

export type ModelTier = "writer" | "utility" | "fallback";

export interface ProviderAvailability {
  available: boolean;
  reason: string;
}

export interface ProviderCapabilities {
  text: boolean;
  visual: boolean;
  live: boolean;
}

export interface ProviderInfo {
  readonly id: string;
  getAvailability(): ProviderAvailability;
  getCapabilities(): ProviderCapabilities;
}

export interface TextProvider extends ProviderInfo {
  translateToBusiness(input: {
    signal: Signal;
  }): Promise<BusinessTranslationResult>;
  generatePostFromIdea(input: { idea: Idea }): Promise<GeneratedPostResult>;
  refinePostDraft(input: { content: ContentAsset }): Promise<RefinedPostResult>;
  summarizeSource(input: {
    source: CreateSourceItemInput;
  }): Promise<SourceSummaryResult>;
  positionSignal(input: {
    signal: Signal;
  }): Promise<SignalPositioningResult>;
  reviewContentAsset(input: {
    content: ContentAsset;
  }): Promise<ContentCriticResult>;
  enrichScoutOutput(input: {
    scout: ScoutEnrichmentInput;
  }): Promise<AIScoutEnrichment>;
  generateMatchContent(input: {
    content: GenerateMatchContentInput;
  }): Promise<AIContentGeneration | undefined>;
}

export interface VisualProvider extends ProviderInfo {
  generateVisualBrief(input: {
    content: ContentAsset;
  }): Promise<VisualBriefResult>;
}

export interface ProviderRouterConfig {
  mode: ProviderExecutionMode;
  textProvider?: string | null;
  visualProvider?: string | null;
  fallbackEnabled: boolean;
  writerProvider?: string;
  utilityProvider?: string;
}

export type ProviderRouterSummary = ProviderConfigSummary;
