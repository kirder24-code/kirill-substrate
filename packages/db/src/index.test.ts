import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentRun,
  AnalyticsSnapshot,
  BrandVoiceProfile,
  ContentQueueItem,
  ContentAsset,
  CriticReview,
  MemoryPattern,
  OrchestratorDecision,
  CreateSignalInput,
  GenerateContentInput,
  GenerateIdeaInput,
  Idea,
  MarketProfile,
  SignalAnalysis,
  Signal,
  SignalSourceToOutputTrail,
  SourceItem,
  SolutionMemory,
  StrategyRecommendation,
  TopicScore,
  VisualAsset,
  WritingQualityAssessment
} from "@linkedin-brand-os/shared";
import { SqliteDatabase } from "./index";

describe("SqliteDatabase repositories", () => {
  let db: SqliteDatabase;
  let dbDir: string;
  let dbPath: string;

  beforeEach(async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-db-"));
    dbPath = join(dbDir, "test.sqlite");
    db = new SqliteDatabase({ databasePath: dbPath });
    await db.initDatabase();
    await db.resetDatabase();
  });

  afterEach(() => {
    vi.useRealTimers();
    db?.close();
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("createSignal stores a signal record", async () => {
    const input: CreateSignalInput = {
      title: "AI procurement friction",
      sourceType: "manual",
      rawText: "Teams need help reframing technical blockers."
    };

    const signal = await db.createSignal(input);

    expect(signal).toEqual({
      id: expect.stringMatching(/^sig-/),
      title: input.title,
      sourceType: input.sourceType,
      rawText: input.rawText,
      status: "new",
      createdAt: expect.any(String)
    });
  });

  it("listSignals returns stored records", async () => {
    await db.createSignal({
      title: "First signal",
      sourceType: "manual",
      rawText: "First raw text"
    });
    await db.createSignal({
      title: "Second signal",
      sourceType: "research",
      rawText: "Second raw text"
    });

    const signals = await db.listSignals();

    expect(signals).toHaveLength(2);
    expect(signals.map((signal) => signal.title)).toEqual([
      "First signal",
      "Second signal"
    ]);
  });

  it("createIdea stores an idea linked to a signal", async () => {
    const signal = await db.createSignal({
      title: "Signal for idea",
      sourceType: "manual",
      rawText: "Signal body"
    });

    const input: GenerateIdeaInput & Omit<Idea, "id" | "createdAt"> = {
      signalId: signal.id,
      title: "Idea title",
      coreInsight: "The core insight",
      businessRelevance: "Business relevance",
      targetAudience: "Founders",
      status: "draft"
    };

    const idea = await db.createIdea(input);

    expect(idea).toEqual({
      id: expect.stringMatching(/^idea-/),
      signalId: signal.id,
      title: "Idea title",
      coreInsight: "The core insight",
      businessRelevance: "Business relevance",
      targetAudience: "Founders",
      status: "draft",
      createdAt: expect.any(String)
    });
  });

  it("listIdeas returns stored ideas", async () => {
    const signal = await db.createSignal({
      title: "Signal",
      sourceType: "manual",
      rawText: "Signal text"
    });

    await db.createIdea({
      signalId: signal.id,
      title: "Idea one",
      coreInsight: "Insight one",
      businessRelevance: "Relevance one",
      targetAudience: "Audience one",
      status: "draft"
    });

    const ideas = await db.listIdeas();

    expect(ideas).toHaveLength(1);
    expect(ideas[0]?.signalId).toBe(signal.id);
    expect(ideas[0]?.title).toBe("Idea one");
  });

  it("createContentAsset stores a content asset linked to an idea", async () => {
    const signal = await db.createSignal({
      title: "Signal",
      sourceType: "manual",
      rawText: "Signal text"
    });
    const idea = await db.createIdea({
      signalId: signal.id,
      title: "Idea",
      coreInsight: "Insight",
      businessRelevance: "Relevance",
      targetAudience: "Audience",
      status: "draft"
    });

    const input: GenerateContentInput & Omit<ContentAsset, "id" | "createdAt"> = {
      ideaId: idea.id,
      contentType: "linkedin-post",
      hook: "Hook",
      body: "Body",
      cta: "CTA",
      status: "draft"
    };

    const asset = await db.createContentAsset(input);

    expect(asset).toEqual({
      id: expect.stringMatching(/^content-/),
      ideaId: idea.id,
      signalId: signal.id,
      contentType: "linkedin-post",
      hook: "Hook",
      body: "Body",
      cta: "CTA",
      status: "draft",
      createdAt: expect.any(String)
    });
  });

  it("listContentAssets returns stored content assets", async () => {
    const signal = await db.createSignal({
      title: "Signal",
      sourceType: "manual",
      rawText: "Signal text"
    });
    const idea = await db.createIdea({
      signalId: signal.id,
      title: "Idea",
      coreInsight: "Insight",
      businessRelevance: "Relevance",
      targetAudience: "Audience",
      status: "draft"
    });
    await db.createContentAsset({
      ideaId: idea.id,
      contentType: "linkedin-post",
      hook: "Hook",
      body: "Body",
      cta: "CTA",
      status: "draft"
    });

    const assets = await db.listContentAssets();

    expect(assets).toHaveLength(1);
    expect(assets[0]?.ideaId).toBe(idea.id);
    expect(assets[0]?.hook).toBe("Hook");
  });

  it("get methods return stored records by id", async () => {
    const signal = await db.createSignal({
      title: "Signal",
      sourceType: "manual",
      rawText: "Signal text"
    });
    const idea = await db.createIdea({
      signalId: signal.id,
      title: "Idea",
      coreInsight: "Insight",
      businessRelevance: "Relevance",
      targetAudience: "Audience",
      status: "draft"
    });
    const content = await db.createContentAsset({
      ideaId: idea.id,
      contentType: "linkedin-post",
      hook: "Hook",
      body: "Body",
      cta: "CTA",
      status: "draft"
    });

    await expect(db.getSignalById(signal.id)).resolves.toEqual(signal);
    await expect(db.getIdeaById(idea.id)).resolves.toEqual(idea);
    await expect(db.getContentAssetById(content.id)).resolves.toEqual(content);
  });

  it("updateContentAssetRefinement persists refinement fields", async () => {
    const signal = await db.createSignal({
      title: "Signal",
      sourceType: "manual",
      rawText: "Signal text"
    });
    const idea = await db.createIdea({
      signalId: signal.id,
      title: "Idea",
      coreInsight: "Insight",
      businessRelevance: "Relevance",
      targetAudience: "Audience",
      status: "draft"
    });
    const content = await db.createContentAsset({
      ideaId: idea.id,
      contentType: "linkedin-post",
      hook: "Hook",
      body: "Body",
      cta: "CTA",
      status: "draft"
    });

    const updated = await db.updateContentAssetRefinement(content.id, {
      refinedHook: "Refined hook",
      refinedBody: "Refined body",
      refinedCta: "Refined CTA",
      refinementStatus: "refined"
    });

    expect(updated).toEqual({
      ...content,
      refinedHook: "Refined hook",
      refinedBody: "Refined body",
      refinedCta: "Refined CTA",
      refinementStatus: "refined"
    });
    await expect(db.getContentAssetById(content.id)).resolves.toEqual(updated);
  });

  it("updateContentAssetFinalPost persists final post fields separately from refinement", async () => {
    const signal = await db.createSignal({
      title: "Signal",
      sourceType: "manual",
      rawText: "Signal text"
    });
    const idea = await db.createIdea({
      signalId: signal.id,
      title: "Idea",
      coreInsight: "Insight",
      businessRelevance: "Relevance",
      targetAudience: "Audience",
      status: "draft"
    });
    const content = await db.createContentAsset({
      ideaId: idea.id,
      contentType: "linkedin-post",
      hook: "Hook",
      body: "Body",
      cta: "CTA",
      status: "draft"
    });
    await db.updateContentAssetRefinement(content.id, {
      refinedHook: "Refined hook",
      refinedBody: "Refined body",
      refinedCta: "Refined CTA",
      refinementStatus: "refined"
    });

    const updated = await db.updateContentAssetFinalPost(content.id, {
      finalHook: "Final hook",
      finalBody: "Final body",
      finalClosing: "Final closing",
      finalStatus: "ready",
      finalQualityScore: 91
    });

    expect(updated).toEqual({
      ...content,
      refinedHook: "Refined hook",
      refinedBody: "Refined body",
      refinedCta: "Refined CTA",
      refinementStatus: "refined",
      finalHook: "Final hook",
      finalBody: "Final body",
      finalClosing: "Final closing",
      finalStatus: "ready",
      finalQualityScore: 91
    });
    await expect(db.getContentAssetById(content.id)).resolves.toEqual(updated);
  });

  it("createVisualAsset and listVisualAssets persist visual briefs", async () => {
    const visual = await db.createVisualAsset({
      contentAssetId: "content-1",
      title: "Carousel concept",
      visualType: "single-image",
      prompt: "A clean editorial visual about operational AI rollout.",
      status: "ready"
    });

    const visuals = await db.listVisualAssets();

    expect(visual).toEqual<VisualAsset>({
      id: expect.stringMatching(/^visual-/),
      contentAssetId: "content-1",
      title: "Carousel concept",
      visualType: "single-image",
      prompt: "A clean editorial visual about operational AI rollout.",
      status: "ready",
      createdAt: expect.any(String)
    });
    expect(visuals).toEqual([visual]);
  });

  it("createAnalyticsSnapshot and listAnalyticsSnapshots persist analytics data", async () => {
    const snapshot = await db.createAnalyticsSnapshot({
      contentAssetId: "content-1",
      impressions: 1500,
      likes: 78,
      comments: 12,
      saves: 9,
      profileViews: 27,
      followersGained: 5
    });

    const snapshots = await db.listAnalyticsSnapshots();

    expect(snapshot).toEqual<AnalyticsSnapshot>({
      id: expect.stringMatching(/^analytics-/),
      contentAssetId: "content-1",
      impressions: 1500,
      likes: 78,
      comments: 12,
      saves: 9,
      profileViews: 27,
      followersGained: 5,
      createdAt: expect.any(String)
    });
    expect(snapshots).toEqual([snapshot]);
  });

  it("createStrategyRecommendation and listStrategyRecommendations persist recommendations", async () => {
    const recommendation = await db.createStrategyRecommendation({
      type: "format",
      title: "Visuals are increasing engagement",
      description: "Posts with strong visual briefs should get priority.",
      priority: "medium"
    });

    const recommendations = await db.listStrategyRecommendations();

    expect(recommendation).toEqual<StrategyRecommendation>({
      id: expect.stringMatching(/^strategy-/),
      type: "format",
      title: "Visuals are increasing engagement",
      description: "Posts with strong visual briefs should get priority.",
      priority: "medium",
      createdAt: expect.any(String)
    });
    expect(recommendations).toEqual([recommendation]);
  });

  it("createSourceItem and listSourceItems persist normalized source intake", async () => {
    const source = await db.createSourceItem({
      title: "Public article on AI operations",
      sourceType: "article",
      sourceUrl: "https://example.com/article",
      rawText: "Operators want more grounded rollout examples.",
      normalizedSummary: "Public article about grounded AI rollout examples.",
      tags: ["ai", "operations"],
      status: "normalized"
    });

    const sources = await db.listSourceItems();

    expect(source).toEqual<SourceItem>({
      id: expect.stringMatching(/^source-/),
      title: "Public article on AI operations",
      sourceType: "article",
      sourceUrl: "https://example.com/article",
      rawText: "Operators want more grounded rollout examples.",
      normalizedSummary: "Public article about grounded AI rollout examples.",
      tags: ["ai", "operations"],
      status: "normalized",
      createdAt: expect.any(String)
    });
    expect(sources).toEqual([source]);
  });

  it("createMarketProfile and listMarketProfiles persist market intelligence", async () => {
    const market = await db.createMarketProfile({
      country: "Canada",
      region: "North America",
      primaryLanguage: "English",
      marketNote: "High fit for B2B operator content.",
      linkedinPriority: "high",
      serviceFitScore: 80
    });

    const markets = await db.listMarketProfiles();

    expect(market).toEqual<MarketProfile>({
      id: expect.stringMatching(/^market-/),
      country: "Canada",
      region: "North America",
      primaryLanguage: "English",
      marketNote: "High fit for B2B operator content.",
      linkedinPriority: "high",
      serviceFitScore: 80,
      createdAt: expect.any(String)
    });
    expect(markets).toEqual([market]);
  });

  it("createTopicScore and listTopicScores persist scored topics", async () => {
    const score = await db.createTopicScore({
      topicLabel: "AI rollout operations",
      sourceItemId: "source-1",
      marketProfileId: "market-1",
      brandRelevanceScore: 82,
      marketRelevanceScore: 76,
      noveltyScore: 63,
      priorityScore: 77,
      rationale: "Strong operator fit in a high-priority market."
    });

    const scores = await db.listTopicScores();

    expect(score).toEqual<TopicScore>({
      id: expect.stringMatching(/^topic-/),
      topicLabel: "AI rollout operations",
      sourceItemId: "source-1",
      marketProfileId: "market-1",
      brandRelevanceScore: 82,
      marketRelevanceScore: 76,
      noveltyScore: 63,
      priorityScore: 77,
      rationale: "Strong operator fit in a high-priority market.",
      createdAt: expect.any(String)
    });
    expect(scores).toEqual([score]);
  });

  it("createContentQueueItem and listContentQueueItems persist queue records", async () => {
    const queueItem = await db.createContentQueueItem({
      topicScoreId: "topic-1",
      recommendedAction: "write_post",
      priority: "high",
      reason: "Highest-value topic score in the backlog.",
      status: "queued"
    });

    const queue = await db.listContentQueueItems();

    expect(queueItem).toEqual<ContentQueueItem>({
      id: expect.stringMatching(/^queue-/),
      topicScoreId: "topic-1",
      recommendedAction: "write_post",
      priority: "high",
      reason: "Highest-value topic score in the backlog.",
      status: "queued",
      createdAt: expect.any(String)
    });
    expect(queue).toEqual([queueItem]);
  });

  it("createBrandVoiceProfile, listBrandVoiceProfiles, and getActiveBrandVoiceProfile persist brand voice", async () => {
    const first = await db.createBrandVoiceProfile({
      name: "Legacy Voice",
      tone: "Direct",
      audience: "Operators",
      writingRules: ["Be direct"],
      bannedPatterns: ["generic hype"],
      preferredPatterns: ["operational payoff"],
      styleNotes: "Keep it practical.",
      isActive: false
    });
    const active = await db.createBrandVoiceProfile({
      name: "Grounded Operator Voice",
      tone: "Direct, practical, calm",
      audience: "Founders and operator-led teams",
      writingRules: ["Lead with specifics", "Use plain business language"],
      bannedPatterns: ["AI is changing everything"],
      preferredPatterns: ["practical rollout"],
      styleNotes: "Keep sentences varied.",
      isActive: true
    });

    await expect(db.listBrandVoiceProfiles()).resolves.toEqual([first, active]);
    await expect(db.getActiveBrandVoiceProfile()).resolves.toEqual(active);
  });

  it("updateBrandVoiceProfile switches the active voice safely", async () => {
    const voice = await db.createBrandVoiceProfile({
      name: "Grounded Operator Voice",
      tone: "Direct",
      audience: "Operators",
      writingRules: ["Be specific"],
      bannedPatterns: ["hype"],
      preferredPatterns: ["proof"],
      styleNotes: "Keep it grounded.",
      isActive: true
    });

    const updated = await db.updateBrandVoiceProfile(voice.id, {
      tone: "Direct, practical, calm",
      styleNotes: "Use short paragraphs and concrete examples.",
      isActive: true
    });

    expect(updated).toEqual<BrandVoiceProfile>({
      ...voice,
      tone: "Direct, practical, calm",
      styleNotes: "Use short paragraphs and concrete examples.",
      updatedAt: expect.any(String)
    });
  });

  it("createWritingQualityAssessment and listWritingQualityAssessments persist review records", async () => {
    const assessment = await db.createWritingQualityAssessment({
      contentAssetId: "content-1",
      humanToneScore: 81,
      clarityScore: 83,
      groundednessScore: 88,
      antiRobotScore: 79,
      overallScore: 83,
      notes: ["Strong clarity", "Avoid one vague claim"]
    });

    expect(assessment).toEqual<WritingQualityAssessment>({
      id: expect.stringMatching(/^quality-/),
      contentAssetId: "content-1",
      humanToneScore: 81,
      clarityScore: 83,
      groundednessScore: 88,
      antiRobotScore: 79,
      overallScore: 83,
      notes: ["Strong clarity", "Avoid one vague claim"],
      createdAt: expect.any(String)
    });
    await expect(db.listWritingQualityAssessments()).resolves.toEqual([assessment]);
  });

  it("preserves record links across signal, idea, content, visual, analytics, strategy, source, topic, and queue", async () => {
    const signal = await db.createSignal({
      title: "Signal",
      sourceType: "manual",
      rawText: "Signal text"
    });
    const idea = await db.createIdea({
      signalId: signal.id,
      title: "Idea",
      coreInsight: "Insight",
      businessRelevance: "Relevance",
      targetAudience: "Audience",
      status: "draft"
    });
    const content = await db.createContentAsset({
      ideaId: idea.id,
      contentType: "linkedin-post",
      hook: "Hook",
      body: "Body",
      cta: "CTA",
      status: "draft"
    });
    const visual = await db.createVisualAsset({
      contentAssetId: content.id,
      title: "Visual",
      visualType: "single-image",
      prompt: "Prompt",
      status: "ready"
    });
    const analytics = await db.createAnalyticsSnapshot({
      contentAssetId: content.id,
      impressions: 1000,
      likes: 50,
      comments: 8,
      saves: 6,
      profileViews: 20,
      followersGained: 3
    });
    const recommendation = await db.createStrategyRecommendation({
      type: "messaging",
      title: "Lean into operations",
      description: "Operational posts perform best.",
      priority: "high"
    });
    const source = await db.createSourceItem({
      title: "Source",
      sourceType: "article",
      sourceUrl: "https://example.com/source",
      rawText: "Source text",
      normalizedSummary: "Source summary",
      tags: ["operations"],
      status: "normalized"
    });
    const score = await db.createTopicScore({
      topicLabel: "Operations topic",
      sourceItemId: source.id,
      ideaId: idea.id,
      marketProfileId: "market-1",
      brandRelevanceScore: 80,
      marketRelevanceScore: 75,
      noveltyScore: 60,
      priorityScore: 74,
      rationale: "Strong fit."
    });
    const queueItem = await db.createContentQueueItem({
      topicScoreId: score.id,
      recommendedAction: "write_post",
      priority: "high",
      reason: "Top priority",
      status: "queued"
    });

    expect(idea.signalId).toBe(signal.id);
    expect(content.ideaId).toBe(idea.id);
    expect(visual.contentAssetId).toBe(content.id);
    expect(analytics.contentAssetId).toBe(content.id);
    expect(recommendation.id).toMatch(/^strategy-/);
    expect(score.sourceItemId).toBe(source.id);
    expect(score.ideaId).toBe(idea.id);
    expect(queueItem.topicScoreId).toBe(score.id);
  });

  it("records survive repository re-instantiation against the same SQLite file", async () => {
    const firstDb = new SqliteDatabase({ databasePath: dbPath });
    await firstDb.initDatabase();
    await firstDb.resetDatabase();

    const signal = await firstDb.createSignal({
      title: "Persistent signal",
      sourceType: "manual",
      rawText: "Persistent text"
    });

    const secondDb = new SqliteDatabase({ databasePath: dbPath });
    await secondDb.initDatabase();

    await expect(secondDb.listSignals()).resolves.toEqual([signal]);
    firstDb.close();
    secondDb.close();
  });

  it("upgrades older local SQLite files additively for current factory schema columns", async () => {
    db.close();

    const legacyDbPath = join(dbDir, "legacy.sqlite");
    const legacyClient = new Database(legacyDbPath);

    legacyClient.exec(`
      CREATE TABLE signals (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        source_type TEXT NOT NULL,
        raw_text TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE signal_analyses (
        id TEXT PRIMARY KEY,
        signal_id TEXT NOT NULL,
        relevance_score REAL NOT NULL,
        why_relevant TEXT NOT NULL,
        target_audience TEXT NOT NULL,
        business_value_summary TEXT NOT NULL,
        pains_solved_json TEXT NOT NULL,
        practical_implications_json TEXT NOT NULL,
        overhype_notes TEXT,
        recommended_pillar TEXT,
        uniqueness_score REAL NOT NULL,
        uniqueness_reason TEXT NOT NULL,
        buildability_score REAL NOT NULL,
        buildability_reason TEXT NOT NULL,
        popularity_potential_score REAL NOT NULL,
        brand_growth_potential_score REAL NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE solution_memories (
        id TEXT PRIMARY KEY,
        signal_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        implementation_potential TEXT NOT NULL,
        implementation_complexity TEXT NOT NULL,
        detected_stack_json TEXT NOT NULL,
        key_features_json TEXT NOT NULL,
        architecture_clues_json TEXT NOT NULL,
        deployment_hints_json TEXT NOT NULL,
        client_fit_types_json TEXT NOT NULL,
        possible_use_cases_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE autonomous_runs (
        id TEXT PRIMARY KEY,
        watchlist_id TEXT,
        trigger_type TEXT NOT NULL,
        run_type TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        error_summary TEXT,
        result_summary TEXT,
        result_metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    legacyClient
      .prepare(
        `INSERT INTO signal_analyses (
          id, signal_id, relevance_score, why_relevant, target_audience, business_value_summary,
          pains_solved_json, practical_implications_json, overhype_notes, recommended_pillar,
          uniqueness_score, uniqueness_reason, buildability_score, buildability_reason,
          popularity_potential_score, brand_growth_potential_score, created_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )`
      )
      .run(
        "legacy-analysis-1",
        "legacy-signal-1",
        71,
        "Still relevant for operators.",
        "Founders",
        "Shows where handoffs break.",
        "[]",
        "[]",
        null,
        null,
        60,
        "Common problem, still useful.",
        72,
        "Easy to implement.",
        68,
        74,
        "2026-03-17T00:00:00.000Z"
      );

    legacyClient.close();

    db = new SqliteDatabase({ databasePath: legacyDbPath });
    await db.initDatabase();

    const legacyAnalyses = await db.listSignalAnalyses();
    expect(legacyAnalyses).toEqual([
      expect.objectContaining({
        id: "legacy-analysis-1",
        bestAngle: undefined,
        recommendedFormat: undefined,
        audienceEmphasis: undefined
      })
    ]);

    const signal = await db.createSignal({
      title: "Schema repair signal",
      sourceType: "manual",
      rawText: "This should persist with the repaired schema."
    });

    const analysis = await db.createSignalAnalysis({
      signalId: signal.id,
      relevanceScore: 88,
      whyRelevant: "Tests additive schema repair.",
      targetAudience: "Operators",
      businessValueSummary: "Confirms old DBs can persist new reasoning fields.",
      painsSolved: ["avoids forced DB resets"],
      practicalImplications: ["safe local upgrades"],
      overhypeNotes: "No hype needed.",
      recommendedPillar: "operations",
      uniquenessScore: 64,
      uniquenessReason: "Useful operational fix.",
      buildabilityScore: 91,
      buildabilityReason: "Pure additive migration.",
      popularityPotentialScore: 52,
      brandGrowthPotentialScore: 66,
      bestAngle: "Repair local schema drift before it blocks trust.",
      alternativeAnglesJson: ["Why local upgrades matter"],
      recommendedFormat: "long_linkedin_post",
      audienceEmphasis: "operators",
      toneGuidance: "direct",
      recommendedPillarFinal: "operations",
      reasoningJson: { repaired: true }
    });

    const solutionMemory = await db.createSolutionMemory({
      signalId: signal.id,
      sourceType: "manual",
      implementationPotential: "high",
      implementationComplexity: "low",
      detectedStack: ["typescript", "sqlite"],
      keyFeatures: ["additive repair"],
      architectureClues: ["startup schema pass"],
      deploymentHints: ["safe on repeated boot"],
      clientFitTypes: ["local operator teams"],
      possibleUseCases: ["repair local DB drift"],
      adaptationNotes: "Applies on init.",
      repoReference: "local-db-schema-repair",
      readmeSnapshot: "Schema upgrade notes",
      implementationNotes: "Adds missing columns in place."
    });

    const signalRun = await db.createAutonomousRun({
      signalId: signal.id,
      triggerType: "manual",
      runType: "signal_pipeline",
      status: "queued"
    });

    expect(analysis.bestAngle).toBe("Repair local schema drift before it blocks trust.");
    expect(solutionMemory.repoReference).toBe("local-db-schema-repair");
    expect(signalRun.signalId).toBe(signal.id);

    db.close();
    db = new SqliteDatabase({ databasePath: legacyDbPath });
    await db.initDatabase();

    await expect(db.listSignalAnalyses()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "legacy-analysis-1" }),
        expect.objectContaining({ id: analysis.id, bestAngle: analysis.bestAngle })
      ])
    );

    const repairedClient = new Database(legacyDbPath, { readonly: true });
    const repairedSignalAnalysisColumns = (
      repairedClient.prepare("PRAGMA table_info(signal_analyses)").all() as Array<{ name: string }>
    ).map((column) => column.name);
    const repairedSolutionMemoryColumns = (
      repairedClient.prepare("PRAGMA table_info(solution_memories)").all() as Array<{ name: string }>
    ).map((column) => column.name);
    const repairedAutonomousRunColumns = (
      repairedClient.prepare("PRAGMA table_info(autonomous_runs)").all() as Array<{ name: string }>
    ).map((column) => column.name);
    repairedClient.close();

    expect(repairedSignalAnalysisColumns).toEqual(
      expect.arrayContaining([
        "best_angle",
        "alternative_angles_json",
        "recommended_format",
        "audience_emphasis",
        "tone_guidance",
        "recommended_pillar_final",
        "reasoning_json"
      ])
    );
    expect(repairedSolutionMemoryColumns).toEqual(
      expect.arrayContaining([
        "adaptation_notes",
        "repo_reference",
        "readme_snapshot",
        "implementation_notes"
      ])
    );
    expect(repairedAutonomousRunColumns).toEqual(expect.arrayContaining(["signal_id"]));
  });

  it("persists server-side autonomous watchlists independently of browser-local state", async () => {
    const created = await db.createAutonomousWatchlist({
      sourceKind: "public_discussion_source",
      label: "Workflow pain watchlist",
      sourceUrl: "https://example.com/discussions/workflow",
      notes: "Used for deterministic scheduler runs.",
      seedExcerpt: "Operators still patch launch handoffs manually.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      priority: "high",
      isActive: true
    });

    const updated = await db.updateAutonomousWatchlist(created.id, {
      lastRunAt: "2026-03-16T00:00:00.000Z",
      nextRunAt: "2026-03-17T00:00:00.000Z"
    });

    expect(created.id).toMatch(/^auto-watch-/);
    expect(updated).toEqual(
      expect.objectContaining({
        id: created.id,
        label: "Workflow pain watchlist",
        refreshCadence: "daily_candidate",
        lastRunAt: "2026-03-16T00:00:00.000Z",
        nextRunAt: "2026-03-17T00:00:00.000Z"
      })
    );

    await expect(db.listAutonomousWatchlists()).resolves.toEqual([
      expect.objectContaining({
        id: created.id,
        seedExcerpt: "Operators still patch launch handoffs manually."
      })
    ]);
  });

  it("persists autonomous runs and records safe status transitions", async () => {
    const watchlist = await db.createAutonomousWatchlist({
      sourceKind: "github_release",
      label: "Workflow repo releases",
      sourceUrl: "https://github.com/example/repo/releases",
      seedExcerpt: "Release notes mention retry ownership and status visibility.",
      refreshCadence: "weekly_candidate",
      isActive: true
    });

    const queued = await db.createAutonomousRun({
      watchlistId: watchlist.id,
      triggerType: "scheduler",
      runType: "watchlist_scout_feed",
      status: "queued"
    });

    const running = await db.updateAutonomousRun(queued.id, {
      status: "running",
      startedAt: "2026-03-16T00:00:00.000Z"
    });
    const completed = await db.updateAutonomousRun(queued.id, {
      status: "completed",
      completedAt: "2026-03-16T00:00:02.000Z",
      resultSummary: "1 solution item surfaced for operator review.",
      resultMetadata: {
        audienceItemCount: 0,
        solutionItemCount: 1,
        usedAi: false
      }
    });

    expect(queued.id).toMatch(/^auto-run-/);
    expect(running?.status).toBe("running");
    expect(completed).toEqual(
      expect.objectContaining({
        status: "completed",
        resultSummary: "1 solution item surfaced for operator review.",
        resultMetadata: {
          audienceItemCount: 0,
          solutionItemCount: 1,
          usedAi: false
        }
      })
    );

    await expect(db.findActiveAutonomousRunForWatchlist(watchlist.id)).resolves.toBeNull();
    await expect(db.listAutonomousRuns()).resolves.toEqual([
      expect.objectContaining({
        id: queued.id,
        watchlistId: watchlist.id,
        status: "completed"
      })
    ]);
  });

  it("persists signal-pipeline autonomous runs with signal linkage and partial outcomes", async () => {
    const signal = await db.createSignal({
      title: "Signal pipeline seed",
      sourceType: "manual_note",
      rawText: "Operators need queue visibility and exception ownership."
    });

    const queued = await db.createAutonomousRun({
      signalId: signal.id,
      triggerType: "manual",
      runType: "signal_pipeline",
      status: "queued"
    });

    const running = await db.updateAutonomousRun(queued.id, {
      status: "running",
      startedAt: "2026-03-16T00:00:00.000Z"
    });
    const partial = await db.updateAutonomousRun(queued.id, {
      status: "partial",
      completedAt: "2026-03-16T00:00:04.000Z",
      resultSummary: "Decision completed but content generation was skipped.",
      resultMetadata: {
        audienceItemCount: 0,
        solutionItemCount: 0,
        usedAi: true,
        stageOrder: [
          "analyze_signal",
          "position_signal_and_decide",
          "generate_content_asset",
          "review_content_asset",
          "enqueue_candidate"
        ],
        stagesAttempted: ["analyze_signal", "position_signal_and_decide"],
        stagesCompleted: ["analyze_signal", "position_signal_and_decide"],
        stagesBlocked: [],
        stagesFailed: [],
        producedSignalAnalysisId: "signal-analysis-1",
        producedSolutionMemoryId: "solution-memory-1",
        producedOrchestratorDecisionId: "decision-1"
      }
    });

    expect(running?.status).toBe("running");
    expect(partial).toEqual(
      expect.objectContaining({
        signalId: signal.id,
        runType: "signal_pipeline",
        status: "partial",
        resultMetadata: expect.objectContaining({
          producedSignalAnalysisId: "signal-analysis-1",
          stagesCompleted: ["analyze_signal", "position_signal_and_decide"]
        })
      })
    );

    await expect(db.findActiveAutonomousRunForSignal(signal.id)).resolves.toBeNull();
  });

  it("persists autonomous ingestion artifacts for server-side automated intake", async () => {
    const watchlist = await db.createAutonomousWatchlist({
      sourceKind: "article_source",
      label: "Workflow article watchlist",
      sourceUrl: "https://example.com/article",
      seedExcerpt: "Teams still patch broken handoffs manually after launch.",
      refreshCadence: "daily_candidate",
      isActive: true
    });
    const run = await db.createAutonomousRun({
      watchlistId: watchlist.id,
      triggerType: "scheduler",
      runType: "watchlist_scout_feed",
      status: "running"
    });

    const artifact = await db.createAutonomousIngestionArtifact({
      watchlistId: watchlist.id,
      autonomousRunId: run.id,
      sourceType: "article",
      sourceUrl: "https://example.com/article",
      title: "Workflow failures after launch",
      rawText: "Teams still patch broken handoffs manually after launch.",
      normalizedSignalText:
        "Teams still patch broken handoffs manually after launch because ownership stays vague.",
      suggestedAngle: "ownership_gap",
      reasoningSummary: "The source points to a recurring ownership gap after rollout.",
      status: "ingested"
    });

    await expect(db.listAutonomousIngestionArtifacts()).resolves.toEqual([
      expect.objectContaining({
        id: artifact.id,
        watchlistId: watchlist.id,
        autonomousRunId: run.id,
        status: "ingested"
      })
    ]);
  });

  it("persists autonomous review queue items and upserts deterministic duplicates", async () => {
    const watchlist = await db.createAutonomousWatchlist({
      sourceKind: "article_source",
      label: "Workflow article watchlist",
      sourceUrl: "https://example.com/article",
      seedExcerpt: "Teams still patch broken handoffs manually after launch.",
      refreshCadence: "daily_candidate",
      isActive: true
    });
    const firstRun = await db.createAutonomousRun({
      watchlistId: watchlist.id,
      triggerType: "scheduler",
      runType: "watchlist_scout_feed",
      status: "completed"
    });
    const secondRun = await db.createAutonomousRun({
      watchlistId: watchlist.id,
      triggerType: "scheduler",
      runType: "watchlist_scout_feed",
      status: "completed"
    });

    const created = await db.upsertAutonomousReviewQueueItem({
      watchlistId: watchlist.id,
      autonomousRunId: firstRun.id,
      sourceKind: "solution",
      dedupeKey:
        "auto-watch-1:solution:visibility and recovery ownership pattern:write_post",
      title: "Visibility and recovery ownership pattern",
      summary: "Expose status and one recovery owner when workflows stall.",
      rationale: "Useful operator lesson for review.",
      recommendedAction: "write_post"
    });
    const updated = await db.upsertAutonomousReviewQueueItem({
      watchlistId: watchlist.id,
      autonomousRunId: secondRun.id,
      sourceKind: "solution",
      dedupeKey:
        "auto-watch-1:solution:visibility and recovery ownership pattern:write_post",
      title: "Visibility and recovery ownership pattern",
      summary: "Expose status and one recovery owner when workflows stall.",
      rationale: "Still a useful operator lesson for review.",
      recommendedAction: "write_post"
    });

    expect(updated.id).toBe(created.id);
    expect(updated.autonomousRunId).toBe(secondRun.id);
    expect(updated.rationale).toBe("Still a useful operator lesson for review.");

    await expect(db.listAutonomousReviewQueueItems()).resolves.toEqual([
      expect.objectContaining({
        id: created.id,
        watchlistId: watchlist.id,
        recommendedAction: "write_post"
      })
    ]);
  });

  it("persists autonomous matched opportunities and upserts deterministic duplicates", async () => {
    const watchlist = await db.createAutonomousWatchlist({
      sourceKind: "article_source",
      label: "Workflow article watchlist",
      sourceUrl: "https://example.com/article",
      seedExcerpt: "Teams still patch broken handoffs manually after launch.",
      refreshCadence: "daily_candidate",
      isActive: true
    });
    const firstRun = await db.createAutonomousRun({
      watchlistId: watchlist.id,
      triggerType: "scheduler",
      runType: "watchlist_scout_feed",
      status: "completed"
    });
    const secondRun = await db.createAutonomousRun({
      watchlistId: watchlist.id,
      triggerType: "scheduler",
      runType: "watchlist_scout_feed",
      status: "completed"
    });

    const created = await db.upsertAutonomousMatchedOpportunity({
      watchlistId: watchlist.id,
      autonomousRunId: firstRun.id,
      audienceQueueItemId: "review-1",
      solutionQueueItemId: "review-2",
      dedupeKey: "review-1:review-2",
      title: "Broken handoffs + visibility and recovery ownership",
      matchedPain: "Operators still patch broken handoffs manually",
      matchedSolutionPattern: "Visibility and recovery ownership pattern",
      matchRationale:
        "The solution directly addresses the same ownership gap surfaced by the audience pain.",
      suggestedAngle: "workflow_accountability",
      recommendedAction: "write_post",
      priorityScore: 88,
      priorityBand: "high",
      reasonLines: [
        "High-confidence match with strong opportunity strength.",
        "Write-post urgency keeps this pair near the top of the review order."
      ],
      confidence: "high",
      opportunityStrength: "strong",
      scoreNotes: ["High keyword overlap"]
    });
    const updated = await db.upsertAutonomousMatchedOpportunity({
      watchlistId: watchlist.id,
      autonomousRunId: secondRun.id,
      audienceQueueItemId: "review-1",
      solutionQueueItemId: "review-2",
      dedupeKey: "review-1:review-2",
      title: "Broken handoffs + visibility and recovery ownership",
      matchedPain: "Operators still patch broken handoffs manually",
      matchedSolutionPattern: "Visibility and recovery ownership pattern",
      matchRationale:
        "The solution still directly addresses the same ownership gap surfaced by the audience pain.",
      suggestedAngle: "workflow_accountability",
      recommendedAction: "write_post",
      priorityScore: 92,
      priorityBand: "high",
      reasonLines: [
        "High-confidence match with strong opportunity strength.",
        "Write-post urgency keeps this pair near the top of the review order.",
        "Match evidence includes 2 supporting score notes."
      ],
      confidence: "high",
      opportunityStrength: "strong",
      scoreNotes: ["High keyword overlap", "Both sides are actionable"]
    });
    await db.upsertAutonomousMatchedOpportunity({
      watchlistId: watchlist.id,
      autonomousRunId: secondRun.id,
      audienceQueueItemId: "review-3",
      solutionQueueItemId: "review-4",
      dedupeKey: "review-3:review-4",
      title: "Secondary workflow note + lightweight pattern",
      matchedPain: "Operators mention a weaker workflow note",
      matchedSolutionPattern: "Lightweight pattern",
      matchRationale: "The overlap exists but is weaker.",
      suggestedAngle: "operational_roi",
      recommendedAction: "save_for_later",
      priorityScore: 28,
      priorityBand: "low",
      reasonLines: [
        "Low-confidence match with weak opportunity strength.",
        "Save-for-later review value keeps this pair near the top of the review order."
      ],
      confidence: "low",
      opportunityStrength: "weak"
    });

    expect(updated.id).toBe(created.id);
    expect(updated.autonomousRunId).toBe(secondRun.id);
    expect(updated.priorityScore).toBe(92);
    expect(updated.priorityBand).toBe("high");
    expect(updated.reviewState).toBe("new");
    expect(updated.reasonLines).toEqual([
      "High-confidence match with strong opportunity strength.",
      "Write-post urgency keeps this pair near the top of the review order.",
      "Match evidence includes 2 supporting score notes."
    ]);
    expect(updated.scoreNotes).toEqual(["High keyword overlap", "Both sides are actionable"]);

    await expect(db.listAutonomousMatchedOpportunities()).resolves.toEqual([
      expect.objectContaining({
        id: created.id,
        watchlistId: watchlist.id,
        recommendedAction: "write_post",
        priorityScore: 92,
        priorityBand: "high"
      }),
      expect.objectContaining({
        watchlistId: watchlist.id,
        recommendedAction: "save_for_later",
        priorityScore: 28,
        priorityBand: "low"
      })
    ]);
  });

  it("persists autonomous matched opportunity triage state independently of ranking fields", async () => {
    const watchlist = await db.createAutonomousWatchlist({
      sourceKind: "article_source",
      label: "Workflow article watchlist",
      sourceUrl: "https://example.com/article",
      seedExcerpt: "Teams still patch broken handoffs manually after launch.",
      refreshCadence: "daily_candidate",
      isActive: true
    });
    const run = await db.createAutonomousRun({
      watchlistId: watchlist.id,
      triggerType: "scheduler",
      runType: "watchlist_scout_feed",
      status: "completed"
    });

    const created = await db.upsertAutonomousMatchedOpportunity({
      watchlistId: watchlist.id,
      autonomousRunId: run.id,
      audienceQueueItemId: "review-1",
      solutionQueueItemId: "review-2",
      dedupeKey: "review-1:review-2",
      title: "Broken handoffs + visibility and recovery ownership",
      matchedPain: "Operators still patch broken handoffs manually",
      matchedSolutionPattern: "Visibility and recovery ownership pattern",
      matchRationale: "The solution directly addresses the same ownership gap.",
      suggestedAngle: "workflow_accountability",
      recommendedAction: "write_post",
      priorityScore: 88,
      priorityBand: "high",
      reasonLines: [
        "High-confidence match with strong opportunity strength.",
        "Write-post urgency keeps this pair near the top of the review order."
      ],
      confidence: "high",
      opportunityStrength: "strong"
    });

    const reviewed = await db.updateAutonomousMatchedOpportunityReviewState(created.id, {
      reviewState: "saved",
      reviewNote: "Strong fit for the next operator review pass."
    });

    expect(reviewed).toEqual(
      expect.objectContaining({
        id: created.id,
        reviewState: "saved",
        reviewNote: "Strong fit for the next operator review pass.",
        reviewedAt: expect.any(String),
        priorityScore: 88,
        recommendedAction: "write_post"
      })
    );

    await expect(db.getAutonomousMatchedOpportunityById(created.id)).resolves.toEqual(
      expect.objectContaining({
        id: created.id,
        reviewState: "saved",
        reviewNote: "Strong fit for the next operator review pass."
      })
    );
  });

  it("persists autonomous content work items idempotently from matched opportunities", async () => {
    const created = await db.upsertAutonomousContentWorkItem({
      sourceMatchedOpportunityId: "matched-1",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "post",
      title: "Promoted workflow accountability angle",
      summary: "Broken handoffs -> visibility and recovery ownership",
      rationale: "The deterministic match and triage state justify content prep.",
      recommendedAction: "write_post",
      priorityScore: 91,
      priorityBand: "high",
      reviewState: "saved",
      aiContent: {
        contentIdea: "Explain why ownership gaps appear after launch."
      },
      draftSeed: {
        title: "Workflow accountability after launch",
        angle: "Show the ownership gap after rollout.",
        seedText:
          "Teams still patch broken handoffs manually because recovery ownership stays vague.",
        sourceSummary: "Broken handoffs -> visibility and recovery ownership",
        rationale: "The deterministic match and triage state justify content prep.",
        recommendedAction: "write_post",
        priorityBand: "high"
      }
    });

    const updated = await db.upsertAutonomousContentWorkItem({
      sourceMatchedOpportunityId: "matched-1",
      watchlistId: "watch-1",
      autonomousRunId: "run-2",
      workItemKind: "post",
      title: "Promoted workflow accountability angle",
      summary: "Broken handoffs -> visibility and recovery ownership",
      rationale: "The deterministic match still justifies content prep.",
      recommendedAction: "write_post",
      priorityScore: 92,
      priorityBand: "high",
      reviewState: "saved"
    });

    expect(updated.id).toBe(created.id);
    expect(updated.priorityScore).toBe(92);
    expect(updated.recommendedAction).toBe("write_post");
    expect(updated.draftSeed).toEqual(created.draftSeed);

    await expect(db.listAutonomousContentWorkItems()).resolves.toEqual([
      expect.objectContaining({
        id: created.id,
        sourceMatchedOpportunityId: "matched-1",
        workItemKind: "post",
        reviewState: "saved",
        status: "draft",
        stateChangedAt: expect.any(String),
        draftSeed: expect.objectContaining({
          recommendedAction: "write_post",
          priorityBand: "high"
        })
      })
    ]);
  });

  it("lists autonomous content work items deterministically with kind and status filters", async () => {
    const first = await db.upsertAutonomousContentWorkItem({
      sourceMatchedOpportunityId: "matched-1",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "post",
      title: "Promoted post angle",
      summary: "Post summary",
      rationale: "Post rationale",
      recommendedAction: "write_post",
      priorityScore: 91,
      priorityBand: "high",
      reviewState: "saved",
      status: "draft"
    });
    const second = await db.upsertAutonomousContentWorkItem({
      sourceMatchedOpportunityId: "matched-2",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "deferred_note",
      title: "Parked note",
      summary: "Deferred summary",
      rationale: "Deferred rationale",
      recommendedAction: "save_for_later",
      priorityScore: 44,
      priorityBand: "low",
      reviewState: "in_review",
      status: "parked"
    });

    await expect(db.listAutonomousContentWorkItems()).resolves.toEqual([
      expect.objectContaining({ id: second.id }),
      expect.objectContaining({ id: first.id })
    ]);
    await expect(
      db.listAutonomousContentWorkItems({ workItemKind: "post" })
    ).resolves.toEqual([expect.objectContaining({ id: first.id, workItemKind: "post" })]);
    await expect(
      db.listAutonomousContentWorkItems({ status: "parked" })
    ).resolves.toEqual([expect.objectContaining({ id: second.id, status: "parked" })]);
    await expect(db.getAutonomousContentWorkItemById(first.id)).resolves.toEqual(
      expect.objectContaining({
        id: first.id,
        sourceMatchedOpportunityId: "matched-1",
        recommendedAction: "write_post",
        draftSeed: undefined
      })
    );
  });

  it("persists autonomous content work item workflow-state updates without duplicating records", async () => {
    const created = await db.upsertAutonomousContentWorkItem({
      sourceMatchedOpportunityId: "matched-1",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "post",
      title: "Promoted post angle",
      summary: "Post summary",
      rationale: "Post rationale",
      recommendedAction: "write_post",
      priorityScore: 91,
      priorityBand: "high",
      reviewState: "saved",
      status: "draft"
    });

    const updated = await db.updateAutonomousContentWorkItemStatus(created.id, {
      status: "ready_for_draft",
      workNote: "Ready for a human drafting pass."
    });

    expect(updated).toEqual(
      expect.objectContaining({
        id: created.id,
        status: "ready_for_draft",
        workNote: "Ready for a human drafting pass.",
        stateChangedAt: expect.any(String),
        recommendedAction: "write_post",
        priorityScore: 91
      })
    );

    await expect(db.listAutonomousContentWorkItems()).resolves.toEqual([
      expect.objectContaining({
        id: created.id,
        status: "ready_for_draft"
      })
    ]);
  });

  it("persists autonomous draft documents idempotently from content work item draft seeds", async () => {
    const workItem = await db.upsertAutonomousContentWorkItem({
      sourceMatchedOpportunityId: "matched-1",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "post",
      title: "Promoted workflow accountability angle",
      summary: "Broken handoffs -> visibility and recovery ownership",
      rationale: "The deterministic match and triage state justify content prep.",
      recommendedAction: "write_post",
      priorityScore: 91,
      priorityBand: "high",
      reviewState: "saved",
      draftSeed: {
        title: "Workflow accountability after launch",
        angle: "Show the ownership gap after rollout.",
        seedText:
          "Teams still patch broken handoffs manually because recovery ownership stays vague.",
        sourceSummary: "Broken handoffs -> visibility and recovery ownership",
        rationale: "The deterministic match and triage state justify content prep.",
        recommendedAction: "write_post",
        priorityBand: "high"
      }
    });

    const created = await db.upsertAutonomousDraftDocument({
      sourceContentWorkItemId: workItem.id,
      title: workItem.draftSeed!.title,
      body: workItem.draftSeed!.seedText,
      angle: workItem.draftSeed!.angle,
      sourceSummary: workItem.draftSeed!.sourceSummary,
      recommendedAction: workItem.draftSeed!.recommendedAction
    });

    const updated = await db.upsertAutonomousDraftDocument({
      sourceContentWorkItemId: workItem.id,
      title: workItem.draftSeed!.title,
      body: workItem.draftSeed!.seedText,
      sourceSummary: workItem.draftSeed!.sourceSummary,
      recommendedAction: workItem.draftSeed!.recommendedAction
    });

    expect(updated.id).toBe(created.id);
    expect(updated.body).toBe(created.body);
    expect(updated.recommendedAction).toBe("write_post");

    await expect(db.listAutonomousDraftDocuments()).resolves.toEqual([
      expect.objectContaining({
        id: created.id,
        sourceContentWorkItemId: workItem.id,
        title: "Workflow accountability after launch",
        status: "draft"
      })
    ]);
    await expect(db.getAutonomousDraftDocumentById(created.id)).resolves.toEqual(
      expect.objectContaining({
        id: created.id,
        sourceContentWorkItemId: workItem.id
      })
    );
    await expect(
      db.getAutonomousDraftDocumentBySourceContentWorkItemId(workItem.id)
    ).resolves.toEqual(expect.objectContaining({ id: created.id }));
    await expect(db.getAutonomousContentWorkItemById(workItem.id)).resolves.toEqual(
      expect.objectContaining({
        id: workItem.id,
        status: "draft",
        draftSeed: expect.objectContaining({
          recommendedAction: "write_post"
        })
      })
    );
  });

  it("persists autonomous draft document updates without mutating source content work items", async () => {
    const workItem = await db.upsertAutonomousContentWorkItem({
      sourceMatchedOpportunityId: "matched-1",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "post",
      title: "Promoted workflow accountability angle",
      summary: "Broken handoffs -> visibility and recovery ownership",
      rationale: "The deterministic match and triage state justify content prep.",
      recommendedAction: "write_post",
      priorityScore: 91,
      priorityBand: "high",
      reviewState: "saved",
      draftSeed: {
        title: "Workflow accountability after launch",
        angle: "Show the ownership gap after rollout.",
        seedText:
          "Teams still patch broken handoffs manually because recovery ownership stays vague.",
        sourceSummary: "Broken handoffs -> visibility and recovery ownership",
        rationale: "The deterministic match and triage state justify content prep.",
        recommendedAction: "write_post",
        priorityBand: "high"
      }
    });
    const created = await db.upsertAutonomousDraftDocument({
      sourceContentWorkItemId: workItem.id,
      title: workItem.draftSeed!.title,
      body: workItem.draftSeed!.seedText,
      angle: workItem.draftSeed!.angle,
      sourceSummary: workItem.draftSeed!.sourceSummary,
      recommendedAction: workItem.draftSeed!.recommendedAction
    });

    const updated = await db.updateAutonomousDraftDocument(created.id, {
      title: "Refined workflow accountability title",
      body: "A tighter operator-facing draft body.",
      angle: "Focus on recovery ownership after launch."
    });

    expect(updated).toEqual(
      expect.objectContaining({
        id: created.id,
        sourceContentWorkItemId: workItem.id,
        title: "Refined workflow accountability title",
        body: "A tighter operator-facing draft body.",
        angle: "Focus on recovery ownership after launch.",
        sourceSummary: workItem.draftSeed!.sourceSummary,
        recommendedAction: "write_post",
        status: "draft",
        updatedAt: expect.any(String)
      })
    );

    await expect(db.getAutonomousDraftDocumentById(created.id)).resolves.toEqual(
      expect.objectContaining({
        id: created.id,
        title: "Refined workflow accountability title"
      })
    );
    await expect(db.getAutonomousContentWorkItemById(workItem.id)).resolves.toEqual(
      expect.objectContaining({
        id: workItem.id,
        title: "Promoted workflow accountability angle",
        draftSeed: expect.objectContaining({
          title: "Workflow accountability after launch",
          seedText:
            "Teams still patch broken handoffs manually because recovery ownership stays vague."
        })
      })
    );
  });

  it("persists autonomous draft document status updates without mutating source linkage", async () => {
    const workItem = await db.upsertAutonomousContentWorkItem({
      sourceMatchedOpportunityId: "matched-1",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "post",
      title: "Promoted workflow accountability angle",
      summary: "Broken handoffs -> visibility and recovery ownership",
      rationale: "The deterministic match and triage state justify content prep.",
      recommendedAction: "write_post",
      priorityScore: 91,
      priorityBand: "high",
      reviewState: "saved",
      draftSeed: {
        title: "Workflow accountability after launch",
        angle: "Show the ownership gap after rollout.",
        seedText:
          "Teams still patch broken handoffs manually because recovery ownership stays vague.",
        sourceSummary: "Broken handoffs -> visibility and recovery ownership",
        rationale: "The deterministic match and triage state justify content prep.",
        recommendedAction: "write_post",
        priorityBand: "high"
      }
    });
    const created = await db.upsertAutonomousDraftDocument({
      sourceContentWorkItemId: workItem.id,
      title: workItem.draftSeed!.title,
      body: workItem.draftSeed!.seedText,
      angle: workItem.draftSeed!.angle,
      sourceSummary: workItem.draftSeed!.sourceSummary,
      recommendedAction: workItem.draftSeed!.recommendedAction
    });

    const ready = await db.updateAutonomousDraftDocumentStatus(created.id, {
      status: "ready"
    });
    const archived = await db.updateAutonomousDraftDocumentStatus(created.id, {
      status: "archived"
    });

    expect(ready).toEqual(
      expect.objectContaining({
        id: created.id,
        sourceContentWorkItemId: workItem.id,
        status: "ready"
      })
    );
    expect(archived).toEqual(
      expect.objectContaining({
        id: created.id,
        sourceContentWorkItemId: workItem.id,
        status: "archived",
        sourceSummary: workItem.draftSeed!.sourceSummary,
        recommendedAction: "write_post"
      })
    );

    await expect(db.getAutonomousContentWorkItemById(workItem.id)).resolves.toEqual(
      expect.objectContaining({
        id: workItem.id,
        draftSeed: expect.objectContaining({
          title: "Workflow accountability after launch"
        })
      })
    );
  });

  it("filters autonomous draft documents by status safely", async () => {
    const firstWorkItem = await db.upsertAutonomousContentWorkItem({
      sourceMatchedOpportunityId: "matched-1",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "post",
      title: "First promoted workflow accountability angle",
      summary: "Broken handoffs -> visibility and recovery ownership",
      rationale: "The deterministic match and triage state justify content prep.",
      recommendedAction: "write_post",
      priorityScore: 91,
      priorityBand: "high",
      reviewState: "saved",
      draftSeed: {
        title: "Workflow accountability after launch",
        angle: "Show the ownership gap after rollout.",
        seedText: "Teams still patch broken handoffs manually.",
        sourceSummary: "Broken handoffs -> visibility and recovery ownership",
        rationale: "The deterministic match and triage state justify content prep.",
        recommendedAction: "write_post",
        priorityBand: "high"
      }
    });
    const secondWorkItem = await db.upsertAutonomousContentWorkItem({
      sourceMatchedOpportunityId: "matched-2",
      watchlistId: "watch-2",
      autonomousRunId: "run-2",
      workItemKind: "comment",
      title: "Second promoted workflow accountability angle",
      summary: "Exception handling note",
      rationale: "A second deterministic drafting target.",
      recommendedAction: "write_comment",
      priorityScore: 79,
      priorityBand: "medium",
      reviewState: "saved",
      draftSeed: {
        title: "Comment workflow accountability",
        angle: "Focus on exception handling.",
        seedText: "Exception ownership still stalls rollout.",
        sourceSummary: "Exception handling note",
        rationale: "A second deterministic drafting target.",
        recommendedAction: "write_comment",
        priorityBand: "medium"
      }
    });

    const readyDraft = await db.upsertAutonomousDraftDocument({
      sourceContentWorkItemId: firstWorkItem.id,
      title: firstWorkItem.draftSeed!.title,
      body: firstWorkItem.draftSeed!.seedText,
      angle: firstWorkItem.draftSeed!.angle,
      sourceSummary: firstWorkItem.draftSeed!.sourceSummary,
      recommendedAction: firstWorkItem.draftSeed!.recommendedAction
    });
    const draftDraft = await db.upsertAutonomousDraftDocument({
      sourceContentWorkItemId: secondWorkItem.id,
      title: secondWorkItem.draftSeed!.title,
      body: secondWorkItem.draftSeed!.seedText,
      angle: secondWorkItem.draftSeed!.angle,
      sourceSummary: secondWorkItem.draftSeed!.sourceSummary,
      recommendedAction: secondWorkItem.draftSeed!.recommendedAction
    });

    await db.updateAutonomousDraftDocumentStatus(readyDraft.id, { status: "ready" });

    await expect(db.listAutonomousDraftDocuments({ status: "ready" })).resolves.toEqual([
      expect.objectContaining({
        id: readyDraft.id,
        status: "ready"
      })
    ]);
    await expect(db.listAutonomousDraftDocuments({ status: "archived" })).resolves.toEqual([]);
    await expect(db.listAutonomousDraftDocuments({ status: "draft" })).resolves.toEqual([
      expect.objectContaining({
        id: draftDraft.id,
        status: "draft"
      })
    ]);
  });

  it("sorts autonomous draft documents safely without changing the default truthful order", async () => {
    vi.useFakeTimers();

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
    const firstDraft = await db.upsertAutonomousDraftDocument({
      sourceContentWorkItemId: firstWorkItem.id,
      title: firstWorkItem.draftSeed!.title,
      body: firstWorkItem.draftSeed!.seedText,
      angle: firstWorkItem.draftSeed!.angle,
      sourceSummary: firstWorkItem.draftSeed!.sourceSummary,
      recommendedAction: firstWorkItem.draftSeed!.recommendedAction
    });

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
    const secondDraft = await db.upsertAutonomousDraftDocument({
      sourceContentWorkItemId: secondWorkItem.id,
      title: secondWorkItem.draftSeed!.title,
      body: secondWorkItem.draftSeed!.seedText,
      angle: secondWorkItem.draftSeed!.angle,
      sourceSummary: secondWorkItem.draftSeed!.sourceSummary,
      recommendedAction: secondWorkItem.draftSeed!.recommendedAction
    });

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
    const thirdDraft = await db.upsertAutonomousDraftDocument({
      sourceContentWorkItemId: thirdWorkItem.id,
      title: thirdWorkItem.draftSeed!.title,
      body: thirdWorkItem.draftSeed!.seedText,
      angle: thirdWorkItem.draftSeed!.angle,
      sourceSummary: thirdWorkItem.draftSeed!.sourceSummary,
      recommendedAction: thirdWorkItem.draftSeed!.recommendedAction
    });

    await db.updateAutonomousDraftDocumentStatus(firstDraft.id, { status: "ready" });
    await db.updateAutonomousDraftDocumentStatus(secondDraft.id, { status: "blocked" });

    await expect(db.listAutonomousDraftDocuments()).resolves.toEqual([
      expect.objectContaining({ id: thirdDraft.id, status: "draft" }),
      expect.objectContaining({ id: secondDraft.id, status: "blocked" }),
      expect.objectContaining({ id: firstDraft.id, status: "ready" })
    ]);
    await expect(db.listAutonomousDraftDocuments({ sort: "updated_asc" })).resolves.toEqual([
      expect.objectContaining({ id: firstDraft.id }),
      expect.objectContaining({ id: secondDraft.id }),
      expect.objectContaining({ id: thirdDraft.id })
    ]);
    await expect(db.listAutonomousDraftDocuments({ sort: "status" })).resolves.toEqual([
      expect.objectContaining({ id: thirdDraft.id, status: "draft" }),
      expect.objectContaining({ id: firstDraft.id, status: "ready" }),
      expect.objectContaining({ id: secondDraft.id, status: "blocked" })
    ]);
  });

  it("resetDatabase clears all persisted tables cleanly", async () => {
    await db.createSignal({
      title: "Signal",
      sourceType: "manual",
      rawText: "Text"
    });
    await db.createSourceItem({
      title: "Source",
      sourceType: "manual",
      rawText: "Source text",
      normalizedSummary: "Summary",
      tags: ["manual"],
      status: "normalized"
    });

    await db.resetDatabase();

    await expect(db.listSignals()).resolves.toEqual([]);
    await expect(db.listSourceItems()).resolves.toEqual([]);
    await expect(db.listIdeas()).resolves.toEqual([]);
    await expect(db.listContentAssets()).resolves.toEqual([]);
    await expect(db.listAutonomousWatchlists()).resolves.toEqual([]);
    await expect(db.listAutonomousRuns()).resolves.toEqual([]);
  });

  it("creates and links canonical records through a full local trail for a GitHub source", async () => {
    const signal = await db.createSignal({
      title: "Retry ownership repo",
      sourceType: "github_repo",
      sourceUrl: "https://github.com/example/repo",
      sourceDomain: "github.com",
      sourceTitle: "example/repo",
      sourceAuthorOrOwner: "example",
      fetchedAt: "2026-03-16T00:00:00.000Z",
      language: "en",
      rawText: "README text about retry ownership and visible state.",
      normalizedContent: "Retry ownership and visibility are explicit.",
      contentHash: "hash-github-1",
      topicTags: ["ops", "visibility"],
      noveltyHint: "Grounded operator implementation angle",
      sourceMetadataJson: { stars: 1200, primaryLanguage: "TypeScript" }
    });
    const analysis = await db.createSignalAnalysis({
      signalId: signal.id,
      relevanceScore: 88,
      whyRelevant: "Strong operational workflow lesson with direct implementation value.",
      targetAudience: "Operator-led SaaS teams",
      businessValueSummary: "Can power both brand content and client solution framing.",
      painsSolved: ["ownership drift", "hidden retries"],
      practicalImplications: ["visible recovery paths", "clear responsibility"],
      overhypeNotes: "Avoid claiming full autonomy from a single feature set.",
      recommendedPillar: "workflow accountability",
      uniquenessScore: 76,
      uniquenessReason: "Concrete implementation detail rather than abstract AI commentary.",
      buildabilityScore: 84,
      buildabilityReason: "The repo exposes enough architectural clues to adapt.",
      popularityPotentialScore: 68,
      brandGrowthPotentialScore: 83,
      reasoningJson: { sourceKind: "repo" }
    });
    const idea = await db.createIdea({
      signalId: signal.id,
      title: "Explain retry ownership",
      coreInsight: "Operator trust depends on visible recovery paths.",
      businessRelevance: "Useful for implementation-aware positioning.",
      targetAudience: "Founders and operators",
      status: "draft"
    });
    const content = await db.createContentAsset({
      ideaId: idea.id,
      signalId: signal.id,
      signalAnalysisId: analysis.id,
      contentType: "linkedin-post",
      hook: "Execution breaks when retries go invisible.",
      body: "Operators need visible recovery paths after launch.",
      cta: "What do you expose when workflows stall?",
      bestAngle: "workflow_accountability",
      alternativeAnglesJson: ["ownership_gap"],
      recommendedFormat: "long_linkedin_post",
      longPostDraft: "Long draft",
      shortPostDraft: "Short authority draft",
      hooksJson: ["Hook A", "Hook B"],
      commentAnglesJson: ["Comment angle A"],
      ctaVariantsJson: ["CTA A"],
      carouselOutline: "Slide 1 -> Slide 2",
      contentStatus: "review",
      publishReadyFlag: false,
      status: "draft"
    });
    const solutionMemory = await db.createSolutionMemory({
      signalId: signal.id,
      sourceType: "github_repo",
      implementationPotential: "high",
      implementationComplexity: "medium",
      detectedStack: ["typescript", "fastify", "sqlite"],
      keyFeatures: ["scheduler", "review queue"],
      architectureClues: ["durable workflow state", "server-backed triage"],
      deploymentHints: ["local sqlite is enough for MVP"],
      clientFitTypes: ["operator-led SaaS"],
      possibleUseCases: ["workflow accountability products"],
      adaptationNotes: "Needs tenant/auth hardening for clients.",
      repoReference: "github.com/example/repo",
      readmeSnapshot: "README snapshot",
      implementationNotes: "Good source for client solution memory."
    });
    const criticReview = await db.createWritingQualityAssessment({
      contentAssetId: content.id,
      humanToneScore: 84,
      clarityScore: 86,
      groundednessScore: 90,
      antiRobotScore: 88,
      overallScore: 87,
      notes: ["Grounded and specific."],
      qualityScore: 87,
      genericnessScore: 18,
      businessValueScore: 85,
      differentiationScore: 82,
      publishReadyFlag: false,
      rewriteSuggestions: ["Make the hook sharper."],
      criticNotes: "Good operator signal."
    });
    const performanceSnapshot = await db.createAnalyticsSnapshot({
      contentAssetId: content.id,
      postUrl: "https://linkedin.com/posts/example",
      platform: "linkedin",
      publishedAt: "2026-03-18T00:00:00.000Z",
      audienceGeoHint: "North America",
      audienceSegment: "B2B operators",
      impressions: 1200,
      likes: 64,
      comments: 11,
      saves: 8,
      reactions: 64,
      reposts: 4,
      profileViews: 22,
      followersGained: 6,
      inboundLeads: 2,
      qualitativeNotes: "Implementation detail resonated."
    });
    const memoryPattern = await db.upsertMemoryPattern({
      patternType: "implementation",
      patternKey: "visible-retry-ownership",
      strengthScore: 8,
      supportingEvidenceJson: { contentAssetId: content.id },
      recommendedAction: "repeat"
    });
    const decision = await db.createOrchestratorDecision({
      signalId: signal.id,
      decisionType: "promote_to_content",
      decisionReason: "High buildability and high brand growth potential.",
      confidenceScore: 82,
      nextAction: "create_draft_seed",
      requiresHumanReview: true
    });
    const agentRun = await db.createAgentRun({
      signalId: signal.id,
      agentName: "signal-analysis",
      modelTier: "deterministic",
      providerName: "fallback",
      status: "completed",
      startedAt: "2026-03-16T00:00:00.000Z",
      completedAt: "2026-03-16T00:00:02.000Z",
      inputSummary: "GitHub repo snapshot",
      outputSummary: "High implementation potential"
    });

    const trail = await db.getSignalSourceToOutputTrail(signal.id);

    expect(signal.contentHash).toBe("hash-github-1");
    expect(analysis.signalId).toBe(signal.id);
    expect(content.signalId).toBe(signal.id);
    expect(content.signalAnalysisId).toBe(analysis.id);
    expect(solutionMemory.signalId).toBe(signal.id);
    expect(criticReview.contentAssetId).toBe(content.id);
    expect(performanceSnapshot.contentAssetId).toBe(content.id);
    expect(memoryPattern.patternKey).toBe("visible-retry-ownership");
    expect(decision.nextAction).toBe("create_draft_seed");
    expect(agentRun.agentName).toBe("signal-analysis");
    expect(trail).toEqual<SignalSourceToOutputTrail>({
      signal,
      analyses: [analysis],
      contentAssets: [content],
      solutionMemories: [solutionMemory],
      criticReviews: [criticReview],
      performanceSnapshots: [performanceSnapshot]
    });
  });

  it("stores a full local trail for an article source without solution memory", async () => {
    const signal = await db.createSignal({
      title: "Article on launch accountability",
      sourceType: "article",
      sourceUrl: "https://example.com/accountability",
      sourceDomain: "example.com",
      sourceTitle: "Launch accountability article",
      sourceAuthorOrOwner: "Casey Writer",
      fetchedAt: "2026-03-16T00:00:00.000Z",
      rawText: "Article text about accountability after launch.",
      normalizedContent: "Launch accountability matters when ownership drifts.",
      contentHash: "hash-article-1",
      topicTags: ["launch", "accountability"]
    });
    const analysis = await db.createSignalAnalysis({
      signalId: signal.id,
      relevanceScore: 81,
      whyRelevant: "Strong operator-facing lesson.",
      targetAudience: "B2B operators",
      businessValueSummary: "Useful for authority content.",
      painsSolved: ["handoff drift"],
      practicalImplications: ["clear ownership"],
      uniquenessScore: 67,
      uniquenessReason: "Solid but less implementation-specific than repo material.",
      buildabilityScore: 58,
      buildabilityReason: "Article is directional, not deeply technical.",
      popularityPotentialScore: 71,
      brandGrowthPotentialScore: 78
    });
    const idea = await db.createIdea({
      signalId: signal.id,
      title: "Write launch accountability post",
      coreInsight: "Ownership drift slows execution after launch.",
      businessRelevance: "Useful authority positioning.",
      targetAudience: "Operators",
      status: "draft"
    });
    const content = await db.createContentAsset({
      ideaId: idea.id,
      signalId: signal.id,
      signalAnalysisId: analysis.id,
      contentType: "linkedin-post",
      hook: "Launch accountability fails when ownership goes vague.",
      body: "Visible ownership compounds trust.",
      cta: "What do you surface after launch?",
      status: "draft"
    });

    const trail = await db.getSignalSourceToOutputTrail(signal.id);

    expect(trail?.signal.id).toBe(signal.id);
    expect(trail?.analyses).toEqual([analysis]);
    expect(trail?.contentAssets).toEqual([content]);
    expect(trail?.solutionMemories).toEqual([]);
  });

  it("keeps signal persistence hash-safe by returning the existing signal for duplicate content hashes", async () => {
    const first = await db.createSignal({
      title: "First title",
      sourceType: "manual_note",
      rawText: "Same normalized source",
      contentHash: "hash-repeat-1"
    });

    const second = await db.createSignal({
      title: "Second title should not create a new row",
      sourceType: "manual_note",
      rawText: "Same normalized source",
      contentHash: "hash-repeat-1"
    });

    expect(second).toEqual(first);
    await expect(db.listSignals()).resolves.toHaveLength(1);
  });

  it("updateSignalAnalysis persists positioning enrichment fields", async () => {
    const signal = await db.createSignal({
      title: "Signal for positioning",
      sourceType: "article",
      rawText: "Operators need clearer workflow accountability."
    });
    const analysis = await db.createSignalAnalysis({
      signalId: signal.id,
      relevanceScore: 80,
      whyRelevant: "Strong operator lesson.",
      targetAudience: "Founders and operators",
      businessValueSummary: "Good content candidate.",
      painsSolved: ["workflow fragility"],
      practicalImplications: ["clarify queue ownership"],
      uniquenessScore: 68,
      uniquenessReason: "Grounded detail.",
      buildabilityScore: 64,
      buildabilityReason: "Enough process detail.",
      popularityPotentialScore: 60,
      brandGrowthPotentialScore: 76
    });

    const updated = await db.updateSignalAnalysis(analysis.id, {
      bestAngle: "workflow_accountability",
      alternativeAnglesJson: ["ownership_gap", "handoff_failure"],
      recommendedFormat: "long_linkedin_post",
      audienceEmphasis: "Founders plus operators",
      toneGuidance: "Direct and grounded",
      recommendedPillarFinal: "workflow_accountability"
    });

    expect(updated).toEqual(
      expect.objectContaining({
        id: analysis.id,
        bestAngle: "workflow_accountability",
        alternativeAnglesJson: ["ownership_gap", "handoff_failure"],
        recommendedFormat: "long_linkedin_post",
        audienceEmphasis: "Founders plus operators",
        toneGuidance: "Direct and grounded",
        recommendedPillarFinal: "workflow_accountability"
      })
    );
  });

  it("updateContentAssetCriticState persists publish-readiness review fields", async () => {
    const signal = await db.createSignal({
      title: "Signal",
      sourceType: "manual",
      rawText: "Signal text"
    });
    const idea = await db.createIdea({
      signalId: signal.id,
      title: "Idea",
      coreInsight: "Insight",
      businessRelevance: "Relevance",
      targetAudience: "Audience",
      status: "draft"
    });
    const content = await db.createContentAsset({
      ideaId: idea.id,
      signalId: signal.id,
      contentType: "linkedin-post",
      hook: "Hook",
      body: "Body",
      cta: "CTA",
      status: "draft",
      contentStatus: "draft",
      publishReadyFlag: false
    });

    const updated = await db.updateContentAssetCriticState(content.id, {
      contentStatus: "ready",
      publishReadyFlag: true,
      qualityStatus: "reviewed",
      overallQualityScore: 86
    });

    expect(updated).toEqual(
      expect.objectContaining({
        id: content.id,
        contentStatus: "ready",
        publishReadyFlag: true,
        qualityStatus: "reviewed",
        overallQualityScore: 86
      })
    );
  });

  it("createCandidateQueueItem and listCandidateQueueItems persist canonical handoff records", async () => {
    const created = await db.createCandidateQueueItem({
      signalId: "sig-1",
      signalAnalysisId: "analysis-1",
      contentAssetId: "content-1",
      criticReviewId: "quality-1",
      solutionMemoryId: "solution-memory-1",
      orchestratorDecisionId: "decision-1",
      candidateType: "high_priority_candidate",
      queueState: "ready_for_review",
      priorityScore: 88,
      priorityLabel: "high",
      whyQueued: "Strong reviewed content with high-priority decision context.",
      nextAction: "review_for_publication",
      requiresHumanReview: true
    });

    expect(created).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^candidate-/),
        signalId: "sig-1",
        signalAnalysisId: "analysis-1",
        contentAssetId: "content-1",
        criticReviewId: "quality-1",
        solutionMemoryId: "solution-memory-1",
        orchestratorDecisionId: "decision-1",
        candidateType: "high_priority_candidate",
        queueState: "ready_for_review",
        priorityScore: 88,
        priorityLabel: "high",
        whyQueued: expect.any(String),
        nextAction: "review_for_publication",
        requiresHumanReview: true,
        createdAt: expect.any(String),
        updatedAt: expect.any(String)
      })
    );
    await expect(db.listCandidateQueueItems()).resolves.toEqual([created]);
  });

  it("updateCandidateQueueItem persists operator review state changes", async () => {
    const created = await db.createCandidateQueueItem({
      signalId: "sig-1",
      signalAnalysisId: "analysis-1",
      contentAssetId: "content-1",
      orchestratorDecisionId: "decision-1",
      candidateType: "content_candidate",
      queueState: "ready_for_review",
      priorityScore: 72,
      priorityLabel: "medium",
      whyQueued: "Needs a final operator pass.",
      nextAction: "review_content_candidate",
      requiresHumanReview: true
    });

    const updated = await db.updateCandidateQueueItem(created.id, {
      queueState: "revision_requested",
      whyQueued: "Revision requested before approval.",
      nextAction: "revise_content_candidate",
      requiresHumanReview: true,
      operatorNote: "Tighten the hook and make the CTA more specific."
    });

    expect(updated).toEqual(
      expect.objectContaining({
        id: created.id,
        queueState: "revision_requested",
        whyQueued: "Revision requested before approval.",
        nextAction: "revise_content_candidate",
        requiresHumanReview: true,
        operatorNote: "Tighten the hook and make the CTA more specific."
      })
    );

    await expect(db.getCandidateQueueItemById(created.id)).resolves.toEqual(updated);
  });
});
