import { describe, expect, it } from "vitest";
import {
  classifyGitHubChangeKind,
  classifySourcePattern,
  normalizeSourceIntake
} from "./sourceIntakeNormalizer";

describe("source intake normalizer", () => {
  it("classifies GitHub release inputs as adoption momentum or execution lesson patterns", () => {
    expect(
      classifySourcePattern({
        sourceType: "github",
        githubSubtype: "release",
        title: "v1.4 ships approval visibility and rollout controls",
        summaryText:
          "The release packages approval visibility, queue controls, and simpler rollout settings so teams can ship adoption changes with less operator confusion."
      })
    ).toBe("adoption_momentum");
  });

  it("classifies rollout and adoption GitHub changes", () => {
    expect(
      classifyGitHubChangeKind({
        sourceType: "github",
        githubSubtype: "release",
        title: "v1.4 ships approval visibility and rollout controls",
        summaryText:
          "The release packages approval visibility, queue controls, and simpler rollout settings so teams can ship adoption changes with less operator confusion."
      })
    ).toBe("rollout_adoption");
  });

  it("classifies exception and recovery GitHub changes", () => {
    expect(
      classifyGitHubChangeKind({
        sourceType: "github",
        githubSubtype: "issue",
        title: "Retries fail after exception path",
        summaryText:
          "Failed runs need recovery ownership, retry handling, and exception routing so operators can recover stalled work."
      })
    ).toBe("exception_recovery");
  });

  it("classifies orchestration and state GitHub changes", () => {
    expect(
      classifyGitHubChangeKind({
        sourceType: "github",
        githubSubtype: "repo_change",
        title: "State orchestration refactor for async workers",
        summaryText:
          "Refactors state orchestration for async workers, coordination, caching, and reliability boundaries."
      })
    ).toBe("orchestration_state");
  });

  it("classifies support and friction GitHub changes", () => {
    expect(
      classifyGitHubChangeKind({
        sourceType: "github",
        githubSubtype: "issue",
        title: "Users confused by approval queue behavior",
        summaryText:
          "Repeated confusion, support burden, and UX friction keep escalating when approval steps stall."
      })
    ).toBe("support_friction");
  });

  it("classifies GitHub issue inputs as support friction or resilience recovery patterns", () => {
    expect(
      classifySourcePattern({
        sourceType: "github",
        githubSubtype: "issue",
        title: "Users confused by approval queue behavior",
        summaryText:
          "Repeated confusion, support burden, and UX friction keep escalating when approval steps stall."
      })
    ).toBe("support_friction");
  });

  it("classifies GitHub repo change inputs as system tradeoff or operational visibility patterns", () => {
    expect(
      classifySourcePattern({
        sourceType: "github",
        githubSubtype: "repo_change",
        title: "State orchestration refactor for async workers",
        summaryText:
          "Refactors state orchestration for async workers, coordination, caching, and reliability boundaries."
      })
    ).toBe("operational_visibility");
  });

  it("classifies article and manual workflow notes into richer source patterns", () => {
    expect(
      classifySourcePattern({
        sourceType: "article",
        title: "Why workflow ownership breaks after the pilot",
        summaryText:
          "Operators lose momentum when the pilot ends and nobody owns the next step, exception path, or handoff."
      })
    ).toBe("workflow_pain");

    expect(
      classifySourcePattern({
        sourceType: "manual_research",
        title: "Operators keep seeing the same rollout problem",
        summaryText:
          "Manual interviews keep surfacing the same field lesson: teams ship tools before clarifying ownership, adoption, and recovery."
      })
    ).toBe("field_pattern");
  });

  it("falls back to general_change when GitHub input is weak or ambiguous", () => {
    expect(
      classifyGitHubChangeKind({
        sourceType: "github",
        title: "Minor repository update",
        summaryText: "General improvements across the repository."
      })
    ).toBe("general_change");
  });

  it("normalizes GitHub release intake with rollout and adoption framing", () => {
    const result = normalizeSourceIntake({
      sourceType: "github",
      githubSubtype: "release",
      title: "v1.4 ships approval visibility and rollout controls",
      sourceUrl: "https://github.com/example/orchestrator/releases/tag/v1.4.0",
      summaryText:
        "The release packages approval visibility, queue controls, and simpler rollout settings so teams can ship adoption changes with less operator confusion.",
      repoName: "example/orchestrator",
      repoContext: "Ops automation platform"
    });

    expect(result.normalizedSignalText.toLowerCase()).toMatch(/ship|rollout|adoption|release|operators/);
    expect(result.reasoningSummary.toLowerCase()).toMatch(/release|rollout|adoption/);
    expect(result.normalizedSignalText.toLowerCase()).toMatch(/momentum|distribution|usability|shipping discipline|adoption/);
    expect(result.normalizedSignalText.toLowerCase()).not.toMatch(/\badded\b|\bupdated\b|\bfixed\b|\brelease notes\b/);
    expect(result.plannerReadyPayload.sourceType).toBe("github");
  });

  it("normalizes GitHub issue intake with friction and workflow-breakdown framing", () => {
    const result = normalizeSourceIntake({
      sourceType: "github",
      githubSubtype: "issue",
      title: "Approval queue stalls after exception path",
      summaryText:
        "Users report approvals stall after edge-case exceptions, support load rises, and nobody can see who owns recovery once the workflow breaks.",
      repoName: "example/orchestrator"
    });

    expect(result.normalizedSignalText.toLowerCase()).toMatch(/friction|stall|workflow|support|operators|recovery/);
    expect(result.reasoningSummary.toLowerCase()).toMatch(/issue|friction|workflow|pain/);
    expect(result.normalizedSignalText.toLowerCase()).toMatch(/support burden|edge-case|edge case|execution reality|workflow breakdown|recovery/);
    expect(result.normalizedSignalText.toLowerCase()).not.toMatch(/\bbug report\b|\bissue notes\b|\bfixed\b|\bpatched\b/);
    expect(result.suggestedAngle).toMatch(/exception_handling|workflow_accountability|handoff_failure|ownership_gap/);
  });

  it("normalizes GitHub repo-change intake with system-tradeoff framing", () => {
    const result = normalizeSourceIntake({
      sourceType: "github",
      githubSubtype: "repo_change",
      title: "State orchestration refactor for async workers",
      summaryText:
        "Refactors state orchestration for async workers, queue ownership, and retry boundaries to reduce scaling failures and make tradeoffs more visible.",
      repoName: "example/agent-os"
    });

    expect(result.normalizedSignalText.toLowerCase()).toMatch(/system|orchestration|state|tradeoff|scaling|workflow/);
    expect(result.reasoningSummary.toLowerCase()).toMatch(/repo|system|tradeoff|implementation/);
    expect(result.normalizedSignalText.toLowerCase()).toMatch(/coordination|reliability|ownership|discipline|tradeoff/);
    expect(result.normalizedSignalText.toLowerCase()).not.toMatch(/\brefactor\b|\bupdated\b|\bcode cleanup\b/);
    expect(result.suggestedAngle).toMatch(/workflow_accountability|operational_roi|ownership_gap/);
  });

  it("normalizes GitHub intake into a planner-ready operator signal", () => {
    const result = normalizeSourceIntake({
      sourceType: "github",
      title: "Queue visibility fixes in the orchestration repo",
      sourceUrl: "https://github.com/example/orchestrator/releases/tag/v1.4.0",
      summaryText:
        "The release adds queue-state visibility, retry handling, and clearer ownership for failed automations so operators can see what needs intervention.",
      operatorNotes: "Useful execution lesson for ops leaders.",
      repoName: "example/orchestrator",
      repoContext: "Ops automation platform",
      releaseOrChangeType: "release"
    });

    expect(result.normalizedSignalText.toLowerCase()).toMatch(/operator|workflow|queue|ownership/);
    expect(result.normalizedSignalText.toLowerCase()).not.toMatch(/pull request|commit hash|changelog/);
    expect(result.suggestedAngle).toMatch(
      /execution_lesson|workflow_accountability|operational_tension|system_design_tradeoff|ownership_gap/
    );
    expect(result.reasoningSummary.toLowerCase()).toContain("github");
    expect(result.plannerReadyPayload.sourceType).toBe("github");
  });

  it("uses richer source patterns to sharpen article and manual reasoning and angles", () => {
    const articleResult = normalizeSourceIntake({
      sourceType: "article",
      title: "Why workflow ownership breaks after the pilot",
      summaryText:
        "Operators lose momentum when the pilot ends and nobody owns the next step, exception path, or handoff."
    });

    const manualResult = normalizeSourceIntake({
      sourceType: "manual_research",
      title: "Operators keep seeing the same rollout problem",
      summaryText:
        "Manual interviews keep surfacing the same field lesson: teams ship tools before clarifying ownership, adoption, and recovery."
    });

    expect(articleResult.suggestedAngle).toMatch(/ownership_gap|handoff_failure|exception_handling/);
    expect(articleResult.reasoningSummary.toLowerCase()).toMatch(/workflow|operator|ownership|execution/);
    expect(manualResult.reasoningSummary.toLowerCase()).toMatch(/field|pattern|repeat|operator|execution/);
  });

  it("uses richer source patterns to sharpen GitHub suggested angles and reasoning summaries", () => {
    const result = normalizeSourceIntake({
      sourceType: "github",
      githubSubtype: "repo_change",
      title: "State orchestration refactor for async workers",
      summaryText:
        "Refactors state orchestration for async workers, queue ownership, and retry boundaries to reduce scaling failures and make tradeoffs more visible."
    });

    expect(result.suggestedAngle).toMatch(/workflow_accountability|ownership_gap/);
    expect(result.reasoningSummary.toLowerCase()).toMatch(/system|visibility|tradeoff|operator|workflow/);
  });

  it("translates GitHub changes into business framing instead of raw technical dump language", () => {
    const result = normalizeSourceIntake({
      sourceType: "github",
      title: "Fallback queueing for failed agent runs",
      summaryText:
        "Adds retry orchestration, dead-letter queue handling, and visibility into failed runs after webhook exceptions.",
      repoName: "example/agent-os"
    });

    expect(result.normalizedSignalText.toLowerCase()).toMatch(/workflow|operators|handoff|queue|execution/);
    expect(result.reasoningSummary.toLowerCase()).toMatch(/workflow|operator|business|execution/);
    expect(result.normalizedSignalText.toLowerCase()).not.toContain("dead-letter");
  });

  it("avoids raw patch-note phrasing across GitHub subtypes", () => {
    const release = normalizeSourceIntake({
      sourceType: "github",
      githubSubtype: "release",
      title: "v1.8 adds queue metrics and rollout controls",
      summaryText: "Adds queue metrics, rollout controls, and packaging updates for the new operator dashboard.",
      repoName: "example/orchestrator"
    });

    const issue = normalizeSourceIntake({
      sourceType: "github",
      githubSubtype: "issue",
      title: "Bug: workflow stalls on approval exceptions",
      summaryText: "Bug report shows approval exceptions stall workflows and increase support escalations.",
      repoName: "example/orchestrator"
    });

    const repoChange = normalizeSourceIntake({
      sourceType: "github",
      githubSubtype: "repo_change",
      title: "Refactor async queue ownership boundaries",
      summaryText: "Refactors async queue ownership boundaries and updates orchestration state handling.",
      repoName: "example/orchestrator"
    });

    for (const result of [release, issue, repoChange]) {
      expect(result.normalizedSignalText.toLowerCase()).not.toMatch(
        /\badds\b|\bfixes\b|\bupdated\b|\brefactor\b|\bpatch\b|\brelease note\b/
      );
    }
  });

  it("normalizes article intake into a useful signal and suggested angle", () => {
    const result = normalizeSourceIntake({
      sourceType: "article",
      title: "Why AI copilots fail after the demo",
      sourceUrl: "https://example.com/copilots",
      summaryText:
        "Most AI copilots look impressive in a demo, but collapse in real work because nobody designs the surrounding process. There is no clear owner, no exception handling, and no operational accountability.",
      operatorNotes: "Useful founder-facing angle for workflow execution.",
      targetRole: "Founder",
      companyContext: "B2B operations software"
    });

    expect(result.normalizedSignalText).toContain("AI copilots");
    expect(result.normalizedSignalText.toLowerCase()).toMatch(/owner|owns/);
    expect(result.suggestedAngle).toBe("ownership_gap");
    expect(result.reasoningSummary).toContain("article");
    expect(result.plannerReadyPayload.sourceType).toBe("article");
  });

  it("normalizes manual research intake into a planner-ready signal", () => {
    const result = normalizeSourceIntake({
      sourceType: "manual_research",
      title: "Approval workflow friction",
      summaryText:
        "Manual interviews show that approvals stall because exception handling is undefined and nobody owns the next step after the pilot.",
      operatorNotes: "Good angle for operators who think the model is the blocker."
    });

    expect(result.normalizedSignalText.toLowerCase()).toContain("approval");
    expect(result.suggestedAngle).toMatch(
      /ownership_gap|exception_handling|workflow_accountability/
    );
    expect(result.plannerReadyPayload.signalText).toBe(result.normalizedSignalText);
    expect(result.plannerReadyPayload.sourceType).toBe("note");
  });

  it("works safely when optional fields are absent", () => {
    const result = normalizeSourceIntake({
      sourceType: "article",
      title: "Ops handoff problem",
      summaryText: "Teams lose momentum when handoffs are vague."
    });

    expect(result.sourceUrl).toBeUndefined();
    expect(result.targetRole).toBeUndefined();
    expect(result.companyContext).toBeUndefined();
    expect(result.normalizedSignalText).toContain("handoffs");
  });

  it("works safely for GitHub intake when optional fields are absent", () => {
    const result = normalizeSourceIntake({
      sourceType: "github",
      title: "Approval-step audit trail added",
      summaryText: "The repo update adds approval-state audit history so teams can see where requests stall."
    });

    expect(result.sourceUrl).toBeUndefined();
    expect(result.targetRole).toBeUndefined();
    expect(result.companyContext).toBeUndefined();
    expect(result.plannerReadyPayload.sourceType).toBe("github");
    expect(result.normalizedSignalText.length).toBeGreaterThan(20);
  });

  it("falls back safely when GitHub subtype is absent", () => {
    const result = normalizeSourceIntake({
      sourceType: "github",
      title: "Approval-step audit trail added",
      summaryText: "The repo update adds approval-state audit history so teams can see where requests stall."
    });

    expect(result.normalizedSignalText.length).toBeGreaterThan(20);
    expect(result.reasoningSummary).toContain("GitHub");
    expect(result.plannerReadyPayload.sourceType).toBe("github");
  });

  it("is deterministic and produces a planner-ready payload shape", () => {
    const input = {
      sourceType: "manual_research" as const,
      title: "Workflow memory breaks first",
      summaryText:
        "Research notes show workflow memory breaks first when nobody owns the process.",
      targetRole: "Operator"
    };

    expect(normalizeSourceIntake(input)).toEqual(normalizeSourceIntake(input));
    expect(normalizeSourceIntake(input).plannerReadyPayload).toEqual(
      expect.objectContaining({
        signalText: expect.any(String),
        sourceType: "note",
        targetRole: "Operator"
      })
    );
  });

  it("is deterministic for GitHub intake", () => {
    const input = {
      sourceType: "github" as const,
      title: "Agent retry ownership improvements",
      summaryText:
        "Release notes show failed runs now surface explicit owners, retry paths, and clearer workflow state.",
      repoName: "example/ops-agent",
      releaseOrChangeType: "release"
    };

    expect(normalizeSourceIntake(input)).toEqual(normalizeSourceIntake(input));
    expect(normalizeSourceIntake(input).plannerReadyPayload).toEqual(
      expect.objectContaining({
        signalText: expect.any(String),
        sourceType: "github"
      })
    );
  });

  it("is deterministic for GitHub intake when subtype is provided", () => {
    const input = {
      sourceType: "github" as const,
      githubSubtype: "issue" as const,
      title: "Agent retry ownership improvements",
      summaryText:
        "Issue notes show failed runs now surface explicit owners, retry paths, and clearer workflow state.",
      repoName: "example/ops-agent"
    };

    expect(normalizeSourceIntake(input)).toEqual(normalizeSourceIntake(input));
  });

  it("uses change-kind classification to sharpen GitHub output without changing the output shape", () => {
    const result = normalizeSourceIntake({
      sourceType: "github",
      githubSubtype: "issue",
      title: "Retries fail after exception path",
      summaryText:
        "Failed runs need recovery ownership, retry handling, and exception routing so operators can recover stalled work."
    });

    expect(result.suggestedAngle).toBe("workflow_accountability");
    expect(result.reasoningSummary.toLowerCase()).toMatch(/recovery|resilience|workflow|operator/);
    expect(result).toEqual(
      expect.objectContaining({
        normalizedSignalText: expect.any(String),
        suggestedAngle: expect.any(String),
        reasoningSummary: expect.any(String),
        plannerReadyPayload: expect.objectContaining({
          signalText: expect.any(String),
          sourceType: "github"
        })
      })
    );
  });
});
