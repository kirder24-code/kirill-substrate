/**
 * SALES BOT — @LinkedOS_bot
 * Менеджер по продажам. Работает каждые 60 минут.
 *
 * Задачи:
 * 1. Ведёт каждый лид по воронке
 * 2. Генерирует квалификационные сообщения
 * 3. Создаёт персональные коммерческие предложения
 * 4. Следит за follow-up (3 дня без ответа = напоминание)
 * 5. Фиксирует закрытые сделки, активирует BuildBot
 */

import { randomUUID } from "crypto";
import { getDb, BOTS, CHAT_ID, callAI, tgSend, tgSendToKirill, claimTasks, completeTask, heartbeat, createTask, logActivity, isCleanOutreach, MODEL_STRONG, MODEL_DEFAULT, MODEL_MINI, pollMessages, markMessageActedOn, sendMessage, reportError, clearError, getDirectivesFor } from "./orchestrator.mjs";

// SalesBot uses One Voice — all messages to Kirill go through tgSendToKirill()
const BOT_TOKEN = BOTS.sales.token;
const VOICE_TOKEN = BOTS.content.token; // читаем команды/кнопки с главного бота (Tolik_bot)
const BOT_ID = "sales";

// ── Product catalog ──────────────────────────────────────────────────
const SERVICES = {
  "vibe-code-audit":     { name: "Vibe-Code Audit",                price: "$1,500-2,500 CAD", duration: "1 week",   target: "SaaS founders"  },
  "reply-chaser":        { name: "Reply Chaser Automation",        price: "$1,500 CAD",       duration: "1 week",   target: "any business"   },
  "first-10-customers":  { name: "First 10 Customers Sales Motion", price: "$2,000 CAD",       duration: "1 week",   target: "SaaS founders"  },
  "custom-ai-build":     { name: "Custom AI / n8n Build",          price: "$2,500-8,000 CAD", duration: "1-3 weeks", target: "any business"   }
};

const KIRILL_PROFILE = `
Kirill D. — AI Automation Consultant, Calgary, Alberta, Canada.
5.5 years Senior PM at Ukraine's parliament (zero-trust, high-stakes ops).
Physics degree. Builds: n8n, Notion, LLM orchestrators, local AI servers.
Tone: direct, specific, no corporate speak. Short sentences. Real numbers.
BANNED PHRASES (never use): "Hi there", "Hello!", "I can help you", "I specialize in",
"I noticed", "streamline", "leverage", "game-changer", "seamlessly", "Furthermore",
"Let me know if", "I've worked with a client", "feel free to", "don't hesitate",
"I hope this", "ensuring", "enhancing", "reach out", "I'd love to".
`;

function getKirillProfileWithDirectives() {
  let profile = KIRILL_PROFILE;
  try { const purpose = readPurpose().slice(0, 400); if (purpose) profile = `SYSTEM PURPOSE: ${purpose}\n\n` + profile; } catch {}
  try {
    const directives = getDirectivesFor("sales-bot").filter(d => d.active);
    if (directives.length > 0) {
      profile += `\nOWNER DIRECTIVES (from Kirill - HIGHEST PRIORITY):\n` +
        directives.map(d => `  [${d.action.toUpperCase()}] ${d.what}`).join("\n") + "\n";
    }
  } catch {}
  return profile;
}

// ── Generate qualification message ──────────────────────────────────
async function genQualificationMessage(lead) {
  return callAI(
    `${getKirillProfileWithDirectives()}
Write a short, genuine DM to a potential client who showed interest.
Goal: understand their situation better. NOT a sales pitch.
Max 3 sentences. Sound human. Return JSON with: { "message": "..." }
be brief.`,
    `Lead: ${lead.name}, ${lead.role || "role unknown"} at ${lead.company || "company unknown"}
Pain: ${lead.pain_description}
Their post/signal: ${lead.source_url}
Service match: ${lead.service_match}`,
    MODEL_DEFAULT,
    true
  );
}

// ── Generate commercial proposal ─────────────────────────────────────
async function genProposal(lead, serviceKey) {
  const service = SERVICES[serviceKey] || SERVICES["custom-automation"];
  return callAI(
    `${getKirillProfileWithDirectives()}
Write a concise commercial proposal. Be specific. Use their actual pain points.
Return JSON with:
{
  "subject": "email subject",
  "opener": "2 sentences showing you understand their exact problem",
  "deliverables": ["item1", "item2", "item3"],
  "timeline": "X days/weeks",
  "investment": "price range with ROI context",
  "next_step": "one clear action",
  "ps": "one trust-building sentence"
}
be brief.`,
    `Client: ${lead.name}, ${lead.company || ""}
Pain: ${lead.pain_description}
Service: ${service.name} — ${service.price} — ${service.days}
What they told us: ${lead.notes || "No additional context"}`,
    MODEL_STRONG,
    true
  );
}

// ── Send proposal to Kirill ──────────────────────────────────────────
async function notifyProposal(lead, serviceKey, proposal) {
  const service = SERVICES[serviceKey] || SERVICES["custom-automation"];
  const text = [
    `<b>📧 КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ ГОТОВО</b>`,
    ``,
    `<b>Клиент:</b> ${lead.name} — ${lead.company || ""}`,
    `<b>Сервис:</b> ${service.name}`,
    `<b>Цена:</b> ${service.price}`,
    ``,
    `<b>Тема письма:</b> ${proposal.subject}`,
    ``,
    `<b>Открытие:</b>`,
    proposal.opener,
    ``,
    `<b>Что получит клиент:</b>`,
    ...(proposal.deliverables || []).map(d => `• ${d}`),
    ``,
    `<b>Сроки:</b> ${proposal.timeline}`,
    `<b>Инвестиция:</b> ${proposal.investment}`,
    ``,
    `<b>Следующий шаг:</b> ${proposal.next_step}`,
    ``,
    `<b>P.S.</b> ${proposal.ps}`,
    ``,
    `Отправь это предложение клиенту в LinkedIn DM.`,
    `После отправки напиши: /proposal_sent ${lead.id}`
  ].join("\n");

  await tgSendToKirill( text);
}

// ── Отправка с inline-кнопками (One Voice — через VOICE_TOKEN) ────────
async function tgSendWithButtons(text, buttons) {
  await fetch(`https://api.telegram.org/bot${VOICE_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons }
    })
  });
}

// ── Notify new lead ──────────────────────────────────────────────────
async function notifyNewLead(lead) {
  const url = lead.source_url || "";

  // Date check: skip posts older than 30 days (stale leads waste time)
  if (lead.created_at) {
    const ageDays = (Date.now() - new Date(lead.created_at).getTime()) / 86400000;
    if (ageDays > 30) {
      console.log(`[SalesBot] Skip ${lead.name}: lead is ${Math.floor(ageDays)} days old`);
      return;
    }
  }

  // Generate a ready-to-post comment draft so Kirill can act immediately
  const isTwitter = url.includes("x.com") || url.includes("twitter.com");
  let draftComment = "";
  try {
    const prompt = isTwitter
      ? `${getKirillProfileWithDirectives()}
Draft a short X/Twitter reply from Kirill.
RULES:
- MAX 240 characters. One punchy observation + one suggestion.
- No signature, no URL (Twitter threads are visible).
- NO em-dash. Hyphen only.
- Return JSON: { "comment": "..." }
be brief.`
      : `${getKirillProfileWithDirectives()}
Draft a helpful Reddit comment from Kirill to a potential client's post.
RULES:
- 80-130 words MAX. Short paragraphs. No bullet lists.
- Peer tone, NOT salesy. Open with observation about THEIR post.
- 2 specific tactical suggestions that show expertise.
- End with one soft line mentioning launchsoloai.com naturally.
- Sign: "- Kirill, Calgary"
- NO em-dash. Hyphen only.
- NO: "I specialize", "I can help", "feel free", "don't hesitate", "leverage", "streamline"
- Return JSON: { "comment": "..." }
be brief.`;
    const result = await callAI(prompt,
      `Post: ${(lead.pain_description || "").slice(0, 400)}\nURL: ${url}`,
      MODEL_DEFAULT, true);
    draftComment = result?.comment || "";
  } catch (e) {
    console.log(`[SalesBot] Draft failed for ${lead.name}: ${e.message}`);
  }

  // Build card - keep under 4096 chars for Telegram
  const pain = (lead.pain_description || "").slice(0, 150);
  const comment = draftComment ? draftComment.slice(0, 800) : "";

  const text = [
    `🔥 <b>НОВЫЙ ЛИД</b>`,
    `👤 ${lead.name} | 📡 ${lead.source_platform} | ⭐ ${lead.score}/100`,
    ``,
    `<b>Боль:</b> ${pain}`,
    `🔗 ${url}`,
    ...(comment ? [``, `✏️ <b>Коммент:</b>`, `<i>${comment}</i>`] : []),
  ].join("\n");

  await tgSendWithButtons(text, [
    [
      { text: "✅ Написал им", callback_data: `contacted:${lead.id}` },
      { text: "❌ Не подходит", callback_data: `reject:${lead.id}` }
    ],
  ]);
}

// ── Follow-up reminder ───────────────────────────────────────────────
async function sendFollowupReminder(lead, daysSince) {
  const msg = await callAI(
    `${getKirillProfileWithDirectives()}
Write a short follow-up message for a lead that hasn't responded in ${daysSince} days.
Friendly, not pushy. Max 2 sentences. Return JSON: { "message": "..." }
be brief.`,
    `Lead: ${lead.name}, ${lead.company || ""}
Original pain: ${lead.pain_description}
Days since last contact: ${daysSince}`
  );

  const text = [
    `<b>⏰ FOLLOW-UP: ${lead.name}</b>`,
    ``,
    `${daysSince} дней без ответа.`,
    ``,
    `<b>Готовое сообщение:</b>`,
    `<i>${msg.message}</i>`,
    ``,
    `Отправь им это в LinkedIn DM.`,
    `После отправки: /lead_contacted ${lead.id}`
  ].join("\n");

  await tgSendToKirill( text);
}

// ── Check if notes contain banned phrases ────────────────────────────
function hasAIPhrases(text) {
  if (!text) return true;
  const banned = [
    "i can ", "i will ", "i specialize", "streamline", "leverage", "i'd love to",
    "i can help", "i can build", "i can create", "i can set up", "i can guide", "i can design",
    "let me know if", "feel free", "don't hesitate", "i hope this", "ensuring", "enhancing",
    "as an ai", "in my experience helping", "i recently worked", "i've had success with",
    "i help businesses", "i help ", "struggling with", "boosting efficiency", "boosting productivity",
    "boosting roi", "reducing costs", "exploring how", "how are you currently", "how do you currently",
    "are you exploring", "interested in exploring", "boost your", "boost their",
  ];
  const lower = (text || "").toLowerCase();
  return banned.some(p => lower.includes(p));
}

// ── Generate platform-specific outreach message ───────────────────────
async function generateOutreachForLead(lead) {
  const isForumLead = ["n8n_community", "web"].includes(lead.source_platform);
  const isLinkedIn = ["linkedin", "linkedin_global"].includes(lead.source_platform);
  const isReddit = lead.source_platform?.startsWith("r/") || lead.source_platform === "reddit";

  if (isForumLead) {
    // Forum reply — expert commentary, not a pitch
    const result = await callAI(
      `${getKirillProfileWithDirectives()}
Write a reply to this job/consulting post on n8n Community forum.

RULES — CRITICAL:
- Start by acknowledging something SPECIFIC from their post (tool, use case, stack)
- Show you've done this exact thing before — one concrete detail (without "I can")
- Offer a specific approach or ask one clarifying technical question
- Keep it 2-4 sentences, max 400 characters
- End: "— Kirill | n8n automation | Calgary"
- NEVER: "I can", "I will", "I specialize", "streamline", "leverage", "Hello!"
- Sound like a human expert, not a vendor

Return JSON: { "message": "...", "channel": "n8n_forum_reply" }
be brief.`,
      `Post title: ${lead.name}
Their need: ${lead.pain_description}
Their URL: ${lead.source_url}`,
      MODEL_DEFAULT,
      true
    );
    return result?.message || null;
  }

  if (isLinkedIn) {
    const result = await callAI(
      `${getKirillProfileWithDirectives()}
Write a LinkedIn connection note. HARD LIMIT: 200 characters.

RULES:
- Reference their specific role or company pain
- NO "I can help", "I noticed", "I specialize in"
- Sound like a real person reaching out, not a bot
- Max 200 chars — count carefully

Return JSON: { "message": "...", "char_count": N, "channel": "linkedin_connection_note" }
be brief.`,
      `Name: ${lead.name}
Role/company: ${lead.company || lead.role || ""}
Their pain: ${lead.pain_description}
Profile: ${lead.source_url}`,
      MODEL_DEFAULT,
      true
    );
    const msg = result?.message || null;
    // Enforce 200 char limit
    return msg && msg.length <= 200 ? msg : null;
  }

  if (isReddit) {
    const result = await callAI(
      `${getKirillProfileWithDirectives()}
Write a Reddit comment reply to this post asking for help with automation/n8n.
Rules: casual, specific, helpful. No pitch. Mention one concrete thing you'd do.
Max 300 characters. Return JSON: { "message": "..." }
be brief.`,
      `Their post: ${lead.pain_description}\nURL: ${lead.source_url}`,
      MODEL_DEFAULT,
      true
    );
    return result?.message || null;
  }

  // Default: short expert reply
  const result = await callAI(
    `${getKirillProfileWithDirectives()}
Write a short expert reply to this consulting request. 2-3 sentences. No pitch. Show expertise.
Return JSON: { "message": "..." }
be brief.`,
    `Their need: ${lead.pain_description}`,
    MODEL_DEFAULT,
    true
  );
  return result?.message || null;
}

// ── Process new leads: fix bad notes, prepare outreach ───────────────
// Runs silently — no Telegram notifications. BriefAgent shows results at 9 AM.
async function processNewLeads(db) {
  const leadsToProcess = db.prepare(`
    SELECT * FROM leads
    WHERE stage IN ('new', 'briefed') AND score >= 55
    ORDER BY score DESC LIMIT 15
  `).all();

  const needsRewrite = leadsToProcess.filter(l => hasAIPhrases(l.notes));

  if (!needsRewrite.length) {
    console.log(`[SalesBot] All ${leadsToProcess.length} new leads already have clean notes.`);
    return 0;
  }

  console.log(`[SalesBot] Rewriting notes for ${needsRewrite.length} leads with AI phrases...`);
  let fixed = 0;

  // DB connection stays open here across async AI calls — each callAI may take 3-8s.
  // Keep this loop bounded (LIMIT 15 above) to cap max hold time at ~2 minutes.
  for (const lead of needsRewrite) {
    try {
      const message = await generateOutreachForLead(lead);
      if (message && isCleanOutreach(message)) {
        db.prepare(`UPDATE leads SET notes = ?, updated_at = ? WHERE id = ?`)
          .run(message, new Date().toISOString(), lead.id);
        console.log(`  ✓ Fixed notes for: ${lead.name.slice(0, 50)}`);
        fixed++;
      } else {
        console.log(`  ✗ Quality check failed for: ${lead.name.slice(0, 50)}`);
      }
    } catch (err) {
      console.warn(`  ✗ Error for ${lead.name.slice(0, 40)}: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 600));
  }

  console.log(`[SalesBot] processNewLeads: fixed ${fixed}/${needsRewrite.length} notes.`);
  return fixed;
}

// ── Surface email replies to Kirill with exact follow-up copy ────────
async function sendReplyFollowups() {
  const db = getDb();
  db.pragma("busy_timeout = 5000");

  const replied = db.prepare(`
    SELECT * FROM leads
    WHERE stage = 'replied'
    ORDER BY updated_at DESC
    LIMIT 10
  `).all();

  if (!replied.length) {
    await tgSendToKirill(`<b>REPLY FOLLOWUPS</b>\n\nNo email replies found in DB (stage=replied). Nothing to action.`);
    db.close();
    return;
  }

  const cards = [];

  for (const lead of replied) {
    let followUp = "";
    try {
      const result = await callAI(
        `${getKirillProfileWithDirectives()}
You are writing a follow-up reply for Kirill to send to a prospect who replied to his outreach email.

RULES:
- Exactly 2-3 sentences. No more.
- Sound like a real human, not a bot.
- Acknowledge something specific from their reply if available.
- Move toward a discovery call or a specific next step.
- No "I can help", "I specialize", "streamline", "leverage", "feel free", "don't hesitate".
- No em-dash. Hyphen only.
- No money-back guarantees.

Return JSON: { "summary": "1 sentence: what they said", "reply": "exact 2-3 sentence message Kirill should send" }
be brief.`,
        `Name: ${lead.name}
Company: ${lead.company || "unknown"}
Their pain: ${lead.pain_description || ""}
Their reply/notes: ${(lead.notes || "").slice(0, 400)}
Stage: ${lead.stage}`,
        MODEL_DEFAULT,
        true
      );
      const summary = result?.summary || "Replied to outreach";
      const reply = result?.reply || "Thanks for getting back to me. What does your current process look like for this - happy to do a quick 20-min call if that's easier than back-and-forth email.";
      followUp = `<b>From:</b> ${lead.name}${lead.company ? ` - ${lead.company}` : ""}\n<b>Their message:</b> ${summary}\n<b>Send this:</b>\n<i>${reply}</i>`;
    } catch (e) {
      followUp = `<b>From:</b> ${lead.name}\n<b>Error generating reply:</b> ${e.message}`;
    }
    cards.push(followUp);
    await new Promise(r => setTimeout(r, 500));
  }

  const header = `<b>REPLY FOLLOWUPS - ${replied.length} HUMANS REPLIED</b>\nSend these RIGHT NOW. Each one is a live conversation.\n`;
  const body = cards.join("\n\n---\n\n");
  const full = `${header}\n${body}`.slice(0, 4090);

  await tgSendToKirill(full);
  db.close();
  console.log(`[SalesBot] Sent ${replied.length} reply followups to Kirill.`);
}

// ── Main SalesBot run ────────────────────────────────────────────────
async function runSales() {
  const db = getDb();
  // Agents hold DB connections 6000ms+ during async AI calls vs ~5ms for sync queries.
  // busy_timeout prevents "database is locked" from concurrent bot writers during those windows.
  db.pragma("busy_timeout = 5000");
  heartbeat(db, BOT_ID, "SalesBot", "starting");
  // NOTE: All Telegram button/command handling is done by Orchestrator (runs every 1 min).
  // SalesBot only processes task queue — no direct Telegram getUpdates here.

  // Читаем сообщения от OutreachBot
  const messages = pollMessages(db, BOT_ID, 20);
  console.log(`[SalesBot] Received ${messages.length} messages from other bots`);

  for (const msg of messages) {
    if (msg.message_type === "outreach_sent") {
      console.log(`[SalesBot] Outreach sent: ${msg.payload.count} emails`);

      // Обновить stage лидов на "contacted"
      for (const lead of msg.payload.leads) {
        db.prepare(`UPDATE leads SET stage = 'contacted', last_contact_at = ?, updated_at = ? WHERE id = ?`)
          .run(lead.sentAt, new Date().toISOString(), lead.leadId);
      }

      markMessageActedOn(db, msg.id, { leads_updated: msg.payload.count });
    }

    if (msg.message_type === "lead_replied") {
      console.log(`[SalesBot] Lead replied: ${msg.payload.from}`);

      // Обновить stage на "replied" и отправить Кириллу
      db.prepare(`UPDATE leads SET stage = 'replied', updated_at = ? WHERE id = ?`)
        .run(new Date().toISOString(), msg.payload.leadId);

      await tgSendToKirill([
        `🎉 <b>КЛИЕНТ ОТВЕТИЛ!</b>`,
        ``,
        `<b>От:</b> ${msg.payload.from}`,
        `<b>Тема:</b> ${msg.payload.subject}`,
        ``,
        `<b>Сообщение:</b>`,
        msg.payload.body.slice(0, 500),
        ``,
        `Ответь клиенту: /note ${msg.payload.leadId} [твой ответ]`
      ].join("\n"));

      // Отправить конверсию в EvolutionBot
      sendMessage(db, {
        fromBot: BOT_ID,
        toBot: "evolution-bot",
        messageType: "conversion_event",
        payload: {
          leadId: msg.payload.leadId,
          fromStage: "contacted",
          toStage: "replied",
          convertedAt: msg.payload.repliedAt
        },
        priority: 8
      });

      markMessageActedOn(db, msg.id, { notified: true });
    }
  }

  // Process tasks from other bots
  const tasks = claimTasks(db, BOT_ID);
  for (const task of tasks) {
    try {
      if (task.task_type === "new_lead") {
        const lead = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(task.payload.leadId);
        if (lead) {
          await notifyNewLead(lead);
          // Auto-generate proposal for high-score leads
          if (lead.score >= 80 && lead.service_match) {
            const proposal = await genProposal(lead, lead.service_match);
            await notifyProposal(lead, lead.service_match, proposal);
          }
        }
        completeTask(db, task.id);
      }

      if (task.task_type === "followup_lead") {
        const lead = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(task.payload.leadId);
        if (lead) {
          await sendFollowupReminder(lead, task.payload.daysSinceContact || 3);
          // Update last_contact_at so the 3-day counter resets — prevents duplicate follow-ups
          const nextFollowup = new Date(Date.now() + 4 * 86400000).toISOString();
          db.prepare(`UPDATE leads SET last_contact_at = ?, next_followup_at = ?, updated_at = ? WHERE id = ?`)
            .run(new Date().toISOString(), nextFollowup, new Date().toISOString(), lead.id);
          await logActivity(db, "sales", `Follow-up напоминание отправлено: ${lead.name} (${task.payload.daysSinceContact || 3} дней без ответа)`);
        }
        completeTask(db, task.id);
      }

      if (task.task_type === "generate_proposal") {
        const lead = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(task.payload.leadId);
        if (lead) {
          const serviceKey = lead.service_match || "custom-automation";
          const proposal = await genProposal(lead, serviceKey);
          await notifyProposal(lead, serviceKey, proposal);
        }
        completeTask(db, task.id);
      }

      // Генерирует следующий шаг в переговорах на основе заметки Кирилла
      if (task.task_type === "generate_reply") {
        const lead = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(task.payload.leadId);
        if (lead) {
          const reply = await callAI(
            `Be brief.
${getKirillProfileWithDirectives()}
You are helping Kirill respond in an ongoing sales conversation.
Based on what the client just said, suggest the BEST next message.
Goal: move them toward a discovery call OR proposal — whichever makes sense.
Keep it SHORT (2-3 sentences). Sound human. No corporate speak.
Return JSON: { "message": "...", "intent": "qualify_budget|qualify_timeline|book_call|send_proposal|handle_objection", "why": "one sentence explaining the strategy" }
be brief.`,
            `Client: ${lead.name}, ${lead.company || ""}
Pain: ${lead.pain_description}
Service match: ${lead.service_match}
What client just said: ${task.payload.note}
Full conversation history: ${lead.notes || "none"}`
          );

          await tgSendToKirill([
            `💬 <b>СЛЕДУЮЩИЙ ШАГ — ${lead.name}</b>`,
            ``,
            `<b>Рекомендуемый ответ:</b>`,
            `<i>${reply.message}</i>`,
            ``,
            `<b>Стратегия:</b> ${reply.why}`,
            ``,
            `Запиши ответ клиента: /note ${lead.id} [что ответил]`
          ].join("\n"));

          await logActivity(db, "sales", `Следующий шаг для ${lead.name} готов (${reply.intent})`);
        }
        completeTask(db, task.id);
      }

    } catch (err) {
      console.warn(`[SalesBot] Task ${task.task_type} error: ${err.message}`);
    }
  }

  // NOTE: Follow-up scheduling is handled ONLY by Orchestrator (checkStaleLeads).
  // SalesBot processes followup_lead tasks from the queue — no direct overdue check here.
  // This prevents double-sending when both systems run simultaneously.

  // Fix bad AI-generated notes for new leads (silently, brief shows results at 9 AM)
  const fixedNotes = await processNewLeads(db);

  heartbeat(db, BOT_ID, "SalesBot", "tick complete", { processedTasks: tasks.length, fixedNotes }, {
    status: "ok",
    last_success_at: new Date().toISOString(),
    error: null
  });

  if (tasks.length > 0 || fixedNotes > 0) {
    try { clearError(db, BOT_ID); } catch {}
  }

  db.close();
  console.log(`[SalesBot] Done. Processed ${tasks.length} tasks.`);
}

// ── LIVE MODE (24/7 процесс) ──────────────────────────────────────────────────
async function liveMode() {
  console.log(`[SalesBot] Starting in LIVE mode (runs every hour)...`);

  while (true) {
    try {
      console.log(`[SalesBot] Running sales cycle...`);
      await runSales();

      // Спать 1 час
      console.log(`[SalesBot] Sleeping 1 hour until next cycle...`);
      await new Promise(r => setTimeout(r, 60 * 60 * 1000));
    } catch (err) {
      console.error(`[SalesBot] Error in live mode:`, err.message);
      try { const edb = getDb(); heartbeat(edb, BOT_ID, "SalesBot", "error", {}, { status: "error", last_success_at: null, error: err.message }); reportError(edb, BOT_ID, "SalesBot", err.message, "crash", "liveMode"); edb.close(); } catch {}
      await new Promise(r => setTimeout(r, 30 * 60 * 1000)); // retry in 30 min
    }
  }
}

import { fileURLToPath as _ftu } from "url";
import { readPurpose, getWikiContext, appendLog } from "../../wiki/reader.mjs";
if (process.argv[1] === _ftu(import.meta.url)) {
  const isLive = process.argv.includes("live");
  const isReplies = process.argv.includes("replies");
  if (isLive) {
    liveMode().catch(err => {
      console.error(`[SalesBot] Fatal error:`, err);
      process.exit(1);
    });
  } else if (isReplies) {
    sendReplyFollowups().catch(console.error);
  } else {
    runSales().catch(console.error);
  }
}

export { runSales };
