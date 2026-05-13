import { describe, expect, it } from "vitest";
import { ProviderRegistry, ProviderRouter } from "@linkedin-brand-os/ai-providers";
import {
  commentWriter,
  providerBackedCommentService,
  providerBackedReplyService,
  replyWriter
} from "./index";

const sourcePostText =
  "Most AI copilots look impressive in a demo, but collapse in real work because nobody designs the surrounding process. There is no clear owner, no exception handling, no workflow memory, and no operational accountability.";

describe("relevance-driven engagement adaptation", () => {
  it("changes comment generation metadata and output plan for high versus medium relevance", async () => {
    const strategic = await commentWriter({
      sourcePostText,
      positioningContext: "Operator-led systems.",
      relevanceScore: 84,
      bestAngle: "ownership_gap",
      recommendedAction: "comment",
      targetRole: "Founder",
      reasoningSummary: "Ownership after launch is the real gap."
    });

    const lighter = await commentWriter({
      sourcePostText,
      positioningContext: "Operator-led systems.",
      relevanceScore: 52,
      bestAngle: "workflow_accountability",
      recommendedAction: "save_for_later",
      targetRole: "Operations manager",
      reasoningSummary: "Workflow accountability matters here."
    });

    expect(strategic.adaptationPlan?.engagementMode).toBe("strategic_execution");
    expect(lighter.adaptationPlan?.engagementMode).toBe("insight_light_positioning");
    expect(strategic.appliedAngle).toBe("ownership_gap");
    expect(lighter.appliedAngle).toBe("workflow_accountability");
    expect(strategic.text).not.toEqual(lighter.text);
  });

  it("changes reply generation metadata and tone for outreach-aware versus neutral-or-skip cases", async () => {
    const bridge = await replyWriter({
      ourPostText: "AI copilots fail when nobody owns the workflow after the demo.",
      incomingCommentText: "We see the same thing in support when exceptions pile up.",
      context: "Keep it concise.",
      relevanceScore: 39,
      bestAngle: "handoff_failure",
      recommendedAction: "outreach_candidate",
      targetRole: "Founder",
      reasoningSummary: "This is relevant but better handled as a bridge."
    });

    const skip = await replyWriter({
      ourPostText: "AI copilots fail when nobody owns the workflow after the demo.",
      incomingCommentText: "Interesting. I mostly think about content trends.",
      context: "Keep it concise.",
      relevanceScore: 18,
      bestAngle: "low_fit",
      recommendedAction: "ignore",
      targetRole: "Creator",
      reasoningSummary: "Weak fit."
    });

    expect(bridge.adaptationPlan?.engagementMode).toBe("bridge_outreach_aware");
    expect(skip.adaptationPlan?.engagementMode).toBe("neutral_or_skip");
    expect(skip.shouldGenerate).toBe(false);
    expect(skip.text).toMatch(/skip|low fit|not the right thread/i);
  });

  it("keeps backward compatibility when relevance inputs are absent", async () => {
    const result = await commentWriter({
      sourcePostText,
      positioningContext: "Operator-led systems."
    });

    expect(result.text).toMatch(/workflow|owner|exception|rollout|handoff/i);
    expect(result.adaptationPlan).toBeUndefined();
    expect(result.mode).toBe("deterministic");
  });

  it("works through deterministic fallback when provider mode is enabled but no provider is available", async () => {
    const router = new ProviderRouter(new ProviderRegistry(), {
      mode: "local",
      textProvider: "mirai",
      fallbackEnabled: true
    });

    const result = await providerBackedCommentService({
      sourcePostText,
      positioningContext: "Operator-led systems.",
      relevanceScore: 84,
      bestAngle: "ownership_gap",
      recommendedAction: "comment",
      targetRole: "Founder",
      router
    });

    expect(result.mode).toBe("deterministic");
    expect(result.adaptationPlan?.engagementMode).toBe("strategic_execution");
  });

  it("applies adaptation metadata to provider-backed reply generation when a provider path exists", async () => {
    const router = new ProviderRouter(new ProviderRegistry(), {
      mode: "deterministic",
      fallbackEnabled: true
    });

    const result = await providerBackedReplyService({
      ourPostText: "AI copilots fail when nobody owns the workflow after the demo.",
      incomingCommentText: "We saw the same thing in support.",
      relevanceScore: 58,
      bestAngle: "exception_handling",
      recommendedAction: "reply",
      targetRole: "Ops leader",
      router
    });

    expect(result.mode).toBe("deterministic");
    expect(result.adaptationPlan?.engagementMode).toBe("insight_light_positioning");
  });
});
