import { describe, expect, it } from "vitest";
import type { GrowthRhythmInput } from "@linkedin-brand-os/shared";
import { buildGrowthRhythmPlan } from "./growthRhythmPlanner";

describe("growth rhythm planner", () => {
  it("prioritizes strong post candidates", () => {
    const input: GrowthRhythmInput = {
      queueItems: [
        {
          id: "queue-1",
          title: "Ownership gap after rollout",
          suggestedAction: "generate_post_candidate",
          priority: "high",
          status: "new",
          bestAngle: "ownership_gap",
          reasoningSummary: "Strong workflow pain and operator fit.",
          sourceType: "manual"
        },
        {
          id: "queue-2",
          title: "Workflow handoff cleanup",
          suggestedAction: "write_post",
          priority: "medium",
          status: "queued",
          bestAngle: "handoff_failure",
          reasoningSummary: "Useful secondary post topic.",
          sourceType: "research"
        }
      ],
      savedCandidates: []
    };

    const plan = buildGrowthRhythmPlan(input);

    expect(plan.topPostCandidates[0]?.id).toBe("queue-1");
    expect(plan.topPostCandidates[1]?.id).toBe("queue-2");
    expect(plan.suggestedCadence).toContain("post");
  });

  it("routes engagement-first items into top comment candidates", () => {
    const input: GrowthRhythmInput = {
      queueItems: [],
      savedCandidates: [
        {
          id: "saved-1",
          title: "Comment on GTM handoff thread",
          suggestedAction: "generate_comment",
          priority: "high",
          status: "new",
          bestAngle: "handoff_failure",
          reasoningSummary: "Live thread with strong ops fit."
        },
        {
          id: "saved-2",
          title: "Reply on workflow ownership post",
          suggestedAction: "generate_reply",
          priority: "medium",
          status: "sent",
          bestAngle: "ownership_gap",
          reasoningSummary: "Good follow-up reply."
        }
      ]
    };

    const plan = buildGrowthRhythmPlan(input);

    expect(plan.topCommentCandidates.map((candidate) => candidate.id)).toEqual([
      "saved-1",
      "saved-2"
    ]);
  });

  it("keeps lower-priority items for later", () => {
    const input: GrowthRhythmInput = {
      queueItems: [
        {
          id: "queue-1",
          title: "Low urgency market note",
          suggestedAction: "analyze_market",
          priority: "low",
          status: "done",
          reasoningSummary: "Not urgent this week."
        }
      ],
      savedCandidates: [
        {
          id: "saved-1",
          title: "Medium-fit idea",
          suggestedAction: "save_for_later",
          priority: "low",
          status: "archived",
          reasoningSummary: "Keep it around, not urgent."
        }
      ]
    };

    const plan = buildGrowthRhythmPlan(input);

    expect(plan.keepForLater.map((candidate) => candidate.id)).toEqual([
      "queue-1",
      "saved-1"
    ]);
  });

  it("biases strong repeat-worthy feedback patterns upward for post candidates", () => {
    const input: GrowthRhythmInput = {
      queueItems: [
        {
          id: "queue-1",
          title: "Workflow accountability breaks after launch",
          suggestedAction: "generate_post_candidate",
          priority: "medium",
          status: "new",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Execution-heavy workflow accountability post."
        },
        {
          id: "queue-2",
          title: "General AI productivity thought",
          suggestedAction: "generate_post_candidate",
          priority: "high",
          status: "new",
          bestAngle: "operational_roi",
          reasoningSummary: "Broader but less specific post."
        }
      ],
      feedbackSummary: {
        strongPatterns: ["Workflow accountability themes are performing well."],
        weakPatterns: [],
        suggestedRepeats: ["Repeat workflow accountability and operator execution topics."],
        suggestedAvoids: [],
        reasoningSummary: "Lean into workflow accountability.",
        totalRecords: 3
      }
    };

    const plan = buildGrowthRhythmPlan(input);

    expect(plan.topPostCandidates[0]?.id).toBe("queue-1");
    expect(plan.topPostCandidates[0]?.feedbackAlignment).toBe("positive");
    expect(plan.topPostCandidates[0]?.feedbackHintKind).toBe("repeat");
    expect(plan.topPostCandidates[0]?.feedbackHint).toContain("Aligned with repeat");
    expect(plan.reasoningSummary).toContain("feedback");
  });

  it("biases weak feedback patterns downward into later buckets", () => {
    const input: GrowthRhythmInput = {
      queueItems: [
        {
          id: "queue-1",
          title: "Generic AI transformation thought",
          suggestedAction: "generate_post_candidate",
          priority: "medium",
          status: "new",
          reasoningSummary: "Generic transformation angle."
        },
        {
          id: "queue-2",
          title: "Workflow ownership lesson",
          suggestedAction: "generate_post_candidate",
          priority: "medium",
          status: "new",
          bestAngle: "ownership_gap",
          reasoningSummary: "Specific execution lesson."
        }
      ],
      feedbackSummary: {
        strongPatterns: [],
        weakPatterns: ["Generic AI transformation phrasing is landing weakly."],
        suggestedRepeats: [],
        suggestedAvoids: ["Avoid generic AI transformation language."],
        reasoningSummary: "Avoid generic transformation angles.",
        totalRecords: 2
      }
    };

    const plan = buildGrowthRhythmPlan(input);

    expect(plan.topPostCandidates[0]?.id).toBe("queue-2");
    expect(plan.keepForLater.map((candidate) => candidate.id)).toContain("queue-1");
    expect(plan.keepForLater.find((candidate) => candidate.id === "queue-1")?.feedbackAlignment).toBe(
      "negative"
    );
    expect(plan.keepForLater.find((candidate) => candidate.id === "queue-1")?.feedbackHintKind).toBe(
      "avoid"
    );
    expect(plan.keepForLater.find((candidate) => candidate.id === "queue-1")?.feedbackHint).toContain(
      "Watch:"
    );
  });

  it("does not emit misleading feedback hints for neutral candidates", () => {
    const input: GrowthRhythmInput = {
      queueItems: [
        {
          id: "queue-1",
          title: "Approval routing note with no motif overlap",
          suggestedAction: "generate_post_candidate",
          priority: "medium",
          status: "new",
          reasoningSummary: "Specific enough to be useful, but not tied to known motifs."
        }
      ],
      feedbackSummary: {
        strongPatterns: ["Workflow accountability themes are performing well."],
        weakPatterns: ["Generic AI transformation phrasing is landing weakly."],
        suggestedRepeats: ["Repeat workflow accountability and operator execution topics."],
        suggestedAvoids: ["Avoid generic AI transformation language."],
        reasoningSummary: "Mix of repeat and avoid patterns.",
        totalRecords: 2
      }
    };

    const plan = buildGrowthRhythmPlan(input);

    expect(plan.topPostCandidates[0]?.feedbackAlignment).toBe("neutral");
    expect(plan.topPostCandidates[0]?.feedbackHint).toBeUndefined();
    expect(plan.topPostCandidates[0]?.feedbackHintKind).toBeUndefined();
  });

  it("is deterministic for the same input", () => {
    const input: GrowthRhythmInput = {
      queueItems: [
        {
          id: "queue-1",
          title: "Ownership gap after rollout",
          suggestedAction: "generate_post_candidate",
          priority: "high",
          status: "new",
          bestAngle: "ownership_gap",
          reasoningSummary: "Strong workflow pain and operator fit."
        }
      ],
      savedCandidates: []
    };

    expect(buildGrowthRhythmPlan(input)).toEqual(buildGrowthRhythmPlan(input));
  });

  it("renders a safe empty plan when little input is available", () => {
    const plan = buildGrowthRhythmPlan({ queueItems: [] });

    expect(plan.topPostCandidates).toEqual([]);
    expect(plan.topCommentCandidates).toEqual([]);
    expect(plan.keepForLater).toEqual([]);
    expect(plan.weeklyFocus).toContain("No strong growth rhythm signal yet");
  });

  it("remains backward-compatible without feedback summary", () => {
    const input: GrowthRhythmInput = {
      queueItems: [
        {
          id: "queue-1",
          title: "Ownership gap after rollout",
          suggestedAction: "generate_post_candidate",
          priority: "high",
          status: "new",
          bestAngle: "ownership_gap",
          reasoningSummary: "Strong workflow pain and operator fit."
        }
      ]
    };

    const plan = buildGrowthRhythmPlan(input);

    expect(plan.topPostCandidates[0]?.id).toBe("queue-1");
    expect(plan.reasoningSummary).not.toContain("feedback");
  });

  it("is deterministic for the same input and feedback summary", () => {
    const input: GrowthRhythmInput = {
      queueItems: [
        {
          id: "queue-1",
          title: "Workflow accountability breaks after launch",
          suggestedAction: "generate_post_candidate",
          priority: "medium",
          status: "new",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Execution-heavy workflow accountability post."
        }
      ],
      feedbackSummary: {
        strongPatterns: ["Workflow accountability themes are performing well."],
        weakPatterns: [],
        suggestedRepeats: ["Repeat workflow accountability and operator execution topics."],
        suggestedAvoids: [],
        reasoningSummary: "Lean into workflow accountability.",
        totalRecords: 1
      }
    };

    expect(buildGrowthRhythmPlan(input)).toEqual(buildGrowthRhythmPlan(input));
  });

  it("emits deterministic candidate hints for the same input and feedback summary", () => {
    const input: GrowthRhythmInput = {
      queueItems: [
        {
          id: "queue-1",
          title: "Workflow accountability breaks after launch",
          suggestedAction: "generate_post_candidate",
          priority: "medium",
          status: "new",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Execution-heavy workflow accountability post."
        }
      ],
      feedbackSummary: {
        strongPatterns: ["Workflow accountability themes are performing well."],
        weakPatterns: [],
        suggestedRepeats: ["Repeat workflow accountability and operator execution topics."],
        suggestedAvoids: [],
        reasoningSummary: "Lean into workflow accountability.",
        totalRecords: 1
      }
    };

    expect(buildGrowthRhythmPlan(input).topPostCandidates[0]?.feedbackHint).toBe(
      buildGrowthRhythmPlan(input).topPostCandidates[0]?.feedbackHint
    );
  });

  it("uses long-term pattern memory to boost recurring post themes", () => {
    const input: GrowthRhythmInput = {
      queueItems: [
        {
          id: "queue-1",
          title: "Repeat-worthy topics around workflow accountability",
          suggestedAction: "generate_post_candidate",
          priority: "medium",
          status: "new",
          bestAngle: "workflow_accountability",
          reasoningSummary: "Specific operator lesson."
        },
        {
          id: "queue-2",
          title: "Broad AI narrative",
          suggestedAction: "generate_post_candidate",
          priority: "high",
          status: "new",
          reasoningSummary: "Generic angle."
        }
      ],
      patternMemorySummary: {
        repeatPatterns: [
          {
            id: "repeat:all:repeat-worthy topics",
            label: "repeat-worthy topics",
            kind: "repeat",
            strength: 4,
            occurrences: 2,
            lastSeenAt: "2026-03-15T00:00:00.000Z",
            source: "feedback"
          }
        ],
        avoidPatterns: [],
        recurringThemes: ["repeat-worthy topics"],
        weakThemes: [],
        notes: "Memory favors repeat-worthy topics.",
        totalPatterns: 1
      }
    };

    const plan = buildGrowthRhythmPlan(input);

    expect(plan.topPostCandidates[0]?.id).toBe("queue-1");
    expect(plan.topPostCandidates[0]?.memoryBadge).toBe("Long-term repeat");
    expect(plan.topPostCandidates[0]?.memoryBadgeKind).toBe("repeat");
    expect(plan.reasoningSummary).toContain("memory");
  });

  it("uses long-term pattern memory to keep recurring weak themes lower", () => {
    const input: GrowthRhythmInput = {
      queueItems: [
        {
          id: "queue-1",
          title: "Generic engagement thought",
          suggestedAction: "generate_comment",
          priority: "low",
          status: "new",
          reasoningSummary: "Very broad engagement angle."
        },
        {
          id: "queue-2",
          title: "Specific workflow accountability comment",
          suggestedAction: "generate_comment",
          priority: "medium",
          status: "new",
          reasoningSummary: "Specific operator engagement."
        }
      ],
      patternMemorySummary: {
        repeatPatterns: [],
        avoidPatterns: [
          {
            id: "avoid:comment:generic engagement",
            label: "generic engagement",
            kind: "avoid",
            artifactType: "comment",
            strength: 4,
            occurrences: 2,
            lastSeenAt: "2026-03-15T00:00:00.000Z",
            source: "feedback"
          }
        ],
        recurringThemes: [],
        weakThemes: ["generic engagement"],
        notes: "Memory cautions on generic engagement.",
        totalPatterns: 1
      }
    };

    const plan = buildGrowthRhythmPlan(input);

    expect(plan.topCommentCandidates[0]?.id).toBe("queue-2");
    expect(plan.keepForLater.map((candidate) => candidate.id)).toContain("queue-1");
    expect(
      plan.keepForLater.find((candidate) => candidate.id === "queue-1")?.memoryBadge
    ).toBe("Recurring weak pattern");
    expect(
      plan.keepForLater.find((candidate) => candidate.id === "queue-1")?.memoryBadgeKind
    ).toBe("avoid");
  });

  it("does not emit misleading memory badges without meaningful long-term alignment", () => {
    const input: GrowthRhythmInput = {
      queueItems: [
        {
          id: "queue-1",
          title: "Specific approval-routing note",
          suggestedAction: "generate_post_candidate",
          priority: "medium",
          status: "new",
          reasoningSummary: "Useful but not tied to recurring memory motifs."
        }
      ],
      patternMemorySummary: {
        repeatPatterns: [
          {
            id: "repeat:all:repeat-worthy topics",
            label: "repeat-worthy topics",
            kind: "repeat",
            strength: 4,
            occurrences: 2,
            lastSeenAt: "2026-03-15T00:00:00.000Z",
            source: "feedback"
          }
        ],
        avoidPatterns: [],
        recurringThemes: ["repeat-worthy topics"],
        weakThemes: [],
        notes: "Memory favors repeat-worthy topics.",
        totalPatterns: 1
      }
    };

    const plan = buildGrowthRhythmPlan(input);

    expect(plan.topPostCandidates[0]?.memoryBadge).toBeUndefined();
    expect(plan.topPostCandidates[0]?.memoryBadgeKind).toBeUndefined();
  });
});
