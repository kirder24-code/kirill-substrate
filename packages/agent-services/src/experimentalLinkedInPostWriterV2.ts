import type {
  BrandVoiceProfile,
  ContentAsset,
  CreateBrandVoiceProfileInput,
  Idea,
  Signal
} from "@linkedin-brand-os/shared";
import type { ProviderRouter } from "@linkedin-brand-os/ai-providers";

export interface ExperimentalLinkedInPostWriterV2Result {
  hook: string;
  post: string;
  paragraphs: string[];
  mode: "provider" | "deterministic";
}

const bannedPatterns = [
  /what leaders need to hear/gi,
  /what leaders actually need to hear/gi,
  /a business case for action/gi,
  /in today'?s fast-paced world/gi,
  /ai is transforming everything/gi,
  /\bthe payoff is\b/gi,
  /\bAudience:\s*[^.\n]+[.\n]?/gi,
  /\bVoice:\s*[^.\n]+[.\n]?/gi,
  /\bTone:\s*[^.\n]+[.\n]?/gi
];

function cleanText(text: string): string {
  let next = text.replace(/\s+/g, " ").trim();
  for (const pattern of bannedPatterns) {
    next = next.replace(pattern, " ");
  }
  next = next.replace(/\s+([,.!?;:])/g, "$1");
  next = next.replace(/\b(.+?)\s+\1\b/gi, "$1");
  return next.replace(/\s+/g, " ").trim();
}

function toSentences(text: string): string[] {
  return cleanText(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function trimLine(text: string, maxLength = 56): string {
  const cleaned = cleanText(text).replace(/[.,!?;: -]+$/g, "");
  const words = cleaned.split(/\s+/);
  const trimmed: string[] = [];

  for (const word of words) {
    if ([...trimmed, word].join(" ").length > maxLength) {
      break;
    }
    trimmed.push(word);
  }

  return trimmed.join(" ").replace(/[.,!?;: -]+$/g, "");
}

function uniqueByMeaning(lines: string[]): string[] {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const normalized = line.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
    if (seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function buildDeterministicHook(signal: Signal): string {
  const title = cleanText(signal.title);
  const titleWithoutWhy = title.replace(/^why\s+/i, "");

  const candidates = uniqueByMeaning([
    trimLine(titleWithoutWhy),
    trimLine(`${titleWithoutWhy} when nobody owns the workflow`),
    trimLine("The demo is the easy part"),
    trimLine("AI copilots fail when the workflow has no owner")
  ]).filter((candidate) => candidate.length >= 18 && !candidate.includes(":"));

  return candidates[0] ?? "The demo is the easy part";
}

function findSentence(sentences: string[], pattern: RegExp, fallback: string): string {
  return sentences.find((sentence) => pattern.test(sentence)) ?? fallback;
}

function rewriteProblem(rawText: string, providerText?: string): string {
  const sentences = toSentences([rawText, providerText].filter(Boolean).join(" "));
  const source = findSentence(
    sentences,
    /collapse|real work|owner|exception|workflow|accountability/i,
    "The real problem starts after the demo, when the work hits live exceptions and nobody owns the path."
  );

  if (/nobody designs the surrounding process/i.test(source)) {
    return "The real problem starts after the demo, when the work hits a live process that nobody actually designed.";
  }

  return cleanText(
    source
      .replace(/^most ai copilots look impressive in a demo, but /i, "")
      .replace(/^the real problem is\s+/i, "The real problem is ")
  );
}

function rewriteWrong(rawText: string, providerText?: string): string {
  const sentences = toSentences([rawText, providerText].filter(Boolean).join(" "));
  const source = findSentence(
    sentences,
    /clear owner|exception handling|workflow memory|operational accountability|model is rarely/i,
    "Most teams miss this: they tune the model and skip the workflow around it."
  );

  if (/clear owner|exception handling|workflow memory|operational accountability/i.test(source)) {
    return "Most teams miss this: the useful system is the owner, exception path, memory, and accountability around the model.";
  }

  return "Most teams miss this: the demo is not the operating system.";
}

function rewriteWhyItMatters(rawText: string, providerText?: string): string {
  const sentences = toSentences([rawText, providerText].filter(Boolean).join(" "));
  const source = findSentence(
    sentences,
    /accountability|owner|workflow|real work|main problem/i,
    "That creates more cleanup, slower decisions, and less trust in the people who have to use it."
  );

  if (/model is rarely the main problem/i.test(source)) {
    return "That matters because the team ends up blaming the model for a workflow nobody owned in the first place.";
  }

  return "That shows up as more cleanup, slower decisions, and less trust in the system once the demo is over.";
}

function rewriteClosing(rawText: string): string {
  if (/model is rarely the main problem/i.test(rawText)) {
    return "The model is rarely the main problem.";
  }
  return "Own the workflow before you celebrate the demo.";
}

function cleanParagraph(paragraph: string): string {
  return cleanText(
    paragraph
      .replace(/\bthe payoff is\b/gi, "What matters is")
      .replace(/\bwhat leaders need to hear\b/gi, "")
      .replace(/\bwhat leaders actually need to hear\b/gi, "")
      .replace(/\ba business case for action\b/gi, "")
      .replace(/\bAI is transforming everything\b/gi, "")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function synthesizeIdea(signal: Signal, brandVoice?: BrandVoiceProfile | null): Idea {
  const firstSentence = toSentences(signal.rawText)[0] ?? signal.rawText;

  return {
    id: `exp-idea-${signal.id}`,
    signalId: signal.id,
    title: signal.title,
    coreInsight: cleanText(firstSentence),
    businessRelevance: "Operational reliability drives adoption.",
    targetAudience: brandVoice?.audience ?? "Founders and operators",
    status: "draft",
    createdAt: signal.createdAt
  };
}

function normalizeBrandVoice(
  input?: CreateBrandVoiceProfileInput | BrandVoiceProfile | null
): BrandVoiceProfile | null {
  if (!input) {
    return null;
  }

  if ("id" in input) {
    return input;
  }

  return {
    id: "experimental-brand-voice",
    ...input,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
}

function buildPostFromMeaning(input: {
  signal: Signal;
  providerText?: string;
  brandVoice?: BrandVoiceProfile | null;
}): { hook: string; paragraphs: string[] } {
  const hook = buildDeterministicHook(input.signal);
  const problem = cleanParagraph(rewriteProblem(input.signal.rawText, input.providerText));
  const wrong = cleanParagraph(rewriteWrong(input.signal.rawText, input.providerText));
  const matters = cleanParagraph(rewriteWhyItMatters(input.signal.rawText, input.providerText));
  const closing = cleanParagraph(rewriteClosing(input.signal.rawText));

  const paragraphs = uniqueByMeaning([hook, problem, wrong, matters, closing]).slice(0, 5);

  if (input.brandVoice?.preferredPatterns.some((pattern) => /if nobody owns the workflow/i.test(pattern))) {
    const alreadyHasWorkflowLine = paragraphs.some((paragraph) =>
      /if nobody owns the workflow/i.test(paragraph)
    );
    if (!alreadyHasWorkflowLine && paragraphs[2]) {
      paragraphs[2] = `${paragraphs[2]} If nobody owns the workflow, the model never survives real work.`;
    }
  }

  return {
    hook: paragraphs[0] ?? hook,
    paragraphs
  };
}

export async function experimentalLinkedInPostWriterV2(input: {
  signal: Signal;
  brandVoice?: BrandVoiceProfile | CreateBrandVoiceProfileInput | null;
  idea?: Idea | null;
  content?: ContentAsset | null;
  router?: ProviderRouter;
}): Promise<ExperimentalLinkedInPostWriterV2Result> {
  const brandVoice = normalizeBrandVoice(input.brandVoice);
  const fallbackIdea = input.idea ?? synthesizeIdea(input.signal, brandVoice);

  let mode: "provider" | "deterministic" = "deterministic";
  let providerText = "";

  if (input.router) {
    const providerDraft = await input.router.generatePostFromIdea({
      idea: fallbackIdea,
      fallback: async () => ({
        contentType: "linkedin-post",
        hook: buildDeterministicHook(input.signal),
        body: [rewriteProblem(input.signal.rawText), rewriteWrong(input.signal.rawText)].join(" "),
        cta: rewriteClosing(input.signal.rawText),
        status: "draft"
      })
    });

    providerText = [providerDraft.hook, providerDraft.body, providerDraft.cta]
      .map((value) => cleanText(value))
      .join(" ");

    if (providerText.length > 0 && /A clearer way to frame|practical/i.test(providerText)) {
      mode = "provider";
    }
  }

  const composed = buildPostFromMeaning({
    signal: input.signal,
    providerText,
    brandVoice
  });

  return {
    hook: composed.hook,
    post: composed.paragraphs.join("\n\n"),
    paragraphs: composed.paragraphs,
    mode
  };
}
