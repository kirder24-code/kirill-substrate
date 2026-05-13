/**
 * CORTEX FEEDBACK LOOPS — Closed-loop strategy optimization
 *
 * This is what makes CORTEX truly autonomous:
 * Bot outcomes DON'T just go to memory — they update STRATEGY WEIGHTS
 * that change what CORTEX does next cycle.
 *
 * Feedback signals:
 * 1. CHANNEL EFFECTIVENESS - which channels produce leads/replies
 * 2. BOT ROI - which bots produce value per dollar
 * 3. TIME PATTERNS - when do bots perform best
 * 4. LEAD QUALITY - which sources produce real buyers
 * 5. CONTENT RESONANCE - which topics get engagement
 *
 * The strategy weights directly influence:
 * - Which workflows to run (and how often)
 * - Budget allocation across bots
 * - Focus direction percentages
 * - Keywords and targeting parameters
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { remember, recall, setFocus } from "./memory.mjs";
import { updateBotConfig, readConfig, writeConfig } from "./config-injection.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const STRATEGY_PATH = resolve(ROOT, ".data/cortex-strategy.json");

// ── STRATEGY STATE ─────────────────────────────────────────────────────

function loadStrategy() {
  if (!existsSync(STRATEGY_PATH)) return defaultStrategy();
  try {
    return JSON.parse(readFileSync(STRATEGY_PATH, "utf-8"));
  } catch { return defaultStrategy(); }
}

function saveStrategy(strategy) {
  strategy._updatedAt = new Date().toISOString();
  writeFileSync(STRATEGY_PATH, JSON.stringify(strategy, null, 2));
}

function defaultStrategy() {
  return {
    _version: 1,
    _updatedAt: null,

    // Channel weights (0-100, higher = more investment)
    channels: {
      reddit_comments: { weight: 70, leads: 0, replies: 0, conversions: 0, lastUpdated: null },
      reddit_dms: { weight: 10, leads: 0, replies: 0, conversions: 0, lastUpdated: null },
      cold_email: { weight: 10, leads: 0, replies: 0, conversions: 0, lastUpdated: null },
      linkedin: { weight: 40, leads: 0, replies: 0, conversions: 0, lastUpdated: null },
      fiverr: { weight: 50, leads: 0, replies: 0, conversions: 0, lastUpdated: null },
      google_ads: { weight: 50, leads: 0, replies: 0, conversions: 0, lastUpdated: null },
      vapi_outbound: { weight: 30, leads: 0, replies: 0, conversions: 0, lastUpdated: null },
    },

    // Bot ROI scores (updated from KPD data)
    botROI: {},

    // Time patterns: which hours produce best results
    timePatterns: {
      bestHours: [],
      worstHours: [],
      dayOfWeekScores: {},
    },

    // Lead source quality
    sourceQuality: {},

    // Momentum: are things getting better or worse?
    momentum: {
      trend: "flat", // improving, flat, declining
      leadsThisWeek: 0,
      leadsLastWeek: 0,
      repliesThisWeek: 0,
      repliesLastWeek: 0,
    },
  };
}

// ── COLLECT SIGNALS FROM DB ────────────────────────────────────────────

export function collectSignals(db, log = console.log) {
  const signals = {
    channels: {},
    botROI: {},
    sourceQuality: {},
    momentum: {},
  };

  // 1. Channel effectiveness from leads table
  try {
    const channelLeads = db.prepare(`
      SELECT source, COUNT(*) as total,
        SUM(CASE WHEN stage IN ('warming', 'ready_buyer', 'contacted', 'won') THEN 1 ELSE 0 END) as qualified
      FROM leads
      WHERE created_at > datetime('now', '-7 days')
      GROUP BY source
    `).all();

    for (const cl of channelLeads) {
      const channel = mapSourceToChannel(cl.source);
      if (!signals.channels[channel]) signals.channels[channel] = { leads: 0, qualified: 0 };
      signals.channels[channel].leads += cl.total;
      signals.channels[channel].qualified += cl.qualified;
    }
  } catch {}

  // 2. Reply rates from outreach
  try {
    const replyStats = db.prepare(`
      SELECT
        COUNT(*) as sent,
        SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) as replied
      FROM outreach_emails
      WHERE created_at > datetime('now', '-7 days')
    `).get();
    signals.channels.cold_email = {
      ...signals.channels.cold_email,
      sent: replyStats?.sent || 0,
      replied: replyStats?.replied || 0,
      replyRate: replyStats?.sent > 0 ? (replyStats.replied / replyStats.sent * 100).toFixed(1) : 0,
    };
  } catch {}

  // 3. Bot ROI from KPD table
  try {
    const kpd = db.prepare(`
      SELECT bot_name,
        COUNT(*) as runs,
        ROUND(SUM(cost_usd), 2) as cost,
        ROUND(SUM(output_value), 2) as value,
        ROUND(AVG(kpd_score), 2) as avgKPD
      FROM cortex_kpd
      WHERE run_at > datetime('now', '-7 days')
      GROUP BY bot_name
    `).all();

    for (const k of kpd) {
      signals.botROI[k.bot_name] = {
        runs: k.runs,
        cost: k.cost,
        value: k.value,
        avgKPD: k.avgKPD,
        roi: k.cost > 0 ? (k.value / k.cost).toFixed(2) : 0,
      };
    }
  } catch {}

  // 4. Momentum: this week vs last week
  try {
    const thisWeek = db.prepare("SELECT COUNT(*) as cnt FROM leads WHERE created_at > datetime('now', '-7 days')").get()?.cnt || 0;
    const lastWeek = db.prepare("SELECT COUNT(*) as cnt FROM leads WHERE created_at > datetime('now', '-14 days') AND created_at <= datetime('now', '-7 days')").get()?.cnt || 0;
    signals.momentum = {
      leadsThisWeek: thisWeek,
      leadsLastWeek: lastWeek,
      trend: thisWeek > lastWeek * 1.1 ? "improving" : thisWeek < lastWeek * 0.9 ? "declining" : "flat",
      changePercent: lastWeek > 0 ? Math.round((thisWeek - lastWeek) / lastWeek * 100) : 0,
    };
  } catch {}

  // 5. Source quality (which lead sources produce ready_buyers)
  try {
    const sources = db.prepare(`
      SELECT source,
        COUNT(*) as total,
        SUM(CASE WHEN stage = 'ready_buyer' THEN 1 ELSE 0 END) as buyers,
        ROUND(AVG(score), 1) as avgScore
      FROM leads
      WHERE created_at > datetime('now', '-14 days')
      GROUP BY source
      HAVING total >= 3
      ORDER BY buyers DESC
    `).all();

    for (const s of sources) {
      signals.sourceQuality[s.source] = {
        total: s.total,
        buyers: s.buyers,
        buyerRate: (s.buyers / s.total * 100).toFixed(1),
        avgScore: s.avgScore,
      };
    }
  } catch {}

  log(`[FEEDBACK] Signals collected: ${Object.keys(signals.channels).length} channels, ${Object.keys(signals.botROI).length} bots, momentum=${signals.momentum.trend}`);
  return signals;
}

// ── UPDATE STRATEGY WEIGHTS ────────────────────────────────────────────

export function updateStrategy(db, signals, log = console.log) {
  const strategy = loadStrategy();
  const now = new Date().toISOString();

  // 1. Update channel weights based on results
  for (const [channel, data] of Object.entries(signals.channels)) {
    if (!strategy.channels[channel]) {
      strategy.channels[channel] = { weight: 30, leads: 0, replies: 0, conversions: 0, lastUpdated: null };
    }
    const ch = strategy.channels[channel];
    ch.leads += data.leads || 0;
    ch.qualified = (ch.qualified || 0) + (data.qualified || 0);
    ch.lastUpdated = now;

    // Adjust weight: channels with qualified leads get boosted
    if (data.qualified > 0) {
      ch.weight = Math.min(100, ch.weight + 10);
      log(`[FEEDBACK] Channel ${channel} BOOSTED to ${ch.weight} (${data.qualified} qualified leads)`);
    } else if (data.leads > 5 && data.qualified === 0) {
      ch.weight = Math.max(5, ch.weight - 5);
      log(`[FEEDBACK] Channel ${channel} REDUCED to ${ch.weight} (${data.leads} leads, 0 qualified)`);
    }
  }

  // 2. Update bot ROI scores
  for (const [bot, roi] of Object.entries(signals.botROI)) {
    strategy.botROI[bot] = { ...roi, updatedAt: now };
  }

  // 3. Update momentum
  strategy.momentum = { ...signals.momentum, updatedAt: now };

  // 4. Update source quality
  for (const [source, quality] of Object.entries(signals.sourceQuality)) {
    strategy.sourceQuality[source] = { ...quality, updatedAt: now };
  }

  saveStrategy(strategy);
  log(`[FEEDBACK] Strategy updated. Momentum: ${strategy.momentum.trend}`);
  return strategy;
}

// ── APPLY STRATEGY TO SYSTEM CONFIG ────────────────────────────────────

export function applyStrategyToConfig(db, strategy, log = console.log) {
  const actions = [];

  // 1. Adjust focus based on momentum
  if (strategy.momentum.trend === "declining") {
    // Things are getting worse - increase outreach
    log("[FEEDBACK] Momentum declining - boosting outreach");
    actions.push("boost_outreach");
  }

  // 2. Adjust workflow frequency based on channel weights
  const config = readConfig();
  const topChannel = Object.entries(strategy.channels)
    .sort(([, a], [, b]) => b.weight - a.weight)[0];

  if (topChannel) {
    log(`[FEEDBACK] Top channel: ${topChannel[0]} (weight ${topChannel[1].weight})`);
  }

  // 3. Disable workflows for dead channels
  for (const [channel, data] of Object.entries(strategy.channels)) {
    if (data.weight <= 10 && data.leads > 20) {
      log(`[FEEDBACK] Channel ${channel} is dead (weight ${data.weight}, ${data.leads} leads with 0 quality)`);
      remember(db, "procedural",
        `Channel ${channel} is ineffective: ${data.leads} leads total but weight dropped to ${data.weight}. Consider replacing.`,
        "feedback-loop", "cortex", 0.8);
    }
  }

  // 4. Write best bot rankings to memory for brain context
  const topBots = Object.entries(strategy.botROI)
    .filter(([, r]) => r.runs >= 2)
    .sort(([, a], [, b]) => (b.avgKPD || 0) - (a.avgKPD || 0))
    .slice(0, 5);

  if (topBots.length > 0) {
    const ranking = topBots.map(([name, r]) => `${name}: KPD=${r.avgKPD}, ROI=${r.roi}`).join(", ");
    log(`[FEEDBACK] Top bots by ROI: ${ranking}`);
  }

  writeConfig(config);
  return actions;
}

// ── FULL FEEDBACK LOOP CYCLE ───────────────────────────────────────────

export function runFeedbackLoop(db, log = console.log) {
  log("[FEEDBACK] === FEEDBACK LOOP CYCLE ===");

  // 1. Collect signals from all data sources
  const signals = collectSignals(db, log);

  // 2. Update strategy weights
  const strategy = updateStrategy(db, signals, log);

  // 3. Apply strategy changes to config
  const actions = applyStrategyToConfig(db, strategy, log);

  // 4. Summary
  const summary = {
    channelsTracked: Object.keys(strategy.channels).length,
    botsTracked: Object.keys(strategy.botROI).length,
    momentum: strategy.momentum.trend,
    topChannel: Object.entries(strategy.channels)
      .sort(([, a], [, b]) => b.weight - a.weight)[0]?.[0] || "none",
    actionsApplied: actions.length,
  };

  log(`[FEEDBACK] Summary: ${JSON.stringify(summary)}`);
  log("[FEEDBACK] === FEEDBACK LOOP DONE ===");

  return summary;
}

// ── GET STRATEGY FOR BRAIN CONTEXT ─────────────────────────────────────

export function getStrategyContext() {
  const strategy = loadStrategy();

  const channelRanking = Object.entries(strategy.channels)
    .sort(([, a], [, b]) => b.weight - a.weight)
    .map(([name, data]) => `${name}: weight=${data.weight}`)
    .join(", ");

  const botRanking = Object.entries(strategy.botROI)
    .sort(([, a], [, b]) => (b.avgKPD || 0) - (a.avgKPD || 0))
    .slice(0, 5)
    .map(([name, data]) => `${name}: KPD=${data.avgKPD}`)
    .join(", ");

  return {
    channelRanking,
    botRanking,
    momentum: strategy.momentum.trend || "unknown",
    momentumChange: strategy.momentum.changePercent || 0,
  };
}

// ── HELPERS ─────────────────────────────────────────────────────────────

function mapSourceToChannel(source) {
  if (!source) return "unknown";
  const s = source.toLowerCase();
  if (s.includes("reddit") || s.includes("fresh-pain")) return "reddit_comments";
  if (s.includes("apify-linkedin") || s.includes("linkedin")) return "linkedin";
  if (s.includes("email") || s.includes("outreach")) return "cold_email";
  if (s.includes("fiverr")) return "fiverr";
  if (s.includes("google") || s.includes("ads")) return "google_ads";
  if (s.includes("hn") || s.includes("hacker")) return "hackernews";
  if (s.includes("vapi") || s.includes("voice")) return "vapi_outbound";
  return "other";
}
