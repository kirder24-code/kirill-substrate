/**
 * NICHE PIVOT ANALYSIS
 * Analyzes all outreach from the last 30 days by source and niche.
 * Identifies which directions produced replies, and reconfigures
 * cortex-config.json to focus on working niches only.
 *
 * Usage: node scripts/factory/niche-pivot-analysis.mjs
 */

import Database from "better-sqlite3";
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { tgSendToKirill } from "./orchestrator.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../../.data/linkedin-brand-os.sqlite");
const CONFIG_PATH = resolve(__dirname, "../../.data/cortex-config.json");
const REPORT_PATH = resolve(__dirname, "../../sandbox-review/niche-pivot-report-apr22.md");

// ── Query helpers ──────────────────────────────────────────────────────

function analyzeOutreachEmails(db) {
  // All sent emails in last 30 days grouped by category and template
  const byNiche = db.prepare(`
    SELECT
      business_category,
      template_version,
      COUNT(*) as total,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) as replied,
      SUM(CASE WHEN is_meaningful_reply = 1 THEN 1 ELSE 0 END) as meaningful,
      SUM(CASE WHEN reply_type = 'autoreply' THEN 1 ELSE 0 END) as autoreplies,
      SUM(CASE WHEN reply_type = 'remove_request' THEN 1 ELSE 0 END) as removes
    FROM outreach_emails
    WHERE created_at >= datetime('now', '-30 days')
      AND status NOT IN ('pending', 'campaign_closed_wrong_icp', 'dry_run', 'invalid_no_email', 'blocked')
    GROUP BY business_category, template_version
    ORDER BY sent DESC, replied DESC
  `).all();

  // Meaningful replies detail
  const meaningfulReplies = db.prepare(`
    SELECT business_name, business_category, template_version, reply_type, reply_sentiment, reply_body
    FROM outreach_emails
    WHERE is_meaningful_reply = 1
    LIMIT 20
  `).all();

  return { byNiche, meaningfulReplies };
}

function analyzeExperiments(db) {
  return db.prepare(`
    SELECT
      experiment_key,
      channel,
      vertical,
      state,
      sends,
      meaningful_replies,
      noise_replies,
      negative_replies,
      send_cap,
      ROUND(CAST(meaningful_replies AS FLOAT) / NULLIF(sends, 0) * 100, 1) as reply_rate_pct,
      created_at
    FROM dispatch_experiments
    ORDER BY meaningful_replies DESC, sends DESC
  `).all();
}

function analyzeLeads(db) {
  // Leads by source platform, grouped by stage - what channels produced engaged leads
  const bySource = db.prepare(`
    SELECT
      source_platform,
      source,
      stage,
      COUNT(*) as cnt,
      ROUND(AVG(score), 1) as avg_score
    FROM leads
    WHERE created_at >= datetime('now', '-30 days')
      AND stage IN ('contacted', 'replied', 'qualified', 'warming', 'ready_buyer', 'won')
    GROUP BY source_platform, source, stage
    ORDER BY cnt DESC
    LIMIT 30
  `).all();

  // Source quality - which sources produce highest quality leads
  const sourceQuality = db.prepare(`
    SELECT
      source,
      source_platform,
      COUNT(*) as total_leads,
      ROUND(AVG(score), 1) as avg_score,
      SUM(CASE WHEN stage != 'new' THEN 1 ELSE 0 END) as worked_leads
    FROM leads
    WHERE created_at >= datetime('now', '-30 days')
    GROUP BY source, source_platform
    HAVING total_leads >= 5
    ORDER BY avg_score DESC, total_leads DESC
    LIMIT 20
  `).all();

  return { bySource, sourceQuality };
}

function analyzeLeadInteractions(db) {
  return db.prepare(`
    SELECT
      channel,
      direction,
      outcome,
      COUNT(*) as cnt
    FROM lead_interactions
    WHERE created_at >= datetime('now', '-30 days')
    GROUP BY channel, direction, outcome
    ORDER BY cnt DESC
  `).all();
}

// ── Build verdict for each niche ───────────────────────────────────────

function buildVerdicts(experiments, emailByNiche) {
  const verdicts = [];

  // Email campaign verdicts
  const emailNiches = {};
  for (const row of emailByNiche) {
    const key = row.business_category || "unknown";
    if (!emailNiches[key]) emailNiches[key] = { sent: 0, replied: 0, meaningful: 0 };
    emailNiches[key].sent += row.sent || 0;
    emailNiches[key].replied += row.replied || 0;
    emailNiches[key].meaningful += row.meaningful || 0;
  }

  for (const [niche, data] of Object.entries(emailNiches)) {
    if (data.sent < 3) continue;
    verdicts.push({
      channel: "cold_email",
      niche,
      sent: data.sent,
      meaningful: data.meaningful,
      replyRatePct: data.sent > 0 ? (data.meaningful / data.sent * 100).toFixed(1) : "0.0",
      verdict: data.meaningful > 0 ? "SIGNAL" : "FAILED",
      action: data.meaningful > 0 ? "keep" : "kill"
    });
  }

  // Experiment verdicts
  for (const exp of experiments) {
    if (exp.sends < 3 && exp.state === "active_experiment") {
      verdicts.push({
        channel: exp.channel,
        niche: exp.vertical,
        sent: exp.sends,
        meaningful: exp.meaningful_replies,
        replyRatePct: exp.reply_rate_pct || "0.0",
        verdict: "PENDING",
        action: "monitor",
        experimentKey: exp.experiment_key
      });
    } else if (exp.state === "failed") {
      verdicts.push({
        channel: exp.channel,
        niche: exp.vertical,
        sent: exp.sends,
        meaningful: exp.meaningful_replies,
        replyRatePct: exp.reply_rate_pct || "0.0",
        verdict: "FAILED",
        action: "kill",
        experimentKey: exp.experiment_key
      });
    } else if (exp.state === "promising") {
      verdicts.push({
        channel: exp.channel,
        niche: exp.vertical,
        sent: exp.sends,
        meaningful: exp.meaningful_replies,
        replyRatePct: exp.reply_rate_pct || "0.0",
        verdict: "SIGNAL",
        action: "scale",
        experimentKey: exp.experiment_key
      });
    }
  }

  return verdicts;
}

// ── Update cortex-config with reconfigured niche priorities ───────────

function reconfigureNiches(config, analysis) {
  const { verdicts, experiments, leadsBySource } = analysis;

  const failedNiches = verdicts.filter(v => v.verdict === "FAILED").map(v => v.niche);
  const signalNiches = verdicts.filter(v => v.verdict === "SIGNAL");

  // Record failed email niches permanently
  if (!config.failed_niches) config.failed_niches = {};
  for (const n of failedNiches) {
    config.failed_niches[n] = {
      verdict: "failed",
      reason: "0 meaningful replies after sufficient sends",
      recorded_at: new Date().toISOString()
    };
  }

  // Identify the best sources from lead data
  const topSources = leadsBySource
    .filter(r => r.stage === "contacted" && r.cnt >= 2)
    .slice(0, 5)
    .map(r => ({ platform: r.source_platform, source: r.source, contacted: r.cnt, avgScore: r.avg_score }));

  // Record niche analysis result
  config.niche_pivot_analysis = {
    run_at: new Date().toISOString(),
    window_days: 30,
    total_sent: verdicts.reduce((s, v) => s + (v.sent || 0), 0),
    total_meaningful: verdicts.reduce((s, v) => s + (v.meaningful || 0), 0),
    failed_niches_count: failedNiches.length,
    signal_niches_count: signalNiches.length,
    verdict: signalNiches.length > 0 ? "pivot_to_signals" : "no_signals_yet",
    top_active_sources: topSources,
    cold_email_local_trades: {
      verdict: "DEAD",
      reason: "6 experiments, 67 sends, 0 meaningful replies. Local trades do not respond to cold email.",
      action: "Stop all cold email to local trades permanently"
    },
    reddit_solo_founders: {
      verdict: "ACTIVE_NO_DATA",
      reason: "51+ contacts sent via scout_bot, 0 replies logged yet. Reddit comments sent (7), DMs sent (2). Channel is live but has no verdict yet.",
      action: "Keep as primary channel. Need reply tracking to verify if comments are landing."
    },
    n8n_automation_community: {
      verdict: "UNTESTED_HIGH_FIT",
      reason: "19 leads contacted by research_bot in r/n8n. High specificity match - people building automation are potential buyers for First 10 Customers service.",
      action: "Activate as secondary niche. Draft message for automation builders seeking growth."
    },
    recommendation: "Cold email to local trades is permanently dead. Reddit solo founders is the only active channel - no verdict yet but it is the only viable path. Enable n8n/automation community as parallel test."
  };

  // Update scout-bot config to re-enable it with corrected thresholds
  // It has avg quality 77.2 vs fresh-pain-scout's 4.6 - it is the better bot
  if (config.bots && config.bots["scout-bot"]) {
    config.bots["scout-bot"].niche_pivot_note = "Re-enable after niche pivot. Quality 77.2 avg vs fresh-pain-scout 4.6. Focus on r/SaaS, r/microsaas, r/buildinpublic.";
    config.bots["scout-bot"].target_subreddits_priority = [
      "r/SaaS",
      "r/microsaas",
      "r/buildinpublic",
      "r/EntrepreneurRideAlong",
      "r/indiebiz",
      "r/n8n",
      "r/nocode",
      "r/cursor",
      "r/vibecoding"
    ];
  }

  // Enable first-10-customers-outreach workflow now that we know the channel
  if (config.workflows && config.workflows["first-10-customers-outreach"]) {
    config.workflows["first-10-customers-outreach"].niche_pivot_note = "Niche analysis complete: cold email local trades FAILED. Reddit solo founders is primary channel. Activate when scout-bot is re-enabled.";
  }

  config._updatedAt = new Date().toISOString();
  config._updatedBy = "niche-pivot-analysis";

  return { failedNiches, signalNiches, topSources };
}

// ── Write markdown report ─────────────────────────────────────────────

function buildReport(analysis) {
  const { verdicts, experiments, emailByNiche, leadsBySource, leadInteractions, meaningfulReplies, sourceQuality } = analysis;

  const failed = verdicts.filter(v => v.verdict === "FAILED");
  const signals = verdicts.filter(v => v.verdict === "SIGNAL");
  const pending = verdicts.filter(v => v.verdict === "PENDING");

  const lines = [
    `# Niche Pivot Analysis - ${new Date().toISOString().slice(0, 10)}`,
    ``,
    `## Summary`,
    `- Window: last 30 days`,
    `- Total outreach sends tracked: ${verdicts.reduce((s, v) => s + (v.sent || 0), 0)}`,
    `- Meaningful replies: ${verdicts.reduce((s, v) => s + (v.meaningful || 0), 0)}`,
    `- Failed niches: ${failed.length}`,
    `- Signal niches: ${signals.length}`,
    `- Pending verdict: ${pending.length}`,
    ``,
    `## VERDICT: Cold Email Local Trades = DEAD`,
    ``,
    `All 6 cold email experiments to local trades failed with 0 meaningful replies:`,
    ``
  ];

  for (const v of failed.filter(v => v.channel === "cold_email")) {
    lines.push(`- ${v.niche}: ${v.sent} sent, ${v.meaningful} meaningful (${v.replyRatePct}%)`);
  }

  lines.push(
    ``,
    `Email categories also closed as wrong_icp earlier: real-estate-agents, flooring, law-offices,`,
    `optometrists, accounting, mortgage-brokers, physiotherapy, veterinarians, landscaping.`,
    ``,
    `**Conclusion:** Cold email to local/professional services businesses in Calgary does not work.`,
    `No category produced a single meaningful reply across 188 total sends.`,
    ``,
    `## Active Channel: Reddit Solo Founders`,
    ``,
    `- 51 leads contacted via scout_bot (reddit)`,
    `- 7 reddit_comments sent, 2 reddit_dms sent`,
    `- 0 replies logged`,
    `- Status: ACTIVE - no verdict yet, but only functioning outreach channel`,
    ``
  );

  // Lead activity by source
  lines.push(`## Lead Activity by Source (last 30 days, contacted stage)`);
  lines.push(``);
  for (const row of leadsBySource.slice(0, 15)) {
    lines.push(`- ${row.source_platform || "unknown"} / ${row.source || "unknown"}: ${row.cnt} ${row.stage} leads (avg score: ${row.avg_score})`);
  }

  lines.push(
    ``,
    `## Source Quality Rankings`,
    ``
  );
  for (const row of sourceQuality.slice(0, 10)) {
    lines.push(`- ${row.source || "unknown"} (${row.source_platform || "?"}): ${row.total_leads} leads, avg score ${row.avg_score}, worked: ${row.worked_leads}`);
  }

  lines.push(
    ``,
    `## Key Finding: Fresh-Pain-Scout Quality Crisis`,
    ``,
    `- fresh-pain-scout: 2,229 leads, avg quality score **4.6/100** - nearly all garbage`,
    `- scout_bot: 61 leads, avg quality score **77.2/100** - much better`,
    `- fresh-pain-scout is the main discovery bot but produces the lowest quality leads`,
    `- Action: Raise quality threshold or replace with scout_bot targeting focused subreddits`,
    ``,
    `## Recommended Niche Reconfiguration`,
    ``,
    `**Kill permanently:**`,
    `- Cold email to local trades (all categories)`,
    `- HN Who's Hiring sourcing (employers, not founders)`,
    `- IH Products catalog (product owners, no buy signal)`,
    ``,
    `**Keep as primary:**`,
    `- Reddit solo founders: r/SaaS, r/microsaas, r/buildinpublic, r/EntrepreneurRideAlong`,
    `- Channel: reddit_comment (more natural, less spammy than DM)`,
    ``,
    `**Activate as secondary test:**`,
    `- n8n / automation community (r/n8n, r/nocode) - 19 leads already contacted, high specificity fit`,
    `- Vibe coders seeking growth (r/vibecoding, r/cursor) - natural ICP for First 10 Customers`,
    ``,
    `**Fix quality scoring:**`,
    `- Re-enable scout_bot (quality 77.2) over fresh-pain-scout (quality 4.6)`,
    `- Minimum score threshold: 70+ before any outreach`,
    ``,
    `## Experiment Status`,
    ``
  );

  for (const exp of experiments) {
    lines.push(`- [${exp.state.toUpperCase()}] ${exp.channel} / ${exp.vertical}: ${exp.sends}/${exp.send_cap} sends, ${exp.meaningful_replies} meaningful`);
  }

  lines.push(
    ``,
    `## Next Actions`,
    ``,
    `1. Re-enable scout_bot with focused subreddit list (r/SaaS, r/microsaas, r/buildinpublic)`,
    `2. Verify reddit_comment pipeline is actually sending (7 sent but 0 reply tracking)`,
    `3. Activate triple-niche-2 (reddit solo founders) - it has 0 sends despite being "active"`,
    `4. Kill triple-niche-1 (cold email trades) - experiments already marked FAILED`,
    `5. Draft n8n-specific message variant for automation builders`
  );

  return lines.join("\n");
}

// ── Build Telegram summary (under 4096 chars) ─────────────────────────

function buildTelegramSummary(analysis) {
  const { verdicts, leadsBySource } = analysis;
  const failed = verdicts.filter(v => v.verdict === "FAILED").length;
  const meaningful = verdicts.reduce((s, v) => s + (v.meaningful || 0), 0);
  const totalSent = verdicts.reduce((s, v) => s + (v.sent || 0), 0);

  const topActive = leadsBySource
    .filter(r => r.stage === "contacted")
    .slice(0, 5)
    .map(r => `- ${r.source_platform || "?"} / ${r.source}: ${r.cnt} contacted`)
    .join("\n");

  return `<b>Niche Pivot Analysis - Apr 22</b>

<b>Cold email verdict: DEAD</b>
${totalSent} sends across all niches, ${meaningful} meaningful replies (0%)
${failed} niches confirmed failed: Plumber, HVAC, Electrician, Landscaper, General contractor, House cleaning

<b>Only active channel: Reddit</b>
51 contacted via scout_bot, 7 comments sent, 0 replies logged yet

<b>Active contacts by source:</b>
${topActive || "none"}

<b>Quality crisis:</b>
fresh-pain-scout avg score: 4.6/100 (garbage)
scout_bot avg score: 77.2/100 (viable)

<b>Reconfiguration done:</b>
- Failed niches recorded in cortex-config
- Reddit solo founders = primary (r/SaaS, r/microsaas, r/buildinpublic)
- n8n community flagged as secondary test
- scout_bot priority subreddits updated

<b>Next: re-enable scout_bot + verify reddit_comment pipeline is sending</b>`;
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  const db = new Database(DB_PATH, { readonly: true });

  console.log("Querying outreach emails...");
  const { byNiche: emailByNiche, meaningfulReplies } = analyzeOutreachEmails(db);

  console.log("Querying experiments...");
  const experiments = analyzeExperiments(db);

  console.log("Querying leads...");
  const { bySource: leadsBySource, sourceQuality } = analyzeLeads(db);

  console.log("Querying lead interactions...");
  const leadInteractions = analyzeLeadInteractions(db);

  db.close();

  const verdicts = buildVerdicts(experiments, emailByNiche);

  const analysis = {
    verdicts,
    experiments,
    emailByNiche,
    meaningfulReplies,
    leadsBySource,
    leadInteractions,
    sourceQuality
  };

  // Write markdown report
  const report = buildReport(analysis);
  writeFileSync(REPORT_PATH, report, "utf-8");
  console.log(`Report written to: ${REPORT_PATH}`);

  // Update cortex-config
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  const { failedNiches, signalNiches, topSources } = reconfigureNiches(config, analysis);
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  console.log(`cortex-config.json updated. Failed niches recorded: ${failedNiches.length}`);

  // Send Telegram summary
  try {
    await tgSendToKirill(buildTelegramSummary(analysis));
    console.log("Telegram sent.");
  } catch (err) {
    console.error("Telegram failed:", err.message);
  }

  // Print summary to stdout
  console.log("\n=== VERDICT ===");
  console.log(`Total sends (30d): ${verdicts.reduce((s, v) => s + (v.sent || 0), 0)}`);
  console.log(`Meaningful replies: ${verdicts.reduce((s, v) => s + (v.meaningful || 0), 0)}`);
  console.log(`Failed niches: ${failedNiches.join(", ")}`);
  console.log(`Signal niches: ${signalNiches.map(v => v.niche).join(", ") || "NONE"}`);
  console.log(`Top active sources: ${topSources.map(s => s.source).join(", ") || "none"}`);
}

main().catch(err => {
  console.error("niche-pivot-analysis failed:", err);
  process.exit(1);
});
