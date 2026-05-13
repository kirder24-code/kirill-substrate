import type { VisualProvider } from "./types";

export interface ImageProviderConfig {
  model?: string;
}

export class ImageProvider implements VisualProvider {
  readonly id = "image-provider";

  constructor(private readonly config: ImageProviderConfig = {}) {}

  getAvailability() {
    return {
      available: false,
      reason: "Image provider is a future integration seam."
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
      title: `Image seam brief for ${content.hook}`,
      visualType: "single-image" as const,
      prompt: `TODO: integrate image provider ${this.config.model ?? "default"} for structured brief generation.`,
      status: "ready" as const
    };
  }
}
