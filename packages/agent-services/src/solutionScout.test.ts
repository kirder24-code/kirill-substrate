import { describe, expect, it } from "vitest";
import { buildSolutionScoutResult, classifySolutionPattern } from "./solutionScout";

describe("solution scout", () => {
  it("produces structured solution items with the expected shape", () => {
    const result = buildSolutionScoutResult({
      sourceType: "github",
      sourceLabel: "GitHub release",
      sourceExcerpt:
        "The release adds approval-state visibility and retry ownership so teams can recover stalled workflows faster."
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        sourceType: "github",
        solutionPattern: expect.any(String),
        implementationLesson: expect.any(String),
        tradeoffOrConstraint: expect.any(String),
        whyItMatters: expect.any(String),
        suggestedAngle: expect.any(String),
        suggestedActionType: expect.any(String),
        confidence: expect.any(String)
      })
    ]);
  });

  it("extracts practical implementation lessons from source excerpts", () => {
    const result = buildSolutionScoutResult({
      sourceType: "article",
      sourceExcerpt:
        "The case study shows that rollout only stabilized after the team exposed status and ownership before scaling automation."
    });

    expect(result.items[0]?.implementationLesson.toLowerCase()).toMatch(
      /status|ownership|rollout|automation/
    );
  });

  it("surfaces a tradeoff or constraint signal", () => {
    const result = buildSolutionScoutResult({
      sourceType: "manual_research",
      sourceExcerpt:
        "Operators reduced support escalations by simplifying the workflow, but they had to add more up-front implementation clarity."
    });

    expect(result.items[0]?.tradeoffOrConstraint.toLowerCase()).toMatch(
      /tradeoff|complexity|clarity|up front|visibility|overhead/
    );
  });

  it("biases the result toward the provided target problem", () => {
    const result = buildSolutionScoutResult({
      sourceType: "github",
      targetProblem: "workflow handoff failures",
      sourceExcerpt:
        "The release adds approval-state visibility and retry ownership so teams can recover stalled workflows faster."
    });

    expect(result.items[0]?.whyItMatters).toContain("workflow handoff failures");
    expect(result.items[0]?.suggestedActionType).toBe("post_candidate");
  });

  it("returns a safe low-confidence result for weak source material", () => {
    const result = buildSolutionScoutResult({
      sourceExcerpt: "Interesting tool update."
    });

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        confidence: "low",
        suggestedActionType: "later",
        signalStrength: "weak"
      })
    );
  });

  it("scores specific implementation lessons stronger than vague solution text", () => {
    const strong = buildSolutionScoutResult({
      sourceType: "github",
      targetProblem: "approval handoff failures",
      sourceExcerpt:
        "The release adds retry ownership, approval-state visibility, and a recovery queue so operators can see stalled workflows before support escalations spike, but it adds extra coordination overhead."
    });
    const weak = buildSolutionScoutResult({
      sourceType: "manual_research",
      sourceExcerpt: "This tool seems useful for teams."
    });

    expect(strong.items[0]).toEqual(
      expect.objectContaining({
        confidence: "high",
        signalStrength: "strong",
        scoreNotes: expect.arrayContaining([
          expect.stringMatching(/implementation|tradeoff|business consequence/i)
        ])
      })
    );
    expect(weak.items[0]).toEqual(
      expect.objectContaining({
        confidence: "low",
        signalStrength: "weak"
      })
    );
  });

  it("classifies solution patterns deterministically", () => {
    expect(
      classifySolutionPattern({
        sourceType: "github",
        sourceExcerpt:
          "Adds approval-state visibility and retry ownership so teams can recover stalled workflows faster."
      })
    ).toBe("exception_recovery");

    expect(
      classifySolutionPattern({
        sourceType: "article",
        sourceExcerpt:
          "The team reduced support confusion by making the workflow legible in the product."
      })
    ).toBe("support_reduction");
  });

  it("is deterministic for the same input", () => {
    const input = {
      sourceType: "manual_research" as const,
      targetProblem: "support friction",
      sourceExcerpt:
        "Operators reduced support escalations by simplifying the workflow, but they had to add more up-front implementation clarity."
    };

    expect(buildSolutionScoutResult(input)).toEqual(buildSolutionScoutResult(input));
  });
});
