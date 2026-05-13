import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CANONICAL_EXECUTION_TASK_POLICIES,
  createModelAssignmentConfigFromEnv,
  ExecutionPolicyRouter,
  MiraiAdapter,
  MiraiProvider,
  MockTextProvider,
  MockVisualProvider,
  ProviderRegistry,
  ProviderRouter,
  StrongTextProvider
} from "@linkedin-brand-os/ai-providers";
import { SqliteDatabase } from "@linkedin-brand-os/db";
import { AnalysisBlockedError, NotFoundError, OrchestratorService } from "./index";

describe("OrchestratorService workflow", () => {
  let orchestrator: OrchestratorService;
  let db: SqliteDatabase;
  let dbDir: string;

  beforeEach(async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-orchestrator-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();
    orchestrator = new OrchestratorService({ db });
  });

  afterEach(() => {
    db?.close();
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("ingestSignal persists a signal via repository", async () => {
    const signal = await orchestrator.ingestSignal({
      title: "Signal title",
      sourceType: "manual",
      rawText: "Signal raw text"
    });

    expect(signal).toMatchObject({
      title: "Signal title",
      sourceType: "manual",
      rawText: "Signal raw text",
      status: "new"
    });

    await expect(db.listSignals()).resolves.toEqual([signal]);
  });

  it("generateIdeaFromSignal creates an idea using the signal", async () => {
    const signal = await orchestrator.ingestSignal({
      title: "AI rollout blockers",
      sourceType: "manual",
      rawText: "Executives need a clearer business case for AI approvals."
    });

    const idea = await orchestrator.generateIdeaFromSignal(signal.id);

    expect(idea).toMatchObject({
      signalId: signal.id,
      status: "draft",
      title: expect.stringContaining("AI rollout blockers"),
      coreInsight: expect.any(String),
      businessRelevance: expect.any(String),
      targetAudience: expect.any(String)
    });

    await expect(db.listIdeas()).resolves.toEqual([idea]);
  });

  it("generateContentFromIdea creates a content draft linked to the idea and signal", async () => {
    const signal = await orchestrator.ingestSignal({
      title: "AI buying committee friction",
      sourceType: "manual",
      rawText: "Content should explain why technical pilots fail to reach production."
    });
    const idea = await orchestrator.generateIdeaFromSignal(signal.id);

    const asset = await orchestrator.generateContentFromIdea(idea.id);

    expect(asset).toMatchObject({
      ideaId: idea.id,
      contentType: "linkedin-post",
      hook: expect.any(String),
      body: expect.stringContaining(idea.coreInsight),
      cta: expect.any(String),
      status: "draft"
    });

    const ideas = await db.listIdeas();
    const assets = await db.listContentAssets();

    expect(ideas[0]?.signalId).toBe(signal.id);
    expect(assets[0]?.ideaId).toBe(idea.id);
  });

  it("refineContentDraft updates a content asset with refined fields", async () => {
    const signal = await orchestrator.ingestSignal({
      title: "AI operations",
      sourceType: "manual",
      rawText: "Operators need grounded language for change management."
    });
    const idea = await orchestrator.generateIdeaFromSignal(signal.id);
    const content = await orchestrator.generateContentFromIdea(idea.id);

    const refined = await orchestrator.refineContentDraft(content.id);

    expect(refined.refinementStatus).toBe("refined");
    expect(refined.refinedBody).toEqual(expect.any(String));
    expect(refined.refinedHook).toEqual(expect.any(String));
  });

  it("generateFinalPost persists final post fields without breaking the refined draft", async () => {
    const signal = await orchestrator.ingestSignal({
      title: "AI operations",
      sourceType: "manual",
      rawText: "Operators need grounded language for change management."
    });
    const idea = await orchestrator.generateIdeaFromSignal(signal.id);
    const content = await orchestrator.generateContentFromIdea(idea.id);
    const refined = await orchestrator.refineContentDraft(content.id);

    const finalized = await orchestrator.generateFinalPost(content.id);

    expect(finalized.id).toBe(content.id);
    expect(finalized.refinedBody).toBe(refined.refinedBody);
    expect(finalized.finalHook).toEqual(expect.any(String));
    expect(finalized.finalBody).toEqual(expect.any(String));
    expect(finalized.finalClosing).toEqual(expect.any(String));
    expect(finalized.finalStatus).toBe("ready");
    expect(finalized.finalQualityScore).toBeGreaterThan(0);
  });

  it("generateFinalPost accepts optional V3 quality config and returns ephemeral quality metadata", async () => {
    const signal = await orchestrator.ingestSignal({
      title: "AI operations",
      sourceType: "manual",
      rawText: "Operators need grounded language for change management."
    });
    const idea = await orchestrator.generateIdeaFromSignal(signal.id);
    const content = await orchestrator.generateContentFromIdea(idea.id);
    await orchestrator.refineContentDraft(content.id);

    const finalized = await orchestrator.generateFinalPost(content.id, {
      hookMode: "operational_tension",
      antiBlandness: true
    });

    expect(finalized.finalStatus).toBe("ready");
    expect(finalized.finalQualityMetadata).toEqual(
      expect.objectContaining({
        hookStrengthScore: expect.any(Number),
        humanFeelScore: expect.any(Number),
        publishabilityScore: expect.any(Number)
      })
    );

    const persisted = await db.getContentAssetById(content.id);
    expect(persisted?.finalStatus).toBe("ready");
    expect(persisted?.finalQualityScore).toBeGreaterThan(0);
  });

  it("generateFinalPost accepts additive outcome-aware shaping context", async () => {
    const signal = await orchestrator.ingestSignal({
      title: "Workflow accountability",
      sourceType: "manual",
      rawText: "Operator trust grows when one owner carries the workflow after launch."
    });
    const idea = await orchestrator.generateIdeaFromSignal(signal.id);
    const content = await orchestrator.generateContentFromIdea(idea.id);
    await orchestrator.refineContentDraft(content.id);

    const finalized = await orchestrator.generateFinalPost(
      content.id,
      { outcomeAwareShaping: true },
      {
        feedbackSummary: {
          strongPatterns: ["workflow accountability"],
          weakPatterns: [],
          suggestedRepeats: ["operator execution"],
          suggestedAvoids: [],
          reasoningSummary: "Workflow accountability keeps winning.",
          totalRecords: 2
        },
        patternMemorySummary: {
          repeatPatterns: [],
          avoidPatterns: [],
          recurringThemes: ["workflow accountability"],
          weakThemes: [],
          notes: "Long-term memory keeps reinforcing workflow accountability.",
          totalPatterns: 1
        }
      }
    );

    expect(finalized.finalStatus).toBe("ready");
    expect(finalized.finalQualityMetadata).toEqual(
      expect.objectContaining({
        appliedOutcomeBias: "repeat",
        outcomePatternBiasNotes: expect.arrayContaining([
          expect.stringMatching(/workflow accountability|operator execution/i)
        ])
      })
    );
  });

  it("generateFinalPost can use provider-assisted drafting before cleanup while persisting stable fields", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    const router = new ProviderRouter(registry, {
      mode: "mock",
      textProvider: "mock-text",
      fallbackEnabled: true
    });

    orchestrator = new OrchestratorService({ db, providerRouter: router });

    const signal = await orchestrator.ingestSignal({
      title: "AI operations",
      sourceType: "manual",
      rawText: "Operators need grounded language for change management."
    });
    const idea = await orchestrator.generateIdeaFromSignal(signal.id);
    const content = await orchestrator.generateContentFromIdea(idea.id);
    await orchestrator.refineContentDraft(content.id);

    const finalized = await orchestrator.generateFinalPost(content.id);

    expect(finalized.finalStatus).toBe("ready");
    expect(finalized.finalBody).toEqual(expect.any(String));
    expect(finalized.finalBody).not.toContain("Audience:");
    expect(finalized.finalBody).not.toContain("Voice:");
  });

  it("generateExperimentalPostV2 returns a comparison-only post from a signal without persisting content fields", async () => {
    const signal = await orchestrator.ingestSignal({
      title: "Why AI copilots fail after the demo",
      sourceType: "manual",
      rawText:
        "Most AI copilots look impressive in a demo, but collapse in real work because nobody designs the surrounding process. There is no clear owner, no exception handling, no workflow memory, and no operational accountability. The model is rarely the main problem."
    });

    const result = await orchestrator.generateExperimentalPostV2({
      signalId: signal.id,
      brandVoice: {
        name: "Operator Voice",
        tone: "Practical, sharp, grounded, anti-hype",
        audience: "Founders and operators",
        writingRules: ["Lead with the operational failure"],
        bannedPatterns: ["A business case for action"],
        preferredPatterns: ["if nobody owns the workflow"],
        styleNotes: "Keep it credible.",
        isActive: true
      }
    });

    expect(result.post).toEqual(expect.any(String));
    expect(result.post.split("\n\n")).toHaveLength(5);
    expect(result.signalId).toBe(signal.id);
    expect(result.mode).toMatch(/deterministic|provider/);

    const assets = await db.listContentAssets();
    expect(assets).toEqual([]);
  });

  it("generateVisualForContent creates a visual asset linked to content", async () => {
    const signal = await orchestrator.ingestSignal({
      title: "AI operations",
      sourceType: "manual",
      rawText: "Operators need grounded language for change management."
    });
    const idea = await orchestrator.generateIdeaFromSignal(signal.id);
    const content = await orchestrator.generateContentFromIdea(idea.id);

    const visual = await orchestrator.generateVisualForContent(content.id);

    expect(visual).toMatchObject({
      contentAssetId: content.id,
      visualType: "single-image",
      prompt: expect.any(String),
      status: "ready"
    });
  });

  it("recordAnalyticsSnapshot and analyzePerformance produce recommendations", async () => {
    const signal = await orchestrator.ingestSignal({
      title: "Founder operations",
      sourceType: "manual",
      rawText: "Founders respond to grounded operational advice."
    });
    const idea = await orchestrator.generateIdeaFromSignal(signal.id);
    const content = await orchestrator.generateContentFromIdea(idea.id);

    await orchestrator.recordAnalyticsSnapshot({
      contentAssetId: content.id,
      impressions: 1500,
      likes: 92,
      comments: 18,
      saves: 13,
      profileViews: 26,
      followersGained: 7
    });

    const recommendations = await orchestrator.analyzePerformance();

    expect(recommendations.length).toBeGreaterThan(0);
    expect(await db.listStrategyRecommendations()).toEqual(recommendations);
  });

  it("analyzePerformance accepts optional feedbackSummary and adds feedback-aware strategy guidance", async () => {
    const signal = await orchestrator.ingestSignal({
      title: "Workflow accountability",
      sourceType: "manual",
      rawText: "Workflow accountability matters after launch."
    });
    const idea = await orchestrator.generateIdeaFromSignal(signal.id);
    const content = await orchestrator.generateContentFromIdea(idea.id);

    await orchestrator.recordAnalyticsSnapshot({
      contentAssetId: content.id,
      impressions: 1200,
      likes: 80,
      comments: 10,
      saves: 7,
      profileViews: 20,
      followersGained: 4
    });

    const recommendations = await orchestrator.analyzePerformance({
      feedbackSummary: {
        strongPatterns: ["Workflow accountability themes are performing well."],
        weakPatterns: ["Generic AI commentary is weak."],
        suggestedRepeats: ["Repeat workflow accountability angles."],
        suggestedAvoids: ["Avoid generic AI commentary this week."],
        reasoningSummary: "Use feedback to sharpen strategy.",
        totalRecords: 2
      }
    });

    expect(recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Repeat the strongest operator themes"
        }),
        expect.objectContaining({
          title: "Deprioritize weaker patterns this week"
        })
      ])
    );
  });

  it("recordAnalyticsSnapshotAndUpdateMemory persists a snapshot and creates strong evidence-based memory patterns", async () => {
    const signal = await db.createSignal({
      title: "Workflow accountability signal",
      sourceType: "article",
      rawText:
        "Founders and operators need queue visibility, ownership, and exception recovery after rollout.",
      topicTags: ["workflow-accountability", "queue-visibility"]
    });
    const analysis = await db.createSignalAnalysis({
      signalId: signal.id,
      relevanceScore: 81,
      whyRelevant: "Strong fit for founder/operator authority content.",
      targetAudience: "Founders and operators",
      businessValueSummary: "Clear operational lesson with business relevance.",
      painsSolved: ["handoff failure"],
      practicalImplications: ["show queue ownership"],
      recommendedPillar: "workflow_accountability",
      uniquenessScore: 73,
      uniquenessReason: "Specific operator framing.",
      buildabilityScore: 77,
      buildabilityReason: "Strong practical detail.",
      popularityPotentialScore: 78,
      brandGrowthPotentialScore: 84,
      bestAngle: "ownership_gap",
      recommendedFormat: "long_linkedin_post",
      audienceEmphasis: "Founders and operators",
      recommendedPillarFinal: "workflow_accountability"
    });
    const decision = await db.createOrchestratorDecision({
      signalId: signal.id,
      decisionType: "high_priority_candidate",
      decisionReason: "Strong enough to move into content.",
      confidenceScore: 84,
      nextAction: "prioritize_for_content",
      requiresHumanReview: true
    });
    const idea = await db.createIdea({
      signalId: signal.id,
      title: "Idea",
      coreInsight: "Insight",
      businessRelevance: "Business",
      targetAudience: "Founders and operators",
      status: "draft"
    });
    const content = await db.createContentAsset({
      ideaId: idea.id,
      signalId: signal.id,
      signalAnalysisId: analysis.id,
      orchestratorDecisionId: decision.id,
      contentType: "linkedin-post",
      hook: "The workflow breaks before the model does",
      body: "Queue visibility and ownership matter after rollout.",
      cta: "Compare notes.",
      bestAngle: "ownership_gap",
      recommendedFormat: "long_linkedin_post",
      longPostDraft: "Long draft",
      shortPostDraft: "Short draft",
      status: "draft",
      contentStatus: "review",
      publishReadyFlag: false
    });
    await db.createWritingQualityAssessment({
      contentAssetId: content.id,
      humanToneScore: 82,
      clarityScore: 84,
      groundednessScore: 86,
      antiRobotScore: 88,
      overallScore: 85,
      notes: ["Strong draft"],
      qualityScore: 84,
      genericnessScore: 22,
      businessValueScore: 83,
      differentiationScore: 80,
      publishReadyFlag: false,
      rewriteSuggestions: ["Tighten intro"],
      criticNotes: "Grounded."
    });

    const result = await orchestrator.recordAnalyticsSnapshotAndUpdateMemory({
      contentAssetId: content.id,
      postUrl: "https://linkedin.com/posts/example-1",
      platform: "linkedin",
      publishedAt: "2026-03-18T14:30:00.000Z",
      audienceGeoHint: "North America",
      audienceSegment: "B2B operators",
      impressions: 2400,
      likes: 120,
      comments: 24,
      saves: 18,
      reactions: 120,
      reposts: 8,
      profileViews: 48,
      followersGained: 12,
      inboundLeads: 4,
      qualitativeNotes: "Strong operator resonance and concrete implementation comments."
    });

    expect(result.snapshot.contentAssetId).toBe(content.id);
    expect(result.outcomeClassification).toBe("strong");
    expect(result.memoryPatterns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          patternType: "angle",
          patternKey: "angle:strong:ownership-gap",
          recommendedAction: "repeat"
        }),
        expect.objectContaining({
          patternType: "pillar",
          patternKey: "pillar:strong:workflow-accountability"
        }),
        expect.objectContaining({
          patternType: "publish_window",
          patternKey: "publish_window:strong:afternoon"
        }),
        expect.objectContaining({
          patternType: "source_type",
          patternKey: "source_type:strong:article"
        })
      ])
    );
    expect(result.memoryPatterns[0]?.supportingEvidenceJson).toEqual(
      expect.objectContaining({
        lastEvidence: expect.objectContaining({
          contentAssetId: content.id,
          signalId: signal.id,
          analyticsSnapshotId: result.snapshot.id,
          outcomeClassification: "strong"
        })
      })
    );
  });

  it("recordAnalyticsSnapshotAndUpdateMemory creates weak topic and angle patterns from a poor outcome", async () => {
    const signal = await db.createSignal({
      title: "Weak topic signal",
      sourceType: "manual_note",
      rawText: "Generic workflow commentary without much specificity.",
      topicTags: ["generic-ai-commentary"]
    });
    const analysis = await db.createSignalAnalysis({
      signalId: signal.id,
      relevanceScore: 52,
      whyRelevant: "Directionally relevant.",
      targetAudience: "Founders and operators",
      businessValueSummary: "Needs more concrete business framing.",
      painsSolved: ["vague workflow confusion"],
      practicalImplications: ["clarify specifics"],
      recommendedPillar: "workflow_accountability",
      uniquenessScore: 45,
      uniquenessReason: "Not differentiated.",
      buildabilityScore: 40,
      buildabilityReason: "Weak implementation detail.",
      popularityPotentialScore: 38,
      brandGrowthPotentialScore: 44,
      bestAngle: "workflow_accountability",
      recommendedFormat: "long_linkedin_post",
      audienceEmphasis: "Founders and operators",
      recommendedPillarFinal: "workflow_accountability"
    });
    const idea = await db.createIdea({
      signalId: signal.id,
      title: "Idea",
      coreInsight: "Insight",
      businessRelevance: "Business",
      targetAudience: "Founders and operators",
      status: "draft"
    });
    const content = await db.createContentAsset({
      ideaId: idea.id,
      signalId: signal.id,
      signalAnalysisId: analysis.id,
      contentType: "linkedin-post",
      hook: "Generic AI thought",
      body: "Automation matters.",
      cta: "Thoughts?",
      bestAngle: "workflow_accountability",
      recommendedFormat: "long_linkedin_post",
      status: "draft",
      contentStatus: "review",
      publishReadyFlag: false
    });

    const result = await orchestrator.recordAnalyticsSnapshotAndUpdateMemory({
      contentAssetId: content.id,
      postUrl: "https://linkedin.com/posts/example-2",
      platform: "linkedin",
      publishedAt: "2026-03-18T02:15:00.000Z",
      audienceGeoHint: "North America",
      audienceSegment: "General LinkedIn audience",
      impressions: 900,
      likes: 6,
      comments: 1,
      saves: 0,
      reactions: 6,
      reposts: 0,
      profileViews: 3,
      followersGained: 0,
      inboundLeads: 0,
      qualitativeNotes: "Felt generic and vague."
    });

    expect(result.outcomeClassification).toBe("weak");
    expect(result.memoryPatterns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          patternType: "topic",
          patternKey: "topic:weak:generic-ai-commentary",
          recommendedAction: "deprioritize"
        }),
        expect.objectContaining({
          patternType: "angle",
          patternKey: "angle:weak:workflow-accountability"
        })
      ])
    );
  });

  it("planDecision returns a deterministic action plan without affecting signal-to-content flows", async () => {
    const plan = await orchestrator.planDecision({
      signalText:
        "Most AI copilots collapse after the demo because nobody owns the workflow or the exception path.",
      sourceType: "manual",
      targetRole: "Founder",
      relevanceScore: 86,
      bestAngle: "ownership_gap",
      recommendedAction: "comment"
    });

    expect(plan).toEqual(
      expect.objectContaining({
        recommendedNextAction: "generate_post_candidate",
        bestAngle: "ownership_gap",
        decisionMode: "deterministic"
      })
    );

    const signal = await orchestrator.ingestSignal({
      title: "Still works",
      sourceType: "manual",
      rawText: "Keep the old pipeline stable."
    });
    const idea = await orchestrator.generateIdeaFromSignal(signal.id);
    const content = await orchestrator.generateContentFromIdea(idea.id);

    expect(content.ideaId).toBe(idea.id);
  });

  it("ingestSourceItem normalizes and persists source intake", async () => {
    const source = await orchestrator.ingestSourceItem({
      title: "Open-source article",
      sourceType: "article",
      sourceUrl: "https://example.com/article",
      rawText: "Open-source article covering operator-led AI rollout patterns."
    });

    expect(source).toMatchObject({
      title: "Open-source article",
      sourceType: "article",
      normalizedSummary: expect.any(String),
      tags: expect.any(Array),
      status: "normalized"
    });
    await expect(db.listSourceItems()).resolves.toEqual([source]);
  });

  it("ingestMarketProfile structures and persists market intelligence", async () => {
    const market = await orchestrator.ingestMarketProfile({
      country: "Canada",
      region: "North America",
      primaryLanguage: "English",
      marketNote: "Strong B2B operator market."
    });

    expect(market).toMatchObject({
      country: "Canada",
      linkedinPriority: expect.any(String),
      serviceFitScore: expect.any(Number)
    });
    await expect(db.listMarketProfiles()).resolves.toEqual([market]);
  });

  it("scoreTopics creates and persists topic scores from stored inputs", async () => {
    await orchestrator.ingestSourceItem({
      title: "AI rollout operations",
      sourceType: "article",
      rawText: "Operator-led AI rollout advice."
    });
    await orchestrator.ingestMarketProfile({
      country: "Canada",
      region: "North America",
      primaryLanguage: "English",
      marketNote: "Strong B2B operator market."
    });

    const scores = await orchestrator.scoreTopics();

    expect(scores.length).toBeGreaterThan(0);
    expect(await db.listTopicScores()).toEqual(scores);
  });

  it("buildContentQueue creates prioritized queue items from topic scores", async () => {
    await orchestrator.ingestSourceItem({
      title: "AI rollout operations",
      sourceType: "article",
      rawText: "Operator-led AI rollout advice."
    });
    await orchestrator.ingestMarketProfile({
      country: "Canada",
      region: "North America",
      primaryLanguage: "English",
      marketNote: "Strong B2B operator market."
    });
    await orchestrator.scoreTopics();

    const queue = await orchestrator.buildContentQueue();

    expect(queue.length).toBeGreaterThan(0);
    expect(queue[0]).toEqual(
      expect.objectContaining({
        recommendedAction: expect.any(String),
        priority: expect.any(String),
        status: "queued"
      })
    );
    expect(await db.listContentQueueItems()).toEqual(queue);
  });

  it("generateContentFromIdea uses provider routing when enabled", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    const router = new ProviderRouter(registry, {
      mode: "mock",
      textProvider: "mock-text",
      fallbackEnabled: true
    });

    orchestrator = new OrchestratorService({ db, providerRouter: router });

    const signal = await orchestrator.ingestSignal({
      title: "Operational AI rollout",
      sourceType: "manual",
      rawText: "Make the rollout path concrete."
    });
    const idea = await orchestrator.generateIdeaFromSignal(signal.id);

    const asset = await orchestrator.generateContentFromIdea(idea.id);

    expect(asset.body).toContain("practical");
    expect((await db.listContentAssets())[0]?.id).toBe(asset.id);
  });

  it("refineContentDraft uses provider routing when enabled", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    const router = new ProviderRouter(registry, {
      mode: "mock",
      textProvider: "mock-text",
      fallbackEnabled: true
    });

    orchestrator = new OrchestratorService({ db, providerRouter: router });

    const signal = await orchestrator.ingestSignal({
      title: "Operational AI rollout",
      sourceType: "manual",
      rawText: "Make the rollout path concrete."
    });
    const idea = await orchestrator.generateIdeaFromSignal(signal.id);
    const content = await orchestrator.generateContentFromIdea(idea.id);

    const refined = await orchestrator.refineContentDraft(content.id);

    expect(refined.refinedBody).toContain("clear, direct");
    expect((await db.getContentAssetById(content.id))?.refinementStatus).toBe("refined");
  });

  it("generateVisualForContent uses provider routing when enabled", async () => {
    const registry = new ProviderRegistry();
    registry.registerVisualProvider(new MockVisualProvider());
    const router = new ProviderRouter(registry, {
      mode: "mock",
      visualProvider: "mock-visual",
      fallbackEnabled: true
    });

    orchestrator = new OrchestratorService({ db, providerRouter: router });

    const signal = await orchestrator.ingestSignal({
      title: "Operational AI rollout",
      sourceType: "manual",
      rawText: "Make the rollout path concrete."
    });
    const idea = await orchestrator.generateIdeaFromSignal(signal.id);
    const content = await orchestrator.generateContentFromIdea(idea.id);

    const visual = await orchestrator.generateVisualForContent(content.id);

    expect(visual.prompt).toContain("editorial visual");
    expect((await db.listVisualAssets())[0]?.id).toBe(visual.id);
  });

  it("generateContentFromIdea can use a Mirai-backed path and still persist the same shape", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(
      new MiraiProvider(
        {
          enabled: true,
          model: "mirai-local"
        },
        {
          adapter: new MiraiAdapter({
            config: {
              enabled: true,
              transport: "node",
              nodePath: process.execPath
            },
            transport: {
              getAvailability: () => ({
                available: true,
                reason: "Mirai ready"
              }),
              generateText: async () => ({
                text: "Practical operator post body with concrete rollout guidance.",
                hook: "The rollout problem is not the model",
                body: "Practical operator post body with concrete rollout guidance.",
                cta: "Compare notes if this is showing up in your team."
              }),
              getSummary: () => "mirai-default@node"
            }
          })
        }
      )
    );
    const router = new ProviderRouter(registry, {
      mode: "local",
      textProvider: "mirai",
      fallbackEnabled: true
    });

    orchestrator = new OrchestratorService({ db, providerRouter: router });

    const signal = await orchestrator.ingestSignal({
      title: "Operator rollout friction",
      sourceType: "manual",
      rawText: "Teams need grounded rollout language."
    });
    const idea = await orchestrator.generateIdeaFromSignal(signal.id);

    const asset = await orchestrator.generateContentFromIdea(idea.id);

    expect(asset).toEqual(
      expect.objectContaining({
        ideaId: idea.id,
        contentType: "linkedin-post",
        hook: expect.stringContaining("rollout problem"),
        body: expect.stringContaining("Practical operator post body"),
        status: "draft",
        qualityStatus: "reviewed",
        overallQualityScore: expect.any(Number)
      })
    );
  });

  it("refineContentDraft can use a Mirai-backed path and still runs the quality loop", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(
      new MiraiProvider(
        {
          enabled: true,
          model: "mirai-local"
        },
        {
          adapter: new MiraiAdapter({
            config: {
              enabled: true,
              transport: "node",
              nodePath: process.execPath
            },
            transport: {
              getAvailability: () => ({
                available: true,
                reason: "Mirai ready"
              }),
              generateText: async () => ({
                text: "A more grounded revision that avoids hype and stays concrete.",
                hook: "What actually blocks rollout progress",
                body: "A more grounded revision that avoids hype and stays concrete.",
                cta: "Compare notes if your team is seeing the same pattern."
              }),
              getSummary: () => "mirai-default@node"
            }
          })
        }
      )
    );
    const router = new ProviderRouter(registry, {
      mode: "local",
      textProvider: "mirai",
      fallbackEnabled: true
    });

    orchestrator = new OrchestratorService({ db, providerRouter: router });

    const signal = await orchestrator.ingestSignal({
      title: "Operator rollout friction",
      sourceType: "manual",
      rawText: "AI is changing everything and teams need grounded rollout language."
    });
    const idea = await orchestrator.generateIdeaFromSignal(signal.id);
    const content = await orchestrator.generateContentFromIdea(idea.id);

    const refined = await orchestrator.refineContentDraft(content.id);
    const assessments = await db.listWritingQualityAssessments();

    expect(refined.refinementStatus).toBe("refined");
    expect(refined.refinedBody).toContain("grounded revision");
    expect(refined.qualityStatus).toBe("reviewed");
    expect(refined.overallQualityScore).toBeGreaterThan(0);
    expect(assessments.at(-1)?.contentAssetId).toBe(content.id);
  });

  it("keeps persisted content shapes stable when the Mirai provider is configured through an SDK-style adapter", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(
      new MiraiProvider(
        {
          enabled: true,
          transport: "sdk",
          apiKey: "test-key",
          modelRepo: "Qwen/Qwen3-4B-AWQ"
        },
        {
          adapter: new MiraiAdapter({
            config: {
              enabled: true,
              transport: "sdk",
              apiKey: "test-key",
              modelRepo: "Qwen/Qwen3-4B-AWQ"
            },
            transport: {
              getAvailability: () => ({
                available: true,
                reason: "Mirai SDK ready."
              }),
              generateText: async () => ({
                text: "Hook: Operational AI rollout needs an owner\nBody: Teams move faster when rollout ownership is explicit.\nCTA: Compare notes if this is showing up in your team.",
                hook: "Operational AI rollout needs an owner",
                body: "Teams move faster when rollout ownership is explicit.",
                cta: "Compare notes if this is showing up in your team."
              }),
              getSummary: () => "Qwen/Qwen3-4B-AWQ@sdk"
            }
          })
        }
      )
    );

    const router = new ProviderRouter(registry, {
      mode: "local",
      textProvider: "mirai",
      fallbackEnabled: true
    });
    orchestrator = new OrchestratorService({ db, providerRouter: router });

    const signal = await orchestrator.ingestSignal({
      title: "Operational AI rollout",
      sourceType: "manual",
      rawText: "Make rollout ownership explicit."
    });
    const idea = await orchestrator.generateIdeaFromSignal(signal.id);
    const asset = await orchestrator.generateContentFromIdea(idea.id);
    const refined = await orchestrator.refineContentDraft(asset.id);

    expect(asset).toEqual(
      expect.objectContaining({
        ideaId: idea.id,
        contentType: "linkedin-post",
        status: "draft",
        qualityStatus: "reviewed",
        overallQualityScore: expect.any(Number)
      })
    );
    expect(refined).toEqual(
      expect.objectContaining({
        id: asset.id,
        refinementStatus: "refined",
        qualityStatus: "reviewed",
        overallQualityScore: expect.any(Number)
      })
    );
  });

  it("creates and returns the active brand voice profile", async () => {
    const created = await orchestrator.createBrandVoiceProfile({
      name: "Grounded Operator Voice",
      tone: "Direct, practical, calm",
      audience: "Founders and operator-led teams",
      writingRules: ["Use plain business language", "Lead with a concrete problem"],
      bannedPatterns: ["AI is changing everything"],
      preferredPatterns: ["operational payoff"],
      styleNotes: "Keep it specific.",
      isActive: true
    });

    expect(created.isActive).toBe(true);
    await expect(orchestrator.getActiveBrandVoiceProfile()).resolves.toEqual(created);
  });

  it("generateContentFromIdea respects active brand voice metadata when present", async () => {
    await orchestrator.createBrandVoiceProfile({
      name: "Grounded Operator Voice",
      tone: "Direct, practical, calm",
      audience: "Founders and operator-led teams",
      writingRules: ["Use plain business language"],
      bannedPatterns: ["AI is changing everything"],
      preferredPatterns: ["operational payoff"],
      styleNotes: "Keep it specific.",
      isActive: true
    });

    const signal = await orchestrator.ingestSignal({
      title: "Operational AI rollout",
      sourceType: "manual",
      rawText: "Make the rollout path concrete."
    });
    const idea = await orchestrator.generateIdeaFromSignal(signal.id);

    const asset = await orchestrator.generateContentFromIdea(idea.id);

    expect(asset.brandVoiceProfileId).toMatch(/^voice-/);
    expect(asset.body).toContain("operational payoff");
  });

  it("refineContentDraft creates a writing quality assessment and reviewed quality metadata", async () => {
    const voice = await orchestrator.createBrandVoiceProfile({
      name: "Grounded Operator Voice",
      tone: "Direct, practical, calm",
      audience: "Founders and operator-led teams",
      writingRules: ["Use plain business language"],
      bannedPatterns: ["AI is changing everything"],
      preferredPatterns: ["operational payoff"],
      styleNotes: "Keep it specific.",
      isActive: true
    });

    const signal = await orchestrator.ingestSignal({
      title: "Operational AI rollout",
      sourceType: "manual",
      rawText: "AI is changing everything for teams that need rollout clarity."
    });
    const idea = await orchestrator.generateIdeaFromSignal(signal.id);
    const content = await orchestrator.generateContentFromIdea(idea.id);

    const refined = await orchestrator.refineContentDraft(content.id);
    const assessments = await db.listWritingQualityAssessments();

    expect(refined.qualityStatus).toBe("reviewed");
    expect(refined.overallQualityScore).toBeGreaterThan(0);
    expect(refined.brandVoiceProfileId).toBe(voice.id);
    expect(assessments[0]?.contentAssetId).toBe(content.id);
  });

  it("normalizeSourceIntake returns a deterministic planner-ready signal candidate", async () => {
    const normalized = await orchestrator.normalizeSourceIntake({
      sourceType: "article",
      title: "Why AI copilots fail after the demo",
      sourceUrl: "https://example.com/copilots",
      summaryText:
        "Most AI copilots look impressive in a demo, but collapse in real work because nobody designs the surrounding process. There is no clear owner or exception handling.",
      operatorNotes: "Good founder-facing execution angle.",
      targetRole: "Founder",
      companyContext: "B2B operations software"
    });

    expect(normalized).toEqual(
      expect.objectContaining({
        sourceType: "article",
        suggestedAngle: "ownership_gap",
        normalizedSignalText: expect.any(String),
        plannerReadyPayload: expect.objectContaining({
          signalText: expect.any(String),
          sourceType: "article",
          targetRole: "Founder",
          bestAngle: "ownership_gap"
        })
      })
    );
  });

  it("ingestCanonicalSignal persists extracted canonical signals", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      text: async () =>
        "<html><title>Launch narrative</title><body><article>The launch page explains workflow visibility, approval state, and operator review.</article></body></html>"
    } as Response);

    orchestrator = new OrchestratorService({ db, watchlistFetch: fetchImpl });

    const signal = await orchestrator.ingestCanonicalSignal({
      sourceUrl: "https://example.com/product/launch-visibility"
    });

    expect(signal).toEqual(
      expect.objectContaining({
        sourceType: "tool_launch",
        sourceDomain: "example.com",
        normalizedContent: expect.stringContaining("approval state"),
        contentHash: expect.any(String)
      })
    );

    await expect(db.listSignals()).resolves.toEqual([signal]);
  });

  it("ingestCanonicalSignal reuses an existing signal when the content hash matches", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      text: async () =>
        "<html><title>AI workflow notes</title><body><article>Operators need one queue, one owner, and one escalation path.</article></body></html>"
    } as Response);

    orchestrator = new OrchestratorService({ db, watchlistFetch: fetchImpl });

    const first = await orchestrator.ingestCanonicalSignal({
      sourceUrl: "https://example.com/articles/workflow-notes"
    });
    const second = await orchestrator.ingestCanonicalSignal({
      sourceUrl: "https://example.com/articles/workflow-notes?ref=duplicate"
    });

    expect(second.id).toBe(first.id);
    await expect(db.listSignals()).resolves.toHaveLength(1);
  });

  it("analyzeSignal persists structured analysis and AgentRun traces for a GitHub signal", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    const providerRouter = new ProviderRouter(registry, {
      mode: "mock",
      textProvider: "mock-text",
      fallbackEnabled: true
    });
    const executionPolicyRouter = new ExecutionPolicyRouter({
      modelAssignments: {
        ...createModelAssignmentConfigFromEnv({}),
        openAI: {
          providerName: "mock-text",
          model: "mock-openai-tier"
        }
      },
      taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
      availability: {
        localMiraiAvailable: true,
        openAIAvailable: true
      }
    });
    orchestrator = new OrchestratorService({
      db,
      providerRouter,
      executionPolicyRouter
    });
    const signal = await orchestrator.ingestSignal({
      title: "Retry ownership repo",
      sourceType: "github_repo",
      rawText: "README covers queue visibility, retry state, and operator recovery."
    });

    const result = await orchestrator.analyzeSignal(signal.id);
    const analyses = await db.listSignalAnalysesBySignalId(signal.id);
    const agentRuns = await db.listAgentRuns();

    expect(result.analysis).toEqual(
      expect.objectContaining({
        signalId: signal.id,
        relevanceScore: expect.any(Number),
        whyRelevant: expect.stringContaining("Retry ownership repo"),
        targetAudience: expect.any(String),
        businessValueSummary: expect.any(String),
        painsSolved: expect.any(Array),
        practicalImplications: expect.any(Array),
        recommendedPillar: expect.any(String),
        uniquenessScore: expect.any(Number),
        buildabilityScore: expect.any(Number),
        popularityPotentialScore: expect.any(Number),
        brandGrowthPotentialScore: expect.any(Number)
      })
    );
    expect(analyses).toEqual([result.analysis]);
    expect(agentRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          signalId: signal.id,
          agentName: "relevance-agent",
          modelTier: "openai",
          providerName: "mock-text",
          status: "completed"
        }),
        expect.objectContaining({
          signalId: signal.id,
          agentName: "business-translator-agent",
          modelTier: "openai",
          providerName: "mock-text",
          status: "completed"
        })
      ])
    );
  });

  it("analyzeSignal persists structured analysis for an article signal", async () => {
    const executionPolicyRouter = new ExecutionPolicyRouter({
      modelAssignments: {
        ...createModelAssignmentConfigFromEnv({}),
        openAI: {
          providerName: "mock-text",
          model: "mock-openai-tier"
        }
      },
      taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
      availability: {
        localMiraiAvailable: false,
        openAIAvailable: true
      }
    });
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "mock",
        textProvider: "mock-text",
        fallbackEnabled: true
      }),
      executionPolicyRouter
    });
    const signal = await orchestrator.ingestSignal({
      title: "Article on launch accountability",
      sourceType: "article",
      rawText: "Launch accountability matters when handoffs fail and nobody owns recovery."
    });

    const result = await orchestrator.analyzeSignal(signal.id);

    expect(result.analysis.signalId).toBe(signal.id);
    expect(result.analysis.painsSolved).toContain("handoff failures");
    expect(result.analysis.practicalImplications[0]).toEqual(expect.any(String));
  });

  it("analyzeSignal persists structured analysis for a manual note signal", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "mock",
        textProvider: "mock-text",
        fallbackEnabled: true
      }),
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: {
          ...createModelAssignmentConfigFromEnv({}),
          openAI: {
            providerName: "mock-text",
            model: "mock-openai-tier"
          }
        },
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: false,
          openAIAvailable: true
        }
      })
    });
    const signal = await orchestrator.ingestSignal({
      title: "Manual ops note",
      sourceType: "manual_note",
      rawText: "Teams still treat automation like magic instead of queue and exception design."
    });

    const result = await orchestrator.analyzeSignal(signal.id);

    expect(result.analysis.signalId).toBe(signal.id);
    expect(result.analysis.overhypeNotes).toEqual(expect.any(String));
  });

  it("analyzeSignal blocks honestly when OpenAI-required reasoning is unavailable", async () => {
    orchestrator = new OrchestratorService({
      db,
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: createModelAssignmentConfigFromEnv({}),
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: true,
          openAIAvailable: false
        }
      })
    });
    const signal = await orchestrator.ingestSignal({
      title: "Blocked analysis signal",
      sourceType: "article",
      rawText: "A signal that still needs premium reasoning."
    });

    await expect(orchestrator.analyzeSignal(signal.id)).rejects.toBeInstanceOf(
      AnalysisBlockedError
    );
    await expect(db.listSignalAnalysesBySignalId(signal.id)).resolves.toEqual([]);
    await expect(db.listAgentRuns()).resolves.toEqual([
      expect.objectContaining({
        signalId: signal.id,
        agentName: "relevance-agent",
        status: "failed",
        errorMessage: expect.stringContaining("required")
      })
    ]);
  });

  it("positionSignalAndDecide persists positioning, solution memory, and a high-priority decision for a GitHub signal", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "mock",
        textProvider: "mock-text",
        fallbackEnabled: true
      }),
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: {
          ...createModelAssignmentConfigFromEnv({}),
          openAI: {
            providerName: "mock-text",
            model: "mock-openai-tier"
          }
        },
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: false,
          openAIAvailable: true
        }
      })
    });
    const signal = await orchestrator.ingestSignal({
      title: "Workflow accountability repo",
      sourceType: "github_repo",
      rawText:
        "TypeScript repo adds queue visibility, ownership tracking, retry state, and approval recovery."
    });
    const analyzed = await orchestrator.analyzeSignal(signal.id);

    const result = await orchestrator.positionSignalAndDecide(signal.id);

    expect(result.analysis.id).toBe(analyzed.analysis.id);
    expect(result.analysis.bestAngle).toEqual(expect.any(String));
    expect(result.analysis.alternativeAnglesJson?.length).toBeGreaterThan(0);
    expect(result.analysis.recommendedFormat).toBe("long_linkedin_post");
    expect(result.analysis.audienceEmphasis).toEqual(expect.any(String));
    expect(result.solutionMemory).toEqual(
      expect.objectContaining({
        signalId: signal.id,
        implementationPotential: "high",
        implementationComplexity: "medium",
        possibleUseCases: expect.any(Array),
        repoReference: expect.any(String)
      })
    );
    expect(result.decision).toEqual(
      expect.objectContaining({
        signalId: signal.id,
        decisionType: expect.stringMatching(
          /^(high_priority_candidate|solution_candidate)$/
        ),
        decisionReason: expect.any(String),
        confidenceScore: expect.any(Number),
        nextAction: expect.any(String),
        requiresHumanReview: true
      })
    );
    expect(result.agentRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentName: "positioning-agent",
          modelTier: "openai",
          providerName: "mock-text"
        }),
        expect.objectContaining({
          agentName: "solution-memory-enrichment",
          modelTier: "deterministic"
        })
      ])
    );
  });

  it("positionSignalAndDecide enriches article signals into content candidates", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "mock",
        textProvider: "mock-text",
        fallbackEnabled: true
      }),
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: {
          ...createModelAssignmentConfigFromEnv({}),
          openAI: {
            providerName: "mock-text",
            model: "mock-openai-tier"
          }
        },
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: false,
          openAIAvailable: true
        }
      })
    });
    const signal = await orchestrator.ingestSignal({
      title: "Article on launch accountability",
      sourceType: "article",
      rawText: "Launch accountability matters when handoffs fail and operators need clearer ownership."
    });
    await orchestrator.analyzeSignal(signal.id);

    const result = await orchestrator.positionSignalAndDecide(signal.id);

    expect(result.analysis.bestAngle).toEqual(expect.any(String));
    expect(result.solutionMemory.clientFitTypes.length).toBeGreaterThan(0);
    expect(result.decision.decisionType).not.toBe("discard");
  });

  it("positionSignalAndDecide positions a manual note and can require manual review", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "mock",
        textProvider: "mock-text",
        fallbackEnabled: true
      }),
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: {
          ...createModelAssignmentConfigFromEnv({}),
          openAI: {
            providerName: "mock-text",
            model: "mock-openai-tier"
          }
        },
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: false,
          openAIAvailable: true
        }
      })
    });
    const signal = await orchestrator.ingestSignal({
      title: "Manual founder note",
      sourceType: "manual_note",
      rawText: "A founder wants better automation, but the note is still vague on real workflow design."
    });
    await orchestrator.analyzeSignal(signal.id);

    const result = await orchestrator.positionSignalAndDecide(signal.id);

    expect(result.analysis.toneGuidance).toEqual(expect.any(String));
    expect(result.decision.decisionType).toMatch(
      /^(content_candidate|manual_review_required|archive)$/
    );
  });

  it("positionSignalAndDecide blocks honestly when premium positioning is unavailable", async () => {
    orchestrator = new OrchestratorService({
      db,
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: createModelAssignmentConfigFromEnv({}),
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: true,
          openAIAvailable: false
        }
      })
    });
    const signal = await orchestrator.ingestSignal({
      title: "Blocked positioning signal",
      sourceType: "github_repo",
      rawText: "Queue and approval state needs a strategic angle."
    });
    const analysis = await db.createSignalAnalysis({
      signalId: signal.id,
      relevanceScore: 80,
      whyRelevant: "Strong operator relevance.",
      targetAudience: "Founders and operators",
      businessValueSummary: "Strong content candidate.",
      painsSolved: ["workflow fragility"],
      practicalImplications: ["clarify queue ownership"],
      recommendedPillar: "workflow_accountability",
      uniquenessScore: 72,
      uniquenessReason: "Concrete implementation detail.",
      buildabilityScore: 78,
      buildabilityReason: "Enough implementation clues.",
      popularityPotentialScore: 70,
      brandGrowthPotentialScore: 82
    });

    await expect(orchestrator.positionSignalAndDecide(signal.id)).rejects.toBeInstanceOf(
      AnalysisBlockedError
    );
    await expect(db.listSolutionMemoriesBySignalId(signal.id)).resolves.toEqual([]);
    await expect(db.listOrchestratorDecisions()).resolves.toEqual([]);
    await expect(db.listAgentRuns()).resolves.toEqual([
      expect.objectContaining({
        signalId: signal.id,
        agentName: "positioning-agent",
        status: "failed"
      })
    ]);
    await expect(db.listSignalAnalysesBySignalId(signal.id)).resolves.toEqual([analysis]);
  });

  it("generateContentAssetForSignal persists a canonical content asset for a positioned GitHub signal", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "mock",
        textProvider: "mock-text",
        fallbackEnabled: true
      }),
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: {
          ...createModelAssignmentConfigFromEnv({}),
          openAI: {
            providerName: "mock-text",
            model: "mock-openai-tier"
          }
        },
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: false,
          openAIAvailable: true
        }
      })
    });
    const signal = await orchestrator.ingestSignal({
      title: "Workflow accountability repo",
      sourceType: "github_repo",
      rawText:
        "TypeScript repo adds queue visibility, ownership tracking, retry state, and approval recovery."
    });
    await orchestrator.analyzeSignal(signal.id);
    const positioned = await orchestrator.positionSignalAndDecide(signal.id);

    const result = await orchestrator.generateContentAssetForSignal(signal.id);

    expect(result.contentAsset).toEqual(
      expect.objectContaining({
        signalId: signal.id,
        signalAnalysisId: positioned.analysis.id,
        orchestratorDecisionId: positioned.decision.id,
        bestAngle: expect.any(String),
        recommendedFormat: expect.any(String),
        longPostDraft: expect.any(String),
        shortPostDraft: expect.any(String),
        hooksJson: expect.any(Array),
        commentAnglesJson: expect.any(Array),
        ctaVariantsJson: expect.any(Array),
        contentStatus: "draft",
        publishReadyFlag: false
      })
    );
    expect(result.contentAsset.hooksJson?.length).toBeGreaterThan(1);
    expect(result.agentRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          signalId: signal.id,
          agentName: "content-agent",
          modelTier: "openai",
          providerName: "mock-text",
          status: "completed"
        })
      ])
    );
  });

  it("generateContentAssetForSignal supports article-derived content candidates", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "mock",
        textProvider: "mock-text",
        fallbackEnabled: true
      }),
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: {
          ...createModelAssignmentConfigFromEnv({}),
          openAI: {
            providerName: "mock-text",
            model: "mock-openai-tier"
          }
        },
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: false,
          openAIAvailable: true
        }
      })
    });
    const signal = await orchestrator.ingestSignal({
      title: "Article on launch accountability",
      sourceType: "article",
      rawText:
        "Launch accountability matters when handoffs fail and operators need clearer ownership."
    });
    await orchestrator.analyzeSignal(signal.id);
    await orchestrator.positionSignalAndDecide(signal.id);

    const result = await orchestrator.generateContentAssetForSignal(signal.id);

    expect(result.contentAsset.longPostDraft).toEqual(expect.any(String));
    expect(result.contentAsset.commentAnglesJson?.length).toBeGreaterThan(1);
    expect(result.contentAsset.publishReadyFlag).toBe(false);
  });

  it("generateContentAssetForSignal supports manual-note content candidates", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "mock",
        textProvider: "mock-text",
        fallbackEnabled: true
      }),
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: {
          ...createModelAssignmentConfigFromEnv({}),
          openAI: {
            providerName: "mock-text",
            model: "mock-openai-tier"
          }
        },
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: false,
          openAIAvailable: true
        }
      })
    });
    const signal = await orchestrator.ingestSignal({
      title: "Founder note on automation handoffs",
      sourceType: "manual_note",
      rawText:
        "Operators keep losing trust because the automation path has no clear owner when exceptions hit."
    });
    await orchestrator.analyzeSignal(signal.id);
    await orchestrator.positionSignalAndDecide(signal.id);

    const result = await orchestrator.generateContentAssetForSignal(signal.id);

    expect(result.contentAsset.shortPostDraft).toEqual(expect.any(String));
    expect(result.contentAsset.ctaVariantsJson?.length).toBeGreaterThan(1);
  });

  it("generateContentAssetForSignal blocks honestly when premium content generation is unavailable", async () => {
    orchestrator = new OrchestratorService({
      db,
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: createModelAssignmentConfigFromEnv({}),
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: true,
          openAIAvailable: false
        }
      })
    });
    const signal = await orchestrator.ingestSignal({
      title: "Blocked content signal",
      sourceType: "manual_note",
      rawText: "This needs positioned, premium-quality content generation."
    });
    const analysis = await db.createSignalAnalysis({
      signalId: signal.id,
      relevanceScore: 78,
      whyRelevant: "Strong operator relevance.",
      targetAudience: "Founders and operators",
      businessValueSummary: "Strong content candidate.",
      painsSolved: ["workflow fragility"],
      practicalImplications: ["clarify queue ownership"],
      recommendedPillar: "workflow_accountability",
      uniquenessScore: 64,
      uniquenessReason: "Grounded operator detail.",
      buildabilityScore: 68,
      buildabilityReason: "Enough implementation context.",
      popularityPotentialScore: 66,
      brandGrowthPotentialScore: 74,
      bestAngle: "workflow accountability is the real rollout layer",
      alternativeAnglesJson: ["ownership gap", "handoff failure"],
      recommendedFormat: "long_linkedin_post",
      audienceEmphasis: "Founders and operators",
      toneGuidance: "Direct and grounded",
      recommendedPillarFinal: "workflow_accountability"
    });
    await db.createOrchestratorDecision({
      signalId: signal.id,
      decisionType: "content_candidate",
      decisionReason: "Good enough to draft.",
      confidenceScore: 76,
      nextAction: "queue_for_content_review",
      requiresHumanReview: true
    });

    await expect(orchestrator.generateContentAssetForSignal(signal.id)).rejects.toBeInstanceOf(
      AnalysisBlockedError
    );
    await expect(db.listContentAssets()).resolves.toEqual([]);
    await expect(db.listAgentRuns()).resolves.toEqual([
      expect.objectContaining({
        signalId: signal.id,
        agentName: "content-agent",
        status: "failed",
        errorMessage: expect.stringContaining("required")
      })
    ]);
    await expect(db.listSignalAnalysesBySignalId(signal.id)).resolves.toEqual([analysis]);
  });

  it("reviewContentAsset persists a critic review for a GitHub-derived content asset", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "mock",
        textProvider: "mock-text",
        fallbackEnabled: true
      }),
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: {
          ...createModelAssignmentConfigFromEnv({}),
          openAI: {
            providerName: "mock-text",
            model: "mock-openai-tier"
          }
        },
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: false,
          openAIAvailable: true
        }
      })
    });
    const signal = await orchestrator.ingestSignal({
      title: "Workflow accountability repo",
      sourceType: "github_repo",
      rawText:
        "TypeScript repo adds queue visibility, ownership tracking, retry state, and approval recovery."
    });
    await orchestrator.analyzeSignal(signal.id);
    await orchestrator.positionSignalAndDecide(signal.id);
    const generated = await orchestrator.generateContentAssetForSignal(signal.id);

    const result = await orchestrator.reviewContentAsset(generated.contentAsset.id);

    expect(result.criticReview).toEqual(
      expect.objectContaining({
        contentAssetId: generated.contentAsset.id,
        qualityScore: expect.any(Number),
        genericnessScore: expect.any(Number),
        businessValueScore: expect.any(Number),
        differentiationScore: expect.any(Number),
        publishReadyFlag: expect.any(Boolean),
        rewriteSuggestions: expect.any(Array),
        criticNotes: expect.any(String)
      })
    );
    expect(result.contentAsset).toEqual(
      expect.objectContaining({
        id: generated.contentAsset.id,
        publishReadyFlag: result.criticReview.publishReadyFlag,
        qualityStatus: "reviewed",
        contentStatus: result.criticReview.publishReadyFlag ? "ready" : "review"
      })
    );
    expect(result.agentRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentName: "critic-agent",
          modelTier: "openai",
          providerName: "mock-text",
          status: "completed"
        })
      ])
    );
  });

  it("reviewContentAsset supports article-derived canonical content", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "mock",
        textProvider: "mock-text",
        fallbackEnabled: true
      }),
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: {
          ...createModelAssignmentConfigFromEnv({}),
          openAI: {
            providerName: "mock-text",
            model: "mock-openai-tier"
          }
        },
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: false,
          openAIAvailable: true
        }
      })
    });
    const signal = await orchestrator.ingestSignal({
      title: "Article on launch accountability",
      sourceType: "article",
      rawText:
        "Launch accountability matters when handoffs fail and operators need clearer ownership."
    });
    await orchestrator.analyzeSignal(signal.id);
    await orchestrator.positionSignalAndDecide(signal.id);
    const generated = await orchestrator.generateContentAssetForSignal(signal.id);

    const result = await orchestrator.reviewContentAsset(generated.contentAsset.id);

    expect(result.criticReview.businessValueScore).toBeGreaterThan(0);
    expect(result.criticReview.rewriteSuggestions?.length ?? 0).toBeGreaterThan(0);
  });

  it("reviewContentAsset supports manual-note canonical content", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "mock",
        textProvider: "mock-text",
        fallbackEnabled: true
      }),
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: {
          ...createModelAssignmentConfigFromEnv({}),
          openAI: {
            providerName: "mock-text",
            model: "mock-openai-tier"
          }
        },
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: false,
          openAIAvailable: true
        }
      })
    });
    const signal = await orchestrator.ingestSignal({
      title: "Founder note on automation handoffs",
      sourceType: "manual_note",
      rawText:
        "Operators keep losing trust because the automation path has no clear owner when exceptions hit."
    });
    await orchestrator.analyzeSignal(signal.id);
    await orchestrator.positionSignalAndDecide(signal.id);
    const generated = await orchestrator.generateContentAssetForSignal(signal.id);

    const result = await orchestrator.reviewContentAsset(generated.contentAsset.id);

    expect(result.criticReview.qualityScore).toEqual(expect.any(Number));
    expect(result.criticReview.criticNotes).toEqual(expect.any(String));
  });

  it("reviewContentAsset blocks honestly when premium critic review is unavailable", async () => {
    orchestrator = new OrchestratorService({
      db,
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: createModelAssignmentConfigFromEnv({}),
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: true,
          openAIAvailable: false
        }
      })
    });
    const signal = await orchestrator.ingestSignal({
      title: "Blocked critic signal",
      sourceType: "manual_note",
      rawText: "This needs critic review."
    });
    const analysis = await db.createSignalAnalysis({
      signalId: signal.id,
      relevanceScore: 78,
      whyRelevant: "Strong operator relevance.",
      targetAudience: "Founders and operators",
      businessValueSummary: "Strong content candidate.",
      painsSolved: ["workflow fragility"],
      practicalImplications: ["clarify queue ownership"],
      recommendedPillar: "workflow_accountability",
      uniquenessScore: 64,
      uniquenessReason: "Grounded operator detail.",
      buildabilityScore: 68,
      buildabilityReason: "Enough implementation context.",
      popularityPotentialScore: 66,
      brandGrowthPotentialScore: 74,
      bestAngle: "workflow accountability is the real rollout layer",
      alternativeAnglesJson: ["ownership gap", "handoff failure"],
      recommendedFormat: "long_linkedin_post",
      audienceEmphasis: "Founders and operators",
      toneGuidance: "Direct and grounded",
      recommendedPillarFinal: "workflow_accountability"
    });
    const decision = await db.createOrchestratorDecision({
      signalId: signal.id,
      decisionType: "content_candidate",
      decisionReason: "Good enough to draft.",
      confidenceScore: 76,
      nextAction: "queue_for_content_review",
      requiresHumanReview: true
    });
    const idea = await db.createIdea({
      signalId: signal.id,
      title: "Draft idea",
      coreInsight: "Insight",
      businessRelevance: "Business relevance",
      targetAudience: "Founders and operators",
      status: "draft"
    });
    const content = await db.createContentAsset({
      ideaId: idea.id,
      signalId: signal.id,
      signalAnalysisId: analysis.id,
      orchestratorDecisionId: decision.id,
      contentType: "linkedin-post",
      hook: "The workflow breaks before the model does",
      body: "Operators lose trust when exceptions have no owner.",
      cta: "Compare notes.",
      longPostDraft: "The workflow breaks before the model does.\n\nOperators lose trust when exceptions have no owner.\n\nCompare notes.",
      shortPostDraft: "The workflow breaks before the model does.\n\nOperators lose trust when exceptions have no owner.",
      hooksJson: ["The workflow breaks before the model does"],
      commentAnglesJson: ["Ownership matters more than demo quality"],
      ctaVariantsJson: ["Compare notes."],
      status: "draft",
      contentStatus: "draft",
      publishReadyFlag: false
    });

    await expect(orchestrator.reviewContentAsset(content.id)).rejects.toBeInstanceOf(
      AnalysisBlockedError
    );
    await expect(db.listWritingQualityAssessments()).resolves.toEqual([]);
    await expect(db.listAgentRuns()).resolves.toEqual([
      expect.objectContaining({
        signalId: signal.id,
        agentName: "critic-agent",
        status: "failed",
        errorMessage: expect.stringContaining("required")
      })
    ]);
  });

  it("enqueueCandidateForSignal queues a critic-reviewed content candidate with full traceability", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "mock",
        textProvider: "mock-text",
        fallbackEnabled: true
      }),
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: {
          ...createModelAssignmentConfigFromEnv({}),
          openAI: {
            providerName: "mock-text",
            model: "mock-openai-tier"
          }
        },
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: false,
          openAIAvailable: true
        }
      })
    });
    const signal = await orchestrator.ingestSignal({
      title: "Workflow accountability repo",
      sourceType: "github_repo",
      rawText:
        "TypeScript repo adds queue visibility, ownership tracking, retry state, and approval recovery."
    });
    const analyzed = await orchestrator.analyzeSignal(signal.id);
    const positioned = await orchestrator.positionSignalAndDecide(signal.id);
    const generated = await orchestrator.generateContentAssetForSignal(signal.id);
    const reviewed = await orchestrator.reviewContentAsset(generated.contentAsset.id);

    const queued = await orchestrator.enqueueCandidateForSignal(signal.id);

    expect(queued).toEqual(
      expect.objectContaining({
        signalId: signal.id,
        signalAnalysisId: analyzed.analysis.id,
        contentAssetId: generated.contentAsset.id,
        criticReviewId: reviewed.criticReview.id,
        solutionMemoryId: positioned.solutionMemory.id,
        orchestratorDecisionId: positioned.decision.id,
        candidateType: expect.stringMatching(
          /^(content_candidate|high_priority_candidate|solution_candidate)$/
        ),
        queueState: expect.stringMatching(/^(ready_for_review|ready_for_solution_followup)$/),
        whyQueued: expect.any(String),
        nextAction: expect.any(String)
      })
    );
  });

  it("enqueueCandidateForSignal queues a high-priority candidate", async () => {
    const signal = await db.createSignal({
      title: "High-priority signal",
      sourceType: "manual_note",
      rawText: "Ownership and exception recovery matter more than demo polish."
    });
    const analysis = await db.createSignalAnalysis({
      signalId: signal.id,
      relevanceScore: 88,
      whyRelevant: "Strong operator fit.",
      targetAudience: "Founders and operators",
      businessValueSummary: "Strong content and brand candidate.",
      painsSolved: ["workflow fragility"],
      practicalImplications: ["clarify queue ownership"],
      uniquenessScore: 74,
      uniquenessReason: "Specific operator angle.",
      buildabilityScore: 78,
      buildabilityReason: "Enough implementation detail.",
      popularityPotentialScore: 82,
      brandGrowthPotentialScore: 90,
      bestAngle: "ownership gap after rollout",
      alternativeAnglesJson: ["workflow accountability"],
      recommendedFormat: "long_linkedin_post",
      audienceEmphasis: "Founders and operators",
      toneGuidance: "Direct and grounded",
      recommendedPillarFinal: "workflow_accountability"
    });
    const solutionMemory = await db.createSolutionMemory({
      signalId: signal.id,
      sourceType: "manual_note",
      implementationPotential: "medium",
      implementationComplexity: "low",
      possibleUseCases: ["Operational positioning"]
    });
    const decision = await db.createOrchestratorDecision({
      signalId: signal.id,
      decisionType: "high_priority_candidate",
      decisionReason: "Strong enough to enter the front of the queue.",
      confidenceScore: 88,
      nextAction: "prioritize_for_content",
      requiresHumanReview: true
    });
    const idea = await db.createIdea({
      signalId: signal.id,
      title: "Draft idea",
      coreInsight: "Insight",
      businessRelevance: "Business relevance",
      targetAudience: "Founders and operators",
      status: "draft"
    });
    const content = await db.createContentAsset({
      ideaId: idea.id,
      signalId: signal.id,
      signalAnalysisId: analysis.id,
      orchestratorDecisionId: decision.id,
      contentType: "linkedin-post",
      hook: "The workflow breaks before the model does",
      body: "Operators lose trust when exceptions have no owner.",
      cta: "Compare notes.",
      status: "draft",
      contentStatus: "review",
      publishReadyFlag: false
    });
    const review = await db.createWritingQualityAssessment({
      contentAssetId: content.id,
      humanToneScore: 82,
      clarityScore: 84,
      groundednessScore: 86,
      antiRobotScore: 88,
      overallScore: 85,
      notes: ["Strong draft"],
      qualityScore: 86,
      genericnessScore: 20,
      businessValueScore: 84,
      differentiationScore: 82,
      publishReadyFlag: false,
      rewriteSuggestions: ["Tighten one paragraph."],
      criticNotes: "Strong but still needs review."
    });

    const queued = await orchestrator.enqueueCandidateForSignal(signal.id);

    expect(solutionMemory.id).toBeDefined();
    expect(review.id).toBeDefined();
    expect(queued.candidateType).toBe("high_priority_candidate");
    expect(queued.queueState).toBe("ready_for_review");
    expect(queued.priorityLabel).toBe("high");
  });

  it("enqueueCandidateForSignal queues a solution candidate", async () => {
    const signal = await db.createSignal({
      title: "Solution signal",
      sourceType: "github_repo",
      rawText: "Repo documents exception ownership, queue visibility, and deployment safeguards."
    });
    const analysis = await db.createSignalAnalysis({
      signalId: signal.id,
      relevanceScore: 72,
      whyRelevant: "Useful for practical founder content.",
      targetAudience: "Founders and operators",
      businessValueSummary: "Good solution candidate.",
      painsSolved: ["rollout opacity"],
      practicalImplications: ["show queue state"],
      uniquenessScore: 68,
      uniquenessReason: "Specific implementation clues.",
      buildabilityScore: 82,
      buildabilityReason: "Strong implementation detail.",
      popularityPotentialScore: 58,
      brandGrowthPotentialScore: 70
    });
    const solutionMemory = await db.createSolutionMemory({
      signalId: signal.id,
      sourceType: "github_repo",
      implementationPotential: "high",
      implementationComplexity: "medium",
      possibleUseCases: ["Client implementation reuse"],
      repoReference: "https://github.com/example/repo"
    });
    const decision = await db.createOrchestratorDecision({
      signalId: signal.id,
      decisionType: "solution_candidate",
      decisionReason: "Strong implementation reuse value.",
      confidenceScore: 79,
      nextAction: "save_solution_memory",
      requiresHumanReview: true
    });

    const queued = await orchestrator.enqueueCandidateForSignal(signal.id);

    expect(analysis.id).toBeDefined();
    expect(solutionMemory.id).toBeDefined();
    expect(queued.candidateType).toBe("solution_candidate");
    expect(queued.queueState).toBe("ready_for_solution_followup");
    expect(queued.solutionMemoryId).toBe(solutionMemory.id);
  });

  it("enqueueCandidateForSignal queues a manual-review-required candidate", async () => {
    const signal = await db.createSignal({
      title: "Manual review signal",
      sourceType: "manual_note",
      rawText: "Mixed signal with unclear direction."
    });
    const analysis = await db.createSignalAnalysis({
      signalId: signal.id,
      relevanceScore: 58,
      whyRelevant: "Some fit, but mixed signal.",
      targetAudience: "Founders and operators",
      businessValueSummary: "Needs more judgment.",
      painsSolved: ["unclear workflow"],
      practicalImplications: ["decide whether the angle is public-facing"],
      uniquenessScore: 55,
      uniquenessReason: "Not differentiated yet.",
      buildabilityScore: 51,
      buildabilityReason: "Needs more evidence.",
      popularityPotentialScore: 48,
      brandGrowthPotentialScore: 54
    });
    const decision = await db.createOrchestratorDecision({
      signalId: signal.id,
      decisionType: "manual_review_required",
      decisionReason: "Mixed content and solution value.",
      confidenceScore: 61,
      nextAction: "request_manual_review",
      requiresHumanReview: true
    });

    const queued = await orchestrator.enqueueCandidateForSignal(signal.id);

    expect(analysis.id).toBeDefined();
    expect(decision.id).toBeDefined();
    expect(queued.candidateType).toBe("manual_review_required");
    expect(queued.queueState).toBe("manual_review_queue");
    expect(queued.requiresHumanReview).toBe(true);
  });

  it("enqueueCandidateForSignal rejects invalid queueing when required upstream records are missing", async () => {
    const signal = await db.createSignal({
      title: "Incomplete signal",
      sourceType: "manual_note",
      rawText: "No analysis or decision yet."
    });

    await expect(orchestrator.enqueueCandidateForSignal(signal.id)).rejects.toBeInstanceOf(
      NotFoundError
    );
    await expect(db.listCandidateQueueItems()).resolves.toEqual([]);
  });

  it("getCandidateQueueItemDetail returns the joined review context for a content candidate", async () => {
    const signal = await db.createSignal({
      title: "Workflow accountability repo",
      sourceType: "github_repo",
      rawText: "Queue visibility and exception handling matter after rollout."
    });
    const analysis = await db.createSignalAnalysis({
      signalId: signal.id,
      relevanceScore: 84,
      whyRelevant: "Strong operator fit.",
      targetAudience: "Founders and operators",
      businessValueSummary: "Useful for authority-building content.",
      painsSolved: ["invisible queue failures"],
      practicalImplications: ["make handoffs visible"],
      uniquenessScore: 78,
      uniquenessReason: "Grounded implementation angle.",
      buildabilityScore: 76,
      buildabilityReason: "Concrete workflow context.",
      popularityPotentialScore: 72,
      brandGrowthPotentialScore: 83,
      bestAngle: "ownership gap after rollout",
      audienceEmphasis: "Operators responsible for production workflow outcomes"
    });
    const decision = await db.createOrchestratorDecision({
      signalId: signal.id,
      decisionType: "content_candidate",
      decisionReason: "Strong enough for a draft review lane.",
      confidenceScore: 81,
      nextAction: "queue_for_content_review",
      requiresHumanReview: true
    });
    const idea = await db.createIdea({
      signalId: signal.id,
      title: "Draft idea",
      coreInsight: "Workflow trust breaks when nobody owns the exception path.",
      businessRelevance: "Operators need stronger review handoff.",
      targetAudience: "Founders and operators",
      status: "draft"
    });
    const content = await db.createContentAsset({
      ideaId: idea.id,
      signalId: signal.id,
      signalAnalysisId: analysis.id,
      orchestratorDecisionId: decision.id,
      contentType: "linkedin-post",
      hook: "The workflow breaks before the model does",
      body: "If nobody owns the queue after launch, your AI rollout stays fragile.",
      cta: "Compare notes.",
      bestAngle: "ownership gap after rollout",
      longPostDraft: "Long draft body",
      shortPostDraft: "Short draft body",
      status: "draft",
      contentStatus: "review",
      publishReadyFlag: false
    });
    const criticReview = await db.createWritingQualityAssessment({
      contentAssetId: content.id,
      humanToneScore: 82,
      clarityScore: 84,
      groundednessScore: 86,
      antiRobotScore: 88,
      overallScore: 85,
      notes: ["Strong draft"],
      qualityScore: 84,
      genericnessScore: 18,
      businessValueScore: 83,
      differentiationScore: 79,
      publishReadyFlag: false,
      rewriteSuggestions: ["Make the CTA more specific."],
      criticNotes: "Strong operator angle, but the close is still generic."
    });
    const candidate = await db.createCandidateQueueItem({
      signalId: signal.id,
      signalAnalysisId: analysis.id,
      contentAssetId: content.id,
      criticReviewId: criticReview.id,
      orchestratorDecisionId: decision.id,
      candidateType: "content_candidate",
      queueState: "ready_for_review",
      priorityScore: 81,
      priorityLabel: "high",
      whyQueued: "Ready for supervised review.",
      nextAction: "review_content_candidate",
      requiresHumanReview: true
    });

    const detail = await orchestrator.getCandidateQueueItemDetail(candidate.id);

    expect(detail).toEqual(
      expect.objectContaining({
        candidate: expect.objectContaining({ id: candidate.id }),
        signal: expect.objectContaining({ id: signal.id }),
        signalAnalysis: expect.objectContaining({ id: analysis.id }),
        contentAsset: expect.objectContaining({ id: content.id }),
        criticReview: expect.objectContaining({ id: criticReview.id }),
        orchestratorDecision: expect.objectContaining({ id: decision.id })
      })
    );
  });

  it("applyCandidateQueueOperatorAction updates candidate and content state for approval, revision, and archive", async () => {
    const signal = await db.createSignal({
      title: "Approval signal",
      sourceType: "manual_note",
      rawText: "Queue state should respond to operator review actions."
    });
    const analysis = await db.createSignalAnalysis({
      signalId: signal.id,
      relevanceScore: 80,
      whyRelevant: "Review flow signal.",
      targetAudience: "Operators",
      businessValueSummary: "Makes the product usable.",
      painsSolved: ["orphaned drafts"],
      practicalImplications: ["turn review into explicit states"],
      uniquenessScore: 74,
      uniquenessReason: "Concrete review workflow.",
      buildabilityScore: 79,
      buildabilityReason: "The persistence seam already exists.",
      popularityPotentialScore: 68,
      brandGrowthPotentialScore: 82
    });
    const decision = await db.createOrchestratorDecision({
      signalId: signal.id,
      decisionType: "content_candidate",
      decisionReason: "Content should enter human review.",
      confidenceScore: 79,
      nextAction: "queue_for_content_review",
      requiresHumanReview: true
    });
    const idea = await db.createIdea({
      signalId: signal.id,
      title: "Reviewable idea",
      coreInsight: "The queue needs explicit operator outcomes.",
      businessRelevance: "Review without actions is dead-end UI.",
      targetAudience: "Operators",
      status: "draft"
    });
    const content = await db.createContentAsset({
      ideaId: idea.id,
      signalId: signal.id,
      signalAnalysisId: analysis.id,
      orchestratorDecisionId: decision.id,
      contentType: "linkedin-post",
      hook: "Draft hook",
      body: "Draft body",
      cta: "Draft CTA",
      status: "draft",
      contentStatus: "review",
      publishReadyFlag: false
    });
    const candidate = await db.createCandidateQueueItem({
      signalId: signal.id,
      signalAnalysisId: analysis.id,
      contentAssetId: content.id,
      orchestratorDecisionId: decision.id,
      candidateType: "content_candidate",
      queueState: "ready_for_review",
      priorityScore: 79,
      priorityLabel: "high",
      whyQueued: "Ready for review.",
      nextAction: "review_content_candidate",
      requiresHumanReview: true
    });

    const revision = await orchestrator.applyCandidateQueueOperatorAction(candidate.id, {
      action: "mark_needs_revision",
      operatorNote: "Make the hook less generic."
    });
    expect(revision.candidate.queueState).toBe("revision_requested");
    expect(revision.candidate.operatorNote).toBe("Make the hook less generic.");
    expect(revision.contentAsset?.contentStatus).toBe("review");
    expect(revision.contentAsset?.publishReadyFlag).toBe(false);

    const approved = await orchestrator.applyCandidateQueueOperatorAction(candidate.id, {
      action: "approve_for_publication"
    });
    expect(approved.candidate.queueState).toBe("ready_to_publish");
    expect(approved.candidate.requiresHumanReview).toBe(false);
    expect(approved.contentAsset?.contentStatus).toBe("ready");
    expect(approved.contentAsset?.publishReadyFlag).toBe(true);

    const archived = await orchestrator.applyCandidateQueueOperatorAction(candidate.id, {
      action: "archive_candidate"
    });
    expect(archived.candidate.queueState).toBe("archived");
    expect(archived.contentAsset?.contentStatus).toBe("archived");
  });

  it("runAutonomousSignalPipeline completes a GitHub signal and hands it off to the candidate queue", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "mock",
        textProvider: "mock-text",
        fallbackEnabled: true
      }),
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: {
          ...createModelAssignmentConfigFromEnv({}),
          openAI: {
            providerName: "mock-text",
            model: "mock-openai-tier"
          }
        },
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: false,
          openAIAvailable: true
        }
      })
    });

    const signal = await orchestrator.ingestSignal({
      title: "Workflow accountability repo",
      sourceType: "github_repo",
      rawText:
        "TypeScript repo adds queue visibility, retry ownership, approval recovery, and exception handling for operator workflows."
    });

    const result = await orchestrator.runAutonomousSignalPipeline(signal.id);

    expect(result.run).toEqual(
      expect.objectContaining({
        signalId: signal.id,
        runType: "signal_pipeline",
        status: "completed",
        resultMetadata: expect.objectContaining({
          stagesCompleted: expect.arrayContaining([
            "analyze_signal",
            "position_signal_and_decide",
            "enqueue_candidate"
          ]),
          producedSignalAnalysisId: expect.any(String),
          producedCandidateQueueItemId: expect.any(String)
        })
      })
    );
    expect(result.analysis?.signalId).toBe(signal.id);
    expect(result.decision?.decisionType).toMatch(
      /^(solution_candidate|high_priority_candidate|manual_review_required)$/
    );
    expect(result.candidateQueueItem?.signalId).toBe(signal.id);
  });

  it("runAutonomousSignalPipeline completes an article signal through critic review and queue handoff", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "mock",
        textProvider: "mock-text",
        fallbackEnabled: true
      }),
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: {
          ...createModelAssignmentConfigFromEnv({}),
          openAI: {
            providerName: "mock-text",
            model: "mock-openai-tier"
          }
        },
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: false,
          openAIAvailable: true
        }
      })
    });

    const signal = await orchestrator.ingestSignal({
      title: "Article on approval-state visibility",
      sourceType: "article",
      rawText:
        "Article explains why founders and operators care about approval-state visibility, retry ownership, queue telemetry, revenue leakage, and ROI after workflow automation rollout."
    });

    const result = await orchestrator.runAutonomousSignalPipeline(signal.id);

    expect(result.run.status).toBe("completed");
    expect(result.contentAsset?.recommendedFormat).toEqual(expect.any(String));
    expect(result.criticReview?.qualityScore).toEqual(expect.any(Number));
    expect(result.candidateQueueItem?.candidateType).toMatch(
      /^(content_candidate|high_priority_candidate|solution_candidate)$/
    );
  });

  it("runAutonomousSignalPipeline completes a manual-note signal when the full premium path is available", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "mock",
        textProvider: "mock-text",
        fallbackEnabled: true
      }),
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: {
          ...createModelAssignmentConfigFromEnv({}),
          openAI: {
            providerName: "mock-text",
            model: "mock-openai-tier"
          }
        },
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: false,
          openAIAvailable: true
        }
      })
    });

    const signal = await orchestrator.ingestSignal({
      title: "Manual ops note",
      sourceType: "manual_note",
      rawText:
        "Founders and operators trust automation when queues expose ownership, retries, exception handling, ROI, and revenue impact instead of hiding them."
    });

    const result = await orchestrator.runAutonomousSignalPipeline(signal.id);

    expect(result.run.status).toBe("completed");
    expect(result.analysis?.businessValueSummary).toEqual(expect.any(String));
    expect(result.decision?.decisionType).toMatch(
      /^(content_candidate|high_priority_candidate|solution_candidate)$/
    );
  });

  it("runAutonomousSignalPipeline completes through the real premium provider path when OpenAI is configured", async () => {
    const premiumFetch = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: Array<{ role: string; content: string }>;
      };
      const prompt = body.messages?.map((item) => item.content).join("\n") ?? "";

      const content = prompt.includes("BEST_ANGLE") || prompt.includes("RECOMMENDED_PILLAR_FINAL")
        ? {
            bestAngle: "ownership_gap",
            alternativeAnglesJson: ["workflow_accountability", "operational_roi"],
            recommendedFormat: "long_linkedin_post",
            audienceEmphasis: "Founders and operators managing workflow accountability.",
            toneGuidance: "Direct, specific, and grounded.",
            recommendedPillarFinal: "workflow_accountability"
          }
        : prompt.includes("QUALITY_SIGNAL") || prompt.includes("GENERICNESS_RISK")
          ? {
              qualitySignal: "strong",
              genericnessRisk: "low",
              businessValueSignal: "strong",
              differentiationSignal: "strong",
              publishReadyHint: true,
              rewriteSuggestions: [],
              criticNotes: "Grounded in queue ownership and operator consequence."
            }
          : prompt.includes("hook") || prompt.includes("HOOK")
            ? {
                hook: "The rollout breaks where ownership disappears.",
                body: "The source matters because queue visibility without ownership just makes failure easier to observe. Strong systems pair visibility with retry ownership and clear exception handling.",
                cta: "If this pattern is showing up in your workflow, compare notes."
              }
            : {
                title: "Queue ownership is the business layer",
                coreInsight: "The signal matters because workflow accountability determines whether automation survives contact with real operations.",
                businessRelevance:
                  "Translate the source into execution risk, retry ownership, and rollout clarity for founders and operators.",
                targetAudience: "Founders and operators"
              };

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(content)
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    });
    const registry = new ProviderRegistry();
    registry.registerTextProvider(
      new StrongTextProvider(
        {
          apiKey: "test-openai-key",
          model: "gpt-4.1-mini"
        },
        { fetchImpl: premiumFetch }
      )
    );

    orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "external",
        textProvider: "strong-text",
        fallbackEnabled: true
      }),
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: createModelAssignmentConfigFromEnv({
          OPENAI_API_KEY: "test-openai-key",
          OPENAI_TEXT_MODEL: "gpt-4.1-mini"
        }),
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: false,
          openAIAvailable: true
        }
      })
    });

    const signal = await orchestrator.ingestSignal({
      title: "Premium provider path signal",
      sourceType: "article",
      rawText:
        "Article explains why founders and operators should turn queue ownership, exception handling, approval recovery, and rollout ROI into differentiated LinkedIn authority content instead of generic AI commentary."
    });

    const result = await orchestrator.runAutonomousSignalPipeline(signal.id);

    expect(result.run.status).toBe("completed");
    expect(result.analysis?.signalId).toBe(signal.id);
    expect(result.contentAsset?.longPostDraft).toContain("queue visibility");
    expect(result.contentAsset?.qualityStatus).toBe("reviewed");
    expect(result.criticReview?.publishReadyFlag).toBe(true);
    expect(result.candidateQueueItem?.signalId).toBe(signal.id);
    expect(result.candidateQueueItem?.criticReviewId).toBe(result.criticReview?.id);
    expect(premiumFetch).toHaveBeenCalled();
  });

  it("runAutonomousSignalPipeline returns a useful partial outcome when critic provider execution fails after content generation", async () => {
    class CriticFailingProvider extends MockTextProvider {
      override async reviewContentAsset(
        _input: Parameters<MockTextProvider["reviewContentAsset"]>[0]
      ): ReturnType<MockTextProvider["reviewContentAsset"]> {
        throw new Error("critic transport returned malformed JSON");
      }
    }

    const registry = new ProviderRegistry();
    registry.registerTextProvider(new CriticFailingProvider());
    orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "mock",
        textProvider: "mock-text",
        fallbackEnabled: true
      }),
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: {
          ...createModelAssignmentConfigFromEnv({}),
          openAI: {
            providerName: "mock-text",
            model: "mock-openai-tier"
          }
        },
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: false,
          openAIAvailable: true
        }
      })
    });

    const signal = await orchestrator.ingestSignal({
      title: "Critic transport failure signal",
      sourceType: "manual_note",
      rawText:
        "Founders and operators need queue ownership, exception handling, ROI, and revenue visibility to trust automation after launch."
    });

    const result = await orchestrator.runAutonomousSignalPipeline(signal.id);

    expect(result.run.status).toBe("partial");
    expect(result.run.resultMetadata?.stagesCompleted).toEqual([
      "analyze_signal",
      "position_signal_and_decide",
      "generate_content_asset",
      "enqueue_candidate"
    ]);
    expect(result.run.resultMetadata?.stagesBlocked).toEqual(["review_content_asset"]);
    expect(result.run.errorSummary).toContain("Critic review provider execution failed");
    expect(result.contentAsset?.id).toBeTruthy();
    expect(result.criticReview).toBeUndefined();
    expect(result.candidateQueueItem).toEqual(
      expect.objectContaining({
        signalId: signal.id,
        contentAssetId: result.contentAsset?.id,
        candidateType: "content_candidate",
        queueState: "ready_for_review",
        nextAction: "review_content_candidate"
      })
    );
    expect(result.candidateQueueItem?.criticReviewId).toBeUndefined();
    expect(result.candidateQueueItem?.whyQueued).toContain("critic review is still pending");
  });

  it("runAutonomousSignalPipeline enqueues a review-needed candidate when critic review blocks after content generation", async () => {
    orchestrator = new OrchestratorService({
      db,
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: createModelAssignmentConfigFromEnv({}),
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: false,
          openAIAvailable: true
        }
      })
    });

    const signal = await orchestrator.ingestSignal({
      title: "Critic blocked after content signal",
      sourceType: "manual_note",
      rawText:
        "Content can be generated but the critic stage still needs a live premium reviewer."
    });

    vi.spyOn(orchestrator, "analyzeSignal").mockResolvedValueOnce({
      analysis: await db.createSignalAnalysis({
        signalId: signal.id,
        relevanceScore: 81,
        whyRelevant: "Useful content candidate.",
        targetAudience: "Operators",
        businessValueSummary: "Worth reviewing even if critic is blocked.",
        painsSolved: ["missing review continuity"],
        practicalImplications: ["human review should still see the generated draft"],
        uniquenessScore: 67,
        uniquenessReason: "Specific operator framing.",
        buildabilityScore: 78,
        buildabilityReason: "Already generated.",
        popularityPotentialScore: 63,
        brandGrowthPotentialScore: 74
      }),
      agentRuns: []
    });
    vi.spyOn(orchestrator, "positionSignalAndDecide").mockResolvedValueOnce({
      analysis: await db.createSignalAnalysis({
        signalId: signal.id,
        relevanceScore: 81,
        whyRelevant: "Useful content candidate.",
        targetAudience: "Operators",
        businessValueSummary: "Worth reviewing even if critic is blocked.",
        painsSolved: ["missing review continuity"],
        practicalImplications: ["human review should still see the generated draft"],
        uniquenessScore: 67,
        uniquenessReason: "Specific operator framing.",
        buildabilityScore: 78,
        buildabilityReason: "Already generated.",
        popularityPotentialScore: 63,
        brandGrowthPotentialScore: 74,
        bestAngle: "review continuity matters after generation",
        recommendedFormat: "long_linkedin_post",
        recommendedPillarFinal: "workflow_accountability"
      }),
      solutionMemory: await db.createSolutionMemory({
        signalId: signal.id,
        sourceType: "manual_note",
        implementationPotential: "medium",
        implementationComplexity: "low",
        possibleUseCases: ["Supervised review handoff"]
      }),
      decision: await db.createOrchestratorDecision({
        signalId: signal.id,
        decisionType: "content_candidate",
        decisionReason: "Generated content should still reach human review.",
        confidenceScore: 77,
        nextAction: "queue_for_content_review",
        requiresHumanReview: true
      }),
      agentRuns: []
    });
    vi.spyOn(orchestrator, "generateContentAssetForSignal").mockResolvedValueOnce({
      contentAsset: await db.createContentAsset({
        ideaId: "idea-critic-block",
        signalId: signal.id,
        signalAnalysisId: (await db.listSignalAnalysesBySignalId(signal.id))[0]!.id,
        orchestratorDecisionId: (await db.listOrchestratorDecisions())[0]!.id,
        contentType: "linkedin-post",
        hook: "The draft exists.",
        body: "Content should not disappear just because critic review blocks.",
        cta: "Review the draft.",
        bestAngle: "review continuity matters after generation",
        longPostDraft: "Generated content should still move into a review lane.",
        shortPostDraft: "Queue the draft anyway.",
        status: "draft"
      }),
      agentRuns: []
    });
    vi.spyOn(orchestrator, "reviewContentAsset").mockRejectedValueOnce(
      new AnalysisBlockedError("Premium critic review is required and no acceptable fallback is configured.")
    );

    const result = await orchestrator.runAutonomousSignalPipeline(signal.id);

    expect(result.run.status).toBe("partial");
    expect(result.contentAsset?.id).toBeTruthy();
    expect(result.candidateQueueItem).toEqual(
      expect.objectContaining({
        signalId: signal.id,
        contentAssetId: result.contentAsset?.id,
        candidateType: "content_candidate",
        queueState: "ready_for_review",
        nextAction: "review_content_candidate"
      })
    );
    expect(result.candidateQueueItem?.criticReviewId).toBeUndefined();
  });

  it("runAutonomousSignalPipeline returns a partial outcome when decisioning intentionally stops before content", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "mock",
        textProvider: "mock-text",
        fallbackEnabled: true
      }),
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: {
          ...createModelAssignmentConfigFromEnv({}),
          openAI: {
            providerName: "mock-text",
            model: "mock-openai-tier"
          }
        },
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: false,
          openAIAvailable: true
        }
      })
    });

    const signal = await orchestrator.ingestSignal({
      title: "Archive candidate",
      sourceType: "manual_note",
      rawText: "Weak directional note."
    });

    vi.spyOn(orchestrator, "positionSignalAndDecide").mockResolvedValueOnce({
      analysis: await db.createSignalAnalysis({
        signalId: signal.id,
        relevanceScore: 42,
        whyRelevant: "Only directionally relevant.",
        targetAudience: "Founders and operators",
        businessValueSummary: "Not strong enough for active content work.",
        painsSolved: ["vague workflow concern"],
        practicalImplications: ["archive unless stronger evidence appears"],
        uniquenessScore: 40,
        uniquenessReason: "Not differentiated enough.",
        buildabilityScore: 44,
        buildabilityReason: "Weak implementation detail.",
        popularityPotentialScore: 35,
        brandGrowthPotentialScore: 41
      }),
      solutionMemory: await db.createSolutionMemory({
        signalId: signal.id,
        sourceType: "manual_note",
        implementationPotential: "low",
        implementationComplexity: "low",
        possibleUseCases: ["Background note only"]
      }),
      decision: await db.createOrchestratorDecision({
        signalId: signal.id,
        decisionType: "archive",
        decisionReason: "Not strong enough to continue into content.",
        confidenceScore: 67,
        nextAction: "archive_signal",
        requiresHumanReview: false
      }),
      agentRuns: []
    });

    const result = await orchestrator.runAutonomousSignalPipeline(signal.id);

    expect(result.run.status).toBe("partial");
    expect(result.run.resultMetadata?.stagesCompleted).toEqual([
      "analyze_signal",
      "position_signal_and_decide"
    ]);
    expect(result.contentAsset).toBeUndefined();
    expect(result.candidateQueueItem).toBeUndefined();
  });

  it("runAutonomousSignalPipeline returns a blocked outcome when premium analysis is unavailable", async () => {
    orchestrator = new OrchestratorService({
      db,
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: createModelAssignmentConfigFromEnv({}),
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: true,
          openAIAvailable: false
        }
      })
    });

    const signal = await orchestrator.ingestSignal({
      title: "Blocked premium signal",
      sourceType: "manual_note",
      rawText: "Premium reasoning is unavailable here."
    });

    const result = await orchestrator.runAutonomousSignalPipeline(signal.id);

    expect(result.run.status).toBe("blocked");
    expect(result.run.resultMetadata?.stagesBlocked).toEqual(["analyze_signal"]);
    expect(result.run.errorSummary).toContain("required");
  });

  it("runAutonomousSignalPipeline returns a failed outcome when a hard runtime error occurs", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "mock",
        textProvider: "mock-text",
        fallbackEnabled: true
      }),
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: {
          ...createModelAssignmentConfigFromEnv({}),
          openAI: {
            providerName: "mock-text",
            model: "mock-openai-tier"
          }
        },
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: false,
          openAIAvailable: true
        }
      })
    });

    const signal = await orchestrator.ingestSignal({
      title: "Failure path signal",
      sourceType: "manual_note",
      rawText:
        "Founders and operators need queue ownership, approval recovery, ROI, and revenue visibility to trust automation after launch."
    });

    vi.spyOn(orchestrator, "positionSignalAndDecide").mockResolvedValueOnce({
      analysis: await db.createSignalAnalysis({
        signalId: signal.id,
        relevanceScore: 79,
        whyRelevant: "Strong content candidate.",
        targetAudience: "Founders and operators",
        businessValueSummary: "Strong operational content opportunity.",
        painsSolved: ["workflow fragility"],
        practicalImplications: ["show ROI and queue ownership"],
        uniquenessScore: 74,
        uniquenessReason: "Specific operational framing.",
        buildabilityScore: 70,
        buildabilityReason: "Enough implementation detail.",
        popularityPotentialScore: 73,
        brandGrowthPotentialScore: 81,
        bestAngle: "ownership gap after rollout",
        alternativeAnglesJson: ["workflow accountability"],
        recommendedFormat: "long_linkedin_post",
        audienceEmphasis: "Founders and operators",
        toneGuidance: "Direct and grounded",
        recommendedPillarFinal: "workflow_accountability"
      }),
      solutionMemory: await db.createSolutionMemory({
        signalId: signal.id,
        sourceType: "manual_note",
        implementationPotential: "medium",
        implementationComplexity: "medium",
        possibleUseCases: ["Content-first operational guidance"]
      }),
      decision: await db.createOrchestratorDecision({
        signalId: signal.id,
        decisionType: "content_candidate",
        decisionReason: "Strong enough to continue into content.",
        confidenceScore: 82,
        nextAction: "queue_for_content_review",
        requiresHumanReview: true
      }),
      agentRuns: []
    });
    vi.spyOn(orchestrator, "generateContentAssetForSignal").mockRejectedValueOnce(
      new Error("content generator exploded")
    );

    const result = await orchestrator.runAutonomousSignalPipeline(signal.id);

    expect(result.run.status).toBe("failed");
    expect(result.run.resultMetadata?.stagesFailed).toEqual(["generate_content_asset"]);
    expect(result.run.errorSummary).toBe("content generator exploded");
  });

  it("tickAutonomousScheduler processes a bounded batch of new signals through the autonomous pipeline", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "mock",
        textProvider: "mock-text",
        fallbackEnabled: true
      }),
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: {
          ...createModelAssignmentConfigFromEnv({}),
          openAI: {
            providerName: "mock-text",
            model: "mock-openai-tier"
          }
        },
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: false,
          openAIAvailable: true
        }
      })
    });

    const first = await orchestrator.ingestSignal({
      title: "Scheduler signal one",
      sourceType: "manual_note",
      rawText: "Queue visibility, ownership, and retries improve operator trust."
    });
    const second = await orchestrator.ingestSignal({
      title: "Scheduler signal two",
      sourceType: "article",
      rawText: "Article covers approval recovery and exception handling after rollout."
    });

    const tick = await orchestrator.tickAutonomousScheduler("2026-03-16T00:00:00.000Z");

    expect(tick.processedSignalIds).toEqual([first.id, second.id]);
    expect(
      tick.runs.filter((run) => run.runType === "signal_pipeline").map((run) => run.signalId)
    ).toEqual([first.id, second.id]);
  });

  it("tickAutonomousScheduler auto-promotes high-confidence write_post opportunities to drafts", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "mock",
        textProvider: "mock-text",
        fallbackEnabled: true
      }),
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: {
          ...createModelAssignmentConfigFromEnv({}),
          openAI: {
            providerName: "mock-text",
            model: "mock-openai-tier"
          }
        },
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: false,
          openAIAvailable: true
        }
      })
    });

    const watchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "article_source",
      label: "Test watchlist for auto-promotion",
      sourceUrl: "data:text/plain,Test content",
      seedExcerpt: "Test excerpt",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });

    const run = await db.createAutonomousRun({
      watchlistId: watchlist.id,
      triggerType: "scheduler",
      runType: "watchlist_scout_feed",
      status: "completed"
    });

    const audienceQueueItem = await db.upsertAutonomousReviewQueueItem({
      watchlistId: watchlist.id,
      autonomousRunId: run.id,
      sourceKind: "audience",
      dedupeKey: "test-audience-1",
      title: "Teams struggle with approval visibility",
      summary: "Production teams lack workflow ownership tracking",
      rationale: "High pain point for operations teams",
      recommendedAction: "write_post",
      status: "new"
    });

    const solutionQueueItem = await db.upsertAutonomousReviewQueueItem({
      watchlistId: watchlist.id,
      autonomousRunId: run.id,
      sourceKind: "solution",
      dedupeKey: "test-solution-1",
      title: "Workflow visibility dashboard",
      summary: "Real-time tracking of approval chains",
      rationale: "Solves operations pain point",
      recommendedAction: "write_post",
      status: "new"
    });

    const matchedOpp = await db.upsertAutonomousMatchedOpportunity({
      watchlistId: watchlist.id,
      autonomousRunId: run.id,
      audienceQueueItemId: audienceQueueItem.id,
      solutionQueueItemId: solutionQueueItem.id,
      dedupeKey: "test-match-1",
      title: "Workflow visibility for approval tracking",
      matchedPain: "Teams lack visibility into approval workflows",
      matchedSolutionPattern: "Dashboard provides real-time workflow tracking",
      matchRationale: "Strong match between pain and solution",
      suggestedAngle: "ownership_gap",
      recommendedAction: "write_post",
      priorityScore: 85,
      priorityBand: "high",
      reasonLines: ["High pain point", "Clear solution fit", "Strong operator need"],
      confidence: "high",
      reviewState: "new"
    });

    const draftsBefore = await db.listAutonomousDraftDocuments();
    expect(draftsBefore.length).toBe(0);

    await orchestrator.tickAutonomousScheduler("2026-03-16T00:00:00.000Z");

    const draftsAfter = await db.listAutonomousDraftDocuments();
    const autoDraft = draftsAfter.find(
      (draft) => draft.recommendedAction === "write_post"
    );

    expect(autoDraft).toBeDefined();
    expect(autoDraft!.title).toBeTruthy();
    expect(autoDraft!.body).toBeTruthy();
    expect(autoDraft!.status).toBe("draft");
  });

  it("tickAutonomousScheduler generates AI content when enableAutonomousAiDrafts flag is true", async () => {
    const mockProvider = new MockTextProvider();
    const generatePostSpy = vi.spyOn(mockProvider, "generatePostFromIdea");

    const registry = new ProviderRegistry();
    registry.registerTextProvider(mockProvider);
    orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "mock",
        textProvider: "mock-text",
        fallbackEnabled: true
      }),
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: {
          ...createModelAssignmentConfigFromEnv({}),
          openAI: {
            providerName: "mock-text",
            model: "mock-openai-tier"
          }
        },
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: false,
          openAIAvailable: true
        }
      }),
      enableAutonomousAiDrafts: true
    });

    const watchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "article_source",
      label: "Test watchlist for AI content generation",
      sourceUrl: "data:text/plain,Test content",
      seedExcerpt: "Test excerpt",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });

    const run = await db.createAutonomousRun({
      watchlistId: watchlist.id,
      triggerType: "scheduler",
      runType: "watchlist_scout_feed",
      status: "completed"
    });

    const audienceQueueItem = await db.upsertAutonomousReviewQueueItem({
      watchlistId: watchlist.id,
      autonomousRunId: run.id,
      sourceKind: "audience",
      dedupeKey: "test-audience-ai-1",
      title: "Teams struggle with approval visibility",
      summary: "Production teams lack workflow ownership tracking",
      rationale: "High pain point for operations teams",
      recommendedAction: "write_post",
      status: "new"
    });

    const solutionQueueItem = await db.upsertAutonomousReviewQueueItem({
      watchlistId: watchlist.id,
      autonomousRunId: run.id,
      sourceKind: "solution",
      dedupeKey: "test-solution-ai-1",
      title: "Workflow visibility dashboard",
      summary: "Real-time tracking of approval chains",
      rationale: "Solves operations pain point",
      recommendedAction: "write_post",
      status: "new"
    });

    await db.upsertAutonomousMatchedOpportunity({
      watchlistId: watchlist.id,
      autonomousRunId: run.id,
      audienceQueueItemId: audienceQueueItem.id,
      solutionQueueItemId: solutionQueueItem.id,
      dedupeKey: "test-match-ai-1",
      title: "Workflow visibility for approval tracking",
      matchedPain: "Teams lack visibility into approval workflows",
      matchedSolutionPattern: "Dashboard provides real-time workflow tracking",
      matchRationale: "Strong match between pain and solution",
      suggestedAngle: "ownership_gap",
      recommendedAction: "write_post",
      priorityScore: 85,
      priorityBand: "high",
      reasonLines: ["High pain point", "Clear solution fit", "Strong operator need"],
      confidence: "high",
      reviewState: "new"
    });

    await orchestrator.tickAutonomousScheduler("2026-03-16T00:00:00.000Z");

    const draftsAfter = await db.listAutonomousDraftDocuments();
    const autoDraft = draftsAfter.find(
      (draft) => draft.recommendedAction === "write_post"
    );

    expect(autoDraft).toBeDefined();
    expect(generatePostSpy).toHaveBeenCalled();

    const callArgs = generatePostSpy.mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    expect(callArgs?.idea.title).toContain("Workflow visibility");

    expect(autoDraft!.body).toContain("A practical take on");
    expect(autoDraft!.body).toContain("Keep the language direct, practical");
  });

  it("tickAutonomousScheduler does NOT auto-promote save_for_later opportunities", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "mock",
        textProvider: "mock-text",
        fallbackEnabled: true
      }),
      executionPolicyRouter: new ExecutionPolicyRouter({
        modelAssignments: {
          ...createModelAssignmentConfigFromEnv({}),
          openAI: {
            providerName: "mock-text",
            model: "mock-openai-tier"
          }
        },
        taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
        availability: {
          localMiraiAvailable: false,
          openAIAvailable: true
        }
      })
    });

    const watchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "watched_url",
      label: "Manual review watchlist",
      sourceUrl: "data:text/plain,Ambiguous signals",
      seedExcerpt: "Ambiguous signals",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });

    const run = await db.createAutonomousRun({
      watchlistId: watchlist.id,
      triggerType: "scheduler",
      runType: "watchlist_scout_feed",
      status: "completed"
    });

    const audienceQueueItem = await db.upsertAutonomousReviewQueueItem({
      watchlistId: watchlist.id,
      autonomousRunId: run.id,
      sourceKind: "audience",
      dedupeKey: "test-audience-2",
      title: "Ambiguous workflow discussion",
      summary: "Needs manual review",
      rationale: "Unclear signal",
      recommendedAction: "save_for_later",
      status: "new"
    });

    const solutionQueueItem = await db.upsertAutonomousReviewQueueItem({
      watchlistId: watchlist.id,
      autonomousRunId: run.id,
      sourceKind: "solution",
      dedupeKey: "test-solution-2",
      title: "Potential solution",
      summary: "Needs validation",
      rationale: "Unclear fit",
      recommendedAction: "save_for_later",
      status: "new"
    });

    await db.upsertAutonomousMatchedOpportunity({
      watchlistId: watchlist.id,
      autonomousRunId: run.id,
      audienceQueueItemId: audienceQueueItem.id,
      solutionQueueItemId: solutionQueueItem.id,
      dedupeKey: "test-match-2",
      title: "Ambiguous opportunity for review",
      matchedPain: "Unclear pain signal",
      matchedSolutionPattern: "Unclear solution fit",
      matchRationale: "Needs human review",
      suggestedAngle: "low_fit",
      recommendedAction: "save_for_later",
      priorityScore: 40,
      priorityBand: "low",
      reasonLines: ["Ambiguous signal", "Unclear fit", "Needs validation"],
      confidence: "low",
      reviewState: "new"
    });

    const draftsBefore = await db.listAutonomousDraftDocuments();
    const saveForLaterDraftBefore = draftsBefore.find(
      (draft) => draft.recommendedAction === "save_for_later"
    );
    expect(saveForLaterDraftBefore).toBeUndefined();

    await orchestrator.tickAutonomousScheduler("2026-03-16T00:00:00.000Z");

    const draftsAfter = await db.listAutonomousDraftDocuments();
    const saveForLaterDraftAfter = draftsAfter.find(
      (draft) => draft.recommendedAction === "save_for_later"
    );
    expect(saveForLaterDraftAfter).toBeUndefined();

    const opportunities = await orchestrator.listAutonomousPrioritizedOpportunities({});
    const saveForLaterOpp = opportunities.find((opp) => opp.recommendedAction === "save_for_later");
    if (saveForLaterOpp) {
      expect(saveForLaterOpp.reviewState).toBe("new");
    }
  });

  it("planGrowthRhythm produces deterministic weekly guidance from queue and saved candidates", async () => {
    const plan = await orchestrator.planGrowthRhythm({
      queueItems: [
        {
          id: "queue-1",
          title: "Ownership gap after rollout",
          suggestedAction: "generate_post_candidate",
          priority: "high",
          status: "new",
          bestAngle: "ownership_gap",
          reasoningSummary: "Strong post candidate."
        }
      ],
      savedCandidates: [
        {
          id: "saved-1",
          title: "Comment on workflow thread",
          suggestedAction: "generate_comment",
          priority: "medium",
          status: "sent",
          bestAngle: "handoff_failure",
          reasoningSummary: "Good engagement opportunity."
        }
      ]
    });

    expect(plan.topPostCandidates[0]?.id).toBe("queue-1");
    expect(plan.topCommentCandidates[0]?.id).toBe("saved-1");
    expect(plan.weeklyFocus).toEqual(expect.any(String));
    expect(plan.suggestedCadence).toContain("post candidate");
  });

  it("scoutAudience returns a deterministic shortlist of audience pain signals", async () => {
    const result = await orchestrator.scoutAudience({
      targetTopics: ["workflow chaos", "manual work after rollout"],
      targetRoles: ["COO"],
      targetKeywords: ["handoff", "spreadsheet"],
      maxResults: 2
    });

    expect(result).toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            suggestedActionType: expect.any(String),
            painSignalSummary: expect.any(String),
            whyItMatters: expect.any(String)
          }),
          expect.objectContaining({
            suggestedActionType: expect.any(String)
          })
        ],
        summary: expect.any(String),
        notes: expect.any(String)
      })
    );
  });

  it("scoutAudience can attach optional AI enrichment without changing deterministic fields", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    const router = new ProviderRouter(registry, {
      mode: "mock",
      textProvider: "mock-text",
      fallbackEnabled: true
    });
    orchestrator = new OrchestratorService({ db, providerRouter: router });

    const result = await orchestrator.scoutAudience({
      targetTopics: ["workflow chaos"],
      targetRoles: ["COO"],
      targetKeywords: ["handoff"],
      maxResults: 1
    });

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        painSignalSummary: expect.any(String),
        whyItMatters: expect.any(String),
        aiEnrichment: expect.objectContaining({
          improvedSummary: expect.any(String),
          businessConsequence: expect.any(String)
        })
      })
    );
  });

  it("scoutSolutions returns a deterministic shortlist of structured solution patterns", async () => {
    const result = await orchestrator.scoutSolutions({
      sourceType: "github",
      targetProblem: "workflow handoff failures",
      sourceLabel: "GitHub release",
      sourceExcerpt:
        "The release adds approval-state visibility and retry ownership so teams can recover stalled workflows faster."
    });

    expect(result).toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            solutionPattern: expect.any(String),
            implementationLesson: expect.any(String),
            tradeoffOrConstraint: expect.any(String),
            suggestedAngle: expect.any(String)
          })
        ],
        summary: expect.any(String),
        notes: expect.any(String)
      })
    );
  });

  it("scoutSolutions can attach optional AI enrichment without changing deterministic fields", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    const router = new ProviderRouter(registry, {
      mode: "mock",
      textProvider: "mock-text",
      fallbackEnabled: true
    });
    orchestrator = new OrchestratorService({ db, providerRouter: router });

    const result = await orchestrator.scoutSolutions({
      sourceType: "github",
      targetProblem: "workflow handoff failures",
      sourceLabel: "GitHub release",
      sourceExcerpt:
        "The release adds approval-state visibility and retry ownership so teams can recover stalled workflows faster."
    });

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        solutionPattern: expect.any(String),
        implementationLesson: expect.any(String),
        aiEnrichment: expect.objectContaining({
          operatorAngle: expect.any(String)
        })
      })
    );
  });

  it("matchScoutOpportunities returns a deterministic shortlist of matched opportunities", async () => {
    const result = await orchestrator.matchScoutOpportunities({
      audienceItems: [
        {
          id: "aud-1",
          sourcePlatform: "public_web",
          rawExcerpt: "We still patch the workflow by hand because nobody owns the handoff after launch.",
          painSignalSummary: "Operators are flagging broken handoffs after launch.",
          whyItMatters: "This shows workflow-accountability pain in live operations.",
          suggestedActionType: "post_candidate",
          topicCluster: "Broken Handoff",
          confidence: "high",
          createdAt: "2026-03-15T00:00:00.000Z"
        }
      ],
      solutionItems: [
        {
          id: "sol-1",
          sourceType: "github",
          rawExcerpt: "The release exposes status and ownership so teams can recover stalled workflows faster.",
          solutionPattern: "Visibility and coordination pattern",
          implementationLesson: "Expose status and ownership early so operators can intervene before work stalls.",
          tradeoffOrConstraint: "Visibility helps coordination, but it can create noise if ownership is still undefined.",
          whyItMatters: "Useful operator lesson.",
          suggestedAngle: "workflow_accountability",
          suggestedActionType: "post_candidate",
          confidence: "high",
          createdAt: "2026-03-15T00:00:00.000Z"
        }
      ]
    });

    expect(result).toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            audienceItemId: "aud-1",
            solutionItemId: "sol-1",
            recommendedAction: expect.any(String)
          })
        ],
        summary: expect.any(String),
        notes: expect.any(String)
      })
    );
  });

  it("matchScoutOpportunities can attach optional AI enrichment without changing deterministic matching", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    const router = new ProviderRouter(registry, {
      mode: "mock",
      textProvider: "mock-text",
      fallbackEnabled: true
    });
    orchestrator = new OrchestratorService({ db, providerRouter: router });

    const result = await orchestrator.matchScoutOpportunities({
      audienceItems: [
        {
          id: "aud-1",
          sourcePlatform: "public_web",
          rawExcerpt: "We still patch the workflow by hand because nobody owns the handoff after launch.",
          painSignalSummary: "Operators are flagging broken handoffs after launch.",
          whyItMatters: "This shows workflow-accountability pain in live operations.",
          suggestedActionType: "post_candidate",
          topicCluster: "Broken Handoff",
          confidence: "high",
          createdAt: "2026-03-15T00:00:00.000Z"
        }
      ],
      solutionItems: [
        {
          id: "sol-1",
          sourceType: "github",
          rawExcerpt: "The release exposes status and ownership so teams can recover stalled workflows faster.",
          solutionPattern: "Visibility and coordination pattern",
          implementationLesson: "Expose status and ownership early so operators can intervene before work stalls.",
          tradeoffOrConstraint: "Visibility helps coordination, but it can create noise if ownership is still undefined.",
          whyItMatters: "Useful operator lesson.",
          suggestedAngle: "workflow_accountability",
          suggestedActionType: "post_candidate",
          confidence: "high",
          createdAt: "2026-03-15T00:00:00.000Z"
        }
      ]
    });

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        audienceItemId: "aud-1",
        solutionItemId: "sol-1",
        recommendedAction: expect.any(String),
        aiEnrichment: expect.objectContaining({
          whyItMatters: expect.any(String),
          operatorAngle: expect.any(String)
        })
      })
    );
  });

  it("runScoutFeed returns deterministic batched audience and solution items", async () => {
    const result = await orchestrator.runScoutFeed({
      mode: "mixed",
      items: [
        {
          sourceType: "public_web",
          excerpt: "We still cannot see where the workflow is stuck until something breaks."
        },
        {
          sourceType: "github",
          excerpt: "The release adds status visibility and retry ownership."
        }
      ]
    });

    expect(result).toEqual(
      expect.objectContaining({
        audienceItems: [expect.objectContaining({ painSignalSummary: expect.any(String) })],
        solutionItems: [expect.objectContaining({ solutionPattern: expect.any(String) })],
        summary: expect.any(String),
        notes: expect.any(String)
      })
    );
  });

  it("scout results stay fully usable when AI enrichment is unavailable", async () => {
    const router = new ProviderRouter(new ProviderRegistry(), {
      mode: "deterministic",
      fallbackEnabled: true
    });
    orchestrator = new OrchestratorService({ db, providerRouter: router });

    const audience = await orchestrator.scoutAudience({
      targetTopics: ["workflow chaos"],
      maxResults: 1
    });
    const solution = await orchestrator.scoutSolutions({
      sourceType: "github",
      targetProblem: "workflow handoff failures",
      sourceExcerpt: "Expose status and ownership early so operators can intervene before work stalls."
    });
    const match = await orchestrator.matchScoutOpportunities({
      audienceItems: audience.items,
      solutionItems: solution.items
    });

    expect(audience.items[0]?.aiEnrichment).toBeUndefined();
    expect(solution.items[0]?.aiEnrichment).toBeUndefined();
    expect(match.items[0]?.aiEnrichment).toBeUndefined();
  });

  it("generateMatchContent attaches optional AI content only on the reviewed match seam", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    const router = new ProviderRouter(registry, {
      mode: "mock",
      textProvider: "mock-text",
      fallbackEnabled: true
    });
    orchestrator = new OrchestratorService({ db, providerRouter: router });

    const reviewed = await orchestrator.generateMatchContent({
      id: "saved-match-1",
      match: {
        id: "match-1",
        audienceItemId: "aud-1",
        solutionItemId: "sol-1",
        matchedPain: "Operators are still cleaning up broken workflow handoffs.",
        matchedSolutionPattern: "Visibility and coordination pattern",
        whyThisMatchWorks: "The solution addresses the same ownership gap.",
        suggestedAngle: "workflow_accountability",
        recommendedAction: "write_post",
        confidence: "high",
        aiEnrichment: {
          whyItMatters: "The pairing exposes a repeatable ownership gap.",
          operatorAngle: "Frame it as an operator lesson about recovery ownership."
        },
        createdAt: "2026-03-15T00:00:00.000Z"
      },
      status: "reviewed",
      createdAt: "2026-03-15T00:00:00.000Z"
    });
    const unreviewed = await orchestrator.generateMatchContent({
      id: "saved-match-2",
      match: {
        id: "match-2",
        audienceItemId: "aud-1",
        solutionItemId: "sol-1",
        matchedPain: "Operators are still cleaning up broken workflow handoffs.",
        matchedSolutionPattern: "Visibility and coordination pattern",
        whyThisMatchWorks: "The solution addresses the same ownership gap.",
        suggestedAngle: "workflow_accountability",
        recommendedAction: "write_post",
        confidence: "high",
        aiEnrichment: {
          whyItMatters: "The pairing exposes a repeatable ownership gap.",
          operatorAngle: "Frame it as an operator lesson about recovery ownership."
        },
        createdAt: "2026-03-15T00:00:00.000Z"
      },
      status: "new",
      createdAt: "2026-03-15T00:00:00.000Z"
    });

    expect(reviewed.match.aiContent).toEqual(
      expect.objectContaining({
        contentIdea: expect.any(String),
        draftAngle: expect.any(String),
        postSeed: expect.any(String)
      })
    );
    expect(unreviewed.match.aiContent).toBeUndefined();
    expect(reviewed.match.recommendedAction).toBe("write_post");
    expect(unreviewed.match.recommendedAction).toBe("write_post");
  });

  it("tickAutonomousScheduler creates a real server-side run for a due watchlist", async () => {
    const watchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "github_release",
      label: "Workflow releases",
      sourceUrl: "https://github.com/example/repo/releases",
      seedExcerpt: "Release notes mention retry ownership and status visibility.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      priority: "high",
      isActive: true
    });

    await orchestrator.updateAutonomousWatchlist(watchlist.id, {
      nextRunAt: "2026-03-16T00:00:00.000Z"
    });

    const result = await orchestrator.tickAutonomousScheduler("2026-03-16T00:00:00.000Z");
    const runs = await orchestrator.listAutonomousRuns();
    const refreshedWatchlist = (await orchestrator.listAutonomousWatchlists()).find(
      (item) => item.id === watchlist.id
    );
    const secondTick = await orchestrator.tickAutonomousScheduler(
      "2026-03-16T00:00:00.000Z"
    );

    expect(result).toEqual(
      expect.objectContaining({
        dueWatchlistIds: [watchlist.id],
        runs: [
          expect.objectContaining({
            watchlistId: watchlist.id,
            status: "completed",
            resultMetadata: expect.objectContaining({
              audienceItemCount: 0,
              solutionItemCount: 1,
              usedAi: true,
              ingestionStatus: "not_applicable"
            })
          })
        ]
      })
    );
    expect(runs[0]).toEqual(
      expect.objectContaining({
        watchlistId: watchlist.id,
        status: "completed",
        runType: "watchlist_scout_feed"
      })
    );
    expect(refreshedWatchlist).toEqual(
      expect.objectContaining({
        lastRunAt: "2026-03-16T00:00:00.000Z",
        nextRunAt: "2026-03-17T00:00:00.000Z"
      })
    );
    expect(secondTick.runs).toEqual([]);
  });

  it("tickAutonomousScheduler skips not-due and manual-only watchlists without requiring AI providers", async () => {
    const manualOnly = await orchestrator.createAutonomousWatchlist({
      sourceKind: "github_release",
      label: "Workflow releases",
      sourceUrl: "https://github.com/example/repo/releases",
      seedExcerpt: "Release notes mention retry ownership and visibility.",
      refreshCadence: "manual_only",
      isActive: true
    });
    const due = await orchestrator.createAutonomousWatchlist({
      sourceKind: "github_release",
      label: "Due workflow releases",
      sourceUrl: "https://github.com/example/repo/releases",
      seedExcerpt: "Release notes mention retry ownership and visibility.",
      refreshCadence: "weekly_candidate",
      isActive: true
    });

    await orchestrator.updateAutonomousWatchlist(due.id, {
      nextRunAt: "2026-03-16T00:00:00.000Z"
    });

    const result = await orchestrator.tickAutonomousScheduler(
      "2026-03-16T00:00:00.000Z"
    );

    expect(result.dueWatchlistIds).toEqual([due.id]);
    expect(result.skippedWatchlistIds).toEqual(expect.arrayContaining([manualOnly.id]));
    expect(result.runs[0]).toEqual(
      expect.objectContaining({
        status: "completed",
        resultMetadata: expect.objectContaining({
          audienceItemCount: 0,
          solutionItemCount: 1,
          usedAi: true
        })
      })
    );
  });

  it("tickAutonomousScheduler can ingest URL-backed sources server-side and persist artifacts", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      text: async () =>
        "<html><title>Workflow failures after launch</title><body>Teams still patch broken handoffs manually after launch because ownership stays vague.</body></html>"
    } as Response);
    orchestrator = new OrchestratorService({ db, watchlistFetch: fetchImpl });

    const watchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "article_source",
      label: "Workflow article watchlist",
      sourceUrl: "https://example.com/article",
      seedExcerpt: "Teams still patch broken handoffs manually after launch.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });

    await orchestrator.updateAutonomousWatchlist(watchlist.id, {
      nextRunAt: "2026-03-16T00:00:00.000Z"
    });

    const result = await orchestrator.tickAutonomousScheduler(
      "2026-03-16T00:00:00.000Z"
    );
    const artifacts = await orchestrator.listAutonomousIngestionArtifacts();
    const reviewQueue = await orchestrator.listAutonomousReviewQueueItems();

    expect(fetchImpl).toHaveBeenCalledWith("https://example.com/article");
    expect(result.runs[0]).toEqual(
      expect.objectContaining({
        status: "completed",
        resultMetadata: expect.objectContaining({
          solutionItemCount: 1,
          ingestionArtifactCount: 1,
          ingestionStatus: "completed",
          usedAi: true
        })
      })
    );
    expect(artifacts).toEqual([
      expect.objectContaining({
        watchlistId: watchlist.id,
        status: "ingested",
        normalizedSignalText: expect.stringContaining("ownership")
      })
    ]);
    expect(reviewQueue).toEqual([
      expect.objectContaining({
        watchlistId: watchlist.id,
        autonomousRunId: result.runs[0]?.id,
        sourceArtifactId: artifacts[0]?.id,
        recommendedAction: expect.any(String)
      })
    ]);
  });

  it("tickAutonomousScheduler surfaces automated ingestion failures safely", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("network down"));
    orchestrator = new OrchestratorService({ db, watchlistFetch: fetchImpl });

    const watchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "article_source",
      label: "Workflow article watchlist",
      sourceUrl: "https://example.com/article",
      seedExcerpt: "Teams still patch broken handoffs manually after launch.",
      refreshCadence: "daily_candidate",
      isActive: true
    });

    await orchestrator.updateAutonomousWatchlist(watchlist.id, {
      nextRunAt: "2026-03-16T00:00:00.000Z"
    });

    const result = await orchestrator.tickAutonomousScheduler(
      "2026-03-16T00:00:00.000Z"
    );
    const artifacts = await orchestrator.listAutonomousIngestionArtifacts();

    expect(result.runs[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        errorSummary: "network down",
        resultMetadata: expect.objectContaining({
          ingestionArtifactCount: 1,
          ingestionStatus: "failed"
        })
      })
    );
    expect(artifacts).toEqual([
      expect.objectContaining({
        watchlistId: watchlist.id,
        status: "failed",
        errorSummary: "network down"
      })
    ]);
    await expect(orchestrator.listAutonomousReviewQueueItems()).resolves.toEqual([]);
  });

  it("repeated autonomous runs upsert deterministic review queue items instead of duplicating them", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      text: async () =>
        "<html><title>Workflow failures after launch</title><body>Teams still patch broken handoffs manually after launch because ownership stays vague.</body></html>"
    } as Response);
    orchestrator = new OrchestratorService({ db, watchlistFetch: fetchImpl });

    const watchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "article_source",
      label: "Workflow article watchlist",
      sourceUrl: "https://example.com/article",
      seedExcerpt: "Teams still patch broken handoffs manually after launch.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });

    await orchestrator.updateAutonomousWatchlist(watchlist.id, {
      nextRunAt: "2026-03-16T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-16T00:00:00.000Z");

    await orchestrator.updateAutonomousWatchlist(watchlist.id, {
      nextRunAt: "2026-03-17T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-17T00:00:00.000Z");

    const reviewQueue = await orchestrator.listAutonomousReviewQueueItems();
    expect(reviewQueue).toHaveLength(1);
    expect(reviewQueue[0]).toEqual(
      expect.objectContaining({
        watchlistId: watchlist.id,
        recommendedAction: expect.any(String)
      })
    );
  });

  it("autonomous runs can create durable matched opportunities from the review backlog", async () => {
    orchestrator = new OrchestratorService({ db });

    const audienceWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "public_discussion_source",
      label: "Workflow pain watchlist",
      seedExcerpt: "Operators still patch broken handoffs manually after rollout.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });
    const solutionWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "article_source",
      label: "Workflow solution watchlist",
      seedExcerpt: "The release adds visibility and retry ownership so teams can recover stalled workflows faster.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });

    await orchestrator.updateAutonomousWatchlist(audienceWatchlist.id, {
      nextRunAt: "2026-03-16T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-16T00:00:00.000Z");

    await orchestrator.updateAutonomousWatchlist(solutionWatchlist.id, {
      nextRunAt: "2026-03-17T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-17T00:00:00.000Z");
    const matched = await orchestrator.listAutonomousMatchedOpportunities();

    expect(matched).toEqual([
      expect.objectContaining({
        watchlistId: solutionWatchlist.id,
        matchedPain: expect.any(String),
        matchedSolutionPattern: expect.any(String),
        matchRationale: expect.any(String),
        recommendedAction: expect.any(String),
        confidence: expect.any(String),
        priorityScore: expect.any(Number),
        priorityBand: expect.stringMatching(/high|medium|low/),
        reasonLines: expect.arrayContaining([expect.any(String)])
      })
    ]);
  });

  it("repeated autonomous runs upsert deterministic matched opportunities instead of duplicating them", async () => {
    orchestrator = new OrchestratorService({ db });

    const audienceWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "public_discussion_source",
      label: "Workflow pain watchlist",
      seedExcerpt: "Operators still patch broken handoffs manually after rollout.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });
    const solutionWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "article_source",
      label: "Workflow solution watchlist",
      seedExcerpt: "The release adds visibility and retry ownership so teams can recover stalled workflows faster.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });

    await orchestrator.updateAutonomousWatchlist(audienceWatchlist.id, {
      nextRunAt: "2026-03-16T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-16T00:00:00.000Z");

    await orchestrator.updateAutonomousWatchlist(solutionWatchlist.id, {
      nextRunAt: "2026-03-17T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-17T00:00:00.000Z");
    await orchestrator.updateAutonomousWatchlist(solutionWatchlist.id, {
      nextRunAt: "2026-03-18T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-18T00:00:00.000Z");

    const matched = await orchestrator.listAutonomousMatchedOpportunities();
    expect(matched).toHaveLength(1);
    expect(matched[0]).toEqual(
      expect.objectContaining({
        watchlistId: solutionWatchlist.id,
        priorityScore: expect.any(Number),
        priorityBand: expect.stringMatching(/high|medium|low/),
        reviewState: "new"
      })
    );
  });

  it("operator triage updates persist on durable matched opportunities without altering deterministic ranking fields", async () => {
    orchestrator = new OrchestratorService({ db });

    const audienceWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "public_discussion_source",
      label: "Workflow pain watchlist",
      seedExcerpt: "Operators still patch broken handoffs manually after rollout.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });
    const solutionWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "article_source",
      label: "Workflow solution watchlist",
      seedExcerpt:
        "The release adds visibility and retry ownership so teams can recover stalled workflows faster.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });

    await orchestrator.updateAutonomousWatchlist(audienceWatchlist.id, {
      nextRunAt: "2026-03-16T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-16T00:00:00.000Z");
    await orchestrator.updateAutonomousWatchlist(solutionWatchlist.id, {
      nextRunAt: "2026-03-17T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-17T00:00:00.000Z");

    const matched = await orchestrator.listAutonomousMatchedOpportunities();
    const target = matched[0];
    expect(target).toBeDefined();

    const updated = await orchestrator.updateAutonomousMatchedOpportunityReviewState(
      target!.id,
      {
        reviewState: "saved",
        reviewNote: "Strong fit for human follow-up."
      }
    );

    expect(updated).toEqual(
      expect.objectContaining({
        id: target!.id,
        reviewState: "saved",
        reviewNote: "Strong fit for human follow-up.",
        reviewedAt: expect.any(String),
        recommendedAction: target!.recommendedAction,
        priorityScore: target!.priorityScore,
        priorityBand: target!.priorityBand
      })
    );
  });

  it("autonomous reruns preserve existing operator triage state on matched opportunities", async () => {
    orchestrator = new OrchestratorService({ db });

    const audienceWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "public_discussion_source",
      label: "Workflow pain watchlist",
      seedExcerpt: "Operators still patch broken handoffs manually after rollout.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });
    const solutionWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "article_source",
      label: "Workflow solution watchlist",
      seedExcerpt:
        "The release adds visibility and retry ownership so teams can recover stalled workflows faster.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });

    await orchestrator.updateAutonomousWatchlist(audienceWatchlist.id, {
      nextRunAt: "2026-03-16T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-16T00:00:00.000Z");
    await orchestrator.updateAutonomousWatchlist(solutionWatchlist.id, {
      nextRunAt: "2026-03-17T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-17T00:00:00.000Z");

    const firstMatched = (await orchestrator.listAutonomousMatchedOpportunities())[0];
    await orchestrator.updateAutonomousMatchedOpportunityReviewState(firstMatched!.id, {
      reviewState: "dismissed",
      reviewNote: "Not a near-term operator priority."
    });

    await orchestrator.updateAutonomousWatchlist(solutionWatchlist.id, {
      nextRunAt: "2026-03-18T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-18T00:00:00.000Z");

    const rerunMatched = (await orchestrator.listAutonomousMatchedOpportunities())[0];
    expect(rerunMatched).toEqual(
      expect.objectContaining({
        id: firstMatched!.id,
        reviewState: "dismissed",
        reviewNote: "Not a near-term operator priority.",
        recommendedAction: firstMatched!.recommendedAction
      })
    );
  });

  it("eligible triaged matched opportunities can be promoted into durable content work items", async () => {
    orchestrator = new OrchestratorService({ db });

    const audienceWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "public_discussion_source",
      label: "Workflow pain watchlist",
      seedExcerpt: "Operators still patch broken handoffs manually after rollout.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });
    const solutionWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "article_source",
      label: "Workflow solution watchlist",
      seedExcerpt:
        "The release adds visibility and retry ownership so teams can recover stalled workflows faster.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });

    await orchestrator.updateAutonomousWatchlist(audienceWatchlist.id, {
      nextRunAt: "2026-03-16T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-16T00:00:00.000Z");
    await orchestrator.updateAutonomousWatchlist(solutionWatchlist.id, {
      nextRunAt: "2026-03-17T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-17T00:00:00.000Z");

    const opportunity = (await orchestrator.listAutonomousMatchedOpportunities())[0]!;
    await orchestrator.updateAutonomousMatchedOpportunityReviewState(opportunity.id, {
      reviewState: "saved",
      reviewNote: "Ready for server-side content prep."
    });

    const promoted = await orchestrator.promoteAutonomousMatchedOpportunity(opportunity.id);

    expect(promoted).toEqual(
      expect.objectContaining({
        sourceMatchedOpportunityId: opportunity.id,
        watchlistId: opportunity.watchlistId,
        recommendedAction: opportunity.recommendedAction,
        priorityScore: opportunity.priorityScore,
        priorityBand: opportunity.priorityBand,
        reviewState: "saved",
        draftSeed: expect.objectContaining({
          title: opportunity.title,
          sourceSummary: `${opportunity.matchedPain} -> ${opportunity.matchedSolutionPattern}`,
          rationale: opportunity.matchRationale,
          recommendedAction: opportunity.recommendedAction,
          priorityBand: opportunity.priorityBand
        })
      })
    );

    await expect(orchestrator.listAutonomousContentWorkItems()).resolves.toEqual([
      expect.objectContaining({
        sourceMatchedOpportunityId: opportunity.id
      })
    ]);
  });

  it("separate watchlist pairs keep matched opportunities and downstream promotion chains isolated across repeated runs", async () => {
    orchestrator = new OrchestratorService({ db });

    const firstAudienceWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "public_discussion_source",
      label: "First workflow pain watchlist",
      seedExcerpt: "Operators still patch broken handoffs manually after rollout.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });
    const firstSolutionWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "article_source",
      label: "First workflow solution watchlist",
      seedExcerpt:
        "The release adds visibility and retry ownership so teams can recover stalled workflows faster.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });

    await orchestrator.updateAutonomousWatchlist(firstAudienceWatchlist.id, {
      nextRunAt: "2026-03-16T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-16T00:00:00.000Z");
    await orchestrator.updateAutonomousWatchlist(firstSolutionWatchlist.id, {
      nextRunAt: "2026-03-17T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-17T00:00:00.000Z");

    const firstMatched = (await orchestrator.listAutonomousMatchedOpportunities()).find(
      (item) => item.watchlistId === firstSolutionWatchlist.id
    )!;
    await orchestrator.updateAutonomousMatchedOpportunityReviewState(firstMatched.id, {
      reviewState: "saved"
    });
    const firstWorkItem = await orchestrator.promoteAutonomousMatchedOpportunity(firstMatched.id);
    const firstDraft = await orchestrator.createAutonomousDraftDocumentFromWorkItem(
      firstWorkItem!.id
    );

    const secondAudienceWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "public_discussion_source",
      label: "Second workflow pain watchlist",
      seedExcerpt: "Teams still carry manual workflow recovery work in public discussions.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });
    const secondSolutionWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "article_source",
      label: "Second workflow solution watchlist",
      seedExcerpt:
        "The update adds approval-state visibility and one retry owner so teams can recover stalled workflows faster.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });

    await orchestrator.updateAutonomousWatchlist(secondAudienceWatchlist.id, {
      nextRunAt: "2026-03-18T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-18T00:00:00.000Z");
    await orchestrator.updateAutonomousWatchlist(secondSolutionWatchlist.id, {
      nextRunAt: "2026-03-19T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-19T00:00:00.000Z");

    const matchedOpportunities = await orchestrator.listAutonomousMatchedOpportunities();
    const secondMatched = matchedOpportunities.find(
      (item) => item.watchlistId === secondSolutionWatchlist.id
    )!;

    expect(secondMatched.id).not.toBe(firstMatched.id);
    expect(
      matchedOpportunities.filter(
        (item) =>
          item.id === firstMatched.id || item.id === secondMatched.id
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: firstMatched.id,
          watchlistId: firstSolutionWatchlist.id,
          reviewState: "saved"
        }),
        expect.objectContaining({
          id: secondMatched.id,
          watchlistId: secondSolutionWatchlist.id,
          reviewState: "new"
        })
      ])
    );

    await orchestrator.updateAutonomousMatchedOpportunityReviewState(secondMatched.id, {
      reviewState: "saved"
    });
    const secondWorkItem = await orchestrator.promoteAutonomousMatchedOpportunity(
      secondMatched.id
    );
    const secondDraft = await orchestrator.createAutonomousDraftDocumentFromWorkItem(
      secondWorkItem!.id
    );

    expect(secondWorkItem!.id).not.toBe(firstWorkItem!.id);
    expect(secondDraft!.id).not.toBe(firstDraft!.id);
    expect(secondWorkItem).toEqual(
      expect.objectContaining({
        sourceMatchedOpportunityId: secondMatched.id,
        watchlistId: secondSolutionWatchlist.id
      })
    );
    expect(secondDraft).toEqual(
      expect.objectContaining({
        sourceContentWorkItemId: secondWorkItem!.id
      })
    );
  });

  it("promotion rejects ineligible triage states and does not mutate source opportunities", async () => {
    orchestrator = new OrchestratorService({ db });

    const audienceWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "public_discussion_source",
      label: "Workflow pain watchlist",
      seedExcerpt: "Operators still patch broken handoffs manually after rollout.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });
    const solutionWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "article_source",
      label: "Workflow solution watchlist",
      seedExcerpt:
        "The release adds visibility and retry ownership so teams can recover stalled workflows faster.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });

    await orchestrator.updateAutonomousWatchlist(audienceWatchlist.id, {
      nextRunAt: "2026-03-16T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-16T00:00:00.000Z");
    await orchestrator.updateAutonomousWatchlist(solutionWatchlist.id, {
      nextRunAt: "2026-03-17T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-17T00:00:00.000Z");

    const opportunity = (await orchestrator.listAutonomousMatchedOpportunities())[0]!;

    await expect(
      orchestrator.promoteAutonomousMatchedOpportunity(opportunity.id)
    ).rejects.toThrow(/Only in_review or saved matched opportunities can be promoted/i);

    const sourceAfter = (await orchestrator.listAutonomousMatchedOpportunities())[0]!;
    expect(sourceAfter).toEqual(
      expect.objectContaining({
        id: opportunity.id,
        reviewState: "new",
        recommendedAction: opportunity.recommendedAction,
        priorityScore: opportunity.priorityScore
      })
    );
  });

  it("server-side content workspace feed lists promoted items deterministically and supports filtering", async () => {
    orchestrator = new OrchestratorService({ db });

    const audienceWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "public_discussion_source",
      label: "Workflow pain watchlist",
      seedExcerpt: "Operators still patch broken handoffs manually after rollout.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });
    const solutionWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "article_source",
      label: "Workflow solution watchlist",
      seedExcerpt:
        "The release adds visibility and retry ownership so teams can recover stalled workflows faster.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });

    await orchestrator.updateAutonomousWatchlist(audienceWatchlist.id, {
      nextRunAt: "2026-03-16T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-16T00:00:00.000Z");
    await orchestrator.updateAutonomousWatchlist(solutionWatchlist.id, {
      nextRunAt: "2026-03-17T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-17T00:00:00.000Z");

    const opportunity = (await orchestrator.listAutonomousMatchedOpportunities())[0]!;
    await orchestrator.updateAutonomousMatchedOpportunityReviewState(opportunity.id, {
      reviewState: "saved"
    });
    const promoted = await orchestrator.promoteAutonomousMatchedOpportunity(opportunity.id);

    const feed = await orchestrator.listAutonomousContentWorkspaceFeed();
    const filtered = await orchestrator.listAutonomousContentWorkspaceFeed({
      workItemKind: promoted!.workItemKind,
      status: promoted!.status
    });
    const fetched = await orchestrator.getAutonomousContentWorkItemById(promoted!.id);

    expect(feed).toEqual([expect.objectContaining({ id: promoted!.id })]);
    expect(filtered).toEqual([
      expect.objectContaining({
        id: promoted!.id,
        workItemKind: promoted!.workItemKind,
        status: promoted!.status,
        draftSeed: expect.objectContaining({
          title: promoted!.title
        }),
        draftProgress: expect.objectContaining({
          hasDraft: false
        })
      })
    ]);
    expect(fetched).toEqual(
      expect.objectContaining({
        id: promoted!.id,
        draftSeed: expect.objectContaining({
          recommendedAction: promoted!.recommendedAction
        }),
        draftProgress: expect.objectContaining({
          hasDraft: false
        })
      })
    );
  });

  it("content work-item workflow updates persist without altering source opportunity or promotion identity", async () => {
    orchestrator = new OrchestratorService({ db });

    const audienceWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "public_discussion_source",
      label: "Workflow pain watchlist",
      seedExcerpt: "Operators still patch broken handoffs manually after rollout.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });
    const solutionWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "article_source",
      label: "Workflow solution watchlist",
      seedExcerpt:
        "The release adds visibility and retry ownership so teams can recover stalled workflows faster.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });

    await orchestrator.updateAutonomousWatchlist(audienceWatchlist.id, {
      nextRunAt: "2026-03-16T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-16T00:00:00.000Z");
    await orchestrator.updateAutonomousWatchlist(solutionWatchlist.id, {
      nextRunAt: "2026-03-17T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-17T00:00:00.000Z");

    const source = (await orchestrator.listAutonomousMatchedOpportunities())[0]!;
    await orchestrator.updateAutonomousMatchedOpportunityReviewState(source.id, {
      reviewState: "saved"
    });
    const promoted = await orchestrator.promoteAutonomousMatchedOpportunity(source.id);

    const updated = await orchestrator.updateAutonomousContentWorkItemStatus(promoted!.id, {
      status: "blocked",
      workNote: "Waiting on operator input."
    });

    expect(updated).toEqual(
      expect.objectContaining({
        id: promoted!.id,
        status: "blocked",
        workNote: "Waiting on operator input.",
        sourceMatchedOpportunityId: source.id
      })
    );

    const sourceAfter = (await orchestrator.listAutonomousMatchedOpportunities())[0]!;
    expect(sourceAfter).toEqual(
      expect.objectContaining({
        id: source.id,
        reviewState: "saved",
        recommendedAction: source.recommendedAction,
        priorityScore: source.priorityScore
      })
    );

    const promotedAgain = await orchestrator.promoteAutonomousMatchedOpportunity(source.id);
    expect(promotedAgain).toEqual(
      expect.objectContaining({
        id: promoted!.id,
        status: "blocked",
        draftSeed: expect.objectContaining({
          rationale: source.matchRationale
        })
      })
    );
  });

  it("creates durable draft documents explicitly from content work item draft seeds", async () => {
    orchestrator = new OrchestratorService({ db });

    const audienceWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "public_discussion_source",
      label: "Workflow pain watchlist",
      seedExcerpt: "Operators still patch broken handoffs manually after rollout.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });
    const solutionWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "article_source",
      label: "Workflow solution watchlist",
      seedExcerpt:
        "The release adds visibility and retry ownership so teams can recover stalled workflows faster.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });

    await orchestrator.updateAutonomousWatchlist(audienceWatchlist.id, {
      nextRunAt: "2026-03-16T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-16T00:00:00.000Z");
    await orchestrator.updateAutonomousWatchlist(solutionWatchlist.id, {
      nextRunAt: "2026-03-17T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-17T00:00:00.000Z");

    const source = (await orchestrator.listAutonomousMatchedOpportunities())[0]!;
    await orchestrator.updateAutonomousMatchedOpportunityReviewState(source.id, {
      reviewState: "saved"
    });
    const promoted = await orchestrator.promoteAutonomousMatchedOpportunity(source.id);
    const created = await orchestrator.createAutonomousDraftDocumentFromWorkItem(promoted!.id);
    const createdAgain = await orchestrator.createAutonomousDraftDocumentFromWorkItem(
      promoted!.id
    );

    expect(created).toEqual(
      expect.objectContaining({
        sourceContentWorkItemId: promoted!.id,
        title: promoted!.draftSeed!.title,
        body: promoted!.draftSeed!.seedText,
        sourceSummary: promoted!.draftSeed!.sourceSummary,
        recommendedAction: promoted!.recommendedAction,
        status: "draft"
      })
    );
    expect(createdAgain).toEqual(expect.objectContaining({ id: created!.id }));

    await expect(orchestrator.listAutonomousDraftDocuments()).resolves.toEqual([
      expect.objectContaining({
        id: created!.id,
        sourceContentWorkItemId: promoted!.id,
        sourceWorkItemTitle: promoted!.title,
        sourceWorkItemStatus: promoted!.status,
        sourceWorkItemRecommendedAction: promoted!.recommendedAction,
        sourceWorkItemSummary: promoted!.summary
      })
    ]);
    await expect(orchestrator.getAutonomousDraftDocumentById(created!.id)).resolves.toEqual(
      expect.objectContaining({
        id: created!.id,
        recommendedAction: promoted!.recommendedAction
      })
    );

    await expect(orchestrator.getAutonomousContentWorkItemById(promoted!.id)).resolves.toEqual(
      expect.objectContaining({
        id: promoted!.id,
        status: promoted!.status,
        draftSeed: expect.objectContaining({
          title: promoted!.draftSeed!.title
        }),
        draftProgress: expect.objectContaining({
          hasDraft: true,
          draftId: created!.id,
          draftStatus: "draft",
          draftUpdatedAt: expect.any(String)
        })
      })
    );
  });

  it("filters the content workspace feed by derived draft progress safely", async () => {
    orchestrator = new OrchestratorService({ db });

    const audienceWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "public_discussion_source",
      label: "Workflow pain watchlist",
      seedExcerpt: "Operators still patch broken handoffs manually after rollout.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });
    const solutionWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "article_source",
      label: "Workflow solution watchlist",
      seedExcerpt:
        "The release adds visibility and retry ownership so teams can recover stalled workflows faster.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });

    await orchestrator.updateAutonomousWatchlist(audienceWatchlist.id, {
      nextRunAt: "2026-03-16T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-16T00:00:00.000Z");
    await orchestrator.updateAutonomousWatchlist(solutionWatchlist.id, {
      nextRunAt: "2026-03-17T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-17T00:00:00.000Z");

    const source = (await orchestrator.listAutonomousMatchedOpportunities())[0]!;
    await orchestrator.updateAutonomousMatchedOpportunityReviewState(source.id, {
      reviewState: "saved"
    });
    const promoted = await orchestrator.promoteAutonomousMatchedOpportunity(source.id);

    await expect(
      orchestrator.listAutonomousContentWorkspaceFeed({ hasDraft: false })
    ).resolves.toEqual([
      expect.objectContaining({
        id: promoted!.id,
        draftProgress: expect.objectContaining({ hasDraft: false })
      })
    ]);

    const draft = await orchestrator.createAutonomousDraftDocumentFromWorkItem(promoted!.id);
    await orchestrator.updateAutonomousDraftDocumentStatus(draft!.id, {
      status: "ready"
    });

    await expect(
      orchestrator.listAutonomousContentWorkspaceFeed({ hasDraft: true })
    ).resolves.toEqual([
      expect.objectContaining({
        id: promoted!.id,
        draftProgress: expect.objectContaining({
          hasDraft: true,
          draftId: draft!.id,
          draftStatus: "ready"
        })
      })
    ]);
    await expect(
      orchestrator.listAutonomousContentWorkspaceFeed({ draftStatus: "ready" })
    ).resolves.toEqual([
      expect.objectContaining({
        id: promoted!.id,
        draftProgress: expect.objectContaining({
          hasDraft: true,
          draftStatus: "ready"
        })
      })
    ]);
    await expect(
      orchestrator.listAutonomousContentWorkspaceFeed({ draftStatus: "blocked" })
    ).resolves.toEqual([]);
  });

  it("filters autonomous draft documents by status safely", async () => {
    orchestrator = new OrchestratorService({ db });

    const audienceWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "public_discussion_source",
      label: "Workflow pain watchlist",
      seedExcerpt: "Operators still patch broken handoffs manually after rollout.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });
    const solutionWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "article_source",
      label: "Workflow solution watchlist",
      seedExcerpt:
        "The release adds visibility and retry ownership so teams can recover stalled workflows faster.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });

    await orchestrator.updateAutonomousWatchlist(audienceWatchlist.id, {
      nextRunAt: "2026-03-16T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-16T00:00:00.000Z");
    await orchestrator.updateAutonomousWatchlist(solutionWatchlist.id, {
      nextRunAt: "2026-03-17T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-17T00:00:00.000Z");

    const source = (await orchestrator.listAutonomousMatchedOpportunities())[0]!;
    await orchestrator.updateAutonomousMatchedOpportunityReviewState(source.id, {
      reviewState: "saved"
    });
    const promoted = await orchestrator.promoteAutonomousMatchedOpportunity(source.id);
    const firstDraft = await orchestrator.createAutonomousDraftDocumentFromWorkItem(promoted!.id);

    const secondWorkItem = await db.upsertAutonomousContentWorkItem({
      sourceMatchedOpportunityId: "matched-second",
      watchlistId: "watch-second",
      autonomousRunId: "run-second",
      workItemKind: "comment",
      title: "Second promoted workflow angle",
      summary: "A second deterministic drafting target",
      rationale: "Keeps draft filter coverage explicit.",
      recommendedAction: "write_comment",
      priorityScore: 74,
      priorityBand: "medium",
      reviewState: "saved",
      draftSeed: {
        title: "Second deterministic draft",
        angle: "Comment-first angle",
        seedText: "Comment draft seed text.",
        sourceSummary: "A second deterministic drafting target",
        rationale: "Keeps draft filter coverage explicit.",
        recommendedAction: "write_comment",
        priorityBand: "medium"
      }
    });
    const secondDraft = await orchestrator.createAutonomousDraftDocumentFromWorkItem(secondWorkItem.id);

    await orchestrator.updateAutonomousDraftDocumentStatus(firstDraft!.id, {
      status: "ready"
    });

    await expect(orchestrator.listAutonomousDraftDocuments({ status: "ready" })).resolves.toEqual([
      expect.objectContaining({
        id: firstDraft!.id,
        status: "ready",
        sourceWorkItemTitle: promoted!.title,
        sourceWorkItemStatus: promoted!.status,
        sourceWorkItemRecommendedAction: promoted!.recommendedAction,
        sourceWorkItemSummary: promoted!.summary
      })
    ]);
    await expect(orchestrator.listAutonomousDraftDocuments({ status: "draft" })).resolves.toEqual([
      expect.objectContaining({
        id: secondDraft!.id,
        status: "draft"
      })
    ]);
    await expect(orchestrator.listAutonomousDraftDocuments({ status: "archived" })).resolves.toEqual([]);
  });

  it("sorts autonomous draft documents safely without changing the default truthful order", async () => {
    vi.useFakeTimers();
    orchestrator = new OrchestratorService({ db });

    vi.setSystemTime(new Date("2026-03-16T14:00:00.000Z"));
    const firstWorkItem = await db.upsertAutonomousContentWorkItem({
      sourceMatchedOpportunityId: "matched-a",
      watchlistId: "watch-a",
      autonomousRunId: "run-a",
      workItemKind: "post",
      title: "First draft work item",
      summary: "First deterministic draft target",
      rationale: "Draft sorting coverage",
      recommendedAction: "write_post",
      priorityScore: 88,
      priorityBand: "high",
      reviewState: "saved",
      draftSeed: {
        title: "First draft",
        angle: "First angle",
        seedText: "First seed",
        sourceSummary: "First deterministic draft target",
        rationale: "Draft sorting coverage",
        recommendedAction: "write_post",
        priorityBand: "high"
      }
    });
    const firstDraft = await orchestrator.createAutonomousDraftDocumentFromWorkItem(firstWorkItem.id);

    vi.setSystemTime(new Date("2026-03-16T14:10:00.000Z"));
    const secondWorkItem = await db.upsertAutonomousContentWorkItem({
      sourceMatchedOpportunityId: "matched-b",
      watchlistId: "watch-b",
      autonomousRunId: "run-b",
      workItemKind: "comment",
      title: "Second draft work item",
      summary: "Second deterministic draft target",
      rationale: "Draft sorting coverage",
      recommendedAction: "write_comment",
      priorityScore: 77,
      priorityBand: "medium",
      reviewState: "saved",
      draftSeed: {
        title: "Second draft",
        angle: "Second angle",
        seedText: "Second seed",
        sourceSummary: "Second deterministic draft target",
        rationale: "Draft sorting coverage",
        recommendedAction: "write_comment",
        priorityBand: "medium"
      }
    });
    const secondDraft = await orchestrator.createAutonomousDraftDocumentFromWorkItem(secondWorkItem.id);

    vi.setSystemTime(new Date("2026-03-16T14:20:00.000Z"));
    const thirdWorkItem = await db.upsertAutonomousContentWorkItem({
      sourceMatchedOpportunityId: "matched-c",
      watchlistId: "watch-c",
      autonomousRunId: "run-c",
      workItemKind: "reply",
      title: "Third draft work item",
      summary: "Third deterministic draft target",
      rationale: "Draft sorting coverage",
      recommendedAction: "write_comment",
      priorityScore: 72,
      priorityBand: "medium",
      reviewState: "saved",
      draftSeed: {
        title: "Third draft",
        angle: "Third angle",
        seedText: "Third seed",
        sourceSummary: "Third deterministic draft target",
        rationale: "Draft sorting coverage",
        recommendedAction: "write_comment",
        priorityBand: "medium"
      }
    });
    const thirdDraft = await orchestrator.createAutonomousDraftDocumentFromWorkItem(thirdWorkItem.id);

    await orchestrator.updateAutonomousDraftDocumentStatus(firstDraft!.id, { status: "ready" });
    await orchestrator.updateAutonomousDraftDocumentStatus(secondDraft!.id, { status: "blocked" });

    await expect(orchestrator.listAutonomousDraftDocuments()).resolves.toEqual([
      expect.objectContaining({ id: thirdDraft!.id, status: "draft" }),
      expect.objectContaining({ id: secondDraft!.id, status: "blocked" }),
      expect.objectContaining({ id: firstDraft!.id, status: "ready" })
    ]);
    await expect(
      orchestrator.listAutonomousDraftDocuments({ sort: "updated_asc" })
    ).resolves.toEqual([
      expect.objectContaining({ id: firstDraft!.id }),
      expect.objectContaining({ id: secondDraft!.id }),
      expect.objectContaining({ id: thirdDraft!.id })
    ]);
    await expect(orchestrator.listAutonomousDraftDocuments({ sort: "status" })).resolves.toEqual([
      expect.objectContaining({ id: thirdDraft!.id, status: "draft" }),
      expect.objectContaining({ id: firstDraft!.id, status: "ready" }),
      expect.objectContaining({ id: secondDraft!.id, status: "blocked" })
    ]);
  });

  it("projects source work-item title and status onto draft list rows safely", async () => {
    orchestrator = new OrchestratorService({ db });

    const sourceWorkItem = await db.upsertAutonomousContentWorkItem({
      sourceMatchedOpportunityId: "matched-source",
      watchlistId: "watch-source",
      autonomousRunId: "run-source",
      workItemKind: "post",
      title: "Projected source work item",
      summary: "Source projection stays on the draft row.",
      rationale: "This keeps draft-origin context visible without an extra fetch.",
      recommendedAction: "write_post",
      priorityScore: 88,
      priorityBand: "high",
      reviewState: "saved",
      status: "blocked"
    });
    const projectedDraft = await db.upsertAutonomousDraftDocument({
      sourceContentWorkItemId: sourceWorkItem.id,
      title: "Projected draft",
      body: "Draft body",
      angle: "Projection angle",
      sourceSummary: sourceWorkItem.summary,
      recommendedAction: sourceWorkItem.recommendedAction
    });
    const missingSourceDraft = await db.upsertAutonomousDraftDocument({
      sourceContentWorkItemId: "work-missing",
      title: "Missing source draft",
      body: "Draft body",
      sourceSummary: "Missing source summary",
      recommendedAction: "write_post"
    });

    await expect(orchestrator.listAutonomousDraftDocuments()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: projectedDraft.id,
          sourceContentWorkItemId: sourceWorkItem.id,
          sourceWorkItemTitle: sourceWorkItem.title,
          sourceWorkItemStatus: sourceWorkItem.status,
          sourceWorkItemRecommendedAction: sourceWorkItem.recommendedAction,
          sourceWorkItemSummary: sourceWorkItem.summary
        }),
        expect.objectContaining({
          id: missingSourceDraft.id,
          sourceContentWorkItemId: "work-missing",
          sourceWorkItemTitle: undefined,
          sourceWorkItemStatus: undefined,
          sourceWorkItemRecommendedAction: undefined,
          sourceWorkItemSummary: undefined
        })
      ])
    );
  });

  it("sorts the content workspace feed safely without changing the default deterministic order", async () => {
    const older = await db.upsertAutonomousContentWorkItem({
      sourceMatchedOpportunityId: "match-old",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "comment",
      title: "Older draftless item",
      summary: "Older summary",
      rationale: "Older rationale",
      recommendedAction: "write_comment",
      priorityScore: 60,
      priorityBand: "medium",
      reviewState: "saved",
      status: "blocked",
      stateChangedAt: "2026-03-16T10:00:00.000Z"
    });
    const newer = await db.upsertAutonomousContentWorkItem({
      sourceMatchedOpportunityId: "match-new",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "post",
      title: "Newer drafted item",
      summary: "Newer summary",
      rationale: "Newer rationale",
      recommendedAction: "write_post",
      priorityScore: 90,
      priorityBand: "high",
      reviewState: "saved",
      status: "ready_for_draft",
      stateChangedAt: "2026-03-16T11:00:00.000Z",
      draftSeed: {
        title: "Newer drafted item",
        seedText: "Seed",
        sourceSummary: "Summary",
        rationale: "Rationale",
        recommendedAction: "write_post",
        priorityBand: "high"
      }
    });
    const draft = await orchestrator.createAutonomousDraftDocumentFromWorkItem(newer.id);
    await orchestrator.updateAutonomousDraftDocumentStatus(draft!.id, { status: "ready" });

    await expect(orchestrator.listAutonomousContentWorkspaceFeed()).resolves.toEqual([
      expect.objectContaining({ id: newer.id }),
      expect.objectContaining({ id: older.id })
    ]);
    await expect(
      orchestrator.listAutonomousContentWorkspaceFeed({ sort: "updated_asc" })
    ).resolves.toEqual([
      expect.objectContaining({ id: older.id }),
      expect.objectContaining({ id: newer.id })
    ]);
    await expect(
      orchestrator.listAutonomousContentWorkspaceFeed({ sort: "status" })
    ).resolves.toEqual([
      expect.objectContaining({ id: newer.id, status: "ready_for_draft" }),
      expect.objectContaining({ id: older.id, status: "blocked" })
    ]);
    await expect(
      orchestrator.listAutonomousContentWorkspaceFeed({ sort: "has_draft" })
    ).resolves.toEqual([
      expect.objectContaining({
        id: newer.id,
        draftProgress: expect.objectContaining({ hasDraft: true, draftStatus: "ready" })
      }),
      expect.objectContaining({
        id: older.id,
        draftProgress: expect.objectContaining({ hasDraft: false })
      })
    ]);
  });

  it("updates draft documents explicitly without mutating source work item or draft seed", async () => {
    orchestrator = new OrchestratorService({ db });

    const audienceWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "public_discussion_source",
      label: "Workflow pain watchlist",
      seedExcerpt: "Operators still patch broken handoffs manually after rollout.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });
    const solutionWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "article_source",
      label: "Workflow solution watchlist",
      seedExcerpt:
        "The release adds visibility and retry ownership so teams can recover stalled workflows faster.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });

    await orchestrator.updateAutonomousWatchlist(audienceWatchlist.id, {
      nextRunAt: "2026-03-16T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-16T00:00:00.000Z");
    await orchestrator.updateAutonomousWatchlist(solutionWatchlist.id, {
      nextRunAt: "2026-03-17T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-17T00:00:00.000Z");

    const source = (await orchestrator.listAutonomousMatchedOpportunities())[0]!;
    await orchestrator.updateAutonomousMatchedOpportunityReviewState(source.id, {
      reviewState: "saved"
    });
    const promoted = await orchestrator.promoteAutonomousMatchedOpportunity(source.id);
    const created = await orchestrator.createAutonomousDraftDocumentFromWorkItem(promoted!.id);
    const updated = await orchestrator.updateAutonomousDraftDocument(created!.id, {
      title: "Refined workflow accountability title",
      body: "A tighter operator-facing draft body.",
      angle: "Focus on recovery ownership after launch."
    });

    expect(updated).toEqual(
      expect.objectContaining({
        id: created!.id,
        sourceContentWorkItemId: promoted!.id,
        title: "Refined workflow accountability title",
        body: "A tighter operator-facing draft body.",
        angle: "Focus on recovery ownership after launch.",
        recommendedAction: promoted!.recommendedAction,
        sourceSummary: promoted!.draftSeed!.sourceSummary,
        status: "draft"
      })
    );

    await expect(orchestrator.getAutonomousDraftDocumentById(created!.id)).resolves.toEqual(
      expect.objectContaining({
        id: created!.id,
        title: "Refined workflow accountability title"
      })
    );
    await expect(orchestrator.getAutonomousContentWorkItemById(promoted!.id)).resolves.toEqual(
      expect.objectContaining({
        id: promoted!.id,
        title: promoted!.title,
        draftSeed: expect.objectContaining({
          title: promoted!.draftSeed!.title,
          seedText: promoted!.draftSeed!.seedText
        })
      })
    );
  });

  it("updates draft document workflow status explicitly without mutating source draft seed context", async () => {
    orchestrator = new OrchestratorService({ db });

    const audienceWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "public_discussion_source",
      label: "Workflow pain watchlist",
      seedExcerpt: "Operators still patch broken handoffs manually after rollout.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });
    const solutionWatchlist = await orchestrator.createAutonomousWatchlist({
      sourceKind: "article_source",
      label: "Workflow solution watchlist",
      seedExcerpt:
        "The release adds visibility and retry ownership so teams can recover stalled workflows faster.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      isActive: true
    });

    await orchestrator.updateAutonomousWatchlist(audienceWatchlist.id, {
      nextRunAt: "2026-03-16T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-16T00:00:00.000Z");
    await orchestrator.updateAutonomousWatchlist(solutionWatchlist.id, {
      nextRunAt: "2026-03-17T00:00:00.000Z"
    });
    await orchestrator.tickAutonomousScheduler("2026-03-17T00:00:00.000Z");

    const source = (await orchestrator.listAutonomousMatchedOpportunities())[0]!;
    await orchestrator.updateAutonomousMatchedOpportunityReviewState(source.id, {
      reviewState: "saved"
    });
    const promoted = await orchestrator.promoteAutonomousMatchedOpportunity(source.id);
    const created = await orchestrator.createAutonomousDraftDocumentFromWorkItem(promoted!.id);

    const ready = await orchestrator.updateAutonomousDraftDocumentStatus(created!.id, {
      status: "ready"
    });
    const blocked = await orchestrator.updateAutonomousDraftDocumentStatus(created!.id, {
      status: "blocked"
    });

    expect(ready).toEqual(expect.objectContaining({ id: created!.id, status: "ready" }));
    expect(blocked).toEqual(
      expect.objectContaining({
        id: created!.id,
        status: "blocked",
        sourceContentWorkItemId: promoted!.id
      })
    );

    await expect(orchestrator.getAutonomousDraftDocumentById(created!.id)).resolves.toEqual(
      expect.objectContaining({
        id: created!.id,
        status: "blocked"
      })
    );
    await expect(orchestrator.getAutonomousContentWorkItemById(promoted!.id)).resolves.toEqual(
      expect.objectContaining({
        id: promoted!.id,
        draftSeed: expect.objectContaining({
          title: promoted!.draftSeed!.title,
          recommendedAction: promoted!.draftSeed!.recommendedAction
        })
      })
    );
  });

  it("recommendNextMove returns a deterministic coordinated recommendation", async () => {
    const recommendation = await orchestrator.recommendNextMove({
      currentSourceSignal: {
        sourceType: "article",
        title: "Workflow accountability after launch",
        rawSummary: "Launches fail when no one owns the workflow.",
        normalizedSignalText:
          "Workflow accountability breaks after launch when ownership stays vague.",
        suggestedAngle: "workflow_accountability",
        reasoningSummary: "Clear operator-fit post signal.",
        plannerReadyPayload: {
          signalText: "Workflow accountability breaks after launch when ownership stays vague.",
          sourceType: "article"
        }
      },
      currentDecisionPlan: {
        recommendedNextAction: "generate_post_candidate",
        bestAngle: "workflow_accountability",
        contentPriority: "high",
        engagementPriority: "medium",
        publishability: "high",
        confidence: 88,
        decisionMode: "deterministic",
        riskNotes: [],
        reasoningSummary: "High-signal post candidate.",
        suggestedFlow: "post_only",
        shouldEscalateToPost: true,
        shouldEscalateToEngagement: false,
        shouldStoreForLater: false
      },
      growthRhythmPlan: {
        topPostCandidates: [
          {
            id: "queue-1",
            title: "Workflow accountability after launch",
            suggestedAction: "generate_post_candidate",
            priority: "high",
            status: "new"
          }
        ],
        topCommentCandidates: [],
        keepForLater: [],
        weeklyFocus: "Lead with workflow accountability.",
        suggestedCadence: "1 post candidate, 0 engagement opportunities, 0 to revisit later.",
        reasoningSummary: "Post-first rhythm."
      },
      strategyRecommendations: [
        {
          id: "strategy-1",
          title: "Repeat the strongest operator themes",
          priority: "high",
          description: "Workflow accountability is worth repeating."
        }
      ]
    });

    expect(recommendation).toEqual(
      expect.objectContaining({
        recommendedAction: "write_post",
        primaryTarget: expect.stringContaining("Workflow accountability"),
        confidence: expect.any(String)
      })
    );
  });

  it("evaluateFactoryPriority ranks a strong new signal above a weak one", async () => {
    const strongSignal = await db.createSignal({
      title: "Workflow accountability release",
      sourceType: "article",
      rawText:
        "Release notes explain queue ownership, retry recovery, and approval visibility for operators.",
      topicTags: ["workflow-accountability"],
      noveltyHint: "fresh launch signal"
    });
    const weakSignal = await db.createSignal({
      title: "Generic AI note",
      sourceType: "manual_note",
      rawText: "AI matters and teams should think about it.",
      topicTags: ["generic-ai-commentary"],
      noveltyHint: "old note"
    });

    await db.createSignalAnalysis({
      signalId: strongSignal.id,
      relevanceScore: 87,
      whyRelevant: "Strong fit for founder/operator authority positioning.",
      targetAudience: "Founders and operators",
      businessValueSummary: "Strong workflow accountability lesson.",
      painsSolved: ["queue ownership confusion"],
      practicalImplications: ["show retry ownership"],
      recommendedPillar: "workflow_accountability",
      uniquenessScore: 79,
      uniquenessReason: "Specific operational lesson.",
      buildabilityScore: 76,
      buildabilityReason: "Plenty of practical implementation detail.",
      popularityPotentialScore: 74,
      brandGrowthPotentialScore: 85,
      bestAngle: "ownership_gap",
      recommendedFormat: "long_linkedin_post",
      audienceEmphasis: "Founders and operators",
      recommendedPillarFinal: "workflow_accountability"
    });
    await db.createSignalAnalysis({
      signalId: weakSignal.id,
      relevanceScore: 34,
      whyRelevant: "Only loosely relevant.",
      targetAudience: "General AI audience",
      businessValueSummary: "Weak and generic.",
      painsSolved: ["vague AI confusion"],
      practicalImplications: ["none"],
      recommendedPillar: "generic_ai",
      uniquenessScore: 30,
      uniquenessReason: "Not differentiated.",
      buildabilityScore: 28,
      buildabilityReason: "No implementation detail.",
      popularityPotentialScore: 32,
      brandGrowthPotentialScore: 29,
      bestAngle: "generic_ai_commentary",
      recommendedFormat: "short_authority_post",
      audienceEmphasis: "General audience",
      recommendedPillarFinal: "generic_ai"
    });
    await db.upsertMemoryPattern({
      patternType: "source_type",
      patternKey: "source_type:strong:article",
      strengthScore: 14,
      recommendedAction: "repeat"
    });
    await db.upsertMemoryPattern({
      patternType: "topic",
      patternKey: "topic:weak:generic-ai-commentary",
      strengthScore: 16,
      recommendedAction: "deprioritize"
    });

    const result = await orchestrator.evaluateFactoryPriority({
      now: "2026-03-19T14:00:00.000Z"
    });

    expect(result.signals[0]).toEqual(
      expect.objectContaining({
        itemId: strongSignal.id,
        recommendedAction: "run_now",
        priorityLabel: "high"
      })
    );
    expect(result.signals.find((item) => item.itemId === weakSignal.id)).toEqual(
      expect.objectContaining({
        recommendedAction: expect.stringMatching(/deprioritize|skip/),
        priorityLabel: "low"
      })
    );
    expect(result.signals[0]!.priorityScore).toBeGreaterThan(
      result.signals.find((item) => item.itemId === weakSignal.id)!.priorityScore
    );
  });

  it("evaluateFactoryPriority ranks a high-priority candidate above a normal content candidate", async () => {
    const highSignal = await db.createSignal({
      title: "High priority workflow signal",
      sourceType: "article",
      rawText: "Operators need queue ownership and approval recovery.",
      topicTags: ["workflow-accountability"]
    });
    const normalSignal = await db.createSignal({
      title: "Normal content signal",
      sourceType: "article",
      rawText: "Operators need better post-launch visibility.",
      topicTags: ["post-launch-visibility"]
    });
    const highAnalysis = await db.createSignalAnalysis({
      signalId: highSignal.id,
      relevanceScore: 86,
      whyRelevant: "Strong fit.",
      targetAudience: "Founders and operators",
      businessValueSummary: "High priority signal.",
      painsSolved: ["ownership gaps"],
      practicalImplications: ["clarify ownership"],
      recommendedPillar: "workflow_accountability",
      uniquenessScore: 76,
      uniquenessReason: "Specific angle.",
      buildabilityScore: 73,
      buildabilityReason: "Strong detail.",
      popularityPotentialScore: 74,
      brandGrowthPotentialScore: 84,
      bestAngle: "ownership_gap",
      recommendedFormat: "long_linkedin_post",
      audienceEmphasis: "Founders and operators",
      recommendedPillarFinal: "workflow_accountability"
    });
    const normalAnalysis = await db.createSignalAnalysis({
      signalId: normalSignal.id,
      relevanceScore: 72,
      whyRelevant: "Useful but less urgent.",
      targetAudience: "Founders and operators",
      businessValueSummary: "Normal candidate.",
      painsSolved: ["visibility gaps"],
      practicalImplications: ["show state visibility"],
      recommendedPillar: "workflow_accountability",
      uniquenessScore: 64,
      uniquenessReason: "Decent angle.",
      buildabilityScore: 68,
      buildabilityReason: "Moderate detail.",
      popularityPotentialScore: 63,
      brandGrowthPotentialScore: 71,
      bestAngle: "visibility_gap",
      recommendedFormat: "long_linkedin_post",
      audienceEmphasis: "Founders and operators",
      recommendedPillarFinal: "workflow_accountability"
    });
    const highDecision = await db.createOrchestratorDecision({
      signalId: highSignal.id,
      decisionType: "high_priority_candidate",
      decisionReason: "Strong enough for the priority lane.",
      confidenceScore: 90,
      nextAction: "prioritize_for_content",
      requiresHumanReview: true
    });
    const normalDecision = await db.createOrchestratorDecision({
      signalId: normalSignal.id,
      decisionType: "content_candidate",
      decisionReason: "Good content candidate.",
      confidenceScore: 75,
      nextAction: "queue_for_content_review",
      requiresHumanReview: true
    });
    const highIdea = await db.createIdea({
      signalId: highSignal.id,
      title: "High idea",
      coreInsight: "Insight",
      businessRelevance: "Business",
      targetAudience: "Founders and operators",
      status: "draft"
    });
    const normalIdea = await db.createIdea({
      signalId: normalSignal.id,
      title: "Normal idea",
      coreInsight: "Insight",
      businessRelevance: "Business",
      targetAudience: "Founders and operators",
      status: "draft"
    });
    const highContent = await db.createContentAsset({
      ideaId: highIdea.id,
      signalId: highSignal.id,
      signalAnalysisId: highAnalysis.id,
      orchestratorDecisionId: highDecision.id,
      contentType: "linkedin-post",
      hook: "The workflow breaks before the model does",
      body: "Queue ownership matters.",
      cta: "Compare notes.",
      bestAngle: "ownership_gap",
      recommendedFormat: "long_linkedin_post",
      longPostDraft: "Long draft",
      shortPostDraft: "Short draft",
      status: "draft",
      contentStatus: "review",
      publishReadyFlag: true
    });
    const normalContent = await db.createContentAsset({
      ideaId: normalIdea.id,
      signalId: normalSignal.id,
      signalAnalysisId: normalAnalysis.id,
      orchestratorDecisionId: normalDecision.id,
      contentType: "linkedin-post",
      hook: "Visibility matters after launch",
      body: "State visibility matters.",
      cta: "Compare notes.",
      bestAngle: "visibility_gap",
      recommendedFormat: "long_linkedin_post",
      longPostDraft: "Long draft",
      shortPostDraft: "Short draft",
      status: "draft",
      contentStatus: "review",
      publishReadyFlag: false
    });
    const highReview = await db.createWritingQualityAssessment({
      contentAssetId: highContent.id,
      humanToneScore: 84,
      clarityScore: 85,
      groundednessScore: 88,
      antiRobotScore: 87,
      overallScore: 86,
      notes: ["Strong draft"],
      qualityScore: 88,
      genericnessScore: 20,
      businessValueScore: 86,
      differentiationScore: 82,
      publishReadyFlag: true,
      rewriteSuggestions: [],
      criticNotes: "Ready."
    });
    const normalReview = await db.createWritingQualityAssessment({
      contentAssetId: normalContent.id,
      humanToneScore: 76,
      clarityScore: 78,
      groundednessScore: 79,
      antiRobotScore: 80,
      overallScore: 78,
      notes: ["Needs another pass"],
      qualityScore: 74,
      genericnessScore: 38,
      businessValueScore: 72,
      differentiationScore: 68,
      publishReadyFlag: false,
      rewriteSuggestions: ["Tighten the angle"],
      criticNotes: "Needs review."
    });
    await db.createCandidateQueueItem({
      signalId: highSignal.id,
      signalAnalysisId: highAnalysis.id,
      contentAssetId: highContent.id,
      criticReviewId: highReview.id,
      orchestratorDecisionId: highDecision.id,
      candidateType: "high_priority_candidate",
      queueState: "ready_for_review",
      priorityScore: 90,
      priorityLabel: "high",
      whyQueued: "High priority",
      nextAction: "review_for_publication",
      requiresHumanReview: true
    });
    await db.createCandidateQueueItem({
      signalId: normalSignal.id,
      signalAnalysisId: normalAnalysis.id,
      contentAssetId: normalContent.id,
      criticReviewId: normalReview.id,
      orchestratorDecisionId: normalDecision.id,
      candidateType: "content_candidate",
      queueState: "ready_for_review",
      priorityScore: 75,
      priorityLabel: "medium",
      whyQueued: "Content review",
      nextAction: "review_content_candidate",
      requiresHumanReview: true
    });

    const result = await orchestrator.evaluateFactoryPriority({
      now: "2026-03-19T14:00:00.000Z"
    });

    expect(result.candidateQueueItems[0]).toEqual(
      expect.objectContaining({
        candidateType: "high_priority_candidate",
        recommendedAction: "queue_for_review",
        priorityLabel: "high"
      })
    );
    expect(result.candidateQueueItems[1]).toEqual(
      expect.objectContaining({
        candidateType: "content_candidate"
      })
    );
    expect(result.candidateQueueItems[0]!.priorityScore).toBeGreaterThan(
      result.candidateQueueItems[1]!.priorityScore
    );
  });

  it("evaluateFactoryPriority deprioritizes signals with weak matching memory evidence", async () => {
    const signal = await db.createSignal({
      title: "Weak pattern signal",
      sourceType: "manual_note",
      rawText: "Generic AI commentary with little operator value.",
      topicTags: ["generic-ai-commentary"]
    });
    await db.createSignalAnalysis({
      signalId: signal.id,
      relevanceScore: 58,
      whyRelevant: "Directionally relevant.",
      targetAudience: "Founders and operators",
      businessValueSummary: "Needs stronger practical detail.",
      painsSolved: ["generic confusion"],
      practicalImplications: ["none"],
      recommendedPillar: "generic_ai",
      uniquenessScore: 42,
      uniquenessReason: "Weakly differentiated.",
      buildabilityScore: 38,
      buildabilityReason: "Little implementation detail.",
      popularityPotentialScore: 41,
      brandGrowthPotentialScore: 39,
      bestAngle: "generic_ai_commentary",
      recommendedFormat: "short_authority_post",
      audienceEmphasis: "Founders and operators",
      recommendedPillarFinal: "generic_ai"
    });
    await db.upsertMemoryPattern({
      patternType: "topic",
      patternKey: "topic:weak:generic-ai-commentary",
      strengthScore: 24,
      recommendedAction: "deprioritize"
    });
    await db.upsertMemoryPattern({
      patternType: "source_type",
      patternKey: "source_type:weak:manual-note",
      strengthScore: 18,
      recommendedAction: "deprioritize"
    });

    const result = await orchestrator.evaluateFactoryPriority({
      now: "2026-03-19T14:00:00.000Z"
    });
    const decision = result.signals.find((item) => item.itemId === signal.id);

    expect(decision).toEqual(
      expect.objectContaining({
        recommendedAction: "deprioritize",
        priorityLabel: "low",
        memoryInfluenceLabel: "negative"
      })
    );
    expect(decision?.reasonSummary).toMatch(/weak memory/i);
  });

  it("evaluateFactoryPriority recommends retry_later for a blocked signal when retry policy allows it", async () => {
    const signal = await db.createSignal({
      title: "Retryable blocked signal",
      sourceType: "article",
      rawText: "Queue ownership and retry recovery matter."
    });
    await db.createAutonomousRun({
      signalId: signal.id,
      triggerType: "scheduler",
      runType: "signal_pipeline",
      status: "blocked",
      startedAt: "2026-03-19T09:00:00.000Z",
      completedAt: "2026-03-19T09:02:00.000Z",
      errorSummary: "OpenAI tier is required but unavailable.",
      resultSummary: "Blocked on premium provider."
    });

    const result = await orchestrator.evaluateFactoryPriority({
      now: "2026-03-19T10:00:00.000Z"
    });
    const decision = result.signals.find((item) => item.itemId === signal.id);

    expect(decision).toEqual(
      expect.objectContaining({
        recommendedAction: "retry_later",
        recommendedDelayMinutes: 120,
        priorityLabel: "medium"
      })
    );
  });

  it("evaluateFactoryPriority skips repeated failures when retry would be wasteful", async () => {
    const signal = await db.createSignal({
      title: "Wasteful retry signal",
      sourceType: "article",
      rawText: "Queue ownership and retry recovery matter."
    });

    await db.createAutonomousRun({
      signalId: signal.id,
      triggerType: "scheduler",
      runType: "signal_pipeline",
      status: "failed",
      startedAt: "2026-03-19T09:00:00.000Z",
      completedAt: "2026-03-19T09:01:00.000Z",
      errorSummary: "Unhandled runtime exception.",
      resultSummary: "Failed."
    });
    await db.createAutonomousRun({
      signalId: signal.id,
      triggerType: "scheduler",
      runType: "signal_pipeline",
      status: "failed",
      startedAt: "2026-03-19T10:00:00.000Z",
      completedAt: "2026-03-19T10:01:00.000Z",
      errorSummary: "Unhandled runtime exception.",
      resultSummary: "Failed again."
    });
    await db.createAutonomousRun({
      signalId: signal.id,
      triggerType: "scheduler",
      runType: "signal_pipeline",
      status: "failed",
      startedAt: "2026-03-19T11:00:00.000Z",
      completedAt: "2026-03-19T11:01:00.000Z",
      errorSummary: "Unhandled runtime exception.",
      resultSummary: "Failed again."
    });

    const result = await orchestrator.evaluateFactoryPriority({
      now: "2026-03-19T12:00:00.000Z"
    });
    const decision = result.signals.find((item) => item.itemId === signal.id);

    expect(decision).toEqual(
      expect.objectContaining({
        recommendedAction: "skip",
        priorityLabel: "low"
      })
    );
    expect(decision?.reasonSummary).toMatch(/repeated failure/i);
  });

  it("evaluateFactoryPriority recommends rerun_when_window_matches when new memory evidence changes timing context", async () => {
    const signal = await db.createSignal({
      title: "Rerun-worthy signal",
      sourceType: "article",
      rawText: "Queue ownership and approval visibility matter.",
      topicTags: ["workflow-accountability"]
    });
    await db.createSignalAnalysis({
      signalId: signal.id,
      relevanceScore: 79,
      whyRelevant: "Strong fit.",
      targetAudience: "Founders and operators",
      businessValueSummary: "Strong authority content.",
      painsSolved: ["ownership gap"],
      practicalImplications: ["show queue ownership"],
      recommendedPillar: "workflow_accountability",
      uniquenessScore: 70,
      uniquenessReason: "Specific operator framing.",
      buildabilityScore: 68,
      buildabilityReason: "Enough detail.",
      popularityPotentialScore: 74,
      brandGrowthPotentialScore: 82,
      bestAngle: "ownership_gap",
      recommendedFormat: "long_linkedin_post",
      audienceEmphasis: "B2B operators",
      recommendedPillarFinal: "workflow_accountability"
    });
    await db.createAutonomousRun({
      signalId: signal.id,
      triggerType: "scheduler",
      runType: "signal_pipeline",
      status: "completed",
      startedAt: "2026-03-18T14:00:00.000Z",
      completedAt: "2026-03-18T14:05:00.000Z",
      resultSummary: "Completed without queue handoff."
    });
    await db.upsertMemoryPattern({
      patternType: "publish_window",
      patternKey: "publish_window:strong:afternoon",
      strengthScore: 18,
      supportingEvidenceJson: {
        evidenceCount: 2
      },
      recommendedAction: "repeat"
    });

    const result = await orchestrator.evaluateFactoryPriority({
      now: "2026-03-19T09:00:00.000Z"
    });
    const decision = result.signals.find((item) => item.itemId === signal.id);

    expect(decision).toEqual(
      expect.objectContaining({
        recommendedAction: "rerun_when_window_matches",
        timingHint: expect.stringMatching(/afternoon/i),
        memoryInfluenceLabel: "positive"
      })
    );
  });

  it("evaluateFactoryPriority generates timing hints from publish-window memory for queued candidates", async () => {
    const signal = await db.createSignal({
      title: "Timed candidate signal",
      sourceType: "article",
      rawText: "Operators need queue ownership and approval visibility."
    });
    const analysis = await db.createSignalAnalysis({
      signalId: signal.id,
      relevanceScore: 84,
      whyRelevant: "Strong fit.",
      targetAudience: "Founders and operators",
      businessValueSummary: "Strong operator content.",
      painsSolved: ["ownership gap"],
      practicalImplications: ["show ownership"],
      recommendedPillar: "workflow_accountability",
      uniquenessScore: 74,
      uniquenessReason: "Specific operator framing.",
      buildabilityScore: 72,
      buildabilityReason: "Strong detail.",
      popularityPotentialScore: 76,
      brandGrowthPotentialScore: 83,
      bestAngle: "ownership_gap",
      recommendedFormat: "long_linkedin_post",
      audienceEmphasis: "B2B operators",
      recommendedPillarFinal: "workflow_accountability"
    });
    const decision = await db.createOrchestratorDecision({
      signalId: signal.id,
      decisionType: "content_candidate",
      decisionReason: "Ready for content review.",
      confidenceScore: 82,
      nextAction: "queue_for_content_review",
      requiresHumanReview: true
    });
    const idea = await db.createIdea({
      signalId: signal.id,
      title: "Timed idea",
      coreInsight: "Insight",
      businessRelevance: "Business",
      targetAudience: "Founders and operators",
      status: "draft"
    });
    const content = await db.createContentAsset({
      ideaId: idea.id,
      signalId: signal.id,
      signalAnalysisId: analysis.id,
      orchestratorDecisionId: decision.id,
      contentType: "linkedin-post",
      hook: "The workflow breaks before the model does",
      body: "Ownership matters.",
      cta: "Compare notes.",
      bestAngle: "ownership_gap",
      recommendedFormat: "long_linkedin_post",
      longPostDraft: "Long draft",
      shortPostDraft: "Short draft",
      status: "draft",
      contentStatus: "review",
      publishReadyFlag: false
    });
    const review = await db.createWritingQualityAssessment({
      contentAssetId: content.id,
      humanToneScore: 82,
      clarityScore: 83,
      groundednessScore: 84,
      antiRobotScore: 85,
      overallScore: 83,
      notes: ["Good draft"],
      qualityScore: 82,
      genericnessScore: 24,
      businessValueScore: 81,
      differentiationScore: 76,
      publishReadyFlag: true,
      rewriteSuggestions: [],
      criticNotes: "Ready soon."
    });
    await db.createCandidateQueueItem({
      signalId: signal.id,
      signalAnalysisId: analysis.id,
      contentAssetId: content.id,
      criticReviewId: review.id,
      orchestratorDecisionId: decision.id,
      candidateType: "content_candidate",
      queueState: "ready_for_review",
      priorityScore: 82,
      priorityLabel: "high",
      whyQueued: "Review ready",
      nextAction: "review_for_publication",
      requiresHumanReview: true
    });
    await db.upsertMemoryPattern({
      patternType: "publish_window",
      patternKey: "publish_window:strong:afternoon",
      strengthScore: 20,
      recommendedAction: "repeat"
    });

    const result = await orchestrator.evaluateFactoryPriority({
      now: "2026-03-19T09:00:00.000Z"
    });

    expect(result.candidateQueueItems[0]).toEqual(
      expect.objectContaining({
        recommendedAction: "queue_for_review",
        timingHint: expect.stringMatching(/afternoon/i)
      })
    );
  });
});
