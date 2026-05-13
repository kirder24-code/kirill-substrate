import { describe, expect, it } from "vitest";
import { mapScoutFeedResultToReviewQueueItems } from "./autonomousReviewQueue";

describe("autonomousReviewQueue", () => {
  it("maps deterministic scout-feed outputs into durable review queue records", () => {
    const items = mapScoutFeedResultToReviewQueueItems({
      watchlistId: "auto-watch-1",
      autonomousRunId: "auto-run-1",
      sourceArtifactId: "ingest-1",
      audienceItems: [
        {
          id: "aud-1",
          sourcePlatform: "public_web",
          rawExcerpt: "Operators still patch broken handoffs manually after rollout.",
          painSignalSummary: "Operators still patch broken handoffs manually",
          whyItMatters: "This exposes a recurring workflow-accountability pain worth review.",
          suggestedActionType: "post_candidate",
          confidence: "high",
          createdAt: "2026-03-16T00:00:00.000Z"
        }
      ],
      solutionItems: [
        {
          id: "sol-1",
          sourceType: "article",
          rawExcerpt: "Expose status and one recovery owner when workflows stall.",
          solutionPattern: "Visibility and recovery ownership pattern",
          implementationLesson:
            "Expose status and one recovery owner when workflows stall.",
          tradeoffOrConstraint: "Extra coordination overhead if ownership stays vague.",
          whyItMatters: "Useful operator lesson for review.",
          suggestedAngle: "workflow_accountability",
          suggestedActionType: "later",
          confidence: "high",
          createdAt: "2026-03-16T00:00:00.000Z"
        }
      ]
    });

    expect(items).toEqual([
      expect.objectContaining({
        watchlistId: "auto-watch-1",
        autonomousRunId: "auto-run-1",
        sourceKind: "audience",
        recommendedAction: "write_post"
      }),
      expect.objectContaining({
        sourceKind: "solution",
        recommendedAction: "save_for_later"
      })
    ]);
  });

  it("normalizes empty optional AI enrichment fields out of queue records", () => {
    const items = mapScoutFeedResultToReviewQueueItems({
      watchlistId: "auto-watch-1",
      autonomousRunId: "auto-run-1",
      audienceItems: [
        {
          id: "aud-1",
          sourcePlatform: "public_web",
          rawExcerpt: "Operators still patch broken handoffs manually after rollout.",
          painSignalSummary: "Operators still patch broken handoffs manually",
          whyItMatters: "This exposes a recurring workflow-accountability pain worth review.",
          suggestedActionType: "comment_opportunity",
          confidence: "high",
          aiEnrichment: {
            improvedSummary: "   ",
            operatorAngle: " Frame it as an operator lesson. "
          },
          createdAt: "2026-03-16T00:00:00.000Z"
        }
      ]
    });

    expect(items[0]?.aiEnrichment).toEqual({
      improvedSummary: undefined,
      whyItMatters: undefined,
      businessConsequence: undefined,
      operatorAngle: "Frame it as an operator lesson.",
      uncertaintyNote: undefined
    });
    expect(items[0]?.recommendedAction).toBe("write_comment");
  });
});
