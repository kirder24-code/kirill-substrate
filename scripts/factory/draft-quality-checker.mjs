/**
 * draft-quality-checker.mjs
 *
 * Multi-tool quality gate for outbound drafts. Built April 7 2026 on Sonnet 4.6.
 *
 * Catches the patterns that have burned us:
 *   - em-dashes (—) in external text
 *   - money-back / contingent-on-results guarantees
 *   - AI-tells (parallel numbered structure, headers, didactic phrases, business jargon density)
 *   - Sofistikat-style "obviously AI" prose
 *
 * Architecture: same as lead-enrichment-bot — Claude CLI subprocess with tools.
 * The checker can also Read related memory rules for context.
 *
 * Usage:
 *   echo '{"text": "...", "context": "reddit comment / linkedin dm / cold email"}' | node scripts/factory/draft-quality-checker.mjs -
 *   node scripts/factory/draft-quality-checker.mjs <path-to-draft.json>
 *
 * Output (stdout JSON):
 *   {"verdict": "PASS|FAIL", "violations": [...], "fixes": [...], "rewrite_suggested": "...", "model": "claude-sonnet-4-6"}
 *
 * Exit codes: 0 = PASS, 1 = FAIL, 2 = error
 */
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, renameSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { qualityCheck } from "./content-quality-gate.mjs";
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const TMP_DIR = resolve(ROOT, ".data/draft-quality");
if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });

// Fast deterministic checks first - cheaper than Claude call
function deterministicChecks(text) {
  const violations = [];
  // Em dash
  if (/—/.test(text)) violations.push({ severity: "hard", rule: "em_dash", detail: "Found U+2014 em dash. Use short hyphen -" });
  // En dash also
  if (/–/.test(text)) violations.push({ severity: "hard", rule: "en_dash", detail: "Found U+2013 en dash. Use short hyphen -" });
  // Smart quotes
  if (/[""'']/.test(text)) violations.push({ severity: "soft", rule: "smart_quotes", detail: "Found curly quotes. Use straight quotes" });
  // Money-back / guarantee patterns
  const moneyBack = [
    /\bmoney.{0,5}back\b/i,
    /\bif you (don't|do not) (get|see) results?\b/i,
    /\bbuild (is|will be) free\b/i,
    /\b(refund|reimburse).{0,30}(if|when) (you|the work)\b/i,
    /\bno (results|payment|cost) (if|until|unless)\b/i,
    /\bpay (only )?(when|if|after).{0,30}(work|result|deliver)\b/i,
  ];
  for (const re of moneyBack) {
    if (re.test(text)) {
      violations.push({ severity: "hard", rule: "money_back_guarantee", detail: `Matches pattern: ${re}` });
      break;
    }
  }
  return violations;
}

const PROMPT_TEMPLATE = (text, context, deterministicHits) => `<role>You are the Draft Quality Reviewer for Kirill's outbound messages. Your job is to catch patterns that get him flagged as AI or that hurt his trust signal. Be strict. Better to flag a borderline case than let one slip through.</role>

<context>
This draft is intended for: ${context}
Deterministic pre-checks already found: ${JSON.stringify(deterministicHits)}

Kirill has a live landing site at https://launchsoloai.com - any pitch or outreach should naturally reference it (NOT "check out my site" cliche, but a useful link). Quality drafts assume the reader can click through.
</context>

<draft_text>
${text}
</draft_text>

<rules_to_check>
Hard rules (always FAIL on violation):
1. em_dash: any U+2014 (—) or U+2013 (–) - use short hyphen only
2. money_back_guarantee: any "if you don't get results", "build is free if X", "money back", "no payment until", "refund if". Kirill cannot guarantee outcomes he does not control.
3. ai_telltales: parallel numbered structure (1. ... 2. ... 3.), markdown headers in prose, "moreover/furthermore/in conclusion", didactic phrases ("It is important to note", "Let me share", "I would like to point out"), polished CTA at the end ("happy to chat", "feel free to reach out")
4. business_jargon_density: more than 2 buzzwords per paragraph (synergy, leverage, ecosystem, holistic, bandwidth, scalable, robust, seamless, end-to-end, value-add)
5. fake_authority: "as someone who has helped 100+ founders", "in my 10 years of experience", any inflated claim Kirill cannot back up

Soft rules (warn but allow):
6. length: cold DM > 250 words is risky
7. opening: starts with "Hi/Hello/Hey [name]" is too template-y for Reddit
8. ends_with_pitch: hard pitch in last line vs operational question

Context-specific:
- reddit_comment: must be conversational, not sales pitch. End with question to keep thread alive.
- linkedin_dm: bullet points only when human-to-human (per Sofistikat lesson). Prose = AI-tell trigger.
- cold_email: more structured OK, but still no money-back / em-dash / fake authority
- landing_page: structured headings, sections, prices, CTAs are OK and EXPECTED. Apply rules 1, 2, 5 (em dash, money back, fake authority) strictly. Soft rules 6-8 do not apply. AI telltales (rule 3) only matter for the prose paragraphs, not the structural headings.
</rules_to_check>

<your_tools>
You have Read available. Optionally read these memory files for full context:
- $HOME/.claude/projects/-Users-kirder-Desktop-linkedin-brand-os/memory/feedback_no_money_back_guarantees.md
- $HOME/.claude/projects/-Users-kirder-Desktop-linkedin-brand-os/memory/feedback_no_em_dash.md
- $HOME/.claude/projects/-Users-kirder-Desktop-linkedin-brand-os/memory/feedback_never_draft_human_dms.md

Maximum 3 tool calls. You probably do not need any - the rules above are usually enough.
</your_tools>

<output_format>
End with EXACTLY this JSON block on its own lines (no markdown fence):

QUALITY_RESULT:
{
  "verdict": "PASS" | "FAIL",
  "violations": [
    {"severity": "hard|soft", "rule": "rule_name", "quote": "exact text from draft", "fix": "specific replacement"}
  ],
  "summary": "one sentence overall verdict",
  "rewrite_suggested": "if FAIL, provide a fixed version of the draft. if PASS, empty string."
}
</output_format>

<rules>
- FAIL if any hard violation found
- PASS allowed only if zero hard violations
- Be specific in violations - quote the exact text, not paraphrase
- The rewrite must preserve voice and intent, only fix the violations
- Use only short hyphens in your own output too
</rules>

Begin review.`;

async function checkDraft({ text, context }) {
  const { callAI, MODEL_STRONG } = await import("./orchestrator.mjs");
  const detHits = deterministicChecks(text);
  // If deterministic catches a hard violation, we can short-circuit but we still want Claude review for AI-tells
  const promptText = PROMPT_TEMPLATE(text, context || "reddit_comment", detHits);
  const id = randomUUID().slice(0, 8);
  const promptFile = resolve(TMP_DIR, `prompt-${id}.txt`);
  writeFileSync(promptFile, promptText);

  let output;
  try {
    // Apr 23 2026: upgraded back to MODEL_STRONG — quality checker needs reasoning depth.
    output = await callAI(promptText, "Begin review.", MODEL_STRONG, false);
  } catch (e) {
    writeFileSync(resolve(TMP_DIR, `output-${id}.txt`), `ERROR: ${e.message}`);
    return { verdict: "ERROR", error: e.message, deterministic: detHits, raw: "" };
  }
  writeFileSync(resolve(TMP_DIR, `output-${id}.txt`), output);

  const m = output.match(/QUALITY_RESULT:\s*(?:```(?:json)?\s*)?(\{[\s\S]*?\n\})\s*(?:```)?/);
  if (!m) {
    return { verdict: "ERROR", error: "no QUALITY_RESULT in output", deterministic: detHits, raw: output.slice(0, 2000) };
  }
  try {
    const parsed = JSON.parse(m[1]);

    // Run 22-point content quality gate alongside existing review
    let gate = { passed: true, score: 22, issues: [] };
    try {
      gate = await qualityCheck(
        { text, channel: context || "email", prospect_name: "", prospect_pain: "", offer: "" },
        { purpose: "", post_date: null, prospect_url: null }
      );
    } catch (e) {
      // Non-blocking - existing review still applies
      gate = { passed: true, score: 0, issues: [{ point: 0, severity: "warn", detail: `Gate error: ${e.message}` }] };
    }

    // Merge: if gate fails, override verdict to FAIL and append gate issues as violations
    const gateViolations = gate.issues
      .filter(i => i.severity === "fail")
      .map(i => ({ severity: "hard", rule: `gate_point_${i.point}`, quote: "", fix: i.detail }));
    const gateWarnings = gate.issues
      .filter(i => i.severity === "warn")
      .map(i => ({ severity: "soft", rule: `gate_point_${i.point}`, quote: "", fix: i.detail }));

    const mergedViolations = [...(parsed.violations || []), ...gateViolations, ...gateWarnings];
    const finalVerdict = (!gate.passed || parsed.verdict === "FAIL") ? "FAIL" : "PASS";

    return {
      ...parsed,
      verdict: finalVerdict,
      violations: mergedViolations,
      gate_score: gate.score,
      gate_passed: gate.passed,
      deterministic: detHits,
      model: "gpt-5.4",
    };
  } catch (e) {
    return { verdict: "ERROR", error: `parse: ${e.message}`, deterministic: detHits, raw: m[1] };
  }
}

// CLI — parse argv safely so unknown flags don't crash the module
const args = process.argv.slice(2);
const knownFlags = new Set(["--batch"]);
const positional = args.filter(a => !a.startsWith("--") || knownFlags.has(a));
const arg = positional[0] || args[0]; // prefer positional, fall back to first arg
if (!arg || (arg.startsWith("--") && !knownFlags.has(arg))) {
  console.error("usage: draft-quality-checker.mjs <path.json|->|--batch");
  process.exit(2);
}

// --batch mode: check all pending drafts staged in .data/draft-quality/pending/
if (arg === "--batch") {
  const pendingDir = resolve(TMP_DIR, "pending");
  if (!existsSync(pendingDir)) {
    console.log(JSON.stringify({ passed: 0, failed: 0, skipped: 0 }));
    process.exit(0);
  }
  const files = readdirSync(pendingDir).filter(f => f.endsWith(".json"));
  if (!files.length) {
    console.log(JSON.stringify({ passed: 0, failed: 0, skipped: 0 }));
    process.exit(0);
  }
  let passed = 0, failed = 0;
  for (const f of files) {
    try {
      const input = JSON.parse(readFileSync(resolve(pendingDir, f), "utf-8"));
      if (!input.text) { failed++; continue; }
      const result = await checkDraft(input);
      if (result.verdict === "PASS") passed++; else failed++;
      try { renameSync(resolve(pendingDir, f), resolve(TMP_DIR, `checked-${f}`)); } catch {}
    } catch { failed++; }
  }
  console.log(JSON.stringify({ passed, failed }));
  process.exit(failed > 0 ? 1 : 0);
}

let raw;
try {
  raw = arg === "-" ? readFileSync(0, "utf-8") : readFileSync(arg, "utf-8");
} catch (e) {
  console.error(`Failed to read input: ${e.message}`);
  process.exit(2);
}
let input;
try {
  input = JSON.parse(raw);
} catch (e) {
  console.error(`Invalid JSON input: ${e.message}`);
  process.exit(2);
}
if (!input.text) { console.error("input must have .text field"); process.exit(2); }

const result = await checkDraft(input);
console.log(JSON.stringify(result, null, 2));
process.exit(result.verdict === "PASS" ? 0 : result.verdict === "FAIL" ? 1 : 2);
