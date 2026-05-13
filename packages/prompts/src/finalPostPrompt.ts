export function buildFinalPostPrompt(input: {
  hook: string;
  body: string;
  cta: string;
}): string {
  return [
    "Polish this into a publishable LinkedIn post.",
    "",
    "Requirements:",
    "- Make the hook shorter and stronger (full sentence or clear question, no preamble)",
    "- Make the body shorter and reduce repeated phrases between hook and body",
    "- Remove forced transitions like 'The real breakdown starts when' if they don't fit naturally",
    "- Ensure each sentence connects logically to the next",
    "- State business impact in the first two sentences (move business payoff earlier in the body)",
    "- Write like a human operator sharing real insight, not a template",
    "",
    `Hook: ${input.hook}`,
    `Body: ${input.body}`,
    `CTA: ${input.cta}`,
    "",
    "Return sections labeled Hook, Body, and CTA."
  ].join("\n");
}
