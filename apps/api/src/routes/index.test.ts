import type { FastifyInstance } from "fastify";
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
  ProviderRegistry,
  ProviderRouter
} from "@linkedin-brand-os/ai-providers";
import { SqliteDatabase } from "@linkedin-brand-os/db";
import { OrchestratorService } from "@linkedin-brand-os/orchestrator";
import { OperatorAuthService } from "../auth";
import { BackgroundSchedulerRuntime } from "../backgroundSchedulerRuntime";
import { buildApp } from "../app";

describe("API MVP workflow routes", () => {
  let app: FastifyInstance | undefined;
  let db: SqliteDatabase | undefined;
  let dbDir: string | undefined;
  const operatorCredentials = {
    username: "operator",
    password: "operator-pass"
  };
  const createTestOperatorAuthService = () =>
    new OperatorAuthService({
      ...operatorCredentials,
      sessionTtlMs: 10 * 365 * 24 * 60 * 60 * 1000
    });

  beforeEach(() => {
    vi.stubEnv("OPERATOR_USERNAME", operatorCredentials.username);
    vi.stubEnv("OPERATOR_PASSWORD", operatorCredentials.password);
  });

  const authenticateOperatorApp = async (
    targetApp: FastifyInstance
  ): Promise<FastifyInstance> => {
    const loginResponse = await targetApp.inject({
      method: "POST",
      url: "/auth/login",
      payload: operatorCredentials
    });

    expect(loginResponse.statusCode).toBe(200);
    const { token } = loginResponse.json() as { token: string };
    const originalInject = targetApp.inject.bind(targetApp);

    targetApp.inject = (((options: Record<string, unknown>) =>
      originalInject({
        ...options,
        headers: {
          ...((options.headers as Record<string, string> | undefined) ?? {}),
          authorization: `Bearer ${token}`
        }
      })) as typeof targetApp.inject);

    return targetApp;
  };

  const createAppWithTestDatabase = async (): Promise<FastifyInstance> => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();

    const builtApp = await buildApp({
      logger: false,
      orchestrator: new OrchestratorService({ db }),
      operatorAuthService: createTestOperatorAuthService()
    });

    return authenticateOperatorApp(builtApp);
  };

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    if (app) {
      await app.close();
      app = undefined;
    }
    if (db) {
      db.close();
      db = undefined;
    }
    if (dbDir) {
      rmSync(dbDir, { recursive: true, force: true });
      dbDir = undefined;
    }
  });

  it("POST /signals creates a signal and GET /signals returns it", async () => {
    app = await createAppWithTestDatabase();

    const createResponse = await app.inject({
      method: "POST",
      url: "/signals",
      payload: {
        title: "Signal title",
        sourceType: "manual",
        rawText: "Signal raw text"
      }
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json()).toEqual({
      id: expect.stringMatching(/^sig-/),
      title: "Signal title",
      sourceType: "manual",
      rawText: "Signal raw text",
      status: "new",
      createdAt: expect.any(String)
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/signals"
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual([
      expect.objectContaining({
        title: "Signal title",
        sourceType: "manual"
      })
    ]);
  });

  it("POST /signals/intake persists a canonical GitHub signal with extraction metadata", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();

    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      text: async () =>
        "<html><title>example/brand-os</title><body><main><article id=\"readme\">Queue-state visibility and operator review flow from the README.</article></main></body></html>"
    } as Response);

    app = await buildApp({
      logger: false,
      orchestrator: new OrchestratorService({ db, watchlistFetch: fetchImpl }),
      operatorAuthService: createTestOperatorAuthService()
    });
    await authenticateOperatorApp(app);

    const response = await app.inject({
      method: "POST",
      url: "/signals/intake",
      payload: {
        sourceUrl: "https://github.com/example/brand-os"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(
      expect.objectContaining({
        sourceType: "github_repo",
        sourceUrl: "https://github.com/example/brand-os",
        sourceDomain: "github.com",
        normalizedContent: expect.stringContaining("operator review flow"),
        contentHash: expect.any(String),
        sourceMetadataJson: expect.objectContaining({
          owner: "example",
          repo: "brand-os"
        })
      })
    );
  });

  it("POST /signals/:id/analyze persists SignalAnalysis and AgentRun records", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();

    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());

    app = await buildApp({
      logger: false,
      orchestrator: new OrchestratorService({
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
      }),
      operatorAuthService: createTestOperatorAuthService()
    });
    await authenticateOperatorApp(app);

    const created = await app.inject({
      method: "POST",
      url: "/signals",
      payload: {
        title: "Manual ops note",
        sourceType: "manual",
        rawText: "Queue visibility and exception handling are what make automation trustworthy."
      }
    });
    const signalId = (created.json() as { id: string }).id;

    const response = await app.inject({
      method: "POST",
      url: `/signals/${signalId}/analyze`
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(
      expect.objectContaining({
        analysis: expect.objectContaining({
          signalId,
          relevanceScore: expect.any(Number),
          businessValueSummary: expect.any(String),
          uniquenessScore: expect.any(Number),
          buildabilityScore: expect.any(Number)
        }),
        agentRuns: expect.arrayContaining([
          expect.objectContaining({
            agentName: "relevance-agent",
            modelTier: "openai",
            providerName: "mock-text"
          }),
          expect.objectContaining({
            agentName: "business-translator-agent",
            modelTier: "openai",
            providerName: "mock-text"
          })
        ])
      })
    );
  });

  it("POST /signals/:id/analyze returns 409 when policy blocks premium reasoning", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();

    app = await buildApp({
      logger: false,
      orchestrator: new OrchestratorService({
        db,
        executionPolicyRouter: new ExecutionPolicyRouter({
          modelAssignments: createModelAssignmentConfigFromEnv({}),
          taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
          availability: {
            localMiraiAvailable: true,
            openAIAvailable: false
          }
        })
      }),
      operatorAuthService: createTestOperatorAuthService()
    });
    await authenticateOperatorApp(app);

    const created = await app.inject({
      method: "POST",
      url: "/signals",
      payload: {
        title: "Blocked signal",
        sourceType: "manual",
        rawText: "Premium reasoning should be unavailable here."
      }
    });
    const signalId = (created.json() as { id: string }).id;

    const response = await app.inject({
      method: "POST",
      url: `/signals/${signalId}/analyze`
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: expect.stringContaining("required")
    });
  });

  it("POST /signals/:id/position persists positioning, solution memory, and decision records", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();

    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());

    app = await buildApp({
      logger: false,
      orchestrator: new OrchestratorService({
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
      }),
      operatorAuthService: createTestOperatorAuthService()
    });
    await authenticateOperatorApp(app);

    const created = await app.inject({
      method: "POST",
      url: "/signals",
      payload: {
        title: "Workflow accountability repo",
        sourceType: "manual",
        rawText: "Queue visibility, retry state, and ownership make automation trustworthy."
      }
    });
    const signalId = (created.json() as { id: string }).id;
    await app.inject({
      method: "POST",
      url: `/signals/${signalId}/analyze`
    });

    const response = await app.inject({
      method: "POST",
      url: `/signals/${signalId}/position`
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(
      expect.objectContaining({
        analysis: expect.objectContaining({
          signalId,
          bestAngle: expect.any(String),
          alternativeAnglesJson: expect.any(Array),
          recommendedFormat: expect.any(String),
          audienceEmphasis: expect.any(String),
          toneGuidance: expect.any(String)
        }),
        solutionMemory: expect.objectContaining({
          signalId,
          implementationPotential: expect.any(String),
          implementationComplexity: expect.any(String),
          possibleUseCases: expect.any(Array)
        }),
        decision: expect.objectContaining({
          signalId,
          decisionType: expect.any(String),
          decisionReason: expect.any(String),
          confidenceScore: expect.any(Number),
          nextAction: expect.any(String)
        }),
        agentRuns: expect.arrayContaining([
          expect.objectContaining({
            agentName: "positioning-agent",
            modelTier: "openai",
            providerName: "mock-text"
          })
        ])
      })
    );
  });

  it("POST /signals/:id/position returns 409 when premium positioning is unavailable", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();

    app = await buildApp({
      logger: false,
      orchestrator: new OrchestratorService({
        db,
        executionPolicyRouter: new ExecutionPolicyRouter({
          modelAssignments: createModelAssignmentConfigFromEnv({}),
          taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
          availability: {
            localMiraiAvailable: true,
            openAIAvailable: false
          }
        })
      }),
      operatorAuthService: createTestOperatorAuthService()
    });
    await authenticateOperatorApp(app);

    const created = await app.inject({
      method: "POST",
      url: "/signals",
      payload: {
        title: "Blocked positioning signal",
        sourceType: "manual",
        rawText: "This still needs premium strategic positioning."
      }
    });
    const signalId = (created.json() as { id: string }).id;

    await db.createSignalAnalysis({
      signalId,
      relevanceScore: 72,
      whyRelevant: "Strong enough to evaluate.",
      targetAudience: "Founders and operators",
      businessValueSummary: "Potential content candidate.",
      painsSolved: ["workflow fragility"],
      practicalImplications: ["clarify queue ownership"],
      recommendedPillar: "workflow_accountability",
      uniquenessScore: 64,
      uniquenessReason: "Grounded operator detail.",
      buildabilityScore: 68,
      buildabilityReason: "Enough implementation context.",
      popularityPotentialScore: 66,
      brandGrowthPotentialScore: 74
    });

    const response = await app.inject({
      method: "POST",
      url: `/signals/${signalId}/position`
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: expect.stringContaining("required")
    });
  });

  it("POST /signals/:id/content persists a canonical content asset for a positioned signal", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    app = await buildApp({
      logger: false,
      orchestrator: new OrchestratorService({
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
      }),
      operatorAuthService: createTestOperatorAuthService()
    });
    await authenticateOperatorApp(app);

    const created = await app.inject({
      method: "POST",
      url: "/signals",
      payload: {
        title: "Workflow accountability repo",
        sourceType: "manual",
        rawText:
          "TypeScript repo adds queue visibility, ownership tracking, retry state, and approval recovery."
      }
    });
    const signalId = (created.json() as { id: string }).id;

    await db.createSignalAnalysis({
      signalId,
      relevanceScore: 82,
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
      popularityPotentialScore: 74,
      brandGrowthPotentialScore: 81,
      bestAngle: "workflow accountability is the real rollout layer",
      alternativeAnglesJson: ["ownership gap", "handoff failure"],
      recommendedFormat: "long_linkedin_post",
      audienceEmphasis: "Founders and operators",
      toneGuidance: "Direct and grounded",
      recommendedPillarFinal: "workflow_accountability"
    });
    await db.createOrchestratorDecision({
      signalId,
      decisionType: "high_priority_candidate",
      decisionReason: "Strong enough to draft now.",
      confidenceScore: 84,
      nextAction: "prioritize_for_content",
      requiresHumanReview: true
    });

    const response = await app.inject({
      method: "POST",
      url: `/signals/${signalId}/content`
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(
      expect.objectContaining({
        contentAsset: expect.objectContaining({
          signalId,
          signalAnalysisId: expect.any(String),
          orchestratorDecisionId: expect.any(String),
          longPostDraft: expect.any(String),
          shortPostDraft: expect.any(String),
          hooksJson: expect.any(Array),
          commentAnglesJson: expect.any(Array),
          ctaVariantsJson: expect.any(Array),
          contentStatus: "draft",
          publishReadyFlag: false
        }),
        agentRuns: expect.arrayContaining([
          expect.objectContaining({
            agentName: "content-agent",
            modelTier: "openai",
            providerName: "mock-text",
            status: "completed"
          })
        ])
      })
    );
  });

  it("POST /signals/:id/content returns 409 when premium content generation is unavailable", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();
    app = await buildApp({
      logger: false,
      orchestrator: new OrchestratorService({
        db,
        executionPolicyRouter: new ExecutionPolicyRouter({
          modelAssignments: createModelAssignmentConfigFromEnv({}),
          taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
          availability: {
            localMiraiAvailable: true,
            openAIAvailable: false
          }
        })
      }),
      operatorAuthService: createTestOperatorAuthService()
    });
    await authenticateOperatorApp(app);

    const created = await app.inject({
      method: "POST",
      url: "/signals",
      payload: {
        title: "Blocked content signal",
        sourceType: "manual",
        rawText: "This still needs premium content generation."
      }
    });
    const signalId = (created.json() as { id: string }).id;

    await db.createSignalAnalysis({
      signalId,
      relevanceScore: 72,
      whyRelevant: "Strong enough to evaluate.",
      targetAudience: "Founders and operators",
      businessValueSummary: "Potential content candidate.",
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
      signalId,
      decisionType: "content_candidate",
      decisionReason: "Good enough to draft.",
      confidenceScore: 76,
      nextAction: "queue_for_content_review",
      requiresHumanReview: true
    });

    const response = await app.inject({
      method: "POST",
      url: `/signals/${signalId}/content`
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: expect.stringContaining("required")
    });
  });

  it("POST /signals/:id/run persists a full autonomous signal-pipeline run", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();

    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());

    app = await buildApp({
      logger: false,
      orchestrator: new OrchestratorService({
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
      }),
      operatorAuthService: createTestOperatorAuthService()
    });
    await authenticateOperatorApp(app);

    const created = await app.inject({
      method: "POST",
      url: "/signals",
      payload: {
        title: "Workflow accountability repo",
        sourceType: "manual",
        rawText:
          "Founders and operators care about queue visibility, retry ownership, approval recovery, ROI, and revenue impact after workflow automation rollout."
      }
    });
    const signalId = (created.json() as { id: string }).id;

    const response = await app.inject({
      method: "POST",
      url: `/signals/${signalId}/run`
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(
      expect.objectContaining({
        run: expect.objectContaining({
          signalId,
          runType: "signal_pipeline",
          status: "completed",
          resultMetadata: expect.objectContaining({
            producedSignalAnalysisId: expect.any(String),
            producedContentAssetId: expect.any(String),
            producedCandidateQueueItemId: expect.any(String)
          })
        }),
        analysis: expect.objectContaining({
          signalId
        }),
        candidateQueueItem: expect.objectContaining({
          signalId
        })
      })
    );
  });

  it("POST /analytics/learn persists a snapshot and updates evidence-based memory patterns", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();

    app = await buildApp({
      logger: false,
      orchestrator: new OrchestratorService({ db }),
      operatorAuthService: createTestOperatorAuthService()
    });
    await authenticateOperatorApp(app);

    const signal = await db.createSignal({
      title: "Workflow accountability signal",
      sourceType: "article",
      rawText: "Founders and operators need queue visibility and ownership after rollout.",
      topicTags: ["workflow-accountability"]
    });
    const analysis = await db.createSignalAnalysis({
      signalId: signal.id,
      relevanceScore: 82,
      whyRelevant: "Strong fit.",
      targetAudience: "Founders and operators",
      businessValueSummary: "Practical operator content.",
      painsSolved: ["handoff failure"],
      practicalImplications: ["show ownership"],
      recommendedPillar: "workflow_accountability",
      uniquenessScore: 74,
      uniquenessReason: "Specific operator angle.",
      buildabilityScore: 76,
      buildabilityReason: "Strong practical detail.",
      popularityPotentialScore: 77,
      brandGrowthPotentialScore: 83,
      bestAngle: "ownership_gap",
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
      hook: "The workflow breaks before the model does",
      body: "Ownership matters after rollout.",
      cta: "Compare notes.",
      bestAngle: "ownership_gap",
      recommendedFormat: "long_linkedin_post",
      status: "draft",
      contentStatus: "review",
      publishReadyFlag: false
    });

    const response = await app.inject({
      method: "POST",
      url: "/analytics/learn",
      payload: {
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
        qualitativeNotes: "Strong operator resonance."
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(
      expect.objectContaining({
        snapshot: expect.objectContaining({
          contentAssetId: content.id
        }),
        outcomeClassification: "strong",
        memoryPatterns: expect.arrayContaining([
          expect.objectContaining({
            patternType: "angle",
            patternKey: "angle:strong:ownership-gap"
          })
        ])
      })
    );
  });

  it("POST /content/:id/review persists a canonical critic review and updates publish readiness", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    app = await buildApp({
      logger: false,
      orchestrator: new OrchestratorService({
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
      }),
      operatorAuthService: createTestOperatorAuthService()
    });
    await authenticateOperatorApp(app);

    const created = await app.inject({
      method: "POST",
      url: "/signals",
      payload: {
        title: "Workflow accountability repo",
        sourceType: "manual",
        rawText:
          "TypeScript repo adds queue visibility, ownership tracking, retry state, and approval recovery."
      }
    });
    const signalId = (created.json() as { id: string }).id;

    const analysis = await db.createSignalAnalysis({
      signalId,
      relevanceScore: 82,
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
      popularityPotentialScore: 74,
      brandGrowthPotentialScore: 81,
      bestAngle: "workflow accountability is the real rollout layer",
      alternativeAnglesJson: ["ownership gap", "handoff failure"],
      recommendedFormat: "long_linkedin_post",
      audienceEmphasis: "Founders and operators",
      toneGuidance: "Direct and grounded",
      recommendedPillarFinal: "workflow_accountability"
    });
    const decision = await db.createOrchestratorDecision({
      signalId,
      decisionType: "high_priority_candidate",
      decisionReason: "Strong enough to draft now.",
      confidenceScore: 84,
      nextAction: "prioritize_for_content",
      requiresHumanReview: true
    });
    const idea = await db.createIdea({
      signalId,
      title: "Draft idea",
      coreInsight: "Insight",
      businessRelevance: "Business relevance",
      targetAudience: "Founders and operators",
      status: "draft"
    });
    const content = await db.createContentAsset({
      ideaId: idea.id,
      signalId,
      signalAnalysisId: analysis.id,
      orchestratorDecisionId: decision.id,
      contentType: "linkedin-post",
      hook: "The workflow breaks before the model does",
      body: "Operators lose trust when exceptions have no owner.",
      cta: "Compare notes.",
      longPostDraft:
        "The workflow breaks before the model does.\n\nOperators lose trust when exceptions have no owner.\n\nCompare notes.",
      shortPostDraft:
        "The workflow breaks before the model does.\n\nOperators lose trust when exceptions have no owner.",
      hooksJson: ["The workflow breaks before the model does"],
      commentAnglesJson: ["Ownership matters more than demo quality"],
      ctaVariantsJson: ["Compare notes."],
      status: "draft",
      contentStatus: "draft",
      publishReadyFlag: false
    });

    const response = await app.inject({
      method: "POST",
      url: `/content/${content.id}/review`
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(
      expect.objectContaining({
        criticReview: expect.objectContaining({
          contentAssetId: content.id,
          qualityScore: expect.any(Number),
          genericnessScore: expect.any(Number),
          businessValueScore: expect.any(Number),
          differentiationScore: expect.any(Number),
          publishReadyFlag: expect.any(Boolean),
          rewriteSuggestions: expect.any(Array),
          criticNotes: expect.any(String)
        }),
        contentAsset: expect.objectContaining({
          id: content.id,
          qualityStatus: "reviewed",
          publishReadyFlag: expect.any(Boolean),
          contentStatus: expect.stringMatching(/^(review|ready)$/)
        }),
        agentRuns: expect.arrayContaining([
          expect.objectContaining({
            agentName: "critic-agent",
            modelTier: "openai",
            providerName: "mock-text",
            status: "completed"
          })
        ])
      })
    );
  });

  it("POST /content/:id/review returns 409 when premium critic review is unavailable", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();
    app = await buildApp({
      logger: false,
      orchestrator: new OrchestratorService({
        db,
        executionPolicyRouter: new ExecutionPolicyRouter({
          modelAssignments: createModelAssignmentConfigFromEnv({}),
          taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
          availability: {
            localMiraiAvailable: true,
            openAIAvailable: false
          }
        })
      }),
      operatorAuthService: createTestOperatorAuthService()
    });
    await authenticateOperatorApp(app);

    const created = await app.inject({
      method: "POST",
      url: "/signals",
      payload: {
        title: "Blocked critic signal",
        sourceType: "manual",
        rawText: "This still needs premium critic review."
      }
    });
    const signalId = (created.json() as { id: string }).id;

    const analysis = await db.createSignalAnalysis({
      signalId,
      relevanceScore: 72,
      whyRelevant: "Strong enough to evaluate.",
      targetAudience: "Founders and operators",
      businessValueSummary: "Potential content candidate.",
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
      signalId,
      decisionType: "content_candidate",
      decisionReason: "Good enough to draft.",
      confidenceScore: 76,
      nextAction: "queue_for_content_review",
      requiresHumanReview: true
    });
    const idea = await db.createIdea({
      signalId,
      title: "Draft idea",
      coreInsight: "Insight",
      businessRelevance: "Business relevance",
      targetAudience: "Founders and operators",
      status: "draft"
    });
    const content = await db.createContentAsset({
      ideaId: idea.id,
      signalId,
      signalAnalysisId: analysis.id,
      orchestratorDecisionId: decision.id,
      contentType: "linkedin-post",
      hook: "The workflow breaks before the model does",
      body: "Operators lose trust when exceptions have no owner.",
      cta: "Compare notes.",
      longPostDraft:
        "The workflow breaks before the model does.\n\nOperators lose trust when exceptions have no owner.\n\nCompare notes.",
      shortPostDraft:
        "The workflow breaks before the model does.\n\nOperators lose trust when exceptions have no owner.",
      hooksJson: ["The workflow breaks before the model does"],
      commentAnglesJson: ["Ownership matters more than demo quality"],
      ctaVariantsJson: ["Compare notes."],
      status: "draft",
      contentStatus: "draft",
      publishReadyFlag: false
    });

    const response = await app.inject({
      method: "POST",
      url: `/content/${content.id}/review`
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: expect.stringContaining("required")
    });
  });

  it("POST /signals/:id/enqueue-candidate persists a canonical queue candidate", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();
    app = await buildApp({
      logger: false,
      orchestrator: new OrchestratorService({ db }),
      operatorAuthService: createTestOperatorAuthService()
    });
    await authenticateOperatorApp(app);

    const signal = await db.createSignal({
      title: "Queue signal",
      sourceType: "manual_note",
      rawText: "Workflow accountability is the real rollout layer."
    });
    const analysis = await db.createSignalAnalysis({
      signalId: signal.id,
      relevanceScore: 78,
      whyRelevant: "Strong operator relevance.",
      targetAudience: "Founders and operators",
      businessValueSummary: "Strong content candidate.",
      painsSolved: ["workflow fragility"],
      practicalImplications: ["clarify queue ownership"],
      uniquenessScore: 64,
      uniquenessReason: "Grounded operator detail.",
      buildabilityScore: 68,
      buildabilityReason: "Enough implementation context.",
      popularityPotentialScore: 66,
      brandGrowthPotentialScore: 74
    });
    const solutionMemory = await db.createSolutionMemory({
      signalId: signal.id,
      sourceType: "manual_note",
      implementationPotential: "medium",
      implementationComplexity: "low",
      possibleUseCases: ["Operator review"]
    });
    const decision = await db.createOrchestratorDecision({
      signalId: signal.id,
      decisionType: "manual_review_required",
      decisionReason: "Needs human judgment.",
      confidenceScore: 62,
      nextAction: "request_manual_review",
      requiresHumanReview: true
    });

    const response = await app.inject({
      method: "POST",
      url: `/signals/${signal.id}/enqueue-candidate`
    });

    expect(analysis.id).toBeDefined();
    expect(solutionMemory.id).toBeDefined();
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(
      expect.objectContaining({
        signalId: signal.id,
        signalAnalysisId: analysis.id,
        solutionMemoryId: solutionMemory.id,
        orchestratorDecisionId: decision.id,
        candidateType: "manual_review_required",
        queueState: "manual_review_queue",
        whyQueued: expect.any(String),
        nextAction: "request_manual_review"
      })
    );
  });

  it("rejects protected operational routes without operator authentication", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();

    app = await buildApp({
      logger: false,
      orchestrator: new OrchestratorService({ db }),
      operatorAuthService: createTestOperatorAuthService()
    });

    const response = await app.inject({
      method: "GET",
      url: "/system/providers"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "Operator authentication required."
    });
  });

  it("accepts valid operator login and returns the active session", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();

    app = await buildApp({
      logger: false,
      orchestrator: new OrchestratorService({ db }),
      operatorAuthService: createTestOperatorAuthService()
    });

    const loginResponse = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: operatorCredentials
    });

    expect(loginResponse.statusCode).toBe(200);
    expect(loginResponse.json()).toEqual(
      expect.objectContaining({
        username: "operator",
        token: expect.any(String),
        expiresAt: expect.any(String)
      })
    );

    const sessionResponse = await app.inject({
      method: "GET",
      url: "/auth/session",
      headers: {
        authorization: `Bearer ${(loginResponse.json() as { token: string }).token}`
      }
    });

    expect(sessionResponse.statusCode).toBe(200);
    expect(sessionResponse.json()).toEqual({
      username: "operator",
      expiresAt: expect.any(String)
    });
  });

  it("rejects invalid operator credentials and invalid sessions safely", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();

    app = await buildApp({
      logger: false,
      orchestrator: new OrchestratorService({ db }),
      operatorAuthService: createTestOperatorAuthService()
    });

    const loginResponse = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        username: "operator",
        password: "wrong-password"
      }
    });

    expect(loginResponse.statusCode).toBe(401);
    expect(loginResponse.json()).toEqual({
      error: "Invalid operator credentials."
    });

    const sessionResponse = await app.inject({
      method: "GET",
      url: "/auth/session",
      headers: {
        authorization: "Bearer invalid-token"
      }
    });

    expect(sessionResponse.statusCode).toBe(401);
    expect(sessionResponse.json()).toEqual({
      error: "Invalid or expired operator session."
    });
  });

  it("invalidates the operator session on logout", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();

    app = await buildApp({
      logger: false,
      orchestrator: new OrchestratorService({ db }),
      operatorAuthService: createTestOperatorAuthService()
    });

    const loginResponse = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: operatorCredentials
    });
    const token = (loginResponse.json() as { token: string }).token;

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(logoutResponse.statusCode).toBe(200);
    expect(logoutResponse.json()).toEqual({
      ok: true
    });

    const sessionResponse = await app.inject({
      method: "GET",
      url: "/auth/session",
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(sessionResponse.statusCode).toBe(401);
    expect(sessionResponse.json()).toEqual({
      error: "Invalid or expired operator session."
    });
  });

  it("accepts valid secret-backed login from required runtime env config", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();
    vi.stubEnv("OPERATOR_USERNAME", "secret-operator");
    vi.stubEnv("OPERATOR_PASSWORD", "secret-pass");

    app = await buildApp({
      logger: false,
      orchestrator: new OrchestratorService({ db })
    });

    const loginResponse = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        username: "secret-operator",
        password: "secret-pass"
      }
    });

    expect(loginResponse.statusCode).toBe(200);
    expect(loginResponse.json()).toEqual(
      expect.objectContaining({
        username: "secret-operator",
        token: expect.any(String),
        expiresAt: expect.any(String)
      })
    );
  });

  it("logs auth audit events for invalid login, logout, and protected-route auth failures", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();

    app = await buildApp({
      logger: false,
      orchestrator: new OrchestratorService({ db }),
      operatorAuthService: createTestOperatorAuthService()
    });
    const warnSpy = vi.spyOn(app.log, "warn");
    const infoSpy = vi.spyOn(app.log, "info");

    const unauthenticatedResponse = await app.inject({
      method: "GET",
      url: "/system/providers"
    });
    expect(unauthenticatedResponse.statusCode).toBe(401);

    const invalidLoginResponse = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        username: "operator",
        password: "wrong-password"
      }
    });
    expect(invalidLoginResponse.statusCode).toBe(401);

    const validLoginResponse = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: operatorCredentials
    });
    const token = (validLoginResponse.json() as { token: string }).token;

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    expect(logoutResponse.statusCode).toBe(200);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "operator_auth_failed",
        reason: "missing_token",
        method: "GET",
        path: "/system/providers"
      }),
      "Operator auth failure"
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "operator_auth_login_failed",
        username: "operator"
      }),
      "Operator login rejected"
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "operator_auth_logout",
        username: "operator"
      }),
      "Operator logout"
    );
  });

  it("GET /system/providers returns provider status for an authenticated operator", async () => {
    app = await createAppWithTestDatabase();

    const response = await app.inject({
      method: "GET",
      url: "/system/providers"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        mode: "deterministic",
        textProvider: null,
        visualProvider: null,
        fallbackEnabled: true,
        textProviderStatus: null,
        visualProviderStatus: null
      })
    );
  });

  it("GET /system/ai-runtime-health reports deterministic fallback mode for an authenticated operator", async () => {
    app = await createAppWithTestDatabase();

    const response = await app.inject({
      method: "GET",
      url: "/system/ai-runtime-health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      providerMode: "deterministic",
      textProvider: null,
      visualProvider: null,
      aiActive: false,
      fallbackActive: true,
      runtimeEnabled: true,
      schedulerRuntimeEnabled: false,
      fallbackEnabled: true,
      configStatus: "fallback_active",
      issues: [],
      textProviderStatus: null,
      visualProviderStatus: null,
      operatorAuthConfig: {
        configured: true,
        missingConfigKeys: []
      }
    });
  });

  it("POST /system/ai-probe reports safe inactive status in deterministic fallback mode", async () => {
    app = await createAppWithTestDatabase();

    const response = await app.inject({
      method: "POST",
      url: "/system/ai-probe"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      providerMode: "deterministic",
      textProvider: null,
      aiActive: false,
      fallbackActive: true,
      probeStatus: "inactive",
      probeMessage:
        "Deterministic fallback mode is active; no text provider probe was executed."
    });
  });

  it("GET /system/launch-preflight reports fallback_ready in deterministic fallback mode", async () => {
    app = await createAppWithTestDatabase();

    const response = await app.inject({
      method: "GET",
      url: "/system/launch-preflight"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      launchStatus: "fallback_ready",
      aiReady: false,
      fallbackReady: true,
      providerMode: "deterministic",
      textProvider: null,
      schedulerRuntimeEnabled: false,
      configStatus: "fallback_active",
      issues: [],
      operatorAuthConfig: {
        configured: true,
        missingConfigKeys: []
      }
    });
  });

  it("GET /system/ai-runtime-health reports AI-active mode and scheduler runtime enablement explicitly", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();

    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    const orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "mock",
        textProvider: "mock-text",
        fallbackEnabled: true
      })
    });
    const backgroundSchedulerRuntime = new BackgroundSchedulerRuntime({
      orchestrator,
      enabled: true,
      intervalMs: 60_000
    });

    app = await authenticateOperatorApp(await buildApp({
      logger: false,
      orchestrator,
      backgroundSchedulerRuntime,
      operatorAuthService: createTestOperatorAuthService()
    }));

    const response = await app.inject({
      method: "GET",
      url: "/system/ai-runtime-health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        providerMode: "mock",
        textProvider: "mock-text",
        visualProvider: null,
        aiActive: true,
        fallbackActive: false,
        runtimeEnabled: true,
        schedulerRuntimeEnabled: true,
        fallbackEnabled: true,
        configStatus: "ai_active",
        issues: [],
        operatorAuthConfig: {
          configured: true,
          missingConfigKeys: []
        },
        textProviderStatus: {
          id: "mock-text",
          available: true,
          reason: "Deterministic mock text provider is always available.",
          capabilities: {
            text: true,
            visual: false,
            live: false
          }
        }
      })
    );
  });

  it("POST /system/ai-probe confirms provider response in AI-active mode", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();

    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    const orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "mock",
        textProvider: "mock-text",
        fallbackEnabled: true
      })
    });

    app = await authenticateOperatorApp(await buildApp({
      logger: false,
      orchestrator,
      operatorAuthService: createTestOperatorAuthService()
    }));

    const response = await app.inject({
      method: "POST",
      url: "/system/ai-probe"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      providerMode: "mock",
      textProvider: "mock-text",
      aiActive: true,
      fallbackActive: false,
      probeStatus: "success",
      probeMessage: "Provider 'mock-text' responded to the explicit probe."
    });
  });

  it("GET /system/launch-preflight reports ai_ready when health and probe are both active", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();

    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    const orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "mock",
        textProvider: "mock-text",
        fallbackEnabled: true
      })
    });
    const backgroundSchedulerRuntime = new BackgroundSchedulerRuntime({
      orchestrator,
      enabled: true,
      intervalMs: 60_000
    });

    app = await authenticateOperatorApp(await buildApp({
      logger: false,
      orchestrator,
      backgroundSchedulerRuntime,
      operatorAuthService: createTestOperatorAuthService()
    }));

    const response = await app.inject({
      method: "GET",
      url: "/system/launch-preflight"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      launchStatus: "ai_ready",
      aiReady: true,
      fallbackReady: false,
      providerMode: "mock",
      textProvider: "mock-text",
      schedulerRuntimeEnabled: true,
      configStatus: "ai_active",
      issues: [],
      operatorAuthConfig: {
        configured: true,
        missingConfigKeys: []
      }
    });
  });

  it("GET /system/ai-runtime-health surfaces invalid provider config safely while startup remains available", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();

    const registry = new ProviderRegistry();
    registry.registerTextProvider(
      new MiraiProvider(
        {
          enabled: true,
          transport: "node",
          nodePath: process.execPath
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
                available: false,
                reason: "Mirai runtime not responding."
              }),
              generateText: async () => ({
                text: "unused"
              }),
              getSummary: () => "mirai-default@node"
            }
          })
        }
      )
    );
    const orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "local",
        textProvider: "mirai",
        fallbackEnabled: false
      })
    });

    app = await authenticateOperatorApp(await buildApp({
      logger: false,
      orchestrator,
      operatorAuthService: createTestOperatorAuthService()
    }));

    const response = await app.inject({
      method: "GET",
      url: "/system/ai-runtime-health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        providerMode: "local",
        textProvider: "mirai",
        aiActive: false,
        fallbackActive: false,
        runtimeEnabled: true,
        schedulerRuntimeEnabled: false,
        fallbackEnabled: false,
        configStatus: "invalid",
        issues: ["mirai: Mirai runtime not responding."],
        operatorAuthConfig: {
          configured: true,
          missingConfigKeys: []
        },
        textProviderStatus: {
          id: "mirai",
          available: false,
          reason: "Mirai runtime not responding.",
          capabilities: {
            text: true,
            visual: true,
            live: true
          }
        }
      })
    );
  });

  it("POST /system/ai-probe reports failed status for invalid provider config safely", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();

    const registry = new ProviderRegistry();
    registry.registerTextProvider(
      new MiraiProvider(
        {
          enabled: true,
          transport: "node",
          nodePath: process.execPath
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
                available: false,
                reason: "Mirai runtime not responding."
              }),
              generateText: async () => ({
                text: "unused"
              }),
              getSummary: () => "mirai-default@node"
            }
          })
        }
      )
    );
    const orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "local",
        textProvider: "mirai",
        fallbackEnabled: false
      })
    });

    app = await authenticateOperatorApp(await buildApp({
      logger: false,
      orchestrator,
      operatorAuthService: createTestOperatorAuthService()
    }));

    const response = await app.inject({
      method: "POST",
      url: "/system/ai-probe"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      providerMode: "local",
      textProvider: "mirai",
      aiActive: false,
      fallbackActive: false,
      probeStatus: "failed",
      probeMessage: "Mirai runtime not responding."
    });
  });

  it("GET /system/launch-preflight reports blocked for invalid provider config", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();

    const registry = new ProviderRegistry();
    registry.registerTextProvider(
      new MiraiProvider(
        {
          enabled: true,
          transport: "node",
          nodePath: process.execPath
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
                available: false,
                reason: "Mirai runtime not responding."
              }),
              generateText: async () => ({
                text: "unused"
              }),
              getSummary: () => "mirai-default@node"
            }
          })
        }
      )
    );
    const orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "local",
        textProvider: "mirai",
        fallbackEnabled: false
      })
    });

    app = await authenticateOperatorApp(await buildApp({
      logger: false,
      orchestrator,
      operatorAuthService: createTestOperatorAuthService()
    }));

    const response = await app.inject({
      method: "GET",
      url: "/system/launch-preflight"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      launchStatus: "blocked",
      aiReady: false,
      fallbackReady: false,
      providerMode: "local",
      textProvider: "mirai",
      schedulerRuntimeEnabled: false,
      configStatus: "invalid",
      issues: ["mirai: Mirai runtime not responding."],
      operatorAuthConfig: {
        configured: true,
        missingConfigKeys: []
      }
    });
  });

  it("GET /system/ai-runtime-health reports missing operator auth config without exposing secret values", async () => {
    vi.stubEnv("OPERATOR_USERNAME", "");
    vi.stubEnv("OPERATOR_PASSWORD", "");
    app = await createAppWithTestDatabase();

    const response = await app.inject({
      method: "GET",
      url: "/system/ai-runtime-health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        operatorAuthConfig: {
          configured: false,
          missingConfigKeys: ["OPERATOR_USERNAME", "OPERATOR_PASSWORD"]
        }
      })
    );
    expect(response.body).not.toContain(operatorCredentials.password);
  });

  it("GET /system/launch-preflight reports missing operator auth config without exposing secret values", async () => {
    vi.stubEnv("OPERATOR_USERNAME", "");
    vi.stubEnv("OPERATOR_PASSWORD", "");
    app = await createAppWithTestDatabase();

    const response = await app.inject({
      method: "GET",
      url: "/system/launch-preflight"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        operatorAuthConfig: {
          configured: false,
          missingConfigKeys: ["OPERATOR_USERNAME", "OPERATOR_PASSWORD"]
        }
      })
    );
    expect(response.body).not.toContain(operatorCredentials.password);
  });

  it("POST /system/launch-smoke-run succeeds in fallback-ready mode and returns honest artifact counts", async () => {
    app = await createAppWithTestDatabase();

    const response = await app.inject({
      method: "POST",
      url: "/system/launch-smoke-run"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      launchStatus: "fallback_ready",
      runnable: true,
      smokeTag: expect.stringMatching(/^launch-smoke:/),
      providerMode: "deterministic",
      textProvider: null,
      schedulerRuntimeEnabled: false,
      configStatus: "fallback_active",
      issues: [],
      artifactCounts: {
        ingestionArtifacts: expect.any(Number),
        reviewQueueItems: expect.any(Number),
        matchedOpportunities: expect.any(Number),
        prioritizedOpportunities: expect.any(Number),
        contentWorkItems: expect.any(Number),
        draftDocuments: expect.any(Number)
      }
    });

    const body = response.json();
    expect(body.smokeTag).toMatch(/^launch-smoke:/);
    expect(body.artifactCounts.ingestionArtifacts).toBeGreaterThanOrEqual(1);
    expect(body.artifactCounts.reviewQueueItems).toBeGreaterThanOrEqual(1);
    expect(body.artifactCounts.matchedOpportunities).toBeGreaterThanOrEqual(1);
    expect(body.artifactCounts.prioritizedOpportunities).toBeGreaterThanOrEqual(1);
    expect(body.artifactCounts.contentWorkItems).toBeGreaterThanOrEqual(1);
    expect(body.artifactCounts.draftDocuments).toBeGreaterThanOrEqual(1);

    const watchlistsResponse = await app.inject({
      method: "GET",
      url: "/autonomy/watchlists"
    });
    const smokeWatchlists = watchlistsResponse
      .json()
      .filter((item: { label: string }) => item.label.startsWith("Launch smoke "));
    expect(smokeWatchlists.length).toBeGreaterThan(0);
    expect(
      smokeWatchlists.every((item: { notes?: string }) => item.notes === body.smokeTag)
    ).toBe(true);

    const matchedResponse = await app.inject({
      method: "GET",
      url: "/autonomy/matched-opportunities"
    });
    expect(
      matchedResponse
        .json()
        .some((item: { reviewNote?: string }) => item.reviewNote?.includes(body.smokeTag))
    ).toBe(true);

    const workItemsResponse = await app.inject({
      method: "GET",
      url: "/autonomy/content-work-items"
    });
    expect(
      workItemsResponse
        .json()
        .some((item: { workNote?: string }) => item.workNote === body.smokeTag)
    ).toBe(true);
  });

  it("POST /system/launch-smoke-run succeeds in AI-ready mode when a mock provider is active", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();

    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    const orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "mock",
        textProvider: "mock-text",
        fallbackEnabled: true
      })
    });

    app = await authenticateOperatorApp(await buildApp({
      logger: false,
      orchestrator,
      operatorAuthService: createTestOperatorAuthService()
    }));

    const response = await app.inject({
      method: "POST",
      url: "/system/launch-smoke-run"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        launchStatus: "ai_ready",
        runnable: true,
        smokeTag: expect.stringMatching(/^launch-smoke:/),
        providerMode: "mock",
        textProvider: "mock-text",
        configStatus: "ai_active",
        artifactCounts: expect.objectContaining({
          draftDocuments: expect.any(Number)
        })
      })
    );
  });

  it("POST /system/launch-smoke-run reports blocked mode safely without creating artifacts", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();

    const registry = new ProviderRegistry();
    registry.registerTextProvider(
      new MiraiProvider(
        {
          enabled: true,
          transport: "node",
          nodePath: process.execPath
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
                available: false,
                reason: "Mirai runtime not responding."
              }),
              generateText: async () => ({
                text: "unused"
              }),
              getSummary: () => "mirai-default@node"
            }
          })
        }
      )
    );
    const orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "local",
        textProvider: "mirai",
        fallbackEnabled: false
      })
    });

    app = await authenticateOperatorApp(await buildApp({
      logger: false,
      orchestrator,
      operatorAuthService: createTestOperatorAuthService()
    }));

    const response = await app.inject({
      method: "POST",
      url: "/system/launch-smoke-run"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      launchStatus: "blocked",
      runnable: false,
      providerMode: "local",
      textProvider: "mirai",
      schedulerRuntimeEnabled: false,
      configStatus: "invalid",
      issues: ["mirai: Mirai runtime not responding."],
      artifactCounts: {
        ingestionArtifacts: 0,
        reviewQueueItems: 0,
        matchedOpportunities: 0,
        prioritizedOpportunities: 0,
        contentWorkItems: 0,
        draftDocuments: 0
      }
    });

    const watchlistsResponse = await app.inject({
      method: "GET",
      url: "/autonomy/watchlists"
    });
    expect(
      watchlistsResponse
        .json()
        .some((item: { notes?: string }) => item.notes?.startsWith("launch-smoke:"))
    ).toBe(false);
  });

  it("normal non-smoke artifacts remain untagged", async () => {
    app = await createAppWithTestDatabase();

    const createResponse = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "public_discussion_source",
        label: "Normal watchlist",
        seedExcerpt: "Operators still patch launch handoffs manually after rollout.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json().notes).toBeUndefined();
  });

  it("GET /system/launch-smoke-artifacts lists tagged artifacts by smokeTag only", async () => {
    app = await createAppWithTestDatabase();

    const smokeRunResponse = await app.inject({
      method: "POST",
      url: "/system/launch-smoke-run"
    });
    const smokeTag = smokeRunResponse.json().smokeTag;

    const response = await app.inject({
      method: "GET",
      url: `/system/launch-smoke-artifacts?smokeTag=${encodeURIComponent(smokeTag)}`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      smokeTag,
      summary: {
        watchlistCount: 2,
        matchedOpportunityCount: 1,
        contentWorkItemCount: 1,
        totalCount: 4
      },
      watchlists: expect.arrayContaining([
        expect.objectContaining({
          notes: smokeTag
        })
      ]),
      matchedOpportunities: expect.arrayContaining([
        expect.objectContaining({
          reviewNote: expect.stringContaining(smokeTag)
        })
      ]),
      contentWorkItems: expect.arrayContaining([
        expect.objectContaining({
          workNote: smokeTag
        })
      ])
    });
  });

  it("GET /system/launch-smoke-artifacts excludes non-smoke artifacts", async () => {
    app = await createAppWithTestDatabase();

    const createResponse = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "public_discussion_source",
        label: "Normal watchlist",
        seedExcerpt: "Operators still patch launch handoffs manually after rollout.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    expect(createResponse.statusCode).toBe(201);

    const response = await app.inject({
      method: "GET",
      url: "/system/launch-smoke-artifacts?smokeTag=launch-smoke:missing"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      smokeTag: "launch-smoke:missing",
      summary: {
        watchlistCount: 0,
        matchedOpportunityCount: 0,
        contentWorkItemCount: 0,
        totalCount: 0
      },
      watchlists: [],
      matchedOpportunities: [],
      contentWorkItems: []
    });
  });

  it("DELETE /system/launch-smoke-artifacts removes tagged smoke artifacts by smokeTag", async () => {
    app = await createAppWithTestDatabase();

    const smokeRunResponse = await app.inject({
      method: "POST",
      url: "/system/launch-smoke-run"
    });
    const smokeTag = smokeRunResponse.json().smokeTag;

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/system/launch-smoke-artifacts?smokeTag=${encodeURIComponent(smokeTag)}`
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toEqual({
      smokeTag,
      deletedWatchlistCount: 2,
      deletedMatchedOpportunityCount: 1,
      deletedContentWorkItemCount: 1,
      totalDeleted: 4
    });

    const inspectResponse = await app.inject({
      method: "GET",
      url: `/system/launch-smoke-artifacts?smokeTag=${encodeURIComponent(smokeTag)}`
    });

    expect(inspectResponse.statusCode).toBe(200);
    expect(inspectResponse.json()).toEqual({
      smokeTag,
      summary: {
        watchlistCount: 0,
        matchedOpportunityCount: 0,
        contentWorkItemCount: 0,
        totalCount: 0
      },
      watchlists: [],
      matchedOpportunities: [],
      contentWorkItems: []
    });
  });

  it("DELETE /system/launch-smoke-artifacts leaves non-smoke artifacts untouched", async () => {
    app = await createAppWithTestDatabase();

    const normalWatchlistResponse = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "public_discussion_source",
        label: "Normal watchlist",
        seedExcerpt: "Operators still patch launch handoffs manually after rollout.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    expect(normalWatchlistResponse.statusCode).toBe(201);

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/system/launch-smoke-artifacts?smokeTag=launch-smoke:missing"
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toEqual({
      smokeTag: "launch-smoke:missing",
      deletedWatchlistCount: 0,
      deletedMatchedOpportunityCount: 0,
      deletedContentWorkItemCount: 0,
      totalDeleted: 0
    });

    const watchlistsResponse = await app.inject({
      method: "GET",
      url: "/autonomy/watchlists"
    });
    expect(
      watchlistsResponse.json().some((item: { label: string }) => item.label === "Normal watchlist")
    ).toBe(true);
  });

  it("POST /autonomy/watchlists creates a server-side watchlist and GET /autonomy/watchlists lists it", async () => {
    app = await createAppWithTestDatabase();

    const createResponse = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "public_discussion_source",
        label: "Workflow pain watchlist",
        sourceUrl: "https://example.com/discussions/workflow",
        seedExcerpt: "Operators still patch launch handoffs manually after rollout.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        priority: "high",
        isActive: true
      }
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json()).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^auto-watch-/),
        label: "Workflow pain watchlist",
        nextRunAt: expect.any(String)
      })
    );

    const listResponse = await app.inject({
      method: "GET",
      url: "/autonomy/watchlists"
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual([
      expect.objectContaining({
        label: "Workflow pain watchlist",
        sourceKind: "public_discussion_source"
      })
    ]);
  });

  it("POST /autonomy/scheduler/tick creates an inspectable autonomous run without AI keys", async () => {
    app = await createAppWithTestDatabase();

    const createWatchlist = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "github_release",
        label: "Workflow releases",
        sourceUrl: "https://github.com/example/repo/releases",
        seedExcerpt: "Release notes mention retry ownership and visibility.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "weekly_candidate",
        isActive: true
      }
    });
    const created = createWatchlist.json() as { id: string };

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/autonomy/watchlists/${created.id}`,
      payload: {
        nextRunAt: "2026-03-16T00:00:00.000Z"
      }
    });

    expect(patchResponse.statusCode).toBe(200);

    const tickResponse = await app.inject({
      method: "POST",
      url: "/autonomy/scheduler/tick",
      payload: {
        now: "2026-03-16T00:00:00.000Z"
      }
    });

    expect(tickResponse.statusCode).toBe(201);
    expect(tickResponse.json()).toEqual(
      expect.objectContaining({
        dueWatchlistIds: [created.id],
        runs: [
          expect.objectContaining({
            watchlistId: created.id,
            status: "completed",
            resultMetadata: expect.objectContaining({
              audienceItemCount: 0,
              solutionItemCount: 1,
              usedAi: false
            })
          })
        ]
      })
    );

    const runsResponse = await app.inject({
      method: "GET",
      url: "/autonomy/runs"
    });

    expect(runsResponse.statusCode).toBe(200);
    expect(runsResponse.json()).toEqual([
      expect.objectContaining({
        watchlistId: created.id,
        status: "completed",
        runType: "watchlist_scout_feed"
      })
    ]);
  });

  it("GET /autonomy/ingestion-artifacts exposes persisted automated intake results", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();

    app = await authenticateOperatorApp(await buildApp({
      logger: false,
      orchestrator: new OrchestratorService({
        db,
        watchlistFetch: (async () =>
          ({
            ok: true,
            text: async () =>
              "<html><title>Workflow failures after launch</title><body>Teams still patch broken handoffs manually after launch because ownership stays vague.</body></html>"
          }) as Response) as typeof fetch
      }),
      operatorAuthService: createTestOperatorAuthService()
    }));

    const createWatchlist = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "article_source",
        label: "Workflow article watchlist",
        sourceUrl: "https://example.com/article",
        seedExcerpt: "Teams still patch broken handoffs manually after launch.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    const created = createWatchlist.json() as { id: string };

    await app.inject({
      method: "PATCH",
      url: `/autonomy/watchlists/${created.id}`,
      payload: {
        nextRunAt: "2026-03-16T00:00:00.000Z"
      }
    });

    await app.inject({
      method: "POST",
      url: "/autonomy/scheduler/tick",
      payload: {
        now: "2026-03-16T00:00:00.000Z"
      }
    });

    const artifactsResponse = await app.inject({
      method: "GET",
      url: "/autonomy/ingestion-artifacts"
    });

    expect(artifactsResponse.statusCode).toBe(200);
    expect(artifactsResponse.json()).toEqual([
      expect.objectContaining({
        watchlistId: created.id,
        status: "ingested",
        normalizedSignalText: expect.stringContaining("ownership")
      })
    ]);
  });

  it("GET /autonomy/review-queue exposes durable server-side review backlog items", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();

    app = await authenticateOperatorApp(await buildApp({
      logger: false,
      orchestrator: new OrchestratorService({
        db,
        watchlistFetch: (async () =>
          ({
            ok: true,
            text: async () =>
              "<html><title>Workflow failures after launch</title><body>Teams still patch broken handoffs manually after launch because ownership stays vague.</body></html>"
          }) as Response) as typeof fetch
      }),
      operatorAuthService: createTestOperatorAuthService()
    }));

    const createWatchlist = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "article_source",
        label: "Workflow article watchlist",
        sourceUrl: "https://example.com/article",
        seedExcerpt: "Teams still patch broken handoffs manually after launch.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    const created = createWatchlist.json() as { id: string };

    await app.inject({
      method: "PATCH",
      url: `/autonomy/watchlists/${created.id}`,
      payload: {
        nextRunAt: "2026-03-16T00:00:00.000Z"
      }
    });

    await app.inject({
      method: "POST",
      url: "/autonomy/scheduler/tick",
      payload: {
        now: "2026-03-16T00:00:00.000Z"
      }
    });

    const queueResponse = await app.inject({
      method: "GET",
      url: "/autonomy/review-queue"
    });

    expect(queueResponse.statusCode).toBe(200);
    expect(queueResponse.json()).toEqual([
      expect.objectContaining({
        watchlistId: created.id,
        recommendedAction: expect.any(String),
        rationale: expect.any(String),
        status: "new"
      })
    ]);
  });

  it("GET /autonomy/matched-opportunities exposes durable server-side matched opportunities", async () => {
    app = await createAppWithTestDatabase();

    const createAudienceWatchlist = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "public_discussion_source",
        label: "Workflow pain watchlist",
        seedExcerpt: "Operators still patch broken handoffs manually after rollout.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    const audienceWatchlist = createAudienceWatchlist.json() as { id: string };
    const createSolutionWatchlist = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "article_source",
        label: "Workflow solution watchlist",
        seedExcerpt: "The release adds visibility and retry ownership so teams can recover stalled workflows faster.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    const solutionWatchlist = createSolutionWatchlist.json() as { id: string };

    await app.inject({
      method: "PATCH",
      url: `/autonomy/watchlists/${audienceWatchlist.id}`,
      payload: {
        nextRunAt: "2026-03-16T00:00:00.000Z"
      }
    });

    await app.inject({
      method: "POST",
      url: "/autonomy/scheduler/tick",
      payload: {
        now: "2026-03-16T00:00:00.000Z"
      }
    });

    await app.inject({
      method: "PATCH",
      url: `/autonomy/watchlists/${solutionWatchlist.id}`,
      payload: {
        nextRunAt: "2026-03-17T00:00:00.000Z"
      }
    });

    await app.inject({
      method: "POST",
      url: "/autonomy/scheduler/tick",
      payload: {
        now: "2026-03-17T00:00:00.000Z"
      }
    });

    const matchedResponse = await app.inject({
      method: "GET",
      url: "/autonomy/matched-opportunities"
    });

    expect(matchedResponse.statusCode).toBe(200);
    expect(matchedResponse.json()).toEqual([
      expect.objectContaining({
        watchlistId: solutionWatchlist.id,
        matchedPain: expect.any(String),
        matchedSolutionPattern: expect.any(String),
        recommendedAction: expect.any(String),
        priorityScore: expect.any(Number),
        priorityBand: expect.stringMatching(/high|medium|low/),
        status: "new"
      })
    ]);
  });

  it("GET /autonomy/prioritized-opportunities exposes durable ranked matched opportunities", async () => {
    app = await createAppWithTestDatabase();

    const createAudienceWatchlist = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "public_discussion_source",
        label: "Workflow pain watchlist",
        seedExcerpt: "Operators still patch broken handoffs manually after rollout.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    const audienceWatchlist = createAudienceWatchlist.json() as { id: string };
    const createSolutionWatchlist = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "article_source",
        label: "Workflow solution watchlist",
        seedExcerpt:
          "The release adds visibility and retry ownership so teams can recover stalled workflows faster.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    const solutionWatchlist = createSolutionWatchlist.json() as { id: string };

    await app.inject({
      method: "PATCH",
      url: `/autonomy/watchlists/${audienceWatchlist.id}`,
      payload: {
        nextRunAt: "2026-03-16T00:00:00.000Z"
      }
    });
    await app.inject({
      method: "POST",
      url: "/autonomy/scheduler/tick",
      payload: {
        now: "2026-03-16T00:00:00.000Z"
      }
    });
    await app.inject({
      method: "PATCH",
      url: `/autonomy/watchlists/${solutionWatchlist.id}`,
      payload: {
        nextRunAt: "2026-03-17T00:00:00.000Z"
      }
    });
    await app.inject({
      method: "POST",
      url: "/autonomy/scheduler/tick",
      payload: {
        now: "2026-03-17T00:00:00.000Z"
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/autonomy/prioritized-opportunities"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({
        watchlistId: solutionWatchlist.id,
        recommendedAction: expect.any(String),
        priorityScore: expect.any(Number),
        priorityBand: expect.stringMatching(/high|medium|low/),
        // reviewState may be "new" OR "saved" - auto-promotion kicks in for
        // high-confidence write_post opportunities during scheduler tick
        reviewState: expect.stringMatching(/new|saved/),
        reasonLines: expect.arrayContaining([expect.any(String)])
      })
    ]);
  });

  it("PATCH /autonomy/matched-opportunities/:id/review-state persists server-side triage state safely", async () => {
    app = await createAppWithTestDatabase();

    const createAudienceWatchlist = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "public_discussion_source",
        label: "Workflow pain watchlist",
        seedExcerpt: "Operators still patch broken handoffs manually after rollout.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    const audienceWatchlist = createAudienceWatchlist.json() as { id: string };
    const createSolutionWatchlist = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "article_source",
        label: "Workflow solution watchlist",
        seedExcerpt:
          "The release adds visibility and retry ownership so teams can recover stalled workflows faster.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    const solutionWatchlist = createSolutionWatchlist.json() as { id: string };

    await app.inject({
      method: "PATCH",
      url: `/autonomy/watchlists/${audienceWatchlist.id}`,
      payload: { nextRunAt: "2026-03-16T00:00:00.000Z" }
    });
    await app.inject({
      method: "POST",
      url: "/autonomy/scheduler/tick",
      payload: { now: "2026-03-16T00:00:00.000Z" }
    });
    await app.inject({
      method: "PATCH",
      url: `/autonomy/watchlists/${solutionWatchlist.id}`,
      payload: { nextRunAt: "2026-03-17T00:00:00.000Z" }
    });
    await app.inject({
      method: "POST",
      url: "/autonomy/scheduler/tick",
      payload: { now: "2026-03-17T00:00:00.000Z" }
    });

    const matchedResponse = await app.inject({
      method: "GET",
      url: "/autonomy/matched-opportunities"
    });
    const matched = matchedResponse.json() as Array<{ id: string }>;

    const reviewResponse = await app.inject({
      method: "PATCH",
      url: `/autonomy/matched-opportunities/${matched[0]!.id}/review-state`,
      payload: {
        reviewState: "in_review",
        reviewNote: "Needs operator validation against current queue."
      }
    });

    expect(reviewResponse.statusCode).toBe(200);
    expect(reviewResponse.json()).toEqual(
      expect.objectContaining({
        id: matched[0]!.id,
        reviewState: "in_review",
        reviewNote: "Needs operator validation against current queue.",
        reviewedAt: expect.any(String),
        recommendedAction: expect.any(String),
        priorityScore: expect.any(Number)
      })
    );
  });

  it("GET /autonomy/prioritized-opportunities filters by reviewState without altering rank fields", async () => {
    app = await createAppWithTestDatabase();

    const createAudienceWatchlist = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "public_discussion_source",
        label: "Workflow pain watchlist",
        seedExcerpt: "Operators still patch broken handoffs manually after rollout.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    const audienceWatchlist = createAudienceWatchlist.json() as { id: string };
    const createSolutionWatchlist = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "article_source",
        label: "Workflow solution watchlist",
        seedExcerpt:
          "The release adds visibility and retry ownership so teams can recover stalled workflows faster.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    const solutionWatchlist = createSolutionWatchlist.json() as { id: string };

    await app.inject({
      method: "PATCH",
      url: `/autonomy/watchlists/${audienceWatchlist.id}`,
      payload: { nextRunAt: "2026-03-16T00:00:00.000Z" }
    });
    await app.inject({
      method: "POST",
      url: "/autonomy/scheduler/tick",
      payload: { now: "2026-03-16T00:00:00.000Z" }
    });
    await app.inject({
      method: "PATCH",
      url: `/autonomy/watchlists/${solutionWatchlist.id}`,
      payload: { nextRunAt: "2026-03-17T00:00:00.000Z" }
    });
    await app.inject({
      method: "POST",
      url: "/autonomy/scheduler/tick",
      payload: { now: "2026-03-17T00:00:00.000Z" }
    });

    const allResponse = await app.inject({
      method: "GET",
      url: "/autonomy/prioritized-opportunities"
    });
    const itemId = (allResponse.json() as Array<{ id: string }>)[0]!.id;

    await app.inject({
      method: "PATCH",
      url: `/autonomy/matched-opportunities/${itemId}/review-state`,
      payload: {
        reviewState: "saved",
        reviewNote: "Hold for operator backlog."
      }
    });

    const filteredResponse = await app.inject({
      method: "GET",
      url: "/autonomy/prioritized-opportunities?reviewState=saved"
    });

    expect(filteredResponse.statusCode).toBe(200);
    expect(filteredResponse.json()).toEqual([
      expect.objectContaining({
        id: itemId,
        reviewState: "saved",
        priorityScore: expect.any(Number),
        recommendedAction: expect.any(String)
      })
    ]);
  });

  it("POST /autonomy/matched-opportunities/:id/promote creates one durable content work item from an eligible opportunity", async () => {
    app = await createAppWithTestDatabase();

    const createAudienceWatchlist = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "public_discussion_source",
        label: "Workflow pain watchlist",
        seedExcerpt: "Operators still patch broken handoffs manually after rollout.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    const audienceWatchlist = createAudienceWatchlist.json() as { id: string };
    const createSolutionWatchlist = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "article_source",
        label: "Workflow solution watchlist",
        seedExcerpt:
          "The release adds visibility and retry ownership so teams can recover stalled workflows faster.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    const solutionWatchlist = createSolutionWatchlist.json() as { id: string };

    await app.inject({
      method: "PATCH",
      url: `/autonomy/watchlists/${audienceWatchlist.id}`,
      payload: { nextRunAt: "2026-03-16T00:00:00.000Z" }
    });
    await app.inject({
      method: "POST",
      url: "/autonomy/scheduler/tick",
      payload: { now: "2026-03-16T00:00:00.000Z" }
    });
    await app.inject({
      method: "PATCH",
      url: `/autonomy/watchlists/${solutionWatchlist.id}`,
      payload: { nextRunAt: "2026-03-17T00:00:00.000Z" }
    });
    await app.inject({
      method: "POST",
      url: "/autonomy/scheduler/tick",
      payload: { now: "2026-03-17T00:00:00.000Z" }
    });

    const matchedResponse = await app.inject({
      method: "GET",
      url: "/autonomy/prioritized-opportunities"
    });
    const itemId = (matchedResponse.json() as Array<{ id: string }>)[0]!.id;

    await app.inject({
      method: "PATCH",
      url: `/autonomy/matched-opportunities/${itemId}/review-state`,
      payload: { reviewState: "saved" }
    });

    const promoteResponse = await app.inject({
      method: "POST",
      url: `/autonomy/matched-opportunities/${itemId}/promote`
    });

    expect(promoteResponse.statusCode).toBe(201);
    expect(promoteResponse.json()).toEqual(
      expect.objectContaining({
        sourceMatchedOpportunityId: itemId,
        recommendedAction: expect.any(String),
        priorityScore: expect.any(Number),
        reviewState: "saved"
      })
    );

    const listResponse = await app.inject({
      method: "GET",
      url: "/autonomy/content-work-items"
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual([
      expect.objectContaining({
        sourceMatchedOpportunityId: itemId
      })
    ]);
  });

  it("POST /autonomy/matched-opportunities/:id/promote rejects ineligible items and remains idempotent for eligible ones", async () => {
    app = await createAppWithTestDatabase();

    const createAudienceWatchlist = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "public_discussion_source",
        label: "Workflow pain watchlist",
        seedExcerpt: "Operators still patch broken handoffs manually after rollout.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    const audienceWatchlist = createAudienceWatchlist.json() as { id: string };
    const createSolutionWatchlist = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "article_source",
        label: "Workflow solution watchlist",
        seedExcerpt:
          "The release adds visibility and retry ownership so teams can recover stalled workflows faster.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    const solutionWatchlist = createSolutionWatchlist.json() as { id: string };

    await app.inject({
      method: "PATCH",
      url: `/autonomy/watchlists/${audienceWatchlist.id}`,
      payload: { nextRunAt: "2026-03-16T00:00:00.000Z" }
    });
    await app.inject({
      method: "POST",
      url: "/autonomy/scheduler/tick",
      payload: { now: "2026-03-16T00:00:00.000Z" }
    });
    await app.inject({
      method: "PATCH",
      url: `/autonomy/watchlists/${solutionWatchlist.id}`,
      payload: { nextRunAt: "2026-03-17T00:00:00.000Z" }
    });
    await app.inject({
      method: "POST",
      url: "/autonomy/scheduler/tick",
      payload: { now: "2026-03-17T00:00:00.000Z" }
    });

    const matchedResponse = await app.inject({
      method: "GET",
      url: "/autonomy/prioritized-opportunities"
    });
    const itemId = (matchedResponse.json() as Array<{ id: string }>)[0]!.id;

    // Scheduler auto-promotes high-confidence write_post opportunities to "saved"
    // state. Reset to "new" so we test the rejection path for ineligible state.
    await app.inject({
      method: "PATCH",
      url: `/autonomy/matched-opportunities/${itemId}/review-state`,
      payload: { reviewState: "new" }
    });

    const rejected = await app.inject({
      method: "POST",
      url: `/autonomy/matched-opportunities/${itemId}/promote`
    });
    expect(rejected.statusCode).toBe(409);

    await app.inject({
      method: "PATCH",
      url: `/autonomy/matched-opportunities/${itemId}/review-state`,
      payload: { reviewState: "in_review" }
    });

    const first = await app.inject({
      method: "POST",
      url: `/autonomy/matched-opportunities/${itemId}/promote`
    });
    const second = await app.inject({
      method: "POST",
      url: `/autonomy/matched-opportunities/${itemId}/promote`
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(
      expect.objectContaining({
        id: first.json().id,
        sourceMatchedOpportunityId: itemId
      })
    );

    const listResponse = await app.inject({
      method: "GET",
      url: "/autonomy/content-work-items"
    });
    expect(listResponse.json()).toHaveLength(1);
  });

  it("GET /autonomy/content-work-items supports deterministic workspace filtering and single-item inspection", async () => {
    app = await createAppWithTestDatabase();

    const createAudienceWatchlist = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "public_discussion_source",
        label: "Workflow pain watchlist",
        seedExcerpt: "Operators still patch broken handoffs manually after rollout.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    const audienceWatchlist = createAudienceWatchlist.json() as { id: string };
    const createSolutionWatchlist = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "article_source",
        label: "Workflow solution watchlist",
        seedExcerpt:
          "The release adds visibility and retry ownership so teams can recover stalled workflows faster.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    const solutionWatchlist = createSolutionWatchlist.json() as { id: string };

    await app.inject({
      method: "PATCH",
      url: `/autonomy/watchlists/${audienceWatchlist.id}`,
      payload: { nextRunAt: "2026-03-16T00:00:00.000Z" }
    });
    await app.inject({
      method: "POST",
      url: "/autonomy/scheduler/tick",
      payload: { now: "2026-03-16T00:00:00.000Z" }
    });
    await app.inject({
      method: "PATCH",
      url: `/autonomy/watchlists/${solutionWatchlist.id}`,
      payload: { nextRunAt: "2026-03-17T00:00:00.000Z" }
    });
    await app.inject({
      method: "POST",
      url: "/autonomy/scheduler/tick",
      payload: { now: "2026-03-17T00:00:00.000Z" }
    });

    const matchedResponse = await app.inject({
      method: "GET",
      url: "/autonomy/prioritized-opportunities"
    });
    const itemId = (matchedResponse.json() as Array<{ id: string }>)[0]!.id;

    await app.inject({
      method: "PATCH",
      url: `/autonomy/matched-opportunities/${itemId}/review-state`,
      payload: { reviewState: "saved" }
    });
    const promoteResponse = await app.inject({
      method: "POST",
      url: `/autonomy/matched-opportunities/${itemId}/promote`
    });
    const workItemId = promoteResponse.json().id as string;

    const filtered = await app.inject({
      method: "GET",
      url: "/autonomy/content-work-items?kind=post&status=draft"
    });
    const single = await app.inject({
      method: "GET",
      url: `/autonomy/content-work-items/${workItemId}`
    });

    expect(filtered.statusCode).toBe(200);
    expect(filtered.json()).toEqual([
      expect.objectContaining({
        id: workItemId,
        workItemKind: "post",
        status: "draft",
        sourceMatchedOpportunityId: itemId,
        draftSeed: expect.objectContaining({
          recommendedAction: "write_post"
        }),
        // Scheduler auto-promotes high-confidence write_post opportunities AND
        // auto-creates a basic draft document. So work item starts with hasDraft=true.
        draftProgress: expect.objectContaining({
          hasDraft: true
        })
      })
    ]);
    expect(single.statusCode).toBe(200);
    expect(single.json()).toEqual(
      expect.objectContaining({
        id: workItemId,
        recommendedAction: expect.any(String),
        priorityScore: expect.any(Number),
        reviewState: "saved",
        draftSeed: expect.objectContaining({
          title: expect.any(String),
          seedText: expect.any(String)
        }),
        draftProgress: expect.objectContaining({
          hasDraft: true
        })
      })
    );
  });

  it("PATCH /autonomy/content-work-items/:id/status persists workflow-state changes and keeps filtering stable", async () => {
    app = await createAppWithTestDatabase();

    const createAudienceWatchlist = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "public_discussion_source",
        label: "Workflow pain watchlist",
        seedExcerpt: "Operators still patch broken handoffs manually after rollout.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    const audienceWatchlist = createAudienceWatchlist.json() as { id: string };
    const createSolutionWatchlist = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "article_source",
        label: "Workflow solution watchlist",
        seedExcerpt:
          "The release adds visibility and retry ownership so teams can recover stalled workflows faster.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    const solutionWatchlist = createSolutionWatchlist.json() as { id: string };

    await app.inject({
      method: "PATCH",
      url: `/autonomy/watchlists/${audienceWatchlist.id}`,
      payload: { nextRunAt: "2026-03-16T00:00:00.000Z" }
    });
    await app.inject({
      method: "POST",
      url: "/autonomy/scheduler/tick",
      payload: { now: "2026-03-16T00:00:00.000Z" }
    });
    await app.inject({
      method: "PATCH",
      url: `/autonomy/watchlists/${solutionWatchlist.id}`,
      payload: { nextRunAt: "2026-03-17T00:00:00.000Z" }
    });
    await app.inject({
      method: "POST",
      url: "/autonomy/scheduler/tick",
      payload: { now: "2026-03-17T00:00:00.000Z" }
    });

    const matchedResponse = await app.inject({
      method: "GET",
      url: "/autonomy/prioritized-opportunities"
    });
    const itemId = (matchedResponse.json() as Array<{ id: string }>)[0]!.id;

    await app.inject({
      method: "PATCH",
      url: `/autonomy/matched-opportunities/${itemId}/review-state`,
      payload: { reviewState: "saved" }
    });
    const promoteResponse = await app.inject({
      method: "POST",
      url: `/autonomy/matched-opportunities/${itemId}/promote`
    });
    const workItemId = promoteResponse.json().id as string;

    const statusResponse = await app.inject({
      method: "PATCH",
      url: `/autonomy/content-work-items/${workItemId}/status`,
      payload: {
        status: "ready_for_draft",
        workNote: "Ready for the next drafting pass."
      }
    });

    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toEqual(
      expect.objectContaining({
        id: workItemId,
        status: "ready_for_draft",
        workNote: "Ready for the next drafting pass.",
        stateChangedAt: expect.any(String),
        sourceMatchedOpportunityId: itemId
      })
    );

    const filtered = await app.inject({
      method: "GET",
      url: "/autonomy/content-work-items?status=ready_for_draft"
    });

    expect(filtered.statusCode).toBe(200);
    expect(filtered.json()).toEqual([
      expect.objectContaining({
        id: workItemId,
        status: "ready_for_draft",
        draftSeed: expect.objectContaining({
          recommendedAction: "write_post"
        })
      })
    ]);
  });

  it("POST /autonomy/content-work-items/:id/draft creates one durable draft document and exposes it via API", async () => {
    app = await createAppWithTestDatabase();

    const createAudienceWatchlist = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "public_discussion_source",
        label: "Workflow pain watchlist",
        seedExcerpt: "Operators still patch broken handoffs manually after rollout.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    const audienceWatchlist = createAudienceWatchlist.json() as { id: string };
    const createSolutionWatchlist = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "article_source",
        label: "Workflow solution watchlist",
        seedExcerpt:
          "The release adds visibility and retry ownership so teams can recover stalled workflows faster.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    const solutionWatchlist = createSolutionWatchlist.json() as { id: string };

    await app.inject({
      method: "PATCH",
      url: `/autonomy/watchlists/${audienceWatchlist.id}`,
      payload: { nextRunAt: "2026-03-16T00:00:00.000Z" }
    });
    await app.inject({
      method: "POST",
      url: "/autonomy/scheduler/tick",
      payload: { now: "2026-03-16T00:00:00.000Z" }
    });
    await app.inject({
      method: "PATCH",
      url: `/autonomy/watchlists/${solutionWatchlist.id}`,
      payload: { nextRunAt: "2026-03-17T00:00:00.000Z" }
    });
    await app.inject({
      method: "POST",
      url: "/autonomy/scheduler/tick",
      payload: { now: "2026-03-17T00:00:00.000Z" }
    });

    const matchedResponse = await app.inject({
      method: "GET",
      url: "/autonomy/prioritized-opportunities"
    });
    const itemId = (matchedResponse.json() as Array<{ id: string }>)[0]!.id;

    await app.inject({
      method: "PATCH",
      url: `/autonomy/matched-opportunities/${itemId}/review-state`,
      payload: { reviewState: "saved" }
    });
    const promoteResponse = await app.inject({
      method: "POST",
      url: `/autonomy/matched-opportunities/${itemId}/promote`
    });
    const workItemId = promoteResponse.json().id as string;

    const first = await app.inject({
      method: "POST",
      url: `/autonomy/content-work-items/${workItemId}/draft`
    });
    const second = await app.inject({
      method: "POST",
      url: `/autonomy/content-work-items/${workItemId}/draft`
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(
      expect.objectContaining({
        id: first.json().id,
        sourceContentWorkItemId: workItemId,
        status: "draft"
      })
    );

    const listResponse = await app.inject({
      method: "GET",
      url: "/autonomy/drafts"
    });
    const draftId = first.json().id as string;
    const singleResponse = await app.inject({
      method: "GET",
      url: `/autonomy/drafts/${draftId}`
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual([
      expect.objectContaining({
        id: draftId,
        sourceContentWorkItemId: workItemId,
        title: expect.any(String),
        body: expect.any(String)
      })
    ]);
    expect(singleResponse.statusCode).toBe(200);
    expect(singleResponse.json()).toEqual(
      expect.objectContaining({
        id: draftId,
        sourceContentWorkItemId: workItemId,
        recommendedAction: "write_post"
      })
    );

    const workspaceResponse = await app.inject({
      method: "GET",
      url: `/autonomy/content-work-items/${workItemId}`
    });
    expect(workspaceResponse.statusCode).toBe(200);
    expect(workspaceResponse.json()).toEqual(
      expect.objectContaining({
        id: workItemId,
        draftProgress: expect.objectContaining({
          hasDraft: true,
          draftId,
          draftStatus: "draft",
          draftUpdatedAt: expect.any(String)
        })
      })
    );
  });

  it("GET /autonomy/drafts supports status filtering safely", async () => {
    app = await createAppWithTestDatabase();

    const firstWorkItem = await db!.upsertAutonomousContentWorkItem({
      sourceMatchedOpportunityId: "matched-first",
      watchlistId: "watch-first",
      autonomousRunId: "run-first",
      workItemKind: "post",
      title: "First promoted workflow angle",
      summary: "First deterministic drafting target",
      rationale: "Keeps API draft filter coverage explicit.",
      recommendedAction: "write_post",
      priorityScore: 90,
      priorityBand: "high",
      reviewState: "saved",
      draftSeed: {
        title: "First deterministic draft",
        angle: "Ownership gap",
        seedText: "First draft seed text.",
        sourceSummary: "First deterministic drafting target",
        rationale: "Keeps API draft filter coverage explicit.",
        recommendedAction: "write_post",
        priorityBand: "high"
      }
    });
    const firstDraft = await db!.upsertAutonomousDraftDocument({
      sourceContentWorkItemId: firstWorkItem.id,
      title: firstWorkItem.draftSeed!.title,
      body: firstWorkItem.draftSeed!.seedText,
      angle: firstWorkItem.draftSeed!.angle,
      sourceSummary: firstWorkItem.draftSeed!.sourceSummary,
      recommendedAction: firstWorkItem.draftSeed!.recommendedAction
    });
    const secondWorkItem = await db!.upsertAutonomousContentWorkItem({
      sourceMatchedOpportunityId: "matched-second",
      watchlistId: "watch-second",
      autonomousRunId: "run-second",
      workItemKind: "comment",
      title: "Second promoted workflow angle",
      summary: "A second deterministic drafting target",
      rationale: "Keeps API draft filter coverage explicit.",
      recommendedAction: "write_comment",
      priorityScore: 74,
      priorityBand: "medium",
      reviewState: "saved",
      draftSeed: {
        title: "Second deterministic draft",
        angle: "Comment-first angle",
        seedText: "Comment draft seed text.",
        sourceSummary: "A second deterministic drafting target",
        rationale: "Keeps API draft filter coverage explicit.",
        recommendedAction: "write_comment",
        priorityBand: "medium"
      }
    });
    const secondDraft = await db!.upsertAutonomousDraftDocument({
      sourceContentWorkItemId: secondWorkItem.id,
      title: secondWorkItem.draftSeed!.title,
      body: secondWorkItem.draftSeed!.seedText,
      angle: secondWorkItem.draftSeed!.angle,
      sourceSummary: secondWorkItem.draftSeed!.sourceSummary,
      recommendedAction: secondWorkItem.draftSeed!.recommendedAction
    });
    await db!.updateAutonomousDraftDocumentStatus(firstDraft.id, { status: "ready" });

    const readyResponse = await app.inject({
      method: "GET",
      url: "/autonomy/drafts?status=ready"
    });
    const draftResponse = await app.inject({
      method: "GET",
      url: "/autonomy/drafts?status=draft"
    });
    const archivedResponse = await app.inject({
      method: "GET",
      url: "/autonomy/drafts?status=archived"
    });

    expect(readyResponse.statusCode).toBe(200);
    expect(readyResponse.json()).toEqual([
      expect.objectContaining({
        id: firstDraft.id,
        status: "ready",
        sourceContentWorkItemId: firstWorkItem.id,
        sourceWorkItemTitle: firstWorkItem.title,
        sourceWorkItemStatus: firstWorkItem.status,
        sourceWorkItemRecommendedAction: firstWorkItem.recommendedAction,
        sourceWorkItemSummary: firstWorkItem.summary
      })
    ]);
    expect(draftResponse.statusCode).toBe(200);
    expect(draftResponse.json()).toEqual([
      expect.objectContaining({
        id: secondDraft.id,
        status: "draft",
        sourceContentWorkItemId: secondWorkItem.id
      })
    ]);
    expect(archivedResponse.statusCode).toBe(200);
    expect(archivedResponse.json()).toEqual([]);
  });

  it("GET /autonomy/drafts supports server-side sorting safely without changing the default order", async () => {
    app = await createAppWithTestDatabase();
    vi.useFakeTimers();

    vi.setSystemTime(new Date("2026-03-16T14:00:00.000Z"));
    const firstWorkItem = await db!.upsertAutonomousContentWorkItem({
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
    const firstDraft = await db!.upsertAutonomousDraftDocument({
      sourceContentWorkItemId: firstWorkItem.id,
      title: firstWorkItem.draftSeed!.title,
      body: firstWorkItem.draftSeed!.seedText,
      angle: firstWorkItem.draftSeed!.angle,
      sourceSummary: firstWorkItem.draftSeed!.sourceSummary,
      recommendedAction: firstWorkItem.draftSeed!.recommendedAction
    });
    vi.setSystemTime(new Date("2026-03-16T14:10:00.000Z"));
    const secondWorkItem = await db!.upsertAutonomousContentWorkItem({
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
    const secondDraft = await db!.upsertAutonomousDraftDocument({
      sourceContentWorkItemId: secondWorkItem.id,
      title: secondWorkItem.draftSeed!.title,
      body: secondWorkItem.draftSeed!.seedText,
      angle: secondWorkItem.draftSeed!.angle,
      sourceSummary: secondWorkItem.draftSeed!.sourceSummary,
      recommendedAction: secondWorkItem.draftSeed!.recommendedAction
    });
    vi.setSystemTime(new Date("2026-03-16T14:20:00.000Z"));
    const thirdWorkItem = await db!.upsertAutonomousContentWorkItem({
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
    const thirdDraft = await db!.upsertAutonomousDraftDocument({
      sourceContentWorkItemId: thirdWorkItem.id,
      title: thirdWorkItem.draftSeed!.title,
      body: thirdWorkItem.draftSeed!.seedText,
      angle: thirdWorkItem.draftSeed!.angle,
      sourceSummary: thirdWorkItem.draftSeed!.sourceSummary,
      recommendedAction: thirdWorkItem.draftSeed!.recommendedAction
    });

    vi.setSystemTime(new Date("2026-03-16T14:30:00.000Z"));
    await db!.updateAutonomousDraftDocumentStatus(firstDraft.id, { status: "ready" });
    vi.setSystemTime(new Date("2026-03-16T14:40:00.000Z"));
    await db!.updateAutonomousDraftDocumentStatus(secondDraft.id, { status: "blocked" });

    const defaultResponse = await app.inject({
      method: "GET",
      url: "/autonomy/drafts"
    });
    const updatedAscResponse = await app.inject({
      method: "GET",
      url: "/autonomy/drafts?sort=updated_asc"
    });
    const statusResponse = await app.inject({
      method: "GET",
      url: "/autonomy/drafts?sort=status"
    });

    expect(defaultResponse.statusCode).toBe(200);
    expect(defaultResponse.json()).toEqual([
      expect.objectContaining({ id: secondDraft.id }),
      expect.objectContaining({ id: firstDraft.id }),
      expect.objectContaining({ id: thirdDraft.id })
    ]);
    expect(updatedAscResponse.statusCode).toBe(200);
    expect(updatedAscResponse.json()).toEqual([
      expect.objectContaining({ id: thirdDraft.id }),
      expect.objectContaining({ id: firstDraft.id }),
      expect.objectContaining({ id: secondDraft.id })
    ]);
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toEqual([
      expect.objectContaining({ id: thirdDraft.id, status: "draft" }),
      expect.objectContaining({ id: firstDraft.id, status: "ready" }),
      expect.objectContaining({ id: secondDraft.id, status: "blocked" })
    ]);
  });

  it("GET /autonomy/drafts projects source work-item title and status safely", async () => {
    app = await createAppWithTestDatabase();

    const sourceWorkItem = await db!.upsertAutonomousContentWorkItem({
      sourceMatchedOpportunityId: "matched-source",
      watchlistId: "watch-source",
      autonomousRunId: "run-source",
      workItemKind: "post",
      title: "Projected source work item",
      summary: "Source projection should stay on the draft row.",
      rationale: "Keeps queue context visible without an extra fetch.",
      recommendedAction: "write_post",
      priorityScore: 88,
      priorityBand: "high",
      reviewState: "saved",
      status: "blocked"
    });
    const projectedDraft = await db!.upsertAutonomousDraftDocument({
      sourceContentWorkItemId: sourceWorkItem.id,
      title: "Projected draft",
      body: "Projected body",
      angle: "Projection angle",
      sourceSummary: sourceWorkItem.summary,
      recommendedAction: sourceWorkItem.recommendedAction
    });
    const missingSourceDraft = await db!.upsertAutonomousDraftDocument({
      sourceContentWorkItemId: "work-missing",
      title: "Missing source draft",
      body: "Missing source body",
      sourceSummary: "Missing source summary",
      recommendedAction: "write_post"
    });

    const response = await app.inject({
      method: "GET",
      url: "/autonomy/drafts"
    });
    const responseBody = response.json();

    expect(response.statusCode).toBe(200);
    expect(responseBody).toEqual(
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
          sourceContentWorkItemId: "work-missing"
        })
      ])
    );
    const missingSourceRow = responseBody.find(
      (draft: { id: string }) => draft.id === missingSourceDraft.id
    );
    expect(missingSourceRow).toBeDefined();
    expect(missingSourceRow).not.toHaveProperty("sourceWorkItemTitle");
    expect(missingSourceRow).not.toHaveProperty("sourceWorkItemStatus");
    expect(missingSourceRow).not.toHaveProperty("sourceWorkItemRecommendedAction");
    expect(missingSourceRow).not.toHaveProperty("sourceWorkItemSummary");
  });

  it("GET /autonomy/content-work-items supports derived draft progress filters safely", async () => {
    app = await createAppWithTestDatabase();

    const createAudienceWatchlist = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "public_discussion_source",
        label: "Workflow pain watchlist",
        seedExcerpt: "Operators still patch broken handoffs manually after rollout.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    const audienceWatchlist = createAudienceWatchlist.json() as { id: string };
    const createSolutionWatchlist = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "article_source",
        label: "Workflow solution watchlist",
        seedExcerpt:
          "The release adds visibility and retry ownership so teams can recover stalled workflows faster.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    const solutionWatchlist = createSolutionWatchlist.json() as { id: string };

    await app.inject({
      method: "PATCH",
      url: `/autonomy/watchlists/${audienceWatchlist.id}`,
      payload: { nextRunAt: "2026-03-16T00:00:00.000Z" }
    });
    await app.inject({
      method: "POST",
      url: "/autonomy/scheduler/tick",
      payload: { now: "2026-03-16T00:00:00.000Z" }
    });
    await app.inject({
      method: "PATCH",
      url: `/autonomy/watchlists/${solutionWatchlist.id}`,
      payload: { nextRunAt: "2026-03-17T00:00:00.000Z" }
    });
    await app.inject({
      method: "POST",
      url: "/autonomy/scheduler/tick",
      payload: { now: "2026-03-17T00:00:00.000Z" }
    });

    const matchedResponse = await app.inject({
      method: "GET",
      url: "/autonomy/prioritized-opportunities"
    });
    const itemId = (matchedResponse.json() as Array<{ id: string }>)[0]!.id;

    await app.inject({
      method: "PATCH",
      url: `/autonomy/matched-opportunities/${itemId}/review-state`,
      payload: { reviewState: "saved" }
    });
    const promoteResponse = await app.inject({
      method: "POST",
      url: `/autonomy/matched-opportunities/${itemId}/promote`
    });
    const workItemId = promoteResponse.json().id as string;

    const noDraftResponse = await app.inject({
      method: "GET",
      url: "/autonomy/content-work-items?hasDraft=false"
    });

    // Scheduler auto-creates draft for promoted work items, so hasDraft=false filter
    // returns empty (the work item already has a draft from auto-promotion).
    expect(noDraftResponse.statusCode).toBe(200);
    expect(noDraftResponse.json()).toEqual([]);

    const createDraftResponse = await app.inject({
      method: "POST",
      url: `/autonomy/content-work-items/${workItemId}/draft`
    });
    const draftId = createDraftResponse.json().id as string;
    await app.inject({
      method: "PATCH",
      url: `/autonomy/drafts/${draftId}/status`,
      payload: { status: "ready" }
    });

    const hasDraftResponse = await app.inject({
      method: "GET",
      url: "/autonomy/content-work-items?hasDraft=true"
    });
    const readyDraftResponse = await app.inject({
      method: "GET",
      url: "/autonomy/content-work-items?draftStatus=ready"
    });
    const blockedDraftResponse = await app.inject({
      method: "GET",
      url: "/autonomy/content-work-items?draftStatus=blocked"
    });

    expect(hasDraftResponse.statusCode).toBe(200);
    expect(hasDraftResponse.json()).toEqual([
      expect.objectContaining({
        id: workItemId,
        draftProgress: expect.objectContaining({
          hasDraft: true,
          draftId,
          draftStatus: "ready",
          draftUpdatedAt: expect.any(String)
        })
      })
    ]);
    expect(readyDraftResponse.statusCode).toBe(200);
    expect(readyDraftResponse.json()).toEqual([
      expect.objectContaining({
        id: workItemId,
        draftProgress: expect.objectContaining({
          hasDraft: true,
          draftStatus: "ready"
        })
      })
    ]);
    expect(blockedDraftResponse.statusCode).toBe(200);
    expect(blockedDraftResponse.json()).toEqual([]);
  });

  it("GET /autonomy/content-work-items supports alternate server-side workspace sorting safely", async () => {
    app = await createAppWithTestDatabase();

    const older = await db!.upsertAutonomousContentWorkItem({
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
    const newer = await db!.upsertAutonomousContentWorkItem({
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
    const draft = await db!.upsertAutonomousDraftDocument({
      sourceContentWorkItemId: newer.id,
      title: "Draft",
      body: "Body",
      sourceSummary: "Summary",
      recommendedAction: "write_post"
    });
    await db!.updateAutonomousDraftDocumentStatus(draft.id, { status: "ready" });

    const defaultResponse = await app.inject({
      method: "GET",
      url: "/autonomy/content-work-items"
    });
    const ascendingResponse = await app.inject({
      method: "GET",
      url: "/autonomy/content-work-items?sort=updated_asc"
    });
    const statusResponse = await app.inject({
      method: "GET",
      url: "/autonomy/content-work-items?sort=status"
    });
    const hasDraftResponse = await app.inject({
      method: "GET",
      url: "/autonomy/content-work-items?sort=has_draft"
    });

    expect(defaultResponse.statusCode).toBe(200);
    expect(defaultResponse.json()).toEqual([
      expect.objectContaining({ id: newer.id }),
      expect.objectContaining({ id: older.id })
    ]);
    expect(ascendingResponse.statusCode).toBe(200);
    expect(ascendingResponse.json()).toEqual([
      expect.objectContaining({ id: older.id }),
      expect.objectContaining({ id: newer.id })
    ]);
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toEqual([
      expect.objectContaining({ id: newer.id, status: "ready_for_draft" }),
      expect.objectContaining({ id: older.id, status: "blocked" })
    ]);
    expect(hasDraftResponse.statusCode).toBe(200);
    expect(hasDraftResponse.json()).toEqual([
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

  it("PATCH /autonomy/drafts/:id persists explicit draft updates without mutating source work item context", async () => {
    app = await createAppWithTestDatabase();

    const createAudienceWatchlist = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "public_discussion_source",
        label: "Workflow pain watchlist",
        seedExcerpt: "Operators still patch broken handoffs manually after rollout.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    const audienceWatchlist = createAudienceWatchlist.json() as { id: string };
    const createSolutionWatchlist = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "article_source",
        label: "Workflow solution watchlist",
        seedExcerpt:
          "The release adds visibility and retry ownership so teams can recover stalled workflows faster.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    const solutionWatchlist = createSolutionWatchlist.json() as { id: string };

    await app.inject({
      method: "PATCH",
      url: `/autonomy/watchlists/${audienceWatchlist.id}`,
      payload: { nextRunAt: "2026-03-16T00:00:00.000Z" }
    });
    await app.inject({
      method: "POST",
      url: "/autonomy/scheduler/tick",
      payload: { now: "2026-03-16T00:00:00.000Z" }
    });
    await app.inject({
      method: "PATCH",
      url: `/autonomy/watchlists/${solutionWatchlist.id}`,
      payload: { nextRunAt: "2026-03-17T00:00:00.000Z" }
    });
    await app.inject({
      method: "POST",
      url: "/autonomy/scheduler/tick",
      payload: { now: "2026-03-17T00:00:00.000Z" }
    });

    const matchedResponse = await app.inject({
      method: "GET",
      url: "/autonomy/prioritized-opportunities"
    });
    const itemId = (matchedResponse.json() as Array<{ id: string }>)[0]!.id;

    await app.inject({
      method: "PATCH",
      url: `/autonomy/matched-opportunities/${itemId}/review-state`,
      payload: { reviewState: "saved" }
    });
    const promoteResponse = await app.inject({
      method: "POST",
      url: `/autonomy/matched-opportunities/${itemId}/promote`
    });
    const workItemId = promoteResponse.json().id as string;
    const createDraftResponse = await app.inject({
      method: "POST",
      url: `/autonomy/content-work-items/${workItemId}/draft`
    });
    const draftId = createDraftResponse.json().id as string;

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/autonomy/drafts/${draftId}`,
      payload: {
        title: "Refined workflow accountability title",
        body: "A tighter operator-facing draft body.",
        angle: "Focus on recovery ownership after launch.",
        sourceContentWorkItemId: "ignored-at-runtime"
      }
    });

    expect(updateResponse.statusCode).toBe(400);
    expect(updateResponse.json()).toEqual(
      expect.objectContaining({
        error: expect.any(Object)
      })
    );

    const validUpdateResponse = await app.inject({
      method: "PATCH",
      url: `/autonomy/drafts/${draftId}`,
      payload: {
        title: "Refined workflow accountability title",
        body: "A tighter operator-facing draft body.",
        angle: "Focus on recovery ownership after launch."
      }
    });

    expect(validUpdateResponse.statusCode).toBe(200);
    expect(validUpdateResponse.json()).toEqual(
      expect.objectContaining({
        id: draftId,
        sourceContentWorkItemId: workItemId,
        title: "Refined workflow accountability title",
        body: "A tighter operator-facing draft body.",
        angle: "Focus on recovery ownership after launch.",
        status: "draft"
      })
    );

    const statusAttemptResponse = await app.inject({
      method: "PATCH",
      url: `/autonomy/drafts/${draftId}`,
      payload: {
        status: "ready"
      }
    });

    expect(statusAttemptResponse.statusCode).toBe(400);
    expect(updateResponse.json()).toEqual(
      expect.objectContaining({
        error: expect.any(Object)
      })
    );

    const singleDraft = await app.inject({
      method: "GET",
      url: `/autonomy/drafts/${draftId}`
    });
    const sourceWorkItem = await app.inject({
      method: "GET",
      url: `/autonomy/content-work-items/${workItemId}`
    });

    expect(singleDraft.statusCode).toBe(200);
    expect(singleDraft.json()).toEqual(
      expect.objectContaining({
        id: draftId,
        title: "Refined workflow accountability title",
        sourceContentWorkItemId: workItemId,
        status: "draft"
      })
    );
    expect(sourceWorkItem.statusCode).toBe(200);
    expect(sourceWorkItem.json()).toEqual(
      expect.objectContaining({
        id: workItemId,
        sourceMatchedOpportunityId: itemId,
        draftSeed: expect.objectContaining({
          title: expect.any(String),
          recommendedAction: "write_post"
        })
      })
    );
  });

  it("PATCH /autonomy/drafts/:id/status persists explicit draft workflow status changes safely", async () => {
    app = await createAppWithTestDatabase();

    const createAudienceWatchlist = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "public_discussion_source",
        label: "Workflow pain watchlist",
        seedExcerpt: "Operators still patch broken handoffs manually after rollout.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    const audienceWatchlist = createAudienceWatchlist.json() as { id: string };
    const createSolutionWatchlist = await app.inject({
      method: "POST",
      url: "/autonomy/watchlists",
      payload: {
        sourceKind: "article_source",
        label: "Workflow solution watchlist",
        seedExcerpt:
          "The release adds visibility and retry ownership so teams can recover stalled workflows faster.",
        targetProblem: "workflow handoff failures",
        refreshCadence: "daily_candidate",
        isActive: true
      }
    });
    const solutionWatchlist = createSolutionWatchlist.json() as { id: string };

    await app.inject({
      method: "PATCH",
      url: `/autonomy/watchlists/${audienceWatchlist.id}`,
      payload: { nextRunAt: "2026-03-16T00:00:00.000Z" }
    });
    await app.inject({
      method: "POST",
      url: "/autonomy/scheduler/tick",
      payload: { now: "2026-03-16T00:00:00.000Z" }
    });
    await app.inject({
      method: "PATCH",
      url: `/autonomy/watchlists/${solutionWatchlist.id}`,
      payload: { nextRunAt: "2026-03-17T00:00:00.000Z" }
    });
    await app.inject({
      method: "POST",
      url: "/autonomy/scheduler/tick",
      payload: { now: "2026-03-17T00:00:00.000Z" }
    });

    const matchedResponse = await app.inject({
      method: "GET",
      url: "/autonomy/prioritized-opportunities"
    });
    const itemId = (matchedResponse.json() as Array<{ id: string }>)[0]!.id;

    await app.inject({
      method: "PATCH",
      url: `/autonomy/matched-opportunities/${itemId}/review-state`,
      payload: { reviewState: "saved" }
    });
    const promoteResponse = await app.inject({
      method: "POST",
      url: `/autonomy/matched-opportunities/${itemId}/promote`
    });
    const workItemId = promoteResponse.json().id as string;
    const createDraftResponse = await app.inject({
      method: "POST",
      url: `/autonomy/content-work-items/${workItemId}/draft`
    });
    const draftId = createDraftResponse.json().id as string;

    const readyResponse = await app.inject({
      method: "PATCH",
      url: `/autonomy/drafts/${draftId}/status`,
      payload: { status: "ready" }
    });
    const archivedResponse = await app.inject({
      method: "PATCH",
      url: `/autonomy/drafts/${draftId}/status`,
      payload: { status: "archived" }
    });

    expect(readyResponse.statusCode).toBe(200);
    expect(readyResponse.json()).toEqual(
      expect.objectContaining({
        id: draftId,
        status: "ready",
        sourceContentWorkItemId: workItemId
      })
    );
    expect(archivedResponse.statusCode).toBe(200);
    expect(archivedResponse.json()).toEqual(
      expect.objectContaining({
        id: draftId,
        status: "archived",
        sourceContentWorkItemId: workItemId
      })
    );

    const singleDraft = await app.inject({
      method: "GET",
      url: `/autonomy/drafts/${draftId}`
    });
    const sourceWorkItem = await app.inject({
      method: "GET",
      url: `/autonomy/content-work-items/${workItemId}`
    });

    expect(singleDraft.statusCode).toBe(200);
    expect(singleDraft.json()).toEqual(
      expect.objectContaining({
        id: draftId,
        status: "archived"
      })
    );
    expect(sourceWorkItem.statusCode).toBe(200);
    expect(sourceWorkItem.json()).toEqual(
      expect.objectContaining({
        id: workItemId,
        draftSeed: expect.objectContaining({
          recommendedAction: "write_post"
        })
      })
    );
  });

  it("GET /autonomy/runtime/status exposes minimal background runtime state", async () => {
    app = await createAppWithTestDatabase();

    const response = await app.inject({
      method: "GET",
      url: "/autonomy/runtime/status"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      enabled: false,
      running: false,
      intervalMs: 0,
      isTickInFlight: false
    });
  });

  it("POST /growth/rhythm returns deterministic weekly guidance from queue and saved candidates", async () => {
    app = await createAppWithTestDatabase();

    const response = await app.inject({
      method: "POST",
      url: "/growth/rhythm",
      payload: {
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
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(
      expect.objectContaining({
        topPostCandidates: [
          expect.objectContaining({
            id: "queue-1",
            suggestedAction: "generate_post_candidate"
          })
        ],
        topCommentCandidates: [
          expect.objectContaining({
            id: "saved-1",
            suggestedAction: "generate_comment"
          })
        ],
        weeklyFocus: expect.any(String),
        suggestedCadence: expect.any(String),
        reasoningSummary: expect.any(String)
      })
    );
  });

  it("POST /growth/rhythm accepts optional feedbackSummary", async () => {
    app = await createAppWithTestDatabase();

    const response = await app.inject({
      method: "POST",
      url: "/growth/rhythm",
      payload: {
        queueItems: [
          {
            id: "queue-1",
            title: "Workflow accountability breaks after launch",
            suggestedAction: "generate_post_candidate",
            priority: "medium",
            status: "new",
            bestAngle: "workflow_accountability",
            reasoningSummary: "Execution-heavy workflow accountability post."
          }
        ],
        feedbackSummary: {
          strongPatterns: ["Workflow accountability themes are performing well."],
          weakPatterns: [],
          suggestedRepeats: ["Repeat workflow accountability topics."],
          suggestedAvoids: [],
          reasoningSummary: "Lean into workflow accountability.",
          totalRecords: 2
        }
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(
      expect.objectContaining({
        topPostCandidates: expect.any(Array),
        reasoningSummary: expect.stringContaining("feedback")
      })
    );
  });

  it("POST /growth/rhythm accepts optional patternMemorySummary", async () => {
    app = await createAppWithTestDatabase();

    const response = await app.inject({
      method: "POST",
      url: "/growth/rhythm",
      payload: {
        queueItems: [
          {
            id: "queue-1",
            title: "Repeat-worthy topics around workflow accountability",
            suggestedAction: "generate_post_candidate",
            priority: "medium",
            status: "new",
            bestAngle: "workflow_accountability",
            reasoningSummary: "Specific operator lesson."
          }
        ],
        patternMemorySummary: {
          repeatPatterns: [
            {
              id: "repeat:all:repeat-worthy topics",
              label: "repeat-worthy topics",
              kind: "repeat",
              strength: 4,
              occurrences: 2,
              lastSeenAt: "2026-03-15T00:00:00.000Z",
              source: "feedback"
            }
          ],
          avoidPatterns: [],
          recurringThemes: ["repeat-worthy topics"],
          weakThemes: [],
          notes: "Memory favors repeat-worthy topics.",
          totalPatterns: 1
        }
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(
      expect.objectContaining({
        topPostCandidates: expect.any(Array),
        reasoningSummary: expect.stringContaining("memory")
      })
    );
  });

  it("responds with local dev CORS headers for the Vite web origin", async () => {
    app = await createAppWithTestDatabase();

    const response = await app.inject({
      method: "OPTIONS",
      url: "/signals",
      headers: {
        origin: "http://127.0.0.1:5173",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5173");
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
    expect(response.headers["access-control-allow-headers"]).toContain("content-type");
  });

  it("GET /system/providers reflects Mirai availability summary without requiring a live runtime", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();

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
                available: false,
                reason: "Mirai runtime not responding."
              }),
              generateText: async () => ({
                text: "unused"
              }),
              getSummary: () => "mirai-default@node"
            }
          })
        }
      )
    );
    const orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "local",
        textProvider: "mirai",
        fallbackEnabled: true
      })
    });
    app = await authenticateOperatorApp(await buildApp({
      logger: false,
      orchestrator,
      operatorAuthService: createTestOperatorAuthService()
    }));

    const response = await app.inject({
      method: "GET",
      url: "/system/providers"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        mode: "local",
        textProvider: "mirai",
        fallbackEnabled: true,
        textProviderStatus: {
          id: "mirai",
          available: false,
          reason: "Mirai runtime not responding.",
          capabilities: {
            text: true,
            visual: true,
            live: true
          }
        }
      })
    );
  });

  it("GET /system/providers surfaces SDK model repo diagnostics when Mirai SDK mode is configured", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();

    const registry = new ProviderRegistry();
    registry.registerTextProvider(
      new MiraiProvider(
        {
          enabled: true,
          transport: "sdk",
          apiKey: "test-key",
          modelRepo: "Qwen/Qwen3-0.6B"
        },
        {
          adapter: new MiraiAdapter({
            config: {
              enabled: true,
              transport: "sdk",
              apiKey: "test-key",
              modelRepo: "Qwen/Qwen3-0.6B"
            },
            transport: {
              getAvailability: () => ({
                available: false,
                reason:
                  "Mirai SDK could not find model repo 'Qwen/Qwen3-0.6B'. Verify the official repo id format."
              }),
              generateText: async () => ({
                text: "unused"
              }),
              getSummary: () => "Qwen/Qwen3-0.6B@sdk"
            }
          })
        }
      )
    );
    const orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "local",
        textProvider: "mirai",
        fallbackEnabled: true
      })
    });
    app = await authenticateOperatorApp(await buildApp({
      logger: false,
      orchestrator,
      operatorAuthService: createTestOperatorAuthService()
    }));

    const response = await app.inject({
      method: "GET",
      url: "/system/providers"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        textProviderStatus: {
          id: "mirai",
          available: false,
          reason:
            "Mirai SDK could not find model repo 'Qwen/Qwen3-0.6B'. Verify the official repo id format.",
          capabilities: {
            text: true,
            visual: true,
            live: true
          }
        }
      })
    );
  });

  it("POST /brand-voice creates an active profile and GET /brand-voice returns it", async () => {
    app = await createAppWithTestDatabase();

    const created = await app.inject({
      method: "POST",
      url: "/brand-voice",
      payload: {
        name: "Grounded Operator Voice",
        tone: "Direct, practical, calm",
        audience: "Founders and operator-led teams",
        writingRules: ["Use plain business language", "Lead with a concrete problem"],
        bannedPatterns: ["AI is changing everything"],
        preferredPatterns: ["operational payoff"],
        styleNotes: "Keep it specific.",
        isActive: true
      }
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual(
      expect.objectContaining({
        name: "Grounded Operator Voice",
        isActive: true
      })
    );

    const listed = await app.inject({ method: "GET", url: "/brand-voice" });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual(
      expect.objectContaining({
        active: expect.objectContaining({
          name: "Grounded Operator Voice"
        }),
        profiles: expect.arrayContaining([
          expect.objectContaining({
            name: "Grounded Operator Voice"
          })
        ])
      })
    );
  });

  it("POST /content/finalize persists final post fields and keeps refined content intact", async () => {
    app = await createAppWithTestDatabase();

    const signal = await app.inject({
      method: "POST",
      url: "/signals",
      payload: {
        title: "Signal title",
        sourceType: "manual",
        rawText: "Signal raw text"
      }
    });
    const idea = await app.inject({
      method: "POST",
      url: "/ideas/generate",
      payload: { signalId: signal.json().id as string }
    });
    const content = await app.inject({
      method: "POST",
      url: "/content/generate",
      payload: { ideaId: idea.json().id as string }
    });
    await app.inject({
      method: "POST",
      url: "/content/refine",
      payload: { contentId: content.json().id as string }
    });

    const finalized = await app.inject({
      method: "POST",
      url: "/content/finalize",
      payload: { contentId: content.json().id as string }
    });

    expect(finalized.statusCode).toBe(201);
    expect(finalized.json()).toEqual(
      expect.objectContaining({
        id: content.json().id,
        refinedBody: expect.any(String),
        finalHook: expect.any(String),
        finalBody: expect.any(String),
        finalClosing: expect.any(String),
        finalStatus: "ready",
        finalQualityScore: expect.any(Number)
      })
    );

    const listed = await app.inject({
      method: "GET",
      url: "/content"
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([
      expect.objectContaining({
        id: content.json().id,
        refinedBody: expect.any(String),
        finalStatus: "ready"
      })
    ]);
  });

  it("POST /content/finalize accepts optional quality config and returns quality metadata", async () => {
    app = await createAppWithTestDatabase();

    const signal = await app.inject({
      method: "POST",
      url: "/signals",
      payload: {
        title: "Signal title",
        sourceType: "manual",
        rawText: "Signal raw text"
      }
    });
    const idea = await app.inject({
      method: "POST",
      url: "/ideas/generate",
      payload: { signalId: signal.json().id as string }
    });
    const content = await app.inject({
      method: "POST",
      url: "/content/generate",
      payload: { ideaId: idea.json().id as string }
    });
    await app.inject({
      method: "POST",
      url: "/content/refine",
      payload: { contentId: content.json().id as string }
    });

    const finalized = await app.inject({
      method: "POST",
      url: "/content/finalize",
      payload: {
        contentId: content.json().id as string,
        config: {
          hookMode: "execution_lesson",
          antiBlandness: true
        }
      }
    });

    expect(finalized.statusCode).toBe(201);
    expect(finalized.json()).toEqual(
      expect.objectContaining({
        finalStatus: "ready",
        finalQualityMetadata: expect.objectContaining({
          hookStrengthScore: expect.any(Number),
          humanFeelScore: expect.any(Number),
          specificityScore: expect.any(Number),
          publishabilityScore: expect.any(Number)
        })
      })
    );
  });

  it("POST /content/finalize accepts additive outcome-aware shaping context", async () => {
    app = await createAppWithTestDatabase();

    const signal = await app.inject({
      method: "POST",
      url: "/signals",
      payload: {
        title: "Signal title",
        sourceType: "manual",
        rawText: "Workflow accountability becomes visible after the pilot."
      }
    });
    const idea = await app.inject({
      method: "POST",
      url: "/ideas/generate",
      payload: { signalId: signal.json().id as string }
    });
    const content = await app.inject({
      method: "POST",
      url: "/content/generate",
      payload: { ideaId: idea.json().id as string }
    });
    await app.inject({
      method: "POST",
      url: "/content/refine",
      payload: { contentId: content.json().id as string }
    });

    const finalized = await app.inject({
      method: "POST",
      url: "/content/finalize",
      payload: {
        contentId: content.json().id as string,
        config: {
          outcomeAwareShaping: true
        },
        outcomeContext: {
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
            notes: "Long-term memory reinforces workflow accountability.",
            totalPatterns: 1
          }
        }
      }
    });

    expect(finalized.statusCode).toBe(201);
    expect(finalized.json()).toEqual(
      expect.objectContaining({
        finalStatus: "ready",
        finalQualityMetadata: expect.objectContaining({
          appliedOutcomeBias: "repeat",
          outcomePatternBiasNotes: expect.arrayContaining([
            expect.stringMatching(/workflow accountability/i)
          ])
        })
      })
    );
  });

  it("POST /content/experimental-v2 returns a comparison-only publishable post from a signal", async () => {
    app = await createAppWithTestDatabase();

    const signal = await app.inject({
      method: "POST",
      url: "/signals",
      payload: {
        title: "Why AI copilots fail after the demo",
        sourceType: "manual",
        rawText:
          "Most AI copilots look impressive in a demo, but collapse in real work because nobody designs the surrounding process. There is no clear owner, no exception handling, no workflow memory, and no operational accountability. The model is rarely the main problem."
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/content/experimental-v2",
      payload: {
        signalId: signal.json().id,
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
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(
      expect.objectContaining({
        signalId: signal.json().id,
        post: expect.any(String),
        mode: expect.stringMatching(/deterministic|provider/)
      })
    );
    expect((response.json().post as string).split("\n\n")).toHaveLength(5);
  });

  it("POST /content/finalize and POST /content/finalize-v2 return distinct payload shapes for the same content", async () => {
    app = await createAppWithTestDatabase();

    const signal = await app.inject({
      method: "POST",
      url: "/signals",
      payload: {
        title: "Why AI copilots fail after the demo",
        sourceType: "manual",
        rawText:
          "Most AI copilots look impressive in a demo, but collapse in real work because nobody designs the surrounding process. There is no clear owner, no exception handling, no workflow memory, and no operational accountability. The model is rarely the main problem."
      }
    });
    const idea = await app.inject({
      method: "POST",
      url: "/ideas/generate",
      payload: { signalId: signal.json().id as string }
    });
    const content = await app.inject({
      method: "POST",
      url: "/content/generate",
      payload: { ideaId: idea.json().id as string }
    });
    await app.inject({
      method: "POST",
      url: "/content/refine",
      payload: { contentId: content.json().id as string }
    });

    const legacy = await app.inject({
      method: "POST",
      url: "/content/finalize",
      payload: { contentId: content.json().id as string }
    });
    const v2 = await app.inject({
      method: "POST",
      url: "/content/finalize-v2",
      payload: { contentId: content.json().id as string }
    });

    expect(legacy.statusCode).toBe(201);
    expect(v2.statusCode).toBe(201);
    expect(legacy.json()).toEqual(
      expect.objectContaining({
        id: content.json().id,
        finalHook: expect.any(String),
        finalBody: expect.any(String),
        finalStatus: "ready"
      })
    );
    expect(v2.json()).toEqual(
      expect.objectContaining({
        contentId: content.json().id,
        post: expect.any(String),
        hook: expect.any(String),
        generatorVersion: "v2"
      })
    );
    expect(v2.json()).not.toHaveProperty("finalBody");
  });

  it("POST /comments/generate and POST /replies/generate return concise operator-style outputs", async () => {
    app = await createAppWithTestDatabase();

    const comment = await app.inject({
      method: "POST",
      url: "/comments/generate",
      payload: {
        sourcePostText:
          "Most teams buy AI tools before they fix the handoff between sales and ops. The demo looks great, but nobody owns the workflow after launch.",
        positioningContext: "Operator-led, practical rollout."
      }
    });

    expect(comment.statusCode).toBe(201);
    expect(comment.json()).toEqual(
      expect.objectContaining({
        text: expect.any(String),
        mode: expect.stringMatching(/deterministic|provider/)
      })
    );

    const reply = await app.inject({
      method: "POST",
      url: "/replies/generate",
      payload: {
        ourPostText: "AI copilots fail when nobody owns the workflow after the demo.",
        incomingCommentText:
          "We saw the same thing in support. The queue design was the real mess.",
        context: "Keep it concise."
      }
    });

    expect(reply.statusCode).toBe(201);
    expect(reply.json()).toEqual(
      expect.objectContaining({
        text: expect.any(String),
        mode: expect.stringMatching(/deterministic|provider/)
      })
    );
  });

  it("POST /comments/generate and POST /replies/generate accept optional relevance adaptation fields", async () => {
    app = await createAppWithTestDatabase();

    const comment = await app.inject({
      method: "POST",
      url: "/comments/generate",
      payload: {
        sourcePostText:
          "Most teams buy AI tools before they fix the handoff between sales and ops.",
        positioningContext: "Operator-led systems.",
        relevanceScore: 86,
        bestAngle: "ownership_gap",
        recommendedAction: "comment",
        targetRole: "Founder",
        reasoningSummary: "Ownership after launch is the real gap."
      }
    });

    expect(comment.statusCode).toBe(201);
    expect(comment.json()).toEqual(
      expect.objectContaining({
        text: expect.any(String),
        adaptationPlan: expect.objectContaining({
          engagementMode: "strategic_execution",
          shouldGenerate: true
        }),
        engagementMode: "strategic_execution",
        appliedAngle: "ownership_gap"
      })
    );

    const reply = await app.inject({
      method: "POST",
      url: "/replies/generate",
      payload: {
        ourPostText: "AI copilots fail when nobody owns the workflow after the demo.",
        incomingCommentText: "We saw the same thing in support.",
        relevanceScore: 32,
        bestAngle: "handoff_failure",
        recommendedAction: "outreach_candidate",
        targetRole: "Founder"
      }
    });

    expect(reply.statusCode).toBe(201);
    expect(reply.json()).toEqual(
      expect.objectContaining({
        text: expect.any(String),
        adaptationPlan: expect.objectContaining({
          engagementMode: "bridge_outreach_aware"
        })
      })
    );
  });

  it("POST /decision/plan returns a deterministic action plan with partial input", async () => {
    app = await createAppWithTestDatabase();

    const response = await app.inject({
      method: "POST",
      url: "/decision/plan",
      payload: {
        signalText:
          "Most AI copilots fail after the demo because nobody owns the workflow or the exception path.",
        targetRole: "Founder",
        hasCommentContext: true
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(
      expect.objectContaining({
        recommendedNextAction: expect.stringMatching(
          /generate_post_candidate|generate_comment|save_for_later|ignore/
        ),
        bestAngle: expect.any(String),
        suggestedFlow: expect.any(String),
        contentPriority: expect.any(String),
        engagementPriority: expect.any(String),
        decisionMode: "deterministic",
        confidence: expect.any(Number),
        reasoningSummary: expect.any(String),
        riskNotes: expect.any(Array)
      })
    );
  });

  it("POST /ideas/generate creates an idea from signalId and GET /ideas returns it", async () => {
    app = await createAppWithTestDatabase();

    const signal = await app.inject({
      method: "POST",
      url: "/signals",
      payload: {
        title: "AI procurement blockers",
        sourceType: "manual",
        rawText: "Translate technical approval issues into business risk."
      }
    });
    const createdSignal = signal.json();

    const generateIdea = await app.inject({
      method: "POST",
      url: "/ideas/generate",
      payload: {
        signalId: createdSignal.id
      }
    });

    expect(generateIdea.statusCode).toBe(201);
    expect(generateIdea.json()).toEqual({
      id: expect.stringMatching(/^idea-/),
      signalId: createdSignal.id,
      title: expect.any(String),
      coreInsight: expect.any(String),
      businessRelevance: expect.any(String),
      targetAudience: expect.any(String),
      status: "draft",
      createdAt: expect.any(String)
    });

    const listIdeas = await app.inject({
      method: "GET",
      url: "/ideas"
    });

    expect(listIdeas.statusCode).toBe(200);
    expect(listIdeas.json()).toEqual([
      expect.objectContaining({
        signalId: createdSignal.id
      })
    ]);
  });

  it("POST /content/generate creates a content draft from ideaId and GET /content returns it", async () => {
    app = await createAppWithTestDatabase();

    const signal = await app.inject({
      method: "POST",
      url: "/signals",
      payload: {
        title: "Signal",
        sourceType: "manual",
        rawText: "Raw text"
      }
    });
    const createdSignal = signal.json();

    const idea = await app.inject({
      method: "POST",
      url: "/ideas/generate",
      payload: {
        signalId: createdSignal.id
      }
    });
    const createdIdea = idea.json();

    const generateContent = await app.inject({
      method: "POST",
      url: "/content/generate",
      payload: {
        ideaId: createdIdea.id
      }
    });

    expect(generateContent.statusCode).toBe(201);
    expect(generateContent.json()).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^content-/),
        ideaId: createdIdea.id,
        contentType: "linkedin-post",
        hook: expect.any(String),
        body: expect.any(String),
        cta: expect.any(String),
        status: "draft",
        createdAt: expect.any(String)
      })
    );

    const listContent = await app.inject({
      method: "GET",
      url: "/content"
    });

    expect(listContent.statusCode).toBe(200);
    expect(listContent.json()).toEqual([
      expect.objectContaining({
        ideaId: createdIdea.id
      })
    ]);
  });

  it("POST /content/refine updates a content draft and GET /content returns refined fields", async () => {
    app = await createAppWithTestDatabase();

    await app.inject({
      method: "POST",
      url: "/brand-voice",
      payload: {
        name: "Grounded Operator Voice",
        tone: "Direct, practical, calm",
        audience: "Founders and operator-led teams",
        writingRules: ["Use plain business language"],
        bannedPatterns: ["AI is changing everything"],
        preferredPatterns: ["operational payoff"],
        styleNotes: "Keep it specific.",
        isActive: true
      }
    });

    const signal = await app.inject({
      method: "POST",
      url: "/signals",
      payload: {
        title: "Signal",
        sourceType: "manual",
        rawText: "Raw text"
      }
    });
    const idea = await app.inject({
      method: "POST",
      url: "/ideas/generate",
      payload: {
        signalId: signal.json().id
      }
    });
    const content = await app.inject({
      method: "POST",
      url: "/content/generate",
      payload: {
        ideaId: idea.json().id
      }
    });

    const refined = await app.inject({
      method: "POST",
      url: "/content/refine",
      payload: {
        contentId: content.json().id
      }
    });

    expect(refined.statusCode).toBe(201);
    expect(refined.json()).toEqual(
      expect.objectContaining({
        refinementStatus: "refined",
        refinedHook: expect.any(String),
        refinedBody: expect.any(String),
        refinedCta: expect.any(String),
        qualityStatus: "reviewed",
        overallQualityScore: expect.any(Number)
      })
    );

    const listContent = await app.inject({ method: "GET", url: "/content" });

    expect(listContent.json()).toEqual([
      expect.objectContaining({
        refinementStatus: "refined"
      })
    ]);
  });

  it("visual routes create and list visual assets", async () => {
    app = await createAppWithTestDatabase();

    const signal = await app.inject({
      method: "POST",
      url: "/signals",
      payload: {
        title: "Signal",
        sourceType: "manual",
        rawText: "Raw text"
      }
    });
    const idea = await app.inject({
      method: "POST",
      url: "/ideas/generate",
      payload: { signalId: signal.json().id }
    });
    const content = await app.inject({
      method: "POST",
      url: "/content/generate",
      payload: { ideaId: idea.json().id }
    });

    const visual = await app.inject({
      method: "POST",
      url: "/visuals/generate",
      payload: {
        contentId: content.json().id
      }
    });

    expect(visual.statusCode).toBe(201);
    expect(visual.json()).toEqual(
      expect.objectContaining({
        contentAssetId: content.json().id,
        visualType: "single-image",
        prompt: expect.any(String)
      })
    );

    const visuals = await app.inject({ method: "GET", url: "/visuals" });
    expect(visuals.json()).toEqual([expect.objectContaining({ contentAssetId: content.json().id })]);
  });

  it("analytics and strategy routes store snapshots and return recommendations", async () => {
    app = await createAppWithTestDatabase();

    const signal = await app.inject({
      method: "POST",
      url: "/signals",
      payload: {
        title: "Signal",
        sourceType: "manual",
        rawText: "Raw text"
      }
    });
    const idea = await app.inject({
      method: "POST",
      url: "/ideas/generate",
      payload: { signalId: signal.json().id }
    });
    const content = await app.inject({
      method: "POST",
      url: "/content/generate",
      payload: { ideaId: idea.json().id }
    });

    const snapshot = await app.inject({
      method: "POST",
      url: "/analytics",
      payload: {
        contentAssetId: content.json().id,
        impressions: 1200,
        likes: 80,
        comments: 10,
        saves: 7,
        profileViews: 20,
        followersGained: 4
      }
    });

    expect(snapshot.statusCode).toBe(201);

    const analytics = await app.inject({ method: "GET", url: "/analytics" });
    expect(analytics.json()).toEqual([
      expect.objectContaining({
        contentAssetId: content.json().id,
        impressions: 1200
      })
    ]);

    const recommendations = await app.inject({
      method: "POST",
      url: "/strategy/analyze"
    });

    expect(recommendations.statusCode).toBe(201);
    expect(recommendations.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: expect.any(String),
          priority: expect.any(String)
        })
      ])
    );

    const stored = await app.inject({
      method: "GET",
      url: "/strategy/recommendations"
    });
    expect(stored.json().length).toBeGreaterThan(0);
  });

  it("POST /strategy/analyze accepts optional feedbackSummary", async () => {
    app = await createAppWithTestDatabase();

    const signal = await app.inject({
      method: "POST",
      url: "/signals",
      payload: {
        title: "Workflow accountability",
        sourceType: "manual",
        rawText: "Workflow accountability matters after launch."
      }
    });
    const idea = await app.inject({
      method: "POST",
      url: "/ideas/generate",
      payload: { signalId: signal.json().id }
    });
    const content = await app.inject({
      method: "POST",
      url: "/content/generate",
      payload: { ideaId: idea.json().id }
    });

    await app.inject({
      method: "POST",
      url: "/analytics",
      payload: {
        contentAssetId: content.json().id,
        impressions: 1200,
        likes: 80,
        comments: 10,
        saves: 7,
        profileViews: 20,
        followersGained: 4
      }
    });

    const recommendations = await app.inject({
      method: "POST",
      url: "/strategy/analyze",
      payload: {
        feedbackSummary: {
          strongPatterns: ["Workflow accountability themes are performing well."],
          weakPatterns: ["Generic AI commentary is weak."],
          suggestedRepeats: ["Repeat workflow accountability angles."],
          suggestedAvoids: ["Avoid generic AI commentary this week."],
          reasoningSummary: "Use feedback to sharpen strategy.",
          totalRecords: 2
        }
      }
    });

    expect(recommendations.statusCode).toBe(201);
    expect(recommendations.json()).toEqual(
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

  it("POST /strategy/analyze accepts optional patternMemorySummary", async () => {
    app = await createAppWithTestDatabase();

    const signal = await app.inject({
      method: "POST",
      url: "/signals",
      payload: {
        title: "Workflow accountability",
        sourceType: "manual",
        rawText: "Workflow accountability matters after launch."
      }
    });
    const idea = await app.inject({
      method: "POST",
      url: "/ideas/generate",
      payload: { signalId: signal.json().id }
    });
    const content = await app.inject({
      method: "POST",
      url: "/content/generate",
      payload: { ideaId: idea.json().id }
    });

    await app.inject({
      method: "POST",
      url: "/analytics",
      payload: {
        contentAssetId: content.json().id,
        impressions: 1200,
        likes: 80,
        comments: 10,
        saves: 7,
        profileViews: 20,
        followersGained: 4
      }
    });

    const recommendations = await app.inject({
      method: "POST",
      url: "/strategy/analyze",
      payload: {
        patternMemorySummary: {
          repeatPatterns: [
            {
              id: "repeat:final_post:final posts",
              label: "final posts",
              kind: "repeat",
              artifactType: "final_post",
              strength: 4,
              occurrences: 2,
              lastSeenAt: "2026-03-15T00:00:00.000Z",
              source: "feedback"
            }
          ],
          avoidPatterns: [
            {
              id: "avoid:comment:generic engagement",
              label: "generic engagement",
              kind: "avoid",
              artifactType: "comment",
              strength: 2,
              occurrences: 1,
              lastSeenAt: "2026-03-15T00:00:00.000Z",
              source: "feedback"
            }
          ],
          recurringThemes: ["final posts"],
          weakThemes: ["generic engagement"],
          notes: "Memory favors final posts and cautions on generic engagement.",
          totalPatterns: 2
        }
      }
    });

    expect(recommendations.statusCode).toBe(201);
    expect(recommendations.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Reinforce recurring long-term themes"
        }),
        expect.objectContaining({
          title: "Keep recurring weak themes deprioritized"
        })
      ])
    );
  });

  it("POST /orchestrator/recommend returns a compact coordinated next move", async () => {
    app = await createAppWithTestDatabase();

    const response = await app.inject({
      method: "POST",
      url: "/orchestrator/recommend",
      payload: {
        currentSourceSignal: {
          sourceType: "article",
          title: "Workflow accountability after launch",
          rawSummary: "Launches fail when no one owns the workflow.",
          normalizedSignalText:
            "Workflow accountability breaks after launch when ownership stays vague.",
          suggestedAngle: "workflow_accountability",
          reasoningSummary: "Clear operator-fit post signal.",
          plannerReadyPayload: {
            signalText:
              "Workflow accountability breaks after launch when ownership stays vague.",
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
        scoutOpportunityContext: {
          matchedOpportunities: [
            {
              id: "match-1",
              audienceItemId: "aud-1",
              solutionItemId: "sol-1",
              matchedPain: "Operators are flagging broken handoffs.",
              matchedSolutionPattern: "Visibility and coordination pattern",
              whyThisMatchWorks: "The solution addresses the same ownership gap.",
              suggestedAngle: "workflow_accountability",
              recommendedAction: "write_post",
              confidence: "high",
              createdAt: "2026-03-15T00:00:00.000Z"
            }
          ]
        }
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(
      expect.objectContaining({
        recommendedAction: "write_post",
        recommendationReason: expect.any(String),
        primaryTarget: expect.any(String),
        supportingSignals: expect.any(Array),
        confidence: expect.any(String),
        coordinationNotes: expect.any(Array),
        scoutSupport: expect.any(Array),
        scoutInfluence: expect.any(String)
      })
    );
  });

  it("POST /audience/scout returns a deterministic shortlist of audience pain and opportunity signals", async () => {
    app = await createAppWithTestDatabase();

    const response = await app.inject({
      method: "POST",
      url: "/audience/scout",
      payload: {
        targetTopics: ["AI automation", "workflow chaos"],
        targetRoles: ["COO"],
        targetKeywords: ["handoff", "manual work"],
        maxResults: 2
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            sourcePlatform: "public_web",
            painSignalSummary: expect.any(String),
            whyItMatters: expect.any(String),
            suggestedActionType: expect.any(String)
          }),
          expect.objectContaining({
            sourcePlatform: "public_web"
          })
        ],
        summary: expect.any(String),
        notes: expect.any(String)
      })
    );
  });

  it("POST /audience/scout accepts operator-provided public excerpts and preserves source context", async () => {
    app = await createAppWithTestDatabase();

    const response = await app.inject({
      method: "POST",
      url: "/audience/scout",
      payload: {
        targetTopics: [],
        publicInputs: [
          {
            sourceLabel: "LinkedIn thread",
            sourceUrl: "https://linkedin.example/posts/ops-1",
            excerpt:
              "We still patch launch handoffs in spreadsheets because nobody owns the workflow after rollout."
          }
        ],
        maxResults: 2
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            sourcePlatform: "public_web",
            sourceLabel: "LinkedIn thread",
            sourceUrl: "https://linkedin.example/posts/ops-1",
            rawExcerpt: expect.stringContaining("spreadsheets"),
            suggestedActionType: expect.any(String)
          })
        ]
      })
    );
  });

  it("POST /solutions/scout returns structured solution intelligence from operator-provided source material", async () => {
    app = await createAppWithTestDatabase();

    const response = await app.inject({
      method: "POST",
      url: "/solutions/scout",
      payload: {
        sourceType: "github",
        targetProblem: "workflow handoff failures",
        sourceLabel: "GitHub release",
        sourceUrl: "https://github.com/example/repo/releases/tag/v1.2.0",
        sourceExcerpt:
          "The release adds approval-state visibility and retry ownership so teams can recover stalled workflows faster.",
        operatorNotes: "Useful for operator rollout lessons."
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            sourceType: "github",
            sourceLabel: "GitHub release",
            sourceUrl: "https://github.com/example/repo/releases/tag/v1.2.0",
            solutionPattern: expect.any(String),
            implementationLesson: expect.any(String),
            tradeoffOrConstraint: expect.any(String),
            whyItMatters: expect.any(String),
            suggestedActionType: expect.any(String)
          })
        ],
        summary: expect.any(String),
        notes: expect.any(String)
      })
    );
  });

  it("POST /scout/feed returns batched audience and solution scout items safely", async () => {
    app = await createAppWithTestDatabase();

    const response = await app.inject({
      method: "POST",
      url: "/scout/feed",
      payload: {
        mode: "mixed",
        items: [
          {
            sourceType: "public_web",
            sourceLabel: "Ops thread",
            excerpt: "We still cannot see where the workflow is stuck until something breaks."
          },
          {
            sourceType: "github",
            sourceLabel: "Release notes",
            excerpt: "The release adds status visibility and retry ownership."
          }
        ]
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(
      expect.objectContaining({
        audienceItems: [expect.objectContaining({ painSignalSummary: expect.any(String) })],
        solutionItems: [expect.objectContaining({ solutionPattern: expect.any(String) })],
        summary: expect.any(String),
        notes: expect.any(String)
      })
    );
  });

  it("POST /scout/match returns structured matched opportunities from audience and solution scout items", async () => {
    app = await createAppWithTestDatabase();

    const response = await app.inject({
      method: "POST",
      url: "/scout/match",
      payload: {
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
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            audienceItemId: "aud-1",
            solutionItemId: "sol-1",
            matchedPain: expect.any(String),
            matchedSolutionPattern: expect.any(String),
            whyThisMatchWorks: expect.any(String),
            recommendedAction: expect.any(String)
          })
        ],
        summary: expect.any(String),
        notes: expect.any(String)
      })
    );
  });

  it("POST /matches/content/generate attaches optional compact AI content only for reviewed saved matches", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-api-"));
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();

    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    const router = new ProviderRouter(registry, {
      mode: "mock",
      textProvider: "mock-text",
      fallbackEnabled: true
    });

    app = await authenticateOperatorApp(await buildApp({
      logger: false,
      orchestrator: new OrchestratorService({ db, providerRouter: router }),
      operatorAuthService: createTestOperatorAuthService()
    }));

    const response = await app.inject({
      method: "POST",
      url: "/matches/content/generate",
      payload: {
        savedMatch: {
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
        }
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(
      expect.objectContaining({
        id: "saved-match-1",
        status: "reviewed",
        match: expect.objectContaining({
          recommendedAction: "write_post",
          aiContent: expect.objectContaining({
            contentIdea: expect.any(String),
            draftAngle: expect.any(String),
            postSeed: expect.any(String)
          })
        })
      })
    );
  });

  it("source routes create and list source items", async () => {
    app = await createAppWithTestDatabase();

    const created = await app.inject({
      method: "POST",
      url: "/sources",
      payload: {
        title: "Public article",
        sourceType: "article",
        sourceUrl: "https://example.com/article",
        rawText: "Open-source article about operator-led AI rollout."
      }
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual(
      expect.objectContaining({
        title: "Public article",
        sourceType: "article",
        normalizedSummary: expect.any(String),
        tags: expect.any(Array),
        status: "normalized"
      })
    );

    const listed = await app.inject({ method: "GET", url: "/sources" });
    expect(listed.json()).toEqual([expect.objectContaining({ title: "Public article" })]);
  });

  it("POST /sources/intake normalizes manual or article research into a planner-ready signal", async () => {
    app = await createAppWithTestDatabase();

    const response = await app.inject({
      method: "POST",
      url: "/sources/intake",
      payload: {
        sourceType: "article",
        title: "Why AI copilots fail after the demo",
        sourceUrl: "https://example.com/copilots",
        summaryText:
          "Most AI copilots look impressive in a demo, but collapse in real work because nobody designs the surrounding process. There is no clear owner or exception handling.",
        operatorNotes: "Good founder-facing execution angle.",
        targetRole: "Founder",
        companyContext: "B2B operations software"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(
      expect.objectContaining({
        sourceType: "article",
        sourceUrl: "https://example.com/copilots",
        normalizedSignalText: expect.any(String),
        suggestedAngle: "ownership_gap",
        reasoningSummary: expect.any(String),
        plannerReadyPayload: expect.objectContaining({
          signalText: expect.any(String),
          sourceType: "article",
          targetRole: "Founder"
        })
      })
    );
  });

  it("POST /sources/intake accepts GitHub intake and returns a planner-ready normalized signal", async () => {
    app = await createAppWithTestDatabase();

    const response = await app.inject({
      method: "POST",
      url: "/sources/intake",
      payload: {
        sourceType: "github",
        title: "Queue visibility fixes in the orchestration repo",
        sourceUrl: "https://github.com/example/orchestrator/releases/tag/v1.4.0",
        summaryText:
          "The release adds queue-state visibility, retry handling, and clearer ownership for failed automations so operators can see what needs intervention.",
        operatorNotes: "Useful execution lesson for ops leaders.",
        repoName: "example/orchestrator",
        repoContext: "Ops automation platform",
        releaseOrChangeType: "release"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(
      expect.objectContaining({
        sourceType: "github",
        sourceUrl: "https://github.com/example/orchestrator/releases/tag/v1.4.0",
        normalizedSignalText: expect.any(String),
        suggestedAngle: expect.any(String),
        reasoningSummary: expect.stringContaining("GitHub"),
        plannerReadyPayload: expect.objectContaining({
          signalText: expect.any(String),
          sourceType: "github"
        })
      })
    );
  });

  it("POST /sources/intake accepts optional GitHub subtype fields", async () => {
    app = await createAppWithTestDatabase();

    const response = await app.inject({
      method: "POST",
      url: "/sources/intake",
      payload: {
        sourceType: "github",
        githubSubtype: "issue",
        title: "Approval queue stalls after exception path",
        sourceUrl: "https://github.com/example/orchestrator/issues/123",
        summaryText:
          "Users report approvals stall after edge-case exceptions, support load rises, and nobody can see who owns recovery once the workflow breaks.",
        repoName: "example/orchestrator"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(
      expect.objectContaining({
        sourceType: "github",
        normalizedSignalText: expect.any(String),
        reasoningSummary: expect.stringContaining("GitHub"),
        plannerReadyPayload: expect.objectContaining({
          sourceType: "github"
        })
      })
    );
  });

  it("market routes create and list market profiles", async () => {
    app = await createAppWithTestDatabase();

    const created = await app.inject({
      method: "POST",
      url: "/markets",
      payload: {
        country: "Canada",
        region: "North America",
        primaryLanguage: "English",
        marketNote: "Strong B2B operator market."
      }
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual(
      expect.objectContaining({
        country: "Canada",
        linkedinPriority: expect.any(String),
        serviceFitScore: expect.any(Number)
      })
    );

    const listed = await app.inject({ method: "GET", url: "/markets" });
    expect(listed.json()).toEqual([expect.objectContaining({ country: "Canada" })]);
  });

  it("topic scoring and queue routes create and list scored topics and queue items", async () => {
    app = await createAppWithTestDatabase();

    await app.inject({
      method: "POST",
      url: "/sources",
      payload: {
        title: "Public article",
        sourceType: "article",
        rawText: "Open-source article about operator-led AI rollout."
      }
    });
    await app.inject({
      method: "POST",
      url: "/markets",
      payload: {
        country: "Canada",
        region: "North America",
        primaryLanguage: "English",
        marketNote: "Strong B2B operator market."
      }
    });

    const scores = await app.inject({
      method: "POST",
      url: "/topics/score"
    });

    expect(scores.statusCode).toBe(201);
    expect(scores.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          topicLabel: expect.any(String),
          priorityScore: expect.any(Number)
        })
      ])
    );

    const listedScores = await app.inject({ method: "GET", url: "/topics/scores" });
    expect(listedScores.json().length).toBeGreaterThan(0);

    const queue = await app.inject({
      method: "POST",
      url: "/queue/build"
    });

    expect(queue.statusCode).toBe(201);
    expect(queue.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recommendedAction: expect.any(String),
          status: "queued"
        })
      ])
    );

    const listedQueue = await app.inject({ method: "GET", url: "/queue" });
    expect(listedQueue.json().length).toBeGreaterThan(0);
  });

  it("GET /factory/priority returns explicit signal and candidate recommendations", async () => {
    app = await createAppWithTestDatabase();

    const signal = await db!.createSignal({
      title: "Priority signal",
      sourceType: "article",
      rawText: "Operators need queue ownership and retry visibility.",
      topicTags: ["workflow-accountability"]
    });
    const analysis = await db!.createSignalAnalysis({
      signalId: signal.id,
      relevanceScore: 83,
      whyRelevant: "Strong fit.",
      targetAudience: "Founders and operators",
      businessValueSummary: "Strong operator content.",
      painsSolved: ["ownership gap"],
      practicalImplications: ["show ownership"],
      recommendedPillar: "workflow_accountability",
      uniquenessScore: 74,
      uniquenessReason: "Specific operational framing.",
      buildabilityScore: 72,
      buildabilityReason: "Strong detail.",
      popularityPotentialScore: 76,
      brandGrowthPotentialScore: 84,
      bestAngle: "ownership_gap",
      recommendedFormat: "long_linkedin_post",
      audienceEmphasis: "B2B operators",
      recommendedPillarFinal: "workflow_accountability"
    });
    const decision = await db!.createOrchestratorDecision({
      signalId: signal.id,
      decisionType: "content_candidate",
      decisionReason: "Queue for content review.",
      confidenceScore: 81,
      nextAction: "queue_for_content_review",
      requiresHumanReview: true
    });
    const idea = await db!.createIdea({
      signalId: signal.id,
      title: "Priority idea",
      coreInsight: "Insight",
      businessRelevance: "Business",
      targetAudience: "Founders and operators",
      status: "draft"
    });
    const content = await db!.createContentAsset({
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
    const review = await db!.createWritingQualityAssessment({
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
    await db!.createCandidateQueueItem({
      signalId: signal.id,
      signalAnalysisId: analysis.id,
      contentAssetId: content.id,
      criticReviewId: review.id,
      orchestratorDecisionId: decision.id,
      candidateType: "content_candidate",
      queueState: "ready_for_review",
      priorityScore: 81,
      priorityLabel: "high",
      whyQueued: "Review ready",
      nextAction: "review_for_publication",
      requiresHumanReview: true
    });
    await db!.upsertMemoryPattern({
      patternType: "publish_window",
      patternKey: "publish_window:strong:afternoon",
      strengthScore: 20,
      recommendedAction: "repeat"
    });

    const response = await app.inject({
      method: "GET",
      url: "/factory/priority?now=2026-03-19T09:00:00.000Z"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        evaluatedAt: "2026-03-19T09:00:00.000Z",
        signals: expect.arrayContaining([
          expect.objectContaining({
            itemType: "signal",
            itemId: signal.id,
            priorityScore: expect.any(Number),
            recommendedAction: expect.any(String)
          })
        ]),
        candidateQueueItems: expect.arrayContaining([
          expect.objectContaining({
            itemType: "candidate_queue_item",
            signalId: signal.id,
            contentAssetId: content.id,
            recommendedAction: "queue_for_review",
            timingHint: expect.stringMatching(/afternoon/i)
          })
        ])
      })
    );
  });

  it("GET /candidate-queue/:id returns joined review detail for a Day-1 content candidate", async () => {
    app = await createAppWithTestDatabase();

    const signal = await db!.createSignal({
      title: "Workflow accountability repo",
      sourceType: "github_repo",
      rawText: "Queue visibility and exception handling matter after rollout."
    });
    const analysis = await db!.createSignalAnalysis({
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
    const decision = await db!.createOrchestratorDecision({
      signalId: signal.id,
      decisionType: "content_candidate",
      decisionReason: "Strong enough for a draft review lane.",
      confidenceScore: 81,
      nextAction: "queue_for_content_review",
      requiresHumanReview: true
    });
    const idea = await db!.createIdea({
      signalId: signal.id,
      title: "Draft idea",
      coreInsight: "Workflow trust breaks when nobody owns the exception path.",
      businessRelevance: "Operators need stronger review handoff.",
      targetAudience: "Founders and operators",
      status: "draft"
    });
    const content = await db!.createContentAsset({
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
    const criticReview = await db!.createWritingQualityAssessment({
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
    const candidate = await db!.createCandidateQueueItem({
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

    const response = await app.inject({
      method: "GET",
      url: `/candidate-queue/${candidate.id}`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
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

  it("PATCH /candidate-queue/:id applies operator review actions safely", async () => {
    app = await createAppWithTestDatabase();

    const signal = await db!.createSignal({
      title: "Operator review signal",
      sourceType: "manual_note",
      rawText: "Review actions should update the queue and content state."
    });
    const analysis = await db!.createSignalAnalysis({
      signalId: signal.id,
      relevanceScore: 79,
      whyRelevant: "Makes Day-1 usable.",
      targetAudience: "Operators",
      businessValueSummary: "Turns review into a real workflow.",
      painsSolved: ["orphaned drafts"],
      practicalImplications: ["make review decisions explicit"],
      uniquenessScore: 73,
      uniquenessReason: "Grounded product requirement.",
      buildabilityScore: 80,
      buildabilityReason: "Existing queue seam can support it.",
      popularityPotentialScore: 65,
      brandGrowthPotentialScore: 81
    });
    const decision = await db!.createOrchestratorDecision({
      signalId: signal.id,
      decisionType: "content_candidate",
      decisionReason: "Strong enough for a review lane.",
      confidenceScore: 80,
      nextAction: "queue_for_content_review",
      requiresHumanReview: true
    });
    const idea = await db!.createIdea({
      signalId: signal.id,
      title: "Reviewable idea",
      coreInsight: "Review without actions is a dead-end UI.",
      businessRelevance: "Operators need an actual decision path.",
      targetAudience: "Operators",
      status: "draft"
    });
    const content = await db!.createContentAsset({
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
    const candidate = await db!.createCandidateQueueItem({
      signalId: signal.id,
      signalAnalysisId: analysis.id,
      contentAssetId: content.id,
      orchestratorDecisionId: decision.id,
      candidateType: "content_candidate",
      queueState: "ready_for_review",
      priorityScore: 80,
      priorityLabel: "high",
      whyQueued: "Ready for review.",
      nextAction: "review_content_candidate",
      requiresHumanReview: true
    });

    const revision = await app.inject({
      method: "PATCH",
      url: `/candidate-queue/${candidate.id}`,
      payload: {
        action: "mark_needs_revision",
        operatorNote: "Tighten the hook."
      }
    });
    expect(revision.statusCode).toBe(200);
    expect(revision.json()).toEqual(
      expect.objectContaining({
        candidate: expect.objectContaining({
          id: candidate.id,
          queueState: "revision_requested",
          operatorNote: "Tighten the hook."
        }),
        contentAsset: expect.objectContaining({
          id: content.id,
          contentStatus: "review",
          publishReadyFlag: false
        })
      })
    );

    const approval = await app.inject({
      method: "PATCH",
      url: `/candidate-queue/${candidate.id}`,
      payload: {
        action: "approve_for_publication"
      }
    });
    expect(approval.statusCode).toBe(200);
    expect(approval.json()).toEqual(
      expect.objectContaining({
        candidate: expect.objectContaining({
          id: candidate.id,
          queueState: "ready_to_publish",
          requiresHumanReview: false
        }),
        contentAsset: expect.objectContaining({
          id: content.id,
          contentStatus: "ready",
          publishReadyFlag: true
        })
      })
    );

    const archived = await app.inject({
      method: "PATCH",
      url: `/candidate-queue/${candidate.id}`,
      payload: {
        action: "archive_candidate"
      }
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json()).toEqual(
      expect.objectContaining({
        candidate: expect.objectContaining({
          id: candidate.id,
          queueState: "archived"
        }),
        contentAsset: expect.objectContaining({
          id: content.id,
          contentStatus: "archived"
        })
      })
    );
  });
});
