import { describe, expect, it } from "vitest";
import { buildScoutMatchResult } from "./scoutMatcher";

describe("scout matcher", () => {
  const audienceItem = {
    id: "aud-1",
    sourcePlatform: "public_web" as const,
    rawExcerpt: "We still patch the workflow by hand because nobody owns the handoff after launch.",
    painSignalSummary: "Operators are flagging broken handoffs after launch.",
    whyItMatters: "This shows workflow-accountability pain in live operations.",
    suggestedActionType: "post_candidate" as const,
    topicCluster: "Broken Handoff",
    confidence: "high" as const,
    createdAt: "2026-03-15T00:00:00.000Z"
  };

  const solutionItem = {
    id: "sol-1",
    sourceType: "github" as const,
    rawExcerpt: "The release exposes status and ownership so teams can recover stalled workflows faster.",
    solutionPattern: "Visibility and coordination pattern",
    implementationLesson: "Expose status and ownership early so operators can intervene before work stalls.",
    tradeoffOrConstraint: "Visibility helps coordination, but it can create noise if ownership is still undefined.",
    whyItMatters: "This gives the operator a strong way to explain why visibility and coordination matter before work breaks.",
    suggestedAngle: "workflow_accountability" as const,
    suggestedActionType: "post_candidate" as const,
    confidence: "high" as const,
    createdAt: "2026-03-15T00:00:00.000Z"
  };

  it("matches relevant audience pain and solution items into a structured opportunity", () => {
    const result = buildScoutMatchResult({
      audienceItems: [audienceItem],
      solutionItems: [solutionItem]
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        audienceItemId: "aud-1",
        solutionItemId: "sol-1",
        matchedPain: expect.any(String),
        matchedSolutionPattern: expect.any(String),
        whyThisMatchWorks: expect.any(String),
        recommendedAction: "write_post"
      })
    ]);
  });

  it("excludes poor-fit pairs safely", () => {
    const result = buildScoutMatchResult({
      audienceItems: [
        {
          ...audienceItem,
          id: "aud-2",
          painSignalSummary: "Operators are discussing broad AI news.",
          whyItMatters: "This is broad commentary with low specificity.",
          rawExcerpt: "Interesting week for AI."
        }
      ],
      solutionItems: [
        {
          ...solutionItem,
          id: "sol-2",
          solutionPattern: "Adoption and rollout pattern",
          implementationLesson: "Ship rollout and enablement discipline alongside the feature.",
          rawExcerpt: "The case study describes onboarding and enablement changes."
        }
      ]
    });

    expect(result.items).toEqual([]);
    expect(result.summary).toContain("No strong pain-to-solution matches");
  });

  it("infers comment, reply, and save-for-later actions deterministically", () => {
    const comment = buildScoutMatchResult({
      audienceItems: [{ ...audienceItem, suggestedActionType: "comment_opportunity" }],
      solutionItems: [{ ...solutionItem, suggestedActionType: "post_candidate" }]
    });
    const reply = buildScoutMatchResult({
      audienceItems: [{ ...audienceItem, suggestedActionType: "reply_opportunity" }],
      solutionItems: [{ ...solutionItem, suggestedActionType: "post_candidate" }]
    });
    const later = buildScoutMatchResult({
      audienceItems: [{ ...audienceItem, suggestedActionType: "later", rawExcerpt: "broad note on ownership handoff" }],
      solutionItems: [{ ...solutionItem, suggestedActionType: "later", rawExcerpt: "ownership handoff visibility note" }]
    });

    expect(comment.items[0]?.recommendedAction).toBe("write_comment");
    expect(reply.items[0]?.recommendedAction).toBe("write_reply");
    expect(later.items[0]?.recommendedAction).toBe("save_for_later");
  });

  it("applies additive feedback and memory bias to the match confidence", () => {
    const neutral = buildScoutMatchResult({
      audienceItems: [audienceItem],
      solutionItems: [solutionItem]
    });
    const biased = buildScoutMatchResult({
      audienceItems: [audienceItem],
      solutionItems: [solutionItem],
      feedbackSummary: {
        strongPatterns: ["visibility and coordination pattern"],
        weakPatterns: [],
        suggestedRepeats: ["workflow accountability"],
        suggestedAvoids: [],
        reasoningSummary: "Repeat workflow accountability themes.",
        totalRecords: 2
      },
      patternMemorySummary: {
        repeatPatterns: [],
        avoidPatterns: [],
        recurringThemes: ["workflow accountability"],
        weakThemes: [],
        notes: "Long-term memory repeats workflow accountability.",
        totalPatterns: 1
      }
    });

    expect(neutral.items[0]?.confidence).toBe("medium");
    expect(biased.items[0]?.confidence).toBe("high");
  });

  it("scores a tight pain-solution pair stronger than a weak pair", () => {
    const strongAudience = {
      ...audienceItem,
      signalStrength: "strong" as const,
      scoreNotes: ["Clear ownership failure", "Specific workflow consequence"]
    };
    const strongSolution = {
      ...solutionItem,
      signalStrength: "strong" as const,
      scoreNotes: ["Concrete implementation lesson", "Tradeoff is explicit"]
    };
    const weakAudience = {
      ...audienceItem,
      id: "aud-weak",
      rawExcerpt: "Interesting AI chatter this week.",
      painSignalSummary: "People are discussing AI in broad terms.",
      whyItMatters: "Broad commentary with little operator specificity.",
      suggestedActionType: "later" as const,
      confidence: "low" as const,
      signalStrength: "weak" as const,
      scoreNotes: ["Signal is broad"]
    };
    const weakSolution = {
      ...solutionItem,
      id: "sol-weak",
      rawExcerpt: "This update seems useful.",
      solutionPattern: "General solution pattern",
      implementationLesson: "The pattern still needs detail.",
      tradeoffOrConstraint: "Tradeoff is still unclear.",
      whyItMatters: "Needs clearer implementation detail.",
      suggestedActionType: "later" as const,
      confidence: "low" as const,
      signalStrength: "weak" as const,
      scoreNotes: ["Implementation detail is broad"]
    };

    const result = buildScoutMatchResult({
      audienceItems: [weakAudience, strongAudience],
      solutionItems: [weakSolution, strongSolution]
    });

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        audienceItemId: "aud-1",
        solutionItemId: "sol-1",
        confidence: "high",
        opportunityStrength: "strong",
        scoreNotes: expect.arrayContaining([
          expect.stringMatching(/overlap|actionable|strong scout signals/i)
        ])
      })
    );
  });

  it("downgrades vague low-value matches safely", () => {
    const result = buildScoutMatchResult({
      audienceItems: [
        {
          ...audienceItem,
          id: "aud-vague",
          rawExcerpt: "Interesting AI chatter this week.",
          painSignalSummary: "Broad AI chatter.",
          whyItMatters: "Still vague.",
          suggestedActionType: "later",
          confidence: "low",
          signalStrength: "weak",
          scoreNotes: ["Signal is broad"]
        }
      ],
      solutionItems: [
        {
          ...solutionItem,
          id: "sol-vague",
          rawExcerpt: "Useful update for teams.",
          solutionPattern: "General solution pattern",
          implementationLesson: "Still broad.",
          tradeoffOrConstraint: "Still unclear.",
          whyItMatters: "Needs more detail.",
          suggestedActionType: "later",
          confidence: "low",
          signalStrength: "weak",
          scoreNotes: ["Implementation detail is broad"]
        }
      ]
    });

    expect(result.items).toEqual([]);
  });

  it("returns a safe empty state when either scout side is missing", () => {
    const result = buildScoutMatchResult({
      audienceItems: [],
      solutionItems: [solutionItem]
    });

    expect(result.items).toEqual([]);
    expect(result.summary).toContain("No matched pain-to-solution opportunities");
  });

  it("is deterministic for the same inputs", () => {
    const input = {
      audienceItems: [audienceItem],
      solutionItems: [solutionItem]
    };

    expect(buildScoutMatchResult(input)).toEqual(buildScoutMatchResult(input));
  });
});
