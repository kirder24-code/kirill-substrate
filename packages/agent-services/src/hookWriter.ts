import type {
  BrandVoiceProfile,
  FinalPostGenerationConfig,
  FinalPostHookMode
} from "@linkedin-brand-os/shared";

export interface HookWriterResult {
  candidates: string[];
  selected: string;
}

interface HookCandidate {
  text: string;
  source: "source" | "problem" | "miss" | "payoff" | "hybrid";
  mode?: FinalPostHookMode;
}

const blockedPatterns = [
  /what leaders actually need to hear/gi,
  /a business case for action/gi,
  /the future of /gi,
  /why this matters now/gi,
  /what you need to know/gi,
  /join our/gi,
  /did you know/gi
];

const weakLeadPatterns = [
  /^\bthis is\b/i,
  /^\bthere is\b/i,
  /^\bthere are\b/i,
  /^\ba better\b/i,
  /^\bwhat most teams miss is\b/i,
  /^\bthe problem is\b/i,
  /^\bmissing ownership\b/i,
  /^[-•]\s+/,
  /^#\w+/
];

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\s+([,.!?;:])/g, "$1").trim();
}

function toSentenceCase(text: string): string {
  if (!text) {
    return text;
  }
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function trimHook(text: string): string {
  const cleaned = normalizeWhitespace(text).replace(/[.,!?;: -]+$/g, "");
  const words = cleaned.split(/\s+/);
  const trimmed: string[] = [];

  for (const word of words) {
    if ([...trimmed, word].join(" ").length > 56) {
      break;
    }
    trimmed.push(word);
  }

  return toSentenceCase(trimmed.join(" ").replace(/[.,!?;: -]+$/g, ""));
}

function blockGenericLanguage(text: string): string {
  let next = text;
  for (const pattern of blockedPatterns) {
    next = next.replace(pattern, "");
  }
  return normalizeWhitespace(next);
}

function naturalizeHook(text: string): string {
  let next = blockGenericLanguage(text)
    .replace(/\babout why\b/gi, "")
    .replace(/\bwhat most teams miss is the point is\b/gi, "")
    .replace(/\bthe point is the point is\b/gi, "")
    .replace(/\bthe point is\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  for (const pattern of weakLeadPatterns) {
    next = next.replace(pattern, "");
  }

  return trimHook(next);
}

function splitColonHook(text: string): string {
  if (!text.includes(":")) {
    return naturalizeHook(text);
  }

  const parts = text
    .split(":")
    .map((part) => naturalizeHook(part))
    .filter((part) => part.length >= 12);

  if (parts.length < 2) {
    return naturalizeHook(text);
  }

  const [left, right] = parts;
  const leftScore =
    (/fail|break|stall|demo|approval|owner|workflow|budget|decision/i.test(left) ? 4 : 0) +
    (!/^most\s/i.test(left) ? 2 : 0);
  const rightScore =
    (/fail|break|stall|demo|approval|owner|workflow|budget|decision/i.test(right) ? 4 : 0) +
    (!/^most\s/i.test(right) ? 2 : 0);

  return trimHook(leftScore >= rightScore ? left : right);
}

function uniqueCandidates(candidates: HookCandidate[]): HookCandidate[] {
  const seen = new Set<string>();
  const unique: HookCandidate[] = [];

  for (const candidate of candidates) {
    const cleaned = splitColonHook(candidate.text);
    if (!cleaned || cleaned.length < 18) {
      continue;
    }
    const normalized = cleaned.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push({
      ...candidate,
      text: cleaned
    });
  }

  return unique.slice(0, 5);
}

function modeLabel(mode: FinalPostHookMode | undefined): string {
  switch (mode) {
    case "operational_tension":
      return "operational_tension";
    case "counterintuitive_claim":
      return "counterintuitive_claim";
    case "execution_lesson":
      return "execution_lesson";
    case "field_pattern":
      return "field_pattern";
    case "sharp_observation":
    default:
      return "sharp_observation";
  }
}

function buildModeCandidates(
  mode: FinalPostHookMode | undefined,
  problemCore: string,
  missCore: string,
  payoffCore: string
): HookCandidate[] {
  const problemFocus = problemCore
    .replace(/^the problem is\s+/i, "")
    .replace(/^the real problem is\s+/i, "");
  const missFocus = missCore.replace(/^what most teams miss is\s+/i, "");
  const payoffFocus = payoffCore
    .replace(/^the business payoff is\s+/i, "")
    .replace(/^the payoff is\s+/i, "");

  switch (mode) {
    case "operational_tension":
      return [
        {
          text: `${problemFocus.replace(/\.$/, "")}`,
          source: "problem",
          mode
        },
        {
          text: `${problemFocus.split(".")[0]} ${missFocus.split(".")[0]}`.trim(),
          source: "hybrid",
          mode
        }
      ];
    case "counterintuitive_claim":
      return [
        {
          text: payoffFocus
            .replace(/^faster\s+/i, "Speed does not fix ")
            .replace(/^less\s+/i, "Less does not fix "),
          source: "payoff",
          mode
        },
        {
          text: `The model is not the hard part ${missFocus}`.trim(),
          source: "hybrid",
          mode
        }
      ];
    case "execution_lesson":
      return [
        {
          text: `One operator needs to own ${missFocus.replace(/^that\s+/i, "").replace(/^one operator needs to own\s+/i, "").replace(/^the workflow needs\s+/i, "the workflow ")}`,
          source: "miss",
          mode
        },
        {
          text: `Execution stalls when ${problemFocus.replace(/^\bthat\b\s+/i, "")}`,
          source: "hybrid",
          mode
        }
      ];
    case "field_pattern":
      return [
        {
          text: `Most teams ${problemFocus}`,
          source: "hybrid",
          mode
        },
        { text: missCore, source: "miss", mode }
      ];
    case "sharp_observation":
    default:
      return [
        { text: problemCore, source: "problem", mode: "sharp_observation" },
        { text: payoffCore, source: "payoff", mode: "sharp_observation" }
      ];
  }
}

function scoreHook(
  candidate: HookCandidate,
  brandVoice?: BrandVoiceProfile | null,
  preferredMode?: FinalPostHookMode
): number {
  const text = candidate.text;
  let score = 0;

  if (text.length >= 24 && text.length <= 56) {
    score += 4;
  }
  if (/approval|owner|budget|rollout|decision|handoff|operator|pilot/i.test(text)) {
    score += 5;
  }
  if (/what leaders actually need to hear|business case for action|future of|what you need to know/i.test(text)) {
    score -= 8;
  }
  if (/problems are real|story|actually need to hear|business case/i.test(text)) {
    score -= 6;
  }
  if (/do not need|needs one|breaks before|stalls when/i.test(text)) {
    score += 5;
  }
  if (/^that\s/i.test(text)) {
    score -= 6;
  }
  if (/[,:;]/.test(text)) {
    score -= 2;
  }
  if (weakLeadPatterns.some((pattern) => pattern.test(text))) {
    score -= 4;
  }
  if (brandVoice?.preferredPatterns.some((pattern) => text.toLowerCase().includes(pattern.toLowerCase()))) {
    score += 2;
  }
  if (candidate.source === "source") {
    score += 2;
  }
  if (preferredMode && candidate.mode === preferredMode) {
    score += 4;
  }
  if (preferredMode === "execution_lesson" && /need|owner|approval|workflow|operator/i.test(text)) {
    score += 3;
  }
  if (preferredMode === "operational_tension" && /break|stall|fail|friction|after the pilot|after the demo/i.test(text)) {
    score += 3;
  }
  if (preferredMode === "counterintuitive_claim" && /not the problem|not the hard part|rarely the main problem/i.test(text)) {
    score += 3;
  }
  if (preferredMode === "field_pattern" && /^most teams/i.test(text)) {
    score += 3;
  }
  if (preferredMode === "sharp_observation" && !/^most teams/i.test(text)) {
    score += 2;
  }

  return score;
}

export async function hookWriter(input: {
  sourceHook: string;
  problem: string;
  miss: string;
  payoff: string;
  brandVoice?: BrandVoiceProfile | null;
  config?: FinalPostGenerationConfig;
}): Promise<HookWriterResult> {
  const sourceHook = naturalizeHook(input.sourceHook);
  const problemCore = naturalizeHook(input.problem.replace(/^the problem is\s+/i, ""));
  const missCore = naturalizeHook(input.miss.replace(/^what most teams miss is\s+/i, ""));
  const payoffCore = naturalizeHook(input.payoff.replace(/^the business payoff is\s+/i, "").replace(/^the payoff is\s+/i, ""));
  const preferredMode = input.config?.hookMode ?? "sharp_observation";

  const candidates = uniqueCandidates([
    { text: sourceHook, source: "source" },
    { text: problemCore, source: "problem" },
    { text: missCore, source: "miss" },
    { text: payoffCore, source: "payoff" },
    {
      text: `${problemCore.split(".")[0]} ${payoffCore.split(".")[0]}`.trim(),
      source: "hybrid"
    },
    ...buildModeCandidates(preferredMode, problemCore, missCore, payoffCore)
  ]);

  const selected =
    [...candidates].sort(
      (left, right) =>
        scoreHook(right, input.brandVoice, preferredMode) -
          scoreHook(left, input.brandVoice, preferredMode) ||
        left.text.length - right.text.length
    )[0]?.text ?? "The rollout breaks before ownership is clear";

  return {
    candidates: candidates.map((candidate) => candidate.text),
    selected
  };
}
