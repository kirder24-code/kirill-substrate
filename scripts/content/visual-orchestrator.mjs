/**
 * scripts/content/visual-orchestrator.mjs
 *
 * Dispatches a brief to 5-7 specialist personas in parallel and collects
 * their structured opinions. Then visual-synthesizer.mjs combines them.
 *
 * This is the team-of-designers layer. Each specialist sees the same
 * brief and returns their angle. The synthesizer (next file) unifies.
 *
 * Public API:
 *   consultPanel({ idea, context, channel, audience, post_type })
 *     → { ok, panel: { psychologist, brand, news?, sales?, educational?, ... }, cost_usd }
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findTrendsForBrief, getDeadOrAvoidTrends } from "./trend-purpose-mapper.mjs";
import { findReferencesForBrief } from "./reference-query.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");
const PERSONAS_DIR = resolve(__dirname, "personas");

function buildReferenceBlock({ asset_level, post_type }) {
  // Build a compact reference list — only injected when visual-researcher is on the panel.
  const goalHint = {
    news: "attention", sales: "conversion", educational: "clarity",
    provocation: "provocation", carousel: "clarity", case_study: "trust",
    general: "premium",
  }[post_type] || "premium";
  const r = findReferencesForBrief({ goal: goalHint, asset_level, limit: 6 });
  if (!r.references.length) return "";
  let block = `\nCURATED REFERENCES (from references-seed.json, filtered for ${goalHint}/${asset_level}):\n`;
  for (const ref of r.references) {
    block += `- ${ref.name} [${ref.category}] — what_to_steal: ${ref.what_to_steal}\n`;
  }
  return block;
}

function buildTrendBlock({ asset_level, post_type }) {
  // Guess primary goal heuristically per post_type for ranking purposes;
  // visual-creative-director still owns the final goal choice.
  const goalHint = {
    news: "attention", sales: "conversion", educational: "clarity",
    provocation: "provocation", carousel: "clarity", case_study: "trust",
    general: "premium",
  }[post_type] || "premium";
  const active = findTrendsForBrief({ goal: goalHint, asset_level, post_type, limit: 4 });
  const avoid = getDeadOrAvoidTrends().slice(0, 6);
  if (!active.trends.length && !avoid.length) return "";
  let block = `\nRELEVANT TRENDS (from trend-memory.json, ranked by fit for ${goalHint}/${asset_level}):\n`;
  for (const t of active.trends) {
    block += `- [${t.slug}] ${t.trend} — use_for_substrate: ${t.use_for_substrate || "(see memory)"} | confidence ${t.confidence}\n`;
  }
  if (avoid.length) {
    block += `\nDEAD/AVOID TRENDS (do not propose these):\n`;
    for (const t of avoid) block += `- ${t.slug}: ${t.avoid || t.trend}\n`;
  }
  return block;
}

function envMap() {
  try {
    return Object.fromEntries(
      readFileSync(ENV_PATH, "utf-8").split("\n")
        .filter(l => l && !l.startsWith("#") && l.includes("="))
        .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
    );
  } catch { return {}; }
}

// Specialists always consulted (every brief). Creative-director closes the panel.
const ALWAYS = ["visual-psychologist", "brand-designer", "trend-watcher", "visual-creative-director"];

// Conditional specialists based on post_type
const BY_POST_TYPE = {
  news:        ["news-designer", "educational-designer"],
  sales:       ["sales-designer", "provocation-designer"],
  educational: ["educational-designer"],
  provocation: ["provocation-designer", "sales-designer"],
  carousel:    ["carousel-strategist", "educational-designer"],
  case_study:  ["sales-designer", "educational-designer", "provocation-designer"],
  general:     ["educational-designer", "provocation-designer"],
};

// Conditional specialists by asset_level. Motion/scroll bring new specialists onto the panel.
const BY_ASSET_LEVEL = {
  static: [],
  motion: ["motion-designer", "visual-researcher", "animation-strategist"],
  scroll: ["web-experience-designer", "interaction-designer", "motion-designer", "visual-researcher"],
};

// Localization always consulted if audience is non-default
function needsLocalization(audience) {
  if (!audience || audience === "general" || audience === "intel-upwork") return false;
  return ["au-rdti", "ca-lift", "calgary-smb", "russian", "ru"].includes(audience);
}

function loadPersona(name) {
  const path = resolve(PERSONAS_DIR, `${name}.md`);
  try { return readFileSync(path, "utf-8"); } catch { return null; }
}

const SPECIALIST_USER_TEMPLATE = `BRIEF FOR YOUR REVIEW:

IDEA: {{idea}}
POST TYPE: {{post_type}}
ASSET LEVEL: {{asset_level}}
CHANNEL: {{channel}}
AUDIENCE: {{audience}}
{{context_block}}
{{history_block}}
{{trends_block}}
{{references_block}}

Your task: read the persona file (you ARE that specialist) and return your structured opinion in the JSON format specified in your persona. Be specific to THIS brief — don't return generic advice. Where trend slugs or reference names are listed above, refer to them by name when relevant.

Return ONLY the JSON object specified in your persona. No markdown fences, no preamble, no commentary outside the JSON.`;

async function callOpenAI(persona, userMsg, key, model = "gpt-4o-mini") {
  const started = Date.now();
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: persona },
          { role: "user", content: userMsg },
        ],
        temperature: 0.4,
        max_tokens: 600,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!r.ok) {
      const body = await r.text();
      return { ok: false, reason: `openai_http_${r.status}`, body: body.slice(0, 200), latency_ms: Date.now() - started };
    }
    const j = await r.json();
    const content = j.choices?.[0]?.message?.content;
    if (!content) return { ok: false, reason: "empty_completion", latency_ms: Date.now() - started };
    let parsed;
    try { parsed = JSON.parse(content); } catch (e) {
      return { ok: false, reason: "json_parse", error: e.message, raw: content.slice(0, 200), latency_ms: Date.now() - started };
    }
    const tokens = j.usage?.total_tokens || 0;
    // gpt-4o-mini pricing approx
    const cost = tokens * 0.0000003; // very rough
    return { ok: true, opinion: parsed, latency_ms: Date.now() - started, cost_usd: cost };
  } catch (e) {
    return { ok: false, reason: "fetch_failed", error: e.message, latency_ms: Date.now() - started };
  }
}

export async function consultPanel({ idea, context = "", channel = "linkedin", audience = "general", post_type = "general", asset_level = "static", history_summary = "" }) {
  if (!idea) return { ok: false, reason: "no_idea" };

  const env = envMap();
  const key = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, reason: "no_openai_key" };

  // Build specialist list
  const conditional = BY_POST_TYPE[post_type] || BY_POST_TYPE.general;
  const byLevel = BY_ASSET_LEVEL[asset_level] || BY_ASSET_LEVEL.static;
  const specialists = [...new Set([...ALWAYS, ...conditional, ...byLevel])];
  if (needsLocalization(audience)) specialists.push("localization-designer");

  // Build user message
  const contextBlock = context ? `\nCONTEXT (about the topic):\n${context.slice(0, 600)}\n` : "";
  const historyBlock = history_summary ? `\nRECENT STYLE HISTORY (for variety):\n${history_summary}\n` : "";
  const trendsBlock = buildTrendBlock({ asset_level, post_type });
  // Only inject references when visual-researcher is on the panel (motion/scroll).
  const referencesBlock = specialists.includes("visual-researcher")
    ? buildReferenceBlock({ asset_level, post_type })
    : "";
  const userMsg = SPECIALIST_USER_TEMPLATE
    .replace("{{idea}}", idea)
    .replace("{{post_type}}", post_type)
    .replace("{{asset_level}}", asset_level)
    .replace("{{channel}}", channel)
    .replace("{{audience}}", audience)
    .replace("{{context_block}}", contextBlock)
    .replace("{{history_block}}", historyBlock)
    .replace("{{trends_block}}", trendsBlock)
    .replace("{{references_block}}", referencesBlock);

  // Parallel calls
  const tasks = specialists.map(async name => {
    const persona = loadPersona(name);
    if (!persona) return [name, { ok: false, reason: "persona_not_found" }];
    const r = await callOpenAI(persona, userMsg, key);
    return [name, r];
  });

  const results = await Promise.all(tasks);
  const panel = {};
  let total_cost = 0, total_latency = 0;
  const failures = [];
  for (const [name, r] of results) {
    panel[name] = r.opinion || null;
    total_cost += r.cost_usd || 0;
    total_latency = Math.max(total_latency, r.latency_ms || 0);
    if (!r.ok) failures.push({ name, reason: r.reason });
  }

  return {
    ok: failures.length < specialists.length,  // ok if at least one specialist returned
    specialists_consulted: specialists,
    panel,
    failures,
    total_cost_usd: total_cost,
    parallel_latency_ms: total_latency,
  };
}

// CLI smoke
if (import.meta.url === `file://${process.argv[1]}`) {
  const idea = process.argv[2] || "How Substrate turns market signals into sales";
  const post_type = process.argv[3] || "educational";
  const audience = process.argv[4] || "general";
  console.log(`Consulting panel on: "${idea}" (type=${post_type}, audience=${audience})`);
  consultPanel({ idea, post_type, audience }).then(r => {
    if (!r.ok) { console.error("FAIL:", r); process.exit(1); }
    console.log(`\nConsulted ${r.specialists_consulted.length} specialists in ~${r.parallel_latency_ms}ms, cost ~$${r.total_cost_usd.toFixed(4)}`);
    for (const [name, op] of Object.entries(r.panel)) {
      console.log(`\n── ${name} ──`);
      console.log(op ? JSON.stringify(op, null, 2).slice(0, 600) : "(no opinion)");
    }
  });
}
