import { describe, expect, it } from "vitest";
import {
  buildAudienceScoutResult,
  classifyAudienceScoutPattern
} from "./audienceScout";

describe("audience scout", () => {
  it("produces structured scout items with the expected shape", () => {
    const result = buildAudienceScoutResult({
      targetTopics: ["workflow chaos"],
      targetRoles: ["COO"],
      targetKeywords: ["handoff", "manual work"],
      maxResults: 3
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        id: expect.stringContaining("workflow-chaos"),
        sourcePlatform: "public_web",
        rawExcerpt: expect.any(String),
        painSignalSummary: expect.any(String),
        whyItMatters: expect.any(String),
        suggestedActionType: expect.any(String),
        confidence: expect.any(String),
        createdAt: expect.any(String)
      })
    ]);
    expect(result.summary).toContain("audience signals shortlisted");
    expect(result.notes).toContain("review-first");
  });

  it("classifies operator-provided public excerpts into structured scout items", () => {
    const result = buildAudienceScoutResult({
      targetTopics: [],
      publicInputs: [
        {
          sourceLabel: "LinkedIn thread",
          excerpt:
            "We still patch launch handoffs in spreadsheets because nobody owns the workflow after rollout."
        }
      ],
      maxResults: 2
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        sourceLabel: "LinkedIn thread",
        rawExcerpt:
          "We still patch launch handoffs in spreadsheets because nobody owns the workflow after rollout.",
        suggestedActionType: "post_candidate",
        topicCluster: expect.stringMatching(/Broken Handoff|Manual Work/),
        confidence: "high"
      })
    ]);
  });

  it("preserves excerpt URL context without requiring fetches", () => {
    const result = buildAudienceScoutResult({
      targetTopics: [],
      publicInputs: [
        {
          sourceLabel: "Public post",
          sourceUrl: "https://linkedin.example/post/ops-1",
          excerpt: "Support escalations keep rising because the workflow is confusing in real conditions."
        }
      ]
    });

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        sourceLabel: "Public post",
        sourceUrl: "https://linkedin.example/post/ops-1"
      })
    );
  });

  it("supports mixed topic and public-input mode safely", () => {
    const result = buildAudienceScoutResult({
      targetTopics: ["workflow chaos"],
      targetKeywords: ["handoff"],
      publicInputs: [
        {
          excerpt: "We still cannot see where the workflow is stuck until something breaks."
        }
      ],
      maxResults: 3
    });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.rawExcerpt).toContain("cannot see where the workflow is stuck");
    expect(result.items[1]?.id).toContain("workflow-chaos");
  });

  it("classifies audience scout items into post, comment, reply, and later opportunities", () => {
    expect(classifyAudienceScoutPattern("manual work after rollout", ["spreadsheet"])).toBe(
      "manual_work"
    );
    expect(classifyAudienceScoutPattern("implementation confusion", ["onboarding"])).toBe(
      "implementation_confusion"
    );
    expect(classifyAudienceScoutPattern("visibility black box", ["status"])).toBe(
      "operational_visibility"
    );
    expect(classifyAudienceScoutPattern("broad AI automation", ["generic"])).toBe("general");

    const result = buildAudienceScoutResult({
      targetTopics: [
        "manual work after rollout",
        "implementation confusion",
        "visibility black box",
        "broad AI automation"
      ],
      maxResults: 4
    });

    expect(result.items.map((item) => item.suggestedActionType)).toEqual([
      "post_candidate",
      "comment_opportunity",
      "reply_opportunity",
      "later"
    ]);
  });

  it("returns a safe empty result when no strong inputs are provided", () => {
    const result = buildAudienceScoutResult({
      targetTopics: [],
      targetKeywords: [],
      maxResults: 3
    });

    expect(result.items).toEqual([]);
    expect(result.summary).toContain("No strong public audience signals");
    expect(result.notes).toContain("does not execute externally");
  });

  it("returns a safe low-confidence result for sparse public excerpts", () => {
    const result = buildAudienceScoutResult({
      targetTopics: [],
      publicInputs: [{ excerpt: "Interesting AI thread" }]
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        suggestedActionType: "later",
        confidence: "low",
        signalStrength: "weak"
      })
    ]);
  });

  it("scores clear operational pain stronger than generic discussion noise", () => {
    const result = buildAudienceScoutResult({
      targetTopics: [],
      publicInputs: [
        {
          sourceLabel: "Generic discussion",
          excerpt: "People are talking about AI workflows this week."
        },
        {
          sourceLabel: "Operator thread",
          excerpt:
            "After rollout, nobody owns the approval handoff, support escalations stack up, and ops is still patching the workflow in spreadsheets every Friday."
        }
      ],
      maxResults: 5
    });

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        sourceLabel: "Operator thread",
        confidence: "high",
        signalStrength: "strong",
        scoreNotes: expect.arrayContaining([
          expect.stringMatching(/operational pain|specific workflow consequence/i)
        ])
      })
    );
    expect(result.items[1]).toEqual(
      expect.objectContaining({
        sourceLabel: "Generic discussion",
        confidence: "low",
        signalStrength: "weak"
      })
    );
  });

  it("is deterministic for the same inputs", () => {
    const input = {
      targetTopics: ["ops bottlenecks", "workflow chaos"],
      targetRoles: ["RevOps lead"],
      targetKeywords: ["handoff", "support friction"],
      publicInputs: [
        {
          sourceLabel: "Discussion board",
          excerpt: "Nobody owns recovery once the workflow breaks."
        }
      ],
      maxResults: 2
    };

    expect(buildAudienceScoutResult(input)).toEqual(buildAudienceScoutResult(input));
  });
});
