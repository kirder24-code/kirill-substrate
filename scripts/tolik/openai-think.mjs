/**
 * scripts/tolik/openai-think.mjs
 *
 * Direct OpenAI chat completion for Tolik's voice path. Why not Claude
 * CLI? Subprocess startup is 7-10s per call which kills voice UX. Direct
 * HTTPS to OpenAI = ~200ms network + 1-2s inference = ~2s wall.
 *
 * Substrate keeps using Claude (cortex, factory, opps, morning-brief).
 * This module is ONLY for the realtime voice loop.
 *
 * Native function calling: instead of asking Claude to emit `[TOOL: ...]`
 * lines that we regex out, we pass the tool inventory as OpenAI function
 * definitions. Cleaner, more reliable, no parsing.
 *
 * Records the call into survival-tolik-llm-log.jsonl for cost accounting.
 */

import { readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");
const LOG_PATH = resolve(ROOT, ".data/survival-tolik-llm-log.jsonl");

const MODEL = process.env.TOLIK_OPENAI_MODEL || "gpt-4o-mini";
const PRICES_USD_PER_MTOK = {
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "gpt-4o":      { input: 2.50, output: 10.00 },
};

function envMap() {
  if (!existsSync(ENV_PATH)) return {};
  return Object.fromEntries(
    readFileSync(ENV_PATH, "utf-8").split("\n")
      .filter(l => l && !l.startsWith("#") && l.includes("="))
      .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
  );
}

function logCall(record) {
  try {
    if (!existsSync(dirname(LOG_PATH))) mkdirSync(dirname(LOG_PATH), { recursive: true });
    appendFileSync(LOG_PATH, JSON.stringify(record) + "\n");
  } catch {}
}

// Tool inventory mirrors the [TOOL:] catalog in voice-bridge.mjs but
// expressed in OpenAI function-calling shape so the model picks one
// natively instead of emitting a parseable string.
export const TOLIK_FUNCTIONS = [
  // Browser
  { type: "function", function: { name: "open", description: "Open a URL in Tolik's separate Chromium browser.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } } },
  { type: "function", function: { name: "search", description: "Do a Google web search and return top 5 results.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "gmail_search", description: "Search Kirill's Gmail inbox for a query.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "gmail_draft", description: "Open compose in Gmail with to/subject/body filled, leave for Kirill to review and send.", parameters: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } }, required: ["to"] } } },
  { type: "function", function: { name: "calendar_today", description: "Read today's events from Google Calendar.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "screenshot", description: "Capture current page of Tolik's browser.", parameters: { type: "object", properties: {} } } },
  // File system
  { type: "function", function: { name: "fs_read", description: "Read a file inside the project repo.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "fs_list", description: "List directory contents inside the project repo.", parameters: { type: "object", properties: { path: { type: "string" } } } } },
  { type: "function", function: { name: "fs_grep", description: "Grep across the codebase for a query string.", parameters: { type: "object", properties: { query: { type: "string" }, dir: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "fs_open_editor", description: "Open a file in VS Code.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "fs_tail_log", description: "Tail the last N lines of a known log (webhook-server, tolik-browser-agent, pulse-daemon, cortex-daemon, etc).", parameters: { type: "object", properties: { name: { type: "string" }, n: { type: "integer" } }, required: ["name"] } } },
  // Telegram
  { type: "function", function: { name: "tg_send_to_me", description: "Send a message to Kirill's own Telegram (reminders, notifications).", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } } },
  { type: "function", function: { name: "tg_send_to", description: "Send a Telegram message to a chat_id or @username.", parameters: { type: "object", properties: { chat: { type: "string" }, text: { type: "string" } }, required: ["chat", "text"] } } },
  { type: "function", function: { name: "tg_recent", description: "Read last N dialogs from Kirill's Telegram.", parameters: { type: "object", properties: { n: { type: "integer" } } } } },
  // Substrate
  { type: "function", function: { name: "sub_query_db", description: "Read-only SQL on substrate DBs (survival, organism, cortex, factory, leads, brand, ...). SELECT only.", parameters: { type: "object", properties: { db: { type: "string" }, sql: { type: "string" } }, required: ["db", "sql"] } } },
  { type: "function", function: { name: "sub_wiki", description: "Search Tolik's wiki-archive for a topic.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "sub_run_action", description: "Invoke a registered substrate action by id.", parameters: { type: "object", properties: { action_id: { type: "string" }, params: { type: "object" } }, required: ["action_id"] } } },
  { type: "function", function: { name: "morning_brief", description: "Read Kirill's morning brief synthesized from substrate state - pipeline state, drafts awaiting approval, opportunities by stage, LLM spend, top actions, strategic verdict. THIS IS NOT WORLD NEWS. Use morning_brief WHENEVER Kirill says 'бриф', 'утренний бриф', 'сводка', 'что у нас сегодня', 'доброе утро', 'отчёт', 'briefing'. NEVER use news_top for these triggers - news_top is for world/tech headlines only.", parameters: { type: "object", properties: {} } } },
  // ISA-aware tools — let Tolik answer "что у нас по AU opp" by reading the actual ISA state
  { type: "function", function: { name: "list_isas", description: "List all Ideal State Artifacts (ISA.md files) in the substrate with their progress (X/Y ISCs checked) and slug. Use this when Kirill asks 'какие у нас opportunities', 'все ли ISA активны', 'покажи всё что мы делаем'.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "isa_status", description: "Get progress + next pending ISC for one opportunity. Match by slug substring (slug, file path, or task text). Use whenever Kirill asks 'что по X opportunity', 'как идут дела с Australia / Canada / Upwork', 'что осталось закрыть в X', 'какой следующий шаг по Y'. Returns: progress, pending count, next ISC, has_verification.", parameters: { type: "object", properties: { slug: { type: "string", description: "Substring of slug, file path, or task text. e.g. 'australia' or 'au-rdti' or 'upwork'." } }, required: ["slug"] } } },
  { type: "function", function: { name: "read_isa", description: "Full read of a specific ISA: frontmatter, all ISC statuses, Problem/Goal/Verification sections. Use when Kirill asks for details: 'расскажи всё про X', 'что в Verification у X', 'какие критерии у X opportunity'.", parameters: { type: "object", properties: { path: { type: "string", description: "Relative path like '.data/survival-opportunities/opp-au-rdti/ISA.md' or just 'ISA.md' for substrate root." } }, required: ["path"] } } },
  { type: "function", function: { name: "isa_run_check", description: "Run isa-check on an ISA — returns pass/fail + structured gap report (which sections missing, ISCs without anti-criterion, etc). Use when Kirill asks 'можно ли закрыть X opp' or 'почему X не проходит проверку' or 'что блокирует завершение X'.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  // Recording
  { type: "function", function: { name: "rec_start", description: "Start a screen recording for N seconds (or open-ended if seconds=0).", parameters: { type: "object", properties: { seconds: { type: "integer" } } } } },
  { type: "function", function: { name: "rec_stop", description: "Stop the current screen recording and return the saved file path.", parameters: { type: "object", properties: {} } } },
  // Web / news / weather — for ANYTHING current Tolik does not already know
  { type: "function", function: { name: "web_read", description: "Fetch a webpage and return its main text content. Use this whenever Kirill asks about content of a specific URL or you need to verify what is on a page.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } } },
  { type: "function", function: { name: "news_top", description: "Get top headlines from a news source. Use this WHENEVER Kirill asks about news, current events, what's happening, or any time-sensitive information you don't already know. Sources: hackernews, world (Reddit worldnews), tech (Reddit technology), ai (Reddit AI subs), programming, startups, canada, calgary, bbc, techcrunch, theverge.", parameters: { type: "object", properties: { source: { type: "string", enum: ["hackernews","world","tech","ai","programming","startups","canada","calgary","bbc","techcrunch","theverge"] }, n: { type: "integer", description: "How many headlines, 5-15" } }, required: ["source"] } } },
  { type: "function", function: { name: "weather", description: "Current weather and today/tomorrow forecast for a city. Use this WHENEVER Kirill asks about weather, temperature, or what to wear. Calgary is the default city.", parameters: { type: "object", properties: { city: { type: "string" } } } } },
  // Telegram extra
  { type: "function", function: { name: "tg_post_to_channel", description: "Post a message to a Telegram channel where the bot is admin. Use when Kirill says 'запости в канал' or similar.", parameters: { type: "object", properties: { channel: { type: "string", description: "@channel_name or numeric -100... id" }, text: { type: "string" } }, required: ["channel", "text"] } } },
  // Intel - faster than raw sub_query_db for common questions
  { type: "function", function: { name: "intel_outreach_recent", description: "Last N outbound contacts (emails, DMs) Kirill sent. Use for 'кому мы писали недавно'.", parameters: { type: "object", properties: { n: { type: "integer" } } } } },
  { type: "function", function: { name: "intel_leads_summary", description: "Top-level summary of leads pipeline: total, by source, by status, recent 5. Use for 'сколько у нас лидов', 'обзор пайплайна'.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "intel_reddit_recent", description: "Recent Reddit touches/outreach. Use for 'кому мы писали в reddit'.", parameters: { type: "object", properties: { n: { type: "integer" } } } } },
  { type: "function", function: { name: "intel_linkedin_recent", description: "Recent LinkedIn published posts. Use for 'что мы публиковали в LinkedIn'.", parameters: { type: "object", properties: { n: { type: "integer" } } } } },
  { type: "function", function: { name: "intel_substrate_overview", description: "Substrate dashboard summary: opps by state, top actions, LLM spend 24h/7d.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "intel_files_recent", description: "Recent files in a project directory (default .data). Use for 'что нового в .data', 'покажи последние артефакты'.", parameters: { type: "object", properties: { dir: { type: "string" }, n: { type: "integer" } } } } },
  // Content writing
  { type: "function", function: { name: "content_draft", description: "Draft a post for Kirill on a given platform (linkedin, threads, telegram_channel, twitter_x, reddit, email). Tolik writes it using Kirill's voice rules and sends a preview to Telegram by default. Use whenever Kirill says 'напиши пост', 'набросай', 'сделай драфт'.", parameters: { type: "object", properties: { platform: { type: "string", enum: ["linkedin","threads","telegram_channel","twitter_x","reddit","email"] }, topic: { type: "string" }, audience: { type: "string" }, style_notes: { type: "string" }, send_to_tg: { type: "boolean" } }, required: ["platform", "topic"] } } },
  { type: "function", function: { name: "content_save", description: "Save arbitrary content to a file under .data/, dashboard/, apps/, or scripts/tolik. Use for 'сохрани', 'запиши в файл'.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
  // Content DEPARTMENT — Visual Agent + post-writer integrated dept (May 2026)
  { type: "function", function: { name: "content_status", description: "Read live state of the Content Department (queue depth, last fire, cadence, posts this week). Use when Kirill asks 'что с контентом', 'когда последний пост', 'сколько в очереди', 'статус контент департамента'.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "content_queue_add", description: "Enqueue a content idea for the Content Department. The dept will compose visual + post text + hashtags + purpose and deliver as ONE Telegram card. Use when Kirill says 'сделай пост про X', 'добавь в очередь', 'запости про Y'. asset_level: static (PNG card), motion (5-8s video), scroll (full landing page). Recipe only for scroll-fast.", parameters: { type: "object", properties: { idea: { type: "string", description: "Post topic/hook" }, source: { type: "string", enum: ["manual","awareness","opp-win","scout","signal-hook","scheduled"] }, post_type: { type: "string", enum: ["news","sales","educational","provocation","carousel","case_study","general"] }, asset_level: { type: "string", enum: ["static","motion","scroll"] }, recipe: { type: "string", enum: ["launchsoloai-landing","apollo-case"] }, priority: { type: "integer", description: "1=high, 5=low" }, context: { type: "string", description: "Optional extra context" } }, required: ["idea"] } } },
  { type: "function", function: { name: "content_compose", description: "Force the Content Department to drain the queue NOW (bypass anti-spam). Use when Kirill says 'запости сейчас', 'не жди до утра', or after content_queue_add to immediately compose. autoDiscover=true lets it scan awareness/scout/opp signals if queue is empty.", parameters: { type: "object", properties: { forceNow: { type: "boolean" }, autoDiscover: { type: "boolean" } } } } },
  { type: "function", function: { name: "content_recent", description: "List recent content assets with status (draft/approved/published) and purpose. Use when Kirill asks 'что мы недавно постили', 'покажи мои последние посты'.", parameters: { type: "object", properties: { days: { type: "integer" }, limit: { type: "integer" } } } } },
  { type: "function", function: { name: "content_regen", description: "Re-compose an asset with FORCED different template + accent than the rejected one. Use when Kirill says 'не нравится картинка', 'переделай но по-другому', 'сделай в другом стиле'. Without asset_id: processes all pending regen_requested rows. force_template options: idea-card | stat-hero | quote-card | news-card | before-after | system-diagram | proof-frame. force_accent: cyan | gold | red | green | amber.", parameters: { type: "object", properties: { asset_id: { type: "string" }, force_template: { type: "string", enum: ["idea-card","stat-hero","quote-card","news-card","before-after","system-diagram","proof-frame"] }, force_accent: { type: "string", enum: ["cyan","gold","red","green","amber"] } } } } },
  { type: "function", function: { name: "dispatch_to_specialist", description: "Route the question to one of 10 specialist personas built into substrate. ALWAYS use this instead of answering directly when the question is in a specialist's domain. Each persona is grounded in 2026 B2B SMB services reality and Kirill's substrate beliefs. Specialists: copywriter (actual post writing), market-researcher (sizing/validation), marketing-strategist (channel+positioning strategy), partnership-strategist, pricing-strategist (rates/packages), prospecting-specialist (lead list build), reddit-strategist, sales-strategist, telegram-strategist, web-strategist (site+SEO).", parameters: { type: "object", properties: { specialist: { type: "string", enum: ["copywriter","market-researcher","marketing-strategist","partnership-strategist","pricing-strategist","prospecting-specialist","reddit-strategist","sales-strategist","telegram-strategist","web-strategist"] }, question: { type: "string" }, context: { type: "string", description: "Optional extra context for the specialist" } }, required: ["specialist", "question"] } } },
  // Code delegation - the killer tool
  { type: "function", function: { name: "delegate_to_coder", description: "Open VS Code and spawn a Claude Code CLI session in a new Terminal with a task pre-loaded. Use this when Kirill says 'построй X', 'создай план для Y', 'давай задачу VS Code', 'делегируй'. The task should be detailed - what to build, what files matter, success criteria.", parameters: { type: "object", properties: { task: { type: "string", description: "Detailed task description for Claude Code" }, mode: { type: "string", enum: ["interactive", "background"], description: "interactive opens visible Terminal; background runs claude -p silently" }, context_files: { type: "array", items: { type: "string" } } }, required: ["task"] } } },
  { type: "function", function: { name: "delegation_status", description: "Check status of a previously delegated coding task by id.", parameters: { type: "object", properties: { delegation_id: { type: "string" } }, required: ["delegation_id"] } } },
  { type: "function", function: { name: "delegations_list", description: "List all coding delegations (past and current).", parameters: { type: "object", properties: {} } } },
  // Site editing
  { type: "function", function: { name: "site_list", description: "List files in one of the sites: launchsoloai (apps/web), command (apps/command-site), tolik (apps/tolik), dashboard.", parameters: { type: "object", properties: { target: { type: "string", enum: ["launchsoloai","command","tolik","dashboard"] } }, required: ["target"] } } },
  { type: "function", function: { name: "site_edit", description: "Edit a site file by find-and-replace. The find string must be unique in the file.", parameters: { type: "object", properties: { path: { type: "string" }, find: { type: "string" }, replace: { type: "string" } }, required: ["path", "find", "replace"] } } },
  { type: "function", function: { name: "site_git_status", description: "Git status - what's changed in the repo.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "site_git_diff", description: "Git diff of changes, optionally for a specific path.", parameters: { type: "object", properties: { path: { type: "string" } } } } },
  // Goals
  { type: "function", function: { name: "tolik_get_goals", description: "List Kirill's current targets with their progress.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "tolik_add_goal", description: "Add a new goal. Use when Kirill says 'поставь цель', 'добавь target'.", parameters: { type: "object", properties: { id: { type: "string" }, label: { type: "string" }, target: { type: "number" }, unit: { type: "string" }, why: { type: "string" }, deadline: { type: "string" } }, required: ["id", "label", "target"] } } },
  { type: "function", function: { name: "tolik_update_goal_value", description: "Update the current value of a MANUAL-measured goal (e.g. monthly revenue Kirill enters by voice).", parameters: { type: "object", properties: { id: { type: "string" }, current: { type: "number" } }, required: ["id", "current"] } } },
  // Atlas - Tolik's index of the whole organism
  { type: "function", function: { name: "sub_atlas", description: "Search Tolik's atlas of EVERY bot, action, persona, channel, DB in the organism. ALWAYS call this when Kirill asks 'what bots do we have', 'what can substrate do', 'кто отвечает за X', 'есть ли в системе Y'. Returns matched entries with descriptions. Use {query:'keyword'} to find by topic; {section:'factory|survival|cortex|tolik|actions|personas|dbs'} to list a whole section.", parameters: { type: "object", properties: { query: { type: "string" }, section: { type: "string", enum: ["actions","personas","factory","survival","cortex","tolik","organism","command","dbs"] } } } } },
  { type: "function", function: { name: "atlas_rebuild", description: "Regenerate the atlas from current source files. Call after major changes (new bots added, etc).", parameters: { type: "object", properties: {} } } },
];

/**
 * Call OpenAI chat completion. Returns:
 *   { ok, content, tool_calls, usage, cost_usd, latency_ms }
 *
 * Optional `messages` lets caller pass a pre-built turn sequence
 * (for follow-up calls after a tool returns).
 */
export async function openaiThink({ system, user, messages, tools = TOLIK_FUNCTIONS, tool_choice = "auto", caller = "tolik_voice", model, max_tokens = 250 }) {
  const env = envMap();
  const key = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, reason: "no_openai_key" };

  const useModel = model || MODEL;
  const msgs = messages || [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  const started = Date.now();
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: useModel,
        messages: msgs,
        tools,
        tool_choice,
        temperature: 0.4,
        max_tokens,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) {
      const body = await r.text();
      return { ok: false, reason: "openai_http_" + r.status, body };
    }
    const j = await r.json();
    const latency_ms = Date.now() - started;
    const msg = j.choices?.[0]?.message;
    const usage = j.usage || {};
    const price = PRICES_USD_PER_MTOK[useModel] || PRICES_USD_PER_MTOK["gpt-4o-mini"];
    const cost_usd = ((usage.prompt_tokens || 0) * price.input + (usage.completion_tokens || 0) * price.output) / 1_000_000;

    const record = {
      ts: new Date().toISOString(),
      caller,
      model: useModel,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      cost_usd,
      latency_ms,
      tool_called: msg?.tool_calls?.[0]?.function?.name || null,
    };
    logCall(record);

    return {
      ok: true,
      content: msg?.content || "",
      tool_calls: msg?.tool_calls || [],
      usage,
      cost_usd,
      latency_ms,
    };
  } catch (e) {
    return { ok: false, reason: "openai_threw", error: e.message };
  }
}
