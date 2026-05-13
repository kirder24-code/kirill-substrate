import type { VisualProvider } from "./types";

export class MockVisualProvider implements VisualProvider {
  readonly id = "mock-visual";

  getAvailability() {
    return {
      available: true,
      reason: "Deterministic mock visual provider is always available."
    };
  }

  getCapabilities() {
    return {
      text: false,
      visual: true,
      live: false
    };
  }

  async generateVisualBrief({
    content
  }: Parameters<VisualProvider["generateVisualBrief"]>[0]) {
    return {
      title: `Editorial visual for ${content.refinedHook ?? content.hook}`,
      visualType: "single-image" as const,
      prompt: [
        "Create a structured visual brief for an editorial visual.",
        `Headline: ${content.refinedHook ?? content.hook}`,
        `Narrative: ${(content.refinedBody ?? content.body).slice(0, 160)}`,
        "Direction: minimal, credible, practical, no hype."
      ].join(" "),
      status: "ready" as const
    };
  }
}
