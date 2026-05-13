import { describe, expect, it, vi } from "vitest";
import type { AutonomousWatchlist } from "@linkedin-brand-os/shared";
import {
  buildSourceIntakeInput,
  ingestWatchlistSources,
  supportsAutomatedUrlIngestion
} from "./watchlistSourceIngestion";

function buildWatchlist(
  overrides: Partial<AutonomousWatchlist> = {}
): AutonomousWatchlist {
  return {
    id: "auto-watch-1",
    sourceKind: "article_source",
    label: "Workflow article watchlist",
    sourceUrl: "https://example.com/article",
    notes: "Operator-focused intake",
    seedExcerpt: "Teams still patch broken handoffs manually after launch.",
    targetProblem: "workflow handoff failures",
    refreshCadence: "daily_candidate",
    priority: "high",
    isActive: true,
    createdAt: "2026-03-15T00:00:00.000Z",
    updatedAt: "2026-03-15T00:00:00.000Z",
    ...overrides
  };
}

describe("watchlistSourceIngestion", () => {
  it("maps autonomous watchlists to deterministic source intake inputs", () => {
    const intake = buildSourceIntakeInput(buildWatchlist(), {
      title: "Workflow failures after launch",
      bodyText: "Teams still patch broken handoffs manually after launch."
    });

    expect(intake).toEqual({
      sourceType: "article",
      title: "Workflow failures after launch",
      sourceUrl: "https://example.com/article",
      summaryText: "Teams still patch broken handoffs manually after launch.",
      operatorNotes: "Operator-focused intake"
    });
  });

  it("ingests a URL-backed watchlist server-side without AI providers", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      text: async () =>
        "<html><title>Workflow failures after launch</title><body>Teams still patch broken handoffs manually after launch because ownership stays vague.</body></html>"
    } as Response);

    const result = await ingestWatchlistSources(buildWatchlist(), "auto-run-1", {
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledWith("https://example.com/article");
    expect(result.artifacts).toEqual([
      expect.objectContaining({
        autonomousRunId: "auto-run-1",
        status: "ingested",
        normalizedSignalText: expect.stringContaining("ownership"),
        suggestedAngle: expect.any(String)
      })
    ]);
    expect(result.scoutFeedInput).toEqual(
      expect.objectContaining({
        mode: "solution",
        items: [
          expect.objectContaining({
            excerpt: expect.stringContaining("ownership"),
            sourceType: "article"
          })
        ]
      })
    );
  });

  it("handles fetch failures safely and visibly", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("network down"));

    const result = await ingestWatchlistSources(buildWatchlist(), "auto-run-1", {
      fetchImpl
    });

    expect(result.scoutFeedInput).toBeUndefined();
    expect(result.artifacts).toEqual([
      expect.objectContaining({
        status: "failed",
        errorSummary: "network down"
      })
    ]);
  });

  it("handles empty fetched payloads safely", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      text: async () => "<html><title>Workflow</title><body>   </body></html>"
    } as Response);

    const result = await ingestWatchlistSources(buildWatchlist(), "auto-run-1", {
      fetchImpl
    });

    expect(result.scoutFeedInput).toBeUndefined();
    expect(result.artifacts).toEqual([
      expect.objectContaining({
        status: "empty"
      })
    ]);
  });

  it("only treats narrow URL-backed watchlists as automated-ingestion candidates", () => {
    expect(supportsAutomatedUrlIngestion(buildWatchlist())).toBe(true);
    expect(
      supportsAutomatedUrlIngestion(
        buildWatchlist({
          sourceKind: "github_release",
          sourceUrl: "https://github.com/example/repo/releases"
        })
      )
    ).toBe(false);
    expect(
      supportsAutomatedUrlIngestion(buildWatchlist({ sourceUrl: undefined }))
    ).toBe(false);
  });
});
