/**
 * BODY MAP — What the system knows it controls
 *
 * The brain has ideas. But without knowing its body, ideas stay ideas.
 *
 * When Evolution Engine says "try bilingual angle", the system must know:
 * - Website exists at launchsoloai.com → needs new section/page
 * - Website exists → needs fresh case studies
 * - Fiverr gig exists → needs updated description
 * - Google Ads running → needs new keywords
 * - Scout queries → needs bilingual search terms
 * - Outreach templates → needs bilingual messaging
 *
 * This module maps EVERYTHING the system can touch,
 * HOW to modify it, and WHAT TOOL/BOT does the modification.
 *
 * When an idea is generated, the body map produces an IMPLEMENTATION PLAN:
 * specific steps with specific tools for each change.
 */

export const BODY_MAP = {
  // ── WEBSITE ──────────────────────────────────────────────────────────
  website: {
    name: "LaunchSoloAI Website",
    url: "https://launchsoloai.com",
    what: "Main sales website for AI services",
    pages: [
      { path: "/", description: "Homepage with hero banner and service overview" },
    ],
    hosted_on: "Vercel",
    code_location: "apps/web/",
    how_to_modify: "Edit Next.js pages in apps/web/ via HANDS (Claude CLI). Deploy still requires Vercel push.",
    modifier_bot: "cortex-hands",
    manual_actions: ["Deploy requires Vercel push", "Major redesigns need Kirill approval"],
    can_auto_modify: true, // HANDS can edit code, deploy is separate
    notify_for: "New pages, pricing changes, major copy changes",
  },

  // ── VOICE AGENT (VAPI) - DISCONTINUED 2026-04-22 ────────────────────
  vapi_agent: {
    name: "Vapi Voice Agent",
    status: "DISCONTINUED",
    discontinued_at: "2026-04-22",
    reason: "Offer unconfirmed. Do not pitch, draft, or score as opportunity.",
    can_auto_modify: false,
  },

  // ── FIVERR GIG ───────────────────────────────────────────────────────
  fiverr: {
    name: "Fiverr Gig",
    url: "https://www.fiverr.com/s/Q7pB1D1",
    what: "Gig selling AI automation and custom builds",
    packages: {
      basic: "$215 CAD",
      standard: "$503 CAD",
      premium: "$1,006 CAD",
    },
    how_to_modify: "Manual edit on Fiverr.com — update title, description, packages, FAQ",
    can_auto_modify: false,
    notify_for: "Title changes, pricing changes, new package ideas",
  },

  // ── GOOGLE ADS ───────────────────────────────────────────────────────
  google_ads: {
    name: "Google Ads Campaign",
    what: "Paid search ads for vibe code audit and AI services",
    budget: "$10/day",
    keywords: ["vibe code audit", "ai automation small business", "custom ai build", "n8n automation"],
    landing_page: "https://launchsoloai.com",
    how_to_modify: "Manual in Google Ads dashboard — keywords, ad copy, budget",
    can_auto_modify: false,
    notify_for: "New keyword ideas, ad copy suggestions, budget changes",
  },

  // ── SCOUT SEARCH QUERIES ─────────────────────────────────────────────
  scout_queries: {
    name: "Scout Bot Search Queries",
    what: "Brave Search queries that find potential leads",
    config_location: "scripts/factory/scout-bot.mjs (queries array) + .data/cortex-config.json",
    how_to_modify: "Update config.bots['scout-bot'].keywords via config-injection",
    modifier_bot: "config-injection",
    can_auto_modify: true,
  },

  // ── SCORING PROMPT ───────────────────────────────────────────────────
  scoring_prompt: {
    name: "Lead Scoring Prompt",
    what: "GPT prompt that scores leads 0-100",
    config_location: "scripts/factory/scout-bot.mjs (callAI prompt)",
    how_to_modify: "HANDS rewrites scoring prompt in scout-bot.mjs callAI function",
    modifier_bot: "cortex-hands",
    can_auto_modify: true, // HANDS can edit code directly
    notify_for: "New industries to add, scoring criteria changes",
  },

  // ── OUTREACH TEMPLATES ───────────────────────────────────────────────
  outreach_templates: {
    name: "Outreach Message Templates",
    what: "Templates for Reddit DMs, email outreach, LinkedIn messages",
    config_location: "scripts/factory/icp-outreach-bot.mjs",
    how_to_modify: "HANDS rewrites templates in icp-outreach-bot.mjs or updates cortex-config.json",
    modifier_bot: "cortex-hands",
    can_auto_modify: true, // HANDS can edit both code and config
  },

  // ── EMAIL SYSTEM ─────────────────────────────────────────────────────
  email: {
    name: "Email (kirill@launchsoloai.com)",
    what: "SMTP/IMAP email for outreach and replies",
    config_location: "apps/api/.env (SMTP_USER, SMTP_PASS)",
    how_to_modify: "scripts/outreach/write-email.mjs for sending",
    modifier_bot: "monitor-replies",
    can_auto_modify: true,
  },

  // ── TELEGRAM ─────────────────────────────────────────────────────────
  telegram: {
    name: "Telegram Bot (@ContentBot)",
    what: "Communication channel with Kirill",
    how_to_modify: "Send messages via Telegram API",
    can_auto_modify: true,
  },

  // ── DATABASE ─────────────────────────────────────────────────────────
  database: {
    name: "SQLite Database",
    what: "All leads, outreach, KPD, decisions, memory stored here",
    location: ".data/linkedin-brand-os.sqlite",
    tables: ["leads", "outreach_emails", "cortex_memory", "cortex_kpd", "cortex_decisions", "bot_heartbeats", "wm_entities", "wm_beliefs", "wm_predictions", "cortex_narrative"],
    how_to_modify: "Direct SQL via better-sqlite3. HANDS can write migration scripts.",
    modifier_bot: "cortex-hands",
    can_auto_modify: true,
  },

  // ── CORTEX CONFIG ────────────────────────────────────────────────────
  cortex_config: {
    name: "CORTEX Dynamic Config",
    what: "Runtime config that controls all bots, budgets, workflows",
    location: ".data/cortex-config.json",
    how_to_modify: "config-injection.mjs readConfig/writeConfig, or HANDS edits JSON directly",
    modifier_bot: "config-injection",
    can_auto_modify: true,
  },
};

// ── GENERATE IMPLEMENTATION PLAN FOR AN IDEA ───────────────────────────

export function planImplementation(idea) {
  const steps = [];
  const ideaLower = (idea || "").toLowerCase();

  // Analyze what the idea touches
  for (const [key, asset] of Object.entries(BODY_MAP)) {
    const relevant = isRelevant(ideaLower, key, asset);
    if (!relevant) continue;
    if (asset.status === "DISCONTINUED") continue; // skip discontinued bodies

    if (asset.can_auto_modify) {
      steps.push({
        asset: asset.name,
        action: `Auto-modify via ${asset.modifier_bot || "config"}`,
        how: asset.how_to_modify,
        automated: true,
      });
    } else {
      steps.push({
        asset: asset.name,
        action: `Notify Kirill: ${asset.notify_for || "needs manual update"}`,
        how: asset.how_to_modify,
        automated: false,
      });
    }
  }

  return steps;
}

function isRelevant(idea, key, asset) {
  // Match idea keywords to assets
  const keywordMap = {
    website: ["website", "landing", "page", "site", "copy", "hero", "pricing page"],
    vapi_agent: [], // DISCONTINUED 2026-04-22 — no keywords match
    fiverr: ["fiverr", "gig", "package", "freelance"],
    google_ads: ["ads", "keywords", "google", "campaign", "ad copy", "ppc"],
    scout_queries: ["search", "queries", "scout", "find", "discover", "subreddit", "source"],
    scoring_prompt: ["scoring", "qualify", "threshold", "criteria", "industry"],
    outreach_templates: ["outreach", "message", "template", "dm", "email", "pitch", "angle", "offer"],
    email: ["email", "outbound", "cold email"],
    telegram: ["telegram", "notify", "alert"],
    cortex_config: ["config", "budget", "enable", "disable"],
  };

  const keywords = keywordMap[key] || [];
  return keywords.some(kw => idea.includes(kw));
}

// ── FORMAT BODY MAP FOR LLM CONTEXT ────────────────────────────────────

export function formatBodyMapForLLM() {
  return Object.entries(BODY_MAP).map(([key, asset]) => {
    if (asset.status === "DISCONTINUED") return `- ${asset.name} [DISCONTINUED ${asset.discontinued_at || ""}] — do not use`;
    const autoLabel = asset.can_auto_modify ? "AUTO" : "MANUAL (notify Kirill)";
    return `- ${asset.name} [${autoLabel}]: ${asset.what}. Modify: ${asset.how_to_modify}`;
  }).join("\n");
}
