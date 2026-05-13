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
import type { TextProvider } from "./types";
import { withTimeout } from "./fetchWithTimeout";

export interface StrongTextProviderConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
}

export interface StrongTextProviderDependencies {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  providerId?: string;
}

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
}

export class StrongTextProvider implements TextProvider {
  readonly id: string;
  private readonly fetchImpl: typeof fetch;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string | null;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: StrongTextProviderConfig = {},
    dependencies: StrongTextProviderDependencies = {}
  ) {
    this.id = dependencies.providerId ?? "strong-text";
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.model = config.model ?? "gpt-5.4";
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    this.apiKey = normalizeOpenAIApiKey(config.apiKey);
    this.timeoutMs = dependencies.timeoutMs ?? 30000;
  }

  getAvailability() {
    if (!this.apiKey) {
      return {
        available: false,
        reason: "OPENAI_API_KEY is not set."
      };
    }

    return {
      available: true,
      reason: "OpenAI premium provider is configured."
    };
  }

  getCapabilities() {
    return {
      text: true,
      visual: false,
      live: true
    };
  }

  async translateToBusiness({
    signal
  }: Parameters<TextProvider["translateToBusiness"]>[0]) {
    const result = await this.generateStructuredJson<{
      title?: string;
      coreInsight?: string;
      businessRelevance?: string;
      targetAudience?: string;
    }>({
      task: "translateToBusiness",
      prompt: buildBusinessTranslatorPrompt(signal),
      outputShape: [
        "Return strict JSON only.",
        'Keys: "title", "coreInsight", "businessRelevance", "targetAudience".',
        "Keep the language grounded in business impact and rollout execution."
      ].join(" ")
    });

    return {
      title: result.title?.trim() || `${signal.title}: business case`,
      coreInsight:
        result.coreInsight?.trim() ||
        "Translate the source into an execution lesson with business relevance.",
      businessRelevance:
        result.businessRelevance?.trim() ||
        "Explain the operational consequence, business value, and why this matters now.",
      targetAudience: result.targetAudience?.trim() || "Founders and operators",
      status: "draft" as const
    };
  }

  async generatePostFromIdea({
    idea
  }: Parameters<TextProvider["generatePostFromIdea"]>[0]) {
    const result = await this.generateStructuredJson<{
      hook?: string;
      body?: string;
      cta?: string;
    }>({
      task: "generatePostFromIdea",
      prompt: buildLinkedInPostPrompt(idea),
      outputShape: [
        "Return strict JSON only.",
        'Keys: "hook", "body", "cta".',
        "Write practical LinkedIn authority content, avoid empty hype, and stay grounded in business consequences."
      ].join(" ")
    });

    return {
      contentType: "linkedin-post" as const,
      hook: result.hook?.trim() || `A practical take on ${idea.title}`,
      body:
        result.body?.trim() ||
        [idea.coreInsight, idea.businessRelevance].filter(Boolean).join(" "),
      cta: result.cta?.trim() || "Compare notes if this pattern is showing up in your team.",
      status: "draft" as const
    };
  }

  async refinePostDraft({
    content
  }: Parameters<TextProvider["refinePostDraft"]>[0]) {
    const result = await this.generateStructuredJson<{
      refinedHook?: string;
      refinedBody?: string;
      refinedCta?: string;
    }>({
      task: "refinePostDraft",
      prompt: buildHumanWritingRefinementPrompt(content),
      outputShape: [
        "Return strict JSON only.",
        'Keys: "refinedHook", "refinedBody", "refinedCta".',
        "Improve clarity and human tone without adding hype."
      ].join(" ")
    });

    return {
      refinedHook: result.refinedHook?.trim() || content.hook,
      refinedBody: result.refinedBody?.trim() || content.body,
      refinedCta: result.refinedCta?.trim() || content.cta,
      refinementStatus: "refined" as const
    };
  }

  async summarizeSource({
    source
  }: Parameters<TextProvider["summarizeSource"]>[0]) {
    const result = await this.generateStructuredJson<{
      normalizedSummary?: string;
      tags?: string[];
    }>({
      task: "summarizeSource",
      prompt: buildSourceSummaryPrompt(source),
      outputShape: [
        "Return strict JSON only.",
        'Keys: "normalizedSummary", "tags".',
        "Keep the summary readable and compact. Tags should be a short string array."
      ].join(" ")
    });

    return {
      normalizedSummary:
        result.normalizedSummary?.trim() || `${source.title}: ${source.rawText.slice(0, 160)}`,
      tags:
        result.tags?.filter((item) => typeof item === "string" && item.trim().length > 0) ?? [
          source.sourceType,
          "signal"
        ],
      status: "normalized" as const
    };
  }

  async positionSignal({
    signal
  }: Parameters<TextProvider["positionSignal"]>[0]) {
    const result = await this.generateStructuredJson<{
      bestAngle?: string;
      alternativeAnglesJson?: string[];
      recommendedFormat?: "long_linkedin_post" | "short_authority_post" | "comment_set" | "carousel";
      audienceEmphasis?: string;
      toneGuidance?: string;
      recommendedPillarFinal?: string;
    }>({
      task: "positionSignal",
      prompt: buildPositioningPrompt(signal),
      outputShape: [
        "Return strict JSON only.",
        'Keys: "bestAngle", "alternativeAnglesJson", "recommendedFormat", "audienceEmphasis", "toneGuidance", "recommendedPillarFinal".',
        "alternativeAnglesJson must be an array of 2 to 4 strings."
      ].join(" ")
    });

    return {
      bestAngle: result.bestAngle?.trim() || "workflow_accountability",
      alternativeAnglesJson:
        result.alternativeAnglesJson?.filter(Boolean).slice(0, 4) ?? [
          "workflow_accountability",
          "ownership_gap"
        ],
      recommendedFormat: result.recommendedFormat ?? "long_linkedin_post",
      audienceEmphasis:
        result.audienceEmphasis?.trim() ||
        "Founders and operators who care about grounded workflow lessons.",
      toneGuidance:
        result.toneGuidance?.trim() ||
        "Direct, grounded, and specific rather than hype-heavy.",
      recommendedPillarFinal:
        result.recommendedPillarFinal?.trim() || "workflow_accountability"
    };
  }

  async reviewContentAsset({
    content
  }: Parameters<TextProvider["reviewContentAsset"]>[0]) {
    const result = await this.generateStructuredJson<{
      qualitySignal?: "strong" | "mixed" | "weak";
      genericnessRisk?: "low" | "medium" | "high";
      businessValueSignal?: "strong" | "mixed" | "weak";
      differentiationSignal?: "strong" | "mixed" | "weak";
      publishReadyHint?: boolean;
      rewriteSuggestions?: string[];
      criticNotes?: string;
    }>({
      task: "reviewContentAsset",
      prompt: buildCriticPrompt(content),
      outputShape: [
        "Return strict JSON only.",
        'Keys: "qualitySignal", "genericnessRisk", "businessValueSignal", "differentiationSignal", "publishReadyHint", "rewriteSuggestions", "criticNotes".',
        'Signals must use the enums "strong|mixed|weak" and "low|medium|high".'
      ].join(" ")
    });

    return {
      qualitySignal: result.qualitySignal ?? "mixed",
      genericnessRisk: result.genericnessRisk ?? "medium",
      businessValueSignal: result.businessValueSignal ?? "mixed",
      differentiationSignal: result.differentiationSignal ?? "mixed",
      publishReadyHint: Boolean(result.publishReadyHint),
      rewriteSuggestions: sanitizeStringArray(result.rewriteSuggestions),
      criticNotes:
        result.criticNotes?.trim() ||
        "Keep the draft grounded in the selected angle and business consequence."
    };
  }

  async enrichScoutOutput({
    scout
  }: Parameters<TextProvider["enrichScoutOutput"]>[0]) {
    const result = await this.generateStructuredJson<{
      improvedSummary?: string;
      whyItMatters?: string;
      businessConsequence?: string;
      operatorAngle?: string;
      uncertaintyNote?: string;
    }>({
      task: "enrichScoutOutput",
      prompt: buildScoutEnrichmentPrompt(scout),
      outputShape: [
        "Return strict JSON only.",
        'Keys: "improvedSummary", "whyItMatters", "businessConsequence", "operatorAngle", "uncertaintyNote".'
      ].join(" ")
    });

    return {
      improvedSummary: result.improvedSummary?.trim(),
      whyItMatters: result.whyItMatters?.trim(),
      businessConsequence: result.businessConsequence?.trim(),
      operatorAngle: result.operatorAngle?.trim(),
      uncertaintyNote: result.uncertaintyNote?.trim()
    };
  }

  async generateMatchContent({
    content
  }: Parameters<TextProvider["generateMatchContent"]>[0]) {
    const result = await this.generateStructuredJson<{
      contentIdea?: string;
      draftAngle?: string;
      postSeed?: string;
      commentSeed?: string;
      angleStub?: string;
      warnings?: string[];
    }>({
      task: "generateMatchContent",
      prompt: buildContentGenerationPrompt(content),
      outputShape: [
        "Return strict JSON only.",
        'Keys: "contentIdea", "draftAngle", "postSeed", "commentSeed", "angleStub", "warnings".'
      ].join(" ")
    });

    const mapped = {
      contentIdea: result.contentIdea?.trim(),
      draftAngle: result.draftAngle?.trim(),
      postSeed: result.postSeed?.trim(),
      commentSeed: result.commentSeed?.trim(),
      angleStub: result.angleStub?.trim(),
      warnings: sanitizeStringArray(result.warnings),
      provider: this.id
    };

    return Object.values(mapped).some((value) =>
      Array.isArray(value) ? value.length > 0 : typeof value === "string" && value.length > 0
    )
      ? mapped
      : undefined;
  }

  private async generateStructuredJson<T>(input: {
    task: string;
    prompt: string;
    outputShape: string;
  }): Promise<T> {
    const fetchPromise = this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
        ...(this.config.organization ? { "OpenAI-Organization": this.config.organization } : {}),
        ...(this.config.project ? { "OpenAI-Project": this.config.project } : {})
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        response_format: {
          type: "json_object"
        },
        messages: [
          {
            role: "system",
            content:
              "You are a grounded operator-grade writing and reasoning assistant. Return JSON only and avoid markdown."
          },
          {
            role: "user",
            content: `${input.prompt}\n\n${input.outputShape}`
          }
        ]
      })
    });

    const response = await withTimeout(
      fetchPromise,
      this.timeoutMs,
      `OpenAI API request for ${input.task} timed out after ${this.timeoutMs}ms.`
    );

    const responseText = await response.text();
    if (!response.ok) {
      const parsedError = safeParseJson(responseText) as OpenAIChatCompletionResponse | null;
      throw new Error(
        parsedError?.error?.message?.trim() ||
          `OpenAI provider request failed with status ${response.status}.`
      );
    }

    const parsed = safeParseJson(responseText) as OpenAIChatCompletionResponse | null;
    const messageContent = readChatCompletionText(parsed);
    if (!messageContent) {
      throw new Error("OpenAI provider response did not include message content.");
    }

    const payload = extractJsonObject(messageContent);
    if (!payload) {
      throw new Error(`OpenAI provider returned non-JSON content for ${input.task}.`);
    }

    return payload as T;
  }
}

function readChatCompletionText(
  response: OpenAIChatCompletionResponse | null
): string | null {
  const content = response?.choices?.[0]?.message?.content;

  if (typeof content === "string" && content.trim().length > 0) {
    return content;
  }

  if (Array.isArray(content)) {
    const joined = content
      .map((item) => item.text?.trim())
      .filter((item): item is string => Boolean(item))
      .join("\n");

    return joined.length > 0 ? joined : null;
  }

  return null;
}

function extractJsonObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  const direct = safeParseJson(trimmed);

  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as Record<string, unknown>;
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  const sliced = trimmed.slice(firstBrace, lastBrace + 1);
  const parsed = safeParseJson(sliced);

  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
    .slice(0, 6);
}

function normalizeOpenAIApiKey(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "PASTE_REAL_KEY_HERE") {
    return null;
  }

  return trimmed;
}
