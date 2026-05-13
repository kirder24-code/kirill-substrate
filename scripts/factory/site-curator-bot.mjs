/**
 * site-curator-bot.mjs
 *
 * Multi-tool agent on Sonnet 4.6 that monitors and maintains launchsoloai.com.
 * Built April 7 2026 to answer "who watches the site?"
 *
 * Runs weekly (Sunday 8 PM cron) and:
 *   1. Checks site is live (HTTP 200, SSL valid)
 *   2. Reads current "this week" section in HTML
 *   3. Reviews real lead/research activity from DB to suggest fresh content
 *   4. Generates a weekly update suggestion for the "What I am working on right now" section
 *   5. Drafts new case study candidates from lead_enrichment table
 *   6. Checks for stale voice-agent references (discontinued product)
 *   7. Checks sitemap.xml coverage against actual .html files
 *   8. Sends Telegram report to Kirill with suggestions + "approve to deploy" button
 *
 * Does NOT auto-deploy anything. Only suggests + waits for Kirill approval.
 *
 * Run: node scripts/factory/site-curator-bot.mjs [check|suggest|full]
 */
import Database from "better-sqlite3";
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readWiki, readPurpose, getWikiContext, appendLog } from "../../wiki/reader.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const SITE_URL = "https://launchsoloai.com";
const SITE_HTML_PATH = resolve(ROOT, "sandbox-review/site/index.html");
const SITE_DIR = resolve(ROOT, "sandbox-review/site");
const SITE_PAGES = {
  main: resolve(ROOT, "sandbox-review/site/index.html"),
  calgary_landing: resolve(ROOT, "sandbox-review/site/missed-quotes-intake-gaps.html"),
  tools: resolve(ROOT, "sandbox-review/site/tools.html"),
  checklist: resolve(ROOT, "sandbox-review/site/free-audit-checklist.html"),
  insights_index: resolve(ROOT, "sandbox-review/site/insights/index.html"),
  faq: resolve(ROOT, "sandbox-review/site/faq.html"),
};
const CURATOR_DIR = resolve(ROOT, ".data/site-curator");
if (!existsSync(CURATOR_DIR)) mkdirSync(CURATOR_DIR, { recursive: true });

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, "apps/api/.env"), "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const TG = env.TELEGRAM_BOT_TOKEN, CHAT = env.TELEGRAM_CHAT_ID;
const { callAI, MODEL_STRONG } = await import("./orchestrator.mjs");

const db = new Database(DB_PATH, { readonly: true });

/* ── PURPOSE + Wiki + Discovery context ── */

function loadPurposeAndStrategy() {
  const purpose = readPurpose();
  const wikiCtx = getWikiContext([
    "channels/capabilities.md",
    "strategy/current-thesis.md",
  ]);
  return { purpose, wikiCtx };
}

function loadDiscoveryState() {
  const dsPath = resolve(ROOT, ".data/cortex-discovery-state.json");
  try {
    return JSON.parse(readFileSync(dsPath, "utf-8"));
  } catch { return null; }
}

/* ── Voice-agent stale reference checker ── */

function checkVoiceAgentReferences() {
  const voicePatterns = /voice\s*agent|voice\s*receptionist|missed\s*call/gi;
  const flags = [];
  for (const [label, filePath] of Object.entries(SITE_PAGES)) {
    try {
      const html = readFileSync(filePath, "utf-8");
      const matches = html.match(voicePatterns);
      if (matches && matches.length) {
        flags.push({ page: label, file: filePath, matches: [...new Set(matches.map(m => m.toLowerCase()))] });
      }
    } catch {}
  }
  // Also check dedicated voice page
  const voicePage = resolve(ROOT, "sandbox-review/site/voice-agents.html");
  if (existsSync(voicePage)) {
    flags.push({ page: "voice-agents.html", file: voicePage, matches: ["entire page exists - voice agent discontinued"] });
  }
  return flags;
}

/* ── Sitemap coverage checker ── */

function checkSitemapCoverage() {
  const sitemapPath = resolve(SITE_DIR, "sitemap.xml");
  let sitemapContent = "";
  try { sitemapContent = readFileSync(sitemapPath, "utf-8"); } catch { return { error: "sitemap.xml not found", total: 0, missing: [] }; }

  const allHtml = [];
  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const full = resolve(dir, e);
      try {
        if (statSync(full).isDirectory()) walk(full);
        else if (e.endsWith(".html")) allHtml.push(full);
      } catch {}
    }
  }
  walk(SITE_DIR);

  const missing = [];
  const skipFiles = ["thank-you.html", "google9bba5aecabb74535.html"];
  for (const f of allHtml) {
    const rel = f.replace(SITE_DIR, "").replace(/^\//, "");
    if (skipFiles.some(s => rel.endsWith(s))) continue;
    const urlPath = rel === "index.html" ? "/" : `/${rel}`;
    const expectedUrl = `https://launchsoloai.com${urlPath}`;
    const altUrl = urlPath.endsWith("/index.html")
      ? `https://launchsoloai.com${urlPath.replace("/index.html", "/")}`
      : null;
    if (!sitemapContent.includes(expectedUrl) && !(altUrl && sitemapContent.includes(altUrl))) {
      missing.push(rel);
    }
  }
  return { total: allHtml.length, missing };
}

async function tg(text) {
  if (!TG || !CHAT) return;
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text, parse_mode: "HTML", disable_web_page_preview: true }),
  }).catch(() => {});
}

async function checkLive() {
  try {
    const r = await fetch(SITE_URL, { signal: AbortSignal.timeout(15000) });
    return { status: r.status, ok: r.ok, headers: { server: r.headers.get("server"), age: r.headers.get("age") } };
  } catch (e) {
    return { status: 0, ok: false, error: e.message };
  }
}

function gatherActivityContext() {
  // Recent leads contacted in last 7 days, with classification
  const recent = db.prepare(`
    SELECT l.name, l.source_platform, l.stage, l.notes, le.classification, le.recommended_action, le.next_message_angle
    FROM leads l
    LEFT JOIN lead_enrichment le ON le.lead_id = l.id
    WHERE l.updated_at > datetime('now','-7 days')
    ORDER BY l.updated_at DESC LIMIT 20
  `).all();

  const stages = db.prepare(`SELECT stage, COUNT(*) c FROM leads GROUP BY stage`).all();
  const classifications = db.prepare(`SELECT classification, COUNT(*) c FROM lead_enrichment GROUP BY classification`).all();

  return { recent, stages, classifications };
}

function buildPrompt(liveCheck, currentHtmlSnippet, activity, extras) {
  const { purposeAndStrategy, discoveryState, voiceAgentFlags, sitemapCoverage } = extras;

  let discoverySection = "";
  if (discoveryState && discoveryState.hypothesis) {
    discoverySection = `
<active_hypothesis>
The system is currently exploring: "${discoveryState.hypothesis}"
${discoveryState.evidence ? `Evidence so far: ${JSON.stringify(discoveryState.evidence)}` : ""}
${discoveryState.status ? `Status: ${discoveryState.status}` : ""}
Consider suggesting site content that supports this hypothesis (e.g. case study, insight article, landing page section).
</active_hypothesis>`;
  }

  let voiceAgentSection = "";
  if (voiceAgentFlags.length > 0) {
    voiceAgentSection = `
<voice_agent_stale_refs>
CRITICAL: AI Voice Agent was DISCONTINUED on 2026-04-22. The following pages still reference it:
${voiceAgentFlags.map(f => `- ${f.page}: ${f.matches.join(", ")}`).join("\n")}
These MUST be flagged for removal/replacement.
</voice_agent_stale_refs>`;
  }

  let sitemapSection = "";
  if (sitemapCoverage.missing && sitemapCoverage.missing.length > 0) {
    sitemapSection = `
<sitemap_gaps>
${sitemapCoverage.missing.length} HTML pages are NOT in sitemap.xml:
${sitemapCoverage.missing.map(f => `- ${f}`).join("\n")}
These should be added to sitemap.xml for SEO coverage.
</sitemap_gaps>`;
  } else if (!sitemapCoverage.error) {
    sitemapSection = `\n<sitemap_gaps>All ${sitemapCoverage.total} HTML pages are covered in sitemap.xml.</sitemap_gaps>`;
  }

  return `<role>You are the Site Curator for Kirill's launchsoloai.com. You run weekly to suggest content updates that keep the site fresh, trustworthy, and alive. You do NOT deploy anything. You suggest, Kirill approves.</role>

${purposeAndStrategy.wikiCtx}

<context>
Live site: ${SITE_URL}
Live check: ${JSON.stringify(liveCheck)}
Source files: $CLAUDE_PROJECT_DIR/sandbox-review/site/

FULL SITE MAP (you must know ALL pages):
- / (index.html) - Main landing. Two client tracks: SaaS founders + Service businesses. Has offers, case studies, contact form, weekly log.
- /missed-quotes-intake-gaps.html - Calgary trades landing (Google Ads drive here). Trust bar with numbers, 3 case studies (renovation, HVAC, plumbing), calculator link, CTA to form.
- /free-audit-checklist.html - Interactive 9-point vibe-code audit checklist for SaaS founders (Google Ads drive here). Pass/fail buttons, live scoring.
- /tools.html - Free tools hub: audit checklist link + missed revenue calculator (interactive, JS).
- /insights/ - Blog index. Currently 5 published articles on service business pain patterns.
- /faq.html - FAQ with schema markup.
- /thank-you.html - Post-form conversion page (Google Ads tracking).
- /#qualify - Contact form (Formspree, fields: name, email, stack, problem).

TRUST SIGNALS (keep current):
- Trust bar on Calgary landing: businesses helped count, revenue recovered, delivery time, fixed price
- 3 case studies on main page (SaaS), 3 on Calgary landing (trades)
- Weekly log showing current work (MUST update weekly, stale dates kill trust)
- "Available for X projects this month" badge in hero

GOOGLE ADS running:
- Campaign 1: Vibe-code audit (worldwide) -> /free-audit-checklist.html
- Campaign 2: Calgary trades follow-up (Calgary 50km) -> /missed-quotes-intake-gaps.html
</context>
${discoverySection}${voiceAgentSection}${sitemapSection}

<current_week_log_snippet>
${currentHtmlSnippet}
</current_week_log_snippet>

<recent_activity>
Recent leads (last 7 days): ${JSON.stringify(activity.recent.slice(0, 10))}
Pipeline stages: ${JSON.stringify(activity.stages)}
Classifications so far: ${JSON.stringify(activity.classifications)}
</recent_activity>

<your_job>
Produce a weekly update report. Be concrete, not generic.

1. SITE_HEALTH: is the site live? Anything to flag?
2. WEEK_LOG_SUGGESTION: a fresh "what I am working on right now" paragraph (4-6 sentences, specific tools/problems, forward motion)
3. NEW_CASE_STUDY: Draft a NEW case study for a DIFFERENT industry than what is already on the site. Each case study MUST:
   - Be a different business type (NOT another renovation/HVAC/plumbing if those exist)
   - Name specific tools used (n8n, Supabase, Claude, Stripe, Postgres, Twilio, etc.)
   - Show concrete numbers (revenue recovered, time saved, response time improvement)
   - Industries to rotate through: electrical, cleaning, landscaping, property management, MSP, bookkeeper, auto repair, garage doors, SaaS, e-commerce
4. STALENESS_FLAGS: anything on the site older than 14 days that should be refreshed. Check ALL pages, not just index.
5. TRUST_BAR_UPDATE: suggest updated numbers for the trust bar (businesses helped, revenue recovered)
6. LANDING_PAGE_CHECK: is the Calgary landing page (/missed-quotes-intake-gaps.html) still compelling? Any improvements?
7. VOICE_AGENT_CHECK: if any pages still reference "voice agent", "voice receptionist", or "missed call" in a product context, flag as CRITICAL for removal (product discontinued 2026-04-22)
8. SITEMAP_CHECK: flag any .html pages missing from sitemap.xml
9. DISCOVERY_HYPOTHESIS: if there is an active hypothesis from the discovery engine, suggest how the site could support it (new content, case study angle, landing section)
10. ONE_PRIORITY_FIX: the single most impactful edit this week
</your_job>

<output_format>
End with EXACTLY this JSON block:

CURATOR_REPORT:
{
  "site_health": "ok" | "degraded" | "down",
  "week_log_suggestion": "the new paragraph text",
  "case_study_candidate": "description or 'none yet'",
  "staleness_flags": ["item 1", "item 2"],
  "voice_agent_stale": ["page: detail", ...] or [],
  "sitemap_missing": ["file1.html", ...] or [],
  "discovery_suggestion": "suggestion or null",
  "one_priority_fix": "the single most impactful edit",
  "summary": "one sentence overall"
}
</output_format>

<rules>
- Use only short hyphens, never em dashes
- Do not invent client names or numbers Kirill cannot back up
- The week_log_suggestion should sound like Kirill actually wrote it - direct, technical, no filler
- Maximum 3 tool calls
</rules>

Begin curation.`;
}

async function runCurator() {
  const live = await checkLive();
  console.log(`[curator] live check: ${JSON.stringify(live)}`);

  const html = readFileSync(SITE_HTML_PATH, "utf-8");
  const m = html.match(/<div class="week-log">([\s\S]*?)<\/div>/);
  const currentSnippet = m ? m[1].slice(0, 800) : "(could not extract)";

  const activity = gatherActivityContext();
  console.log(`[curator] activity: ${activity.recent.length} recent leads, ${activity.stages.length} stages`);

  // Load PURPOSE, wiki strategy, discovery state, and run checks
  const purposeAndStrategy = loadPurposeAndStrategy();
  console.log(`[curator] loaded PURPOSE (${purposeAndStrategy.purpose.length} chars) + wiki context`);

  const discoveryState = loadDiscoveryState();
  if (discoveryState?.hypothesis) console.log(`[curator] active hypothesis: ${discoveryState.hypothesis}`);

  const voiceAgentFlags = checkVoiceAgentReferences();
  if (voiceAgentFlags.length) console.log(`[curator] CRITICAL: ${voiceAgentFlags.length} pages still reference voice agent`);

  const sitemapCoverage = checkSitemapCoverage();
  if (sitemapCoverage.missing?.length) console.log(`[curator] sitemap gaps: ${sitemapCoverage.missing.join(", ")}`);

  const prompt = buildPrompt(live, currentSnippet, activity, {
    purposeAndStrategy,
    discoveryState,
    voiceAgentFlags,
    sitemapCoverage,
  });
  const promptFile = resolve(CURATOR_DIR, "prompt.txt");
  writeFileSync(promptFile, prompt);

  const startedAt = Date.now();
  let output;
  try {
    output = await callAI(prompt, "Begin curation now.", MODEL_STRONG, false);
  } catch (e) {
    output = `ERROR: ${e.message}`;
  }
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  writeFileSync(resolve(CURATOR_DIR, `output-${Date.now()}.txt`), output);

  const match = output.match(/CURATOR_REPORT:\s*(?:```(?:json)?\s*)?(\{[\s\S]*?\n\})\s*(?:```)?/);
  if (!match) {
    await tg(`<b>⚠️ site-curator-bot: parse fail (${elapsed}s)</b>\n\nLive: ${live.ok ? "✅ HTTP 200" : "❌ DOWN"}\nNo curator report parsed. See .data/site-curator/output-*.txt`);
    return;
  }

  let parsed;
  try { parsed = JSON.parse(match[1]); }
  catch (e) {
    await tg(`<b>⚠️ site-curator: JSON parse error</b>\n${e.message}`);
    return;
  }

  // Save suggestion for later approval
  const suggestionId = `curator-${Date.now()}`;
  const pendingDir = resolve(CURATOR_DIR, "pending");
  if (!existsSync(pendingDir)) mkdirSync(pendingDir, { recursive: true });
  const suggestionFile = resolve(pendingDir, `${suggestionId}.json`);
  writeFileSync(suggestionFile, JSON.stringify({
    id: suggestionId,
    created_at: new Date().toISOString(),
    week_log_suggestion: parsed.week_log_suggestion,
    case_study_candidate: parsed.case_study_candidate,
    staleness_flags: parsed.staleness_flags,
    voice_agent_stale: parsed.voice_agent_stale,
    sitemap_missing: parsed.sitemap_missing,
    discovery_suggestion: parsed.discovery_suggestion,
    one_priority_fix: parsed.one_priority_fix,
    summary: parsed.summary,
  }, null, 2));

  // Build Telegram message
  const healthEmoji = parsed.site_health === "ok" ? "✅" : parsed.site_health === "degraded" ? "⚠️" : "❌";

  let voiceAlertBlock = "";
  if (voiceAgentFlags.length > 0) {
    voiceAlertBlock = `\n<b>🚨 CRITICAL - Stale voice agent refs:</b>\n${voiceAgentFlags.map(f => `- ${f.page}: ${f.matches.join(", ")}`).join("\n")}\n`;
  }

  let sitemapBlock = "";
  if (sitemapCoverage.missing?.length) {
    sitemapBlock = `\n<b>🗺 Sitemap gaps (${sitemapCoverage.missing.length}):</b>\n${sitemapCoverage.missing.map(f => `- ${f}`).join("\n")}\n`;
  }

  let discoveryBlock = "";
  if (parsed.discovery_suggestion) {
    discoveryBlock = `\n<b>🔬 Discovery hypothesis:</b>\n<i>${parsed.discovery_suggestion}</i>\n`;
  }

  const message = `<b>📰 site-curator weekly report</b>

${healthEmoji} <b>Site health:</b> ${parsed.site_health}
<i>${parsed.summary}</i>
${voiceAlertBlock}${sitemapBlock}
<b>📝 New "this week" paragraph:</b>
<i>${parsed.week_log_suggestion}</i>

<b>💡 One priority fix:</b>
${parsed.one_priority_fix}

${parsed.staleness_flags?.length ? `<b>⏳ Staleness flags:</b>\n${parsed.staleness_flags.map(f => `- ${f}`).join("\n")}\n\n` : ""}<b>🔮 Future case study candidate:</b>
<i>${parsed.case_study_candidate}</i>
${discoveryBlock}
<i>Approve = auto-apply week-log update + deploy</i>
Time: ${elapsed}s`;

  // Send with inline keyboard buttons
  if (TG && CHAT) {
    await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT,
        text: message.slice(0, 4000),
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[
            { text: "✅ Approve & Deploy", callback_data: `site_approve:${suggestionId}` },
            { text: "❌ Reject", callback_data: `site_reject:${suggestionId}` },
          ]]
        }
      }),
    }).catch(() => {});
  }
  console.log(`[curator] reported with approve buttons, id=${suggestionId}`);
}

const cmd = process.argv[2] || "full";
if (cmd === "check") {
  console.log(JSON.stringify(await checkLive()));
} else {
  await runCurator();
}
db.close();
