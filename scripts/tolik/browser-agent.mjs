/**
 * scripts/tolik/browser-agent.mjs
 *
 * Tolik's hands - a separate Chromium instance (NOT Kirill's main browser)
 * that Tolik controls via Playwright. Persistent profile at
 * .data/tolik-browser-profile so Tolik can log into Gmail / Calendar /
 * other services once and stay logged in across restarts.
 *
 * Two interaction modes:
 *   1. HTTP control plane on port 4790: voice-bridge POSTs commands here
 *      after Claude decides Tolik should "open Gmail" or "search the web"
 *   2. CLI tool: `node scripts/tolik/browser-agent.mjs open https://...`
 *
 * Exposed actions:
 *   open(url) - navigate to url, screenshot back
 *   search(query) - Google search, return top results + screenshot
 *   gmail.search(query) - search Gmail (if logged in), return subject lines
 *   gmail.draft(to, subject, body) - open compose, fill, leave for review
 *   calendar.today() - read today's events from calendar.google.com
 *   read(selector) - read text content of element at selector
 *   screenshot() - return current page as png base64
 *
 * Lifecycle: chromium spawned on first request, kept alive. Idle for >30min
 * → graceful close. Restarted on next request.
 *
 * Requires: pnpm add -D playwright (one-time), then playwright install chromium.
 */

import { enforceOAuthBilling } from "../lib/billing-guard.mjs";
enforceOAuthBilling();
import http from "node:http";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { fs_read, fs_list, fs_grep, fs_open_editor, fs_tail_log } from "./fs-tools.mjs";
import { tg_send_to_me, tg_send_to, tg_recent, tg_post_to_channel } from "./tg-tools.mjs";
import { rec_start, rec_stop, rec_status } from "./recorder.mjs";
import { sub_run_action, sub_query_db, sub_wiki, sub_tail_log, morning_brief } from "./substrate-tools.mjs";
import { list_isas, read_isa, isa_status, isa_run_check } from "./isa-tools.mjs";
import { web_read, news_top, weather } from "./web-tools.mjs";
import { intel_outreach_recent, intel_leads_summary, intel_reddit_recent, intel_linkedin_recent, intel_substrate_overview, intel_files_recent } from "./intel-tools.mjs";
import { content_draft, content_save, dispatch_to_specialist, content_status, content_queue_add, content_compose, content_recent, content_regen } from "./content-tools.mjs";
import { delegate_to_coder, delegation_status, delegations_list } from "./code-delegate.mjs";
import { site_list, site_edit, site_git_status, site_git_diff } from "./site-tools.mjs";
import { tolik_get_goals, tolik_add_goal, tolik_update_goal_value } from "./goals.mjs";
import { sub_atlas, buildAtlas } from "./atlas.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const PROFILE_DIR = resolve(ROOT, ".data/tolik-browser-profile");
const PID_PATH = resolve(ROOT, ".data/tolik-browser.pid");
const PORT = Number(process.env.TOLIK_BROWSER_PORT || 4790);
const IDLE_CLOSE_MS = 30 * 60 * 1000;

let browser = null;
let context = null;
let page = null;
let lastUseAt = 0;
let idleTimer = null;

async function ensurePlaywright() {
  try {
    const mod = await import("playwright");
    return mod;
  } catch (e) {
    return { __missing: true, reason: e.message };
  }
}

async function ensurePage() {
  const pw = await ensurePlaywright();
  if (pw.__missing) {
    return { ok: false, reason: "playwright_not_installed",
             hint: "pnpm add -D playwright && npx playwright install chromium" };
  }
  if (!existsSync(PROFILE_DIR)) mkdirSync(PROFILE_DIR, { recursive: true });
  if (!context) {
    context = await pw.chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      viewport: { width: 1280, height: 800 },
      args: [
        "--disable-blink-features=AutomationControlled",
        "--window-position=200,40",
        "--window-size=1280,820",
      ],
    });
    browser = context.browser();
    page = context.pages()[0] || await context.newPage();
  }
  lastUseAt = Date.now();
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (Date.now() - lastUseAt >= IDLE_CLOSE_MS) {
      try { await context.close(); } catch {}
      context = null; browser = null; page = null;
    }
  }, IDLE_CLOSE_MS);
  return { ok: true };
}

// Bring Tolik's Chromium window to the foreground so Kirill can see what
// Tolik is doing. Playwright's bringToFront() is a no-op on macOS without
// also using AppleScript to activate the application bundle. Combine both.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const _exec = promisify(execFile);
async function bringChromiumToFront() {
  try { await page.bringToFront(); } catch {}
  // macOS: activate Chromium's headless-shell that Playwright launched
  if (process.platform === "darwin") {
    try {
      await _exec("osascript", ["-e", `tell application "System Events" to set frontmost of every process whose unix id is ${context?.browser()?.process?.()?.pid || 0} to true`]).catch(() => {});
    } catch {}
    // Fallback: try by app names Playwright uses
    for (const name of ["Chromium", "chromium-headless-shell", "Chrome for Testing"]) {
      try { await _exec("osascript", ["-e", `tell application "${name}" to activate`]); break; } catch {}
    }
  }
}

async function action_open({ url }) {
  const r = await ensurePage();
  if (!r.ok) return r;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await bringChromiumToFront();
  const title = await page.title();
  return { ok: true, url, title };
}

async function action_search({ query }) {
  const r = await ensurePage();
  if (!r.ok) return r;
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await bringChromiumToFront();
  // Extract top 5 result titles + links
  const results = await page.evaluate(() => {
    const items = [];
    document.querySelectorAll("h3").forEach((h, i) => {
      if (i >= 5) return;
      const a = h.closest("a");
      items.push({ title: h.innerText, href: a?.href });
    });
    return items;
  });
  return { ok: true, query, results };
}

async function action_gmail_search({ query }) {
  const r = await ensurePage();
  if (!r.ok) return r;
  await page.goto(`https://mail.google.com/mail/u/0/#search/${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await bringChromiumToFront();
  // Wait briefly for results to render. If not logged in we just return what we see.
  await page.waitForTimeout(2500);
  const items = await page.evaluate(() => {
    const rows = [];
    document.querySelectorAll('tr.zA').forEach((tr, i) => {
      if (i >= 10) return;
      const from = tr.querySelector('.yW span')?.innerText;
      const subj = tr.querySelector('.bog span')?.innerText;
      const snippet = tr.querySelector('.y2')?.innerText;
      rows.push({ from, subj, snippet });
    });
    return rows;
  });
  return { ok: true, query, items, logged_in: items.length > 0 };
}

async function action_gmail_draft({ to, subject, body }) {
  const r = await ensurePage();
  if (!r.ok) return r;
  await page.goto("https://mail.google.com/mail/u/0/#inbox?compose=new", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await bringChromiumToFront();
  await page.waitForTimeout(2000);
  try {
    await page.fill('input[name="to"]', to);
    await page.fill('input[name="subjectbox"]', subject || "");
    const bodyEl = await page.$('div[aria-label="Message Body"]');
    if (bodyEl) await bodyEl.fill(body || "");
    return { ok: true, mode: "draft_filled_awaiting_kirill_review", to, subject };
  } catch (e) {
    return { ok: false, reason: "gmail_compose_failed", error: e.message,
             hint: "Probably not logged in. Open the browser and log in once - the profile persists." };
  }
}

async function action_calendar_today() {
  const r = await ensurePage();
  if (!r.ok) return r;
  await page.goto("https://calendar.google.com/calendar/u/0/r/day", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await bringChromiumToFront();
  await page.waitForTimeout(2500);
  const events = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('[role="button"][aria-label]').forEach((el, i) => {
      const label = el.getAttribute("aria-label") || "";
      if (i < 30 && /\d{1,2}:\d{2}/.test(label)) out.push(label);
    });
    return out;
  });
  return { ok: true, events };
}

async function action_screenshot() {
  const r = await ensurePage();
  if (!r.ok) return r;
  const buf = await page.screenshot({ type: "png", fullPage: false });
  return { ok: true, png_b64: buf.toString("base64") };
}

const ACTIONS = {
  // Browser (Chromium controlled via Playwright)
  open: action_open,
  search: action_search,
  gmail_search: action_gmail_search,
  gmail_draft: action_gmail_draft,
  calendar_today: action_calendar_today,
  screenshot: action_screenshot,
  // File system (sandboxed to repo)
  fs_read,
  fs_list,
  fs_grep,
  fs_open_editor,
  fs_tail_log,
  // Telegram (bot + MTProto fallback)
  tg_send_to_me,
  tg_send_to,
  tg_recent,
  // Screen recording
  rec_start,
  rec_stop,
  rec_status,
  // Substrate control
  sub_run_action,
  sub_query_db,
  sub_wiki,
  sub_tail_log,
  morning_brief,
  list_isas,
  read_isa,
  isa_status,
  isa_run_check,
  // Web / news / weather (Tolik's "stay informed" toolset)
  web_read,
  news_top,
  weather,
  // Telegram extra
  tg_post_to_channel,
  // Intel shortcuts on substrate DBs
  intel_outreach_recent,
  intel_leads_summary,
  intel_reddit_recent,
  intel_linkedin_recent,
  intel_substrate_overview,
  intel_files_recent,
  // Content writing
  content_draft,
  content_save,
  dispatch_to_specialist,
  // Content DEPARTMENT (Visual Agent + post-writer integrated, May 2026)
  content_status,
  content_queue_add,
  content_compose,
  content_recent,
  content_regen,
  // Code delegation to Claude Code
  delegate_to_coder,
  delegation_status,
  delegations_list,
  // Site (apps/web, apps/command-site, etc.)
  site_list,
  site_edit,
  site_git_status,
  site_git_diff,
  // Goals
  tolik_get_goals,
  tolik_add_goal,
  tolik_update_goal_value,
  // Atlas: full knowledge index of the organism
  sub_atlas,
  atlas_rebuild: async () => buildAtlas(),
};

function readBody(req) {
  return new Promise((res, rej) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => res(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", rej);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, ts: new Date().toISOString(), browser_alive: !!context }));
    return;
  }
  if (req.method === "POST" && req.url?.startsWith("/action/")) {
    const action = req.url.replace("/action/", "");
    const handler = ACTIONS[action];
    if (!handler) { res.writeHead(404); res.end(JSON.stringify({ ok: false, reason: "unknown_action" })); return; }
    let payload = {};
    try { payload = JSON.parse(await readBody(req) || "{}"); }
    catch { res.writeHead(400); res.end(JSON.stringify({ ok: false, reason: "invalid_json" })); return; }
    let result;
    try { result = await handler(payload); }
    catch (e) { result = { ok: false, reason: "action_threw", error: e.message }; }
    res.writeHead(result.ok ? 200 : 500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(result));
    return;
  }
  res.writeHead(404); res.end();
});

writeFileSync(PID_PATH, String(process.pid));
server.listen(PORT, "127.0.0.1", () => {
  console.log(`[tolik-browser-agent] :${PORT} pid=${process.pid}`);
});

process.on("SIGTERM", async () => {
  try { if (context) await context.close(); } catch {}
  process.exit(0);
});
