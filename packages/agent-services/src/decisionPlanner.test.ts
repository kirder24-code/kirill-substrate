import { describe, expect, it } from "vitest";
import { buildDecisionPlan } from "./decisionPlanner";

describe("decision planner", () => {
  it("returns a high-priority post candidate for strong operational founder signals", () => {
    const result = buildDecisionPlan({
      signalText:
        "Most AI copilots collapse after the demo because nobody owns the workflow, the exception path, or the operational accountability.",
      sourceType: "manual",
      targetRole: "Founder",
      companyContext: "B2B operations tooling",
      relevanceScore: 88,
      bestAngle: "ownership_gap",
      recommendedAction: "comment"
    });

    expect(result.recommendedNextAction).toBe("generate_post_candidate");
    expect(result.contentPriority).toBe("high");
    expect(result.confidence).toBeGreaterThanOrEqual(75);
    expect(result.bestAngle).toBe("ownership_gap");
  });

  it("returns an engagement-first action for a live discussion with strong relevance", () => {
    const result = buildDecisionPlan({
      signalText:
        "The handoff between sales and ops is where automation usually dies.",
      sourceType: "commentary",
      targetRole: "Operator",
      postContext: "A public LinkedIn thread about rollout failures.",
      relevanceScore: 81,
      bestAngle: "handoff_failure",
      recommendedAction: "comment",
      hasCommentContext: true
    });

    expect(result.recommendedNextAction).toBe("generate_comment");
    expect(result.suggestedFlow).toBe("engagement_only");
    expect(result.engagementPriority).toBe("high");
  });

  it("returns save for later for medium relevance without immediate context", () => {
    const result = buildDecisionPlan({
      signalText:
        "There may be a useful angle on approval workflow friction, but the signal is still thin.",
      sourceType: "note",
      targetRole: "Operations manager",
      relevanceScore: 53,
      bestAngle: "workflow_accountability",
      recommendedAction: "save_for_later"
    });

    expect(result.recommendedNextAction).toBe("save_for_later");
    expect(result.suggestedFlow).toBe("research_later");
    expect(result.shouldStoreForLater).toBe(true);
  });

  it("returns ignore for weak soft signals", () => {
    const result = buildDecisionPlan({
      signalText: "Leadership mindset and creative energy matter more than process.",
      sourceType: "other",
      targetRole: "Creator",
      relevanceScore: 14,
      bestAngle: "low_fit",
      recommendedAction: "ignore"
    });

    expect(result.recommendedNextAction).toBe("ignore");
    expect(result.suggestedFlow).toBe("ignore");
    expect(result.confidence).toBeLessThanOrEqual(45);
  });

  it("is deterministic and does not require provider input", () => {
    const input = {
      signalText: "Workflow memory breaks first when nobody owns the process.",
      sourceType: "manual" as const,
      targetRole: "Founder"
    };

    expect(buildDecisionPlan(input)).toEqual(buildDecisionPlan(input));
  });
});
