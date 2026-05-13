/**
 * CORTEX FULL SELF-DIAGNOSTIC
 *
 * Checks every component of the living system:
 * - Brain modules (feedback, hunger, causal reasoning)
 * - Bot health (who's alive, who's dead)
 * - Database integrity (leads, enrichment, outreach)
 * - Learning loop (directives, evolution)
 * - Awareness breadth (sources, terms)
 * - Execution pipeline (callAI, HANDS, Telegram)
 *
 * Run: node scripts/cortex/self-diagnostic.mjs
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

const results = [];
let pass = 0, fail = 0, warn = 0;

function check(name, condition, detail = "") {
  if (condition) {
    results.push({ status: "PASS", name, detail });
    pass++;
  } else {
    results.push({ status: "FAIL", name, detail });
    fail++;
  }
}

function warning(name, detail = "") {
  results.push({ status: "WARN", name, detail });
  warn++;
}

console.log("=== CORTEX FULL SELF-DIAGNOSTIC ===\n");

// ═══════════════════════════════════════════════════════════════
// 1. BRAIN MODULES - do the new components exist?
// ═══════════════════════════════════════════════════════════════
console.log("--- 1. BRAIN MODULES ---");

check("feedback-extractor.mjs exists",
  existsSync(resolve(ROOT, "scripts/cortex/feedback-extractor.mjs")));

check("hunger-engine.mjs exists",
  existsSync(resolve(ROOT, "scripts/cortex/hunger-engine.mjs")));

check("causal-reasoning.mjs exists",
  existsSync(resolve(ROOT, "scripts/cortex/causal-reasoning.mjs")));

check("cortex-daemon imports feedback-extractor",
  readFileSync(resolve(ROOT, "scripts/cortex/cortex-daemon.mjs"), "utf-8").includes("runFeedbackExtraction"));

check("cortex-daemon imports hunger-engine",
  readFileSync(resolve(ROOT, "scripts/cortex/cortex-daemon.mjs"), "utf-8").includes("hungerCycle"));

check("hunger-engine imports causal-reasoning",
  readFileSync(resolve(ROOT, "scripts/cortex/hunger-engine.mjs"), "utf-8").includes("runCausalChain"));

// ═══════════════════════════════════════════════════════════════
// 2. LEARNING LOOP - does feedback flow from Kirill to bots?
// ═══════════════════════════════════════════════════════════════
console.log("--- 2. LEARNING LOOP ---");

check("cortex-active-directives.json exists",
  existsSync(resolve(ROOT, ".data/cortex-active-directives.json")));

try {
  const directives = JSON.parse(readFileSync(resolve(ROOT, ".data/cortex-active-directives.json"), "utf-8"));
  const active = (directives.directives || []).filter(d => d.active);
  check("Active directives present", active.length > 0, `${active.length} active directives`);
  check("Directives have confidence scores", active.every(d => d.confidence >= 0.8), "All >= 0.8");
} catch (e) {
  check("Directives readable", false, e.message);
}

// Check bots import getDirectivesFor
for (const bot of ["scout-bot", "idea-bot", "sales-bot", "content-bot", "evolution-bot"]) {
  const path = resolve(ROOT, `scripts/factory/${bot}.mjs`);
  if (existsSync(path)) {
    const code = readFileSync(path, "utf-8");
    check(`${bot} reads directives`, code.includes("getDirectivesFor"), "imports from orchestrator");
  }
}

// ═══════════════════════════════════════════════════════════════
// 3. callAI ENGINE - Claude CLI, not OpenAI
// ═══════════════════════════════════════════════════════════════
console.log("--- 3. AI ENGINE ---");

const orchCode = readFileSync(resolve(ROOT, "scripts/factory/orchestrator.mjs"), "utf-8");
check("MODEL_STRONG = Claude Sonnet", orchCode.includes('MODEL_STRONG  = "claude-sonnet-4-6"'));
check("MODEL_MINI = Claude Haiku", orchCode.includes('MODEL_MINI    = "claude-haiku-4-5'));
check("callAI uses Claude CLI", orchCode.includes("CLAUDE_BIN") && orchCode.includes("spawnSync"));
check("callAI does NOT use OpenAI fetch",
  !orchCode.includes('fetch("https://api.openai.com'));

// ═══════════════════════════════════════════════════════════════
// 4. BOT HEALTH - which bots are alive?
// ═══════════════════════════════════════════════════════════════
console.log("--- 4. BOT HEALTH ---");

// Check processes
const { execSync } = await import("child_process");
try {
  const ps = execSync("ps aux | grep -E 'orchestrator-daemon|cortex-daemon|sonnet-bots' | grep -v grep", { encoding: "utf-8" });
  check("orchestrator-daemon running", ps.includes("orchestrator-daemon"));
  check("cortex-daemon running", ps.includes("cortex-daemon"));
  check("sonnet-bots-daemon running", ps.includes("sonnet-bots"));
} catch {
  check("Daemons running", false, "ps command failed");
}

// Check crontab
try {
  const cron = execSync("crontab -l 2>/dev/null", { encoding: "utf-8" });
  check("fresh-pain-scout REMOVED from cron", !cron.includes("fresh-pain-scout"), "deprecated bot killed");
  check("buying-signal-hunt in cron", cron.includes("buying-signal-hunt"));
  check("cron-watchdog in cron", cron.includes("cron-watchdog"));
} catch {
  warning("Crontab check failed");
}

// ═══════════════════════════════════════════════════════════════
// 5. DATABASE INTEGRITY
// ═══════════════════════════════════════════════════════════════
console.log("--- 5. DATABASE ---");

try {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(resolve(ROOT, ".data/linkedin-brand-os.sqlite"));

  const leads = db.prepare("SELECT COUNT(*) as c FROM leads").get();
  check("Leads table accessible", leads.c > 0, `${leads.c} leads`);

  const qualified = db.prepare("SELECT COUNT(*) as c FROM leads WHERE score >= 60").get();
  check("Qualified leads (score 60+) exist", qualified.c > 0, `${qualified.c} qualified`);

  const enriched = db.prepare("SELECT COUNT(*) as c FROM lead_enrichment").get();
  check("Enrichment table accessible", enriched.c > 0, `${enriched.c} enrichments`);

  const notFit = db.prepare("SELECT COUNT(*) as c FROM lead_enrichment WHERE classification = 'not_fit'").get();
  const total = enriched.c;
  const notFitPct = Math.round(notFit.c / total * 100);
  check("Not-fit ratio", notFitPct < 90, `${notFitPct}% not_fit (was 82%)`);

  const replies = db.prepare("SELECT COUNT(*) as c FROM outreach_emails WHERE reply_received_at IS NOT NULL").get();
  check("Email replies exist", replies.c > 0, `${replies.c} replies`);

  db.close();
} catch (e) {
  check("Database accessible", false, e.message);
}

// ═══════════════════════════════════════════════════════════════
// 6. AWARENESS BREADTH
// ═══════════════════════════════════════════════════════════════
console.log("--- 6. AWARENESS ---");

const awarenessCode = readFileSync(resolve(ROOT, "scripts/factory/awareness-bot.mjs"), "utf-8");

check("Tier 2B (business/economy) sources exist", awarenessCode.includes("tier2b"));
check("r/smallbusiness monitored", awarenessCode.includes("r/smallbusiness"));
check("r/canadasmallbusiness monitored", awarenessCode.includes("canadasmallbusiness"));
check("r/artificial monitored", awarenessCode.includes("r/artificial"));
check("USA market terms added", awarenessCode.includes("usa ai") || awarenessCode.includes("us small business"));
check("Canada terms present", awarenessCode.includes("canada ai"));
check("Industry AI terms present", awarenessCode.includes("real estate ai"));
check("Current offers present", awarenessCode.includes("vibe") || awarenessCode.includes("automation"));
check("Missed call REMOVED", !awarenessCode.includes('"missed call"'));
check("TechCrunch unblocked", !awarenessCode.includes('"techcrunch.com"'));

// Count relevance terms
const termsMatch = awarenessCode.match(/RELEVANCE_TERMS = \[([\s\S]*?)\]/);
if (termsMatch) {
  const termCount = (termsMatch[1].match(/"/g) || []).length / 2;
  check("Relevance terms expanded", termCount > 80, `${termCount} terms (was ~65)`);
}

// ═══════════════════════════════════════════════════════════════
// 7. QUALITY GATES
// ═══════════════════════════════════════════════════════════════
console.log("--- 7. QUALITY GATES ---");

const dqcCode = readFileSync(resolve(ROOT, "scripts/factory/draft-quality-checker.mjs"), "utf-8");
check("Quality checker uses Sonnet (not Haiku)", dqcCode.includes("MODEL_STRONG"));

const rcCode = readFileSync(resolve(ROOT, "scripts/factory/reply-classifier.mjs"), "utf-8");
check("Reply classifier uses Sonnet (not Haiku)", rcCode.includes("MODEL_STRONG"));

const scoutCode = readFileSync(resolve(ROOT, "scripts/factory/scout-bot.mjs"), "utf-8");
check("Scout-bot Reddit threshold = 60", scoutCode.includes('"reddit"') && scoutCode.includes("? 60"));

const enrichCode = readFileSync(resolve(ROOT, "scripts/factory/lead-enrichment-bot.mjs"), "utf-8");
check("Enrichment only for score >= 60", enrichCode.includes("score >= 60"));

// ═══════════════════════════════════════════════════════════════
// 8. GROUND TRUTH & DOCTRINE
// ═══════════════════════════════════════════════════════════════
console.log("--- 8. DOCTRINE ---");

const doctrine = readFileSync(resolve(ROOT, ".data/cortex-doctrine.md"), "utf-8");
check("Ground truth facts section exists", doctrine.includes("GROUND TRUTH FACTS"));
check("Conference not-attended fact", doctrine.includes("did NOT attend"));
check("Voice agent discontinued fact", doctrine.includes("DISCONTINUED"));
check("USA market included", doctrine.includes("United States") && !doctrine.includes("backup only"));
check("Voice Receptionist removed from packages", !doctrine.includes("Voice Receptionist Setup"));

// ═══════════════════════════════════════════════════════════════
// 9. HUNGER & EVOLUTION
// ═══════════════════════════════════════════════════════════════
console.log("--- 9. HUNGER & EVOLUTION ---");

check("Hunger state file exists",
  existsSync(resolve(ROOT, ".data/cortex-hunger-state.json")) ||
  existsSync(resolve(ROOT, ".data/hunger-last-result.json")));

check("Causal reasoning chains dir exists",
  existsSync(resolve(ROOT, ".data/reasoning-chains")));

try {
  const chains = readdirSync(resolve(ROOT, ".data/reasoning-chains")).filter(f => f.endsWith(".json"));
  check("At least one causal chain completed", chains.length > 0, `${chains.length} chains`);
} catch {
  check("Causal chains exist", false);
}

const hungerCode = readFileSync(resolve(ROOT, "scripts/cortex/hunger-engine.mjs"), "utf-8");
check("Hunger engine has MARKET OPPORTUNITY drive", hungerCode.includes("MARKET OPPORTUNITY"));
check("Hunger engine has 4 drives", hungerCode.includes("FOUR DRIVES"));

const evoCode = readFileSync(resolve(ROOT, "scripts/factory/evolution-bot.mjs"), "utf-8");
check("Evolution-bot reads Kirill directives", evoCode.includes("getDirectivesFor"));
check("Evolution-bot lowered threshold", evoCode.includes("hasMediumProblems") || evoCode.includes("hasKirillDirective"));

// ═══════════════════════════════════════════════════════════════
// 10. NEW BOTS
// ═══════════════════════════════════════════════════════════════
console.log("--- 10. NEW CAPABILITIES ---");

check("reply-to-booking-bot.mjs exists",
  existsSync(resolve(ROOT, "scripts/factory/reply-to-booking-bot.mjs")));

check("4 new subreddits in scout-bot",
  scoutCode.includes("AI_Agents") && scoutCode.includes("microsaas"));

// ═══════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════
console.log("\n=== DIAGNOSTIC SUMMARY ===\n");

const total = pass + fail + warn;
console.log(`  PASS: ${pass}/${total}`);
console.log(`  FAIL: ${fail}/${total}`);
console.log(`  WARN: ${warn}/${total}`);
console.log(`  HEALTH: ${Math.round(pass / total * 100)}%`);

if (fail > 0) {
  console.log("\n  FAILURES:");
  results.filter(r => r.status === "FAIL").forEach(r => {
    console.log(`    ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  });
}

if (warn > 0) {
  console.log("\n  WARNINGS:");
  results.filter(r => r.status === "WARN").forEach(r => {
    console.log(`    ! ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  });
}

console.log("\n=== END DIAGNOSTIC ===");
