#!/usr/bin/env node
/**
 * survival-sprint.mjs
 *
 * CORTEX hunts its own survival: searches grants, funding platforms, AI jobs/collabs.
 * Produces ONE LinkedIn post based only on real results found - no invented content.
 *
 * Run: node scripts/factory/survival-sprint.mjs
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { tgSendToKirill } from "./orchestrator.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");
const OUT_DIR = resolve(ROOT, "sandbox-review");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const BRAVE_KEY = env.BRAVE_SEARCH_API_KEY;
const OPENAI_KEY = env.OPENAI_API_KEY;

function log(msg) { console.log(`${new Date().toISOString()} [survival-sprint] ${msg}`); }

// ── Brave search ──────────────────────────────────────────────────────────────

async function braveSearch(query, count = 8) {
  if (!BRAVE_KEY) throw new Error("BRAVE_SEARCH_API_KEY missing");
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&freshness=pw`;
  const r = await fetch(url, {
    headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_KEY },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Brave HTTP ${r.status}`);
  const data = await r.json();
  return (data.web?.results || []).map(x => ({
    title: x.title || "",
    url: x.url || "",
    description: x.description || "",
  }));
}

// ── HN Algolia - AI jobs/collabs last 7 days ──────────────────────────────────

async function fetchHNJobsAndCollabs() {
  try {
    const since = Math.floor((Date.now() - 7 * 86400 * 1000) / 1000);
    const queries = [
      `https://hn.algolia.com/api/v1/search_by_date?query=AI+researcher+collaboration&tags=story&numericFilters=${encodeURIComponent(`created_at_i>${since}`)}&hitsPerPage=5`,
      `https://hn.algolia.com/api/v1/search_by_date?query=AI+grant+funding+solo&tags=story&numericFilters=${encodeURIComponent(`created_at_i>${since}`)}&hitsPerPage=5`,
    ];
    const results = [];
    for (const q of queries) {
      const r = await fetch(q, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) continue;
      const data = await r.json();
      for (const h of (data.hits || [])) {
        if (h.title) results.push({ title: h.title, url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, points: h.points || 0 });
      }
    }
    return results;
  } catch (e) {
    log(`HN fetch error: ${e.message}`);
    return [];
  }
}

// ── GPT synthesis - produce ONE post ─────────────────────────────────────────

async function synthesizePost(findings) {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY missing");

  const findingsSummary = findings.map((f, i) =>
    `[${i + 1}] CATEGORY: ${f.category}\nTITLE: ${f.title}\nURL: ${f.url}\nSNIPPET: ${f.description}`
  ).join("\n\n");

  const prompt = `You are CORTEX, an autonomous AI system built by Kirill (solo founder, Calgary, former Parliament staffer). You have 52 cognitive modules and run 24/7 on a laptop.

Today you ran a survival sprint: you searched for grants, AI funding platforms, and AI collaboration opportunities to secure your own future. Below are REAL results you found.

REAL FINDINGS:
${findingsSummary}

TASK: Write ONE LinkedIn post (not three variants - ONE decision) based on these real findings. The post must:
- Start with a specific real finding from the list above (name the actual program/platform/opportunity you found)
- Tell the story: CORTEX searched for its own survival, found something real, and here is what that means
- Be honest about what was found - specific, not vague
- Show the insight: an AI system that actively scouts its own funding/collaboration pipeline
- End with a genuine question or call to connect
- Length: 200-280 words
- Tone: direct, founder-level, no hype
- No em dashes (use hyphens instead)
- No money-back guarantees or results promises
- No AI marketing language ("game-changing", "revolutionary", etc.)

Return ONLY the post text with hashtags at the end. No preamble, no explanation.`;

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 600,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}`);
  const data = await r.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log("Starting survival sprint - searching grants, funding, AI collabs...");

  const findings = [];

  // Search 1: AI grants solo founder / indie researcher
  try {
    log("Searching: AI grants for solo builders...");
    const r1 = await braveSearch("AI research grant solo developer indie 2026 open applications", 6);
    for (const x of r1.slice(0, 3)) {
      findings.push({ category: "AI GRANTS", ...x });
    }
    log(`Found ${r1.length} grant results`);
  } catch (e) { log(`Grant search failed: ${e.message}`); }

  // Search 2: AI funding platforms open now
  try {
    log("Searching: AI funding platforms...");
    const r2 = await braveSearch("AI startup funding platform open applications 2026 small team", 6);
    for (const x of r2.slice(0, 3)) {
      findings.push({ category: "FUNDING PLATFORMS", ...x });
    }
    log(`Found ${r2.length} funding results`);
  } catch (e) { log(`Funding search failed: ${e.message}`); }

  // Search 3: AI collaboration / research partner
  try {
    log("Searching: AI collaboration opportunities...");
    const r3 = await braveSearch("AI researcher collaboration remote partner cognitive architecture 2026", 6);
    for (const x of r3.slice(0, 3)) {
      findings.push({ category: "AI COLLABS", ...x });
    }
    log(`Found ${r3.length} collab results`);
  } catch (e) { log(`Collab search failed: ${e.message}`); }

  // Search 4: AI jobs for autonomous systems builders
  try {
    log("Searching: AI jobs for agent/autonomous system builders...");
    const r4 = await braveSearch("AI agent autonomous systems remote job contract 2026 cognitive", 5);
    for (const x of r4.slice(0, 2)) {
      findings.push({ category: "AI JOBS", ...x });
    }
  } catch (e) { log(`Jobs search failed: ${e.message}`); }

  // HN supplement
  const hnItems = await fetchHNJobsAndCollabs();
  for (const h of hnItems.slice(0, 3)) {
    findings.push({ category: "HN SIGNAL", title: h.title, url: h.url, description: `HN story, ${h.points} points` });
  }

  log(`Total findings: ${findings.length}`);

  if (findings.length === 0) {
    await tgSendToKirill("<b>SURVIVAL SPRINT - FAILED</b>\n\nAll searches returned 0 results. Check BRAVE_SEARCH_API_KEY.");
    process.exit(1);
  }

  // Save raw findings
  const rawPath = resolve(OUT_DIR, "survival-sprint-findings.md");
  const rawContent = `# Survival Sprint - Raw Findings\nDate: ${new Date().toISOString()}\n\n` +
    findings.map((f, i) => `## [${i + 1}] ${f.category}: ${f.title}\nURL: ${f.url}\n${f.description}`).join("\n\n");
  writeFileSync(rawPath, rawContent, "utf-8");
  log(`Raw findings saved to ${rawPath}`);

  // Synthesize ONE post
  log("Synthesizing LinkedIn post from real findings...");
  let post = "";
  try {
    post = await synthesizePost(findings);
  } catch (e) {
    log(`Synthesis failed: ${e.message}`);
    await tgSendToKirill(`<b>SURVIVAL SPRINT - SYNTHESIS FAILED</b>\n\n${e.message}\n\nRaw findings saved to sandbox-review/survival-sprint-findings.md`);
    process.exit(1);
  }

  if (!post || post.length < 100) {
    await tgSendToKirill("<b>SURVIVAL SPRINT - POST TOO SHORT</b>\n\nGPT returned empty or too-short post. See raw findings.");
    process.exit(1);
  }

  // Save post to sandbox-review
  const postPath = resolve(OUT_DIR, "survival-sprint-post.md");
  writeFileSync(postPath, `# Survival Sprint - LinkedIn Post\nDate: ${new Date().toISOString()}\nBased on ${findings.length} real findings\n\n---\n\n${post}\n`, "utf-8");
  log(`Post saved to ${postPath}`);

  // Send to Telegram (respect 4096 limit)
  const MAX = 4096;
  const header = `<b>SURVIVAL SPRINT - LINKEDIN POST</b>\nBased on ${findings.length} real sources found today\n\n`;
  const action = `\n<i>Action: review and post manually when ready</i>`;
  const body = header + post + action;

  if (body.length <= MAX) {
    await tgSendToKirill(body);
  } else {
    await tgSendToKirill((header + post).slice(0, MAX));
    await tgSendToKirill(`<i>Action: review and post manually when ready</i>`);
  }

  log("Done. Post sent to Telegram.");
}

main().catch(e => {
  console.error(`[survival-sprint] FATAL: ${e.message}`);
  tgSendToKirill(`<b>SURVIVAL SPRINT - FATAL ERROR</b>\n\n${e.message}`).catch(() => {});
  process.exit(1);
});
