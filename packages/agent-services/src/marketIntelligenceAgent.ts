import type {
  CreateMarketProfileInput,
  StrategyPriority
} from "@linkedin-brand-os/shared";

export interface MarketIntelligenceAgentInput extends CreateMarketProfileInput {}

export interface MarketIntelligenceAgentOutput {
  marketNote: string;
  linkedinPriority: StrategyPriority;
  serviceFitScore: number;
}

export async function marketIntelligenceAgent(
  input: MarketIntelligenceAgentInput
): Promise<MarketIntelligenceAgentOutput> {
  const normalizedNote = input.marketNote.trim().replace(/\s+/g, " ");
  const lower = `${input.country} ${input.region} ${normalizedNote}`.toLowerCase();
  const highPriority =
    lower.includes("north america") ||
    lower.includes("europe") ||
    lower.includes("b2b") ||
    lower.includes("consult");

  return {
    marketNote: normalizedNote,
    linkedinPriority: highPriority ? "high" : "medium",
    serviceFitScore: Math.min(
      95,
      50 +
        (lower.includes("b2b") ? 20 : 0) +
        (lower.includes("operator") ? 15 : 0) +
        (highPriority ? 10 : 0)
    )
  };
}

