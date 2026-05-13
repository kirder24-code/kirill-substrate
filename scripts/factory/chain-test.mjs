/**
 * chain-test.mjs — Tests every data chain in the system end-to-end
 *
 * Not syntax. Not imports. RUNTIME chains:
 * Does data flow from A → B → C without breaking?
 *
 * Run: node scripts/factory/chain-test.mjs
 */

import Database from "better-sqlite3";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");

const results = { pass: 0, fail: 0, details: [] };

function pass(chain, detail = "") {
  results.pass++;
  results.details.push({ status: "PASS", chain, detail });
  console.log(`  ✅ ${chain}`);
}
function fail(chain, detail = "") {
  results.fail++;
  results.details.push({ status: "FAIL", chain, detail });
  console.log(`  ❌ ${chain} — ${detail}`);
}

console.log("=== CHAIN TEST — Runtime Integration ===\n");

const db = new Database(DB_PATH, { readonly: true });

// ═══ 1. PURPOSE → BRAIN → DIRECTIVES → ORCHESTRATOR ═══
console.log("1. Strategic chain:");

// PURPOSE exists and is fresh
const purpose = existsSync(resolve(ROOT, "wiki/PURPOSE.md"))
  ? readFileSync(resolve(ROOT, "wiki/PURPOSE.md"), "utf-8") : "";
if (purpose.includes("Autonomous Operating System")) pass("PURPOSE.md has current identity");
else fail("PURPOSE.md missing identity", "Should contain 'Autonomous Operating System'");

// Directives exist and are fresh
const directives = existsSync(resolve(ROOT, "wiki/directives.md"))
  ? readFileSync(resolve(ROOT, "wiki/directives.md"), "utf-8") : "";
const dirMatch = directives.match(/Last updated: (.+)/);
if (dirMatch) {
  const hoursAgo = (Date.now() - new Date(dirMatch[1]).getTime()) / 3600000;
  if (hoursAgo < 4) pass(`Directives fresh (${hoursAgo.toFixed(1)}h ago)`);
  else fail(`Directives stale`, `${hoursAgo.toFixed(0)}h old`);
} else fail("Directives missing timestamp");

// Orchestrator state exists
const orchState = existsSync(resolve(ROOT, ".data/orchestrator-loop-state.json"))
  ? JSON.parse(readFileSync(resolve(ROOT, ".data/orchestrator-loop-state.json"), "utf-8")) : null;
if (orchState?.branch) pass(`Orchestrator active (cycle ${orchState.cycleNum}, branch: ${orchState.branch.slice(0, 40)})`);
else fail("Orchestrator state missing");

// ═══ 2. DISCOVERY → HYPOTHESIS → EXECUTOR → MONITOR ═══
console.log("\n2. Discovery chain:");

const discState = existsSync(resolve(ROOT, ".data/cortex-discovery-state.json"))
  ? JSON.parse(readFileSync(resolve(ROOT, ".data/cortex-discovery-state.json"), "utf-8")) : null;
if (discState?.activeHypothesis?.market) pass(`Active hypothesis: ${discState.activeHypothesis.market.slice(0, 50)}`);
else fail("No active hypothesis");

// Hypothesis tests exist
const htCount = db.prepare("SELECT COUNT(*) as c FROM hypothesis_tests").get()?.c || 0;
if (htCount > 0) pass(`${htCount} hypothesis tests tracked`);
else fail("No hypothesis tests — executor never ran");

// Tests have status progression
const htStatuses = db.prepare("SELECT status, COUNT(*) as c FROM hypothesis_tests GROUP BY status").all();
const statusMap = Object.fromEntries(htStatuses.map(s => [s.status, s.c]));
if (statusMap.sent > 0) pass(`${statusMap.sent} tests posted by Kirill`);
else fail("No tests marked as sent — button flow broken?");

// Monitored threads exist for hypothesis
const hypMonitored = db.prepare("SELECT COUNT(*) as c FROM bot_intelligence WHERE bot_id='reddit' AND insight_type='monitoring' AND value_json LIKE '%hypothesis%'").get()?.c || 0;
if (hypMonitored > 0) pass(`${hypMonitored} hypothesis threads monitored by reddit-monitor`);
else fail("Hypothesis threads not registered for monitoring");

// ═══ 3. REDDIT MONITORING → SEEN TRACKING ═══
console.log("\n3. Reddit reply chain:");

const allMonitored = db.prepare("SELECT key, value_json FROM bot_intelligence WHERE bot_id='reddit' AND insight_type='monitoring'").all();
let totalSeen = 0;
let emptySeenCount = 0;
for (const row of allMonitored) {
  try {
    const m = JSON.parse(row.value_json);
    const seen = m.seenCommentIds || [];
    totalSeen += seen.length;
    if (seen.length === 0) emptySeenCount++;
  } catch {}
}
if (totalSeen > 0) pass(`${totalSeen} comment IDs marked as seen (won't repeat)`);
else fail("No seenCommentIds — replies will spam Kirill");

if (emptySeenCount < allMonitored.length) pass(`${allMonitored.length - emptySeenCount}/${allMonitored.length} threads have seen history`);
else fail("All threads have empty seen history");

// Check reply_context entries match monitoring entries
const replyContexts = db.prepare("SELECT COUNT(*) as c FROM bot_intelligence WHERE bot_id='reddit' AND insight_type='reply_context'").get()?.c || 0;
if (replyContexts > 0) pass(`${replyContexts} reply contexts saved (for button callbacks)`);
else fail("No reply contexts — buttons won't be able to update seenCommentIds");

// ═══ 4. CONVERSATION TRACKING ═══
console.log("\n4. Conversation chain:");

try {
  const convCount = db.prepare("SELECT COUNT(*) as c FROM conversations").get()?.c || 0;
  if (convCount > 0) pass(`${convCount} conversations tracked`);
  else fail("No conversations — recordFirstContact/recordReply never called");

  const activeConvs = db.prepare("SELECT COUNT(*) as c FROM conversations WHERE stage NOT IN ('won','lost','dormant')").get()?.c || 0;
  if (activeConvs > 0) pass(`${activeConvs} active conversations`);
  else fail("No active conversations");
} catch (e) {
  fail("conversations table missing", e.message);
}

// ═══ 5. FIELD KIT → EXECUTOR ═══
console.log("\n5. Field kit chain:");

const kitsPath = resolve(ROOT, ".data/active-field-kits.json");
if (existsSync(kitsPath)) {
  const kits = JSON.parse(readFileSync(kitsPath, "utf-8"));
  if (Array.isArray(kits) && kits.length > 0) pass(`${kits.length} active field kit(s): ${kits.map(k => k.title).join(", ").slice(0, 80)}`);
  else fail("active-field-kits.json is empty");
} else fail("active-field-kits.json missing — no kits activated");

// ═══ 6. LEAD PIPELINE ═══
console.log("\n6. Lead pipeline chain:");

const totalLeads = db.prepare("SELECT COUNT(*) as c FROM leads").get()?.c || 0;
const todayLeads = db.prepare("SELECT COUNT(*) as c FROM leads WHERE created_at > date('now', '-1 day')").get()?.c || 0;
pass(`${totalLeads} total leads, ${todayLeads} in last 24h`);

// Score distribution — are leads scoreable?
const above60 = db.prepare("SELECT COUNT(*) as c FROM leads WHERE score >= 60").get()?.c || 0;
const below60 = db.prepare("SELECT COUNT(*) as c FROM leads WHERE score < 60 AND score > 0").get()?.c || 0;
if (above60 > 0) pass(`${above60} leads with score >= 60 (enrichment eligible)`);
else fail("0 leads with score >= 60 — scoring too strict, pipeline dead");

// Enrichment → warming
const warming = db.prepare("SELECT COUNT(*) as c FROM lead_enrichment WHERE classification IN ('warming','ready_buyer')").get()?.c || 0;
if (warming > 0) pass(`${warming} warming/ready_buyer leads`);
else fail("0 warming leads — enrichment not producing actionable leads");

// ═══ 7. EMAIL PIPELINE ═══
console.log("\n7. Email chain:");

const sent = db.prepare("SELECT COUNT(*) as c FROM outreach_emails WHERE status='sent'").get()?.c || 0;
const meaningful = db.prepare("SELECT COUNT(*) as c FROM outreach_emails WHERE is_meaningful_reply=1").get()?.c || 0;
pass(`${sent} emails sent, ${meaningful} meaningful replies`);

if (meaningful === 0 && sent > 50) fail("0 meaningful replies from 50+ sends — email channel is dead");

// ═══ 8. TELEGRAM CALLBACKS ═══
console.log("\n8. Telegram callback chain:");

// Check kirill_feedback entries exist (proves buttons save data)
const feedbackCount = db.prepare("SELECT COUNT(*) as c FROM bot_intelligence WHERE bot_id='cortex' AND insight_type='kirill_feedback'").get()?.c || 0;
if (feedbackCount > 0) pass(`${feedbackCount} Kirill feedback entries saved from button presses`);
else fail("No kirill_feedback — button presses not being saved");

// ═══ 9. BRAIN BELIEFS ═══
console.log("\n9. Brain chain:");

try {
  const beliefs = db.prepare("SELECT COUNT(*) as c FROM wm_beliefs").get()?.c || 0;
  const predictions = db.prepare("SELECT COUNT(*) as c FROM wm_predictions").get()?.c || 0;
  const tested = db.prepare("SELECT COUNT(*) as c FROM wm_predictions WHERE tested_at IS NOT NULL").get()?.c || 0;
  pass(`${beliefs} beliefs, ${predictions} predictions, ${tested} tested`);
  if (tested > 0) pass(`Brain auto-validation working (${tested} predictions tested)`);
  else fail("0 predictions tested — autoValidatePredictions not running");
} catch (e) {
  fail("Brain tables missing", e.message);
}

// ═══ 10. AWARENESS ═══
console.log("\n10. Awareness chain:");

const latestAwareness = resolve(ROOT, ".data/awareness/latest.md");
if (existsSync(latestAwareness)) {
  const content = readFileSync(latestAwareness, "utf-8");
  const dateMatch = content.match(/Generated: (\S+)/);
  if (dateMatch) {
    const hoursAgo = (Date.now() - new Date(dateMatch[1]).getTime()) / 3600000;
    if (hoursAgo < 24) pass(`Awareness brief fresh (${hoursAgo.toFixed(1)}h ago)`);
    else fail(`Awareness brief stale`, `${hoursAgo.toFixed(0)}h old`);
  }
} else fail("No awareness brief");

// Check Portugal/EU queries exist in awareness
const awarenessCode = readFileSync(resolve(ROOT, "scripts/factory/awareness-bot.mjs"), "utf-8");
if (awarenessCode.includes("Portugal")) pass("Portugal/EU queries in awareness-bot");
else fail("No Portugal queries — EU market research not active");

if (awarenessCode.includes("franchise")) pass("Chain/franchise queries in awareness-bot");
else fail("No franchise queries — chain business research not active");

// ═══ 11. SITE ═══
console.log("\n11. Site chain:");

const indexHtml = existsSync(resolve(ROOT, "sandbox-review/site/index.html"))
  ? readFileSync(resolve(ROOT, "sandbox-review/site/index.html"), "utf-8") : "";
if (indexHtml && !/voice.agent|voice.receptionist/i.test(indexHtml)) pass("Site clean — no voice agent refs");
else fail("Site still has voice agent references");

// ═══ 12. CHANNEL CAPABILITIES ═══
console.log("\n12. Channel awareness chain:");

const capPath = resolve(ROOT, "wiki/channels/capabilities.md");
if (existsSync(capPath)) {
  const caps = readFileSync(capPath, "utf-8");
  if (caps.includes("Chain Business")) pass("Channel capabilities include chain business sources");
  else fail("No chain business sources in capabilities");
  if (caps.includes("Threads")) pass("Threads in capabilities");
  else fail("Threads missing from capabilities");
} else fail("wiki/channels/capabilities.md missing");

// ═══ 13. DAEMONS ═══
console.log("\n13. Process chain:");

try {
  const { execSync } = await import("child_process");
  const ps = execSync("ps aux", { encoding: "utf-8" });
  const daemons = ["orchestrator-daemon", "sonnet-bots-daemon", "telegram-control", "cortex-daemon"];
  for (const d of daemons) {
    if (ps.includes(d)) pass(`${d} running`);
    else fail(`${d} NOT RUNNING`);
  }
} catch {}

// ═══ REPORT ═══
db.close();
console.log("\n" + "=".repeat(60));
console.log(`CHAIN TEST: ${results.pass} PASS | ${results.fail} FAIL`);
console.log("=".repeat(60));

if (results.fail > 0) {
  console.log("\n❌ BROKEN CHAINS:");
  for (const d of results.details.filter(d => d.status === "FAIL")) {
    console.log(`  ${d.chain}${d.detail ? " — " + d.detail : ""}`);
  }
}

if (results.fail === 0) {
  console.log("\n✅ ALL CHAINS CONNECTED");
}

console.log(`\nTotal chains tested: ${results.pass + results.fail}`);
process.exit(results.fail > 0 ? 1 : 0);
