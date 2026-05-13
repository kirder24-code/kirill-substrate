import { describe, expect, it } from "vitest";
import { MockTextProvider, ProviderRegistry, ProviderRouter } from "@linkedin-brand-os/ai-providers";
import {
  commentWriter,
  providerBackedCommentService,
  providerBackedReplyService,
  replyWriter
} from "./index";

describe("comment and reply writers", () => {
  it("commentWriter outputs a short grounded comment with substance", async () => {
    const result = await commentWriter({
      sourcePostText:
        "Most teams buy AI tools before they fix the handoff between sales and ops. The demo looks great, but nobody owns the workflow after launch.",
      positioningContext: "We focus on operator-led systems and practical rollout."
    });

    expect(result.text.length).toBeLessThanOrEqual(220);
    expect(result.text).not.toMatch(/great post|love this|so true/i);
    expect(result.text).toMatch(/owner|workflow|handoff|ops|rollout/i);
    expect(result.mode).toBe("deterministic");
  });

  it("replyWriter acknowledges naturally and responds directly without robotic phrasing", async () => {
    const result = await replyWriter({
      ourPostText:
        "AI copilots fail when nobody owns the workflow after the demo.",
      incomingCommentText:
        "We saw the same thing in support. The model was fine. The queue design was the real mess.",
      context: "Keep the reply concise and operator-style."
    });

    expect(result.text.length).toBeLessThanOrEqual(240);
    expect(result.text).toMatch(/exactly|that|same|fair|yes/i);
    expect(result.text).toMatch(/queue|workflow|owner|support/i);
    expect(result.text).not.toMatch(/great point!|absolutely agree with your insightful comment/i);
    expect(result.mode).toBe("deterministic");
  });

  it("provider-backed comment service can use a provider result and still clean generic praise", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    const router = new ProviderRouter(registry, {
      mode: "mock",
      textProvider: "mock-text",
      fallbackEnabled: true
    });

    const result = await providerBackedCommentService({
      sourcePostText:
        "The demo is not the problem. The ownership gap is.",
      positioningContext: "Keep it practical.",
      router
    });

    expect(result.mode).toBe("provider");
    expect(result.text).not.toMatch(/great post|love this/i);
    expect(result.text).toMatch(/owner|workflow|rollout|practical/i);
  });

  it("provider-backed reply service falls back cleanly when no provider is configured", async () => {
    const router = new ProviderRouter(new ProviderRegistry(), {
      mode: "deterministic",
      fallbackEnabled: true
    });

    const result = await providerBackedReplyService({
      ourPostText: "The workflow breaks after the demo.",
      incomingCommentText: "We saw this in onboarding too.",
      context: "Keep it grounded.",
      router
    });

    expect(result.mode).toBe("deterministic");
    expect(result.text).toMatch(/onboarding|workflow|owner|handoff/i);
  });
});
