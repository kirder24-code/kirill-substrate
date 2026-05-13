/**
 * reddit-rate-guard.mjs
 *
 * Hard rate limits to avoid Reddit shadowban:
 *   - Max 1 comment per subreddit per 24h
 *   - Max 6 comments per day total
 *   - Min 45 min between comments (burst protection)
 *
 * Reads from leads table where stage='contacted' and source LIKE 'reddit_r_%'.
 * Used by any dispatch script BEFORE sending drafts to Telegram.
 *
 * CLI: node scripts/factory/reddit-rate-guard.mjs check [sub]
 *      node scripts/factory/reddit-rate-guard.mjs summary
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../../.data/linkedin-brand-os.sqlite");

export const LIMITS = {
  perSubPer24h: 1,
  perDayTotal: 6,
  minMinutesBetween: 45,
};

// GROUND TRUTH: read Kirill's actual Reddit comment history, not our DB.
// Manual posts (Kirill posting from phone without clicking Posted button) are
// invisible to our DB. The Reddit API is the only source of truth for "what
// did Kirill actually post in the last 24h".
const KIRILL_USERNAME = "Ok-Serve4908";
const UA = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36";

export async function getRecentPosts() {
  try {
    const r = await fetch(`https://www.reddit.com/user/${KIRILL_USERNAME}/comments.json?limit=50&sort=new&raw_json=1`, {
      headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      console.error(`[rate-guard] Reddit API ${r.status} - FAILING CLOSED, treating as max usage`);
      // Fail closed: pretend daily cap is reached so we never spam
      return Array(LIMITS.perDayTotal).fill({ sub: "unknown", at: new Date() });
    }
    const data = await r.json();
    const cutoff = Date.now() / 1000 - 24 * 3600;
    return (data?.data?.children || [])
      .filter(c => c.kind === "t1" && c.data?.created_utc >= cutoff)
      .map(c => ({ sub: c.data.subreddit, at: new Date(c.data.created_utc * 1000) }));
  } catch (e) {
    console.error(`[rate-guard] fetch failed: ${e.message} - FAILING CLOSED`);
    return Array(LIMITS.perDayTotal).fill({ sub: "unknown", at: new Date() });
  }
}

export function canPostToSub(sub, recent) {
  const subLower = sub.replace(/^r\//, "").toLowerCase();
  return !recent.some(r => r.sub.toLowerCase() === subLower);
}

export function dailyBudgetRemaining(recent) {
  return Math.max(0, LIMITS.perDayTotal - recent.length);
}

export function minutesSinceLastPost(recent) {
  if (recent.length === 0) return Infinity;
  return Math.floor((Date.now() - recent[0].at.getTime()) / 60000);
}

export async function canPostNow(sub) {
  const recent = await getRecentPosts();
  const reasons = [];
  if (!canPostToSub(sub, recent)) reasons.push(`r/${sub} already posted within 24h`);
  if (dailyBudgetRemaining(recent) <= 0) reasons.push(`daily cap ${LIMITS.perDayTotal} reached`);
  const mins = minutesSinceLastPost(recent);
  if (mins < LIMITS.minMinutesBetween) reasons.push(`only ${mins}m since last post (need ${LIMITS.minMinutesBetween}m)`);
  return { ok: reasons.length === 0, reasons };
}

export async function filterDraftsBySafety(drafts) {
  // drafts: array of {sub, ...}. Returns {allowed, blocked} respecting per-sub uniqueness within batch too.
  const recent = await getRecentPosts();
  const seenSubs = new Set(recent.map(r => r.sub.toLowerCase()));
  const allowed = [];
  const blocked = [];
  let budget = dailyBudgetRemaining(recent);
  for (const d of drafts) {
    const sub = (d.sub || "").replace(/^r\//, "").toLowerCase();
    if (seenSubs.has(sub)) { blocked.push({ ...d, reason: `r/${sub} already in 24h window` }); continue; }
    if (budget <= 0) { blocked.push({ ...d, reason: `daily cap ${LIMITS.perDayTotal} reached` }); continue; }
    allowed.push(d);
    seenSubs.add(sub);
    budget--;
  }
  return { allowed, blocked };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2] || "summary";
  const recent = await getRecentPosts();
  if (cmd === "summary") {
    console.log(`Source: Reddit user API (ground truth, not local DB)`);
    console.log(`Recent (last 24h): ${recent.length} / ${LIMITS.perDayTotal}`);
    console.log(`Budget remaining: ${dailyBudgetRemaining(recent)}`);
    console.log(`Min since last: ${minutesSinceLastPost(recent)}`);
    console.log(`Subs used:`);
    for (const r of recent) console.log(`  r/${r.sub}  ${r.at.toISOString()}`);
  } else if (cmd === "check") {
    const sub = process.argv[3];
    if (!sub) { console.error("usage: check <sub>"); process.exit(1); }
    console.log(JSON.stringify(await canPostNow(sub), null, 2));
  }
}
