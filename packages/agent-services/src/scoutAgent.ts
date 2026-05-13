import type { Signal } from "@linkedin-brand-os/shared";

export interface ScoutAgentInput {
  source: string;
  query: string;
}

export interface ScoutAgentOutput {
  signals: Signal[];
}

export async function scoutAgent(
  input: ScoutAgentInput
): Promise<ScoutAgentOutput> {
  return {
    signals: [
      {
        id: `sig-scout-${Date.now()}`,
        title: input.query,
        sourceType: "research",
        rawText: `Mock signal discovered from ${input.source} for ${input.query}.`,
        status: "new",
        createdAt: new Date().toISOString()
      }
    ]
  };
}
