/**
 * content-quality-gate.mjs
 *
 * Universal 22-point quality checklist for ANY outbound draft.
 * Channels: Reddit comment, LinkedIn post/note, email, Threads post, insight article.
 *
 * Library module - exports only, no main execution.
 *
 * Usage:
 *   import { qualityCheck } from "./content-quality-gate.mjs";
 *   const result = qualityCheck(draft, context);
 *   // result: { passed, score, issues }
 *
 * April 27 2026
 */

import { callAI, MODEL_MINI } from "./orchestrator.mjs";

// ── AI-tell words ────────────────────────────────────────────────────
const AI_TELLS = [
  "delve", "leverage", "robust", "seamless", "streamline",
  "moreover", "furthermore", "in conclusion", "it is important to note",
  "let me share", "i would like to point out", "holistic",
  "synergy", "ecosystem", "bandwidth", "scalable", "end-to-end",
  "value-add", "game-changer", "cutting-edge",
];

const AI_TELL_RE = new RegExp(`\\b(${AI_TELLS.join("|")})\\b`, "gi");

// ── Money-back / results-based payment patterns ─────────────────────
const MONEY_BACK_PATTERNS = [
  /\bmoney.{0,5}back\b/i,
  /\bif you (don't|do not) (get|see) results?\b/i,
  /\bbuild (is|will be) free\b/i,
  /\b(refund|reimburse).{0,30}(if|when) (you|the work)\b/i,
  /\bno (results|payment|cost) (if|until|unless)\b/i,
  /\bpay (only )?(when|if|after).{0,30}(work|result|deliver)\b/i,
  /\bguarantee.{0,20}(result|outcome|revenue|roi)\b/i,
  /\b(free|no charge) (if|until|unless)\b/i,
];

// ── Voice agent / receptionist references (discontinued) ────────────
const VOICE_AGENT_RE = /\b(voice agent|voice receptionist|missed.call|ai receptionist|voice assistant|call.?answering)\b/i;

// ── URL validation ──────────────────────────────────────────────────
const ALLOWED_URL_HOSTS = ["launchsoloai.com", "www.launchsoloai.com"];
const URL_RE = /https?:\/\/[^\s)>\]"']+/gi;

// ── Channel limits ──────────────────────────────────────────────────
const CHANNEL_LIMITS = {
  reddit_comment: { maxWords: 400, minWords: 30 },
  linkedin_note: { maxChars: 200 },
  linkedin_post: { maxWords: 600, minWords: 50 },
  email: { maxWords: 300, minWords: 50 },
  threads: { maxChars: 500 },
  telegram: { maxChars: 4096 },
};

// ── Ideal word ranges per channel ───────────────────────────────────
const WORD_RANGES = {
  reddit_comment: [100, 300],
  email: [150, 250],
  linkedin_post: [100, 500],
};

// ── We language check ───────────────────────────────────────────────
const WE_LANGUAGE_RE = /\b(we offer|we build|we provide|we help|our team|we can|we will|we have built|we specialize|we are)\b/i;

// ── Price range ─────────────────────────────────────────────────────
const PRICE_RE = /\$[\d,]+(?:\.\d{2})?\s*(?:k|K|CAD|USD)?/g;

// ── Format artifacts ────────────────────────────────────────────────
const FORMAT_ARTIFACT_PATTERNS = [
  /  {2,}/,                        // triple+ spaces
  /\[.*?\]\((?!https?:\/\/).*?\)/, // broken markdown link
  /<\/?[a-z]+[^>]*>/i,            // HTML tags
  /\n{4,}/,                        // excessive blank lines
];

/**
 * Run all 22 quality checks on a draft.
 *
 * @param {object} draft - { text, channel, prospect_name, prospect_pain, offer }
 * @param {object} context - { purpose, post_date, prospect_url }
 * @returns {Promise<{ passed: boolean, score: number, issues: Array }>}
 */
export async function qualityCheck(draft, context = {}) {
  const { text = "", channel = "email", prospect_name, prospect_pain, offer } = draft;
  const { purpose = "", post_date, prospect_url } = context;

  const issues = [];

  function fail(point, detail) {
    issues.push({ point, severity: "fail", detail });
  }
  function warn(point, detail) {
    issues.push({ point, severity: "warn", detail });
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const charCount = text.length;

  // ═══════════════════════════════════════════════════════════════════
  // DETERMINISTIC CHECKS (fast, no AI)
  // ═══════════════════════════════════════════════════════════════════

  // 4. No em dashes
  if (/\u2014/.test(text)) fail(4, "Em dash (U+2014) found - use hyphen only");
  if (/\u2013/.test(text)) warn(4, "En dash (U+2013) found - use hyphen only");

  // 5. No money-back guarantees
  for (const re of MONEY_BACK_PATTERNS) {
    if (re.test(text)) {
      fail(5, `Money-back/results-based promise detected: ${text.match(re)[0]}`);
      break;
    }
  }

  // 7. No invented URLs
  const urls = text.match(URL_RE) || [];
  for (const url of urls) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      if (!ALLOWED_URL_HOSTS.map(h => h.replace(/^www\./, "")).includes(host)) {
        // Allow well-known external sites (reddit, linkedin, etc)
        const safeHosts = ["reddit.com", "linkedin.com", "github.com", "twitter.com", "x.com", "threads.net", "youtube.com"];
        if (!safeHosts.some(s => host === s || host.endsWith("." + s))) {
          fail(7, `Non-launchsoloai URL found: ${url}`);
        }
      }
    } catch {
      warn(7, `Malformed URL: ${url}`);
    }
  }

  // 8. Post date verified
  if (post_date) {
    const postMs = new Date(post_date).getTime();
    const nowMs = Date.now();
    const daysSince = (nowMs - postMs) / (1000 * 60 * 60 * 24);
    const isEngagement = ["reddit_comment", "linkedin_post", "threads"].includes(channel);
    const limit = isEngagement ? 14 : 30;
    if (daysSince > limit) {
      fail(8, `Post is ${Math.round(daysSince)} days old (limit: ${limit} for ${isEngagement ? "engagement" : "cold"} channel)`);
    }
  }

  // 9. No voice agent references
  if (VOICE_AGENT_RE.test(text)) {
    fail(9, `Voice agent/receptionist reference found: ${text.match(VOICE_AGENT_RE)[0]}`);
  }

  // 10. Signed correctly
  if (channel === "reddit_comment" && !/(- ?Kirill|Kirill,? Calgary)/i.test(text)) {
    warn(10, 'Reddit comment not signed "- Kirill, Calgary"');
  }
  if (channel === "email" && !/Kirill/i.test(text)) {
    warn(10, "Email not signed with name");
  }

  // 11. Under character/word limits
  const limits = CHANNEL_LIMITS[channel];
  if (limits) {
    if (limits.maxChars && charCount > limits.maxChars) {
      fail(11, `Over ${channel} char limit: ${charCount}/${limits.maxChars}`);
    }
    if (limits.maxWords && wordCount > limits.maxWords) {
      warn(11, `Over suggested word limit: ${wordCount}/${limits.maxWords}`);
    }
    if (limits.minWords && wordCount < limits.minWords) {
      warn(11, `Under minimum word count: ${wordCount}/${limits.minWords}`);
    }
  }

  // 12. CTA check (basic - multiple action verbs at end)
  const lastLines = text.split("\n").filter(Boolean).slice(-3).join(" ");
  const ctaVerbs = lastLines.match(/\b(book|schedule|call|email|DM|check out|visit|sign up|click|reply|reach out)\b/gi) || [];
  if (ctaVerbs.length > 2) {
    warn(12, `Multiple CTAs detected (${ctaVerbs.join(", ")}) - keep to one clear action`);
  }

  // 16. Price range check
  const prices = text.match(PRICE_RE) || [];
  for (const p of prices) {
    const num = parseFloat(p.replace(/[$,kK]/g, "").trim());
    const multiplier = /k/i.test(p) ? 1000 : 1;
    const actual = num * multiplier;
    if (actual > 0 && (actual < 1500 || actual > 8000)) {
      warn(16, `Price ${p} outside $1.5K-8K CAD range`);
    }
  }

  // 17. No "we" language
  if (WE_LANGUAGE_RE.test(text)) {
    fail(17, `"We" language detected (Kirill is solo): ${text.match(WE_LANGUAGE_RE)[0]}`);
  }

  // 19. Correct format for channel
  if (channel === "email" && /^#{1,3}\s/m.test(text)) {
    warn(19, "Markdown headers in email - use plain text");
  }
  if (channel === "email" && /\[.*?\]\(.*?\)/.test(text)) {
    warn(19, "Markdown links in email - use plain URLs");
  }

  // 20. Format artifacts
  for (const re of FORMAT_ARTIFACT_PATTERNS) {
    if (re.test(text)) {
      warn(20, `Format artifact detected: ${re.source}`);
      break;
    }
  }

  // 21. Length appropriate
  const range = WORD_RANGES[channel];
  if (range) {
    if (wordCount < range[0]) warn(21, `Too short for ${channel}: ${wordCount} words (target ${range[0]}-${range[1]})`);
    if (wordCount > range[1]) warn(21, `Too long for ${channel}: ${wordCount} words (target ${range[0]}-${range[1]})`);
  }

  // 22. launchsoloai.com mention
  if (["email", "linkedin_post"].includes(channel) && !/launchsoloai\.com/i.test(text)) {
    warn(22, "launchsoloai.com not mentioned - consider adding where natural");
  }

  // ═══════════════════════════════════════════════════════════════════
  // AI-ASSISTED CHECKS (subjective, need LLM judgment)
  // Points 1, 2, 3, 6, 13, 14, 15, 18
  // ═══════════════════════════════════════════════════════════════════

  // Pre-check: AI tells (point 3) - do a fast regex pass first
  const aiTellMatches = text.match(AI_TELL_RE) || [];
  if (aiTellMatches.length > 0) {
    fail(3, `AI-tell words found: ${[...new Set(aiTellMatches.map(w => w.toLowerCase()))].join(", ")}`);
  }

  // Batch subjective checks into one AI call for efficiency
  try {
    const aiPrompt = `You are a quality reviewer for outbound sales/content drafts written by Kirill (solo AI consultant in Calgary, Canada).

DRAFT TEXT:
"""
${text.slice(0, 2000)}
"""

CHANNEL: ${channel}
PROSPECT NAME: ${prospect_name || "unknown"}
PROSPECT PAIN: ${prospect_pain || "unknown"}
OFFER: ${offer || "unknown"}
PURPOSE CONTEXT: ${(purpose || "").slice(0, 500)}

Check these specific points and return JSON:
{
  "pain_match": { "pass": true/false, "reason": "..." },
  "icp_match": { "pass": true/false, "reason": "..." },
  "tone_human": { "pass": true/false, "reason": "..." },
  "specific_details": { "pass": true/false, "reason": "..." },
  "comment_first": { "pass": true/false, "reason": "..." },
  "real_capability": { "pass": true/false, "reason": "..." },
  "no_fake_studies": { "pass": true/false, "reason": "..." },
  "unique_to_prospect": { "pass": true/false, "reason": "..." }
}

Rules for each check:
1. pain_match: Does the draft address the prospect's ACTUAL pain point, not generic "AI can help you" fluff?
2. icp_match: Does the offer match the prospect type (SaaS founder vs service business vs agency)?
3. tone_human: Does it read like a real human wrote it? No corporate/AI tone, no didactic structure, no "happy to chat" filler?
4. specific_details: Does it mention concrete specifics (tools, numbers, timeframes) rather than vague promises?
5. comment_first: For reddit/linkedin - is this a comment/contribution first, not a DM/pitch-first approach?
6. real_capability: Does it reference things Kirill actually does (AI workflow automation, lead gen, chatbots, content systems - $1.5K-8K CAD)?
7. no_fake_studies: No invented case studies, fake testimonials, or made-up statistics?
8. unique_to_prospect: Does it feel customized to THIS prospect, not a copy-paste template?

Be strict. Better to flag borderline cases. Return ONLY the JSON object.`;

    const aiResult = await callAI(aiPrompt, "Check now.", MODEL_MINI, true);
    let parsed;
    if (typeof aiResult === "string") {
      const jsonMatch = aiResult.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } else {
      parsed = aiResult;
    }

    if (parsed) {
      // Point 1: pain_match
      if (parsed.pain_match && !parsed.pain_match.pass) {
        fail(1, parsed.pain_match.reason || "Draft does not address prospect's actual pain");
      }
      // Point 2: icp_match
      if (parsed.icp_match && !parsed.icp_match.pass) {
        warn(2, parsed.icp_match.reason || "Offer may not match prospect's situation");
      }
      // Point 3: tone_human (supplement regex check)
      if (parsed.tone_human && !parsed.tone_human.pass && aiTellMatches.length === 0) {
        fail(3, parsed.tone_human.reason || "Tone reads as AI-generated");
      }
      // Point 6: specific_details
      if (parsed.specific_details && !parsed.specific_details.pass) {
        warn(6, parsed.specific_details.reason || "Draft is vague - add specifics");
      }
      // Point 13: comment_first
      if (parsed.comment_first && !parsed.comment_first.pass) {
        if (["reddit_comment", "linkedin_post", "linkedin_note"].includes(channel)) {
          warn(13, parsed.comment_first.reason || "Should be comment-first, not DM-first");
        }
      }
      // Point 14: real_capability
      if (parsed.real_capability && !parsed.real_capability.pass) {
        fail(14, parsed.real_capability.reason || "References capabilities Kirill does not have");
      }
      // Point 15: no_fake_studies
      if (parsed.no_fake_studies && !parsed.no_fake_studies.pass) {
        fail(15, parsed.no_fake_studies.reason || "Fake case studies or invented numbers detected");
      }
      // Point 18: unique_to_prospect
      if (parsed.unique_to_prospect && !parsed.unique_to_prospect.pass) {
        warn(18, parsed.unique_to_prospect.reason || "Reads like a template - not customized");
      }
    }
  } catch (e) {
    warn(0, `AI check failed (non-blocking): ${e.message}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // SCORING
  // ═══════════════════════════════════════════════════════════════════
  const totalPoints = 22;
  const failedPoints = new Set(issues.filter(i => i.severity === "fail").map(i => i.point));
  const warnedPoints = new Set(issues.filter(i => i.severity === "warn").map(i => i.point));
  // Each fail = 0 points, each warn = 0.5 points, each pass = 1 point
  let score = totalPoints;
  for (const p of failedPoints) score -= 1;
  for (const p of warnedPoints) { if (!failedPoints.has(p)) score -= 0.5; }

  const passed = failedPoints.size === 0;

  return {
    passed,
    score: Math.max(0, Math.round(score * 10) / 10),
    issues,
  };
}
