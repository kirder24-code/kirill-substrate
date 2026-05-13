import { describe, expect, it } from "vitest";
import { prioritizeAutonomousMatchedOpportunity } from "./autonomousPrioritizedOpportunity";

describe("autonomousPrioritizedOpportunity", () => {
  it("assigns stable deterministic priority fields to strong matched opportunities", () => {
    const prioritized = prioritizeAutonomousMatchedOpportunity({
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      audienceQueueItemId: "aud-1",
      solutionQueueItemId: "sol-1",
      dedupeKey: "aud-1:sol-1",
      title: "Broken handoffs + recovery ownership",
      matchedPain: "Broken handoffs keep stalling operators",
      matchedSolutionPattern: "Recovery ownership pattern",
      matchRationale: "The pattern directly addresses the same ownership gap.",
      suggestedAngle: "workflow_accountability",
      recommendedAction: "write_post",
      confidence: "high",
      opportunityStrength: "strong",
      scoreNotes: ["High overlap", "Both sides are actionable"]
    });

    expect(prioritized.priorityScore).toBe(96);
    expect(prioritized.priorityBand).toBe("high");
    expect(prioritized.reasonLines).toEqual([
      "High-confidence match with strong opportunity strength.",
      "Write-post urgency keeps this pair near the top of the review order.",
      "Match evidence includes 2 supporting score notes."
    ]);
  });

  it("keeps lower-signal matched opportunities reviewable without inventing urgency", () => {
    const prioritized = prioritizeAutonomousMatchedOpportunity({
      watchlistId: "watch-1",
      autonomousRunId: "run-1",
      audienceQueueItemId: "aud-2",
      solutionQueueItemId: "sol-2",
      dedupeKey: "aud-2:sol-2",
      title: "Light pattern overlap",
      matchedPain: "Operators mention the issue occasionally",
      matchedSolutionPattern: "Lightweight follow-up pattern",
      matchRationale: "The overlap is real but still weak.",
      suggestedAngle: "operational_roi",
      recommendedAction: "save_for_later",
      confidence: "low",
      opportunityStrength: "weak"
    });

    expect(prioritized.priorityScore).toBe(23);
    expect(prioritized.priorityBand).toBe("low");
    expect(prioritized.reasonLines).toEqual([
      "Low-confidence match with weak opportunity strength.",
      "Save-for-later review value keeps this pair near the top of the review order."
    ]);
  });
});
