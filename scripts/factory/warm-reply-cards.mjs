import { writeFileSync } from "fs";
import { getDb, tgSendToKirill, callAI, MODEL_MINI, setIntelligence, getIntelligenceKey, emitEvent } from "./orchestrator.mjs";

const RESULTS_PATH = new URL("../../.data/warm-reply-cards.json", import.meta.url).pathname;

function esc(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function generateDraft(name, company, subject, replySnippet, painDescription) {
  const context = replySnippet
    ? `Their reply: ${replySnippet}`
    : `Their known pain: ${painDescription || "not captured"}`;

  try {
    return await callAI(
      `You write concise follow-up replies for a solo AI consultant named Kirill.
Format as exactly 3 bullet points starting with "-". No em-dashes - use hyphens only. No greetings or sign-offs.
Under 200 words total.
Bullet 1: acknowledge their specific situation using their first name, reference something concrete from context.
Bullet 2: one sharp qualifying question about a manual process, time cost, or specific pain point.
Bullet 3: low-friction CTA for a 20-minute call this week.
Return only the 3 bullet points. No intro, no outro.`,
      `First name: ${name}
Company: ${company || "their company"}
Original subject: ${subject || "(none)"}
${context}`,
      MODEL_MINI,
      false
    );
  } catch {
    return `- ${name}, appreciate you getting back - want to make sure I address what's actually relevant to you.\n- What's the single most time-consuming manual step in your current workflow right now?\n- Would a 20-minute call this week work to map out exactly where automation could save you the most time?`;
  }
}

async function run() {
  const dryRun = false;
  const db = getDb();
  const results = [];

  try {
    const emails = db.prepare(`
      SELECT oe.id, oe.lead_id, oe.business_name, oe.business_email, oe.subject,
             oe.reply_body, oe.status, oe.sent_at, oe.reply_received_at,
             l.name AS lead_name, l.company, l.pain_description
      FROM outreach_emails oe
      LEFT JOIN leads l ON oe.lead_id = l.id
      WHERE (
        oe.status IN ('warming', 'replied')
        OR (oe.reply_received_at IS NOT NULL AND oe.reply_body IS NOT NULL)
      )
      AND oe.status NOT IN ('bounced', 'invalid_email', 'invalid_no_email')
      ORDER BY COALESCE(oe.reply_received_at, oe.created_at) DESC
      LIMIT 7
    `).all();

    const toProcess = dryRun ? emails.slice(0, 1) : emails;
    console.log(`[WarmReplyCards] Found ${emails.length} warm/replied leads${dryRun ? " (dry-run: top 1 only)" : ""}`);

    for (const email of toProcess) {
      if (!dryRun) {
        const alreadySent = getIntelligenceKey(db, "warm-reply-cards", "tg_card", String(email.id));
        if (alreadySent) {
          console.log(`[WarmReplyCards] Skip ${email.business_name} (card already sent)`);
          continue;
        }
      }

      const rawName = email.lead_name || email.business_name || "there";
      const firstName = rawName.split(/[\s,]/)[0];
      const company = email.company || email.business_name || "";
      const replySnippet = (email.reply_body || "").replace(/\s+/g, " ").trim().slice(0, 300);
      const painDescription = (email.pain_description || "").slice(0, 200);

      const draft = await generateDraft(firstName, company, email.subject, replySnippet, painDescription);

      const lastMsg = replySnippet || "(no reply yet - warming)";
      const shortMsg = lastMsg.slice(0, 140) + (lastMsg.length > 140 ? "..." : "");
      const companyLine = company ? ` @ ${esc(company)}` : "";

      const text = `<b>${esc(firstName)}${companyLine}</b>\n`
        + `📧 ${esc(email.subject || "(no subject)")}\n`
        + `💬 <i>${esc(shortMsg)}</i>\n\n`
        + `<b>Draft reply:</b>\n<pre>${esc(draft.trim())}</pre>`;

      const buttons = {
        inline_keyboard: [[
          { text: "Approve", callback_data: `send_email:${email.id}` },
          { text: "Skip", callback_data: `skip_reply:${email.id}` }
        ]]
      };

      let tgResult = null;
      try {
        tgResult = await tgSendToKirill(text, { reply_markup: buttons });
        const msgId = tgResult?.result?.message_id;
        const sentAt = new Date().toISOString();
        console.log(`[WarmReplyCards] Sent card for ${email.business_name}: msg_id=${msgId}`);
        if (!dryRun) {
          setIntelligence(db, "warm-reply-cards", "tg_card", String(email.id), { sent_at: sentAt, msg_id: msgId || null });
        }
        emitEvent(db, {
          fromBot: "warm-reply-cards",
          eventType: "warm_reply_card_sent",
          payload: { lead_id: email.lead_id || email.id, email_id: email.id, msg_id: msgId || null, sent_at: sentAt, dry_run: dryRun }
        });
        console.log(`[WarmReplyCards] Logged to bot_events: lead_id=${email.lead_id || email.id} sent_at=${sentAt}`);
      } catch (e) {
        console.error(`[WarmReplyCards] Failed to send card for ${email.business_name}: ${e.message}`);
      }

      results.push({
        email_id: email.id,
        business_name: email.business_name,
        business_email: email.business_email,
        subject: email.subject,
        reply_snippet: replySnippet.slice(0, 200),
        draft: draft.trim(),
        tg_message_id: tgResult?.result?.message_id || null,
        sent_at: new Date().toISOString()
      });

      await new Promise(r => setTimeout(r, 800));
    }

  } finally {
    db.close();
  }

  writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
  console.log(`[WarmReplyCards] Done. ${results.length} cards sent. Results: ${RESULTS_PATH}`);
}

run().catch(e => {
  console.error("[WarmReplyCards] Fatal:", e.message);
  process.exit(1);
});
