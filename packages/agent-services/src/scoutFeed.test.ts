import { describe, expect, it } from "vitest";
import { buildScoutFeedResult } from "./scoutFeed";

describe("scout feed", () => {
  it("routes public discussion inputs through the public discussion adapter safely", () => {
    const result = buildScoutFeedResult({
      mode: "mixed",
      items: [
        {
          sourceType: "public_web",
          sourceUrl: "https://www.linkedin.com/posts/example-thread",
          excerpt: "People in the thread keep saying the workflow is confusing and manual."
        }
      ]
    });

    expect(result.audienceItems).toHaveLength(1);
    expect(result.solutionItems).toBeUndefined();
    expect(result.notes).toContain("watched url snapshot");
    expect(result.adapterSummary).toEqual({
      families: ["watched_url_snapshot"],
      usedDeterministicFallback: false,
      compactLabel: "Routed as watched URL snapshot."
    });
    expect(result.audienceAdapterSummary).toEqual({
      families: ["watched_url_snapshot"],
      usedDeterministicFallback: false,
      compactLabel: "Routed as watched URL snapshot."
    });
    expect(result.audienceItems?.[0]?.adapterSummary).toEqual({
      family: "watched_url_snapshot",
      usedDeterministicFallback: false,
      compactLabel: "Routed as watched URL snapshot."
    });
    expect(result.solutionAdapterSummary).toBeUndefined();
  });

  it("routes GitHub-style inputs through the GitHub snapshot adapter safely", () => {
    const result = buildScoutFeedResult({
      mode: "mixed",
      items: [
        {
          sourceType: "public_web",
          sourceUrl: "https://github.com/example/repo/releases/tag/v1",
          excerpt: "The release adds retry ownership so teams can recover stalled workflows faster."
        }
      ]
    });

    expect(result.solutionItems).toHaveLength(1);
    expect(result.audienceItems).toBeUndefined();
    expect(result.notes).toContain("github snapshot");
    expect(result.adapterSummary).toEqual({
      families: ["github_snapshot"],
      usedDeterministicFallback: false,
      compactLabel: "Routed as GitHub snapshot."
    });
    expect(result.solutionAdapterSummary).toEqual({
      families: ["github_snapshot"],
      usedDeterministicFallback: false,
      compactLabel: "Routed as GitHub snapshot."
    });
    expect(result.solutionItems?.[0]?.adapterSummary).toEqual({
      family: "github_snapshot",
      usedDeterministicFallback: false,
      compactLabel: "Routed as GitHub snapshot."
    });
    expect(result.audienceAdapterSummary).toBeUndefined();
  });

  it("routes article or blog inputs through the article snapshot adapter safely", () => {
    const result = buildScoutFeedResult({
      mode: "mixed",
      items: [
        {
          sourceType: "public_web",
          sourceUrl: "https://example.com/blog/workflow-visibility",
          excerpt: "The case study exposed status and ownership before scaling automation."
        }
      ]
    });

    expect(result.solutionItems).toHaveLength(1);
    expect(result.audienceItems).toBeUndefined();
    expect(result.notes).toContain("article snapshot");
    expect(result.adapterSummary).toEqual({
      families: ["article_snapshot"],
      usedDeterministicFallback: false,
      compactLabel: "Routed as article snapshot."
    });
    expect(result.solutionAdapterSummary).toEqual({
      families: ["article_snapshot"],
      usedDeterministicFallback: false,
      compactLabel: "Routed as article snapshot."
    });
    expect(result.solutionItems?.[0]?.adapterSummary).toEqual({
      family: "article_snapshot",
      usedDeterministicFallback: false,
      compactLabel: "Routed as article snapshot."
    });
  });

  it("handles manual feed inputs safely without polluting other paths", () => {
    const result = buildScoutFeedResult({
      mode: "mixed",
      items: [
        {
          sourceType: "manual_research",
          excerpt:
            "Operator note: make recovery ownership visible before the workflow hits its first failure path."
        }
      ]
    });

    expect(result.solutionItems).toHaveLength(1);
    expect(result.audienceItems).toBeUndefined();
    expect(result.notes).toContain("manual feed");
    expect(result.adapterSummary).toEqual({
      families: ["manual_feed"],
      usedDeterministicFallback: false,
      compactLabel: "Routed as manual feed."
    });
    expect(result.solutionAdapterSummary).toEqual({
      families: ["manual_feed"],
      usedDeterministicFallback: false,
      compactLabel: "Routed as manual feed."
    });
    expect(result.solutionItems?.[0]?.adapterSummary).toEqual({
      family: "manual_feed",
      usedDeterministicFallback: false,
      compactLabel: "Routed as manual feed."
    });
  });

  it("handles watched URL snapshots safely and distinctly", () => {
    const result = buildScoutFeedResult({
      mode: "mixed",
      items: [
        {
          sourceType: "public_web",
          sourceUrl: "https://example.com/discussions/workflow-chaos",
          excerpt: "Users in the discussion keep saying they cannot see where work gets stuck."
        }
      ]
    });

    expect(result.audienceItems).toHaveLength(1);
    expect(result.solutionItems).toBeUndefined();
    expect(result.notes).toContain("watched url snapshot");
    expect(result.adapterSummary).toEqual({
      families: ["watched_url_snapshot"],
      usedDeterministicFallback: false,
      compactLabel: "Routed as watched URL snapshot."
    });
    expect(result.audienceAdapterSummary).toEqual({
      families: ["watched_url_snapshot"],
      usedDeterministicFallback: false,
      compactLabel: "Routed as watched URL snapshot."
    });
    expect(result.audienceItems?.[0]?.adapterSummary).toEqual({
      family: "watched_url_snapshot",
      usedDeterministicFallback: false,
      compactLabel: "Routed as watched URL snapshot."
    });
  });

  it("degrades mixed or ambiguous inputs safely", () => {
    const result = buildScoutFeedResult({
      mode: "mixed",
      items: [{ sourceType: "mixed", excerpt: "Interesting update." }]
    });

    expect(result.notes).toContain("deterministic fallback");
    expect(result.adapterSummary).toEqual({
      families: ["public_discussion"],
      usedDeterministicFallback: true,
      compactLabel: "Routed as public discussion."
    });
    expect(result.audienceAdapterSummary).toEqual({
      families: ["public_discussion"],
      usedDeterministicFallback: true,
      compactLabel: "Routed as public discussion."
    });
    expect(result.audienceItems?.[0]?.adapterSummary).toEqual({
      family: "public_discussion",
      usedDeterministicFallback: true,
      compactLabel: "Routed as public discussion."
    });
    expect(
      (result.audienceItems?.[0]?.confidence ?? result.solutionItems?.[0]?.confidence) === "low"
    ).toBe(true);
  });

  it("summarizes mixed adapter families safely in structured metadata", () => {
    const result = buildScoutFeedResult({
      mode: "mixed",
      items: [
        {
          sourceType: "public_web",
          sourceUrl: "https://github.com/example/repo/releases/tag/v1",
          excerpt: "The release adds retry ownership so teams can recover stalled workflows faster."
        },
        {
          sourceType: "public_web",
          sourceUrl: "https://example.com/discussions/workflow-chaos",
          excerpt: "Users keep saying they cannot see where work gets stuck."
        }
      ]
    });

    expect(result.adapterSummary).toEqual({
      families: ["github_snapshot", "watched_url_snapshot"],
      usedDeterministicFallback: false,
      compactLabel: "Routed through mixed source adapters."
    });
    expect(result.audienceAdapterSummary).toEqual({
      families: ["watched_url_snapshot"],
      usedDeterministicFallback: false,
      compactLabel: "Routed as watched URL snapshot."
    });
    expect(result.solutionAdapterSummary).toEqual({
      families: ["github_snapshot"],
      usedDeterministicFallback: false,
      compactLabel: "Routed as GitHub snapshot."
    });
    expect(result.audienceItems?.[0]?.adapterSummary).toEqual({
      family: "watched_url_snapshot",
      usedDeterministicFallback: false,
      compactLabel: "Routed as watched URL snapshot."
    });
    expect(result.solutionItems?.[0]?.adapterSummary).toEqual({
      family: "github_snapshot",
      usedDeterministicFallback: false,
      compactLabel: "Routed as GitHub snapshot."
    });
  });

  it("returns a safe empty result when the batch has no usable excerpts", () => {
    const result = buildScoutFeedResult({
      mode: "audience",
      items: [{ excerpt: "   " }]
    });

    expect(result.audienceItems).toBeUndefined();
    expect(result.solutionItems).toBeUndefined();
    expect(result.summary).toContain("No strong scout feed items found");
  });

  it("is deterministic for the same batch input", () => {
    const input = {
      mode: "mixed" as const,
      items: [
        {
          sourceType: "public_web" as const,
          excerpt: "Nobody owns recovery once the workflow breaks."
        },
        {
          sourceType: "manual_research" as const,
          excerpt: "Make recovery ownership visible before the workflow hits its first failure path."
        }
      ]
    };

    expect(buildScoutFeedResult(input)).toEqual(buildScoutFeedResult(input));
  });
});
