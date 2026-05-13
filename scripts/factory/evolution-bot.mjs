/**
 * EVOLUTION BOT — Мета-агент самообучения системы
 *
 * Запускается каждые 24ч (3 AM).
 * Читает KPI каждого бота за последние 7 дней.
 * Диагностирует проблемы через GPT.
 * Мутирует стратегии — боты читают evolved стратегию в начале каждого запуска.
 * Калибрует скоринг на основе реальных конверсий.
 * Присылает Кириллу отчёт: что эволюционировало и почему.
 *
 * Это мозг системы. Без него боты — роботы. С ним — они растут.
 */

import {
  getDb, callAI, tgSendToKirill, heartbeat,
  setIntelligence, getIntelligenceKey, reportKPIs,
  MODEL_STRONG, MODEL_MINI, MODEL_NANO, reportError, clearError,
  getDirectivesFor
} from "./orchestrator.mjs";
import { getWikiContext, appendLog, updatePage, readPurpose, readWiki } from "../../wiki/reader.mjs";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath as _ftuPath } from "url";

const __evo_dirname = dirname(_ftuPath(import.meta.url));
const WIKI_DIR = resolve(__evo_dirname, "../../wiki");

const BOT_NAME = "evolution";

async function callAIWithRetry(prompt, context, model, maxAttempts = 3, delayMs = 30000) {
  const BACKOFF = [5000, 10000, 20000];
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) console.log(`[EvolutionBot] STREAM_RETRY attempt=${attempt} ts=${new Date().toISOString()}`);
    try {
      const result = await Promise.race([
        callAI(prompt, context, model),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Stream idle timeout - 30s token silence')), 30000))
      ]);
      // Bug fix (E2E 2026-05-13): callAI sometimes returns objects (with .text/.answer/.content)
      // not strings, causing TypeError "result.includes is not a function" at .includes() call.
      // Coerce to string before string-method invocation.
      const resultStr = typeof result === 'string' ? result :
        (result?.text || result?.answer || result?.content || (result ? JSON.stringify(result) : ""));
      if (resultStr && !resultStr.includes('Stream idle timeout')) return result;
      lastError = new Error(resultStr.includes('Stream idle timeout') ? 'Stream idle timeout' : 'empty response');
    } catch (err) {
      lastError = err;
      console.warn(`[EvolutionBot] callAI attempt ${attempt}/${maxAttempts} failed ts=${new Date().toISOString()}: ${err.message}`);
    }
    if (attempt < maxAttempts) {
      const delay = BACKOFF[attempt - 1] ?? BACKOFF[BACKOFF.length - 1];
      console.log(`[EvolutionBot] Retrying in ${delay / 1000}s... ts=${new Date().toISOString()}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError || new Error("callAI failed after all retries");
}

function top5Metrics(metrics) {
  if (!metrics) return null;
  return {
    runs: metrics.runs,
    avg_leads_found: metrics.avg_leads_found,
    avg_leads_qualified: metrics.avg_leads_qualified,
    total_qualified_7d: metrics.total_qualified_7d,
    avg_errors: metrics.avg_errors
  };
}

// Wiki context for evolution - reads health + lessons to inform analysis
const WIKI_CTX = getWikiContext(["bots/health.md", "strategy/lessons.md", "leads/enrichment-insights.md"]);

// ── Текущий offer stack ──────────────────────────────────────────────────────
const CURRENT_OFFER_STACK = [
  { id: "vibe-audit",       name: "Vibe Code Audit",                price: "$1.5K CAD", icp: "solo founders with broken pipeline or AI-heavy codebase" },
  { id: "first-10",         name: "First 10 Customers Sales Motion", price: "$2.5K CAD", icp: "pre-PMF solo founders, 0-5 paying customers" },
  { id: "ai-workflow",      name: "AI Workflow Design Sprint",       price: "$3K CAD",   icp: "founders drowning in manual ops, want AI automation" },
  { id: "pipeline-build",   name: "Full Pipeline Build",             price: "$5-10K CAD", icp: "funded startups needing end-to-end lead + outreach pipeline" }
];

// ── Какие боты эволюционируют ─────────────────────────────────────────────────
const EVOLVABLE_BOTS = [
  "icp-outreach-bot",     // outreach drafts — scripts/factory/icp-outreach-bot.mjs
  "reddit-monitor",       // lead discovery — scripts/factory/reddit-monitor.mjs
  "fresh-pain-scout",     // lead discovery — scripts/factory/fresh-pain-scout.mjs
  "buying-signal-hunt",   // prospect finding — scripts/factory/buying-signal-hunt.mjs
  "awareness-bot",        // trend detection — scripts/factory/awareness-bot.mjs
  "community-bot",        // community engagement — scripts/factory/community-bot.mjs
  "sales-bot",            // deal progression — scripts/factory/sales-bot.mjs
  "lead-enrichment-bot",  // lead quality — scripts/factory/lead-enrichment-bot.mjs
  "research-bot-v2",      // deep research — scripts/factory/research-bot-v2.mjs
];

// ── 1. СБОР МЕТРИК ────────────────────────────────────────────────────────────

function collectBotMetrics(db, botId) {
  const history = getIntelligenceKey(db, botId, "kpis", "history") || [];
  const last7 = history.filter(h => {
    const ms = new Date(h.date).getTime();
    if (isNaN(ms)) return false;
    return (Date.now() - ms) / 86400000 <= 7;
  });

  if (!last7.length) return null;

  const avg = (key) => {
    const vals = last7.map(h => h[key] || 0).filter(v => v !== undefined);
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : 0;
  };

  return {
    botId,
    runs: last7.length,
    avg_leads_found: parseFloat(avg("leads_found")),
    avg_leads_qualified: parseFloat(avg("leads_qualified")),
    avg_errors: parseFloat(avg("errors")),
    avg_tasks_completed: parseFloat(avg("tasks_completed")),
    total_leads_7d: last7.reduce((s, h) => s + (h.leads_found || 0), 0),
    total_qualified_7d: last7.reduce((s, h) => s + (h.leads_qualified || 0), 0),
    last_run: last7[last7.length - 1]?.date,
    custom: last7[last7.length - 1]?.custom || {}
  };
}

// ── 2. ДИАГНОСТИКА ПРОБЛЕМ ────────────────────────────────────────────────────

function detectProblems(metrics) {
  const problems = [];

  // Нет данных = нормально в первые дни после установки. Не критично.
  if (!metrics) {
    problems.push({ severity: "low", issue: "bot_no_data", description: "KPI ещё не накоплены — бот запустится по расписанию" });
    return problems;
  }

  // Нужно минимум 3 запуска для диагностики
  if (metrics.runs < 3) {
    problems.push({ severity: "low", issue: "insufficient_runs", description: `Только ${metrics.runs} запуска — нужно 3+ для анализа` });
    return problems;
  }

  if (metrics.avg_leads_found === 0) {
    problems.push({ severity: "critical", issue: "zero_leads", description: `${metrics.runs} запусков — 0 лидов найдено. Стратегия поиска не работает.` });
  } else if (metrics.avg_leads_found > 0 && metrics.avg_leads_qualified === 0) {
    problems.push({ severity: "high", issue: "zero_qualified", description: `Находит лидов (avg ${metrics.avg_leads_found}/run) но 0 квалифицируется. Скоринг слишком строгий.` });
  } else if (metrics.avg_leads_qualified > 0 && (metrics.avg_leads_qualified / metrics.avg_leads_found) < 0.05) {
    problems.push({ severity: "medium", issue: "low_qualification_rate", description: `Квалифицируется ${Math.round((metrics.avg_leads_qualified / metrics.avg_leads_found) * 100)}% от найденных.` });
  }

  if (metrics.avg_errors > 2) {
    problems.push({ severity: "high", issue: "frequent_errors", description: `Avg ${metrics.avg_errors} ошибок за запуск.` });
  }

  return problems;
}

// ── 3. ГЕНЕРАЦИЯ EVOLVED СТРАТЕГИИ ───────────────────────────────────────────

async function evolveStrategy(db, botId, metrics, problems, conversions) {
  const currentStrategy = getIntelligenceKey(db, botId, "strategy", "current") || {};
  const currentVersion = currentStrategy.version || 0;

  // Check if Kirill gave directives for this bot - auto-trigger evolution
  const kirillDirectives = getDirectivesFor(botId).filter(d => d.active);
  const hasKirillDirective = kirillDirectives.length > 0;

  // Evolve if: critical/high problems OR medium problems OR Kirill gave directive
  const hasSeriousProblems = problems.filter(p => p.severity === "critical" || p.severity === "high").length > 0;
  const hasMediumProblems = problems.filter(p => p.severity === "medium").length > 0;

  if (!hasSeriousProblems && !hasMediumProblems && !hasKirillDirective && currentVersion > 0) {
    return null; // без изменений
  }

  // When Kirill directive forces evolution but we have no metrics and only
  // "bot_no_data"/"insufficient_runs" problems, the AI prompt gets empty context
  // and returns nothing useful. Ensure there's at least one actionable problem.
  if (hasKirillDirective && problems.every(p => p.issue === "bot_no_data" || p.issue === "insufficient_runs")) {
    // Replace low-severity noise with the directive itself as the problem to solve
    const realProblems = problems.filter(p => p.issue !== "bot_no_data" && p.issue !== "insufficient_runs");
    for (const d of kirillDirectives) {
      realProblems.push({ severity: "high", issue: "owner_directive", description: `Kirill: ${d.what}` });
    }
    problems.length = 0;
    problems.push(...realProblems);
  }

  const winPatterns = conversions.wins?.slice(-10) || [];

  // Read system PURPOSE so the AI knows what we're optimizing for
  const systemPurpose = readPurpose();

  const m = top5Metrics(metrics);
  const diagnosis = await callAIWithRetry(
    `You are an AI system optimizer. A bot in an autonomous lead generation system is underperforming.

Your job: analyze the problems and generate an improved strategy that the bot will use in its next runs.

SYSTEM PURPOSE (what the entire system is trying to achieve):
${systemPurpose || "No PURPOSE.md found - optimize for lead generation and conversion to paid clients."}

CURRENT OFFER STACK (optimize for these active offers only):
${CURRENT_OFFER_STACK.map(o => `- ${o.name} (${o.price}): ${o.icp}`).join("\n")}

Bot: ${botId}
Current strategy version: ${currentVersion}
${currentStrategy.description ? `Current strategy: ${currentStrategy.description}` : "No evolved strategy yet - bot uses default hardcoded logic"}

Problems detected:
${problems.map(p => `[${p.severity.toUpperCase()}] ${p.issue}: ${p.description}`).join("\n")}

Performance metrics (top 5 signals, last 7 days):
- Runs: ${m?.runs || 0}
- Avg leads found per run: ${m?.avg_leads_found || 0}
- Avg leads qualified per run: ${m?.avg_leads_qualified || 0}
- Total qualified leads (7d): ${m?.total_qualified_7d || 0}
- Avg errors per run: ${m?.avg_errors || 0}

Winning lead patterns (what actually converted):
${winPatterns.length ? winPatterns.map(w => `- source: ${w.source}, score: ${w.score}, service: ${w.serviceMatch}`).join("\n") : "No conversions yet"}

OWNER DIRECTIVES (from Kirill - highest priority, must be incorporated):
${kirillDirectives.length ? kirillDirectives.map(d => `- [${d.action.toUpperCase()}] ${d.what} (source: "${d.source_quote || "direct"}")`).join("\n") : "No specific directives from owner"}

Generate an evolved strategy. Return JSON:
{
  "description": "one sentence — what changed and why",
  "scoring_adjustments": {
    "min_score_threshold": number (was 65, adjust based on data),
    "boost_sources": ["sources that showed better conversion"],
    "penalize_sources": ["sources with 0 conversions"],
    "boost_keywords": ["keywords found in winning leads"],
    "penalize_keywords": ["keywords found in rejected leads"]
  },
  "search_adjustments": {
    "add_queries": ["new search query ideas based on winning patterns"],
    "remove_patterns": ["patterns that consistently return irrelevant results"],
    "focus_platforms": ["platforms showing best signal quality"]
  },
  "prompt_patches": {
    "qualification_criteria": "updated criteria for what counts as a qualified lead",
    "red_flags": ["things to immediately disqualify"]
  },
  "expected_improvement": "what metric should improve and by how much"
}
be brief.`,
    `Bot performance analysis for ${botId}`,
    MODEL_STRONG,
    3,
    30000
  );

  let evolved = null;
  try { evolved = JSON.parse(diagnosis?.match(/\{[\s\S]*\}/)?.[0]); } catch {
    if (diagnosis) {
      const lastBrace = diagnosis.lastIndexOf('}');
      if (lastBrace >= 0) try { evolved = JSON.parse(diagnosis.slice(0, lastBrace + 1)); } catch {}
    }
  }
  if (!evolved) return null;

  const newStrategy = {
    version: currentVersion + 1,
    evolvedAt: new Date().toISOString(),
    problems: problems.map(p => p.issue),
    ...evolved
  };

  // DB intelligence: read by scout-bot.mjs and content-bot.mjs on startup.
  // Wiki directives: read by system-brain and all bots that consume wiki/directives.md.
  // Both paths are written to ensure maximum reach.
  setIntelligence(db, botId, "strategy", "current", newStrategy, 100);
  setIntelligence(db, botId, "strategy", `v${newStrategy.version}`, newStrategy, 100); // archive

  console.log(`[EvolutionBot] ✅ ${botId} evolved to v${newStrategy.version}: ${evolved.description}`);
  return newStrategy;
}

// ── 4. КАЛИБРОВКА СКОРИНГА НА ОСНОВЕ КОНВЕРСИЙ ───────────────────────────────

async function calibrateScoring(db, conversions) {
  const events = conversions.events || [];
  if (events.length < 5) return null; // нужно минимум 5 событий

  const wonLeads = events.filter(e => e.toStage === "won" || e.toStage === "replied");
  const deadLeads = events.filter(e => e.toStage === "lost" || e.toStage === "skipped");

  if (!wonLeads.length) return null;

  const calibration = await callAIWithRetry(
    `You are a lead scoring calibrator. Analyze conversion patterns and update scoring weights.

Won/replied leads (${wonLeads.length} total):
${wonLeads.slice(-20).map(l => `- source: ${l.source}, platform: ${l.sourcePlatform}, score_at_entry: ${l.score}, service: ${l.serviceMatch}`).join("\n")}

Lost/skipped leads (${deadLeads.length} total):
${deadLeads.slice(-20).map(l => `- source: ${l.source}, platform: ${l.sourcePlatform}, score_at_entry: ${l.score}`).join("\n")}

Current min score threshold: 65

Based on real conversion data, generate updated scoring calibration.
Return JSON:
{
  "new_min_score": number,
  "source_weights": { "source_name": multiplier_0.5_to_2.0 },
  "platform_weights": { "platform_name": multiplier_0.5_to_2.0 },
  "insight": "one sentence — what pattern explains wins vs losses"
}
be brief.`,
    "Lead scoring calibration based on real conversions",
    MODEL_MINI,
    3,
    30000
  );

  let calibrated = null;
  try { calibrated = JSON.parse(calibration?.match(/\{[\s\S]*\}/)?.[0]); } catch {
    if (calibration) {
      const lastBrace = calibration.lastIndexOf('}');
      if (lastBrace >= 0) try { calibrated = JSON.parse(calibration.slice(0, lastBrace + 1)); } catch {}
    }
  }
  if (!calibrated) return null;

  setIntelligence(db, "evolution", "scoring", "calibration", {
    ...calibrated,
    calibratedAt: new Date().toISOString(),
    basedOnWins: wonLeads.length,
    basedOnLosses: deadLeads.length
  }, 100);

  console.log(`[EvolutionBot] ✅ Scoring calibrated: min_score=${calibrated.new_min_score}, insight: ${calibrated.insight}`);
  return calibrated;
}

// ── 5. ОТЧЁТ КИРИЛЛУ ─────────────────────────────────────────────────────────

async function sendEvolutionReport(db, results) {
  const evolved = results.filter(r => r.evolved);
  // Только реальные проблемы (critical/high) — не "нет данных" и не "мало запусков"
  const problems = results.filter(r =>
    r.problems?.some(p => (p.severity === "critical" || p.severity === "high") && p.issue !== "bot_no_data" && p.issue !== "insufficient_runs")
  );
  const calibration = results.find(r => r.calibration);

  const lines = [`🧬 <b>Evolution Report — система обучилась</b>`, ``];

  if (evolved.length) {
    lines.push(`<b>🔄 Эволюции стратегий (${evolved.length}):</b>`);
    evolved.forEach(r => {
      lines.push(`• <b>${r.botId}</b> → v${r.evolved.version}: ${r.evolved.description}`);
      if (r.evolved.expected_improvement) {
        lines.push(`  <i>Ожидаем: ${r.evolved.expected_improvement}</i>`);
      }
    });
    lines.push(``);
  }

  if (problems.length) {
    lines.push(`<b>🚨 Критичные проблемы (требуют внимания):</b>`);
    problems.forEach(r => {
      const crit = r.problems.filter(p => p.severity === "critical");
      crit.forEach(p => lines.push(`• <b>${r.botId}</b>: ${p.description}`));
    });
    lines.push(``);
  }

  if (calibration?.calibration) {
    lines.push(`<b>🎯 Скоринг откалиброван:</b>`);
    lines.push(`• Новый минимальный порог: ${calibration.calibration.new_min_score}`);
    lines.push(`• <i>${calibration.calibration.insight}</i>`);
    lines.push(``);
  }

  if (!evolved.length && !problems.length) {
    lines.push(`✅ Система работает нормально. Стратегии не менялись.`);
  }

  const accumulating = results.filter(r => r.problems?.some(p => p.issue === "bot_no_data" || p.issue === "insufficient_runs"));
  if (accumulating.length) {
    lines.push(`<b>📊 Накапливают KPI (${accumulating.length}):</b> ${accumulating.map(r => r.botId).join(", ")}`);
    lines.push(`<i>Через 3+ запуска EvolutionBot начнёт их анализировать.</i>`);
  }

  const okBots = results.filter(r => !r.evolved && !r.problems?.some(p => p.severity === "critical" || p.severity === "high"));
  if (okBots.length && !accumulating.find(a => okBots.find(o => o.botId === a.botId))) {
    lines.push(`<b>✅ Стабильны:</b> ${okBots.map(r => r.botId).join(", ")}`);
  }

  await tgSendToKirill(lines.join("\n"));
}

// ── 6. WRITE EVOLUTION DIRECTIVES TO WIKI ────────────────────────────────────

function writeEvolutionDirectivesToWiki(results) {
  const evolved = results.filter(r => r.evolved);
  if (!evolved.length) return;

  const timestamp = new Date().toISOString();
  const lines = [
    `## Evolution Directives (auto-generated by evolution-bot)`,
    `Last updated: ${timestamp}`,
    ``
  ];

  for (const r of evolved) {
    const e = r.evolved;
    const focusParts = [];
    if (e.description) focusParts.push(e.description);
    if (e.search_adjustments?.add_queries?.length) {
      focusParts.push(`Add queries: ${e.search_adjustments.add_queries.join(", ")}`);
    }
    if (e.prompt_patches?.qualification_criteria) {
      focusParts.push(`Qualification: ${e.prompt_patches.qualification_criteria}`);
    }

    const stopParts = [];
    if (e.search_adjustments?.remove_patterns?.length) {
      stopParts.push(e.search_adjustments.remove_patterns.join(", "));
    }
    if (e.prompt_patches?.red_flags?.length) {
      stopParts.push(`Red flags: ${e.prompt_patches.red_flags.join(", ")}`);
    }
    if (e.scoring_adjustments?.penalize_sources?.length) {
      stopParts.push(`Penalize sources: ${e.scoring_adjustments.penalize_sources.join(", ")}`);
    }

    lines.push(`### ${r.botId}`);
    lines.push(`- **FOCUS:** ${focusParts.join(". ") || "See evolved strategy v" + e.version}`);
    lines.push(`- **STOP:** ${stopParts.join(". ") || "No specific stop directives"}`);
    lines.push(``);
  }

  const section = lines.join("\n");

  // Try updatePage first (replaces existing section), fall back to direct append
  const directivesPath = resolve(WIKI_DIR, "directives.md");
  try {
    let content = readWiki("directives.md");
    if (!content) {
      console.log(`[EvolutionBot] wiki/directives.md not found, skipping wiki write`);
      return;
    }

    // Replace existing evolution section if present, otherwise append before ## Related
    const evoHeader = "## Evolution Directives (auto-generated by evolution-bot)";
    const evoIdx = content.indexOf(evoHeader);
    if (evoIdx >= 0) {
      // Find the next ## heading after the evolution section
      const afterEvo = content.indexOf("\n## ", evoIdx + evoHeader.length);
      if (afterEvo >= 0) {
        content = content.slice(0, evoIdx) + section + "\n" + content.slice(afterEvo + 1);
      } else {
        content = content.slice(0, evoIdx) + section;
      }
    } else {
      // Insert before ## Related if it exists, otherwise append
      const relatedIdx = content.indexOf("\n## Related");
      if (relatedIdx >= 0) {
        content = content.slice(0, relatedIdx) + "\n" + section + "\n" + content.slice(relatedIdx);
      } else {
        content += "\n\n" + section;
      }
    }

    writeFileSync(directivesPath, content);
    console.log(`[EvolutionBot] Wrote ${evolved.length} evolution directives to wiki/directives.md`);
    appendLog("evolution", `${evolved.length} bot strategies evolved and written to directives.md`);
  } catch (err) {
    console.error(`[EvolutionBot] Failed to write wiki directives:`, err.message);
  }
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

export async function runEvolutionBot() {
  const db = getDb();
  heartbeat(db, BOT_NAME, "EvolutionBot", "starting");
  console.log("[EvolutionBot] Starting evolution cycle...");

  const conversions = {
    events: getIntelligenceKey(db, "evolution", "conversions", "events") || [],
    wins:   getIntelligenceKey(db, "evolution", "conversions", "wins") || []
  };

  // Калибровка скоринга (если есть данные о конверсиях)
  const calibration = await calibrateScoring(db, conversions);

  const results = [];

  for (const botId of EVOLVABLE_BOTS) {
    console.log(`[EvolutionBot] Analyzing ${botId}...`);

    const metrics = collectBotMetrics(db, botId);
    const problems = detectProblems(metrics);
    const kirillDirectives = getDirectivesFor(botId).filter(d => d.active);
    const hasKirillDirective = kirillDirectives.length > 0;
    const criticalProblems = problems.filter(p => p.severity === "critical" || p.severity === "high");
    const mediumProblems = problems.filter(p => p.severity === "medium");

    let evolved = null;
    if (criticalProblems.length > 0 || mediumProblems.length > 0 || hasKirillDirective) {
      if (hasKirillDirective) {
        console.log(`[EvolutionBot] ${botId}: Kirill directive detected - forcing evolution`);
        // Add Kirill directives as high-severity problems so they enter the prompt
        for (const d of kirillDirectives) {
          problems.push({ severity: "high", issue: "owner_directive", description: `Kirill: ${d.what}` });
        }
      }
      evolved = await evolveStrategy(db, botId, metrics, problems, conversions);
      await new Promise(r => setTimeout(r, 800));
    }

    results.push({ botId, metrics, problems, evolved, calibration: calibration ? { calibration } : null });
  }

  // Write evolved directives to wiki so all bots can read them
  writeEvolutionDirectivesToWiki(results);

  // Отчёт Кириллу
  await sendEvolutionReport(db, results);

  // Сохранить состояние последней эволюции
  setIntelligence(db, BOT_NAME, "meta", "last_run", {
    ranAt: new Date().toISOString(),
    botsAnalyzed: EVOLVABLE_BOTS.length,
    evolved: results.filter(r => r.evolved).map(r => r.botId),
    calibrated: !!calibration
  }, 100);

  const evolvedCount = results.filter(r => r.evolved).length;
  heartbeat(db, BOT_NAME, "EvolutionBot", `done — ${evolvedCount} evolved`, {}, {
    status: evolvedCount > 0 ? "ok" : "degraded",
    last_success_at: new Date().toISOString(),
    error: null
  });
  try { clearError(db, BOT_NAME); } catch {}
  console.log(`[EvolutionBot] Done. Evolved: ${results.filter(r => r.evolved).map(r => r.botId).join(", ") || "none"}`);
  db.close();
}

// ── LIVE MODE (24/7 процесс) ──────────────────────────────────────────────────
async function processMessages() {
  const { getDb, pollMessages, markMessageActedOn } = await import("./orchestrator.mjs");
  const db = getDb();
  try {
    const messages = pollMessages(db, "evolution-bot", 10);
    for (const msg of messages) {
      console.log(`[EvolutionBot] Got ${msg.message_type} from ${msg.from_bot}`);
      // Store signals for next evolution run
      const { setIntelligence } = await import("./orchestrator.mjs");
      setIntelligence(db, "evolution-bot", "incoming_signals", `${msg.message_type}_${Date.now()}`, msg.payload, 70);
      markMessageActedOn(db, msg.id, { stored: true });
    }
  } finally { db.close(); }
}

async function liveMode() {
  console.log(`[EvolutionBot] Starting in LIVE mode (3 AM daily + check messages every 10min)...`);
  let lastFullRun = 0;

  while (true) {
    try {
      const now = new Date();
      const hour = now.getHours();

      if (hour === 3 && Date.now() - lastFullRun > 20 * 60 * 60 * 1000) {
        console.log(`[EvolutionBot] Running evolution cycle...`);
        await runEvolutionBot();
        lastFullRun = Date.now();
      }

      await processMessages();
      await new Promise(r => setTimeout(r, 10 * 60 * 1000));
    } catch (err) {
      console.error(`[EvolutionBot] Error in live mode:`, err.message);
      try { const edb = getDb(); reportError(edb, BOT_NAME, "EvolutionBot", err.message, "crash", "liveMode"); edb.close(); } catch {}
      await new Promise(r => setTimeout(r, 60 * 60 * 1000)); // retry in 1 hour
    }
  }
}

if (process.argv[1] === _ftuPath(import.meta.url)) {
  const isLive = process.argv.includes("live");
  if (isLive) {
    liveMode().catch(err => {
      console.error(`[EvolutionBot] Fatal error:`, err);
      process.exit(1);
    });
  } else {
    runEvolutionBot().catch(console.error);
  }
}
