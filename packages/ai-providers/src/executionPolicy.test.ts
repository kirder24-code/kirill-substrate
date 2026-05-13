import { describe, expect, it } from "vitest";
import {
  buildAgentRunCreateInputFromExecutionDecision,
  CANONICAL_EXECUTION_TASK_POLICIES,
  createExecutionPolicyRouterFromEnv,
  createModelAssignmentConfigFromEnv,
  ExecutionPolicyRouter
} from "./executionPolicy";

describe("ExecutionPolicyRouter", () => {
  it("routes deterministic tasks to deterministic execution", () => {
    const router = new ExecutionPolicyRouter({
      modelAssignments: createModelAssignmentConfigFromEnv({}),
      taskPolicies: {
        ...CANONICAL_EXECUTION_TASK_POLICIES,
        scout_preprocess: {
          ...CANONICAL_EXECUTION_TASK_POLICIES.scout_preprocess,
          defaultTier: "deterministic",
          fallbackTier: null,
          deterministicFallbackAllowed: true
        }
      },
      availability: {
        localMiraiAvailable: true,
        openAIAvailable: true
      }
    });

    const decision = router.route({ taskType: "scout_preprocess" });

    expect(decision).toEqual(
      expect.objectContaining({
        taskType: "scout_preprocess",
        chosenTier: "deterministic",
        chosenProvider: null,
        chosenModel: "deterministic_rules_v1",
        fallbackUsed: false,
        outcome: "selected",
        selectionReason: "Task is deterministic-only by policy."
      })
    );
  });

  it("routes local-preferred tasks to Mirai by default", () => {
    const router = createExecutionPolicyRouterFromEnv({
      MIRAI_ENABLED: "true"
    });

    const decision = router.route({ taskType: "source_tagging" });

    expect(decision).toEqual(
      expect.objectContaining({
        chosenTier: "local_mirai",
        chosenProvider: "mirai",
        chosenModel: "mirai-default",
        fallbackUsed: false,
        outcome: "selected"
      })
    );
    expect(decision.selectionReason).toContain("local-first");
  });

  it("routes OpenAI-required tasks to the OpenAI tier", () => {
    const router = createExecutionPolicyRouterFromEnv({
      OPENAI_API_KEY: "secret",
      OPENAI_TEXT_MODEL: "gpt-4.1-mini"
    });

    const decision = router.route({ taskType: "business_translation" });

    expect(decision).toEqual(
      expect.objectContaining({
        chosenTier: "openai",
        chosenProvider: "strong-text",
        chosenModel: "gpt-4.1-mini",
        fallbackUsed: false,
        outcome: "selected"
      })
    );
  });

  it("escalates from local Mirai to OpenAI when policy and input allow it", () => {
    const router = createExecutionPolicyRouterFromEnv({
      MIRAI_ENABLED: "true",
      OPENAI_API_KEY: "secret"
    });

    const decision = router.route({
      taskType: "analytics_synthesis",
      qualityRequirement: "high",
      allowOpenAIEscalation: true
    });

    expect(decision).toEqual(
      expect.objectContaining({
        chosenTier: "openai",
        fallbackUsed: false,
        outcome: "selected"
      })
    );
    expect(decision.selectionReason).toContain("Escalated");
  });

  it("fails honestly when an OpenAI-required task has no acceptable fallback", () => {
    const router = createExecutionPolicyRouterFromEnv({
      MIRAI_ENABLED: "true"
    });

    const decision = router.route({ taskType: "relevance_reasoning" });

    expect(decision).toEqual(
      expect.objectContaining({
        chosenTier: null,
        chosenProvider: null,
        chosenModel: null,
        fallbackUsed: false,
        outcome: "blocked"
      })
    );
    expect(decision.selectionReason).toContain("required");
  });

  it("falls back to deterministic behavior when local Mirai is missing and policy allows it", () => {
    const router = createExecutionPolicyRouterFromEnv({});

    const decision = router.route({ taskType: "clustering" });

    expect(decision).toEqual(
      expect.objectContaining({
        chosenTier: "deterministic",
        chosenProvider: null,
        chosenModel: "deterministic_rules_v1",
        fallbackUsed: true,
        outcome: "fallback"
      })
    );
    expect(decision.selectionReason).toContain("fell back to deterministic");
  });

  it("records chosen tier and reason in AgentRun-friendly shape", () => {
    const router = createExecutionPolicyRouterFromEnv({
      MIRAI_ENABLED: "true"
    });
    const decision = router.route({ taskType: "lead_intelligence_first_pass" });

    const run = buildAgentRunCreateInputFromExecutionDecision({
      signalId: "sig-1",
      agentName: "lead-intelligence-agent",
      decision
    });

    expect(run).toEqual(
      expect.objectContaining({
        signalId: "sig-1",
        agentName: "lead-intelligence-agent",
        modelTier: "local_mirai",
        providerName: "mirai",
        status: "queued",
        inputSummary: expect.stringContaining("lead_intelligence_first_pass")
      })
    );
  });

  it("builds explicit stage mappings that stay cheap by default", () => {
    expect(CANONICAL_EXECUTION_TASK_POLICIES.scout_preprocess).toEqual(
      expect.objectContaining({
        defaultTier: "local_mirai",
        fallbackTier: "deterministic",
        costSensitivity: "high"
      })
    );
    expect(CANONICAL_EXECUTION_TASK_POLICIES.content_generation).toEqual(
      expect.objectContaining({
        defaultTier: "openai",
        deterministicFallbackAllowed: false
      })
    );
  });
});
