import { describe, expect, it } from "vitest";
import type { ContentAsset, Idea, Signal } from "@linkedin-brand-os/shared";
import {
  buildBrandVoicePrompt,
  buildBusinessTranslatorPrompt,
  buildContentGenerationPrompt,
  buildCriticPrompt,
  buildFinalPostPrompt,
  buildHumanWritingRefinementPrompt,
  buildLinkedInPostPrompt,
  buildMarketAnalysisPrompt,
  buildPositioningPrompt,
  buildScoutEnrichmentPrompt,
  buildSourceSummaryPrompt,
  buildTopicScoringPrompt,
  buildVisualPrompt,
  buildVoiceEditorPrompt,
  buildWritingQualityPrompt
} from "./index";

describe("prompt builders", () => {
  it("buildBusinessTranslatorPrompt includes signal context", () => {
    const signal: Signal = {
      id: "sig-1",
      title: "AI governance",
      sourceType: "manual",
      rawText: "Leaders want operational clarity.",
      status: "new",
      createdAt: "2026-03-14T00:00:00.000Z"
    };

    expect(buildBusinessTranslatorPrompt(signal)).toContain(
      "Title: AI governance"
    );
    expect(buildBusinessTranslatorPrompt(signal)).toContain(
      "Raw text: Leaders want operational clarity."
    );
  });

  it("buildLinkedInPostPrompt includes idea title and angle", () => {
    const idea: Idea = {
      id: "idea-1",
      signalId: "sig-1",
      title: "Explain AI governance in business terms",
      coreInsight: "Map controls to business confidence.",
      businessRelevance: "Faster approval and less rollout friction.",
      targetAudience: "B2B founders",
      status: "draft",
      createdAt: "2026-03-14T00:00:00.000Z"
    };

    const prompt = buildLinkedInPostPrompt(idea);

    expect(prompt).toContain("Title: Explain AI governance in business terms");
    expect(prompt).toContain("Core insight: Map controls to business confidence.");
  });

  it("buildPositioningPrompt includes signal context", () => {
    const signal: Signal = {
      id: "sig-2",
      title: "Workflow accountability repo",
      sourceType: "github_repo",
      rawText: "Expose queue state and operator ownership.",
      status: "new",
      createdAt: "2026-03-14T00:00:00.000Z"
    };

    const prompt = buildPositioningPrompt(signal);

    expect(prompt).toContain("Title: Workflow accountability repo");
    expect(prompt).toContain("Source type: github_repo");
  });

  it("buildCriticPrompt includes draft title and body", () => {
    const content: ContentAsset = {
      id: "content-1",
      ideaId: "idea-1",
      contentType: "linkedin-post",
      hook: "Why governance accelerates adoption",
      body: "Governance removes friction by making approval easier.",
      cta: "Invite discussion",
      status: "draft",
      createdAt: "2026-03-14T00:00:00.000Z"
    };

    const prompt = buildCriticPrompt(content);

    expect(prompt).toContain("Hook: Why governance accelerates adoption");
    expect(prompt).toContain(
      "Body: Governance removes friction by making approval easier."
    );
  });

  it("buildVoiceEditorPrompt includes refinement context", () => {
    const content: ContentAsset = {
      id: "content-2",
      ideaId: "idea-1",
      contentType: "linkedin-post",
      hook: "Original hook",
      body: "Original body",
      cta: "Original cta",
      status: "draft",
      createdAt: "2026-03-14T00:00:00.000Z"
    };

    const prompt = buildVoiceEditorPrompt(content);

    expect(prompt).toContain("Hook: Original hook");
    expect(prompt).toContain("Prefer practical, grounded language");
  });

  it("buildVisualPrompt includes content context", () => {
    const content: ContentAsset = {
      id: "content-3",
      ideaId: "idea-1",
      contentType: "linkedin-post",
      hook: "Operational clarity beats hype",
      body: "Body text",
      cta: "CTA",
      status: "draft",
      createdAt: "2026-03-14T00:00:00.000Z"
    };

    const prompt = buildVisualPrompt(content);

    expect(prompt).toContain("Hook: Operational clarity beats hype");
    expect(prompt).toContain("Generate a structured visual brief");
  });

  it("buildSourceSummaryPrompt includes source intake context", () => {
    const prompt = buildSourceSummaryPrompt({
      title: "Public article",
      sourceType: "article",
      rawText: "Open-source article about AI operations."
    });

    expect(prompt).toContain("Title: Public article");
    expect(prompt).toContain("Manual/open-source safe intake only");
  });

  it("buildMarketAnalysisPrompt includes market profile context", () => {
    const prompt = buildMarketAnalysisPrompt({
      country: "Canada",
      region: "North America",
      primaryLanguage: "English",
      marketNote: "Strong B2B operator market."
    });

    expect(prompt).toContain("Country: Canada");
    expect(prompt).toContain("stored market profile");
  });

  it("buildTopicScoringPrompt includes source and market context", () => {
    const prompt = buildTopicScoringPrompt({
      sourceTitles: ["Public article"],
      marketCountries: ["Canada"]
    });

    expect(prompt).toContain("Sources: Public article");
    expect(prompt).toContain("Markets: Canada");
  });

  it("brand voice and writing quality prompts include the expected context", () => {
    const voicePrompt = buildBrandVoicePrompt({
      name: "Grounded Operator Voice",
      tone: "Direct, practical, calm",
      audience: "Founders",
      writingRules: ["Use plain business language"],
      bannedPatterns: ["AI is changing everything"],
      preferredPatterns: ["operational payoff"],
      styleNotes: "Keep it specific.",
      isActive: true
    });
    const refinePrompt = buildHumanWritingRefinementPrompt({
      hook: "AI is changing everything",
      body: "This is a game changer for every business.",
      cta: "Let me know your thoughts."
    });
    const qualityPrompt = buildWritingQualityPrompt({
      hook: "Original hook",
      body: "Original body"
    });

    expect(voicePrompt).toContain("Grounded Operator Voice");
    expect(refinePrompt).toContain("Avoid generic hype");
    expect(qualityPrompt).toContain("anti-robotic phrasing");
  });

  it("buildFinalPostPrompt includes final post shaping rules", () => {
    const prompt = buildFinalPostPrompt({
      hook: "Long draft hook that needs tightening",
      body: "Draft body with repeated phrasing and late payoff.",
      cta: "Draft cta"
    });

    expect(prompt).toContain("shorter and stronger");
    expect(prompt).toContain("reduce repeated phrases");
    expect(prompt).toContain("move business payoff earlier");
  });

  it("buildScoutEnrichmentPrompt steers audience enrichment toward pain clarity and business consequence", () => {
    const prompt = buildScoutEnrichmentPrompt({
      kind: "audience",
      subject: "Operators are flagging broken handoffs after launch.",
      whyItMatters: "This shows workflow-accountability pain in live operations.",
      supportingContext: "Broken Handoff",
      rawExcerpt: "Operators still patch workflow handoffs manually.",
      operatorAction: "post_candidate"
    });

    expect(prompt).toContain("Audience shaping:");
    expect(prompt).toContain("sharpen the pain clearly and concretely");
    expect(prompt).toContain("practical business cost or operational consequence");
  });

  it("buildScoutEnrichmentPrompt steers solution enrichment toward implementation-summary and operator angle", () => {
    const prompt = buildScoutEnrichmentPrompt({
      kind: "solution",
      subject: "Visibility and coordination pattern",
      whyItMatters: "Useful operator lesson.",
      supportingContext: "Expose status and ownership early.",
      rawExcerpt: "Expose status and ownership before work stalls.",
      operatorAction: "post_candidate"
    });

    expect(prompt).toContain("Solution shaping:");
    expect(prompt).toContain("concrete implementation lesson");
    expect(prompt).toContain("how an operator could frame or use the lesson");
  });

  it("buildScoutEnrichmentPrompt steers match enrichment toward why-it-matters and operator/content angle", () => {
    const prompt = buildScoutEnrichmentPrompt({
      kind: "match",
      subject: "Operators are flagging broken handoffs after launch.",
      whyItMatters: "The solution addresses the same ownership gap.",
      supportingContext: "Visibility and coordination pattern",
      operatorAction: "write_post"
    });

    expect(prompt).toContain("Match shaping:");
    expect(prompt).toContain("pairing matters now");
    expect(prompt).toContain("operator/content framing angle");
    expect(prompt).toContain("practical business relevance");
    expect(prompt).toContain("Current operator action hint: write_post");
  });

  it("buildScoutEnrichmentPrompt stays action-aware for comment and defer-oriented match cases", () => {
    const commentPrompt = buildScoutEnrichmentPrompt({
      kind: "match",
      subject: "Operators are flagging broken handoffs after launch.",
      whyItMatters: "The solution addresses the same ownership gap.",
      supportingContext: "Visibility and coordination pattern",
      operatorAction: "write_comment"
    });
    const deferPrompt = buildScoutEnrichmentPrompt({
      kind: "match",
      subject: "Operators are flagging broken handoffs after launch.",
      whyItMatters: "The solution addresses the same ownership gap.",
      supportingContext: "Visibility and coordination pattern",
      operatorAction: "save_for_later"
    });

    expect(commentPrompt).toContain("Current operator action hint: write_comment");
    expect(commentPrompt).toContain("operator/content framing angle");
    expect(deferPrompt).toContain("Current operator action hint: save_for_later");
    expect(deferPrompt).toContain("practical business relevance");
  });

  it("buildContentGenerationPrompt requests compact post-prep artifacts for write_post", () => {
    const prompt = buildContentGenerationPrompt({
      itemType: "match",
      recommendedAction: "write_post",
      title: "Workflow accountability after launch",
      painSummary: "Operators are still patching broken handoffs manually.",
      whyItMatters: "The pain-solution pairing points to a repeatable ownership gap.",
      operatorAngle: "Frame it as an operator lesson about visible ownership."
    });

    expect(prompt).toContain("Recommended action: write_post");
    expect(prompt).toContain("CONTENT_IDEA:");
    expect(prompt).toContain("DRAFT_ANGLE:");
    expect(prompt).toContain("POST_SEED:");
    expect(prompt).toContain("Do not write a full polished post");
    expect(prompt).toContain("human-sounding");
    expect(prompt).not.toContain("COMMENT_SEED only");
  });

  it("buildContentGenerationPrompt requests concise comment-prep artifacts for write_comment", () => {
    const prompt = buildContentGenerationPrompt({
      itemType: "match",
      recommendedAction: "write_comment",
      title: "Visibility and coordination pattern",
      painSummary: "Operators lose track of stalled workflow ownership.",
      whyItMatters: "The pairing creates a practical lesson worth adding to a public discussion.",
      operatorAngle: "Add one concrete operator lesson without sounding generic."
    });

    expect(prompt).toContain("Recommended action: write_comment");
    expect(prompt).toContain("CONTENT_IDEA:");
    expect(prompt).toContain("DRAFT_ANGLE:");
    expect(prompt).toContain("COMMENT_SEED:");
    expect(prompt).toContain("not flattery");
    expect(prompt).toContain("not mini-post sprawl");
  });

  it("buildContentGenerationPrompt keeps save_for_later lightweight and avoids over-generation", () => {
    const prompt = buildContentGenerationPrompt({
      itemType: "match",
      recommendedAction: "save_for_later",
      title: "Deferred workflow accountability idea",
      whyItMatters: "Useful later when the operator wants a stronger evidence set."
    });

    expect(prompt).toContain("Recommended action: save_for_later");
    expect(prompt).toContain("ANGLE_STUB:");
    expect(prompt).toContain("Avoid POST_SEED");
    expect(prompt).toContain("Avoid COMMENT_SEED");
    expect(prompt).toContain("Avoid content-forward urgency language");
  });
});
