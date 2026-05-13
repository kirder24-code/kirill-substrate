import { describe, expect, it } from "vitest";
import { mapAutonomousReviewQueueToMatchedOpportunities } from "./autonomousMatchedOpportunity";

describe("autonomousMatchedOpportunity", () => {
  it("matches durable autonomous review queue items deterministically", () => {
    const items = mapAutonomousReviewQueueToMatchedOpportunities({
      watchlistId: "auto-watch-1",
      autonomousRunId: "auto-run-1",
      queueItems: [
        {
          id: "review-aud-1",
          watchlistId: "auto-watch-1",
          autonomousRunId: "auto-run-1",
          sourceKind: "audience",
          dedupeKey: "aud",
          title: "Operators still patch broken handoffs manually",
          summary: "Operators still patch broken handoffs manually after rollout.",
          rationale: "This exposes a recurring workflow-accountability pain worth review.",
          recommendedAction: "write_post",
          status: "new",
          createdAt: "2026-03-16T00:00:00.000Z",
          updatedAt: "2026-03-16T00:00:00.000Z"
        },
        {
          id: "review-sol-1",
          watchlistId: "auto-watch-1",
          autonomousRunId: "auto-run-1",
          sourceKind: "solution",
          dedupeKey: "sol",
          title: "Visibility and recovery ownership pattern",
          summary: "Expose status and one recovery owner when workflows stall.",
          rationale: "Useful operator lesson for review.",
          recommendedAction: "write_post",
          status: "new",
          createdAt: "2026-03-16T00:00:00.000Z",
          updatedAt: "2026-03-16T00:00:00.000Z"
        }
      ]
    });

    expect(items).toEqual([
      expect.objectContaining({
        watchlistId: "auto-watch-1",
        autonomousRunId: "auto-run-1",
        audienceQueueItemId: "review-aud-1",
        solutionQueueItemId: "review-sol-1",
        recommendedAction: "write_post",
        matchRationale: expect.any(String),
        priorityScore: expect.any(Number),
        priorityBand: expect.stringMatching(/high|medium|low/),
        reasonLines: expect.arrayContaining([expect.any(String)])
      })
    ]);
  });

  it("returns no matched opportunities when the durable queue lacks one side of the match", () => {
    const items = mapAutonomousReviewQueueToMatchedOpportunities({
      watchlistId: "auto-watch-1",
      autonomousRunId: "auto-run-1",
      queueItems: [
        {
          id: "review-aud-1",
          watchlistId: "auto-watch-1",
          autonomousRunId: "auto-run-1",
          sourceKind: "audience",
          dedupeKey: "aud",
          title: "Operators still patch broken handoffs manually",
          summary: "Operators still patch broken handoffs manually after rollout.",
          rationale: "This exposes a recurring workflow-accountability pain worth review.",
          recommendedAction: "write_post",
          status: "new",
          createdAt: "2026-03-16T00:00:00.000Z",
          updatedAt: "2026-03-16T00:00:00.000Z"
        }
      ]
    });

    expect(items).toEqual([]);
  });

  it("only generates matched opportunities that involve the active queue items for the current run", () => {
    const items = mapAutonomousReviewQueueToMatchedOpportunities({
      watchlistId: "auto-watch-2",
      autonomousRunId: "auto-run-2",
      queueItems: [
        {
          id: "review-aud-1",
          watchlistId: "auto-watch-1",
          autonomousRunId: "auto-run-1",
          sourceKind: "audience",
          dedupeKey: "aud-1",
          title: "Operators still patch broken handoffs manually",
          summary: "Operators still patch broken handoffs manually after rollout.",
          rationale: "Recurring workflow-accountability pain.",
          recommendedAction: "write_post",
          status: "new",
          createdAt: "2026-03-16T00:00:00.000Z",
          updatedAt: "2026-03-16T00:00:00.000Z"
        },
        {
          id: "review-sol-1",
          watchlistId: "auto-watch-1",
          autonomousRunId: "auto-run-1",
          sourceKind: "solution",
          dedupeKey: "sol-1",
          title: "Visibility and recovery ownership pattern",
          summary: "Expose status and one recovery owner when workflows stall.",
          rationale: "Useful operator lesson for review.",
          recommendedAction: "write_post",
          status: "new",
          createdAt: "2026-03-16T00:00:00.000Z",
          updatedAt: "2026-03-16T00:00:00.000Z"
        },
        {
          id: "review-sol-2",
          watchlistId: "auto-watch-2",
          autonomousRunId: "auto-run-2",
          sourceKind: "solution",
          dedupeKey: "sol-2",
          title: "Approval-state visibility and retry ownership pattern",
          summary: "Expose approval-state visibility and one retry owner when workflows stall.",
          rationale: "Useful operator lesson for review.",
          recommendedAction: "write_post",
          status: "new",
          createdAt: "2026-03-17T00:00:00.000Z",
          updatedAt: "2026-03-17T00:00:00.000Z"
        }
      ],
      activeQueueItems: [
        {
          id: "review-sol-2",
          watchlistId: "auto-watch-2",
          autonomousRunId: "auto-run-2",
          sourceKind: "solution",
          dedupeKey: "sol-2",
          title: "Approval-state visibility and retry ownership pattern",
          summary: "Expose approval-state visibility and one retry owner when workflows stall.",
          rationale: "Useful operator lesson for review.",
          recommendedAction: "write_post",
          status: "new",
          createdAt: "2026-03-17T00:00:00.000Z",
          updatedAt: "2026-03-17T00:00:00.000Z"
        }
      ]
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(
      expect.objectContaining({
        watchlistId: "auto-watch-2",
        autonomousRunId: "auto-run-2",
        audienceQueueItemId: "review-aud-1",
        solutionQueueItemId: "review-sol-2",
        dedupeKey: "review-aud-1:review-sol-2"
      })
    );
  });
});
