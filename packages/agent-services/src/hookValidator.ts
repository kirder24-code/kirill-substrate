/**
 * Hook validation and repair gate for autonomous draft generation.
 * Prevents incomplete/broken hooks from reaching final output.
 */

export interface HookValidationResult {
  valid: boolean;
  issues: string[];
  needsRepair: boolean;
}

const WEAK_ENDINGS = [
  "a",
  "an",
  "the",
  "when",
  "with",
  "without",
  "because",
  "that",
  "as",
  "for",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by"
];

const GENERIC_WEAK_PATTERNS = [
  /^(this|that|it) is about/i,
  /^automation pattern is/i,
  /^the pattern is/i,
  /^work stalls when$/i,
  /^most teams/i
];

/**
 * Validates a hook against quality criteria.
 * Returns validation result with specific issues found.
 */
export function validateHook(hook: string): HookValidationResult {
  const issues: string[] = [];
  const trimmed = hook.trim();

  // Too short
  if (trimmed.length < 20) {
    issues.push("too short (< 20 chars)");
  }

  // Too long
  if (trimmed.length > 100) {
    issues.push("too long (> 100 chars)");
  }

  // Ends with weak word (article, preposition, conjunction)
  const words = trimmed.split(/\s+/);
  const lastWord = words[words.length - 1]?.toLowerCase().replace(/[^\w]/g, "");
  if (lastWord && WEAK_ENDINGS.includes(lastWord)) {
    issues.push(`ends with weak word: "${lastWord}"`);
  }

  // Missing terminal punctuation (professional finish required)
  const endsWithPunctuation = /[.!?]$/.test(trimmed);
  const appearsComplete = trimmed.split(/\s+/).length >= 5;
  if (appearsComplete && !endsWithPunctuation) {
    issues.push("missing terminal punctuation");
  }

  // Generic weak opening patterns
  for (const pattern of GENERIC_WEAK_PATTERNS) {
    if (pattern.test(trimmed)) {
      issues.push("matches generic weak pattern");
      break;
    }
  }

  // Incomplete sentence fragment (ends with capital letter followed by lowercase)
  if (/[A-Z][a-z]+\s+[a-z]+\s*$/.test(trimmed) && !endsWithPunctuation) {
    issues.push("incomplete sentence fragment");
  }

  const valid = issues.length === 0;
  const needsRepair = issues.length > 0;

  return {
    valid,
    issues,
    needsRepair
  };
}

/**
 * Attempts to repair a broken hook with minimal intervention.
 * Returns repaired hook or original if repair not possible.
 */
export function repairHook(hook: string): string {
  let repaired = hook.trim();

  // Remove trailing weak words, but preserve if it creates an incomplete thought
  const words = repaired.split(/\s+/);
  let trimmedWords = [...words];

  while (trimmedWords.length > 3) {
    const lastWord = trimmedWords[trimmedWords.length - 1]?.toLowerCase().replace(/[^\w]/g, "");
    if (lastWord && WEAK_ENDINGS.includes(lastWord)) {
      trimmedWords.pop();
    } else {
      break;
    }
  }

  // Check if trimming created an obviously incomplete thought
  const trimmedText = trimmedWords.join(" ");
  const looksIncomplete =
    /\b(one|simple|clearly|usually)\s*$/.test(trimmedText) ||
    trimmedText.split(/\s+/).length < 4;

  // Use trimmed version only if it doesn't create incomplete thought
  repaired = looksIncomplete ? words.join(" ") : trimmedText;

  // Final professional punctuation enforcement
  if (!/[.!?]$/.test(repaired)) {
    // Explicit question patterns get question mark
    if (/^(how|what|why|when|where|who|which|is|are|do|does|can|could|would|should)/i.test(repaired)) {
      repaired += "?";
    } else {
      // All other operator statements get declarative period
      repaired += ".";
    }
  }

  // Trim to reasonable length
  if (repaired.length > 90) {
    const sentences = repaired.split(/[.!?]/);
    repaired = sentences[0]?.trim() || repaired;
    if (!/[.!?]$/.test(repaired)) {
      repaired += ".";
    }
  }

  return repaired;
}
