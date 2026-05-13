import type { Signal } from "@linkedin-brand-os/shared";

export function buildPositioningPrompt(signal: Signal): string {
  return [
    "You are positioning a source signal for an operator-led LinkedIn brand.",
    `Title: ${signal.title}`,
    `Source type: ${signal.sourceType}`,
    `Signal text: ${signal.normalizedContent ?? signal.rawText}`,
    "Return the best angle, alternative angles, recommended format, audience emphasis, tone guidance, and final pillar."
  ].join("\n");
}
