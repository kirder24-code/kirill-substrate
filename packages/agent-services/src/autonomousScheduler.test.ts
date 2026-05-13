import { describe, expect, it } from "vitest";
import type { AutonomousWatchlist } from "@linkedin-brand-os/shared";
import {
  buildScoutFeedInputFromAutonomousWatchlist,
  computeNextAutonomousWatchlistRunAt,
  isAutonomousWatchlistDue
} from "./autonomousScheduler";

function buildWatchlist(
  overrides: Partial<AutonomousWatchlist> = {}
): AutonomousWatchlist {
  return {
    id: "auto-watch-1",
    sourceKind: "public_discussion_source",
    label: "Workflow pain watchlist",
    sourceUrl: "https://example.com/discussions/workflow",
    notes: "Server-side watchlist",
    seedExcerpt: "Operators still patch launch handoffs manually.",
    targetProblem: "workflow handoff failures",
    refreshCadence: "daily_candidate",
    priority: "high",
    isActive: true,
    createdAt: "2026-03-15T00:00:00.000Z",
    updatedAt: "2026-03-15T00:00:00.000Z",
    ...overrides
  };
}

describe("autonomous scheduler helpers", () => {
  it("detects due watchlists deterministically", () => {
    const due = buildWatchlist({
      nextRunAt: "2026-03-16T00:00:00.000Z"
    });
    const notDue = buildWatchlist({
      id: "auto-watch-2",
      nextRunAt: "2026-03-17T00:00:00.000Z"
    });

    expect(isAutonomousWatchlistDue(due, "2026-03-16T00:00:00.000Z")).toBe(true);
    expect(isAutonomousWatchlistDue(notDue, "2026-03-16T00:00:00.000Z")).toBe(false);
  });

  it("skips disabled and manual-only watchlists", () => {
    const disabled = buildWatchlist({ isActive: false });
    const manualOnly = buildWatchlist({ refreshCadence: "manual_only" });

    expect(isAutonomousWatchlistDue(disabled, "2026-03-16T00:00:00.000Z")).toBe(false);
    expect(isAutonomousWatchlistDue(manualOnly, "2026-03-16T00:00:00.000Z")).toBe(false);
  });

  it("computes next run times from cadence deterministically", () => {
    expect(
      computeNextAutonomousWatchlistRunAt(
        "daily_candidate",
        "2026-03-16T00:00:00.000Z"
      )
    ).toBe("2026-03-17T00:00:00.000Z");
    expect(
      computeNextAutonomousWatchlistRunAt(
        "weekly_candidate",
        "2026-03-16T00:00:00.000Z"
      )
    ).toBe("2026-03-23T00:00:00.000Z");
    expect(
      computeNextAutonomousWatchlistRunAt("manual_only", "2026-03-16T00:00:00.000Z")
    ).toBeUndefined();
  });

  it("builds a deterministic scout-feed input from a persisted watchlist", () => {
    const input = buildScoutFeedInputFromAutonomousWatchlist(
      buildWatchlist({ sourceKind: "github_release" })
    );

    expect(input).toEqual({
      mode: "solution",
      items: [
        expect.objectContaining({
          sourceType: "github",
          sourceLabel: "Workflow pain watchlist",
          excerpt: "Operators still patch launch handoffs manually.",
          targetProblem: "workflow handoff failures"
        })
      ]
    });
  });
});
