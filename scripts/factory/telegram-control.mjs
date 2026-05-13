/**
 * TELEGRAM CONTROL PANEL
 *
 * Kirill manages the entire lead pipeline from Telegram.
 * Every lead card has inline buttons. One tap = one action.
 *
 * Buttons per lead:
 *   [✅ Написал]  [❌ Пропустить]  [👀 Профиль]
 * After "Написал":
 *   [💬 Ответил]  [⏰ Напомни через 48ч]  [🚫 Не ответит]
 * After "Ответил":
 *   [📋 Готовить КП]  [📞 Созвон назначен]
 *
 * Commands:
 *   /leads  — show pipeline with buttons
 *   /stats  — system status
 *   /brief  — request brief now
 *   /approve [id] — approve deal → triggers BuilderBot
 *
 * Run: node scripts/factory/telegram-control.mjs
 * Schedule: always running (cron every minute as keepalive)
 */
import { getDb, callAI, tgSendToKirill, heartbeat, emitEvent, createTask, env, getIntelligenceKey, setIntelligence, MODEL_MINI, signalConversion, sendMessage as sendEventBus, reportError, clearError, preflight } from "./orchestrator.mjs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { readPurpose, getWikiContext, appendLog } from "../../wiki/reader.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = env.TELEGRAM_CHAT_ID;
const BOT_NAME = "telegram-control";

// ─── IMAGE FINDER ──────────────────────────────────────────────────────────────

async function extractOgImage(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LinkedInBot/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // og:image — standard Open Graph (GitHub, ProductHunt, websites all support this)
    const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (ogMatch?.[1]) return ogMatch[1];

    // twitter:image fallback
    const twMatch = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    if (twMatch?.[1]) return twMatch[1];

    return null;
  } catch {
    return null;
  }
}

async function extractGitHubRepoImage(sourceUrl) {
  if (!sourceUrl) return null;
  try {
    // Convert any URL to GitHub repo format
    let repoPath = null;
    if (sourceUrl.includes("github.com/")) {
      repoPath = sourceUrl.split("github.com/")[1]?.split("/").slice(0, 2).join("/");
    }
    if (!repoPath) return null;

    // GitHub's own social preview image
    const socialPreview = `https://opengraph.githubassets.com/1/${repoPath}`;
    return socialPreview; // GitHub always serves this (auto-generated if no custom)
  } catch {
    return null;
  }
}

async function generateImageDallE(hook, topic, orchEnv) {
  const apiKey = orchEnv?.OPENAI_API_KEY || env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const prompt = `Professional LinkedIn post header image. Clean, minimal, modern design.
Topic: ${topic || "AI automation for business"}
Concept: ${hook || "AI transforming business operations"}
Style: Dark background, abstract tech visuals, no text overlays, suitable for B2B LinkedIn.
Colors: deep blue, white, subtle gradients. Corporate but innovative feel.`;

  try {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "dall-e-3", prompt, n: 1, size: "1792x1024", quality: "standard" }),
      signal: AbortSignal.timeout(60000),
    });
    const data = await res.json();
    return data.data?.[0]?.url || null;
  } catch {
    return null;
  }
}

async function findOrGenerateImage(sourceUrl, hook, topic, orchEnv) {
  // 1. Try GitHub social preview (always works for GitHub repos)
  const ghImage = await extractGitHubRepoImage(sourceUrl);
  if (ghImage) return ghImage;

  // 2. Try og:image from the source URL
  const ogImage = await extractOgImage(sourceUrl);
  if (ogImage) return ogImage;

  // 3. Fallback: generate with DALL-E
  return generateImageDallE(hook, topic, orchEnv);
}

// ─── TELEGRAM API HELPERS ─────────────────────────────────────────────────────

async function tgAPI(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  return res.json();
}

async function sendMessage(text, extra = {}) {
  return tgAPI("sendMessage", { chat_id: CHAT_ID, text, parse_mode: "Markdown", ...extra });
}

// Show ONE target at a time — the next pending target across all steps
// Show ONE target at a time — the next pending target
async function showNextTarget(db, projectId, projectName, _depth = 0) {
  // Anti-recursion guard
  if (_depth > 10) return;

  const totalSteps = db.prepare(`SELECT COUNT(*) as c FROM project_steps WHERE project_id = ?`).get(projectId)?.c || 0;
  const completedSteps = db.prepare(`SELECT COUNT(*) as c FROM project_steps WHERE project_id = ? AND status = 'completed'`).get(projectId)?.c || 0;

  // Find current step (first non-completed)
  const currentStep = db.prepare(`SELECT * FROM project_steps WHERE project_id = ? AND status != 'completed' ORDER BY step_number ASC LIMIT 1`).get(projectId);

  if (!currentStep) {
    // All steps done — project snapshot
    // Idempotency: check if already completed
    const proj = db.prepare(`SELECT status FROM projects WHERE id = ?`).get(projectId);
    if (proj?.status === "waiting_response" || proj?.status === "completed") return;

    const sentTargets = db.prepare(`SELECT target_name, artifact_type FROM step_artifacts WHERE project_id = ? AND status = 'sent'`).all(projectId);
    const skippedTargets = db.prepare(`SELECT target_name FROM step_artifacts WHERE project_id = ? AND status = 'skipped'`).all(projectId);

    db.prepare(`UPDATE projects SET status = 'waiting_response', current_stage = 'done', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(projectId);

    // Build detailed snapshot
    const lines = [
      `🎉 <b>${projectName} — выполнен!</b>`,
      ``,
      `<b>📊 Что сделано:</b>`,
    ];
    if (sentTargets.length > 0) {
      const byType = {};
      for (const t of sentTargets) {
        const type = t.artifact_type || "action";
        if (!byType[type]) byType[type] = [];
        byType[type].push(t.target_name || "—");
      }
      const typeLabels = { outreach: "✉️ Написали", content: "📝 Опубликовали", community: "💬 Прокомментировали", research: "🔍 Исследовали", follow_up: "🔄 Follow-up" };
      for (const [type, names] of Object.entries(byType)) {
        lines.push(`${typeLabels[type] || type}: ${names.slice(0, 5).join(", ")}${names.length > 5 ? ` +${names.length - 5}` : ""}`);
      }
    }
    if (skippedTargets.length > 0) {
      lines.push(`⏭ Пропущено: ${skippedTargets.length}`);
    }
    lines.push(``);
    lines.push(`<b>Статус:</b> ожидание ответов`);
    lines.push(`<i>Система отслеживает результаты.</i>`);

    await tgSendToKirill(lines.join("\n").slice(0, 3000), { reply_markup: { inline_keyboard: [[{ text: "🤖 Меню", callback_data: "menu" }]] }});
    return;
  }

  // Find next pending target in current step
  const nextTarget = db.prepare(`SELECT * FROM step_artifacts WHERE step_id = ? AND status = 'pending' ORDER BY rowid ASC LIMIT 1`).get(currentStep.id);

  if (!nextTarget) {
    // All targets in this step done — close step silently, move to next
    db.prepare(`UPDATE project_steps SET status = 'completed', completed_at = datetime('now') WHERE id = ?`).run(currentStep.id);
    db.prepare(`UPDATE projects SET current_stage = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(`step_${currentStep.step_number + 1}`, projectId);
    return showNextTarget(db, projectId, projectName, _depth + 1);
  }

  // Count targets in this step
  const totalInStep = db.prepare(`SELECT COUNT(*) as c FROM step_artifacts WHERE step_id = ?`).get(currentStep.id)?.c || 0;
  const doneInStep = db.prepare(`SELECT COUNT(*) as c FROM step_artifacts WHERE step_id = ? AND status != 'pending'`).get(currentStep.id)?.c || 0;

  // Action-type aware card
  const actionType = nextTarget.artifact_type || "outreach";
  const typeConfig = {
    outreach:   { icon: "✉️", verb: "Отправил", skipVerb: "Пропустить" },
    content:    { icon: "📝", verb: "Опубликовал", skipVerb: "Не сейчас" },
    community:  { icon: "💬", verb: "Прокомментировал", skipVerb: "Пропустить" },
    research:   { icon: "🔍", verb: "Готово", skipVerb: "Пропустить" },
    follow_up:  { icon: "🔄", verb: "Отправил", skipVerb: "Пропустить" },
  };
  const cfg = typeConfig[actionType] || typeConfig.outreach;

  // Build compact card
  const lines = [
    `📁 <b>${projectName.slice(0, 40)}</b>`,
    `Шаг ${currentStep.step_number}/${totalSteps} | ${cfg.icon} ${doneInStep + 1}/${totalInStep}`,
    ``,
  ];

  // Step action (only on first target of step)
  if (doneInStep === 0) {
    lines.push(`<b>${currentStep.action.slice(0, 100)}</b>`);
    lines.push(``);
  }

  // Target
  if (nextTarget.target_name) lines.push(`👤 <b>${nextTarget.target_name}</b>`);
  if (nextTarget.target_url || nextTarget.url) {
    const link = nextTarget.target_url || nextTarget.url;
    lines.push(`🔗 <a href="${link}">${link}</a>`);
  }
  if (nextTarget.title) lines.push(`⚡ ${nextTarget.title.slice(0, 100)}`);
  if (nextTarget.content) {
    lines.push(``);
    lines.push(`<code>${nextTarget.content.slice(0, 1500)}</code>`);
  }

  const text = lines.join("\n").slice(0, 3000);

  await tgSendToKirill(text, { reply_markup: { inline_keyboard: [
    [
      { text: `${cfg.icon} ${cfg.verb}`, callback_data: `target_done:${nextTarget.id}` },
      { text: `⏭ ${cfg.skipVerb}`, callback_data: `target_skip:${nextTarget.id}` },
    ],
    [{ text: `📋 Все цели (${totalInStep})`, callback_data: `step_more:${projectId}:${currentStep.step_number}` }],
    [{ text: "⏸ Пауза", callback_data: `step_pause:${projectId}:${currentStep.step_number}` }],
  ]}});
}

// Legacy — keep for backwards compat
async function showStepWithArtifacts(db, projectId, stepNum, projectName, totalSteps) {
  const step = db.prepare(`SELECT * FROM project_steps WHERE project_id = ? AND step_number = ?`).get(projectId, stepNum);
  if (!step) return;

  const artifacts = db.prepare(`SELECT * FROM step_artifacts WHERE step_id = ? ORDER BY artifact_type`).all(step.id);
  const completedSteps = db.prepare(`SELECT COUNT(*) as c FROM project_steps WHERE project_id = ? AND status = 'completed'`).get(projectId)?.c || 0;

  // Build ONE compact card
  const lines = [
    `📁 <b>${projectName}</b> | Шаг ${stepNum}/${totalSteps} (✅ ${completedSteps})`,
    ``,
    `🎯 <b>СЕЙЧАС:</b> ${step.action}`,
  ];

  if (step.why) lines.push(`💡 ${(step.why || "").slice(0, 120)}`);
  lines.push(``);

  // Embed artifacts INLINE — compact, not separate messages
  const targets = artifacts.filter(a => a.artifact_type === "target_list");
  const dms = artifacts.filter(a => a.artifact_type === "outreach_dm");
  const posts = artifacts.filter(a => a.artifact_type === "linkedin_post");
  const comments = artifacts.filter(a => a.artifact_type === "comment_draft");
  const recs = artifacts.filter(a => a.artifact_type === "recommendation");

  // Recommendation first (if any) — one line
  if (recs.length > 0) {
    lines.push(`⚡ ${recs[0].content.slice(0, 150)}`);
    lines.push(``);
  }

  // Top 3 targets with DMs inline
  if (targets.length > 0) {
    // Parse target list — each line is a target
    const targetLines = targets[0].content.split("\n").filter(l => l.trim().length > 5).slice(0, 3);
    for (let i = 0; i < targetLines.length; i++) {
      lines.push(`${i + 1}️⃣ ${targetLines[i].slice(0, 120)}`);
    }
    if (targets[0].content.split("\n").filter(l => l.trim().length > 5).length > 3) {
      lines.push(`<i>...ещё ${targets[0].content.split("\n").filter(l => l.trim().length > 5).length - 3} контактов</i>`);
    }
    lines.push(``);
  }

  // One DM template (first one only, copy-paste)
  if (dms.length > 0) {
    lines.push(`✉️ <b>Сообщение:</b>`);
    lines.push(`<code>${dms[0].content.slice(0, 250)}</code>`);
    if (dms.length > 1) lines.push(`<i>+${dms.length - 1} вариантов — нажми "Ещё варианты"</i>`);
    lines.push(``);
  }

  // LinkedIn post (if this step has one)
  if (posts.length > 0) {
    lines.push(`📝 <b>Пост:</b>`);
    lines.push(`<code>${posts[0].content.slice(0, 300)}</code>`);
    lines.push(``);
  }

  // Comment draft
  if (comments.length > 0) {
    lines.push(`💬 <b>Комментарий:</b>`);
    lines.push(`<code>${comments[0].content.slice(0, 250)}</code>`);
    lines.push(``);
  }

  if (step.expected_outcome) lines.push(`✅ <b>Готово когда:</b> ${step.expected_outcome.slice(0, 100)}`);

  // ONE message, compact
  const text = lines.join("\n").slice(0, 3500);

  const buttons = [[{ text: "✅ Сделал — следующий", callback_data: `step_done:${projectId}:${stepNum}` }]];
  if (dms.length > 1 || targets.length > 1) {
    buttons.push([{ text: "📋 Ещё варианты", callback_data: `step_more:${projectId}:${stepNum}` }]);
  }
  buttons.push([{ text: "⏸ Пауза", callback_data: `step_pause:${projectId}:${stepNum}` }]);

  await tgSendToKirill(text, { reply_markup: { inline_keyboard: buttons }});
}

async function editMessage(chatId, messageId, text, extra = {}) {
  return tgAPI("editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "Markdown", ...extra });
}

async function deleteMessage(chatId, messageId) {
  if (!messageId) return;
  return tgAPI("deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => {});
}

async function answerCallback(callbackQueryId, text = "✅") {
  return tgAPI("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
}

// ─── LEAD CARD BUILDER ────────────────────────────────────────────────────────

function buildLeadCard(lead, index = 1) {
  const platform = lead.source_platform || lead.source || "unknown";
  const platformEmoji = { linkedin: "💼", reddit: "🔴", hackernews: "🟠", email: "📧" }[platform] || "🌐";
  const scoreBar = lead.score >= 70 ? "🔥" : lead.score >= 50 ? "⚡" : "📊";

  const lines = [];
  lines.push(`${scoreBar} *Лид #${index}: ${lead.name || "Unknown"}*`);
  if (lead.company) lines.push(`🏢 ${lead.company}`);
  if (lead.role) lines.push(`👤 ${lead.role}`);
  lines.push(`${platformEmoji} ${platform} | Score: ${lead.score}/100`);
  if (lead.pain_description) lines.push(`💡 _${lead.pain_description.slice(0, 120)}_`);
  if (lead.source_url || lead.linkedin_url) {
    const url = lead.source_url || lead.linkedin_url;
    lines.push(`🔗 [Открыть профиль](${url})`);
  }
  if (lead.notes) {
    const cleanNotes = lead.notes
      .replace(/<[^>]+>/g, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/###\s*/g, "")
      .replace(/##\s*/g, "")
      .replace(/#\s*/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (cleanNotes.length > 10) {
      const isReddit = platform === "reddit";
      const label = isReddit ? "💬 *Готовый комментарий на Reddit:*" : "📝 *Готовое сообщение:*";
      lines.push(`\n${label}`);
      lines.push(`\`\`\`\n${cleanNotes.slice(0, 900)}\n\`\`\``);
    }
  }

  return lines.join("\n");
}

function buildLeadButtons(leadId, stage) {
  if (stage === "new" || stage === "briefed") {
    return {
      inline_keyboard: [
        [{ text: "✅ Написал", callback_data: `wrote:${leadId}` }],
        [{ text: "❌ Не подходит", callback_data: `skip_why:${leadId}` }],
        [{ text: "🤖 Главное меню", callback_data: "cmd:menu" }]
      ]
    };
  }
  if (stage === "contacted") {
    return {
      inline_keyboard: [
        [
          { text: "💬 Ответил!", callback_data: `replied:${leadId}` },
          { text: "⏰ Напомни 48ч", callback_data: `remind:${leadId}` },
        ],
        [{ text: "🚫 Не ответит — скажу почему", callback_data: `feedback:${leadId}` }],
        [{ text: "🤖 Главное меню", callback_data: "cmd:menu" }]
      ]
    };
  }
  if (stage === "replied") {
    return {
      inline_keyboard: [
        [
          { text: "📋 Готовить КП", callback_data: `proposal:${leadId}` },
          { text: "📞 Созвон", callback_data: `call:${leadId}` },
        ],
        [{ text: "✅ Одобрил — строить MVP", callback_data: `approved:${leadId}` }],
        [{ text: "💬 Оставить комментарий", callback_data: `feedback:${leadId}` }],
        [{ text: "🤖 Главное меню", callback_data: "cmd:menu" }]
      ]
    };
  }
  return { inline_keyboard: [[{ text: "🤖 Главное меню", callback_data: "cmd:menu" }]] };
}

// ─── PRE-FLIGHT CHECK — runs before EVERY card sent to Kirill ────────────────
// GPT-mini evaluates: is this worth Kirill's attention right now?
// If it fails → card is NOT sent, lead is auto-skipped with reason logged.

async function preflightCheck(lead, db) {
  try {
    // Load learned rules from LearnBot (if available)
    let learnedRules = "";
    try {
      const scoring = getIntelligenceKey(db, "learn-bot", "learned_rules", "lead_scoring");
      if (scoring?.hard_reject_patterns?.length) {
        learnedRules = `\nLearned hard-reject patterns: ${scoring.hard_reject_patterns.join(", ")}`;
      }
      if (scoring?.icp_refinement) {
        learnedRules += `\nIdeal client profile: ${scoring.icp_refinement}`;
      }
    } catch {}

    const isLinkedIn = (lead.source_platform || "").includes("linkedin");
    // For LinkedIn leads the "message" is a 200-char connection note — don't judge it as outreach quality.
    // Only evaluate the LEAD itself: score, pain, is it a real business?
    const messageContext = isLinkedIn
      ? `Connection note (200 chars): ${(lead.notes || "").slice(0, 200)}`
      : `Outreach message: ${(lead.notes || "").slice(0, 150)}`;

    const result = await callAI(
      `You are a pre-flight filter for Kirill's lead pipeline.
Kirill is an AI automation consultant (n8n, LLM, workflow automation). Works remotely, global clients.

Reject (pass=false) ONLY if clearly one of these:
- Full-time employment listing (salary, benefits, "full-time" role)
- Vendor/SaaS trying to sell Kirill something
- Score < 45 with no automation pain at all
- Obviously a student, hobbyist, or non-buyer
${isLinkedIn ? "- NOTE: This is a LinkedIn prospect — evaluate the PERSON and their pain, not the connection note style." : "- Message contains obvious AI template phrases (\"Hi there!\", \"I can help you\")"}
${learnedRules}

When in doubt — pass=true. Kirill decides, not the filter.
Return JSON: { "pass": true/false, "reason": "one sentence why" }`,
      `Lead: ${lead.name} (${lead.source_platform})
Score: ${lead.score}/100
Pain: ${(lead.pain_description || "").slice(0, 200)}
${messageContext}
Service match: ${lead.service_match || "?"}`,
      MODEL_MINI,
      true
    );

    return { pass: result?.pass !== false, reason: result?.reason || "" };
  } catch {
    return { pass: true, reason: "" }; // on error — let it through, don't block
  }
}

// ─── SEND LEAD CARD ───────────────────────────────────────────────────────────

export async function sendLeadCard(lead, index = 1) {
  const db = getDb();

  // Skip leads already actioned — don't re-send cards Kirill already saw
  if (["contacted", "replied", "won", "lost", "skipped"].includes(lead.stage)) {
    console.log(`[SendLeadCard] Skip "${lead.name}" — already ${lead.stage}`);
    db.close();
    return null;
  }

  // Pre-flight: should this card reach Kirill?
  const { pass, reason } = await preflightCheck(lead, db);
  if (!pass) {
    console.log(`[PreFlight] ❌ Blocked "${lead.name}" — ${reason}`);
    // Auto-skip silently, save reason for LearnBot to analyze
    try {
      db.prepare(`UPDATE leads SET stage = 'skipped', updated_at = datetime('now') WHERE id = ?`).run(lead.id);
      const { setIntelligence, getIntelligenceKey: getKey } = await import("./orchestrator.mjs");
      const existing = (() => { try { return getKey(db, "lead_feedback", "rejections", "reasons") || []; } catch { return []; }})();
      existing.push({ reason: `[AUTO] ${reason}`, leadName: lead.name, platform: lead.source_platform, score: lead.score, at: new Date().toISOString() });
      setIntelligence(db, "lead_feedback", "rejections", "reasons", existing.slice(-30), 365);
    } catch {}
    db.close();
    return null;
  }

  const text = buildLeadCard(lead, index);
  const buttons = buildLeadButtons(lead.id, lead.stage);
  const result = await sendMessage(text, { reply_markup: buttons });
  // Save message_id so we can delete the card after action
  if (result?.result?.message_id) {
    try {
      db.prepare("UPDATE leads SET tg_message_id = ? WHERE id = ?").run(result.result.message_id, lead.id);
    } catch {}
  }
  db.close();
  return result;
}

// ─── COMMAND HANDLERS ─────────────────────────────────────────────────────────

async function handleLeads(db) {
  const leads = db.prepare(`
    SELECT * FROM leads
    WHERE stage IN ('new', 'briefed', 'contacted', 'replied')
    ORDER BY score DESC, created_at DESC
    LIMIT 5
  `).all();

  if (leads.length === 0) {
    return sendMessage("📭 *Воронка пуста.*\n\nСистема ищет лидов. Жди — LinkedIn Hunter и ScoutBot работают.");
  }

  await sendMessage(`📋 *Твоя воронка (топ ${leads.length}):*`);
  for (let i = 0; i < leads.length; i++) {
    await sendLeadCard(leads[i], i + 1);
    await new Promise(r => setTimeout(r, 500));
  }
}

async function handleStats(db) {
  const deadline = new Date("2026-06-01T23:59:00-06:00");
  const daysLeft = Math.max(0, Math.ceil((deadline - new Date()) / 86400000));

  const stages = db.prepare("SELECT stage, COUNT(*) as n FROM leads GROUP BY stage").all();
  const emails = db.prepare("SELECT COUNT(*) as n FROM outreach_emails WHERE status='sent'").get();
  const replies = db.prepare("SELECT COUNT(*) as n FROM outreach_emails WHERE reply_received_at IS NOT NULL").get();
  const deals = db.prepare("SELECT COUNT(*) as n FROM deals WHERE status='won'").get();

  const stageMap = Object.fromEntries(stages.map(s => [s.stage, s.n]));

  const lines = [
    `📊 *Статус системы*`,
    `⏳ Дней до дедлайна: *${daysLeft}* | Цель: $1,500 CAD`,
    ``,
    `*Воронка лидов:*`,
    `• Новых: ${(stageMap.new || 0) + (stageMap.briefed || 0)}`,
    `• Написано: ${stageMap.contacted || 0}`,
    `• Ответили: ${stageMap.replied || 0}`,
    `• Закрыто: ${deals.n} 💰`,
    ``,
    `*Cold Email:*`,
    `• Отправлено: ${emails.n}`,
    `• Ответов: ${replies.n}`,
    ``,
    `*Активные каналы:*`,
    `• ✅ Cold Email (73 в очереди)`,
    `• ✅ LinkedIn Hunter (Brave Search)`,
    `• ✅ ScoutBot (Reddit/HN/Craigslist)`,
    `• ⏳ Upwork/Threads (апрель)`,
  ];

  await sendMessage(lines.join("\n"), {
    inline_keyboard: [[
      { text: "📋 Показать лидов", callback_data: "cmd:leads" },
      { text: "🔄 Обновить", callback_data: "cmd:stats" },
    ]]
  });
}

async function handleBrief() {
  const { runBriefAgent } = await import("./brief-agent.mjs");
  await runBriefAgent();
}

async function handleIntel(db) {
  const { getIntelligenceKey } = await import("./orchestrator.mjs");
  const { readFileSync, existsSync } = await import("fs");
  const { resolve, dirname } = await import("path");
  const { fileURLToPath } = await import("url");

  // Market heat summary
  const now = new Date();
  const year = now.getFullYear();
  const start = new Date(year, 0, 1);
  const week = Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7);
  const weekKey = `${year}_W${week}`;
  const heatData = getIntelligenceKey(db, "research-bot", "market_heat", `week_${weekKey}`) || {};
  const sortedMarkets = Object.entries(heatData)
    .filter(([m]) => m !== "unknown")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const prTarget = getIntelligenceKey(db, "pr-bot", "current_target_market", "market");
  const marketIntel = getIntelligenceKey(db, "research-bot", "market_intelligence", "latest");
  const demandSignals = getIntelligenceKey(db, "research-bot", "demand_signals", "latest") || [];
  const freshSignals = demandSignals.filter(s =>
    s.foundAt && Date.now() - new Date(s.foundAt).getTime() < 7 * 24 * 60 * 60 * 1000
  );

  const lines = [`🌍 *Глобальная разведка — краткий отчёт*`, ``];

  if (sortedMarkets.length > 0) {
    lines.push(`*🔥 Горячие рынки (эта неделя):*`);
    for (const [market, count] of sortedMarkets) {
      const heat = count >= 5 ? "🔴" : count >= 3 ? "🟡" : "🟢";
      const isTarget = prTarget?.market === market ? " ← фокус" : "";
      lines.push(`${heat} ${market}: ${count} сигналов${isTarget}`);
    }
    lines.push(``);
  } else {
    lines.push(`_Данных о рынках пока нет — ResearchBot накапливает сигналы._`);
    lines.push(``);
  }

  if (prTarget?.market) {
    lines.push(`*🎯 Текущий фокус:* ${prTarget.market}`);
    lines.push(`_LinkedInHunter и ContentBot настроены на эту страну до ${new Date(prTarget.expiresAt).toLocaleDateString("ru-RU")}_`);
    lines.push(``);
  }

  if (freshSignals.length > 0) {
    lines.push(`*🚨 Свежих запросов за 7 дней: ${freshSignals.length}*`);
    freshSignals.slice(0, 3).forEach(s => {
      lines.push(`• [${s.title?.slice(0, 55)}](${s.url})`);
    });
    lines.push(``);
  }

  if (marketIntel?.analysis) {
    lines.push(`*🗺 Рыночная разведка:*`);
    lines.push(`_${marketIntel.analysis.slice(0, 350)}_`);
    lines.push(``);
  }

  // Check if INTEL.md exists
  const intelPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.data/INTEL.md");
  if (existsSync(intelPath)) {
    lines.push(`📄 _Полный документ: \`.data/INTEL.md\` (обновляется каждую ночь)_`);
  } else {
    lines.push(`_Полный документ создастся после первого ночного сканирования (3 AM)._`);
  }

  await sendMessage(lines.join("\n"), {
    reply_markup: { inline_keyboard: [
      [
        { text: "🔍 Запустить разведку сейчас", callback_data: "cmd:run_research" },
        { text: "🎯 PR Фокус", callback_data: "cmd:run_pr" }
      ],
      [
        { text: "✍️ Написать моё мнение об отчёте", callback_data: "cmd:intel_feedback" }
      ]
    ]}
  });
}

// ─── DELETE LEAD CARD HELPER ──────────────────────────────────────────────────
// Deletes the original lead card message from chat after Kirill takes action.
// Keeps the chat clean — only active/unactioned leads visible.
async function deleteLeadCard(db, leadId, chatId, fallbackMessageId = null) {
  try {
    const row = db.prepare("SELECT tg_message_id FROM leads WHERE id = ?").get(leadId);
    if (row?.tg_message_id) {
      await deleteMessage(chatId, row.tg_message_id);
      return;
    }
  } catch {}
  // Fallback: delete the current message that contains the callback button
  if (fallbackMessageId) {
    try { await deleteMessage(chatId, fallbackMessageId); } catch {}
  }
}

// ─── CALLBACK HANDLERS ────────────────────────────────────────────────────────

// Dedup guard — prevent processing same callback twice
const _processedCallbacks = new Set();

async function handleCallback(db, query) {
  const { id: callbackId, data, message } = query;
  const chatId = message?.chat?.id;
  const messageId = message?.message_id;

  if (!data) return;

  // Dedup: skip if this exact callback was already processed
  if (_processedCallbacks.has(callbackId)) {
    try { await answerCallback(callbackId); } catch {}
    return;
  }
  _processedCallbacks.add(callbackId);
  // Keep set small — only last 200 callbacks
  if (_processedCallbacks.size > 200) {
    const first = _processedCallbacks.values().next().value;
    _processedCallbacks.delete(first);
  }

  // ═══ UNIFIED CARD HANDLERS (send-action-card.mjs + legacy) ═══
  // card_skip: just delete card
  if (data === "noop" || data === "card_skip") {
    await answerCallback(callbackId, "✅ Skipped");
    try { await tgAPI("deleteMessage", { chat_id: chatId, message_id: messageId }); } catch {}
    return;
  }
  // send_email:<id> - Kirill approved a warm reply card, send the reply via SMTP
  if (data.startsWith("send_email:")) {
    const emailId = data.split(":")[1];
    await answerCallback(callbackId, "📤 Sending...");
    try {
      const db2 = getDb();
      const row = db2.prepare(`SELECT id, business_name, business_email, subject, reply_body, followup_sent_at FROM outreach_emails WHERE id = ?`).get(emailId);
      if (!row) throw new Error(`email ${emailId} not found`);
      if (row.followup_sent_at) {
        await sendMessage(`⚠️ Already sent follow-up to ${row.business_name}`);
        if (messageId) await deleteMessage(chatId, messageId);
        db2.close();
        return;
      }

      const msgText = message?.text || "";
      const draftMatch = msgText.match(/Draft reply:\s*\n([\s\S]+)$/);
      const draftBody = draftMatch ? draftMatch[1].trim() : `Hi,\n\nFollowing up on my previous email - happy to jump on a quick 20-minute call this week to discuss how AI automation could save your team time.\n\nBest,\nKirill D.`;

      const replySubject = row.subject ? (row.subject.startsWith("Re:") ? row.subject : `Re: ${row.subject}`) : "Re: AI workflow automation";

      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport({
        host: env.OUTREACH_SMTP_HOST || "mail.privateemail.com",
        port: parseInt(env.OUTREACH_SMTP_PORT || "587"),
        secure: false,
        auth: { user: env.OUTREACH_EMAIL, pass: env.OUTREACH_PASSWORD },
        tls: { rejectUnauthorized: false },
      });

      await transport.sendMail({
        from: `"Kirill D." <${env.OUTREACH_EMAIL}>`,
        to: row.business_email,
        subject: replySubject,
        text: draftBody,
        html: draftBody.replace(/\n/g, "<br>"),
      });

      db2.prepare(`UPDATE outreach_emails SET followup_sent_at = ?, status = 'warming', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), new Date().toISOString(), emailId);
      db2.close();

      await sendMessage(`✅ Sent to <b>${row.business_name}</b> (${row.business_email})`, { parse_mode: "HTML" });
      if (messageId) await deleteMessage(chatId, messageId);
      console.log(`[telegram-control] send_email: sent follow-up to ${row.business_name} (${row.business_email})`);
    } catch (e) {
      console.error(`[telegram-control] send_email error:`, e.message);
      await sendMessage(`❌ Send failed: ${e.message}`);
    }
    return;
  }

  // skip_reply:<id> - Kirill skipped this warm reply card, don't show again
  if (data.startsWith("skip_reply:")) {
    const emailId = data.split(":")[1];
    await answerCallback(callbackId, "⏭ Skipped");
    try {
      const db2 = getDb();
      setIntelligence(db2, "warm-reply-cards", "tg_card", emailId, { sent_at: new Date().toISOString(), skipped: true });
      db2.close();
    } catch {}
    if (messageId) await deleteMessage(chatId, messageId);
    return;
  }

  // card_posted: Kirill posted a Reddit comment - auto-register for monitoring + conversation tracking
  if (data.startsWith("card_posted:")) {
    const msgText = message?.text || "";
    const redditUrlMatch = msgText.match(/https?:\/\/(?:www\.)?reddit\.com\/r\/(\w+)\/comments\/(\w+)\/([^/\s]+)/);
    if (redditUrlMatch) {
      try {
        const { randomUUID } = await import("crypto");
        const sub = redditUrlMatch[1];
        const postId = redditUrlMatch[2];
        const fullUrl = redditUrlMatch[0];
        const title = (redditUrlMatch[3] || "").replace(/_/g, " ").slice(0, 150);
        const monKey = `posted_${postId}`;
        const now = new Date().toISOString();
        const db = getDb();
        // Register for reddit-monitor
        db.prepare(`INSERT OR IGNORE INTO bot_intelligence (id, bot_id, insight_type, key, value_json, confidence, created_at, updated_at) VALUES (?, 'reddit', 'monitoring', ?, ?, 30, ?, ?)`).run(
          randomUUID(), monKey, JSON.stringify({
            monitorId: monKey, postUrl: fullUrl, subreddit: sub, title,
            monitoredSince: Date.now(), seenCommentIds: [],
            kirillCommentId: "manual_post", type: "comment", source: "card_posted"
          }), now, now
        );
        // Create conversation
        try {
          const { recordFirstContact } = await import("./conversation-tracker.mjs");
          const draftMatch = msgText.match(/<code>([\s\S]*?)<\/code>/) || msgText.match(/```([\s\S]*?)```/);
          recordFirstContact("thread_audience", "reddit", `r/${sub}`, (draftMatch?.[1] || "comment posted").slice(0, 500), title, fullUrl);
        } catch {}
        db.close();
        console.log(`[telegram-control] card_posted: r/${sub}/${postId} registered for monitoring + conversation`);
      } catch (e) {
        console.error(`[telegram-control] card_posted register error: ${e.message}`);
      }
    }
    await answerCallback(callbackId, "✅ Posted - tracking replies");
    try { await tgAPI("deleteMessage", { chat_id: chatId, message_id: messageId }); } catch {}
    return;
  }
  // cortex_ack on a field kit card: save to active-field-kits.json for field-kit-executor
  if (data.startsWith("cortex_ack")) {
    try {
      const { existsSync: _ex, readFileSync: _rf, writeFileSync: _wf } = await import("fs");
      const { resolve: _rv } = await import("path");
      const kitsPath = _rv("$CLAUDE_PROJECT_DIR/.data/active-field-kits.json");

      // Extract field kit data from the message text
      const msgText = message?.text || "";
      const kitData = await callAI(
        `Extract the field kit details from this Telegram message. Return JSON:
{
  "title": "kit title",
  "target_description": "who to search for",
  "search_queries": ["query1", "query2", "query3"],
  "opener_template": "template text if any",
  "objection_handlers": [],
  "close_line": "closing line if any"
}
If this is not a field kit message, return { "is_kit": false }`,
        msgText.slice(0, 2000),
        MODEL_MINI,
        true,
      );

      if (kitData && kitData.is_kit !== false && kitData.title) {
        let kits = [];
        if (_ex(kitsPath)) {
          try { kits = JSON.parse(_rf(kitsPath, "utf-8")); } catch { kits = []; }
        }
        if (!Array.isArray(kits)) kits = [];

        // Avoid duplicates by title
        if (!kits.some(k => k.title === kitData.title)) {
          kits.push({
            id: (await import("crypto")).randomUUID(),
            title: kitData.title,
            target_description: kitData.target_description || "",
            search_queries: kitData.search_queries || [],
            opener_template: kitData.opener_template || "",
            objection_handlers: kitData.objection_handlers || [],
            close_line: kitData.close_line || "",
            approved_at: new Date().toISOString(),
          });
          _wf(kitsPath, JSON.stringify(kits, null, 2));
          await answerCallback(callbackId, "Kit activated - executor will search");
          console.log(`[telegram-control] Field kit saved: "${kitData.title}"`);
        } else {
          await answerCallback(callbackId, "Kit already active");
        }
      } else {
        await answerCallback(callbackId, "✅ Noted");
      }

      // AUTO-REGISTER: if message contains a Reddit URL, register for monitoring + conversation tracking
      const redditUrlMatch = msgText.match(/https?:\/\/(?:www\.)?reddit\.com\/r\/(\w+)\/comments\/(\w+)\/([^/\s]+)/);
      if (redditUrlMatch) {
        try {
          const { randomUUID: _uuid } = await import("crypto");
          const sub = redditUrlMatch[1];
          const postId = redditUrlMatch[2];
          const fullUrl = redditUrlMatch[0];
          const title = (redditUrlMatch[3] || "").replace(/_/g, " ").slice(0, 150);
          const monKey = `posted_${postId}`;
          const now = new Date().toISOString();

          // Register for reddit-monitor
          const db = getDb();
          db.prepare(`INSERT OR IGNORE INTO bot_intelligence (id, bot_id, insight_type, key, value_json, confidence, created_at, updated_at) VALUES (?, 'reddit', 'monitoring', ?, ?, 30, ?, ?)`).run(
            _uuid(), monKey, JSON.stringify({
              monitorId: monKey, postUrl: fullUrl, subreddit: sub, title,
              monitoredSince: Date.now(), seenCommentIds: [],
              kirillCommentId: "manual_post", type: "comment", source: "telegram_posted"
            }), now, now
          );

          // Create conversation record
          try {
            const { recordFirstContact } = await import("./conversation-tracker.mjs");
            const draftText = msgText.match(/```([\s\S]*?)```/) || msgText.match(/<code>([\s\S]*?)<\/code>/);
            recordFirstContact("thread_audience", "reddit", `r/${sub}`, (draftText?.[1] || "comment posted").slice(0, 500), title, fullUrl);
          } catch {}

          db.close();
          console.log(`[telegram-control] Auto-registered r/${sub}/${postId} for monitoring + conversation`);
        } catch (regErr) {
          console.error(`[telegram-control] Auto-register failed: ${regErr.message}`);
        }
      }
    } catch (e) {
      console.error(`[telegram-control] cortex_ack kit save error:`, e.message);
      await answerCallback(callbackId, "✅ Noted (kit save failed)");
    }
    try { await tgAPI("deleteMessage", { chat_id: chatId, message_id: messageId }); } catch {}
    return;
  }
  // Other cortex_ callbacks (non-kit)
  if (data.startsWith("cortex_")) {
    await answerCallback(callbackId, "✅ Noted");
    try { await tgAPI("deleteMessage", { chat_id: chatId, message_id: messageId }); } catch {}
    return;
  }
  // Field kit executor: kit_sent, kit_skip, kit_stop
  if (data.startsWith("kit_sent:") || data.startsWith("kit_skip:") || data.startsWith("kit_stop:")) {
    try {
      const db = getDb();
      if (data.startsWith("kit_sent:")) {
        const leadId = data.split(":")[1];
        db.prepare(`UPDATE field_kit_leads SET status = 'sent_by_kirill', actioned_at = ? WHERE id = ?`)
          .run(new Date().toISOString(), leadId);
        await answerCallback(callbackId, "Marked as sent");
      } else if (data.startsWith("kit_skip:")) {
        const leadId = data.split(":")[1];
        db.prepare(`UPDATE field_kit_leads SET status = 'skipped', actioned_at = ? WHERE id = ?`)
          .run(new Date().toISOString(), leadId);
        await answerCallback(callbackId, "Skipped");
      } else if (data.startsWith("kit_stop:")) {
        const kitId = data.split(":")[1];
        // Remove kit from active list
        const { existsSync: _ex, readFileSync: _rf, writeFileSync: _wf } = await import("fs");
        const { resolve: _rv } = await import("path");
        const kitsPath = _rv("$CLAUDE_PROJECT_DIR/.data/active-field-kits.json");
        if (_ex(kitsPath)) {
          let kits = [];
          try { kits = JSON.parse(_rf(kitsPath, "utf-8")); } catch { kits = []; }
          const removed = kits.find(k => k.id === kitId);
          kits = kits.filter(k => k.id !== kitId);
          _wf(kitsPath, JSON.stringify(kits, null, 2));
          await answerCallback(callbackId, `Kit stopped: ${removed?.title || kitId}`);
          console.log(`[telegram-control] Field kit stopped: ${removed?.title || kitId}`);
        } else {
          await answerCallback(callbackId, "No active kits file");
        }
        db.close();
        try { await tgAPI("deleteMessage", { chat_id: chatId, message_id: messageId }); } catch {}
        return;
      }
      db.close();
    } catch (e) {
      await answerCallback(callbackId, `Error: ${e.message.slice(0, 50)}`);
    }
    try { await tgAPI("deleteMessage", { chat_id: chatId, message_id: messageId }); } catch {}
    return;
  }
  if (data === "delete_flag" || data === "delete_scouts_flag") {
    try {
      const { unlinkSync, existsSync } = await import("fs");
      const flagPath = "$CLAUDE_PROJECT_DIR/.data/scouts-paused.flag";
      if (existsSync(flagPath)) unlinkSync(flagPath);
      await answerCallback(callbackId, "✅ Flag deleted, scouts resuming");
    } catch (e) {
      await answerCallback(callbackId, `Error: ${e.message.slice(0, 50)}`);
    }
    try { await tgAPI("deleteMessage", { chat_id: chatId, message_id: messageId }); } catch {}
    return;
  }

  // Hypothesis executor posted/skip (added Apr 27 2026)
  if (data.startsWith("hyp_posted:") || data.startsWith("hyp_skip:")) {
    // hypothesis_tests CHECK constraint allows: 'drafted','sent','skipped','replied'
    // "posted" was triggering CHECK constraint failure, map to "sent" semantically
    const isPosted = data.startsWith("hyp_posted:");
    const dbStatus = isPosted ? "sent" : "skipped";
    const testId = data.split(":")[1];
    try {
      const db = getDb();
      // Read the test row first so we can record an outcome with rich context
      const test = db.prepare(`SELECT subreddit, post_title, post_url, draft_text, hypothesis_id FROM hypothesis_tests WHERE id = ?`).get(testId);
      db.prepare(`UPDATE hypothesis_tests SET status = ?, sent_at = ? WHERE id = ?`)
        .run(dbStatus, new Date().toISOString(), testId);
      db.close();
      await answerCallback(callbackId, isPosted ? "✅ Marked as posted" : "⏭ Skipped");
      // Delete the message card after action
      try {
        await tgAPI("deleteMessage", { chat_id: chatId, message_id: messageId });
      } catch {}
      console.log(`[telegram-control] hypothesis test ${testId} -> ${dbStatus}`);

      // COMPOUNDING LEARNING (added 2026-05-08): record outcome for organism so
      // wiki/learned-hypothesis-filtering.md gets sharper with every button press.
      // signal_value: 1.0 if Kirill posted (match was useful), 0.0 if skipped (match was noise).
      try {
        if (test) {
          const verdict = isPosted ? "HIT" : "NOISE";
          const signalValue = isPosted ? 1.0 : 0.0;
          const description = `${verdict}: r/${test.subreddit} "${(test.post_title || "").slice(0, 120)}" - Kirill ${isPosted ? "posted" : "skipped"} via Telegram. Hypothesis: ${(test.hypothesis_id || "").slice(0, 80)}`;
          const outcome = JSON.stringify({
            source_type: "telegram_button_hypothesis",
            source_ref: testId,
            signal_type: "icp_match_quality",
            signal_value: signalValue,
            description,
            related_action_type: "reddit_comment",
            related_target: test.subreddit || "unknown",
            meta_json: JSON.stringify({ post_url: test.post_url, hypothesis_id: test.hypothesis_id, button: isPosted ? "posted" : "skipped" }),
          });
          const ROOT = resolve(__dirname, "../..");
          const child = spawn(NODE_BIN, [resolve(ROOT, "scripts/organism/record-outcome.mjs"), "--stdin"], {
            cwd: ROOT, stdio: ["pipe", "pipe", "pipe"], detached: true,
          });
          child.stdin.write(outcome);
          child.stdin.end();
          child.unref();
          console.log(`[telegram-control] outcome recorded: ${verdict} for ${testId}`);
        }
      } catch (outcomeErr) {
        // Don't fail the button just because outcome recording failed
        console.error(`[telegram-control] outcome record failed: ${outcomeErr.message}`);
      }
    } catch (e) {
      await answerCallback(callbackId, `Error: ${e.message.slice(0, 50)}`);
    }
    return;
  }

  // Threads reply send/skip (added Apr 23 2026)
  if (data.startsWith("threads_send:") || data.startsWith("threads_skip:")) {
    const action = data.startsWith("threads_send:") ? "send" : "skip";
    const replyToId = data.split(":")[1];
    try {
      if (action === "send") {
        const msgText = message?.text || "";
        const draftMatch = msgText.match(/Draft reply:\n([\s\S]*?)\n\nReply ID:/);
        const draft = draftMatch?.[1]?.trim();
        if (draft && replyToId) {
          const { replyToComment } = await import("./threads-bot.mjs");
          await replyToComment(replyToId, draft);
          await answerCallback(callbackId, "Posted on Threads!");
        } else {
          await answerCallback(callbackId, "No draft found");
        }
      } else {
        await answerCallback(callbackId, "Skipped");
      }
      await tgAPI("deleteMessage", { chat_id: chatId, message_id: messageId });
    } catch (e) {
      console.error(`[Control] Threads ${action} error:`, e.message);
      await answerCallback(callbackId, `Error: ${e.message.slice(0, 50)}`);
      try { await tgAPI("deleteMessage", { chat_id: chatId, message_id: messageId }); } catch {}
    }
    return;
  }

  // Threads qualify/follow-up send (threads_send_qualify: was missing handler - added May 2026)
  if (data.startsWith("threads_send_qualify:") || data.startsWith("threads_skip_qualify:")) {
    const action = data.startsWith("threads_send_qualify:") ? "send" : "skip";
    const replyToId = data.split(":")[1];
    try {
      if (action === "send") {
        const msgText = message?.text || "";
        // Handle both QUALIFY and FOLLOW-UP message formats from threads-bot
        const qualifyMatch = msgText.match(/Qualifying question:\n([\s\S]*?)\n\nTone:/);
        const followupMatch = msgText.match(/Follow-up:\n([\s\S]*?)\n\nReply ID:/);
        const draft = (qualifyMatch?.[1] || followupMatch?.[1])?.trim();
        if (draft && replyToId) {
          const { replyToComment } = await import("./threads-bot.mjs");
          await replyToComment(replyToId, draft);
          await answerCallback(callbackId, "Qualifying question posted!");
        } else {
          await answerCallback(callbackId, "No qualifying draft found");
        }
      } else {
        await answerCallback(callbackId, "Skipped");
      }
      await tgAPI("deleteMessage", { chat_id: chatId, message_id: messageId });
    } catch (e) {
      console.error(`[Control] Threads qualify ${action} error:`, e.message);
      await answerCallback(callbackId, `Error: ${e.message.slice(0, 50)}`);
      try { await tgAPI("deleteMessage", { chat_id: chatId, message_id: messageId }); } catch {}
    }
    return;
  }

  // Threads publish post
  if (data.startsWith("threads_publish:")) {
    try {
      const { readFileSync: rf } = await import("fs");
      const { resolve: res } = await import("path");
      const pending = JSON.parse(rf(res("$CLAUDE_PROJECT_DIR/.data/threads-pending-post.json"), "utf-8"));
      if (pending?.text) {
        const { publishPost } = await import("./threads-bot.mjs");
        await publishPost(pending.text);
        await answerCallback(callbackId, "Posted on Threads!");
      } else {
        await answerCallback(callbackId, "No pending post");
      }
      await tgAPI("deleteMessage", { chat_id: chatId, message_id: messageId });
    } catch (e) {
      console.error(`[Control] Threads publish error:`, e.message);
      await answerCallback(callbackId, `Error: ${e.message.slice(0, 50)}`);
      try { await tgAPI("deleteMessage", { chat_id: chatId, message_id: messageId }); } catch {}
    }
    return;
  }

  // Site curator approve/reject (added Apr 15 2026)
  if (data.startsWith("site_approve:") || data.startsWith("site_reject:")) {
    const action = data.startsWith("site_approve:") ? "approve" : "reject";
    const suggestionId = data.split(":")[1];
    try {
      const { execSync } = await import("child_process");
      const path = await import("path");
      const fs = await import("fs");
      const ROOT = "$CLAUDE_PROJECT_DIR";
      const suggestionPath = path.resolve(ROOT, ".data/site-curator/pending", `${suggestionId}.json`);

      if (!fs.existsSync(suggestionPath)) {
        await answerCallback(callbackId, "❌ Suggestion not found");
        return;
      }

      if (action === "reject") {
        fs.unlinkSync(suggestionPath);
        await tgAPI("deleteMessage", { chat_id: chatId, message_id: messageId });
        await answerCallback(callbackId, "❌ Rejected");
        console.log(`[telegram-control] site-curator suggestion ${suggestionId} rejected`);
        return;
      }

      // APPROVE: apply week-log update and deploy
      const suggestion = JSON.parse(fs.readFileSync(suggestionPath, "utf-8"));
      const indexPath = path.resolve(ROOT, "sandbox-review/site/index.html");
      let html = fs.readFileSync(indexPath, "utf-8");

      // Replace the week-log paragraph content
      const weekLogRegex = /(<div class="week-log">[\s\S]*?<time>)([^<]+)(<\/time>\s*<h3>)([^<]+)(<\/h3>\s*<p>)([\s\S]*?)(<\/p>)/;
      const today = new Date();
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay() + 1); // Monday
      const dateStr = weekStart.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

      // Preserve existing h3 heading, only update date and paragraph
      html = html.replace(weekLogRegex, (m, p1, p2, p3, p4, p5, p6, p7) => {
        return `${p1}Week of ${dateStr}${p3}${p4}${p5}${suggestion.week_log_suggestion}${p7}`;
      });

      fs.writeFileSync(indexPath, html);

      // Deploy via vercel
      await answerCallback(callbackId, "✅ Applying & deploying...");
      try {
        execSync(`cd "${path.resolve(ROOT, "sandbox-review/site")}" && $HOME/.nvm/versions/node/v22.22.2/bin/node $(which vercel) --prod --yes 2>&1`, { encoding: "utf-8", timeout: 120000 });
        fs.unlinkSync(suggestionPath);
        await tgAPI("deleteMessage", { chat_id: chatId, message_id: messageId });
        await tgSendToKirill(`✅ Site updated + deployed\n\nWeek-log: ${dateStr}\n${suggestion.week_log_suggestion.slice(0, 200)}...\n\nhttps://launchsoloai.com`);
        console.log(`[telegram-control] site-curator suggestion ${suggestionId} approved + deployed`);
      } catch (e) {
        await tgSendToKirill(`⚠️ Site updated but deploy failed:\n${e.message.slice(0, 300)}\n\nRun manually: cd sandbox-review/site && vercel --prod`);
      }
    } catch (e) {
      console.error("[telegram-control] site approve/reject error:", e.message);
      await answerCallback(callbackId, `❌ ${e.message.slice(0, 50)}`);
    }
    return;
  }

  // LinkedIn outreach Send/Skip callbacks (added Apr 8 2026 for linkedin-deep-analyzer)
  // Kirill wants the WHOLE CARD to disappear after button press, not just buttons updated.
  if (data.startsWith("li_sent:") || data.startsWith("li_skip:")) {
    const action = data.startsWith("li_sent:") ? "sent" : "skipped";
    const leadId = data.split(":")[1];
    try {
      db.prepare(`UPDATE leads SET outreach_status=?, outreach_action_at=datetime('now') WHERE id=?`).run(action, leadId);
      const lead = db.prepare(`SELECT name FROM leads WHERE id=?`).get(leadId);
      // DELETE the entire card from Telegram so chat stays clean
      await tgAPI("deleteMessage", { chat_id: chatId, message_id: messageId });
      await answerCallback(callbackId, action === "sent" ? "✅ Sent" : "⏭ Skipped");
      console.log(`[telegram-control] LinkedIn lead ${lead?.name} → ${action} (card deleted)`);
    } catch (e) {
      console.error("[telegram-control] li_sent/skip error:", e.message);
      await answerCallback(callbackId, `❌ ${e.message.slice(0, 50)}`);
    }
    return;
  }

  // Command callbacks
  if (data.startsWith("cmd:")) {
    const cmd = data.slice(4);
    await answerCallback(callbackId);
    if (cmd === "leads") await handleLeads(db);
    if (cmd === "stats") await handleStats(db);
    if (cmd === "intel") await handleIntel(db);
    if (cmd === "run_pr") {
      await sendMessage(`🎯 <b>Запускаю PRBot...</b>\nВыбираю целевой рынок и ищу LinkedIn профили. ~2 минуты.`);
      import("./pr-bot.mjs").then(({ runPRBot }) => runPRBot()).catch(e => sendMessage(`❌ PRBot error: ${e.message}`));
    }
    if (cmd === "run_research") {
      await sendMessage(`🌍 <b>Запускаю разведку...</b>\nСканирую 50+ источников по всему миру. ~5 минут.`);
      import("./research-bot.mjs").then(({ runResearchBot }) => runResearchBot()).catch(e => sendMessage(`❌ Research error: ${e.message}`));
    }
    // Community bot callbacks
    if (data.startsWith("community_post:")) {
      const topicId = data.split(":")[1];
      await answerCallback(callbackQuery.id, "⏳ Публикую...");

      // Try auto-post via Discourse API
      try {
        const { postToDiscourse } = await import("./community-bot.mjs");
        // Get saved answer for this topic
        const savedAnswer = getIntelligenceKey(db, "community-bot", "pending_answers", topicId);
        if (savedAnswer?.answer) {
          const posted = await postToDiscourse(topicId, savedAnswer.answer);
          if (posted) {
            setIntelligence(db, "community-bot", "published", topicId, new Date().toISOString());
            if (messageId) await deleteMessage(chatId, messageId);
            await sendMessage(
              `✅ <b>Опубликовано автоматически!</b>\n\n` +
              `<a href="https://community.n8n.io/t/${topicId}">Посмотреть →</a>`
            );
            return;
          }
        }
      } catch {}

      // Fallback: manual mode — show answer + direct link, one tap to copy
      setIntelligence(db, "community-bot", "published", topicId, new Date().toISOString());
      const savedAnswer2 = getIntelligenceKey(db, "community-bot", "pending_answers", topicId);
      const answerText = savedAnswer2?.answer || "(ответ не найден — проверь карточку выше)";
      const threadUrl = savedAnswer2?.url || `https://community.n8n.io/t/${topicId}`;

      await sendMessage(
        `📋 <b>Шаг 1 — скопируй ответ:</b>\n\n` +
        `<code>${answerText.slice(0, 3000)}</code>`
      );
      await sendMessage(
        `📋 <b>Шаг 2 — открой тред и вставь:</b>\n\n` +
        `<a href="${threadUrl}">➡️ Нажми здесь — откроется тред</a>\n\n` +
        `Нажми Reply → вставь текст → Submit. 20 секунд.`,
        { reply_markup: { inline_keyboard: [[
          { text: "✅ Опубликовал", callback_data: `community_done:${topicId}` }
        ]]}}
      );
      return;
    }
    if (data.startsWith("community_skip:")) {
      const topicId = data.split(":")[1];
      await answerCallback(callbackQuery.id, "Пропущено");
      setIntelligence(db, "community-bot", "skipped", topicId, new Date().toISOString());
      return;
    }
    if (data.startsWith("community_done:")) {
      const topicId = data.split(":")[1];
      await answerCallback(callbackQuery.id, "✅ Записано!");
      setIntelligence(db, "community-bot", "confirmed_published", topicId, new Date().toISOString());
      // Delete original card + step messages — keep chat clean
      if (messageId) await deleteMessage(chatId, messageId);
      await sendMessage(`✅ <b>Опубликовано.</b> Эксперты на n8n Community — тебя видят.`);
      return;
    }

    if (cmd === "intel_feedback") {
      const { writeFileSync } = await import("fs");
      const { resolve, dirname } = await import("path");
      const { fileURLToPath: ftu } = await import("url");
      const __d = dirname(ftu(import.meta.url));
      writeFileSync(resolve(__d, "../../.data/pending-feedback.json"), JSON.stringify({
        type: "intel_feedback",
        askedAt: new Date().toISOString()
      }));
      await sendMessage(
        `✍️ <b>Напиши своё мнение об отчёте</b>\n\n` +
        `Например:\n` +
        `• "Нигерия интересна, но сначала UK"\n` +
        `• "Эти сигналы слишком общие — нужны конкретные компании"\n` +
        `• "Хочу больше fintech и меньше accounting"\n` +
        `• "Казахстан приоритет — говорю по-русски"\n\n` +
        `_ResearchBot и PRBot скорректируют поиск на основе твоего мнения._`
      );
    }
    if (cmd === "menu") {
      // Forward to orchestrator menu via shared tgSendToKirill
      const { orchestratorTick } = await import("./orchestrator.mjs").catch(() => ({}));
      await sendMessage(
        `🤖 *Главное меню*\n\nЧем займёмся?`,
        { reply_markup: {
          inline_keyboard: [
            [
              { text: "📋 Мои лиды", callback_data: "show_pipeline" },
              { text: "📊 Статус системы", callback_data: "show_status" }
            ],
            [
              { text: "📝 Черновики постов", callback_data: "show_posts" },
              { text: "📧 Email рассылка", callback_data: "show_outreach" }
            ],
            [
              { text: "🎓 Обучить из поста", callback_data: "learn_mode" },
              { text: "🧠 Мои предпочтения", callback_data: "show_feedback" }
            ],
            [
              { text: "☀️ Показать бриф", callback_data: "run_brief" },
              { text: "🔍 Найти лидов сейчас", callback_data: "run_scout" }
            ],
            [
              { text: "🌍 Разведка рынков /intel", callback_data: "cmd:intel" },
              { text: "🎯 Фокус недели (PRBot)", callback_data: "cmd:run_pr" }
            ]
          ]
        }}
      );
    }
    return;
  }

  // ─── NON-LEAD CALLBACKS (меню, тренды, контент, система) ──────────────────
  const parts = data.split(":");
  const action = parts[0];
  const param = parts.slice(1).join(":"); // preserve full param (may contain colons)

  // Главное меню
  if (action === "learn_done") {
    await answerCallback(callbackId, "Режим обучения завершён");
    const { writeFileSync: wfDone } = await import("fs");
    const { resolve: resDone, dirname: dirDone } = await import("path");
    const { fileURLToPath: ftuDone } = await import("url");
    const __dDone = dirDone(ftuDone(import.meta.url));
    wfDone(resDone(__dDone, "../../.data/pending-feedback.json"), JSON.stringify({}));
    const { getIntelligenceKey } = await import("./orchestrator.mjs");
    const posts = (() => { try { return (getIntelligenceKey(db, "content_feedback", "good_examples", "posts") || []).filter(e => e?.text); } catch { return []; }})();
    await sendMessage(
      `🎓 *Обучение завершено!*\n\nВсего примеров: *${posts.length}*\nContentBot будет писать в твоём стиле.`,
      { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "🤖 Главное меню", callback_data: "menu" }]] }}
    );
    return;
  }

  if (action === "menu" || action === "show_pipeline" || action === "show_status" ||
      action === "show_posts" || action === "show_outreach" || action === "learn_mode" ||
      action === "show_feedback" || action === "run_brief" || action === "run_scout" ||
      action === "verbose_off" || action === "verbose_on" || action === "show_stats" ||
      action === "show_ideas" || action === "show_ph" || action === "show_evolution" ||
      action === "show_trends" || action === "show_community" || action === "show_hunter" ||
      action === "show_pr" || action === "show_research" ||
      action === "run_ph" || action === "run_evolution" || action === "run_trend" ||
      action === "show_content_ideas" || action === "toggle_community_pause" || action === "show_community_queue" ||
      action === "run_community" || action === "run_hunter" || action === "run_pr_now") {
    await answerCallback(callbackId);
    if (messageId) await deleteMessage(chatId, messageId);

    if (action === "menu") {
      await sendMessage(
        `🤖 *Главное меню*`,
        { parse_mode: "Markdown", reply_markup: {
          inline_keyboard: [
            // ЛИДЫ
            [{ text: "📋 Мои лиды", callback_data: "show_pipeline" }, { text: "🔍 Найти лидов сейчас", callback_data: "run_scout" }],
            [{ text: "🔗 LinkedIn Hunter", callback_data: "show_hunter" }, { text: "🇵🇭 Philippines", callback_data: "show_ph" }],
            // КОНТЕНТ
            [{ text: "📝 Черновики постов", callback_data: "show_posts" }, { text: "✍️ Контент-идеи", callback_data: "show_content_ideas" }],
            [{ text: "💬 N8N Community", callback_data: "show_community" }, { text: "📧 Email рассылка", callback_data: "show_outreach" }],
            // РАЗВЕДКА
            [{ text: "🌍 Разведка рынков", callback_data: "show_research" }, { text: "🎯 PR Фокус", callback_data: "show_pr" }],
            [{ text: "💡 Мои идеи", callback_data: "show_ideas" }, { text: "🧬 Эволюция системы", callback_data: "show_evolution" }],
            // СИСТЕМА
            [{ text: "☀️ Показать бриф", callback_data: "run_brief" }, { text: "📊 Статус системы", callback_data: "show_status" }],
            [{ text: "🎓 Обучить из поста", callback_data: "learn_mode" }, { text: "🧠 Мои предпочтения", callback_data: "show_feedback" }],
          ]
        }}
      );
    } else if (action === "show_pipeline") {
      await handleLeads(db);
    } else if (action === "show_status") {
      await handleStats(db);
    } else if (action === "run_brief") {
      await sendMessage(`☀️ *Готовлю бриф...*`);
      import("./brief-agent.mjs").then(({ runBriefAgent }) => runBriefAgent()).catch(() => {});
    } else if (action === "run_scout") {
      await sendMessage(`🔍 *Запускаю сканирование лидов...*\nLinkedIn + Reddit + HN. Результат через 1-2 минуты.`);
      import("./linkedin-hunter.mjs").then(({ runLinkedInHunter }) => runLinkedInHunter()).catch(() => {});
      import("./scout-bot.mjs").then(({ runScout }) => runScout()).catch(() => {});
    } else if (action === "run_ph") {
      await sendMessage(`🇵🇭 *Запускаю Philippines Bot...*`);
      import("./ph-bot.mjs").then(({ runPHBot }) => runPHBot()).catch(e => sendMessage(`❌ PHBot error: ${e.message}`));
    } else if (action === "run_evolution") {
      await sendMessage(`🧬 *Запускаю EvolutionBot...*\nАнализ KPI всех ботов. ~2 минуты.`);
      import("./evolution-bot.mjs").then(({ runEvolutionBot }) => runEvolutionBot()).catch(e => sendMessage(`❌ Evolution error: ${e.message}`));
    } else if (action === "run_trend") {
      await sendMessage(`🔮 *Запускаю TrendBot...*`);
      import("./trend-bot.mjs").then(({ runTrend }) => runTrend()).catch(e => sendMessage(`❌ TrendBot error: ${e.message}`));
    } else if (action === "run_community") {
      await sendMessage(`💬 *Запускаю Community Bot...*`);
      import("./community-bot.mjs").then(({ runCommunityBot }) => runCommunityBot()).catch(e => sendMessage(`❌ Community error: ${e.message}`));
    } else if (action === "run_hunter") {
      await sendMessage(`🔗 *Запускаю LinkedIn Hunter...*\nИщу профили по всем рынкам.`);
      import("./linkedin-hunter.mjs").then(({ runLinkedInHunter }) => runLinkedInHunter()).catch(e => sendMessage(`❌ Hunter error: ${e.message}`));
    } else if (action === "run_pr_now") {
      await sendMessage(`🎯 *Запускаю PRBot...*\nВыбираю целевой рынок и ищу LinkedIn профили.`);
      import("./pr-bot.mjs").then(({ runPRBot }) => runPRBot()).catch(e => sendMessage(`❌ PRBot error: ${e.message}`));
    } else if (action === "learn_mode") {
      const { mkdirSync, writeFileSync } = await import("fs");
      const { resolve, dirname } = await import("path");
      const { fileURLToPath } = await import("url");
      const __d = dirname(fileURLToPath(import.meta.url));
      writeFileSync(resolve(__d, "../../.data/pending-feedback.json"), JSON.stringify({ type: "learn_post", askedAt: new Date().toISOString() }));
      await sendMessage(
        `🎓 *Режим обучения*\n\nОтправь текст своего лучшего LinkedIn поста следующим сообщением.\nContentBot изучит стиль и будет писать похоже.`,
        { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "❌ Отмена", callback_data: "menu" }]] }}
      );
    } else if (action === "show_feedback") {
      const { getIntelligenceKey } = await import("./orchestrator.mjs");
      const rejections = (() => { try { return getIntelligenceKey(db, "content_feedback", "rejections", "reasons") || []; } catch { return []; }})();
      const examples = (() => { try { return getIntelligenceKey(db, "content_feedback", "good_examples", "posts") || []; } catch { return []; }})();
      const realExamples = Array.isArray(examples) ? examples.filter(e => e && typeof e.text === "string") : [];
      const realRejections = Array.isArray(rejections) ? rejections.filter(r => r && typeof r.reason === "string") : [];
      let reply = `🧠 *Предпочтения по контенту:*\n\n✅ Постов-примеров: *${realExamples.length}*\n❌ Причин отказа: *${realRejections.length}*`;
      if (realRejections.length > 0) {
        reply += `\n\n*Последние причины "не публикую":*\n` + realRejections.slice(-5).map(r => `• _${r.reason}_`).join("\n");
      }
      await sendMessage(reply, { parse_mode: "Markdown", reply_markup: { inline_keyboard: [
        [{ text: "🎓 Добавить пост-пример", callback_data: "learn_mode" }],
        [{ text: "◀️ Главное меню", callback_data: "menu" }]
      ]}});
    } else if (action === "show_outreach") {
      const sent = db.prepare(`SELECT COUNT(*) as n FROM outreach_emails WHERE status='sent'`).get()?.n || 0;
      const replies = db.prepare(`SELECT COUNT(*) as n FROM outreach_emails WHERE reply_received_at IS NOT NULL`).get()?.n || 0;
      await sendMessage(
        `📧 *Email рассылка*\n\nОтправлено: *${sent}* | Ответов: *${replies}*\n\nАвтоматически каждый будний день в 9 AM Calgary.`,
        { parse_mode: "Markdown", reply_markup: { inline_keyboard: [
          [{ text: "📤 Отправить сейчас (15 писем)", callback_data: "send_outreach_now" }],
          [{ text: "◀️ Главное меню", callback_data: "menu" }]
        ]}}
      );
    } else if (action === "send_outreach_now") {
      await sendMessage(`📤 *Запускаю рассылку...*`);
      import("../outreach/send-outreach.mjs").then(({ runOutreach }) => runOutreach()).catch(() => {});
    } else if (action === "show_ideas") {
      const savedIdeas = getIntelligenceKey(db, "idea-bot", "saved", "list") || [];
      if (!savedIdeas.length) {
        await sendMessage(`💡 *Сохранённых идей нет.*\n\nКаждое утро в 7 AM IdeaBot присылает новые идеи на основе сигналов системы.`,
          { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "◀️ Меню", callback_data: "menu" }]] }}
        );
      } else {
        await sendMessage(`💡 *Сохранённые идеи (${savedIdeas.length}):*`, { parse_mode: "Markdown" });
        for (const idea of savedIdeas.slice(-5)) { // последние 5
          const ideaKey = idea.ideaKey || idea.title?.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 30);
          await sendMessage(
            `💎 *${idea.title}*\n\n` +
            `${idea.opportunity}\n\n` +
            `💰 ${idea.price_point} | 👤 ${idea.icp}\n\n` +
            `⚡ *Первый шаг:* ${idea.first_step_48h}`,
            { parse_mode: "Markdown", reply_markup: { inline_keyboard: [
              [{ text: "🚀 Тестировать — пишем пост", callback_data: `idea_test:${ideaKey}` }],
              [{ text: "🗑 Удалить", callback_data: `idea_delete:${ideaKey}` }]
            ]}}
          );
          await new Promise(r => setTimeout(r, 300));
        }
        await sendMessage(`◀️`, { reply_markup: { inline_keyboard: [[{ text: "◀️ Главное меню", callback_data: "menu" }]] }});
      }

    } else if (action === "show_ph") {
      const niches = getIntelligenceKey(db, "ph-bot", "recon", "niches") || [];
      const commented = getIntelligenceKey(db, "ph-bot", "commented") || {};
      const commentedCount = Object.keys(commented).length;
      const phContacts = (() => { try { return db.prepare("SELECT COUNT(*) as c FROM leads WHERE source_platform='linkedin_ph' AND stage IN ('contacted','replied','won')").get()?.c || 0; } catch { return 0; }})();
      const lastRun = getIntelligenceKey(db, "ph-bot", "monitoring", "last_run");
      const lines = [`🇵🇭 *Philippines Bot*\n`];
      lines.push(`📊 PH контактов: *${phContacts}/10* (нужно для поста)`);
      lines.push(`💬 Прокомментировал тредов: *${commentedCount}*`);
      lines.push(`🕐 Последний запуск: ${lastRun ? new Date(lastRun).toLocaleString("ru-RU") : "нет данных"}`);
      if (niches.length) {
        lines.push(`\n🔥 *Горячие ниши:*`);
        niches.slice(0, 3).forEach(n => lines.push(`• ${n.name}: ${n.why_urgent}`));
      }
      await sendMessage(lines.join("\n"), { parse_mode: "Markdown", reply_markup: { inline_keyboard: [
        [{ text: "🔄 Запустить PHBot сейчас", callback_data: "run_ph" }],
        [{ text: "◀️ Меню", callback_data: "menu" }]
      ]}});

    } else if (action === "show_evolution") {
      const lastEvolution = getIntelligenceKey(db, "evolution", "meta", "last_run");
      const calibration = getIntelligenceKey(db, "evolution", "scoring", "calibration");
      const wins = getIntelligenceKey(db, "evolution", "conversions", "wins") || [];
      const lines = [`🧬 *Evolution Bot*\n`];
      if (lastEvolution) {
        lines.push(`🕐 Последний запуск: ${new Date(lastEvolution.ranAt).toLocaleString("ru-RU")}`);
        lines.push(`🤖 Проанализировано ботов: *${lastEvolution.botsAnalyzed}*`);
        lines.push(`🔄 Эволюций: *${lastEvolution.evolved?.length || 0}*`);
        if (lastEvolution.evolved?.length) lines.push(`📌 Изменены: ${lastEvolution.evolved.join(", ")}`);
      } else {
        lines.push(`_Первый запуск будет сегодня в 3:00 AM_`);
      }
      if (calibration) {
        lines.push(`\n🎯 *Скоринг откалиброван:*`);
        lines.push(`• Минимальный порог: ${calibration.new_min_score}`);
        lines.push(`• _${calibration.insight}_`);
      }
      lines.push(`\n📈 Побед (won): *${wins.length}*`);
      await sendMessage(lines.join("\n"), { parse_mode: "Markdown", reply_markup: { inline_keyboard: [
        [{ text: "🔄 Запустить Evolution сейчас", callback_data: "run_evolution" }],
        [{ text: "◀️ Меню", callback_data: "menu" }]
      ]}});

    } else if (action === "show_trends") {
      const trends = getIntelligenceKey(db, "trend_bot", "saved_ideas", "list") || [];
      const lastTrend = getIntelligenceKey(db, "trend_bot", "last_run", "at");
      const lines = [`🔮 *TrendBot*\n`];
      lines.push(`📌 Сохранено трендов: *${trends.length}*`);
      if (lastTrend) lines.push(`🕐 Последний запуск: ${new Date(lastTrend).toLocaleString("ru-RU")}`);
      if (trends.length) {
        lines.push(`\n*Последние тренды:*`);
        trends.slice(-4).reverse().forEach(t => lines.push(`• ${t.title || t.topic}`));
      }
      await sendMessage(lines.join("\n"), { parse_mode: "Markdown", reply_markup: { inline_keyboard: [
        [{ text: "🔄 Запустить TrendBot", callback_data: "run_trend" }],
        [{ text: "◀️ Меню", callback_data: "menu" }]
      ]}});

    } else if (action === "show_community") {
      const answered = (() => { try { return db.prepare("SELECT COUNT(*) as c FROM bot_intelligence WHERE bot_id='community-bot' AND insight_type='confirmed_published'").get()?.c || 0; } catch { return 0; }})();
      const queued = (() => { try { return db.prepare("SELECT COUNT(*) as c FROM bot_intelligence WHERE bot_id='community-bot' AND insight_type='queued_answers'").get()?.c || 0; } catch { return 0; }})();
      const paused = getIntelligenceKey(db, "community-bot", "settings", "paused");
      const lastRun = getIntelligenceKey(db, "community-bot", "meta", "last_run");
      await sendMessage(
        `💬 *N8N Community Bot*\n\n` +
        `${paused ? "⏸ *ПАУЗА* — карточки копятся в очереди" : "▶️ Активен"}\n` +
        `✅ Опубликовано: *${answered}*\n` +
        `📦 В очереди: *${queued}*\n` +
        `🕐 Последний запуск: ${lastRun ? new Date(lastRun).toLocaleString("ru-RU") : "нет данных"}`,
        { parse_mode: "Markdown", reply_markup: { inline_keyboard: [
          [{ text: paused ? "▶️ Включить уведомления" : "⏸ Пауза уведомлений", callback_data: "toggle_community_pause" }],
          [{ text: "📦 Показать очередь", callback_data: "show_community_queue" }],
          [{ text: "🔄 Запустить Community Bot", callback_data: "run_community" }],
          [{ text: "◀️ Меню", callback_data: "menu" }]
        ]}}
      );

    } else if (action === "show_hunter") {
      const found = (() => { try { return db.prepare("SELECT COUNT(*) as c FROM leads WHERE source='linkedin_hunter' AND created_at > datetime('now', '-7 days')").get()?.c || 0; } catch { return 0; }})();
      const total = (() => { try { return db.prepare("SELECT COUNT(*) as c FROM leads WHERE source='linkedin_hunter'").get()?.c || 0; } catch { return 0; }})();
      const lastRun = getIntelligenceKey(db, "linkedin-hunter", "meta", "last_run");
      await sendMessage(
        `🔗 *LinkedIn Hunter*\n\n` +
        `👤 Найдено за 7 дней: *${found}*\n` +
        `📊 Всего в базе: *${total}*\n` +
        `🕐 Последний запуск: ${lastRun ? new Date(lastRun).toLocaleString("ru-RU") : "нет данных"}`,
        { parse_mode: "Markdown", reply_markup: { inline_keyboard: [
          [{ text: "🔄 Запустить Hunter сейчас", callback_data: "run_hunter" }],
          [{ text: "◀️ Меню", callback_data: "menu" }]
        ]}}
      );

    } else if (action === "toggle_community_pause") {
      const paused = getIntelligenceKey(db, "community-bot", "settings", "paused");
      if (paused) {
        db.prepare(`DELETE FROM bot_intelligence WHERE bot_id = 'community-bot' AND insight_type = 'settings' AND key = 'paused'`).run();
        await sendMessage(`▶️ *Community Bot включён.* Карточки будут приходить в Telegram.`);
      } else {
        setIntelligence(db, "community-bot", "settings", "paused", true, 100);
        await sendMessage(`⏸ *Community Bot на паузе.* Поиск продолжается, карточки копятся в очереди.`);
      }

    } else if (action === "show_community_queue") {
      const queued = db.prepare(`SELECT key, value_json FROM bot_intelligence WHERE bot_id = 'community-bot' AND insight_type = 'queued_answers' ORDER BY updated_at DESC LIMIT 5`).all();
      if (!queued.length) {
        await sendMessage(`📦 *Очередь пуста.*`, { parse_mode: "Markdown" });
      } else {
        for (const row of queued) {
          try {
            const data = JSON.parse(row.value_json);
            await sendMessage(
              `📦 *${(data.question?.title || "?").slice(0, 70)}*\nScore: ${data.scoring?.score || "?"}/100\n\n<code>${(data.answer || "").slice(0, 300)}</code>\n\n<a href="${data.question?.url || ""}">Открыть</a>`,
              { parse_mode: "HTML" }
            );
          } catch {}
        }
      }

    } else if (action === "show_content_ideas") {
      const ideas = db.prepare(
        `SELECT key, value_json FROM bot_intelligence WHERE bot_id = 'content-bot' AND insight_type = 'content_ideas' ORDER BY updated_at DESC LIMIT 10`
      ).all();

      if (!ideas.length) {
        await sendMessage(`✍️ *Контент-идеи*\n\n_Пока нет идей. Система собирает тренды и сигналы — идеи появятся после следующего сканирования._`, {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [[{ text: "◀️ Меню", callback_data: "menu" }]] }
        });
      } else {
        // Show each idea with "Write post" button
        for (const row of ideas.slice(0, 5)) {
          try {
            const idea = JSON.parse(row.value_json);
            const text = [
              `✍️ <b>${(idea.title || "Без названия").slice(0, 80)}</b>`,
              idea.score ? `Скор: ${idea.score}/100` : "",
              idea.hook ? `\n<i>${idea.hook.slice(0, 200)}</i>` : "",
              idea.category ? `\nКатегория: ${idea.category}` : "",
              idea.source ? `Источник: ${idea.source}` : "",
            ].filter(Boolean).join("\n");

            await tgSendToKirill(text, { reply_markup: { inline_keyboard: [
              [{ text: "📝 Написать пост", callback_data: `write_post:${row.key}` }],
              [{ text: "❌ Удалить", callback_data: `delete_idea:${row.key}` }],
            ]}});
          } catch {}
        }
      }

    } else if (action === "show_research") {
      await handleIntel(db);

    } else if (action === "show_pr") {
      const prTarget = getIntelligenceKey(db, "pr-bot", "current_target_market", "market");
      const lastRun = getIntelligenceKey(db, "pr-bot", "meta", "last_run");
      const lines = [`🎯 *PR Bot*\n`];
      if (prTarget?.market) {
        lines.push(`🌍 Текущий фокус: *${prTarget.market}*`);
        lines.push(`📅 До: ${new Date(prTarget.expiresAt).toLocaleDateString("ru-RU")}`);
        if (prTarget.reasoning) lines.push(`_${prTarget.reasoning}_`);
      } else {
        lines.push(`_Фокус не установлен_`);
      }
      if (lastRun) lines.push(`\n🕐 Последний запуск: ${new Date(lastRun).toLocaleString("ru-RU")}`);
      await sendMessage(lines.join("\n"), { parse_mode: "Markdown", reply_markup: { inline_keyboard: [
        [{ text: "🔄 Запустить PRBot", callback_data: "run_pr_now" }],
        [{ text: "◀️ Меню", callback_data: "menu" }]
      ]}});
    }

    return;
  }

  // ─── TREND CALLBACKS ───────────────────────────────────────────────────────
  if (action === "trend_post" || action === "trend_save" || action === "trend_skip") {
    const trendKey = param;
    const { getIntelligence, setIntelligence, createTask } = await import("./orchestrator.mjs");
    const trend = getIntelligence(db, "trend_bot", "pending_trends", trendKey);

    if (action === "trend_post") {
      await answerCallback(callbackId, "✍️ Пишу пост...");
      if (trend) {
        createTask(db, {
          fromBot: "telegram-control", toBot: "content_factory",
          taskType: "draft_linkedin_post",
          payload: trend,
          priority: 10
        });
        await sendMessage(`✍️ *ContentBot пишет пост о тренде:*\n_${trend.title}_\n\nЧерновик придёт через 1-2 минуты.`);
      } else {
        await sendMessage(`❌ Данные тренда не найдены. Попробуй снова через /trend`);
      }
    } else if (action === "trend_save") {
      await answerCallback(callbackId, "💡 Сохранено!");
      if (trend) {
        const { setIntelligence: si } = await import("./orchestrator.mjs");
        const saved = (() => { try { return getIntelligence(db, "trend_bot", "saved_ideas", "list") || []; } catch { return []; }})();
        saved.push({ ...trend, savedAt: new Date().toISOString() });
        si(db, "trend_bot", "saved_ideas", "list", saved.slice(-20), 100);
        await sendMessage(`💡 *Идея сохранена.*\n_${trend.title}_`, { parse_mode: "Markdown", reply_markup: { inline_keyboard: [
          [{ text: "✍️ Написать пост сейчас", callback_data: `trend_post:${trendKey}` }],
          [{ text: "◀️ Главное меню", callback_data: "menu" }]
        ]}});
      }
    } else if (action === "trend_skip") {
      await answerCallback(callbackId, "Пропущен");
      await sendMessage(`❌ *Тренд пропущен.* TrendBot учтёт это.`, { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "◀️ Главное меню", callback_data: "menu" }]] }});
    }
    return;
  }

  // ─── IMAGE FINDER ──────────────────────────────────────────────────────────
  if (action === "get_image") {
    const postId = param;
    await answerCallback(callbackId, "🔍 Ищу фото...");
    await sendMessage(`🔍 *Ищу изображение...*\nПроверяю GitHub, сайт проекта. Если не найду — сгенерирую через DALL-E.`);

    try {
      const { getIntelligence, env: orchEnv } = await import("./orchestrator.mjs");
      const meta = getIntelligence(db, "content", "post_meta", postId);
      const imageUrl = await findOrGenerateImage(meta?.sourceUrl, meta?.hook, meta?.sourceInfo, orchEnv);

      if (imageUrl) {
        // Send as photo
        await tgAPI("sendPhoto", {
          chat_id: CHAT_ID,
          photo: imageUrl,
          caption: `🖼 *Фото для поста*\n\n${meta?.hook || ""}\n\n_Прикрепи к посту в LinkedIn перед публикацией._`,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "✅ Опубликовал в LinkedIn", callback_data: `mark_published:${postId}` }],
              [{ text: "🔄 Сгенерировать другое", callback_data: `gen_image:${postId}` }],
              [{ text: "❌ Не публикую — скажу почему", callback_data: `not_publishing:${postId}` }]
            ]
          }
        });
      } else {
        await sendMessage(`❌ Не смог найти изображение. Попробуй нажать снова — иногда GitHub rate-limits.`);
      }
    } catch (e) {
      await sendMessage(`❌ Ошибка: ${e.message}`);
    }
    return;
  }

  // Сгенерировать новое изображение (DALL-E принудительно)
  if (action === "gen_image") {
    const postId = param;
    await answerCallback(callbackId, "🎨 Генерирую...");
    await sendMessage(`🎨 *DALL-E генерирует изображение...*\nЗаймёт 15-30 секунд.`);
    try {
      const { getIntelligence, env: orchEnv } = await import("./orchestrator.mjs");
      const meta = getIntelligence(db, "content", "post_meta", postId);
      const imageUrl = await generateImageDallE(meta?.hook, meta?.sourceInfo, orchEnv);
      if (imageUrl) {
        await tgAPI("sendPhoto", {
          chat_id: CHAT_ID,
          photo: imageUrl,
          caption: `🎨 *Сгенерировано DALL-E*\n\n${meta?.hook || ""}`,
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [
            [{ text: "✅ Опубликовал в LinkedIn", callback_data: `mark_published:${postId}` }],
            [{ text: "🔄 Сгенерировать ещё", callback_data: `gen_image:${postId}` }],
          ]}
        });
      }
    } catch (e) {
      await sendMessage(`❌ DALL-E ошибка: ${e.message}`);
    }
    return;
  }

  // ─── REDDIT CALLBACKS ──────────────────────────────────────────────────────
  if (action === "adapt_reddit") {
    const postId = param;
    await answerCallback(callbackId, "Адаптирую для Reddit...");
    const { getIntelligenceKey } = await import("./orchestrator.mjs");
    const { adaptForReddit, sendRedditDraftToKirill, isRedditConfigured } = await import("./reddit-publisher.mjs");

    if (!isRedditConfigured()) {
      await sendMessage(
        `⚙️ *Reddit не настроен*\n\nДобавь в .env:\n` +
        `<code>REDDIT_CLIENT_ID=...\nREDDIT_CLIENT_SECRET=...\nREDDIT_USERNAME=...\nREDDIT_PASSWORD=...</code>\n\n` +
        `Создай приложение: reddit.com/prefs/apps → script type`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const meta = getIntelligenceKey(db, "content", "post_meta", postId);
    if (!meta) { await sendMessage("Черновик не найден"); return; }

    await sendMessage(`⏳ Адаптирую для Reddit...`);
    try {
      // Pick the best subreddit based on content
      const subreddit = meta.sourceInfo?.toLowerCase().includes("calgary") ? "Calgary" : "smallbusiness";
      const adapted = await adaptForReddit(meta, subreddit);
      await sendRedditDraftToKirill(adapted, meta);
    } catch (e) {
      await sendMessage(`❌ Ошибка адаптации: ${e.message}`);
    }
    return;
  }

  if (action === "post_reddit" || action === "skip_reddit") {
    const draftId = param;
    await answerCallback(callbackId);
    const { getIntelligenceKey } = await import("./orchestrator.mjs");
    const draft = getIntelligenceKey(db, "reddit", "pending_posts", draftId);

    if (action === "post_reddit" && draft) {
      // Hybrid mode: show ready-to-paste text, Kirill posts manually
      await sendMessage(
        `📋 <b>Готово для публикации в r/${draft.subreddit}</b>\n\n` +
        `1️⃣ Открой: <a href="https://www.reddit.com/r/${draft.subreddit}/submit">reddit.com/r/${draft.subreddit}/submit</a>\n` +
        `2️⃣ Выбери "Text"\n` +
        `3️⃣ Вставь заголовок:\n<code>${draft.title}</code>\n\n` +
        `4️⃣ Вставь текст:\n<code>${(draft.body || "").slice(0, 900)}</code>`,
        { reply_markup: { inline_keyboard: [[{ text: "🤖 Меню", callback_data: "menu" }]] }}
      );
    } else {
      await sendMessage(`Пропущено.`, { reply_markup: { inline_keyboard: [[{ text: "🤖 Меню", callback_data: "menu" }]] }});
    }
    return;
  }

  if (action === "post_reddit_comment" || action === "skip_reddit_comment") {
    const commentId = param;
    await answerCallback(callbackId);
    const { getIntelligenceKey } = await import("./orchestrator.mjs");
    const data = getIntelligenceKey(db, "reddit", "pending_comments", commentId);

    if (action === "post_reddit_comment" && data) {
      // Hybrid mode: show comment text + link, Kirill posts manually
      await sendMessage(
        `💬 <b>Готовый ответ — скопируй и вставь:</b>\n\n` +
        `🔗 <a href="${data.post.url}">${data.post.url}</a>\n\n` +
        `<code>${data.comment.comment}</code>`,
        { reply_markup: { inline_keyboard: [[{ text: "🤖 Меню", callback_data: "menu" }]] }}
      );
    } else {
      await sendMessage(`Пропущено.`, { reply_markup: { inline_keyboard: [[{ text: "🤖 Меню", callback_data: "menu" }]] }});
    }
    return;
  }

  // ─── OPPORTUNITY PROMOTION / DEFERRAL ───────────────────────────────────────
  if (action === "promote_opp") {
    if (messageId) await deleteMessage(chatId, messageId);
    // Idempotency: check if already promoted
    const existingOpp = db.prepare(`SELECT decision, linked_project_id FROM opportunities WHERE id = ?`).get(param);
    if (existingOpp?.decision === "promoted") {
      await answerCallback(callbackId, "Уже в работе");
      return;
    }
    await answerCallback(callbackId, "🚀 Создаю проект...");
    const { createProjectFromOpportunity, callAI, MODEL_STRONG, getSystemMission } = await import("./orchestrator.mjs");
    const projectId = createProjectFromOpportunity(db, param);
    if (!projectId) { await sendMessage(`❌ Не удалось создать проект.`); return; }
    if (messageId) await deleteMessage(chatId, messageId);

    const project = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId);
    const opp = db.prepare(`SELECT * FROM opportunities WHERE id = ?`).get(param);
    await sendMessage(`🚀 *Проект "${project.name}" создан!*\n_Генерирую execution packets с готовыми материалами... (30-60 сек)_`);

    // ═══ DATA QUALITY LAYER — filter leads BEFORE sending to GPT ═══
    const market = (project.linked_market || opp?.market || "").toLowerCase();
    const isPhilippines = market.includes("philipp") || market.includes("manila") || market.includes("cebu");

    // 1. Get leads filtered by LOCATION + MARKET match
    let matchingLeads = [];
    if (isPhilippines) {
      matchingLeads = db.prepare(`SELECT name, linkedin_url, source_url, score, pain_description, notes, source_platform, location
        FROM leads WHERE score >= 40 AND (
          source_platform LIKE '%ph%' OR location LIKE '%philipp%' OR location LIKE '%manila%' OR location LIKE '%cebu%'
          OR pain_description LIKE '%BPO%' OR pain_description LIKE '%Philippines%' OR pain_description LIKE '%fintech%'
          OR source_platform = 'linkedin_ph'
        ) ORDER BY score DESC LIMIT 20`).all();
    } else {
      matchingLeads = db.prepare(`SELECT name, linkedin_url, source_url, score, pain_description, notes, source_platform, location
        FROM leads WHERE score >= 50 AND (pain_description LIKE ? OR notes LIKE ?)
        ORDER BY score DESC LIMIT 20`)
        .all(`%${(opp?.pain || "").split(" ")[0]}%`, `%${(opp?.pain || "").split(" ")[0]}%`);
    }

    // 2. Remove already contacted leads (stage != 'new' and != 'briefed')
    matchingLeads = matchingLeads.filter(l => {
      const stage = db.prepare(`SELECT stage FROM leads WHERE name = ?`).get(l.name)?.stage;
      return stage === "new" || stage === "briefed";
    });

    // 3. Remove leads already used as targets in ANY active project
    const usedTargetNames = db.prepare(`SELECT DISTINCT target_name FROM step_artifacts WHERE status IN ('sent', 'pending') AND target_name != ''`).all().map(r => r.target_name.toLowerCase());
    matchingLeads = matchingLeads.filter(l => !usedTargetNames.includes(l.name.toLowerCase()));

    // 4. Get Reddit threads already commented (don't suggest again)
    const commentedThreads = db.prepare(`SELECT value_json FROM bot_intelligence WHERE bot_id = 'reddit' AND insight_type = 'monitoring'`).all()
      .map(r => { try { return JSON.parse(r.value_json).postUrl; } catch { return null; } }).filter(Boolean);

    const leadsContext = matchingLeads.length > 0
      ? matchingLeads.map(l => `${l.name} (${l.score}/100, ${l.source_platform}, ${l.location || "?"}) — ${l.pain_description?.slice(0, 60) || ""} ${l.linkedin_url || l.source_url || ""}`).join("\n")
      : "No matching leads for this market in DB. Use community/platform targets instead.";

    const alreadyCommented = commentedThreads.length > 0
      ? `\nALREADY COMMENTED Reddit threads (DO NOT suggest these): ${commentedThreads.slice(0, 10).join(", ")}`
      : "";

    // Ground truth checks BEFORE generation
    const { canPublishToday } = await import("./orchestrator.mjs");
    const canPost = canPublishToday(db);

    const channelConstraints = [
      `CHANNEL CONSTRAINTS FOR THIS PROJECT:`,
      isPhilippines
        ? `Market is Philippines. DO NOT use LinkedIn posts — Kirill has 0 PH followers. Use: Facebook groups (Shopee Sellers PH, Lazada Sellers PH, Ecommerce Philippines), OnlineJobs.ph, Kalibrr, local Telegram groups. LinkedIn DMs are OK only if target has a real LinkedIn profile.`
        : `Market is ${market || "global"}. LinkedIn posts OK. LinkedIn DMs OK.`,
      canPost ? `Content: CAN publish 1 post today (max 1 per 2 days).` : `Content: CANNOT publish today — posted recently. Skip content steps.`,
      `URL RULES: Only use LinkedIn URLs from the EXISTING LEADS list below. Do NOT invent URLs. If no URL exists for a target, set url to empty string.`,
    ].join("\n");

    // Generate EXECUTION PACKETS with per-target structure
    const plan = await callAI(
      `${getSystemMission()}

${channelConstraints}

You are building EXECUTION PACKETS. Each step contains TARGETS — individual actionable items.

RULES:
- Max 5 steps
- Each target = one person to DM, one community to join, or one post to publish
- ONLY use people/URLs from the EXISTING LEADS list below. Never invent LinkedIn URLs.
- NEVER use the same person in multiple steps. Each person appears ONCE in the entire plan.
- For Philippines: use Facebook groups, Kalibrr, OnlineJobs.ph — NOT LinkedIn posts
- Write the ACTUAL message for each target (max 200 chars for LinkedIn DMs, write COMPLETE text, do not truncate)
- Maximum 1 content post step. If canPost=false, skip content entirely.
- Do NOT suggest Reddit threads that are in the ALREADY COMMENTED list below.

Return JSON: {
  "steps": [{
    "action": "what this step achieves",
    "type": "outreach|content|community|research|follow_up",
    "why": "why this matters",
    "done_when": "completion criteria",
    "targets": [
      {"name": "person/group name", "url": "REAL url from leads list or known platform URL", "why_first": "reason", "message": "complete ready-to-send text, not truncated"}
    ]
  }]
}`,
      `Project: ${project.name}
Goal: ${project.goal}
Market: ${market}
ICP: ${opp?.icp}
Pain: ${opp?.pain}
${alreadyCommented}
Entry path: ${opp?.entry_path}
Can publish content today: ${canPost}
Is Philippines market: ${isPhilippines}

EXISTING LEADS WITH VERIFIED URLS (use ONLY these URLs):
${leadsContext}

ACTIVE HYPOTHESES TO TEST (integrate into steps where possible):
${(() => { try { return db.prepare("SELECT hypothesis, cheapest_test, priority_score FROM hypotheses WHERE status = 'active' ORDER BY priority_score DESC LIMIT 3").all().map(h => `- [${h.priority_score}] ${h.hypothesis} → Test: ${h.cheapest_test}`).join("\n") || "No active hypotheses"; } catch { return "No hypotheses"; } })()}

DISCONFIRMED (avoid these approaches):
${(() => { try { return db.prepare("SELECT hypothesis FROM hypotheses WHERE status = 'disconfirmed' LIMIT 5").all().map(h => `- ${h.hypothesis}`).join("\n") || "None"; } catch { return "None"; } })()}`,
      MODEL_STRONG
    ).catch(() => null);

    if (plan?.steps?.length > 0) {
      const { randomUUID } = await import("crypto");

      // POST-GENERATION DEDUP — remove duplicate targets across steps (code, not GPT)
      const seenTargetNames = new Set();
      for (const s of plan.steps) {
        s.targets = (s.targets || []).filter(t => {
          const key = (t.name || "").toLowerCase().trim();
          if (!key || seenTargetNames.has(key)) return false;
          seenTargetNames.add(key);
          return true;
        });
      }
      // Remove empty steps after dedup
      plan.steps = plan.steps.filter(s => (s.targets || []).length > 0);

      for (let i = 0; i < plan.steps.length; i++) {
        const s = plan.steps[i];
        const stepId = randomUUID();

        db.prepare(`INSERT INTO project_steps (id, project_id, step_number, action, why, expected_outcome, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')`)
          .run(stepId, projectId, i + 1, s.action, s.why, s.done_when);

        // Save each target — validate URLs first
        for (const target of (s.targets || [])) {
          let validUrl = target.url || "";

          // URL validation: check if it's a real page (not invented by GPT)
          if (validUrl && validUrl.includes("linkedin.com")) {
            try {
              const checkUrl = validUrl.startsWith("http") ? validUrl : "https://" + validUrl;
              const res = await fetch(checkUrl, { method: "HEAD", signal: AbortSignal.timeout(5000), headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow" });
              if (!res.ok && res.status !== 999) { // LinkedIn returns 999 for non-logged but page exists
                console.log(`[Ground Truth] Invalid URL removed: ${validUrl} (${res.status})`);
                validUrl = ""; // Remove fake URL
              }
            } catch {
              // Timeout or network error — keep URL (might be LinkedIn blocking)
            }
          }

          db.prepare(`INSERT INTO step_artifacts (id, step_id, project_id, artifact_type, title, content, url, target_name, target_url, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`)
            .run(randomUUID(), stepId, projectId, s.type || "outreach", target.why_first || "", target.message || target.name, validUrl, target.name || "", validUrl);
        }
      }

      db.prepare(`UPDATE projects SET status = 'execution', current_stage = 'step_1', updated_at = datetime('now') WHERE id = ?`).run(projectId);

      // Show first target of step 1
      await showNextTarget(db, projectId, project.name);
    } else {
      await sendMessage(`⚠️ Не удалось сгенерировать план. Попробуй позже.`);
    }
    return;
  }
  if (action === "defer_opp") {
    await answerCallback(callbackId, "⏸ Отложено");
    db.prepare(`UPDATE opportunities SET decision = 'deferred', decision_reason = 'Kirill deferred — not today', reviewed_at = datetime('now') WHERE id = ?`).run(param);
    if (messageId) await deleteMessage(chatId, messageId);
    return;
  }

  // ─── TASK FLOW — step by step execution ─────────────────────────────────────
  // ─── PER-TARGET EXECUTION ──────────────────────────────────────────────────
  if (action === "target_done" || action === "target_skip") {
    const targetId = param;
    if (messageId) await deleteMessage(chatId, messageId);

    // Idempotency
    const target = db.prepare(`SELECT * FROM step_artifacts WHERE id = ?`).get(targetId);
    if (!target || target.status !== "pending") {
      await answerCallback(callbackId, "Уже обработан");
      return;
    }

    const newStatus = action === "target_done" ? "sent" : "skipped";
    await answerCallback(callbackId, action === "target_done" ? "✅ Записал" : "⏭ Пропущен");

    db.prepare(`UPDATE step_artifacts SET status = ?, used_at = datetime('now') WHERE id = ?`)
      .run(newStatus, targetId);

    // Record execution evidence (Layer 1 — Truth)
    if (action === "target_done") {
      const { recordEvidence } = await import("./orchestrator.mjs");
      recordEvidence(db, {
        projectId: target.project_id,
        actionType: target.artifact_type || "outreach",
        channel: (target.target_url || "").includes("linkedin") ? "linkedin_connection"
          : (target.target_url || "").includes("reddit") ? "reddit_comment"
          : (target.target_url || "").includes("facebook") ? "facebook_group"
          : (target.target_url || "").includes("kalibrr") ? "kalibrr"
          : "manual",
        deliveryMode: "manual",
        targetName: target.target_name,
        targetUrl: target.target_url || target.url,
        sentText: target.content,
        sourceStepId: target.step_id,
        sourceArtifactId: target.id,
        approvedByHuman: true,
        outcomeTier: "tier3_action",
      });
    }

    // Get project info and show next target
    const project = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(target.project_id);
    if (project) {
      await showNextTarget(db, target.project_id, project.name);
    }
    return;
  }

  if (action === "step_done") {
    const [projectId, stepNumStr] = param.split(":");
    const stepNum = parseInt(stepNumStr);
    if (messageId) await deleteMessage(chatId, messageId);

    // Idempotency: check if already completed
    const existingStep = db.prepare(`SELECT status FROM project_steps WHERE project_id = ? AND step_number = ?`).get(projectId, stepNum);
    if (existingStep?.status === "completed") {
      await answerCallback(callbackId, "Уже выполнен");
      return;
    }
    await answerCallback(callbackId, "✅ Записал!");

    // Mark step as completed
    db.prepare(`UPDATE project_steps SET status = 'completed', completed_at = datetime('now') WHERE project_id = ? AND step_number = ?`)
      .run(projectId, stepNum);

    // Get next step
    const nextStep = db.prepare(`SELECT * FROM project_steps WHERE project_id = ? AND step_number = ? AND status = 'pending'`).get(projectId, stepNum + 1);
    const totalSteps = db.prepare(`SELECT COUNT(*) as c FROM project_steps WHERE project_id = ?`).get(projectId)?.c || 0;
    const completedSteps = db.prepare(`SELECT COUNT(*) as c FROM project_steps WHERE project_id = ? AND status = 'completed'`).get(projectId)?.c || 0;

    // Update project stage
    db.prepare(`UPDATE projects SET current_stage = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(nextStep ? `step_${stepNum + 1}` : "completed", projectId);

    const project = db.prepare(`SELECT name FROM projects WHERE id = ?`).get(projectId);
    const projectName = project?.name || "Проект";

    if (nextStep) {
      await showNextTarget(db, projectId, projectName);
    } else {
      // All steps done!
      db.prepare(`UPDATE projects SET status = 'waiting_response', current_stage = 'completed_execution', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
        .run(projectId);

      await tgSendToKirill(
        `🎉 <b>Проект "${projectName}" — все шаги выполнены!</b>\n\n` +
        `✅ ${completedSteps}/${totalSteps} шагов завершено.\n\n` +
        `Проект переведён в статус "ожидание ответов". Система отслеживает результаты и напомнит в следующем брифе.`,
        { reply_markup: { inline_keyboard: [[{ text: "🤖 Меню", callback_data: "menu" }]] }}
      );
    }
    return;
  }

  if (action === "step_more") {
    const [projectId, stepNumStr] = param.split(":");
    await answerCallback(callbackId, "📋 Загружаю...");
    if (messageId) await deleteMessage(chatId, messageId);
    const step = db.prepare(`SELECT * FROM project_steps WHERE project_id = ? AND step_number = ?`).get(projectId, parseInt(stepNumStr));
    if (!step) return;
    const artifacts = db.prepare(`SELECT * FROM step_artifacts WHERE step_id = ? ORDER BY rowid`).all(step.id);

    const lines = [`📋 <b>Все цели шага ${stepNumStr} (${artifacts.length}):</b>\n`];

    for (let i = 0; i < artifacts.length; i++) {
      const a = artifacts[i];
      const statusIcon = a.status === "sent" ? "✅" : a.status === "skipped" ? "⏭" : "⏳";
      lines.push(`${statusIcon} <b>${i + 1}. ${a.target_name || "Target"}</b>`);
      if (a.target_url || a.url) lines.push(`   🔗 ${(a.target_url || a.url).slice(0, 60)}`);
      if (a.content) lines.push(`   <code>${a.content.slice(0, 150)}</code>`);
      lines.push(``);
    }

    await tgSendToKirill(lines.join("\n").slice(0, 4000), { reply_markup: { inline_keyboard: [
      [{ text: "◀️ Назад к шагу", callback_data: `resume_project:${projectId}` }],
    ]}});
    return;
  }

  if (action === "step_pause") {
    const [projectId, stepNumStr] = param.split(":");
    await answerCallback(callbackId, "⏸ Поставил на паузу");
    if (messageId) await deleteMessage(chatId, messageId);

    db.prepare(`UPDATE projects SET status = 'paused', updated_at = datetime('now') WHERE id = ?`).run(projectId);

    const project = db.prepare(`SELECT name FROM projects WHERE id = ?`).get(projectId);
    await sendMessage(`⏸ *${project?.name || "Проект"}* на паузе. Продолжим когда скажешь — или завтра в брифе напомню.`);
    return;
  }

  if (action === "resume_project") {
    if (messageId) await deleteMessage(chatId, messageId);
    const projectId = param;

    // Check project status BEFORE doing anything
    const projCheck = db.prepare(`SELECT status, name FROM projects WHERE id = ?`).get(projectId);
    if (!projCheck) { await answerCallback(callbackId, "Проект не найден"); return; }
    if (projCheck.status === "waiting_response" || projCheck.status === "completed") {
      await answerCallback(callbackId, "Проект уже завершён");
      await sendMessage(`📁 *${projCheck.name}* — все шаги выполнены. Ожидаем ответов.`);
      return;
    }

    await answerCallback(callbackId, "▶️ Продолжаем!");
    if (projCheck.status === "paused") {
      db.prepare(`UPDATE projects SET status = 'execution', updated_at = datetime('now') WHERE id = ?`).run(projectId);
    }

    // Find next pending step
    const nextStep = db.prepare(`SELECT * FROM project_steps WHERE project_id = ? AND status = 'pending' ORDER BY step_number ASC LIMIT 1`).get(projectId);
    const totalSteps = db.prepare(`SELECT COUNT(*) as c FROM project_steps WHERE project_id = ?`).get(projectId)?.c || 0;
    const completedSteps = db.prepare(`SELECT COUNT(*) as c FROM project_steps WHERE project_id = ? AND status = 'completed'`).get(projectId)?.c || 0;
    const project = db.prepare(`SELECT name FROM projects WHERE id = ?`).get(projectId);

    if (nextStep) {
      await showNextTarget(db, projectId, project?.name || "Проект");
    } else {
      await sendMessage(`✅ Все шаги проекта выполнены.`);
    }
    return;
  }

  // ─── PROJECT STEP CALLBACKS (legacy) ──────────────────────────────────────
  if (action === "project_step") {
    const parts = param.split(":");
    const projectId = parts[0];
    const step = parts.slice(1).join(":");
    await answerCallback(callbackId, "✅ Записал!");

    const project = getIntelligenceKey(db, "orchestrator", "active_projects", projectId) || {};
    const stepsDone = project.steps_done || [];
    stepsDone.push({ step, at: new Date().toISOString() });
    setIntelligence(db, "orchestrator", "active_projects", projectId, {
      ...project, steps_done: stepsDone, lastStepAt: new Date().toISOString(),
    }, 90);

    if (messageId) await deleteMessage(chatId, messageId);

    const messages = {
      "post_done": "✅ Пост опубликован! Переходи к шагу 2 — отправь 10-15 DM.",
      "dms_sent": "✅ DMs отправлены! Жди ответов. Система отслеживает LinkedIn уведомления.",
      "find_targets": "🔍 LinkedInHunter ищет 30 целей для SaaS Amnesty...",
      "client_yes": "🚀 Отлично! Напиши имя клиента и я запущу BuilderBot — создам шаблон аудита.",
      "rewrite_post": "📝 Генерирую новый вариант поста...",
    };

    await sendMessage(messages[step] || `✅ Шаг "${step}" записан.`);

    if (step === "find_targets") {
      sendEventBus(db, {
        fromBot: "telegram-control", toBot: "scout-bot",
        messageType: "lead_pain_signal",
        payload: {
          niche: "SaaS Waste Recovery",
          pain: "duplicate SaaS tools, dead seats, zombie renewals, overlapping subscriptions",
          source: "active_project",
          instructions: "Find founders/COOs/ops managers of companies with 10-100 employees. Agencies, e-commerce, service businesses. Any market.",
        },
        priority: 10
      });
      sendEventBus(db, {
        fromBot: "telegram-control", toBot: "linkedin-hunter",
        messageType: "hunt_profiles",
        payload: {
          niche: "SaaS Waste Recovery targets",
          queries: [
            '"founder" "agency" "10" OR "20" OR "30" employees "SaaS" OR "tools"',
            '"COO" OR "operations manager" "startup" "software" OR "subscriptions"',
            '"founder" "e-commerce" OR "ecommerce" "team" "tools" OR "stack"',
          ],
        },
        priority: 9
      });
    }

    return;
  }

  // ─── REDDIT MONITORING — confirm post was published ───────────────────────
  if (action === "confirm_reddit_post") {
    const commentId = param;
    await answerCallback(callbackId);
    const { getIntelligenceKey, setIntelligence } = await import("./orchestrator.mjs");
    const data = getIntelligenceKey(db, "reddit", "pending_comments", commentId);

    if (data?.post?.url) {
      const monitorId = `monitor_${Date.now()}`;
      setIntelligence(db, "reddit", "monitoring", monitorId, {
        monitorId,
        postUrl: data.post.url,
        subreddit: data.post.subreddit,
        title: data.post.title,
        monitoredSince: Date.now(),
        seenCommentIds: [],
      }, 30); // keep 30 days

      await sendMessage(
        `👁 <b>Мониторинг включён</b>\n\nБуду проверять ответы каждые 2ч:\n<i>${data.post.title}</i>\n\nКак только кто-то ответит — пришлю тебе.`,
        { reply_markup: { inline_keyboard: [[{ text: "🤖 Меню", callback_data: "menu" }]] }}
      );
    } else {
      await sendMessage(`Не могу найти данные поста.`, { reply_markup: { inline_keyboard: [[{ text: "🤖 Меню", callback_data: "menu" }]] }});
    }
    return;
  }

  // ─── REDDIT REPLY CALLBACKS ─────────────────────────────────────────────────
  if (action === "reddit_replied") {
    const replyKey = param;
    await answerCallback(callbackId, "✅ Записал — слежу за продолжением");
    const ctx = getIntelligenceKey(db, "reddit", "reply_context", replyKey);
    if (ctx) {
      // Record that Kirill replied to this person
      const conversations = getIntelligenceKey(db, "reddit", "conversations", "active") || [];
      conversations.push({
        author: ctx.author,
        subreddit: ctx.subreddit,
        postUrl: ctx.postUrl,
        postTitle: ctx.postTitle,
        isLead: ctx.isLead,
        repliedAt: new Date().toISOString(),
      });
      setIntelligence(db, "reddit", "conversations", "active", conversations.slice(-50), 30);

      // CRITICAL: Add this comment ID to seenCommentIds so reddit-monitor stops re-notifying
      if (ctx.commentId && ctx.monitorId) {
        const monitor = getIntelligenceKey(db, "reddit", "monitoring", ctx.monitorId);
        if (monitor) {
          const seen = monitor.seenCommentIds || [];
          if (!seen.includes(ctx.commentId)) {
            seen.push(ctx.commentId);
            setIntelligence(db, "reddit", "monitoring", ctx.monitorId, { ...monitor, seenCommentIds: seen }, 30);
            console.log(`[telegram-control] Added ${ctx.commentId} to seenCommentIds for ${ctx.monitorId}`);
          }
        }
      }

      // If potential lead — notify ScoutBot to research this person
      if (ctx.isLead) {
        sendEventBus(db, {
          fromBot: "reddit-monitor",
          toBot: "scout-bot",
          messageType: "lead_pain_signal",
          payload: {
            name: ctx.author,
            source: "reddit",
            subreddit: ctx.subreddit,
            postUrl: ctx.postUrl,
            pain: ctx.body,
          },
          priority: 8
        });
      }
    }
    if (messageId) await deleteMessage(chatId, messageId);
    return;
  }
  if (action === "reddit_skip") {
    await answerCallback(callbackId, "⏭ Пропущено");
    // Also add to seenCommentIds so it doesn't come back
    const skipCtx = getIntelligenceKey(db, "reddit", "reply_context", param);
    if (skipCtx?.commentId && skipCtx?.monitorId) {
      const monitor = getIntelligenceKey(db, "reddit", "monitoring", skipCtx.monitorId);
      if (monitor) {
        const seen = monitor.seenCommentIds || [];
        if (!seen.includes(skipCtx.commentId)) {
          seen.push(skipCtx.commentId);
          setIntelligence(db, "reddit", "monitoring", skipCtx.monitorId, { ...monitor, seenCommentIds: seen }, 30);
        }
      }
    }
    if (messageId) await deleteMessage(chatId, messageId);
    return;
  }

  // ─── REDDIT COMMENT OUTBOUND TRACKING (rcm = reddit comment) ───────────────
  // Used when Kirill posts an outbound Reddit comment from a draft I sent him.
  if (action === "rcm_posted") {
    const leadId = param;
    await answerCallback(callbackId, "✅ Отмечено как posted, отслеживаю");
    try {
      const now = new Date().toISOString();
      db.prepare(`UPDATE leads SET stage='contacted', last_contact_at=?, updated_at=? WHERE id=?`)
        .run(now, now, leadId);
      // Update lead_interactions outcome
      try {
        db.prepare(`UPDATE lead_interactions SET kirill_approved=1, outcome='sent' WHERE lead_id=? AND outcome='pending'`)
          .run(leadId);
      } catch {}
    } catch (e) { console.error("[rcm_posted] db update failed:", e.message); }
    if (messageId) await deleteMessage(chatId, messageId);
    return;
  }
  // Insight publishing pipeline (Apr 7 2026)
  if (action === "insight_approve") {
    const slug = param;
    await answerCallback(callbackId, "📤 Publishing...");
    try {
      const { spawnSync } = await import("child_process");
      const r = spawnSync("node", ["scripts/factory/publish-insight.mjs", slug], {
        cwd: "$CLAUDE_PROJECT_DIR",
        encoding: "utf-8",
        timeout: 6 * 60 * 1000,
      });
      const out = (r.stdout || "") + (r.stderr || "");
      if (r.status === 0) {
        await sendMessage(`✅ Published: https://launchsoloai.com/insights/${slug}.html\n\nIndex regenerated, sitemap updated, deployed.`);
      } else {
        await sendMessage(`❌ Publish failed for ${slug}\n\nExit ${r.status}\n${out.slice(-800)}`);
      }
    } catch (e) {
      await sendMessage(`❌ Publish exception: ${e.message}`);
    }
    if (messageId) await deleteMessage(chatId, messageId);
    return;
  }
  if (action === "insight_reject") {
    const slug = param;
    await answerCallback(callbackId, "❌ Rejected");
    try {
      const { unlinkSync } = await import("fs");
      unlinkSync(`$CLAUDE_PROJECT_DIR/sandbox-review/site/insights/drafts/${slug}.md`);
      await sendMessage(`Draft ${slug} deleted from drafts/`);
    } catch (e) { console.error("[insight_reject]", e.message); }
    if (messageId) await deleteMessage(chatId, messageId);
    return;
  }
  if (action === "insight_edit") {
    const slug = param;
    await answerCallback(callbackId, "Open file in editor");
    await sendMessage(`Edit at: sandbox-review/site/insights/drafts/${slug}.md\n\nAfter editing, run from terminal: node scripts/factory/publish-insight.mjs ${slug}`);
    return;
  }

  // Vibe-code (and any future) DM tracking. Same shape as rcm_posted.
  if (action === "vc_dm_sent" || action === "dm_sent") {
    const leadId = param;
    await answerCallback(callbackId, "📤 DM logged as sent");
    try {
      const now = new Date().toISOString();
      const r = db.prepare(`UPDATE leads SET stage='contacted', last_contact_at=?, updated_at=? WHERE id=?`)
        .run(now, now, leadId);
      if (r.changes === 0) console.error(`[vc_dm_sent] no lead matched id=${leadId}`);
      try {
        db.prepare(`UPDATE lead_interactions SET kirill_approved=1, outcome='sent' WHERE lead_id=? AND outcome='pending'`)
          .run(leadId);
      } catch {}
    } catch (e) { console.error("[vc_dm_sent] db update failed:", e.message); }
    if (messageId) await deleteMessage(chatId, messageId);
    return;
  }
  if (action === "vc_dm_skip" || action === "dm_skip") {
    const leadId = param;
    await answerCallback(callbackId, "⏭ Skipped");
    try {
      db.prepare(`UPDATE leads SET stage='skipped', updated_at=? WHERE id=?`)
        .run(new Date().toISOString(), leadId);
      try {
        db.prepare(`UPDATE lead_interactions SET kirill_approved=0, outcome='skipped' WHERE lead_id=? AND outcome='pending'`)
          .run(leadId);
      } catch {}
    } catch (e) { console.error("[vc_dm_skip] db update failed:", e.message); }
    if (messageId) await deleteMessage(chatId, messageId);
    return;
  }
  if (action === "rcm_skip") {
    const leadId = param;
    await answerCallback(callbackId, "⏭ Skipped");
    try {
      db.prepare(`UPDATE leads SET stage='skipped', updated_at=? WHERE id=?`)
        .run(new Date().toISOString(), leadId);
      try {
        db.prepare(`UPDATE lead_interactions SET kirill_approved=0, outcome='skipped' WHERE lead_id=? AND outcome='pending'`)
          .run(leadId);
      } catch {}
    } catch (e) { console.error("[rcm_skip] db update failed:", e.message); }
    if (messageId) await deleteMessage(chatId, messageId);
    return;
  }

  // ─── QUOTE CHASER SEND/SKIP CALLBACKS (qc_send:N, qc_skip:N) ──────────────
  // Triggered from the Quote Chaser dispatch April 7 2026.
  // Reads .data/quote-chaser-batch.json and sends specific email via SMTP.
  if (action === "qc_send") {
    const n = parseInt(param);
    await answerCallback(callbackId, "📤 Sending...");
    try {
      const fs = await import("fs");
      const path = await import("path");
      const batchPath = path.resolve(process.cwd(), ".data/quote-chaser-batch.json");
      if (!fs.existsSync(batchPath)) throw new Error("batch file not found");
      const batch = JSON.parse(fs.readFileSync(batchPath, "utf-8"));
      const email = batch.find(e => e.n === n);
      if (!email) throw new Error(`email ${n} not in batch`);

      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport({
        host: env.OUTREACH_SMTP_HOST || "mail.privateemail.com",
        port: parseInt(env.OUTREACH_SMTP_PORT || "587"),
        secure: false,
        auth: { user: env.OUTREACH_EMAIL, pass: env.OUTREACH_PASSWORD },
      });

      const info = await transport.sendMail({
        from: `"Kirill D." <${env.OUTREACH_EMAIL}>`,
        to: email.to,
        subject: email.subject,
        text: email.body,
        html: email.body.replace(/\n/g, "<br>"),
      });

      // Log to outreach_emails as quote-chaser test send
      db.prepare(`
        INSERT INTO outreach_emails (id, business_name, business_email, business_category, subject, body, status, sent_at, template_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        email.biz,
        email.to,
        email.cat || "trades",
        email.subject,
        email.body,
        "sent",
        new Date().toISOString(),
        "quote-chaser-v1"
      );

      await sendMessage(`✅ Sent to ${email.biz} (${email.to})\nmessageId: ${info.messageId}`);
      if (messageId) await deleteMessage(chatId, messageId);
    } catch (e) {
      console.error("[qc_send] failed:", e.message);
      await sendMessage(`❌ Send failed for #${n}: ${e.message}`);
    }
    return;
  }

  if (action === "qc_skip") {
    const n = parseInt(param);
    await answerCallback(callbackId, "⏭ Skipped");
    if (messageId) await deleteMessage(chatId, messageId);
    return;
  }

  // ─── AWARENESS DIGEST CALLBACKS (multi-item card, edit not delete) ──────
  // Added 2026-05-09: digest cards have N rows of buttons. Clicking one button
  // should NOT delete the whole card - it should remove just that row from the
  // keyboard so other items stay clickable. Different prefix (awd_*) so legacy
  // single-item aw_* handler stays unchanged.
  if (action === "awd_apply" || action === "awd_later" || action === "awd_skip") {
    const itemId = param;
    const now = new Date().toISOString();
    let status = "new";
    let toastMsg = "";
    if (action === "awd_apply") { status = "apply_now"; toastMsg = "⚡ Queued for implementation"; }
    else if (action === "awd_later") { status = "later"; toastMsg = "⏰ Saved for later"; }
    else { status = "skipped"; toastMsg = "❌ Skipped"; }

    try {
      db.prepare(`UPDATE awareness_items SET status = ?, updated_at = ? WHERE id = ?`).run(status, now, itemId);
    } catch (e) {
      console.error("[Control] awareness_items update failed:", e.message);
    }

    await answerCallback(callbackId, toastMsg);

    // Edit the keyboard: remove the row containing buttons that reference this itemId.
    // Each row has 3 buttons (apply/later/skip) all sharing the itemId, so we drop the row.
    try {
      const orig = message?.reply_markup?.inline_keyboard;
      if (Array.isArray(orig)) {
        const filtered = orig.filter(row => !row.some(btn => (btn.callback_data || "").endsWith(":" + itemId)));
        await tgAPI("editMessageReplyMarkup", {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: filtered },
        });
      }
    } catch (e) {
      console.error("[Control] digest keyboard edit failed:", e.message);
    }
    return;
  }

  // ─── AWARENESS BRIEF CALLBACKS ─────────────────────────────────────────────
  if (action === "aw_apply" || action === "aw_later" || action === "aw_skip") {
    const itemId = param;
    const now = new Date().toISOString();
    let status = "new";
    let toastMsg = "";

    if (action === "aw_apply") {
      status = "apply_now";
      toastMsg = "⚡ Queued for implementation";
    } else if (action === "aw_later") {
      status = "later";
      toastMsg = "⏰ Saved for later";
    } else {
      status = "skipped";
      toastMsg = "❌ Skipped";
    }

    try {
      db.prepare(`UPDATE awareness_items SET status = ?, updated_at = ? WHERE id = ?`).run(status, now, itemId);
    } catch (e) {
      console.error("[Control] awareness_items update failed:", e.message);
    }

    await answerCallback(callbackId, toastMsg);
    if (messageId) await deleteMessage(chatId, messageId);

    // If apply_now, notify that it's in the work queue
    if (action === "aw_apply") {
      try {
        const item = db.prepare(`SELECT title FROM awareness_items WHERE id = ?`).get(itemId);
        if (item) {
          await sendMessage(
            `⚡ <b>Queued for implementation:</b>\n<i>${item.title}</i>\n\nNext session: I'll read the URL, extract the pattern, and apply it to the target component.`,
            { parse_mode: "HTML" }
          );
        }
      } catch {}
    }
    return;
  }

  // ─── SERVICE BOT CALLBACKS ─────────────────────────────────────────────────
  if (action === "test_service" || action === "save_service" || action === "skip_service") {
    const ideaId = param;
    await answerCallback(callbackId);
    const { getIntelligenceKey, setIntelligence, createTask } = await import("./orchestrator.mjs");

    const idea = getIntelligenceKey(db, "service_bot", "idea_data", ideaId);
    const catalog = getIntelligenceKey(db, "service_bot", "ideas", "catalog") || [];

    if (action === "test_service" && idea) {
      const updated = catalog.map(i => i.id === ideaId ? { ...i, status: "testing" } : i);
      setIntelligence(db, "service_bot", "ideas", "catalog", updated, 100);

      // Save as active project
      setIntelligence(db, "orchestrator", "active_projects", ideaId, {
        title: idea.title, status: "in_progress", price: idea.price_cad || idea.price_point,
        icp: idea.icp, startedAt: new Date().toISOString(), steps_done: [],
      }, 90);

      await sendMessage(`🚀 *Генерирую полный план для "${idea.title}"...*\n_30 секунд_`);

      // Generate full action plan
      const { callAI, MODEL_STRONG } = await import("./orchestrator.mjs");
      const plan = await callAI(
        `You are a sales strategist. Create a COMPLETE action plan for selling this service idea.

Return JSON: {
  "linkedin_post": "ready-to-copy LinkedIn post under 1300 chars, Kirill's voice, specific numbers, ends with CTA",
  "where_to_post": ["list 5+ specific places: LinkedIn page, LinkedIn groups by name, subreddits, forums, communities"],
  "outreach_messages": [{"target": "who", "message": "ready-to-copy DM under 300 chars"}],
  "where_to_find_buyers": ["5 specific search queries or communities"],
  "how_to_close": "step by step: what to say on call, how to price, what deliverables",
  "first_48h": "exactly what to do in the next 48 hours, step by step"
}`,
        `Idea: ${idea.title}\nDescription: ${idea.description}\nICP: ${idea.icp}\nPrice: ${idea.price_cad || idea.price_point}\nROI: ${idea.roi_for_client || ""}\nOpener: ${idea.cold_outreach_opener || ""}\nLinkedIn angle: ${idea.linkedin_angle || ""}`,
        MODEL_STRONG
      ).catch(() => null);

      if (plan) {
        // Card 1: Post
        await tgSendToKirill(
          `📋 <b>ПРОЕКТ: ${idea.title}</b>\n\n<b>Шаг 1 — LinkedIn пост:</b>\n\n<code>${(plan.linkedin_post || "").slice(0, 800)}</code>`,
          { reply_markup: { inline_keyboard: [
            [{ text: "✅ Опубликовал", callback_data: `project_step:${ideaId}:post_done` }],
          ]}}
        );
        await new Promise(r => setTimeout(r, 500));

        // Card 2: Where to post + find buyers
        const whereParts = [
          `<b>Где публиковать:</b>`,
          ...(plan.where_to_post || []).map((p, i) => `${i + 1}. ${p}`),
          ``,
          `<b>Где искать покупателей:</b>`,
          ...(plan.where_to_find_buyers || []).map(p => `• ${p}`),
        ];
        await tgSendToKirill(whereParts.join("\n"), { reply_markup: { inline_keyboard: [
          [{ text: "🔍 Найти целей в LinkedIn", callback_data: `project_step:${ideaId}:find_targets` }],
        ]}});
        await new Promise(r => setTimeout(r, 500));

        // Card 3: Outreach messages
        const dmParts = [`<b>Шаг 2 — Outreach:</b>\n`];
        for (const m of (plan.outreach_messages || []).slice(0, 3)) {
          dmParts.push(`<b>${m.target}:</b>\n<code>${(m.message || "").slice(0, 350)}</code>\n`);
        }
        await tgSendToKirill(dmParts.join("\n"), { reply_markup: { inline_keyboard: [
          [{ text: "✅ Отправил DMs", callback_data: `project_step:${ideaId}:dms_sent` }],
        ]}});
        await new Promise(r => setTimeout(r, 500));

        // Card 4: How to close + first 48h
        await tgSendToKirill(
          `<b>Шаг 3 — Как закрыть сделку:</b>\n\n${plan.how_to_close || ""}\n\n<b>Первые 48 часов:</b>\n${plan.first_48h || ""}`,
          { reply_markup: { inline_keyboard: [
            [{ text: "🚀 Клиент сказал ДА", callback_data: `project_step:${ideaId}:client_yes` }],
            [{ text: "🤖 Меню", callback_data: "menu" }],
          ]}}
        );
      } else {
        await sendMessage(`❌ Не удалось сгенерировать план. Попробуй ещё раз.`);
      }

    } else if (action === "save_service") {
      const updated = catalog.map(i => i.id === ideaId ? { ...i, status: "saved" } : i);
      setIntelligence(db, "service_bot", "ideas", "catalog", updated, 100);
      await sendMessage(
        `💾 Идея *"${idea?.title || ideaId}"* сохранена — вернёмся когда будет время.`,
        { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "🤖 Меню", callback_data: "menu" }]] }}
      );

    } else if (action === "skip_service") {
      const updated = catalog.map(i => i.id === ideaId ? { ...i, status: "rejected" } : i);
      setIntelligence(db, "service_bot", "ideas", "catalog", updated, 100);
      await sendMessage(
        `❌ Понял — не наш рынок. ServiceBot запомнит.`,
        { reply_markup: { inline_keyboard: [[{ text: "🤖 Меню", callback_data: "menu" }]] }}
      );
    }
    return;
  }

  // ─── CONTENT CALLBACKS (посты) ─────────────────────────────────────────────
  if (action === "not_publishing") {
    const postId = param;
    await answerCallback(callbackId, "Жду объяснение...");
    // Set pending state so next text message = rejection reason
    const { writeFileSync: wfs2 } = await import("fs");
    const { resolve: res2, dirname: dir2 } = await import("path");
    const { fileURLToPath: ftu2 } = await import("url");
    const __d2 = dir2(ftu2(import.meta.url));
    wfs2(res2(__d2, "../../.data/pending-feedback.json"), JSON.stringify({
      type: "post_rejection",
      postId,
      askedAt: new Date().toISOString()
    }));
    await sendMessage(
      `❌ *Не публикуешь этот пост — почему?*\n\n` +
      `Напиши одним сообщением. Примеры:\n` +
      `• _Тема скучная, не моя аудитория_\n` +
      `• _Слишком продажно, без ценности_\n` +
      `• _Hook слабый, не цепляет_\n` +
      `• _Фото не подходит к теме_\n` +
      `• _Уже писал об этом недавно_\n\n` +
      `_ContentBot запомнит и больше так не делает._`
    );
    return;
  }

  if (action === "mark_published") {
    const postId = param;
    const now = new Date().toISOString();
    db.prepare(`INSERT OR IGNORE INTO published_posts (id, post_id, platform, status, published_at, created_at) VALUES (?,?,'linkedin','published',?,?)`)
      .run(randomUUID(), postId, now, now);
    db.prepare(`UPDATE published_posts SET status='published', published_at=? WHERE post_id=?`).run(now, postId);
    // Also record in content_calendar for governance
    const { scheduleContent } = await import("./orchestrator.mjs");
    try {
      db.prepare(`INSERT INTO content_calendar (id, content_type, topic, status, published_at, created_at) VALUES (?, 'linkedin_post', ?, 'published', ?, ?)`)
        .run(randomUUID(), postId, now, now);
    } catch {}
    await answerCallback(callbackId, "✅ Зафиксировано!");
    await sendMessage(
      `📊 <b>Пост опубликован!</b>\n\nКогда увидишь статистику — нажми кнопку ниже.`,
      { reply_markup: { inline_keyboard: [
        [{ text: "📈 Внести статистику поста", callback_data: `update_stats:${postId}` }],
        [{ text: "🤖 Меню", callback_data: "cmd:menu" }]
      ]}}
    );
    return;
  }

  if (action === "update_stats") {
    const postId = param;
    await answerCallback(callbackId, "Выбери результат");
    await sendMessage(
      `📈 <b>Результат поста</b>\n\nСколько лайков получил пост?`,
      { reply_markup: { inline_keyboard: [
        [
          { text: "0–10", callback_data: `post_likes:${postId}:5` },
          { text: "10–30", callback_data: `post_likes:${postId}:20` },
          { text: "30–70", callback_data: `post_likes:${postId}:50` },
          { text: "70+", callback_data: `post_likes:${postId}:100` }
        ],
        [{ text: "❌ Пропустить", callback_data: "cmd:menu" }]
      ]}}
    );
    return;
  }

  if (action === "post_likes") {
    const [postId, likes] = param.split(":");
    const now = new Date().toISOString();
    db.prepare(`UPDATE published_posts SET likes=?, updated_at=? WHERE post_id=?`).run(parseInt(likes), now, postId);
    await answerCallback(callbackId, "Записано!");
    await sendMessage(
      `✅ <b>Лайки записаны: ${likes}</b>\n\nБыли ли входящие сообщения или лиды после поста?`,
      { reply_markup: { inline_keyboard: [
        [
          { text: "✅ Да, были лиды", callback_data: `post_leads:${postId}:1` },
          { text: "❌ Нет лидов", callback_data: `post_leads:${postId}:0` }
        ]
      ]}}
    );
    return;
  }

  if (action === "post_leads") {
    const [postId, leadsCount] = param.split(":");
    const now = new Date().toISOString();
    const score = Math.min(100, parseInt(leadsCount) * 20 + 30);
    db.prepare(`UPDATE published_posts SET leads_generated=?, performance_score=?, updated_at=? WHERE post_id=?`)
      .run(parseInt(leadsCount), score, now, postId);
    await answerCallback(callbackId, "Сохранено!");
    await sendMessage(
      `✅ <b>Статистика сохранена!</b>\n\nAnalyticsBot учтёт это при следующем отчёте.`,
      { reply_markup: { inline_keyboard: [[{ text: "🤖 Меню", callback_data: "cmd:menu" }]] }}
    );
    return;
  }

  if (action === "show_posts" || action === "post_proposal") {
    await answerCallback(callbackId);
    return;
  }

  // ─── IDEA BOT CALLBACKS ────────────────────────────────────────────────────
  if (action === "idea_test") {
    const ideaKey = param;
    await answerCallback(callbackId, "🚀 Генерирую полный план...");
    const idea = getIntelligenceKey(db, "idea-bot", "ideas", ideaKey);
    setIntelligence(db, "idea-bot", "ideas", ideaKey, { ...(idea || {}), status: "pipeline", approvedAt: new Date().toISOString() });
    if (messageId) await deleteMessage(chatId, messageId);
    if (idea) {
      // Save as active project
      setIntelligence(db, "orchestrator", "active_projects", ideaKey, {
        title: idea.title, status: "in_progress",
        price: idea.price_cad || idea.price_point,
        icp: idea.icp, startedAt: new Date().toISOString(), steps_done: [],
        sources: idea.sources || [], where_to_sell: idea.where_to_sell || [],
      }, 90);

      await sendMessage(`🚀 *Генерирую полный план для "${idea.title}"...*\n_30 секунд_`);

      // Background: CompetitorAgent + ScoutBot
      sendEventBus(db, { fromBot: "idea-bot", toBot: "competitor-agent", messageType: "analyze_competition",
        payload: { idea: { title: idea.title, description: idea.opportunity, service_definition: idea.service_definition, icp: idea.icp, price_cad: idea.price_cad, sources: idea.sources || [] }, source: "kirill_approved", ideaKey, score: 10 }, priority: 10 });
      sendEventBus(db, { fromBot: "idea-bot", toBot: "scout-bot", messageType: "lead_pain_signal",
        payload: { niche: idea.title, pain: idea.opportunity || idea.service_definition, source: "approved_idea", original_sources: idea.sources || [], where_to_sell: idea.where_to_sell || [] }, priority: 9 });

      // Generate full action plan as cards
      const { callAI, MODEL_STRONG } = await import("./orchestrator.mjs");
      const plan = await callAI(
        `You are a sales strategist. Create a COMPLETE action plan for selling this idea.

Return JSON: {
  "linkedin_post": "ready-to-copy LinkedIn post under 1300 chars, casual tone, specific numbers, ends with CTA",
  "where_to_post": ["5+ specific places: LinkedIn page, groups by name, subreddits, forums"],
  "outreach_messages": [{"target": "who exactly", "message": "ready-to-copy DM under 300 chars"}],
  "where_to_find_buyers": ["5 specific communities or search queries"],
  "how_to_close": "what to say on call, pricing, deliverables",
  "first_48h": "step by step what to do right now"
}`,
        `Idea: ${idea.title}\nDescription: ${idea.opportunity || idea.service_definition}\nICP: ${idea.icp}\nPrice: ${idea.price_cad || idea.price_point}\nFirst step: ${idea.first_step_48h || ""}\nSources: ${(idea.sources || []).map(s => s.platform + "/" + s.community).join(", ")}\nWhere to sell: ${(idea.where_to_sell || []).join("; ")}`,
        MODEL_STRONG
      ).catch(() => null);

      if (plan) {
        await tgSendToKirill(
          `📋 <b>ПРОЕКТ: ${idea.title}</b>\n\n<b>Шаг 1 — LinkedIn пост:</b>\n\n<code>${(plan.linkedin_post || "").slice(0, 800)}</code>`,
          { reply_markup: { inline_keyboard: [[{ text: "✅ Опубликовал", callback_data: `project_step:${ideaKey}:post_done` }]]}}
        );
        await new Promise(r => setTimeout(r, 500));

        const whereParts = [`<b>Где публиковать + искать покупателей:</b>`, ...(plan.where_to_post || []).map((p, i) => `${i+1}. ${p}`), ``, `<b>Где искать:</b>`, ...(plan.where_to_find_buyers || []).map(p => `• ${p}`)];
        await tgSendToKirill(whereParts.join("\n"), { reply_markup: { inline_keyboard: [[{ text: "🔍 Найти целей", callback_data: `project_step:${ideaKey}:find_targets` }]]}});
        await new Promise(r => setTimeout(r, 500));

        const dmParts = [`<b>Шаг 2 — Outreach:</b>\n`];
        for (const m of (plan.outreach_messages || []).slice(0, 3)) dmParts.push(`<b>${m.target}:</b>\n<code>${(m.message || "").slice(0, 350)}</code>\n`);
        await tgSendToKirill(dmParts.join("\n"), { reply_markup: { inline_keyboard: [[{ text: "✅ Отправил DMs", callback_data: `project_step:${ideaKey}:dms_sent` }]]}});
        await new Promise(r => setTimeout(r, 500));

        await tgSendToKirill(
          `<b>Шаг 3 — Как закрыть:</b>\n\n${plan.how_to_close || ""}\n\n<b>Первые 48 часов:</b>\n${plan.first_48h || ""}`,
          { reply_markup: { inline_keyboard: [[{ text: "🚀 Клиент сказал ДА", callback_data: `project_step:${ideaKey}:client_yes` }], [{ text: "🤖 Меню", callback_data: "menu" }]]}});
      } else {
        await sendMessage(`❌ Не удалось сгенерировать план. Попробуй ещё раз.`);
      }
    }
    return;
  }
  if (action === "idea_save") {
    const ideaKey = param;
    await answerCallback(callbackId, "💾 Сохранено!");
    const idea = getIntelligenceKey(db, "idea-bot", "ideas", ideaKey);
    setIntelligence(db, "idea-bot", "ideas", ideaKey, { ...(idea || {}), status: "saved" });
    const savedList = getIntelligenceKey(db, "idea-bot", "saved", "list") || [];
    if (idea) savedList.push({ ...idea, savedAt: new Date().toISOString() });
    setIntelligence(db, "idea-bot", "saved", "list", savedList.slice(-30));
    if (messageId) await deleteMessage(chatId, messageId);
    await sendMessage(`💾 *Идея сохранена.* Вернёмся когда придёт время.`);
    return;
  }
  if (action === "idea_delete") {
    const ideaKey = param;
    await answerCallback(callbackId, "Удалено");
    const savedList = getIntelligenceKey(db, "idea-bot", "saved", "list") || [];
    setIntelligence(db, "idea-bot", "saved", "list", savedList.filter(i => i.ideaKey !== ideaKey));
    if (messageId) await deleteMessage(chatId, messageId);
    return;
  }
  // ─── AUTO PIPELINE FEEDBACK ─────────────────────────────────────────────────
  if (action === "auto_sent") {
    await answerCallback(callbackId, "✅ Записал — слежу за ответом");
    // Mark outreach as actually sent
    db.prepare(`UPDATE outreach_emails SET status = 'sent' WHERE lead_id = ? AND status LIKE 'ready_%'`).run(param);
    setIntelligence(db, "orchestrator", "pipeline_feedback", `sent_${Date.now()}`, {
      leadId: param, feedback: "sent", at: new Date().toISOString(),
    }, 30);
    if (messageId) await deleteMessage(chatId, messageId);
    return;
  }
  if (action === "auto_ok") {
    await answerCallback(callbackId, "👍 Запомнил");
    setIntelligence(db, "orchestrator", "pipeline_feedback", `ok_${Date.now()}`, {
      leadId: param, feedback: "good", at: new Date().toISOString(),
    }, 30);
    if (messageId) await deleteMessage(chatId, messageId);
    return;
  }
  if (action === "auto_bad") {
    await answerCallback(callbackId, "👎 Запомнил — скажи что не так");
    setIntelligence(db, "orchestrator", "pipeline_feedback", `bad_${Date.now()}`, {
      leadId: param, feedback: "bad", at: new Date().toISOString(),
    }, 30);
    if (messageId) await deleteMessage(chatId, messageId);
    await sendMessage(`👎 Понял. Напиши что не так — я запомню и скорректирую подход.`);
    return;
  }

  // ─── CONTENT IDEA ACTIONS ───────────────────────────────────────────────────
  if (action === "write_post") {
    const ideaKey = param;
    await answerCallback(callbackId, "📝 ContentBot пишет...");
    const idea = getIntelligenceKey(db, "content-bot", "content_ideas", ideaKey);
    if (idea) {
      createTask(db, {
        fromBot: "telegram-control",
        toBot: "content_factory",
        taskType: "draft_commentary_post",
        payload: {
          title: idea.title,
          hook: idea.hook,
          category: idea.category || "commentary",
          monetization: idea.monetization || "",
          urgency: idea.urgency || "",
          source: idea.source || "content_idea",
          url: idea.url || "",
          summary: idea.hook,
        },
        priority: 95
      });
      // Remove from ideas list
      db.prepare(`DELETE FROM bot_intelligence WHERE bot_id = 'content-bot' AND insight_type = 'content_ideas' AND key = ?`).run(ideaKey);
      if (messageId) await deleteMessage(chatId, messageId);
      await sendMessage(`📝 *ContentBot пишет пост:* "${(idea.title || "").slice(0, 60)}"\n\n_Черновик придёт через 1-2 минуты._`);
    }
    return;
  }
  if (action === "delete_idea") {
    const ideaKey = param;
    await answerCallback(callbackId, "❌ Удалено");
    db.prepare(`DELETE FROM bot_intelligence WHERE bot_id = 'content-bot' AND insight_type = 'content_ideas' AND key = ?`).run(ideaKey);
    if (messageId) await deleteMessage(chatId, messageId);
    return;
  }

  // ─── PH NICHE TARGET — launch full pipeline for chosen niche ────────────────
  if (action === "ph_target_niche") {
    const nicheIndex = parseInt(param);
    await answerCallback(callbackId, "🎯 Запускаю...");
    const niches = getIntelligenceKey(db, "ph-bot", "report", "latest_niches") || [];
    const niche = niches[nicheIndex];
    if (!niche) {
      await sendMessage("❌ Ниша не найдена.");
      return;
    }
    if (messageId) await deleteMessage(chatId, messageId);

    const nicheName = niche.name;
    const market = "Philippines";

    // 1. ScoutBot — искать лидов в этой нише
    sendEventBus(db, {
      fromBot: "ph-bot",
      toBot: "scout-bot",
      messageType: "lead_pain_signal",
      payload: {
        niche: nicheName,
        market,
        pain: niche.why_urgent,
        source: "ph_market_report",
        instructions: `Find businesses in ${market} that need ${nicheName}. Look for founders, ops managers, CTOs actively discussing this pain.`,
      },
      priority: 9
    });

    // 2. LinkedInHunter — искать профили
    sendEventBus(db, {
      fromBot: "ph-bot",
      toBot: "linkedin-hunter",
      messageType: "hunt_profiles",
      payload: {
        market,
        niche: nicheName,
        queries: [
          `"Philippines" "${nicheName}" "founder" OR "CEO" OR "operations"`,
          `"Philippines" "automation" "${nicheName.split(" ")[0]}" "director" OR "manager"`,
        ],
      },
      priority: 8
    });

    // 3. Сохранить нишу как контекст для контента — пост только по запросу Кирилла
    setIntelligence(db, "content-bot", "niche_context", "active", {
      niche: nicheName,
      market,
      why: niche.why_urgent,
      savedAt: new Date().toISOString(),
    }, 30);

    // 4. PRBot — фокус на этом рынке
    sendEventBus(db, {
      fromBot: "ph-bot",
      toBot: "pr-bot",
      messageType: "market_focus",
      payload: { market, niche: nicheName, reason: niche.why_urgent },
      priority: 7
    });

    await sendMessage(
      `🎯 <b>Целимся в: ${nicheName}</b>\n\n` +
      `Запущено:\n` +
      `• ScoutBot — ищет лидов с этой болью\n` +
      `• LinkedInHunter — ищет профили в Philippines\n` +
      `• Контекст сохранён — пост по твоей команде\n` +
      `• PRBot — фокусирует outreach на Philippines\n\n` +
      `<i>Результаты начнут приходить в течение 10-30 минут</i>`
    );
    return;
  }

  if (action === "idea_skip") {
    const ideaKey = param;
    await answerCallback(callbackId, "Понял, не то");
    const idea = getIntelligenceKey(db, "idea-bot", "ideas", ideaKey);
    setIntelligence(db, "idea-bot", "ideas", ideaKey, { ...(idea || {}), status: "rejected" });
    // Сохранить rejection для обучения — чтобы не предлагать похожее
    const rejected = getIntelligenceKey(db, "idea-bot", "rejected", "list") || [];
    rejected.push({ title: idea?.title, category: idea?.icp, rejectedAt: new Date().toISOString() });
    setIntelligence(db, "idea-bot", "rejected", "list", rejected.slice(-20));
    if (messageId) await deleteMessage(chatId, messageId);
    return;
  }

  // ─── PHILIPPINES BOT CALLBACKS ─────────────────────────────────────────────
  if (action === "ph_commented") {
    const threadKey = param;
    await answerCallback(callbackId, "✅ Записано!");
    const card = getIntelligenceKey(db, "ph-bot", "thread_cards", threadKey);
    setIntelligence(db, "ph-bot", "thread_cards", threadKey, {
      ...(card || {}),
      status: "commented",
      commentedAt: new Date().toISOString()
    });
    setIntelligence(db, "ph-bot", "commented", threadKey, {
      url: card?.url,
      title: card?.title,
      commentedAt: new Date().toISOString()
    });
    // Добавить тред в reddit-monitor чтобы отслеживать ответы на комментарий Кирилла
    if (card?.url) {
      const monitorId = `ph_${threadKey}`;
      const subredditMatch = card.url.match(/reddit\.com\/r\/([^/]+)\//);
      setIntelligence(db, "reddit", "monitoring", monitorId, {
        monitorId,
        postUrl: card.url,
        subreddit: subredditMatch?.[1] || "unknown",
        title: card.title || "",
        monitoredSince: Date.now(),
        seenCommentIds: [],
        source: "ph_bot"
      }, 30);
    }
    if (messageId) await deleteMessage(chatId, messageId);
    await sendMessage(`✅ *Прокомментировал.* Слежу за ответами — пришлю когда кто-то ответит.`);
    return;
  }
  if (action === "ph_skip") {
    const threadKey = param;
    await answerCallback(callbackId, "Пропущено");
    const card = getIntelligenceKey(db, "ph-bot", "thread_cards", threadKey);
    setIntelligence(db, "ph-bot", "thread_cards", threadKey, {
      ...(card || {}),
      status: "skipped",
      skippedAt: new Date().toISOString()
    });
    if (messageId) await deleteMessage(chatId, messageId);
    return;
  }

  // ─── CATCH-ALL: unknown callbacks from cortex/other bots ───
  // Cortex generates dynamic callback_data via AI. Instead of ignoring,
  // RECORD Kirill's choice so the system learns from every button press.
  const KNOWN_LEAD_ACTIONS = ["contacted", "wrote", "skip_why", "replied", "remind", "feedback", "proposal", "call", "approved", "rejected", "delivered", "lost"];
  if (!KNOWN_LEAD_ACTIONS.includes(action)) {
    // Save Kirill's response to bot_intelligence so cortex/brain can learn
    try {
      const feedbackKey = `kirill_response_${Date.now()}`;
      const msgText = message?.text || "";
      const buttonText = data || "";
      setIntelligence(db, "cortex", "kirill_feedback", feedbackKey, {
        button_pressed: buttonText,
        card_text: msgText.slice(0, 500),
        card_title: msgText.split("\n")[0]?.slice(0, 100) || "",
        responded_at: new Date().toISOString(),
        interpretation: buttonText.includes("spam") || buttonText.includes("skip") || buttonText.includes("no")
          ? "rejected"
          : buttonText.includes("check") || buttonText.includes("now") || buttonText.includes("yes") || buttonText.includes("post") || buttonText.includes("got")
          ? "accepted"
          : "acknowledged",
      }, 14);
      console.log(`[telegram-control] Kirill feedback saved: "${buttonText}" on "${msgText.slice(0, 60)}..." → ${buttonText.includes("spam") ? "rejected" : "accepted"}`);
    } catch (e) {
      console.error(`[telegram-control] feedback save error: ${e.message}`);
    }
    await answerCallback(callbackId, "✅ Noted");
    if (messageId) try { await tgAPI("deleteMessage", { chat_id: chatId, message_id: messageId }); } catch {}
    return;
  }

  // ─── LEAD CALLBACKS ────────────────────────────────────────────────────────
  const leadId = param;
  if (!leadId) return;

  const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(leadId);
  if (!lead) {
    await answerCallback(callbackId, "Лид не найден");
    return;
  }

  const now = new Date().toISOString();

  switch (action) {
    case "contacted":
    case "wrote": {
      db.prepare(`UPDATE leads SET stage = 'contacted', last_contact_at = ?, next_followup_at = datetime('now', '+48 hours'), updated_at = ? WHERE id = ?`)
        .run(now, now, leadId);
      await answerCallback(callbackId, "✅ В работе!");
      await deleteLeadCard(db, leadId, chatId, messageId);
      await sendMessage(
        `✅ *${lead.name || "Лид"} — в работе*\n\n` +
        `Переведён в стадию "contacted". Жди ответа.\n` +
        `Если ответит — нажми [💬 Ответил] в /leads`,
        { reply_markup: { inline_keyboard: [[
          { text: "📋 Все лиды", callback_data: "cmd:leads" },
          { text: "🤖 Меню", callback_data: "menu" }
        ]] }}
      );
      break;
    }

    case "skip_why": {
      // Show quick-reason buttons — delete original card, show reason picker
      await answerCallback(callbackId);
      await deleteLeadCard(db, leadId, chatId, messageId);
      await sendMessage(
        `❌ <b>Почему не подходит ${lead.name || "этот лид"}?</b>\n<i>Выбери причину — это обучит систему не присылать похожих</i>`,
        { reply_markup: { inline_keyboard: [
          [{ text: "✉️ Не могу написать — не в контактах", callback_data: `skip_reason:${leadId}:не в контактах LinkedIn` }],
          [{ text: "💼 Не мой клиент / не та индустрия", callback_data: `skip_reason:${leadId}:не мой клиент, не та индустрия` }],
          [{ text: "📋 Это вакансия, не проект", callback_data: `skip_reason:${leadId}:это вакансия а не проектная работа` }],
          [{ text: "💬 Уже решил проблему / не срочно", callback_data: `skip_reason:${leadId}:уже решил проблему` }],
          [{ text: "✍️ Написать свою причину", callback_data: `feedback:${leadId}` }],
        ]}}
      );
      break;
    }

    case "skip_reason": {
      const reason = param.split(":").slice(1).join(":");
      const realLeadId = param.split(":")[0];
      const realLead = db.prepare("SELECT * FROM leads WHERE id = ?").get(realLeadId);
      db.prepare(`UPDATE leads SET stage = 'skipped', updated_at = ? WHERE id = ?`).run(now, realLeadId);
      await answerCallback(callbackId, "Сохранено ✓");

      const { setIntelligence, getIntelligenceKey } = await import("./orchestrator.mjs");
      const existing = (() => { try { return getIntelligenceKey(db, "lead_feedback", "rejections", "reasons") || []; } catch { return []; }})();
      existing.push({
        reason,
        leadName: realLead?.name || "Unknown",
        platform: realLead?.source_platform || realLead?.source || "?",
        score: realLead?.score,
        at: new Date().toISOString()
      });
      setIntelligence(db, "lead_feedback", "rejections", "reasons", existing.slice(-30), 365);

      // No confirmation message — reason was saved, chat stays clean
      break;
    }

    case "skip": {
      db.prepare(`UPDATE leads SET stage = 'skipped', updated_at = ? WHERE id = ?`).run(now, leadId);
      await answerCallback(callbackId, "Пропущен");
      await deleteLeadCard(db, leadId, chatId, messageId);
      break;
    }

    case "feedback": {
      await answerCallback(callbackId, "Жду объяснение...");
      await deleteLeadCard(db, leadId, chatId);
      // Save pending state — next text message = feedback reason for this lead
      const { writeFileSync } = await import("fs");
      const { resolve, dirname } = await import("path");
      const { fileURLToPath: ftu } = await import("url");
      const __d = dirname(ftu(import.meta.url));
      writeFileSync(resolve(__d, "../../.data/pending-feedback.json"), JSON.stringify({
        type: "lead_feedback",
        leadId,
        leadName: lead.name || "Unknown",
        leadPlatform: lead.source_platform || lead.source,
        leadScore: lead.score,
        askedAt: new Date().toISOString()
      }));
      await sendMessage(
        `💬 *Почему этот лид не подходит?*\n\n` +
        `*${lead.name || "Лид"}* — ${lead.source_platform || ""}  Score: ${lead.score}/100\n\n` +
        `Напиши одним сообщением. Примеры:\n` +
        `• _Это вакансия, а не проект_\n` +
        `• _Слишком маленький бюджет для автоматизации_\n` +
        `• _Не мой рынок — это B2C_\n` +
        `• _Уже закрыто, ищут сотрудника_\n\n` +
        `_Система запомнит и перестанет находить похожих._`
      );
      break;
    }

    case "replied": {
      db.prepare(`UPDATE leads SET stage = 'replied', updated_at = ? WHERE id = ?`).run(now, leadId);
      signalConversion(db, lead, "replied"); // EvolutionBot: этот источник/скор даёт ответы
      await answerCallback(callbackId, "🎉 Отлично!");
      await editMessage(chatId, messageId,
        buildLeadCard({ ...lead, stage: "replied" }) + "\n\n💬 *Ответил!* Что дальше?",
        { reply_markup: buildLeadButtons(leadId, "replied") }
      );

      // SalesBot: prepare proposal
      createTask(db, {
        fromBot: "telegram-control", toBot: "sales", taskType: "lead_replied",
        payload: { leadId, leadName: lead.name, company: lead.company, pain: lead.pain_description },
        priority: 10
      });
      break;
    }

    case "remind": {
      const remindAt = new Date(Date.now() + 48 * 3600000).toISOString();
      db.prepare(`UPDATE leads SET next_followup_at = ?, updated_at = ? WHERE id = ?`).run(remindAt, now, leadId);
      await answerCallback(callbackId, "⏰ Напомню через 48 часов");
      break;
    }

    case "dead": {
      db.prepare(`UPDATE leads SET stage = 'dead', updated_at = ? WHERE id = ?`).run(now, leadId);
      await answerCallback(callbackId, "Окей, удаляю из воронки");
      await editMessage(chatId, messageId, `${lead.name || "Лид"} — *не ответит*`);
      break;
    }

    case "proposal": {
      await answerCallback(callbackId, "📋 Готовлю КП...");
      createTask(db, {
        fromBot: "telegram-control", toBot: "sales", taskType: "generate_proposal",
        payload: { leadId, leadName: lead.name, company: lead.company, pain: lead.pain_description },
        priority: 10
      });
      await sendMessage(`📋 SalesBot готовит коммерческое предложение для *${lead.name || lead.company}*.\nПолучишь в течение 2 минут.`);
      break;
    }

    case "call": {
      db.prepare(`UPDATE leads SET stage = 'call_scheduled', updated_at = ? WHERE id = ?`).run(now, leadId);
      await answerCallback(callbackId, "📞 Созвон отмечен!");
      await sendMessage(`📞 *Созвон с ${lead.name || lead.company} запланирован.*\n\nПосле созвона: /approve ${leadId} — если согласились.`);
      break;
    }

    case "approved": {
      // Create deal and trigger BuilderBot
      const existing = db.prepare("SELECT id FROM deals WHERE lead_id = ?").get(leadId);
      if (!existing) {
        db.prepare(`
          INSERT INTO deals (id, lead_id, service_type, amount, currency, status, proposed_at, created_at, updated_at)
          VALUES (lower(hex(randomblob(8))), ?, ?, 1500, 'CAD', 'approved', ?, ?, ?)
        `).run(leadId, lead.service_match || "AI Automation", now, now, now);
      } else {
        db.prepare(`UPDATE deals SET status = 'approved', updated_at = ? WHERE lead_id = ?`).run(now, leadId);
      }
      db.prepare(`UPDATE leads SET stage = 'approved', updated_at = ? WHERE id = ?`).run(now, leadId);
      signalConversion(db, lead, "won"); // EvolutionBot: победный паттерн — максимальный сигнал

      await answerCallback(callbackId, "🚀 BuilderBot запущен!");
      await sendMessage(`🚀 *Сделка одобрена!*\n\nКлиент: *${lead.name || lead.company}*\nBuilderBot начинает строить MVP.\nУведомлю когда будет готово.`);

      emitEvent(db, { fromBot: "telegram-control", eventType: "deal_approved", payload: { leadId, dealId: "latest" } });
      break;
    }
  }
}

// ─── MANAGEMENT COMMANDS ──────────────────────────────────────────────────────

const KNOWN_BOTS = {
  "telegram-control":    { type: "daemon", script: "scripts/factory/telegram-control.mjs", log: "/tmp/lbo-telegram-control.log" },
  "orchestrator-daemon": { type: "daemon", script: "scripts/factory/orchestrator-daemon.mjs", log: "/tmp/lbo-orchestrator-daemon.log" },
  "sonnet-bots-daemon":  { type: "daemon", script: "scripts/factory/sonnet-bots-daemon.mjs", log: "/tmp/lbo-sonnet-bots-daemon.log" },
  "monitor-replies":     { type: "cron", script: "scripts/outreach/monitor-replies.mjs", log: "/tmp/lbo-monitor-replies.log" },
  "awareness-bot":       { type: "cron", script: "scripts/factory/awareness-bot.mjs", log: "/tmp/lbo-awareness-bot.log" },
  "community-bot":       { type: "cron", script: "scripts/factory/community-bot.mjs", log: "/tmp/lbo-community-bot.log" },
  "icp-outreach-bot":    { type: "cron", script: "scripts/factory/icp-outreach-bot.mjs", log: "/tmp/lbo-icp-outreach-bot.log" },
  "reddit-monitor":      { type: "cron", script: "scripts/factory/reddit-monitor.mjs", log: "/tmp/lbo-reddit-monitor.log" },
  "buying-signal-hunt":  { type: "cron", script: "scripts/factory/buying-signal-hunt.mjs", log: "/tmp/lbo-buying-signal-hunt.log" },
  "fresh-pain-scout":    { type: "cron", script: "scripts/factory/fresh-pain-scout.mjs", log: "/tmp/lbo-fresh-pain-scout.log" },
  "hn-show-hn-scout":    { type: "cron", script: "scripts/factory/hn-show-hn-scout.mjs", log: "/tmp/lbo-hn-show-hn-scout.log" },
  "evolution-bot":       { type: "cron", script: "scripts/factory/evolution-bot.mjs", log: "/tmp/lbo-evolution-bot.log" },
  "idea-bot":            { type: "cron", script: "scripts/factory/idea-bot.mjs", log: "/tmp/lbo-idea-bot.log" },
  "content-bot":         { type: "cron", script: "scripts/factory/content-bot.mjs", log: "/tmp/lbo-content-bot.log" },
  "content-curator-bot": { type: "cron", script: "scripts/factory/content-curator-bot.mjs", log: "/tmp/lbo-content-curator-bot.log" },
  "site-curator-bot":    { type: "cron", script: "scripts/factory/site-curator-bot.mjs", log: "/tmp/lbo-site-curator-bot.log" },
  "lead-enrichment-bot": { type: "cron", script: "scripts/factory/lead-enrichment-bot.mjs", log: "/tmp/lbo-lead-enrichment-bot.log" },
  "research-bot-v2":     { type: "cron", script: "scripts/factory/research-bot-v2.mjs", log: "/tmp/lbo-research-bot-v2.log" },
  "sales-bot":           { type: "cron", script: "scripts/factory/sales-bot.mjs", log: "/tmp/lbo-sales-bot.log" },
  "threads-bot":         { type: "cron", script: "scripts/factory/threads-bot.mjs", log: "/tmp/lbo-threads-bot.log" },
  "daily-observations":  { type: "cron", script: "scripts/factory/daily-observations.mjs", log: "/tmp/lbo-observations.log" },
  "daily-heartbeat":     { type: "cron", script: "scripts/factory/daily-heartbeat-report.mjs", log: "/tmp/lbo-daily-heartbeat.log" },
  "cron-watchdog":       { type: "cron", script: "scripts/factory/cron-watchdog.mjs", log: "/tmp/lbo-cron-watchdog.log" },
  "project-executor":    { type: "cron", script: "scripts/factory/project-executor.mjs", log: "/tmp/lbo-project-executor.log" },
  "pipeline-bridge":     { type: "cron", script: "scripts/factory/pipeline-bridge.mjs", log: "/tmp/lbo-pipeline-bridge.log" },
};

const PROJECT_DIR = "$CLAUDE_PROJECT_DIR";
const NODE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/node";
const CLAUDE_BIN_PATH = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";

function findBot(query) {
  if (!query) return null;
  const q = query.toLowerCase().replace(/[^a-z0-9-]/g, "");
  return Object.keys(KNOWN_BOTS).find(k => k === q || k.includes(q)) || null;
}

async function handleFix(target) {
  await sendMessage("🔧 Запускаю диагностику...");

  const { execSync } = await import("child_process");
  const { readFileSync, statSync, existsSync } = await import("fs");

  if (target) {
    // Fix specific bot
    const botName = findBot(target);
    if (!botName) {
      await sendMessage(`Не знаю бота "${target}". Доступные:\n${Object.keys(KNOWN_BOTS).join(", ")}`);
      return;
    }
    await runRepairAgent(`Diagnose and fix the bot "${botName}" in project ${PROJECT_DIR}. Script: ${KNOWN_BOTS[botName].script}, Log: ${KNOWN_BOTS[botName].log}. Check the last 30 lines of the log for errors, read the relevant source code, fix the bug, and report what you did.`);
    return;
  }

  // Full system diagnosis
  const issues = [];
  const healthy = [];

  for (const [name, bot] of Object.entries(KNOWN_BOTS)) {
    if (bot.type === "daemon") {
      // Check if daemon is running
      try {
        const pidFile = `${PROJECT_DIR}/.data/${name}.pid`;
        if (existsSync(pidFile)) {
          const pid = parseInt(readFileSync(pidFile, "utf-8").trim());
          try {
            process.kill(pid, 0);
            healthy.push(name);
            continue;
          } catch {}
        }
        issues.push(`${name}: daemon NOT running`);
      } catch {
        issues.push(`${name}: can't check status`);
      }
    } else {
      // Check log freshness and errors
      try {
        if (!existsSync(bot.log)) {
          issues.push(`${name}: log missing (never ran?)`);
          continue;
        }
        const stat = statSync(bot.log);
        const ageMin = Math.round((Date.now() - stat.mtimeMs) / 60000);
        const tail = execSync(`tail -5 "${bot.log}" 2>/dev/null`, { encoding: "utf-8", timeout: 5000 }).trim();
        const hasError = /FATAL|Error|TypeError|SyntaxError|Cannot find module|ENOENT/i.test(tail);
        if (hasError) {
          const errorLine = tail.split("\n").find(l => /FATAL|Error|TypeError|SyntaxError/i.test(l)) || tail.split("\n").pop();
          issues.push(`${name}: ERROR - ${errorLine.slice(0, 100)}`);
        } else if (ageMin > 360) {
          issues.push(`${name}: stale (${Math.round(ageMin / 60)}h ago)`);
        } else {
          healthy.push(name);
        }
      } catch {
        issues.push(`${name}: can't read log`);
      }
    }
  }

  if (issues.length === 0) {
    await sendMessage(`✅ Все ${healthy.length} ботов здоровы. Проблем не найдено.`);
    return;
  }

  let report = `🔍 *Диагностика*\n\n✅ Здоровы: ${healthy.length}\n❌ Проблемы: ${issues.length}\n\n`;
  for (const issue of issues) {
    report += `- ${issue}\n`;
  }
  report += `\n🔧 Запускаю авторемонт...`;
  await sendMessage(report.slice(0, 4000));

  // Auto-repair via Claude CLI with Bash access
  const issueList = issues.join("\n");
  await runRepairAgent(
    `You are a system repair agent for the project at ${PROJECT_DIR}.\n\n` +
    `BROKEN BOTS:\n${issueList}\n\n` +
    `For each broken bot:\n` +
    `1. Read the last 30 lines of its log to understand the error\n` +
    `2. Read the source code at the error location\n` +
    `3. Fix the bug with minimal changes\n` +
    `4. If a daemon is down, restart it\n\n` +
    `Bot registry: ${JSON.stringify(KNOWN_BOTS, null, 2)}\n\n` +
    `Report what you fixed in plain text, in Russian. Max 3000 chars. No em dashes.`
  );
}

async function handleRestart(target) {
  if (!target) {
    await sendMessage("Укажи бота: /restart [имя]\nДемоны: telegram-control, orchestrator-daemon, sonnet-bots-daemon");
    return;
  }

  const botName = findBot(target);
  if (!botName) {
    await sendMessage(`Не знаю бота "${target}".`);
    return;
  }

  const bot = KNOWN_BOTS[botName];
  const { execSync } = await import("child_process");
  const { existsSync, readFileSync } = await import("fs");

  await sendMessage(`🔄 Перезапускаю ${botName}...`);

  if (bot.type === "daemon") {
    // Kill old process
    try {
      const pidFile = `${PROJECT_DIR}/.data/${botName}.pid`;
      if (existsSync(pidFile)) {
        const pid = parseInt(readFileSync(pidFile, "utf-8").trim());
        try { process.kill(pid, "SIGTERM"); } catch {}
      }
    } catch {}

    // Wait and start new
    await new Promise(r => setTimeout(r, 2000));

    if (botName === "telegram-control") {
      // Special case: restart ourselves
      try {
        execSync(
          `nohup ${NODE_BIN} ${PROJECT_DIR}/${bot.script} > /dev/null 2>&1 &`,
          { cwd: PROJECT_DIR, timeout: 5000 }
        );
        await sendMessage(`✅ ${botName} перезапускается. Я вернусь через пару секунд.`);
        setTimeout(() => process.exit(0), 1000);
      } catch (e) {
        await sendMessage(`❌ Ошибка перезапуска: ${e.message}`);
      }
    } else {
      try {
        execSync(
          `nohup ${NODE_BIN} ${PROJECT_DIR}/${bot.script} > /dev/null 2>&1 &`,
          { cwd: PROJECT_DIR, timeout: 5000 }
        );
        await new Promise(r => setTimeout(r, 2000));
        // Verify
        const pidFile = `${PROJECT_DIR}/.data/${botName}.pid`;
        if (existsSync(pidFile)) {
          const newPid = readFileSync(pidFile, "utf-8").trim();
          await sendMessage(`✅ ${botName} перезапущен (PID ${newPid})`);
        } else {
          await sendMessage(`⚠️ ${botName} запущен, но PID файл не появился. Проверь логи.`);
        }
      } catch (e) {
        await sendMessage(`❌ Ошибка: ${e.message}`);
      }
    }
  } else {
    // Cron bot - just run it now
    try {
      const result = execSync(
        `${NODE_BIN} ${PROJECT_DIR}/${bot.script} 2>&1 | tail -10`,
        { encoding: "utf-8", cwd: PROJECT_DIR, timeout: 120000 }
      ).trim();
      await sendMessage(`✅ ${botName} выполнен:\n\`\`\`\n${result.slice(0, 3000)}\n\`\`\``);
    } catch (e) {
      const output = (e.stdout || "") + (e.stderr || "");
      await sendMessage(`❌ ${botName} ошибка:\n\`\`\`\n${output.slice(-1000)}\n\`\`\``);
    }
  }
}

async function handleLogs(target) {
  if (!target) {
    await sendMessage("Укажи бота: /logs [имя]\nПример: /logs awareness-bot");
    return;
  }

  const botName = findBot(target);
  if (!botName) {
    await sendMessage(`Не знаю бота "${target}".`);
    return;
  }

  const bot = KNOWN_BOTS[botName];
  const { execSync } = await import("child_process");

  try {
    const tail = execSync(`tail -30 "${bot.log}" 2>/dev/null`, { encoding: "utf-8", timeout: 5000 }).trim();
    if (!tail) {
      await sendMessage(`📋 ${botName}: лог пуст или не существует.`);
      return;
    }
    // Split into chunks if too long
    const chunks = tail.match(/[\s\S]{1,3500}/g) || [tail];
    for (const chunk of chunks.slice(0, 2)) {
      await sendMessage(`📋 *${botName}* (last lines):\n\`\`\`\n${chunk}\n\`\`\``);
    }
  } catch (e) {
    await sendMessage(`❌ Не могу прочитать лог: ${e.message}`);
  }
}

async function handleRun(target) {
  if (!target) {
    await sendMessage("Укажи скрипт: /run [имя]\nПример: /run daily-observations");
    return;
  }

  const botName = findBot(target);
  if (botName) {
    const bot = KNOWN_BOTS[botName];
    await sendMessage(`⏳ Запускаю ${botName}...`);
    const { execSync } = await import("child_process");
    try {
      const result = execSync(
        `${NODE_BIN} ${PROJECT_DIR}/${bot.script} 2>&1 | tail -15`,
        { encoding: "utf-8", cwd: PROJECT_DIR, timeout: 180000 }
      ).trim();
      await sendMessage(`✅ ${botName} готов:\n\`\`\`\n${result.slice(0, 3500)}\n\`\`\``);
    } catch (e) {
      const output = (e.stdout || "") + (e.stderr || "");
      await sendMessage(`❌ ${botName} ошибка:\n\`\`\`\n${output.slice(-1500)}\n\`\`\``);
    }
  } else {
    await sendMessage(`Не знаю скрипт "${target}". Доступные:\n${Object.keys(KNOWN_BOTS).join(", ")}`);
  }
}

async function runRepairAgent(task) {
  const { spawnSync } = await import("child_process");
  const { writeFileSync } = await import("fs");
  const { resolve } = await import("path");

  const promptFile = resolve(PROJECT_DIR, ".data/repair-prompt.md");
  writeFileSync(promptFile, task);

  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING;
  cleanEnv.PATH = `$HOME/.nvm/versions/node/v22.22.2/bin:${process.env.PATH || "/usr/bin:/bin"}`;

  const r = spawnSync("bash", [
    "-c",
    `cat "${promptFile}" | "${CLAUDE_BIN_PATH}" -p --model claude-sonnet-4-6 --max-turns 20 --output-format text --allowedTools "Bash,Read,Edit,Grep,Glob" 2>&1`,
  ], {
    cwd: PROJECT_DIR,
    env: cleanEnv,
    encoding: "utf-8",
    timeout: 300000,
    maxBuffer: 10 * 1024 * 1024,
  });

  const result = ((r.stdout || "") + (r.stderr || "")).trim();
  if (!result || result.length < 5 || /Reached max turns|max turns/i.test(result)) {
    // Fallback: use callAI for a quick answer instead of showing error
    try {
      const fallback = await callAI(
        `You are a system admin. Answer this question/task concisely based on your knowledge of the project. Max 1500 chars. No em dashes.`,
        taskDescription.slice(0, 1000),
        MODEL_STRONG,
        false
      );
      if (fallback && fallback.length > 5) {
        await sendMessage(`🔧 ${fallback.slice(0, 4000)}`);
        return;
      }
    } catch {}
    await sendMessage("❌ Задача слишком сложная для удаленного выполнения. Нужна сессия с Claude Code.");
    return;
  }

  // Send result in chunks
  const clean = result.slice(0, 4000);
  await sendMessage(`🔧 ${clean}`);
}

// ─── POLLING LOOP ─────────────────────────────────────────────────────────────

let offset = 0;

async function poll(db) {
  try {
    const data = await tgAPI("getUpdates", { offset, timeout: 30, allowed_updates: ["message", "callback_query"] });
    if (!data.ok || !data.result?.length) return;

    for (const update of data.result) {
      offset = update.update_id + 1;

      // Callback button pressed
      if (update.callback_query) {
        await handleCallback(db, update.callback_query).catch(e =>
          console.error("[Control] Callback error:", e.message)
        );
        continue;
      }

      // Text or voice message
      const msg = update.message;
      if (!msg || String(msg.chat.id) !== String(CHAT_ID)) continue;

      // ── Mirror to organism inbox ──────────────────────────────────────────
      // The organism is one of this system's listeners. telegram-control owns the live
      // long-poll socket (only one process can), so we mirror every Kirill message into
      // a JSONL file the organism's adapter consumes. Append-only, single line per msg.
      try {
        const { appendFileSync: _appendInbox } = await import("fs");
        _appendInbox(
          "$CLAUDE_PROJECT_DIR/.data/organism-telegram-inbox.jsonl",
          JSON.stringify({
            update_id: update.update_id,
            message_id: msg.message_id,
            text: msg.text || msg.caption || null,
            date: msg.date,
            from: msg.from?.first_name || null,
            received_at: new Date().toISOString(),
          }) + "\n"
        );
      } catch {} // never let mirroring break the existing flow

      // Handle photos/screenshots - analyze via Claude CLI
      let text = msg.text?.trim() || "";
      if (msg.photo || msg.document?.mime_type?.startsWith("image/")) {
        try {
          const fileId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : msg.document.file_id;
          const fileInfo = await tgAPI("getFile", { file_id: fileId });
          if (fileInfo.ok && fileInfo.result.file_path) {
            const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.result.file_path}`;
            const { execSync } = await import("child_process");
            const { resolve: res, dirname: dir } = await import("path");
            const { fileURLToPath: ftu } = await import("url");
            const __d = dir(ftu(import.meta.url));
            const ext = fileInfo.result.file_path.split(".").pop() || "jpg";
            const imgPath = res(__d, `../../.data/telegram-image.${ext}`);
            execSync(`curl -s -o "${imgPath}" "${fileUrl}"`, { timeout: 15000 });

            await sendMessage("🧠 Смотрю...");

            const caption = msg.caption || "";

            // Fire async (don't block polling)
            (async () => {
              try {
                // OCR: extract text from screenshot using tesseract
                // Convert progressive JPEG to PNG (tesseract bug) + upscale for OCR
                const pngPath = imgPath.replace(/\.[^.]+$/, "-ocr.png");
                const bigPngPath = imgPath.replace(/\.[^.]+$/, "-ocr-big.png");
                execSync(`/usr/bin/sips -s format png "${imgPath}" --out "${pngPath}" > /dev/null 2>&1`, { timeout: 10000 });
                execSync(`/usr/bin/sips -Z 2560 "${pngPath}" --out "${bigPngPath}" > /dev/null 2>&1`, { timeout: 10000 });
                const ocrText = execSync(
                  `/opt/homebrew/bin/tesseract "${bigPngPath}" stdout -l eng`,
                  { encoding: "utf-8", timeout: 20000 }
                ).trim();
                console.log(`[Control] OCR: ${ocrText.length} chars`);

                console.log(`[Control] OCR extracted ${ocrText.length} chars`);

                if (ocrText.length < 10 && !caption) {
                  await sendMessage("Не смог прочитать текст со скриншота. Добавь подпись что нужно сделать.");
                  return;
                }

                const fullContext = [
                  caption ? `Kirill's request: ${caption}` : "",
                  ocrText ? `Text from screenshot:\n${ocrText.slice(0, 3000)}` : "",
                ].filter(Boolean).join("\n\n");

                // Save to conversation
                const { readFileSync: rf2, writeFileSync: wf2 } = await import("fs");
                try {
                  const convPath = res(__d, "../../.data/cortex-conversation.json");
                  let conv = [];
                  try { conv = JSON.parse(rf2(convPath, "utf-8")); } catch {}
                  conv.push({ role: "user", text: `[SCREENSHOT] ${caption || "image"}: ${ocrText.slice(0, 300)}`, at: new Date().toISOString(), source: "telegram" });
                  if (conv.length > 100) conv = conv.slice(-100);
                  wf2(convPath, JSON.stringify(conv, null, 2));
                } catch {}

                // Ask Claude to analyze and respond
                const response = await callAI(
                  `You are CORTEX. Kirill sent a screenshot via Telegram. The text was extracted via OCR.

RULES:
- If it shows social media comments/posts in English - draft replies IN ENGLISH (match the language of the original)
- If it shows social media in Russian - draft replies in Russian
- Your META-commentary (which variant to pick, why, strategy notes) should be in Russian for Kirill
- But the ACTUAL draft text that Kirill will copy-paste must be in the SAME LANGUAGE as the original comment/post
- Draft replies: short, human, no em dashes (use hyphens), no buzzwords, max 4 sentences
- If it shows an error or system log - diagnose and suggest fix in Russian
- If Kirill added a caption with instructions, follow those FIRST.`,
                  fullContext,
                  MODEL_MINI,
                  false
                );

                if (response && response.length > 3) {
                  try {
                    const convPath2 = res(__d, "../../.data/cortex-conversation.json");
                    let conv2 = [];
                    try { conv2 = JSON.parse(rf2(convPath2, "utf-8")); } catch {}
                    conv2.push({ role: "brain", text: response.slice(0, 500), at: new Date().toISOString(), source: "telegram" });
                    if (conv2.length > 100) conv2 = conv2.slice(-100);
                    wf2(convPath2, JSON.stringify(conv2, null, 2));
                  } catch {}
                  await sendMessage(response.slice(0, 4000));
                } else {
                  await sendMessage("Получил скриншот. Напиши подробнее что нужно.");
                }
              } catch (e) {
                console.error("[Control] Image analysis error:", e.message);
                await sendMessage("Получил скриншот. Добавь подпись что нужно сделать.");
              }
            })();
          }
        } catch (e) {
          console.error("[Control] Photo download error:", e.message);
        }
        continue;
      }

      // Handle voice messages - transcribe via Claude CLI
      if (msg.voice || msg.audio) {
        try {
          const fileId = (msg.voice || msg.audio).file_id;
          // Get file path from Telegram
          const fileInfo = await tgAPI("getFile", { file_id: fileId });
          if (fileInfo.ok && fileInfo.result.file_path) {
            const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.result.file_path}`;
            // Download voice file
            const { execSync } = await import("child_process");
            const { resolve: res, dirname: dir } = await import("path");
            const { fileURLToPath: ftu } = await import("url");
            const __d = dir(ftu(import.meta.url));
            const voicePath = res(__d, "../../.data/voice-msg.ogg");
            execSync(`curl -s -o "${voicePath}" "${fileUrl}"`, { timeout: 15000 });
            // Transcribe via Claude CLI (it can read audio)
            const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
            const result = execSync(
              `echo "Transcribe this audio message to text. Return ONLY the transcription, nothing else. If in Russian, keep Russian." | "${CLAUDE_BIN}" -p --model claude-sonnet-4-6 --max-turns 1 --output-format text --file "${voicePath}" 2>&1`,
              { encoding: "utf-8", timeout: 60000, cwd: res(__d, "../..") }
            ).trim();
            if (result && result.length > 2) {
              text = result;
              console.log(`[Control] Voice transcribed: ${text.slice(0, 100)}`);
              await sendMessage(`🎙 <i>${text.slice(0, 300)}</i>`, {});
            }
          }
        } catch (e) {
          console.error(`[Control] Voice transcription error: ${e.message}`);
          await sendMessage("Не смог расшифровать голосовое. Попробуй текстом.");
          continue;
        }
      }

      if (!text) continue;
      console.log(`[Control] Command: ${text}`);

      // ── Pending feedback (lead rejection reason) ──────────────────
      if (text && !text.startsWith("/")) {
        let pending = null;
        try {
          const { readFileSync } = await import("fs");
          const { resolve, dirname } = await import("path");
          const { fileURLToPath: ftu } = await import("url");
          const __d = dirname(ftu(import.meta.url));
          pending = JSON.parse(readFileSync(resolve(__d, "../../.data/pending-feedback.json"), "utf-8"));
        } catch {}

        if (pending?.type === "lead_feedback" && pending.leadId) {
          // Save feedback to intelligence
          const { setIntelligence, getIntelligence } = await import("./orchestrator.mjs");
          const existing = (() => {
            try { return getIntelligence(db, "lead_feedback", "rejections", "reasons") || []; } catch { return []; }
          })();
          existing.push({
            reason: text,
            leadName: pending.leadName,
            platform: pending.leadPlatform,
            score: pending.leadScore,
            at: new Date().toISOString()
          });
          setIntelligence(db, "lead_feedback", "rejections", "reasons", existing.slice(-50), 100);

          // Also mark lead as skipped
          const now2 = new Date().toISOString();
          db.prepare(`UPDATE leads SET stage = 'skipped', updated_at = ? WHERE id = ?`)
            .run(now2, pending.leadId);

          // Clear pending state
          try {
            const { writeFileSync } = await import("fs");
            const { resolve, dirname } = await import("path");
            const { fileURLToPath: ftu } = await import("url");
            const __d = dirname(ftu(import.meta.url));
            writeFileSync(resolve(__d, "../../.data/pending-feedback.json"), JSON.stringify({}));
          } catch {}

          await sendMessage(
            `🧠 *Записано и лид убран из воронки.*\n\n` +
            `Причина: _${text}_\n\n` +
            `Накоплено причин: ${existing.length}\n` +
            `ScoutBot и LinkedIn Hunter учтут это при следующем сканировании.`,
            { reply_markup: { inline_keyboard: [[{ text: "📋 Показать лидов", callback_data: "cmd:leads" }, { text: "🤖 Меню", callback_data: "cmd:menu" }]] }}
          );
          continue;
        }

        if (pending?.type === "learn_post") {
          // Handle learn_post — keep mode active so multiple posts can be sent in a row
          const { setIntelligence, getIntelligenceKey } = await import("./orchestrator.mjs");
          const existing = (() => {
            try { return getIntelligenceKey(db, "content_feedback", "good_examples", "posts") || []; } catch { return []; }
          })();
          // Filter out any corrupted entries (DB rows accidentally stored)
          const clean = Array.isArray(existing) ? existing.filter(e => e && typeof e.text === "string") : [];
          clean.push({ text, addedAt: new Date().toISOString() });
          setIntelligence(db, "content_feedback", "good_examples", "posts", clean.slice(-10), 100);
          // Keep pending-feedback.json active so next message is also treated as a post
          await sendMessage(
            `✅ *Пост #${clean.length} добавлен!*\nContentBot изучит твой стиль.\n\nОтправь ещё пост или нажми «Готово».`,
            { parse_mode: "Markdown", reply_markup: { inline_keyboard: [
              [{ text: "✅ Готово", callback_data: "learn_done" }]
            ]}}
          );
          continue;
        }

        if (pending?.type === "post_rejection") {
          const { setIntelligence, getIntelligence } = await import("./orchestrator.mjs");
          const rejections = (() => {
            try { return getIntelligence(db, "content_feedback", "rejections", "reasons") || []; } catch { return []; }
          })();
          rejections.push({ reason: text, postId: pending.postId, at: new Date().toISOString() });
          setIntelligence(db, "content_feedback", "rejections", "reasons", rejections.slice(-20), 100);
          try {
            const { writeFileSync } = await import("fs");
            const { resolve, dirname } = await import("path");
            const { fileURLToPath: ftu } = await import("url");
            const __d = dirname(ftu(import.meta.url));
            writeFileSync(resolve(__d, "../../.data/pending-feedback.json"), JSON.stringify({}));
          } catch {}
          await sendMessage(
            `🧠 *Записано!* ContentBot больше так не делает.\n\nПричина: _${text}_`,
            { reply_markup: { inline_keyboard: [[{ text: "🤖 Меню", callback_data: "cmd:menu" }]] }}
          );
          continue;
        }

        if (pending?.type === "intel_feedback") {
          const { setIntelligence, getIntelligenceKey } = await import("./orchestrator.mjs");

          // Save feedback
          const existing = getIntelligenceKey(db, "research-bot", "intel_feedback", "history") || [];
          existing.push({ feedback: text, at: new Date().toISOString() });
          setIntelligence(db, "research-bot", "intel_feedback", "history", existing.slice(-20), 100);

          // Latest feedback for bots to read on next run
          setIntelligence(db, "research-bot", "intel_feedback", "latest", {
            feedback: text,
            at: new Date().toISOString()
          }, 100);

          // Clear pending
          try {
            const { writeFileSync: wf } = await import("fs");
            const { resolve: res, dirname: dir } = await import("path");
            const { fileURLToPath: ftu2 } = await import("url");
            wf(res(dir(ftu2(import.meta.url)), "../../.data/pending-feedback.json"), JSON.stringify({}));
          } catch {}

          await sendMessage(
            `🧠 <b>Мнение записано!</b>\n\n` +
            `_"${text.slice(0, 200)}"_\n\n` +
            `✅ ResearchBot учтёт это при следующем сканировании (3 AM)\n` +
            `✅ PRBot скорректирует выбор рынков\n` +
            `✅ ContentBot будет писать посты в нужном направлении\n\n` +
            `Накоплено мнений: ${existing.length}`,
            { reply_markup: { inline_keyboard: [[
              { text: "🌍 /intel", callback_data: "cmd:intel" },
              { text: "🤖 Меню", callback_data: "cmd:menu" }
            ]] }}
          );
          continue;
        }

        // Free-text with no pending state — THIS IS THE MAIN CHANNEL
        // Kirill communicates with the system via Telegram. Every message goes to:
        // 1. cortex-conversation.json (feedback-extractor reads this → directives to bots)
        // 2. Claude CLI for an intelligent response
        if (text.length > 5) {
          const now = new Date().toISOString();

          // 1. Save to cortex-conversation.json so feedback-extractor processes it
          try {
            const { readFileSync: rf, writeFileSync: wf } = await import("fs");
            const { resolve: res, dirname: dir } = await import("path");
            const { fileURLToPath: ftu } = await import("url");
            const __d = dir(ftu(import.meta.url));
            const convPath = res(__d, "../../.data/cortex-conversation.json");
            let conv = [];
            try { conv = JSON.parse(rf(convPath, "utf-8")); } catch {}
            conv.push({ role: "user", text, at: now, source: "telegram" });
            // Keep last 100 messages
            if (conv.length > 100) conv = conv.slice(-100);
            wf(convPath, JSON.stringify(conv, null, 2));
          } catch (e) { console.error("[Control] Conv save error:", e.message); }

          // 2. Also save to free_feedback for backward compat
          const existing = getIntelligenceKey(db, "orchestrator", "free_feedback", "history") || [];
          existing.push({ text, at: now });
          setIntelligence(db, "orchestrator", "free_feedback", "history", existing.slice(-30), 80);

          // 3. Detect if this is a TASK (repair/management/action) or just a chat message
          const isTask = /почини|fix|restart|перезапусти|запусти|останови|kill|проверь|check|диагност|repair|сломал|broken|ошибк|error|обнови|update|измени|change|добавь|add|удали|delete|remove|создай|create|напиши код|write code|сделай|поправь/i.test(text);

          if (isTask) {
            await sendMessage(`🔧 Выполняю задачу...`);
          } else {
            await sendMessage(`🧠 Думаю...`);
          }

          // Fire-and-forget brain response (don't block polling)
          (async () => {
            try {
              if (isTask) {
                // TASK MODE: use repair agent with full tool access (Bash, Read, Edit)
                await runRepairAgent(
                  `Kirill sent this task via Telegram. Execute it in the project at ${PROJECT_DIR}.\n\n` +
                  `TASK: ${text}\n\n` +
                  `CONTEXT:\n` +
                  `- Project: linkedin-brand-os (autonomous business system)\n` +
                  `- Bot registry: ${JSON.stringify(Object.fromEntries(Object.entries(KNOWN_BOTS).map(([k,v]) => [k, v.script])), null, 2)}\n` +
                  `- DB: ${PROJECT_DIR}/db/main.db (SQLite)\n` +
                  `- Logs: /tmp/lbo-*.log\n\n` +
                  `RULES:\n` +
                  `- Execute the task, don't just describe what to do\n` +
                  `- If fixing code: read the file, find the bug, edit the file\n` +
                  `- If restarting: kill old process, start new one\n` +
                  `- If checking: read logs, DB, process list\n` +
                  `- Report results in Russian. Max 3000 chars. No em dashes (use hyphens).\n` +
                  `- Be concise - just say what you did and the result.`
                );
                return;
              }

              // CHAT MODE: regular brain response
              const { readFileSync: rf } = await import("fs");
              const { resolve: res, dirname: dir } = await import("path");
              const { fileURLToPath: ftu } = await import("url");
              const __d = dir(ftu(import.meta.url));

              let statusSnippet = "";
              try {
                const status = JSON.parse(rf(res(__d, "../../.data/cortex-live-status.json"), "utf-8"));
                statusSnippet = `Cycle: ${status.cycle}, Last action: ${status.last_action?.description?.slice(0, 100)}, HANDS 24h: ${status.hands_stats_24h?.runs} runs`;
              } catch {}

              let recentConv = [];
              try {
                recentConv = JSON.parse(rf(res(__d, "../../.data/cortex-conversation.json"), "utf-8")).slice(-6);
              } catch {}

              let purposeCtx = "";
              try { purposeCtx = readPurpose().slice(0, 400); } catch {}

              const brainPrompt = `You are CORTEX - an autonomous business system. Kirill is your owner and partner.
He sent a message via Telegram. Respond naturally, concisely, in the same language he used.
${purposeCtx ? `\nSYSTEM PURPOSE: ${purposeCtx}\n` : ""}
RULES:
- If he asks about system state - answer with real data from SYSTEM STATE below
- If he gives a directive - confirm and say what will change
- If he shares a URL/link - USE the WebFetch tool to open and read the page, then analyze the content and suggest what's relevant for us
- If he shares news or idea - analyze briefly and suggest one next step
- If casual - respond briefly and warmly
- Max 2000 chars. No em dashes (use hyphens). No corporate speak.
- You are his PARTNER, not assistant. Speak as equal.
- You CAN use tools: WebFetch (to open URLs), WebSearch (to search the web), Read (to read local files). USE THEM when needed.

SYSTEM STATE: ${statusSnippet}
RECENT: ${recentConv.map(m => `${m.role}: ${m.text?.slice(0, 80)}`).join(" | ")}

MESSAGE: ${text}

Reply in plain text, no JSON.`;

              const response = await callAI(brainPrompt, text, MODEL_MINI, false);
              if (response && response.length > 3) {
                // Save brain response to conversation
                try {
                  const convPath2 = res(__d, "../../.data/cortex-conversation.json");
                  let conv2 = [];
                  try { conv2 = JSON.parse(rf(convPath2, "utf-8")); } catch {}
                  conv2.push({ role: "brain", text: response.slice(0, 500), at: new Date().toISOString(), source: "telegram" });
                  if (conv2.length > 100) conv2 = conv2.slice(-100);
                  const { writeFileSync: wf2 } = await import("fs");
                  wf2(convPath2, JSON.stringify(conv2, null, 2));
                } catch {}
                await sendMessage(response.slice(0, 4000));
              }
            } catch (e) {
              console.error("[Control] Brain async error:", e.message);
              await sendMessage(`Записал. Обработаю в цикле.`);
            }
          })();
        } else {
          await sendMessage(`🧠 Слушаю. Напиши подробнее.`);
        }
        continue;
      }

      if (text === "/menu" || text === "menu") {
        await handleCallback(db, { id: "manual", data: "menu", message: { chat: { id: CHAT_ID }, message_id: 0 } });
      }
      else if (text.startsWith("/leads")) await handleLeads(db);
      else if (text.startsWith("/stats")) await handleStats(db);
      else if (text.startsWith("/brief")) await handleBrief();
      else if (text.startsWith("/intel")) await handleIntel(db);
      else if (text.startsWith("/approve")) {
        const parts = text.split(" ");
        const leadId = parts[1];
        if (leadId) await handleCallback(db, { id: "manual", data: `approved:${leadId}`, message: { chat: { id: CHAT_ID }, message_id: 0 } });
      }
      else if (text.startsWith("/fix")) {
        await handleFix(text.slice(4).trim());
      }
      else if (text.startsWith("/restart")) {
        await handleRestart(text.slice(8).trim());
      }
      else if (text.startsWith("/logs")) {
        await handleLogs(text.slice(5).trim());
      }
      else if (text.startsWith("/run")) {
        await handleRun(text.slice(4).trim());
      }
      else if (text.startsWith("/start") || text.startsWith("/help")) {
        await sendMessage(
          `🤖 *AI Factory Control Panel*\n\n` +
          `Команды:\n` +
          `• /leads — воронка лидов с кнопками\n` +
          `• /stats — статус системы\n` +
          `• /brief — запросить бриф сейчас\n` +
          `• /intel — разведка рынков (горячие страны, сигналы)\n` +
          `• /approve [id] — одобрить сделку\n` +
          `• /fix — диагностика + авторемонт всего\n` +
          `• /fix [бот] — починить конкретный бот\n` +
          `• /restart [бот] — перезапустить бот/демон\n` +
          `• /logs [бот] — последние логи бота\n` +
          `• /run [скрипт] — запустить скрипт\n\n` +
          `_Или просто напиши задачу - система выполнит._`
        );
      }
    }
  } catch (err) {
    console.error("[Control] Poll error:", err.message);
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

export async function runTelegramControl() {
  const db = getDb();
  heartbeat(db, BOT_NAME, "Telegram Control", "polling");
  await poll(db);
  db.close();
}

// Run as persistent daemon — with PID lock to prevent duplicates
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { existsSync, writeFileSync, readFileSync, unlinkSync } = await import("fs");
  const { resolve, dirname } = await import("path");
  const __dir = dirname(fileURLToPath(import.meta.url));
  const PID_FILE = resolve(__dir, "../../.data/telegram-control.pid");

  // Check if another instance is running
  if (existsSync(PID_FILE)) {
    try {
      const oldPid = parseInt(readFileSync(PID_FILE, "utf-8").trim());
      // Check if process is actually alive
      try { process.kill(oldPid, 0); console.log(`[Control] Another instance running (PID ${oldPid}). Exiting.`); process.exit(0); }
      catch { /* process dead, clean up */ unlinkSync(PID_FILE); }
    } catch {}
  }
  writeFileSync(PID_FILE, String(process.pid));
  // ENOENT on PID cleanup is harmless (file already gone, e.g. external kill -9 ran).
  // Only log non-ENOENT errors.
  const safeCleanup = () => {
    try { unlinkSync(PID_FILE); }
    catch (e) { if (e.code !== "ENOENT") console.error("[TG-Control] PID cleanup failed:", e.message); }
  };
  process.on("exit", safeCleanup);
  process.on("SIGTERM", () => { safeCleanup(); process.exit(0); });

  console.log(`[Control] Starting Telegram Control Panel (PID ${process.pid})...`);

  // Preflight
  const precheck = preflight([
    { name: "TELEGRAM_BOT_TOKEN", value: BOT_TOKEN },
    { name: "TELEGRAM_CHAT_ID", value: CHAT_ID },
  ]);
  if (!precheck.ok) {
    console.error(`[${BOT_NAME}] Preflight FAILED: ${precheck.message}`);
    try { const db = getDb(); reportError(db, BOT_NAME, "Telegram Control", precheck.message, "config", "preflight"); db.close(); } catch {}
    process.exit(1);
  }

  const db = getDb();

  // Send startup message
  sendMessage(
    `🟢 *Control Panel запущен*\n\n` +
    `/leads — показать лидов\n` +
    `/stats — статус системы\n` +
    `/brief — бриф прямо сейчас`
  ).catch(() => {});

  // Polling loop
  setInterval(async () => {
    try {
      await poll(db);
      heartbeat(db, BOT_NAME, "Telegram Control", "polling", {}, {
        status: "ok",
        last_success_at: new Date().toISOString(),
        error: null
      });
      try { clearError(db, BOT_NAME); } catch (e) { console.error("[TG-Control] clearError failed:", e.message); }
    } catch (e) {
      heartbeat(db, BOT_NAME, "Telegram Control", "poll error", {}, {
        status: "error",
        last_success_at: null,
        error: e.message
      });
      try { reportError(db, BOT_NAME, "Telegram Control", e.message, "crash", "pollLoop"); } catch (e) { console.error("[TG-Control] reportError failed:", e.message); }
    }
  }, 2000);

  // Keep alive
  process.on("SIGINT", () => { db.close(); process.exit(0); });
}
