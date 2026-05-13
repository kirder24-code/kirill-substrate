import { describe, expect, it } from "vitest";
import type { Idea, MarketProfile, SourceItem, TopicScore } from "@linkedin-brand-os/shared";
import { marketIntelligenceAgent } from "./marketIntelligenceAgent";
import { queuePlannerAgent } from "./queuePlannerAgent";
import { sourceNormalizerAgent } from "./sourceNormalizerAgent";
import { topicScoringAgent } from "./topicScoringAgent";

describe("phase 3 agents", () => {
  it("sourceNormalizerAgent structures safe manual/open-source intake", async () => {
    const normalized = await sourceNormalizerAgent({
      title: "Public article on operator-led AI rollout",
      sourceType: "article",
      rawText: "Open-source article about operator-led AI rollout patterns and practical examples."
    });

    expect(normalized).toEqual({
      normalizedSummary: expect.stringContaining("Open-source"),
      tags: expect.arrayContaining(["ai", "operators"]),
      status: "normalized"
    });
  });

  it("marketIntelligenceAgent derives a structured market profile", async () => {
    const market = await marketIntelligenceAgent({
      country: "Canada",
      region: "North America",
      primaryLanguage: "English",
      marketNote: "Strong B2B operator and consulting audience."
    });

    expect(market).toEqual({
      marketNote: expect.stringContaining("Strong B2B operator"),
      linkedinPriority: "high",
      serviceFitScore: expect.any(Number)
    });
  });

  it("topicScoringAgent scores topics from sources, ideas, and markets", async () => {
    const sources: SourceItem[] = [
      {
        id: "source-1",
        title: "AI rollout operations",
        sourceType: "article",
        rawText: "Operator-led AI rollout examples",
        normalizedSummary: "Operator-led AI rollout examples",
        tags: ["ai", "operations"],
        status: "normalized",
        createdAt: "2026-03-14T00:00:00.000Z"
      }
    ];
    const ideas: Idea[] = [
      {
        id: "idea-1",
        signalId: "sig-1",
        title: "Operator content systems",
        coreInsight: "Practical operator content works better.",
        businessRelevance: "Better pipeline quality.",
        targetAudience: "Founders",
        status: "draft",
        createdAt: "2026-03-14T00:00:00.000Z"
      }
    ];
    const markets: MarketProfile[] = [
      {
        id: "market-1",
        country: "Canada",
        region: "North America",
        primaryLanguage: "English",
        marketNote: "High fit market",
        linkedinPriority: "high",
        serviceFitScore: 82,
        createdAt: "2026-03-14T00:00:00.000Z"
      }
    ];

    const scores = await topicScoringAgent({ sources, ideas, markets });

    expect(scores.length).toBeGreaterThan(0);
    expect(scores[0]).toEqual(
      expect.objectContaining({
        topicLabel: expect.any(String),
        brandRelevanceScore: expect.any(Number),
        marketRelevanceScore: expect.any(Number),
        noveltyScore: expect.any(Number),
        priorityScore: expect.any(Number),
        rationale: expect.any(String)
      })
    );
  });

  it("queuePlannerAgent generates prioritized queue items", async () => {
    const scores: TopicScore[] = [
      {
        id: "topic-1",
        topicLabel: "Founder operations",
        brandRelevanceScore: 85,
        marketRelevanceScore: 82,
        noveltyScore: 60,
        priorityScore: 81,
        rationale: "Strong fit",
        createdAt: "2026-03-14T00:00:00.000Z"
      },
      {
        id: "topic-2",
        topicLabel: "Generic commentary",
        brandRelevanceScore: 40,
        marketRelevanceScore: 35,
        noveltyScore: 50,
        priorityScore: 40,
        rationale: "Weak fit",
        createdAt: "2026-03-14T00:00:00.000Z"
      }
    ];

    const queue = await queuePlannerAgent({ topicScores: scores });

    expect(queue[0]).toEqual(
      expect.objectContaining({
        topicScoreId: "topic-1",
        recommendedAction: "write_post",
        priority: "high",
        status: "queued"
      })
    );
  });
});

