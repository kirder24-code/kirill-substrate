/**
 * scripts/survival/site-content-generator.mjs
 *
 * Two actions:
 *   site_audit_live — fetches launchsoloai.com (or configured URL),
 *     runs web_strategist persona, writes audit to
 *     .data/site-drafts/audits/<ts>.md
 *
 *   site_content_generate — picks one missing content type from a
 *     curated production plan (vertical landing, testimonial framework,
 *     case study, blog post, FAQ block, comparison page) that does NOT
 *     yet exist in .data/site-drafts/, generates it via web_strategist
 *     + copywriter personas, writes to .data/site-drafts/<type>/<slug>.md
 *
 * Output is markdown that Kirill manually copies into his actual site
 * repo. Substrate cannot deploy directly.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { think } from "./llm-think.mjs";
import { getIdentityBlock } from "./operator-identity.mjs";
import { buildKnowledgeBlock } from "./wiki-brain.mjs";
import { buildLeadKnowledgeBlock } from "./lead-database.mjs";
import { loadPersona } from "./specialist-agents.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DRAFTS_DIR = resolve(ROOT, ".data/site-drafts");
const SITE_URL = process.env.OPERATOR_SITE_URL || "https://launchsoloai.com";

function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }

// --- ACTION: site_audit_live ---

export const siteAuditLiveMeta = {
  description: "Fetch operator's live site (launchsoloai.com), run web_strategist persona, save concrete improvement audit.",
  side_effect_class: "auto",
  expected_signal: "site_audit_md_written",
  expected_signal_delay_min: 0,
  estimated_cost_usd: 0.20,
};

export async function runSiteAuditLive({ strategy }) {
  let html;
  try {
    const res = await fetch(SITE_URL, { headers: { "User-Agent": "substrate-site-audit/0.1" } });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    html = (await res.text()).slice(0, 60_000);
  } catch (e) {
    return { ok: false, reason: "fetch_failed", error: e.message };
  }
  const cleaned = html.replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\s+/g, " ").trim().slice(0, 30_000);

  const persona = loadPersona("web_strategist");
  const identity = getIdentityBlock();
  const wiki = buildKnowledgeBlock("site landing page conversion B2B services", { limit: 2 });

  const prompt = `${persona}

## OPERATOR IDENTITY
${identity}

## PRIOR KNOWLEDGE
${wiki}

## SITE TO AUDIT (cleaned excerpt — no scripts/styles)
URL: ${SITE_URL}

${cleaned}

Apply your output specification to THIS site.`;

  const result = await think({
    prompt,
    model: "claude-sonnet-4-6",
    caller: "site:audit_live",
    strategy_id: strategy.id,
    max_input_tokens: 12_000,
    max_output_tokens: 3000,
  });
  if (!result.ok) return { ok: false, reason: result.reason, error: result.error };

  const auditDir = resolve(DRAFTS_DIR, "audits");
  ensureDir(auditDir);
  const out = resolve(auditDir, `audit-${Date.now()}.md`);
  const header = `# Site Audit: ${SITE_URL}\n\naudited_at: ${new Date().toISOString()}\nstrategy_id: ${strategy.id}\nllm_cost_usd: ${result.cost_usd.toFixed(4)}\n\n---\n\n`;
  writeFileSync(out, header + result.output);
  return { ok: true, output_file: out, llm_cost_usd: result.cost_usd };
}

// --- ACTION: site_content_generate ---

const CONTENT_PLAN = [
  // Vertical landing pages (high SEO value)
  { type: "vertical-landing", slug: "calgary-dental-clinics", title: "AI workflow automation for Calgary dental clinics", target_keyword: "AI automation dental practice Calgary" },
  { type: "vertical-landing", slug: "real-estate-brokers-canada", title: "AI workflow automation for Canadian real estate brokers", target_keyword: "AI automation real estate broker Canada" },
  { type: "vertical-landing", slug: "law-firms-canada", title: "AI workflow automation for Canadian law firms", target_keyword: "AI workflow law firm Canada SR&ED" },
  { type: "vertical-landing", slug: "smb-grants-implementation", title: "BDC LIFT AI implementation partner for Canadian SMB", target_keyword: "BDC LIFT AI implementation Canada" },
  { type: "vertical-landing", slug: "sred-ai-r-and-d-implementation", title: "SR&ED-eligible AI development for Canadian tech companies", target_keyword: "SR&ED AI development eligible expenditure" },
  // Trust assets
  { type: "case-study", slug: "apollo-finvest-3-day-build", title: "Apollo Finvest case study: full AI workflow in 3 days", target_keyword: "AI workflow case study fintech" },
  { type: "case-study", slug: "automation-pilot-pattern", title: "From email pilot to full pipeline in 18 days", target_keyword: "AI automation pilot SMB" },
  // Authority content
  { type: "blog", slug: "money-flow-pattern-grant-funded-ai", title: "The money-flow pattern: AI projects funded by grants", target_keyword: "grant funded AI implementation Canada" },
  { type: "blog", slug: "remote-canadian-ai-architect-cross-border", title: "Why remote Canadian AI consultants close cross-border deals", target_keyword: "remote AI consultant cross border" },
  { type: "blog", slug: "what-1500-cad-ai-pilot-actually-buys", title: "What a $1,500 CAD AI pilot actually delivers", target_keyword: "AI pilot pricing SMB Canada" },
  // Conversion enablers
  { type: "faq", slug: "smb-ai-faq", title: "SMB AI implementation: 12 questions Canadian owners ask", target_keyword: "AI for small business Canada FAQ" },
  { type: "comparison", slug: "ai-consultant-vs-agency-vs-fte", title: "AI consultant vs agency vs hire: real cost comparison", target_keyword: "AI consultant vs agency cost" },
  { type: "testimonial-template", slug: "testimonial-ask-templates", title: "How to ask 5 past clients for testimonials this week", target_keyword: "internal_only" },
];

function pickNextContent() {
  ensureDir(DRAFTS_DIR);
  const existing = new Set();
  for (const c of CONTENT_PLAN) {
    const dir = resolve(DRAFTS_DIR, c.type);
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) existing.add(`${c.type}/${f.replace(/\.md$/, "")}`);
    }
  }
  return CONTENT_PLAN.find(c => !existing.has(`${c.type}/${c.slug}`));
}

export const siteContentGenerateMeta = {
  description: "Generate ONE missing piece of site content (vertical landing / case study / blog / FAQ) into .data/site-drafts/. Operator copies into actual site repo.",
  side_effect_class: "auto",
  expected_signal: "site_content_draft_written",
  expected_signal_delay_min: 0,
  estimated_cost_usd: 0.30,
};

export async function runSiteContentGenerate({ strategy }) {
  const params = strategy.parameters_json ? JSON.parse(strategy.parameters_json) : {};
  let item;
  if (params.slug) {
    item = CONTENT_PLAN.find(c => c.slug === params.slug);
  } else {
    item = pickNextContent();
  }
  if (!item) return { ok: true, reason: "all_content_drafted" };

  const webPersona = loadPersona("web_strategist");
  const copyPersona = loadPersona("copywriter");
  const identity = getIdentityBlock();
  const wiki = buildKnowledgeBlock(item.title + " " + item.target_keyword, { limit: 3 });
  const leads = buildLeadKnowledgeBlock(item.target_keyword, { limit: 3 });

  const typeBriefs = {
    "vertical-landing": "Full landing page in markdown. Sections: H1 hero, subhead, 3-5 outcomes specific to this vertical (with named pain), one mini case study, pricing anchor, CTA, secondary CTA. SEO: target keyword in H1, intro, one H2.",
    "case-study": "Case study in markdown. Sections: client name + industry, problem (3 paragraphs of context), what was built (specific deliverables, tools used, timeline), measurable result (numbers), client quote if pluggable, CTA at end.",
    "blog": "Long-form blog post 800-1200 words in markdown. Sections: hook, 3-4 H2 subsections with concrete data/examples, conclusion with light CTA. SEO: target keyword in title, intro, one H2, meta description suggestion at top.",
    "faq": "12 question FAQ block in markdown. Each Q a real owner question (not hypothetical), each A 2-4 sentences with concrete number or specific answer. SEO: target keyword used naturally in 3-4 answers.",
    "comparison": "Comparison page in markdown. Side-by-side table: AI consultant / agency / FTE hire across 6-8 dimensions (cost, time-to-live, scope flexibility, ongoing cost, learning curve, ownership, risk, fit). Honest framing where consultant LOSES on some dimensions. CTA at end.",
    "testimonial-template": "Internal asset only (NOT for site). 5 different email templates Kirill can send to past clients/contacts asking for a structured testimonial. Each template under 100 words, plain text, no em dashes, names what specific result the client experienced.",
  };

  const prompt = `${webPersona}

---

${copyPersona}

---

## OPERATOR IDENTITY
${identity}

## PRIOR KNOWLEDGE FROM WIKI
${wiki}

## LEAD DB GROUNDING (real prior outreach + replies — for tone)
${leads}

## CONTENT TASK

Generate a ${item.type} for the operator's site (${SITE_URL}).

Title: ${item.title}
Slug: ${item.slug}
Target SEO keyword: ${item.target_keyword}
Type-specific brief: ${typeBriefs[item.type]}

Output ONLY the final markdown content, ready to paste into a static site
repo. Start with frontmatter:

---
title: "${item.title}"
slug: ${item.slug}
type: ${item.type}
target_keyword: ${item.target_keyword}
generated_at: ${new Date().toISOString()}
generated_by: substrate
---

Then the body. No preamble explaining what you wrote. NO em dashes. Hyphens
only. Voice must match operator-identity (remote Calgary AI architect, no
hype, concrete numbers, productized $1.5K-10K CAD packages).`;

  const result = await think({
    prompt,
    model: "claude-sonnet-4-6",
    caller: "site:content_generate",
    strategy_id: strategy.id,
    max_input_tokens: 12_000,
    max_output_tokens: 4000,
  });
  if (!result.ok) return { ok: false, reason: result.reason, error: result.error };

  const typeDir = resolve(DRAFTS_DIR, item.type);
  ensureDir(typeDir);
  const out = resolve(typeDir, `${item.slug}.md`);
  writeFileSync(out, result.output);
  return {
    ok: true,
    type: item.type,
    slug: item.slug,
    output_file: out,
    llm_cost_usd: result.cost_usd,
    next_in_queue: pickNextContent()?.slug || "(plan complete)",
  };
}
