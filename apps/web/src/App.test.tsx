import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AIRuntimeHealthSummary,
  AIProviderProbeResult,
  AnalyticsSnapshot,
  AutonomousRun,
  AutonomousMatchedOpportunity,
  AutonomousReviewQueueItem,
  AutonomousContentWorkItem,
  AutonomousDraftDocument,
  BrandVoiceProfile,
  CandidateQueueItem,
  CandidateQueueItemDetail,
  ContentQueueItem,
  ContentAsset,
  DecisionPlan,
  FactoryPrioritySelectionResult,
  Idea,
  LaunchPreflightResult,
  LaunchSmokeRunResult,
  MarketProfile,
  MemoryPattern,
  Signal,
  SourceItem,
  SolutionMemory,
  StrategyRecommendation,
  TopicScore,
  VisualAsset,
  WritingQualityAssessment
} from "@linkedin-brand-os/shared";
import App from "./App";

const fetchMock = vi.fn<typeof fetch>();
const OPERATOR_AUTH_TOKEN_STORAGE_KEY = "linkedin-brand-os:operator-auth-token";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function respondWithEmptyDashboard(url: string, method: string): Response | null {
  if (url.endsWith("/auth/session") && method === "GET") {
    const token = window.localStorage.getItem(OPERATOR_AUTH_TOKEN_STORAGE_KEY);
    if (!token) {
      return jsonResponse({ error: "Invalid or expired operator session." }, 401);
    }

    return jsonResponse({
      username: "operator",
      expiresAt: "2026-03-17T00:00:00.000Z"
    });
  }

  if (method !== "GET") {
    return null;
  }

  if (url.endsWith("/signals")) return jsonResponse([]);
  if (url.endsWith("/ideas")) return jsonResponse([]);
  if (url.endsWith("/content")) return jsonResponse([]);
  if (url.endsWith("/visuals")) return jsonResponse([]);
  if (url.endsWith("/analytics")) return jsonResponse([]);
  if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
  if (url.endsWith("/sources")) return jsonResponse([]);
  if (url.endsWith("/markets")) return jsonResponse([]);
  if (url.endsWith("/topics/scores")) return jsonResponse([]);
  if (url.endsWith("/queue")) return jsonResponse([]);
  if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
  if (url.endsWith("/autonomy/review-queue")) return jsonResponse([]);
  if (url.includes("/autonomy/prioritized-opportunities")) return jsonResponse([]);
  if (url.endsWith("/autonomy/matched-opportunities")) return jsonResponse([]);
  if (url.endsWith("/autonomy/content-work-items")) return jsonResponse([]);
  if (url.endsWith("/candidate-queue")) return jsonResponse([]);
  if (url.endsWith("/factory/runs")) return jsonResponse([]);
  if (url.endsWith("/factory/memory-patterns")) return jsonResponse([]);
  if (url.endsWith("/factory/solution-memories")) return jsonResponse([]);
  if (url.endsWith("/factory/critic-reviews")) return jsonResponse([]);
  if (url.endsWith("/factory/priority")) {
    return jsonResponse({
      evaluatedAt: "2026-03-19T09:00:00.000Z",
      signals: [],
      candidateQueueItems: []
    } satisfies FactoryPrioritySelectionResult);
  }
  if (url.endsWith("/system/ai-runtime-health")) {
    return jsonResponse({
      providerMode: "deterministic",
      textProvider: null,
      visualProvider: null,
      aiActive: false,
      fallbackActive: true,
      runtimeEnabled: true,
      schedulerRuntimeEnabled: true,
      fallbackEnabled: true,
      configStatus: "fallback_active",
      issues: [],
      operatorAuthConfig: {
        configured: true,
        missingConfigKeys: []
      }
    } satisfies AIRuntimeHealthSummary);
  }
  if (url.endsWith("/system/launch-preflight")) {
    return jsonResponse({
      launchStatus: "fallback_ready",
      aiReady: false,
      fallbackReady: true,
      providerMode: "deterministic",
      textProvider: null,
      schedulerRuntimeEnabled: true,
      configStatus: "fallback_active",
      issues: [],
      operatorAuthConfig: {
        configured: true,
        missingConfigKeys: []
      }
    } satisfies LaunchPreflightResult);
  }
  if (url.endsWith("/system/providers")) {
    return jsonResponse({
      mode: "deterministic",
      textProvider: null,
      visualProvider: null,
      fallbackEnabled: true
    });
  }

  return null;
}

describe("App phase 3 workflow", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem(OPERATOR_AUTH_TOKEN_STORAGE_KEY, "test-operator-token");
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("shows the operator login gate when no valid operator session exists", async () => {
    window.localStorage.removeItem(OPERATOR_AUTH_TOKEN_STORAGE_KEY);
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);

      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    expect(await screen.findByRole("heading", { name: "Operator sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Operator username")).toBeInTheDocument();
    expect(screen.getByLabelText("Operator password")).toBeInTheDocument();
  });

  it("logs in the operator and loads the protected dashboard", async () => {
    window.localStorage.removeItem(OPERATOR_AUTH_TOKEN_STORAGE_KEY);

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/auth/login") && method === "POST") {
        return jsonResponse({
          username: "operator",
          token: "fresh-operator-token",
          expiresAt: "2026-03-17T00:00:00.000Z"
        });
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await user.type(await screen.findByLabelText("Operator username"), "operator");
    await user.type(screen.getByLabelText("Operator password"), "operator-pass");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Operator workflow" })).toBeInTheDocument();
    expect(window.localStorage.getItem(OPERATOR_AUTH_TOKEN_STORAGE_KEY)).toBe("fresh-operator-token");
  });

  it("returns to the login gate when the saved operator session is invalid", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/auth/session") && method === "GET") {
        return jsonResponse({ error: "Invalid or expired operator session." }, 401);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    expect(await screen.findByRole("heading", { name: "Operator sign in" })).toBeInTheDocument();
    expect(window.localStorage.getItem(OPERATOR_AUTH_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it(
    "supports source intake, market profiles, topic scoring, and queue building",
    async () => {
    const signals: Signal[] = [];
    const ideas: Idea[] = [];
    const contentAssets: ContentAsset[] = [];
    const visuals: VisualAsset[] = [];
    const analytics: AnalyticsSnapshot[] = [];
    const recommendations: StrategyRecommendation[] = [];
    const sources: SourceItem[] = [
      {
        id: "source-1",
        title: "Existing source",
        sourceType: "article",
        rawText: "Existing source raw text",
        normalizedSummary: "Existing normalized summary",
        tags: ["ai", "operators"],
        status: "normalized",
        createdAt: "2026-03-14T00:00:00.000Z"
      }
    ];
    const markets: MarketProfile[] = [
      {
        id: "market-1",
        country: "Canada",
        region: "North America",
        primaryLanguage: "English",
        marketNote: "High fit market",
        linkedinPriority: "high",
        serviceFitScore: 82,
        createdAt: "2026-03-14T00:00:00.000Z"
      }
    ];
    const topicScores: TopicScore[] = [];
    const queueItems: ContentQueueItem[] = [];
    const brandVoiceProfiles: BrandVoiceProfile[] = [];
    const activeBrandVoice = {
      active: null,
      profiles: brandVoiceProfiles
    };
    const qualityAssessments: WritingQualityAssessment[] = [];
    let generatedComment = "";
    let generatedReply = "";
    let relevanceResult:
      | {
          relevanceScore: number;
          bestAngle: string;
          recommendedAction: string;
          reasoningSummary: string;
          riskNotes: string[];
          mode: string;
          targetType: string;
        }
      | undefined;
    let decisionResult: DecisionPlan | undefined;

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/signals") && method === "GET") return jsonResponse(signals);
      if (url.endsWith("/ideas") && method === "GET") return jsonResponse(ideas);
      if (url.endsWith("/content") && method === "GET") return jsonResponse(contentAssets);
      if (url.endsWith("/visuals") && method === "GET") return jsonResponse(visuals);
      if (url.endsWith("/analytics") && method === "GET") return jsonResponse(analytics);
      if (url.endsWith("/strategy/recommendations") && method === "GET") {
        return jsonResponse(recommendations);
      }
      if (url.endsWith("/sources") && method === "GET") return jsonResponse(sources);
      if (url.endsWith("/markets") && method === "GET") return jsonResponse(markets);
      if (url.endsWith("/topics/scores") && method === "GET") return jsonResponse(topicScores);
      if (url.endsWith("/queue") && method === "GET") return jsonResponse(queueItems);
      if (url.endsWith("/brand-voice") && method === "GET") return jsonResponse(activeBrandVoice);
      if (url.endsWith("/system/providers") && method === "GET") {
        return jsonResponse({
          mode: "deterministic",
          textProvider: null,
          visualProvider: null,
          fallbackEnabled: true
        });
      }

      if (url.endsWith("/sources") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        const created = {
          id: "source-2",
          ...body,
          normalizedSummary: "Normalized source summary",
          tags: ["ai", "market"],
          status: "normalized",
          createdAt: "2026-03-14T01:00:00.000Z"
        };
        sources.push(created);
        return jsonResponse(created, 201);
      }

      if (url.endsWith("/markets") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        const created = {
          id: "market-2",
          ...body,
          linkedinPriority: "high",
          serviceFitScore: 84,
          createdAt: "2026-03-14T02:00:00.000Z"
        };
        markets.push(created);
        return jsonResponse(created, 201);
      }

      if (url.endsWith("/topics/score") && method === "POST") {
        const created = [
          {
            id: "topic-1",
            topicLabel: "AI rollout operations",
            sourceItemId: "source-2",
            marketProfileId: "market-2",
            brandRelevanceScore: 85,
            marketRelevanceScore: 79,
            noveltyScore: 64,
            priorityScore: 80,
            rationale: "Strong fit for operator-focused brand and market.",
            createdAt: "2026-03-14T03:00:00.000Z"
          }
        ];
        topicScores.splice(0, topicScores.length, ...created);
        return jsonResponse(created, 201);
      }

      if (url.endsWith("/queue/build") && method === "POST") {
        const created = [
          {
            id: "queue-1",
            topicScoreId: "topic-1",
            recommendedAction: "write_post" as const,
            priority: "high" as const,
            reason: "Top-scoring topic for the current market mix.",
            status: "queued" as const,
            createdAt: "2026-03-14T04:00:00.000Z"
          }
        ];
        queueItems.splice(0, queueItems.length, ...created);
        return jsonResponse(created, 201);
      }

      if (url.endsWith("/brand-voice") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        const created = {
          id: "voice-1",
          ...body,
          createdAt: "2026-03-14T01:30:00.000Z",
          updatedAt: "2026-03-14T01:30:00.000Z"
        };
        brandVoiceProfiles.splice(0, brandVoiceProfiles.length, created);
        activeBrandVoice.active = created;
        activeBrandVoice.profiles = brandVoiceProfiles;
        return jsonResponse(created, 201);
      }

      if (url.endsWith("/comments/generate") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        generatedComment =
          "The handoff is where most of these tools die. If nobody owns the workflow after launch, the model never gets a fair shot.";
        return jsonResponse(
          {
            text: generatedComment,
            mode: "deterministic",
            engagementMode: body.useRelevanceAdaptation
              ? "strategic_execution"
              : undefined,
            appliedAngle: body.useRelevanceAdaptation ? "ownership_gap" : undefined,
            shouldGenerate: true,
            adaptationPlan: body.useRelevanceAdaptation
              ? {
                  engagementMode: "strategic_execution",
                  angleDirective: "ownership_gap",
                  shouldGenerate: true
                }
              : undefined
          },
          201
        );
      }

      if (url.endsWith("/replies/generate") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        generatedReply =
          "That tracks. Support is usually where the ownership gap shows up first because the exceptions pile up fast.";
        return jsonResponse(
          {
            text: generatedReply,
            mode: "deterministic",
            engagementMode: body.useRelevanceAdaptation
              ? "insight_light_positioning"
              : undefined,
            appliedAngle: body.useRelevanceAdaptation ? "ownership_gap" : undefined,
            shouldGenerate: true,
            adaptationPlan: body.useRelevanceAdaptation
              ? {
                  engagementMode: "insight_light_positioning",
                  angleDirective: "ownership_gap",
                  shouldGenerate: true
                }
              : undefined
          },
          201
        );
      }

      if (url.endsWith("/relevance/analyze") && method === "POST") {
        relevanceResult = {
          relevanceScore: 86,
          bestAngle: "ownership_gap",
          recommendedAction: "comment",
          reasoningSummary: "The strongest angle is ownership after the workflow leaves the demo.",
          riskNotes: [],
          mode: "deterministic",
          targetType: "mixed"
        };
        return jsonResponse(relevanceResult, 201);
      }

      if (url.endsWith("/decision/plan") && method === "POST") {
        decisionResult = {
          recommendedNextAction: "generate_post_candidate",
          bestAngle: "ownership_gap",
          contentPriority: "high",
          engagementPriority: "medium",
          publishability: "high",
          confidence: 84,
          decisionMode: "deterministic",
          riskNotes: [],
          reasoningSummary:
            "Strong workflow pain plus ICP fit makes this a strong post candidate.",
          suggestedFlow: "post_only",
          shouldEscalateToPost: true,
          shouldEscalateToEngagement: false,
          shouldStoreForLater: false
        };
        return jsonResponse(decisionResult, 201);
      }

      if (url.endsWith("/content/finalize") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        const existing = contentAssets.find((asset) => asset.id === body.contentId);
        if (!existing) {
          return jsonResponse({ error: "Content not found" }, 404);
        }
        const updated = {
          ...existing,
          finalHook: "Final hook",
          finalBody: "Lead with the operational payoff.\n\nThen explain the blocker with clearer rhythm.",
          finalClosing: "What is blocking rollout on your side?",
          finalStatus: "ready" as const,
          finalQualityScore: 92
        };
        const index = contentAssets.findIndex((asset) => asset.id === body.contentId);
        contentAssets.splice(index, 1, updated);
        return jsonResponse(updated, 201);
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Existing source")).toBeInTheDocument();
      expect(screen.getByText("Canada")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Source title"), "New source");
    await user.selectOptions(screen.getByLabelText("Discovery source type"), "article");
    await user.type(screen.getByLabelText("Source URL"), "https://example.com/new");
    await user.type(screen.getByLabelText("Source raw text"), "Open-source market note");
    await user.click(screen.getByRole("button", { name: "Add Source" }));

    await waitFor(() => {
      expect(screen.getByText("New source")).toBeInTheDocument();
      expect(screen.getByText("Normalized source summary")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Country"), "Germany");
    await user.type(screen.getByLabelText("Region"), "Europe");
    await user.type(screen.getByLabelText("Primary language"), "German");
    await user.type(screen.getByLabelText("Market note"), "Strong consulting market");
    await user.click(screen.getByRole("button", { name: "Add Market Profile" }));

    await waitFor(() => {
      expect(screen.getByText("Germany")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Score Topics" }));
    await waitFor(() => {
      expect(screen.getByText("AI rollout operations")).toBeInTheDocument();
      expect(
        screen.getByText("Strong fit for operator-focused brand and market.")
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Build Queue" }));
    await waitFor(() => {
      expect(screen.getByText("Top-scoring topic for the current market mix.")).toBeInTheDocument();
      expect(screen.getByText("write_post")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Voice profile name"), "Grounded Operator Voice");
    await user.type(screen.getByLabelText("Voice tone"), "Direct, practical, calm");
    await user.type(
      screen.getByLabelText("Voice audience"),
      "Founders and operator-led teams"
    );
    await user.type(
      screen.getByLabelText("Writing rules"),
      "Use plain business language, Lead with a concrete problem"
    );
    await user.type(
      screen.getByLabelText("Banned patterns"),
      "AI is changing everything, game changer"
    );
    await user.type(
      screen.getByLabelText("Preferred patterns"),
      "operational payoff, practical rollout"
    );
    await user.type(
      screen.getByLabelText("Style notes"),
      "Keep sentences varied and specific."
    );
    await user.click(screen.getByRole("button", { name: "Save Brand Voice" }));

    await waitFor(() => {
      expect(screen.getAllByText("Grounded Operator Voice").length).toBeGreaterThan(0);
      expect(screen.getByText("Direct, practical, calm")).toBeInTheDocument();
    });

    await user.type(
      screen.getByLabelText("Source post text"),
      "Most teams buy AI tools before they fix the handoff between sales and ops. The demo looks great, but nobody owns the workflow after launch."
    );
    await user.type(
      screen.getByLabelText("Comment positioning context"),
      "Operator-led, practical rollout."
    );
    await user.click(screen.getByRole("button", { name: "Generate Comment" }));

    await waitFor(() => {
      expect(screen.getByText(generatedComment)).toBeInTheDocument();
    });

    await user.type(
      screen.getByLabelText("Our post text"),
      "AI copilots fail when nobody owns the workflow after the demo."
    );
    await user.type(
      screen.getByLabelText("Incoming comment text"),
      "We saw the same thing in support. The queue design was the real mess."
    );
    await user.type(screen.getByLabelText("Reply context"), "Keep it concise.");
    await user.click(screen.getByRole("button", { name: "Generate Reply" }));

    await waitFor(() => {
      expect(screen.getByText(generatedReply)).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Role/title"), "Founder");
    await user.type(
      screen.getByLabelText("Company/about text"),
      "We help B2B teams fix GTM operations and workflow handoffs."
    );
    await user.type(
      screen.getByLabelText("Post text"),
      "Most automation fails because nobody owns the workflow after launch."
    );
    await user.click(screen.getByRole("button", { name: "Analyze Relevance" }));

    await waitFor(() => {
      expect(screen.getByText(/Score:/)).toBeInTheDocument();
      expect(screen.getByText(/Angle:/)).toBeInTheDocument();
      expect(screen.getByText(/Action:/)).toBeInTheDocument();
      expect(screen.getAllByText(/ownership_gap/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/^comment$/).length).toBeGreaterThan(0);
      expect(screen.getByText(relevanceResult?.reasoningSummary ?? "")).toBeInTheDocument();
    });

    await user.type(
      screen.getByLabelText("Decision signal text"),
      "Most AI copilots fail after the demo because nobody owns the workflow."
    );
    await user.type(screen.getByLabelText("Decision target role/title"), "Founder");
    await user.click(screen.getByRole("button", { name: "Plan Decision" }));

    await waitFor(() => {
      expect(screen.getByText(/Recommended action:/)).toBeInTheDocument();
      expect(screen.getByText(/generate_post_candidate/)).toBeInTheDocument();
      expect(screen.getByText(/Suggested flow:/)).toBeInTheDocument();
      expect(screen.getByText(decisionResult?.reasoningSummary ?? "")).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText("Use relevance adaptation for comment"));
    await user.click(screen.getByRole("button", { name: "Generate Comment" }));

    await waitFor(() => {
      expect(screen.getByText(/Adaptation: strategic_execution/)).toBeInTheDocument();
      expect(screen.getByText(/Angle: ownership_gap/)).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText("Use relevance adaptation for reply"));
    await user.click(screen.getByRole("button", { name: "Generate Reply" }));

    await waitFor(() => {
      expect(screen.getByText(/Adaptation: insight_light_positioning/)).toBeInTheDocument();
    });
  }, 20000);

  it("runs recommended action by prefilling the comment writer for generate_comment", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/decision/plan") && method === "POST") {
        return jsonResponse(
          {
            recommendedNextAction: "generate_comment",
            bestAngle: "ownership_gap",
            contentPriority: "medium",
            engagementPriority: "high",
            publishability: "medium",
            confidence: 82,
            decisionMode: "deterministic",
            riskNotes: [],
            reasoningSummary: "Commenting is the best next step for this live thread.",
            suggestedFlow: "engagement_only",
            shouldEscalateToPost: false,
            shouldEscalateToEngagement: true,
            shouldStoreForLater: false
          },
          201
        );
      }

      if (url.endsWith("/comments/generate") && method === "POST") {
        return jsonResponse({ text: "comment", mode: "deterministic" }, 201);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Operator workflow" })).toBeInTheDocument();
    });

    await user.type(
      screen.getByLabelText("Decision signal text"),
      "Most automation dies when nobody owns the workflow after launch."
    );
    await user.type(screen.getByLabelText("Decision target role/title"), "Founder");
    await user.type(
      screen.getByLabelText("Decision post/comment context"),
      "A live thread about rollout failures."
    );
    await user.click(screen.getByRole("button", { name: "Plan Decision" }));

    await waitFor(() => {
      expect(screen.getByText(/generate_comment/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Run Recommended Action" }));

    expect(screen.getByLabelText("Source post text")).toHaveValue(
      "A live thread about rollout failures."
    );
    expect(screen.getByLabelText("Comment positioning context")).toHaveValue(
      "Commenting is the best next step for this live thread."
    );
    expect(screen.getByLabelText("Comment target role/title")).toHaveValue("Founder");
    expect(screen.getByText("Sent current recommendation to Comment Writer.")).toBeInTheDocument();
    },
    15000
  );

  it("runs recommended action by prefilling the reply writer for generate_reply", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      if (url.endsWith("/decision/plan") && method === "POST") {
        return jsonResponse(
          {
            recommendedNextAction: "generate_reply",
            bestAngle: "handoff_failure",
            contentPriority: "low",
            engagementPriority: "high",
            publishability: "medium",
            confidence: 79,
            decisionMode: "deterministic",
            riskNotes: [],
            reasoningSummary: "There is direct reply context, so reply first.",
            suggestedFlow: "engagement_only",
            shouldEscalateToPost: false,
            shouldEscalateToEngagement: true,
            shouldStoreForLater: false
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await user.type(
      screen.getByLabelText("Decision signal text"),
      "Replies matter when the thread already has a useful operator point."
    );
    await user.type(screen.getByLabelText("Decision target role/title"), "Ops leader");
    await user.type(
      screen.getByLabelText("Decision post/comment context"),
      "We saw this in onboarding too."
    );
    await user.click(screen.getByLabelText("There is a reply context"));
    await user.click(screen.getByRole("button", { name: "Plan Decision" }));

    await waitFor(() => {
      expect(screen.getByText(/generate_reply/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Run Recommended Action" }));

    expect(screen.getByLabelText("Our post text")).toHaveValue(
      "Replies matter when the thread already has a useful operator point."
    );
    expect(screen.getByLabelText("Incoming comment text")).toHaveValue(
      "We saw this in onboarding too."
    );
    expect(screen.getByLabelText("Reply context")).toHaveValue(
      "There is direct reply context, so reply first."
    );
    expect(screen.getByText("Sent current recommendation to Reply Writer.")).toBeInTheDocument();
  });

  it("runs recommended action by prefilling the post generator for generate_post_candidate", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      if (url.endsWith("/decision/plan") && method === "POST") {
        return jsonResponse(
          {
            recommendedNextAction: "generate_post_candidate",
            bestAngle: "ownership_gap",
            contentPriority: "high",
            engagementPriority: "low",
            publishability: "high",
            confidence: 88,
            decisionMode: "deterministic",
            riskNotes: [],
            reasoningSummary: "Strong workflow pain plus ICP fit makes this a strong post candidate.",
            suggestedFlow: "post_only",
            shouldEscalateToPost: true,
            shouldEscalateToEngagement: false,
            shouldStoreForLater: false
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await user.type(
      screen.getByLabelText("Decision signal text"),
      "Most AI copilots fail after the demo because nobody owns the workflow."
    );
    await user.selectOptions(screen.getByLabelText("Decision source type"), "article");
    await user.click(screen.getByRole("button", { name: "Plan Decision" }));

    await waitFor(() => {
      expect(screen.getByText(/generate_post_candidate/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Run Recommended Action" }));

    expect(screen.getByLabelText("Signal title")).toHaveValue(
      "Most AI copilots fail after the demo because nobody owns the workflow"
    );
    expect(screen.getByLabelText("Source type")).toHaveValue("research");
    expect(screen.getByLabelText("Raw text")).toHaveValue(
      "Most AI copilots fail after the demo because nobody owns the workflow."
    );
    expect(screen.getByText("Sent current recommendation to Post Generator.")).toBeInTheDocument();
  });

  it("stores lightweight save-for-later items and shows ignore explanations", async () => {
    let callCount = 0;

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      if (url.endsWith("/decision/plan") && method === "POST") {
        callCount += 1;
        if (callCount === 1) {
          return jsonResponse(
            {
              recommendedNextAction: "save_for_later",
              bestAngle: "workflow_accountability",
              contentPriority: "medium",
              engagementPriority: "low",
              publishability: "medium",
              confidence: 57,
              decisionMode: "deterministic",
              riskNotes: ["Signal has some fit but weak immediacy."],
              reasoningSummary:
                "The signal is relevant enough to keep, but it is not urgent or fully formed yet.",
              suggestedFlow: "research_later",
              shouldEscalateToPost: false,
              shouldEscalateToEngagement: false,
              shouldStoreForLater: true
            },
            201
          );
        }

        return jsonResponse(
          {
            recommendedNextAction: "ignore",
            bestAngle: "low_fit",
            contentPriority: "low",
            engagementPriority: "low",
            publishability: "low",
            confidence: 28,
            decisionMode: "deterministic",
            riskNotes: ["Weak operational relevance."],
            reasoningSummary: "The signal is too soft or off-ICP to justify immediate action.",
            suggestedFlow: "ignore",
            shouldEscalateToPost: false,
            shouldEscalateToEngagement: false,
            shouldStoreForLater: false
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await user.type(
      screen.getByLabelText("Decision signal text"),
      "There may be a useful angle on approval workflow friction, but the signal is still thin."
    );
    await user.click(screen.getByRole("button", { name: "Plan Decision" }));

    await waitFor(() => {
      expect(screen.getAllByText(/save_for_later/).length).toBeGreaterThan(0);
    });

    await user.click(screen.getByRole("button", { name: "Run Recommended Action" }));

    expect(screen.getAllByText("Saved for later").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        /The signal is relevant enough to keep, but it is not urgent or fully formed yet./
      ).length
    ).toBeGreaterThan(0);

    await user.clear(screen.getByLabelText("Decision signal text"));
    await user.type(
      screen.getByLabelText("Decision signal text"),
      "Leadership mindset and creative energy matter more than process."
    );
    await user.click(screen.getByRole("button", { name: "Plan Decision" }));

    await waitFor(() => {
      expect(
        screen.getByText((content, element) => {
          if (!element) {
            return false;
          }
          return (
            element.tagName.toLowerCase() === "p" &&
            element.textContent?.includes("Recommended action:") === true &&
            element.textContent?.includes("ignore") === true
          );
        })
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Run Recommended Action" }));

    expect(
      screen.getByText(/No action launched. The signal is too soft or off-ICP to justify immediate action./)
    ).toBeInTheDocument();
  }, 10000);

  it("hydrates saved-for-later items from localStorage on load", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-1",
          signalText: "Approval workflow friction is worth revisiting.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Strong enough to keep for later follow-up.",
          priority: "medium",
          recommendedAction: "save_for_later",
          createdAt: "2026-03-14T12:00:00.000Z"
        }
      ])
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Saved for later")).toBeInTheDocument();
      expect(
        screen.getByText("Approval workflow friction is worth revisiting.")
      ).toBeInTheDocument();
      expect(
        screen.getByText("Strong enough to keep for later follow-up.")
      ).toBeInTheDocument();
    });
  });

  it("persists save-for-later items to localStorage", async () => {
    let callCount = 0;

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      if (url.endsWith("/decision/plan") && method === "POST") {
        callCount += 1;
        if (callCount === 1) {
          return jsonResponse(
            {
              recommendedNextAction: "save_for_later",
              bestAngle: "workflow_accountability",
              contentPriority: "medium",
              engagementPriority: "low",
              publishability: "medium",
              confidence: 61,
              decisionMode: "deterministic",
              riskNotes: [],
              reasoningSummary: "Useful enough to keep in the local queue.",
              suggestedFlow: "research_later",
              shouldEscalateToPost: false,
              shouldEscalateToEngagement: false,
              shouldStoreForLater: true
            },
            201
          );
        }
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await user.type(screen.getByLabelText("Decision signal text"), "Keep this workflow note for later.");
    await user.click(screen.getByRole("button", { name: "Plan Decision" }));

    await waitFor(() => {
      expect(screen.getAllByText(/save_for_later/).length).toBeGreaterThan(0);
    });

    await user.click(screen.getByRole("button", { name: "Run Recommended Action" }));

    const stored = window.localStorage.getItem("linkedin-brand-os:saved-for-later");
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored ?? "[]")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          signalText: "Keep this workflow note for later.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Useful enough to keep in the local queue.",
          priority: "low",
          recommendedAction: "save_for_later",
          status: "new"
        })
      ])
    );
  });

  it("defaults new saved queue items to status new", async () => {
    let callCount = 0;

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      if (url.endsWith("/decision/plan") && method === "POST") {
        callCount += 1;
        if (callCount === 1) {
          return jsonResponse(
            {
              recommendedNextAction: "save_for_later",
              bestAngle: "workflow_accountability",
              contentPriority: "medium",
              engagementPriority: "low",
              publishability: "medium",
              confidence: 61,
              decisionMode: "deterministic",
              riskNotes: [],
              reasoningSummary: "Useful enough to keep in the local queue.",
              suggestedFlow: "research_later",
              shouldEscalateToPost: false,
              shouldEscalateToEngagement: false,
              shouldStoreForLater: true
            },
            201
          );
        }
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await user.type(screen.getByLabelText("Decision signal text"), "Keep this workflow note for later.");
    await user.click(screen.getByRole("button", { name: "Plan Decision" }));
    await waitFor(() => {
      expect(screen.getAllByText(/save_for_later/).length).toBeGreaterThan(0);
    });
    await user.click(screen.getByRole("button", { name: "Run Recommended Action" }));

    expect(screen.getByText("new")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("linkedin-brand-os:saved-for-later") ?? "[]")).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "new" })])
    );
  });

  it("ignores malformed saved-for-later storage data safely", async () => {
    window.localStorage.setItem("linkedin-brand-os:saved-for-later", "{not-json");

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    expect(screen.queryByText("Saved for later")).not.toBeInTheDocument();
  });

  it("removes one saved queue item and updates localStorage", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-1",
          signalText: "Keep the approval workflow note.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Worth keeping.",
          priority: "medium",
          recommendedAction: "save_for_later",
          createdAt: "2026-03-14T12:00:00.000Z"
        },
        {
          id: "saved-2",
          signalText: "Keep the rollout ownership note.",
          bestAngle: "ownership_gap",
          reasoningSummary: "Also worth keeping.",
          priority: "high",
          recommendedAction: "save_for_later",
          createdAt: "2026-03-14T13:00:00.000Z"
        }
      ])
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Keep the approval workflow note.")).toBeInTheDocument();
      expect(screen.getByText("Keep the rollout ownership note.")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Remove saved-1" }));

    expect(screen.queryByText("Keep the approval workflow note.")).not.toBeInTheDocument();
    expect(screen.getByText("Keep the rollout ownership note.")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("linkedin-brand-os:saved-for-later") ?? "[]")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "saved-2" })
      ])
    );
  });

  it("clears all saved queue items and updates localStorage", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-1",
          signalText: "Keep the approval workflow note.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Worth keeping.",
          priority: "medium",
          recommendedAction: "save_for_later",
          createdAt: "2026-03-14T12:00:00.000Z"
        }
      ])
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Keep the approval workflow note.")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Clear all saved items" }));

    expect(screen.queryByText("Saved for later")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("linkedin-brand-os:saved-for-later")).toBe("[]");
  });

  it("sends a saved queue item to the post generator", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-1",
          signalText: "Most AI copilots fail after the demo because nobody owns the workflow.",
          bestAngle: "ownership_gap",
          reasoningSummary: "Strong enough to turn into a post.",
          priority: "high",
          recommendedAction: "generate_post_candidate",
          createdAt: "2026-03-14T12:00:00.000Z",
          sourceType: "article"
        }
      ])
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText(/Most AI copilots fail after the demo/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Send saved-1 to post generator" }));

    expect(screen.getByLabelText("Signal title")).toHaveValue(
      "Most AI copilots fail after the demo because nobody owns the workflow"
    );
    expect(screen.getByLabelText("Source type")).toHaveValue("research");
    expect(screen.getByLabelText("Raw text")).toHaveValue(
      "Most AI copilots fail after the demo because nobody owns the workflow."
    );
    expect(screen.getByText("sent")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("linkedin-brand-os:saved-for-later") ?? "[]")).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "saved-1", status: "sent" })])
    );
  });

  it("sends a saved queue item to the comment writer", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-1",
          signalText: "The rollout breaks when nobody owns the workflow after launch.",
          bestAngle: "ownership_gap",
          reasoningSummary: "Use an execution-focused angle.",
          priority: "high",
          recommendedAction: "generate_comment",
          createdAt: "2026-03-14T12:00:00.000Z",
          targetRole: "Founder",
          companyContext: "Operator-led SaaS team",
          postContext: "A live thread about rollout failures.",
          relevanceScore: 88
        }
      ])
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText(/The rollout breaks when nobody owns the workflow/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Send saved-1 to comment writer" }));

    expect(screen.getByLabelText("Source post text")).toHaveValue("A live thread about rollout failures.");
    expect(screen.getByLabelText("Comment positioning context")).toHaveValue(
      "Use an execution-focused angle."
    );
    expect(screen.getByLabelText("Comment target role/title")).toHaveValue("Founder");
    expect(screen.getByText("sent")).toBeInTheDocument();
  });

  it("sends a saved queue item to the reply writer", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-1",
          signalText: "Replies work better when the thread already has a useful operator point.",
          bestAngle: "ownership_gap",
          reasoningSummary: "Reply directly and keep it practical.",
          priority: "medium",
          recommendedAction: "generate_reply",
          createdAt: "2026-03-14T12:00:00.000Z",
          targetRole: "Operator",
          companyContext: "Operator-led SaaS team",
          postContext: "We saw this in onboarding too.",
          relevanceScore: 74
        }
      ])
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText(/Replies work better when the thread/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Send saved-1 to reply writer" }));

    expect(screen.getByLabelText("Our post text")).toHaveValue(
      "Replies work better when the thread already has a useful operator point."
    );
    expect(screen.getByLabelText("Incoming comment text")).toHaveValue("We saw this in onboarding too.");
    expect(screen.getByLabelText("Reply context")).toHaveValue(
      "Reply directly and keep it practical."
    );
    expect(screen.getByText("sent")).toBeInTheDocument();
  });

  it("marks a saved queue item done and persists the state", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-1",
          signalText: "Keep the approval workflow note.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Worth keeping.",
          priority: "medium",
          recommendedAction: "save_for_later",
          createdAt: "2026-03-14T12:00:00.000Z",
          status: "new"
        }
      ])
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Keep the approval workflow note.")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Mark saved-1 done" }));

    expect(screen.getByText("done")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("linkedin-brand-os:saved-for-later") ?? "[]")).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "saved-1", status: "done" })])
    );
  });

  it("archives a saved queue item and persists the state", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-1",
          signalText: "Keep the approval workflow note.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Worth keeping.",
          priority: "medium",
          recommendedAction: "save_for_later",
          createdAt: "2026-03-14T12:00:00.000Z",
          status: "new"
        }
      ])
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Keep the approval workflow note.")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Archive saved-1" }));

    expect(screen.getByText("archived")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("linkedin-brand-os:saved-for-later") ?? "[]")).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "saved-1", status: "archived" })])
    );
  });

  it("hydrates legacy saved queue items without status as new", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-1",
          signalText: "Legacy workflow note.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Legacy item without status.",
          priority: "medium",
          recommendedAction: "save_for_later",
          createdAt: "2026-03-14T12:00:00.000Z"
        }
      ])
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Legacy workflow note.")).toBeInTheDocument();
      expect(screen.getByText("new")).toBeInTheDocument();
    });
  });

  it("shows every queue item under the All filter", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-new",
          signalText: "New workflow note.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Fresh item.",
          priority: "medium",
          recommendedAction: "save_for_later",
          createdAt: "2026-03-14T12:00:00.000Z",
          status: "new"
        },
        {
          id: "saved-sent",
          signalText: "Sent workflow note.",
          bestAngle: "ownership_gap",
          reasoningSummary: "Already sent.",
          priority: "high",
          recommendedAction: "generate_comment",
          createdAt: "2026-03-14T13:00:00.000Z",
          status: "sent"
        },
        {
          id: "saved-done",
          signalText: "Done workflow note.",
          bestAngle: "operational_roi",
          reasoningSummary: "Already done.",
          priority: "medium",
          recommendedAction: "generate_post_candidate",
          createdAt: "2026-03-14T14:00:00.000Z",
          status: "done"
        },
        {
          id: "saved-archived",
          signalText: "Archived workflow note.",
          bestAngle: "low_fit",
          reasoningSummary: "Archived item.",
          priority: "low",
          recommendedAction: "ignore",
          createdAt: "2026-03-14T15:00:00.000Z",
          status: "archived"
        }
      ])
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("New workflow note.")).toBeInTheDocument();
      expect(screen.getByText("Sent workflow note.")).toBeInTheDocument();
      expect(screen.getByText("Done workflow note.")).toBeInTheDocument();
      expect(screen.getByText("Archived workflow note.")).toBeInTheDocument();
    });
  });

  it("shows only new and sent items under the Active filter", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-new",
          signalText: "New workflow note.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Fresh item.",
          priority: "medium",
          recommendedAction: "save_for_later",
          createdAt: "2026-03-14T12:00:00.000Z",
          status: "new"
        },
        {
          id: "saved-sent",
          signalText: "Sent workflow note.",
          bestAngle: "ownership_gap",
          reasoningSummary: "Already sent.",
          priority: "high",
          recommendedAction: "generate_comment",
          createdAt: "2026-03-14T13:00:00.000Z",
          status: "sent"
        },
        {
          id: "saved-done",
          signalText: "Done workflow note.",
          bestAngle: "operational_roi",
          reasoningSummary: "Already done.",
          priority: "medium",
          recommendedAction: "generate_post_candidate",
          createdAt: "2026-03-14T14:00:00.000Z",
          status: "done"
        },
        {
          id: "saved-archived",
          signalText: "Archived workflow note.",
          bestAngle: "low_fit",
          reasoningSummary: "Archived item.",
          priority: "low",
          recommendedAction: "ignore",
          createdAt: "2026-03-14T15:00:00.000Z",
          status: "archived"
        }
      ])
    );

    fetchMock.mockImplementation(async () => jsonResponse([]));
    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("New workflow note.")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /^Active/ }));

    expect(screen.getByText("New workflow note.")).toBeInTheDocument();
    expect(screen.getByText("Sent workflow note.")).toBeInTheDocument();
    expect(screen.queryByText("Done workflow note.")).not.toBeInTheDocument();
    expect(screen.queryByText("Archived workflow note.")).not.toBeInTheDocument();
  });

  it("shows only done items under the Done filter", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-done",
          signalText: "Done workflow note.",
          bestAngle: "operational_roi",
          reasoningSummary: "Already done.",
          priority: "medium",
          recommendedAction: "generate_post_candidate",
          createdAt: "2026-03-14T14:00:00.000Z",
          status: "done"
        },
        {
          id: "saved-archived",
          signalText: "Archived workflow note.",
          bestAngle: "low_fit",
          reasoningSummary: "Archived item.",
          priority: "low",
          recommendedAction: "ignore",
          createdAt: "2026-03-14T15:00:00.000Z",
          status: "archived"
        }
      ])
    );

    fetchMock.mockImplementation(async () => jsonResponse([]));
    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Done workflow note.")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /^Done/ }));

    expect(screen.getByText("Done workflow note.")).toBeInTheDocument();
    expect(screen.queryByText("Archived workflow note.")).not.toBeInTheDocument();
  });

  it("shows only archived items under the Archived filter", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-new",
          signalText: "New workflow note.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Fresh item.",
          priority: "medium",
          recommendedAction: "save_for_later",
          createdAt: "2026-03-14T12:00:00.000Z",
          status: "new"
        },
        {
          id: "saved-archived",
          signalText: "Archived workflow note.",
          bestAngle: "low_fit",
          reasoningSummary: "Archived item.",
          priority: "low",
          recommendedAction: "ignore",
          createdAt: "2026-03-14T15:00:00.000Z",
          status: "archived"
        }
      ])
    );

    fetchMock.mockImplementation(async () => jsonResponse([]));
    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Archived workflow note.")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /^Archived/ }));

    expect(screen.getByText("Archived workflow note.")).toBeInTheDocument();
    expect(screen.queryByText("New workflow note.")).not.toBeInTheDocument();
  });

  it("renders a compact empty state when a filter has no items", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-new",
          signalText: "New workflow note.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Fresh item.",
          priority: "medium",
          recommendedAction: "save_for_later",
          createdAt: "2026-03-14T12:00:00.000Z",
          status: "new"
        }
      ])
    );

    fetchMock.mockImplementation(async () => jsonResponse([]));
    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("New workflow note.")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /^Archived/ }));

    expect(screen.getByText("No archived items yet.")).toBeInTheDocument();
    expect(screen.queryByText("New workflow note.")).not.toBeInTheDocument();
  });

  it("displays last action timestamps when available", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-sent",
          signalText: "Sent workflow note.",
          bestAngle: "ownership_gap",
          reasoningSummary: "Already sent.",
          priority: "high",
          recommendedAction: "generate_comment",
          createdAt: "2026-03-14T13:00:00.000Z",
          status: "sent",
          lastActionAt: "2026-03-14T13:30:00.000Z"
        }
      ])
    );

    fetchMock.mockImplementation(async () => jsonResponse([]));
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Sent workflow note.")).toBeInTheDocument();
      expect(screen.getByText(/Last action:/)).toBeInTheDocument();
    });
  });

  it("sorts queue items by newest first", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-oldest",
          signalText: "Oldest workflow note.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Oldest item.",
          priority: "medium",
          recommendedAction: "save_for_later",
          createdAt: "2026-03-14T10:00:00.000Z",
          status: "new"
        },
        {
          id: "saved-newest",
          signalText: "Newest workflow note.",
          bestAngle: "ownership_gap",
          reasoningSummary: "Newest item.",
          priority: "high",
          recommendedAction: "generate_comment",
          createdAt: "2026-03-14T14:00:00.000Z",
          status: "sent"
        },
        {
          id: "saved-middle",
          signalText: "Middle workflow note.",
          bestAngle: "operational_roi",
          reasoningSummary: "Middle item.",
          priority: "medium",
          recommendedAction: "generate_post_candidate",
          createdAt: "2026-03-14T12:00:00.000Z",
          status: "done"
        }
      ])
    );

    fetchMock.mockImplementation(async () => jsonResponse([]));
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Newest workflow note.")).toBeInTheDocument();
    });

    const queueItems = screen
      .getAllByText(/workflow note\./)
      .map((element) => element.textContent);

    expect(queueItems).toEqual([
      "Newest workflow note.",
      "Middle workflow note.",
      "Oldest workflow note."
    ]);
  });

  it("sorts queue items by oldest first", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-oldest",
          signalText: "Oldest workflow note.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Oldest item.",
          priority: "medium",
          recommendedAction: "save_for_later",
          createdAt: "2026-03-14T10:00:00.000Z",
          status: "new"
        },
        {
          id: "saved-newest",
          signalText: "Newest workflow note.",
          bestAngle: "ownership_gap",
          reasoningSummary: "Newest item.",
          priority: "high",
          recommendedAction: "generate_comment",
          createdAt: "2026-03-14T14:00:00.000Z",
          status: "sent"
        },
        {
          id: "saved-middle",
          signalText: "Middle workflow note.",
          bestAngle: "operational_roi",
          reasoningSummary: "Middle item.",
          priority: "medium",
          recommendedAction: "generate_post_candidate",
          createdAt: "2026-03-14T12:00:00.000Z",
          status: "done"
        }
      ])
    );

    fetchMock.mockImplementation(async () => jsonResponse([]));
    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Oldest workflow note.")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Oldest" }));

    const queueItems = screen
      .getAllByText(/workflow note\./)
      .map((element) => element.textContent);

    expect(queueItems).toEqual([
      "Oldest workflow note.",
      "Middle workflow note.",
      "Newest workflow note."
    ]);
  });

  it("sorts queue items by most recent last action first with safe timestamp fallback", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-no-action",
          signalText: "No action workflow note.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "No action yet.",
          priority: "medium",
          recommendedAction: "save_for_later",
          createdAt: "2026-03-14T14:00:00.000Z",
          status: "new"
        },
        {
          id: "saved-earlier-action",
          signalText: "Earlier action workflow note.",
          bestAngle: "ownership_gap",
          reasoningSummary: "Earlier action.",
          priority: "high",
          recommendedAction: "generate_comment",
          createdAt: "2026-03-14T10:00:00.000Z",
          status: "sent",
          lastActionAt: "2026-03-14T11:00:00.000Z"
        },
        {
          id: "saved-latest-action",
          signalText: "Latest action workflow note.",
          bestAngle: "operational_roi",
          reasoningSummary: "Latest action.",
          priority: "medium",
          recommendedAction: "generate_post_candidate",
          createdAt: "2026-03-14T09:00:00.000Z",
          status: "done",
          lastActionAt: "2026-03-14T15:00:00.000Z"
        }
      ])
    );

    fetchMock.mockImplementation(async () => jsonResponse([]));
    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Latest action workflow note.")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Last action" }));

    const queueItems = screen
      .getAllByText(/workflow note\./)
      .map((element) => element.textContent);

    expect(queueItems).toEqual([
      "Latest action workflow note.",
      "No action workflow note.",
      "Earlier action workflow note."
    ]);
  });

  it("applies sorting correctly inside filtered views", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-sent-older",
          signalText: "Older sent workflow note.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Older active item.",
          priority: "medium",
          recommendedAction: "save_for_later",
          createdAt: "2026-03-14T10:00:00.000Z",
          status: "sent"
        },
        {
          id: "saved-newer-sent",
          signalText: "Newer sent workflow note.",
          bestAngle: "ownership_gap",
          reasoningSummary: "Newer active item.",
          priority: "high",
          recommendedAction: "generate_comment",
          createdAt: "2026-03-14T14:00:00.000Z",
          status: "sent"
        },
        {
          id: "saved-archived",
          signalText: "Archived workflow note.",
          bestAngle: "low_fit",
          reasoningSummary: "Archived item.",
          priority: "low",
          recommendedAction: "ignore",
          createdAt: "2026-03-14T15:00:00.000Z",
          status: "archived"
        }
      ])
    );

    fetchMock.mockImplementation(async () => jsonResponse([]));
    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Newer sent workflow note.")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /^Active/ }));
    await user.click(screen.getByRole("button", { name: "Oldest" }));

    const queueItems = screen
      .getAllByText(/sent workflow note\./)
      .map((element) => element.textContent);

    expect(queueItems).toEqual([
      "Older sent workflow note.",
      "Newer sent workflow note."
    ]);
    expect(screen.queryByText("Archived workflow note.")).not.toBeInTheDocument();
  });

  it("keeps filtered empty states safe regardless of sort selection", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-new",
          signalText: "New workflow note.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Fresh item.",
          priority: "medium",
          recommendedAction: "save_for_later",
          createdAt: "2026-03-14T12:00:00.000Z",
          status: "new"
        }
      ])
    );

    fetchMock.mockImplementation(async () => jsonResponse([]));
    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("New workflow note.")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /^Archived/ }));
    await user.click(screen.getByRole("button", { name: "Last action" }));

    expect(screen.getByText("No archived items yet.")).toBeInTheDocument();
    expect(screen.queryByText("New workflow note.")).not.toBeInTheDocument();
  });

  it("hydrates the saved queue filter preference on app load", async () => {
    window.localStorage.setItem("linkedin-brand-os:queue-filter", "done");
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-done",
          signalText: "Done workflow note.",
          bestAngle: "operational_roi",
          reasoningSummary: "Already done.",
          priority: "medium",
          recommendedAction: "generate_post_candidate",
          createdAt: "2026-03-14T14:00:00.000Z",
          status: "done"
        },
        {
          id: "saved-new",
          signalText: "New workflow note.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Fresh item.",
          priority: "medium",
          recommendedAction: "save_for_later",
          createdAt: "2026-03-14T12:00:00.000Z",
          status: "new"
        }
      ])
    );

    fetchMock.mockImplementation(async () => jsonResponse([]));
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Done workflow note.")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /^Done/ })).toHaveClass("bg-slate-900");
    expect(screen.queryByText("New workflow note.")).not.toBeInTheDocument();
  });

  it("hydrates the saved queue sort preference on app load", async () => {
    window.localStorage.setItem("linkedin-brand-os:queue-sort", "oldest");
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-newest",
          signalText: "Newest workflow note.",
          bestAngle: "ownership_gap",
          reasoningSummary: "Newest item.",
          priority: "high",
          recommendedAction: "generate_comment",
          createdAt: "2026-03-14T14:00:00.000Z",
          status: "sent"
        },
        {
          id: "saved-oldest",
          signalText: "Oldest workflow note.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Oldest item.",
          priority: "medium",
          recommendedAction: "save_for_later",
          createdAt: "2026-03-14T10:00:00.000Z",
          status: "new"
        }
      ])
    );

    fetchMock.mockImplementation(async () => jsonResponse([]));
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Oldest workflow note.")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Oldest" })).toHaveClass("bg-slate-900");
    const queueItems = screen
      .getAllByText(/workflow note\./)
      .map((element) => element.textContent);
    expect(queueItems).toEqual(["Oldest workflow note.", "Newest workflow note."]);
  });

  it("persists queue filter changes to localStorage", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-done",
          signalText: "Done workflow note.",
          bestAngle: "operational_roi",
          reasoningSummary: "Already done.",
          priority: "medium",
          recommendedAction: "generate_post_candidate",
          createdAt: "2026-03-14T14:00:00.000Z",
          status: "done"
        }
      ])
    );

    fetchMock.mockImplementation(async () => jsonResponse([]));
    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Done workflow note.")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /^Done/ }));

    expect(window.localStorage.getItem("linkedin-brand-os:queue-filter")).toBe("done");
  });

  it("persists queue sort changes to localStorage", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-newest",
          signalText: "Newest workflow note.",
          bestAngle: "ownership_gap",
          reasoningSummary: "Newest item.",
          priority: "high",
          recommendedAction: "generate_comment",
          createdAt: "2026-03-14T14:00:00.000Z",
          status: "sent"
        },
        {
          id: "saved-oldest",
          signalText: "Oldest workflow note.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Oldest item.",
          priority: "medium",
          recommendedAction: "save_for_later",
          createdAt: "2026-03-14T10:00:00.000Z",
          status: "new"
        }
      ])
    );

    fetchMock.mockImplementation(async () => jsonResponse([]));
    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Newest workflow note.")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Last action" }));

    expect(window.localStorage.getItem("linkedin-brand-os:queue-sort")).toBe("lastAction");
  });

  it("ignores malformed queue preference values safely", async () => {
    window.localStorage.setItem("linkedin-brand-os:queue-filter", "bad-filter");
    window.localStorage.setItem("linkedin-brand-os:queue-sort", "bad-sort");
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-newest",
          signalText: "Newest workflow note.",
          bestAngle: "ownership_gap",
          reasoningSummary: "Newest item.",
          priority: "high",
          recommendedAction: "generate_comment",
          createdAt: "2026-03-14T14:00:00.000Z",
          status: "sent"
        },
        {
          id: "saved-oldest",
          signalText: "Oldest workflow note.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Oldest item.",
          priority: "medium",
          recommendedAction: "save_for_later",
          createdAt: "2026-03-14T10:00:00.000Z",
          status: "new"
        }
      ])
    );

    fetchMock.mockImplementation(async () => jsonResponse([]));
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Newest workflow note.")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /^All/ })).toHaveClass("bg-slate-900");
    expect(screen.getByRole("button", { name: "Newest" })).toHaveClass("bg-slate-900");
    const queueItems = screen
      .getAllByText(/workflow note\./)
      .map((element) => element.textContent);
    expect(queueItems).toEqual(["Newest workflow note.", "Oldest workflow note."]);
  });

  it("searches saved items by signal text case-insensitively", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-1",
          signalText: "Approval workflow note.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Operations issue.",
          priority: "medium",
          recommendedAction: "save_for_later",
          createdAt: "2026-03-14T12:00:00.000Z",
          status: "new"
        },
        {
          id: "saved-2",
          signalText: "Sales handoff issue.",
          bestAngle: "handoff_failure",
          reasoningSummary: "Revenue team friction.",
          priority: "high",
          recommendedAction: "generate_comment",
          createdAt: "2026-03-14T13:00:00.000Z",
          status: "sent"
        }
      ])
    );

    fetchMock.mockImplementation(async () => jsonResponse([]));
    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Approval workflow note.")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Search saved items"), "APPROVAL");

    expect(screen.getByText("Approval workflow note.")).toBeInTheDocument();
    expect(screen.queryByText("Sales handoff issue.")).not.toBeInTheDocument();
  });

  it("searches saved items by best angle", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-1",
          signalText: "Approval workflow note.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Operations issue.",
          priority: "medium",
          recommendedAction: "save_for_later",
          createdAt: "2026-03-14T12:00:00.000Z",
          status: "new"
        },
        {
          id: "saved-2",
          signalText: "Sales handoff issue.",
          bestAngle: "handoff_failure",
          reasoningSummary: "Revenue team friction.",
          priority: "high",
          recommendedAction: "generate_comment",
          createdAt: "2026-03-14T13:00:00.000Z",
          status: "sent"
        }
      ])
    );

    fetchMock.mockImplementation(async () => jsonResponse([]));
    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Approval workflow note.")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Search saved items"), "handoff");

    expect(screen.getByText("Sales handoff issue.")).toBeInTheDocument();
    expect(screen.queryByText("Approval workflow note.")).not.toBeInTheDocument();
  });

  it("searches saved items by reasoning summary", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-1",
          signalText: "Approval workflow note.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Operations issue.",
          priority: "medium",
          recommendedAction: "save_for_later",
          createdAt: "2026-03-14T12:00:00.000Z",
          status: "new"
        },
        {
          id: "saved-2",
          signalText: "Sales handoff issue.",
          bestAngle: "handoff_failure",
          reasoningSummary: "Revenue team friction.",
          priority: "high",
          recommendedAction: "generate_comment",
          createdAt: "2026-03-14T13:00:00.000Z",
          status: "sent"
        }
      ])
    );

    fetchMock.mockImplementation(async () => jsonResponse([]));
    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Approval workflow note.")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Search saved items"), "revenue");

    expect(screen.getByText("Sales handoff issue.")).toBeInTheDocument();
    expect(screen.queryByText("Approval workflow note.")).not.toBeInTheDocument();
  });

  it("searches only within the current filtered view", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-1",
          signalText: "Archived revenue note.",
          bestAngle: "operational_roi",
          reasoningSummary: "Revenue issue.",
          priority: "low",
          recommendedAction: "ignore",
          createdAt: "2026-03-14T12:00:00.000Z",
          status: "archived"
        },
        {
          id: "saved-2",
          signalText: "Active revenue note.",
          bestAngle: "ownership_gap",
          reasoningSummary: "Revenue issue.",
          priority: "high",
          recommendedAction: "generate_comment",
          createdAt: "2026-03-14T13:00:00.000Z",
          status: "sent"
        }
      ])
    );

    fetchMock.mockImplementation(async () => jsonResponse([]));
    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Archived revenue note.")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /^Archived/ }));
    await user.type(screen.getByLabelText("Search saved items"), "revenue");

    expect(screen.getByText("Archived revenue note.")).toBeInTheDocument();
    expect(screen.queryByText("Active revenue note.")).not.toBeInTheDocument();
  });

  it("keeps sorting active within search results", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-1",
          signalText: "Approval workflow note.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Approval issue.",
          priority: "medium",
          recommendedAction: "save_for_later",
          createdAt: "2026-03-14T10:00:00.000Z",
          status: "new"
        },
        {
          id: "saved-2",
          signalText: "Approval routing note.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Approval routing issue.",
          priority: "high",
          recommendedAction: "generate_comment",
          createdAt: "2026-03-14T14:00:00.000Z",
          status: "sent"
        }
      ])
    );

    fetchMock.mockImplementation(async () => jsonResponse([]));
    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Approval workflow note.")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Search saved items"), "approval");
    await user.click(screen.getByRole("button", { name: "Oldest" }));

    const queueItems = screen
      .getAllByText(/Approval .* note\./)
      .map((element) => element.textContent);

    expect(queueItems).toEqual(["Approval workflow note.", "Approval routing note."]);
  });

  it("renders a search-specific empty state safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-1",
          signalText: "Approval workflow note.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Approval issue.",
          priority: "medium",
          recommendedAction: "save_for_later",
          createdAt: "2026-03-14T10:00:00.000Z",
          status: "new"
        }
      ])
    );

    fetchMock.mockImplementation(async () => jsonResponse([]));
    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Approval workflow note.")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Search saved items"), "missing");

    expect(screen.getByText("No saved items match this search.")).toBeInTheDocument();
    expect(screen.queryByText("Approval workflow note.")).not.toBeInTheDocument();
  });

  it("clearing search restores the current filtered and sorted view", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-1",
          signalText: "Older active note.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Approval issue.",
          priority: "medium",
          recommendedAction: "save_for_later",
          createdAt: "2026-03-14T10:00:00.000Z",
          status: "sent"
        },
        {
          id: "saved-2",
          signalText: "Newer active note.",
          bestAngle: "ownership_gap",
          reasoningSummary: "Routing issue.",
          priority: "high",
          recommendedAction: "generate_comment",
          createdAt: "2026-03-14T14:00:00.000Z",
          status: "new"
        },
        {
          id: "saved-3",
          signalText: "Done note.",
          bestAngle: "operational_roi",
          reasoningSummary: "Closed issue.",
          priority: "medium",
          recommendedAction: "generate_post_candidate",
          createdAt: "2026-03-14T12:00:00.000Z",
          status: "done"
        }
      ])
    );

    fetchMock.mockImplementation(async () => jsonResponse([]));
    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Older active note.")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /^Active/ }));
    await user.click(screen.getByRole("button", { name: "Oldest" }));
    const searchInput = screen.getByLabelText("Search saved items");
    await user.type(searchInput, "older");

    expect(screen.getByText("Older active note.")).toBeInTheDocument();
    expect(screen.queryByText("Newer active note.")).not.toBeInTheDocument();

    await user.clear(searchInput);

    const queueItems = screen
      .getAllByText(/active note\./)
      .map((element) => element.textContent);

    expect(queueItems).toEqual(["Older active note.", "Newer active note."]);
    expect(screen.queryByText("Done note.")).not.toBeInTheDocument();
  });

  it("runs Audience Scout and can send a scout item to Source Intake", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/audience/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "scout-1",
                sourcePlatform: "public_web",
                sourceUrl: "https://public.example.com/audience/workflow-chaos",
                authorName: "Ops lead",
                authorRole: "COO",
                rawExcerpt:
                  "We still cannot tell who owns the workflow once the launch handoff happens.",
                painSignalSummary:
                  "COO teams are flagging broken handoffs after the initial launch phase.",
                whyItMatters:
                  "Broken handoffs create a strong operator lesson and usually translate cleanly into workflow-accountability content.",
                suggestedActionType: "post_candidate",
                topicCluster: "Workflow Chaos",
                confidence: "high",
                signalStrength: "strong",
                scoreNotes: ["Clear operational pain", "Specific workflow consequence"],
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 audience signals shortlisted: 1 broader post angles and 0 discussion opportunities.",
            notes: "Audience Scout is a review-first shortlist."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Audience Scout")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Target topics"), "workflow chaos");
    await user.type(screen.getByLabelText("Target roles"), "COO");
    await user.type(screen.getByLabelText("Target keywords"), "handoff");
    await user.click(screen.getByRole("button", { name: "Run Audience Scout" }));

    await waitFor(() => {
      expect(
        screen.getByText("COO teams are flagging broken handoffs after the initial launch phase.")
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Send to Source Intake" }));

    expect(screen.getByLabelText("Intake source type")).toHaveValue("manual_research");
    expect(screen.getByLabelText("Intake target role/title")).toHaveValue("COO");
    expect(screen.getByLabelText("Intake summary / notes")).toHaveValue(
      "We still cannot tell who owns the workflow once the launch handoff happens."
    );
    expect(screen.getByText("Sent scout item to Source Intake.")).toBeInTheDocument();
  });

  it("renders audience scout strength badges and a compact score note safely", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/audience/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "scout-strong",
                sourcePlatform: "public_web",
                rawExcerpt: "Nobody owns the approval handoff after rollout.",
                painSignalSummary: "Operators are flagging broken handoffs after launch.",
                whyItMatters: "This shows workflow-accountability pain in live operations.",
                suggestedActionType: "post_candidate",
                topicCluster: "Broken Handoff",
                confidence: "high",
                signalStrength: "strong",
                scoreNotes: ["Clear operational pain", "Specific workflow consequence"],
                createdAt: "2026-03-15T00:00:00.000Z"
              },
              {
                id: "scout-weak",
                sourcePlatform: "public_web",
                rawExcerpt: "Interesting AI chatter.",
                painSignalSummary: "Broad discussion signal.",
                whyItMatters: "Still broad.",
                suggestedActionType: "later",
                confidence: "low",
                signalStrength: "weak",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "2 audience signals shortlisted.",
            notes: "Audience Scout is a review-first shortlist."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Audience Scout")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Target topics"), "handoff");
    await user.click(screen.getByRole("button", { name: "Run Audience Scout" }));

    await waitFor(() =>
      expect(
        screen.getAllByText("Operators are flagging broken handoffs after launch.").length
      ).toBeGreaterThan(0)
    );

    expect(screen.getByText("Strong")).toBeInTheDocument();
    expect(screen.getByText("Weak")).toBeInTheDocument();
    expect(screen.getByText("Why this scored well: Clear operational pain")).toBeInTheDocument();
  });

  it("can save a scout item for later without breaking the existing queue", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/audience/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "scout-2",
                sourcePlatform: "public_web",
                rawExcerpt:
                  "We keep answering the same support question because the workflow is confusing in real conditions.",
                painSignalSummary:
                  "Operator-led teams keep surfacing recurring support friction around the workflow.",
                whyItMatters:
                  "This is usually better as an engagement-first opportunity because operators react to lived support pain in public threads.",
                suggestedActionType: "comment_opportunity",
                topicCluster: "Support Friction",
                confidence: "medium",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 audience signals shortlisted: 0 broader post angles and 1 discussion opportunities.",
            notes: "Audience Scout is a review-first shortlist."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Audience Scout")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Target topics"), "support friction");
    await user.click(screen.getByRole("button", { name: "Run Audience Scout" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Operator-led teams keep surfacing recurring support friction around the workflow."
        )
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Save for later" }));

    expect(
      screen.getAllByText(
        "Operator-led teams keep surfacing recurring support friction around the workflow."
      ).length
    ).toBeGreaterThan(0);
    expect(screen.getByText("Saved scout item for later.")).toBeInTheDocument();
  });

  it("can send a scout item into Decision Planner safely", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/audience/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "scout-3",
                sourcePlatform: "public_web",
                authorRole: "RevOps lead",
                rawExcerpt:
                  "We still cannot see where the workflow is stuck until something breaks.",
                painSignalSummary:
                  "RevOps lead teams are calling out operational visibility gaps in day-to-day execution.",
                whyItMatters:
                  "Visibility pain is useful for both thought leadership and direct replies because it maps to a clear operational consequence.",
                suggestedActionType: "reply_opportunity",
                topicCluster: "Operational Visibility",
                confidence: "medium",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 audience signals shortlisted: 0 broader post angles and 1 discussion opportunities.",
            notes: "Audience Scout is a review-first shortlist."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Audience Scout")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Target topics"), "operational visibility");
    await user.click(screen.getByRole("button", { name: "Run Audience Scout" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "RevOps lead teams are calling out operational visibility gaps in day-to-day execution."
        )
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Send to Decision Planner" }));

    expect(screen.getByLabelText("Decision signal text")).toHaveValue(
      "RevOps lead teams are calling out operational visibility gaps in day-to-day execution."
    );
    expect(screen.getByLabelText("Decision source type")).toHaveValue("commentary");
    expect(screen.getByLabelText("Decision target role/title")).toHaveValue("RevOps lead");
    expect(screen.getByLabelText("Optional best angle")).toHaveValue("exception_handling");
    expect(screen.getByText("Sent scout item to Decision Planner.")).toBeInTheDocument();
  });

  it("supports public excerpt ingestion and preserves source context in scout results", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/audience/scout") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        expect(body.publicInputs).toEqual([
          {
            sourceLabel: "LinkedIn thread",
            sourceUrl: "https://linkedin.example/posts/ops-1",
            excerpt:
              "We still patch launch handoffs in spreadsheets because nobody owns the workflow after rollout."
          }
        ]);

        return jsonResponse(
          {
            items: [
              {
                id: "scout-public-1",
                sourcePlatform: "public_web",
                sourceLabel: "LinkedIn thread",
                sourceUrl: "https://linkedin.example/posts/ops-1",
                authorRole: "COO",
                rawExcerpt:
                  "We still patch launch handoffs in spreadsheets because nobody owns the workflow after rollout.",
                painSignalSummary:
                  "COO teams are describing broken handoffs and missing ownership in public threads.",
                whyItMatters:
                  "The excerpt signals a handoff and ownership problem that usually translates well into workflow-accountability content.",
                suggestedActionType: "post_candidate",
                topicCluster: "Broken Handoff",
                confidence: "high",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 audience signals shortlisted: 1 broader post angles and 0 discussion opportunities.",
            notes: "Audience Scout is a review-first shortlist. Public URLs are preserved as context only."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Audience Scout")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Public source label"), "LinkedIn thread");
    await user.type(
      screen.getByLabelText("Public source URL"),
      "https://linkedin.example/posts/ops-1"
    );
    await user.type(
      screen.getByLabelText("Public excerpt"),
      "We still patch launch handoffs in spreadsheets because nobody owns the workflow after rollout."
    );
    await user.click(screen.getByRole("button", { name: "Run Audience Scout" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "COO teams are describing broken handoffs and missing ownership in public threads."
        )
      ).toBeInTheDocument();
    });

    expect(screen.getByText(/public_web .*LinkedIn thread/i)).toBeInTheDocument();
    expect(screen.getByText("https://linkedin.example/posts/ops-1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Send to Source Intake" }));

    expect(screen.getByLabelText("Intake source URL")).toHaveValue(
      "https://linkedin.example/posts/ops-1"
    );
    expect(screen.getByLabelText("Intake summary / notes")).toHaveValue(
      "We still patch launch handoffs in spreadsheets because nobody owns the workflow after rollout."
    );
  });

  it("can save an excerpt-driven scout item for later safely", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/audience/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "scout-public-2",
                sourcePlatform: "public_web",
                sourceLabel: "Community note",
                rawExcerpt:
                  "We keep answering the same support question because the workflow is confusing in real conditions.",
                painSignalSummary:
                  "Operator-led teams are surfacing recurring support friction in public discussions.",
                whyItMatters:
                  "The excerpt shows lived support pain, which is usually stronger as a comment opportunity than a broad top-of-funnel post.",
                suggestedActionType: "comment_opportunity",
                topicCluster: "Support Friction",
                confidence: "medium",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 audience signals shortlisted: 0 broader post angles and 1 discussion opportunities.",
            notes: "Audience Scout is a review-first shortlist."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Audience Scout")).toBeInTheDocument();
    });

    await user.type(
      screen.getByLabelText("Public excerpt"),
      "We keep answering the same support question because the workflow is confusing in real conditions."
    );
    await user.click(screen.getByRole("button", { name: "Run Audience Scout" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Operator-led teams are surfacing recurring support friction in public discussions."
        )
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Save for later" }));

    expect(
      screen.getAllByText(
        "Operator-led teams are surfacing recurring support friction in public discussions."
      ).length
    ).toBeGreaterThan(0);
  });

  it("can send an excerpt-driven scout item into Decision Planner safely", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/audience/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "scout-public-3",
                sourcePlatform: "public_web",
                authorRole: "RevOps lead",
                rawExcerpt:
                  "We still cannot see where the workflow is stuck until something breaks.",
                painSignalSummary:
                  "RevOps lead teams are calling out operational visibility gaps in public execution threads.",
                whyItMatters:
                  "The excerpt points to visibility gaps in live operations, which often work well as direct replies or tactical discussion hooks.",
                suggestedActionType: "reply_opportunity",
                topicCluster: "Operational Visibility",
                confidence: "medium",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 audience signals shortlisted: 0 broader post angles and 1 discussion opportunities.",
            notes: "Audience Scout is a review-first shortlist."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Audience Scout")).toBeInTheDocument();
    });

    await user.type(
      screen.getByLabelText("Public excerpt"),
      "We still cannot see where the workflow is stuck until something breaks."
    );
    await user.click(screen.getByRole("button", { name: "Run Audience Scout" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "RevOps lead teams are calling out operational visibility gaps in public execution threads."
        )
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Send to Decision Planner" }));

    expect(screen.getByLabelText("Decision signal text")).toHaveValue(
      "RevOps lead teams are calling out operational visibility gaps in public execution threads."
    );
    expect(screen.getByLabelText("Decision source type")).toHaveValue("commentary");
  });

  it("runs a batch audience scout feed and reuses existing audience handoffs safely", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/scout/feed") && method === "POST") {
        return jsonResponse(
          {
            audienceItems: [
              {
                id: "feed-aud-1",
                sourcePlatform: "public_web",
                rawExcerpt: "We still patch launch handoffs manually.",
                painSignalSummary: "Operators are still patching launch handoffs manually.",
                whyItMatters: "This exposes workflow-accountability pain.",
                suggestedActionType: "post_candidate",
                topicCluster: "Broken Handoff",
                confidence: "high",
                adapterSummary: {
                  family: "public_discussion",
                  usedDeterministicFallback: false,
                  compactLabel: "Routed as public discussion."
                },
                createdAt: "2026-03-15T00:00:00.000Z"
              },
              {
                id: "feed-aud-2",
                sourcePlatform: "public_web",
                rawExcerpt: "Support keeps answering the same workflow question.",
                painSignalSummary: "Operators keep surfacing support friction in the workflow.",
                whyItMatters: "This is useful engagement-first material.",
                suggestedActionType: "comment_opportunity",
                topicCluster: "Support Friction",
                confidence: "medium",
                adapterSummary: {
                  family: "public_discussion",
                  usedDeterministicFallback: false,
                  compactLabel: "Routed as public discussion."
                },
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "2 scout feed items processed: 2 audience and 0 solution signals.",
            audienceAdapterSummary: {
              families: ["public_discussion"],
              usedDeterministicFallback: false,
              compactLabel: "Routed as public discussion."
            },
            notes: "Scout Feed stays review-first."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Scout Feed")).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText("Feed mode"), "audience");
    await user.type(
      screen.getByLabelText("Batch feed entries"),
      "We still patch launch handoffs manually.\n\nSupport keeps answering the same workflow question."
    );
    await user.click(screen.getByRole("button", { name: "Run Scout Feed" }));

    await waitFor(() => {
      expect(screen.getByText("2 scout feed items processed: 2 audience and 0 solution signals.")).toBeInTheDocument();
      expect(screen.getByText("Operators are still patching launch handoffs manually.")).toBeInTheDocument();
    });

    const audienceSection = screen.getByText("Audience Scout").closest("section");
    expect(audienceSection).not.toBeNull();
    expect(
      within(audienceSection as HTMLElement).getByText("Audience routed as public discussion.")
    ).toBeInTheDocument();
    expect(within(audienceSection as HTMLElement).getAllByText("Public discussion").length).toBeGreaterThan(0);

    await user.click(
      within(audienceSection as HTMLElement).getAllByRole("button", { name: "Send to Source Intake" })[0]!
    );

    expect(screen.getByLabelText("Intake source type")).toHaveValue("manual_research");
    expect(screen.getByLabelText("Intake title")).toHaveValue(
      "Operators are still patching launch handoffs manually"
    );
  });

  it("runs a mixed scout feed and can build scout matches from the resulting items", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/scout/feed") && method === "POST") {
        return jsonResponse(
          {
            audienceItems: [
              {
                id: "feed-aud-1",
                sourcePlatform: "public_web",
                rawExcerpt: "Nobody owns recovery once the workflow breaks.",
                painSignalSummary: "Operators are describing stalled recovery pain.",
                whyItMatters: "This exposes resilience pain.",
                suggestedActionType: "reply_opportunity",
                topicCluster: "Workflow Pain",
                confidence: "medium",
                adapterSummary: {
                  family: "public_discussion",
                  usedDeterministicFallback: false,
                  compactLabel: "Routed as public discussion."
                },
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            solutionItems: [
              {
                id: "feed-sol-1",
                sourceType: "manual_research",
                rawExcerpt: "Make recovery ownership visible before the workflow hits its first failure path.",
                solutionPattern: "Exception and recovery pattern",
                implementationLesson: "Make recovery ownership visible before the workflow hits its first failure path.",
                tradeoffOrConstraint: "Recovery guardrails add reliability, but they add complexity.",
                whyItMatters: "Useful resilience lesson.",
                suggestedAngle: "exception_handling",
                suggestedActionType: "reply_opportunity",
                confidence: "high",
                adapterSummary: {
                  family: "manual_feed",
                  usedDeterministicFallback: false,
                  compactLabel: "Routed as manual feed."
                },
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "2 scout feed items processed: 1 audience and 1 solution signals.",
            audienceAdapterSummary: {
              families: ["public_discussion"],
              usedDeterministicFallback: false,
              compactLabel: "Routed as public discussion."
            },
            solutionAdapterSummary: {
              families: ["manual_feed"],
              usedDeterministicFallback: false,
              compactLabel: "Routed as manual feed."
            },
            notes: "Scout Feed stays review-first."
          },
          201
        );
      }

      if (url.endsWith("/scout/match") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "match-feed-1",
                audienceItemId: "feed-aud-1",
                solutionItemId: "feed-sol-1",
                matchedPain: "Operators are describing stalled recovery pain.",
                matchedSolutionPattern: "Exception and recovery pattern",
                whyThisMatchWorks: "The solution addresses the same stalled recovery pain surfaced in the audience signal.",
                suggestedAngle: "exception_handling",
                recommendedAction: "write_reply",
                confidence: "high",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 matched pain-to-solution opportunities shortlisted.",
            notes: "Scout matches stay review-first."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Scout Feed")).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText("Feed mode"), "mixed");
    await user.type(
      screen.getByLabelText("Batch feed entries"),
      "Nobody owns recovery once the workflow breaks.\n\nMake recovery ownership visible before the workflow hits its first failure path."
    );
    await user.click(screen.getByRole("button", { name: "Run Scout Feed" }));

    await waitFor(() => {
      expect(screen.getByText("2 scout feed items processed: 1 audience and 1 solution signals.")).toBeInTheDocument();
    });
    const mixedAudienceSection = screen.getByText("Audience Scout").closest("section");
    const mixedSolutionSection = screen.getByText("Solution Scout").closest("section");
    expect(mixedAudienceSection).not.toBeNull();
    expect(mixedSolutionSection).not.toBeNull();
    expect(
      within(mixedAudienceSection as HTMLElement).getByText("Audience routed as public discussion.")
    ).toBeInTheDocument();
    expect(
      within(mixedSolutionSection as HTMLElement).getByText("Solution routed as manual feed.")
    ).toBeInTheDocument();
    expect(within(mixedAudienceSection as HTMLElement).getByText("Public discussion")).toBeInTheDocument();
    expect(within(mixedSolutionSection as HTMLElement).getByText("Manual feed")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Build Scout Matches" }));

    await waitFor(() => {
      expect(screen.getByText("1 matched pain-to-solution opportunities shortlisted.")).toBeInTheDocument();
      expect(screen.getAllByText("Operators are describing stalled recovery pain.").length).toBeGreaterThan(0);
    });
  });

  it("shows a compact GitHub adapter note in the Scout Feed summary", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/scout/feed") && method === "POST") {
        return jsonResponse(
          {
            solutionItems: [
              {
                id: "feed-sol-1",
                sourceType: "github",
                rawExcerpt: "Expose status and ownership before recovery stalls.",
                solutionPattern: "Visibility and coordination pattern",
                implementationLesson: "Make ownership visible earlier in the recovery path.",
                tradeoffOrConstraint: "Adds workflow overhead.",
                whyItMatters: "Useful GitHub-derived lesson.",
                suggestedAngle: "workflow_accountability",
                suggestedActionType: "post_candidate",
                confidence: "high",
                adapterSummary: {
                  family: "github_snapshot",
                  usedDeterministicFallback: false,
                  compactLabel: "Routed as GitHub snapshot."
                },
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 scout feed items processed: 0 audience and 1 solution signals.",
            adapterSummary: {
              families: ["github_snapshot"],
              usedDeterministicFallback: false,
              compactLabel: "Routed as GitHub snapshot."
            },
            solutionAdapterSummary: {
              families: ["github_snapshot"],
              usedDeterministicFallback: false,
              compactLabel: "Routed as GitHub snapshot."
            },
            notes: "Scout Feed stays review-first."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Scout Feed")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Feed mode"), "solution");
    await user.selectOptions(screen.getByLabelText("Feed solution source type"), "github");
    await user.type(screen.getByLabelText("Batch feed entries"), "Expose status and ownership before recovery stalls.");
    await user.click(screen.getByRole("button", { name: "Run Scout Feed" }));

    await waitFor(() => {
      expect(screen.getByText("Routed as GitHub snapshot.")).toBeInTheDocument();
    });
    const solutionSection = screen.getByText("Solution Scout").closest("section");
    expect(solutionSection).not.toBeNull();
    expect(
      within(solutionSection as HTMLElement).getByText("Solution routed as GitHub snapshot.")
    ).toBeInTheDocument();
    expect(within(solutionSection as HTMLElement).getByText("GitHub snapshot")).toBeInTheDocument();
  });

  it("shows a compact article adapter note in the Scout Feed summary", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/scout/feed") && method === "POST") {
        return jsonResponse(
          {
            solutionItems: [
              {
                id: "feed-sol-1",
                sourceType: "article",
                rawExcerpt: "Document the recovery path before the first customer incident.",
                solutionPattern: "Recovery path pattern",
                implementationLesson: "Document the recovery path earlier.",
                tradeoffOrConstraint: "Adds process work.",
                whyItMatters: "Useful article-derived lesson.",
                suggestedAngle: "exception_handling",
                suggestedActionType: "post_candidate",
                confidence: "high",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 scout feed items processed: 0 audience and 1 solution signals.",
            adapterSummary: {
              families: ["article_snapshot"],
              usedDeterministicFallback: false,
              compactLabel: "Routed as article snapshot."
            },
            notes: "Scout Feed stays review-first."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Scout Feed")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Feed mode"), "solution");
    await user.selectOptions(screen.getByLabelText("Feed solution source type"), "article");
    await user.type(screen.getByLabelText("Batch feed entries"), "Document the recovery path before the first customer incident.");
    await user.click(screen.getByRole("button", { name: "Run Scout Feed" }));

    await waitFor(() => {
      expect(screen.getByText("Routed as article snapshot.")).toBeInTheDocument();
    });
  });

  it("shows a compact public-discussion adapter note in the Scout Feed summary", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/scout/feed") && method === "POST") {
        return jsonResponse(
          {
            audienceItems: [
              {
                id: "feed-aud-1",
                sourcePlatform: "public_web",
                rawExcerpt: "Operators keep surfacing support friction in the workflow.",
                painSignalSummary: "Operators keep surfacing support friction in the workflow.",
                whyItMatters: "This is useful discussion material.",
                suggestedActionType: "comment_opportunity",
                topicCluster: "Support Friction",
                confidence: "medium",
                adapterSummary: {
                  family: "public_discussion",
                  usedDeterministicFallback: false,
                  compactLabel: "Routed as public discussion."
                },
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 scout feed items processed: 1 audience and 0 solution signals.",
            adapterSummary: {
              families: ["public_discussion"],
              usedDeterministicFallback: false,
              compactLabel: "Routed as public discussion."
            },
            audienceAdapterSummary: {
              families: ["public_discussion"],
              usedDeterministicFallback: false,
              compactLabel: "Routed as public discussion."
            },
            notes: "Scout Feed stays review-first."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Scout Feed")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Feed mode"), "audience");
    await user.type(screen.getByLabelText("Batch feed entries"), "Operators keep surfacing support friction in the workflow.");
    await user.click(screen.getByRole("button", { name: "Run Scout Feed" }));

    await waitFor(() => {
      expect(screen.getByText("Routed as public discussion.")).toBeInTheDocument();
    });
    const audienceSection = screen.getByText("Audience Scout").closest("section");
    expect(audienceSection).not.toBeNull();
    expect(
      within(audienceSection as HTMLElement).getByText("Audience routed as public discussion.")
    ).toBeInTheDocument();
    expect(within(audienceSection as HTMLElement).getByText("Public discussion")).toBeInTheDocument();
  });

  it("shows a compact deterministic fallback note in the Scout Feed summary", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/scout/feed") && method === "POST") {
        return jsonResponse(
          {
            audienceItems: [
              {
                id: "feed-aud-1",
                sourcePlatform: "public_web",
                rawExcerpt: "Ambiguous signal text.",
                painSignalSummary: "Ambiguous signal text.",
                whyItMatters: "Fallback-safe discussion material.",
                suggestedActionType: "comment_opportunity",
                topicCluster: "Ambiguous",
                confidence: "medium",
                adapterSummary: {
                  family: "public_discussion",
                  usedDeterministicFallback: true,
                  compactLabel: "Routed as public discussion."
                },
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 scout feed items processed: 1 audience and 0 solution signals.",
            adapterSummary: {
              families: ["public_discussion"],
              usedDeterministicFallback: true,
              compactLabel: "Routed as public discussion."
            },
            audienceAdapterSummary: {
              families: ["public_discussion"],
              usedDeterministicFallback: true,
              compactLabel: "Routed as public discussion."
            },
            notes: "Scout Feed stays review-first."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Scout Feed")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Feed mode"), "mixed");
    await user.type(screen.getByLabelText("Batch feed entries"), "Ambiguous signal text.");
    await user.click(screen.getByRole("button", { name: "Run Scout Feed" }));

    await waitFor(() => {
      expect(
        screen.getByText("Routed as public discussion. Used deterministic fallback.")
      ).toBeInTheDocument();
    });
    const fallbackAudienceSection = screen.getByText("Audience Scout").closest("section");
    expect(fallbackAudienceSection).not.toBeNull();
    expect(
      within(fallbackAudienceSection as HTMLElement).getByText(
        "Audience routed as public discussion. Used deterministic fallback."
      )
    ).toBeInTheDocument();
    expect(
      within(fallbackAudienceSection as HTMLElement).getByText(
        "Public discussion · Deterministic fallback"
      )
    ).toBeInTheDocument();
  });

  it("keeps Scout Feed adapter notes quiet when no useful adapter note is available", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/scout/feed") && method === "POST") {
        return jsonResponse(
          {
            audienceItems: [
              {
                id: "feed-aud-1",
                sourcePlatform: "public_web",
                rawExcerpt: "General signal text.",
                painSignalSummary: "General signal text.",
                whyItMatters: "Review-first discussion material.",
                suggestedActionType: "comment_opportunity",
                topicCluster: "General",
                confidence: "medium",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 scout feed items processed: 1 audience and 0 solution signals.",
            notes: "Scout Feed stays review-first."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Scout Feed")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Feed mode"), "audience");
    await user.type(screen.getByLabelText("Batch feed entries"), "General signal text.");
    await user.click(screen.getByRole("button", { name: "Run Scout Feed" }));

    await waitFor(() => {
      expect(screen.getByText("1 scout feed items processed: 1 audience and 0 solution signals.")).toBeInTheDocument();
    });

    expect(screen.queryByText("Routed as GitHub snapshot.")).not.toBeInTheDocument();
    expect(screen.queryByText("Routed as article snapshot.")).not.toBeInTheDocument();
    expect(screen.queryByText("Routed as public discussion.")).not.toBeInTheDocument();
    expect(screen.queryByText("Used deterministic fallback.")).not.toBeInTheDocument();
  });

  it("runs Solution Scout and can send a solution item to Source Intake", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/solutions/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "solution-1",
                sourceType: "github",
                sourceLabel: "GitHub release",
                sourceUrl: "https://github.com/example/repo/releases/tag/v1.2.0",
                rawExcerpt:
                  "The release adds approval-state visibility and retry ownership so teams can recover stalled workflows faster.",
                solutionPattern: "Visibility and coordination pattern",
                implementationLesson:
                  "Expose status and ownership early so operators can intervene before work stalls.",
                tradeoffOrConstraint:
                  "Visibility helps coordination, but it can create noise if ownership is still undefined.",
                whyItMatters:
                  "This gives the operator a strong way to explain why visibility and coordination matter before work breaks.",
                suggestedAngle: "workflow_accountability",
                suggestedActionType: "post_candidate",
                confidence: "high",
                signalStrength: "strong",
                scoreNotes: ["Concrete implementation lesson", "Tradeoff is explicit"],
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 solution pattern shortlisted for review.",
            notes: "Solution Scout is review-first."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Solution Scout")).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Solution source type"), "github");
    await user.type(screen.getByLabelText("Solution target problem"), "workflow handoff failures");
    await user.type(screen.getByLabelText("Solution source label"), "GitHub release");
    await user.type(
      screen.getByLabelText("Solution source URL"),
      "https://github.com/example/repo/releases/tag/v1.2.0"
    );
    await user.type(
      screen.getByLabelText("Solution source excerpt"),
      "The release adds approval-state visibility and retry ownership so teams can recover stalled workflows faster."
    );
    await user.click(screen.getByRole("button", { name: "Run Solution Scout" }));

    await waitFor(() => {
      expect(screen.getByText("Visibility and coordination pattern")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Send to Source Intake" }));

    expect(screen.getByLabelText("Intake source type")).toHaveValue("github");
    expect(screen.getByLabelText("Intake source URL")).toHaveValue(
      "https://github.com/example/repo/releases/tag/v1.2.0"
    );
    expect(screen.getByText("Sent solution item to Source Intake.")).toBeInTheDocument();
  });

  it("renders solution scout strength badges and keeps missing notes quiet", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/solutions/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "solution-strong",
                sourceType: "github",
                rawExcerpt: "Adds retry ownership and visibility for stalled approvals.",
                solutionPattern: "Visibility and coordination pattern",
                implementationLesson:
                  "Expose status and ownership early so operators can intervene before work stalls.",
                tradeoffOrConstraint:
                  "Visibility helps coordination, but it can create noise if ownership is still undefined.",
                whyItMatters: "Useful operator lesson.",
                suggestedAngle: "workflow_accountability",
                suggestedActionType: "post_candidate",
                confidence: "high",
                signalStrength: "strong",
                scoreNotes: ["Concrete implementation lesson", "Tradeoff is explicit"],
                createdAt: "2026-03-15T00:00:00.000Z"
              },
              {
                id: "solution-medium",
                sourceType: "manual_research",
                rawExcerpt: "Operators simplified onboarding.",
                solutionPattern: "Adoption and rollout pattern",
                implementationLesson: "Ship enablement discipline alongside the feature.",
                tradeoffOrConstraint: "Needs more structured rollout work.",
                whyItMatters: "Useful but still moderate.",
                suggestedAngle: "operational_roi",
                suggestedActionType: "comment_opportunity",
                confidence: "medium",
                signalStrength: "medium",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "2 solution patterns shortlisted for review.",
            notes: "Solution Scout is review-first."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Solution Scout")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Solution source excerpt"), "Adds retry ownership.");
    await user.click(screen.getByRole("button", { name: "Run Solution Scout" }));

    await waitFor(() =>
      expect(screen.getAllByText("Visibility and coordination pattern").length).toBeGreaterThan(0)
    );

    expect(screen.getByText("Strong")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(
      screen.getByText("Why this scored well: Concrete implementation lesson")
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Why this scored well:/)).toHaveLength(1);
  });

  it("can save a solution item for later without breaking the existing queue", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/solutions/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "solution-2",
                sourceType: "article",
                sourceLabel: "Case study",
                rawExcerpt:
                  "The team reduced support escalations by simplifying the workflow, but they had to add more up-front implementation clarity.",
                solutionPattern: "Support-friction reduction pattern",
                implementationLesson:
                  "Reduce support load by making the real workflow legible in the product, not just in docs.",
                tradeoffOrConstraint:
                  "Reducing friction often requires extra product clarity and implementation effort up front.",
                whyItMatters:
                  "This is useful because it connects product clarity to lower support drag and cleaner execution.",
                suggestedAngle: "handoff_failure",
                suggestedActionType: "comment_opportunity",
                confidence: "medium",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 solution pattern shortlisted for review.",
            notes: "Solution Scout is review-first."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Solution Scout")).toBeInTheDocument();
    });

    await user.type(
      screen.getByLabelText("Solution source excerpt"),
      "The team reduced support escalations by simplifying the workflow, but they had to add more up-front implementation clarity."
    );
    await user.click(screen.getByRole("button", { name: "Run Solution Scout" }));

    await waitFor(() => {
      expect(screen.getByText("Support-friction reduction pattern")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Save for later" }));

    expect(
      screen.getAllByText(
        "Reduce support load by making the real workflow legible in the product, not just in docs."
      ).length
    ).toBeGreaterThan(0);
    expect(screen.getByText("Saved solution item for later.")).toBeInTheDocument();
  });

  it("can send a solution item into Decision Planner safely", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/solutions/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "solution-3",
                sourceType: "manual_research",
                sourceLabel: "Operator interview",
                rawExcerpt:
                  "Operators stabilized the workflow only after giving one owner a visible recovery path for stalled approvals.",
                solutionPattern: "Exception and recovery pattern",
                implementationLesson:
                  "Make recovery ownership visible before the workflow hits its first failure path.",
                tradeoffOrConstraint:
                  "Recovery guardrails add reliability, but they also add operational complexity to maintain.",
                whyItMatters:
                  "This gives the operator a concrete resilience lesson about failures, retries, and visible recovery paths.",
                suggestedAngle: "exception_handling",
                suggestedActionType: "reply_opportunity",
                confidence: "high",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 solution pattern shortlisted for review.",
            notes: "Solution Scout is review-first."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Solution Scout")).toBeInTheDocument();
    });

    await user.type(
      screen.getByLabelText("Solution source excerpt"),
      "Operators stabilized the workflow only after giving one owner a visible recovery path for stalled approvals."
    );
    await user.click(screen.getByRole("button", { name: "Run Solution Scout" }));

    await waitFor(() => {
      expect(screen.getByText("Exception and recovery pattern")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Send to Decision Planner" }));

    expect(screen.getByLabelText("Decision signal text")).toHaveValue(
      "Make recovery ownership visible before the workflow hits its first failure path."
    );
    expect(screen.getByLabelText("Decision source type")).toHaveValue("manual");
    expect(screen.getByLabelText("Optional best angle")).toHaveValue("exception_handling");
    expect(screen.getByText("Sent solution item to Decision Planner.")).toBeInTheDocument();
  });

  it("matches scout items and can send a matched opportunity to Source Intake", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/audience/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "aud-1",
                sourcePlatform: "public_web",
                rawExcerpt: "We still patch the workflow by hand because nobody owns the handoff after launch.",
                painSignalSummary: "Operators are flagging broken handoffs after launch.",
                whyItMatters: "This shows workflow-accountability pain in live operations.",
                suggestedActionType: "post_candidate",
                topicCluster: "Broken Handoff",
                confidence: "high",
                signalStrength: "strong",
                scoreNotes: ["Clear operational pain"],
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 audience signal shortlisted.",
            notes: "Audience Scout is review-first."
          },
          201
        );
      }

      if (url.endsWith("/solutions/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
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
                signalStrength: "strong",
                scoreNotes: ["Concrete implementation lesson"],
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 solution pattern shortlisted for review.",
            notes: "Solution Scout is review-first."
          },
          201
        );
      }

      if (url.endsWith("/scout/match") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "match-aud-1-sol-1",
                audienceItemId: "aud-1",
                solutionItemId: "sol-1",
                matchedPain: "Operators are flagging broken handoffs after launch.",
                matchedSolutionPattern: "Visibility and coordination pattern",
                whyThisMatchWorks:
                  "Visibility and coordination pattern addresses the same operator problem surfaced in \"Operators are flagging broken handoffs after launch.\". This is most usable as write post.",
                suggestedAngle: "workflow_accountability",
                recommendedAction: "write_post",
                confidence: "high",
                opportunityStrength: "strong",
                scoreNotes: ["High keyword overlap", "Both sides are actionable"],
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 matched pain-to-solution opportunities shortlisted.",
            notes: "Scout matches stay review-first."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Audience Scout")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Target topics"), "workflow chaos");
    await user.click(screen.getByRole("button", { name: "Run Audience Scout" }));
    await waitFor(() =>
      expect(
        screen.getAllByText("Operators are flagging broken handoffs after launch.").length
      ).toBeGreaterThan(0)
    );

    await user.type(
      screen.getByLabelText("Solution source excerpt"),
      "The release exposes status and ownership so teams can recover stalled workflows faster."
    );
    await user.click(screen.getByRole("button", { name: "Run Solution Scout" }));
    await waitFor(() =>
      expect(screen.getByText("Visibility and coordination pattern")).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Build Scout Matches" }));
    await waitFor(() =>
      expect(screen.getByText("1 matched pain-to-solution opportunities shortlisted.")).toBeInTheDocument()
    );

    const matchCard = screen
      .getByText("1 matched pain-to-solution opportunities shortlisted.")
      .closest("div");
    expect(matchCard).not.toBeNull();

    await user.click(within(matchCard as HTMLElement).getByRole("button", { name: "Send to Source Intake" }));

    expect(screen.getByLabelText("Intake source type")).toHaveValue("manual_research");
    expect(screen.getByLabelText("Intake title")).toHaveValue(
      "Operators are flagging broken handoffs after launch"
    );
    expect(screen.getByLabelText("Intake summary / notes")).toHaveValue(
      "Operators are flagging broken handoffs after launch."
    );
    expect(
      (screen.getByLabelText("Intake operator notes") as HTMLTextAreaElement).value
    ).toContain("Visibility and coordination pattern");
  });

  it("renders match strength badges and a compact score note safely", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/audience/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "aud-1",
                sourcePlatform: "public_web",
                rawExcerpt: "Nobody owns the handoff after launch.",
                painSignalSummary: "Operators are flagging broken handoffs after launch.",
                whyItMatters: "This shows workflow-accountability pain in live operations.",
                suggestedActionType: "post_candidate",
                topicCluster: "Broken Handoff",
                confidence: "high",
                signalStrength: "strong",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 audience signal shortlisted.",
            notes: "Audience Scout is review-first."
          },
          201
        );
      }

      if (url.endsWith("/solutions/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "sol-1",
                sourceType: "github",
                rawExcerpt: "Expose status and ownership early.",
                solutionPattern: "Visibility and coordination pattern",
                implementationLesson: "Expose status and ownership early so operators can intervene before work stalls.",
                tradeoffOrConstraint: "Visibility helps coordination, but it can create noise if ownership is still undefined.",
                whyItMatters: "Useful operator lesson.",
                suggestedAngle: "workflow_accountability",
                suggestedActionType: "post_candidate",
                confidence: "high",
                signalStrength: "strong",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 solution pattern shortlisted for review.",
            notes: "Solution Scout is review-first."
          },
          201
        );
      }

      if (url.endsWith("/scout/match") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "match-1",
                audienceItemId: "aud-1",
                solutionItemId: "sol-1",
                matchedPain: "Operators are flagging broken handoffs after launch.",
                matchedSolutionPattern: "Visibility and coordination pattern",
                whyThisMatchWorks: "Visibility and coordination pattern addresses the same operator problem surfaced in the audience item.",
                suggestedAngle: "workflow_accountability",
                recommendedAction: "write_post",
                confidence: "high",
                opportunityStrength: "strong",
                scoreNotes: ["High keyword overlap", "Both sides are actionable"],
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 matched pain-to-solution opportunities shortlisted.",
            notes: "Scout matches stay review-first."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Audience Scout")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Target topics"), "handoff");
    await user.click(screen.getByRole("button", { name: "Run Audience Scout" }));
    await waitFor(() =>
      expect(
        screen.getAllByText("Operators are flagging broken handoffs after launch.").length
      ).toBeGreaterThan(0)
    );

    await user.type(screen.getByLabelText("Solution source excerpt"), "Expose status and ownership early.");
    await user.click(screen.getByRole("button", { name: "Run Solution Scout" }));
    await waitFor(() =>
      expect(screen.getAllByText("Visibility and coordination pattern").length).toBeGreaterThan(0)
    );

    await user.click(screen.getByRole("button", { name: "Build Scout Matches" }));
    await waitFor(() =>
      expect(screen.getByText("1 matched pain-to-solution opportunities shortlisted.")).toBeInTheDocument()
    );

    expect(screen.getAllByText("Strong").length).toBeGreaterThan(0);
    expect(screen.getByText("Why this scored well: High keyword overlap")).toBeInTheDocument();
  });

  it("renders the strongest shaped AI scout enrichment lines safely by item type", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/audience/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "aud-enriched-1",
                sourcePlatform: "public_web",
                rawExcerpt: "Operators still patch broken handoffs by hand.",
                painSignalSummary: "Operators are flagging broken handoffs after launch.",
                whyItMatters: "This shows workflow-accountability pain in live operations.",
                suggestedActionType: "post_candidate",
                topicCluster: "Broken Handoff",
                confidence: "high",
                aiEnrichment: {
                  improvedSummary: "AI insight: broken handoffs are still creating manual cleanup after launch.",
                  businessConsequence: "The business consequence is slower recovery and messier support escalation.",
                  operatorAngle: "Frame this as an operator lesson about ownership before escalation."
                },
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 audience signal shortlisted.",
            notes: "Audience Scout is review-first."
          },
          201
        );
      }

      if (url.endsWith("/solutions/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "sol-enriched-1",
                sourceType: "github",
                rawExcerpt: "Expose status and ownership before work stalls.",
                solutionPattern: "Visibility and coordination pattern",
                implementationLesson: "Expose status and ownership early so operators can intervene before work stalls.",
                tradeoffOrConstraint: "Visibility helps coordination, but it can create noise if ownership is still undefined.",
                whyItMatters: "Useful operator lesson.",
                suggestedAngle: "workflow_accountability",
                suggestedActionType: "post_candidate",
                confidence: "high",
                aiEnrichment: {
                  improvedSummary: "AI insight: this solution pattern translates well into a workflow-accountability lesson.",
                  whyItMatters: "It gives the operator a concrete implementation lesson rather than a vague best practice.",
                  operatorAngle: "Use it as a planner-ready operator angle about intervention before stalls.",
                  businessConsequence: "This extra business consequence line should stay hidden in the compact UI."
                },
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 solution pattern shortlisted for review.",
            notes: "Solution Scout is review-first."
          },
          201
        );
      }

      if (url.endsWith("/scout/match") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "match-enriched-1",
                audienceItemId: "aud-enriched-1",
                solutionItemId: "sol-enriched-1",
                matchedPain: "Operators are flagging broken handoffs after launch.",
                matchedSolutionPattern: "Visibility and coordination pattern",
                whyThisMatchWorks:
                  "Visibility and coordination pattern addresses the same operator problem surfaced in the audience item.",
                suggestedAngle: "workflow_accountability",
                recommendedAction: "write_post",
                confidence: "high",
                aiEnrichment: {
                  improvedSummary: "AI insight: the pain and solution align around the same ownership gap.",
                  whyItMatters: "This pairing makes the ownership gap easier to explain in downstream planning.",
                  operatorAngle: "Turn this into an operator/content angle about accountability before escalation.",
                  businessConsequence: "This extra business consequence line should stay hidden in the compact UI.",
                  uncertaintyNote: "Treat this as additive guidance rather than a routing change."
                },
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 matched pain-to-solution opportunities shortlisted.",
            notes: "Scout matches stay review-first."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Audience Scout")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Target topics"), "handoff");
    await user.click(screen.getByRole("button", { name: "Run Audience Scout" }));
    await waitFor(() =>
      expect(
        screen.getAllByText("Operators are flagging broken handoffs after launch.").length
      ).toBeGreaterThan(0)
    );

    await user.type(screen.getByLabelText("Solution source excerpt"), "Expose status and ownership before work stalls.");
    await user.click(screen.getByRole("button", { name: "Run Solution Scout" }));
    await waitFor(() =>
      expect(screen.getByText("Visibility and coordination pattern")).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Build Scout Matches" }));
    await waitFor(() =>
      expect(screen.getByText("1 matched pain-to-solution opportunities shortlisted.")).toBeInTheDocument()
    );

    expect(screen.getAllByText("AI insight").length).toBeGreaterThanOrEqual(3);
    expect(
      screen.getByText(
        "The business consequence is slower recovery and messier support escalation."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Use it as a planner-ready operator angle about intervention before stalls."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This pairing makes the ownership gap easier to explain in downstream planning."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Turn this into an operator/content angle about accountability before escalation."
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Frame this as an operator lesson about ownership before escalation.")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "This extra business consequence line should stay hidden in the compact UI."
      )
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Treat this as additive guidance rather than a routing change.")
    ).not.toBeInTheDocument();
  });

  it("keeps scout cards compact when AI enrichment is absent", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/audience/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "aud-plain-1",
                sourcePlatform: "public_web",
                rawExcerpt: "Operators still patch broken handoffs by hand.",
                painSignalSummary: "Operators are flagging broken handoffs after launch.",
                whyItMatters: "This shows workflow-accountability pain in live operations.",
                suggestedActionType: "post_candidate",
                confidence: "high",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 audience signal shortlisted.",
            notes: "Audience Scout is review-first."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Audience Scout")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Target topics"), "handoff");
    await user.click(screen.getByRole("button", { name: "Run Audience Scout" }));
    await waitFor(() =>
      expect(
        screen.getAllByText("Operators are flagging broken handoffs after launch.").length
      ).toBeGreaterThan(0)
    );

    expect(screen.queryByText("AI insight")).not.toBeInTheDocument();
  });

  it("keeps AI scout enrichment compact when preferred fields are missing", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/solutions/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "sol-compact-1",
                sourceType: "github",
                rawExcerpt: "Expose status and ownership before work stalls.",
                solutionPattern: "Visibility and coordination pattern",
                implementationLesson: "Expose status and ownership early so operators can intervene before work stalls.",
                tradeoffOrConstraint: "Visibility helps coordination, but it can create noise if ownership is still undefined.",
                whyItMatters: "Useful operator lesson.",
                suggestedAngle: "workflow_accountability",
                suggestedActionType: "post_candidate",
                confidence: "high",
                aiEnrichment: {
                  operatorAngle: "Use this as a compact operator angle about intervening before stalls.",
                  uncertaintyNote: "This uncertainty note should stay hidden in the compact UI."
                },
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 solution pattern shortlisted for review.",
            notes: "Solution Scout is review-first."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Solution Scout")).toBeInTheDocument());
    await user.type(
      screen.getByLabelText("Solution source excerpt"),
      "Expose status and ownership before work stalls."
    );
    await user.click(screen.getByRole("button", { name: "Run Solution Scout" }));
    await waitFor(() =>
      expect(screen.getByText("Visibility and coordination pattern")).toBeInTheDocument()
    );

    expect(
      screen.getByText("Use this as a compact operator angle about intervening before stalls.")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("This uncertainty note should stay hidden in the compact UI.")
    ).not.toBeInTheDocument();
  });

  it("keeps sparse AI scout enrichment safe and compact across audience, solution, and matches", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/audience/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "aud-sparse-ui-1",
                sourcePlatform: "public_web",
                rawExcerpt: "Operators still patch broken handoffs by hand.",
                painSignalSummary: "Operators are flagging broken handoffs after launch.",
                whyItMatters: "This shows workflow-accountability pain in live operations.",
                suggestedActionType: "post_candidate",
                confidence: "high",
                aiEnrichment: {
                  businessConsequence: "Slower recovery and messier support escalation.",
                  uncertaintyNote: "This note should stay hidden."
                },
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 audience signal shortlisted.",
            notes: "Audience Scout is review-first."
          },
          201
        );
      }

      if (url.endsWith("/solutions/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "sol-sparse-ui-1",
                sourceType: "github",
                rawExcerpt: "Expose status and ownership before work stalls.",
                solutionPattern: "Visibility and coordination pattern",
                implementationLesson: "Expose status and ownership early so operators can intervene before work stalls.",
                tradeoffOrConstraint: "Visibility helps coordination, but it can create noise if ownership is still undefined.",
                whyItMatters: "Useful operator lesson.",
                suggestedAngle: "workflow_accountability",
                suggestedActionType: "post_candidate",
                confidence: "high",
                aiEnrichment: {
                  operatorAngle: "Use this as a compact operator angle about intervening before stalls.",
                  uncertaintyNote: "This note should stay hidden."
                },
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 solution pattern shortlisted for review.",
            notes: "Solution Scout is review-first."
          },
          201
        );
      }

      if (url.endsWith("/scout/match") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "match-sparse-ui-1",
                audienceItemId: "aud-sparse-ui-1",
                solutionItemId: "sol-sparse-ui-1",
                matchedPain: "Operators are flagging broken handoffs after launch.",
                matchedSolutionPattern: "Visibility and coordination pattern",
                whyThisMatchWorks:
                  "Visibility and coordination pattern addresses the same operator problem surfaced in the audience item.",
                suggestedAngle: "workflow_accountability",
                recommendedAction: "write_post",
                confidence: "high",
                aiEnrichment: {
                  whyItMatters: "This pairing matters because the same ownership gap keeps recurring.",
                  uncertaintyNote: "This note should stay hidden."
                },
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 matched pain-to-solution opportunities shortlisted.",
            notes: "Scout matches stay review-first."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Audience Scout")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Target topics"), "handoff");
    await user.click(screen.getByRole("button", { name: "Run Audience Scout" }));
    await waitFor(() =>
      expect(
        screen.getAllByText("Operators are flagging broken handoffs after launch.").length
      ).toBeGreaterThan(0)
    );

    await user.type(
      screen.getByLabelText("Solution source excerpt"),
      "Expose status and ownership before work stalls."
    );
    await user.click(screen.getByRole("button", { name: "Run Solution Scout" }));
    await waitFor(() =>
      expect(screen.getByText("Visibility and coordination pattern")).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Build Scout Matches" }));
    await waitFor(() =>
      expect(screen.getByText("1 matched pain-to-solution opportunities shortlisted.")).toBeInTheDocument()
    );

    expect(screen.getAllByText("AI insight")).toHaveLength(3);
    expect(
      screen.getByText("Slower recovery and messier support escalation.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Use this as a compact operator angle about intervening before stalls.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("This pairing matters because the same ownership gap keeps recurring.")
    ).toBeInTheDocument();
    expect(screen.queryByText("This note should stay hidden.")).not.toBeInTheDocument();
  });

  it("keeps generic overlap language from crowding out stronger match-specific AI rationale", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/audience/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "aud-match-quality-1",
                sourcePlatform: "public_web",
                rawExcerpt: "Operators still patch broken handoffs by hand.",
                painSignalSummary: "Operators are flagging broken handoffs after launch.",
                whyItMatters: "This shows workflow-accountability pain in live operations.",
                suggestedActionType: "post_candidate",
                confidence: "high",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 audience signal shortlisted.",
            notes: "Audience Scout is review-first."
          },
          201
        );
      }

      if (url.endsWith("/solutions/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "sol-match-quality-1",
                sourceType: "github",
                rawExcerpt: "Expose status and ownership before work stalls.",
                solutionPattern: "Visibility and coordination pattern",
                implementationLesson: "Expose status and ownership early so operators can intervene before work stalls.",
                tradeoffOrConstraint: "Visibility helps coordination, but it can create noise if ownership is still undefined.",
                whyItMatters: "Useful operator lesson.",
                suggestedAngle: "workflow_accountability",
                suggestedActionType: "post_candidate",
                confidence: "high",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 solution pattern shortlisted for review.",
            notes: "Solution Scout is review-first."
          },
          201
        );
      }

      if (url.endsWith("/scout/match") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "match-quality-ui-1",
                audienceItemId: "aud-match-quality-1",
                solutionItemId: "sol-match-quality-1",
                matchedPain: "Operators are flagging broken handoffs after launch.",
                matchedSolutionPattern: "Visibility and coordination pattern",
                whyThisMatchWorks:
                  "Visibility and coordination pattern addresses the same operator problem surfaced in the audience item.",
                suggestedAngle: "workflow_accountability",
                recommendedAction: "write_post",
                confidence: "high",
                aiEnrichment: {
                  improvedSummary: "The audience pain and solution share a workflow theme.",
                  businessConsequence:
                    "This pairing matters because unresolved ownership gaps keep slowing recovery and increasing support cleanup.",
                  operatorAngle:
                    "Frame it as an operator/content angle about accountability before support escalation."
                },
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 matched pain-to-solution opportunities shortlisted.",
            notes: "Scout matches stay review-first."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Audience Scout")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Target topics"), "handoff");
    await user.click(screen.getByRole("button", { name: "Run Audience Scout" }));
    await waitFor(() =>
      expect(
        screen.getAllByText("Operators are flagging broken handoffs after launch.").length
      ).toBeGreaterThan(0)
    );

    await user.type(
      screen.getByLabelText("Solution source excerpt"),
      "Expose status and ownership before work stalls."
    );
    await user.click(screen.getByRole("button", { name: "Run Solution Scout" }));
    await waitFor(() =>
      expect(screen.getByText("Visibility and coordination pattern")).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Build Scout Matches" }));
    await waitFor(() =>
      expect(screen.getByText("1 matched pain-to-solution opportunities shortlisted.")).toBeInTheDocument()
    );

    expect(
      screen.getByText(
        "This pairing matters because unresolved ownership gaps keep slowing recovery and increasing support cleanup."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Frame it as an operator/content angle about accountability before support escalation."
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText("The audience pain and solution share a workflow theme.")
    ).not.toBeInTheDocument();
  });

  it("can save a matched opportunity for later without breaking the queue", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/audience/scout") && method === "POST") {
        return jsonResponse({
          items: [
            {
              id: "aud-1",
              sourcePlatform: "public_web",
              rawExcerpt: "Support questions keep repeating because nobody can see where the workflow is stuck.",
              painSignalSummary: "Operators are calling out operational visibility gaps.",
              whyItMatters: "This exposes workflow pain in live operations.",
              suggestedActionType: "reply_opportunity",
              topicCluster: "Operational Visibility",
              confidence: "medium",
              createdAt: "2026-03-15T00:00:00.000Z"
            }
          ],
          summary: "1 audience signal shortlisted.",
          notes: "Audience Scout is review-first."
        }, 201);
      }

      if (url.endsWith("/solutions/scout") && method === "POST") {
        return jsonResponse({
          items: [
            {
              id: "sol-1",
              sourceType: "article",
              rawExcerpt: "The team exposed status and ownership early so operators could intervene before work stalled.",
              solutionPattern: "Visibility and coordination pattern",
              implementationLesson: "Expose status and ownership early so operators can intervene before work stalls.",
              tradeoffOrConstraint: "Visibility helps coordination, but it can create noise if ownership is still undefined.",
              whyItMatters: "Useful operator lesson.",
              suggestedAngle: "workflow_accountability",
              suggestedActionType: "reply_opportunity",
              confidence: "high",
              createdAt: "2026-03-15T00:00:00.000Z"
            }
          ],
          summary: "1 solution pattern shortlisted for review.",
          notes: "Solution Scout is review-first."
        }, 201);
      }

      if (url.endsWith("/scout/match") && method === "POST") {
        return jsonResponse({
          items: [
            {
              id: "match-1",
              audienceItemId: "aud-1",
              solutionItemId: "sol-1",
              matchedPain: "Operators are calling out operational visibility gaps.",
              matchedSolutionPattern: "Visibility and coordination pattern",
              whyThisMatchWorks: "Visibility and coordination pattern addresses the same operator problem surfaced in the audience item.",
              suggestedAngle: "workflow_accountability",
              recommendedAction: "write_reply",
              confidence: "high",
              createdAt: "2026-03-15T00:00:00.000Z"
            }
          ],
          summary: "1 matched pain-to-solution opportunities shortlisted.",
          notes: "Scout matches stay review-first."
        }, 201);
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Audience Scout")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Target topics"), "visibility");
    await user.click(screen.getByRole("button", { name: "Run Audience Scout" }));
    await user.type(
      screen.getByLabelText("Solution source excerpt"),
      "The team exposed status and ownership early so operators could intervene before work stalled."
    );
    await user.click(screen.getByRole("button", { name: "Run Solution Scout" }));
    await user.click(screen.getByRole("button", { name: "Build Scout Matches" }));
    await waitFor(() =>
      expect(
        screen.getAllByText("Operators are calling out operational visibility gaps.").length
      ).toBeGreaterThan(0)
    );

    const matchCard = screen
      .getByText("1 matched pain-to-solution opportunities shortlisted.")
      .closest("div");
    expect(matchCard).not.toBeNull();

    await user.click(within(matchCard as HTMLElement).getByRole("button", { name: "Save for later" }));

    expect(
      screen.getAllByText("Operators are calling out operational visibility gaps.").length
    ).toBeGreaterThan(0);
    expect(
      screen.getByText("Visibility and coordination pattern")
    ).toBeInTheDocument();
  });

  it("can send a matched opportunity into Decision Planner safely", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/audience/scout") && method === "POST") {
        return jsonResponse({
          items: [
            {
              id: "aud-1",
              sourcePlatform: "public_web",
              rawExcerpt: "The workflow stalls in exceptions and nobody owns recovery.",
              painSignalSummary: "Operators are describing workflow pain around stalled recovery.",
              whyItMatters: "This exposes resilience pain.",
              suggestedActionType: "reply_opportunity",
              topicCluster: "Workflow Pain",
              confidence: "medium",
              createdAt: "2026-03-15T00:00:00.000Z"
            }
          ],
          summary: "1 audience signal shortlisted.",
          notes: "Audience Scout is review-first."
        }, 201);
      }

      if (url.endsWith("/solutions/scout") && method === "POST") {
        return jsonResponse({
          items: [
            {
              id: "sol-1",
              sourceType: "manual_research",
              rawExcerpt: "Make recovery ownership visible before the workflow hits its first failure path.",
              solutionPattern: "Exception and recovery pattern",
              implementationLesson: "Make recovery ownership visible before the workflow hits its first failure path.",
              tradeoffOrConstraint: "Recovery guardrails add reliability, but they also add operational complexity to maintain.",
              whyItMatters: "Useful resilience lesson.",
              suggestedAngle: "exception_handling",
              suggestedActionType: "reply_opportunity",
              confidence: "high",
              createdAt: "2026-03-15T00:00:00.000Z"
            }
          ],
          summary: "1 solution pattern shortlisted for review.",
          notes: "Solution Scout is review-first."
        }, 201);
      }

      if (url.endsWith("/scout/match") && method === "POST") {
        return jsonResponse({
          items: [
            {
              id: "match-1",
              audienceItemId: "aud-1",
              solutionItemId: "sol-1",
              matchedPain: "Operators are describing workflow pain around stalled recovery.",
              matchedSolutionPattern: "Exception and recovery pattern",
              whyThisMatchWorks: "The solution addresses the same stalled recovery problem surfaced in the audience item.",
              suggestedAngle: "exception_handling",
              recommendedAction: "write_reply",
              confidence: "high",
              createdAt: "2026-03-15T00:00:00.000Z"
            }
          ],
          summary: "1 matched pain-to-solution opportunities shortlisted.",
          notes: "Scout matches stay review-first."
        }, 201);
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Audience Scout")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Target topics"), "recovery");
    await user.click(screen.getByRole("button", { name: "Run Audience Scout" }));
    await user.type(
      screen.getByLabelText("Solution source excerpt"),
      "Make recovery ownership visible before the workflow hits its first failure path."
    );
    await user.click(screen.getByRole("button", { name: "Run Solution Scout" }));
    await user.click(screen.getByRole("button", { name: "Build Scout Matches" }));
    await waitFor(() =>
      expect(
        screen.getAllByText("Operators are describing workflow pain around stalled recovery.").length
      ).toBeGreaterThan(0)
    );

    const matchCard = screen
      .getByText("1 matched pain-to-solution opportunities shortlisted.")
      .closest("div");
    expect(matchCard).not.toBeNull();

    await user.click(
      within(matchCard as HTMLElement).getByRole("button", { name: "Send to Decision Planner" })
    );

    expect(screen.getByLabelText("Decision signal text")).toHaveValue(
      "Operators are describing workflow pain around stalled recovery."
    );
    expect(screen.getByLabelText("Optional best angle")).toHaveValue("exception_handling");
    expect(screen.getByLabelText("Decision company/about text")).toHaveValue(
      "Exception and recovery pattern"
    );
  });

  it("can save a matched opportunity into persistent saved matches storage", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/audience/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "aud-1",
                sourcePlatform: "public_web",
                rawExcerpt: "The handoff still breaks after rollout.",
                painSignalSummary: "Operators are flagging rollout handoff gaps.",
                whyItMatters: "This exposes workflow accountability pain.",
                suggestedActionType: "post_candidate",
                topicCluster: "Broken Handoff",
                confidence: "high",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 audience signal shortlisted.",
            notes: "Audience Scout is review-first."
          },
          201
        );
      }

      if (url.endsWith("/solutions/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "sol-1",
                sourceType: "github",
                rawExcerpt: "Expose ownership and status before rollout stalls.",
                solutionPattern: "Visibility and coordination pattern",
                implementationLesson: "Expose ownership and status before rollout stalls.",
                tradeoffOrConstraint: "More visibility creates more coordination overhead.",
                whyItMatters: "Useful operator lesson.",
                suggestedAngle: "workflow_accountability",
                suggestedActionType: "post_candidate",
                confidence: "high",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 solution pattern shortlisted for review.",
            notes: "Solution Scout is review-first."
          },
          201
        );
      }

      if (url.endsWith("/scout/match") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "match-1",
                audienceItemId: "aud-1",
                solutionItemId: "sol-1",
                matchedPain: "Operators are flagging rollout handoff gaps.",
                matchedSolutionPattern: "Visibility and coordination pattern",
                whyThisMatchWorks:
                  "The solution pattern addresses the same ownership gap in the audience signal.",
                suggestedAngle: "workflow_accountability",
                recommendedAction: "write_post",
                confidence: "high",
                opportunityStrength: "strong",
                scoreNotes: ["High keyword overlap", "Both sides are actionable"],
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 matched pain-to-solution opportunities shortlisted.",
            notes: "Scout matches stay review-first."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Audience Scout")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Target topics"), "handoff gaps");
    await user.click(screen.getByRole("button", { name: "Run Audience Scout" }));
    await user.type(
      screen.getByLabelText("Solution source excerpt"),
      "Expose ownership and status before rollout stalls."
    );
    await user.click(screen.getByRole("button", { name: "Run Solution Scout" }));
    await user.click(screen.getByRole("button", { name: "Build Scout Matches" }));
    await waitFor(() =>
      expect(screen.getByText("1 matched pain-to-solution opportunities shortlisted.")).toBeInTheDocument()
    );

    const matchCard = screen
      .getByText("1 matched pain-to-solution opportunities shortlisted.")
      .closest("div");
    expect(matchCard).not.toBeNull();

    await user.click(within(matchCard as HTMLElement).getByRole("button", { name: "Save match" }));

    expect(screen.getByText("Saved Matches")).toBeInTheDocument();
    expect(screen.getAllByText("Operators are flagging rollout handoff gaps.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Strong").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Why this scored well: High keyword overlap").length).toBeGreaterThan(1);
    expect(screen.getByText("Saved matched opportunity for review.")).toBeInTheDocument();

    const stored = JSON.parse(
      window.localStorage.getItem("linkedin-brand-os:saved-matches") ?? '{"items":[]}'
    ) as {
      items: Array<{
        status: string;
        match: { matchedPain: string; opportunityStrength?: string; scoreNotes?: string[] };
      }>;
    };
    expect(stored.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "new",
          match: expect.objectContaining({
            matchedPain: "Operators are flagging rollout handoff gaps.",
            opportunityStrength: "strong",
            scoreNotes: expect.arrayContaining(["High keyword overlap"])
          })
        })
      ])
    );
  });

  it("reloads persisted saved matches safely from localStorage", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "persisted-match-1",
            match: {
              id: "match-1",
              audienceItemId: "aud-1",
              solutionItemId: "sol-1",
              matchedPain: "Operators keep flagging workflow pain after launch.",
              matchedSolutionPattern: "Visibility and coordination pattern",
              whyThisMatchWorks: "The solution pattern addresses the same ownership gap.",
              suggestedAngle: "workflow_accountability",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              scoreNotes: ["High keyword overlap", "Both sides are actionable"],
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:00.000Z",
            lastActionAt: "2026-03-15T01:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Saved Matches")).toBeInTheDocument();
      expect(screen.getByText("Operators keep flagging workflow pain after launch.")).toBeInTheDocument();
      expect(screen.getByText("reviewed")).toBeInTheDocument();
      expect(screen.getByText("Strong")).toBeInTheDocument();
      expect(screen.getByText("Why this scored well: High keyword overlap")).toBeInTheDocument();
    });
  });

  it("keeps saved matches compact when no score note exists", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "persisted-match-quiet",
            match: {
              id: "match-quiet",
              audienceItemId: "aud-quiet",
              solutionItemId: "sol-quiet",
              matchedPain: "Operators are tracking a moderate visibility gap.",
              matchedSolutionPattern: "Visibility and coordination pattern",
              whyThisMatchWorks: "The solution pattern still fits the operating problem.",
              suggestedAngle: "workflow_accountability",
              recommendedAction: "write_comment",
              confidence: "medium",
              opportunityStrength: "medium",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Saved Matches")).toBeInTheDocument();
      expect(screen.getByText("Operators are tracking a moderate visibility gap.")).toBeInTheDocument();
      expect(screen.getByText("Medium")).toBeInTheDocument();
    });

    expect(screen.queryByText(/Why this scored well:/)).not.toBeInTheDocument();
  });

  it("updates persisted match statuses and reuses downstream handoffs safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "persisted-match-1",
            match: {
              id: "match-1",
              audienceItemId: "aud-1",
              solutionItemId: "sol-1",
              matchedPain: "Operators are describing stalled recovery paths.",
              matchedSolutionPattern: "Exception and recovery pattern",
              whyThisMatchWorks: "The solution pattern addresses the same resilience gap.",
              suggestedAngle: "exception_handling",
              recommendedAction: "write_reply",
              confidence: "high",
              opportunityStrength: "strong",
              scoreNotes: ["High keyword overlap", "Both sides are actionable"],
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    const savedMatchesSection = screen.getByText("Saved Matches").closest("section");
    expect(savedMatchesSection).not.toBeNull();

    await user.click(
      within(savedMatchesSection as HTMLElement).getByRole("button", { name: "Mark reviewed" })
    );
    expect(screen.getByText("Marked saved match as reviewed.")).toBeInTheDocument();

    await user.click(
      within(savedMatchesSection as HTMLElement).getByRole("button", { name: "Send to Decision Planner" })
    );

    expect(screen.getByLabelText("Decision signal text")).toHaveValue(
      "Operators are describing stalled recovery paths."
    );
    expect(screen.getByLabelText("Optional best angle")).toHaveValue("exception_handling");

    let stored = JSON.parse(
      window.localStorage.getItem("linkedin-brand-os:saved-matches") ?? '{"items":[]}'
    ) as { items: Array<{ status: string; lastActionAt?: string }> };
    expect(stored.items[0]?.status).toBe("converted");
    expect(stored.items[0]?.lastActionAt).toBeDefined();

    await user.click(
      within(savedMatchesSection as HTMLElement).getByRole("button", { name: "Archive" })
    );

    stored = JSON.parse(
      window.localStorage.getItem("linkedin-brand-os:saved-matches") ?? '{"items":[]}'
    ) as { items: Array<{ status: string }> };
    expect(stored.items[0]?.status).toBe("archived");
    expect(screen.getByText("Archived saved match.")).toBeInTheDocument();
  });

  it("surfaces stronger active saved matches ahead of weaker comparable ones", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-weak",
            match: {
              id: "match-weak",
              audienceItemId: "aud-weak",
              solutionItemId: "sol-weak",
              matchedPain: "Weak saved match pain",
              matchedSolutionPattern: "Weak pattern",
              whyThisMatchWorks: "Weak fit.",
              suggestedAngle: "weak_angle",
              recommendedAction: "save_for_later",
              confidence: "low",
              opportunityStrength: "weak",
              createdAt: "2026-03-15T01:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T01:00:00.000Z"
          },
          {
            id: "saved-strong",
            match: {
              id: "match-strong",
              audienceItemId: "aud-strong",
              solutionItemId: "sol-strong",
              matchedPain: "Strong saved match pain",
              matchedSolutionPattern: "Strong pattern",
              whyThisMatchWorks: "Strong fit.",
              suggestedAngle: "strong_angle",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    const savedMatchesSection = screen.getByText("Saved Matches").closest("section");
    expect(savedMatchesSection).not.toBeNull();
    const savedMatchesText = savedMatchesSection?.textContent ?? "";
    expect(savedMatchesText.indexOf("Strong saved match pain")).toBeGreaterThanOrEqual(0);
    expect(savedMatchesText.indexOf("Weak saved match pain")).toBeGreaterThanOrEqual(0);
    expect(savedMatchesText.indexOf("Strong saved match pain")).toBeLessThan(
      savedMatchesText.indexOf("Weak saved match pain")
    );
  });

  it("keeps weaker or converted saved matches below stronger active review candidates", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-converted-weak",
            match: {
              id: "match-converted-weak",
              audienceItemId: "aud-converted-weak",
              solutionItemId: "sol-converted-weak",
              matchedPain: "Converted weak saved match",
              matchedSolutionPattern: "Weak converted pattern",
              whyThisMatchWorks: "Converted weak fit.",
              suggestedAngle: "converted_weak",
              recommendedAction: "save_for_later",
              confidence: "low",
              opportunityStrength: "weak",
              createdAt: "2026-03-15T03:00:00.000Z"
            },
            status: "converted",
            createdAt: "2026-03-15T03:00:00.000Z",
            lastActionAt: "2026-03-15T03:00:00.000Z"
          },
          {
            id: "saved-archived-medium",
            match: {
              id: "match-archived-medium",
              audienceItemId: "aud-archived-medium",
              solutionItemId: "sol-archived-medium",
              matchedPain: "Archived medium saved match",
              matchedSolutionPattern: "Archived pattern",
              whyThisMatchWorks: "Archived fit.",
              suggestedAngle: "archived_medium",
              recommendedAction: "write_comment",
              confidence: "medium",
              opportunityStrength: "medium",
              createdAt: "2026-03-15T02:00:00.000Z"
            },
            status: "archived",
            createdAt: "2026-03-15T02:00:00.000Z",
            lastActionAt: "2026-03-15T02:00:00.000Z"
          },
          {
            id: "saved-review-strong",
            match: {
              id: "match-review-strong",
              audienceItemId: "aud-review-strong",
              solutionItemId: "sol-review-strong",
              matchedPain: "Reviewed strong saved match",
              matchedSolutionPattern: "Reviewed strong pattern",
              whyThisMatchWorks: "Reviewed strong fit.",
              suggestedAngle: "reviewed_strong",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T01:00:00.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T01:00:00.000Z"
          },
          {
            id: "saved-new-strong",
            match: {
              id: "match-new-strong",
              audienceItemId: "aud-new-strong",
              solutionItemId: "sol-new-strong",
              matchedPain: "New strong saved match",
              matchedSolutionPattern: "New strong pattern",
              whyThisMatchWorks: "New strong fit.",
              suggestedAngle: "new_strong",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    const savedMatchesSection = screen.getByText("Saved Matches").closest("section");
    expect(savedMatchesSection).not.toBeNull();
    const savedMatchesText = savedMatchesSection?.textContent ?? "";
    const newStrongIndex = savedMatchesText.indexOf("New strong saved match");
    const reviewedStrongIndex = savedMatchesText.indexOf("Reviewed strong saved match");
    const convertedWeakIndex = savedMatchesText.indexOf("Converted weak saved match");
    const archivedMediumIndex = savedMatchesText.indexOf("Archived medium saved match");

    expect(newStrongIndex).toBeGreaterThanOrEqual(0);
    expect(reviewedStrongIndex).toBeGreaterThanOrEqual(0);
    expect(convertedWeakIndex).toBeGreaterThanOrEqual(0);
    expect(archivedMediumIndex).toBeGreaterThanOrEqual(0);
    expect(newStrongIndex).toBeLessThan(reviewedStrongIndex);
    expect(reviewedStrongIndex).toBeLessThan(convertedWeakIndex);
    expect(convertedWeakIndex).toBeLessThan(archivedMediumIndex);
    expect(within(savedMatchesSection as HTMLElement).getByText("new")).toBeInTheDocument();
    expect(within(savedMatchesSection as HTMLElement).getByText("reviewed")).toBeInTheDocument();
    expect(within(savedMatchesSection as HTMLElement).getByText("converted")).toBeInTheDocument();
    expect(within(savedMatchesSection as HTMLElement).getByText("archived")).toBeInTheDocument();
  });

  it("filters saved matches by status chips safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-filter-new",
            match: {
              id: "match-filter-new",
              audienceItemId: "aud-filter-new",
              solutionItemId: "sol-filter-new",
              matchedPain: "New saved match",
              matchedSolutionPattern: "New pattern",
              whyThisMatchWorks: "New fit.",
              suggestedAngle: "new_angle",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "saved-filter-reviewed",
            match: {
              id: "match-filter-reviewed",
              audienceItemId: "aud-filter-reviewed",
              solutionItemId: "sol-filter-reviewed",
              matchedPain: "Reviewed saved match",
              matchedSolutionPattern: "Reviewed pattern",
              whyThisMatchWorks: "Reviewed fit.",
              suggestedAngle: "reviewed_angle",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:01.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:01.000Z"
          },
          {
            id: "saved-filter-converted",
            match: {
              id: "match-filter-converted",
              audienceItemId: "aud-filter-converted",
              solutionItemId: "sol-filter-converted",
              matchedPain: "Converted saved match",
              matchedSolutionPattern: "Converted pattern",
              whyThisMatchWorks: "Converted fit.",
              suggestedAngle: "converted_angle",
              recommendedAction: "write_comment",
              confidence: "medium",
              opportunityStrength: "medium",
              createdAt: "2026-03-15T00:00:02.000Z"
            },
            status: "converted",
            createdAt: "2026-03-15T00:00:02.000Z"
          },
          {
            id: "saved-filter-archived",
            match: {
              id: "match-filter-archived",
              audienceItemId: "aud-filter-archived",
              solutionItemId: "sol-filter-archived",
              matchedPain: "Archived saved match",
              matchedSolutionPattern: "Archived pattern",
              whyThisMatchWorks: "Archived fit.",
              suggestedAngle: "archived_angle",
              recommendedAction: "save_for_later",
              confidence: "low",
              opportunityStrength: "weak",
              createdAt: "2026-03-15T00:00:03.000Z"
            },
            status: "archived",
            createdAt: "2026-03-15T00:00:03.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    expect(screen.getByText("New saved match")).toBeInTheDocument();
    expect(screen.getByText("Reviewed saved match")).toBeInTheDocument();
    expect(screen.getByText("Converted saved match")).toBeInTheDocument();
    expect(screen.getByText("Archived saved match")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New (1)" }));
    expect(screen.getByText("New saved match")).toBeInTheDocument();
    expect(screen.queryByText("Reviewed saved match")).not.toBeInTheDocument();
    expect(screen.queryByText("Converted saved match")).not.toBeInTheDocument();
    expect(screen.queryByText("Archived saved match")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reviewed (1)" }));
    expect(screen.queryByText("New saved match")).not.toBeInTheDocument();
    expect(screen.getByText("Reviewed saved match")).toBeInTheDocument();
    expect(screen.queryByText("Converted saved match")).not.toBeInTheDocument();
    expect(screen.queryByText("Archived saved match")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Converted (1)" }));
    expect(screen.queryByText("New saved match")).not.toBeInTheDocument();
    expect(screen.queryByText("Reviewed saved match")).not.toBeInTheDocument();
    expect(screen.getByText("Converted saved match")).toBeInTheDocument();
    expect(screen.queryByText("Archived saved match")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Archived (1)" }));
    expect(screen.queryByText("New saved match")).not.toBeInTheDocument();
    expect(screen.queryByText("Reviewed saved match")).not.toBeInTheDocument();
    expect(screen.queryByText("Converted saved match")).not.toBeInTheDocument();
    expect(screen.getByText("Archived saved match")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All (4)" }));
    expect(screen.getByText("New saved match")).toBeInTheDocument();
    expect(screen.getByText("Reviewed saved match")).toBeInTheDocument();
    expect(screen.getByText("Converted saved match")).toBeInTheDocument();
    expect(screen.getByText("Archived saved match")).toBeInTheDocument();
  });

  it("renders a safe empty state when no saved matches match the active filter", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-empty-new",
            match: {
              id: "match-empty-new",
              audienceItemId: "aud-empty-new",
              solutionItemId: "sol-empty-new",
              matchedPain: "Only new saved match",
              matchedSolutionPattern: "Only new pattern",
              whyThisMatchWorks: "Only new fit.",
              suggestedAngle: "only_new",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Archived (0)" }));

    expect(screen.getByText("No saved matches match this filter.")).toBeInTheDocument();
    expect(screen.queryByText("Only new saved match")).not.toBeInTheDocument();
  });

  it("shows compact saved-match review summaries safely", async () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-summary-new-strong",
            match: {
              id: "match-summary-new-strong",
              audienceItemId: "aud-summary-new-strong",
              solutionItemId: "sol-summary-new-strong",
              matchedPain: "New strong saved match",
              matchedSolutionPattern: "Strong review pattern",
              whyThisMatchWorks: "Strong active fit.",
              suggestedAngle: "strong_active",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "saved-summary-reviewed-strong",
            match: {
              id: "match-summary-reviewed-strong",
              audienceItemId: "aud-summary-reviewed-strong",
              solutionItemId: "sol-summary-reviewed-strong",
              matchedPain: "Reviewed strong saved match",
              matchedSolutionPattern: "Reviewed strong pattern",
              whyThisMatchWorks: "Reviewed active fit.",
              suggestedAngle: "reviewed_active",
              recommendedAction: "write_comment",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:01.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:01.000Z"
          },
          {
            id: "saved-summary-new-weak",
            match: {
              id: "match-summary-new-weak",
              audienceItemId: "aud-summary-new-weak",
              solutionItemId: "sol-summary-new-weak",
              matchedPain: "New weak saved match",
              matchedSolutionPattern: "Weak review pattern",
              whyThisMatchWorks: "Weak review fit.",
              suggestedAngle: "weak_review",
              recommendedAction: "save_for_later",
              confidence: "low",
              opportunityStrength: "weak",
              createdAt: "2026-03-15T00:00:02.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:02.000Z"
          },
          {
            id: "saved-summary-converted-today",
            match: {
              id: "match-summary-converted-today",
              audienceItemId: "aud-summary-converted-today",
              solutionItemId: "sol-summary-converted-today",
              matchedPain: "Converted today saved match",
              matchedSolutionPattern: "Converted pattern",
              whyThisMatchWorks: "Converted fit.",
              suggestedAngle: "converted_today",
              recommendedAction: "write_reply",
              confidence: "medium",
              opportunityStrength: "medium",
              createdAt: "2026-03-14T23:00:00.000Z"
            },
            status: "converted",
            createdAt: "2026-03-14T23:00:00.000Z",
            lastActionAt: today.toISOString()
          },
          {
            id: "saved-summary-converted-earlier",
            match: {
              id: "match-summary-converted-earlier",
              audienceItemId: "aud-summary-converted-earlier",
              solutionItemId: "sol-summary-converted-earlier",
              matchedPain: "Converted earlier saved match",
              matchedSolutionPattern: "Converted earlier pattern",
              whyThisMatchWorks: "Earlier converted fit.",
              suggestedAngle: "converted_earlier",
              recommendedAction: "write_reply",
              confidence: "medium",
              opportunityStrength: "medium",
              createdAt: "2026-03-13T23:00:00.000Z"
            },
            status: "converted",
            createdAt: "2026-03-13T23:00:00.000Z",
            lastActionAt: yesterday.toISOString()
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    expect(screen.getByText("Strong active (2)")).toBeInTheDocument();
    expect(screen.getByText("Needs review (2)")).toBeInTheDocument();
    expect(screen.getByText("Converted today (1)")).toBeInTheDocument();
  });

  it("keeps saved-match review summaries stable under status filters safely", async () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-summary-filter-new",
            match: {
              id: "match-summary-filter-new",
              audienceItemId: "aud-summary-filter-new",
              solutionItemId: "sol-summary-filter-new",
              matchedPain: "Filter new strong match",
              matchedSolutionPattern: "Filter new pattern",
              whyThisMatchWorks: "Filter new fit.",
              suggestedAngle: "filter_new",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "saved-summary-filter-reviewed",
            match: {
              id: "match-summary-filter-reviewed",
              audienceItemId: "aud-summary-filter-reviewed",
              solutionItemId: "sol-summary-filter-reviewed",
              matchedPain: "Filter reviewed strong match",
              matchedSolutionPattern: "Filter reviewed pattern",
              whyThisMatchWorks: "Filter reviewed fit.",
              suggestedAngle: "filter_reviewed",
              recommendedAction: "write_comment",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:01.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:01.000Z"
          },
          {
            id: "saved-summary-filter-converted",
            match: {
              id: "match-summary-filter-converted",
              audienceItemId: "aud-summary-filter-converted",
              solutionItemId: "sol-summary-filter-converted",
              matchedPain: "Filter converted match",
              matchedSolutionPattern: "Filter converted pattern",
              whyThisMatchWorks: "Filter converted fit.",
              suggestedAngle: "filter_converted",
              recommendedAction: "write_reply",
              confidence: "medium",
              opportunityStrength: "medium",
              createdAt: "2026-03-14T00:00:00.000Z"
            },
            status: "converted",
            createdAt: "2026-03-14T00:00:00.000Z",
            lastActionAt: today.toISOString()
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    expect(screen.getByText("Strong active (2)")).toBeInTheDocument();
    expect(screen.getByText("Needs review (1)")).toBeInTheDocument();
    expect(screen.getByText("Converted today (1)")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Archived (0)" }));

    expect(screen.getByText("No saved matches match this filter.")).toBeInTheDocument();
    expect(screen.getByText("Strong active (2)")).toBeInTheDocument();
    expect(screen.getByText("Needs review (1)")).toBeInTheDocument();
    expect(screen.getByText("Converted today (1)")).toBeInTheDocument();
  });

  it("updates saved-match review summaries safely after status actions", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-summary-action-new",
            match: {
              id: "match-summary-action-new",
              audienceItemId: "aud-summary-action-new",
              solutionItemId: "sol-summary-action-new",
              matchedPain: "Action summary saved match",
              matchedSolutionPattern: "Action summary pattern",
              whyThisMatchWorks: "Action summary fit.",
              suggestedAngle: "action_summary",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    const savedMatchesSection = screen.getByText("Saved Matches").closest("section");
    expect(savedMatchesSection).not.toBeNull();

    expect(screen.getByText("Strong active (1)")).toBeInTheDocument();
    expect(screen.getByText("Needs review (1)")).toBeInTheDocument();
    expect(screen.getByText("Converted today (0)")).toBeInTheDocument();

    await user.click(
      within(savedMatchesSection as HTMLElement).getByRole("button", { name: "Mark reviewed" })
    );

    expect(screen.getByText("Strong active (1)")).toBeInTheDocument();
    expect(screen.getByText("Needs review (0)")).toBeInTheDocument();
    expect(screen.getByText("Converted today (0)")).toBeInTheDocument();

    await user.click(
      within(savedMatchesSection as HTMLElement).getByRole("button", { name: "Send to Source Intake" })
    );

    expect(screen.getByText("Strong active (0)")).toBeInTheDocument();
    expect(screen.getByText("Needs review (0)")).toBeInTheDocument();
    expect(screen.getByText("Converted today (1)")).toBeInTheDocument();
  });

  it("clicking Needs review activates the New saved-match filter safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-summary-click-new",
            match: {
              id: "match-summary-click-new",
              audienceItemId: "aud-summary-click-new",
              solutionItemId: "sol-summary-click-new",
              matchedPain: "Needs review saved match",
              matchedSolutionPattern: "Needs review pattern",
              whyThisMatchWorks: "Needs review fit.",
              suggestedAngle: "needs_review",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "saved-summary-click-reviewed",
            match: {
              id: "match-summary-click-reviewed",
              audienceItemId: "aud-summary-click-reviewed",
              solutionItemId: "sol-summary-click-reviewed",
              matchedPain: "Reviewed-only saved match",
              matchedSolutionPattern: "Reviewed pattern",
              whyThisMatchWorks: "Reviewed fit.",
              suggestedAngle: "reviewed_only",
              recommendedAction: "write_comment",
              confidence: "medium",
              opportunityStrength: "medium",
              createdAt: "2026-03-15T00:00:01.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:01.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Needs review (1)" }));

    expect(screen.getByRole("button", { name: "New (1)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Needs review saved match")).toBeInTheDocument();
    expect(screen.queryByText("Reviewed-only saved match")).not.toBeInTheDocument();
  });

  it("keeps the Needs review shortcut visually active when the New filter is active safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-summary-clarity-new",
            match: {
              id: "match-summary-clarity-new",
              audienceItemId: "aud-summary-clarity-new",
              solutionItemId: "sol-summary-clarity-new",
              matchedPain: "Clarity new saved match",
              matchedSolutionPattern: "Clarity pattern",
              whyThisMatchWorks: "Clarity fit.",
              suggestedAngle: "clarity_new",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "saved-summary-clarity-reviewed",
            match: {
              id: "match-summary-clarity-reviewed",
              audienceItemId: "aud-summary-clarity-reviewed",
              solutionItemId: "sol-summary-clarity-reviewed",
              matchedPain: "Clarity reviewed saved match",
              matchedSolutionPattern: "Clarity reviewed pattern",
              whyThisMatchWorks: "Clarity reviewed fit.",
              suggestedAngle: "clarity_reviewed",
              recommendedAction: "write_comment",
              confidence: "medium",
              opportunityStrength: "medium",
              createdAt: "2026-03-15T00:00:01.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:01.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    const needsReviewButton = screen.getByRole("button", { name: "Needs review (1)" });
    expect(needsReviewButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("Showing new saved matches")).not.toBeInTheDocument();

    await user.click(needsReviewButton);

    expect(screen.getByRole("button", { name: "Needs review (1)" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "New (1)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Showing new saved matches")).toBeInTheDocument();
  });

  it("removes the Needs review shortcut linkage when another saved-match filter is active safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-summary-clarity-switch-new",
            match: {
              id: "match-summary-clarity-switch-new",
              audienceItemId: "aud-summary-clarity-switch-new",
              solutionItemId: "sol-summary-clarity-switch-new",
              matchedPain: "Switch new saved match",
              matchedSolutionPattern: "Switch new pattern",
              whyThisMatchWorks: "Switch new fit.",
              suggestedAngle: "switch_new",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "saved-summary-clarity-switch-reviewed",
            match: {
              id: "match-summary-clarity-switch-reviewed",
              audienceItemId: "aud-summary-clarity-switch-reviewed",
              solutionItemId: "sol-summary-clarity-switch-reviewed",
              matchedPain: "Switch reviewed saved match",
              matchedSolutionPattern: "Switch reviewed pattern",
              whyThisMatchWorks: "Switch reviewed fit.",
              suggestedAngle: "switch_reviewed",
              recommendedAction: "write_comment",
              confidence: "medium",
              opportunityStrength: "medium",
              createdAt: "2026-03-15T00:00:01.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:01.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Needs review (1)" }));
    expect(screen.getByText("Showing new saved matches")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reviewed (1)" }));

    expect(screen.getByRole("button", { name: "Needs review (1)" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.getByRole("button", { name: "Reviewed (1)" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.queryByText("Showing new saved matches")).not.toBeInTheDocument();
  });

  it("keeps the Needs review shortcut clickable when its count is zero safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-summary-empty-reviewed",
            match: {
              id: "match-summary-empty-reviewed",
              audienceItemId: "aud-summary-empty-reviewed",
              solutionItemId: "sol-summary-empty-reviewed",
              matchedPain: "Reviewed-only empty-state match",
              matchedSolutionPattern: "Reviewed empty-state pattern",
              whyThisMatchWorks: "Reviewed empty-state fit.",
              suggestedAngle: "reviewed_empty",
              recommendedAction: "write_comment",
              confidence: "medium",
              opportunityStrength: "medium",
              createdAt: "2026-03-15T00:00:01.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:01.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    const needsReviewButton = screen.getByRole("button", { name: "Needs review (0)" });
    expect(needsReviewButton).toBeEnabled();

    await user.click(needsReviewButton);

    expect(screen.getByRole("button", { name: "Needs review (0)" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "New (0)" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a review-oriented empty-state message when the New filter is active and empty safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-summary-empty-reviewed-only",
            match: {
              id: "match-summary-empty-reviewed-only",
              audienceItemId: "aud-summary-empty-reviewed-only",
              solutionItemId: "sol-summary-empty-reviewed-only",
              matchedPain: "Reviewed empty-state only match",
              matchedSolutionPattern: "Reviewed only pattern",
              whyThisMatchWorks: "Reviewed only fit.",
              suggestedAngle: "reviewed_only_empty",
              recommendedAction: "write_comment",
              confidence: "medium",
              opportunityStrength: "medium",
              createdAt: "2026-03-15T00:00:01.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:01.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Needs review (0)" }));

    expect(screen.getByText("Showing new saved matches")).toBeInTheDocument();
    expect(screen.getByText("No new saved matches to review.")).toBeInTheDocument();
    expect(screen.queryByText("No saved matches match this filter.")).not.toBeInTheDocument();
  });

  it("keeps the review-empty message scoped to the New filter safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-summary-empty-scope-reviewed",
            match: {
              id: "match-summary-empty-scope-reviewed",
              audienceItemId: "aud-summary-empty-scope-reviewed",
              solutionItemId: "sol-summary-empty-scope-reviewed",
              matchedPain: "Scoped reviewed empty-state match",
              matchedSolutionPattern: "Scoped reviewed pattern",
              whyThisMatchWorks: "Scoped reviewed fit.",
              suggestedAngle: "scoped_reviewed",
              recommendedAction: "write_comment",
              confidence: "medium",
              opportunityStrength: "medium",
              createdAt: "2026-03-15T00:00:01.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:01.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Needs review (0)" }));
    expect(screen.getByText("No new saved matches to review.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Archived (0)" }));

    expect(screen.queryByText("Showing new saved matches")).not.toBeInTheDocument();
    expect(screen.queryByText("No new saved matches to review.")).not.toBeInTheDocument();
    expect(screen.getByText("No saved matches match this filter.")).toBeInTheDocument();
  });

  it("keeps ordering and actions working after the Needs review shortcut safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-summary-shortcut-weak",
            match: {
              id: "match-summary-shortcut-weak",
              audienceItemId: "aud-summary-shortcut-weak",
              solutionItemId: "sol-summary-shortcut-weak",
              matchedPain: "Weak review shortcut match",
              matchedSolutionPattern: "Weak shortcut pattern",
              whyThisMatchWorks: "Weak shortcut fit.",
              suggestedAngle: "weak_shortcut",
              recommendedAction: "save_for_later",
              confidence: "low",
              opportunityStrength: "weak",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "saved-summary-shortcut-strong",
            match: {
              id: "match-summary-shortcut-strong",
              audienceItemId: "aud-summary-shortcut-strong",
              solutionItemId: "sol-summary-shortcut-strong",
              matchedPain: "Strong review shortcut match",
              matchedSolutionPattern: "Strong shortcut pattern",
              whyThisMatchWorks: "Strong shortcut fit.",
              suggestedAngle: "strong_shortcut",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:01.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:01.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Needs review (2)" }));

    const savedMatchesSection = screen.getByText("Saved Matches").closest("section");
    expect(savedMatchesSection).not.toBeNull();

    const savedMatchesText = savedMatchesSection?.textContent ?? "";
    expect(savedMatchesText.indexOf("Strong review shortcut match")).toBeLessThan(
      savedMatchesText.indexOf("Weak review shortcut match")
    );

    await user.click(
      within(savedMatchesSection as HTMLElement).getAllByRole("button", { name: "Mark reviewed" })[0]
    );
    expect(screen.getByText("Marked saved match as reviewed.")).toBeInTheDocument();
    expect(screen.queryByText("Strong review shortcut match")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reviewed (1)" }));
    expect(screen.getByText("Strong review shortcut match")).toBeInTheDocument();
  });

  it("keeps saved match actions working under filtered views safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-filter-action-new",
            match: {
              id: "match-filter-action-new",
              audienceItemId: "aud-filter-action-new",
              solutionItemId: "sol-filter-action-new",
              matchedPain: "Filtered new saved match",
              matchedSolutionPattern: "Filtered pattern",
              whyThisMatchWorks: "Filtered fit.",
              suggestedAngle: "filtered_new",
              recommendedAction: "write_reply",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "New (1)" }));

    const savedMatchesSection = screen.getByText("Saved Matches").closest("section");
    expect(savedMatchesSection).not.toBeNull();

    await user.click(
      within(savedMatchesSection as HTMLElement).getByRole("button", { name: "Mark reviewed" })
    );
    expect(screen.getByText("Marked saved match as reviewed.")).toBeInTheDocument();
    expect(screen.getByText("No new saved matches to review.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reviewed (1)" }));
    await user.click(
      within(savedMatchesSection as HTMLElement).getByRole("button", { name: "Send to Decision Planner" })
    );
    expect(screen.getByLabelText("Decision signal text")).toHaveValue("Filtered new saved match");
    expect(screen.getByText("Sent saved match to Decision Planner.")).toBeInTheDocument();
    expect(screen.getByText("No saved matches match this filter.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Converted (1)" }));
    await user.click(
      within(savedMatchesSection as HTMLElement).getByRole("button", { name: "Archive" })
    );
    expect(screen.getByText("Archived saved match.")).toBeInTheDocument();
    expect(screen.getByText("No saved matches match this filter.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Archived (1)" }));
    expect(
      within(savedMatchesSection as HTMLElement).getByText("Filtered new saved match")
    ).toBeInTheDocument();
  });

  it("renders grouped saved-match actions safely after the review UX cleanup", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-action-layout-new",
            match: {
              id: "match-action-layout-new",
              audienceItemId: "aud-action-layout-new",
              solutionItemId: "sol-action-layout-new",
              matchedPain: "Action layout saved match",
              matchedSolutionPattern: "Action layout pattern",
              whyThisMatchWorks: "Action layout fit.",
              suggestedAngle: "action_layout",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    const savedMatchesSection = screen.getByText("Saved Matches").closest("section");
    expect(savedMatchesSection).not.toBeNull();

    expect(within(savedMatchesSection as HTMLElement).getByText("Convert")).toBeInTheDocument();
    expect(within(savedMatchesSection as HTMLElement).getByText("Review")).toBeInTheDocument();
    expect(
      within(savedMatchesSection as HTMLElement).getByRole("button", { name: "Send to Source Intake" })
    ).toBeInTheDocument();
    expect(
      within(savedMatchesSection as HTMLElement).getByRole("button", { name: "Save for later" })
    ).toBeInTheDocument();
    expect(
      within(savedMatchesSection as HTMLElement).getByRole("button", { name: "Send to Decision Planner" })
    ).toBeInTheDocument();
    expect(
      within(savedMatchesSection as HTMLElement).getByRole("button", { name: "Mark reviewed" })
    ).toBeInTheDocument();
    expect(within(savedMatchesSection as HTMLElement).getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("keeps the primary saved-match review action visually prominent safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-action-primary-new",
            match: {
              id: "match-action-primary-new",
              audienceItemId: "aud-action-primary-new",
              solutionItemId: "sol-action-primary-new",
              matchedPain: "Primary action saved match",
              matchedSolutionPattern: "Primary action pattern",
              whyThisMatchWorks: "Primary action fit.",
              suggestedAngle: "primary_action",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: "Send to Source Intake" }).className).toContain("bg-slate-900");
    expect(screen.getByRole("button", { name: "Send to Source Intake" }).className).toContain("text-white");
  });

  it("emphasizes the decision-planner action for reviewed saved matches safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-action-reviewed",
            match: {
              id: "match-action-reviewed",
              audienceItemId: "aud-action-reviewed",
              solutionItemId: "sol-action-reviewed",
              matchedPain: "Reviewed action saved match",
              matchedSolutionPattern: "Reviewed action pattern",
              whyThisMatchWorks: "Reviewed action fit.",
              suggestedAngle: "reviewed_action",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: "Send to Decision Planner" }).className).toContain(
      "bg-slate-900"
    );
    expect(screen.getByRole("button", { name: "Send to Decision Planner" }).className).toContain(
      "text-white"
    );
    expect(screen.getByRole("button", { name: "Send to Source Intake" }).className).not.toContain(
      "bg-slate-900"
    );
  });

  it("keeps converted and archived saved matches on neutral action emphasis safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-action-converted",
            match: {
              id: "match-action-converted",
              audienceItemId: "aud-action-converted",
              solutionItemId: "sol-action-converted",
              matchedPain: "Converted action saved match",
              matchedSolutionPattern: "Converted action pattern",
              whyThisMatchWorks: "Converted action fit.",
              suggestedAngle: "converted_action",
              recommendedAction: "write_post",
              confidence: "medium",
              opportunityStrength: "medium",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "converted",
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "saved-action-archived",
            match: {
              id: "match-action-archived",
              audienceItemId: "aud-action-archived",
              solutionItemId: "sol-action-archived",
              matchedPain: "Archived action saved match",
              matchedSolutionPattern: "Archived action pattern",
              whyThisMatchWorks: "Archived action fit.",
              suggestedAngle: "archived_action",
              recommendedAction: "write_comment",
              confidence: "low",
              opportunityStrength: "weak",
              createdAt: "2026-03-15T00:00:01.000Z"
            },
            status: "archived",
            createdAt: "2026-03-15T00:00:01.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    const sourceIntakeButtons = screen.getAllByRole("button", { name: "Send to Source Intake" });
    const decisionPlannerButtons = screen.getAllByRole("button", { name: "Send to Decision Planner" });

    for (const button of [...sourceIntakeButtons, ...decisionPlannerButtons]) {
      expect(button.className).not.toContain("bg-slate-900");
      expect(button.className).not.toContain("text-white");
    }
  });

  it("shows an action-specific convert helper for new saved matches safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-convert-hint-new",
            match: {
              id: "match-convert-hint-new",
              audienceItemId: "aud-convert-hint-new",
              solutionItemId: "sol-convert-hint-new",
              matchedPain: "Convert hint new match",
              matchedSolutionPattern: "Convert hint new pattern",
              whyThisMatchWorks: "Convert hint new fit.",
              suggestedAngle: "convert_hint_new",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    expect(screen.getByText("Best for fresh opportunity intake")).toBeInTheDocument();
    expect(screen.queryByText("Recommended next step")).not.toBeInTheDocument();
  });

  it("shows an action-specific convert helper for reviewed saved matches safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-convert-hint-reviewed",
            match: {
              id: "match-convert-hint-reviewed",
              audienceItemId: "aud-convert-hint-reviewed",
              solutionItemId: "sol-convert-hint-reviewed",
              matchedPain: "Convert hint reviewed match",
              matchedSolutionPattern: "Convert hint reviewed pattern",
              whyThisMatchWorks: "Convert hint reviewed fit.",
              suggestedAngle: "convert_hint_reviewed",
              recommendedAction: "write_comment",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    expect(screen.getByText("Best for planner-ready review")).toBeInTheDocument();
    expect(screen.queryByText("Recommended next step")).not.toBeInTheDocument();
  });

  it("keeps the action-specific convert helper quiet for converted and archived saved matches safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-convert-hint-converted",
            match: {
              id: "match-convert-hint-converted",
              audienceItemId: "aud-convert-hint-converted",
              solutionItemId: "sol-convert-hint-converted",
              matchedPain: "Convert hint converted match",
              matchedSolutionPattern: "Convert hint converted pattern",
              whyThisMatchWorks: "Convert hint converted fit.",
              suggestedAngle: "convert_hint_converted",
              recommendedAction: "write_post",
              confidence: "medium",
              opportunityStrength: "medium",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "converted",
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "saved-convert-hint-archived",
            match: {
              id: "match-convert-hint-archived",
              audienceItemId: "aud-convert-hint-archived",
              solutionItemId: "sol-convert-hint-archived",
              matchedPain: "Convert hint archived match",
              matchedSolutionPattern: "Convert hint archived pattern",
              whyThisMatchWorks: "Convert hint archived fit.",
              suggestedAngle: "convert_hint_archived",
              recommendedAction: "write_comment",
              confidence: "low",
              opportunityStrength: "weak",
              createdAt: "2026-03-15T00:00:01.000Z"
            },
            status: "archived",
            createdAt: "2026-03-15T00:00:01.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    expect(screen.queryByText("Best for fresh opportunity intake")).not.toBeInTheDocument();
    expect(screen.queryByText("Best for planner-ready review")).not.toBeInTheDocument();
    expect(screen.queryByText("Recommended next step")).not.toBeInTheDocument();
  });

  it("searches saved matches by matched pain safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-search-pain-target",
            match: {
              id: "match-search-pain-target",
              audienceItemId: "aud-search-pain-target",
              solutionItemId: "sol-search-pain-target",
              matchedPain: "Pipeline review blocker",
              matchedSolutionPattern: "Ops pattern",
              whyThisMatchWorks: "Helpful fit.",
              suggestedAngle: "pain_search",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "saved-search-pain-other",
            match: {
              id: "match-search-pain-other",
              audienceItemId: "aud-search-pain-other",
              solutionItemId: "sol-search-pain-other",
              matchedPain: "Pricing operations note",
              matchedSolutionPattern: "Growth pattern",
              whyThisMatchWorks: "Other fit.",
              suggestedAngle: "pain_other",
              recommendedAction: "write_comment",
              confidence: "medium",
              opportunityStrength: "medium",
              createdAt: "2026-03-15T00:00:01.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:01.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText("Search saved matches"), "blocker");

    expect(screen.getByText("Pipeline review blocker")).toBeInTheDocument();
    expect(screen.queryByText("Pricing operations note")).not.toBeInTheDocument();
  });

  it("searches saved matches by solution pattern and why-this-match-works safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-search-solution-target",
            match: {
              id: "match-search-solution-target",
              audienceItemId: "aud-search-solution-target",
              solutionItemId: "sol-search-solution-target",
              matchedPain: "General pain note",
              matchedSolutionPattern: "Planner workflow template",
              whyThisMatchWorks: "Useful for review triage.",
              suggestedAngle: "solution_search",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "saved-search-solution-other",
            match: {
              id: "match-search-solution-other",
              audienceItemId: "aud-search-solution-other",
              solutionItemId: "sol-search-solution-other",
              matchedPain: "Other pain note",
              matchedSolutionPattern: "Audience discovery pattern",
              whyThisMatchWorks: "Different fit.",
              suggestedAngle: "solution_other",
              recommendedAction: "write_comment",
              confidence: "medium",
              opportunityStrength: "medium",
              createdAt: "2026-03-15T00:00:01.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:01.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText("Search saved matches"), "workflow");
    expect(screen.getByText("General pain note")).toBeInTheDocument();
    expect(screen.queryByText("Other pain note")).not.toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText("Search saved matches"));
    await user.type(screen.getByPlaceholderText("Search saved matches"), "review triage");
    expect(screen.getByText("General pain note")).toBeInTheDocument();
    expect(screen.queryByText("Other pain note")).not.toBeInTheDocument();
  });

  it("combines saved-match search safely with status filters and preserves ordering", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-search-order-weak",
            match: {
              id: "match-search-order-weak",
              audienceItemId: "aud-search-order-weak",
              solutionItemId: "sol-search-order-weak",
              matchedPain: "Search ordering match weak",
              matchedSolutionPattern: "Alpha segment",
              whyThisMatchWorks: "Shared keyword fit.",
              suggestedAngle: "order_weak",
              recommendedAction: "save_for_later",
              confidence: "low",
              opportunityStrength: "weak",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "saved-search-order-strong",
            match: {
              id: "match-search-order-strong",
              audienceItemId: "aud-search-order-strong",
              solutionItemId: "sol-search-order-strong",
              matchedPain: "Search ordering match strong",
              matchedSolutionPattern: "Alpha workflow",
              whyThisMatchWorks: "Shared keyword fit.",
              suggestedAngle: "order_strong",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:01.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:01.000Z"
          },
          {
            id: "saved-search-order-reviewed",
            match: {
              id: "match-search-order-reviewed",
              audienceItemId: "aud-search-order-reviewed",
              solutionItemId: "sol-search-order-reviewed",
              matchedPain: "Reviewed search ordering match",
              matchedSolutionPattern: "Alpha review",
              whyThisMatchWorks: "Shared keyword fit.",
              suggestedAngle: "order_reviewed",
              recommendedAction: "write_comment",
              confidence: "medium",
              opportunityStrength: "medium",
              createdAt: "2026-03-15T00:00:02.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:02.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "New (2)" }));
    await user.type(screen.getByPlaceholderText("Search saved matches"), "alpha");

    expect(screen.queryByText("Reviewed search ordering match")).not.toBeInTheDocument();

    const savedMatchesSection = screen.getByText("Saved Matches").closest("section");
    const savedMatchesText = savedMatchesSection?.textContent ?? "";
    expect(savedMatchesText.indexOf("Search ordering match strong")).toBeLessThan(
      savedMatchesText.indexOf("Search ordering match weak")
    );
  });

  it("renders a safe empty state for saved-match search and keeps actions working under searched views safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-search-action-new",
            match: {
              id: "match-search-action-new",
              audienceItemId: "aud-search-action-new",
              solutionItemId: "sol-search-action-new",
              matchedPain: "Findable saved match",
              matchedSolutionPattern: "Searchable ops pattern",
              whyThisMatchWorks: "Searchable review fit.",
              suggestedAngle: "search_action",
              recommendedAction: "write_reply",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText("Search saved matches"), "findable");

    const savedMatchesSection = screen.getByText("Saved Matches").closest("section");
    expect(savedMatchesSection).not.toBeNull();

    await user.click(
      within(savedMatchesSection as HTMLElement).getByRole("button", { name: "Mark reviewed" })
    );
    expect(screen.getByText("Marked saved match as reviewed.")).toBeInTheDocument();
    expect(screen.queryByText("Findable saved match")).toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText("Search saved matches"));
    await user.type(screen.getByPlaceholderText("Search saved matches"), "missing");
    expect(screen.getByText("No saved matches match this search.")).toBeInTheDocument();
  });

  it("shows a compact saved-match search result count and clears the query safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-search-affordance-one",
            match: {
              id: "match-search-affordance-one",
              audienceItemId: "aud-search-affordance-one",
              solutionItemId: "sol-search-affordance-one",
              matchedPain: "Search affordance alpha",
              matchedSolutionPattern: "Alpha pattern",
              whyThisMatchWorks: "Alpha fit.",
              suggestedAngle: "search_affordance_alpha",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "saved-search-affordance-two",
            match: {
              id: "match-search-affordance-two",
              audienceItemId: "aud-search-affordance-two",
              solutionItemId: "sol-search-affordance-two",
              matchedPain: "Search affordance beta",
              matchedSolutionPattern: "Beta pattern",
              whyThisMatchWorks: "Beta fit.",
              suggestedAngle: "search_affordance_beta",
              recommendedAction: "write_comment",
              confidence: "medium",
              opportunityStrength: "medium",
              createdAt: "2026-03-15T00:00:01.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:01.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
    expect(screen.queryByText("1 match")).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Search saved matches"), "alpha");

    expect(screen.getByText("1 match")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear search" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear search" }));

    expect(screen.getByPlaceholderText("Search saved matches")).toHaveValue("");
    expect(screen.queryByText("1 match")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
    expect(screen.getByText("Search affordance alpha")).toBeInTheDocument();
    expect(screen.getByText("Search affordance beta")).toBeInTheDocument();
  });

  it("keeps saved-match search affordances working with active status filters safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-search-filter-new-weak",
            match: {
              id: "match-search-filter-new-weak",
              audienceItemId: "aud-search-filter-new-weak",
              solutionItemId: "sol-search-filter-new-weak",
              matchedPain: "Filtered search weak alpha",
              matchedSolutionPattern: "Alpha weak pattern",
              whyThisMatchWorks: "Weak alpha fit.",
              suggestedAngle: "filter_search_weak",
              recommendedAction: "save_for_later",
              confidence: "low",
              opportunityStrength: "weak",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "saved-search-filter-new-strong",
            match: {
              id: "match-search-filter-new-strong",
              audienceItemId: "aud-search-filter-new-strong",
              solutionItemId: "sol-search-filter-new-strong",
              matchedPain: "Filtered search strong alpha",
              matchedSolutionPattern: "Alpha strong pattern",
              whyThisMatchWorks: "Strong alpha fit.",
              suggestedAngle: "filter_search_strong",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:01.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:01.000Z"
          },
          {
            id: "saved-search-filter-reviewed",
            match: {
              id: "match-search-filter-reviewed",
              audienceItemId: "aud-search-filter-reviewed",
              solutionItemId: "sol-search-filter-reviewed",
              matchedPain: "Filtered search reviewed alpha",
              matchedSolutionPattern: "Alpha reviewed pattern",
              whyThisMatchWorks: "Reviewed alpha fit.",
              suggestedAngle: "filter_search_reviewed",
              recommendedAction: "write_comment",
              confidence: "medium",
              opportunityStrength: "medium",
              createdAt: "2026-03-15T00:00:02.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:02.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "New (2)" }));
    await user.type(screen.getByPlaceholderText("Search saved matches"), "alpha");

    expect(screen.getByText("2 new matches")).toBeInTheDocument();
    expect(screen.queryByText("Filtered search reviewed alpha")).not.toBeInTheDocument();

    const savedMatchesSection = screen.getByText("Saved Matches").closest("section");
    const savedMatchesText = savedMatchesSection?.textContent ?? "";
    expect(savedMatchesText.indexOf("Filtered search strong alpha")).toBeLessThan(
      savedMatchesText.indexOf("Filtered search weak alpha")
    );

    await user.click(screen.getByRole("button", { name: "Clear search" }));

    expect(screen.queryByText("2 new matches")).not.toBeInTheDocument();
    expect(screen.queryByText("Filtered search reviewed alpha")).not.toBeInTheDocument();
    expect(screen.getByText("Filtered search strong alpha")).toBeInTheDocument();
    expect(screen.getByText("Filtered search weak alpha")).toBeInTheDocument();
  });

  it("shows an in-place recovery affordance for empty saved-match search safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-search-recovery",
            match: {
              id: "match-search-recovery",
              audienceItemId: "aud-search-recovery",
              solutionItemId: "sol-search-recovery",
              matchedPain: "Recoverable saved match",
              matchedSolutionPattern: "Recovery pattern",
              whyThisMatchWorks: "Recovery fit.",
              suggestedAngle: "search_recovery",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText("Search saved matches"), "missing");

    expect(screen.getByText("No saved matches match this search.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear search" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Clear search" })).toHaveLength(1);
  });

  it("clears saved-match search safely from the empty state and preserves active filters", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-search-recovery-new",
            match: {
              id: "match-search-recovery-new",
              audienceItemId: "aud-search-recovery-new",
              solutionItemId: "sol-search-recovery-new",
              matchedPain: "Recovery new alpha",
              matchedSolutionPattern: "Recovery new pattern",
              whyThisMatchWorks: "Recovery new fit.",
              suggestedAngle: "search_recovery_new",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "saved-search-recovery-reviewed",
            match: {
              id: "match-search-recovery-reviewed",
              audienceItemId: "aud-search-recovery-reviewed",
              solutionItemId: "sol-search-recovery-reviewed",
              matchedPain: "Recovery reviewed alpha",
              matchedSolutionPattern: "Recovery reviewed pattern",
              whyThisMatchWorks: "Recovery reviewed fit.",
              suggestedAngle: "search_recovery_reviewed",
              recommendedAction: "write_comment",
              confidence: "medium",
              opportunityStrength: "medium",
              createdAt: "2026-03-15T00:00:01.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:01.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Reviewed (1)" }));
    await user.type(screen.getByPlaceholderText("Search saved matches"), "missing");

    expect(screen.getByText("No reviewed saved matches match this search.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear search" }));

    expect(screen.getByPlaceholderText("Search saved matches")).toHaveValue("");
    expect(screen.queryByText("No reviewed saved matches match this search.")).not.toBeInTheDocument();
    expect(screen.getByText("Recovery reviewed alpha")).toBeInTheDocument();
    expect(screen.queryByText("Recovery new alpha")).not.toBeInTheDocument();
  });

  it("keeps the empty-state recovery affordance scoped away from non-search empty states safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-search-recovery-scoped",
            match: {
              id: "match-search-recovery-scoped",
              audienceItemId: "aud-search-recovery-scoped",
              solutionItemId: "sol-search-recovery-scoped",
              matchedPain: "Scoped recovery item",
              matchedSolutionPattern: "Scoped pattern",
              whyThisMatchWorks: "Scoped fit.",
              suggestedAngle: "search_recovery_scoped",
              recommendedAction: "write_reply",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "New (0)" }));

    expect(screen.getByText("No new saved matches to review.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
  });

  it("shows contextual reviewed empty-search copy safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-search-context-reviewed",
            match: {
              id: "match-search-context-reviewed",
              audienceItemId: "aud-search-context-reviewed",
              solutionItemId: "sol-search-context-reviewed",
              matchedPain: "Reviewed context item",
              matchedSolutionPattern: "Reviewed context pattern",
              whyThisMatchWorks: "Reviewed context fit.",
              suggestedAngle: "search_context_reviewed",
              recommendedAction: "write_reply",
              confidence: "medium",
              opportunityStrength: "medium",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Reviewed (1)" }));
    await user.type(screen.getByPlaceholderText("Search saved matches"), "missing");

    expect(screen.getByText("No reviewed saved matches match this search.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Clear search" })).toHaveLength(1);
  });

  it("shows contextual converted and archived empty-search copy safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-search-context-converted",
            match: {
              id: "match-search-context-converted",
              audienceItemId: "aud-search-context-converted",
              solutionItemId: "sol-search-context-converted",
              matchedPain: "Converted context item",
              matchedSolutionPattern: "Converted context pattern",
              whyThisMatchWorks: "Converted context fit.",
              suggestedAngle: "search_context_converted",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "converted",
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "saved-search-context-archived",
            match: {
              id: "match-search-context-archived",
              audienceItemId: "aud-search-context-archived",
              solutionItemId: "sol-search-context-archived",
              matchedPain: "Archived context item",
              matchedSolutionPattern: "Archived context pattern",
              whyThisMatchWorks: "Archived context fit.",
              suggestedAngle: "search_context_archived",
              recommendedAction: "save_for_later",
              confidence: "low",
              opportunityStrength: "weak",
              createdAt: "2026-03-15T00:00:01.000Z"
            },
            status: "archived",
            createdAt: "2026-03-15T00:00:01.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Converted (1)" }));
    await user.type(screen.getByPlaceholderText("Search saved matches"), "missing");
    expect(screen.getByText("No converted saved matches match this search.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear search" }));
    await user.click(screen.getByRole("button", { name: "Archived (1)" }));
    await user.type(screen.getByPlaceholderText("Search saved matches"), "missing");
    expect(screen.getByText("No archived saved matches match this search.")).toBeInTheDocument();
  });

  it("keeps the top-level clear-search hidden only in empty searched states safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-search-density-one",
            match: {
              id: "match-search-density-one",
              audienceItemId: "aud-search-density-one",
              solutionItemId: "sol-search-density-one",
              matchedPain: "Density alpha result",
              matchedSolutionPattern: "Density pattern",
              whyThisMatchWorks: "Density fit.",
              suggestedAngle: "search_density",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText("Search saved matches"), "alpha");
    expect(screen.getAllByRole("button", { name: "Clear search" })).toHaveLength(1);
    expect(screen.queryByText("No saved matches match this search.")).not.toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText("Search saved matches"));
    await user.type(screen.getByPlaceholderText("Search saved matches"), "missing");
    expect(screen.getByText("No saved matches match this search.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Clear search" })).toHaveLength(1);
  });

  it("shows a compact search-context cue for filtered saved-match searches safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-search-context-cue-new",
            match: {
              id: "match-search-context-cue-new",
              audienceItemId: "aud-search-context-cue-new",
              solutionItemId: "sol-search-context-cue-new",
              matchedPain: "Search cue new item",
              matchedSolutionPattern: "Cue new pattern",
              whyThisMatchWorks: "Cue new fit.",
              suggestedAngle: "search_context_cue_new",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "saved-search-context-cue-reviewed",
            match: {
              id: "match-search-context-cue-reviewed",
              audienceItemId: "aud-search-context-cue-reviewed",
              solutionItemId: "sol-search-context-cue-reviewed",
              matchedPain: "Search cue reviewed item",
              matchedSolutionPattern: "Cue reviewed pattern",
              whyThisMatchWorks: "Cue reviewed fit.",
              suggestedAngle: "search_context_cue_reviewed",
              recommendedAction: "write_reply",
              confidence: "medium",
              opportunityStrength: "medium",
              createdAt: "2026-03-15T00:00:01.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:01.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "New (1)" }));
    expect(screen.getByText("Showing new saved matches")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Search saved matches"), "cue");

    expect(
      screen.getByText("Searching within new saved matches. Clear search keeps this filter.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Showing new saved matches")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear search" }));
    await user.click(screen.getByRole("button", { name: "Reviewed (1)" }));
    await user.type(screen.getByPlaceholderText("Search saved matches"), "cue");

    expect(
      screen.getByText("Searching within reviewed saved matches. Clear search keeps this filter.")
    ).toBeInTheDocument();
  });

  it("keeps the search-context cue quiet when saved-match search is inactive safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-search-context-quiet",
            match: {
              id: "match-search-context-quiet",
              audienceItemId: "aud-search-context-quiet",
              solutionItemId: "sol-search-context-quiet",
              matchedPain: "Search quiet item",
              matchedSolutionPattern: "Quiet pattern",
              whyThisMatchWorks: "Quiet fit.",
              suggestedAngle: "search_context_quiet",
              recommendedAction: "write_reply",
              confidence: "medium",
              opportunityStrength: "medium",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    expect(screen.queryByText("Searching across all saved matches")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Searching within reviewed saved matches. Clear search keeps this filter.")
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reviewed (1)" }));
    expect(
      screen.queryByText("Searching within reviewed saved matches. Clear search keeps this filter.")
    ).not.toBeInTheDocument();
  });

  it("shows an all-saved search-context cue safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-search-context-all-cue",
            match: {
              id: "match-search-context-all-cue",
              audienceItemId: "aud-search-context-all-cue",
              solutionItemId: "sol-search-context-all-cue",
              matchedPain: "Search all cue item",
              matchedSolutionPattern: "All cue pattern",
              whyThisMatchWorks: "All cue fit.",
              suggestedAngle: "search_context_all_cue",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText("Search saved matches"), "cue");

    expect(screen.getByText("Searching across all saved matches")).toBeInTheDocument();
    expect(screen.getByText("1 match")).toBeInTheDocument();
  });

  it("keeps filtered search reset clarity explicit without changing chip behavior safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-search-reset-clarity-reviewed",
            match: {
              id: "match-search-reset-clarity-reviewed",
              audienceItemId: "aud-search-reset-clarity-reviewed",
              solutionItemId: "sol-search-reset-clarity-reviewed",
              matchedPain: "Reset clarity reviewed item",
              matchedSolutionPattern: "Reset clarity pattern",
              whyThisMatchWorks: "Reset clarity fit.",
              suggestedAngle: "search_reset_clarity",
              recommendedAction: "write_reply",
              confidence: "medium",
              opportunityStrength: "medium",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "saved-search-reset-clarity-new",
            match: {
              id: "match-search-reset-clarity-new",
              audienceItemId: "aud-search-reset-clarity-new",
              solutionItemId: "sol-search-reset-clarity-new",
              matchedPain: "Reset clarity new item",
              matchedSolutionPattern: "Reset clarity new pattern",
              whyThisMatchWorks: "Reset clarity new fit.",
              suggestedAngle: "search_reset_clarity_new",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:01.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:01.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Reviewed (1)" }));
    await user.type(screen.getByPlaceholderText("Search saved matches"), "clarity");

    expect(
      screen.getByText("Searching within reviewed saved matches. Clear search keeps this filter.")
    ).toBeInTheDocument();
    expect(screen.getByText("1 reviewed match")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear search" }));

    expect(screen.queryByText("1 reviewed match")).not.toBeInTheDocument();
    expect(screen.getByText("Reset clarity reviewed item")).toBeInTheDocument();
    expect(screen.queryByText("Reset clarity new item")).not.toBeInTheDocument();
  });

  it("keeps the saved-match search row affordances visible together in active filtered search safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-search-density-reviewed-one",
            match: {
              id: "match-search-density-reviewed-one",
              audienceItemId: "aud-search-density-reviewed-one",
              solutionItemId: "sol-search-density-reviewed-one",
              matchedPain: "Density reviewed alpha",
              matchedSolutionPattern: "Density reviewed pattern",
              whyThisMatchWorks: "Density reviewed fit.",
              suggestedAngle: "search_density_reviewed_alpha",
              recommendedAction: "write_reply",
              confidence: "medium",
              opportunityStrength: "medium",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "saved-search-density-reviewed-two",
            match: {
              id: "match-search-density-reviewed-two",
              audienceItemId: "aud-search-density-reviewed-two",
              solutionItemId: "sol-search-density-reviewed-two",
              matchedPain: "Density reviewed beta",
              matchedSolutionPattern: "Density reviewed pattern",
              whyThisMatchWorks: "Density reviewed fit.",
              suggestedAngle: "search_density_reviewed_beta",
              recommendedAction: "write_comment",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:01.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:01.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Reviewed (2)" }));
    await user.type(screen.getByPlaceholderText("Search saved matches"), "density");

    expect(screen.getByPlaceholderText("Search saved matches")).toHaveValue("density");
    expect(screen.getByText("2 reviewed matches")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear search" })).toBeInTheDocument();
    expect(
      screen.getByText("Searching within reviewed saved matches. Clear search keeps this filter.")
    ).toBeInTheDocument();
  });

  it("shows a scoped search count for reviewed saved-match searches safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-search-count-reviewed-one",
            match: {
              id: "match-search-count-reviewed-one",
              audienceItemId: "aud-search-count-reviewed-one",
              solutionItemId: "sol-search-count-reviewed-one",
              matchedPain: "Reviewed count alpha",
              matchedSolutionPattern: "Reviewed count pattern",
              whyThisMatchWorks: "Reviewed count fit.",
              suggestedAngle: "search_count_reviewed_alpha",
              recommendedAction: "write_reply",
              confidence: "medium",
              opportunityStrength: "medium",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "saved-search-count-reviewed-two",
            match: {
              id: "match-search-count-reviewed-two",
              audienceItemId: "aud-search-count-reviewed-two",
              solutionItemId: "sol-search-count-reviewed-two",
              matchedPain: "Reviewed count beta",
              matchedSolutionPattern: "Reviewed count pattern",
              whyThisMatchWorks: "Reviewed count fit.",
              suggestedAngle: "search_count_reviewed_beta",
              recommendedAction: "write_comment",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:01.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:01.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Reviewed (2)" }));
    await user.type(screen.getByPlaceholderText("Search saved matches"), "reviewed");

    expect(screen.getByText("2 reviewed matches")).toBeInTheDocument();
  });

  it("keeps all-filter search-empty copy generic safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-search-context-all",
            match: {
              id: "match-search-context-all",
              audienceItemId: "aud-search-context-all",
              solutionItemId: "sol-search-context-all",
              matchedPain: "All context item",
              matchedSolutionPattern: "All context pattern",
              whyThisMatchWorks: "All context fit.",
              suggestedAngle: "search_context_all",
              recommendedAction: "write_reply",
              confidence: "medium",
              opportunityStrength: "medium",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "new",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText("Search saved matches"), "missing");

    expect(screen.getByText("No saved matches match this search.")).toBeInTheDocument();
    expect(screen.queryByText("No new saved matches match this search.")).not.toBeInTheDocument();
  });

  it("ignores malformed saved matches storage safely", async () => {
    window.localStorage.setItem("linkedin-brand-os:saved-matches", "{not-json");

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    expect(screen.queryByText("Saved Matches")).not.toBeInTheDocument();
  });

  it("generates compact AI content prep only for reviewed saved matches safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-match-content-reviewed",
            match: {
              id: "match-content-reviewed",
              audienceItemId: "aud-content-reviewed",
              solutionItemId: "sol-content-reviewed",
              matchedPain: "Reviewed workflow accountability pattern",
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
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/matches/content/generate") && method === "POST") {
        const payload = JSON.parse(String(init?.body)) as {
          savedMatch: Record<string, unknown>;
        };

        return jsonResponse(
          {
            ...payload.savedMatch,
            match: {
              ...(payload.savedMatch.match as Record<string, unknown>),
              aiContent: {
                contentIdea: "Post idea about ownership clarity after launch.",
                draftAngle: "Tie visibility to clear recovery ownership.",
                postSeed:
                  "Most rollout friction is ownership friction, not tooling friction."
              }
            }
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Generate content prep" }));

    await waitFor(() =>
      expect(
        screen.getByText("Generated compact AI content prep for the reviewed saved match.")
      ).toBeInTheDocument()
    );
    expect(screen.getByText("AI content prep")).toBeInTheDocument();
    expect(screen.getByText(/Content idea:/i)).toBeInTheDocument();
    expect(screen.getByText(/Draft angle:/i)).toBeInTheDocument();
    expect(screen.getByText(/Post seed:/i)).toBeInTheDocument();
  });

  it("stores raw live ingestion items and dedupes normalized duplicates safely", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Live Ingestion Buffer")).toBeInTheDocument());

    await user.type(
      screen.getByLabelText("Raw live inputs"),
      "Operators are still patching the rollout handoff manually.\n\noperators are still patching the rollout handoff manually!!!"
    );
    await user.click(screen.getByRole("button", { name: "Add to Live Buffer" }));

    await waitFor(() => {
      expect(
        screen.getByText("Added 1 live ingestion item and skipped 1 duplicate.")
      ).toBeInTheDocument();
      expect(
        screen.getByText("Operators are still patching the rollout handoff manually.")
      ).toBeInTheDocument();
    });

    const stored = JSON.parse(
      window.localStorage.getItem("linkedin-brand-os:live-ingestion-buffer") ?? '{"items":[]}'
    ) as { items: Array<{ rawExcerpt: string; status: string }> };

    expect(stored.items).toHaveLength(1);
    expect(stored.items[0]?.status).toBe("new");
  });

  it("reloads persisted live ingestion items safely from localStorage", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-1",
            sourceKind: "watched_url_snapshot",
            sourceLabel: "Ops snapshot",
            sourceUrl: "https://example.com/discussion/1",
            rawExcerpt: "Operators are still patching the rollout handoff manually.",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "watched-url-snapshot-example-com-discussion-1",
            status: "new",
            notes: "Captured from a watched URL snapshot."
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Live Ingestion Buffer")).toBeInTheDocument();
      expect(screen.getByText("Ops snapshot")).toBeInTheDocument();
      expect(
        screen.getByText("Operators are still patching the rollout handoff manually.")
      ).toBeInTheDocument();
      expect(screen.getByText("new")).toBeInTheDocument();
    });
  });

  it("updates live ingestion item statuses and sends buffered items into Scout Feed safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-1",
            sourceKind: "public_excerpt",
            sourceLabel: "Ops discussion",
            rawExcerpt: "Operators are flagging broken handoffs after launch.",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "public-excerpt-broken-handoffs-after-launch",
            status: "new"
          }
        ]
      })
    );

    let scoutFeedPayload: Record<string, unknown> | null = null;

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/scout/feed") && method === "POST") {
        scoutFeedPayload = JSON.parse(String(init?.body));
        return jsonResponse(
          {
            audienceItems: [
              {
                id: "aud-1",
                sourcePlatform: "public_web",
                rawExcerpt: "Operators are flagging broken handoffs after launch.",
                painSignalSummary: "Operators are flagging broken handoffs after launch.",
                whyItMatters: "This exposes workflow-accountability pain.",
                suggestedActionType: "post_candidate",
                confidence: "high",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 scout feed items processed.",
            notes: "Scout Feed stays review-first."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Live Ingestion Buffer")).toBeInTheDocument());

    await waitFor(() => {
      expect(screen.getByText("Ops discussion")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Send to Scout Feed" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Send to Scout Feed" }));

    await waitFor(() => {
      expect(scoutFeedPayload).toEqual(
        expect.objectContaining({
          mode: "mixed",
          items: [
            expect.objectContaining({
              sourceType: "public_web",
              excerpt: "Operators are flagging broken handoffs after launch."
            })
          ]
        })
      );
      expect(screen.getByText("Sent live ingestion item to Scout Feed.")).toBeInTheDocument();
      expect(screen.getAllByText("sent_to_feed").length).toBeGreaterThan(0);
      expect(
        screen.getAllByText("Operators are flagging broken handoffs after launch.").length
      ).toBeGreaterThan(1);
    });

    let stored = JSON.parse(
      window.localStorage.getItem("linkedin-brand-os:live-ingestion-buffer") ?? '{"items":[]}'
    ) as { items: Array<{ status: string }> };
    expect(stored.items[0]?.status).toBe("sent_to_feed");

    await user.click(screen.getByRole("button", { name: "Archive" }));
    expect(screen.getByText("Archived live ingestion item.")).toBeInTheDocument();

    stored = JSON.parse(
      window.localStorage.getItem("linkedin-brand-os:live-ingestion-buffer") ?? '{"items":[]}'
    ) as { items: Array<{ status: string }> };
    expect(stored.items[0]?.status).toBe("archived");
  });

  it("discards live ingestion items safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-1",
            sourceKind: "manual_feed_snapshot",
            sourceLabel: "Manual snapshot",
            rawExcerpt: "This input is too weak to keep.",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "manual-feed-snapshot-too-weak",
            status: "new"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Manual snapshot")).toBeInTheDocument());

    await waitFor(() => {
      expect(screen.getByText("Manual snapshot")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Discard" }));

    expect(screen.getByText("Discarded live ingestion item.")).toBeInTheDocument();

    const stored = JSON.parse(
      window.localStorage.getItem("linkedin-brand-os:live-ingestion-buffer") ?? '{"items":[]}'
    ) as { items: Array<{ status: string }> };
    expect(stored.items[0]?.status).toBe("discarded");
  });

  it("ignores malformed live ingestion buffer storage safely", async () => {
    window.localStorage.setItem("linkedin-brand-os:live-ingestion-buffer", "{not-json");

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    expect(screen.getByText("Live Ingestion Buffer")).toBeInTheDocument();
    expect(screen.queryByText("sent_to_feed")).not.toBeInTheDocument();
  });

  it("selects multiple eligible live ingestion items and sends the selected subset to Scout Feed", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-1",
            sourceKind: "public_excerpt",
            sourceLabel: "Ops thread one",
            rawExcerpt: "Operators are flagging broken handoffs after launch.",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "public-excerpt-handoffs-after-launch",
            status: "new"
          },
          {
            id: "ingestion-2",
            sourceKind: "article_watch_snapshot",
            sourceLabel: "Ops article two",
            sourceUrl: "https://example.com/article/2",
            rawExcerpt: "The team exposed workflow status before handoffs stalled.",
            capturedAt: "2026-03-15T00:05:00.000Z",
            fingerprint: "article-watch-status-before-handoffs-stalled",
            status: "new"
          }
        ]
      })
    );

    let scoutFeedPayload: Record<string, unknown> | null = null;

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/scout/feed") && method === "POST") {
        scoutFeedPayload = JSON.parse(String(init?.body));
        return jsonResponse(
          {
            audienceItems: [
              {
                id: "aud-1",
                sourcePlatform: "public_web",
                rawExcerpt: "Operators are flagging broken handoffs after launch.",
                painSignalSummary: "Operators are flagging broken handoffs after launch.",
                whyItMatters: "This exposes workflow-accountability pain.",
                suggestedActionType: "post_candidate",
                confidence: "high",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            solutionItems: [
              {
                id: "sol-1",
                sourceType: "article",
                rawExcerpt: "The team exposed workflow status before handoffs stalled.",
                solutionPattern: "Visibility and coordination pattern",
                implementationLesson: "Expose status before handoffs stall.",
                tradeoffOrConstraint: "Visibility adds coordination overhead.",
                whyItMatters: "Useful operator lesson.",
                suggestedAngle: "workflow_accountability",
                suggestedActionType: "post_candidate",
                confidence: "high",
                createdAt: "2026-03-15T00:05:00.000Z"
              }
            ],
            summary: "2 scout feed items processed.",
            notes: "Scout Feed stays review-first."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Live Ingestion Buffer")).toBeInTheDocument());

    await user.click(screen.getByLabelText("Select live ingestion item ingestion-1"));
    await user.click(screen.getByLabelText("Select live ingestion item ingestion-2"));

    expect(screen.getByText("2 selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Send selected to Scout Feed" }));

    await waitFor(() => {
      expect(scoutFeedPayload).toEqual(
        expect.objectContaining({
          mode: "mixed",
          items: [
            expect.objectContaining({
              sourceType: "public_web",
              excerpt: "Operators are flagging broken handoffs after launch."
            }),
            expect.objectContaining({
              sourceType: "article",
              excerpt: "The team exposed workflow status before handoffs stalled."
            })
          ]
        })
      );
      expect(screen.getByText("Sent 2 selected live ingestion items to Scout Feed.")).toBeInTheDocument();
    });

    const stored = JSON.parse(
      window.localStorage.getItem("linkedin-brand-os:live-ingestion-buffer") ?? '{"items":[]}'
    ) as { items: Array<{ id: string; status: string }> };

    expect(stored.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "ingestion-1", status: "sent_to_feed" }),
        expect.objectContaining({ id: "ingestion-2", status: "sent_to_feed" })
      ])
    );
  });

  it("skips ineligible live ingestion items safely during batch send", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-1",
            sourceKind: "public_excerpt",
            sourceLabel: "Eligible item",
            rawExcerpt: "Operators are flagging broken handoffs after launch.",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "eligible-item",
            status: "new"
          },
          {
            id: "ingestion-2",
            sourceKind: "manual_feed_snapshot",
            sourceLabel: "Already sent item",
            rawExcerpt: "This one was already sent.",
            capturedAt: "2026-03-15T00:05:00.000Z",
            fingerprint: "already-sent-item",
            status: "sent_to_feed"
          },
          {
            id: "ingestion-3",
            sourceKind: "manual_feed_snapshot",
            sourceLabel: "Archived item",
            rawExcerpt: "This one is archived.",
            capturedAt: "2026-03-15T00:06:00.000Z",
            fingerprint: "archived-item",
            status: "archived"
          }
        ]
      })
    );

    let scoutFeedPayload: Record<string, unknown> | null = null;

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/scout/feed") && method === "POST") {
        scoutFeedPayload = JSON.parse(String(init?.body));
        return jsonResponse(
          {
            audienceItems: [
              {
                id: "aud-1",
                sourcePlatform: "public_web",
                rawExcerpt: "Operators are flagging broken handoffs after launch.",
                painSignalSummary: "Operators are flagging broken handoffs after launch.",
                whyItMatters: "This exposes workflow-accountability pain.",
                suggestedActionType: "post_candidate",
                confidence: "high",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 scout feed items processed.",
            notes: "Scout Feed stays review-first."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Live Ingestion Buffer")).toBeInTheDocument());

    await user.click(screen.getByLabelText("Select live ingestion item ingestion-1"));
    await user.click(screen.getByLabelText("Select live ingestion item ingestion-2"));
    await user.click(screen.getByLabelText("Select live ingestion item ingestion-3"));

    await user.click(screen.getByRole("button", { name: "Send selected to Scout Feed" }));

    await waitFor(() => {
      expect(scoutFeedPayload).toEqual(
        expect.objectContaining({
          items: [
            expect.objectContaining({
              excerpt: "Operators are flagging broken handoffs after launch."
            })
          ]
        })
      );
      expect(
        screen.getByText("Sent 1 selected live ingestion item to Scout Feed. Skipped 2 ineligible items.")
      ).toBeInTheDocument();
    });
  });

  it.each([
    ["Draft (1)", "Draft only item", ["Ready item", "Sent item", "Archived item", "Discarded item"]],
    ["New (1)", "Ready item", ["Draft only item", "Sent item", "Archived item", "Discarded item"]],
    ["Sent (1)", "Sent item", ["Draft only item", "Ready item", "Archived item", "Discarded item"]],
    ["Archived (1)", "Archived item", ["Draft only item", "Ready item", "Sent item", "Discarded item"]],
    ["Discarded (1)", "Discarded item", ["Draft only item", "Ready item", "Sent item", "Archived item"]]
  ])("filters live ingestion buffer by %s safely", async (filterLabel, visibleLabel, hiddenLabels) => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-draft-1",
            sourceKind: "public_excerpt",
            sourceLabel: "Draft only item",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "draft-item",
            status: "draft"
          },
          {
            id: "ingestion-new-1",
            sourceKind: "public_excerpt",
            sourceLabel: "Ready item",
            rawExcerpt: "Ready excerpt",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "new-item",
            status: "new"
          },
          {
            id: "ingestion-sent-1",
            sourceKind: "public_excerpt",
            sourceLabel: "Sent item",
            rawExcerpt: "Sent excerpt",
            capturedAt: "2026-03-15T00:02:00.000Z",
            fingerprint: "sent-item",
            status: "sent_to_feed"
          },
          {
            id: "ingestion-archived-1",
            sourceKind: "public_excerpt",
            sourceLabel: "Archived item",
            rawExcerpt: "Archived excerpt",
            capturedAt: "2026-03-15T00:03:00.000Z",
            fingerprint: "archived-item",
            status: "archived"
          },
          {
            id: "ingestion-discarded-1",
            sourceKind: "public_excerpt",
            sourceLabel: "Discarded item",
            rawExcerpt: "Discarded excerpt",
            capturedAt: "2026-03-15T00:04:00.000Z",
            fingerprint: "discarded-item",
            status: "discarded"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Live Ingestion Buffer")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: filterLabel }));

    expect(screen.getByText(visibleLabel)).toBeInTheDocument();
    for (const hidden of hiddenLabels) {
      expect(screen.queryByText(hidden)).not.toBeInTheDocument();
    }
  });

  it("shows all live ingestion items in the default buffer view safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-draft-1",
            sourceKind: "public_excerpt",
            sourceLabel: "Draft only item",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "draft-item",
            status: "draft"
          },
          {
            id: "ingestion-new-1",
            sourceKind: "public_excerpt",
            sourceLabel: "Ready item",
            rawExcerpt: "Ready excerpt",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "new-item",
            status: "new"
          },
          {
            id: "ingestion-sent-1",
            sourceKind: "public_excerpt",
            sourceLabel: "Sent item",
            rawExcerpt: "Sent excerpt",
            capturedAt: "2026-03-15T00:02:00.000Z",
            fingerprint: "sent-item",
            status: "sent_to_feed"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => expect(screen.getByText("Draft only item")).toBeInTheDocument());
    expect(screen.getByText("Ready item")).toBeInTheDocument();
    expect(screen.getByText("Sent item")).toBeInTheDocument();
  });

  it("renders a safe empty state for live ingestion buffer filters", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-new-1",
            sourceKind: "public_excerpt",
            sourceLabel: "Ready item",
            rawExcerpt: "Ready excerpt",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "new-item",
            status: "new"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Ready item")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Draft (0)" }));

    expect(screen.getByText("No buffer items match these filters.")).toBeInTheDocument();
  });

  it("keeps live ingestion item actions working under filtered views safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-draft-1",
            sourceKind: "public_excerpt",
            sourceLabel: "Draft only item",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "draft-item",
            status: "draft"
          },
          {
            id: "ingestion-new-1",
            sourceKind: "public_excerpt",
            sourceLabel: "Ready item",
            rawExcerpt: "Ready excerpt",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "new-item",
            status: "new"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/scout/feed") && method === "POST") {
        return Response.json({
          audienceItems: [],
          solutionItems: [],
          summary: "No strong scout signals found.",
          notes: "Scout Feed stays review-first."
        });
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Draft only item")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Draft (1)" }));
    await user.type(screen.getByLabelText("Draft excerpt ingestion-draft-1"), "Filled draft excerpt");
    await user.click(screen.getByRole("button", { name: "Complete draft" }));

    expect(screen.getByText("Completed draft live ingestion item.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New (2)" }));
    await user.click(screen.getAllByRole("button", { name: "Archive" })[0]);

    expect(screen.getByText("Archived live ingestion item.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Archived (1)" }));
    expect(screen.getByText("Ready item")).toBeInTheDocument();
  });

  it("filters live ingestion buffer by manual origin safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-manual-1",
            sourceKind: "public_excerpt",
            sourceLabel: "Manual item",
            rawExcerpt: "Manual excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "manual-item",
            status: "new",
            origin: "manual"
          },
          {
            id: "ingestion-refresh-1",
            sourceKind: "watched_url_snapshot",
            sourceLabel: "Refresh item",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "refresh-item",
            status: "draft",
            origin: "watchlist_refresh"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Manual item")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Manual (1)" }));

    expect(screen.getByText("Manual item")).toBeInTheDocument();
    expect(screen.queryByText("Refresh item")).not.toBeInTheDocument();
  });

  it("filters live ingestion buffer by watchlist refresh origin safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-manual-1",
            sourceKind: "public_excerpt",
            sourceLabel: "Manual item",
            rawExcerpt: "Manual excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "manual-item",
            status: "new",
            origin: "manual"
          },
          {
            id: "ingestion-refresh-1",
            sourceKind: "watched_url_snapshot",
            sourceLabel: "Refresh item",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "refresh-item",
            status: "draft",
            origin: "watchlist_refresh"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Refresh item")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Watchlist refresh (1)" }));

    expect(screen.getByText("Refresh item")).toBeInTheDocument();
    expect(screen.queryByText("Manual item")).not.toBeInTheDocument();
  });

  it("shows all live ingestion items in the default origin buffer view safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-manual-1",
            sourceKind: "public_excerpt",
            sourceLabel: "Manual item",
            rawExcerpt: "Manual excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "manual-item",
            status: "new",
            origin: "manual"
          },
          {
            id: "ingestion-refresh-1",
            sourceKind: "watched_url_snapshot",
            sourceLabel: "Refresh item",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "refresh-item",
            status: "draft",
            origin: "watchlist_refresh"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => expect(screen.getByText("Manual item")).toBeInTheDocument());
    expect(screen.getByText("Refresh item")).toBeInTheDocument();
  });

  it.each([
    ["Public excerpt (1)", "Public excerpt item", ["Watched URL item", "GitHub snapshot item", "Article snapshot item", "Manual feed item"]],
    ["Watched URL (1)", "Watched URL item", ["Public excerpt item", "GitHub snapshot item", "Article snapshot item", "Manual feed item"]],
    ["GitHub snapshot (1)", "GitHub snapshot item", ["Public excerpt item", "Watched URL item", "Article snapshot item", "Manual feed item"]],
    ["Article snapshot (1)", "Article snapshot item", ["Public excerpt item", "Watched URL item", "GitHub snapshot item", "Manual feed item"]],
    ["Manual feed (1)", "Manual feed item", ["Public excerpt item", "Watched URL item", "GitHub snapshot item", "Article snapshot item"]]
  ])(
    "filters live ingestion buffer by %s source kind safely",
    async (filterLabel, visibleLabel, hiddenLabels) => {
      window.localStorage.setItem(
        "linkedin-brand-os:live-ingestion-buffer",
        JSON.stringify({
          items: [
            {
              id: "ingestion-public-1",
              sourceKind: "public_excerpt",
              sourceLabel: "Public excerpt item",
              rawExcerpt: "Public excerpt",
              capturedAt: "2026-03-15T00:00:00.000Z",
              fingerprint: "public-item",
              status: "new",
              origin: "manual"
            },
            {
              id: "ingestion-watched-url-1",
              sourceKind: "watched_url_snapshot",
              sourceLabel: "Watched URL item",
              rawExcerpt: "",
              capturedAt: "2026-03-15T00:01:00.000Z",
              fingerprint: "watched-url-item",
              status: "draft",
              origin: "watchlist_refresh"
            },
            {
              id: "ingestion-github-1",
              sourceKind: "github_watch_snapshot",
              sourceLabel: "GitHub snapshot item",
              rawExcerpt: "GitHub excerpt",
              capturedAt: "2026-03-15T00:02:00.000Z",
              fingerprint: "github-item",
              status: "new",
              origin: "watchlist_refresh"
            },
            {
              id: "ingestion-article-1",
              sourceKind: "article_watch_snapshot",
              sourceLabel: "Article snapshot item",
              rawExcerpt: "Article excerpt",
              capturedAt: "2026-03-15T00:03:00.000Z",
              fingerprint: "article-item",
              status: "archived",
              origin: "manual"
            },
            {
              id: "ingestion-manual-feed-1",
              sourceKind: "manual_feed_snapshot",
              sourceLabel: "Manual feed item",
              rawExcerpt: "Manual feed excerpt",
              capturedAt: "2026-03-15T00:04:00.000Z",
              fingerprint: "manual-feed-item",
              status: "discarded",
              origin: "manual"
            }
          ]
        })
      );

      fetchMock.mockImplementation(async (input, init) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = init?.method ?? "GET";
        const initial = respondWithEmptyDashboard(url, method);
        if (initial) {
          return initial;
        }

        return new Response("Not found", { status: 404 });
      });

      render(<App apiBaseUrl="http://localhost:4000" />);
      const user = userEvent.setup();

      await waitFor(() => expect(screen.getByText("Public excerpt item")).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: filterLabel }));

      expect(screen.getByText(visibleLabel)).toBeInTheDocument();
      for (const hidden of hiddenLabels) {
        expect(screen.queryByText(hidden)).not.toBeInTheDocument();
      }
    }
  );

  it("shows all live ingestion items in the default source kind buffer view safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-public-1",
            sourceKind: "public_excerpt",
            sourceLabel: "Public excerpt item",
            rawExcerpt: "Public excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "public-item",
            status: "new",
            origin: "manual"
          },
          {
            id: "ingestion-watched-url-1",
            sourceKind: "watched_url_snapshot",
            sourceLabel: "Watched URL item",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "watched-url-item",
            status: "draft",
            origin: "watchlist_refresh"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => expect(screen.getByText("Public excerpt item")).toBeInTheDocument());
    expect(screen.getByText("Watched URL item")).toBeInTheDocument();
  });

  it("searches live ingestion buffer by source label safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-search-label-1",
            sourceKind: "public_excerpt",
            sourceLabel: "Visibility thread",
            rawExcerpt: "Manual visibility excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "search-label-1",
            status: "new",
            origin: "manual"
          },
          {
            id: "ingestion-search-label-2",
            sourceKind: "public_excerpt",
            sourceLabel: "Support note",
            rawExcerpt: "Support excerpt",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "search-label-2",
            status: "new",
            origin: "manual"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Visibility thread")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Search buffer"), "visibility");

    expect(screen.getByText("Visibility thread")).toBeInTheDocument();
    expect(screen.queryByText("Support note")).not.toBeInTheDocument();
  });

  it("searches live ingestion buffer by source URL safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-search-url-1",
            sourceKind: "public_excerpt",
            sourceLabel: "Workflow URL item",
            sourceUrl: "https://example.com/workflow-chaos",
            rawExcerpt: "Workflow excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "search-url-1",
            status: "new",
            origin: "manual"
          },
          {
            id: "ingestion-search-url-2",
            sourceKind: "public_excerpt",
            sourceLabel: "Other URL item",
            sourceUrl: "https://example.com/other-topic",
            rawExcerpt: "Other excerpt",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "search-url-2",
            status: "new",
            origin: "manual"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Workflow URL item")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Search buffer"), "workflow-chaos");

    expect(screen.getByText("Workflow URL item")).toBeInTheDocument();
    expect(screen.queryByText("Other URL item")).not.toBeInTheDocument();
  });

  it("searches live ingestion buffer by raw excerpt text safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-search-excerpt-1",
            sourceKind: "public_excerpt",
            sourceLabel: "Excerpt item",
            rawExcerpt: "Broken handoff and workflow chaos are rising.",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "search-excerpt-1",
            status: "new",
            origin: "manual"
          },
          {
            id: "ingestion-search-excerpt-2",
            sourceKind: "public_excerpt",
            sourceLabel: "Calm item",
            rawExcerpt: "Routine update with no major issue.",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "search-excerpt-2",
            status: "new",
            origin: "manual"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Excerpt item")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Search buffer"), "workflow chaos");

    expect(screen.getByText("Excerpt item")).toBeInTheDocument();
    expect(screen.queryByText("Calm item")).not.toBeInTheDocument();
  });

  it("searches live ingestion buffer by notes safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-search-notes-1",
            sourceKind: "public_excerpt",
            sourceLabel: "Notes item",
            rawExcerpt: "Notes excerpt",
            notes: "Track for COO handoff review",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "search-notes-1",
            status: "new",
            origin: "manual"
          },
          {
            id: "ingestion-search-notes-2",
            sourceKind: "public_excerpt",
            sourceLabel: "Other notes item",
            rawExcerpt: "Other notes excerpt",
            notes: "General backlog",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "search-notes-2",
            status: "new",
            origin: "manual"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Notes item")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Search buffer"), "coo handoff");

    expect(screen.getByText("Notes item")).toBeInTheDocument();
    expect(screen.queryByText("Other notes item")).not.toBeInTheDocument();
  });

  it("searches live ingestion buffer case-insensitively safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-search-case-1",
            sourceKind: "public_excerpt",
            sourceLabel: "RevOps Escalation",
            rawExcerpt: "Escalation excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "search-case-1",
            status: "new",
            origin: "manual"
          },
          {
            id: "ingestion-search-case-2",
            sourceKind: "public_excerpt",
            sourceLabel: "Operations update",
            rawExcerpt: "Ops excerpt",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "search-case-2",
            status: "new",
            origin: "manual"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("RevOps Escalation")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Search buffer"), "revops");

    expect(screen.getByText("RevOps Escalation")).toBeInTheDocument();
    expect(screen.queryByText("Operations update")).not.toBeInTheDocument();
  });

  it("combines live ingestion status and origin filters safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-manual-new",
            sourceKind: "public_excerpt",
            sourceLabel: "Manual ready item",
            rawExcerpt: "Manual excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "manual-new-item",
            status: "new",
            origin: "manual"
          },
          {
            id: "ingestion-refresh-draft",
            sourceKind: "watched_url_snapshot",
            sourceLabel: "Refresh draft item",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "refresh-draft-item",
            status: "draft",
            origin: "watchlist_refresh"
          },
          {
            id: "ingestion-refresh-new",
            sourceKind: "watched_url_snapshot",
            sourceLabel: "Refresh ready item",
            rawExcerpt: "Refresh excerpt",
            capturedAt: "2026-03-15T00:02:00.000Z",
            fingerprint: "refresh-new-item",
            status: "new",
            origin: "watchlist_refresh"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Refresh ready item")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "New (2)" }));
    await user.click(screen.getByRole("button", { name: "Watchlist refresh (2)" }));

    expect(screen.getByText("Refresh ready item")).toBeInTheDocument();
    expect(screen.queryByText("Manual ready item")).not.toBeInTheDocument();
    expect(screen.queryByText("Refresh draft item")).not.toBeInTheDocument();
  });

  it("combines live ingestion status, origin, and source kind filters safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-public-new",
            sourceKind: "public_excerpt",
            sourceLabel: "Manual public ready item",
            rawExcerpt: "Manual public excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "manual-public-new",
            status: "new",
            origin: "manual"
          },
          {
            id: "ingestion-github-draft",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Refresh GitHub draft item",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "refresh-github-draft",
            status: "draft",
            origin: "watchlist_refresh"
          },
          {
            id: "ingestion-github-new",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Refresh GitHub ready item",
            rawExcerpt: "Refresh GitHub excerpt",
            capturedAt: "2026-03-15T00:02:00.000Z",
            fingerprint: "refresh-github-new",
            status: "new",
            origin: "watchlist_refresh"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Refresh GitHub ready item")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "New (2)" }));
    await user.click(screen.getByRole("button", { name: "Watchlist refresh (2)" }));
    await user.click(screen.getByRole("button", { name: "GitHub snapshot (2)" }));

    expect(screen.getByText("Refresh GitHub ready item")).toBeInTheDocument();
    expect(screen.queryByText("Manual public ready item")).not.toBeInTheDocument();
    expect(screen.queryByText("Refresh GitHub draft item")).not.toBeInTheDocument();
  });

  it("combines live ingestion search with status, origin, and source kind filters safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-search-combined-1",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "GitHub issue item",
            rawExcerpt: "Release ops note",
            notes: "release-risk",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "search-combined-1",
            status: "new",
            origin: "watchlist_refresh"
          },
          {
            id: "ingestion-search-combined-2",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "GitHub issue other item",
            rawExcerpt: "General issue note",
            notes: "other-note",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "search-combined-2",
            status: "new",
            origin: "watchlist_refresh"
          },
          {
            id: "ingestion-search-combined-3",
            sourceKind: "public_excerpt",
            sourceLabel: "Manual public item",
            rawExcerpt: "release-risk discussion",
            notes: "public-note",
            capturedAt: "2026-03-15T00:02:00.000Z",
            fingerprint: "search-combined-3",
            status: "new",
            origin: "manual"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("GitHub issue item")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "New (3)" }));
    await user.click(screen.getByRole("button", { name: "Watchlist refresh (2)" }));
    await user.click(screen.getByRole("button", { name: "GitHub snapshot (2)" }));
    await user.type(screen.getByLabelText("Search buffer"), "release-risk");

    expect(screen.getByText("GitHub issue item")).toBeInTheDocument();
    expect(screen.queryByText("GitHub issue other item")).not.toBeInTheDocument();
    expect(screen.queryByText("Manual public item")).not.toBeInTheDocument();
  });

  it("renders a safe empty state for combined live ingestion filters", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-manual-new",
            sourceKind: "public_excerpt",
            sourceLabel: "Manual ready item",
            rawExcerpt: "Manual excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "manual-new-item",
            status: "new",
            origin: "manual"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Manual ready item")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Draft (0)" }));
    await user.click(screen.getByRole("button", { name: "Watchlist refresh (0)" }));

    expect(screen.getByText("No buffer items match these filters.")).toBeInTheDocument();
  });

  it("renders a safe empty state for combined live ingestion source kind filters", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-public-new",
            sourceKind: "public_excerpt",
            sourceLabel: "Manual public ready item",
            rawExcerpt: "Manual public excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "manual-public-new",
            status: "new",
            origin: "manual"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Manual public ready item")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Draft (0)" }));
    await user.click(screen.getByRole("button", { name: "Watchlist refresh (0)" }));
    await user.click(screen.getByRole("button", { name: "GitHub snapshot (0)" }));

    expect(screen.getByText("No buffer items match these filters.")).toBeInTheDocument();
  });

  it("clearing live ingestion search restores the current filtered view safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-search-clear-1",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "GitHub visible item",
            rawExcerpt: "GitHub visible excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "search-clear-1",
            status: "new",
            origin: "watchlist_refresh"
          },
          {
            id: "ingestion-search-clear-2",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "GitHub hidden item",
            rawExcerpt: "GitHub hidden excerpt",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "search-clear-2",
            status: "new",
            origin: "watchlist_refresh"
          },
          {
            id: "ingestion-search-clear-3",
            sourceKind: "public_excerpt",
            sourceLabel: "Manual item",
            rawExcerpt: "Manual excerpt",
            capturedAt: "2026-03-15T00:02:00.000Z",
            fingerprint: "search-clear-3",
            status: "new",
            origin: "manual"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();
    const searchInput = screen.getByLabelText("Search buffer");

    await waitFor(() => expect(screen.getByText("GitHub visible item")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Watchlist refresh (2)" }));
    await user.click(screen.getByRole("button", { name: "GitHub snapshot (2)" }));
    await user.type(searchInput, "visible");

    expect(screen.getByText("GitHub visible item")).toBeInTheDocument();
    expect(screen.queryByText("GitHub hidden item")).not.toBeInTheDocument();

    await user.clear(searchInput);

    expect(screen.getByText("GitHub visible item")).toBeInTheDocument();
    expect(screen.getByText("GitHub hidden item")).toBeInTheDocument();
    expect(screen.queryByText("Manual item")).not.toBeInTheDocument();
  });

  it("renders a safe empty state for live ingestion search safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-search-empty-1",
            sourceKind: "public_excerpt",
            sourceLabel: "Manual item",
            rawExcerpt: "Manual excerpt",
            notes: "manual-note",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "search-empty-1",
            status: "new",
            origin: "manual"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Manual item")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Search buffer"), "missing-query");

    expect(screen.getByText("No buffer items match these filters.")).toBeInTheDocument();
  });

  it("keeps live ingestion item actions working under combined filtered views safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-manual-new",
            sourceKind: "public_excerpt",
            sourceLabel: "Manual ready item",
            rawExcerpt: "Manual excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "manual-new-item",
            status: "new",
            origin: "manual"
          },
          {
            id: "ingestion-refresh-draft",
            sourceKind: "watched_url_snapshot",
            sourceLabel: "Refresh draft item",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "refresh-draft-item",
            status: "draft",
            origin: "watchlist_refresh"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Refresh draft item")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Draft (1)" }));
    await user.click(screen.getByRole("button", { name: "Watchlist refresh (1)" }));

    await user.type(screen.getByLabelText("Draft excerpt ingestion-refresh-draft"), "Completed refresh excerpt");
    await user.click(screen.getByRole("button", { name: "Complete draft" }));

    expect(screen.getByText("Completed draft live ingestion item.")).toBeInTheDocument();
    expect(screen.getByText("No buffer items match these filters.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New (2)" }));
    expect(screen.getByText("Refresh draft item")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send to Scout Feed" })).toBeInTheDocument();
  });

  it("keeps live ingestion item actions working under combined source kind filtered views safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-manual-public-new",
            sourceKind: "public_excerpt",
            sourceLabel: "Manual public ready item",
            rawExcerpt: "Manual public excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "manual-public-ready",
            status: "new",
            origin: "manual"
          },
          {
            id: "ingestion-refresh-github-draft",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Refresh GitHub draft item",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "refresh-github-draft",
            status: "draft",
            origin: "watchlist_refresh"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Refresh GitHub draft item")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Draft (1)" }));
    await user.click(screen.getByRole("button", { name: "Watchlist refresh (1)" }));
    await user.click(screen.getByRole("button", { name: "GitHub snapshot (1)" }));

    await user.type(
      screen.getByLabelText("Draft excerpt ingestion-refresh-github-draft"),
      "Completed GitHub refresh excerpt"
    );
    await user.click(screen.getByRole("button", { name: "Complete draft" }));

    expect(screen.getByText("Completed draft live ingestion item.")).toBeInTheDocument();
    expect(screen.getByText("No buffer items match these filters.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New (2)" }));
    expect(screen.getByText("Refresh GitHub draft item")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send to Scout Feed" })).toBeInTheDocument();
  });

  it("keeps live ingestion item actions working under searched and filtered views safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-search-action-1",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "GitHub draft target",
            rawExcerpt: "",
            notes: "searchable-target",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "search-action-1",
            status: "draft",
            origin: "watchlist_refresh"
          },
          {
            id: "ingestion-search-action-2",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "GitHub other item",
            rawExcerpt: "Other excerpt",
            notes: "other-note",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "search-action-2",
            status: "new",
            origin: "watchlist_refresh"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("GitHub draft target")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Draft (1)" }));
    await user.click(screen.getByRole("button", { name: "Watchlist refresh (2)" }));
    await user.click(screen.getByRole("button", { name: "GitHub snapshot (2)" }));
    await user.type(screen.getByLabelText("Search buffer"), "searchable-target");

    await user.type(
      screen.getByLabelText("Draft excerpt ingestion-search-action-1"),
      "Completed searched draft excerpt"
    );
    await user.click(screen.getByRole("button", { name: "Complete draft" }));

    expect(screen.getByText("Completed draft live ingestion item.")).toBeInTheDocument();
    expect(screen.getByText("No buffer items match these filters.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New (2)" }));
    expect(screen.getByText("GitHub draft target")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send to Scout Feed" })).toBeInTheDocument();
  });

  it("selects the currently visible live ingestion items safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-visible-select-1",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Visible GitHub item one",
            rawExcerpt: "Visible excerpt one",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "visible-select-1",
            status: "new",
            origin: "watchlist_refresh"
          },
          {
            id: "ingestion-visible-select-2",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Visible GitHub item two",
            rawExcerpt: "Visible excerpt two",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "visible-select-2",
            status: "draft",
            origin: "watchlist_refresh"
          },
          {
            id: "ingestion-visible-select-3",
            sourceKind: "public_excerpt",
            sourceLabel: "Hidden manual item",
            rawExcerpt: "Hidden excerpt",
            capturedAt: "2026-03-15T00:02:00.000Z",
            fingerprint: "visible-select-3",
            status: "new",
            origin: "manual"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Visible GitHub item one")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Watchlist refresh (2)" }));
    await user.click(screen.getByRole("button", { name: "GitHub snapshot (2)" }));
    await user.click(screen.getByRole("button", { name: "Select visible" }));

    expect(screen.getByLabelText("Select live ingestion item ingestion-visible-select-1")).toBeChecked();
    expect(screen.getByLabelText("Select live ingestion item ingestion-visible-select-2")).toBeChecked();
    expect(screen.getByText("2/2 visible selected")).toBeInTheDocument();
  });

  it("clears selection for the currently visible live ingestion items safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-visible-clear-1",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Visible GitHub item one",
            rawExcerpt: "Visible excerpt one",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "visible-clear-1",
            status: "new",
            origin: "watchlist_refresh"
          },
          {
            id: "ingestion-visible-clear-2",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Visible GitHub item two",
            rawExcerpt: "Visible excerpt two",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "visible-clear-2",
            status: "draft",
            origin: "watchlist_refresh"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Visible GitHub item one")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Select visible" }));
    await user.click(screen.getByRole("button", { name: "Clear visible selection" }));

    expect(screen.getByLabelText("Select live ingestion item ingestion-visible-clear-1")).not.toBeChecked();
    expect(screen.getByLabelText("Select live ingestion item ingestion-visible-clear-2")).not.toBeChecked();
    expect(screen.getByText("0/2 visible selected")).toBeInTheDocument();
  });

  it("selects the current visible subset under combined filters and search safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-visible-combined-1",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Release risk visible item",
            rawExcerpt: "Release risk excerpt",
            notes: "release-risk",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "visible-combined-1",
            status: "new",
            origin: "watchlist_refresh"
          },
          {
            id: "ingestion-visible-combined-2",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Other GitHub item",
            rawExcerpt: "Other excerpt",
            notes: "other-note",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "visible-combined-2",
            status: "new",
            origin: "watchlist_refresh"
          },
          {
            id: "ingestion-visible-combined-3",
            sourceKind: "public_excerpt",
            sourceLabel: "Manual item",
            rawExcerpt: "release-risk manual excerpt",
            notes: "manual-note",
            capturedAt: "2026-03-15T00:02:00.000Z",
            fingerprint: "visible-combined-3",
            status: "new",
            origin: "manual"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Release risk visible item")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "New (3)" }));
    await user.click(screen.getByRole("button", { name: "Watchlist refresh (2)" }));
    await user.click(screen.getByRole("button", { name: "GitHub snapshot (2)" }));
    await user.type(screen.getByLabelText("Search buffer"), "release-risk");
    await user.click(screen.getByRole("button", { name: "Select visible" }));

    expect(screen.getByLabelText("Select live ingestion item ingestion-visible-combined-1")).toBeChecked();
    expect(screen.getByText("1/1 visible selected")).toBeInTheDocument();
    expect(screen.queryByText("Other GitHub item")).not.toBeInTheDocument();
    expect(screen.queryByText("Manual item")).not.toBeInTheDocument();
  });

  it("clears only the visible live ingestion selection and preserves hidden selections safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-hidden-preserve-1",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Visible GitHub item",
            rawExcerpt: "Visible excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "hidden-preserve-1",
            status: "new",
            origin: "watchlist_refresh"
          },
          {
            id: "ingestion-hidden-preserve-2",
            sourceKind: "public_excerpt",
            sourceLabel: "Hidden manual item",
            rawExcerpt: "Hidden excerpt",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "hidden-preserve-2",
            status: "new",
            origin: "manual"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Visible GitHub item")).toBeInTheDocument());
    await user.click(screen.getByLabelText("Select live ingestion item ingestion-hidden-preserve-2"));
    await user.click(screen.getByRole("button", { name: "Watchlist refresh (1)" }));
    await user.click(screen.getByRole("button", { name: "Select visible" }));
    await user.click(screen.getByRole("button", { name: "Clear visible selection" }));

    await user.click(screen.getByRole("button", { name: "All origins (2)" }));
    expect(screen.getByLabelText("Select live ingestion item ingestion-hidden-preserve-1")).not.toBeChecked();
    expect(screen.getByLabelText("Select live ingestion item ingestion-hidden-preserve-2")).toBeChecked();
  });

  it("batch sends the currently selected visible live ingestion items through Scout Feed safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-visible-send-1",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Visible GitHub item one",
            rawExcerpt: "Visible excerpt one",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "visible-send-1",
            status: "new",
            origin: "watchlist_refresh"
          },
          {
            id: "ingestion-visible-send-2",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Visible GitHub item two",
            rawExcerpt: "Visible excerpt two",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "visible-send-2",
            status: "new",
            origin: "watchlist_refresh"
          },
          {
            id: "ingestion-visible-send-3",
            sourceKind: "public_excerpt",
            sourceLabel: "Hidden manual item",
            rawExcerpt: "Hidden excerpt",
            capturedAt: "2026-03-15T00:02:00.000Z",
            fingerprint: "visible-send-3",
            status: "new",
            origin: "manual"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/scout/feed") && method === "POST") {
        return Response.json({
          audienceItems: [],
          solutionItems: [],
          summary: "No strong scout signals found.",
          notes: "Scout Feed stays review-first."
        });
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Visible GitHub item one")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Watchlist refresh (2)" }));
    await user.click(screen.getByRole("button", { name: "GitHub snapshot (2)" }));
    await user.click(screen.getByRole("button", { name: "Select visible" }));
    await user.click(screen.getByRole("button", { name: "Send selected to Scout Feed" }));

    expect(screen.getByText("Sent 2 selected live ingestion items to Scout Feed.")).toBeInTheDocument();
  });

  it("keeps manual per-item live ingestion selection working safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-per-item-1",
            sourceKind: "public_excerpt",
            sourceLabel: "Per-item selection item",
            rawExcerpt: "Per-item excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "per-item-1",
            status: "new",
            origin: "manual"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Per-item selection item")).toBeInTheDocument());
    await user.click(screen.getByLabelText("Select live ingestion item ingestion-per-item-1"));
    expect(screen.getByLabelText("Select live ingestion item ingestion-per-item-1")).toBeChecked();

    await user.click(screen.getByLabelText("Select live ingestion item ingestion-per-item-1"));
    expect(screen.getByLabelText("Select live ingestion item ingestion-per-item-1")).not.toBeChecked();
  });

  it("selects only eligible visible live ingestion items safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-eligible-visible-1",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Eligible visible item one",
            rawExcerpt: "Eligible excerpt one",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "eligible-visible-1",
            status: "new",
            origin: "watchlist_refresh"
          },
          {
            id: "ingestion-eligible-visible-2",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Eligible visible item two",
            rawExcerpt: "Eligible excerpt two",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "eligible-visible-2",
            status: "new",
            origin: "watchlist_refresh"
          },
          {
            id: "ingestion-eligible-visible-3",
            sourceKind: "public_excerpt",
            sourceLabel: "Hidden manual item",
            rawExcerpt: "Hidden excerpt",
            capturedAt: "2026-03-15T00:02:00.000Z",
            fingerprint: "eligible-visible-3",
            status: "new",
            origin: "manual"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Eligible visible item one")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Watchlist refresh (2)" }));
    await user.click(screen.getByRole("button", { name: "GitHub snapshot (2)" }));
    await user.click(screen.getByRole("button", { name: "Select eligible visible" }));

    expect(screen.getByLabelText("Select live ingestion item ingestion-eligible-visible-1")).toBeChecked();
    expect(screen.getByLabelText("Select live ingestion item ingestion-eligible-visible-2")).toBeChecked();
    expect(screen.getByText("2/2 visible selected")).toBeInTheDocument();
  });

  it("skips visible non-new live ingestion items during eligible visible selection safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-eligible-skip-1",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Visible new item",
            rawExcerpt: "Visible new excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "eligible-skip-1",
            status: "new",
            origin: "watchlist_refresh"
          },
          {
            id: "ingestion-eligible-skip-2",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Visible draft item",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "eligible-skip-2",
            status: "draft",
            origin: "watchlist_refresh"
          },
          {
            id: "ingestion-eligible-skip-3",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Visible sent item",
            rawExcerpt: "Visible sent excerpt",
            capturedAt: "2026-03-15T00:02:00.000Z",
            fingerprint: "eligible-skip-3",
            status: "sent_to_feed",
            origin: "watchlist_refresh"
          },
          {
            id: "ingestion-eligible-skip-4",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Visible archived item",
            rawExcerpt: "Visible archived excerpt",
            capturedAt: "2026-03-15T00:03:00.000Z",
            fingerprint: "eligible-skip-4",
            status: "archived",
            origin: "watchlist_refresh"
          },
          {
            id: "ingestion-eligible-skip-5",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Visible discarded item",
            rawExcerpt: "Visible discarded excerpt",
            capturedAt: "2026-03-15T00:04:00.000Z",
            fingerprint: "eligible-skip-5",
            status: "discarded",
            origin: "watchlist_refresh"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Visible new item")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Watchlist refresh (5)" }));
    await user.click(screen.getByRole("button", { name: "GitHub snapshot (5)" }));
    await user.click(screen.getByRole("button", { name: "Select eligible visible" }));

    expect(screen.getByLabelText("Select live ingestion item ingestion-eligible-skip-1")).toBeChecked();
    expect(screen.getByLabelText("Select live ingestion item ingestion-eligible-skip-2")).not.toBeChecked();
    expect(screen.getByLabelText("Select live ingestion item ingestion-eligible-skip-3")).not.toBeChecked();
    expect(screen.getByLabelText("Select live ingestion item ingestion-eligible-skip-4")).not.toBeChecked();
    expect(screen.getByLabelText("Select live ingestion item ingestion-eligible-skip-5")).not.toBeChecked();
  });

  it("selects eligible visible live ingestion items under combined filters and search safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-eligible-combined-1",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Release risk eligible item",
            rawExcerpt: "Eligible release excerpt",
            notes: "release-risk",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "eligible-combined-1",
            status: "new",
            origin: "watchlist_refresh"
          },
          {
            id: "ingestion-eligible-combined-2",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Release risk draft item",
            rawExcerpt: "",
            notes: "release-risk",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "eligible-combined-2",
            status: "draft",
            origin: "watchlist_refresh"
          },
          {
            id: "ingestion-eligible-combined-3",
            sourceKind: "public_excerpt",
            sourceLabel: "Manual release item",
            rawExcerpt: "release-risk manual excerpt",
            notes: "manual-note",
            capturedAt: "2026-03-15T00:02:00.000Z",
            fingerprint: "eligible-combined-3",
            status: "new",
            origin: "manual"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Release risk eligible item")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Watchlist refresh (2)" }));
    await user.click(screen.getByRole("button", { name: "GitHub snapshot (2)" }));
    await user.type(screen.getByLabelText("Search buffer"), "release-risk");
    await user.click(screen.getByRole("button", { name: "Select eligible visible" }));

    expect(screen.getByLabelText("Select live ingestion item ingestion-eligible-combined-1")).toBeChecked();
    expect(screen.getByLabelText("Select live ingestion item ingestion-eligible-combined-2")).not.toBeChecked();
    expect(screen.getByText("1/2 visible selected")).toBeInTheDocument();
  });

  it("preserves hidden selections when selecting eligible visible live ingestion items safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-eligible-hidden-1",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Visible eligible item",
            rawExcerpt: "Visible eligible excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "eligible-hidden-1",
            status: "new",
            origin: "watchlist_refresh"
          },
          {
            id: "ingestion-eligible-hidden-2",
            sourceKind: "public_excerpt",
            sourceLabel: "Hidden selected item",
            rawExcerpt: "Hidden selected excerpt",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "eligible-hidden-2",
            status: "new",
            origin: "manual"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Visible eligible item")).toBeInTheDocument());
    await user.click(screen.getByLabelText("Select live ingestion item ingestion-eligible-hidden-2"));
    await user.click(screen.getByRole("button", { name: "Watchlist refresh (1)" }));
    await user.click(screen.getByRole("button", { name: "Select eligible visible" }));

    await user.click(screen.getByRole("button", { name: "All origins (2)" }));
    expect(screen.getByLabelText("Select live ingestion item ingestion-eligible-hidden-1")).toBeChecked();
    expect(screen.getByLabelText("Select live ingestion item ingestion-eligible-hidden-2")).toBeChecked();
  });

  it("batch sends selected eligible visible live ingestion items safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-eligible-send-1",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Eligible visible item one",
            rawExcerpt: "Eligible visible excerpt one",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "eligible-send-1",
            status: "new",
            origin: "watchlist_refresh"
          },
          {
            id: "ingestion-eligible-send-2",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Eligible visible item two",
            rawExcerpt: "Eligible visible excerpt two",
            capturedAt: "2026-03-15T00:01:00.000Z",
            fingerprint: "eligible-send-2",
            status: "new",
            origin: "watchlist_refresh"
          },
          {
            id: "ingestion-eligible-send-3",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Visible draft item",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:02:00.000Z",
            fingerprint: "eligible-send-3",
            status: "draft",
            origin: "watchlist_refresh"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/scout/feed") && method === "POST") {
        return Response.json({
          audienceItems: [],
          solutionItems: [],
          summary: "No strong scout signals found.",
          notes: "Scout Feed stays review-first."
        });
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Eligible visible item one")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Watchlist refresh (3)" }));
    await user.click(screen.getByRole("button", { name: "GitHub snapshot (3)" }));
    await user.click(screen.getByRole("button", { name: "Select eligible visible" }));
    await user.click(screen.getByRole("button", { name: "Send selected to Scout Feed" }));

    expect(screen.getByText("Sent 2 selected live ingestion items to Scout Feed.")).toBeInTheDocument();
  });

  it("keeps visible live ingestion selection helpers working safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-visible-helper-1",
            sourceKind: "public_excerpt",
            sourceLabel: "Visible helper item",
            rawExcerpt: "Visible helper excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "visible-helper-1",
            status: "new",
            origin: "manual"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Visible helper item")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Select visible" }));
    expect(screen.getByLabelText("Select live ingestion item ingestion-visible-helper-1")).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Clear visible selection" }));
    expect(screen.getByLabelText("Select live ingestion item ingestion-visible-helper-1")).not.toBeChecked();
  });

  it("persists operator watchlist items safely", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Operator Watchlists")).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText("Watchlist source kind"), "github_release");
    await user.type(screen.getByLabelText("Watchlist label"), "Workflow repo releases");
    await user.type(
      screen.getByLabelText("Watchlist source URL"),
      "https://github.com/example/repo/releases"
    );
    await user.type(screen.getByLabelText("Watchlist notes"), "Watch rollout and adoption changes.");
    await user.selectOptions(screen.getByLabelText("Refresh cadence"), "daily_candidate");
    await user.click(screen.getByRole("checkbox", { name: "High priority" }));
    await user.click(screen.getByRole("button", { name: "Add to Watchlist" }));

    expect(screen.getByText("Added watchlist item.")).toBeInTheDocument();
    expect(screen.getByText("Workflow repo releases")).toBeInTheDocument();
    expect(screen.getByText("daily candidate")).toBeInTheDocument();
    expect(screen.getByText("high priority")).toBeInTheDocument();

    const stored = JSON.parse(
      window.localStorage.getItem("linkedin-brand-os:watchlists") ?? '{"items":[]}'
    ) as {
      items: Array<{
        label: string;
        isActive: boolean;
        refreshCadence?: string;
        priority?: string;
      }>;
    };

    expect(stored.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Workflow repo releases",
          isActive: true,
          refreshCadence: "daily_candidate",
          priority: "high"
        })
      ])
    );
  });

  it("reloads persisted watchlists safely from localStorage", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:watchlists",
      JSON.stringify({
        items: [
          {
            id: "watch-1",
            sourceKind: "article_source",
            label: "Ops blog",
            sourceUrl: "https://example.com/blog",
            notes: "Track coordination lessons.",
            refreshCadence: "weekly_candidate",
            priority: "high",
            isActive: true,
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Operator Watchlists")).toBeInTheDocument();
      expect(screen.getByText("Ops blog")).toBeInTheDocument();
      expect(screen.getByText("active")).toBeInTheDocument();
      expect(screen.getByText("weekly candidate")).toBeInTheDocument();
      expect(screen.getByText("high priority")).toBeInTheDocument();
    });
  });

  it("normalizes older watchlist items without cadence safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:watchlists",
      JSON.stringify({
        items: [
          {
            id: "watch-legacy-1",
            sourceKind: "article_source",
            label: "Legacy blog",
            isActive: true,
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Legacy blog")).toBeInTheDocument();
      expect(screen.getByText("manual only")).toBeInTheDocument();
    });
  });

  it("toggles watchlist activation safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:watchlists",
      JSON.stringify({
        items: [
          {
            id: "watch-1",
            sourceKind: "public_discussion_source",
            label: "Discussion source",
            isActive: true,
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Discussion source")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Deactivate" }));
    expect(screen.getByText("Deactivated watchlist item.")).toBeInTheDocument();

    let stored = JSON.parse(
      window.localStorage.getItem("linkedin-brand-os:watchlists") ?? '{"items":[]}'
    ) as { items: Array<{ isActive: boolean }> };
    expect(stored.items[0]?.isActive).toBe(false);

    await user.click(screen.getByRole("button", { name: "Activate" }));
    expect(screen.getByText("Activated watchlist item.")).toBeInTheDocument();

    stored = JSON.parse(
      window.localStorage.getItem("linkedin-brand-os:watchlists") ?? '{"items":[]}'
    ) as { items: Array<{ isActive: boolean }> };
    expect(stored.items[0]?.isActive).toBe(true);
  });

  it("removes watchlist items safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:watchlists",
      JSON.stringify({
        items: [
          {
            id: "watch-1",
            sourceKind: "watched_url",
            label: "Watched source",
            sourceUrl: "https://example.com/source",
            isActive: true,
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Watched source")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(screen.getByText("Removed watchlist item.")).toBeInTheDocument();
    expect(screen.queryByText("Watched source")).not.toBeInTheDocument();
  });

  it("uses a watchlist item to prefill the live ingestion buffer safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:watchlists",
      JSON.stringify({
        items: [
          {
            id: "watch-1",
            sourceKind: "github_release",
            label: "Workflow repo releases",
            sourceUrl: "https://github.com/example/repo/releases",
            notes: "Track rollout and adoption changes.",
            isActive: true,
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Workflow repo releases")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Use for snapshot" }));

    expect(screen.getByLabelText("Buffer source label")).toHaveValue("Workflow repo releases");
    expect(screen.getByLabelText("Buffer source URL")).toHaveValue(
      "https://github.com/example/repo/releases"
    );
    expect(screen.getByLabelText("Buffer notes")).toHaveValue("Track rollout and adoption changes.");
    expect(screen.getByText("Prefilled live ingestion buffer from watchlist item.")).toBeInTheDocument();

    const stored = JSON.parse(
      window.localStorage.getItem("linkedin-brand-os:watchlists") ?? '{"items":[]}'
    ) as { items: Array<{ lastUsedAt?: string }> };
    expect(stored.items[0]?.lastUsedAt).toBeDefined();
  });

  it("creates a draft live-ingestion snapshot from a watchlist safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:watchlists",
      JSON.stringify({
        items: [
          {
            id: "watch-1",
            sourceKind: "github_release",
            label: "Workflow repo releases",
            sourceUrl: "https://github.com/example/repo/releases",
            notes: "Track rollout and adoption changes.",
            isActive: true,
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Workflow repo releases")).toBeInTheDocument());
    const fetchCountBefore = fetchMock.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Create snapshot" }));

    expect(screen.getByText("Created draft live ingestion snapshot from watchlist item.")).toBeInTheDocument();
    expect(screen.getAllByText("Workflow repo releases").length).toBeGreaterThan(1);
    expect(screen.getByText("draft")).toBeInTheDocument();
    expect(
      screen.getByText("Add excerpt text to make this item ready for Scout Feed.")
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(fetchCountBefore);

    const stored = JSON.parse(
      window.localStorage.getItem("linkedin-brand-os:live-ingestion-buffer") ?? '{"items":[]}'
    ) as {
      items: Array<{
        sourceKind: string;
        sourceLabel?: string;
        sourceUrl?: string;
        rawExcerpt: string;
        status: string;
      }>;
    };

    expect(stored.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKind: "github_watch_snapshot",
          sourceLabel: "Workflow repo releases",
          sourceUrl: "https://github.com/example/repo/releases",
          rawExcerpt: "",
          status: "draft"
        })
      ])
    );
  });

  it("keeps draft watchlist snapshots out of Scout Feed until excerpt text is added", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:watchlists",
      JSON.stringify({
        items: [
          {
            id: "watch-1",
            sourceKind: "watched_url",
            label: "Watched source",
            sourceUrl: "https://example.com/source",
            isActive: true,
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Watched source")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Create snapshot" }));

    expect(screen.queryByRole("button", { name: "Send to Scout Feed" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use draft in form" }));

    expect(screen.getByLabelText("Buffer source label")).toHaveValue("Watched source");
    expect(screen.getByLabelText("Buffer source URL")).toHaveValue("https://example.com/source");
    expect(screen.getByText("Loaded draft live ingestion snapshot into the buffer form.")).toBeInTheDocument();
  });

  it("lets operators edit and save a draft live-ingestion item directly in the buffer", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-draft-1",
            sourceKind: "watched_url_snapshot",
            sourceLabel: "Watched source",
            sourceUrl: "https://example.com/source",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "watched-source-draft",
            status: "draft",
            origin: "watchlist_refresh",
            watchlistItemId: "watch-1"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Watched source")).toBeInTheDocument());

    await user.type(
      screen.getByLabelText("Draft excerpt ingestion-draft-1"),
      "Operators keep losing handoff visibility between release notes and rollout status."
    );
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    expect(screen.getByText("Saved draft live ingestion item.")).toBeInTheDocument();

    const stored = JSON.parse(
      window.localStorage.getItem("linkedin-brand-os:live-ingestion-buffer") ?? '{"items":[]}'
    ) as { items: Array<{ rawExcerpt: string; status: string }> };

    expect(stored.items[0]?.rawExcerpt).toContain("handoff visibility");
    expect(stored.items[0]?.status).toBe("draft");
  });

  it("promotes a valid draft live-ingestion item to ready status safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-draft-1",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Repo releases",
            sourceUrl: "https://github.com/example/repo/releases",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "repo-release-draft",
            status: "draft",
            origin: "watchlist_refresh",
            watchlistItemId: "watch-1",
            notes: "Track rollout changes."
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Repo releases")).toBeInTheDocument());

    await user.type(
      screen.getByLabelText("Draft excerpt ingestion-draft-1"),
      "Release notes show operators still stitching rollout context by hand across issue threads."
    );
    await user.click(screen.getByRole("button", { name: "Complete draft" }));

    expect(screen.getByText("Completed draft live ingestion item.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send to Scout Feed" })).toBeInTheDocument();

    const stored = JSON.parse(
      window.localStorage.getItem("linkedin-brand-os:live-ingestion-buffer") ?? '{"items":[]}'
    ) as {
      items: Array<{
        sourceKind: string;
        sourceLabel?: string;
        sourceUrl?: string;
        status: string;
        origin?: string;
        watchlistItemId?: string;
      }>;
    };

    expect(stored.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKind: "github_watch_snapshot",
          sourceLabel: "Repo releases",
          sourceUrl: "https://github.com/example/repo/releases",
          status: "new",
          origin: "watchlist_refresh",
          watchlistItemId: "watch-1"
        })
      ])
    );
  });

  it("keeps incomplete drafts blocked from Scout Feed safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "ingestion-draft-1",
            sourceKind: "public_excerpt",
            sourceLabel: "Public discussion",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "public-discussion-draft",
            status: "draft"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Public discussion")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Complete draft" }));

    expect(
      screen.getByText("Draft remains blocked. Add excerpt text before sending to Scout Feed.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send to Scout Feed" })).not.toBeInTheDocument();
  });

  it("refreshes an active watchlist item into Live Ingestion Buffer safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:watchlists",
      JSON.stringify({
        items: [
          {
            id: "watch-1",
            sourceKind: "article_source",
            label: "Ops blog",
            sourceUrl: "https://example.com/blog",
            notes: "Track coordination lessons.",
            refreshCadence: "daily_candidate",
            isActive: true,
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Ops blog")).toBeInTheDocument());
    const fetchCountBefore = fetchMock.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Refresh now" }));

    expect(screen.getByText("Refreshed watchlist item into Live Ingestion Buffer.")).toBeInTheDocument();
    expect(screen.getByText("watchlist refresh")).toBeInTheDocument();
    expect(
      screen.getByText("Add excerpt text to make this item ready for Scout Feed.")
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(fetchCountBefore);

    const storedBuffer = JSON.parse(
      window.localStorage.getItem("linkedin-brand-os:live-ingestion-buffer") ?? '{"items":[]}'
    ) as {
      items: Array<{
        sourceKind: string;
        sourceLabel?: string;
        sourceUrl?: string;
        status: string;
        origin?: string;
        watchlistItemId?: string;
      }>;
    };

    expect(storedBuffer.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKind: "article_watch_snapshot",
          sourceLabel: "Ops blog",
          sourceUrl: "https://example.com/blog",
          status: "draft",
          origin: "watchlist_refresh",
          watchlistItemId: "watch-1"
        })
      ])
    );

    const storedWatchlists = JSON.parse(
      window.localStorage.getItem("linkedin-brand-os:watchlists") ?? '{"items":[]}'
    ) as { items: Array<{ lastRefreshedAt?: string }> };
    expect(storedWatchlists.items[0]?.lastRefreshedAt).toBeDefined();
  });

  it("skips inactive watchlists during refresh-active runs safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:watchlists",
      JSON.stringify({
        items: [
          {
            id: "watch-1",
            sourceKind: "public_discussion_source",
            label: "Active source",
            refreshCadence: "daily_candidate",
            isActive: true,
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "watch-2",
            sourceKind: "github_issue",
            label: "Inactive source",
            sourceUrl: "https://github.com/example/repo/issues",
            refreshCadence: "daily_candidate",
            isActive: false,
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Active source")).toBeInTheDocument());

    expect(screen.getAllByRole("button", { name: "Refresh now" })[1]).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Refresh active watchlists" }));

    const storedBuffer = JSON.parse(
      window.localStorage.getItem("linkedin-brand-os:live-ingestion-buffer") ?? '{"items":[]}'
    ) as { items: Array<{ sourceLabel?: string; watchlistItemId?: string }> };

    expect(storedBuffer.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceLabel: "Active source" })])
    );
    expect(
      storedBuffer.items.find((item) => item.watchlistItemId === "watch-2")
    ).toBeUndefined();
  });

  it("refreshes only matching active cadence watchlists safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:watchlists",
      JSON.stringify({
        items: [
          {
            id: "watch-daily-1",
            sourceKind: "public_discussion_source",
            label: "Daily source",
            refreshCadence: "daily_candidate",
            isActive: true,
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "watch-weekly-1",
            sourceKind: "github_issue",
            label: "Weekly source",
            refreshCadence: "weekly_candidate",
            isActive: true,
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Daily source")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Refresh daily candidates" }));

    await waitFor(() => {
      const storedBuffer = JSON.parse(
        window.localStorage.getItem("linkedin-brand-os:live-ingestion-buffer") ?? '{"items":[]}'
      ) as { items: Array<{ sourceLabel?: string; watchlistItemId?: string }> };

      expect(
        storedBuffer.items.find((item) => item.watchlistItemId === "watch-daily-1")
      ).toBeDefined();
      expect(
        storedBuffer.items.find((item) => item.watchlistItemId === "watch-weekly-1")
      ).toBeUndefined();
    });
  });

  it("keeps inactive cadence watchlists out of cadence refresh safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:watchlists",
      JSON.stringify({
        items: [
          {
            id: "watch-daily-active",
            sourceKind: "public_discussion_source",
            label: "Daily active source",
            refreshCadence: "daily_candidate",
            isActive: true,
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "watch-daily-inactive",
            sourceKind: "watched_url",
            label: "Daily inactive source",
            refreshCadence: "daily_candidate",
            isActive: false,
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Daily active source")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Refresh daily candidates" }));

    const storedBuffer = JSON.parse(
      window.localStorage.getItem("linkedin-brand-os:live-ingestion-buffer") ?? '{"items":[]}'
    ) as { items: Array<{ watchlistItemId?: string }> };

    expect(
      storedBuffer.items.find((item) => item.watchlistItemId === "watch-daily-active")
    ).toBeDefined();
    expect(
      storedBuffer.items.find((item) => item.watchlistItemId === "watch-daily-inactive")
    ).toBeUndefined();
  });

  it("dedupes repeated watchlist refresh snapshots safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:watchlists",
      JSON.stringify({
        items: [
          {
            id: "watch-1",
            sourceKind: "watched_url",
            label: "Watched source",
            sourceUrl: "https://example.com/source",
            isActive: true,
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Watched source")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Refresh now" }));
    await user.click(screen.getByRole("button", { name: "Refresh now" }));

    expect(screen.getByText("Skipped duplicate watchlist refresh snapshot.")).toBeInTheDocument();

    const storedBuffer = JSON.parse(
      window.localStorage.getItem("linkedin-brand-os:live-ingestion-buffer") ?? '{"items":[]}'
    ) as { items: Array<{ watchlistItemId?: string; origin?: string }> };

    expect(
      storedBuffer.items.filter(
        (item) => item.watchlistItemId === "watch-1" && item.origin === "watchlist_refresh"
      )
    ).toHaveLength(1);
  });

  it("records explicit watchlist refresh runs and filters the buffer by run safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:watchlists",
      JSON.stringify({
        items: [
          {
            id: "watch-run-1",
            sourceKind: "article_source",
            label: "Ops blog",
            sourceUrl: "https://example.com/blog",
            refreshCadence: "daily_candidate",
            isActive: true,
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "watch-run-2",
            sourceKind: "github_issue",
            label: "GitHub issues",
            sourceUrl: "https://github.com/example/repo/issues",
            refreshCadence: "weekly_candidate",
            isActive: true,
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Ops blog")).toBeInTheDocument());

    await user.click(screen.getAllByRole("button", { name: "Refresh now" })[0]);
    await user.click(screen.getAllByRole("button", { name: "Refresh now" })[1]);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Refresh: Ops blog (1)" })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Refresh: GitHub issues (1)" })
      ).toBeInTheDocument();
    });

    const storedRuns = JSON.parse(
      window.localStorage.getItem("linkedin-brand-os:live-ingestion-refresh-runs") ?? '{"items":[]}'
    ) as {
      items: Array<{
        label?: string;
        createdCount?: number;
        skippedCount?: number;
        watchlistLabels?: string[];
      }>;
    };

    expect(storedRuns.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Refresh: Ops blog",
          createdCount: 1,
          skippedCount: 0,
          watchlistLabels: ["Ops blog"]
        }),
        expect.objectContaining({
          label: "Refresh: GitHub issues",
          createdCount: 1,
          skippedCount: 0,
          watchlistLabels: ["GitHub issues"]
        })
      ])
    );

    await user.click(screen.getByRole("button", { name: "Refresh: Ops blog (1)" }));

    const bufferSection = screen.getByText("Live Ingestion Buffer").closest("section");
    expect(bufferSection).not.toBeNull();
    expect(within(bufferSection as HTMLElement).getAllByText("Ops blog").length).toBeGreaterThan(0);
    expect(
      within(bufferSection as HTMLElement).getAllByLabelText(/Select live ingestion item/).length
    ).toBe(1);
  });

  it("assigns shared refresh-run metadata to cadence refresh batches safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:watchlists",
      JSON.stringify({
        items: [
          {
            id: "watch-daily-run-1",
            sourceKind: "public_discussion_source",
            label: "Daily source one",
            refreshCadence: "daily_candidate",
            isActive: true,
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "watch-daily-run-2",
            sourceKind: "github_repo",
            label: "Daily source two",
            sourceUrl: "https://github.com/example/repo",
            refreshCadence: "daily_candidate",
            isActive: true,
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "manual-existing-1",
            sourceKind: "manual_feed_snapshot",
            sourceLabel: "Manual context",
            rawExcerpt: "Manual item should stay outside the run filter.",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "manual-existing-1",
            status: "new",
            origin: "manual"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Daily source one")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Refresh daily candidates" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Refresh daily candidates (2)" })
      ).toBeInTheDocument()
    );

    const storedBuffer = JSON.parse(
      window.localStorage.getItem("linkedin-brand-os:live-ingestion-buffer") ?? '{"items":[]}'
    ) as {
      items: Array<{
        watchlistItemId?: string;
        refreshRunId?: string;
        refreshRunLabel?: string;
      }>;
    };

    const dailyItems = storedBuffer.items.filter((item) =>
      item.watchlistItemId === "watch-daily-run-1" || item.watchlistItemId === "watch-daily-run-2"
    );

    expect(dailyItems).toHaveLength(2);
    expect(new Set(dailyItems.map((item) => item.refreshRunId))).toHaveLength(1);
    expect(new Set(dailyItems.map((item) => item.refreshRunLabel))).toEqual(
      new Set(["Refresh daily candidates"])
    );

    await user.click(screen.getByRole("button", { name: "Refresh daily candidates (2)" }));

    const bufferSection = screen.getByText("Live Ingestion Buffer").closest("section");
    expect(bufferSection).not.toBeNull();
    expect(within(bufferSection as HTMLElement).getAllByText("Daily source one").length).toBeGreaterThan(0);
    expect(within(bufferSection as HTMLElement).getAllByText("Daily source two").length).toBeGreaterThan(0);
    expect(within(bufferSection as HTMLElement).queryByText("Manual context")).not.toBeInTheDocument();
  });

  it("keeps refresh-run scoped buffer review safely behind draft completion", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:watchlists",
      JSON.stringify({
        items: [
          {
            id: "watch-review-run-1",
            sourceKind: "watched_url",
            label: "Review source",
            sourceUrl: "https://example.com/review",
            refreshCadence: "daily_candidate",
            isActive: true,
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Review source")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Refresh now" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh: Review source (1)" })).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Refresh: Review source (1)" }));
    await user.click(screen.getByRole("button", { name: "New (0)" }));

    expect(screen.getByText("No buffer items match these filters.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send to Scout Feed" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh: Review source (1)" })).toBeInTheDocument();
  });

  it("selects all items in the active refresh run safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "run-select-1",
            sourceKind: "article_watch_snapshot",
            sourceLabel: "Run source one",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "run-select-1",
            status: "draft",
            origin: "watchlist_refresh",
            watchlistItemId: "watch-run-select-1",
            refreshRunId: "run-1",
            refreshRunLabel: "Refresh daily candidates"
          },
          {
            id: "run-select-2",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Run source two",
            rawExcerpt: "Ready excerpt",
            capturedAt: "2026-03-15T00:00:01.000Z",
            fingerprint: "run-select-2",
            status: "new",
            origin: "watchlist_refresh",
            watchlistItemId: "watch-run-select-2",
            refreshRunId: "run-1",
            refreshRunLabel: "Refresh daily candidates"
          },
          {
            id: "run-select-hidden-1",
            sourceKind: "manual_feed_snapshot",
            sourceLabel: "Outside run",
            rawExcerpt: "Outside run excerpt",
            capturedAt: "2026-03-15T00:00:02.000Z",
            fingerprint: "run-select-hidden-1",
            status: "new",
            origin: "manual"
          }
        ]
      })
    );
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-refresh-runs",
      JSON.stringify({
        items: [
          {
            id: "run-1",
            label: "Refresh daily candidates",
            triggerType: "daily_candidate",
            triggeredAt: "2026-03-15T00:00:00.000Z",
            createdCount: 2,
            skippedCount: 0,
            watchlistIds: ["watch-run-select-1", "watch-run-select-2"],
            watchlistLabels: ["Run source one", "Run source two"]
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh daily candidates (2)" })).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Refresh daily candidates (2)" }));
    await user.click(screen.getByRole("button", { name: "Select run" }));

    expect(screen.getByLabelText("Select live ingestion item run-select-1")).toBeChecked();
    expect(screen.getByLabelText("Select live ingestion item run-select-2")).toBeChecked();
  });

  it("selects only eligible items in the active refresh run safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "run-eligible-1",
            sourceKind: "article_watch_snapshot",
            sourceLabel: "Run eligible",
            rawExcerpt: "Ready excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "run-eligible-1",
            status: "new",
            origin: "watchlist_refresh",
            refreshRunId: "run-eligible",
            refreshRunLabel: "Refresh: Eligible run"
          },
          {
            id: "run-eligible-2",
            sourceKind: "article_watch_snapshot",
            sourceLabel: "Run draft",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:00:01.000Z",
            fingerprint: "run-eligible-2",
            status: "draft",
            origin: "watchlist_refresh",
            refreshRunId: "run-eligible",
            refreshRunLabel: "Refresh: Eligible run"
          },
          {
            id: "run-eligible-3",
            sourceKind: "article_watch_snapshot",
            sourceLabel: "Run archived",
            rawExcerpt: "Archived excerpt",
            capturedAt: "2026-03-15T00:00:02.000Z",
            fingerprint: "run-eligible-3",
            status: "archived",
            origin: "watchlist_refresh",
            refreshRunId: "run-eligible",
            refreshRunLabel: "Refresh: Eligible run"
          }
        ]
      })
    );
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-refresh-runs",
      JSON.stringify({
        items: [
          {
            id: "run-eligible",
            label: "Refresh: Eligible run",
            triggerType: "single_watchlist",
            triggeredAt: "2026-03-15T00:00:00.000Z",
            createdCount: 3,
            skippedCount: 0,
            watchlistIds: ["watch-eligible"],
            watchlistLabels: ["Eligible run"]
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh: Eligible run (3)" })).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Refresh: Eligible run (3)" }));
    await user.click(screen.getByRole("button", { name: "Select eligible in run" }));

    expect(screen.getByLabelText("Select live ingestion item run-eligible-1")).toBeChecked();
    expect(screen.getByLabelText("Select live ingestion item run-eligible-2")).not.toBeChecked();
    expect(screen.getByLabelText("Select live ingestion item run-eligible-3")).not.toBeChecked();
  });

  it("clears only the active run selection and preserves hidden selections safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "run-clear-1",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Run clear one",
            rawExcerpt: "Ready excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "run-clear-1",
            status: "new",
            origin: "watchlist_refresh",
            refreshRunId: "run-clear",
            refreshRunLabel: "Refresh weekly candidates"
          },
          {
            id: "run-clear-2",
            sourceKind: "article_watch_snapshot",
            sourceLabel: "Run clear two",
            rawExcerpt: "Ready excerpt",
            capturedAt: "2026-03-15T00:00:01.000Z",
            fingerprint: "run-clear-2",
            status: "new",
            origin: "watchlist_refresh",
            refreshRunId: "run-clear",
            refreshRunLabel: "Refresh weekly candidates"
          },
          {
            id: "run-clear-hidden",
            sourceKind: "manual_feed_snapshot",
            sourceLabel: "Hidden selection",
            rawExcerpt: "Manual excerpt",
            capturedAt: "2026-03-15T00:00:02.000Z",
            fingerprint: "run-clear-hidden",
            status: "new",
            origin: "manual"
          }
        ]
      })
    );
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-refresh-runs",
      JSON.stringify({
        items: [
          {
            id: "run-clear",
            label: "Refresh weekly candidates",
            triggerType: "weekly_candidate",
            triggeredAt: "2026-03-15T00:00:00.000Z",
            createdCount: 2,
            skippedCount: 0,
            watchlistIds: ["watch-clear-1", "watch-clear-2"],
            watchlistLabels: ["Run clear one", "Run clear two"]
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh weekly candidates (2)" })).toBeInTheDocument()
    );

    await user.click(screen.getByLabelText("Select live ingestion item run-clear-hidden"));
    await user.click(screen.getByRole("button", { name: "Refresh weekly candidates (2)" }));
    await user.click(screen.getByRole("button", { name: "Select run" }));
    await user.click(screen.getByRole("button", { name: "Clear run selection" }));

    expect(screen.getByLabelText("Select live ingestion item run-clear-1")).not.toBeChecked();
    expect(screen.getByLabelText("Select live ingestion item run-clear-2")).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "All refresh runs" }));
    expect(screen.getByLabelText("Select live ingestion item run-clear-hidden")).toBeChecked();
  });

  it("keeps run-level batch actions quiet when no refresh run is active", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "run-quiet-1",
            sourceKind: "manual_feed_snapshot",
            sourceLabel: "Manual only",
            rawExcerpt: "Manual excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "run-quiet-1",
            status: "new",
            origin: "manual"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() =>
      expect(screen.getAllByText("Manual only").length).toBeGreaterThan(0)
    );
    expect(screen.queryByRole("button", { name: "Select run" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select eligible in run" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear run selection" })).not.toBeInTheDocument();
  });

  it("batch sends selected eligible items from the active run safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "run-send-1",
            sourceKind: "article_watch_snapshot",
            sourceLabel: "Run send one",
            sourceUrl: "https://example.com/one",
            rawExcerpt: "Ready one",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "run-send-1",
            status: "new",
            origin: "watchlist_refresh",
            refreshRunId: "run-send",
            refreshRunLabel: "Refresh active watchlists"
          },
          {
            id: "run-send-2",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Run send two",
            sourceUrl: "https://github.com/example/repo",
            rawExcerpt: "Ready two",
            capturedAt: "2026-03-15T00:00:01.000Z",
            fingerprint: "run-send-2",
            status: "new",
            origin: "watchlist_refresh",
            refreshRunId: "run-send",
            refreshRunLabel: "Refresh active watchlists"
          },
          {
            id: "run-send-3",
            sourceKind: "article_watch_snapshot",
            sourceLabel: "Run draft",
            sourceUrl: "https://example.com/draft",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:00:02.000Z",
            fingerprint: "run-send-3",
            status: "draft",
            origin: "watchlist_refresh",
            refreshRunId: "run-send",
            refreshRunLabel: "Refresh active watchlists"
          }
        ]
      })
    );
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-refresh-runs",
      JSON.stringify({
        items: [
          {
            id: "run-send",
            label: "Refresh active watchlists",
            triggerType: "active_watchlists",
            triggeredAt: "2026-03-15T00:00:00.000Z",
            createdCount: 3,
            skippedCount: 0,
            watchlistIds: ["watch-send-1", "watch-send-2", "watch-send-3"],
            watchlistLabels: ["Run send one", "Run send two", "Run draft"]
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/scout/feed") && method === "POST") {
        return jsonResponse(
          {
            audienceItems: [],
            solutionItems: [],
            summary: "2 run items sent.",
            notes: "Scout Feed stays review-first."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh active watchlists (3)" })).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Refresh active watchlists (3)" }));
    await user.click(screen.getByRole("button", { name: "Select eligible in run" }));
    await user.click(screen.getByRole("button", { name: "Send selected to Scout Feed" }));

    expect(screen.getByText("Sent 2 selected live ingestion items to Scout Feed.")).toBeInTheDocument();
    expect(screen.getByLabelText("Select live ingestion item run-send-1")).not.toBeChecked();
    expect(screen.getByLabelText("Select live ingestion item run-send-2")).not.toBeChecked();
  });

  it("selects only the visible narrowed items inside the active run safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "run-visible-1",
            sourceKind: "article_watch_snapshot",
            sourceLabel: "Run alpha visible",
            rawExcerpt: "Alpha visible excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "run-visible-1",
            status: "new",
            origin: "watchlist_refresh",
            refreshRunId: "run-visible",
            refreshRunLabel: "Refresh visible run"
          },
          {
            id: "run-visible-2",
            sourceKind: "article_watch_snapshot",
            sourceLabel: "Run beta hidden",
            rawExcerpt: "Beta hidden excerpt",
            capturedAt: "2026-03-15T00:00:01.000Z",
            fingerprint: "run-visible-2",
            status: "new",
            origin: "watchlist_refresh",
            refreshRunId: "run-visible",
            refreshRunLabel: "Refresh visible run"
          },
          {
            id: "run-visible-outside",
            sourceKind: "manual_feed_snapshot",
            sourceLabel: "Outside run visible",
            rawExcerpt: "Outside excerpt",
            capturedAt: "2026-03-15T00:00:02.000Z",
            fingerprint: "run-visible-outside",
            status: "new",
            origin: "manual"
          }
        ]
      })
    );
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-refresh-runs",
      JSON.stringify({
        items: [
          {
            id: "run-visible",
            label: "Refresh visible run",
            triggerType: "single_watchlist",
            triggeredAt: "2026-03-15T00:00:00.000Z",
            createdCount: 2,
            skippedCount: 0,
            watchlistIds: ["watch-visible-1", "watch-visible-2"],
            watchlistLabels: ["Run alpha visible", "Run beta hidden"]
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh visible run (2)" })).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Refresh visible run (2)" }));
    await user.type(screen.getByLabelText("Search buffer"), "alpha");
    await user.click(screen.getByRole("button", { name: "Select visible in run" }));

    expect(screen.getByLabelText("Select live ingestion item run-visible-1")).toBeChecked();
    expect(screen.queryByLabelText("Select live ingestion item run-visible-2")).not.toBeInTheDocument();
  });

  it("selects only eligible visible items inside the active run safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "run-visible-eligible-1",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Run eligible visible",
            rawExcerpt: "Ready visible excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "run-visible-eligible-1",
            status: "new",
            origin: "watchlist_refresh",
            refreshRunId: "run-visible-eligible",
            refreshRunLabel: "Refresh eligible visible run"
          },
          {
            id: "run-visible-eligible-2",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Run draft visible",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:00:01.000Z",
            fingerprint: "run-visible-eligible-2",
            status: "draft",
            origin: "watchlist_refresh",
            refreshRunId: "run-visible-eligible",
            refreshRunLabel: "Refresh eligible visible run"
          },
          {
            id: "run-visible-eligible-3",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Run archived hidden",
            rawExcerpt: "Archived hidden excerpt",
            capturedAt: "2026-03-15T00:00:02.000Z",
            fingerprint: "run-visible-eligible-3",
            status: "archived",
            origin: "watchlist_refresh",
            refreshRunId: "run-visible-eligible",
            refreshRunLabel: "Refresh eligible visible run"
          }
        ]
      })
    );
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-refresh-runs",
      JSON.stringify({
        items: [
          {
            id: "run-visible-eligible",
            label: "Refresh eligible visible run",
            triggerType: "single_watchlist",
            triggeredAt: "2026-03-15T00:00:00.000Z",
            createdCount: 3,
            skippedCount: 0,
            watchlistIds: ["watch-visible-eligible"],
            watchlistLabels: ["Eligible visible run"]
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Refresh eligible visible run (3)" })
      ).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Refresh eligible visible run (3)" }));
    await user.click(screen.getByRole("button", { name: "All (3)" }));
    await user.type(screen.getByLabelText("Search buffer"), "visible");
    await user.click(screen.getByRole("button", { name: "Select eligible visible in run" }));

    expect(screen.getByLabelText("Select live ingestion item run-visible-eligible-1")).toBeChecked();
    expect(screen.getByLabelText("Select live ingestion item run-visible-eligible-2")).not.toBeChecked();
  });

  it("clears only the visible narrowed run subset selection safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "run-visible-clear-1",
            sourceKind: "article_watch_snapshot",
            sourceLabel: "Run clear alpha",
            rawExcerpt: "Alpha excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "run-visible-clear-1",
            status: "new",
            origin: "watchlist_refresh",
            refreshRunId: "run-visible-clear",
            refreshRunLabel: "Refresh visible clear run"
          },
          {
            id: "run-visible-clear-2",
            sourceKind: "article_watch_snapshot",
            sourceLabel: "Run clear beta",
            rawExcerpt: "Beta excerpt",
            capturedAt: "2026-03-15T00:00:01.000Z",
            fingerprint: "run-visible-clear-2",
            status: "new",
            origin: "watchlist_refresh",
            refreshRunId: "run-visible-clear",
            refreshRunLabel: "Refresh visible clear run"
          },
          {
            id: "run-visible-clear-hidden",
            sourceKind: "manual_feed_snapshot",
            sourceLabel: "Hidden outside narrowed subset",
            rawExcerpt: "Outside narrowed excerpt",
            capturedAt: "2026-03-15T00:00:02.000Z",
            fingerprint: "run-visible-clear-hidden",
            status: "new",
            origin: "manual"
          }
        ]
      })
    );
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-refresh-runs",
      JSON.stringify({
        items: [
          {
            id: "run-visible-clear",
            label: "Refresh visible clear run",
            triggerType: "single_watchlist",
            triggeredAt: "2026-03-15T00:00:00.000Z",
            createdCount: 2,
            skippedCount: 0,
            watchlistIds: ["watch-visible-clear-1", "watch-visible-clear-2"],
            watchlistLabels: ["Run clear alpha", "Run clear beta"]
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh visible clear run (2)" })).toBeInTheDocument()
    );

    await user.click(screen.getByLabelText("Select live ingestion item run-visible-clear-hidden"));
    await user.click(screen.getByRole("button", { name: "Refresh visible clear run (2)" }));
    await user.click(screen.getByRole("button", { name: "Select run" }));
    await user.type(screen.getByLabelText("Search buffer"), "alpha");
    await user.click(screen.getByRole("button", { name: "Clear visible run selection" }));

    expect(screen.getByLabelText("Select live ingestion item run-visible-clear-1")).not.toBeChecked();
    await user.clear(screen.getByLabelText("Search buffer"));
    expect(screen.getByLabelText("Select live ingestion item run-visible-clear-2")).toBeChecked();
    await user.click(screen.getByRole("button", { name: "All refresh runs" }));
    expect(screen.getByLabelText("Select live ingestion item run-visible-clear-hidden")).toBeChecked();
  });

  it("batch sends selected eligible visible items from the active run safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "run-visible-send-1",
            sourceKind: "article_watch_snapshot",
            sourceLabel: "Run send alpha",
            sourceUrl: "https://example.com/alpha",
            rawExcerpt: "Alpha ready",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "run-visible-send-1",
            status: "new",
            origin: "watchlist_refresh",
            refreshRunId: "run-visible-send",
            refreshRunLabel: "Refresh visible send run"
          },
          {
            id: "run-visible-send-2",
            sourceKind: "article_watch_snapshot",
            sourceLabel: "Run send beta",
            sourceUrl: "https://example.com/beta",
            rawExcerpt: "Beta ready",
            capturedAt: "2026-03-15T00:00:01.000Z",
            fingerprint: "run-visible-send-2",
            status: "new",
            origin: "watchlist_refresh",
            refreshRunId: "run-visible-send",
            refreshRunLabel: "Refresh visible send run"
          },
          {
            id: "run-visible-send-3",
            sourceKind: "article_watch_snapshot",
            sourceLabel: "Run send draft",
            sourceUrl: "https://example.com/draft",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:00:02.000Z",
            fingerprint: "run-visible-send-3",
            status: "draft",
            origin: "watchlist_refresh",
            refreshRunId: "run-visible-send",
            refreshRunLabel: "Refresh visible send run"
          }
        ]
      })
    );
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-refresh-runs",
      JSON.stringify({
        items: [
          {
            id: "run-visible-send",
            label: "Refresh visible send run",
            triggerType: "single_watchlist",
            triggeredAt: "2026-03-15T00:00:00.000Z",
            createdCount: 3,
            skippedCount: 0,
            watchlistIds: ["watch-visible-send"],
            watchlistLabels: ["Visible send run"]
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/scout/feed") && method === "POST") {
        return jsonResponse(
          {
            audienceItems: [],
            solutionItems: [],
            summary: "1 visible run item sent.",
            notes: "Scout Feed stays review-first."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh visible send run (3)" })).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Refresh visible send run (3)" }));
    await user.type(screen.getByLabelText("Search buffer"), "alpha");
    await user.click(screen.getByRole("button", { name: "Select eligible visible in run" }));
    await user.click(screen.getByRole("button", { name: "Send selected to Scout Feed" }));

    expect(screen.getByText("Sent 1 selected live ingestion item to Scout Feed.")).toBeInTheDocument();
    expect(screen.getByLabelText("Select live ingestion item run-visible-send-1")).not.toBeChecked();
  });

  it("shows a compact readiness summary for the active run safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "run-ready-1",
            sourceKind: "article_watch_snapshot",
            sourceLabel: "Run ready new",
            rawExcerpt: "Ready excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "run-ready-1",
            status: "new",
            origin: "watchlist_refresh",
            refreshRunId: "run-ready",
            refreshRunLabel: "Refresh ready run"
          },
          {
            id: "run-ready-2",
            sourceKind: "article_watch_snapshot",
            sourceLabel: "Run ready draft",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:00:01.000Z",
            fingerprint: "run-ready-2",
            status: "draft",
            origin: "watchlist_refresh",
            refreshRunId: "run-ready",
            refreshRunLabel: "Refresh ready run"
          },
          {
            id: "run-ready-3",
            sourceKind: "article_watch_snapshot",
            sourceLabel: "Run ready archived",
            rawExcerpt: "Archived excerpt",
            capturedAt: "2026-03-15T00:00:02.000Z",
            fingerprint: "run-ready-3",
            status: "archived",
            origin: "watchlist_refresh",
            refreshRunId: "run-ready",
            refreshRunLabel: "Refresh ready run"
          }
        ]
      })
    );
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-refresh-runs",
      JSON.stringify({
        items: [
          {
            id: "run-ready",
            label: "Refresh ready run",
            triggerType: "single_watchlist",
            triggeredAt: "2026-03-15T00:00:00.000Z",
            createdCount: 3,
            skippedCount: 0,
            watchlistIds: ["watch-ready"],
            watchlistLabels: ["Ready run"]
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh ready run (3)" })).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Refresh ready run (3)" }));

    expect(screen.getByText("1 eligible in run")).toBeInTheDocument();
    expect(screen.getByText("2 drafts/ineligible in run")).toBeInTheDocument();
    expect(screen.getByText("Run has ready Scout Feed candidates.")).toBeInTheDocument();
  });

  it("keeps a draft-heavy run not-ready without a misleading ready hint", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "run-not-ready-1",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Draft one",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "run-not-ready-1",
            status: "draft",
            origin: "watchlist_refresh",
            refreshRunId: "run-not-ready",
            refreshRunLabel: "Refresh not ready run"
          },
          {
            id: "run-not-ready-2",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Draft two",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:00:01.000Z",
            fingerprint: "run-not-ready-2",
            status: "draft",
            origin: "watchlist_refresh",
            refreshRunId: "run-not-ready",
            refreshRunLabel: "Refresh not ready run"
          }
        ]
      })
    );
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-refresh-runs",
      JSON.stringify({
        items: [
          {
            id: "run-not-ready",
            label: "Refresh not ready run",
            triggerType: "single_watchlist",
            triggeredAt: "2026-03-15T00:00:00.000Z",
            createdCount: 2,
            skippedCount: 0,
            watchlistIds: ["watch-not-ready"],
            watchlistLabels: ["Not ready run"]
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh not ready run (2)" })).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Refresh not ready run (2)" }));

    expect(screen.getByText("0 eligible in run")).toBeInTheDocument();
    expect(screen.getByText("2 drafts/ineligible in run")).toBeInTheDocument();
    expect(screen.queryByText("Run has ready Scout Feed candidates.")).not.toBeInTheDocument();
  });

  it("keeps run readiness quiet when no active run is selected", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "run-readiness-quiet-1",
            sourceKind: "manual_feed_snapshot",
            sourceLabel: "Manual only readiness",
            rawExcerpt: "Manual excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "run-readiness-quiet-1",
            status: "new",
            origin: "manual"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() =>
      expect(screen.getAllByText("Manual only readiness").length).toBeGreaterThan(0)
    );
    expect(screen.queryByText(/eligible in run/)).not.toBeInTheDocument();
    expect(screen.queryByText(/drafts\/ineligible in run/)).not.toBeInTheDocument();
  });

  it("updates run readiness after draft completion safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "run-ready-update-1",
            sourceKind: "watched_url_snapshot",
            sourceLabel: "Draft to complete",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "run-ready-update-1",
            status: "draft",
            origin: "watchlist_refresh",
            refreshRunId: "run-ready-update",
            refreshRunLabel: "Refresh readiness update run"
          }
        ]
      })
    );
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-refresh-runs",
      JSON.stringify({
        items: [
          {
            id: "run-ready-update",
            label: "Refresh readiness update run",
            triggerType: "single_watchlist",
            triggeredAt: "2026-03-15T00:00:00.000Z",
            createdCount: 1,
            skippedCount: 0,
            watchlistIds: ["watch-ready-update"],
            watchlistLabels: ["Readiness update run"]
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Refresh readiness update run (1)" })
      ).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Refresh readiness update run (1)" }));
    expect(screen.getByText("0 eligible in run")).toBeInTheDocument();

    await user.type(
      screen.getByLabelText("Draft excerpt run-ready-update-1"),
      "Completed readiness excerpt"
    );
    await user.click(screen.getByRole("button", { name: "Complete draft" }));

    expect(screen.getByText("1 eligible in run")).toBeInTheDocument();
    expect(screen.getByText("0 drafts/ineligible in run")).toBeInTheDocument();
    expect(screen.getByText("Run has ready Scout Feed candidates.")).toBeInTheDocument();
  });

  it("shows a compact progress summary for the active run safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "run-progress-1",
            sourceKind: "article_watch_snapshot",
            sourceLabel: "Run progress new",
            rawExcerpt: "Ready excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "run-progress-1",
            status: "new",
            origin: "watchlist_refresh",
            refreshRunId: "run-progress",
            refreshRunLabel: "Refresh progress run"
          },
          {
            id: "run-progress-2",
            sourceKind: "article_watch_snapshot",
            sourceLabel: "Run progress draft",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:00:01.000Z",
            fingerprint: "run-progress-2",
            status: "draft",
            origin: "watchlist_refresh",
            refreshRunId: "run-progress",
            refreshRunLabel: "Refresh progress run"
          },
          {
            id: "run-progress-3",
            sourceKind: "article_watch_snapshot",
            sourceLabel: "Run progress sent",
            rawExcerpt: "Already sent excerpt",
            capturedAt: "2026-03-15T00:00:02.000Z",
            fingerprint: "run-progress-3",
            status: "sent_to_feed",
            origin: "watchlist_refresh",
            refreshRunId: "run-progress",
            refreshRunLabel: "Refresh progress run"
          }
        ]
      })
    );
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-refresh-runs",
      JSON.stringify({
        items: [
          {
            id: "run-progress",
            label: "Refresh progress run",
            triggerType: "single_watchlist",
            triggeredAt: "2026-03-15T00:00:00.000Z",
            createdCount: 3,
            skippedCount: 0,
            watchlistIds: ["watch-progress"],
            watchlistLabels: ["Progress run"]
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh progress run (3)" })).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Refresh progress run (3)" }));

    expect(screen.getByText("1 blocked in run")).toBeInTheDocument();
    expect(screen.getByText("1 already sent from run")).toBeInTheDocument();
    expect(screen.getByText("2 unresolved · 1 resolved in run.")).toBeInTheDocument();
  });

  it("keeps a draft-heavy run blocked and unresolved in the progress summary", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "run-progress-blocked-1",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Blocked draft one",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "run-progress-blocked-1",
            status: "draft",
            origin: "watchlist_refresh",
            refreshRunId: "run-progress-blocked",
            refreshRunLabel: "Refresh blocked progress run"
          },
          {
            id: "run-progress-blocked-2",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Blocked draft two",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:00:01.000Z",
            fingerprint: "run-progress-blocked-2",
            status: "draft",
            origin: "watchlist_refresh",
            refreshRunId: "run-progress-blocked",
            refreshRunLabel: "Refresh blocked progress run"
          }
        ]
      })
    );
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-refresh-runs",
      JSON.stringify({
        items: [
          {
            id: "run-progress-blocked",
            label: "Refresh blocked progress run",
            triggerType: "single_watchlist",
            triggeredAt: "2026-03-15T00:00:00.000Z",
            createdCount: 2,
            skippedCount: 0,
            watchlistIds: ["watch-progress-blocked"],
            watchlistLabels: ["Blocked progress run"]
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Refresh blocked progress run (2)" })
      ).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Refresh blocked progress run (2)" }));

    expect(screen.getByText("2 blocked in run")).toBeInTheDocument();
    expect(screen.getByText("0 already sent from run")).toBeInTheDocument();
    expect(screen.getByText("2 unresolved · 0 resolved in run.")).toBeInTheDocument();
  });

  it("updates run progress after draft completion safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "run-progress-update-1",
            sourceKind: "watched_url_snapshot",
            sourceLabel: "Progress draft",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "run-progress-update-1",
            status: "draft",
            origin: "watchlist_refresh",
            refreshRunId: "run-progress-update",
            refreshRunLabel: "Refresh progress update run"
          }
        ]
      })
    );
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-refresh-runs",
      JSON.stringify({
        items: [
          {
            id: "run-progress-update",
            label: "Refresh progress update run",
            triggerType: "single_watchlist",
            triggeredAt: "2026-03-15T00:00:00.000Z",
            createdCount: 1,
            skippedCount: 0,
            watchlistIds: ["watch-progress-update"],
            watchlistLabels: ["Progress update run"]
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Refresh progress update run (1)" })
      ).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Refresh progress update run (1)" }));
    expect(screen.getByText("1 blocked in run")).toBeInTheDocument();
    expect(screen.getByText("1 unresolved · 0 resolved in run.")).toBeInTheDocument();

    await user.type(
      screen.getByLabelText("Draft excerpt run-progress-update-1"),
      "Completed progress excerpt"
    );
    await user.click(screen.getByRole("button", { name: "Complete draft" }));

    expect(screen.getByText("0 blocked in run")).toBeInTheDocument();
    expect(screen.getByText("1 unresolved · 0 resolved in run.")).toBeInTheDocument();
  });

  it("updates run progress after send to Scout Feed safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "run-progress-send-1",
            sourceKind: "article_watch_snapshot",
            sourceLabel: "Progress send ready",
            sourceUrl: "https://example.com/send",
            rawExcerpt: "Ready to send",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "run-progress-send-1",
            status: "new",
            origin: "watchlist_refresh",
            refreshRunId: "run-progress-send",
            refreshRunLabel: "Refresh progress send run"
          }
        ]
      })
    );
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-refresh-runs",
      JSON.stringify({
        items: [
          {
            id: "run-progress-send",
            label: "Refresh progress send run",
            triggerType: "single_watchlist",
            triggeredAt: "2026-03-15T00:00:00.000Z",
            createdCount: 1,
            skippedCount: 0,
            watchlistIds: ["watch-progress-send"],
            watchlistLabels: ["Progress send run"]
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/scout/feed") && method === "POST") {
        return jsonResponse(
          {
            audienceItems: [],
            solutionItems: [],
            summary: "1 run progress item sent.",
            notes: "Scout Feed stays review-first."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh progress send run (1)" })).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Refresh progress send run (1)" }));
    expect(screen.getByText("0 already sent from run")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Send to Scout Feed" }));

    expect(screen.getByText("1 already sent from run")).toBeInTheDocument();
    expect(screen.getByText("0 unresolved · 1 resolved in run.")).toBeInTheDocument();
  });

  it("keeps run progress quiet when no active run is selected", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "run-progress-quiet-1",
            sourceKind: "manual_feed_snapshot",
            sourceLabel: "Manual only progress",
            rawExcerpt: "Manual excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "run-progress-quiet-1",
            status: "new",
            origin: "manual"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() =>
      expect(screen.getAllByText("Manual only progress").length).toBeGreaterThan(0)
    );
    expect(screen.queryByText(/blocked in run/)).not.toBeInTheDocument();
    expect(screen.queryByText(/already sent from run/)).not.toBeInTheDocument();
    expect(screen.queryByText(/unresolved .* resolved in run/)).not.toBeInTheDocument();
  });

  it("persists run workflow status changes safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "run-status-1",
            sourceKind: "article_watch_snapshot",
            sourceLabel: "Status run item",
            rawExcerpt: "Ready excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "run-status-1",
            status: "new",
            origin: "watchlist_refresh",
            refreshRunId: "run-status",
            refreshRunLabel: "Refresh status run"
          }
        ]
      })
    );
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-refresh-runs",
      JSON.stringify({
        items: [
          {
            id: "run-status",
            label: "Refresh status run",
            triggerType: "single_watchlist",
            triggeredAt: "2026-03-15T00:00:00.000Z",
            createdCount: 1,
            skippedCount: 0,
            watchlistIds: ["watch-status"],
            watchlistLabels: ["Status run"],
            reviewStatus: "open"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh status run (1)" })).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Refresh status run (1)" }));
    await user.click(screen.getByRole("button", { name: "Mark run completed" }));

    let storedRuns = JSON.parse(
      window.localStorage.getItem("linkedin-brand-os:live-ingestion-refresh-runs") ?? '{"items":[]}'
    ) as {
      items: Array<{ id?: string; reviewStatus?: string }>;
    };
    expect(storedRuns.items.find((item) => item.id === "run-status")?.reviewStatus).toBe("completed");

    await user.click(screen.getByRole("button", { name: "Archive run" }));

    storedRuns = JSON.parse(
      window.localStorage.getItem("linkedin-brand-os:live-ingestion-refresh-runs") ?? '{"items":[]}'
    ) as {
      items: Array<{ id?: string; reviewStatus?: string }>;
    };
    expect(storedRuns.items.find((item) => item.id === "run-status")?.reviewStatus).toBe("archived");
  });

  it("reloads persisted run workflow status safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-refresh-runs",
      JSON.stringify({
        items: [
          {
            id: "run-reload-status",
            label: "Refresh reload status run",
            triggerType: "single_watchlist",
            triggeredAt: "2026-03-15T00:00:00.000Z",
            createdCount: 1,
            skippedCount: 0,
            watchlistIds: ["watch-reload-status"],
            watchlistLabels: ["Reload status run"],
            reviewStatus: "completed"
          }
        ]
      })
    );
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "run-reload-status-1",
            sourceKind: "github_watch_snapshot",
            sourceLabel: "Reload status run",
            rawExcerpt: "Ready excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "run-reload-status-1",
            status: "new",
            origin: "watchlist_refresh",
            refreshRunId: "run-reload-status",
            refreshRunLabel: "Refresh reload status run"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh reload status run (1)" })).toBeInTheDocument()
    );
    expect(screen.getByText("completed")).toBeInTheDocument();
  });

  it("lets the operator mark a run completed, reopen it, and archive it safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-refresh-runs",
      JSON.stringify({
        items: [
          {
            id: "run-workflow-control",
            label: "Refresh workflow control run",
            triggerType: "single_watchlist",
            triggeredAt: "2026-03-15T00:00:00.000Z",
            createdCount: 1,
            skippedCount: 0,
            watchlistIds: ["watch-workflow-control"],
            watchlistLabels: ["Workflow control run"]
          }
        ]
      })
    );
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "run-workflow-control-1",
            sourceKind: "watched_url_snapshot",
            sourceLabel: "Workflow control run",
            rawExcerpt: "Ready excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "run-workflow-control-1",
            status: "new",
            origin: "watchlist_refresh",
            refreshRunId: "run-workflow-control",
            refreshRunLabel: "Refresh workflow control run"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Refresh workflow control run (1)" })
      ).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Refresh workflow control run (1)" }));
    expect(screen.getByText("open")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mark run completed" }));
    expect(screen.getByText("completed")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reopen run" }));
    expect(screen.getByText("open")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Archive run" }));
    expect(screen.getAllByText("archived").length).toBeGreaterThan(0);
  });

  it("does not change draft or send eligibility rules when run workflow status changes", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-refresh-runs",
      JSON.stringify({
        items: [
          {
            id: "run-status-send",
            label: "Refresh status send run",
            triggerType: "single_watchlist",
            triggeredAt: "2026-03-15T00:00:00.000Z",
            createdCount: 2,
            skippedCount: 0,
            watchlistIds: ["watch-status-send"],
            watchlistLabels: ["Status send run"]
          }
        ]
      })
    );
    window.localStorage.setItem(
      "linkedin-brand-os:live-ingestion-buffer",
      JSON.stringify({
        items: [
          {
            id: "run-status-send-1",
            sourceKind: "article_watch_snapshot",
            sourceLabel: "Status send ready",
            rawExcerpt: "Ready excerpt",
            capturedAt: "2026-03-15T00:00:00.000Z",
            fingerprint: "run-status-send-1",
            status: "new",
            origin: "watchlist_refresh",
            refreshRunId: "run-status-send",
            refreshRunLabel: "Refresh status send run"
          },
          {
            id: "run-status-send-2",
            sourceKind: "article_watch_snapshot",
            sourceLabel: "Status send draft",
            rawExcerpt: "",
            capturedAt: "2026-03-15T00:00:01.000Z",
            fingerprint: "run-status-send-2",
            status: "draft",
            origin: "watchlist_refresh",
            refreshRunId: "run-status-send",
            refreshRunLabel: "Refresh status send run"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh status send run (2)" })).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Refresh status send run (2)" }));
    await user.click(screen.getByRole("button", { name: "Mark run completed" }));

    expect(screen.getByRole("button", { name: "Send to Scout Feed" })).toBeInTheDocument();
    expect(
      screen.getByText("Add excerpt text to make this item ready for Scout Feed.")
    ).toBeInTheDocument();
  });

  it("ignores malformed persisted refresh-run storage safely", async () => {
    window.localStorage.setItem("linkedin-brand-os:live-ingestion-refresh-runs", "{not-json");

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => expect(screen.getByText("Operator Watchlists")).toBeInTheDocument());
    expect(
      screen.queryByRole("button", { name: /Refresh daily candidates \(/ })
    ).not.toBeInTheDocument();
  });

  it("ignores malformed watchlist storage safely", async () => {
    window.localStorage.setItem("linkedin-brand-os:watchlists", "{not-json");

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    expect(screen.getByText("Operator Watchlists")).toBeInTheDocument();
    expect(screen.queryByText("Use for snapshot")).not.toBeInTheDocument();
  });

  it("filters watchlists by active and inactive state safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:watchlists",
      JSON.stringify({
        items: [
          {
            id: "watch-active-1",
            sourceKind: "watched_url",
            label: "Active source",
            refreshCadence: "manual_only",
            isActive: true,
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "watch-inactive-1",
            sourceKind: "article_source",
            label: "Inactive source",
            refreshCadence: "weekly_candidate",
            isActive: false,
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Active source")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Active (1)" }));
    expect(screen.getByText("Active source")).toBeInTheDocument();
    expect(screen.queryByText("Inactive source")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Inactive (1)" }));
    expect(screen.getByText("Inactive source")).toBeInTheDocument();
    expect(screen.queryByText("Active source")).not.toBeInTheDocument();
  });

  it("filters watchlists by cadence, priority, and source kind safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:watchlists",
      JSON.stringify({
        items: [
          {
            id: "watch-manual-normal",
            sourceKind: "watched_url",
            label: "Manual normal source",
            refreshCadence: "manual_only",
            isActive: true,
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "watch-daily-high",
            sourceKind: "github_release",
            label: "Daily high repo releases",
            refreshCadence: "daily_candidate",
            priority: "high",
            isActive: true,
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "watch-weekly-normal",
            sourceKind: "article_source",
            label: "Weekly article source",
            refreshCadence: "weekly_candidate",
            priority: "normal",
            isActive: true,
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Daily high repo releases")).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText("Watchlist cadence filter"), "daily_candidate");
    expect(screen.getByText("Daily high repo releases")).toBeInTheDocument();
    expect(screen.queryByText("Manual normal source")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Watchlist cadence filter"), "all");
    await user.selectOptions(screen.getByLabelText("Watchlist priority filter"), "normal");
    expect(screen.getByText("Manual normal source")).toBeInTheDocument();
    expect(screen.getByText("Weekly article source")).toBeInTheDocument();
    expect(screen.queryByText("Daily high repo releases")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Watchlist priority filter"), "all");
    await user.selectOptions(screen.getByLabelText("Watchlist source kind filter"), "github_release");
    expect(screen.getByText("Daily high repo releases")).toBeInTheDocument();
    expect(screen.queryByText("Weekly article source")).not.toBeInTheDocument();
  });

  it("supports combined watchlist filtering safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:watchlists",
      JSON.stringify({
        items: [
          {
            id: "watch-match-1",
            sourceKind: "github_issue",
            label: "Active daily high issue source",
            refreshCadence: "daily_candidate",
            priority: "high",
            isActive: true,
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "watch-nonmatch-1",
            sourceKind: "github_issue",
            label: "Inactive daily high issue source",
            refreshCadence: "daily_candidate",
            priority: "high",
            isActive: false,
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          {
            id: "watch-nonmatch-2",
            sourceKind: "github_release",
            label: "Active daily high release source",
            refreshCadence: "daily_candidate",
            priority: "high",
            isActive: true,
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Active daily high issue source")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Active (2)" }));
    await user.selectOptions(screen.getByLabelText("Watchlist cadence filter"), "daily_candidate");
    await user.selectOptions(screen.getByLabelText("Watchlist priority filter"), "high");
    await user.selectOptions(screen.getByLabelText("Watchlist source kind filter"), "github_issue");

    expect(screen.getByText("Active daily high issue source")).toBeInTheDocument();
    expect(screen.queryByText("Inactive daily high issue source")).not.toBeInTheDocument();
    expect(screen.queryByText("Active daily high release source")).not.toBeInTheDocument();
  });

  it("renders a safe empty state when no watchlists match the current filters", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:watchlists",
      JSON.stringify({
        items: [
          {
            id: "watch-1",
            sourceKind: "watched_url",
            label: "Only watched URL source",
            refreshCadence: "manual_only",
            isActive: true,
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Only watched URL source")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Inactive (0)" }));
    expect(screen.getByText("No watchlists match these filters.")).toBeInTheDocument();
    expect(screen.queryByText("Only watched URL source")).not.toBeInTheDocument();
  });

  it("keeps watchlist actions working under filtered views safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:watchlists",
      JSON.stringify({
        items: [
          {
            id: "watch-filter-action-1",
            sourceKind: "github_release",
            label: "Filtered repo releases",
            sourceUrl: "https://github.com/example/repo/releases",
            notes: "Track rollout changes.",
            refreshCadence: "daily_candidate",
            priority: "high",
            isActive: true,
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Filtered repo releases")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Active (1)" }));
    await user.selectOptions(screen.getByLabelText("Watchlist cadence filter"), "daily_candidate");
    await user.selectOptions(screen.getByLabelText("Watchlist priority filter"), "high");
    await user.selectOptions(screen.getByLabelText("Watchlist source kind filter"), "github_release");

    await user.click(screen.getByRole("button", { name: "Use for snapshot" }));
    expect(screen.getByText("Prefilled live ingestion buffer from watchlist item.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Refresh now" }));
    expect(screen.getByText("Refreshed watchlist item into Live Ingestion Buffer.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create snapshot" }));
    expect(screen.getByText("Skipped duplicate draft live ingestion snapshot.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Deactivate" }));
    expect(screen.getByText("Deactivated watchlist item.")).toBeInTheDocument();
    expect(screen.getByText("No watchlists match these filters.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Inactive (1)" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByText("Removed watchlist item.")).toBeInTheDocument();
  });

  it("normalizes source intake and can send the result to Decision Planner", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      if (url.endsWith("/sources/intake") && method === "POST") {
        return jsonResponse(
          {
            sourceType: "article",
            title: "Why AI copilots fail after the demo",
            sourceUrl: "https://example.com/copilots",
            rawSummary:
              "Most AI copilots look impressive in a demo, but collapse in real work because nobody designs the surrounding process.",
            normalizedSignalText:
              "Most AI copilots fail after the demo because nobody owns the workflow or exception path around them.",
            suggestedAngle: "ownership_gap",
            reasoningSummary: "Article intake points to an ownership gap in a live workflow.",
            targetRole: "Founder",
            companyContext: "B2B operations software",
            plannerReadyPayload: {
              signalText:
                "Most AI copilots fail after the demo because nobody owns the workflow or exception path around them.",
              sourceType: "article",
              targetRole: "Founder",
              companyContext: "B2B operations software",
              bestAngle: "ownership_gap",
              reasoningSummary:
                "Article intake points to an ownership gap in a live workflow."
            }
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Plan the next best operator action")).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Intake source type"), "article");
    await user.type(screen.getByLabelText("Intake title"), "Why AI copilots fail after the demo");
    await user.type(
      screen.getByLabelText("Intake summary / notes"),
      "Most AI copilots look impressive in a demo, but collapse in real work because nobody designs the surrounding process."
    );
    await user.type(screen.getByLabelText("Intake target role/title"), "Founder");
    await user.click(screen.getByRole("button", { name: "Normalize Source" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Most AI copilots fail after the demo because nobody owns the workflow or exception path around them."
        )
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Send to Decision Planner" }));

    expect(screen.getByLabelText("Decision signal text")).toHaveValue(
      "Most AI copilots fail after the demo because nobody owns the workflow or exception path around them."
    );
    expect(screen.getByLabelText("Decision source type")).toHaveValue("article");
    expect(screen.getByLabelText("Decision target role/title")).toHaveValue("Founder");
    expect(screen.getByLabelText("Optional best angle")).toHaveValue("ownership_gap");
  });

  it("normalizes GitHub intake and can send the result to Decision Planner", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      if (url.endsWith("/sources/intake") && method === "POST") {
        return jsonResponse(
          {
            sourceType: "github",
            title: "Queue visibility fixes in the orchestration repo",
            sourceUrl: "https://github.com/example/orchestrator/releases/tag/v1.4.0",
            rawSummary:
              "The release adds queue-state visibility, retry handling, and clearer ownership for failed automations so operators can see what needs intervention.",
            normalizedSignalText:
              "When automation queues hide failure ownership, operators cannot recover workflow momentum fast enough to keep execution on track.",
            suggestedAngle: "workflow_accountability",
            reasoningSummary: "GitHub release notes point to workflow accountability and recovery visibility.",
            targetRole: "Operations leader",
            companyContext: "Ops automation platform",
            plannerReadyPayload: {
              signalText:
                "When automation queues hide failure ownership, operators cannot recover workflow momentum fast enough to keep execution on track.",
              sourceType: "github",
              targetRole: "Operations leader",
              companyContext: "Ops automation platform",
              bestAngle: "workflow_accountability",
              reasoningSummary:
                "GitHub release notes point to workflow accountability and recovery visibility."
            }
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Plan the next best operator action")).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Intake source type"), "github");
    await user.type(
      screen.getByLabelText("Intake title"),
      "Queue visibility fixes in the orchestration repo"
    );
    await user.type(
      screen.getByLabelText("Intake source URL"),
      "https://github.com/example/orchestrator/releases/tag/v1.4.0"
    );
    await user.type(screen.getByLabelText("Repo name"), "example/orchestrator");
    await user.type(screen.getByLabelText("Repo / release context"), "Ops automation platform");
    await user.type(
      screen.getByLabelText("Intake summary / notes"),
      "The release adds queue-state visibility, retry handling, and clearer ownership for failed automations so operators can see what needs intervention."
    );
    await user.click(screen.getByRole("button", { name: "Normalize Source" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "When automation queues hide failure ownership, operators cannot recover workflow momentum fast enough to keep execution on track."
        )
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Send to Decision Planner" }));

    expect(screen.getByLabelText("Decision signal text")).toHaveValue(
      "When automation queues hide failure ownership, operators cannot recover workflow momentum fast enough to keep execution on track."
    );
    expect(screen.getByLabelText("Decision source type")).toHaveValue("github");
    expect(screen.getByLabelText("Decision target role/title")).toHaveValue("Operations leader");
    expect(screen.getByLabelText("Optional best angle")).toHaveValue("workflow_accountability");
  });

  it("normalizes GitHub release intake with subtype-aware framing and can send the result to Decision Planner", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      if (url.endsWith("/sources/intake") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        expect(body.githubSubtype).toBe("release");

        return jsonResponse(
          {
            sourceType: "github",
            title: "v1.4 ships approval visibility and rollout controls",
            sourceUrl: "https://github.com/example/orchestrator/releases/tag/v1.4.0",
            rawSummary:
              "The release packages approval visibility, queue controls, and simpler rollout settings so teams can ship adoption changes with less operator confusion.",
            normalizedSignalText:
              "Strong GitHub releases signal shipping momentum when rollout controls and operator visibility make adoption easier in real teams.",
            suggestedAngle: "operational_roi",
            reasoningSummary: "GitHub release intake points to rollout momentum and adoption packaging, not just change logs.",
            plannerReadyPayload: {
              signalText:
                "Strong GitHub releases signal shipping momentum when rollout controls and operator visibility make adoption easier in real teams.",
              sourceType: "github",
              bestAngle: "operational_roi",
              reasoningSummary:
                "GitHub release intake points to rollout momentum and adoption packaging, not just change logs."
            }
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Plan the next best operator action")).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Intake source type"), "github");
    await user.selectOptions(screen.getByLabelText("GitHub subtype"), "release");
    await user.type(
      screen.getByLabelText("Intake title"),
      "v1.4 ships approval visibility and rollout controls"
    );
    await user.type(
      screen.getByLabelText("Intake summary / notes"),
      "The release packages approval visibility, queue controls, and simpler rollout settings so teams can ship adoption changes with less operator confusion."
    );
    await user.click(screen.getByRole("button", { name: "Normalize Source" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Strong GitHub releases signal shipping momentum when rollout controls and operator visibility make adoption easier in real teams."
        )
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Send to Decision Planner" }));
    expect(screen.getByLabelText("Decision source type")).toHaveValue("github");
  });

  it("normalizes source intake and can save the result for later", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      if (url.endsWith("/sources/intake") && method === "POST") {
        return jsonResponse(
          {
            sourceType: "manual_research",
            title: "Approval workflow friction",
            rawSummary:
              "Manual interviews show approvals stall because exception handling is undefined and nobody owns the next step after the pilot.",
            normalizedSignalText:
              "Approval workflows stall when exception handling is undefined and nobody owns the next step after the pilot.",
            suggestedAngle: "exception_handling",
            reasoningSummary: "Manual research intake points to a process gap worth revisiting.",
            plannerReadyPayload: {
              signalText:
                "Approval workflows stall when exception handling is undefined and nobody owns the next step after the pilot.",
              sourceType: "note",
              bestAngle: "exception_handling",
              reasoningSummary:
                "Manual research intake points to a process gap worth revisiting."
            }
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Plan the next best operator action")).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Intake source type"), "manual_research");
    await user.type(screen.getByLabelText("Intake title"), "Approval workflow friction");
    await user.type(
      screen.getByLabelText("Intake summary / notes"),
      "Manual interviews show approvals stall because exception handling is undefined and nobody owns the next step after the pilot."
    );
    await user.click(screen.getByRole("button", { name: "Normalize Source" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Approval workflows stall when exception handling is undefined and nobody owns the next step after the pilot."
        )
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Save for later" }));

    expect(screen.getAllByText("Saved for later").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        "Approval workflows stall when exception handling is undefined and nobody owns the next step after the pilot."
      ).length
    ).toBeGreaterThan(1);
  });

  it("normalizes GitHub intake and can save the result for later", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      if (url.endsWith("/sources/intake") && method === "POST") {
        return jsonResponse(
          {
            sourceType: "github",
            title: "Fallback queueing for failed agent runs",
            rawSummary:
              "Adds retry orchestration, dead-letter queue handling, and visibility into failed runs after webhook exceptions.",
            normalizedSignalText:
              "Operators need visible retry ownership and clearer workflow recovery when automations fail in production.",
            suggestedAngle: "execution_lesson",
            reasoningSummary: "GitHub change notes translate into an execution lesson about workflow recovery.",
            plannerReadyPayload: {
              signalText:
                "Operators need visible retry ownership and clearer workflow recovery when automations fail in production.",
              sourceType: "github",
              bestAngle: "execution_lesson",
              reasoningSummary:
                "GitHub change notes translate into an execution lesson about workflow recovery."
            }
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Plan the next best operator action")).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Intake source type"), "github");
    await user.type(screen.getByLabelText("Intake title"), "Fallback queueing for failed agent runs");
    await user.type(
      screen.getByLabelText("Intake summary / notes"),
      "Adds retry orchestration, dead-letter queue handling, and visibility into failed runs after webhook exceptions."
    );
    await user.click(screen.getByRole("button", { name: "Normalize Source" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Operators need visible retry ownership and clearer workflow recovery when automations fail in production."
        )
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Save for later" }));

    expect(screen.getAllByText("Saved for later").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        "Operators need visible retry ownership and clearer workflow recovery when automations fail in production."
      ).length
    ).toBeGreaterThan(1);
  });

  it("normalizes GitHub issue intake and can save the result for later", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      if (url.endsWith("/sources/intake") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        expect(body.githubSubtype).toBe("issue");

        return jsonResponse(
          {
            sourceType: "github",
            title: "Approval queue stalls after exception path",
            rawSummary:
              "Users report approvals stall after edge-case exceptions, support load rises, and nobody can see who owns recovery once the workflow breaks.",
            normalizedSignalText:
              "When issue traffic exposes stalled exception paths, operators inherit workflow pain, support burden, and unclear recovery ownership.",
            suggestedAngle: "exception_handling",
            reasoningSummary: "GitHub issue intake highlights user-facing workflow friction and execution pain.",
            plannerReadyPayload: {
              signalText:
                "When issue traffic exposes stalled exception paths, operators inherit workflow pain, support burden, and unclear recovery ownership.",
              sourceType: "github",
              bestAngle: "exception_handling",
              reasoningSummary:
                "GitHub issue intake highlights user-facing workflow friction and execution pain."
            }
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Plan the next best operator action")).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Intake source type"), "github");
    await user.selectOptions(screen.getByLabelText("GitHub subtype"), "issue");
    await user.type(screen.getByLabelText("Intake title"), "Approval queue stalls after exception path");
    await user.type(
      screen.getByLabelText("Intake summary / notes"),
      "Users report approvals stall after edge-case exceptions, support load rises, and nobody can see who owns recovery once the workflow breaks."
    );
    await user.click(screen.getByRole("button", { name: "Normalize Source" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "When issue traffic exposes stalled exception paths, operators inherit workflow pain, support burden, and unclear recovery ownership."
        )
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Save for later" }));

    expect(
      screen.getAllByText(
        "When issue traffic exposes stalled exception paths, operators inherit workflow pain, support burden, and unclear recovery ownership."
      ).length
    ).toBeGreaterThan(1);
  });

  it("creates a persisted signal from normalized article intake through the existing signal path", async () => {
    const signals: Signal[] = [];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse(signals);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      if (url.endsWith("/sources/intake") && method === "POST") {
        return jsonResponse(
          {
            sourceType: "article",
            title: "Why AI copilots fail after the demo",
            sourceUrl: "https://example.com/copilots",
            rawSummary:
              "Most AI copilots look impressive in a demo, but collapse in real work because nobody designs the surrounding process.",
            normalizedSignalText:
              "Most AI copilots fail after the demo because nobody owns the workflow or exception path around them.",
            suggestedAngle: "ownership_gap",
            reasoningSummary: "Article intake points to an ownership gap in a live workflow.",
            targetRole: "Founder",
            companyContext: "B2B operations software",
            plannerReadyPayload: {
              signalText:
                "Most AI copilots fail after the demo because nobody owns the workflow or exception path around them.",
              sourceType: "article",
              targetRole: "Founder",
              companyContext: "B2B operations software",
              bestAngle: "ownership_gap",
              reasoningSummary:
                "Article intake points to an ownership gap in a live workflow."
            }
          },
          201
        );
      }

      if (url.endsWith("/signals") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        const created: Signal = {
          id: "sig-intake-1",
          title: body.title,
          sourceType: body.sourceType,
          rawText: body.rawText,
          status: "new",
          createdAt: "2026-03-14T19:00:00.000Z"
        };
        signals.push(created);
        return jsonResponse(created, 201);
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(
        screen.getByText("Normalize article, GitHub, or research notes into a reusable signal")
      ).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Intake source type"), "article");
    await user.type(screen.getByLabelText("Intake title"), "Why AI copilots fail after the demo");
    await user.type(
      screen.getByLabelText("Intake summary / notes"),
      "Most AI copilots look impressive in a demo, but collapse in real work because nobody designs the surrounding process."
    );
    await user.click(screen.getByRole("button", { name: "Normalize Source" }));

    await waitFor(() => {
      expect(screen.getByText(/Most AI copilots fail after the demo/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Create Signal from Intake" }));

    await waitFor(() => {
      expect(screen.getByText("Why AI copilots fail after the demo")).toBeInTheDocument();
      expect(screen.getByText("Created signal from intake.")).toBeInTheDocument();
    });

    expect(signals).toEqual([
      expect.objectContaining({
        title: "Why AI copilots fail after the demo",
        sourceType: "research",
        rawText:
          "Most AI copilots fail after the demo because nobody owns the workflow or exception path around them."
      })
    ]);
    expect(screen.getByRole("button", { name: "Open created signal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate idea from created signal" })).toBeInTheDocument();
  });

  it("creates a persisted signal from normalized GitHub intake through the existing signal path", async () => {
    const signals: Signal[] = [];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse(signals);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      if (url.endsWith("/sources/intake") && method === "POST") {
        return jsonResponse(
          {
            sourceType: "github",
            title: "Queue visibility fixes in the orchestration repo",
            sourceUrl: "https://github.com/example/orchestrator/releases/tag/v1.4.0",
            rawSummary:
              "The release adds queue-state visibility, retry handling, and clearer ownership for failed automations so operators can see what needs intervention.",
            normalizedSignalText:
              "When automation queues hide failure ownership, operators cannot recover workflow momentum fast enough to keep execution on track.",
            suggestedAngle: "workflow_accountability",
            reasoningSummary: "GitHub release notes point to workflow accountability and recovery visibility.",
            plannerReadyPayload: {
              signalText:
                "When automation queues hide failure ownership, operators cannot recover workflow momentum fast enough to keep execution on track.",
              sourceType: "github",
              bestAngle: "workflow_accountability",
              reasoningSummary:
                "GitHub release notes point to workflow accountability and recovery visibility."
            }
          },
          201
        );
      }

      if (url.endsWith("/signals") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        const created: Signal = {
          id: "sig-intake-github-1",
          title: body.title,
          sourceType: body.sourceType,
          rawText: body.rawText,
          status: "new",
          createdAt: "2026-03-14T19:00:00.000Z"
        };
        signals.push(created);
        return jsonResponse(created, 201);
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(
        screen.getByText("Normalize article, GitHub, or research notes into a reusable signal")
      ).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Intake source type"), "github");
    await user.type(
      screen.getByLabelText("Intake title"),
      "Queue visibility fixes in the orchestration repo"
    );
    await user.type(
      screen.getByLabelText("Intake summary / notes"),
      "The release adds queue-state visibility, retry handling, and clearer ownership for failed automations so operators can see what needs intervention."
    );
    await user.click(screen.getByRole("button", { name: "Normalize Source" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "When automation queues hide failure ownership, operators cannot recover workflow momentum fast enough to keep execution on track."
        )
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Create Signal from Intake" }));

    await waitFor(() => {
      expect(screen.getByText("Queue visibility fixes in the orchestration repo")).toBeInTheDocument();
      expect(screen.getByText("Created signal from intake.")).toBeInTheDocument();
    });

    expect(signals).toEqual([
      expect.objectContaining({
        title: "Queue visibility fixes in the orchestration repo",
        sourceType: "research",
        rawText:
          "When automation queues hide failure ownership, operators cannot recover workflow momentum fast enough to keep execution on track."
      })
    ]);
  });

  it("creates a persisted signal from subtype-aware GitHub repo-change intake through the existing signal path", async () => {
    const signals: Signal[] = [];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse(signals);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      if (url.endsWith("/sources/intake") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        expect(body.githubSubtype).toBe("repo_change");

        return jsonResponse(
          {
            sourceType: "github",
            title: "State orchestration refactor for async workers",
            rawSummary:
              "Refactors state orchestration for async workers, queue ownership, and retry boundaries to reduce scaling failures and make tradeoffs more visible.",
            normalizedSignalText:
              "System changes around state orchestration reveal the tradeoff between scaling flexibility and operator clarity when workflow ownership gets more distributed.",
            suggestedAngle: "workflow_accountability",
            reasoningSummary: "GitHub repo changes can surface architecture and orchestration tradeoffs that matter to operators.",
            plannerReadyPayload: {
              signalText:
                "System changes around state orchestration reveal the tradeoff between scaling flexibility and operator clarity when workflow ownership gets more distributed.",
              sourceType: "github",
              bestAngle: "workflow_accountability",
              reasoningSummary:
                "GitHub repo changes can surface architecture and orchestration tradeoffs that matter to operators."
            }
          },
          201
        );
      }

      if (url.endsWith("/signals") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        const created: Signal = {
          id: "sig-intake-github-subtype-1",
          title: body.title,
          sourceType: body.sourceType,
          rawText: body.rawText,
          status: "new",
          createdAt: "2026-03-14T19:00:00.000Z"
        };
        signals.push(created);
        return jsonResponse(created, 201);
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(
        screen.getByText("Normalize article, GitHub, or research notes into a reusable signal")
      ).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Intake source type"), "github");
    await user.selectOptions(screen.getByLabelText("GitHub subtype"), "repo_change");
    await user.type(
      screen.getByLabelText("Intake title"),
      "State orchestration refactor for async workers"
    );
    await user.type(
      screen.getByLabelText("Intake summary / notes"),
      "Refactors state orchestration for async workers, queue ownership, and retry boundaries to reduce scaling failures and make tradeoffs more visible."
    );
    await user.click(screen.getByRole("button", { name: "Normalize Source" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "System changes around state orchestration reveal the tradeoff between scaling flexibility and operator clarity when workflow ownership gets more distributed."
        )
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Create Signal from Intake" }));

    await waitFor(() => {
      expect(screen.getByText("State orchestration refactor for async workers")).toBeInTheDocument();
      expect(screen.getByText("Created signal from intake.")).toBeInTheDocument();
    });

    expect(signals).toEqual([
      expect.objectContaining({
        title: "State orchestration refactor for async workers",
        sourceType: "research",
        rawText:
          "System changes around state orchestration reveal the tradeoff between scaling flexibility and operator clarity when workflow ownership gets more distributed."
      })
    ]);
  });

  it("creates a persisted signal from normalized manual research intake without requiring URL", async () => {
    const signals: Signal[] = [];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse(signals);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      if (url.endsWith("/sources/intake") && method === "POST") {
        return jsonResponse(
          {
            sourceType: "manual_research",
            title: "Approval workflow friction",
            rawSummary:
              "Manual interviews show approvals stall because exception handling is undefined and nobody owns the next step after the pilot.",
            normalizedSignalText:
              "Approval workflows stall when exception handling is undefined and nobody owns the next step after the pilot.",
            suggestedAngle: "exception_handling",
            reasoningSummary: "Manual research intake points to a process gap worth revisiting.",
            plannerReadyPayload: {
              signalText:
                "Approval workflows stall when exception handling is undefined and nobody owns the next step after the pilot.",
              sourceType: "note",
              bestAngle: "exception_handling",
              reasoningSummary:
                "Manual research intake points to a process gap worth revisiting."
            }
          },
          201
        );
      }

      if (url.endsWith("/signals") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        const created: Signal = {
          id: "sig-intake-2",
          title: body.title,
          sourceType: body.sourceType,
          rawText: body.rawText,
          status: "new",
          createdAt: "2026-03-14T19:10:00.000Z"
        };
        signals.push(created);
        return jsonResponse(created, 201);
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(
        screen.getByText("Normalize article, GitHub, or research notes into a reusable signal")
      ).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Intake source type"), "manual_research");
    await user.type(screen.getByLabelText("Intake title"), "Approval workflow friction");
    await user.type(
      screen.getByLabelText("Intake summary / notes"),
      "Manual interviews show approvals stall because exception handling is undefined and nobody owns the next step after the pilot."
    );
    await user.click(screen.getByRole("button", { name: "Normalize Source" }));

    await waitFor(() => {
      expect(screen.getByText(/Approval workflows stall when exception handling is undefined/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Create Signal from Intake" }));

    await waitFor(() => {
      expect(screen.getByText("Created signal from intake.")).toBeInTheDocument();
    });

    expect(signals).toEqual([
      expect.objectContaining({
        title: "Approval workflow friction",
        sourceType: "manual",
        rawText:
          "Approval workflows stall when exception handling is undefined and nobody owns the next step after the pilot."
      })
    ]);
  });

  it("can open the created signal after intake promotion", async () => {
    const signals: Signal[] = [];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse(signals);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      if (url.endsWith("/sources/intake") && method === "POST") {
        return jsonResponse(
          {
            sourceType: "article",
            title: "Why AI copilots fail after the demo",
            rawSummary: "Demo success hides workflow failure.",
            normalizedSignalText:
              "Most AI copilots fail after the demo because nobody owns the workflow or exception path around them.",
            suggestedAngle: "ownership_gap",
            reasoningSummary: "Article intake points to an ownership gap in a live workflow.",
            plannerReadyPayload: {
              signalText:
                "Most AI copilots fail after the demo because nobody owns the workflow or exception path around them.",
              sourceType: "article",
              bestAngle: "ownership_gap",
              reasoningSummary:
                "Article intake points to an ownership gap in a live workflow."
            }
          },
          201
        );
      }

      if (url.endsWith("/signals") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        const created: Signal = {
          id: "sig-open-1",
          title: body.title,
          sourceType: body.sourceType,
          rawText: body.rawText,
          status: "new",
          createdAt: "2026-03-14T19:20:00.000Z"
        };
        signals.push(created);
        return jsonResponse(created, 201);
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(
        screen.getByText("Normalize article, GitHub, or research notes into a reusable signal")
      ).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Intake source type"), "article");
    await user.type(screen.getByLabelText("Intake title"), "Why AI copilots fail after the demo");
    await user.type(screen.getByLabelText("Intake summary / notes"), "Demo success hides workflow failure.");
    await user.click(screen.getByRole("button", { name: "Normalize Source" }));
    await user.click(screen.getByRole("button", { name: "Create Signal from Intake" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open created signal" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Open created signal" }));

    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Opened created signal.")).toBeInTheDocument();
  });

  it("can generate an idea from the created signal continuation action", async () => {
    const signals: Signal[] = [];
    const ideas: Idea[] = [];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse(signals);
        if (url.endsWith("/ideas")) return jsonResponse(ideas);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      if (url.endsWith("/sources/intake") && method === "POST") {
        return jsonResponse(
          {
            sourceType: "article",
            title: "Why AI copilots fail after the demo",
            rawSummary: "Demo success hides workflow failure.",
            normalizedSignalText:
              "Most AI copilots fail after the demo because nobody owns the workflow or exception path around them.",
            suggestedAngle: "ownership_gap",
            reasoningSummary: "Article intake points to an ownership gap in a live workflow.",
            plannerReadyPayload: {
              signalText:
                "Most AI copilots fail after the demo because nobody owns the workflow or exception path around them.",
              sourceType: "article",
              bestAngle: "ownership_gap",
              reasoningSummary:
                "Article intake points to an ownership gap in a live workflow."
            }
          },
          201
        );
      }

      if (url.endsWith("/signals") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        const created: Signal = {
          id: "sig-idea-1",
          title: body.title,
          sourceType: body.sourceType,
          rawText: body.rawText,
          status: "new",
          createdAt: "2026-03-14T19:25:00.000Z"
        };
        signals.push(created);
        return jsonResponse(created, 201);
      }

      if (url.endsWith("/ideas/generate") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        const created: Idea = {
          id: "idea-from-intake",
          signalId: body.signalId,
          title: "Ownership is the real blocker",
          coreInsight: "The model is not the bottleneck when the workflow has no owner.",
          businessRelevance: "This slows rollout and trust.",
          targetAudience: "Founders",
          status: "draft",
          createdAt: "2026-03-14T19:26:00.000Z"
        };
        ideas.push(created);
        return jsonResponse(created, 201);
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(
        screen.getByText("Normalize article, GitHub, or research notes into a reusable signal")
      ).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Intake source type"), "article");
    await user.type(screen.getByLabelText("Intake title"), "Why AI copilots fail after the demo");
    await user.type(screen.getByLabelText("Intake summary / notes"), "Demo success hides workflow failure.");
    await user.click(screen.getByRole("button", { name: "Normalize Source" }));
    await user.click(screen.getByRole("button", { name: "Create Signal from Intake" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Generate idea from created signal" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Generate idea from created signal" }));

    await waitFor(() => {
      expect(screen.getByText("Ownership is the real blocker")).toBeInTheDocument();
      expect(
        screen.getByText("The model is not the bottleneck when the workflow has no owner.")
      ).toBeInTheDocument();
    });
  });

  it("shows Generate Draft continuation after an idea exists and reuses the normal draft flow", async () => {
    const signals: Signal[] = [];
    const ideas: Idea[] = [];
    const contentAssets: ContentAsset[] = [];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse(signals);
        if (url.endsWith("/ideas")) return jsonResponse(ideas);
        if (url.endsWith("/content")) return jsonResponse(contentAssets);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      if (url.endsWith("/sources/intake") && method === "POST") {
        return jsonResponse(
          {
            sourceType: "article",
            title: "Why AI copilots fail after the demo",
            rawSummary: "Demo success hides workflow failure.",
            normalizedSignalText:
              "Most AI copilots fail after the demo because nobody owns the workflow or exception path around them.",
            suggestedAngle: "ownership_gap",
            reasoningSummary: "Article intake points to an ownership gap in a live workflow.",
            plannerReadyPayload: {
              signalText:
                "Most AI copilots fail after the demo because nobody owns the workflow or exception path around them.",
              sourceType: "article",
              bestAngle: "ownership_gap",
              reasoningSummary:
                "Article intake points to an ownership gap in a live workflow."
            }
          },
          201
        );
      }

      if (url.endsWith("/signals") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        const created: Signal = {
          id: "sig-draft-1",
          title: body.title,
          sourceType: body.sourceType,
          rawText: body.rawText,
          status: "new",
          createdAt: "2026-03-14T19:30:00.000Z"
        };
        signals.push(created);
        return jsonResponse(created, 201);
      }

      if (url.endsWith("/ideas/generate") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        const created: Idea = {
          id: "idea-draft-1",
          signalId: body.signalId,
          title: "Ownership is the real blocker",
          coreInsight: "The model is not the bottleneck when the workflow has no owner.",
          businessRelevance: "This slows rollout and trust.",
          targetAudience: "Founders",
          status: "draft",
          createdAt: "2026-03-14T19:31:00.000Z"
        };
        ideas.push(created);
        return jsonResponse(created, 201);
      }

      if (url.endsWith("/content/generate") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        const created: ContentAsset = {
          id: "content-draft-1",
          ideaId: body.ideaId,
          contentType: "linkedin-post",
          hook: "Ownership breaks first",
          body: "The workflow fails long before the model does when nobody owns the rollout.",
          cta: "What are you seeing?",
          status: "draft",
          createdAt: "2026-03-14T19:32:00.000Z"
        };
        contentAssets.push(created);
        return jsonResponse(created, 201);
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(
        screen.getByText("Normalize article, GitHub, or research notes into a reusable signal")
      ).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Intake source type"), "article");
    await user.type(screen.getByLabelText("Intake title"), "Why AI copilots fail after the demo");
    await user.type(screen.getByLabelText("Intake summary / notes"), "Demo success hides workflow failure.");
    await user.click(screen.getByRole("button", { name: "Normalize Source" }));
    await user.click(screen.getByRole("button", { name: "Create Signal from Intake" }));

    expect(screen.getByRole("button", { name: "Generate draft from created signal" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Generate idea from created signal" }));

    await waitFor(() => {
      expect(screen.getByText("Ownership is the real blocker")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Generate draft from created signal" })).not.toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Generate draft from created signal" }));

    await waitFor(() => {
      expect(screen.getByText("Ownership breaks first")).toBeInTheDocument();
      expect(
        screen.getByText("The workflow fails long before the model does when nobody owns the rollout.")
      ).toBeInTheDocument();
    });
  });

  it("uses VITE_API_BASE_URL for initial requests when no prop override is provided", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://127.0.0.1:4000");

    fetchMock.mockImplementation(async () => jsonResponse([]));

    render(<App />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4000/signals",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("keeps successful sections loaded and shows endpoint diagnostics when one initial request fails", async () => {
    const signals: Signal[] = [
      {
        id: "signal-1",
        title: "Buyer signal",
        sourceType: "manual",
        rawText: "A founder asked about AI operations readiness.",
        status: "new",
        createdAt: "2026-03-14T00:00:00.000Z"
      }
    ];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/signals") && method === "GET") return jsonResponse(signals);
      if (url.endsWith("/ideas") && method === "GET") return jsonResponse([]);
      if (url.endsWith("/content") && method === "GET") return jsonResponse([]);
      if (url.endsWith("/visuals") && method === "GET") return jsonResponse([]);
      if (url.endsWith("/analytics") && method === "GET") return jsonResponse([]);
      if (url.endsWith("/strategy/recommendations") && method === "GET") {
        return jsonResponse(
          { error: "no strategy snapshots available for this workspace" },
          500
        );
      }
      if (url.endsWith("/sources") && method === "GET") return jsonResponse([]);
      if (url.endsWith("/markets") && method === "GET") return jsonResponse([]);
      if (url.endsWith("/topics/scores") && method === "GET") return jsonResponse([]);
      if (url.endsWith("/queue") && method === "GET") return jsonResponse([]);
      if (url.endsWith("/brand-voice") && method === "GET") {
        return jsonResponse({ active: null, profiles: [] });
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Buyer signal")).toBeInTheDocument();
    });

    expect(screen.getByText("Some sections failed to load.")).toBeInTheDocument();
    expect(
      screen.getAllByText(/Strategy recommendations failed: GET \/strategy\/recommendations/)
        .length
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/Status: 500/).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/no strategy snapshots available for this workspace/).length
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Section unavailable.").length).toBeGreaterThan(0);
    expect(screen.getByText("1 active")).toBeInTheDocument();
  });

  it("renders the server-side content workspace with work-item status and draft progress", async () => {
    const workspaceItems: AutonomousContentWorkItem[] = [
      {
        id: "work-1",
        sourceMatchedOpportunityId: "match-1",
        watchlistId: "watch-1",
        autonomousRunId: "run-1",
        workItemKind: "post",
        title: "Execution prep post",
        summary: "Show where rollout ownership breaks after promotion.",
        rationale: "Strong deterministic match for operator execution friction.",
        recommendedAction: "write_post",
        priorityScore: 91,
        priorityBand: "high",
        reviewState: "saved",
        status: "ready_for_draft",
        draftProgress: {
          hasDraft: true,
          draftId: "draft-1",
          draftStatus: "ready",
          draftUpdatedAt: "2026-03-16T14:10:00.000Z"
        },
        createdAt: "2026-03-16T13:00:00.000Z",
        updatedAt: "2026-03-16T14:15:00.000Z"
      },
      {
        id: "work-2",
        sourceMatchedOpportunityId: "match-2",
        watchlistId: "watch-1",
        autonomousRunId: "run-1",
        workItemKind: "comment",
        title: "Execution prep comment",
        summary: "Comment-first follow-up for rollout accountability thread.",
        rationale: "Deterministic follow-up item for a saved operator thread.",
        recommendedAction: "write_comment",
        priorityScore: 73,
        priorityBand: "medium",
        reviewState: "saved",
        status: "draft",
        draftProgress: {
          hasDraft: false
        },
        createdAt: "2026-03-16T13:10:00.000Z",
        updatedAt: "2026-03-16T14:05:00.000Z"
      }
    ];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/content-work-items") && method === "GET") {
        return jsonResponse(workspaceItems);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Execution prep post")).toBeInTheDocument();
    });

    const workspace = screen.getByRole("region", { name: "Server content workspace" });
    expect(within(workspace).getByText("2 queued")).toBeInTheDocument();
    expect(
      within(workspace).getByText("Show where rollout ownership breaks after promotion.")
    ).toBeInTheDocument();
    expect(within(workspace).getByText("ready for draft")).toBeInTheDocument();
    expect(within(workspace).getByText("draft ready")).toBeInTheDocument();
    expect(within(workspace).getByText("No server draft yet")).toBeInTheDocument();
    expect(within(workspace).getAllByText("comment").length).toBeGreaterThan(0);
    expect(
      within(workspace).getAllByRole("button", { name: /View details for workspace item/ }).length
    ).toBe(2);
    expect(within(workspace).getByLabelText("Workspace status filter")).toHaveValue("all");
    expect(within(workspace).getByLabelText("Workspace kind filter")).toHaveValue("all");
    expect(within(workspace).getByLabelText("Workspace draft presence filter")).toHaveValue("all");
    expect(within(workspace).getByLabelText("Workspace draft status filter")).toHaveValue("all");
    expect(within(workspace).getByLabelText("Workspace sort")).toHaveValue("updated_desc");
  });

  it("keeps the default server-side content workspace ordering intact and supports alternate sorting", async () => {
    const newestItem: AutonomousContentWorkItem = {
      id: "work-newest",
      sourceMatchedOpportunityId: "match-newest",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "post",
      title: "Newest drafted item",
      summary: "Newest summary",
      rationale: "Newest rationale",
      recommendedAction: "write_post",
      priorityScore: 91,
      priorityBand: "high",
      reviewState: "saved",
      status: "ready_for_draft",
      draftProgress: {
        hasDraft: true,
        draftId: "draft-1",
        draftStatus: "ready",
        draftUpdatedAt: "2026-03-16T14:10:00.000Z"
      },
      createdAt: "2026-03-16T13:00:00.000Z",
      updatedAt: "2026-03-16T14:15:00.000Z"
    };

    const oldestItem: AutonomousContentWorkItem = {
      ...newestItem,
      id: "work-oldest",
      title: "Oldest draftless item",
      workItemKind: "comment",
      status: "blocked",
      draftProgress: { hasDraft: false },
      updatedAt: "2026-03-16T12:15:00.000Z"
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";

      if (url.pathname.endsWith("/autonomy/content-work-items") && method === "GET") {
        const sort = url.searchParams.get("sort");
        if (sort === "updated_asc") {
          return jsonResponse([oldestItem, newestItem]);
        }
        if (sort === "status") {
          return jsonResponse([newestItem, oldestItem]);
        }
        if (sort === "has_draft") {
          return jsonResponse([newestItem, oldestItem]);
        }
        return jsonResponse([newestItem, oldestItem]);
      }

      const initial = respondWithEmptyDashboard(url.toString(), method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await screen.findByText("Newest drafted item");
    const workspace = await screen.findByRole("region", { name: "Server content workspace" });
    expect(within(workspace).getAllByRole("heading", { level: 4 })[0]).toHaveTextContent(
      "Newest drafted item"
    );

    await user.selectOptions(within(workspace).getByLabelText("Workspace sort"), "updated_asc");
    await waitFor(() => {
      expect(within(workspace).getAllByRole("heading", { level: 4 })[0]).toHaveTextContent(
        "Oldest draftless item"
      );
    });

    await user.selectOptions(within(workspace).getByLabelText("Workspace sort"), "has_draft");
    await waitFor(() => {
      expect(within(workspace).getAllByRole("heading", { level: 4 })[0]).toHaveTextContent(
        "Newest drafted item"
      );
    });
  });

  it("filters the server-side content workspace by work-item status using server query params", async () => {
    const readyItem: AutonomousContentWorkItem = {
      id: "work-ready",
      sourceMatchedOpportunityId: "match-ready",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "post",
      title: "Ready for draft item",
      summary: "Ready summary",
      rationale: "Ready rationale",
      recommendedAction: "write_post",
      priorityScore: 91,
      priorityBand: "high",
      reviewState: "saved",
      status: "ready_for_draft",
      draftProgress: { hasDraft: false },
      createdAt: "2026-03-16T13:00:00.000Z",
      updatedAt: "2026-03-16T14:15:00.000Z"
    };

    const blockedItem: AutonomousContentWorkItem = {
      ...readyItem,
      id: "work-blocked",
      title: "Blocked item",
      status: "blocked"
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";

      if (url.pathname.endsWith("/autonomy/content-work-items") && method === "GET") {
        const status = url.searchParams.get("status");
        if (status === "blocked") {
          return jsonResponse([blockedItem]);
        }
        return jsonResponse([readyItem, blockedItem]);
      }

      const initial = respondWithEmptyDashboard(url.toString(), method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await screen.findByText("Ready for draft item");
    const workspace = await screen.findByRole("region", { name: "Server content workspace" });
    expect(within(workspace).getByText("Ready for draft item")).toBeInTheDocument();
    expect(within(workspace).getByText("Blocked item")).toBeInTheDocument();

    await user.selectOptions(within(workspace).getByLabelText("Workspace status filter"), "blocked");

    await waitFor(() => {
      expect(within(workspace).getByText("Blocked item")).toBeInTheDocument();
      expect(within(workspace).queryByText("Ready for draft item")).not.toBeInTheDocument();
    });
  });

  it("filters the server-side content workspace by kind, draft presence, and draft status using server query params", async () => {
    const postWithReadyDraft: AutonomousContentWorkItem = {
      id: "work-post-ready",
      sourceMatchedOpportunityId: "match-1",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "post",
      title: "Post with ready draft",
      summary: "Ready post summary",
      rationale: "Ready post rationale",
      recommendedAction: "write_post",
      priorityScore: 91,
      priorityBand: "high",
      reviewState: "saved",
      status: "ready_for_draft",
      draftProgress: {
        hasDraft: true,
        draftId: "draft-1",
        draftStatus: "ready",
        draftUpdatedAt: "2026-03-16T14:10:00.000Z"
      },
      createdAt: "2026-03-16T13:00:00.000Z",
      updatedAt: "2026-03-16T14:15:00.000Z"
    };

    const commentWithoutDraft: AutonomousContentWorkItem = {
      ...postWithReadyDraft,
      id: "work-comment-none",
      workItemKind: "comment",
      title: "Comment without draft",
      draftProgress: { hasDraft: false }
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";

      if (url.pathname.endsWith("/autonomy/content-work-items") && method === "GET") {
        const kind = url.searchParams.get("kind");
        const hasDraft = url.searchParams.get("hasDraft");
        const draftStatus = url.searchParams.get("draftStatus");

        if (kind === "comment") {
          return jsonResponse([commentWithoutDraft]);
        }
        if (hasDraft === "false") {
          return jsonResponse([commentWithoutDraft]);
        }
        if (draftStatus === "ready") {
          return jsonResponse([postWithReadyDraft]);
        }

        return jsonResponse([postWithReadyDraft, commentWithoutDraft]);
      }

      const initial = respondWithEmptyDashboard(url.toString(), method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    const workspace = await screen.findByRole("region", { name: "Server content workspace" });

    await user.selectOptions(within(workspace).getByLabelText("Workspace kind filter"), "comment");
    await waitFor(() => {
      expect(within(workspace).getByText("Comment without draft")).toBeInTheDocument();
      expect(within(workspace).queryByText("Post with ready draft")).not.toBeInTheDocument();
    });

    await user.selectOptions(within(workspace).getByLabelText("Workspace kind filter"), "all");
    await user.selectOptions(within(workspace).getByLabelText("Workspace draft presence filter"), "false");
    await waitFor(() => {
      expect(within(workspace).getByText("Comment without draft")).toBeInTheDocument();
      expect(within(workspace).queryByText("Post with ready draft")).not.toBeInTheDocument();
    });

    await user.selectOptions(within(workspace).getByLabelText("Workspace draft presence filter"), "all");
    await user.selectOptions(within(workspace).getByLabelText("Workspace draft status filter"), "ready");
    await waitFor(() => {
      expect(within(workspace).getByText("Post with ready draft")).toBeInTheDocument();
      expect(within(workspace).queryByText("Comment without draft")).not.toBeInTheDocument();
    });
  });

  it("keeps server-side workspace filtering and sorting working together safely", async () => {
    const blockedDraftless: AutonomousContentWorkItem = {
      id: "work-blocked",
      sourceMatchedOpportunityId: "match-blocked",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "comment",
      title: "Blocked draftless item",
      summary: "Blocked summary",
      rationale: "Blocked rationale",
      recommendedAction: "write_comment",
      priorityScore: 60,
      priorityBand: "medium",
      reviewState: "saved",
      status: "blocked",
      draftProgress: { hasDraft: false },
      createdAt: "2026-03-16T13:00:00.000Z",
      updatedAt: "2026-03-16T12:15:00.000Z"
    };

    const blockedWithDraft: AutonomousContentWorkItem = {
      ...blockedDraftless,
      id: "work-blocked-draft",
      title: "Blocked drafted item",
      draftProgress: {
        hasDraft: true,
        draftId: "draft-2",
        draftStatus: "ready",
        draftUpdatedAt: "2026-03-16T14:10:00.000Z"
      },
      updatedAt: "2026-03-16T14:15:00.000Z"
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";

      if (url.pathname.endsWith("/autonomy/content-work-items") && method === "GET") {
        const status = url.searchParams.get("status");
        const sort = url.searchParams.get("sort");

        if (status === "blocked" && sort === "has_draft") {
          return jsonResponse([blockedWithDraft, blockedDraftless]);
        }

        return jsonResponse([blockedDraftless, blockedWithDraft]);
      }

      const initial = respondWithEmptyDashboard(url.toString(), method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    const workspace = await screen.findByRole("region", { name: "Server content workspace" });
    await user.selectOptions(within(workspace).getByLabelText("Workspace status filter"), "blocked");
    await user.selectOptions(within(workspace).getByLabelText("Workspace sort"), "has_draft");

    await waitFor(() => {
      expect(within(workspace).getAllByRole("heading", { level: 4 })[0]).toHaveTextContent(
        "Blocked drafted item"
      );
      expect(within(workspace).getByText("Blocked draftless item")).toBeInTheDocument();
    });
  });

  it("shows a safe empty state when server-side workspace filters return no items", async () => {
    const workspaceItem: AutonomousContentWorkItem = {
      id: "work-1",
      sourceMatchedOpportunityId: "match-1",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "post",
      title: "Ready for draft item",
      summary: "Ready summary",
      rationale: "Ready rationale",
      recommendedAction: "write_post",
      priorityScore: 91,
      priorityBand: "high",
      reviewState: "saved",
      status: "ready_for_draft",
      draftProgress: { hasDraft: false },
      createdAt: "2026-03-16T13:00:00.000Z",
      updatedAt: "2026-03-16T14:15:00.000Z"
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";

      if (url.pathname.endsWith("/autonomy/content-work-items") && method === "GET") {
        const status = url.searchParams.get("status");
        if (status === "archived") {
          return jsonResponse([]);
        }
        return jsonResponse([workspaceItem]);
      }

      const initial = respondWithEmptyDashboard(url.toString(), method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    const workspace = await screen.findByRole("region", { name: "Server content workspace" });
    await user.selectOptions(within(workspace).getByLabelText("Workspace status filter"), "archived");

    await waitFor(() => {
      expect(
        within(workspace).getByText("No server-side content work items match the current filters.")
      ).toBeInTheDocument();
    });
  });

  it("opens one server-side content workspace item and shows rationale and draft linkage read-only", async () => {
    const workspaceItems: AutonomousContentWorkItem[] = [
      {
        id: "work-1",
        sourceMatchedOpportunityId: "match-1",
        watchlistId: "watch-1",
        autonomousRunId: "run-1",
        workItemKind: "post",
        title: "Execution prep post",
        summary: "Show where rollout ownership breaks after promotion.",
        rationale: "Strong deterministic match for operator execution friction.",
        recommendedAction: "write_post",
        priorityScore: 91,
        priorityBand: "high",
        reviewState: "saved",
        status: "ready_for_draft",
        draftProgress: {
          hasDraft: true,
          draftId: "draft-1",
          draftStatus: "ready",
          draftUpdatedAt: "2026-03-16T14:10:00.000Z"
        },
        createdAt: "2026-03-16T13:00:00.000Z",
        updatedAt: "2026-03-16T14:15:00.000Z"
      }
    ];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/content-work-items/work-1") && method === "GET") {
        return jsonResponse(workspaceItems[0]);
      }

      if (url.endsWith("/autonomy/content-work-items") && method === "GET") {
        return jsonResponse(workspaceItems);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Execution prep post")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "View details for workspace item Execution prep post" }));

    await waitFor(() => {
      expect(screen.getByText("Recommended action")).toBeInTheDocument();
      expect(screen.getByText("write_post")).toBeInTheDocument();
      expect(screen.getByText("Rationale")).toBeInTheDocument();
      expect(
        screen.getByText("Strong deterministic match for operator execution friction.")
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Work item status select")).toHaveValue("ready_for_draft");
      expect(screen.getByText("Linked draft")).toBeInTheDocument();
      expect(screen.getByText("draft-1")).toBeInTheDocument();
      expect(screen.getByText("Draft status: ready")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "View linked draft draft-1" })).toBeInTheDocument();
  });

  it("persists work-item status updates through the dedicated content work-item status route", async () => {
    let workspaceItem: AutonomousContentWorkItem = {
      id: "work-1",
      sourceMatchedOpportunityId: "match-1",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "post",
      title: "Execution prep post",
      summary: "Show where rollout ownership breaks after promotion.",
      rationale: "Strong deterministic match for operator execution friction.",
      recommendedAction: "write_post",
      priorityScore: 91,
      priorityBand: "high",
      reviewState: "saved",
      status: "ready_for_draft",
      draftProgress: {
        hasDraft: true,
        draftId: "draft-1",
        draftStatus: "ready",
        draftUpdatedAt: "2026-03-16T14:10:00.000Z"
      },
      createdAt: "2026-03-16T13:00:00.000Z",
      updatedAt: "2026-03-16T14:15:00.000Z"
    };

    let statusPayload: Record<string, unknown> | null = null;

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/content-work-items/work-1/status") && method === "PATCH") {
        statusPayload = JSON.parse(String(init?.body)) as Record<string, unknown>;
        workspaceItem = {
          ...workspaceItem,
          status: statusPayload.status as AutonomousContentWorkItem["status"],
          updatedAt: "2026-03-16T15:20:00.000Z"
        };
        return jsonResponse(workspaceItem);
      }
      if (url.endsWith("/autonomy/content-work-items/work-1") && method === "GET") {
        return jsonResponse(workspaceItem);
      }
      if (url.endsWith("/autonomy/content-work-items") && method === "GET") {
        return jsonResponse([workspaceItem]);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Execution prep post")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "View details for workspace item Execution prep post" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Work item status select")).toHaveValue("ready_for_draft");
    });

    await user.selectOptions(screen.getByLabelText("Work item status select"), "blocked");
    await user.click(screen.getByRole("button", { name: "Apply work item status" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Work item status select")).toHaveValue("blocked");
      expect(screen.getAllByText("blocked").length).toBeGreaterThan(0);
    });

    expect(statusPayload).toEqual({ status: "blocked" });
  });

  it("shows an inline error when work-item status update fails", async () => {
    const workspaceItem: AutonomousContentWorkItem = {
      id: "work-1",
      sourceMatchedOpportunityId: "match-1",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "post",
      title: "Execution prep post",
      summary: "Show where rollout ownership breaks after promotion.",
      rationale: "Strong deterministic match for operator execution friction.",
      recommendedAction: "write_post",
      priorityScore: 91,
      priorityBand: "high",
      reviewState: "saved",
      status: "ready_for_draft",
      draftProgress: {
        hasDraft: true,
        draftId: "draft-1",
        draftStatus: "ready",
        draftUpdatedAt: "2026-03-16T14:10:00.000Z"
      },
      createdAt: "2026-03-16T13:00:00.000Z",
      updatedAt: "2026-03-16T14:15:00.000Z"
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/content-work-items/work-1/status") && method === "PATCH") {
        return jsonResponse({ error: "work item status update failed" }, 500);
      }
      if (url.endsWith("/autonomy/content-work-items/work-1") && method === "GET") {
        return jsonResponse(workspaceItem);
      }
      if (url.endsWith("/autonomy/content-work-items") && method === "GET") {
        return jsonResponse([workspaceItem]);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Execution prep post")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "View details for workspace item Execution prep post" }));
    await user.selectOptions(screen.getByLabelText("Work item status select"), "parked");
    await user.click(screen.getByRole("button", { name: "Apply work item status" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          /Work item status update failed: PATCH \/autonomy\/content-work-items\/work-1\/status/
        )
      ).toBeInTheDocument();
      expect(screen.getByText(/work item status update failed/)).toBeInTheDocument();
    });
  });

  it("shows inspection loading and error states for a server-side content workspace item", async () => {
    const workspaceItems: AutonomousContentWorkItem[] = [
      {
        id: "work-1",
        sourceMatchedOpportunityId: "match-1",
        watchlistId: "watch-1",
        autonomousRunId: "run-1",
        workItemKind: "post",
        title: "Execution prep post",
        summary: "Show where rollout ownership breaks after promotion.",
        rationale: "Strong deterministic match for operator execution friction.",
        recommendedAction: "write_post",
        priorityScore: 91,
        priorityBand: "high",
        reviewState: "saved",
        status: "ready_for_draft",
        draftProgress: {
          hasDraft: true,
          draftId: "draft-1",
          draftStatus: "ready",
          draftUpdatedAt: "2026-03-16T14:10:00.000Z"
        },
        createdAt: "2026-03-16T13:00:00.000Z",
        updatedAt: "2026-03-16T14:15:00.000Z"
      }
    ];

    let resolveItemRequest!: (response: Response) => void;
    const itemRequest = new Promise<Response>((resolve) => {
      resolveItemRequest = resolve;
    });

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/content-work-items/work-1") && method === "GET") {
        return itemRequest;
      }

      if (url.endsWith("/autonomy/content-work-items") && method === "GET") {
        return jsonResponse(workspaceItems);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Execution prep post")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "View details for workspace item Execution prep post" }));
    expect(screen.getByText("Loading item details...")).toBeInTheDocument();

    resolveItemRequest(jsonResponse({ error: "workspace item unavailable" }, 500));

    await waitFor(() => {
      expect(screen.getByText(/Item inspection failed: GET \/autonomy\/content-work-items\/work-1/)).toBeInTheDocument();
      expect(screen.getByText(/workspace item unavailable/)).toBeInTheDocument();
    });
  });

  it("opens the linked draft document from work-item inspection and shows key draft fields read-only", async () => {
    const workspaceItem: AutonomousContentWorkItem = {
      id: "work-1",
      sourceMatchedOpportunityId: "match-1",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "post",
      title: "Execution prep post",
      summary: "Show where rollout ownership breaks after promotion.",
      rationale: "Strong deterministic match for operator execution friction.",
      recommendedAction: "write_post",
      priorityScore: 91,
      priorityBand: "high",
      reviewState: "saved",
      status: "ready_for_draft",
      draftProgress: {
        hasDraft: true,
        draftId: "draft-1",
        draftStatus: "ready",
        draftUpdatedAt: "2026-03-16T14:10:00.000Z"
      },
      createdAt: "2026-03-16T13:00:00.000Z",
      updatedAt: "2026-03-16T14:15:00.000Z"
    };

    const draft: AutonomousDraftDocument = {
      id: "draft-1",
      sourceContentWorkItemId: "work-1",
      title: "Execution prep draft",
      body: "Start with the rollout handoff problem.\n\nThen show where ownership breaks after the demo.",
      angle: "ownership gap",
      sourceSummary: "Show where rollout ownership breaks after promotion.",
      recommendedAction: "write_post",
      status: "ready",
      createdAt: "2026-03-16T14:00:00.000Z",
      updatedAt: "2026-03-16T14:10:00.000Z"
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/drafts/draft-1") && method === "GET") {
        return jsonResponse(draft);
      }
      if (url.endsWith("/autonomy/content-work-items/work-1") && method === "GET") {
        return jsonResponse(workspaceItem);
      }
      if (url.endsWith("/autonomy/content-work-items") && method === "GET") {
        return jsonResponse([workspaceItem]);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Execution prep post")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "View details for workspace item Execution prep post" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View linked draft draft-1" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "View linked draft draft-1" }));

    await waitFor(() => {
      expect(screen.getByText("Draft title")).toBeInTheDocument();
      expect(screen.getByText("Execution prep draft")).toBeInTheDocument();
      expect(screen.getAllByText("Draft status").length).toBeGreaterThan(0);
      expect(screen.getByLabelText("Draft status select")).toHaveValue("ready");
      expect(screen.getByText("Draft angle")).toBeInTheDocument();
      expect(screen.getByText("ownership gap")).toBeInTheDocument();
      expect(screen.getByText("Draft body preview")).toBeInTheDocument();
      expect(
        screen.getByText(/Start with the rollout handoff problem/)
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Edit draft draft-1" })).toBeInTheDocument();
    expect(screen.getByLabelText("Draft status select")).toHaveValue("ready");
  });

  it("lets the operator enter and cancel inline draft edit mode without mutating the draft", async () => {
    const workspaceItem: AutonomousContentWorkItem = {
      id: "work-1",
      sourceMatchedOpportunityId: "match-1",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "post",
      title: "Execution prep post",
      summary: "Show where rollout ownership breaks after promotion.",
      rationale: "Strong deterministic match for operator execution friction.",
      recommendedAction: "write_post",
      priorityScore: 91,
      priorityBand: "high",
      reviewState: "saved",
      status: "ready_for_draft",
      draftProgress: {
        hasDraft: true,
        draftId: "draft-1",
        draftStatus: "ready",
        draftUpdatedAt: "2026-03-16T14:10:00.000Z"
      },
      createdAt: "2026-03-16T13:00:00.000Z",
      updatedAt: "2026-03-16T14:15:00.000Z"
    };

    const draft: AutonomousDraftDocument = {
      id: "draft-1",
      sourceContentWorkItemId: "work-1",
      title: "Execution prep draft",
      body: "Start with the rollout handoff problem.\n\nThen show where ownership breaks after the demo.",
      angle: "ownership gap",
      sourceSummary: "Show where rollout ownership breaks after promotion.",
      recommendedAction: "write_post",
      status: "ready",
      createdAt: "2026-03-16T14:00:00.000Z",
      updatedAt: "2026-03-16T14:10:00.000Z"
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/drafts/draft-1") && method === "GET") {
        return jsonResponse(draft);
      }
      if (url.endsWith("/autonomy/content-work-items/work-1") && method === "GET") {
        return jsonResponse(workspaceItem);
      }
      if (url.endsWith("/autonomy/content-work-items") && method === "GET") {
        return jsonResponse([workspaceItem]);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Execution prep post")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "View details for workspace item Execution prep post" }));
    await user.click(await screen.findByRole("button", { name: "View linked draft draft-1" }));
    await user.click(await screen.findByRole("button", { name: "Edit draft draft-1" }));

    expect(screen.getByLabelText("Draft title input")).toHaveValue("Execution prep draft");
    expect(screen.getByLabelText("Draft angle input")).toHaveValue("ownership gap");

    await user.clear(screen.getByLabelText("Draft title input"));
    await user.type(screen.getByLabelText("Draft title input"), "Edited title");
    await user.click(screen.getByRole("button", { name: "Cancel draft edit" }));

    expect(screen.getByText("Execution prep draft")).toBeInTheDocument();
    expect(screen.queryByLabelText("Draft title input")).not.toBeInTheDocument();
  });

  it("persists inline draft edits through the existing draft update route", async () => {
    const workspaceItem: AutonomousContentWorkItem = {
      id: "work-1",
      sourceMatchedOpportunityId: "match-1",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "post",
      title: "Execution prep post",
      summary: "Show where rollout ownership breaks after promotion.",
      rationale: "Strong deterministic match for operator execution friction.",
      recommendedAction: "write_post",
      priorityScore: 91,
      priorityBand: "high",
      reviewState: "saved",
      status: "ready_for_draft",
      draftProgress: {
        hasDraft: true,
        draftId: "draft-1",
        draftStatus: "ready",
        draftUpdatedAt: "2026-03-16T14:10:00.000Z"
      },
      createdAt: "2026-03-16T13:00:00.000Z",
      updatedAt: "2026-03-16T14:15:00.000Z"
    };

    let draft: AutonomousDraftDocument = {
      id: "draft-1",
      sourceContentWorkItemId: "work-1",
      title: "Execution prep draft",
      body: "Start with the rollout handoff problem.\n\nThen show where ownership breaks after the demo.",
      angle: "ownership gap",
      sourceSummary: "Show where rollout ownership breaks after promotion.",
      recommendedAction: "write_post",
      status: "ready",
      createdAt: "2026-03-16T14:00:00.000Z",
      updatedAt: "2026-03-16T14:10:00.000Z"
    };

    let patchPayload: Record<string, unknown> | null = null;

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/drafts/draft-1") && method === "PATCH") {
        const parsedPatchPayload = JSON.parse(String(init?.body)) as Record<string, unknown>;
        patchPayload = parsedPatchPayload;
        draft = {
          ...draft,
          title: String(parsedPatchPayload.title),
          body: String(parsedPatchPayload.body),
          angle: String(parsedPatchPayload.angle),
          updatedAt: "2026-03-16T15:00:00.000Z"
        };
        return jsonResponse(draft);
      }
      if (url.endsWith("/autonomy/drafts/draft-1") && method === "GET") {
        return jsonResponse(draft);
      }
      if (url.endsWith("/autonomy/content-work-items/work-1") && method === "GET") {
        return jsonResponse(workspaceItem);
      }
      if (url.endsWith("/autonomy/content-work-items") && method === "GET") {
        return jsonResponse([workspaceItem]);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Execution prep post")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "View details for workspace item Execution prep post" }));
    await user.click(await screen.findByRole("button", { name: "View linked draft draft-1" }));
    await user.click(await screen.findByRole("button", { name: "Edit draft draft-1" }));

    await user.clear(screen.getByLabelText("Draft title input"));
    await user.type(screen.getByLabelText("Draft title input"), "Edited execution prep draft");
    await user.clear(screen.getByLabelText("Draft angle input"));
    await user.type(screen.getByLabelText("Draft angle input"), "clear ownership seam");
    await user.clear(screen.getByLabelText("Draft body input"));
    await user.type(
      screen.getByLabelText("Draft body input"),
      "Lead with the coordination break.{enter}{enter}Then show how ownership fades after launch."
    );
    await user.click(screen.getByRole("button", { name: "Save draft changes" }));

    await waitFor(() => {
      expect(screen.getByText("Edited execution prep draft")).toBeInTheDocument();
      expect(screen.getByText("clear ownership seam")).toBeInTheDocument();
      expect(screen.getByText(/Lead with the coordination break/)).toBeInTheDocument();
    });

    expect(patchPayload).toEqual({
      title: "Edited execution prep draft",
      body: "Lead with the coordination break.\n\nThen show how ownership fades after launch.",
      angle: "clear ownership seam"
    });
  });

  it("shows an inline error when saving draft edits fails", async () => {
    const workspaceItem: AutonomousContentWorkItem = {
      id: "work-1",
      sourceMatchedOpportunityId: "match-1",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "post",
      title: "Execution prep post",
      summary: "Show where rollout ownership breaks after promotion.",
      rationale: "Strong deterministic match for operator execution friction.",
      recommendedAction: "write_post",
      priorityScore: 91,
      priorityBand: "high",
      reviewState: "saved",
      status: "ready_for_draft",
      draftProgress: {
        hasDraft: true,
        draftId: "draft-1",
        draftStatus: "ready",
        draftUpdatedAt: "2026-03-16T14:10:00.000Z"
      },
      createdAt: "2026-03-16T13:00:00.000Z",
      updatedAt: "2026-03-16T14:15:00.000Z"
    };

    const draft: AutonomousDraftDocument = {
      id: "draft-1",
      sourceContentWorkItemId: "work-1",
      title: "Execution prep draft",
      body: "Start with the rollout handoff problem.\n\nThen show where ownership breaks after the demo.",
      angle: "ownership gap",
      sourceSummary: "Show where rollout ownership breaks after promotion.",
      recommendedAction: "write_post",
      status: "ready",
      createdAt: "2026-03-16T14:00:00.000Z",
      updatedAt: "2026-03-16T14:10:00.000Z"
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/drafts/draft-1") && method === "PATCH") {
        return jsonResponse({ error: "draft update failed" }, 500);
      }
      if (url.endsWith("/autonomy/drafts/draft-1") && method === "GET") {
        return jsonResponse(draft);
      }
      if (url.endsWith("/autonomy/content-work-items/work-1") && method === "GET") {
        return jsonResponse(workspaceItem);
      }
      if (url.endsWith("/autonomy/content-work-items") && method === "GET") {
        return jsonResponse([workspaceItem]);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Execution prep post")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "View details for workspace item Execution prep post" }));
    await user.click(await screen.findByRole("button", { name: "View linked draft draft-1" }));
    await user.click(await screen.findByRole("button", { name: "Edit draft draft-1" }));
    await user.click(screen.getByRole("button", { name: "Save draft changes" }));

    await waitFor(() => {
      expect(screen.getByText(/Draft save failed: PATCH \/autonomy\/drafts\/draft-1/)).toBeInTheDocument();
      expect(screen.getByText(/draft update failed/)).toBeInTheDocument();
    });
  });

  it("persists draft status updates through the dedicated draft status route", async () => {
    const workspaceItem: AutonomousContentWorkItem = {
      id: "work-1",
      sourceMatchedOpportunityId: "match-1",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "post",
      title: "Execution prep post",
      summary: "Show where rollout ownership breaks after promotion.",
      rationale: "Strong deterministic match for operator execution friction.",
      recommendedAction: "write_post",
      priorityScore: 91,
      priorityBand: "high",
      reviewState: "saved",
      status: "ready_for_draft",
      draftProgress: {
        hasDraft: true,
        draftId: "draft-1",
        draftStatus: "ready",
        draftUpdatedAt: "2026-03-16T14:10:00.000Z"
      },
      createdAt: "2026-03-16T13:00:00.000Z",
      updatedAt: "2026-03-16T14:15:00.000Z"
    };

    let draft: AutonomousDraftDocument = {
      id: "draft-1",
      sourceContentWorkItemId: "work-1",
      title: "Execution prep draft",
      body: "Start with the rollout handoff problem.\n\nThen show where ownership breaks after the demo.",
      angle: "ownership gap",
      sourceSummary: "Show where rollout ownership breaks after promotion.",
      recommendedAction: "write_post",
      status: "ready",
      createdAt: "2026-03-16T14:00:00.000Z",
      updatedAt: "2026-03-16T14:10:00.000Z"
    };

    let statusPayload: Record<string, unknown> | null = null;
    let contentPatchCalled = false;

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/drafts/draft-1/status") && method === "PATCH") {
        const parsedStatusPayload = JSON.parse(String(init?.body)) as Record<string, unknown>;
        statusPayload = parsedStatusPayload;
        draft = {
          ...draft,
          status: parsedStatusPayload.status as AutonomousDraftDocument["status"],
          updatedAt: "2026-03-16T15:05:00.000Z"
        };
        return jsonResponse(draft);
      }
      if (url.endsWith("/autonomy/drafts/draft-1") && method === "PATCH") {
        contentPatchCalled = true;
        return jsonResponse(draft);
      }
      if (url.endsWith("/autonomy/drafts/draft-1") && method === "GET") {
        return jsonResponse(draft);
      }
      if (url.endsWith("/autonomy/content-work-items/work-1") && method === "GET") {
        return jsonResponse(workspaceItem);
      }
      if (url.endsWith("/autonomy/content-work-items") && method === "GET") {
        return jsonResponse([workspaceItem]);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Execution prep post")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "View details for workspace item Execution prep post" }));
    await user.click(await screen.findByRole("button", { name: "View linked draft draft-1" }));

    await user.selectOptions(screen.getByLabelText("Draft status select"), "blocked");
    await user.click(screen.getByRole("button", { name: "Apply draft status" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Draft status select")).toHaveValue("blocked");
    });

    expect(statusPayload).toEqual({ status: "blocked" });
    expect(contentPatchCalled).toBe(false);
  });

  it("shows an inline error when draft status update fails", async () => {
    const workspaceItem: AutonomousContentWorkItem = {
      id: "work-1",
      sourceMatchedOpportunityId: "match-1",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "post",
      title: "Execution prep post",
      summary: "Show where rollout ownership breaks after promotion.",
      rationale: "Strong deterministic match for operator execution friction.",
      recommendedAction: "write_post",
      priorityScore: 91,
      priorityBand: "high",
      reviewState: "saved",
      status: "ready_for_draft",
      draftProgress: {
        hasDraft: true,
        draftId: "draft-1",
        draftStatus: "ready",
        draftUpdatedAt: "2026-03-16T14:10:00.000Z"
      },
      createdAt: "2026-03-16T13:00:00.000Z",
      updatedAt: "2026-03-16T14:15:00.000Z"
    };

    const draft: AutonomousDraftDocument = {
      id: "draft-1",
      sourceContentWorkItemId: "work-1",
      title: "Execution prep draft",
      body: "Start with the rollout handoff problem.\n\nThen show where ownership breaks after the demo.",
      angle: "ownership gap",
      sourceSummary: "Show where rollout ownership breaks after promotion.",
      recommendedAction: "write_post",
      status: "ready",
      createdAt: "2026-03-16T14:00:00.000Z",
      updatedAt: "2026-03-16T14:10:00.000Z"
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/drafts/draft-1/status") && method === "PATCH") {
        return jsonResponse({ error: "draft status update failed" }, 500);
      }
      if (url.endsWith("/autonomy/drafts/draft-1") && method === "GET") {
        return jsonResponse(draft);
      }
      if (url.endsWith("/autonomy/content-work-items/work-1") && method === "GET") {
        return jsonResponse(workspaceItem);
      }
      if (url.endsWith("/autonomy/content-work-items") && method === "GET") {
        return jsonResponse([workspaceItem]);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Execution prep post")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "View details for workspace item Execution prep post" }));
    await user.click(await screen.findByRole("button", { name: "View linked draft draft-1" }));

    await user.selectOptions(screen.getByLabelText("Draft status select"), "archived");
    await user.click(screen.getByRole("button", { name: "Apply draft status" }));

    await waitFor(() => {
      expect(screen.getByText(/Draft status update failed: PATCH \/autonomy\/drafts\/draft-1\/status/)).toBeInTheDocument();
      expect(screen.getByText(/draft status update failed/)).toBeInTheDocument();
    });
  });

  it("shows no linked draft action when the inspected work item has no server draft", async () => {
    const workspaceItem: AutonomousContentWorkItem = {
      id: "work-1",
      sourceMatchedOpportunityId: "match-1",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "comment",
      title: "Execution prep comment",
      summary: "Comment-first follow-up for rollout accountability thread.",
      rationale: "Deterministic follow-up item for a saved operator thread.",
      recommendedAction: "write_comment",
      priorityScore: 73,
      priorityBand: "medium",
      reviewState: "saved",
      status: "draft",
      draftProgress: { hasDraft: false },
      createdAt: "2026-03-16T13:10:00.000Z",
      updatedAt: "2026-03-16T14:05:00.000Z"
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/content-work-items/work-1") && method === "GET") {
        return jsonResponse(workspaceItem);
      }
      if (url.endsWith("/autonomy/content-work-items") && method === "GET") {
        return jsonResponse([workspaceItem]);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Execution prep comment")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "View details for workspace item Execution prep comment" }));

    await waitFor(() => {
      expect(screen.getByText("No server draft linked yet.")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: /View linked draft/ })).not.toBeInTheDocument();
  });

  it("shows a create draft action only when the inspected work item has no linked draft", async () => {
    const noDraftItem: AutonomousContentWorkItem = {
      id: "work-1",
      sourceMatchedOpportunityId: "match-1",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "comment",
      title: "Execution prep comment",
      summary: "Comment-first follow-up for rollout accountability thread.",
      rationale: "Deterministic follow-up item for a saved operator thread.",
      recommendedAction: "write_comment",
      priorityScore: 73,
      priorityBand: "medium",
      reviewState: "saved",
      status: "draft",
      draftProgress: { hasDraft: false },
      createdAt: "2026-03-16T13:10:00.000Z",
      updatedAt: "2026-03-16T14:05:00.000Z"
    };

    const withDraftItem: AutonomousContentWorkItem = {
      ...noDraftItem,
      id: "work-2",
      title: "Execution prep post",
      workItemKind: "post",
      recommendedAction: "write_post",
      draftProgress: {
        hasDraft: true,
        draftId: "draft-2",
        draftStatus: "ready",
        draftUpdatedAt: "2026-03-16T14:10:00.000Z"
      }
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/content-work-items/work-1") && method === "GET") {
        return jsonResponse(noDraftItem);
      }
      if (url.endsWith("/autonomy/content-work-items/work-2") && method === "GET") {
        return jsonResponse(withDraftItem);
      }
      if (url.endsWith("/autonomy/content-work-items") && method === "GET") {
        return jsonResponse([noDraftItem, withDraftItem]);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Execution prep comment")).toBeInTheDocument();
      expect(screen.getByText("Execution prep post")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "View details for workspace item Execution prep comment" }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Create draft for workspace item Execution prep comment" })
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /View linked draft/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "View details for workspace item Execution prep post" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View linked draft draft-2" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Create draft for workspace item/ })).not.toBeInTheDocument();
  });

  it("creates a linked server draft from a workspace item and makes draft inspection available immediately", async () => {
    let workspaceItem: AutonomousContentWorkItem = {
      id: "work-1",
      sourceMatchedOpportunityId: "match-1",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "comment",
      title: "Execution prep comment",
      summary: "Comment-first follow-up for rollout accountability thread.",
      rationale: "Deterministic follow-up item for a saved operator thread.",
      recommendedAction: "write_comment",
      priorityScore: 73,
      priorityBand: "medium",
      reviewState: "saved",
      status: "draft",
      draftProgress: { hasDraft: false },
      createdAt: "2026-03-16T13:10:00.000Z",
      updatedAt: "2026-03-16T14:05:00.000Z"
    };

    const createdDraft: AutonomousDraftDocument = {
      id: "draft-new",
      sourceContentWorkItemId: "work-1",
      title: "Execution prep draft",
      body: "Start with the accountability gap.\n\nThen show the follow-up seam.",
      angle: "accountability follow-up",
      sourceSummary: "Comment-first follow-up for rollout accountability thread.",
      recommendedAction: "write_comment",
      status: "draft",
      createdAt: "2026-03-16T15:00:00.000Z",
      updatedAt: "2026-03-16T15:00:00.000Z"
    };

    let createCalled = false;

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/content-work-items/work-1/draft") && method === "POST") {
        createCalled = true;
        workspaceItem = {
          ...workspaceItem,
          draftProgress: {
            hasDraft: true,
            draftId: createdDraft.id,
            draftStatus: createdDraft.status,
            draftUpdatedAt: createdDraft.updatedAt
          }
        };
        return jsonResponse(createdDraft);
      }
      if (url.endsWith("/autonomy/drafts/draft-new") && method === "GET") {
        return jsonResponse(createdDraft);
      }
      if (url.endsWith("/autonomy/content-work-items/work-1") && method === "GET") {
        return jsonResponse(workspaceItem);
      }
      if (url.endsWith("/autonomy/content-work-items") && method === "GET") {
        return jsonResponse([workspaceItem]);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Execution prep comment")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "View details for workspace item Execution prep comment" }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Create draft for workspace item Execution prep comment" })
      ).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", { name: "Create draft for workspace item Execution prep comment" })
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View linked draft draft-new" })).toBeInTheDocument();
      expect(screen.getAllByText("draft in progress").length).toBeGreaterThan(0);
    });

    expect(createCalled).toBe(true);

    await user.click(screen.getByRole("button", { name: "View linked draft draft-new" }));
    await waitFor(() => {
      expect(screen.getByText("Execution prep draft")).toBeInTheDocument();
      expect(screen.getByLabelText("Draft status select")).toHaveValue("draft");
    });
  });

  it("shows an inline error when draft creation from a workspace item fails", async () => {
    const workspaceItem: AutonomousContentWorkItem = {
      id: "work-1",
      sourceMatchedOpportunityId: "match-1",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "comment",
      title: "Execution prep comment",
      summary: "Comment-first follow-up for rollout accountability thread.",
      rationale: "Deterministic follow-up item for a saved operator thread.",
      recommendedAction: "write_comment",
      priorityScore: 73,
      priorityBand: "medium",
      reviewState: "saved",
      status: "draft",
      draftProgress: { hasDraft: false },
      createdAt: "2026-03-16T13:10:00.000Z",
      updatedAt: "2026-03-16T14:05:00.000Z"
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/content-work-items/work-1/draft") && method === "POST") {
        return jsonResponse({ error: "draft creation failed" }, 500);
      }
      if (url.endsWith("/autonomy/content-work-items/work-1") && method === "GET") {
        return jsonResponse(workspaceItem);
      }
      if (url.endsWith("/autonomy/content-work-items") && method === "GET") {
        return jsonResponse([workspaceItem]);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Execution prep comment")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "View details for workspace item Execution prep comment" }));
    await user.click(
      await screen.findByRole("button", { name: "Create draft for workspace item Execution prep comment" })
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Draft creation failed: POST \/autonomy\/content-work-items\/work-1\/draft/)
      ).toBeInTheDocument();
      expect(screen.getByText(/draft creation failed/)).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: /View linked draft/ })).not.toBeInTheDocument();
  });

  it("shows linked draft loading and error states safely", async () => {
    const workspaceItem: AutonomousContentWorkItem = {
      id: "work-1",
      sourceMatchedOpportunityId: "match-1",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "post",
      title: "Execution prep post",
      summary: "Show where rollout ownership breaks after promotion.",
      rationale: "Strong deterministic match for operator execution friction.",
      recommendedAction: "write_post",
      priorityScore: 91,
      priorityBand: "high",
      reviewState: "saved",
      status: "ready_for_draft",
      draftProgress: {
        hasDraft: true,
        draftId: "draft-1",
        draftStatus: "ready",
        draftUpdatedAt: "2026-03-16T14:10:00.000Z"
      },
      createdAt: "2026-03-16T13:00:00.000Z",
      updatedAt: "2026-03-16T14:15:00.000Z"
    };

    let resolveDraftRequest!: (response: Response) => void;
    const draftRequest = new Promise<Response>((resolve) => {
      resolveDraftRequest = resolve;
    });

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/drafts/draft-1") && method === "GET") {
        return draftRequest;
      }
      if (url.endsWith("/autonomy/content-work-items/work-1") && method === "GET") {
        return jsonResponse(workspaceItem);
      }
      if (url.endsWith("/autonomy/content-work-items") && method === "GET") {
        return jsonResponse([workspaceItem]);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Execution prep post")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "View details for workspace item Execution prep post" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View linked draft draft-1" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "View linked draft draft-1" }));
    expect(screen.getByText("Loading linked draft...")).toBeInTheDocument();

    resolveDraftRequest(jsonResponse({ error: "draft unavailable" }, 500));

    await waitFor(() => {
      expect(screen.getByText(/Draft inspection failed: GET \/autonomy\/drafts\/draft-1/)).toBeInTheDocument();
      expect(screen.getByText(/draft unavailable/)).toBeInTheDocument();
    });
  });

  it("renders a server-side draft queue with draft title, status, angle, and updated time", async () => {
    const drafts: AutonomousDraftDocument[] = [
      {
        id: "draft-1",
        sourceContentWorkItemId: "work-1",
        sourceWorkItemTitle: "Execution prep post",
        sourceWorkItemStatus: "ready_for_draft",
        sourceWorkItemRecommendedAction: "write_post",
        sourceWorkItemSummary: "Show where rollout ownership breaks after promotion.",
        title: "Execution prep draft",
        body: "Start with the rollout handoff problem.",
        angle: "ownership gap",
        sourceSummary: "Show where rollout ownership breaks after promotion.",
        recommendedAction: "write_post",
        status: "ready",
        createdAt: "2026-03-16T14:00:00.000Z",
        updatedAt: "2026-03-16T14:10:00.000Z"
      },
      {
        id: "draft-2",
        sourceContentWorkItemId: "work-2",
        sourceWorkItemTitle: "Comment follow-up item",
        sourceWorkItemStatus: "draft",
        sourceWorkItemRecommendedAction: "write_comment",
        sourceWorkItemSummary: "Comment-first follow-up for rollout accountability thread.",
        title: "Comment follow-up draft",
        body: "Lead with the accountability seam.",
        sourceSummary: "Comment-first follow-up for rollout accountability thread.",
        recommendedAction: "write_comment",
        status: "draft",
        createdAt: "2026-03-16T14:20:00.000Z",
        updatedAt: "2026-03-16T14:30:00.000Z"
      }
    ];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.includes("/autonomy/drafts?status=blocked") && method === "GET") {
        return jsonResponse([
          {
            id: "draft-2",
            sourceContentWorkItemId: "work-2",
            title: "Blocked review draft",
            body: "Hold for reviewer input.",
            sourceSummary: "Blocked follow-up draft.",
            recommendedAction: "write_post",
            status: "blocked",
            createdAt: "2026-03-16T14:20:00.000Z",
            updatedAt: "2026-03-16T14:30:00.000Z"
          }
        ]);
      }
      if (url.endsWith("/autonomy/drafts") && method === "GET") {
        return jsonResponse(drafts);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    const draftQueue = await screen.findByRole("region", { name: "Server draft queue" });
    expect(within(draftQueue).getByText("2 drafts")).toBeInTheDocument();
    expect(within(draftQueue).getByText("Execution prep draft")).toBeInTheDocument();
    expect(within(draftQueue).getByText("Comment follow-up draft")).toBeInTheDocument();
    expect(within(draftQueue).getByText("Source work item: work-1")).toBeInTheDocument();
    expect(within(draftQueue).getByText("Source work item: work-2")).toBeInTheDocument();
    expect(within(draftQueue).getByText("Source title: Execution prep post")).toBeInTheDocument();
    expect(within(draftQueue).getByText("Source status: ready for draft")).toBeInTheDocument();
    expect(within(draftQueue).getByText("Source action: write_post")).toBeInTheDocument();
    expect(
      within(draftQueue).getByText("Source summary: Show where rollout ownership breaks after promotion.")
    ).toBeInTheDocument();
    expect(within(draftQueue).getByText("Source title: Comment follow-up item")).toBeInTheDocument();
    expect(within(draftQueue).getByText("Source status: draft")).toBeInTheDocument();
    expect(within(draftQueue).getByText("Source action: write_comment")).toBeInTheDocument();
    expect(
      within(draftQueue).getByText("Source summary: Comment-first follow-up for rollout accountability thread.")
    ).toBeInTheDocument();
    expect(within(draftQueue).getAllByText("ready").length).toBeGreaterThan(0);
    expect(within(draftQueue).getAllByText("draft").length).toBeGreaterThan(0);
    expect(within(draftQueue).getByText("Angle: ownership gap")).toBeInTheDocument();
    expect(within(draftQueue).getByLabelText("Draft queue status filter")).toHaveValue("all");
    expect(within(draftQueue).getByLabelText("Draft queue sort")).toHaveValue("updated_desc");
  });

  it("uses server-side sorting for the draft queue", async () => {
    const newestDraft: AutonomousDraftDocument = {
      id: "draft-new",
      sourceContentWorkItemId: "work-new",
      title: "Newest draft",
      body: "Newest body",
      sourceSummary: "Newest source summary",
      recommendedAction: "write_post",
      status: "draft",
      createdAt: "2026-03-16T14:20:00.000Z",
      updatedAt: "2026-03-16T14:30:00.000Z"
    };
    const oldestDraft: AutonomousDraftDocument = {
      id: "draft-old",
      sourceContentWorkItemId: "work-old",
      title: "Oldest draft",
      body: "Oldest body",
      sourceSummary: "Oldest source summary",
      recommendedAction: "write_post",
      status: "ready",
      createdAt: "2026-03-16T14:00:00.000Z",
      updatedAt: "2026-03-16T14:10:00.000Z"
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.includes("/autonomy/drafts?sort=updated_asc") && method === "GET") {
        return jsonResponse([oldestDraft, newestDraft]);
      }
      if (url.endsWith("/autonomy/drafts") && method === "GET") {
        return jsonResponse([newestDraft, oldestDraft]);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    const draftQueue = await screen.findByRole("region", { name: "Server draft queue" });
    expect(
      within(draftQueue).getAllByRole("heading", { level: 4 }).map((element) => element.textContent)
    ).toEqual(["Newest draft", "Oldest draft"]);

    await user.selectOptions(within(draftQueue).getByLabelText("Draft queue sort"), "updated_asc");

    await waitFor(() => {
      expect(
        within(draftQueue).getAllByRole("heading", { level: 4 }).map((element) => element.textContent)
      ).toEqual(["Oldest draft", "Newest draft"]);
    });
  });

  it("uses server-side filtering and sorting together in the draft queue", async () => {
    const olderReadyDraft: AutonomousDraftDocument = {
      id: "draft-ready-old",
      sourceContentWorkItemId: "work-ready-old",
      title: "Older ready draft",
      body: "Older ready body",
      sourceSummary: "Older ready source summary",
      recommendedAction: "write_post",
      status: "ready",
      createdAt: "2026-03-16T14:00:00.000Z",
      updatedAt: "2026-03-16T14:10:00.000Z"
    };
    const newerReadyDraft: AutonomousDraftDocument = {
      id: "draft-ready-new",
      sourceContentWorkItemId: "work-ready-new",
      title: "Newer ready draft",
      body: "Newer ready body",
      sourceSummary: "Newer ready source summary",
      recommendedAction: "write_post",
      status: "ready",
      createdAt: "2026-03-16T14:20:00.000Z",
      updatedAt: "2026-03-16T14:30:00.000Z"
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.includes("/autonomy/drafts?status=ready&sort=updated_asc") && method === "GET") {
        return jsonResponse([olderReadyDraft, newerReadyDraft]);
      }
      if (url.includes("/autonomy/drafts?status=ready") && method === "GET") {
        return jsonResponse([newerReadyDraft, olderReadyDraft]);
      }
      if (url.endsWith("/autonomy/drafts") && method === "GET") {
        return jsonResponse([newerReadyDraft]);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    const draftQueue = await screen.findByRole("region", { name: "Server draft queue" });
    await user.selectOptions(within(draftQueue).getByLabelText("Draft queue status filter"), "ready");
    await user.selectOptions(within(draftQueue).getByLabelText("Draft queue sort"), "updated_asc");

    await waitFor(() => {
      expect(
        within(draftQueue).getAllByRole("heading", { level: 4 }).map((element) => element.textContent)
      ).toEqual(["Older ready draft", "Newer ready draft"]);
    });
  });

  it("filters the server-side draft queue by draft status", async () => {
    const drafts: AutonomousDraftDocument[] = [
      {
        id: "draft-1",
        sourceContentWorkItemId: "work-1",
        title: "Execution prep draft",
        body: "Start with the rollout handoff problem.",
        angle: "ownership gap",
        sourceSummary: "Show where rollout ownership breaks after promotion.",
        recommendedAction: "write_post",
        status: "ready",
        createdAt: "2026-03-16T14:00:00.000Z",
        updatedAt: "2026-03-16T14:10:00.000Z"
      },
      {
        id: "draft-2",
        sourceContentWorkItemId: "work-2",
        title: "Blocked review draft",
        body: "Hold for reviewer input.",
        sourceSummary: "Blocked follow-up draft.",
        recommendedAction: "write_post",
        status: "blocked",
        createdAt: "2026-03-16T14:20:00.000Z",
        updatedAt: "2026-03-16T14:30:00.000Z"
      }
    ];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.includes("/autonomy/drafts?status=blocked") && method === "GET") {
        return jsonResponse([
          {
            id: "draft-2",
            sourceContentWorkItemId: "work-2",
            title: "Blocked review draft",
            body: "Hold for reviewer input.",
            sourceSummary: "Blocked follow-up draft.",
            recommendedAction: "write_post",
            status: "blocked",
            createdAt: "2026-03-16T14:20:00.000Z",
            updatedAt: "2026-03-16T14:30:00.000Z"
          }
        ]);
      }
      if (url.endsWith("/autonomy/drafts") && method === "GET") {
        return jsonResponse(drafts);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    const draftQueue = await screen.findByRole("region", { name: "Server draft queue" });
    await user.selectOptions(within(draftQueue).getByLabelText("Draft queue status filter"), "blocked");

    await waitFor(() => {
      expect(within(draftQueue).getByText("Blocked review draft")).toBeInTheDocument();
      expect(within(draftQueue).queryByText("Execution prep draft")).not.toBeInTheDocument();
    });
  });

  it("shows a safe filtered empty state in the server-side draft queue", async () => {
    const drafts: AutonomousDraftDocument[] = [
      {
        id: "draft-1",
        sourceContentWorkItemId: "work-1",
        title: "Execution prep draft",
        body: "Start with the rollout handoff problem.",
        angle: "ownership gap",
        sourceSummary: "Show where rollout ownership breaks after promotion.",
        recommendedAction: "write_post",
        status: "ready",
        createdAt: "2026-03-16T14:00:00.000Z",
        updatedAt: "2026-03-16T14:10:00.000Z"
      }
    ];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.includes("/autonomy/drafts?status=archived") && method === "GET") {
        return jsonResponse([]);
      }
      if (url.endsWith("/autonomy/drafts") && method === "GET") {
        return jsonResponse(drafts);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    const draftQueue = await screen.findByRole("region", { name: "Server draft queue" });
    await user.selectOptions(within(draftQueue).getByLabelText("Draft queue status filter"), "archived");

    await waitFor(() => {
      expect(
        within(draftQueue).getByText("No server-side drafts match the current filter.")
      ).toBeInTheDocument();
    });
  });

  it("opens an existing draft from the server-side draft queue", async () => {
    const draft: AutonomousDraftDocument = {
      id: "draft-1",
      sourceContentWorkItemId: "work-1",
      sourceWorkItemTitle: "Execution prep post",
      sourceWorkItemStatus: "ready_for_draft",
      sourceWorkItemRecommendedAction: "write_post",
      sourceWorkItemSummary: "Show where rollout ownership breaks after promotion.",
      title: "Execution prep draft",
      body: "Start with the rollout handoff problem.\n\nThen show where ownership breaks after the demo.",
      angle: "ownership gap",
      sourceSummary: "Show where rollout ownership breaks after promotion.",
      recommendedAction: "write_post",
      status: "ready",
      createdAt: "2026-03-16T14:00:00.000Z",
      updatedAt: "2026-03-16T14:10:00.000Z"
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/drafts/draft-1") && method === "GET") {
        return jsonResponse(draft);
      }
      if (url.includes("/autonomy/drafts?status=ready") && method === "GET") {
        return jsonResponse([draft]);
      }
      if (url.endsWith("/autonomy/drafts") && method === "GET") {
        return jsonResponse([draft]);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    const draftQueue = await screen.findByRole("region", { name: "Server draft queue" });
    await user.selectOptions(within(draftQueue).getByLabelText("Draft queue status filter"), "ready");
    await user.click(within(draftQueue).getByRole("button", { name: "View draft queue item draft-1" }));

    await waitFor(() => {
      expect(within(draftQueue).getByText("Draft title")).toBeInTheDocument();
      expect(within(draftQueue).getAllByText("Execution prep draft").length).toBeGreaterThan(1);
      expect(within(draftQueue).getByLabelText("Draft status select")).toHaveValue("ready");
    });
  });

  it("opens the linked source work item from the server-side draft queue", async () => {
    const draft: AutonomousDraftDocument = {
      id: "draft-1",
      sourceContentWorkItemId: "work-1",
      sourceWorkItemTitle: "Execution prep post",
      sourceWorkItemStatus: "ready_for_draft",
      sourceWorkItemRecommendedAction: "write_post",
      sourceWorkItemSummary: "Show where rollout ownership breaks after promotion.",
      title: "Execution prep draft",
      body: "Start with the rollout handoff problem.",
      angle: "ownership gap",
      sourceSummary: "Show where rollout ownership breaks after promotion.",
      recommendedAction: "write_post",
      status: "ready",
      createdAt: "2026-03-16T14:00:00.000Z",
      updatedAt: "2026-03-16T14:10:00.000Z"
    };
    const sourceWorkItem: AutonomousContentWorkItem = {
      id: "work-1",
      sourceMatchedOpportunityId: "match-1",
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      workItemKind: "post",
      title: "Execution prep post",
      summary: "A server-side work item summary for the draft source.",
      rationale: "This is the source work item rationale.",
      recommendedAction: "write_post",
      status: "ready_for_draft",
      priorityScore: 91,
      priorityBand: "high",
      reviewState: "saved",
      draftSeed: {
        title: "Execution prep post",
        angle: "ownership gap",
        seedText: "Draft seed text",
        sourceSummary: "A server-side work item summary for the draft source.",
        rationale: "This is the source work item rationale.",
        recommendedAction: "write_post",
        priorityBand: "high"
      },
      createdAt: "2026-03-16T13:00:00.000Z",
      updatedAt: "2026-03-16T14:05:00.000Z",
      draftProgress: {
        hasDraft: true,
        draftId: "draft-1",
        draftStatus: "ready",
        draftUpdatedAt: "2026-03-16T14:10:00.000Z"
      }
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/content-work-items/work-1") && method === "GET") {
        return jsonResponse(sourceWorkItem);
      }
      if (url.endsWith("/autonomy/drafts") && method === "GET") {
        return jsonResponse([draft]);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    const draftQueue = await screen.findByRole("region", { name: "Server draft queue" });
    await user.click(
      within(draftQueue).getByRole("button", {
        name: "View source work item work-1 from draft draft-1"
      })
    );

    await waitFor(() => {
      expect(within(draftQueue).getByText("Source title: Execution prep post")).toBeInTheDocument();
      expect(within(draftQueue).getByText("Source status: ready for draft")).toBeInTheDocument();
      expect(within(draftQueue).getByText("Source action: write_post")).toBeInTheDocument();
      expect(
        within(draftQueue).getByText("Source summary: Show where rollout ownership breaks after promotion.")
      ).toBeInTheDocument();
      expect(within(draftQueue).getByText("Source work item title")).toBeInTheDocument();
      expect(within(draftQueue).getByText("Execution prep post")).toBeInTheDocument();
      expect(within(draftQueue).getByText("Source work item status")).toBeInTheDocument();
      expect(within(draftQueue).getByText("ready_for_draft")).toBeInTheDocument();
      expect(within(draftQueue).getByText("Source recommended action")).toBeInTheDocument();
      expect(within(draftQueue).getByText("write_post")).toBeInTheDocument();
    });
  });

  it("shows a safe source work-item error in the server-side draft queue when the linked source is unavailable", async () => {
    const draft: AutonomousDraftDocument = {
      id: "draft-1",
      sourceContentWorkItemId: "work-missing",
      title: "Execution prep draft",
      body: "Start with the rollout handoff problem.",
      angle: "ownership gap",
      sourceSummary: "Show where rollout ownership breaks after promotion.",
      recommendedAction: "write_post",
      status: "ready",
      createdAt: "2026-03-16T14:00:00.000Z",
      updatedAt: "2026-03-16T14:10:00.000Z"
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/content-work-items/work-missing") && method === "GET") {
        return new Response("missing work item", { status: 404 });
      }
      if (url.endsWith("/autonomy/drafts") && method === "GET") {
        return jsonResponse([draft]);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    const draftQueue = await screen.findByRole("region", { name: "Server draft queue" });
    expect(within(draftQueue).queryByText(/Source title:/)).not.toBeInTheDocument();
    expect(within(draftQueue).queryByText(/Source status:/)).not.toBeInTheDocument();
    expect(within(draftQueue).queryByText(/Source action:/)).not.toBeInTheDocument();
    expect(within(draftQueue).queryByText(/Source summary:/)).not.toBeInTheDocument();
    await user.click(
      within(draftQueue).getByRole("button", {
        name: "View source work item work-missing from draft draft-1"
      })
    );

    await waitFor(() => {
      expect(
        within(draftQueue).getByText(/Source work item inspection failed: GET \/autonomy\/content-work-items\/work-missing/)
      ).toBeInTheDocument();
      expect(within(draftQueue).getByText(/missing work item/)).toBeInTheDocument();
    });
  });

  it("shows a safe empty state when no server-side drafts exist", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/drafts") && method === "GET") {
        return jsonResponse([]);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    const draftQueue = await screen.findByRole("region", { name: "Server draft queue" });
    expect(within(draftQueue).getByText("No server-side drafts yet.")).toBeInTheDocument();
  });

  it("shows draft queue endpoint diagnostics safely", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/drafts") && method === "GET") {
        return jsonResponse({ error: "draft queue unavailable" }, 500);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Some sections failed to load.")).toBeInTheDocument();
    });

    expect(
      screen.getAllByText(/Server draft queue failed: GET \/autonomy\/drafts/).length
    ).toBeGreaterThan(0);
  });

  it("shows an empty state when no server-side content work items exist", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
    expect(screen.getByRole("region", { name: "Server content workspace" })).toBeInTheDocument();
  });

  it("renders a launch console with runtime health and launch preflight status", async () => {
    const runtimeHealth: AIRuntimeHealthSummary = {
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
      }
    };
    const launchPreflight: LaunchPreflightResult = {
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
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/system/ai-runtime-health") && method === "GET") {
        return jsonResponse(runtimeHealth);
      }
      if (url.endsWith("/system/launch-preflight") && method === "GET") {
        return jsonResponse(launchPreflight);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    const launchConsole = await screen.findByRole("region", { name: "Launch console" });
    expect(within(launchConsole).getByText("Launch Console")).toBeInTheDocument();
    expect(within(launchConsole).getByText("Provider mode")).toBeInTheDocument();
    expect(within(launchConsole).getByText("mock")).toBeInTheDocument();
    expect(within(launchConsole).getByText("AI active")).toBeInTheDocument();
    expect(within(launchConsole).getByText("yes")).toBeInTheDocument();
    expect(within(launchConsole).getByText("Fallback active")).toBeInTheDocument();
    expect(within(launchConsole).getByText("no")).toBeInTheDocument();
    expect(within(launchConsole).getByText("Launch status")).toBeInTheDocument();
    expect(within(launchConsole).getByText("ai ready")).toBeInTheDocument();
    expect(within(launchConsole).getByText("Config status")).toBeInTheDocument();
    expect(within(launchConsole).getAllByText("ai active").length).toBeGreaterThan(0);
    expect(within(launchConsole).getByText("Scheduler runtime")).toBeInTheDocument();
    expect(within(launchConsole).getAllByText("enabled").length).toBeGreaterThan(0);
    expect(within(launchConsole).getByText("Operator auth config")).toBeInTheDocument();
    expect(within(launchConsole).getByText("present")).toBeInTheDocument();
    expect(
      within(launchConsole).getByRole("button", { name: "Run provider probe" })
    ).toBeInTheDocument();
    expect(
      within(launchConsole).getByRole("button", { name: "Run launch smoke run" })
    ).toBeInTheDocument();
  });

  it("renders a supervised MVP go-live checklist with required, recommended, and fallback-safe guidance", async () => {
    render(<App apiBaseUrl="http://localhost:4000" />);

    const launchPackage = await screen.findByRole("region", {
      name: "Supervised MVP launch package"
    });

    expect(within(launchPackage).getByText("Supervised MVP Launch Package")).toBeInTheDocument();
    expect(within(launchPackage).getByText("Go-live verdict")).toBeInTheDocument();
    expect(within(launchPackage).getByText("Fallback-ready")).toBeInTheDocument();
    expect(
      within(launchPackage).getByText(
        "Core supervised MVP surfaces are available and safe to operate in fallback mode."
      )
    ).toBeInTheDocument();
    expect(within(launchPackage).getByText("Required before first real use")).toBeInTheDocument();
    expect(
      within(launchPackage).getByText("Operator auth secrets configured")
    ).toBeInTheDocument();
    expect(within(launchPackage).getByText("Launch diagnostics visible")).toBeInTheDocument();
    expect(within(launchPackage).getByText("Review & triage console available")).toBeInTheDocument();
    expect(within(launchPackage).getByText("Content workspace available")).toBeInTheDocument();
    expect(
      within(launchPackage).getByText("Draft queue and draft flows available")
    ).toBeInTheDocument();
    expect(within(launchPackage).getByText("Recommended before launch")).toBeInTheDocument();
    expect(
      within(launchPackage).getByText("Run one launch smoke run before first real use")
    ).toBeInTheDocument();
    expect(within(launchPackage).getByText("Fallback-safe operation")).toBeInTheDocument();
    expect(
      within(launchPackage).getByText(
        "Fallback-ready is acceptable for the supervised MVP if operator auth is configured, launch preflight is not blocked, and all review, workspace, and draft actions remain operator-driven."
      )
    ).toBeInTheDocument();
    expect(
      within(launchPackage).getByText("No publish or schedule UI in this launch package.")
    ).toBeInTheDocument();
    expect(
      within(launchPackage).getByText("No unattended promotion, posting, or external execution.")
    ).toBeInTheDocument();
    expect(within(launchPackage).getByText("OPERATOR_USERNAME")).toBeInTheDocument();
    expect(within(launchPackage).getByText("OPERATOR_PASSWORD")).toBeInTheDocument();
  });

  it("shows blocked go-live status and launch blockers honestly in the supervised MVP launch package", async () => {
    const runtimeHealth: AIRuntimeHealthSummary = {
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
      operatorAuthConfig: {
        configured: false,
        missingConfigKeys: ["OPERATOR_USERNAME", "OPERATOR_PASSWORD"]
      }
    };
    const launchPreflight: LaunchPreflightResult = {
      launchStatus: "fallback_ready",
      aiReady: false,
      fallbackReady: true,
      providerMode: "deterministic",
      textProvider: null,
      schedulerRuntimeEnabled: false,
      configStatus: "fallback_active",
      issues: [],
      operatorAuthConfig: {
        configured: false,
        missingConfigKeys: ["OPERATOR_USERNAME", "OPERATOR_PASSWORD"]
      }
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/system/ai-runtime-health") && method === "GET") {
        return jsonResponse(runtimeHealth);
      }
      if (url.endsWith("/system/launch-preflight") && method === "GET") {
        return jsonResponse(launchPreflight);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    const launchPackage = await screen.findByRole("region", {
      name: "Supervised MVP launch package"
    });

    expect(within(launchPackage).getByText("Blocked")).toBeInTheDocument();
    expect(within(launchPackage).getByText("Launch blockers")).toBeInTheDocument();
    expect(
      within(launchPackage).getByText(
        "Do not start real supervised use until the launch blockers are cleared."
      )
    ).toBeInTheDocument();
    expect(within(launchPackage).getByText("Operator auth config is missing.")).toBeInTheDocument();
    expect(
      within(launchPackage).getByText(
        "AI is optional here; supervised fallback mode is acceptable for MVP go-live."
      )
    ).toBeInTheDocument();
    expect(
      within(launchPackage).getByText(
        "Scheduler runtime is disabled, so continuous autonomous intake is not active."
      )
    ).toBeInTheDocument();
    expect(
      within(launchPackage).getByText(
        "Missing auth config: OPERATOR_USERNAME, OPERATOR_PASSWORD"
      )
    ).toBeInTheDocument();
  });

  it("shows launch-ready status when auth is configured and preflight is ai-ready", async () => {
    const runtimeHealth: AIRuntimeHealthSummary = {
      providerMode: "external",
      textProvider: "openai",
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
      }
    };
    const launchPreflight: LaunchPreflightResult = {
      launchStatus: "ai_ready",
      aiReady: true,
      fallbackReady: true,
      providerMode: "external",
      textProvider: "openai",
      schedulerRuntimeEnabled: true,
      configStatus: "ai_active",
      issues: [],
      operatorAuthConfig: {
        configured: true,
        missingConfigKeys: []
      }
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/system/ai-runtime-health") && method === "GET") {
        return jsonResponse(runtimeHealth);
      }
      if (url.endsWith("/system/launch-preflight") && method === "GET") {
        return jsonResponse(launchPreflight);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    const launchPackage = await screen.findByRole("region", {
      name: "Supervised MVP launch package"
    });

    expect(within(launchPackage).getByText("Launch-ready")).toBeInTheDocument();
    expect(
      within(launchPackage).getByText(
        "Core supervised MVP surfaces are available with AI-backed launch readiness."
      )
    ).toBeInTheDocument();
  });

  it("runs the explicit provider probe from the launch console and renders the result", async () => {
    const probeResult: AIProviderProbeResult = {
      providerMode: "mock",
      textProvider: "mock-text",
      aiActive: true,
      fallbackActive: false,
      probeStatus: "success",
      probeMessage: "Mock provider responded."
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/system/ai-probe") && method === "POST") {
        return jsonResponse(probeResult);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    const launchConsole = await screen.findByRole("region", { name: "Launch console" });
    await user.click(within(launchConsole).getByRole("button", { name: "Run provider probe" }));

    await waitFor(() => {
      expect(within(launchConsole).getByText("Probe status")).toBeInTheDocument();
      expect(within(launchConsole).getByText("success")).toBeInTheDocument();
      expect(within(launchConsole).getByText("Mock provider responded.")).toBeInTheDocument();
    });
  });

  it("runs the explicit launch smoke run from the launch console and renders the result", async () => {
    const smokeResult: LaunchSmokeRunResult = {
      launchStatus: "fallback_ready",
      runnable: true,
      smokeTag: "launch-smoke:test-run",
      providerMode: "deterministic",
      textProvider: null,
      schedulerRuntimeEnabled: true,
      configStatus: "fallback_active",
      issues: [],
      artifactCounts: {
        ingestionArtifacts: 2,
        reviewQueueItems: 1,
        matchedOpportunities: 1,
        prioritizedOpportunities: 1,
        contentWorkItems: 1,
        draftDocuments: 1
      }
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/system/launch-smoke-run") && method === "POST") {
        return jsonResponse(smokeResult);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    const launchConsole = await screen.findByRole("region", { name: "Launch console" });
    await user.click(within(launchConsole).getByRole("button", { name: "Run launch smoke run" }));

    await waitFor(() => {
      expect(within(launchConsole).getByText("Smoke run verdict")).toBeInTheDocument();
      expect(within(launchConsole).getByText("fallback ready")).toBeInTheDocument();
      expect(within(launchConsole).getByText("Runnable: yes")).toBeInTheDocument();
      expect(
        within(launchConsole).getByText(
          "Artifacts: 2 ingestion, 1 review, 1 matched, 1 prioritized, 1 work items, 1 drafts"
        )
      ).toBeInTheDocument();
    });
  });

  it("renders missing operator auth config in the launch console without exposing secret values", async () => {
    const runtimeHealth: AIRuntimeHealthSummary = {
      providerMode: "deterministic",
      textProvider: null,
      visualProvider: null,
      aiActive: false,
      fallbackActive: true,
      runtimeEnabled: true,
      schedulerRuntimeEnabled: true,
      fallbackEnabled: true,
      configStatus: "fallback_active",
      issues: [],
      operatorAuthConfig: {
        configured: false,
        missingConfigKeys: ["OPERATOR_USERNAME", "OPERATOR_PASSWORD"]
      }
    };
    const launchPreflight: LaunchPreflightResult = {
      launchStatus: "fallback_ready",
      aiReady: false,
      fallbackReady: true,
      providerMode: "deterministic",
      textProvider: null,
      schedulerRuntimeEnabled: true,
      configStatus: "fallback_active",
      issues: [],
      operatorAuthConfig: {
        configured: false,
        missingConfigKeys: ["OPERATOR_USERNAME", "OPERATOR_PASSWORD"]
      }
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/system/ai-runtime-health") && method === "GET") {
        return jsonResponse(runtimeHealth);
      }
      if (url.endsWith("/system/launch-preflight") && method === "GET") {
        return jsonResponse(launchPreflight);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    const launchConsole = await screen.findByRole("region", { name: "Launch console" });
    expect(within(launchConsole).getByText("Operator auth config")).toBeInTheDocument();
    expect(within(launchConsole).getByText("missing")).toBeInTheDocument();
    expect(within(launchConsole).getByText("Missing auth config: OPERATOR_USERNAME, OPERATOR_PASSWORD")).toBeInTheDocument();
    expect(launchConsole.textContent).not.toContain("operator-pass");
  });

  it("shows launch console endpoint diagnostics safely while keeping workspace surfaces available", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/system/ai-runtime-health") && method === "GET") {
        return jsonResponse({ error: "runtime unavailable" }, 500);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(
        screen.getAllByText(/Launch console failed: GET \/system\/ai-runtime-health/).length
      ).toBeGreaterThan(0);
    });

    expect(screen.getByRole("region", { name: "Server draft queue" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Server content workspace" })).toBeInTheDocument();
  });

  it("renders a focused Day-1 Mode with launch, triage, workspace, and drafts prioritized", async () => {
    render(<App apiBaseUrl="http://localhost:4000" />);

    const dayOneMode = await screen.findByRole("region", { name: "Operator Day-1 mode" });
    expect(within(dayOneMode).getByText("Operator Day-1 Mode")).toBeInTheDocument();
    expect(within(dayOneMode).getByText("Launch")).toBeInTheDocument();
    expect(within(dayOneMode).getByText("Triage")).toBeInTheDocument();
    expect(within(dayOneMode).getByText("Workspace")).toBeInTheDocument();
    expect(within(dayOneMode).getByText("Drafts")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Day-1 Mode" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Full dashboard" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );

    expect(screen.getByRole("region", { name: "Launch console" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Review and triage console" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Server content workspace" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Server draft queue" })).toBeInTheDocument();

    expect(
      within(screen.getByRole("region", { name: "Review and triage console" })).getByText(
        "No server-side review backlog or matched opportunities yet."
      )
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Server content workspace" })).getByText(
        "No server-side content work items yet."
      )
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Server draft queue" })).getByText(
        "No server-side drafts yet."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Active item focus" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Active item focus" })).getByText(
        "No active operator chain yet. Open a matched opportunity, promote a work item, or open a draft to keep the current supervised path anchored here."
      )
    ).toBeInTheDocument();

    expect(screen.queryByLabelText("Signal title")).not.toBeInTheDocument();
    expect(screen.queryByText("Comment Writer")).not.toBeInTheDocument();
  });

  it("renders the factory command center from canonical factory outputs", async () => {
    const signals: Signal[] = [
      {
        id: "sig-factory-1",
        title: "Workflow accountability repo",
        sourceType: "github_repo",
        rawText: "Queue ownership and retry recovery matter.",
        status: "new",
        createdAt: "2026-03-19T08:00:00.000Z"
      },
      {
        id: "sig-factory-2",
        title: "Solution follow-up signal",
        sourceType: "article",
        rawText: "Implementation reuse path is strong.",
        status: "new",
        createdAt: "2026-03-19T08:05:00.000Z"
      }
    ];
    const contentAssets: ContentAsset[] = [
      {
        id: "content-factory-1",
        ideaId: "idea-factory-1",
        signalId: "sig-factory-1",
        signalAnalysisId: "analysis-factory-1",
        orchestratorDecisionId: "decision-factory-1",
        contentType: "linkedin-post",
        hook: "The workflow breaks before the model does",
        body: "Ownership matters after launch.",
        cta: "Compare notes.",
        bestAngle: "ownership_gap",
        recommendedFormat: "long_linkedin_post",
        longPostDraft: "Long draft",
        shortPostDraft: "Short draft",
        status: "draft",
        contentStatus: "review",
        publishReadyFlag: true,
        createdAt: "2026-03-19T09:00:00.000Z"
      }
    ];
    const candidateQueueItems: CandidateQueueItem[] = [
      {
        id: "candidate-content-1",
        signalId: "sig-factory-1",
        signalAnalysisId: "analysis-factory-1",
        contentAssetId: "content-factory-1",
        criticReviewId: "review-factory-1",
        orchestratorDecisionId: "decision-factory-1",
        candidateType: "high_priority_candidate",
        queueState: "ready_for_review",
        priorityScore: 91,
        priorityLabel: "high",
        whyQueued: "Strong candidate",
        nextAction: "review_for_publication",
        requiresHumanReview: true,
        createdAt: "2026-03-19T09:30:00.000Z",
        updatedAt: "2026-03-19T09:30:00.000Z"
      },
      {
        id: "candidate-solution-1",
        signalId: "sig-factory-2",
        signalAnalysisId: "analysis-factory-2",
        solutionMemoryId: "solution-factory-1",
        orchestratorDecisionId: "decision-factory-2",
        candidateType: "solution_candidate",
        queueState: "ready_for_solution_followup",
        priorityScore: 82,
        priorityLabel: "high",
        whyQueued: "Strong solution candidate",
        nextAction: "review_solution_followup",
        requiresHumanReview: true,
        createdAt: "2026-03-19T09:35:00.000Z",
        updatedAt: "2026-03-19T09:35:00.000Z"
      }
    ];
    const factoryRuns: AutonomousRun[] = [
      {
        id: "run-factory-1",
        signalId: "sig-factory-1",
        watchlistId: "sig-factory-1",
        triggerType: "scheduler",
        runType: "signal_pipeline",
        status: "completed",
        startedAt: "2026-03-19T09:00:00.000Z",
        completedAt: "2026-03-19T09:03:00.000Z",
        resultSummary: "Autonomous signal pipeline completed and handed off to the candidate queue.",
        resultMetadata: {
          audienceItemCount: 0,
          solutionItemCount: 0,
          usedAi: true,
          producedSignalAnalysisId: "analysis-factory-1",
          producedOrchestratorDecisionId: "decision-factory-1",
          producedContentAssetId: "content-factory-1",
          producedCriticReviewId: "review-factory-1",
          producedCandidateQueueItemId: "candidate-content-1"
        },
        createdAt: "2026-03-19T09:00:00.000Z",
        updatedAt: "2026-03-19T09:03:00.000Z"
      }
    ];
    const memoryPatterns: MemoryPattern[] = [
      {
        id: "memory-1",
        patternType: "publish_window",
        patternKey: "publish_window:strong:afternoon",
        strengthScore: 20,
        recommendedAction: "repeat",
        lastUpdatedAt: "2026-03-19T09:40:00.000Z"
      },
      {
        id: "memory-2",
        patternType: "angle",
        patternKey: "angle:strong:ownership-gap",
        strengthScore: 18,
        recommendedAction: "repeat",
        lastUpdatedAt: "2026-03-19T09:45:00.000Z"
      }
    ];
    const solutionMemories: SolutionMemory[] = [
      {
        id: "solution-factory-1",
        signalId: "sig-factory-2",
        sourceType: "article",
        implementationPotential: "high",
        implementationComplexity: "medium",
        detectedStack: ["typescript"],
        keyFeatures: ["queue visibility"],
        architectureClues: ["durable queue state"],
        deploymentHints: ["local-first MVP deployment is viable"],
        clientFitTypes: ["operator-led growth teams"],
        possibleUseCases: ["Brand content around solution follow-up"],
        repoReference: "https://example.com/solution",
        createdAt: "2026-03-19T09:15:00.000Z",
        updatedAt: "2026-03-19T09:15:00.000Z"
      }
    ];
    const criticReviews: WritingQualityAssessment[] = [
      {
        id: "review-factory-1",
        contentAssetId: "content-factory-1",
        humanToneScore: 82,
        clarityScore: 84,
        groundednessScore: 86,
        antiRobotScore: 88,
        overallScore: 85,
        notes: ["Strong draft"],
        qualityScore: 88,
        genericnessScore: 18,
        businessValueScore: 84,
        differentiationScore: 81,
        publishReadyFlag: true,
        rewriteSuggestions: [],
        criticNotes: "Ready for publication review.",
        createdAt: "2026-03-19T09:20:00.000Z"
      }
    ];
    const factoryPriority: FactoryPrioritySelectionResult = {
      evaluatedAt: "2026-03-19T09:50:00.000Z",
      signals: [
        {
          itemType: "signal",
          itemId: "sig-factory-2",
          signalId: "sig-factory-2",
          priorityScore: 79,
          priorityLabel: "high",
          recommendedAction: "run_now",
          reasonSummary: "Strong signal should run now.",
          memoryInfluenceLabel: "positive",
          supportingFactorsJson: {}
        }
      ],
      candidateQueueItems: [
        {
          itemType: "candidate_queue_item",
          itemId: "candidate-content-1",
          signalId: "sig-factory-1",
          candidateType: "high_priority_candidate",
          contentAssetId: "content-factory-1",
          priorityScore: 91,
          priorityLabel: "high",
          recommendedAction: "queue_for_review",
          timingHint:
            "Preferred publish window is afternoon; wait for that window before spending the next rerun or review cycle.",
          reasonSummary: "Highest-value candidate for review.",
          memoryInfluenceLabel: "positive",
          supportingFactorsJson: {}
        }
      ]
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/signals") && method === "GET") return jsonResponse(signals);
      if (url.endsWith("/content") && method === "GET") return jsonResponse(contentAssets);
      if (url.endsWith("/candidate-queue") && method === "GET") return jsonResponse(candidateQueueItems);
      if (url.endsWith("/factory/runs") && method === "GET") return jsonResponse(factoryRuns);
      if (url.endsWith("/factory/memory-patterns") && method === "GET") return jsonResponse(memoryPatterns);
      if (url.endsWith("/factory/solution-memories") && method === "GET") return jsonResponse(solutionMemories);
      if (url.endsWith("/factory/critic-reviews") && method === "GET") return jsonResponse(criticReviews);
      if (url.endsWith("/factory/priority") && method === "GET") return jsonResponse(factoryPriority);

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    const commandCenter = await screen.findByRole("region", { name: "Factory command center" });
    expect(within(commandCenter).getByText("Factory command center")).toBeInTheDocument();

    const opportunitiesSection = within(commandCenter).getByRole("region", {
      name: "New signals and opportunities"
    });
    expect(within(opportunitiesSection).getByText("Workflow accountability repo")).toBeInTheDocument();
    expect(within(opportunitiesSection).getByText(/Highest-value candidate for review\./i)).toBeInTheDocument();

    const contentSection = within(commandCenter).getByRole("region", { name: "Top content candidates" });
    expect(within(contentSection).getByText("Workflow accountability repo")).toBeInTheDocument();
    expect(within(contentSection).getByText(/ownership_gap/i)).toBeInTheDocument();
    expect(within(contentSection).getByText(/queue_for_review/i)).toBeInTheDocument();

    const solutionSection = within(commandCenter).getByRole("region", { name: "Top solution candidates" });
    expect(within(solutionSection).getByText("Solution follow-up signal")).toBeInTheDocument();
    expect(within(solutionSection).getByText(/Best fit:/i)).toBeInTheDocument();
    expect(within(solutionSection).getByText(/solution follow-up/i)).toBeInTheDocument();

    const runsSection = within(commandCenter).getByRole("region", { name: "Recent factory runs" });
    expect(within(runsSection).getByText("Autonomous signal pipeline completed and handed off to the candidate queue.")).toBeInTheDocument();
    expect(within(runsSection).getByText(/analysis · decision · content · critic review · queue handoff/i)).toBeInTheDocument();

    const prioritySection = within(commandCenter).getByRole("region", { name: "Next recommended actions" });
    expect(within(prioritySection).getByText("Highest-value candidate for review.")).toBeInTheDocument();
    expect(within(prioritySection).getByText(/Strength/)).toBeInTheDocument();
  });

  it("opens a candidate review detail panel from Day-1 and renders the draft content", async () => {
    const user = userEvent.setup();
    const signals: Signal[] = [
      {
        id: "sig-factory-1",
        title: "Workflow accountability repo",
        sourceType: "github_repo",
        rawText: "Queue visibility and exception handling matter after rollout.",
        status: "new",
        createdAt: "2026-03-19T09:00:00.000Z"
      }
    ];
    const contentAssets: ContentAsset[] = [
      {
        id: "content-factory-1",
        ideaId: "idea-factory-1",
        signalId: "sig-factory-1",
        signalAnalysisId: "analysis-factory-1",
        orchestratorDecisionId: "decision-factory-1",
        contentType: "linkedin-post",
        hook: "The workflow breaks before the model does",
        body: "If nobody owns the queue after launch, your AI rollout stays fragile.",
        cta: "Compare notes.",
        bestAngle: "ownership gap after rollout",
        shortPostDraft: "Short draft body",
        longPostDraft: "Long draft body",
        recommendedFormat: "long_linkedin_post",
        status: "draft",
        contentStatus: "review",
        publishReadyFlag: false,
        overallQualityScore: 84,
        qualityStatus: "reviewed",
        createdAt: "2026-03-19T09:15:00.000Z"
      }
    ];
    const candidateQueueItems: CandidateQueueItem[] = [
      {
        id: "candidate-content-1",
        signalId: "sig-factory-1",
        signalAnalysisId: "analysis-factory-1",
        contentAssetId: "content-factory-1",
        criticReviewId: "review-factory-1",
        orchestratorDecisionId: "decision-factory-1",
        candidateType: "content_candidate",
        queueState: "ready_for_review",
        priorityScore: 91,
        priorityLabel: "high",
        whyQueued: "Highest-value candidate for review.",
        nextAction: "review_for_publication",
        requiresHumanReview: true,
        createdAt: "2026-03-19T09:25:00.000Z",
        updatedAt: "2026-03-19T09:25:00.000Z"
      }
    ];
    const criticReviews: WritingQualityAssessment[] = [
      {
        id: "review-factory-1",
        contentAssetId: "content-factory-1",
        humanToneScore: 82,
        clarityScore: 84,
        groundednessScore: 86,
        antiRobotScore: 88,
        overallScore: 85,
        notes: ["Strong draft"],
        qualityScore: 88,
        genericnessScore: 18,
        businessValueScore: 84,
        differentiationScore: 81,
        publishReadyFlag: false,
        rewriteSuggestions: ["Make the CTA more specific."],
        criticNotes: "Strong operator angle, but the CTA still needs work.",
        createdAt: "2026-03-19T09:20:00.000Z"
      }
    ];
    const detail: CandidateQueueItemDetail = {
      candidate: candidateQueueItems[0]!,
      signal: signals[0]!,
      signalAnalysis: {
        id: "analysis-factory-1",
        signalId: "sig-factory-1",
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
        audienceEmphasis: "Operators responsible for production workflow outcomes",
        createdAt: "2026-03-19T09:05:00.000Z"
      },
      contentAsset: contentAssets[0]!,
      criticReview: criticReviews[0]!,
      orchestratorDecision: {
        id: "decision-factory-1",
        signalId: "sig-factory-1",
        decisionType: "content_candidate",
        decisionReason: "Strong enough for a review lane.",
        confidenceScore: 81,
        nextAction: "queue_for_content_review",
        requiresHumanReview: true,
        createdAt: "2026-03-19T09:10:00.000Z"
      }
    };
    const factoryPriority: FactoryPrioritySelectionResult = {
      evaluatedAt: "2026-03-19T09:50:00.000Z",
      signals: [],
      candidateQueueItems: [
        {
          itemType: "candidate_queue_item",
          itemId: "candidate-content-1",
          signalId: "sig-factory-1",
          candidateType: "content_candidate",
          contentAssetId: "content-factory-1",
          priorityScore: 91,
          priorityLabel: "high",
          recommendedAction: "queue_for_review",
          reasonSummary: "Highest-value candidate for review.",
          memoryInfluenceLabel: "positive",
          supportingFactorsJson: {}
        }
      ]
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/signals") && method === "GET") return jsonResponse(signals);
      if (url.endsWith("/content") && method === "GET") return jsonResponse(contentAssets);
      if (url.endsWith("/candidate-queue") && method === "GET") return jsonResponse(candidateQueueItems);
      if (url.endsWith("/candidate-queue/candidate-content-1") && method === "GET") {
        return jsonResponse(detail);
      }
      if (url.endsWith("/factory/runs") && method === "GET") return jsonResponse([]);
      if (url.endsWith("/factory/memory-patterns") && method === "GET") return jsonResponse([]);
      if (url.endsWith("/factory/solution-memories") && method === "GET") return jsonResponse([]);
      if (url.endsWith("/factory/critic-reviews") && method === "GET") return jsonResponse(criticReviews);
      if (url.endsWith("/factory/priority") && method === "GET") return jsonResponse(factoryPriority);

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    const commandCenter = await screen.findByRole("region", { name: "Factory command center" });
    await user.click(
      within(commandCenter).getByRole("button", { name: "Review draft" })
    );

    const dialog = await screen.findByRole("dialog", { name: "Candidate review detail" });
    expect(within(dialog).getByText("The workflow breaks before the model does")).toBeInTheDocument();
    expect(within(dialog).getByText("If nobody owns the queue after launch, your AI rollout stays fragile.")).toBeInTheDocument();
    expect(within(dialog).getByText("Compare notes.")).toBeInTheDocument();
    expect(within(dialog).getByText("Short draft body")).toBeInTheDocument();
    expect(within(dialog).getByText("Long draft body")).toBeInTheDocument();
    expect(within(dialog).getByText("Strong operator angle, but the CTA still needs work.")).toBeInTheDocument();
  });

  it("applies approve, revision, and archive actions from the Day-1 candidate review panel", async () => {
    const user = userEvent.setup();
    const signals: Signal[] = [
      {
        id: "sig-factory-1",
        title: "Workflow accountability repo",
        sourceType: "github_repo",
        rawText: "Queue visibility and exception handling matter after rollout.",
        status: "new",
        createdAt: "2026-03-19T09:00:00.000Z"
      }
    ];
    let contentAssets: ContentAsset[] = [
      {
        id: "content-factory-1",
        ideaId: "idea-factory-1",
        signalId: "sig-factory-1",
        signalAnalysisId: "analysis-factory-1",
        orchestratorDecisionId: "decision-factory-1",
        contentType: "linkedin-post",
        hook: "The workflow breaks before the model does",
        body: "If nobody owns the queue after launch, your AI rollout stays fragile.",
        cta: "Compare notes.",
        bestAngle: "ownership gap after rollout",
        shortPostDraft: "Short draft body",
        longPostDraft: "Long draft body",
        recommendedFormat: "long_linkedin_post",
        status: "draft",
        contentStatus: "review",
        publishReadyFlag: false,
        overallQualityScore: 84,
        qualityStatus: "reviewed",
        createdAt: "2026-03-19T09:15:00.000Z"
      }
    ];
    let candidateQueueItems: CandidateQueueItem[] = [
      {
        id: "candidate-content-1",
        signalId: "sig-factory-1",
        signalAnalysisId: "analysis-factory-1",
        contentAssetId: "content-factory-1",
        criticReviewId: "review-factory-1",
        orchestratorDecisionId: "decision-factory-1",
        candidateType: "content_candidate",
        queueState: "ready_for_review",
        priorityScore: 91,
        priorityLabel: "high",
        whyQueued: "Highest-value candidate for review.",
        nextAction: "review_for_publication",
        requiresHumanReview: true,
        createdAt: "2026-03-19T09:25:00.000Z",
        updatedAt: "2026-03-19T09:25:00.000Z"
      }
    ];
    const criticReviews: WritingQualityAssessment[] = [
      {
        id: "review-factory-1",
        contentAssetId: "content-factory-1",
        humanToneScore: 82,
        clarityScore: 84,
        groundednessScore: 86,
        antiRobotScore: 88,
        overallScore: 85,
        notes: ["Strong draft"],
        qualityScore: 88,
        genericnessScore: 18,
        businessValueScore: 84,
        differentiationScore: 81,
        publishReadyFlag: false,
        rewriteSuggestions: ["Make the CTA more specific."],
        criticNotes: "Strong operator angle, but the CTA still needs work.",
        createdAt: "2026-03-19T09:20:00.000Z"
      }
    ];
    const signalAnalysis = {
      id: "analysis-factory-1",
      signalId: "sig-factory-1",
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
      audienceEmphasis: "Operators responsible for production workflow outcomes",
      createdAt: "2026-03-19T09:05:00.000Z"
    };
    const decision = {
      id: "decision-factory-1",
      signalId: "sig-factory-1",
      decisionType: "content_candidate",
      decisionReason: "Strong enough for a review lane.",
      confidenceScore: 81,
      nextAction: "queue_for_content_review",
      requiresHumanReview: true,
      createdAt: "2026-03-19T09:10:00.000Z"
    };
    const factoryPriority: FactoryPrioritySelectionResult = {
      evaluatedAt: "2026-03-19T09:50:00.000Z",
      signals: [],
      candidateQueueItems: [
        {
          itemType: "candidate_queue_item",
          itemId: "candidate-content-1",
          signalId: "sig-factory-1",
          candidateType: "content_candidate",
          contentAssetId: "content-factory-1",
          priorityScore: 91,
          priorityLabel: "high",
          recommendedAction: "queue_for_review",
          reasonSummary: "Highest-value candidate for review.",
          memoryInfluenceLabel: "positive",
          supportingFactorsJson: {}
        }
      ]
    };

    const buildDetail = (): CandidateQueueItemDetail => ({
      candidate: candidateQueueItems[0]!,
      signal: signals[0]!,
      signalAnalysis,
      contentAsset: contentAssets[0]!,
      criticReview: criticReviews[0]!,
      orchestratorDecision: decision
    });

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/signals") && method === "GET") return jsonResponse(signals);
      if (url.endsWith("/content") && method === "GET") return jsonResponse(contentAssets);
      if (url.endsWith("/candidate-queue") && method === "GET") return jsonResponse(candidateQueueItems);
      if (url.endsWith("/candidate-queue/candidate-content-1") && method === "GET") {
        return jsonResponse(buildDetail());
      }
      if (url.endsWith("/candidate-queue/candidate-content-1") && method === "PATCH") {
        const payload = JSON.parse(String(init?.body ?? "{}")) as {
          action: "approve_for_publication" | "mark_needs_revision" | "archive_candidate";
          operatorNote?: string;
        };

        if (payload.action === "mark_needs_revision") {
          candidateQueueItems = [
            {
              ...candidateQueueItems[0]!,
              queueState: "revision_requested",
              operatorNote: payload.operatorNote,
              nextAction: "revise_content_candidate",
              whyQueued: "Revision was requested by the operator before publication review can continue."
            }
          ];
          contentAssets = [
            {
              ...contentAssets[0]!,
              contentStatus: "review",
              publishReadyFlag: false
            }
          ];
        }

        if (payload.action === "approve_for_publication") {
          candidateQueueItems = [
            {
              ...candidateQueueItems[0]!,
              queueState: "ready_to_publish",
              requiresHumanReview: false,
              nextAction: "approved_for_publication"
            }
          ];
          contentAssets = [
            {
              ...contentAssets[0]!,
              contentStatus: "ready",
              publishReadyFlag: true
            }
          ];
        }

        if (payload.action === "archive_candidate") {
          candidateQueueItems = [
            {
              ...candidateQueueItems[0]!,
              queueState: "archived",
              nextAction: "archived"
            }
          ];
          contentAssets = [
            {
              ...contentAssets[0]!,
              contentStatus: "archived",
              publishReadyFlag: false
            }
          ];
        }

        return jsonResponse(buildDetail());
      }
      if (url.endsWith("/factory/runs") && method === "GET") return jsonResponse([]);
      if (url.endsWith("/factory/memory-patterns") && method === "GET") return jsonResponse([]);
      if (url.endsWith("/factory/solution-memories") && method === "GET") return jsonResponse([]);
      if (url.endsWith("/factory/critic-reviews") && method === "GET") return jsonResponse(criticReviews);
      if (url.endsWith("/factory/priority") && method === "GET") return jsonResponse(factoryPriority);

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    const commandCenter = await screen.findByRole("region", { name: "Factory command center" });

    await user.click(within(commandCenter).getByRole("button", { name: "Review draft" }));
    const dialog = await screen.findByRole("dialog", { name: "Candidate review detail" });

    await user.clear(within(dialog).getByLabelText("Operator note"));
    await user.type(within(dialog).getByLabelText("Operator note"), "Tighten the hook.");
    await user.click(within(dialog).getByRole("button", { name: "Mark needs revision" }));
    await waitFor(() => {
      expect(within(dialog).getByText("needs revision")).toBeInTheDocument();
      expect(within(dialog).getByDisplayValue("Tighten the hook.")).toBeInTheDocument();
    });

    await user.click(within(dialog).getByRole("button", { name: "Approve for publication" }));
    await waitFor(() => {
      expect(within(dialog).getByText("publish ready")).toBeInTheDocument();
    });

    await user.click(within(dialog).getByRole("button", { name: "Archive candidate" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Candidate review detail" })).not.toBeInTheDocument();
      expect(
        within(commandCenter).getByText("No content candidates are queued yet.")
      ).toBeInTheDocument();
    });
  });

  it("renders clear empty states in the factory command center when canonical factory outputs are empty", async () => {
    render(<App apiBaseUrl="http://localhost:4000" />);

    const commandCenter = await screen.findByRole("region", { name: "Factory command center" });
    expect(within(commandCenter).getByText("No fresh opportunities are waiting right now.")).toBeInTheDocument();
    expect(within(commandCenter).getByText("No content candidates are queued yet.")).toBeInTheDocument();
    expect(within(commandCenter).getByText("No solution candidates are queued yet.")).toBeInTheDocument();
    expect(within(commandCenter).getByText("No autonomous signal-pipeline runs have completed yet.")).toBeInTheDocument();
    expect(within(commandCenter).getByText("No next actions are waiting right now.")).toBeInTheDocument();
  });

  it("keeps the factory command center ahead of the supervised operations stack in Day-1 mode", async () => {
    render(<App apiBaseUrl="http://localhost:4000" />);

    const commandCenter = await screen.findByRole("region", { name: "Factory command center" });
    expect(screen.queryByRole("region", { name: "Review and triage console" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Launch console" })).not.toBeInTheDocument();
    expect(within(commandCenter).getByRole("button", { name: "Open full dashboard" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Signal title")).not.toBeInTheDocument();
  });

  it("shows the active matched opportunity in the Day-1 focus layer after selection", async () => {
    const matchedOpportunities: AutonomousMatchedOpportunity[] = [
      {
        id: "match-focus-1",
        watchlistId: "watch-2",
        autonomousRunId: "run-2",
        audienceQueueItemId: "review-audience-1",
        solutionQueueItemId: "review-solution-1",
        dedupeKey: "match-focus-1",
        title: "Turn approval drift into visible ownership",
        matchedPain: "Approvals stall because ownership stays vague after launch.",
        matchedSolutionPattern: "Visibility plus retry ownership unblocks stalled workflows.",
        matchRationale: "Pain and solution align around post-launch handoff failures.",
        suggestedAngle: "ownership_gap",
        recommendedAction: "write_post",
        priorityScore: 91,
        priorityBand: "high",
        reasonLines: ["Strong pain/solution fit.", "Operator workflow relevance is high."],
        confidence: "high",
        opportunityStrength: "strong",
        status: "new",
        reviewState: "new",
        createdAt: "2026-03-16T09:00:00.000Z",
        updatedAt: "2026-03-16T09:30:00.000Z"
      }
    ];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/review-queue") && method === "GET") {
        return jsonResponse([]);
      }
      if (url.includes("/autonomy/prioritized-opportunities") && method === "GET") {
        return jsonResponse(matchedOpportunities);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    const reviewConsole = await screen.findByRole("region", { name: "Review and triage console" });
    await user.click(
      within(reviewConsole).getByRole("button", {
        name: "View details for matched opportunity Turn approval drift into visible ownership"
      })
    );

    const focusLayer = screen.getByRole("region", { name: "Active item focus" });
    expect(within(focusLayer).getByText("Turn approval drift into visible ownership")).toBeInTheDocument();
    expect(
      within(focusLayer).getByText("Approvals stall because ownership stays vague after launch.")
    ).toBeInTheDocument();
    expect(within(focusLayer).getByText("No promoted work item is active yet.")).toBeInTheDocument();
    expect(within(focusLayer).getByText("No linked draft is active yet.")).toBeInTheDocument();
  });

  it("updates the Day-1 focus layer through promotion and draft creation without changing the supervised flow", async () => {
    const matchedOpportunities: AutonomousMatchedOpportunity[] = [
      {
        id: "match-focus-1",
        watchlistId: "watch-2",
        autonomousRunId: "run-2",
        audienceQueueItemId: "review-audience-1",
        solutionQueueItemId: "review-solution-1",
        dedupeKey: "match-focus-1",
        title: "Turn approval drift into visible ownership",
        matchedPain: "Approvals stall because ownership stays vague after launch.",
        matchedSolutionPattern: "Visibility plus retry ownership unblocks stalled workflows.",
        matchRationale: "Pain and solution align around post-launch handoff failures.",
        suggestedAngle: "ownership_gap",
        recommendedAction: "write_post",
        priorityScore: 91,
        priorityBand: "high",
        reasonLines: ["Strong pain/solution fit.", "Operator workflow relevance is high."],
        confidence: "high",
        opportunityStrength: "strong",
        status: "new",
        reviewState: "saved",
        reviewedAt: "2026-03-16T10:00:00.000Z",
        createdAt: "2026-03-16T09:00:00.000Z",
        updatedAt: "2026-03-16T10:00:00.000Z"
      }
    ];
    let contentWorkspaceItems: AutonomousContentWorkItem[] = [];
    let draftQueueItems: AutonomousDraftDocument[] = [];
    const promotedWorkItem: AutonomousContentWorkItem = {
      id: "work-focus-1",
      sourceMatchedOpportunityId: "match-focus-1",
      watchlistId: "watch-2",
      autonomousRunId: "run-2",
      workItemKind: "post",
      title: "Turn approval drift into visible ownership",
      summary: "Promoted from a saved matched opportunity.",
      rationale: "Pain and solution align around post-launch handoff failures.",
      recommendedAction: "write_post",
      priorityScore: 91,
      priorityBand: "high",
      reviewState: "saved",
      status: "draft",
      draftProgress: { hasDraft: false },
      createdAt: "2026-03-16T10:05:00.000Z",
      updatedAt: "2026-03-16T10:05:00.000Z"
    };
    const createdDraft: AutonomousDraftDocument = {
      id: "draft-focus-1",
      sourceContentWorkItemId: "work-focus-1",
      sourceSummary: "Promoted from a saved matched opportunity.",
      recommendedAction: "write_post",
      sourceWorkItemTitle: "Turn approval drift into visible ownership",
      sourceWorkItemStatus: "draft",
      sourceWorkItemRecommendedAction: "write_post",
      sourceWorkItemSummary: "Promoted from a saved matched opportunity.",
      title: "Turn approval drift into visible ownership",
      body: "Lead with the operator payoff.\n\nThen name the launch handoff clearly.",
      angle: "ownership_gap",
      status: "draft",
      createdAt: "2026-03-16T10:10:00.000Z",
      updatedAt: "2026-03-16T10:10:00.000Z"
    };

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/review-queue") && method === "GET") {
        return jsonResponse([]);
      }
      if (url.includes("/autonomy/prioritized-opportunities") && method === "GET") {
        return jsonResponse(matchedOpportunities);
      }
      if (url.endsWith("/autonomy/content-work-items") && method === "GET") {
        return jsonResponse(contentWorkspaceItems);
      }
      if (url.endsWith("/autonomy/drafts") && method === "GET") {
        return jsonResponse(draftQueueItems);
      }
      if (url.endsWith("/autonomy/matched-opportunities/match-focus-1/promote") && method === "POST") {
        contentWorkspaceItems = [promotedWorkItem];
        return jsonResponse(promotedWorkItem, 201);
      }
      if (url.endsWith("/autonomy/content-work-items/work-focus-1") && method === "GET") {
        return jsonResponse(contentWorkspaceItems[0]);
      }
      if (url.endsWith("/autonomy/content-work-items/work-focus-1/draft") && method === "POST") {
        draftQueueItems = [createdDraft];
        contentWorkspaceItems = [
          {
            ...promotedWorkItem,
            draftProgress: {
              hasDraft: true,
              draftId: createdDraft.id,
              draftStatus: createdDraft.status,
              draftUpdatedAt: createdDraft.updatedAt
            }
          }
        ];

        return jsonResponse(createdDraft, 201);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    const reviewConsole = await screen.findByRole("region", { name: "Review and triage console" });
    await user.click(
      within(reviewConsole).getByRole("button", {
        name: "View details for matched opportunity Turn approval drift into visible ownership"
      })
    );
    await user.click(
      within(reviewConsole).getByRole("button", { name: "Promote to content workspace" })
    );

    const focusLayer = screen.getByRole("region", { name: "Active item focus" });
    await waitFor(() => {
      expect(within(focusLayer).getAllByText("Turn approval drift into visible ownership").length).toBeGreaterThan(0);
      expect(within(focusLayer).getByText("Promoted from a saved matched opportunity.")).toBeInTheDocument();
    });

    const workspace = screen.getByRole("region", { name: "Server content workspace" });
    await user.click(
      within(workspace).getByRole("button", {
        name: "Create draft for workspace item Turn approval drift into visible ownership"
      })
    );

    await waitFor(() => {
      expect(within(focusLayer).getByText(/Lead with the operator payoff\./)).toBeInTheDocument();
      expect(within(focusLayer).getAllByText("draft").length).toBeGreaterThan(0);
    });
  });

  it("lets the operator switch from Day-1 Mode back to the full dashboard without losing the supervised MVP surfaces", async () => {
    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await screen.findByRole("region", { name: "Operator Day-1 mode" });
    await user.click(screen.getByRole("button", { name: "Full dashboard" }));

    expect(screen.getByRole("button", { name: "Full dashboard" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Day-1 Mode" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.queryByRole("region", { name: "Operator Day-1 mode" })).not.toBeInTheDocument();

    expect(screen.getByLabelText("Signal title")).toBeInTheDocument();
    expect(screen.getByText("Comment Writer")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Launch console" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Review and triage console" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Server content workspace" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Server draft queue" })).toBeInTheDocument();
  });

  it("keeps Day-1 Mode safe when launch-console loading fails", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/system/ai-runtime-health") && method === "GET") {
        return jsonResponse({ error: "runtime unavailable" }, 500);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await screen.findByRole("region", { name: "Operator Day-1 mode" });
    await waitFor(() => {
      expect(
        screen.getAllByText(/Launch console failed: GET \/system\/ai-runtime-health/).length
      ).toBeGreaterThan(0);
    });

    expect(screen.getByRole("region", { name: "Review and triage console" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Server content workspace" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Server draft queue" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Signal title")).not.toBeInTheDocument();
  });

  it("renders matched opportunities in server-truthful priority order inside the review and triage console", async () => {
    const reviewQueueItems: AutonomousReviewQueueItem[] = [
      {
        id: "review-1",
        watchlistId: "watch-1",
        autonomousRunId: "run-1",
        sourceArtifactId: "artifact-1",
        sourceKind: "audience",
        dedupeKey: "review-1",
        title: "Broken workflow handoffs after launch",
        summary: "Operators still patch approvals manually after rollout.",
        rationale: "Repeated workflow friction indicates a durable review candidate.",
        recommendedAction: "write_post",
        status: "new",
        createdAt: "2026-03-16T08:00:00.000Z",
        updatedAt: "2026-03-16T08:10:00.000Z"
      }
    ];
    const matchedOpportunities: AutonomousMatchedOpportunity[] = [
      {
        id: "match-high",
        watchlistId: "watch-2",
        autonomousRunId: "run-2",
        audienceQueueItemId: "review-audience-1",
        solutionQueueItemId: "review-solution-1",
        dedupeKey: "match-high",
        title: "Turn approval drift into visible ownership",
        matchedPain: "Approvals stall because ownership stays vague after launch.",
        matchedSolutionPattern: "Visibility plus retry ownership unblocks stalled workflows.",
        matchRationale: "Pain and solution align around post-launch handoff failures.",
        suggestedAngle: "ownership_gap",
        recommendedAction: "write_post",
        priorityScore: 91,
        priorityBand: "high",
        reasonLines: ["Strong pain/solution fit.", "Operator workflow relevance is high."],
        confidence: "high",
        opportunityStrength: "strong",
        status: "new",
        reviewState: "new",
        createdAt: "2026-03-16T09:00:00.000Z",
        updatedAt: "2026-03-16T09:30:00.000Z"
      },
      {
        id: "match-low",
        watchlistId: "watch-3",
        autonomousRunId: "run-3",
        audienceQueueItemId: "review-audience-2",
        solutionQueueItemId: "review-solution-2",
        dedupeKey: "match-low",
        title: "Document retry steps after the fact",
        matchedPain: "Teams need a lower-priority follow-up process note.",
        matchedSolutionPattern: "A lightweight postmortem note helps later.",
        matchRationale: "Useful, but weaker than the ownership-angle item.",
        suggestedAngle: "workflow_accountability",
        recommendedAction: "save_for_later",
        priorityScore: 51,
        priorityBand: "low",
        reasonLines: ["Useful backlog item."],
        confidence: "medium",
        opportunityStrength: "medium",
        status: "new",
        reviewState: "new",
        createdAt: "2026-03-16T09:00:00.000Z",
        updatedAt: "2026-03-16T09:30:00.000Z"
      }
    ];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/review-queue") && method === "GET") {
        return jsonResponse(reviewQueueItems);
      }
      if (url.includes("/autonomy/prioritized-opportunities") && method === "GET") {
        return jsonResponse(matchedOpportunities);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    const reviewConsole = await screen.findByRole("region", { name: "Review and triage console" });
    expect(within(reviewConsole).getByText("Review & Triage Console")).toBeInTheDocument();
    expect(within(reviewConsole).getByText("Broken workflow handoffs after launch")).toBeInTheDocument();
    expect(within(reviewConsole).getByText("Turn approval drift into visible ownership")).toBeInTheDocument();
    const detailButtons = within(reviewConsole).getAllByRole("button", {
      name: /View details for matched opportunity/
    });
    expect(detailButtons[0]).toHaveAttribute(
      "aria-label",
      "View details for matched opportunity Turn approval drift into visible ownership"
    );
    expect(detailButtons[1]).toHaveAttribute(
      "aria-label",
      "View details for matched opportunity Document retry steps after the fact"
    );
    expect(
      within(reviewConsole).getByRole("button", {
        name: "View details for matched opportunity Turn approval drift into visible ownership"
      })
    ).toBeInTheDocument();

    await user.click(
      within(reviewConsole).getByRole("button", {
        name: "View details for matched opportunity Turn approval drift into visible ownership"
      })
    );

    await waitFor(() => {
      expect(within(reviewConsole).getByText("Match rationale")).toBeInTheDocument();
      expect(within(reviewConsole).getByText("Pain and solution align around post-launch handoff failures.")).toBeInTheDocument();
      expect(within(reviewConsole).getByLabelText("Matched opportunity review state")).toBeInTheDocument();
      expect(
        within(reviewConsole).getByRole("button", { name: "Apply review state" })
      ).toBeInTheDocument();
    });
  });

  it("shows a compact empty state when no server-side review backlog exists", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    const reviewConsole = await screen.findByRole("region", { name: "Review and triage console" });
    expect(
      within(reviewConsole).getByText("No server-side review backlog or matched opportunities yet.")
    ).toBeInTheDocument();
  });

  it("filters prioritized matched opportunities by review state while preserving server-truth priority order", async () => {
    const matchedOpportunities: AutonomousMatchedOpportunity[] = [
      {
        id: "match-saved-high",
        watchlistId: "watch-2",
        autonomousRunId: "run-2",
        audienceQueueItemId: "review-audience-1",
        solutionQueueItemId: "review-solution-1",
        dedupeKey: "match-saved-high",
        title: "Highest saved priority",
        matchedPain: "High-priority saved item.",
        matchedSolutionPattern: "Strong saved solution fit.",
        matchRationale: "Saved and still highest priority.",
        suggestedAngle: "ownership_gap",
        recommendedAction: "write_post",
        priorityScore: 95,
        priorityBand: "high",
        reasonLines: ["Highest saved item."],
        confidence: "high",
        opportunityStrength: "strong",
        status: "new",
        reviewState: "saved",
        createdAt: "2026-03-16T09:00:00.000Z",
        updatedAt: "2026-03-16T09:30:00.000Z"
      },
      {
        id: "match-saved-low",
        watchlistId: "watch-3",
        autonomousRunId: "run-3",
        audienceQueueItemId: "review-audience-2",
        solutionQueueItemId: "review-solution-2",
        dedupeKey: "match-saved-low",
        title: "Lower saved priority",
        matchedPain: "Lower-priority saved item.",
        matchedSolutionPattern: "Useful but lower priority.",
        matchRationale: "Saved but lower than the first item.",
        suggestedAngle: "workflow_accountability",
        recommendedAction: "save_for_later",
        priorityScore: 55,
        priorityBand: "low",
        reasonLines: ["Lower saved item."],
        confidence: "medium",
        opportunityStrength: "medium",
        status: "new",
        reviewState: "saved",
        createdAt: "2026-03-16T09:00:00.000Z",
        updatedAt: "2026-03-16T09:30:00.000Z"
      }
    ];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/review-queue") && method === "GET") {
        return jsonResponse([]);
      }
      if (url.includes("/autonomy/prioritized-opportunities?reviewState=saved") && method === "GET") {
        return jsonResponse(matchedOpportunities);
      }
      if (url.includes("/autonomy/prioritized-opportunities") && method === "GET") {
        return jsonResponse([
          {
            ...matchedOpportunities[1]!,
            reviewState: "new",
            title: "Unfiltered leading item"
          },
          ...matchedOpportunities
        ]);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    const reviewConsole = await screen.findByRole("region", { name: "Review and triage console" });
    await user.selectOptions(
      within(reviewConsole).getByLabelText("Review and triage review state filter"),
      "saved"
    );

    await waitFor(() => {
      const detailButtons = within(reviewConsole).getAllByRole("button", {
        name: /View details for matched opportunity/
      });
      expect(detailButtons[0]).toHaveAttribute(
        "aria-label",
        "View details for matched opportunity Highest saved priority"
      );
      expect(detailButtons[1]).toHaveAttribute(
        "aria-label",
        "View details for matched opportunity Lower saved priority"
      );
    });
  });

  it("shows a filtered empty state when no prioritized matched opportunities match the selected review state", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/review-queue") && method === "GET") {
        return jsonResponse([]);
      }
      if (url.includes("/autonomy/prioritized-opportunities") && method === "GET") {
        return jsonResponse([]);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    const reviewConsole = await screen.findByRole("region", { name: "Review and triage console" });
    await user.selectOptions(
      within(reviewConsole).getByLabelText("Review and triage review state filter"),
      "saved"
    );

    await waitFor(() => {
      expect(
        within(reviewConsole).getByText(
          "No prioritized matched opportunities match the current review state filter."
        )
      ).toBeInTheDocument();
    });
  });

  it("applies matched-opportunity triage state safely from the review console", async () => {
    let matchedOpportunities: AutonomousMatchedOpportunity[] = [
      {
        id: "match-1",
        watchlistId: "watch-2",
        autonomousRunId: "run-2",
        audienceQueueItemId: "review-audience-1",
        solutionQueueItemId: "review-solution-1",
        dedupeKey: "match-1",
        title: "Turn approval drift into visible ownership",
        matchedPain: "Approvals stall because ownership stays vague after launch.",
        matchedSolutionPattern: "Visibility plus retry ownership unblocks stalled workflows.",
        matchRationale: "Pain and solution align around post-launch handoff failures.",
        suggestedAngle: "ownership_gap",
        recommendedAction: "write_post",
        priorityScore: 91,
        priorityBand: "high",
        reasonLines: ["Strong pain/solution fit.", "Operator workflow relevance is high."],
        confidence: "high",
        opportunityStrength: "strong",
        status: "new",
        reviewState: "new",
        createdAt: "2026-03-16T09:00:00.000Z",
        updatedAt: "2026-03-16T09:30:00.000Z"
      }
    ];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/review-queue") && method === "GET") {
        return jsonResponse([]);
      }
      if (url.includes("/autonomy/prioritized-opportunities") && method === "GET") {
        return jsonResponse(matchedOpportunities);
      }
      if (url.endsWith("/autonomy/matched-opportunities/match-1/review-state") && method === "PATCH") {
        matchedOpportunities = [
          {
            ...matchedOpportunities[0]!,
            reviewState: "saved",
            reviewNote: "Held for operator backlog.",
            reviewedAt: "2026-03-16T10:00:00.000Z",
            updatedAt: "2026-03-16T10:00:00.000Z"
          }
        ];

        return jsonResponse(matchedOpportunities[0]);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    const reviewConsole = await screen.findByRole("region", { name: "Review and triage console" });
    await user.click(
      within(reviewConsole).getByRole("button", {
        name: "View details for matched opportunity Turn approval drift into visible ownership"
      })
    );
    await user.selectOptions(
      within(reviewConsole).getByLabelText("Matched opportunity review state"),
      "saved"
    );
    await user.click(within(reviewConsole).getByRole("button", { name: "Apply review state" }));

    await waitFor(() => {
      expect(within(reviewConsole).getAllByText("saved").length).toBeGreaterThan(0);
    });
  });

  it("surfaces triage action failures safely while keeping downstream surfaces available", async () => {
    const matchedOpportunities: AutonomousMatchedOpportunity[] = [
      {
        id: "match-1",
        watchlistId: "watch-2",
        autonomousRunId: "run-2",
        audienceQueueItemId: "review-audience-1",
        solutionQueueItemId: "review-solution-1",
        dedupeKey: "match-1",
        title: "Turn approval drift into visible ownership",
        matchedPain: "Approvals stall because ownership stays vague after launch.",
        matchedSolutionPattern: "Visibility plus retry ownership unblocks stalled workflows.",
        matchRationale: "Pain and solution align around post-launch handoff failures.",
        suggestedAngle: "ownership_gap",
        recommendedAction: "write_post",
        priorityScore: 91,
        priorityBand: "high",
        reasonLines: ["Strong pain/solution fit.", "Operator workflow relevance is high."],
        confidence: "high",
        opportunityStrength: "strong",
        status: "new",
        reviewState: "new",
        createdAt: "2026-03-16T09:00:00.000Z",
        updatedAt: "2026-03-16T09:30:00.000Z"
      }
    ];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/review-queue") && method === "GET") {
        return jsonResponse([]);
      }
      if (url.includes("/autonomy/prioritized-opportunities") && method === "GET") {
        return jsonResponse(matchedOpportunities);
      }
      if (url.endsWith("/autonomy/matched-opportunities/match-1/review-state") && method === "PATCH") {
        return jsonResponse({ error: "triage unavailable" }, 500);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    const reviewConsole = await screen.findByRole("region", { name: "Review and triage console" });
    await user.click(
      within(reviewConsole).getByRole("button", {
        name: "View details for matched opportunity Turn approval drift into visible ownership"
      })
    );
    await user.selectOptions(
      within(reviewConsole).getByLabelText("Matched opportunity review state"),
      "saved"
    );
    await user.click(within(reviewConsole).getByRole("button", { name: "Apply review state" }));

    await waitFor(() => {
      expect(
        within(reviewConsole).getByText(
          /Triage update failed: PATCH \/autonomy\/matched-opportunities\/match-1\/review-state/
        )
      ).toBeInTheDocument();
    });

    expect(screen.getByRole("region", { name: "Server content workspace" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Server draft queue" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Launch console" })).toBeInTheDocument();
  });

  it("promotes an eligible matched opportunity through the review console without changing downstream flows", async () => {
    let matchedOpportunities: AutonomousMatchedOpportunity[] = [
      {
        id: "match-1",
        watchlistId: "watch-2",
        autonomousRunId: "run-2",
        audienceQueueItemId: "review-audience-1",
        solutionQueueItemId: "review-solution-1",
        dedupeKey: "match-1",
        title: "Turn approval drift into visible ownership",
        matchedPain: "Approvals stall because ownership stays vague after launch.",
        matchedSolutionPattern: "Visibility plus retry ownership unblocks stalled workflows.",
        matchRationale: "Pain and solution align around post-launch handoff failures.",
        suggestedAngle: "ownership_gap",
        recommendedAction: "write_post",
        priorityScore: 91,
        priorityBand: "high",
        reasonLines: ["Strong pain/solution fit.", "Operator workflow relevance is high."],
        confidence: "high",
        opportunityStrength: "strong",
        status: "new",
        reviewState: "saved",
        reviewedAt: "2026-03-16T10:00:00.000Z",
        createdAt: "2026-03-16T09:00:00.000Z",
        updatedAt: "2026-03-16T10:00:00.000Z"
      }
    ];
    let contentWorkspaceItems: AutonomousContentWorkItem[] = [];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/review-queue") && method === "GET") {
        return jsonResponse([]);
      }
      if (url.includes("/autonomy/prioritized-opportunities") && method === "GET") {
        return jsonResponse(matchedOpportunities);
      }
      if (url.includes("/autonomy/content-work-items") && method === "GET") {
        return jsonResponse(contentWorkspaceItems);
      }
      if (url.endsWith("/autonomy/matched-opportunities/match-1/promote") && method === "POST") {
        contentWorkspaceItems = [
          {
            id: "work-1",
            sourceMatchedOpportunityId: "match-1",
            watchlistId: "watch-2",
            autonomousRunId: "run-2",
            workItemKind: "post",
            title: "Turn approval drift into visible ownership",
            summary: "Promoted from a saved matched opportunity.",
            rationale: "Pain and solution align around post-launch handoff failures.",
            recommendedAction: "write_post",
            priorityScore: 91,
            priorityBand: "high",
            reviewState: "saved",
            status: "draft",
            draftProgress: { hasDraft: false },
            createdAt: "2026-03-16T10:05:00.000Z",
            updatedAt: "2026-03-16T10:05:00.000Z"
          }
        ];

        return jsonResponse(contentWorkspaceItems[0], 201);
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    const reviewConsole = await screen.findByRole("region", { name: "Review and triage console" });
    await user.click(
      within(reviewConsole).getByRole("button", {
        name: "View details for matched opportunity Turn approval drift into visible ownership"
      })
    );
    await user.click(
      within(reviewConsole).getByRole("button", { name: "Promote to content workspace" })
    );

    await waitFor(() => {
      expect(screen.getByText("Turn approval drift into visible ownership")).toBeInTheDocument();
      expect(screen.getByText("Promoted from a saved matched opportunity.")).toBeInTheDocument();
    });
  });

    expect(screen.getByText("No server-side content work items yet.")).toBeInTheDocument();
  });

  it("shows loading state while the server-side content workspace request is still pending", async () => {
    let resolveWorkspaceRequest!: (response: Response) => void;
    const workspaceRequest = new Promise<Response>((resolve) => {
      resolveWorkspaceRequest = resolve;
    });

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.endsWith("/autonomy/content-work-items") && method === "GET") {
        return workspaceRequest;
      }

      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    expect(await screen.findByText("Loading dashboard...")).toBeInTheDocument();

    resolveWorkspaceRequest(
      jsonResponse([
        {
          id: "work-1",
          sourceMatchedOpportunityId: "match-1",
          watchlistId: "watch-1",
          autonomousRunId: "run-1",
          workItemKind: "post",
          title: "Loaded after pending workspace request",
          summary: "A minimal server-side work item.",
          rationale: "Deterministic rationale.",
          recommendedAction: "write_post",
          priorityScore: 88,
          priorityBand: "high",
          reviewState: "saved",
          status: "draft",
          draftProgress: { hasDraft: false },
          createdAt: "2026-03-16T13:00:00.000Z",
          updatedAt: "2026-03-16T14:15:00.000Z"
        } satisfies AutonomousContentWorkItem
      ])
    );

    await waitFor(() => {
      expect(screen.getByText("Loaded after pending workspace request")).toBeInTheDocument();
    });
  });

  it("shows workspace endpoint diagnostics without breaking existing local content drafts", async () => {
    const contentAssets: ContentAsset[] = [
      {
        id: "content-1",
        ideaId: "idea-1",
        contentType: "linkedin-post",
        hook: "Local draft hook",
        body: "Local draft body",
        cta: "Local draft CTA",
        status: "draft",
        createdAt: "2026-03-16T00:00:00.000Z"
      }
    ];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse(contentAssets);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/autonomy/content-work-items")) {
          return jsonResponse({ error: "server workspace unavailable" }, 500);
        }
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Local draft hook")).toBeInTheDocument();
    });

    expect(screen.getByText("Some sections failed to load.")).toBeInTheDocument();
    expect(
      screen.getAllByText(/Server content workspace failed: GET \/autonomy\/content-work-items/)
        .length
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/server workspace unavailable/).length).toBeGreaterThan(0);
  });

  it("shows finalized posts in a dedicated section without breaking draft and refined sections", async () => {
    const contentAssets: ContentAsset[] = [
      {
        id: "content-1",
        ideaId: "idea-1",
        contentType: "linkedin-post",
        hook: "Draft hook",
        body: "Draft body",
        cta: "Draft cta",
        status: "draft",
        refinedHook: "Refined hook",
        refinedBody: "Refined body with a practical payoff.",
        refinedCta: "Refined cta",
        refinementStatus: "refined",
        createdAt: "2026-03-14T00:00:00.000Z"
      }
    ];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse(contentAssets);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      if (url.endsWith("/content/finalize") && method === "POST") {
        const updated = {
          ...contentAssets[0],
          finalHook: "Tighter final hook",
          finalBody:
            "Lead with the business payoff.\n\nThen explain the operational blocker clearly.",
          finalClosing: "Where is the rollout friction showing up for you?",
          finalStatus: "ready" as const,
          finalQualityScore: 93
        };
        contentAssets.splice(0, 1, updated);
        return jsonResponse(updated, 201);
      }

      if (url.endsWith("/content/finalize-v2") && method === "POST") {
        return jsonResponse(
          {
            contentId: "content-1",
            signalId: "signal-1",
            ideaId: "idea-1",
            hook: "AI copilots fail after the demo",
            post:
              "AI copilots fail after the demo\n\nThe real problem starts after the demo, when the work hits a live process that nobody actually designed.\n\nMost teams miss this: the useful system is the owner, exception path, memory, and accountability around the model.\n\nThat shows up as more cleanup, slower decisions, and less trust in the system once the demo is over.\n\nThe model is rarely the main problem.",
            mode: "deterministic",
            generatorVersion: "v2"
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Refined hook")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Generate Final Post (Legacy)" }));
    await user.click(screen.getByRole("button", { name: "Generate Final Post V2" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4000/content/finalize",
        expect.objectContaining({ method: "POST" })
      );
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4000/content/finalize-v2",
        expect.objectContaining({ method: "POST" })
      );
      expect(screen.getByText("Legacy Final Post")).toBeInTheDocument();
      expect(screen.getByText("V2 Final Post")).toBeInTheDocument();
      expect(screen.getByText("Tighter final hook")).toBeInTheDocument();
      expect(screen.getAllByText("AI copilots fail after the demo").length).toBeGreaterThan(0);
      expect(screen.getByText("Where is the rollout friction showing up for you?")).toBeInTheDocument();
      expect(screen.getByText(/93/)).toBeInTheDocument();
      expect(screen.getByText("Refined hook")).toBeInTheDocument();
    });
  });

  it("sends V3 final-post controls to the finalize route and shows quality metadata", async () => {
    const contentAssets: ContentAsset[] = [
      {
        id: "content-1",
        ideaId: "idea-1",
        contentType: "linkedin-post",
        hook: "Draft hook",
        body: "Draft body",
        cta: "Draft cta",
        status: "draft",
        refinedHook: "Refined hook",
        refinedBody: "Refined body with a practical payoff.",
        refinedCta: "Refined cta",
        refinementStatus: "refined",
        createdAt: "2026-03-14T00:00:00.000Z"
      }
    ];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse(contentAssets);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      if (url.endsWith("/content/finalize") && method === "POST") {
        expect(init?.body).toBeDefined();
        expect(JSON.parse(String(init?.body))).toEqual({
          contentId: "content-1",
          config: {
            hookMode: "execution_lesson",
            antiBlandness: true,
            outcomeAwareShaping: false
          }
        });

        const updated = {
          ...contentAssets[0],
          finalHook: "One owner makes the rollout move",
          finalBody:
            "The real breakdown starts after the pilot, when approvals stay fuzzy and nobody owns the edge cases.\n\nMost teams keep tuning the model and ignore the operating system around it.\n\nThat is why the demo looks clean while the real workflow slows down.",
          finalClosing: "Where does the workflow stall for you?",
          finalStatus: "ready" as const,
          finalQualityScore: 95,
          finalQualityMetadata: {
            hookStrengthScore: 94,
            humanFeelScore: 90,
            specificityScore: 88,
            publishabilityScore: 93,
            notes: ["Hook mode: execution_lesson", "Anti-blandness shaping enabled."]
          }
        };
        contentAssets.splice(0, 1, updated);
        return jsonResponse(updated, 201);
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Refined hook")).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Final post hook mode"), "execution_lesson");
    await user.click(screen.getByLabelText("Enable anti-blandness shaping"));
    await user.click(screen.getByRole("button", { name: "Generate Final Post (Legacy)" }));

    await waitFor(() => {
      expect(screen.getByText("One owner makes the rollout move")).toBeInTheDocument();
      expect(screen.getByText(/Hook strength:/i)).toBeInTheDocument();
      expect(screen.getByText(/Human feel:/i)).toBeInTheDocument();
      expect(screen.getByText(/Hook mode: execution_lesson/i)).toBeInTheDocument();
      expect(screen.getByText(/Anti-blandness shaping enabled/i)).toBeInTheDocument();
    });
  });

  it("sends outcome-aware final-post shaping context and renders outcome bias notes safely", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:manual-feedback",
      JSON.stringify([
        {
          id: "feedback-1",
          artifactType: "final_post",
          artifactId: "content-1",
          status: "posted",
          responseLevel: "strong",
          repeatTopic: true,
          notes: "Workflow accountability landed well.",
          createdAt: "2026-03-14T00:00:00.000Z"
        }
      ])
    );

    const contentAssets: ContentAsset[] = [
      {
        id: "content-1",
        ideaId: "idea-1",
        contentType: "linkedin-post",
        hook: "Draft hook",
        body: "Draft body",
        cta: "Draft cta",
        status: "draft",
        refinedHook: "Refined hook",
        refinedBody: "Refined body with a practical payoff.",
        refinedCta: "Refined cta",
        refinementStatus: "refined",
        createdAt: "2026-03-14T00:00:00.000Z"
      }
    ];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse(contentAssets);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      if (url.endsWith("/content/finalize") && method === "POST") {
        expect(init?.body).toBeDefined();
        expect(JSON.parse(String(init?.body))).toEqual({
          contentId: "content-1",
          config: {
            hookMode: "execution_lesson",
            antiBlandness: true,
            outcomeAwareShaping: true
          },
          outcomeContext: {
            feedbackSummary: expect.objectContaining({
              totalRecords: 1
            }),
            patternMemorySummary: expect.objectContaining({
              totalPatterns: expect.any(Number)
            })
          }
        });

        const updated = {
          ...contentAssets[0],
          finalHook: "One owner keeps the rollout moving",
          finalBody:
            "The execution breakdown starts when approvals stay fuzzy after the pilot.\n\nWhat actually matters is who owns the workflow after launch.\n\nThat is why operator trust compounds when execution stays visible.",
          finalClosing: "Where does the workflow stall for you?",
          finalStatus: "ready" as const,
          finalQualityScore: 96,
          finalQualityMetadata: {
            hookStrengthScore: 95,
            humanFeelScore: 92,
            specificityScore: 89,
            publishabilityScore: 94,
            notes: [
              "Hook mode: execution_lesson",
              "Anti-blandness shaping enabled.",
              "Outcome bias: lean into workflow accountability."
            ],
            outcomePatternBiasNotes: ["Outcome bias: lean into workflow accountability."],
            appliedOutcomeBias: "repeat" as const
          }
        };
        contentAssets.splice(0, 1, updated);
        return jsonResponse(updated, 201);
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Refined hook")).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Final post hook mode"), "execution_lesson");
    await user.click(screen.getByLabelText("Enable anti-blandness shaping"));
    await user.click(screen.getByLabelText("Enable outcome-aware shaping"));
    await user.click(screen.getByRole("button", { name: "Generate Final Post (Legacy)" }));

    await waitFor(() => {
      expect(screen.getByText("One owner keeps the rollout moving")).toBeInTheDocument();
      expect(screen.getByText(/Outcome bias: lean into workflow accountability/i)).toBeInTheDocument();
    });
  });

  it("renders a final-post comparison panel for a refined content item across legacy default, legacy + V3, and V2", async () => {
    const contentAssets: ContentAsset[] = [
      {
        id: "content-1",
        ideaId: "idea-1",
        contentType: "linkedin-post",
        hook: "Draft hook",
        body: "Draft body",
        cta: "Draft cta",
        status: "draft",
        refinedHook: "Refined hook",
        refinedBody: "Refined body with a practical payoff.",
        refinedCta: "Refined cta",
        refinementStatus: "refined",
        createdAt: "2026-03-14T00:00:00.000Z"
      }
    ];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse(contentAssets);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      if (url.endsWith("/content/finalize") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        if ("config" in body) {
          return jsonResponse(
            {
              ...contentAssets[0],
              finalHook: "One operator keeps the rollout moving",
              finalBody:
                "The real breakdown starts after the pilot, when approvals stay fuzzy and nobody owns the edge cases.\n\nMost teams keep tuning the model and ignore the workflow around it.\n\nThat is why the demo feels clean while the real process slows down.",
              finalClosing: "Where does the workflow stall for you?",
              finalStatus: "ready",
              finalQualityScore: 95,
              finalQualityMetadata: {
                hookStrengthScore: 94,
                humanFeelScore: 90,
                specificityScore: 88,
                publishabilityScore: 93,
                notes: ["Hook mode: execution_lesson", "Anti-blandness shaping enabled."]
              }
            },
            201
          );
        }

        return jsonResponse(
          {
            ...contentAssets[0],
            finalHook: "Approvals drift after the pilot",
            finalBody:
              "The problem is approvals stay vague after the pilot.\n\nWhat most teams miss is that one owner needs to carry the workflow.\n\nThe payoff is faster decisions and less cleanup.",
            finalClosing: "How are you handling it?",
            finalStatus: "ready",
            finalQualityScore: 88,
            finalQualityMetadata: {
              hookStrengthScore: 82,
              humanFeelScore: 76,
              specificityScore: 80,
              publishabilityScore: 84,
              notes: ["Hook mode: sharp_observation"]
            }
          },
          201
        );
      }

      if (url.endsWith("/content/finalize-v2") && method === "POST") {
        return jsonResponse(
          {
            contentId: "content-1",
            signalId: "signal-1",
            ideaId: "idea-1",
            hook: "AI copilots fail after the demo",
            post:
              "AI copilots fail after the demo\n\nThe real problem starts after the demo, when the work hits a live process that nobody actually designed.\n\nMost teams miss this: the useful system is the owner, exception path, memory, and accountability around the model.\n\nThat shows up as more cleanup, slower decisions, and less trust in the system once the demo is over.\n\nThe model is rarely the main problem.",
            mode: "deterministic",
            generatorVersion: "v2"
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Refined hook")).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Final post hook mode"), "execution_lesson");
    await user.click(screen.getByLabelText("Enable anti-blandness shaping"));
    await user.click(screen.getByRole("button", { name: "Compare Final Post Variants" }));

    await waitFor(() => {
      expect(screen.getByText("Final Post Comparison")).toBeInTheDocument();
      expect(screen.getAllByText("Legacy default").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Legacy + V3").length).toBeGreaterThan(0);
      expect(screen.getAllByText("V2 experimental").length).toBeGreaterThan(0);
      expect(screen.getByText("Approvals drift after the pilot")).toBeInTheDocument();
      expect(screen.getAllByText("One operator keeps the rollout moving").length).toBeGreaterThan(0);
      expect(screen.getAllByText("AI copilots fail after the demo").length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Hook strength:/i).length).toBeGreaterThan(1);
      expect(screen.getByText(/Metadata unavailable for this variant/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Hook mode: execution_lesson/i).length).toBeGreaterThan(0);
    });
  });

  it("supports hook-only, first-paragraph, and full-post comparison views", async () => {
    const contentAssets: ContentAsset[] = [
      {
        id: "content-1",
        ideaId: "idea-1",
        contentType: "linkedin-post",
        hook: "Draft hook",
        body: "Draft body",
        cta: "Draft cta",
        status: "draft",
        refinedHook: "Refined hook",
        refinedBody: "Refined body with a practical payoff.",
        refinedCta: "Refined cta",
        refinementStatus: "refined",
        createdAt: "2026-03-14T00:00:00.000Z"
      }
    ];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse(contentAssets);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      if (url.endsWith("/content/finalize") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        if ("config" in body) {
          return jsonResponse(
            {
              ...contentAssets[0],
              finalHook: "One operator keeps the rollout moving",
              finalBody:
                "The real breakdown starts after the pilot, when approvals stay fuzzy.\n\nMost teams keep tuning the model and ignore the workflow around it.\n\nThat is why the demo feels clean while the real process slows down.",
              finalClosing: "Where does the workflow stall for you?",
              finalStatus: "ready",
              finalQualityScore: 95,
              finalQualityMetadata: {
                hookStrengthScore: 94,
                humanFeelScore: 90,
                specificityScore: 88,
                publishabilityScore: 93,
                notes: ["Hook mode: execution_lesson", "Anti-blandness shaping enabled."]
              }
            },
            201
          );
        }

        return jsonResponse(
          {
            ...contentAssets[0],
            finalHook: "Approvals drift after the pilot",
            finalBody:
              "The problem is approvals stay vague after the pilot.\n\nWhat most teams miss is that one owner needs to carry the workflow.\n\nThe payoff is faster decisions and less cleanup.",
            finalClosing: "How are you handling it?",
            finalStatus: "ready",
            finalQualityScore: 88,
            finalQualityMetadata: {
              hookStrengthScore: 82,
              humanFeelScore: 76,
              specificityScore: 80,
              publishabilityScore: 84,
              notes: ["Hook mode: sharp_observation"]
            }
          },
          201
        );
      }

      if (url.endsWith("/content/finalize-v2") && method === "POST") {
        return jsonResponse(
          {
            contentId: "content-1",
            signalId: "signal-1",
            ideaId: "idea-1",
            hook: "AI copilots fail after the demo",
            post:
              "AI copilots fail after the demo\n\nThe real problem starts after the demo.\n\nMost teams miss this: the useful system is the owner.\n\nThat shows up as more cleanup and slower decisions.\n\nThe model is rarely the main problem.",
            mode: "deterministic",
            generatorVersion: "v2"
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Refined hook")).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Final post hook mode"), "execution_lesson");
    await user.click(screen.getByLabelText("Enable anti-blandness shaping"));
    await user.click(screen.getByRole("button", { name: "Compare Final Post Variants" }));

    await waitFor(() => {
      expect(screen.getByText("Final Post Comparison")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Hook only" }));

    await waitFor(() => {
      expect(screen.getAllByText("Approvals drift after the pilot").length).toBeGreaterThan(0);
      expect(screen.queryByText("The problem is approvals stay vague after the pilot.")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "First paragraph" }));

    await waitFor(() => {
      expect(screen.getByText("The problem is approvals stay vague after the pilot.")).toBeInTheDocument();
      expect(screen.queryByText("What most teams miss is that one owner needs to carry the workflow.")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Full post" }));

    await waitFor(() => {
      expect(screen.getByText("What most teams miss is that one owner needs to carry the workflow.")).toBeInTheDocument();
      expect(screen.getByText("The payoff is faster decisions and less cleanup.")).toBeInTheDocument();
    });
  });

  it("falls back safely when comparison text has no blank-line paragraph breaks", async () => {
    const contentAssets: ContentAsset[] = [
      {
        id: "content-1",
        ideaId: "idea-1",
        contentType: "linkedin-post",
        hook: "Draft hook",
        body: "Draft body",
        cta: "Draft cta",
        status: "draft",
        refinedHook: "Refined hook",
        refinedBody: "Refined body",
        refinedCta: "Refined cta",
        refinementStatus: "refined",
        createdAt: "2026-03-14T00:00:00.000Z"
      }
    ];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse(contentAssets);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      if (url.endsWith("/content/finalize") && method === "POST") {
        return jsonResponse(
          {
            ...contentAssets[0],
            finalHook: "Approvals drift after the pilot",
            finalBody: "Single block fallback text without blank line breaks.",
            finalClosing: "How are you handling it?",
            finalStatus: "ready",
            finalQualityScore: 88,
            finalQualityMetadata: {
              hookStrengthScore: 82,
              humanFeelScore: 76,
              specificityScore: 80,
              publishabilityScore: 84,
              notes: ["Hook mode: sharp_observation"]
            }
          },
          201
        );
      }

      if (url.endsWith("/content/finalize-v2") && method === "POST") {
        return jsonResponse(
          {
            contentId: "content-1",
            signalId: "signal-1",
            ideaId: "idea-1",
            hook: "AI copilots fail after the demo",
            post: "Single block fallback text without blank line breaks.",
            mode: "deterministic",
            generatorVersion: "v2"
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Refined hook")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Compare Final Post Variants" }));

    await waitFor(() => {
      expect(screen.getByText("Final Post Comparison")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "First paragraph" }));

    await waitFor(() => {
      expect(screen.getAllByText("Single block fallback text without blank line breaks.").length).toBeGreaterThan(0);
    });
  });

  it("renders a growth rhythm plan from queue and saved planner context", async () => {
    localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-1",
          signalText: "Comment on workflow ownership thread",
          bestAngle: "ownership_gap",
          reasoningSummary: "Strong operator-fit engagement opportunity.",
          priority: "medium",
          recommendedAction: "generate_comment",
          createdAt: "2026-03-14T00:00:00.000Z",
          status: "new"
        }
      ])
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) {
          return jsonResponse([
            {
              id: "strategy-1",
              type: "messaging",
              title: "Lean into workflow accountability",
              description: "Workflow accountability themes are resonating.",
              priority: "high",
              createdAt: "2026-03-14T00:00:00.000Z"
            }
          ]);
        }
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) {
          return jsonResponse([
            {
              id: "queue-1",
              topicScoreId: "topic-1",
              recommendedAction: "write_post",
              priority: "high",
              reason: "Strong workflow pain topic.",
              status: "queued",
              createdAt: "2026-03-14T00:00:00.000Z"
            }
          ]);
        }
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      if (url.endsWith("/growth/rhythm") && method === "POST") {
        return jsonResponse(
          {
            topPostCandidates: [
              {
                id: "queue-1",
                title: "Queue item: write_post",
                suggestedAction: "write_post",
                priority: "high",
                status: "queued",
                reasoningSummary: "Strong workflow pain topic.",
                memoryBadge: "Long-term repeat",
                memoryBadgeKind: "repeat",
                feedbackHint: "Aligned with repeat: workflow accountability",
                feedbackHintKind: "repeat"
              }
            ],
            topCommentCandidates: [
              {
                id: "saved-1",
                title: "Comment on workflow ownership thread",
                suggestedAction: "generate_comment",
                priority: "medium",
                status: "new",
                bestAngle: "ownership_gap",
                reasoningSummary: "Strong operator-fit engagement opportunity.",
                memoryBadge: "Recurring weak pattern",
                memoryBadgeKind: "avoid",
                feedbackHint: "Watch: avoid generic engagement",
                feedbackHintKind: "avoid"
              }
            ],
            keepForLater: [],
            weeklyFocus:
              "Lead with workflow accountability and convert the clearest queue item into a post.",
            suggestedCadence: "1 post candidate, 1 engagement opportunity, 0 to revisit later.",
            reasoningSummary:
              "The rhythm plan favors active queue work first, then high-fit engagement opportunities."
          },
          201
        );
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Content Queue")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Build Action Plan" }));

    await waitFor(() => {
      expect(screen.getByText("LinkedIn Action Plan")).toBeInTheDocument();
      expect(screen.getByText("Top post candidates")).toBeInTheDocument();
      expect(screen.getByText("Top comment opportunities")).toBeInTheDocument();
      expect(screen.getByText("Keep for later")).toBeInTheDocument();
      expect(screen.getByText("Queue item: write_post")).toBeInTheDocument();
      expect(screen.getAllByText("Comment on workflow ownership thread").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Long-term repeat").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Recurring weak pattern").length).toBeGreaterThan(0);
      expect(screen.getByText("Aligned with repeat: workflow accountability")).toBeInTheDocument();
      expect(screen.getByText("Watch: avoid generic engagement")).toBeInTheDocument();
      expect(screen.getByText(/Lead with workflow accountability/i)).toBeInTheDocument();
      expect(screen.getByText(/1 post candidate, 1 engagement opportunity/i)).toBeInTheDocument();
    });
  });

  it("renders growth rhythm candidates safely without noisy hints when alignment is neutral", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      if (url.endsWith("/growth/rhythm") && method === "POST") {
        return jsonResponse(
          {
            topPostCandidates: [
              {
                id: "queue-1",
                title: "Neutral execution note",
                suggestedAction: "write_post",
                priority: "medium",
                status: "queued",
                reasoningSummary: "No strong feedback overlap."
              }
            ],
            topCommentCandidates: [],
            keepForLater: [],
            weeklyFocus: "Keep next week focused.",
            suggestedCadence: "1 post candidate, 0 engagement opportunities, 0 to revisit later.",
            reasoningSummary: "Base rhythm guidance."
          },
          201
        );
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Content Queue")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Build Action Plan" }));

    await waitFor(() => {
      expect(screen.getByText("Neutral execution note")).toBeInTheDocument();
    });

    expect(screen.queryByText(/Aligned with repeat:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Watch:/i)).not.toBeInTheDocument();
  });

  it("gives a strong scout-supported action-plan candidate a meaningful priority lift over a weaker comparable candidate", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-match-1",
            match: {
              id: "saved-match-1",
              audienceItemId: "aud-1",
              solutionItemId: "sol-1",
              matchedPain: "Broken handoffs after launch",
              matchedSolutionPattern: "Visibility and coordination pattern",
              whyThisMatchWorks: "The solution addresses the same ownership gap.",
              suggestedAngle: "workflow_accountability",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              scoreNotes: ["High keyword overlap"],
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/growth/rhythm") && method === "POST") {
        return jsonResponse(
          {
            topPostCandidates: [
              {
                id: "queue-weaker-1",
                title: "General workflow note",
                suggestedAction: "generate_post_candidate",
                priority: "medium",
                status: "queued",
                bestAngle: "workflow_accountability",
                reasoningSummary: "Broad workflow commentary."
              },
              {
                id: "queue-stronger-1",
                title: "Visibility and coordination pattern after launch",
                suggestedAction: "generate_post_candidate",
                priority: "medium",
                status: "queued",
                bestAngle: "workflow_accountability",
                reasoningSummary: "Broken handoffs after launch need clearer ownership."
              }
            ],
            topCommentCandidates: [],
            keepForLater: [],
            weeklyFocus: "Lead with workflow accountability after launch.",
            suggestedCadence: "2 post candidates, 0 engagement opportunities, 0 to revisit later.",
            reasoningSummary: "Comparable post candidates are available."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => expect(screen.getByText("Content Queue")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Build Action Plan" }));

    await waitFor(() => {
      expect(screen.getByText("Visibility and coordination pattern after launch")).toBeInTheDocument();
      expect(screen.getByText("General workflow note")).toBeInTheDocument();
    });

    const postSection = screen.getByText("Top post candidates").closest("div");
    expect(postSection).not.toBeNull();
    const sectionText = (postSection as HTMLElement).textContent ?? "";
    expect(sectionText.indexOf("Visibility and coordination pattern after launch")).toBeLessThan(
      sectionText.indexOf("General workflow note")
    );
  });

  it("does not let weak scout support hijack stronger non-scout action-plan ordering", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-match-weak-1",
            match: {
              id: "saved-match-weak-1",
              audienceItemId: "aud-1",
              solutionItemId: "sol-1",
              matchedPain: "General workflow note",
              matchedSolutionPattern: "Generic coordination idea",
              whyThisMatchWorks: "Broad fit only.",
              suggestedAngle: "workflow_accountability",
              recommendedAction: "write_post",
              confidence: "medium",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/growth/rhythm") && method === "POST") {
        return jsonResponse(
          {
            topPostCandidates: [
              {
                id: "queue-high-1",
                title: "High priority baseline candidate",
                suggestedAction: "generate_post_candidate",
                priority: "high",
                status: "queued",
                bestAngle: "workflow_accountability",
                reasoningSummary: "Clear high-priority post candidate."
              },
              {
                id: "queue-weak-1",
                title: "General workflow note",
                suggestedAction: "generate_post_candidate",
                priority: "medium",
                status: "queued",
                bestAngle: "workflow_accountability",
                reasoningSummary: "Broad workflow commentary."
              }
            ],
            topCommentCandidates: [],
            keepForLater: [],
            weeklyFocus: "Lead with the clearer high-priority post candidate.",
            suggestedCadence: "2 post candidates, 0 engagement opportunities, 0 to revisit later.",
            reasoningSummary: "A clear high-priority post candidate is already visible."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => expect(screen.getByText("Content Queue")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Build Action Plan" }));

    await waitFor(() => {
      expect(screen.getByText("High priority baseline candidate")).toBeInTheDocument();
      expect(screen.getAllByText("General workflow note").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Reviewed scout match").length).toBeGreaterThan(0);
    });

    const postSection = screen.getByText("Top post candidates").closest("div");
    expect(postSection).not.toBeNull();
    const sectionText = (postSection as HTMLElement).textContent ?? "";
    expect(sectionText.indexOf("High priority baseline candidate")).toBeLessThan(
      sectionText.indexOf("General workflow note")
    );
  });

  it("shows scout-aware reinforcement on an action-plan candidate when a strong matched opportunity aligns", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/audience/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "aud-1",
                sourcePlatform: "public_web",
                rawExcerpt: "We still lose workflow ownership after launch and support gets the cleanup.",
                painSignalSummary: "Operators are flagging broken handoffs after launch.",
                whyItMatters: "This shows workflow-accountability pain in live operations.",
                suggestedActionType: "post_candidate",
                topicCluster: "Broken Handoff",
                confidence: "high",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 audience signal shortlisted.",
            notes: "Audience Scout is review-first."
          },
          201
        );
      }

      if (url.endsWith("/solutions/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "sol-1",
                sourceType: "github",
                rawExcerpt: "Expose status and ownership before stalled work turns into support cleanup.",
                solutionPattern: "Visibility and coordination pattern",
                implementationLesson:
                  "Expose status and ownership early so operators can intervene before work stalls.",
                tradeoffOrConstraint: "Visibility adds coordination overhead if ownership is still vague.",
                whyItMatters: "Useful operator lesson.",
                suggestedAngle: "workflow_accountability",
                suggestedActionType: "post_candidate",
                confidence: "high",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 solution pattern shortlisted for review.",
            notes: "Solution Scout is review-first."
          },
          201
        );
      }

      if (url.endsWith("/scout/match") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "match-1",
                audienceItemId: "aud-1",
                solutionItemId: "sol-1",
                matchedPain: "Operators are flagging broken handoffs after launch.",
                matchedSolutionPattern: "Visibility and coordination pattern",
                whyThisMatchWorks:
                  "Visibility and coordination pattern addresses the ownership gap behind broken handoffs after launch.",
                suggestedAngle: "workflow_accountability",
                recommendedAction: "write_post",
                confidence: "high",
                opportunityStrength: "strong",
                scoreNotes: [
                  "High keyword overlap",
                  "Shared operational theme"
                ],
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 matched pain-to-solution opportunities shortlisted.",
            notes: "Scout matches stay review-first."
          },
          201
        );
      }

      if (url.endsWith("/growth/rhythm") && method === "POST") {
        return jsonResponse(
          {
            topPostCandidates: [
              {
                id: "queue-1",
                title: "Workflow accountability after launch",
                suggestedAction: "write_post",
                priority: "high",
                status: "queued",
                bestAngle: "workflow_accountability",
                reasoningSummary: "Broken handoffs keep surfacing after rollout."
              }
            ],
            topCommentCandidates: [],
            keepForLater: [],
            weeklyFocus: "Lead with workflow accountability after launch.",
            suggestedCadence: "1 post candidate, 0 engagement opportunities, 0 to revisit later.",
            reasoningSummary: "A clear post candidate is already visible."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Audience Scout")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Target topics"), "workflow chaos");
    await user.click(screen.getByRole("button", { name: "Run Audience Scout" }));
    await waitFor(() =>
      expect(
        screen.getAllByText("Operators are flagging broken handoffs after launch.").length
      ).toBeGreaterThan(0)
    );

    await user.type(
      screen.getByLabelText("Solution source excerpt"),
      "Expose status and ownership before stalled work turns into support cleanup."
    );
    await user.click(screen.getByRole("button", { name: "Run Solution Scout" }));
    await waitFor(() =>
      expect(screen.getByText("Visibility and coordination pattern")).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Build Scout Matches" }));
    await waitFor(() =>
      expect(screen.getByText("1 matched pain-to-solution opportunities shortlisted.")).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Build Action Plan" }));

    await waitFor(() => {
      expect(screen.getByText("Workflow accountability after launch")).toBeInTheDocument();
      expect(screen.getByText("Pain + solution match")).toBeInTheDocument();
      expect(screen.getByText("Scout support: Visibility and coordination pattern")).toBeInTheDocument();
      expect(screen.getAllByText("Strong").length).toBeGreaterThan(0);
    });

    const scoutSupportNote = screen.getByText("Scout support: Visibility and coordination pattern");
    const scoutSupportSection = scoutSupportNote.parentElement;
    expect(scoutSupportSection).not.toBeNull();
    expect(within(scoutSupportSection as HTMLElement).getByText("Direct support")).toBeInTheDocument();
    expect(within(scoutSupportSection as HTMLElement).getByText("Direct scout match")).toBeInTheDocument();
    expect(
      within(scoutSupportSection as HTMLElement).queryByText(
        "Backed by current and reviewed scout evidence"
      )
    ).not.toBeInTheDocument();
    expect(
      within(scoutSupportSection as HTMLElement).getByText("Why this scored well: High keyword overlap")
    ).toBeInTheDocument();
    expect(
      within(scoutSupportSection as HTMLElement).queryByText(
        "Why this scored well: Shared operational theme"
      )
    ).not.toBeInTheDocument();
  });

  it("shows reviewed scout support on an aligned action-plan candidate", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-match-1",
            match: {
              id: "match-1",
              audienceItemId: "aud-1",
              solutionItemId: "sol-1",
              matchedPain: "Operators are flagging broken handoffs after launch.",
              matchedSolutionPattern: "Visibility and coordination pattern",
              whyThisMatchWorks: "The solution addresses the same ownership gap.",
              suggestedAngle: "workflow_accountability",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              scoreNotes: [
                "High keyword overlap",
                "Shared operational theme"
              ],
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/growth/rhythm") && method === "POST") {
        return jsonResponse(
          {
            topPostCandidates: [
              {
                id: "queue-1",
                title: "Workflow accountability after launch",
                suggestedAction: "write_post",
                priority: "high",
                status: "queued",
                bestAngle: "workflow_accountability",
                reasoningSummary: "Broken handoffs keep surfacing after rollout."
              }
            ],
            topCommentCandidates: [],
            keepForLater: [],
            weeklyFocus: "Lead with workflow accountability after launch.",
            suggestedCadence: "1 post candidate, 0 engagement opportunities, 0 to revisit later.",
            reasoningSummary: "A clear post candidate is already visible."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Saved Matches")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Mark reviewed" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Build Action Plan" }));

    await waitFor(() => {
      expect(screen.getByText("Workflow accountability after launch")).toBeInTheDocument();
      expect(screen.getByText("Reviewed scout match")).toBeInTheDocument();
      expect(screen.getByText("Scout support: Visibility and coordination pattern")).toBeInTheDocument();
      expect(screen.getAllByText("Strong").length).toBeGreaterThan(0);
    });

    const scoutSupportNote = screen.getByText("Scout support: Visibility and coordination pattern");
    const scoutSupportSection = scoutSupportNote.parentElement;
    expect(scoutSupportSection).not.toBeNull();
    expect(within(scoutSupportSection as HTMLElement).getByText("Reviewed support")).toBeInTheDocument();
    expect(within(scoutSupportSection as HTMLElement).getByText("Reviewed saved match")).toBeInTheDocument();
    expect(
      within(scoutSupportSection as HTMLElement).queryByText(
        "Backed by current and reviewed scout evidence"
      )
    ).not.toBeInTheDocument();
    expect(
      within(scoutSupportSection as HTMLElement).getByText("Why this scored well: High keyword overlap")
    ).toBeInTheDocument();
    expect(
      within(scoutSupportSection as HTMLElement).queryByText(
        "Why this scored well: Shared operational theme"
      )
    ).not.toBeInTheDocument();
    expect(
      within(scoutSupportSection as HTMLElement).getByText("Scout-priority lift")
    ).toBeInTheDocument();
    expect(
      within(scoutSupportSection as HTMLElement).getByText("Lifted by reviewed scout support")
    ).toBeInTheDocument();
  });

  it("keeps action-plan scout support compact when strength metadata is missing", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-match-1",
            match: {
              id: "match-1",
              audienceItemId: "aud-1",
              solutionItemId: "sol-1",
              matchedPain: "Operators are flagging broken handoffs after launch.",
              matchedSolutionPattern: "Visibility and coordination pattern",
              whyThisMatchWorks: "The solution addresses the same ownership gap.",
              suggestedAngle: "workflow_accountability",
              recommendedAction: "write_post",
              confidence: "high",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/growth/rhythm") && method === "POST") {
        return jsonResponse(
          {
            topPostCandidates: [
              {
                id: "queue-1",
                title: "Workflow accountability after launch",
                suggestedAction: "write_post",
                priority: "high",
                status: "queued",
                bestAngle: "workflow_accountability",
                reasoningSummary: "Broken handoffs keep surfacing after rollout."
              }
            ],
            topCommentCandidates: [],
            keepForLater: [],
            weeklyFocus: "Lead with workflow accountability after launch.",
            suggestedCadence: "1 post candidate, 0 engagement opportunities, 0 to revisit later.",
            reasoningSummary: "A clear post candidate is already visible."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Build Action Plan" }));

    await waitFor(() => {
      expect(screen.getByText("Workflow accountability after launch")).toBeInTheDocument();
      expect(screen.getByText("Reviewed scout match")).toBeInTheDocument();
      expect(screen.getByText("Scout support: Visibility and coordination pattern")).toBeInTheDocument();
    });

    const scoutSupportNote = screen.getByText("Scout support: Visibility and coordination pattern");
    const scoutSupportSection = scoutSupportNote.parentElement;
    expect(scoutSupportSection).not.toBeNull();
    expect(within(scoutSupportSection as HTMLElement).queryByText("Direct support")).not.toBeInTheDocument();
    expect(within(scoutSupportSection as HTMLElement).queryByText("Reviewed support")).not.toBeInTheDocument();
    expect(within(scoutSupportSection as HTMLElement).queryByText("Mixed support")).not.toBeInTheDocument();
    expect(
      within(scoutSupportSection as HTMLElement).queryByText(
        "Backed by current and reviewed scout evidence"
      )
    ).not.toBeInTheDocument();
    expect(within(scoutSupportSection as HTMLElement).queryByText("Strong")).not.toBeInTheDocument();
    expect(within(scoutSupportSection as HTMLElement).queryByText("Medium")).not.toBeInTheDocument();
    expect(within(scoutSupportSection as HTMLElement).getByText("Reviewed saved match")).toBeInTheDocument();
    expect(
      within(scoutSupportSection as HTMLElement).queryByText(/Why this scored well:/i)
    ).not.toBeInTheDocument();
  });

  it("keeps weak scout context quiet inside the action plan", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-match-1",
            match: {
              id: "match-1",
              audienceItemId: "aud-1",
              solutionItemId: "sol-1",
              matchedPain: "Operators are flagging broken handoffs after launch.",
              matchedSolutionPattern: "Visibility and coordination pattern",
              whyThisMatchWorks: "The solution addresses the same ownership gap.",
              suggestedAngle: "workflow_accountability",
              recommendedAction: "write_post",
              confidence: "low",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/growth/rhythm") && method === "POST") {
        return jsonResponse(
          {
            topPostCandidates: [
              {
                id: "queue-1",
                title: "Workflow accountability after launch",
                suggestedAction: "write_post",
                priority: "high",
                status: "queued",
                bestAngle: "workflow_accountability",
                reasoningSummary: "Broken handoffs keep surfacing after rollout."
              }
            ],
            topCommentCandidates: [],
            keepForLater: [],
            weeklyFocus: "Lead with workflow accountability after launch.",
            suggestedCadence: "1 post candidate, 0 engagement opportunities, 0 to revisit later.",
            reasoningSummary: "A clear post candidate is already visible."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Saved Matches")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Build Action Plan" }));

    await waitFor(() => {
      expect(screen.getByText("Workflow accountability after launch")).toBeInTheDocument();
    });

    expect(screen.queryByText("Pain + solution match")).not.toBeInTheDocument();
    expect(screen.queryByText("Reviewed scout match")).not.toBeInTheDocument();
    expect(screen.queryByText("Scout-supported")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Scout support: Visibility and coordination pattern")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Direct support")).not.toBeInTheDocument();
    expect(screen.queryByText("Reviewed support")).not.toBeInTheDocument();
    expect(screen.queryByText("Mixed support")).not.toBeInTheDocument();
    expect(screen.queryByText("Backed by current and reviewed scout evidence")).not.toBeInTheDocument();
  });

  it("shows mixed scout support on an aligned action-plan candidate when direct and reviewed matches both back it", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-match-1",
            match: {
              id: "saved-match-1",
              audienceItemId: "aud-1",
              solutionItemId: "sol-1",
              matchedPain: "Operators are flagging broken handoffs after launch.",
              matchedSolutionPattern: "Visibility and coordination pattern",
              whyThisMatchWorks: "The solution addresses the same ownership gap.",
              suggestedAngle: "workflow_accountability",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              scoreNotes: ["High keyword overlap"],
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/audience/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "aud-1",
                sourcePlatform: "public_web",
                rawExcerpt: "We still lose workflow ownership after launch and support gets the cleanup.",
                painSignalSummary: "Operators are flagging broken handoffs after launch.",
                whyItMatters: "This shows workflow-accountability pain in live operations.",
                suggestedActionType: "post_candidate",
                topicCluster: "Broken Handoff",
                confidence: "high",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 audience signal shortlisted.",
            notes: "Audience Scout is review-first."
          },
          201
        );
      }

      if (url.endsWith("/solutions/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "sol-1",
                sourceType: "github",
                rawExcerpt: "Expose status and ownership before stalled work turns into support cleanup.",
                solutionPattern: "Visibility and coordination pattern",
                implementationLesson:
                  "Expose status and ownership early so operators can intervene before work stalls.",
                tradeoffOrConstraint: "Visibility adds coordination overhead if ownership is still vague.",
                whyItMatters: "Useful operator lesson.",
                suggestedAngle: "workflow_accountability",
                suggestedActionType: "post_candidate",
                confidence: "high",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 solution pattern shortlisted for review.",
            notes: "Solution Scout is review-first."
          },
          201
        );
      }

      if (url.endsWith("/scout/match") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "direct-match-1",
                audienceItemId: "aud-1",
                solutionItemId: "sol-1",
                matchedPain: "Operators are flagging broken handoffs after launch.",
                matchedSolutionPattern: "Visibility and coordination pattern",
                whyThisMatchWorks: "The solution addresses the same ownership gap.",
                suggestedAngle: "workflow_accountability",
                recommendedAction: "write_post",
                confidence: "high",
                opportunityStrength: "strong",
                scoreNotes: ["High keyword overlap"],
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 matched pain-to-solution opportunities shortlisted.",
            notes: "Scout matches stay review-first."
          },
          201
        );
      }

      if (url.endsWith("/growth/rhythm") && method === "POST") {
        return jsonResponse(
          {
            topPostCandidates: [
              {
                id: "queue-1",
                title: "Workflow accountability after launch",
                suggestedAction: "write_post",
                priority: "high",
                status: "queued",
                bestAngle: "workflow_accountability",
                reasoningSummary: "Broken handoffs keep surfacing after rollout."
              }
            ],
            topCommentCandidates: [],
            keepForLater: [],
            weeklyFocus: "Lead with workflow accountability after launch.",
            suggestedCadence: "1 post candidate, 0 engagement opportunities, 0 to revisit later.",
            reasoningSummary: "A clear post candidate is already visible."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Audience Scout")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Target topics"), "workflow chaos");
    await user.click(screen.getByRole("button", { name: "Run Audience Scout" }));
    await waitFor(() =>
      expect(
        screen.getAllByText("Operators are flagging broken handoffs after launch.").length
      ).toBeGreaterThan(0)
    );
    await user.type(
      screen.getByLabelText("Solution source excerpt"),
      "Expose status and ownership before stalled work turns into support cleanup."
    );
    await user.click(screen.getByRole("button", { name: "Run Solution Scout" }));
    await waitFor(() =>
      expect(screen.getByText("Visibility and coordination pattern")).toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: "Build Scout Matches" }));
    await waitFor(() =>
      expect(screen.getByText("1 matched pain-to-solution opportunities shortlisted.")).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Build Action Plan" }));

    await waitFor(() => {
      expect(screen.getByText("Workflow accountability after launch")).toBeInTheDocument();
      expect(screen.getByText("Pain + solution match")).toBeInTheDocument();
      expect(screen.getByText("Scout support: Visibility and coordination pattern")).toBeInTheDocument();
    });

    const scoutSupportNote = screen.getByText("Scout support: Visibility and coordination pattern");
    const scoutSupportSection = scoutSupportNote.parentElement;
    expect(scoutSupportSection).not.toBeNull();
    expect(within(scoutSupportSection as HTMLElement).getByText("Mixed support")).toBeInTheDocument();
    expect(within(scoutSupportSection as HTMLElement).getByText("Direct scout match")).toBeInTheDocument();
    expect(
      within(scoutSupportSection as HTMLElement).getByText(
        "Backed by current and reviewed scout evidence"
      )
    ).toBeInTheDocument();
    expect(
      within(scoutSupportSection as HTMLElement).getByText("Strong corroborated support")
    ).toBeInTheDocument();
    expect(
      within(scoutSupportSection as HTMLElement).getByText(
        "Lifted by corroborated direct + reviewed support"
      )
    ).toBeInTheDocument();
  });

  it("shows a scout-priority lift hint on an action-plan candidate when prioritization bias is meaningful", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/audience/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "aud-1",
                sourcePlatform: "public_web",
                rawExcerpt: "Operators lose workflow ownership after launch and support inherits the cleanup.",
                painSignalSummary: "Operators are flagging broken handoffs after launch.",
                whyItMatters: "This shows workflow-accountability pain in live operations.",
                suggestedActionType: "post_candidate",
                topicCluster: "Broken Handoff",
                confidence: "high",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 audience signal shortlisted.",
            notes: "Audience Scout is review-first."
          },
          201
        );
      }

      if (url.endsWith("/solutions/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "sol-1",
                sourceType: "github",
                rawExcerpt: "Expose status and ownership before stalled work turns into support cleanup.",
                solutionPattern: "Visibility and coordination pattern",
                implementationLesson:
                  "Expose status and ownership early so operators can intervene before work stalls.",
                tradeoffOrConstraint: "Visibility adds coordination overhead if ownership is still vague.",
                whyItMatters: "Useful operator lesson.",
                suggestedAngle: "workflow_accountability",
                suggestedActionType: "post_candidate",
                confidence: "high",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 solution pattern shortlisted for review.",
            notes: "Solution Scout is review-first."
          },
          201
        );
      }

      if (url.endsWith("/scout/match") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "match-1",
                audienceItemId: "aud-1",
                solutionItemId: "sol-1",
                matchedPain: "Operators are flagging broken handoffs after launch.",
                matchedSolutionPattern: "Visibility and coordination pattern",
                whyThisMatchWorks:
                  "Visibility and coordination pattern addresses the ownership gap behind broken handoffs after launch.",
                suggestedAngle: "workflow_accountability",
                recommendedAction: "write_post",
                confidence: "high",
                opportunityStrength: "strong",
                scoreNotes: ["High keyword overlap"],
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 matched pain-to-solution opportunities shortlisted.",
            notes: "Scout matches stay review-first."
          },
          201
        );
      }

      if (url.endsWith("/growth/rhythm") && method === "POST") {
        return jsonResponse(
          {
            topPostCandidates: [
              {
                id: "queue-1",
                title: "Workflow accountability after launch",
                suggestedAction: "write_post",
                priority: "high",
                status: "queued",
                bestAngle: "workflow_accountability",
                reasoningSummary: "Broken handoffs keep surfacing after rollout."
              }
            ],
            topCommentCandidates: [],
            keepForLater: [],
            weeklyFocus: "Lead with workflow accountability after launch.",
            suggestedCadence: "1 post candidate, 0 engagement opportunities, 0 to revisit later.",
            reasoningSummary: "A clear post candidate is already visible."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Audience Scout")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Target topics"), "workflow chaos");
    await user.click(screen.getByRole("button", { name: "Run Audience Scout" }));
    await waitFor(() =>
      expect(
        screen.getAllByText("Operators are flagging broken handoffs after launch.").length
      ).toBeGreaterThan(0)
    );
    await user.type(
      screen.getByLabelText("Solution source excerpt"),
      "Expose status and ownership before stalled work turns into support cleanup."
    );
    await user.click(screen.getByRole("button", { name: "Run Solution Scout" }));
    await waitFor(() =>
      expect(screen.getByText("Visibility and coordination pattern")).toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: "Build Scout Matches" }));
    await waitFor(() =>
      expect(screen.getByText("1 matched pain-to-solution opportunities shortlisted.")).toBeInTheDocument()
    );

    await user.click(screen.getByRole("button", { name: "Build Action Plan" }));

    await waitFor(() => {
      expect(screen.getByText("Workflow accountability after launch")).toBeInTheDocument();
      expect(screen.getByText("Scout-priority lift")).toBeInTheDocument();
      expect(screen.getByText("Lifted by strong direct scout support")).toBeInTheDocument();
    });
  });

  it("saves manual feedback for a final post and reloads it safely", async () => {
    const contentAssets: ContentAsset[] = [
      {
        id: "content-1",
        ideaId: "idea-1",
        contentType: "linkedin-post",
        hook: "Draft hook",
        body: "Draft body",
        cta: "Draft cta",
        status: "draft",
        refinedHook: "Refined hook",
        refinedBody: "Refined body",
        refinedCta: "Refined cta",
        refinementStatus: "refined",
        finalHook: "A sharper final hook",
        finalBody: "First paragraph.\n\nSecond paragraph.",
        finalClosing: "What are you seeing?",
        finalStatus: "ready",
        finalQualityScore: 92,
        createdAt: "2026-03-14T00:00:00.000Z"
      }
    ];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse(contentAssets);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    const view = render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Legacy Final Post")).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Feedback status content-1"), "posted");
    await user.selectOptions(screen.getByLabelText("Feedback response content-1"), "strong");
    await user.click(screen.getByLabelText("Feedback repeat topic content-1"));
    await user.click(screen.getByRole("button", { name: "Save feedback content-1" }));

    const stored = window.localStorage.getItem("linkedin-brand-os:manual-feedback");
    expect(stored).toContain("\"artifactType\":\"final_post\"");
    expect(stored).toContain("\"artifactId\":\"content-1\"");

    view.unmount();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByLabelText("Feedback status content-1")).toHaveValue("posted");
    });
    expect(screen.getByLabelText("Feedback response content-1")).toHaveValue("strong");
    expect(screen.getByLabelText("Feedback repeat topic content-1")).toBeChecked();
  });

  it("saves manual feedback for a generated comment", async () => {
    let generatedComment = "";

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      if (url.endsWith("/comments/generate") && method === "POST") {
        generatedComment = "This is a grounded operator comment.";
        return jsonResponse({
          text: generatedComment,
          mode: "deterministic"
        });
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Comment Writer")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Source post text"), "A post about broken rollout ownership.");
    await user.click(screen.getByRole("button", { name: "Generate Comment" }));

    await waitFor(() => {
      expect(screen.getByText(generatedComment)).toBeInTheDocument();
    });

    await user.selectOptions(
      screen.getByLabelText("Feedback response generated-comment-latest"),
      "medium"
    );
    await user.click(screen.getByLabelText("Feedback got replies generated-comment-latest"));
    await user.click(screen.getByRole("button", { name: "Save feedback generated-comment-latest" }));

    const stored = window.localStorage.getItem("linkedin-brand-os:manual-feedback");
    expect(stored).toContain("\"artifactType\":\"comment\"");
    expect(stored).toContain("\"artifactId\":\"generated-comment-latest\"");
  });

  it("saves manual feedback for a generated reply", async () => {
    let generatedReply = "";

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      if (url.endsWith("/replies/generate") && method === "POST") {
        generatedReply = "That tracks. The workflow owner usually shows up in the exceptions.";
        return jsonResponse({
          text: generatedReply,
          mode: "deterministic"
        });
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Reply Writer")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Our post text"), "Our post on rollout failure.");
    await user.type(screen.getByLabelText("Incoming comment text"), "We saw this in support.");
    await user.click(screen.getByRole("button", { name: "Generate Reply" }));

    await waitFor(() => {
      expect(screen.getByText(generatedReply)).toBeInTheDocument();
    });

    await user.selectOptions(
      screen.getByLabelText("Feedback status generated-reply-latest"),
      "used"
    );
    await user.click(screen.getByLabelText("Feedback got lead signal generated-reply-latest"));
    await user.click(screen.getByRole("button", { name: "Save feedback generated-reply-latest" }));

    const stored = window.localStorage.getItem("linkedin-brand-os:manual-feedback");
    expect(stored).toContain("\"artifactType\":\"reply\"");
    expect(stored).toContain("\"artifactId\":\"generated-reply-latest\"");
  });

  it("surfaces a deterministic feedback summary inside Growth Rhythm", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:manual-feedback",
      JSON.stringify([
        {
          id: "final_post:content-1",
          artifactType: "final_post",
          artifactId: "content-1",
          status: "posted",
          responseLevel: "strong",
          gotLeadSignal: true,
          repeatTopic: true,
          createdAt: "2026-03-14T00:00:00.000Z"
        },
        {
          id: "comment:generated-comment-latest",
          artifactType: "comment",
          artifactId: "generated-comment-latest",
          status: "used",
          responseLevel: "weak",
          createdAt: "2026-03-14T01:00:00.000Z"
        }
      ])
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      if (url.endsWith("/growth/rhythm") && method === "POST") {
        return jsonResponse(
          {
            topPostCandidates: [],
            topCommentCandidates: [],
            keepForLater: [],
            weeklyFocus: "Keep next week focused.",
            suggestedCadence: "1 post candidate, 1 engagement opportunity, 0 to revisit later.",
            reasoningSummary: "Base rhythm guidance."
          },
          201
        );
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Content Queue")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Build Action Plan" }));

    await waitFor(() => {
      expect(screen.getByText("Feedback loop")).toBeInTheDocument();
      expect(screen.getByText(/What seems to work:/i)).toBeInTheDocument();
      expect(screen.getByText(/What seems weaker:/i)).toBeInTheDocument();
      expect(screen.getByText(/What to repeat next week:/i)).toBeInTheDocument();
    });
  });

  it("reloads persisted pattern memory safely and renders it inside Growth Rhythm", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:pattern-memory",
      JSON.stringify({
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
        recurringThemes: ["repeat-worthy topics"],
        weakThemes: ["generic engagement"],
        notes:
          "Long-term memory is reinforcing repeat-worthy topics while cautioning on generic engagement.",
        totalPatterns: 2
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      if (url.endsWith("/growth/rhythm") && method === "POST") {
        return jsonResponse(
          {
            topPostCandidates: [],
            topCommentCandidates: [],
            keepForLater: [],
            weeklyFocus: "Keep next week focused.",
            suggestedCadence: "1 post candidate, 1 engagement opportunity, 0 to revisit later.",
            reasoningSummary: "Base rhythm guidance."
          },
          201
        );
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Content Queue")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Build Action Plan" }));

    await waitFor(() => {
      expect(screen.getAllByText("Pattern memory").length).toBeGreaterThan(0);
      expect(screen.getAllByText(/repeat-worthy topics/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/generic engagement/i).length).toBeGreaterThan(0);
    });
  });

  it("includes feedbackSummary in the strategy analyze request and renders feedback-aware guidance", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:manual-feedback",
      JSON.stringify([
        {
          id: "final_post:content-1",
          artifactType: "final_post",
          artifactId: "content-1",
          status: "posted",
          responseLevel: "strong",
          repeatTopic: true,
          createdAt: "2026-03-14T00:00:00.000Z"
        }
      ])
    );

    let strategyPayload: Record<string, unknown> | null = null;

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      if (url.endsWith("/strategy/analyze") && method === "POST") {
        strategyPayload = JSON.parse(String(init?.body));
        return jsonResponse([
          {
            id: "strategy-1",
            type: "messaging",
            title: "Repeat the strongest operator themes",
            description: "Recent feedback suggests workflow accountability angles are worth repeating.",
            priority: "high",
            createdAt: "2026-03-14T00:00:00.000Z"
          }
        ]);
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Strategy Recommendations")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Analyze Strategy" }));

    await waitFor(() => {
      expect(strategyPayload).not.toBeNull();
      expect(screen.getByText("Repeat the strongest operator themes")).toBeInTheDocument();
    });

    expect(strategyPayload).toEqual(
      expect.objectContaining({
        feedbackSummary: expect.objectContaining({
          totalRecords: 1
        }),
        patternMemorySummary: expect.objectContaining({
          recurringThemes: expect.any(Array),
          totalPatterns: expect.any(Number)
        })
      })
    );
    expect(
      screen.getByText(/workflow accountability angles are worth repeating/i)
    ).toBeInTheDocument();
  });

  it("renders compact memory-aware badges on strategy recommendations when long-term memory guidance exists", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:pattern-memory",
      JSON.stringify({
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
        notes: "Long-term memory is reinforcing final posts while cautioning on generic engagement.",
        totalPatterns: 2
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      if (url.endsWith("/strategy/analyze") && method === "POST") {
        return jsonResponse([
          {
            id: "strategy-1",
            type: "messaging",
            title: "Reinforce recurring long-term themes",
            description: "Long-term memory keeps reinforcing these themes: final posts.",
            priority: "medium",
            createdAt: "2026-03-14T00:00:00.000Z"
          },
          {
            id: "strategy-2",
            type: "cadence",
            title: "Keep recurring weak themes deprioritized",
            description: "Long-term memory keeps flagging these patterns as weak: generic engagement.",
            priority: "medium",
            createdAt: "2026-03-14T00:00:00.000Z"
          }
        ]);
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Strategy Recommendations")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Analyze Strategy" }));

    await waitFor(() => {
      expect(screen.getAllByText("Long-term repeat").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Recurring weak pattern").length).toBeGreaterThan(0);
    });
  });

  it("surfaces shared feedback-aware theme tags across queue, strategy, and growth rhythm", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:manual-feedback",
      JSON.stringify([
        {
          id: "final_post:content-1",
          artifactType: "final_post",
          artifactId: "content-1",
          status: "posted",
          responseLevel: "strong",
          repeatTopic: true,
          createdAt: "2026-03-14T00:00:00.000Z"
        },
        {
          id: "comment:generated-comment-latest",
          artifactType: "comment",
          artifactId: "generated-comment-latest",
          status: "used",
          responseLevel: "weak",
          createdAt: "2026-03-14T01:00:00.000Z"
        }
      ])
    );
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-1",
          signalText: "Keep this operator topic in the queue.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Worth keeping visible.",
          priority: "medium",
          recommendedAction: "save_for_later",
          status: "new",
          createdAt: "2026-03-14T00:00:00.000Z"
        }
      ])
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      if (url.endsWith("/growth/rhythm") && method === "POST") {
        return jsonResponse(
          {
            topPostCandidates: [],
            topCommentCandidates: [],
            keepForLater: [],
            weeklyFocus: "Keep next week focused.",
            suggestedCadence: "0 post candidates, 0 engagement opportunities, 0 to revisit later.",
            reasoningSummary: "Base rhythm guidance."
          },
          201
        );
      }

      if (url.endsWith("/strategy/analyze") && method === "POST") {
        return jsonResponse([
          {
            id: "strategy-1",
            type: "messaging",
            title: "Repeat the strongest operator themes",
            description: "Recent feedback suggests workflow accountability angles are worth repeating.",
            priority: "high",
            createdAt: "2026-03-14T00:00:00.000Z"
          }
        ]);
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Saved for later")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Analyze Strategy" }));
    await user.click(screen.getByRole("button", { name: "Build Action Plan" }));

    await waitFor(() => {
      expect(screen.getAllByText(/repeat: final posts/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/repeat: operator execution/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/avoid: comments/i).length).toBeGreaterThan(0);
    });
  });

  it("includes feedbackSummary in the Growth Rhythm request when feedback exists", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:manual-feedback",
      JSON.stringify([
        {
          id: "final_post:content-1",
          artifactType: "final_post",
          artifactId: "content-1",
          status: "posted",
          responseLevel: "strong",
          repeatTopic: true,
          createdAt: "2026-03-14T00:00:00.000Z"
        }
      ])
    );

    let growthPayload: Record<string, unknown> | null = null;

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      if (url.endsWith("/growth/rhythm") && method === "POST") {
        growthPayload = JSON.parse(String(init?.body));
        return jsonResponse(
          {
            topPostCandidates: [],
            topCommentCandidates: [],
            keepForLater: [],
            weeklyFocus: "Keep next week focused.",
            suggestedCadence: "0 post candidates, 0 engagement opportunities, 0 to revisit later.",
            reasoningSummary: "Base rhythm guidance."
          },
          201
        );
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Content Queue")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Build Action Plan" }));

    await waitFor(() => {
      expect(growthPayload).not.toBeNull();
    });

    expect(growthPayload).toEqual(
      expect.objectContaining({
        feedbackSummary: expect.objectContaining({
          totalRecords: 1,
          suggestedRepeats: expect.any(Array)
        }),
        patternMemorySummary: expect.objectContaining({
          recurringThemes: expect.any(Array),
          totalPatterns: expect.any(Number)
        })
      })
    );
  });

  it("requests and renders an orchestrated next move from current planner, rhythm, strategy, feedback, and memory context", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:manual-feedback",
      JSON.stringify([
        {
          id: "final_post:content-1",
          artifactType: "final_post",
          artifactId: "content-1",
          status: "posted",
          responseLevel: "strong",
          repeatTopic: true,
          createdAt: "2026-03-14T00:00:00.000Z"
        }
      ])
    );
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-match-1",
            match: {
              id: "match-1",
              audienceItemId: "aud-1",
              solutionItemId: "sol-1",
              matchedPain: "Operators are flagging broken handoffs after launch.",
              matchedSolutionPattern: "Visibility and coordination pattern",
              whyThisMatchWorks: "The solution addresses the same ownership gap.",
              suggestedAngle: "workflow_accountability",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              scoreNotes: [
                "High keyword overlap",
                "Shared operational theme"
              ],
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    let orchestratorPayload: Record<string, unknown> | null = null;

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      if (url.endsWith("/orchestrator/recommend") && method === "POST") {
        orchestratorPayload = JSON.parse(String(init?.body));
        return jsonResponse({
          recommendedAction: "write_post",
          recommendationReason:
            "Write a post next because the strongest coordination signal still points toward publishable operator insight.",
          primaryTarget: "Workflow accountability after launch",
          supportingSignals: [
            "Decision Planner is already leaning post-first.",
            "LinkedIn Action Plan top post candidate: Workflow accountability after launch"
          ],
          scoutSupport: [
            "Saved scout match (reviewed): Visibility and coordination pattern"
          ],
          scoutInfluence: "moderate",
          confidence: "high",
          coordinationNotes: [
            "Use the strongest post and engagement patterns to shape next week's cadence.",
            "Long-term memory is reinforcing repeat-worthy topics."
          ]
        });
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Orchestrated Next Move")).toBeInTheDocument();
      expect(screen.getByText("Saved Matches")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(
        screen.getAllByText("Operators are flagging broken handoffs after launch.").length
      ).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: "Mark reviewed" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Recommend Next Move" }));

    await waitFor(() => {
      expect(orchestratorPayload).not.toBeNull();
      expect(screen.getByText("Workflow accountability after launch")).toBeInTheDocument();
      expect(screen.getAllByText("write_post").length).toBeGreaterThan(0);
    });

    expect(orchestratorPayload).toEqual(
      expect.objectContaining({
        feedbackSummary: expect.objectContaining({ totalRecords: 1 }),
        patternMemorySummary: expect.objectContaining({ totalPatterns: expect.any(Number) }),
        scoutOpportunityContext: expect.objectContaining({
          matchedOpportunities: [],
          savedMatches: [
            expect.objectContaining({
              status: "reviewed",
              match: expect.objectContaining({
                matchedSolutionPattern: "Visibility and coordination pattern"
              })
            })
          ]
        })
      })
    );
    expect(screen.getByText(/publishable operator insight/i)).toBeInTheDocument();
    expect(screen.getByText(/Decision Planner is already leaning post-first/i)).toBeInTheDocument();
    expect(screen.getByText(/Saved scout match \(reviewed\)/i)).toBeInTheDocument();
    const scoutSupportHeader = screen.getByText("Scout support").parentElement;
    expect(scoutSupportHeader).not.toBeNull();
    const scoutSupportSection = (scoutSupportHeader as HTMLElement).parentElement;
    expect(scoutSupportSection).not.toBeNull();
    await waitFor(() => {
      expect(within(scoutSupportHeader as HTMLElement).getByText("Strong")).toBeInTheDocument();
    });
    expect(within(scoutSupportSection as HTMLElement).getByText("Reviewed support")).toBeInTheDocument();
    expect(within(scoutSupportSection as HTMLElement).getByText("Reviewed saved match")).toBeInTheDocument();
    expect(
      within(scoutSupportSection as HTMLElement).queryByText(
        "Backed by current and reviewed scout evidence"
      )
    ).not.toBeInTheDocument();
    expect(
      within(scoutSupportSection as HTMLElement).getByText(
        "Why this scored well: High keyword overlap"
      )
    ).toBeInTheDocument();
    expect(
      within(scoutSupportSection as HTMLElement).queryByText(
        "Why this scored well: Shared operational theme"
      )
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Scout influence: moderate/i)).toBeInTheDocument();
  });

  it("keeps orchestrated scout support compact when strength metadata is missing", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-match-1",
            match: {
              id: "match-1",
              audienceItemId: "aud-1",
              solutionItemId: "sol-1",
              matchedPain: "Operators are flagging broken handoffs after launch.",
              matchedSolutionPattern: "Visibility and coordination pattern",
              whyThisMatchWorks: "The solution addresses the same ownership gap.",
              suggestedAngle: "workflow_accountability",
              recommendedAction: "write_post",
              confidence: "high",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      if (url.endsWith("/orchestrator/recommend") && method === "POST") {
        return jsonResponse({
          recommendedAction: "write_post",
          recommendationReason: "The strongest coordination signal still points toward a post.",
          primaryTarget: "Workflow accountability after launch",
          supportingSignals: ["Decision Planner is already leaning post-first."],
          scoutSupport: ["Saved scout match (reviewed): Visibility and coordination pattern"],
          scoutInfluence: "moderate",
          confidence: "high",
          coordinationNotes: []
        });
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => expect(screen.getByText("Orchestrated Next Move")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Recommend Next Move" }));

    await waitFor(() =>
      expect(screen.getByText("Saved scout match (reviewed): Visibility and coordination pattern")).toBeInTheDocument()
    );

    const scoutSupportSection = screen.getByText("Scout support").parentElement;
    expect(scoutSupportSection).not.toBeNull();
    expect(within(scoutSupportSection as HTMLElement).queryByText("Direct support")).not.toBeInTheDocument();
    expect(within(scoutSupportSection as HTMLElement).queryByText("Reviewed support")).not.toBeInTheDocument();
    expect(within(scoutSupportSection as HTMLElement).queryByText("Mixed support")).not.toBeInTheDocument();
    expect(
      within(scoutSupportSection as HTMLElement).queryByText(
        "Backed by current and reviewed scout evidence"
      )
    ).not.toBeInTheDocument();
    expect(within(scoutSupportSection as HTMLElement).queryByText("Strong")).not.toBeInTheDocument();
    expect(within(scoutSupportSection as HTMLElement).queryByText("Medium")).not.toBeInTheDocument();
    expect(
      within(scoutSupportSection as HTMLElement).queryByText("Direct scout match")
    ).not.toBeInTheDocument();
    expect(
      within(scoutSupportSection as HTMLElement).queryByText("Reviewed saved match")
    ).not.toBeInTheDocument();
    expect(
      within(scoutSupportSection as HTMLElement).queryByText(/Why this scored well:/i)
    ).not.toBeInTheDocument();
  });

  it("shows direct scout-match origin inside orchestrated scout support when current matches back the recommendation", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      if (url.endsWith("/audience/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "aud-1",
                sourcePlatform: "public_web",
                rawExcerpt: "We still lose workflow ownership after launch and support gets the cleanup.",
                painSignalSummary: "Operators are flagging broken handoffs after launch.",
                whyItMatters: "This shows workflow-accountability pain in live operations.",
                suggestedActionType: "post_candidate",
                topicCluster: "Broken Handoff",
                confidence: "high",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 audience signal shortlisted.",
            notes: "Audience Scout is review-first."
          },
          201
        );
      }

      if (url.endsWith("/solutions/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "sol-1",
                sourceType: "github",
                rawExcerpt: "Expose status and ownership before stalled work turns into support cleanup.",
                solutionPattern: "Visibility and coordination pattern",
                implementationLesson:
                  "Expose status and ownership early so operators can intervene before work stalls.",
                tradeoffOrConstraint: "Visibility adds coordination overhead if ownership is still vague.",
                whyItMatters: "Useful operator lesson.",
                suggestedAngle: "workflow_accountability",
                suggestedActionType: "post_candidate",
                confidence: "high",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 solution pattern shortlisted for review.",
            notes: "Solution Scout is review-first."
          },
          201
        );
      }

      if (url.endsWith("/scout/match") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "match-1",
                audienceItemId: "aud-1",
                solutionItemId: "sol-1",
                matchedPain: "Operators are flagging broken handoffs after launch.",
                matchedSolutionPattern: "Visibility and coordination pattern",
                whyThisMatchWorks: "The solution addresses the same ownership gap.",
                suggestedAngle: "workflow_accountability",
                recommendedAction: "write_post",
                confidence: "high",
                opportunityStrength: "strong",
                scoreNotes: ["High keyword overlap", "Shared operational theme"],
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 matched pain-to-solution opportunities shortlisted.",
            notes: "Scout matches stay review-first."
          },
          201
        );
      }

      if (url.endsWith("/orchestrator/recommend") && method === "POST") {
        return jsonResponse({
          recommendedAction: "write_post",
          recommendationReason: "Current scout evidence still points toward a post.",
          primaryTarget: "Workflow accountability after launch",
          supportingSignals: ["Decision Planner is already leaning post-first."],
          scoutSupport: ["Pain + solution match: Visibility and coordination pattern"],
          scoutInfluence: "moderate",
          confidence: "high",
          coordinationNotes: []
        });
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => expect(screen.getByText("Audience Scout")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Target topics"), "workflow chaos");
    await user.click(screen.getByRole("button", { name: "Run Audience Scout" }));
    await waitFor(() =>
      expect(
        screen.getAllByText("Operators are flagging broken handoffs after launch.").length
      ).toBeGreaterThan(0)
    );
    await user.type(
      screen.getByLabelText("Solution source excerpt"),
      "Expose status and ownership before stalled work turns into support cleanup."
    );
    await user.click(screen.getByRole("button", { name: "Run Solution Scout" }));
    await waitFor(() =>
      expect(screen.getByText("Visibility and coordination pattern")).toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: "Build Scout Matches" }));
    await waitFor(() =>
      expect(screen.getByText("1 matched pain-to-solution opportunities shortlisted.")).toBeInTheDocument()
    );

    await waitFor(() => expect(screen.getByText("Orchestrated Next Move")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Recommend Next Move" }));

    await waitFor(() =>
      expect(screen.getByText("Pain + solution match: Visibility and coordination pattern")).toBeInTheDocument()
    );

    const scoutSupportHeader = screen.getByText("Scout support").parentElement;
    expect(scoutSupportHeader).not.toBeNull();
    const scoutSupportSection = (scoutSupportHeader as HTMLElement).parentElement;
    expect(scoutSupportSection).not.toBeNull();
    expect(within(scoutSupportSection as HTMLElement).getByText("Direct support")).toBeInTheDocument();
    expect(within(scoutSupportSection as HTMLElement).getByText("Direct scout match")).toBeInTheDocument();
    expect(
      within(scoutSupportSection as HTMLElement).queryByText(
        "Backed by current and reviewed scout evidence"
      )
    ).not.toBeInTheDocument();
  });

  it("keeps orchestrated scout-support origin quiet when direct and reviewed support are tied", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-match-1",
            match: {
              id: "match-1",
              audienceItemId: "aud-1",
              solutionItemId: "sol-1",
              matchedPain: "Operators are flagging broken handoffs after launch.",
              matchedSolutionPattern: "Visibility and coordination pattern",
              whyThisMatchWorks: "The solution addresses the same ownership gap.",
              suggestedAngle: "workflow_accountability",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              scoreNotes: ["High keyword overlap"],
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      if (url.endsWith("/audience/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "aud-1",
                sourcePlatform: "public_web",
                rawExcerpt: "We still lose workflow ownership after launch and support gets the cleanup.",
                painSignalSummary: "Operators are flagging broken handoffs after launch.",
                whyItMatters: "This shows workflow-accountability pain in live operations.",
                suggestedActionType: "post_candidate",
                topicCluster: "Broken Handoff",
                confidence: "high",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 audience signal shortlisted.",
            notes: "Audience Scout is review-first."
          },
          201
        );
      }

      if (url.endsWith("/solutions/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "sol-1",
                sourceType: "github",
                rawExcerpt: "Expose status and ownership before stalled work turns into support cleanup.",
                solutionPattern: "Visibility and coordination pattern",
                implementationLesson:
                  "Expose status and ownership early so operators can intervene before work stalls.",
                tradeoffOrConstraint: "Visibility adds coordination overhead if ownership is still vague.",
                whyItMatters: "Useful operator lesson.",
                suggestedAngle: "workflow_accountability",
                suggestedActionType: "post_candidate",
                confidence: "high",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 solution pattern shortlisted for review.",
            notes: "Solution Scout is review-first."
          },
          201
        );
      }

      if (url.endsWith("/scout/match") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "direct-match-1",
                audienceItemId: "aud-1",
                solutionItemId: "sol-1",
                matchedPain: "Operators are flagging broken handoffs after launch.",
                matchedSolutionPattern: "Visibility and coordination pattern",
                whyThisMatchWorks: "The solution addresses the same ownership gap.",
                suggestedAngle: "workflow_accountability",
                recommendedAction: "write_post",
                confidence: "high",
                opportunityStrength: "strong",
                scoreNotes: ["High keyword overlap"],
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 matched pain-to-solution opportunities shortlisted.",
            notes: "Scout matches stay review-first."
          },
          201
        );
      }

      if (url.endsWith("/orchestrator/recommend") && method === "POST") {
        return jsonResponse({
          recommendedAction: "write_post",
          recommendationReason: "Current scout evidence still points toward a post.",
          primaryTarget: "Workflow accountability after launch",
          supportingSignals: ["Decision Planner is already leaning post-first."],
          scoutSupport: ["Visibility and coordination pattern"],
          scoutInfluence: "moderate",
          confidence: "high",
          coordinationNotes: []
        });
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => expect(screen.getByText("Audience Scout")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Target topics"), "workflow chaos");
    await user.click(screen.getByRole("button", { name: "Run Audience Scout" }));
    await waitFor(() =>
      expect(
        screen.getAllByText("Operators are flagging broken handoffs after launch.").length
      ).toBeGreaterThan(0)
    );
    await user.type(
      screen.getByLabelText("Solution source excerpt"),
      "Expose status and ownership before stalled work turns into support cleanup."
    );
    await user.click(screen.getByRole("button", { name: "Run Solution Scout" }));
    await waitFor(() =>
      expect(screen.getByText("Visibility and coordination pattern")).toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: "Build Scout Matches" }));
    await waitFor(() =>
      expect(screen.getByText("1 matched pain-to-solution opportunities shortlisted.")).toBeInTheDocument()
    );

    await waitFor(() => expect(screen.getByText("Orchestrated Next Move")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Recommend Next Move" }));

    await waitFor(() =>
      expect(screen.getAllByText("Visibility and coordination pattern").length).toBeGreaterThan(0)
    );

    const scoutSupportHeader = screen.getByText("Scout support").parentElement;
    expect(scoutSupportHeader).not.toBeNull();
    const scoutSupportSection = (scoutSupportHeader as HTMLElement).parentElement;
    expect(scoutSupportSection).not.toBeNull();
    expect(within(scoutSupportSection as HTMLElement).getByText("Mixed support")).toBeInTheDocument();
    expect(
      within(scoutSupportSection as HTMLElement).getByText(
        "Backed by current and reviewed scout evidence"
      )
    ).toBeInTheDocument();
    expect(within(scoutSupportSection as HTMLElement).queryByText("Direct scout match")).not.toBeInTheDocument();
    expect(within(scoutSupportSection as HTMLElement).queryByText("Reviewed saved match")).not.toBeInTheDocument();
  });

  it("shows a prioritization lift hint in orchestrated next move when scout reinforcement is strong", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-match-lift-1",
            match: {
              id: "saved-match-lift-1",
              audienceItemId: "aud-1",
              solutionItemId: "sol-1",
              matchedPain: "Operators are flagging broken handoffs after launch.",
              matchedSolutionPattern: "Visibility and coordination pattern",
              whyThisMatchWorks: "The solution addresses the same ownership gap twice over.",
              suggestedAngle: "workflow_accountability",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              scoreNotes: ["High keyword overlap"],
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      if (url.endsWith("/audience/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "aud-1",
                sourcePlatform: "public_web",
                rawExcerpt: "We still lose workflow ownership after launch and support gets the cleanup.",
                painSignalSummary: "Operators are flagging broken handoffs after launch.",
                whyItMatters: "This shows workflow-accountability pain in live operations.",
                suggestedActionType: "post_candidate",
                topicCluster: "Broken Handoff",
                confidence: "high",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 audience signal shortlisted.",
            notes: "Audience Scout is review-first."
          },
          201
        );
      }

      if (url.endsWith("/solutions/scout") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "sol-1",
                sourceType: "github",
                rawExcerpt: "Expose status and ownership before stalled work turns into support cleanup.",
                solutionPattern: "Visibility and coordination pattern",
                implementationLesson:
                  "Expose status and ownership early so operators can intervene before work stalls.",
                tradeoffOrConstraint: "Visibility adds coordination overhead if ownership is still vague.",
                whyItMatters: "Useful operator lesson.",
                suggestedAngle: "workflow_accountability",
                suggestedActionType: "post_candidate",
                confidence: "high",
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 solution pattern shortlisted for review.",
            notes: "Solution Scout is review-first."
          },
          201
        );
      }

      if (url.endsWith("/scout/match") && method === "POST") {
        return jsonResponse(
          {
            items: [
              {
                id: "direct-match-lift-1",
                audienceItemId: "aud-1",
                solutionItemId: "sol-1",
                matchedPain: "Operators are flagging broken handoffs after launch.",
                matchedSolutionPattern: "Visibility and coordination pattern",
                whyThisMatchWorks: "The solution addresses the same ownership gap.",
                suggestedAngle: "workflow_accountability",
                recommendedAction: "write_post",
                confidence: "high",
                opportunityStrength: "strong",
                scoreNotes: ["High keyword overlap"],
                createdAt: "2026-03-15T00:00:00.000Z"
              }
            ],
            summary: "1 matched pain-to-solution opportunities shortlisted.",
            notes: "Scout matches stay review-first."
          },
          201
        );
      }

      if (url.endsWith("/orchestrator/recommend") && method === "POST") {
        return jsonResponse({
          recommendedAction: "write_post",
          recommendationReason: "Corroborated scout evidence keeps the post recommendation on top.",
          primaryTarget: "Workflow accountability after launch",
          supportingSignals: [
            "Decision Planner is already leaning post-first.",
            "Corroborated scout evidence is reinforcing the current downstream priority."
          ],
          scoutSupport: ["Visibility and coordination pattern"],
          scoutInfluence: "strong",
          confidence: "high",
          coordinationNotes: []
        });
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => expect(screen.getByText("Audience Scout")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Target topics"), "workflow chaos");
    await user.click(screen.getByRole("button", { name: "Run Audience Scout" }));
    await waitFor(() =>
      expect(
        screen.getAllByText("Operators are flagging broken handoffs after launch.").length
      ).toBeGreaterThan(0)
    );
    await user.type(
      screen.getByLabelText("Solution source excerpt"),
      "Expose status and ownership before stalled work turns into support cleanup."
    );
    await user.click(screen.getByRole("button", { name: "Run Solution Scout" }));
    await waitFor(() =>
      expect(screen.getByText("Visibility and coordination pattern")).toBeInTheDocument()
    );
    await user.click(screen.getByRole("button", { name: "Build Scout Matches" }));
    await waitFor(() =>
      expect(screen.getByText("1 matched pain-to-solution opportunities shortlisted.")).toBeInTheDocument()
    );

    await waitFor(() => expect(screen.getByText("Orchestrated Next Move")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Recommend Next Move" }));

    await waitFor(() => {
      expect(screen.getByText("Strong corroborated support")).toBeInTheDocument();
      expect(
        screen.getByText("Lifted by corroborated direct + reviewed support")
      ).toBeInTheDocument();
    });
  });

  it("shows a reviewed-only prioritization reason line in orchestrated next move when reviewed support is strong", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-match-reviewed-only-1",
            match: {
              id: "saved-match-reviewed-only-1",
              audienceItemId: "aud-1",
              solutionItemId: "sol-1",
              matchedPain: "Operators are flagging broken handoffs after launch.",
              matchedSolutionPattern: "Visibility and coordination pattern",
              whyThisMatchWorks: "The solution addresses the same ownership gap.",
              suggestedAngle: "workflow_accountability",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              scoreNotes: ["High keyword overlap"],
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      if (url.endsWith("/orchestrator/recommend") && method === "POST") {
        return jsonResponse({
          recommendedAction: "write_post",
          recommendationReason: "Strong reviewed scout support keeps the post recommendation on top.",
          primaryTarget: "Workflow accountability after launch",
          supportingSignals: [
            "Decision Planner is already leaning post-first.",
            "Strong scout evidence is reinforcing the current downstream priority."
          ],
          scoutSupport: ["Saved scout match (reviewed): Visibility and coordination pattern"],
          scoutInfluence: "strong",
          confidence: "high",
          coordinationNotes: []
        });
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => expect(screen.getByText("Orchestrated Next Move")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Recommend Next Move" }));

    await waitFor(() => {
      expect(screen.getByText("Scout-priority lift")).toBeInTheDocument();
      expect(screen.getByText("Lifted by reviewed scout support")).toBeInTheDocument();
    });
  });

  it("keeps reviewed-only lift visibility quiet when reviewed support is too weak", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-matches",
      JSON.stringify({
        items: [
          {
            id: "saved-match-reviewed-weak-1",
            match: {
              id: "saved-match-reviewed-weak-1",
              audienceItemId: "aud-1",
              solutionItemId: "sol-1",
              matchedPain: "Operators are flagging broken handoffs after launch.",
              matchedSolutionPattern: "Visibility and coordination pattern",
              whyThisMatchWorks: "The solution addresses the same ownership gap.",
              suggestedAngle: "workflow_accountability",
              recommendedAction: "write_post",
              confidence: "low",
              opportunityStrength: "weak",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      })
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const initial = respondWithEmptyDashboard(url, method);
      if (initial) {
        return initial;
      }

      if (url.endsWith("/growth/rhythm") && method === "POST") {
        return jsonResponse(
          {
            topPostCandidates: [
              {
                id: "queue-1",
                title: "Workflow accountability after launch",
                suggestedAction: "write_post",
                priority: "high",
                status: "queued",
                bestAngle: "workflow_accountability",
                reasoningSummary: "Broken handoffs keep surfacing after rollout."
              }
            ],
            topCommentCandidates: [],
            keepForLater: [],
            weeklyFocus: "Lead with workflow accountability after launch.",
            suggestedCadence: "1 post candidate, 0 engagement opportunities, 0 to revisit later.",
            reasoningSummary: "A clear post candidate is already visible."
          },
          201
        );
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText("Saved Matches")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Build Action Plan" }));

    await waitFor(() => {
      expect(screen.getByText("Workflow accountability after launch")).toBeInTheDocument();
    });

    expect(screen.queryByText("Scout-priority lift")).not.toBeInTheDocument();
    expect(screen.queryByText("Lifted by reviewed scout support")).not.toBeInTheDocument();
  });

  it("sends an orchestrated post recommendation to the post generator when current decision context is safe", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      if (url.endsWith("/decision/plan") && method === "POST") {
        return jsonResponse(
          {
            recommendedNextAction: "generate_post_candidate",
            bestAngle: "workflow_accountability",
            contentPriority: "high",
            engagementPriority: "low",
            publishability: "high",
            confidence: 87,
            decisionMode: "deterministic",
            riskNotes: [],
            reasoningSummary: "This is the strongest post move right now.",
            suggestedFlow: "post_only",
            shouldEscalateToPost: true,
            shouldEscalateToEngagement: false,
            shouldStoreForLater: false
          },
          201
        );
      }

      if (url.endsWith("/orchestrator/recommend") && method === "POST") {
        return jsonResponse(
          {
            recommendedAction: "write_post",
            recommendationReason: "The coordinated signal still favors publishing a post.",
            primaryTarget: "Workflow accountability after launch",
            supportingSignals: ["Decision Planner is already leaning post-first."],
            confidence: "high",
            coordinationNotes: []
          },
          201
        );
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await user.type(
      screen.getByLabelText("Decision signal text"),
      "Workflow accountability after launch is where most automation dies."
    );
    await user.click(screen.getByRole("button", { name: "Plan Decision" }));

    await waitFor(() => {
      expect(screen.getByText(/generate_post_candidate/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Recommend Next Move" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send to Post Generator" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Send to Post Generator" }));

    expect(screen.getByLabelText("Signal title")).toHaveValue(
      "Workflow accountability after launch is where most automation dies"
    );
    expect(screen.getByLabelText("Raw text")).toHaveValue(
      "Workflow accountability after launch is where most automation dies."
    );
    expect(
      screen.getByText("Sent orchestrated recommendation to Post Generator.")
    ).toBeInTheDocument();
  });

  it("sends an orchestrated comment recommendation to Comment Writer when current decision context is safe", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      if (url.endsWith("/decision/plan") && method === "POST") {
        return jsonResponse(
          {
            recommendedNextAction: "generate_comment",
            bestAngle: "operational_tension",
            contentPriority: "medium",
            engagementPriority: "high",
            publishability: "medium",
            confidence: 81,
            decisionMode: "deterministic",
            riskNotes: [],
            reasoningSummary: "This should be a comment, not a full post.",
            suggestedFlow: "engagement_only",
            shouldEscalateToPost: false,
            shouldEscalateToEngagement: true,
            shouldStoreForLater: false
          },
          201
        );
      }

      if (url.endsWith("/orchestrator/recommend") && method === "POST") {
        return jsonResponse(
          {
            recommendedAction: "write_comment",
            recommendationReason: "The coordinated signal favors comment-first engagement.",
            primaryTarget: "Operator friction in rollout threads",
            supportingSignals: ["Decision Planner is already leaning comment-first."],
            confidence: "high",
            coordinationNotes: []
          },
          201
        );
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await user.type(
      screen.getByLabelText("Decision signal text"),
      "Operator friction shows up when rollout threads expose the real handoff problem."
    );
    await user.type(
      screen.getByLabelText("Decision post/comment context"),
      "A live thread about rollout friction."
    );
    await user.type(screen.getByLabelText("Decision target role/title"), "Founder");
    await user.click(screen.getByRole("button", { name: "Plan Decision" }));

    await waitFor(() => {
      expect(screen.getByText(/generate_comment/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Recommend Next Move" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send to Comment Writer" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Send to Comment Writer" }));

    expect(screen.getByLabelText("Source post text")).toHaveValue(
      "A live thread about rollout friction."
    );
    expect(screen.getByLabelText("Comment positioning context")).toHaveValue(
      "This should be a comment, not a full post."
    );
    expect(
      screen.getByText("Sent orchestrated recommendation to Comment Writer.")
    ).toBeInTheDocument();
  });

  it("sends an orchestrated reply recommendation to Reply Writer when current decision context is safe", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      if (url.endsWith("/decision/plan") && method === "POST") {
        return jsonResponse(
          {
            recommendedNextAction: "generate_reply",
            bestAngle: "execution_lesson",
            contentPriority: "low",
            engagementPriority: "high",
            publishability: "medium",
            confidence: 79,
            decisionMode: "deterministic",
            riskNotes: [],
            reasoningSummary: "There is enough reply context to answer directly.",
            suggestedFlow: "engagement_only",
            shouldEscalateToPost: false,
            shouldEscalateToEngagement: true,
            shouldStoreForLater: false
          },
          201
        );
      }

      if (url.endsWith("/orchestrator/recommend") && method === "POST") {
        return jsonResponse(
          {
            recommendedAction: "write_reply",
            recommendationReason: "The coordinated signal favors a direct reply.",
            primaryTarget: "Reply to operator follow-up",
            supportingSignals: ["Decision Planner is already leaning reply-first."],
            confidence: "high",
            coordinationNotes: []
          },
          201
        );
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await user.type(
      screen.getByLabelText("Decision signal text"),
      "Replies are strongest when the thread already contains a useful operator point."
    );
    await user.type(
      screen.getByLabelText("Decision post/comment context"),
      "We saw this during onboarding too."
    );
    await user.click(screen.getByLabelText("There is a reply context"));
    await user.click(screen.getByRole("button", { name: "Plan Decision" }));

    await waitFor(() => {
      expect(screen.getByText(/generate_reply/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Recommend Next Move" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send to Reply Writer" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Send to Reply Writer" }));

    expect(screen.getByLabelText("Our post text")).toHaveValue(
      "Replies are strongest when the thread already contains a useful operator point."
    );
    expect(screen.getByLabelText("Incoming comment text")).toHaveValue(
      "We saw this during onboarding too."
    );
    expect(
      screen.getByText("Sent orchestrated recommendation to Reply Writer.")
    ).toBeInTheDocument();
  });

  it("hides orchestrated quick actions when the recommendation context is insufficient", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      if (url.endsWith("/orchestrator/recommend") && method === "POST") {
        return jsonResponse(
          {
            recommendedAction: "write_post",
            recommendationReason: "The coordinated signal still favors a post.",
            primaryTarget: "A broad publishable workflow theme",
            supportingSignals: ["Strategy is leaning post-first."],
            confidence: "medium",
            coordinationNotes: []
          },
          201
        );
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await user.click(screen.getByRole("button", { name: "Recommend Next Move" }));

    await waitFor(() => {
      expect(screen.getByText("A broad publishable workflow theme")).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("button", { name: "Send to Post Generator" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Send to Comment Writer" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Send to Reply Writer" })
    ).not.toBeInTheDocument();
  });

  it("opens a supporting saved item for a save_for_later recommendation when one is resolvable", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-context-1",
          signalText: "Workflow accountability after launch is still unresolved.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Keep this for later when the signal matures.",
          priority: "medium",
          recommendedAction: "generate_post_candidate",
          status: "new",
          createdAt: "2026-03-14T00:00:00.000Z",
          sourceType: "manual_research"
        }
      ])
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      if (url.endsWith("/orchestrator/recommend") && method === "POST") {
        return jsonResponse(
          {
            recommendedAction: "save_for_later",
            recommendationReason: "This is worth keeping, but not launching right now.",
            primaryTarget: "Workflow accountability after launch",
            supportingSignals: ["Saved context is available for later use."],
            confidence: "medium",
            coordinationNotes: []
          },
          201
        );
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Workflow accountability after launch is still unresolved.")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Recommend Next Move" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open supporting context" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Open supporting context" }));

    expect(screen.getAllByText("Current").length).toBeGreaterThan(0);
    expect(screen.getByText("Opened supporting saved item.")).toBeInTheDocument();
  });

  it("opens a supporting signal for a revisit_signal recommendation when one is resolvable", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) {
          return jsonResponse([
            {
              id: "signal-1",
              title: "Workflow accountability after launch",
              rawText: "Workflow accountability after launch is where most operators lose the thread.",
              sourceType: "research",
              status: "new",
              createdAt: "2026-03-14T00:00:00.000Z"
            }
          ]);
        }
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      if (url.endsWith("/orchestrator/recommend") && method === "POST") {
        return jsonResponse(
          {
            recommendedAction: "revisit_signal",
            recommendationReason: "Revisit the strongest existing signal before doing anything else.",
            primaryTarget: "Workflow accountability after launch",
            supportingSignals: ["Signal inventory already contains a close match."],
            confidence: "medium",
            coordinationNotes: []
          },
          201
        );
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Workflow accountability after launch")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Recommend Next Move" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open supporting context" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Open supporting context" }));

    expect(screen.getAllByText("Current").length).toBeGreaterThan(0);
    expect(screen.getByText("Opened supporting signal.")).toBeInTheDocument();
  });

  it("hides the supporting-context action when no safe target can be resolved", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
        if (url.endsWith("/system/providers")) {
          return jsonResponse({
            mode: "deterministic",
            textProvider: null,
            visualProvider: null,
            fallbackEnabled: true
          });
        }
      }

      if (url.endsWith("/orchestrator/recommend") && method === "POST") {
        return jsonResponse(
          {
            recommendedAction: "revisit_signal",
            recommendationReason: "A signal should be revisited, but nothing is safely resolvable here yet.",
            primaryTarget: "A broad unresolved workflow signal",
            supportingSignals: ["Current context is too weak to open directly."],
            confidence: "low",
            coordinationNotes: []
          },
          201
        );
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await user.click(screen.getByRole("button", { name: "Recommend Next Move" }));

    await waitFor(() => {
      expect(screen.getByText("A broad unresolved workflow signal")).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("button", { name: "Open supporting context" })
    ).not.toBeInTheDocument();
  });

  it("sends a saved growth rhythm post candidate to the post generator", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-post-1",
          signalText: "Workflow accountability breaks after launch.",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Turn this into a post candidate.",
          priority: "high",
          recommendedAction: "generate_post_candidate",
          status: "new",
          createdAt: "2026-03-14T00:00:00.000Z",
          sourceType: "manual_research"
        }
      ])
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      if (url.endsWith("/growth/rhythm") && method === "POST") {
        return jsonResponse(
          {
            topPostCandidates: [
              {
                id: "saved-post-1",
                title: "Workflow accountability breaks after launch.",
                suggestedAction: "generate_post_candidate",
                priority: "high",
                status: "new",
                reasoningSummary: "Turn this into a post candidate."
              }
            ],
            topCommentCandidates: [],
            keepForLater: [],
            weeklyFocus: "Turn the clearest workflow pain into a post.",
            suggestedCadence: "1 post candidate, 0 engagement opportunities, 0 to revisit later.",
            reasoningSummary: "Lead with one strong post candidate."
          },
          201
        );
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Content Queue")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Build Action Plan" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Send growth candidate saved-post-1 to post generator"
        })
      ).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", {
        name: "Send growth candidate saved-post-1 to post generator"
      })
    );

    expect(screen.getByLabelText("Signal title")).toHaveValue(
      "Workflow accountability breaks after launch"
    );
    expect(screen.getByLabelText("Raw text")).toHaveValue(
      "Workflow accountability breaks after launch."
    );
    expect(screen.getByText("Sent action-plan candidate to Post Generator.")).toBeInTheDocument();
  });

  it("sends a saved growth rhythm comment candidate to Comment Writer", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-comment-1",
          signalText: "Most automation fails at the handoff between ops and sales.",
          bestAngle: "handoff_failure",
          reasoningSummary: "Use this as a practical comment angle.",
          priority: "medium",
          recommendedAction: "generate_comment",
          status: "new",
          createdAt: "2026-03-14T00:00:00.000Z",
          postContext: "A post about why automation rollout breaks after the pilot.",
          sourceType: "manual_research"
        }
      ])
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      if (url.endsWith("/growth/rhythm") && method === "POST") {
        return jsonResponse(
          {
            topPostCandidates: [],
            topCommentCandidates: [
              {
                id: "saved-comment-1",
                title: "Most automation fails at the handoff between ops and sales.",
                suggestedAction: "generate_comment",
                priority: "medium",
                status: "new",
                reasoningSummary: "Use this as a practical comment angle."
              }
            ],
            keepForLater: [],
            weeklyFocus: "Add one grounded comment on rollout execution.",
            suggestedCadence: "0 post candidates, 1 engagement opportunity, 0 to revisit later.",
            reasoningSummary: "One strong engagement thread is worth working this week."
          },
          201
        );
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Content Queue")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Build Action Plan" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Send growth candidate saved-comment-1 to comment writer"
        })
      ).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", {
        name: "Send growth candidate saved-comment-1 to comment writer"
      })
    );

    expect(screen.getByLabelText("Source post text")).toHaveValue(
      "A post about why automation rollout breaks after the pilot."
    );
    expect(screen.getByText("Sent action-plan candidate to Comment Writer.")).toBeInTheDocument();
  });

  it("sends a saved growth rhythm reply candidate to Reply Writer", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-reply-1",
          signalText: "Our rollout point should stay grounded in workflow ownership.",
          bestAngle: "ownership_gap",
          reasoningSummary: "Reply directly and keep it grounded.",
          priority: "medium",
          recommendedAction: "generate_reply",
          status: "new",
          createdAt: "2026-03-14T00:00:00.000Z",
          postContext: "We saw the same ownership gap during onboarding.",
          targetRole: "Operator",
          companyContext: "Operator-led SaaS team"
        }
      ])
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      if (url.endsWith("/growth/rhythm") && method === "POST") {
        return jsonResponse(
          {
            topPostCandidates: [],
            topCommentCandidates: [
              {
                id: "saved-reply-1",
                title: "Our rollout point should stay grounded in workflow ownership.",
                suggestedAction: "generate_reply",
                priority: "medium",
                status: "new",
                reasoningSummary: "Reply directly and keep it grounded."
              }
            ],
            keepForLater: [],
            weeklyFocus: "Work one strong reply opportunity.",
            suggestedCadence: "0 post candidates, 1 engagement opportunity, 0 to revisit later.",
            reasoningSummary: "A grounded reply is the clearest engagement move."
          },
          201
        );
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Content Queue")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Build Action Plan" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Send growth candidate saved-reply-1 to reply writer"
        })
      ).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", {
        name: "Send growth candidate saved-reply-1 to reply writer"
      })
    );

    expect(screen.getByLabelText("Our post text")).toHaveValue(
      "Our rollout point should stay grounded in workflow ownership."
    );
    expect(screen.getByLabelText("Incoming comment text")).toHaveValue(
      "We saw the same ownership gap during onboarding."
    );
    expect(screen.getByText("Sent action-plan candidate to Reply Writer.")).toBeInTheDocument();
  });

  it("opens a saved item from the growth rhythm card", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-open-1",
          signalText: "Open this saved item from rhythm.",
          bestAngle: "ownership_gap",
          reasoningSummary: "This one should be easy to reopen.",
          priority: "medium",
          recommendedAction: "save_for_later",
          status: "new",
          createdAt: "2026-03-14T00:00:00.000Z"
        }
      ])
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      if (url.endsWith("/growth/rhythm") && method === "POST") {
        return jsonResponse(
          {
            topPostCandidates: [],
            topCommentCandidates: [],
            keepForLater: [
              {
                id: "saved-open-1",
                title: "Open this saved item from rhythm.",
                suggestedAction: "save_for_later",
                priority: "medium",
                status: "new",
                reasoningSummary: "This one should be easy to reopen."
              }
            ],
            weeklyFocus: "Keep one research item warm for later.",
            suggestedCadence: "0 post candidates, 0 engagement opportunities, 1 to revisit later.",
            reasoningSummary: "Nothing to run now, but keep one useful item visible."
          },
          201
        );
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Content Queue")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Build Action Plan" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Open saved item saved-open-1 from action plan" })
      ).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", { name: "Open saved item saved-open-1 from action plan" })
    );

    expect(screen.getAllByText("Current").length).toBeGreaterThan(0);
    expect(screen.getByText("Opened saved item from LinkedIn Action Plan.")).toBeInTheDocument();
  });

  it("hides unsupported growth rhythm actions when a candidate lacks saved-item context", async () => {
    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      if (url.endsWith("/growth/rhythm") && method === "POST") {
        return jsonResponse(
          {
            topPostCandidates: [
              {
                id: "queue-only-1",
                title: "Queue item: write_post",
                suggestedAction: "write_post",
                priority: "high",
                status: "queued",
                reasoningSummary: "This came from queue only."
              }
            ],
            topCommentCandidates: [],
            keepForLater: [],
            weeklyFocus: "Review queue work first.",
            suggestedCadence: "1 post candidate, 0 engagement opportunities, 0 to revisit later.",
            reasoningSummary: "Queue-only items should stay read-only here."
          },
          201
        );
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Content Queue")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Build Action Plan" }));

    await waitFor(() => {
      expect(screen.getByText("Queue item: write_post")).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("button", {
        name: "Send growth candidate queue-only-1 to post generator"
      })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Open saved item queue-only-1 from action plan"
      })
    ).not.toBeInTheDocument();
  });

  it("hides the growth rhythm reply action when reply context is insufficient", async () => {
    window.localStorage.setItem(
      "linkedin-brand-os:saved-for-later",
      JSON.stringify([
        {
          id: "saved-reply-2",
          signalText: "This saved item lacks usable reply context.",
          bestAngle: "ownership_gap",
          reasoningSummary: "Not enough thread context to reply safely.",
          priority: "medium",
          recommendedAction: "generate_reply",
          status: "new",
          createdAt: "2026-03-14T00:00:00.000Z"
        }
      ])
    );

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse([]);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      if (url.endsWith("/growth/rhythm") && method === "POST") {
        return jsonResponse(
          {
            topPostCandidates: [],
            topCommentCandidates: [
              {
                id: "saved-reply-2",
                title: "This saved item lacks usable reply context.",
                suggestedAction: "generate_reply",
                priority: "medium",
                status: "new",
                reasoningSummary: "Not enough thread context to reply safely."
              }
            ],
            keepForLater: [],
            weeklyFocus: "Skip weak reply context.",
            suggestedCadence: "0 post candidates, 1 engagement opportunity, 0 to revisit later.",
            reasoningSummary: "Do not expose reply actions without comment context."
          },
          201
        );
      }

      return jsonResponse([], 200);
    });

    const user = userEvent.setup();
    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Content Queue")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Build Action Plan" }));

    await waitFor(() => {
      expect(screen.getAllByText("This saved item lacks usable reply context.").length).toBeGreaterThan(0);
    });

    expect(
      screen.queryByRole("button", {
        name: "Send growth candidate saved-reply-2 to reply writer"
      })
    ).not.toBeInTheDocument();
  });

  it("renders clean final posts without leaking internal metadata labels", async () => {
    const contentAssets: ContentAsset[] = [
      {
        id: "content-1",
        ideaId: "idea-1",
        contentType: "linkedin-post",
        hook: "Draft hook",
        body: "Draft body",
        cta: "Draft cta",
        status: "draft",
        refinedHook: "Refined hook",
        refinedBody: "Refined body",
        refinedCta: "Refined cta",
        refinementStatus: "refined",
        finalHook: "Cleaner final hook",
        finalBody:
          "Lead with the operator payoff.\n\nThen name the rollout blocker plainly.",
        finalClosing: "Where is this slowing your team down?",
        finalStatus: "ready",
        finalQualityScore: 94,
        createdAt: "2026-03-14T00:00:00.000Z"
      }
    ];

    fetchMock.mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (method === "GET") {
        if (url.endsWith("/signals")) return jsonResponse([]);
        if (url.endsWith("/ideas")) return jsonResponse([]);
        if (url.endsWith("/content")) return jsonResponse(contentAssets);
        if (url.endsWith("/visuals")) return jsonResponse([]);
        if (url.endsWith("/analytics")) return jsonResponse([]);
        if (url.endsWith("/strategy/recommendations")) return jsonResponse([]);
        if (url.endsWith("/sources")) return jsonResponse([]);
        if (url.endsWith("/markets")) return jsonResponse([]);
        if (url.endsWith("/topics/scores")) return jsonResponse([]);
        if (url.endsWith("/queue")) return jsonResponse([]);
        if (url.endsWith("/brand-voice")) return jsonResponse({ active: null, profiles: [] });
      }

      return new Response("Not found", { status: 404 });
    });

    render(<App apiBaseUrl="http://localhost:4000" />);

    await waitFor(() => {
      expect(screen.getByText("Cleaner final hook")).toBeInTheDocument();
      expect(screen.getByText((content) => content.includes("Lead with the operator payoff."))).toBeInTheDocument();
      expect(screen.queryByText(/Audience:/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Voice:/)).not.toBeInTheDocument();
    });
  });
});
