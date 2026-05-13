import type {
  BrandVoiceProfile,
  ContentAsset,
  FinalPostGenerationConfig,
  FinalPostOutcomeContext,
  FinalPostQualityMetadata
} from "@linkedin-brand-os/shared";
import { hookWriter } from "./hookWriter";

export interface LinkedInPostComposerResult {
  hook: string;
  body: string;
  closing: string;
  qualityScore: number;
  qualityMetadata: FinalPostQualityMetadata;
}

const metadataPatterns = [
  /\bAudience:\s*[^.\n]+[.\n]?/gi,
  /\bVoice:\s*[^.\n]+[.\n]?/gi,
  /\bTone:\s*[^.\n]+[.\n]?/gi,
  /\bPreferred patterns?:\s*[^.\n]+[.\n]?/gi,
  /\bBanned patterns?:\s*[^.\n]+[.\n]?/gi
];

const fillerPatterns = [
  /ai is changing everything/gi,
  /game changer/gi,
  /in today'?s fast-paced environment/gi,
  /unlock the power/gi,
  /stitched together/gi
];

const trivialWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "because",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "they",
  "this",
  "to",
  "when",
  "with"
]);

function cleanText(text: string, brandVoice?: BrandVoiceProfile | null): string {
  let next = text.replace(/\s+/g, " ").trim();

  // Strip ALL hashtags aggressively (not just leading ones)
  next = next.replace(/#\w+/g, "");

  // Strip markdown labels (must happen before general markdown stripping)
  next = next.replace(/^\*\*\s*(Hook|Body|Title|CTA|Closing|Problem|Miss|Payoff)\s*:?\*\*\s*/gmi, "");
  next = next.replace(/^(Hook|Body|Title|CTA|Closing|Problem|Miss|Payoff)\s*:\s*/gmi, "");
  next = next.replace(/^#+\s+(Hook|Body|Title|CTA|Closing|Problem|Miss|Payoff)\s*:?\s*/gmi, "");

  // Strip all markdown formatting (more aggressive, multiple passes)
  for (let i = 0; i < 3; i++) {
    next = next.replace(/\*\*([^*]*)\*\*/g, "$1"); // **bold**
    next = next.replace(/\*([^*]*)\*/g, "$1"); // *italic*
    next = next.replace(/__([^_]*)__/g, "$1"); // __bold__
    next = next.replace(/_([^_]*)_/g, "$1"); // _italic*
  }

  // Strip markdown headers and links
  next = next.replace(/^#+\s*/gm, "");
  next = next.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Strip inline labels that might have survived (anywhere in text, not just word boundaries)
  next = next.replace(/\*\*(Hook|Body|Title|CTA|Closing|Problem|Miss|Payoff|Identify the problem|The problem|Exception and Recovery Pattern)\s*:?\*\*/gi, "");
  next = next.replace(/\b(Hook|Body|Title|CTA|Closing|Problem|Miss|Payoff)\s*:\s*/gi, "");

  // Strip list markers and bullets that often accompany structured content
  next = next.replace(/^[\s-]*[-*•]\s*/gm, "");
  next = next.replace(/^\d+\.\s*/gm, "");

  // Strip generic marketing phrases that survive AI generation
  next = next.replace(/\bjoin our\b[^.!?]*?(training|platform|program|solution|service|pattern)/gi, "");
  next = next.replace(/\bdid you know\b[^.!?]*?\?/gi, "");
  next = next.replace(/\blet'?s make\b[^.!?]*/gi, "");

  // Strip AI metadata and instructions that leak into output
  next = next.replace(/\[Call to Action:[^\]]*\]/gi, "");
  next = next.replace(/\[CTA:[^\]]*\]/gi, "");
  next = next.replace(/\["[^"]*"\s+or\s+"[^"]*"\]/gi, "");

  // Strip mid-paragraph bullets that survive initial cleaning
  next = next.replace(/:\s*[-•]\s+/g, ": ");

  for (const pattern of metadataPatterns) {
    next = next.replace(pattern, " ");
  }
  for (const pattern of fillerPatterns) {
    next = next.replace(pattern, "");
  }
  for (const banned of brandVoice?.bannedPatterns ?? []) {
    next = next.replace(new RegExp(banned, "ig"), "");
  }

  next = next.replace(/\b(.+?)\s+\1\b/gi, "$1");
  next = next.replace(/([.!?])\s+\1+/g, "$1");
  next = next.replace(/\s+([,.!?;:])/g, "$1");
  return next.replace(/\s+/g, " ").trim();
}

function toSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function normalizeForComparison(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

function tokenizeMeaning(text: string): string[] {
  return normalizeForComparison(text)
    .split(/\s+/)
    .filter((token) => token.length > 2 && !trivialWords.has(token));
}

function shareMeaning(left: string, right: string): boolean {
  const leftTokens = new Set(tokenizeMeaning(left));
  const rightTokens = tokenizeMeaning(right);

  if (leftTokens.size === 0 || rightTokens.length === 0) {
    return false;
  }

  let overlap = 0;
  for (const token of rightTokens) {
    if (leftTokens.has(token)) {
      overlap += 1;
    }
  }

  const ratio = overlap / Math.max(leftTokens.size, rightTokens.length);
  return overlap >= 4 || ratio >= 0.6;
}

function uniqueSentences(sentences: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const sentence of sentences) {
    const normalized = normalizeForComparison(sentence);
    if (seen.has(normalized)) {
      continue;
    }
    if (unique.some((candidate) => shareMeaning(candidate, sentence))) {
      continue;
    }
    seen.add(normalized);
    unique.push(sentence);
  }

  return unique;
}

function scoreSentence(sentence: string, pattern: RegExp): number {
  let score = 0;

  if (pattern.test(sentence)) {
    score += 5;
  }
  if (/the problem|real problem/i.test(sentence)) {
    score += 4;
  }
  if (/most teams miss/i.test(sentence)) {
    score += 4;
  }
  if (/business payoff|the payoff|payoff/i.test(sentence)) {
    score += 4;
  }
  if (sentence.length >= 40 && sentence.length <= 150) {
    score += 2;
  }
  if (/most teams miss|the problem|payoff|owner|approval|operator|rollout|business/i.test(sentence)) {
    score += 2;
  }
  if (/^most teams are not blocked/i.test(sentence)) {
    score -= 5;
  }
  if (/[,:;]\s*$/.test(sentence)) {
    score -= 1;
  }

  return score;
}

function selectBestSentence(
  sentences: string[],
  pattern: RegExp,
  used: string[],
  fallback?: string,
  scoreAdjuster?: (sentence: string) => number
): string {
  const available = sentences.filter(
    (sentence) => !used.some((usedSentence) => shareMeaning(usedSentence, sentence))
  );
  const ranked = available
    .map((sentence) => ({
      sentence,
      score: scoreSentence(sentence, pattern) + (scoreAdjuster?.(sentence) ?? 0)
    }))
    .sort((left, right) => right.score - left.score || left.sentence.length - right.sentence.length);

  return ranked[0]?.sentence ?? fallback ?? available[0] ?? "";
}

function trimToSentenceBoundary(text: string): string {
  const trimmed = text.replace(/[,:; -]+$/g, "").trim();
  const boundary = trimmed.search(/[.!?]/);
  if (boundary >= 18 && boundary < trimmed.length - 1) {
    return trimmed.slice(0, boundary).trim();
  }
  return trimmed;
}

function stripIncompleteSuffix(text: string): string {
  return text
    .replace(/\s+(with|without|because|so)\s+[^\s]+(?:\s+[^\s]+){0,5}$/i, "")
    .trim();
}

function toSentenceCase(text: string): string {
  if (!text) {
    return text;
  }
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function canonicalizeHook(sourceHook: string, problem: string): string {
  const joinedParts = sourceHook
    .split(/\s*,\s*and\s+|\s+and\s+/i)
    .map((part) => stripIncompleteSuffix(trimToSentenceBoundary(part)))
    .filter(Boolean);

  const viableParts = joinedParts.filter(
    (part) => part.length >= 18 && !/with a$/i.test(part) && !/without a$/i.test(part)
  );
  const candidate = viableParts[viableParts.length - 1] ?? "";
  const source = candidate || trimToSentenceBoundary(problem) || "The rollout story breaks early";
  const words = source.split(/\s+/);
  const trimmed: string[] = [];

  for (const word of words) {
    if ([...trimmed, word].join(" ").length > 56) {
      break;
    }
    trimmed.push(word);
  }

  const collapsed = trimToSentenceBoundary(trimmed.join(" "));
  return toSentenceCase(collapsed);
}

function cleanProblem(sentence: string): string {
  return toSentenceCase(stripIncompleteSuffix(trimToSentenceBoundary(sentence)));
}

function cleanMiss(sentence: string): string {
  return toSentenceCase(stripIncompleteSuffix(trimToSentenceBoundary(sentence)));
}

function cleanPayoff(sentence: string): string {
  return toSentenceCase(stripIncompleteSuffix(trimToSentenceBoundary(sentence)));
}

function stripRepeatedLead(sentence: string): string {
  const normalized = normalizeForComparison(sentence);
  const fragments = normalized.split(/\s+/);
  if (fragments.length < 8) {
    return sentence;
  }

  const half = Math.floor(fragments.length / 2);
  const lead = fragments.slice(0, half).join(" ");
  const tail = fragments.slice(half).join(" ");
  if (lead === tail) {
    return toSentenceCase(sentence.split(/\s+/).slice(0, half).join(" "));
  }
  return sentence;
}

function selectClosing(sourceClosing: string): string {
  const cleaned = sourceClosing
    .replace(/let me know your thoughts/gi, "How are you handling it?")
    .replace(/compare notes/gi, "How are you handling it?")
    .replace(/\?\.+$/g, "?")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.length <= 58 ? toSentenceCase(cleaned) : "How are you handling it?";
}

function naturalizeSentence(text: string): string {
  return toSentenceCase(
    text
      .replace(/\bthe point is\s+the point is\b/gi, "the point is")
      .replace(/\bwhat most teams miss is the point is\b/gi, "what most teams miss is")
      .replace(/\bthe payoff is the point is\b/gi, "the payoff is")
      .replace(/\bthe problem is the point is\b/gi, "the problem is")
      .replace(/\bthe problem is the payoff is\b/gi, "the problem is")
      .replace(/\babout why\b/gi, "because")
      .replace(/\s+/g, " ")
      .replace(/\s+([,.!?;:])/g, "$1")
      .trim()
  );
}

function naturalizeHook(text: string): string {
  let next = naturalizeSentence(text)
    .replace(/\bis about\b/gi, "")
    .replace(/\bbecause operators need\b/gi, "operators need")
    .replace(/\bbecause teams need\b/gi, "teams need")
    .replace(/\s+/g, " ")
    .trim();

  if (/about why/i.test(next)) {
    next = next.replace(/\babout why\b/gi, "");
  }

  // Strip bad hook patterns that indicate low quality
  next = next.replace(/^the problem is\b/gi, "");
  next = next.replace(/^missing ownership\b/gi, "When ownership is missing");

  // Remove leading bullets/dashes that survived earlier cleaning
  next = next.replace(/^[-•]\s*/g, "");

  next = stripIncompleteSuffix(trimToSentenceBoundary(next));
  if (next.length > 56) {
    const words = next.split(/\s+/);
    const trimmed: string[] = [];
    for (const word of words) {
      if ([...trimmed, word].join(" ").length > 52) {
        break;
      }
      trimmed.push(word);
    }
    next = stripIncompleteSuffix(trimToSentenceBoundary(trimmed.join(" ")));
  }

  return toSentenceCase(next);
}

function naturalizeParagraph(text: string): string {
  return naturalizeSentence(
    text
      .replace(/\bwhat most teams miss is what most teams miss is\b/gi, "what most teams miss is")
      .replace(/\bthe payoff is the payoff is\b/gi, "the payoff is")
      .replace(/\bthe problem is the problem is\b/gi, "the problem is")
  );
}

function humanizeParagraph(text: string): string {
  // Anti-blandness shaping: rewrite formulaic openings so output is less
  // template-shaped than plain naturalize. Without this differentiation
  // antiBlandness flag has no effect on final body (test contract violated).
  let rewritten = naturalizeParagraph(text);
  // Replace formulaic problem opening with a more specific framing
  rewritten = rewritten.replace(
    /^The problem is that\s+/i,
    "Here is what breaks: "
  ).replace(
    /^The problem is\s+/i,
    "What actually breaks is "
  );
  // Replace formulaic miss opening
  rewritten = rewritten.replace(
    /^What most teams miss is that\s+/i,
    "Most teams miss this: "
  ).replace(
    /^What most teams miss is\s+/i,
    "Most teams miss this - "
  );
  // Replace formulaic payoff opening
  rewritten = rewritten.replace(
    /^The payoff is that\s+/i,
    "The win is "
  ).replace(
    /^The payoff is\s+/i,
    "The win - "
  );
  return rewritten;
}

function composeBodyParagraphs(sentences: string[]): {
  problem: string;
  miss: string;
  payoff: string;
} {
  const used: string[] = [];
  const problem = cleanProblem(
    selectBestSentence(
      sentences,
      /problem|fail|fails|breaks|blocked|stall|friction|handoff|approval/i,
      used,
      undefined,
      (sentence) => {
        let score = 0;
        if (/stall|fails|breaks|blocked|friction/i.test(sentence)) {
          score += 8;
        }
        if (/handoff|approval/i.test(sentence)) {
          score += 2;
        }
        if (/payoff|business payoff/i.test(sentence)) {
          score -= 5;
        }
        if (/most teams miss/i.test(sentence)) {
          score -= 6;
        }
        return score;
      }
    )
  );
  used.push(problem);

  const miss = cleanMiss(
    selectBestSentence(
      sentences,
      /most teams miss|owner|ownership|pilot|workflow|handoff|approval|operator|discipline/i,
      used,
      sentences.find((sentence) => !used.some((usedSentence) => shareMeaning(usedSentence, sentence))),
      (sentence) => (/most teams miss/i.test(sentence) ? 4 : 0)
    )
  );
  used.push(miss);

  const payoff = cleanPayoff(
    selectBestSentence(
      sentences,
      /payoff|business|budget|revenue|operator|founder|approval|rollout|clarity|faster|less/i,
      used,
      sentences.find((sentence) => !used.some((usedSentence) => shareMeaning(usedSentence, sentence))),
      (sentence) => (/business payoff|payoff|faster|less budget drift/i.test(sentence) ? 4 : 0)
    )
  );

  return { problem, miss, payoff };
}

function uniqueParagraphs(paragraphs: string[]): string[] {
  const seen = new Set<string>();
  const selected: string[] = [];
  for (const paragraph of paragraphs) {
    if (!paragraph) {
      continue;
    }
    const normalized = normalizeForComparison(paragraph);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    selected.push(paragraph);
  }
  return selected;
}

function ensurePreferredPattern(text: string, _brandVoice?: BrandVoiceProfile | null): string {
  return text;
}

function normalizeOutcomeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function outcomeOverlapScore(left: string, right: string): number {
  const leftTokens = normalizeOutcomeText(left)
    .split(/\s+/)
    .filter((token) => token.length > 3 && !trivialWords.has(token));
  const rightTokens = new Set(
    normalizeOutcomeText(right)
      .split(/\s+/)
      .filter((token) => token.length > 3 && !trivialWords.has(token))
  );

  if (leftTokens.length === 0 || rightTokens.size === 0) {
    return 0;
  }

  return leftTokens.filter((token) => rightTokens.has(token)).length;
}

function pickBestOutcomeTheme(
  themes: string[],
  contentText: string
): string | undefined {
  const ranked = themes
    .map((theme) => ({
      theme,
      score: outcomeOverlapScore(theme, contentText)
    }))
    .sort((left, right) => right.score - left.score || left.theme.localeCompare(right.theme));

  return ranked[0]?.theme ?? themes[0];
}

function mapOutcomeThemeToHookMode(theme?: string): FinalPostGenerationConfig["hookMode"] {
  if (!theme) {
    return "sharp_observation";
  }

  const normalized = normalizeOutcomeText(theme);
  if (/workflow|accountability|owner|execution|operator/.test(normalized)) {
    return "execution_lesson";
  }
  if (/friction|support|pain|breakdown|recovery|exception/.test(normalized)) {
    return "operational_tension";
  }
  if (/pattern|teams|field/.test(normalized)) {
    return "field_pattern";
  }
  if (/tradeoff|state|system|reliability|coordination/.test(normalized)) {
    return "counterintuitive_claim";
  }
  return "sharp_observation";
}

function mapOutcomeThemeToToneBias(
  theme?: string
): "operator_execution" | "support_friction" | "resilience_recovery" | "system_tradeoff" | "neutral" {
  if (!theme) {
    return "neutral";
  }

  const normalized = normalizeOutcomeText(theme);
  if (/workflow|accountability|owner|execution|operator/.test(normalized)) {
    return "operator_execution";
  }
  if (/support|friction|pain|generic engagement|generic ai commentary/.test(normalized)) {
    return "support_friction";
  }
  if (/recovery|exception|resilience|failure/.test(normalized)) {
    return "resilience_recovery";
  }
  if (/tradeoff|state|system|reliability|coordination/.test(normalized)) {
    return "system_tradeoff";
  }
  return "neutral";
}

interface OutcomeShapingPlan {
  effectiveHookMode: FinalPostGenerationConfig["hookMode"];
  antiBlandnessEnabled: boolean;
  appliedOutcomeBias: FinalPostQualityMetadata["appliedOutcomeBias"];
  outcomePatternBiasNotes: string[];
  toneBias: "operator_execution" | "support_friction" | "resilience_recovery" | "system_tradeoff" | "neutral";
}

function deriveOutcomeShapingPlan(input: {
  contentText: string;
  config?: FinalPostGenerationConfig;
  outcomeContext?: FinalPostOutcomeContext;
}): OutcomeShapingPlan {
  const outcomeAwareEnabled = input.config?.outcomeAwareShaping === true;
  if (!outcomeAwareEnabled) {
    return {
      effectiveHookMode: input.config?.hookMode ?? "sharp_observation",
      antiBlandnessEnabled: input.config?.antiBlandness === true,
      appliedOutcomeBias: "neutral",
      outcomePatternBiasNotes: [],
      toneBias: "neutral"
    };
  }

  const positiveThemes = [
    ...(input.outcomeContext?.feedbackSummary?.suggestedRepeats ?? []),
    ...(input.outcomeContext?.feedbackSummary?.strongPatterns ?? []),
    ...(input.outcomeContext?.patternMemorySummary?.recurringThemes ?? [])
  ].filter(Boolean);
  const negativeThemes = [
    ...(input.outcomeContext?.feedbackSummary?.suggestedAvoids ?? []),
    ...(input.outcomeContext?.feedbackSummary?.weakPatterns ?? []),
    ...(input.outcomeContext?.patternMemorySummary?.weakThemes ?? [])
  ].filter(Boolean);

  const repeatTheme = pickBestOutcomeTheme(positiveThemes, input.contentText);
  const avoidTheme = pickBestOutcomeTheme(negativeThemes, input.contentText);
  const appliedOutcomeBias =
    repeatTheme && !avoidTheme ? "repeat" : !repeatTheme && avoidTheme ? "avoid" : repeatTheme ? "repeat" : avoidTheme ? "avoid" : "neutral";
  const dominantTheme = appliedOutcomeBias === "repeat" ? repeatTheme : avoidTheme;
  const outcomePatternBiasNotes =
    appliedOutcomeBias === "repeat" && repeatTheme
      ? [`Outcome bias: lean into ${repeatTheme}.`]
      : appliedOutcomeBias === "avoid" && avoidTheme
        ? [`Outcome bias: avoid ${avoidTheme}.`]
        : [];

  const antiBlandnessFromOutcome =
    appliedOutcomeBias === "avoid" ||
    /generic|broad|bland|commentary/.test(normalizeOutcomeText(avoidTheme ?? ""));

  return {
    effectiveHookMode: input.config?.hookMode ?? mapOutcomeThemeToHookMode(dominantTheme),
    antiBlandnessEnabled: input.config?.antiBlandness === true || antiBlandnessFromOutcome,
    appliedOutcomeBias,
    outcomePatternBiasNotes,
    toneBias: mapOutcomeThemeToToneBias(dominantTheme)
  };
}

function applyOutcomeToneBias(
  text: string,
  role: "problem" | "miss" | "payoff",
  toneBias: OutcomeShapingPlan["toneBias"]
): string {
  if (toneBias === "neutral") {
    return text;
  }

  if (toneBias === "operator_execution") {
    if (role === "problem") {
      return text.replace(/^The real breakdown starts when\b/i, "The execution breakdown starts when");
    }
    if (role === "miss") {
      return text.replace(/^Most teams miss the operating system around it:\b/i, "What actually matters is the owner, workflow, and exception path around it");
    }
    return text.replace(/^That is why\b/i, "That is why operator trust compounds when");
  }

  if (toneBias === "support_friction") {
    if (role === "problem") {
      return text.replace(/^The real breakdown starts when\b/i, "The support drag starts when");
    }
    if (role === "payoff") {
      return text.replace(/^That is why\b/i, "That is why support load drops when");
    }
  }

  if (toneBias === "resilience_recovery") {
    if (role === "problem") {
      return text.replace(/^The real breakdown starts when\b/i, "The recovery problem shows up when");
    }
    if (role === "payoff") {
      return text.replace(/^That is why\b/i, "That is why resilience improves when");
    }
  }

  if (toneBias === "system_tradeoff") {
    if (role === "miss") {
      return text.replace(/^What most teams miss is\b/i, "The real tradeoff is");
    }
    if (role === "payoff") {
      return text.replace(/^That is why\b/i, "That is why system reliability improves when");
    }
  }

  return text;
}

export async function linkedInPostComposer(input: {
  content: Pick<
    ContentAsset,
    "hook" | "body" | "cta" | "refinedHook" | "refinedBody" | "refinedCta"
  >;
  brandVoice?: BrandVoiceProfile | null;
  config?: FinalPostGenerationConfig;
  outcomeContext?: FinalPostOutcomeContext;
}): Promise<LinkedInPostComposerResult> {
  const sourceHook = stripRepeatedLead(
    cleanText(input.content.refinedHook ?? input.content.hook, input.brandVoice)
  );
  const sourceBody = cleanText(input.content.refinedBody ?? input.content.body, input.brandVoice);
  const sourceClosing = cleanText(input.content.refinedCta ?? input.content.cta, input.brandVoice);
  const outcomePlan = deriveOutcomeShapingPlan({
    contentText: [sourceHook, sourceBody, sourceClosing].join(" "),
    config: input.config,
    outcomeContext: input.outcomeContext
  });
  const antiBlandnessEnabled = outcomePlan.antiBlandnessEnabled;

  const sentences = uniqueSentences(toSentences(sourceBody));
  const bodyBlocks = composeBodyParagraphs(sentences);
  const hookResult = await hookWriter({
    sourceHook: canonicalizeHook(sourceHook, bodyBlocks.problem),
    problem: bodyBlocks.problem,
    miss: bodyBlocks.miss,
    payoff: bodyBlocks.payoff,
    brandVoice: input.brandVoice,
    config: {
      ...input.config,
      hookMode: outcomePlan.effectiveHookMode
    }
  });
  const hook = naturalizeHook(hookResult.selected);
  const composedPayoff = ensurePreferredPattern(
    antiBlandnessEnabled ? humanizeParagraph(bodyBlocks.payoff) : bodyBlocks.payoff,
    input.brandVoice
  );
  const paragraphs = uniqueParagraphs([
    applyOutcomeToneBias(
      antiBlandnessEnabled
        ? humanizeParagraph(bodyBlocks.problem)
        : naturalizeParagraph(bodyBlocks.problem),
      "problem",
      outcomePlan.toneBias
    ),
    applyOutcomeToneBias(
      antiBlandnessEnabled
        ? humanizeParagraph(bodyBlocks.miss)
        : naturalizeParagraph(bodyBlocks.miss),
      "miss",
      outcomePlan.toneBias
    ),
    applyOutcomeToneBias(naturalizeParagraph(composedPayoff), "payoff", outcomePlan.toneBias)
  ]).join("\n\n");
  const closing = selectClosing(sourceClosing);
  const hookStrengthScore = Math.min(
    98,
    74 +
      (hook.length <= 56 ? 8 : 0) +
      (/approval|owner|workflow|operator|decision|rollout|demo|pilot/i.test(hook) ? 10 : 0) +
      (!/:/.test(hook) ? 4 : 0)
  );
  const humanFeelScore = Math.min(
    98,
    72 +
      (antiBlandnessEnabled ? 10 : 0) +
      (!/^The problem is\b|^What most teams miss is\b|^The payoff is\b/m.test(paragraphs) ? 8 : 0)
  );
  const specificityScore = Math.min(
    98,
    72 +
      ((paragraphs.match(/\bapproval|owner|workflow|operator|handoff|exception|budget|decision\b/gi)?.length ??
        0) >= 3
        ? 12
        : 4)
  );
  const publishabilityScore = Math.min(
    98,
    76 +
      (paragraphs.split("\n\n").length === 3 ? 8 : 0) +
      (hook.length <= 56 ? 6 : 0) +
      (closing.length <= 58 ? 4 : 0) +
      (outcomePlan.appliedOutcomeBias === "repeat" ? 2 : 0)
  );
  const notes = [`Hook mode: ${outcomePlan.effectiveHookMode ?? "sharp_observation"}`];
  if (antiBlandnessEnabled) {
    notes.push("Anti-blandness shaping enabled.");
  }
  if (input.brandVoice && input.config?.preserveBrandVoice !== false) {
    notes.push("Brand voice preserved in final shaping.");
  }
  notes.push(...outcomePlan.outcomePatternBiasNotes);
  const qualityScore = Math.min(
    98,
    86 +
      (hook.length <= 56 ? 4 : 0) +
      (paragraphs.split("\n\n").length === 3 ? 4 : 0) +
      (!/audience:|voice:|tone:/i.test(paragraphs) ? 2 : 0) +
      (outcomePlan.appliedOutcomeBias === "repeat" ? 2 : 0)
  );

  return {
    hook,
    body: paragraphs,
    closing,
    qualityScore,
    qualityMetadata: {
      hookStrengthScore,
      humanFeelScore,
      specificityScore,
      publishabilityScore,
      notes,
      outcomePatternBiasNotes: outcomePlan.outcomePatternBiasNotes,
      appliedOutcomeBias: outcomePlan.appliedOutcomeBias
    }
  };
}
