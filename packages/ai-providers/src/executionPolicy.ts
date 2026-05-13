import type {
  CreateAgentRunInput,
  ExecutionTaskPolicy,
  ExecutionPolicyResult,
  ExecutionTaskType,
  ModelAssignmentConfig,
  ProviderSelectionInput,
  ProviderTier
} from "@linkedin-brand-os/shared";

export interface ExecutionAvailability {
  localMiraiAvailable: boolean;
  openAIAvailable: boolean;
}

export interface ExecutionPolicyRouterConfig {
  modelAssignments: ModelAssignmentConfig;
  taskPolicies: Record<ExecutionTaskType, ExecutionTaskPolicy>;
  availability: ExecutionAvailability;
}

export const CANONICAL_EXECUTION_TASK_POLICIES: Record<
  ExecutionTaskType,
  ExecutionTaskPolicy
> = {
  scout_preprocess: {
    taskType: "scout_preprocess",
    defaultTier: "local_mirai",
    fallbackTier: "deterministic",
    deterministicFallbackAllowed: true,
    openAIEscalationAllowed: false,
    qualityRequirement: "medium",
    costSensitivity: "high",
    notes: "Cheap first-pass scout cleanup should stay local-first."
  },
  source_tagging: {
    taskType: "source_tagging",
    defaultTier: "local_mirai",
    fallbackTier: "deterministic",
    deterministicFallbackAllowed: true,
    openAIEscalationAllowed: false,
    qualityRequirement: "medium",
    costSensitivity: "high",
    notes: "Tagging is useful but should not consume premium reasoning budget."
  },
  novelty_hinting: {
    taskType: "novelty_hinting",
    defaultTier: "local_mirai",
    fallbackTier: "deterministic",
    deterministicFallbackAllowed: true,
    openAIEscalationAllowed: false,
    qualityRequirement: "medium",
    costSensitivity: "high",
    notes: "Rough novelty hints can degrade safely."
  },
  clustering: {
    taskType: "clustering",
    defaultTier: "local_mirai",
    fallbackTier: "deterministic",
    deterministicFallbackAllowed: true,
    openAIEscalationAllowed: false,
    qualityRequirement: "medium",
    costSensitivity: "high",
    notes: "Clustering is preprocessing and should stay cheap."
  },
  relevance_reasoning: {
    taskType: "relevance_reasoning",
    defaultTier: "openai",
    fallbackTier: null,
    deterministicFallbackAllowed: false,
    openAIEscalationAllowed: false,
    qualityRequirement: "high",
    costSensitivity: "medium",
    notes: "Final relevance judgment is quality-sensitive and should fail honestly."
  },
  business_translation: {
    taskType: "business_translation",
    defaultTier: "openai",
    fallbackTier: null,
    deterministicFallbackAllowed: false,
    openAIEscalationAllowed: false,
    qualityRequirement: "high",
    costSensitivity: "medium",
    notes: "Business translation needs stronger reasoning than local preprocessing."
  },
  positioning: {
    taskType: "positioning",
    defaultTier: "openai",
    fallbackTier: null,
    deterministicFallbackAllowed: false,
    openAIEscalationAllowed: false,
    qualityRequirement: "high",
    costSensitivity: "medium",
    notes: "Positioning should not silently degrade to weak heuristics."
  },
  solution_memory_enrichment: {
    taskType: "solution_memory_enrichment",
    defaultTier: "deterministic",
    fallbackTier: null,
    deterministicFallbackAllowed: true,
    openAIEscalationAllowed: false,
    qualityRequirement: "medium",
    costSensitivity: "high",
    notes: "Implementation memory extraction stays local-first and deterministic until a stronger need appears."
  },
  content_generation: {
    taskType: "content_generation",
    defaultTier: "openai",
    fallbackTier: null,
    deterministicFallbackAllowed: false,
    openAIEscalationAllowed: false,
    qualityRequirement: "high",
    costSensitivity: "low",
    notes: "Final writing quality is premium-tier work."
  },
  critic_review: {
    taskType: "critic_review",
    defaultTier: "openai",
    fallbackTier: null,
    deterministicFallbackAllowed: false,
    openAIEscalationAllowed: false,
    qualityRequirement: "high",
    costSensitivity: "low",
    notes: "Critic judgment should stay high quality or fail honestly."
  },
  lead_intelligence_first_pass: {
    taskType: "lead_intelligence_first_pass",
    defaultTier: "local_mirai",
    fallbackTier: "deterministic",
    deterministicFallbackAllowed: true,
    openAIEscalationAllowed: true,
    qualityRequirement: "medium",
    costSensitivity: "high",
    notes: "Lead preprocessing stays cheap unless explicitly escalated."
  },
  lead_message_generation: {
    taskType: "lead_message_generation",
    defaultTier: "openai",
    fallbackTier: null,
    deterministicFallbackAllowed: false,
    openAIEscalationAllowed: false,
    qualityRequirement: "high",
    costSensitivity: "low",
    notes: "Lead-facing messaging is quality-sensitive."
  },
  analytics_synthesis: {
    taskType: "analytics_synthesis",
    defaultTier: "local_mirai",
    fallbackTier: "deterministic",
    deterministicFallbackAllowed: true,
    openAIEscalationAllowed: true,
    qualityRequirement: "medium",
    costSensitivity: "medium",
    notes: "Analytics summaries can start local, with escalation for deeper synthesis."
  }
};

export class ExecutionPolicyRouter {
  constructor(private readonly config: ExecutionPolicyRouterConfig) {}

  route(input: ProviderSelectionInput): ExecutionPolicyResult {
    const policy = this.config.taskPolicies[input.taskType];
    const qualityRequirement = input.qualityRequirement ?? policy.qualityRequirement;
    const costSensitivity = input.costSensitivity ?? policy.costSensitivity;
    const allowOpenAIEscalation =
      input.allowOpenAIEscalation ?? policy.openAIEscalationAllowed;

    if (policy.defaultTier === "deterministic") {
      return this.buildDecision(policy, {
        chosenTier: "deterministic",
        fallbackUsed: false,
        outcome: "selected",
        selectionReason: "Task is deterministic-only by policy.",
        qualityRequirement,
        costSensitivity
      });
    }

    if (policy.defaultTier === "local_mirai") {
      if (
        allowOpenAIEscalation &&
        qualityRequirement === "high" &&
        this.config.availability.openAIAvailable
      ) {
        return this.buildDecision(policy, {
          chosenTier: "openai",
          fallbackUsed: false,
          outcome: "selected",
          selectionReason:
            "Escalated from local Mirai to OpenAI because high-quality reasoning was explicitly requested.",
          qualityRequirement,
          costSensitivity
        });
      }

      if (this.config.availability.localMiraiAvailable) {
        return this.buildDecision(policy, {
          chosenTier: "local_mirai",
          fallbackUsed: false,
          outcome: "selected",
          selectionReason: "Local Mirai is available and this task is local-first by policy.",
          qualityRequirement,
          costSensitivity
        });
      }

      if (allowOpenAIEscalation && this.config.availability.openAIAvailable) {
        return this.buildDecision(policy, {
          chosenTier: "openai",
          fallbackUsed: false,
          outcome: "selected",
          selectionReason:
            "Escalated to OpenAI because local Mirai is unavailable and policy allows premium fallback.",
          qualityRequirement,
          costSensitivity
        });
      }

      if (policy.deterministicFallbackAllowed) {
        return this.buildDecision(policy, {
          chosenTier: "deterministic",
          fallbackUsed: true,
          outcome: "fallback",
          selectionReason:
            "Local Mirai is unavailable, so the task fell back to deterministic execution by policy.",
          qualityRequirement,
          costSensitivity
        });
      }

      return this.buildBlockedDecision(
        policy,
        "Local Mirai is unavailable and no safe fallback is allowed.",
        qualityRequirement,
        costSensitivity
      );
    }

    if (this.config.availability.openAIAvailable) {
      return this.buildDecision(policy, {
        chosenTier: "openai",
        fallbackUsed: false,
        outcome: "selected",
        selectionReason: "OpenAI tier is available and required for this task.",
        qualityRequirement,
        costSensitivity
      });
    }

    if (policy.fallbackTier === "local_mirai" && this.config.availability.localMiraiAvailable) {
      return this.buildDecision(policy, {
        chosenTier: "local_mirai",
        fallbackUsed: true,
        outcome: "fallback",
        selectionReason:
          "OpenAI tier is unavailable, so the task fell back to local Mirai by explicit policy.",
        qualityRequirement,
        costSensitivity
      });
    }

    if (policy.deterministicFallbackAllowed) {
      return this.buildDecision(policy, {
        chosenTier: "deterministic",
        fallbackUsed: true,
        outcome: "fallback",
        selectionReason:
          "OpenAI tier is unavailable, so the task fell back to deterministic execution by explicit policy.",
        qualityRequirement,
        costSensitivity
      });
    }

    return this.buildBlockedDecision(
      policy,
      "OpenAI tier is required for this task and no acceptable fallback is configured.",
      qualityRequirement,
      costSensitivity
    );
  }

  getPolicies(): Record<ExecutionTaskType, ExecutionTaskPolicy> {
    return this.config.taskPolicies;
  }

  getModelAssignments(): ModelAssignmentConfig {
    return this.config.modelAssignments;
  }

  private buildDecision(
    policy: ExecutionTaskPolicy,
    input: {
      chosenTier: ProviderTier;
      fallbackUsed: boolean;
      outcome: ExecutionPolicyResult["outcome"];
      selectionReason: string;
      qualityRequirement: ExecutionPolicyResult["qualityRequirement"];
      costSensitivity: ExecutionPolicyResult["costSensitivity"];
    }
  ): ExecutionPolicyResult {
    const assignment = resolveModelAssignment(this.config.modelAssignments, input.chosenTier);

    return {
      taskType: policy.taskType,
      defaultTier: policy.defaultTier,
      chosenTier: input.chosenTier,
      chosenProvider: assignment.providerName,
      chosenModel: assignment.model,
      fallbackTier: policy.fallbackTier ?? null,
      fallbackUsed: input.fallbackUsed,
      outcome: input.outcome,
      selectionReason: input.selectionReason,
      qualityRequirement: input.qualityRequirement,
      costSensitivity: input.costSensitivity,
      deterministicFallbackAllowed: policy.deterministicFallbackAllowed,
      openAIEscalationAllowed: policy.openAIEscalationAllowed
    };
  }

  private buildBlockedDecision(
    policy: ExecutionTaskPolicy,
    selectionReason: string,
    qualityRequirement: ExecutionPolicyResult["qualityRequirement"],
    costSensitivity: ExecutionPolicyResult["costSensitivity"]
  ): ExecutionPolicyResult {
    return {
      taskType: policy.taskType,
      defaultTier: policy.defaultTier,
      chosenTier: null,
      chosenProvider: null,
      chosenModel: null,
      fallbackTier: policy.fallbackTier ?? null,
      fallbackUsed: false,
      outcome: "blocked",
      selectionReason,
      qualityRequirement,
      costSensitivity,
      deterministicFallbackAllowed: policy.deterministicFallbackAllowed,
      openAIEscalationAllowed: policy.openAIEscalationAllowed
    };
  }
}

export function createModelAssignmentConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): ModelAssignmentConfig {
  return {
    deterministic: {
      providerName: null,
      model: "deterministic_rules_v1"
    },
    localMirai: {
      providerName: "mirai",
      model: env.MIRAI_MODEL ?? env.MIRAI_MODEL_REPO ?? "mirai-default",
      modelRepo: env.MIRAI_MODEL_REPO
    },
    openAI: {
      providerName: "strong-text",
      model: env.OPENAI_TEXT_MODEL ?? env.OPENAI_MODEL ?? "gpt-5.4"
    }
  };
}

export function createExecutionPolicyRouterFromEnv(
  env: Record<string, string | undefined> = process.env
): ExecutionPolicyRouter {
  return new ExecutionPolicyRouter({
    modelAssignments: createModelAssignmentConfigFromEnv(env),
    taskPolicies: CANONICAL_EXECUTION_TASK_POLICIES,
    availability: {
      localMiraiAvailable: env.MIRAI_ENABLED === "true",
      openAIAvailable: Boolean(
        env.OPENAI_API_KEY?.trim() && env.OPENAI_API_KEY.trim() !== "PASTE_REAL_KEY_HERE"
      )
    }
  });
}

export function buildAgentRunCreateInputFromExecutionDecision(input: {
  signalId: string;
  agentName: string;
  decision: ExecutionPolicyResult;
  status?: CreateAgentRunInput["status"];
  startedAt?: string;
  completedAt?: string;
  inputSummary?: string;
  outputSummary?: string;
  errorMessage?: string;
}): CreateAgentRunInput {
  return {
    signalId: input.signalId,
    agentName: input.agentName,
    modelTier: input.decision.chosenTier ?? undefined,
    providerName: input.decision.chosenProvider ?? undefined,
    status: input.status ?? (input.decision.outcome === "blocked" ? "failed" : "queued"),
    startedAt: input.startedAt ?? new Date().toISOString(),
    completedAt: input.completedAt,
    inputSummary:
      input.inputSummary ??
      `${input.decision.taskType}: ${input.decision.selectionReason}`,
    outputSummary: input.outputSummary,
    errorMessage:
      input.errorMessage ??
      (input.decision.outcome === "blocked" ? input.decision.selectionReason : undefined)
  };
}

function resolveModelAssignment(
  assignments: ModelAssignmentConfig,
  tier: ProviderTier
): { providerName: string | null; model: string } {
  if (tier === "deterministic") {
    return assignments.deterministic;
  }

  if (tier === "local_mirai") {
    return {
      providerName: assignments.localMirai.providerName,
      model: assignments.localMirai.model
    };
  }

  return {
    providerName: assignments.openAI.providerName,
    model: assignments.openAI.model
  };
}
