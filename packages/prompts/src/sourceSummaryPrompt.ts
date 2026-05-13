import type { CreateSourceItemInput } from "@linkedin-brand-os/shared";

export function buildSourceSummaryPrompt(input: CreateSourceItemInput): string {
  return [
    "Summarize this manually entered or open-source source safely.",
    "Manual/open-source safe intake only. No scraping.",
    `Title: ${input.title}`,
    `Source type: ${input.sourceType}`,
    `Raw text: ${input.rawText}`
  ].join("\n");
}

