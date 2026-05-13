import type { CreateMarketProfileInput } from "@linkedin-brand-os/shared";

export function buildMarketAnalysisPrompt(input: CreateMarketProfileInput): string {
  return [
    "Analyze this stored market profile and structure it for deterministic scoring.",
    "Ground recommendations in the stored market profile only.",
    `Country: ${input.country}`,
    `Region: ${input.region}`,
    `Primary language: ${input.primaryLanguage}`,
    `Market note: ${input.marketNote}`
  ].join("\n");
}

