import type { CreateBrandVoiceProfileInput } from "@linkedin-brand-os/shared";

function normalizeList(values: string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function toSentenceCase(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export async function brandVoiceAgent(
  input: CreateBrandVoiceProfileInput
): Promise<CreateBrandVoiceProfileInput> {
  return {
    name: toSentenceCase(input.name),
    tone: toSentenceCase(input.tone),
    audience: toSentenceCase(input.audience),
    writingRules: normalizeList(input.writingRules),
    bannedPatterns: normalizeList(input.bannedPatterns),
    preferredPatterns: normalizeList(input.preferredPatterns),
    styleNotes: toSentenceCase(input.styleNotes),
    isActive: input.isActive
  };
}
