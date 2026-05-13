import { describe, expect, it } from "vitest";
import { buildEngagementAdaptationPlan } from "./engagementAdaptation";

describe("engagement adaptation plan", () => {
  it("maps high relevance founder/operator execution cases to strategic execution mode", () => {
    const plan = buildEngagementAdaptationPlan({
      relevanceScore: 88,
      bestAngle: "ownership_gap",
      recommendedAction: "comment",
      targetRole: "Founder and operator",
      hasCommentContext: false,
      generationType: "comment"
    });

    expect(plan.engagementMode).toBe("strategic_execution");
    expect(plan.shouldGenerate).toBe(true);
    expect(plan.angleDirective).toBe("ownership_gap");
  });

  it("maps medium relevance cases to light positioning mode", () => {
    const plan = buildEngagementAdaptationPlan({
      relevanceScore: 56,
      bestAngle: "workflow_accountability",
      recommendedAction: "save_for_later",
      targetRole: "Operations manager",
      hasCommentContext: false,
      generationType: "comment"
    });

    expect(plan.engagementMode).toBe("insight_light_positioning");
    expect(plan.shouldGenerate).toBe(true);
    expect(plan.depthDirective).toBe("brief");
  });

  it("maps outreach candidate cases to bridge mode", () => {
    const plan = buildEngagementAdaptationPlan({
      relevanceScore: 41,
      bestAngle: "operational_roi",
      recommendedAction: "outreach_candidate",
      targetRole: "Founder",
      hasCommentContext: true,
      generationType: "reply"
    });

    expect(plan.engagementMode).toBe("bridge_outreach_aware");
    expect(plan.shouldGenerate).toBe(true);
    expect(plan.closingStyle).toBe("bridge");
  });

  it("maps low relevance cases to neutral or skip mode", () => {
    const plan = buildEngagementAdaptationPlan({
      relevanceScore: 18,
      bestAngle: "low_fit",
      recommendedAction: "ignore",
      targetRole: "Lifestyle creator",
      hasCommentContext: false,
      generationType: "comment"
    });

    expect(plan.engagementMode).toBe("neutral_or_skip");
    expect(plan.shouldGenerate).toBe(false);
    expect(plan.riskFlags).toContain("low_relevance");
  });
});
