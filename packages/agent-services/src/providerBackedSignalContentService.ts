import type { ProviderRouter } from "@linkedin-brand-os/ai-providers";
import type { Idea, OrchestratorDecision, Signal, SignalAnalysis } from "@linkedin-brand-os/shared";

function synthesizeIdea(signal: Signal, analysis: SignalAnalysis, decision: OrchestratorDecision): Idea {
  return {
    id: `signal-content-${signal.id}`,
    signalId: signal.id,
    title: analysis.bestAngle ?? signal.title,
    coreInsight: [analysis.whyRelevant, analysis.uniquenessReason].filter(Boolean).join(" "),
    businessRelevance: [
      analysis.businessValueSummary,
      analysis.practicalImplications[0],
      `Decision: ${decision.nextAction.replace(/_/g, " ")}`
    ]
      .filter(Boolean)
      .join(" "),
    targetAudience: [analysis.targetAudience, analysis.audienceEmphasis].filter(Boolean).join(" | "),
    status: "draft",
    createdAt: signal.createdAt
  };
}

export async function providerBackedSignalContentService(input: {
  signal: Signal;
  analysis: SignalAnalysis;
  decision: OrchestratorDecision;
  router: ProviderRouter;
}) {
  const idea = synthesizeIdea(input.signal, input.analysis, input.decision);
  return input.router.generatePostFromIdea({
    idea,
    fallback: async () => {
      throw new Error("Premium content generation is required and no acceptable fallback is configured.");
    }
  });
}
