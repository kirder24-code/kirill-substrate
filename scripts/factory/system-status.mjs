/**
 * system-status.mjs - Quick health check for Kirill
 *
 * Run: node scripts/factory/system-status.mjs
 * Shows: what's alive, what's dead, last activity, key metrics
 */
import { execSync } from "child_process";
import { readFileSync, statSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");

function ago(mtime) {
  const mins = Math.floor((Date.now() - mtime) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

console.log("\n========================================");
console.log("  SYSTEM STATUS - launchsoloai.com");
console.log("========================================\n");

// 1. Running processes
const procs = execSync("ps aux | grep 'node.*linkedin-brand' | grep -v grep || true", { encoding: "utf-8" });
const running = procs.split("\n").filter(Boolean).map(l => {
  const m = l.match(/scripts\/factory\/(\S+)|dashboard\/(\S+)/);
  return m ? (m[1] || m[2]) : null;
}).filter(Boolean);
console.log(`LIVE PROCESSES (${running.length}):`);
running.forEach(p => console.log(`  + ${p}`));

// 2. Cron bot activity
console.log("\nBOT LAST ACTIVITY:");
const logs = [
  "system-brain", "watchdog", "fresh-pain-scout", "buying-signal-hunt",
  "content-curator-bot", "monitor-replies", "awareness-bot",
  "hn-show-hn-scout", "calgary-local-pain-scout", "dashboard-update"
];
for (const name of logs) {
  const path = `/tmp/lbo-${name}.log`;
  try {
    const st = statSync(path);
    const lastLine = execSync(`tail -1 "${path}"`, { encoding: "utf-8" }).trim().slice(0, 80);
    console.log(`  ${ago(st.mtimeMs).padEnd(8)} ${name.padEnd(28)} ${lastLine}`);
  } catch {
    console.log(`  ${"never".padEnd(8)} ${name.padEnd(28)} (no log)`);
  }
}

// 3. Key metrics from DB
try {
  const db = new Database(DB_PATH, { readonly: true });
  const total = db.prepare("SELECT COUNT(*) c FROM leads").get().c;
  const warming = db.prepare("SELECT COUNT(*) c FROM lead_enrichment WHERE classification = 'warming'").get().c;
  const ready = db.prepare("SELECT COUNT(*) c FROM lead_enrichment WHERE classification = 'ready_buyer'").get().c;
  const contacted = db.prepare("SELECT COUNT(*) c FROM leads WHERE stage = 'contacted'").get().c;
  let replied = 0;
  try { replied = db.prepare("SELECT COUNT(*) c FROM outreach_emails WHERE status='replied' AND is_meaningful_reply=1").get().c; } catch {
    replied = db.prepare("SELECT COUNT(*) c FROM leads WHERE stage = 'replied'").get().c;
  }
  const unenriched = db.prepare("SELECT COUNT(*) c FROM leads WHERE id NOT IN (SELECT lead_id FROM lead_enrichment)").get().c;

  console.log("\nPIPELINE:");
  console.log(`  Total leads:    ${total}`);
  console.log(`  Unenriched:     ${unenriched} ${unenriched > 500 ? "(SCOUTS PAUSED)" : ""}`);
  console.log(`  Warming:        ${warming}`);
  console.log(`  Ready buyer:    ${ready}`);
  console.log(`  Contacted:      ${contacted}`);
  console.log(`  Replied:        ${replied}`);
  console.log(`  Revenue:        $0`);
  db.close();
} catch (e) {
  console.log("\nPIPELINE: DB error -", e.message);
}

// 4. Wiki directives freshness
try {
  const dir = readFileSync(resolve(ROOT, "wiki/directives.md"), "utf-8");
  const dateMatch = dir.match(/Last updated: (\S+)/);
  if (dateMatch) {
    const updated = new Date(dateMatch[1]);
    console.log(`\nBRAIN LAST THOUGHT: ${ago(updated.getTime())}`);
  }
  const bottleneck = dir.match(/\*\*(.+?)\*\*/);
  if (bottleneck) console.log(`  Bottleneck: ${bottleneck[1].slice(0, 80)}`);
} catch {}

// 5. Site freshness
try {
  const html = readFileSync(resolve(ROOT, "sandbox-review/site/index.html"), "utf-8");
  const weekMatch = html.match(/Week of ([^<]+)/);
  if (weekMatch) {
    console.log(`\nSITE WEEK-LOG: "${weekMatch[1].trim()}"`);
    // Check staleness
    const weekDate = new Date(weekMatch[1].trim());
    const daysSince = Math.floor((Date.now() - weekDate.getTime()) / 86400000);
    if (daysSince > 7) console.log(`  WARNING: ${daysSince} days old - NEEDS UPDATE`);
    else console.log(`  OK (${daysSince} days old)`);
  }
} catch {}

// 6. Google Ads reminder
console.log("\nGOOGLE ADS:");
console.log("  Campaign 1: Vibe-code audit (worldwide) - check ads.google.com");
console.log("  Campaign 2: Calgary trades (local) - check ads.google.com");

console.log("\n========================================");
console.log("  Run: node scripts/factory/system-status.mjs");
console.log("========================================\n");
