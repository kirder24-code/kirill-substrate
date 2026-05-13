import { describe, expect, it } from "vitest";
import type {
  BrandVoiceProfile,
  ContentAsset,
  Idea,
  Signal
} from "@linkedin-brand-os/shared";
import {
  MockTextProvider,
  ProviderRegistry,
  ProviderRouter
} from "@linkedin-brand-os/ai-providers";
import {
  brandVoiceAgent,
  experimentalLinkedInPostWriterV2,
  finalPostFormatterAgent,
  hookWriter,
  providerBackedFinalPostService,
  providerBackedHumanWritingService,
  writingQualityAgent
} from "./index";

const signal: Signal = {
  id: "sig-1",
  title: "AI rollout blockers",
  sourceType: "manual",
  rawText: "Translate technical blockers into business language.",
  status: "new",
  createdAt: "2026-03-14T00:00:00.000Z"
};

const idea: Idea = {
  id: "idea-1",
  signalId: signal.id,
  title: "Operational AI rollout",
  coreInsight: "Teams need a practical rollout plan.",
  businessRelevance: "Operational clarity speeds adoption.",
  targetAudience: "Founders and operators",
  status: "draft",
  createdAt: "2026-03-14T00:00:00.000Z"
};

const content: ContentAsset = {
  id: "content-1",
  ideaId: idea.id,
  contentType: "linkedin-post",
  hook: "AI is changing everything for operators",
  body: "This is a game changer for every business because AI is changing everything.",
  cta: "Let me know your thoughts.",
  status: "draft",
  createdAt: "2026-03-14T00:00:00.000Z"
};

const voice: BrandVoiceProfile = {
  id: "voice-1",
  name: "Grounded Operator Voice",
  tone: "Direct, practical, calm",
  audience: "Founders and operator-led teams",
  writingRules: ["Use plain business language", "Lead with a concrete problem"],
  bannedPatterns: ["AI is changing everything", "game changer"],
  preferredPatterns: ["operational payoff", "practical rollout"],
  styleNotes: "Keep sentences varied and specific.",
  isActive: true,
  createdAt: "2026-03-14T00:00:00.000Z",
  updatedAt: "2026-03-14T00:00:00.000Z"
};

const experimentalSignal: Signal = {
  id: "sig-exp-1",
  title: "Why AI copilots fail after the demo",
  sourceType: "manual",
  rawText:
    "Most AI copilots look impressive in a demo, but collapse in real work because nobody designs the surrounding process. There is no clear owner, no exception handling, no workflow memory, and no operational accountability. The model is rarely the main problem.",
  status: "new",
  createdAt: "2026-03-14T00:00:00.000Z"
};

const experimentalVoice: BrandVoiceProfile = {
  id: "voice-exp-1",
  name: "Operator Skeptic Voice",
  tone: "Practical, sharp, grounded, anti-hype",
  audience: "Founders, operators, business owners, GTM and operations leaders",
  writingRules: ["Lead with the operational failure", "Keep claims concrete"],
  bannedPatterns: [
    "What leaders need to hear",
    "A business case for action",
    "In today’s fast-paced world",
    "AI is transforming everything",
    "The payoff is"
  ],
  preferredPatterns: [
    "in real operations",
    "the real problem is",
    "most teams miss this",
    "this breaks when",
    "what actually matters",
    "if nobody owns the workflow"
  ],
  styleNotes: "Sound like an operator who has watched systems fail in the wild.",
  isActive: true,
  createdAt: "2026-03-14T00:00:00.000Z",
  updatedAt: "2026-03-14T00:00:00.000Z"
};

describe("brand voice and human writing loop", () => {
  it("brandVoiceAgent normalizes a voice profile", async () => {
    const normalized = await brandVoiceAgent({
      name: " Grounded Operator Voice ",
      tone: " direct, practical, calm ",
      audience: " founders and operator-led teams ",
      writingRules: [" Use plain business language ", "Lead with a concrete problem"],
      bannedPatterns: [" AI is changing everything ", "game changer"],
      preferredPatterns: [" practical rollout ", "operational payoff"],
      styleNotes: " keep sentences varied and specific. ",
      isActive: true
    });

    expect(normalized).toEqual({
      name: "Grounded Operator Voice",
      tone: "Direct, practical, calm",
      audience: "Founders and operator-led teams",
      writingRules: ["Use plain business language", "Lead with a concrete problem"],
      bannedPatterns: ["AI is changing everything", "game changer"],
      preferredPatterns: ["practical rollout", "operational payoff"],
      styleNotes: "Keep sentences varied and specific.",
      isActive: true
    });
  });

  it("writingQualityAgent scores and improves robotic content", async () => {
    const result = await writingQualityAgent({ content, brandVoice: voice });

    expect(result.assessment.overallScore).toBeGreaterThan(0);
    expect(result.assessment.antiRobotScore).toBeLessThan(90);
    expect(result.refinement.refinedBody).not.toContain("AI is changing everything");
    expect(result.refinement.refinedBody).toContain("operational payoff");
  });

  it("provider-backed human writing service uses provider output and then runs the quality loop", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    const router = new ProviderRouter(registry, {
      mode: "mock",
      textProvider: "mock-text",
      fallbackEnabled: true
    });

    const result = await providerBackedHumanWritingService({
      idea,
      router,
      brandVoice: voice
    });

    expect(result.content.body).toContain("practical");
    expect(result.assessment.overallScore).toBeGreaterThan(0);
    expect(result.content.brandVoiceProfileId).toBe(voice.id);
  });

  it("deterministic fallback still passes through the quality loop", async () => {
    const router = new ProviderRouter(new ProviderRegistry(), {
      mode: "deterministic",
      fallbackEnabled: true
    });

    const result = await providerBackedHumanWritingService({
      idea,
      router,
      brandVoice: voice
    });

    expect(result.content.hook).toContain("Most teams miss");
    expect(result.assessment.notes.join(" ")).toContain("grounded");
  });

  it("finalPostFormatterAgent shortens the hook, removes repetition, and moves payoff earlier", async () => {
    const result = await finalPostFormatterAgent({
      content: {
        ...content,
        refinedHook:
          "AI rollout problems are real, and AI rollout problems are slowing teams down",
        refinedBody:
          "AI rollout problems are real. AI rollout problems are real. The problem is teams keep stitching together technical pilots and awkward handoffs instead of tying the work to budget, approvals, and operational payoff. The wording feels stitched together and stitched together again.",
        refinedCta: "Let me know your thoughts."
      },
      brandVoice: voice
    });

    expect(result.finalization.finalHook.length).toBeLessThan(
      "AI rollout problems are real, and AI rollout problems are slowing teams down".length
    );
    expect(result.finalization.finalHook.toLowerCase()).not.toContain("ai rollout problems are real");
    expect(result.finalization.finalBody.toLowerCase()).not.toContain("stitched together and stitched together");
    expect(result.finalization.finalBody).toContain("\n\n");
    expect(result.finalization.finalBody.toLowerCase().indexOf("operational payoff")).toBeLessThan(140);
    expect(result.finalization.finalBody).not.toContain("AI is changing everything");
    expect(result.finalization.finalStatus).toBe("ready");
    expect(result.finalization.finalQualityScore).toBeGreaterThan(0);
  });

  it("finalPostFormatterAgent strips metadata leakage and produces a cleaner post block", async () => {
    const result = await finalPostFormatterAgent({
      content: {
        ...content,
        refinedHook: "Voice: Direct, practical, calm",
        refinedBody:
          "Audience: Founders and operators. Voice: Direct, practical, calm. AI rollout breaks when teams treat pilots like strategy. AI rollout breaks when teams treat pilots like strategy. The operational payoff shows up when approvals, owners, and rollout timing are explicit.",
        refinedCta: "Audience: Founders. Compare notes."
      },
      brandVoice: voice
    });

    expect(result.finalization.finalHook).not.toContain("Voice:");
    expect(result.finalization.finalBody).not.toContain("Audience:");
    expect(result.finalization.finalBody).not.toContain("Voice:");
    expect(result.finalization.finalBody.split("\n\n").length).toBeGreaterThan(1);
    expect(result.finalization.finalBody.toLowerCase()).not.toContain(
      "ai rollout breaks when teams treat pilots like strategy. ai rollout breaks when teams treat pilots like strategy"
    );
  });

  it("providerBackedFinalPostService uses provider output before deterministic cleanup", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    const router = new ProviderRouter(registry, {
      mode: "mock",
      textProvider: "mock-text",
      fallbackEnabled: true
    });

    const result = await providerBackedFinalPostService({
      content: {
        ...content,
        refinedHook: "Audience: Founders",
        refinedBody:
          "Voice: Practical. AI is changing everything. Teams need operational payoff and better rollout discipline.",
        refinedCta: "Voice: Direct. Compare notes."
      },
      router,
      brandVoice: voice
    });

    expect(result.providerDraft.refinedHook).toContain("A clearer way to frame");
    expect(result.finalization.finalBody).not.toContain("Voice:");
    expect(result.finalization.finalBody).toContain("operational payoff");
  });

  it("providerBackedFinalPostService falls back cleanly when no provider is configured", async () => {
    const router = new ProviderRouter(new ProviderRegistry(), {
      mode: "deterministic",
      fallbackEnabled: true
    });

    const result = await providerBackedFinalPostService({
      content: {
        ...content,
        refinedHook: "Audience: Founders",
        refinedBody:
          "Audience: Founders. The operational payoff comes from clearer approvals and ownership.",
        refinedCta: "Compare notes."
      },
      router,
      brandVoice: voice
    });

    expect(result.finalization.finalBody).not.toContain("Audience:");
    expect(result.finalization.finalStatus).toBe("ready");
  });

  it("outcome-aware shaping leans into repeat-worthy patterns for final output", async () => {
    const result = await finalPostFormatterAgent({
      content: {
        ...content,
        refinedHook: "Teams lose momentum after the pilot",
        refinedBody:
          "The problem is approvals stay fuzzy after the pilot. What most teams miss is that rollout work needs one owner and one workflow memory. The business payoff is faster execution and cleaner operator trust.",
        refinedCta: "Compare notes."
      },
      brandVoice: voice,
      config: {
        outcomeAwareShaping: true
      },
      outcomeContext: {
        feedbackSummary: {
          strongPatterns: ["workflow accountability"],
          weakPatterns: [],
          suggestedRepeats: ["operator execution"],
          suggestedAvoids: [],
          reasoningSummary: "Workflow-accountability posts are landing well.",
          totalRecords: 2
        },
        patternMemorySummary: {
          repeatPatterns: [],
          avoidPatterns: [],
          recurringThemes: ["workflow accountability"],
          weakThemes: [],
          notes: "Long-term memory keeps reinforcing workflow accountability.",
          totalPatterns: 1
        }
      }
    });

    expect(result.finalization.finalQualityMetadata.notes).toEqual(
      expect.arrayContaining([expect.stringMatching(/Hook mode: execution_lesson/i)])
    );
    expect(result.finalization.finalQualityMetadata.appliedOutcomeBias).toBe("repeat");
    expect(result.finalization.finalQualityMetadata.outcomePatternBiasNotes).toEqual(
      expect.arrayContaining([expect.stringMatching(/workflow accountability|operator execution/i)])
    );
    expect(result.finalization.finalQualityMetadata.notes).toEqual(
      expect.arrayContaining([expect.stringMatching(/Outcome bias:/i)])
    );
  });

  it("outcome-aware shaping avoids weaker generic patterns in final output", async () => {
    const result = await finalPostFormatterAgent({
      content: {
        ...content,
        refinedHook: "AI is changing everything for operators",
        refinedBody:
          "The problem is that teams keep posting broad AI commentary after the demo. What most teams miss is that operator trust depends on a specific workflow owner. The payoff is better adoption and cleaner execution.",
        refinedCta: "Let me know your thoughts."
      },
      brandVoice: voice,
      config: {
        outcomeAwareShaping: true
      },
      outcomeContext: {
        feedbackSummary: {
          strongPatterns: [],
          weakPatterns: ["generic AI commentary"],
          suggestedRepeats: [],
          suggestedAvoids: ["broad generic AI commentary"],
          reasoningSummary: "Generic AI takes are underperforming.",
          totalRecords: 2
        },
        patternMemorySummary: {
          repeatPatterns: [],
          avoidPatterns: [],
          recurringThemes: [],
          weakThemes: ["generic AI commentary"],
          notes: "Long-term memory keeps flagging generic AI framing as weak.",
          totalPatterns: 1
        }
      }
    });

    expect(result.finalization.finalBody).not.toMatch(/^The problem is\b/m);
    expect(result.finalization.finalBody).not.toMatch(/^What most teams miss is\b/m);
    expect(result.finalization.finalQualityMetadata.appliedOutcomeBias).toBe("avoid");
    expect(result.finalization.finalQualityMetadata.outcomePatternBiasNotes).toEqual(
      expect.arrayContaining([expect.stringMatching(/generic ai commentary/i)])
    );
    expect(result.finalization.finalQualityMetadata.notes).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Anti-blandness shaping enabled/i),
        expect.stringMatching(/Outcome bias:/i)
      ])
    );
  });

  it("final post composer removes repeated semantic blocks and keeps one canonical outline", async () => {
    const result = await finalPostFormatterAgent({
      content: {
        ...content,
        refinedHook:
          "Most AI rollouts stall before the business case is clear and most AI rollouts stall before the business case is clear",
        refinedBody:
          "Most AI rollouts stall before the business case is clear. Most AI rollouts stall before the business case is clear. Teams keep handing off pilots without owners. Teams keep handing off pilots without owners and clear approvals. What most teams miss is that rollout work needs one owner, one approval path, and one operating rhythm. The business payoff shows up earlier when ownership, approvals, and timing are explicit. The business payoff shows up earlier when ownership, approvals, and timing are explicit.",
        refinedCta: "Compare notes."
      },
      brandVoice: voice
    });

    const paragraphs = result.finalization.finalBody.split("\n\n");

    expect(result.finalization.finalHook).toMatch(/[A-Za-z]/);
    expect(result.finalization.finalHook.length).toBeLessThanOrEqual(58);
    expect(result.finalization.finalHook.endsWith("and")).toBe(false);
    expect(result.finalization.finalHook.endsWith(",")).toBe(false);
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0].toLowerCase()).toContain("stall");
    expect(paragraphs[1].toLowerCase()).toContain("most teams miss");
    expect(paragraphs[2].toLowerCase()).toContain("business payoff");
    expect(result.finalization.finalBody.toLowerCase().match(/business payoff shows up earlier/g)?.length ?? 0).toBe(1);
    expect(result.finalization.finalBody.toLowerCase().match(/most teams miss/g)?.length ?? 0).toBe(1);
    expect(result.finalization.finalBody.toLowerCase().match(/owner/g)?.length ?? 0).toBeGreaterThan(0);
  });

  it("final post composer keeps the hook as one complete thought instead of a chopped fragment", async () => {
    const result = await finalPostFormatterAgent({
      content: {
        ...content,
        refinedHook:
          "Founders do not need another AI strategy memo, and they do not need another AI strategy memo with a half-finished operating model",
        refinedBody:
          "The problem is not interest. The problem is that teams launch pilots without a real owner. What most teams miss is that rollout discipline matters more than model choice. The business payoff comes from clearer approvals and operating cadence.",
        refinedCta: "Compare notes."
      },
      brandVoice: voice
    });

    expect(result.finalization.finalHook).toBe("They do not need another AI strategy memo");
    expect(result.finalization.finalHook.includes("half-finished operating model")).toBe(false);
  });

  it("final post composer keeps each paragraph focused on a distinct job", async () => {
    const result = await finalPostFormatterAgent({
      content: {
        ...content,
        refinedHook: "Most teams are not blocked by the model",
        refinedBody:
          "Most teams are not blocked by the model. The real problem is that approval paths stay fuzzy after the pilot. What most teams miss is that rollout work needs one operator, one owner, and one operating rhythm. The payoff is faster rollout, cleaner accountability, and less budget drift.",
        refinedCta: "Let me know your thoughts."
      },
      brandVoice: voice
    });

    const [problem, miss, payoff] = result.finalization.finalBody.split("\n\n");

    expect(problem.toLowerCase()).toContain("problem");
    expect(problem.toLowerCase()).not.toContain("most teams miss");
    expect(miss.toLowerCase()).toContain("most teams miss");
    expect(miss.toLowerCase()).not.toContain("payoff");
    expect(payoff.toLowerCase()).toContain("payoff");
    expect(result.finalization.finalClosing).toBe("How are you handling it?");
  });

  it("final post naturalizer produces a short complete hook without awkward truncation", async () => {
    const result = await finalPostFormatterAgent({
      content: {
        ...content,
        refinedHook:
          "A better AI rollout story is about why operators need clearer approvals and cleaner ownership",
        refinedBody:
          "The real problem is that approvals stay fuzzy after the pilot. What most teams miss is that the rollout needs one owner and one operating rhythm. The business payoff is faster execution and less budget drift.",
        refinedCta: "Compare notes."
      },
      brandVoice: voice
    });

    expect(result.finalization.finalHook.length).toBeLessThanOrEqual(56);
    expect(result.finalization.finalHook).not.toMatch(/about why/i);
    expect(result.finalization.finalHook).not.toMatch(/\bwith\b\s*$/i);
    expect(result.finalization.finalHook).toMatch(/[A-Za-z]$/);
  });

  it("final post naturalizer repairs awkward stitched phrasing without changing structure", async () => {
    const result = await finalPostFormatterAgent({
      content: {
        ...content,
        refinedHook: "Operators need a cleaner rollout story",
        refinedBody:
          "The point is the point is approvals stay vague after the pilot. What most teams miss is the point is practical rollout discipline matters more than the model demo. The payoff is clearer ownership and fewer stalled decisions.",
        refinedCta: "Let me know your thoughts."
      },
      brandVoice: voice
    });

    expect(result.finalization.finalBody).not.toContain("the point is the point is");
    expect(result.finalization.finalBody).not.toContain("What most teams miss is the point is");
    expect(result.finalization.finalBody.split("\n\n")).toHaveLength(3);
    expect(result.finalization.finalClosing).toBe("How are you handling it?");
  });

  it("hook writer produces 3 to 5 specific candidates and blocks generic opener language", async () => {
    const result = await hookWriter({
      sourceHook: "What leaders actually need to hear about AI rollout",
      problem: "The problem is approvals stay fuzzy after the pilot.",
      miss: "What most teams miss is that one owner needs to carry the rollout.",
      payoff: "The business payoff is faster decisions and less budget drift.",
      brandVoice: voice
    });

    expect(result.candidates.length).toBeGreaterThanOrEqual(3);
    expect(result.candidates.length).toBeLessThanOrEqual(5);
    expect(result.candidates.every((candidate) => candidate.length <= 56)).toBe(true);
    expect(
      result.candidates.some((candidate) => /what leaders actually need to hear|business case for action/i.test(candidate))
    ).toBe(false);
    expect(result.selected).not.toMatch(/what leaders actually need to hear/i);
    expect(result.selected).toMatch(/approval|owner|budget|rollout|decision/i);
  });

  it("hook writer selects one sharp complete hook instead of a vague abstract opener", async () => {
    const result = await finalPostFormatterAgent({
      content: {
        ...content,
        refinedHook: "A business case for action on AI rollout",
        refinedBody:
          "The real problem is that approvals stay vague after the pilot. What most teams miss is that one operator needs to own the rollout path. The business payoff is faster decisions and less budget drift.",
        refinedCta: "Compare notes."
      },
      brandVoice: voice
    });

    expect(result.finalization.finalHook).not.toMatch(/business case for action/i);
    expect(result.finalization.finalHook.length).toBeLessThanOrEqual(56);
    expect(result.finalization.finalHook).toMatch(/approval|owner|budget|rollout|decision/i);
  });

  it("hook writer prefers one standalone hook and rejects awkward stitched colon continuations", async () => {
    const result = await hookWriter({
      sourceHook: "Why AI copilots fail after the demo: Most AI copilots",
      problem: "The problem is ownership disappears after the demo.",
      miss: "What most teams miss is that one operator needs to own the workflow.",
      payoff: "The business payoff is faster adoption and fewer stalled decisions.",
      brandVoice: voice
    });

    expect(result.selected).not.toContain(": Most AI copilots");
    expect(result.selected).not.toMatch(/:\s+[A-Z][a-z]+\s+[A-Z][a-z]+/);
    expect(result.selected).toMatch(/demo|ownership|workflow|decisions|adoption/i);
    expect(result.selected.split(":").length).toBeLessThanOrEqual(2);
  });

  it("final post hook selection does not concatenate two candidate fragments into one opener", async () => {
    const result = await finalPostFormatterAgent({
      content: {
        ...content,
        refinedHook: "Why AI copilots fail after the demo: Most AI copilots",
        refinedBody:
          "The real problem is that ownership disappears after the demo. What most teams miss is that one operator needs to own the workflow. The business payoff is faster adoption and fewer stalled decisions.",
        refinedCta: "Compare notes."
      },
      brandVoice: voice
    });

    expect(result.finalization.finalHook).not.toContain(": Most AI copilots");
    expect(result.finalization.finalHook).not.toMatch(/Most AI copilots$/);
    expect(result.finalization.finalHook).toMatch(/demo|ownership|workflow|adoption|decisions/i);
  });

  it("finalPostFormatterAgent supports typed hook modes that change the opening strategy", async () => {
    const sharpObservation = await finalPostFormatterAgent({
      content: {
        ...content,
        refinedHook: "Teams keep calling the model the problem",
        refinedBody:
          "The real problem is that approvals disappear after the pilot. What most teams miss is that one operator needs to own the workflow and the exception path. The business payoff is faster decisions and less cleanup.",
        refinedCta: "Compare notes."
      },
      brandVoice: experimentalVoice,
      config: {
        hookMode: "sharp_observation",
        antiBlandness: true
      }
    });

    const executionLesson = await finalPostFormatterAgent({
      content: {
        ...content,
        refinedHook: "Teams keep calling the model the problem",
        refinedBody:
          "The real problem is that approvals disappear after the pilot. What most teams miss is that one operator needs to own the workflow and the exception path. The business payoff is faster decisions and less cleanup.",
        refinedCta: "Compare notes."
      },
      brandVoice: experimentalVoice,
      config: {
        hookMode: "execution_lesson",
        antiBlandness: true
      }
    });

    expect(sharpObservation.finalization.finalHook).not.toEqual(
      executionLesson.finalization.finalHook
    );
    expect(sharpObservation.finalization.finalQualityMetadata?.notes.join(" ")).toContain(
      "Hook mode: sharp_observation"
    );
    expect(executionLesson.finalization.finalQualityMetadata?.notes.join(" ")).toContain(
      "Hook mode: execution_lesson"
    );
  });

  it("finalPostFormatterAgent returns quality metadata for manual inspection", async () => {
    const result = await finalPostFormatterAgent({
      content: {
        ...content,
        refinedHook: "Approvals stall after the pilot",
        refinedBody:
          "The real problem is that approvals stay vague after the pilot. What most teams miss is that the workflow needs one owner and one exception path. The business payoff is faster decisions and cleaner adoption.",
        refinedCta: "Compare notes."
      },
      brandVoice: experimentalVoice,
      config: {
        hookMode: "operational_tension",
        antiBlandness: true,
        preservePublishabilityFocus: true
      }
    });

    expect(result.finalization.finalQualityMetadata).toEqual(
      expect.objectContaining({
        hookStrengthScore: expect.any(Number),
        humanFeelScore: expect.any(Number),
        specificityScore: expect.any(Number),
        publishabilityScore: expect.any(Number),
        notes: expect.arrayContaining([expect.stringContaining("Hook mode: operational_tension")])
      })
    );
  });

  it("anti-blandness shaping produces a less formulaic final body than plain deterministic cleanup", async () => {
    const plain = await finalPostFormatterAgent({
      content: {
        ...content,
        refinedHook: "Operators keep missing the operating model",
        refinedBody:
          "The problem is approvals stay vague after the pilot. What most teams miss is that the workflow needs one owner and one exception path. The payoff is faster decisions and less budget drift.",
        refinedCta: "Compare notes."
      },
      brandVoice: experimentalVoice,
      config: {
        hookMode: "execution_lesson",
        antiBlandness: false
      }
    });

    const shaped = await finalPostFormatterAgent({
      content: {
        ...content,
        refinedHook: "Operators keep missing the operating model",
        refinedBody:
          "The problem is approvals stay vague after the pilot. What most teams miss is that the workflow needs one owner and one exception path. The payoff is faster decisions and less budget drift.",
        refinedCta: "Compare notes."
      },
      brandVoice: experimentalVoice,
      config: {
        hookMode: "execution_lesson",
        antiBlandness: true
      }
    });

    expect(shaped.finalization.finalBody).not.toEqual(plain.finalization.finalBody);
    expect(shaped.finalization.finalQualityMetadata?.notes.join(" ")).toContain(
      "Anti-blandness shaping enabled."
    );
  });

  it("experimental LinkedInPostWriterV2 produces one coherent publishable post with no banned patterns", async () => {
    const result = await experimentalLinkedInPostWriterV2({
      signal: experimentalSignal,
      brandVoice: experimentalVoice
    });

    const paragraphs = result.post.split("\n\n");

    expect(result.mode).toBe("deterministic");
    expect(paragraphs).toHaveLength(5);
    expect(paragraphs[0].length).toBeLessThanOrEqual(56);
    expect(paragraphs[0]).not.toContain(":");
    expect(result.post).not.toMatch(/What leaders need to hear|A business case for action|In today’s fast-paced world|AI is transforming everything|Audience:|Voice:|Tone:/i);
    expect(result.post.toLowerCase().match(/workflow/g)?.length ?? 0).toBeLessThanOrEqual(2);
    expect(paragraphs[1].toLowerCase()).toMatch(/problem|breaks|fails|owner|exception|workflow/i);
    expect(paragraphs[2].toLowerCase()).toMatch(/most teams miss|what actually matters|real problem/i);
    expect(paragraphs[3].toLowerCase()).toMatch(/revenue|margin|adoption|cleanup|handoff|decision|accountability/i);
    expect(paragraphs[4].length).toBeLessThanOrEqual(80);
  });

  it("experimental LinkedInPostWriterV2 can use a provider candidate and still return a clean post", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    const router = new ProviderRouter(registry, {
      mode: "mock",
      textProvider: "mock-text",
      fallbackEnabled: true
    });

    const result = await experimentalLinkedInPostWriterV2({
      signal: experimentalSignal,
      brandVoice: experimentalVoice,
      idea,
      router
    });

    expect(result.mode).toBe("provider");
    expect(result.post).not.toContain("Audience:");
    expect(result.post).not.toContain("Voice:");
    expect(result.post.split("\n\n")).toHaveLength(5);
  });
});
