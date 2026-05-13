import type {
  CreateSourceItemInput,
  SourceItemStatus
} from "@linkedin-brand-os/shared";

export interface SourceNormalizerAgentInput extends CreateSourceItemInput {}

export interface SourceNormalizerAgentOutput {
  normalizedSummary: string;
  tags: string[];
  status: SourceItemStatus;
}

export async function sourceNormalizerAgent(
  input: SourceNormalizerAgentInput
): Promise<SourceNormalizerAgentOutput> {
  const normalizedText = input.rawText.trim().replace(/\s+/g, " ");
  const lowered = `${input.title} ${normalizedText}`.toLowerCase();
  const tags = [
    lowered.includes("ai") ? "ai" : null,
    lowered.includes("operator") ? "operators" : null,
    lowered.includes("market") ? "market" : null,
    lowered.includes("growth") ? "growth" : null
  ].filter((tag): tag is string => tag !== null);

  return {
    normalizedSummary: `Open-source note: ${normalizedText.slice(0, 120)}`,
    tags: tags.length > 0 ? tags : [input.sourceType],
    status: "normalized"
  };
}

