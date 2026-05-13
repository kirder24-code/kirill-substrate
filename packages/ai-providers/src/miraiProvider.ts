import {
  buildBusinessTranslatorPrompt,
  buildContentGenerationPrompt,
  buildCriticPrompt,
  buildHumanWritingRefinementPrompt,
  buildLinkedInPostPrompt,
  buildPositioningPrompt,
  buildScoutEnrichmentPrompt,
  buildSourceSummaryPrompt
} from "@linkedin-brand-os/prompts";
import type { TextProvider, VisualProvider } from "./types";
import {
  MiraiAdapter,
  type MiraiAdapterConfig
} from "./miraiAdapter";

export interface MiraiProviderConfig extends MiraiAdapterConfig {}

export interface MiraiProviderDependencies {
  adapter?: MiraiAdapter;
}

export class MiraiProvider implements TextProvider, VisualProvider {
  readonly id = "mirai";
  private readonly adapter: MiraiAdapter;

  constructor(
    config: MiraiProviderConfig = {},
    dependencies: MiraiProviderDependencies = {}
  ) {
    this.adapter = dependencies.adapter ?? new MiraiAdapter({ config });
  }

  getAvailability() {
    return this.adapter.getAvailability();
  }

  getCapabilities() {
    return {
      text: true,
      visual: true,
      live: true
    };
  }

  async translateToBusiness({
    signal
  }: Parameters<TextProvider["translateToBusiness"]>[0]) {
    const response = await this.adapter.generateText({
      task: "translateToBusiness",
      prompt: buildBusinessTranslatorPrompt(signal)
    });

    return {
      title: response.title ?? `${signal.title}: business case`,
      coreInsight: response.summary ?? response.text,
      businessRelevance:
        response.body ??
        "Translate the signal into execution risk, commercial impact, and operational payoff.",
      targetAudience: "Founders and operators",
      status: "draft" as const
    };
  }

  async generatePostFromIdea({
    idea
  }: Parameters<TextProvider["generatePostFromIdea"]>[0]) {
    const response = await this.adapter.generateText({
      task: "generatePostFromIdea",
      prompt: buildLinkedInPostPrompt(idea)
    });

    return {
      contentType: "linkedin-post" as const,
      hook: response.hook ?? `A grounded take on ${idea.title}`,
      body: response.body ?? response.text,
      cta: response.cta ?? "Compare notes if this pattern is showing up in your team.",
      status: "draft" as const
    };
  }

  async refinePostDraft({
    content
  }: Parameters<TextProvider["refinePostDraft"]>[0]) {
    const response = await this.adapter.generateText({
      task: "refinePostDraft",
      prompt: buildHumanWritingRefinementPrompt(content)
    });

    return {
      refinedHook: response.hook ?? content.hook,
      refinedBody: response.body ?? response.text,
      refinedCta: response.cta ?? content.cta,
      refinementStatus: "refined" as const
    };
  }

  async summarizeSource({
    source
  }: Parameters<TextProvider["summarizeSource"]>[0]) {
    const response = await this.adapter.generateText({
      task: "summarizeSource",
      prompt: buildSourceSummaryPrompt(source)
    });

    return {
      normalizedSummary: response.summary ?? response.text,
      tags: [source.sourceType, "mirai"],
      status: "normalized" as const
    };
  }

  async positionSignal({
    signal
  }: Parameters<TextProvider["positionSignal"]>[0]) {
    const response = await this.adapter.generateText({
      task: "positionSignal",
      prompt: buildPositioningPrompt(signal)
    });

    return parsePositioningResponse(response.text);
  }

  async reviewContentAsset({
    content
  }: Parameters<TextProvider["reviewContentAsset"]>[0]) {
    const response = await this.adapter.generateText({
      task: "reviewContentAsset",
      prompt: buildCriticPrompt(content)
    });

    return parseCriticResponse(response.text);
  }

  async enrichScoutOutput({
    scout
  }: Parameters<TextProvider["enrichScoutOutput"]>[0]) {
    const response = await this.adapter.generateText({
      task: "enrichScoutOutput",
      prompt: buildScoutEnrichmentPrompt(scout)
    });

    return parseScoutEnrichmentResponse(response.text);
  }

  async generateMatchContent({
    content
  }: Parameters<TextProvider["generateMatchContent"]>[0]) {
    const response = await this.adapter.generateText({
      task: "generateMatchContent",
      prompt: buildContentGenerationPrompt(content)
    });

    return parseContentGenerationResponse(response.text);
  }

  async generateVisualBrief({
    content
  }: Parameters<VisualProvider["generateVisualBrief"]>[0]) {
    return {
      title: `Mirai visual brief for ${content.hook}`,
      visualType: "single-image" as const,
      prompt: [
        "Structured visual brief only.",
        "Do not generate an image here.",
        `Hook: ${content.refinedHook ?? content.hook}`,
        `Body angle: ${(content.refinedBody ?? content.body).slice(0, 140)}`
      ].join("\n"),
      status: "ready" as const
    };
  }

  getSummary(): string {
    return this.adapter.getSummary();
  }
}

function parseScoutEnrichmentResponse(
  text: string
): import("@linkedin-brand-os/shared").AIScoutEnrichment {
  return {
    improvedSummary: readScoutEnrichmentField(text, "Improved summary"),
    whyItMatters: readScoutEnrichmentField(text, "Why it matters"),
    businessConsequence: readScoutEnrichmentField(text, "Business consequence"),
    operatorAngle: readScoutEnrichmentField(text, "Operator angle"),
    uncertaintyNote: readScoutEnrichmentField(text, "Uncertainty note")
  };
}

function readScoutEnrichmentField(text: string, label: string): string | undefined {
  const pattern = new RegExp(`^${label}:\\s*(.+)$`, "im");
  const value = text.match(pattern)?.[1]?.trim();
  if (!value || value.toLowerCase() === "n/a") {
    return undefined;
  }

  return value;
}

function parseContentGenerationResponse(
  text: string
): import("@linkedin-brand-os/shared").AIContentGeneration | undefined {
  const warnings = readMultiValueField(text, "WARNINGS");
  const parsed: import("@linkedin-brand-os/shared").AIContentGeneration = {
    contentIdea: readContentField(text, "CONTENT_IDEA"),
    draftAngle: readContentField(text, "DRAFT_ANGLE"),
    postSeed: readContentField(text, "POST_SEED"),
    commentSeed: readContentField(text, "COMMENT_SEED"),
    angleStub: readContentField(text, "ANGLE_STUB"),
    warnings: warnings.length > 0 ? warnings : undefined
  };

  return Object.values(parsed).some((value) =>
    Array.isArray(value) ? value.length > 0 : typeof value === "string" && value.trim().length > 0
  )
    ? parsed
    : undefined;
}

function parsePositioningResponse(
  text: string
): import("./types").SignalPositioningResult {
  return {
    bestAngle: readContentField(text, "BEST_ANGLE") ?? "workflow_accountability",
    alternativeAnglesJson: readMultiValueField(text, "ALTERNATIVE_ANGLES"),
    recommendedFormat:
      (readContentField(text, "RECOMMENDED_FORMAT") as
        | "long_linkedin_post"
        | "short_authority_post"
        | "comment_set"
        | "carousel"
        | undefined) ?? "long_linkedin_post",
    audienceEmphasis:
      readContentField(text, "AUDIENCE_EMPHASIS") ??
      "Founders and operators who care about grounded workflow lessons.",
    toneGuidance:
      readContentField(text, "TONE_GUIDANCE") ??
      "Direct, grounded, and specific rather than hype-heavy.",
    recommendedPillarFinal:
      readContentField(text, "RECOMMENDED_PILLAR_FINAL") ?? "workflow_accountability"
  };
}

function parseCriticResponse(
  text: string
): import("./types").ContentCriticResult {
  return {
    qualitySignal:
      (readContentField(text, "QUALITY_SIGNAL") as "strong" | "mixed" | "weak" | undefined) ??
      "mixed",
    genericnessRisk:
      (readContentField(text, "GENERICNESS_RISK") as
        | "low"
        | "medium"
        | "high"
        | undefined) ?? "medium",
    businessValueSignal:
      (readContentField(text, "BUSINESS_VALUE_SIGNAL") as
        | "strong"
        | "mixed"
        | "weak"
        | undefined) ?? "mixed",
    differentiationSignal:
      (readContentField(text, "DIFFERENTIATION_SIGNAL") as
        | "strong"
        | "mixed"
        | "weak"
        | undefined) ?? "mixed",
    publishReadyHint: /^true$/i.test(readContentField(text, "PUBLISH_READY_HINT") ?? "false"),
    rewriteSuggestions: readMultiValueField(text, "REWRITE_SUGGESTIONS"),
    criticNotes:
      readContentField(text, "CRITIC_NOTES") ??
      "Tighten the angle, business payoff, and specificity before publishing."
  };
}

function readContentField(text: string, label: string): string | undefined {
  const pattern = new RegExp(`^${label}:\\s*(.+)$`, "im");
  const value = text.match(pattern)?.[1]?.trim();
  if (!value || value.toLowerCase() === "n/a") {
    return undefined;
  }

  return value;
}

function readMultiValueField(text: string, label: string): string[] {
  const raw = readContentField(text, label);
  if (!raw) {
    return [];
  }

  return raw
    .split(/\s*[|;,]\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.toLowerCase() !== "n/a");
}
