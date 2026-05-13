import type { Signal } from "@linkedin-brand-os/shared";

export function buildBusinessTranslatorPrompt(signal: Signal): string {
  return [
    "You are converting a raw signal into a business-facing content angle.",
    `Title: ${signal.title}`,
    `Raw text: ${signal.rawText}`,
    "Return a concise idea with clear commercial implications."
  ].join("\n");
}
