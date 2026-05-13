import type { Idea } from "@linkedin-brand-os/shared";

export function buildLinkedInPostPrompt(idea: Idea): string {
  return [
    "Write a LinkedIn post for a B2B operator audience.",
    "",
    `Title: ${idea.title}`,
    `Core insight: ${idea.coreInsight}`,
    `Business relevance: ${idea.businessRelevance}`,
    "",
    "CRITICAL VALIDATION RULES:",
    "- If the title, insight, or relevance contains placeholder text like 'General solution pattern', 'pain pattern is still broad', 'operator problem', or other vague meta-language, REFUSE to generate content",
    "- If the inputs lack specific technical details, product names, or concrete operational scenarios, DO NOT invent or hallucinate specifics",
    "- If you cannot extract a clear, specific problem from the inputs, return Hook: 'Insufficient source detail to generate post', Body: 'The source material lacks specific operational context.', CTA: 'N/A'",
    "- NEVER hallucinate specific technologies, problems, or scenarios (like 'data sync issues', 'CI pipeline problems', etc.) that are not explicitly mentioned in the input",
    "",
    "Hook guidance:",
    "- Start with a specific operator problem, observation, or question DIRECTLY from the source material",
    "- Make it concrete and relatable, not generic",
    "- Keep it short (8-15 words)",
    "- Examples: 'Your CI pipeline is waiting on the wrong approvals' or 'Most teams treat state locks as a Terraform problem'",
    "- If the source lacks specifics, acknowledge insufficient detail rather than inventing a problem",
    "",
    "Body guidance:",
    "- Lead with why this matters in business terms, USING ONLY information from the provided inputs",
    "- Provide 1-2 specific insights or patterns EXPLICITLY stated in the source",
    "- Skip template phrases - write naturally",
    "- Focus on operational reality from the source, not hypothetical scenarios",
    "- If the source is too vague, clearly state that more context is needed",
    "",
    "CTA guidance:",
    "- Keep it conversational",
    "- Invite exchange, not generic engagement",
    "",
    "Return sections labeled Hook, Body, and CTA."
  ].join("\n");
}
