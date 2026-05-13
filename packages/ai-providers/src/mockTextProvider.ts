import type { TextProvider } from "./types";

export class MockTextProvider implements TextProvider {
  readonly id = "mock-text";

  getAvailability() {
    return {
      available: true,
      reason: "Deterministic mock text provider is always available."
    };
  }

  getCapabilities() {
    return {
      text: true,
      visual: false,
      live: false
    };
  }

  async translateToBusiness({
    signal
  }: Parameters<TextProvider["translateToBusiness"]>[0]) {
    return {
      title: `${signal.title}: business case`,
      coreInsight: `The operational issue is ${signal.rawText.toLowerCase()}`,
      businessRelevance:
        "Ground the message in cost, execution risk, and rollout clarity.",
      targetAudience: "Founders and operators",
      status: "draft" as const
    };
  }

  async generatePostFromIdea({
    idea
  }: Parameters<TextProvider["generatePostFromIdea"]>[0]) {
    return {
      contentType: "linkedin-post" as const,
      hook: `A practical take on ${idea.title}`,
      body: [
        idea.coreInsight,
        idea.businessRelevance,
        "Keep the language direct, practical, and easy to act on."
      ].join(" "),
      cta: "If this pattern is showing up in your team, compare notes.",
      status: "draft" as const
    };
  }

  async refinePostDraft({
    content
  }: Parameters<TextProvider["refinePostDraft"]>[0]) {
    return {
      refinedHook: `A clearer way to frame ${content.hook.toLowerCase()}`,
      refinedBody: `${content.body} Keep it clear, direct, and anchored in what operators can actually do next.`,
      refinedCta: "If this reflects what your team is seeing, compare notes.",
      refinementStatus: "refined" as const
    };
  }

  async summarizeSource({
    source
  }: Parameters<TextProvider["summarizeSource"]>[0]) {
    return {
      normalizedSummary: `${source.title}: ${source.rawText.slice(0, 90)}`,
      tags: [source.sourceType, "market", "signal"],
      status: "normalized" as const
    };
  }

  async positionSignal({
    signal
  }: Parameters<TextProvider["positionSignal"]>[0]) {
    return {
      bestAngle: /owner|ownership/i.test(signal.rawText)
        ? "ownership_gap"
        : "workflow_accountability",
      alternativeAnglesJson: [
        "workflow_accountability",
        "handoff_failure",
        "operational_roi"
      ],
      recommendedFormat: "long_linkedin_post" as const,
      audienceEmphasis: "Founders and operators responsible for workflow quality",
      toneGuidance: "Direct, grounded, and operator-first",
      recommendedPillarFinal: "workflow_accountability"
    };
  }

  async reviewContentAsset({
    content
  }: Parameters<TextProvider["reviewContentAsset"]>[0]) {
    const text = `${content.hook} ${content.body} ${content.cta}`.toLowerCase();
    const genericnessRisk: "low" | "medium" | "high" =
      /unlock|game changer|revolutionary|fast-paced/.test(text) ? "high" : "low";
    const businessValueSignal: "strong" | "mixed" | "weak" =
      /operator|workflow|cost|handoff|ownership|recovery|queue/.test(text) ? "strong" : "mixed";
    const differentiationSignal: "strong" | "mixed" | "weak" =
      /owner|ownership|recovery|handoff|queue visibility|approval/.test(text)
        ? "strong"
        : "mixed";
    const qualitySignal: "strong" | "mixed" | "weak" =
      genericnessRisk === "low" && businessValueSignal === "strong" ? "strong" : "mixed";

    return {
      qualitySignal,
      genericnessRisk,
      businessValueSignal,
      differentiationSignal,
      publishReadyHint: qualitySignal === "strong" && differentiationSignal === "strong",
      rewriteSuggestions:
        genericnessRisk === "high"
          ? ["Remove generic hype phrasing and sharpen the operating lesson."]
          : ["Tighten one paragraph so the business payoff lands earlier."],
      criticNotes:
        "Best when the draft stays grounded in ownership, workflow reality, and operator consequence."
    };
  }

  async enrichScoutOutput({
    scout
  }: Parameters<TextProvider["enrichScoutOutput"]>[0]) {
    return {
      improvedSummary: `AI insight: ${scout.subject}`,
      whyItMatters: scout.whyItMatters,
      businessConsequence:
        scout.kind === "match"
          ? "This pain-to-solution pairing sharpens the business consequence for operator review."
          : "This makes the execution consequence easier to explain in business language.",
      operatorAngle:
        scout.kind === "solution"
          ? "Frame it as an implementation lesson operators can apply without hype."
          : "Frame it in operator language with a concrete next-step angle.",
      uncertaintyNote: "AI enrichment is additive and should be reviewed against the deterministic scout item."
    };
  }

  async generateMatchContent({
    content
  }: Parameters<TextProvider["generateMatchContent"]>[0]) {
    if (content.recommendedAction === "write_post") {
      return {
        contentIdea: `Post idea: ${content.title ?? content.painSummary ?? "match insight"}`,
        draftAngle:
          "Frame the pairing as a practical business lesson with a clear operator takeaway.",
        postSeed:
          "A lot of rollout pain is really ownership pain. Visibility helps, but only when one team owns the fix.",
        warnings: ["Review the seed against the live evidence before publishing."],
        provider: this.id
      };
    }

    if (content.recommendedAction === "write_comment") {
      return {
        contentIdea: `Comment idea: ${content.title ?? content.painSummary ?? "match insight"}`,
        draftAngle:
          "Add one concrete operator lesson that sharpens the business relevance without repeating the full post.",
        commentSeed:
          "One useful pattern here: visibility helps only when someone also owns the recovery step.",
        warnings: ["Keep the public comment additive and concise."],
        provider: this.id
      };
    }

    if (content.recommendedAction === "save_for_later") {
      return {
        contentIdea: `Later angle: ${content.title ?? content.painSummary ?? "match insight"}`,
        angleStub: "Revisit this pairing when there is stronger evidence or a clearer public hook.",
        warnings: ["Keep this as lightweight review support, not a draft."],
        provider: this.id
      };
    }

    return undefined;
  }
}
