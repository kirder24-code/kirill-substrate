import type { CreateBrandVoiceProfileInput } from "@linkedin-brand-os/shared";

export function buildBrandVoicePrompt(input: CreateBrandVoiceProfileInput): string {
  return [
    "Normalize this brand voice profile for grounded B2B writing.",
    `Name: ${input.name}`,
    `Tone: ${input.tone}`,
    `Audience: ${input.audience}`,
    `Writing rules: ${input.writingRules.join(", ")}`,
    `Banned patterns: ${input.bannedPatterns.join(", ")}`,
    `Preferred patterns: ${input.preferredPatterns.join(", ")}`,
    `Style notes: ${input.styleNotes}`
  ].join("\n");
}
