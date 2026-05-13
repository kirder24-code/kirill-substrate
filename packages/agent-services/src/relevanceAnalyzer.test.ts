import { describe, expect, it } from "vitest";
import { relevanceAnalyzer } from "./relevanceAnalyzer";

describe("relevance analyzer", () => {
  it("scores founder/operator workflow pain as high relevance", async () => {
    const result = await relevanceAnalyzer({
      roleTitle: "Founder",
      companyText: "We help B2B teams fix GTM operations and handoffs.",
      postText:
        "Most automation fails because nobody owns the workflow after launch. The handoff between sales and ops stays messy.",
      websiteAboutText: "Operational systems for revenue teams."
    });

    expect(result.relevanceScore).toBeGreaterThanOrEqual(75);
    expect(result.bestAngle).toMatch(/ownership_gap|handoff_failure|workflow_accountability/);
    expect(result.recommendedAction).toBe("comment");
  });

  it("scores unrelated audience as low relevance", async () => {
    const result = await relevanceAnalyzer({
      roleTitle: "Lifestyle Creator",
      companyText: "Personal wellness and travel content.",
      postText: "Morning habits and gym consistency matter more than tools."
    });

    expect(result.relevanceScore).toBeLessThan(40);
    expect(result.bestAngle).toBe("low_fit");
    expect(result.recommendedAction).toBe("ignore");
  });

  it("chooses reply when there is comment context and relevance is high", async () => {
    const result = await relevanceAnalyzer({
      roleTitle: "VP Operations",
      postText:
        "The workflow breaks on exception handling and ownership, not on the model itself.",
      hasCommentContext: true
    });

    expect(result.recommendedAction).toBe("reply");
    expect(result.bestAngle).toMatch(/exception_handling|ownership_gap|workflow_accountability/);
  });

  it("uses save for later for medium relevance", async () => {
    const result = await relevanceAnalyzer({
      roleTitle: "Sales Manager",
      postText: "We need better automation in outbound and cleaner follow-up.",
      companyText: "B2B sales team"
    });

    expect(result.relevanceScore).toBeGreaterThanOrEqual(35);
    expect(result.recommendedAction).toBe("save_for_later");
  });
});
