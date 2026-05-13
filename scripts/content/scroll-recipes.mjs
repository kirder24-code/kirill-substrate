/**
 * scripts/content/scroll-recipes.mjs
 *
 * Predefined landing-page recipes for --level=scroll mode.
 * Each recipe returns a brief consumable by scroll-render.renderScroll.
 *
 * Recipes are deliberately HAND-WRITTEN per web-experience-designer.md:
 * substrate's positioning is too high-stakes to autogenerate. Specialists
 * may add new recipes; renaming or removing should be reviewed.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ORG_DB = resolve(ROOT, ".data/organism.db");

// Read live substrate facts so claims in the landing match reality (W10 honesty rule).
function readSubstrateFacts() {
  const facts = { beliefs: null, outcomes_total: null, outcomes_unprocessed: null, bots_active: null };
  if (!existsSync(ORG_DB)) return facts;
  try {
    const c = new Database(ORG_DB, { readonly: true });
    try { facts.beliefs = c.prepare("SELECT COUNT(*) AS n FROM beliefs").get().n; } catch {}
    try {
      const row = c.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN processed=0 THEN 1 ELSE 0 END) AS unp FROM outcomes").get();
      facts.outcomes_total = row?.total ?? null; facts.outcomes_unprocessed = row?.unp ?? null;
    } catch {}
    c.close();
  } catch {}
  return facts;
}

export function launchsoloaiLanding({ slug } = {}) {
  const f = readSubstrateFacts();
  const beliefsLine = f.beliefs ? `${f.beliefs} beliefs, learning loop, world model` : `Learning loop, world model, growing belief graph`;
  return {
    slug: slug || `landing-launchsoloai-${Date.now()}`,
    page_purpose: "marketing-landing",
    page_title: "Substrate — AI OS for solo operators",
    accent_color: "cyan",
    cta_url: "https://launchsoloai.com",
    sections: [
      {
        type: "hero",
        kicker: "SUBSTRATE · LAUNCHSOLOAI",
        headline: "AI operating systems for [accent]solo operators[/accent].",
        body: "Substrate replaces the chatbot with a disciplined AI OS. One operator, full pipeline, real artifacts.",
        cta_text: "Book a diagnostic →", cta_url: "https://launchsoloai.com",
      },
      {
        type: "problem",
        kicker: "PROBLEM · COMMON",
        headline: "Most AI agents are [accent]chatbots[/accent] in disguise.",
        body: "They demo well. In production they hallucinate, lose context between sessions, and skip verification. The result: a confident assistant that you can never trust unsupervised.",
        bullets: ["No memory between sessions","No verification of claims","No ability to act outside one prompt","No discipline when things go wrong"],
      },
      {
        type: "system",
        kicker: "SUBSTRATE · ARCHITECTURE",
        headline: "Five layers. Each layer has [accent]one job[/accent].",
        layers: [
          { name: "Voice (Tolik)", desc: "Operator interface, 49 tools, real-time conversation" },
          { name: "Discipline",     desc: "ISA gates, verification doctrine, egress guard" },
          { name: "Brain (Cortex)", desc: beliefsLine, highlight: true },
          { name: "Hands (Factory)", desc: "Scout, content, sales, awareness — the doing layer" },
          { name: "Storage",         desc: "SQLite + organism graph + persistent memory files" },
        ],
      },
      {
        type: "proof",
        kicker: "PROOF · LIVE",
        headline: "Discipline that [accent]refuses[/accent] to fake done.",
        body: "Every opportunity transition must pass the ISA gate. No bypass, even by the developer.",
        terminal: {
          title: "node scripts/survival/opportunity-store.mjs",
          lines: [
            { kind: "prompt", text: "transition('opp-australia', 'done')" },
            { kind: "text",   text: "ISA Gate response:" },
            { kind: "err",    text: "Error: isa_gate_blocked" },
            { kind: "text",   text: "  reason: '9/9 criterion ISCs still pending'" },
            { kind: "ok",     text: "State NOT changed. Discipline holds." },
          ],
        },
      },
      {
        type: "pricing",
        kicker: "ENGAGEMENT",
        headline: "Three ways to [accent]work together[/accent].",
        body: "Real numbers. No 'contact for pricing'.",
        tiers: [
          { tier: "Diagnostic",   amount: "$1,500", unit: "CAD · 1 week",   includes: ["Audit current workflow","Identify top 3 wins","ROI model","No commitment"] },
          { tier: "NBFC pattern", amount: "$5,000", unit: "CAD · 3 days",   includes: ["Apollo-Finvest 3-day build","Multi-vendor AI stack","Compliance gates","Production deploy"], featured: true },
          { tier: "Custom build", amount: "$10,000", unit: "CAD · 2-3 weeks", includes: ["Full Substrate adaptation","Industry-specific gates","Hand-off + training","30 days support"] },
        ],
      },
      {
        type: "cta",
        kicker: "NEXT STEP",
        headline: "Book a [accent]15-minute[/accent] diagnostic.",
        body: "No pitch. We look at your workflow on a call and tell you whether Substrate makes sense.",
        cta_text: "Book the diagnostic →", cta_url: "https://launchsoloai.com",
      },
    ],
  };
}

export function apolloCaseStudy({ slug } = {}) {
  return {
    slug: slug || `case-apollo-${Date.now()}`,
    page_purpose: "case-study",
    page_title: "Apollo Finvest — 3-day NBFC build",
    accent_color: "amber",
    cta_url: "https://launchsoloai.com",
    sections: [
      { type: "hero", kicker: "CASE · APOLLO FINVEST", headline: "From legacy NBFC ops to [accent]AI-led[/accent] in 3 days.", body: "How Substrate's pattern shipped a regulated lending workflow in under a week.", cta_text: "Read the build →", cta_url: "https://launchsoloai.com" },
      { type: "problem", kicker: "BRIEF", headline: "The ask.", body: "Apollo Finvest needed multi-vendor AI for borrower triage, RBI-compliant logging, and a dual-mode agent (operator + auto). All deployable in days, not months.", bullets: ["Multi-vendor AI (not vendor lock-in)","RBI compliance gates","Dual-mode: operator + autonomous","Production-grade, not pilot"] },
      { type: "system", kicker: "BUILD · STACK", headline: "Substrate's [accent]NBFC pattern[/accent] adapted in 3 days.", layers: [
        { name: "Vendor router", desc: "OpenAI + Anthropic + Gemini, fallback chain" },
        { name: "RBI gates",     desc: "Compliance enforcement before any borrower action", highlight: true },
        { name: "Triage agent",  desc: "Operator-augmented mode + autonomous mode" },
        { name: "Audit trail",   desc: "Every decision logged, replayable, signed" },
      ]},
      { type: "proof", kicker: "OUTCOME", headline: "[accent]Day 3[/accent]: production deploy. Same week: regulatory pass.", body: "What 'AI for NBFCs' really means when you have a substrate pattern to start from.",
        terminal: { title: "apollo-substrate deploy log", lines: [
          { kind: "prompt", text: "deploy('apollo-nbfc-v1', 'prod')" },
          { kind: "ok",     text: "RBI compliance gates: PASS" },
          { kind: "ok",     text: "Audit trail: signed, replayable" },
          { kind: "ok",     text: "Operator + autonomous modes: live" },
        ]} },
      { type: "cta", kicker: "REPLICATE", headline: "Same pattern for your [accent]NBFC[/accent].", body: "$5K CAD · 3 days · same architecture, adapted to your compliance regime.", cta_text: "Book a fit call →", cta_url: "https://launchsoloai.com" },
    ],
  };
}

export const RECIPES = {
  "launchsoloai-landing": launchsoloaiLanding,
  "apollo-case": apolloCaseStudy,
};

export function applyRecipe(name, opts) {
  const fn = RECIPES[name];
  if (!fn) return { ok: false, reason: "unknown_recipe", available: Object.keys(RECIPES) };
  return { ok: true, brief: fn(opts) };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const name = process.argv[2] || "launchsoloai-landing";
  const r = applyRecipe(name, {});
  console.log(r.ok ? JSON.stringify(r.brief, null, 2) : JSON.stringify(r, null, 2));
}
