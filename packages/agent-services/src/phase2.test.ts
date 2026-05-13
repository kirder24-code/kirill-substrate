import { describe, expect, it } from "vitest";
import type { AnalyticsSnapshot, ContentAsset } from "@linkedin-brand-os/shared";
import { analyticsAgent } from "./analyticsAgent";
import { strategyAgent } from "./strategyAgent";
import { visualAgent } from "./visualAgent";
import { voiceEditorAgent } from "./voiceEditorAgent";

describe("phase 2 agents", () => {
  const content: ContentAsset = {
    id: "content-1",
    ideaId: "idea-1",
    contentType: "linkedin-post",
    hook: "Most teams miss this about AI rollout",
    body: "AI rollout often stalls because the business case stays too vague. Teams need clearer operational language.",
    cta: "Tell me what you are seeing.",
    status: "draft",
    createdAt: "2026-03-14T00:00:00.000Z"
  };

  it("voiceEditorAgent produces a more natural refined draft", async () => {
    const refined = await voiceEditorAgent({ content });

    expect(refined).toEqual({
      refinedHook: expect.stringContaining("What leaders actually need"),
      refinedBody: expect.stringContaining("business case"),
      refinedCta: expect.stringContaining("compare notes"),
      refinementStatus: "refined"
    });
  });

  it("visualAgent creates a deterministic visual brief", async () => {
    const visual = await visualAgent({ content });

    expect(visual).toEqual({
      title: expect.stringContaining("Visual brief"),
      visualType: "single-image",
      prompt: expect.stringContaining(content.hook),
      status: "ready"
    });
  });

  it("analyticsAgent summarizes performance findings", async () => {
    const snapshots: AnalyticsSnapshot[] = [
      {
        id: "analytics-1",
        contentAssetId: "content-1",
        impressions: 1200,
        likes: 80,
        comments: 15,
        saves: 10,
        profileViews: 20,
        followersGained: 5,
        createdAt: "2026-03-14T00:00:00.000Z"
      },
      {
        id: "analytics-2",
        contentAssetId: "content-2",
        impressions: 800,
        likes: 24,
        comments: 4,
        saves: 3,
        profileViews: 9,
        followersGained: 1,
        createdAt: "2026-03-15T00:00:00.000Z"
      }
    ];

    const findings = await analyticsAgent({ snapshots });

    expect(findings.bestPerformingContentId).toBe("content-1");
    expect(findings.averageEngagementRate).toBeGreaterThan(0);
    expect(findings.notes.length).toBeGreaterThan(0);
  });

  it("strategyAgent creates deterministic recommendations from findings", async () => {
    const recommendations = await strategyAgent({
      findings: {
        bestPerformingContentId: "content-1",
        averageEngagementRate: 0.09,
        notes: [
          "Visual-linked posts are producing above-average engagement.",
          "Founder-facing operational posts are performing best."
        ]
      },
      contentAssets: [content]
    });

    expect(recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: expect.stringContaining("founder-facing"),
          priority: "high"
        }),
        expect.objectContaining({
          title: expect.stringContaining("Visuals"),
          priority: "medium"
        })
      ])
    );
  });

  it("strategyAgent leans into strong feedback patterns and cautions on weak ones", async () => {
    const recommendations = await strategyAgent({
      findings: {
        bestPerformingContentId: "content-1",
        averageEngagementRate: 0.09,
        notes: ["Founder-facing operational posts are performing best."]
      },
      contentAssets: [content],
      feedbackSummary: {
        strongPatterns: ["Workflow accountability themes are performing well."],
        weakPatterns: ["Generic AI commentary is weak."],
        suggestedRepeats: ["Repeat workflow accountability angles."],
        suggestedAvoids: ["Avoid generic AI commentary this week."],
        reasoningSummary: "Use feedback to sharpen strategy.",
        totalRecords: 3
      }
    });

    expect(recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Repeat the strongest operator themes",
          priority: "high"
        }),
        expect.objectContaining({
          title: "Deprioritize weaker patterns this week",
          priority: "medium"
        })
      ])
    );
  });

  it("strategyAgent remains deterministic with the same feedback summary", async () => {
    const input = {
      findings: {
        bestPerformingContentId: "content-1",
        averageEngagementRate: 0.09,
        notes: ["Founder-facing operational posts are performing best."]
      },
      contentAssets: [content],
      feedbackSummary: {
        strongPatterns: ["Workflow accountability themes are performing well."],
        weakPatterns: [],
        suggestedRepeats: ["Repeat workflow accountability angles."],
        suggestedAvoids: [],
        reasoningSummary: "Use feedback to sharpen strategy.",
        totalRecords: 1
      }
    };

    expect(await strategyAgent(input)).toEqual(await strategyAgent(input));
  });

  it("strategyAgent adds long-term pattern-memory guidance additively", async () => {
    const recommendations = await strategyAgent({
      findings: {
        bestPerformingContentId: "content-1",
        averageEngagementRate: 0.09,
        notes: ["Founder-facing operational posts are performing best."]
      },
      contentAssets: [content],
      patternMemorySummary: {
        repeatPatterns: [
          {
            id: "repeat:final_post:final posts",
            label: "final posts",
            kind: "repeat",
            artifactType: "final_post",
            strength: 4,
            occurrences: 2,
            lastSeenAt: "2026-03-15T00:00:00.000Z",
            source: "feedback"
          }
        ],
        avoidPatterns: [
          {
            id: "avoid:comment:generic engagement",
            label: "generic engagement",
            kind: "avoid",
            artifactType: "comment",
            strength: 2,
            occurrences: 1,
            lastSeenAt: "2026-03-15T00:00:00.000Z",
            source: "feedback"
          }
        ],
        recurringThemes: ["final posts"],
        weakThemes: ["generic engagement"],
        notes: "Memory favors final posts and cautions on generic engagement.",
        totalPatterns: 2
      }
    });

    expect(recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Reinforce recurring long-term themes"
        }),
        expect.objectContaining({
          title: "Keep recurring weak themes deprioritized"
        })
      ])
    );
  });
});
