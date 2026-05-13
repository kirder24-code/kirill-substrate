/**
 * BRIEF AGENT v3 — Daily Control Center
 *
 * NOT a dashboard. NOT a summary. This is the OPERATING LAYER.
 *
 * 5 mandatory blocks:
 *   A. Previous Work Report — what happened since yesterday
 *   B. Active Projects Status — where each project stands
 *   C. Today Priority Plan — 3-5 tasks with why_today
 *   D. One Market Opportunity — best opportunity with full execution package
 *   E. Content Decision — publish today or not, what, why
 *
 * Schedule: 9 AM Calgary daily
 */
import { getDb, callAI, tgSendToKirill, heartbeat, setIntelligence, getIntelligenceKey, getActiveGoal,
         getPortfolio, canPublishToday, CONSTRAINTS, getSystemMission, MODEL_STRONG, reportError, clearError } from "./orchestrator.mjs";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { dirname, resolve } from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { readPurpose, getWikiContext, appendLog } from "../../wiki/reader.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const NODE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/node";
const BOT_NAME = "brief-agent";

function daysLeft() {
  const deadline = new Date("2026-06-01T23:59:00-06:00");
  return Math.max(0, Math.ceil((deadline - new Date()) / (1000 * 60 * 60 * 24)));
}

// ═══════════════════════════════════════════════════════════════════════
// DATA GATHERING — everything the brief needs to know
// ═══════════════════════════════════════════════════════════════════════

function gatherSystemState(db) {
  const state = {};

  // Goal & time
  const goal = getActiveGoal(db);
  state.daysLeft = daysLeft();
  state.revenue = goal?.current_amount || 0;
  state.target = goal?.target_amount || 1500;

  // Portfolio (new project system)
  state.portfolio = getPortfolio(db);

  // Opportunities
  state.readyOpportunities = db.prepare(`SELECT * FROM opportunities WHERE decision = 'ready_to_promote' ORDER BY priority_score DESC LIMIT 3`).all();
  state.queuedOpportunities = db.prepare(`SELECT COUNT(*) as c FROM opportunities WHERE decision IN ('queued', 'deferred')`).get()?.c || 0;

  // Yesterday's outcomes
  state.yesterdayLeads = db.prepare(`SELECT COUNT(*) as c FROM leads WHERE created_at > datetime('now', '-24 hours')`).get()?.c || 0;
  state.yesterdayContacted = db.prepare(`SELECT COUNT(*) as c FROM outreach_emails WHERE sent_at > datetime('now', '-24 hours') AND status = 'sent'`).get()?.c || 0;
  state.emailReplies = db.prepare(`SELECT business_name, reply_body FROM outreach_emails WHERE reply_received_at > datetime('now', '-48 hours') AND reply_body IS NOT NULL`).all();
  state.redditReplies = db.prepare(`SELECT key, value_json FROM bot_intelligence WHERE bot_id = 'reddit' AND insight_type = 'reply_context' AND updated_at > datetime('now', '-24 hours')`).all();

  // Pipeline
  state.leadsNew = db.prepare(`SELECT COUNT(*) as c FROM leads WHERE stage IN ('new','briefed')`).get()?.c || 0;
  state.leadsContacted = db.prepare(`SELECT COUNT(*) as c FROM leads WHERE stage = 'contacted'`).get()?.c || 0;
  state.preparedMessages = db.prepare(`SELECT COUNT(*) as c FROM outreach_emails WHERE status LIKE 'ready_%' AND lead_id IS NOT NULL`).get()?.c || 0;

  // Content
  state.canPublish = canPublishToday(db);
  state.lastPublished = db.prepare(`SELECT published_at, topic FROM content_calendar WHERE status = 'published' ORDER BY published_at DESC LIMIT 1`).get();
  state.contentIdeas = db.prepare(`SELECT COUNT(*) as c FROM bot_intelligence WHERE bot_id = 'content-bot' AND insight_type = 'content_ideas'`).get()?.c || 0;

  // Unfinished work
  state.overdueFollowups = db.prepare(`SELECT name, next_followup_at FROM leads WHERE stage = 'contacted' AND next_followup_at <= datetime('now') AND follow_up_count < 3 LIMIT 5`).all();

  // Community
  state.communityQueue = db.prepare(`SELECT COUNT(*) as c FROM bot_intelligence WHERE bot_id = 'community-bot' AND insight_type = 'queued_answers'`).get()?.c || 0;
  const communityPaused = getIntelligenceKey(db, "community-bot", "settings", "paused");
  state.communityPaused = !!communityPaused;

  return state;
}

// ═══════════════════════════════════════════════════════════════════════
// BRIEF GENERATION — 5 blocks via structured AI call
// ═══════════════════════════════════════════════════════════════════════

function pollDecisionInbox() {
  const inboxPath = resolve(__dirname, "../../.data/decision-inbox.md");
  const modelPath = resolve(__dirname, "../../.data/operator-model.json");
  if (!existsSync(inboxPath)) return [];

  const text = readFileSync(inboxPath, "utf8");
  const cardPattern = /## CARD (\d+) — ([^\n]+)\n[\s\S]*?\*\*Your answer:\*\*\s*\n<!-- Fill here[^\n]*-->\s*\n([^\n-][^\n]*)/g;
  const answered = [];
  let match;

  while ((match = cardPattern.exec(text)) !== null) {
    const [, num, title, answer] = match;
    const trimmed = answer.trim();
    if (trimmed && !trimmed.startsWith("<!--")) {
      answered.push({ card: parseInt(num, 10), title: title.trim(), answer: trimmed });
    }
  }

  if (answered.length === 0) return [];

  const model = existsSync(modelPath)
    ? JSON.parse(readFileSync(modelPath, "utf8"))
    : { updated_at: null, decisions: {} };

  for (const item of answered) {
    model.decisions[`card_${item.card}`] = { title: item.title, answer: item.answer, recorded_at: new Date().toISOString() };
  }
  model.updated_at = new Date().toISOString();

  writeFileSync(modelPath, JSON.stringify(model, null, 2));
  console.log(`[BriefAgent] operator-model.json updated with ${answered.length} decision(s) from inbox`);
  return answered;
}

export async function runBriefAgent() {
  const db = getDb();
  heartbeat(db, BOT_NAME, "Brief Agent", "generating daily control center");
  console.log("[BriefAgent] Generating daily control center...");

  const newDecisions = pollDecisionInbox();
  if (newDecisions.length > 0) {
    const lines = newDecisions.map(d => `- Card ${d.card} (${d.title}): ${d.answer.slice(0, 80)}`).join("\n");
    await tgSendToKirill(`<b>Operator model updated (${newDecisions.length} new decision${newDecisions.length > 1 ? "s" : ""}):</b>\n${lines}`);
    await new Promise(r => setTimeout(r, 300));
  }

  const state = gatherSystemState(db);
  const mission = getSystemMission();
  let purpose = "";
  try { purpose = readPurpose().slice(0, 400); } catch {}

  // Format portfolio for AI
  const activeProjects = state.portfolio.active.map(p => `"${p.name}" (stage: ${p.current_stage}, next: ${p.next_step || "?"}, market: ${p.linked_market || "?"})`).join("\n") || "No active projects";
  const queuedProjects = state.portfolio.queued.map(p => `"${p.name}"`).join(", ") || "none";

  // Format best opportunity
  const bestOpp = state.readyOpportunities[0];
  const oppText = bestOpp
    ? `"${bestOpp.title}" (${bestOpp.priority_score}/100) — Market: ${bestOpp.market}, Pain: ${bestOpp.pain}, ICP: ${bestOpp.icp}, Entry: ${bestOpp.entry_path}`
    : "No qualified opportunities right now";

  // Format yesterday's replies
  const repliesText = [
    ...state.emailReplies.map(r => `Email reply from ${r.business_name}: ${(r.reply_body || "").slice(0, 100)}`),
    ...state.redditReplies.map(r => { try { const v = JSON.parse(r.value_json); return `Reddit reply from ${v.author} in r/${v.subreddit}: ${(v.body || "").slice(0, 80)}`; } catch { return ""; } }).filter(Boolean),
  ].join("\n") || "No replies yesterday";

  const overdueText = state.overdueFollowups.map(l => `${l.name} (due: ${l.next_followup_at})`).join(", ") || "none";

  const brief = await callAI(
    `Be brief.
${mission}
${purpose ? `\nSYSTEM PURPOSE: ${purpose}\n` : ""}
You are the Daily Control Center. Generate Kirill's morning brief with EXACTLY 5 blocks.
Write in Russian. Be specific, not generic. Every task must have WHY TODAY.

CONSTRAINTS:
- Max ${CONSTRAINTS.MAX_ACTIVE_PROJECTS} active projects (current: ${state.portfolio.active.length})
- Content: ${state.canPublish ? "CAN publish today" : "CANNOT publish (posted in last 2 days)"}
- n8n Community: ${state.communityPaused ? "ON HOLD (account paused)" : "active"} (${state.communityQueue} answers queued)
- Max 1 new opportunity per day

Return JSON with EXACTLY these 5 blocks:
{
  "A_previous_work": {
    "replies_received": "what replies came in (email, Reddit, LinkedIn) — be specific",
    "actions_taken": "what system did overnight (leads found, messages sent, etc)",
    "what_worked": "which yesterday's actions showed results",
    "what_didnt": "what got no response or failed"
  },
  "B_active_projects": [
    {"name": "project name", "stage": "current stage", "done": "what's completed", "not_done": "what's unfinished", "blocker": "what's blocking", "next": "next step"}
  ],
  "C_today_plan": [
    {"priority": 1, "task": "specific action", "project": "which project this serves", "why_today": "why not tomorrow", "where": "exact platform/URL", "time": "30 min", "done_when": "what counts as completed"}
  ],
  "D_opportunity": {
    "show": true/false,
    "title": "opportunity name",
    "why_hot": "why this market is hot NOW — specific signals",
    "why_good_for_kirill": "why his skills match",
    "entry_plan": "exactly what to do in 4-5 hours to enter this market",
    "platforms": ["specific platforms: Facebook groups, forums, job boards, communities"],
    "first_message": "exact text to post/send",
    "expected_outcome": "what success looks like"
  },
  "E_content_decision": {
    "publish_today": true/false,
    "reason": "why or why not",
    "topic": "if yes — what topic and why",
    "platform": "where to publish",
    "linked_project": "which project this serves"
  },
  "F_system_needs": {
    "items": [
      {"need": "what system needs to do next to get closer to revenue (max 3 items)", "why_blocks_revenue": "how this directly prevents closing a deal", "request_type": "auto_execute|capability_fix|strategic_decision", "assigned_bot": "which bot should handle this"}
    ]
  }
}
be brief.`,
    `SYSTEM STATE:
Days left: ${state.daysLeft} | Revenue: $${state.revenue}/$${state.target}
Pipeline: ${state.leadsNew} new, ${state.leadsContacted} contacted, ${state.preparedMessages} messages ready
Overdue follow-ups: ${overdueText}

ACTIVE PROJECTS:
${activeProjects}
Queued: ${queuedProjects}

YESTERDAY'S REPLIES:
${repliesText}

YESTERDAY'S ACTIVITY:
- New leads found: ${state.yesterdayLeads}
- Messages sent: ${state.yesterdayContacted}

BEST OPPORTUNITY:
${oppText}
Queued opportunities: ${state.queuedOpportunities}

CONTENT:
- Can publish today: ${state.canPublish}
- Last published: ${state.lastPublished?.published_at || "never"}
- Content ideas available: ${state.contentIdeas}

ACTIVE HYPOTHESES:
${(() => { try { return db.prepare("SELECT hypothesis, cheapest_test, priority_score, category FROM hypotheses WHERE status = 'active' ORDER BY priority_score DESC LIMIT 3").all().map(h => `[${h.category}/${h.priority_score}] ${h.hypothesis} → Test: ${h.cheapest_test}`).join("\n") || "None"; } catch { return "None"; } })()}

RECENT BEHAVIOR CHANGES:
${(() => { try { return db.prepare("SELECT parameter_changed, before_value, after_value, reason FROM behavior_changes ORDER BY created_at DESC LIMIT 3").all().map(c => `Changed ${c.parameter_changed}: ${c.before_value} → ${c.after_value} (${c.reason})`).join("\n") || "None"; } catch { return "None"; } })()}

EXECUTION EVIDENCE (7d):
${(() => { try { const total = db.prepare("SELECT COUNT(*) as c FROM execution_evidence WHERE created_at > datetime('now', '-7 days')").get()?.c || 0; const withResponse = db.prepare("SELECT COUNT(*) as c FROM execution_evidence WHERE response_received = 1 AND created_at > datetime('now', '-7 days')").get()?.c || 0; return `${total} actions recorded, ${withResponse} got responses`; } catch { return "No evidence yet"; } })()}`,
    MODEL_STRONG
  ).catch(e => { console.error("[BriefAgent] AI error:", e.message); return null; });

  if (!brief) {
    await tgSendToKirill(`⚠️ BriefAgent не смог сгенерировать план. Проверь логи.`);
    db.close();
    return;
  }

  // ═══ SEND 5 BLOCKS AS SEPARATE MESSAGES ═══
  const dateStr = new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Edmonton" });

  // BLOCK A — Previous Work Report
  const blockA = brief.A_previous_work || {};
  const textA = [
    `📋 <b>КОНТРОЛЬНЫЙ ЦЕНТР — ${dateStr}</b>`,
    `<b>$${state.revenue} / $${state.target} CAD | ⏳ ${state.daysLeft} дней</b>`,
    ``,
    `<b>A. ЧТО ПРОИЗОШЛО:</b>`,
    blockA.replies_received ? `💬 ${blockA.replies_received}` : "💬 Ответов не было",
    blockA.actions_taken ? `⚙️ ${blockA.actions_taken}` : "",
    blockA.what_worked ? `✅ ${blockA.what_worked}` : "",
    blockA.what_didnt ? `❌ ${blockA.what_didnt}` : "",
  ].filter(Boolean).join("\n").slice(0, 1500);

  await tgSendToKirill(textA);
  await new Promise(r => setTimeout(r, 300));

  // BLOCK B — Active Projects
  const projectsB = brief.B_active_projects || [];
  if (projectsB.length > 0 || state.portfolio.active.length > 0) {
    const textB = [
      `<b>B. АКТИВНЫЕ ПРОЕКТЫ (${state.portfolio.active.length}/${CONSTRAINTS.MAX_ACTIVE_PROJECTS}):</b>`,
      ...projectsB.slice(0, 3).map(p =>
        `\n📁 <b>${p.name}</b>\n   Этап: ${p.stage}\n   ✅ ${p.done || "—"}\n   ⏳ ${p.not_done || "—"}\n   ${p.blocker ? "🚧 " + p.blocker : ""}\n   ➡️ ${p.next || "—"}`
      ),
      state.portfolio.queued.length > 0 ? `\n📦 В очереди: ${state.portfolio.queued.map(p => p.name).join(", ")}` : "",
    ].filter(Boolean).join("\n").slice(0, 1500);
    await tgSendToKirill(textB);
    await new Promise(r => setTimeout(r, 300));
  }

  // BLOCK C — Today's Plan — each task as actionable card
  const tasksC = brief.C_today_plan || [];
  if (tasksC.length > 0) {
    for (const t of tasksC.slice(0, 5)) {
      const taskText = [
        `<b>${t.priority}. ${(t.task || "").slice(0, 100)}</b>`,
        `📁 ${t.project || "—"} | ⏱ ${t.time || "?"}`,
        `💡 ${(t.why_today || "").slice(0, 80)}`,
        `📍 ${(t.where || "").slice(0, 80)}`,
        `✅ ${(t.done_when || "").slice(0, 60)}`,
      ].join("\n");

      // Find matching project for "Start" button
      const matchProject = state.portfolio.active.find(p =>
        t.project && p.name.toLowerCase().includes(t.project.toLowerCase().slice(0, 15))
      );

      const buttons = [];
      if (matchProject) {
        buttons.push([{ text: "▶️ Начать", callback_data: `resume_project:${matchProject.id}` }]);
      }

      await tgSendToKirill(taskText, buttons.length > 0 ? { reply_markup: { inline_keyboard: buttons }} : undefined);
      await new Promise(r => setTimeout(r, 200));
    }
  }

  // BLOCK D — One Market Opportunity
  const oppD = brief.D_opportunity || {};
  if (oppD.show && bestOpp) {
    const textD = [
      `<b>D. РЫНОЧНАЯ ВОЗМОЖНОСТЬ:</b>`,
      ``,
      `🎯 <b>${oppD.title || bestOpp.title}</b>`,
      `🔥 <b>Почему горячо:</b> ${(oppD.why_hot || "").slice(0, 200)}`,
      `💪 <b>Почему подходит:</b> ${(oppD.why_good_for_kirill || "").slice(0, 150)}`,
      ``,
      `<b>План входа (4-5 часов):</b>`,
      (oppD.entry_plan || "").slice(0, 300),
      ``,
      `<b>Платформы:</b>`,
      ...(oppD.platforms || []).slice(0, 5).map(p => `• ${p}`),
      oppD.first_message ? `\n<b>Первое сообщение:</b>\n<code>${oppD.first_message.slice(0, 300)}</code>` : "",
    ].filter(Boolean).join("\n").slice(0, 2500);

    await tgSendToKirill(textD, { reply_markup: { inline_keyboard: [
      [{ text: "🚀 Беру в работу", callback_data: `promote_opp:${bestOpp.id}` }],
      [{ text: "⏸ Не сегодня", callback_data: `defer_opp:${bestOpp.id}` }],
    ]}});
    await new Promise(r => setTimeout(r, 300));
  }

  // BLOCK E — Content Decision
  const contentE = brief.E_content_decision || {};
  const textE = [
    `<b>E. КОНТЕНТ:</b>`,
    contentE.publish_today
      ? `✅ Публикуем сегодня: "${contentE.topic || "?"}" → ${contentE.platform || "LinkedIn"}\n   📁 Проект: ${contentE.linked_project || "—"}\n   💡 ${contentE.reason || ""}`
      : `⏸ Сегодня не публикуем. ${contentE.reason || ""}`,
  ].join("\n").slice(0, 800);

  await tgSendToKirill(textE);
  await new Promise(r => setTimeout(r, 300));

  // BLOCK F — System auto-executes instead of asking Kirill
  const needsF = brief.F_system_needs?.items || [];
  const autoExecuted = [];
  for (const need of needsF.slice(0, 3)) {
    const n = (need.need || "").toLowerCase();
    const type = need.request_type || "";

    // data_from_kirill → system finds data itself
    if (type === "data_from_kirill") {
      if (n.includes("calgary") || n.includes("trades") || n.includes("companies") || n.includes("email")) {
        try { execSync(`nohup ${NODE_BIN} ${ROOT}/scripts/factory/calgary-email-outreach.mjs >> /tmp/lbo-calgary-email-outreach.log 2>&1 &`, { timeout: 5000 }); } catch {}
        autoExecuted.push(`🤖 "${need.need}" → calgary-email-outreach запущен`);
      } else if (n.includes("lead") || n.includes("prospect")) {
        try { execSync(`nohup ${NODE_BIN} ${ROOT}/scripts/factory/lead-enrichment-bot.mjs --batch >> /tmp/lbo-lead-enrichment-bot.log 2>&1 &`, { timeout: 5000 }); } catch {}
        autoExecuted.push(`🤖 "${need.need}" → lead-enrichment-bot запущен`);
      } else {
        try { execSync(`nohup ${NODE_BIN} ${ROOT}/scripts/factory/research-bot-v2.mjs --batch >> /tmp/lbo-research-bot-v2.log 2>&1 &`, { timeout: 5000 }); } catch {}
        autoExecuted.push(`🤖 "${need.need}" → research-bot-v2 запущен`);
      }
    }

    // strategic_decision → system decides based on wiki
    if (type === "strategic_decision") {
      if (n.includes("offer") || n.includes("price") || n.includes("format")) {
        autoExecuted.push(`🤖 "${need.need}" → решено: офферы зафиксированы в wiki/PURPOSE.md. Reply Chaser $1,500, Vibe-Code Audit $1,500-2,500, First 10 $2,000`);
      } else {
        autoExecuted.push(`🤖 "${need.need}" → передано в system-brain для решения на следующем цикле`);
      }
    }

    // capability_fix → system builds it
    if (type === "capability_fix") {
      if (n.includes("follow-up") || n.includes("template") || n.includes("шаблон")) {
        try { execSync(`nohup ${NODE_BIN} ${ROOT}/scripts/factory/sales-bot.mjs >> /tmp/lbo-sales-bot.log 2>&1 &`, { timeout: 5000 }); } catch {}
        autoExecuted.push(`🤖 "${need.need}" → sales-bot запущен для создания`);
      } else {
        try { execSync(`nohup ${NODE_BIN} ${ROOT}/scripts/factory/build-bot.mjs >> /tmp/lbo-build-bot.log 2>&1 &`, { timeout: 5000 }); } catch {}
        autoExecuted.push(`🤖 "${need.need}" → build-bot запущен`);
      }
    }
  }

  if (autoExecuted.length > 0) {
    await tgSendToKirill([
      `<b>F. СИСТЕМА РЕШАЕТ САМА:</b>`,
      ...autoExecuted,
    ].join("\n").slice(0, 1200), { reply_markup: { inline_keyboard: [
      [{ text: "🤖 Меню", callback_data: "menu" }],
    ]}});
  } else {
    await tgSendToKirill(`<b>F.</b> Система работает автономно. Вопросов нет.`, { reply_markup: { inline_keyboard: [
      [{ text: "🤖 Меню", callback_data: "menu" }],
    ]}});
  }

  // Save brief state
  setIntelligence(db, BOT_NAME, "activity", "last_brief_at", new Date().toISOString(), 100);
  setIntelligence(db, BOT_NAME, "activity", "last_brief_data", {
    date: new Date().toISOString(),
    activeProjects: state.portfolio.active.length,
    opportunities: state.readyOpportunities.length,
    plan: tasksC.slice(0, 5),
  }, 80);

  heartbeat(db, BOT_NAME, "Brief Agent", "daily control center sent", {}, {
    status: "ok",
    last_success_at: new Date().toISOString(),
    error: null
  });

  try { clearError(db, BOT_NAME); } catch {}

  db.close();
  console.log("[BriefAgent] Daily control center sent (5 blocks).");
}

// ── LIVE MODE ────────────────────────────────────────────────────────────
async function liveMode() {
  console.log(`[BriefAgent] Starting in LIVE mode (9 AM Calgary daily)...`);

  while (true) {
    try {
      const now = new Date();
      const hourCalgary = parseInt(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Edmonton", hour: "2-digit", hour12: false }).format(now), 10);

      if (hourCalgary === 9 && now.getUTCMinutes() < 5) {
        console.log(`[BriefAgent] Running daily control center...`);
        await runBriefAgent();
        await new Promise(r => setTimeout(r, 23 * 60 * 60 * 1000));
      } else {
        await new Promise(r => setTimeout(r, 60 * 60 * 1000));
      }
    } catch (err) {
      console.error(`[BriefAgent] Error:`, err.message);
      try { const edb = getDb(); heartbeat(edb, BOT_NAME, "Brief Agent", "error", {}, { status: "error", last_success_at: null, error: err.message }); reportError(edb, BOT_NAME, "BriefAgent", err.message, "crash", "liveMode"); edb.close(); } catch {}
      await new Promise(r => setTimeout(r, 60 * 60 * 1000));
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const isLive = process.argv.includes("live");
  if (isLive) {
    liveMode().catch(err => { console.error(`[BriefAgent] Fatal:`, err); process.exit(1); });
  } else {
    runBriefAgent().catch(console.error);
  }
}
