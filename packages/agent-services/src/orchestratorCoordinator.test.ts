import { describe, expect, it } from "vitest";
import type { OrchestratedRecommendationInput } from "@linkedin-brand-os/shared";
import { buildOrchestratedRecommendation } from "./orchestratorCoordinator";

describe("orchestrator coordinator", () => {
  it("recommends write_post for aligned post-oriented context", () => {
    const input: OrchestratedRecommendationInput = {
      currentSourceSignal: {
        sourceType: "article",
        title: "Workflow accountability after launch",
        rawSummary: "Launches fail when no one owns the workflow.",
        normalizedSignalText: "Workflow accountability breaks after launch when ownership stays vague.",
        suggestedAngle: "workflow_accountability",
        reasoningSummary: "Clear operator-fit post signal.",
        plannerReadyPayload: {
          signalText: "Workflow accountability breaks after launch when ownership stays vague.",
          sourceType: "article"
        }
      },
      currentDecisionPlan: {
        recommendedNextAction: "generate_post_candidate",
        bestAngle: "workflow_accountability",
        contentPriority: "high",
        engagementPriority: "medium",
        publishability: "high",
        confidence: 88,
        decisionMode: "deterministic",
        riskNotes: [],
        reasoningSummary: "High-signal post candidate.",
        suggestedFlow: "post_only",
        shouldEscalateToPost: true,
        shouldEscalateToEngagement: false,
        shouldStoreForLater: false
      },
      growthRhythmPlan: {
        topPostCandidates: [
          {
            id: "queue-1",
            title: "Workflow accountability after launch",
            suggestedAction: "generate_post_candidate",
            priority: "high",
            status: "new",
            bestAngle: "workflow_accountability"
          }
        ],
        topCommentCandidates: [],
        keepForLater: [],
        weeklyFocus: "Lead with workflow accountability themes.",
        suggestedCadence: "1 post candidate, 0 engagement opportunities, 0 to revisit later.",
        reasoningSummary: "Post-first rhythm."
      },
      strategyRecommendations: [
        {
          id: "strategy-1",
          title: "Repeat the strongest operator themes",
          priority: "high",
          description: "Workflow accountability is worth repeating."
        }
      ]
    };

    const result = buildOrchestratedRecommendation(input);

    expect(result.recommendedAction).toBe("write_post");
    expect(result.primaryTarget).toContain("Workflow accountability");
    expect(result.supportingSignals.some((signal) => /Decision Planner/i.test(signal))).toBe(true);
  });

  it("recommends write_comment for engagement-first context", () => {
    const input: OrchestratedRecommendationInput = {
      currentDecisionPlan: {
        recommendedNextAction: "generate_comment",
        bestAngle: "handoff_failure",
        contentPriority: "medium",
        engagementPriority: "high",
        publishability: "medium",
        confidence: 72,
        decisionMode: "deterministic",
        riskNotes: [],
        reasoningSummary: "Better as engagement.",
        suggestedFlow: "engagement_only",
        shouldEscalateToPost: false,
        shouldEscalateToEngagement: true,
        shouldStoreForLater: false
      },
      growthRhythmPlan: {
        topPostCandidates: [],
        topCommentCandidates: [
          {
            id: "saved-1",
            title: "Comment on workflow handoff thread",
            suggestedAction: "generate_comment",
            priority: "high",
            status: "new",
            bestAngle: "handoff_failure"
          }
        ],
        keepForLater: [],
        weeklyFocus: "Lean into engagement.",
        suggestedCadence: "0 post candidates, 1 engagement opportunity, 0 to revisit later.",
        reasoningSummary: "Engagement-first rhythm."
      }
    };

    expect(buildOrchestratedRecommendation(input).recommendedAction).toBe("write_comment");
  });

  it("recommends write_reply for reply-safe context", () => {
    const input: OrchestratedRecommendationInput = {
      currentDecisionPlan: {
        recommendedNextAction: "generate_reply",
        bestAngle: "ownership_gap",
        contentPriority: "low",
        engagementPriority: "high",
        publishability: "medium",
        confidence: 70,
        decisionMode: "deterministic",
        riskNotes: [],
        reasoningSummary: "Reply-safe thread.",
        suggestedFlow: "engagement_only",
        shouldEscalateToPost: false,
        shouldEscalateToEngagement: true,
        shouldStoreForLater: false
      },
      growthRhythmPlan: {
        topPostCandidates: [],
        topCommentCandidates: [
          {
            id: "saved-2",
            title: "Reply on ownership thread",
            suggestedAction: "generate_reply",
            priority: "medium",
            status: "sent",
            bestAngle: "ownership_gap"
          }
        ],
        keepForLater: [],
        weeklyFocus: "Stay in the thread.",
        suggestedCadence: "0 post candidates, 1 engagement opportunity, 0 to revisit later.",
        reasoningSummary: "Reply-first rhythm."
      }
    };

    expect(buildOrchestratedRecommendation(input).recommendedAction).toBe("write_reply");
  });

  it("recommends save_for_later or revisit_signal for weak or conflicting context", () => {
    const input: OrchestratedRecommendationInput = {
      currentSourceSignal: {
        sourceType: "manual_research",
        title: "Generic AI note",
        rawSummary: "Broad note.",
        normalizedSignalText: "Broad note.",
        suggestedAngle: "low_fit",
        reasoningSummary: "Weak signal.",
        plannerReadyPayload: {
          signalText: "Broad note.",
          sourceType: "note"
        }
      },
      feedbackSummary: {
        strongPatterns: [],
        weakPatterns: ["Weak patterns keep landing poorly."],
        suggestedRepeats: [],
        suggestedAvoids: ["Avoid generic AI commentary this week."],
        reasoningSummary: "Caution on generic weak themes.",
        totalRecords: 2
      },
      patternMemorySummary: {
        repeatPatterns: [],
        avoidPatterns: [
          {
            id: "avoid:comment:generic engagement",
            label: "generic engagement",
            kind: "avoid",
            artifactType: "comment",
            strength: 3,
            occurrences: 2,
            lastSeenAt: "2026-03-15T00:00:00.000Z",
            source: "feedback"
          }
        ],
        recurringThemes: [],
        weakThemes: ["generic engagement"],
        notes: "Long-term memory cautions on generic engagement.",
        totalPatterns: 1
      },
      strategyRecommendations: [
        {
          id: "strategy-1",
          title: "Keep recurring weak themes deprioritized",
          priority: "medium",
          description: "Long-term memory keeps flagging weak patterns."
        }
      ]
    };

    const result = buildOrchestratedRecommendation(input);

    expect(["save_for_later", "revisit_signal"]).toContain(result.recommendedAction);
    expect(result.recommendationReason).toMatch(/Hold this for later|Revisit the signal/i);
  });

  it("includes feedback and memory bias in the reasoning", () => {
    const input: OrchestratedRecommendationInput = {
      currentDecisionPlan: {
        recommendedNextAction: "generate_post_candidate",
        bestAngle: "workflow_accountability",
        contentPriority: "high",
        engagementPriority: "medium",
        publishability: "high",
        confidence: 84,
        decisionMode: "deterministic",
        riskNotes: [],
        reasoningSummary: "High-signal post candidate.",
        suggestedFlow: "post_only",
        shouldEscalateToPost: true,
        shouldEscalateToEngagement: false,
        shouldStoreForLater: false
      },
      feedbackSummary: {
        strongPatterns: ["Workflow accountability themes are performing well."],
        weakPatterns: [],
        suggestedRepeats: ["Repeat workflow accountability angles."],
        suggestedAvoids: [],
        reasoningSummary: "Lean into stronger repeat-worthy patterns.",
        totalRecords: 2
      },
      patternMemorySummary: {
        repeatPatterns: [
          {
            id: "repeat:all:workflow accountability",
            label: "workflow accountability",
            kind: "repeat",
            strength: 4,
            occurrences: 2,
            lastSeenAt: "2026-03-15T00:00:00.000Z",
            source: "feedback"
          }
        ],
        avoidPatterns: [],
        recurringThemes: ["workflow accountability"],
        weakThemes: [],
        notes: "Long-term memory is reinforcing workflow accountability.",
        totalPatterns: 1
      }
    };

    const result = buildOrchestratedRecommendation(input);

    expect(result.recommendedAction).toBe("write_post");
    expect(result.coordinationNotes.join(" ")).toMatch(/Lean into stronger|Long-term memory/i);
    expect(result.supportingSignals.join(" ")).toMatch(/repeat/i);
  });

  it("adds strong scout-match support to orchestration without replacing the main recommendation", () => {
    const result = buildOrchestratedRecommendation({
      currentDecisionPlan: {
        recommendedNextAction: "generate_post_candidate",
        bestAngle: "workflow_accountability",
        contentPriority: "high",
        engagementPriority: "medium",
        publishability: "high",
        confidence: 84,
        decisionMode: "deterministic",
        riskNotes: [],
        reasoningSummary: "High-signal post candidate.",
        suggestedFlow: "post_only",
        shouldEscalateToPost: true,
        shouldEscalateToEngagement: false,
        shouldStoreForLater: false
      },
      scoutOpportunityContext: {
        matchedOpportunities: [
          {
            id: "match-1",
            audienceItemId: "aud-1",
            solutionItemId: "sol-1",
            matchedPain: "Workflow pain after launch",
            matchedSolutionPattern: "Visibility and coordination pattern",
            whyThisMatchWorks: "The solution addresses the same ownership gap.",
            suggestedAngle: "workflow_accountability",
            recommendedAction: "write_post",
            confidence: "high",
            opportunityStrength: "strong",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      }
    });

    expect(result.recommendedAction).toBe("write_post");
    expect(result.scoutSupport?.[0]).toContain("Scout match:");
    expect(result.scoutInfluence).toBe("strong");
    expect(result.supportingSignals.some((signal) => /Strong scout evidence/i.test(signal))).toBe(
      true
    );
  });

  it("does not let weak scout matches dominate orchestration", () => {
    const result = buildOrchestratedRecommendation({
      currentDecisionPlan: {
        recommendedNextAction: "generate_comment",
        bestAngle: "handoff_failure",
        contentPriority: "medium",
        engagementPriority: "high",
        publishability: "medium",
        confidence: 72,
        decisionMode: "deterministic",
        riskNotes: [],
        reasoningSummary: "Better as engagement.",
        suggestedFlow: "engagement_only",
        shouldEscalateToPost: false,
        shouldEscalateToEngagement: true,
        shouldStoreForLater: false
      },
      scoutOpportunityContext: {
        matchedOpportunities: [
          {
            id: "match-weak",
            audienceItemId: "aud-1",
            solutionItemId: "sol-1",
            matchedPain: "Broad AI chatter",
            matchedSolutionPattern: "General solution pattern",
            whyThisMatchWorks: "Broad fit only.",
            suggestedAngle: "low_fit",
            recommendedAction: "write_post",
            confidence: "low",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      }
    });

    expect(result.recommendedAction).toBe("write_comment");
    expect(result.scoutSupport).toBeUndefined();
  });

  it("uses reviewed saved matches as additive scout context", () => {
    const result = buildOrchestratedRecommendation({
      scoutOpportunityContext: {
        matchedOpportunities: [],
        savedMatches: [
          {
            id: "saved-match-1",
            match: {
              id: "match-1",
              audienceItemId: "aud-1",
              solutionItemId: "sol-1",
              matchedPain: "Recovery ownership pain",
              matchedSolutionPattern: "Exception and recovery pattern",
              whyThisMatchWorks: "The solution addresses the same resilience gap.",
              suggestedAngle: "exception_handling",
              recommendedAction: "write_reply",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      }
    });

    expect(result.scoutSupport?.[0]).toContain("Saved scout match");
    expect(result.supportingSignals.some((signal) => /Scout intelligence/i.test(signal))).toBe(true);
  });

  it("lets corroborated direct and reviewed scout support reinforce orchestration more strongly", () => {
    const result = buildOrchestratedRecommendation({
      currentDecisionPlan: {
        recommendedNextAction: "generate_post_candidate",
        bestAngle: "workflow_accountability",
        contentPriority: "high",
        engagementPriority: "medium",
        publishability: "high",
        confidence: 84,
        decisionMode: "deterministic",
        riskNotes: [],
        reasoningSummary: "High-signal post candidate.",
        suggestedFlow: "post_only",
        shouldEscalateToPost: true,
        shouldEscalateToEngagement: false,
        shouldStoreForLater: false
      },
      scoutOpportunityContext: {
        matchedOpportunities: [
          {
            id: "match-1",
            audienceItemId: "aud-1",
            solutionItemId: "sol-1",
            matchedPain: "Workflow pain after launch",
            matchedSolutionPattern: "Visibility and coordination pattern",
            whyThisMatchWorks: "The solution addresses the same ownership gap.",
            suggestedAngle: "workflow_accountability",
            recommendedAction: "write_post",
            confidence: "high",
            opportunityStrength: "strong",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ],
        savedMatches: [
          {
            id: "saved-match-1",
            match: {
              id: "match-2",
              audienceItemId: "aud-2",
              solutionItemId: "sol-2",
              matchedPain: "Workflow pain after launch",
              matchedSolutionPattern: "Visibility and coordination pattern",
              whyThisMatchWorks: "The solution addresses the same ownership gap twice over.",
              suggestedAngle: "workflow_accountability",
              recommendedAction: "write_post",
              confidence: "high",
              opportunityStrength: "strong",
              createdAt: "2026-03-15T00:00:00.000Z"
            },
            status: "reviewed",
            createdAt: "2026-03-15T00:00:00.000Z"
          }
        ]
      }
    });

    expect(result.scoutInfluence).toBe("strong");
    expect(
      result.supportingSignals.some((signal) => /Corroborated scout evidence/i.test(signal))
    ).toBe(true);
  });

  it("preserves backward-compatible behavior without scout context", () => {
    const result = buildOrchestratedRecommendation({
      currentDecisionPlan: {
        recommendedNextAction: "generate_post_candidate",
        bestAngle: "workflow_accountability",
        contentPriority: "high",
        engagementPriority: "medium",
        publishability: "high",
        confidence: 88,
        decisionMode: "deterministic",
        riskNotes: [],
        reasoningSummary: "High-signal post candidate.",
        suggestedFlow: "post_only",
        shouldEscalateToPost: true,
        shouldEscalateToEngagement: false,
        shouldStoreForLater: false
      }
    });

    expect(result.recommendedAction).toBe("write_post");
    expect(result.scoutSupport).toBeUndefined();
    expect(result.scoutInfluence).toBeUndefined();
  });
});
