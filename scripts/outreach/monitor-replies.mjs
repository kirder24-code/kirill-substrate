/**
 * IMAP Reply Monitor
 * Polls inbox for replies to cold outreach emails.
 * Sends Telegram alert to Kirill when a potential client replies.
 *
 * Run standalone: node scripts/outreach/monitor-replies.mjs
 * Or called from outreach-bot.mjs on schedule
 *
 * CONTEXT-FRAGMENTATION RULE (added 2026-05-09 from awareness apply, score 14):
 *
 * This monitor sits at a critical handoff: email reply -> conversation tracker -> Telegram card.
 * Cross-platform context loss is the documented bottleneck in multi-agent outbound setups.
 * Symptoms when this rule is violated:
 *   - reply lands in inbox but Telegram card has no thread context
 *   - Kirill replies to Telegram card without seeing original outbound message body
 *   - same prospect's repeated replies treated as separate conversations
 *
 * Required pattern when sending a reply notification:
 *   - include lead_id AND outbound_email_id so the Telegram card can show full thread
 *   - never collapse a multi-turn conversation into a single "they replied" notification
 *   - if conversation_id is missing for the sender, log it and create one before notifying
 *     (do not silently drop the reply because tracker was empty)
 *
 * Reference: r/AI_Agents 2026 thread on context fragmentation in multi-agent outbound systems.
 */
import Imap from "imap";
import { simpleParser } from "mailparser";
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { findExperimentForEmail, recordReplyOutcome } from "../factory/experiment-portfolio.mjs";
import { spawnSync } from "child_process";
import { env, tgSendToKirill, setIntelligence, getIntelligenceKey } from "../factory/orchestrator.mjs";
import { readWiki, appendLog } from "../../wiki/reader.mjs";
import { recordEmailReply } from "../factory/conversation-tracker.mjs";

// Reply classifier integration (Apr 7 2026). Calls reply-classifier-bot subprocess.
// Returns null on any error - fail open so the original Telegram notification still goes out.
function classifyReply(replyText, channel, leadId) {
  try {
    const input = JSON.stringify({ reply_text: replyText, channel, lead_id: leadId || null });
    const r = spawnSync("node", [resolve(__dirname, "../factory/reply-classifier.mjs"), "-"], {
      input, encoding: "utf-8", timeout: 120_000,
    });
    if (r.status !== 0 || !r.stdout) return null;
    const parsed = JSON.parse(r.stdout);
    return parsed.error ? null : parsed;
  } catch (e) {
    console.error("[ReplyMonitor] classifier error:", e.message);
    return null;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../../.data/linkedin-brand-os.sqlite");

const IMAP_HOST = env.OUTREACH_IMAP_HOST || "outlook.office365.com";
const IMAP_PORT = parseInt(env.OUTREACH_IMAP_PORT || "993");
const IMAP_USER = env.OUTREACH_EMAIL;
const IMAP_PASS = env.OUTREACH_PASSWORD;

function getDb() { return new Database(DB_PATH); }

function openInbox(imap) {
  return new Promise((resolve, reject) => {
    imap.openBox("INBOX", false, (err, box) => {
      if (err) reject(err);
      else resolve(box);
    });
  });
}

function fetchMessages(imap, criteria, fetchOptions) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const f = imap.search(criteria, (err, uids) => {
      if (err) return reject(err);
      if (!uids || uids.length === 0) return resolve([]);

      const fetch = imap.fetch(uids, fetchOptions);
      fetch.on("message", (msg) => {
        const msgData = { uid: null, raw: "" };
        msg.on("body", (stream) => {
          let buffer = "";
          stream.on("data", (chunk) => buffer += chunk.toString("utf8"));
          stream.once("end", () => { msgData.raw = buffer; });
        });
        msg.once("attributes", (attrs) => { msgData.uid = attrs.uid; });
        msg.once("end", () => messages.push(msgData));
      });
      fetch.once("error", reject);
      fetch.once("end", () => resolve(messages));
    });
  });
}

// Known senders that should trigger immediate Telegram alert
const IMPORTANT_SENDERS = [
  { match: "fiverr.com",       label: "💼 Fiverr",       emoji: "🛒" },
  { match: "upwork.com",       label: "💼 Upwork",       emoji: "🛒" },
  { match: "peopleperhour.com",label: "💼 PeoplePerHour",emoji: "🛒" },
  { match: "contra.com",       label: "💼 Contra",       emoji: "🛒" },
  { match: "linkedin.com",     label: "💼 LinkedIn",     emoji: "🔗" },
];

async function scanFullInbox(imap, db) {
  // Scan ALL unread messages in inbox — catch Fiverr, LinkedIn, any inbound
  try {
    const messages = await fetchMessages(imap, ["UNSEEN"], { bodies: "" });
    if (!messages.length) return;

    for (const msg of messages) {
      try {
        const parsed = await simpleParser(msg.raw);
        const from = (parsed.from?.text || "").toLowerCase();
        const subject = parsed.subject || "(no subject)";
        const bodyText = (parsed.text || "").slice(0, 600);

        // Check if it's from an important platform
        const platform = IMPORTANT_SENDERS.find(p => from.includes(p.match));

        // Filter out marketing/onboarding emails — only alert on real messages/orders
        const isMarketing = /spread the word|mean business|community standards|perfect price|still want to sell|bring.*business|get to know|verify|confirm|welcome|tips for|get started/i.test(subject);
        if (platform && isMarketing) continue;

        // Fiverr-specific: only alert on real orders and client messages, not system notifications
        const isFiverr = from.includes("fiverr.com");
        if (isFiverr) {
          const isRealFiverrEvent = /new order|buyer message|new message|order placed|buyer request|new inquiry|someone messaged|order completed/i.test(subject);
          const isFiverrSpam = /impressions|saved your gig|gig views|gig clicks|optimize|rank higher|seller tip|gig performance|search ranking|gig analytics|profile visit/i.test(subject);
          // If it's a known spam type — skip it
          if (isFiverrSpam) continue;
          // If it's not a known real event AND not explicitly a message/order — skip (too risky to send noise)
          if (!isRealFiverrEvent) continue;
        }

        if (platform) {
          console.log(`[ReplyMonitor] ${platform.emoji} Inbound from ${platform.label}: ${subject}`);

          // Check if already notified — use setIntelligence/getIntelligenceKey (correct schema with id)
          const seenKey = `inbox_${msg.uid || subject.slice(0, 40)}`;
          let alreadySeen = false;
          try {
            alreadySeen = !!getIntelligenceKey(db, "email-monitor", "seen", seenKey);
          } catch (e) { console.error("[ReplyMonitor] Reply processing error:", e.message); }
          if (alreadySeen) continue;

          // Mark as seen BEFORE sending — prevents duplicate if Telegram times out
          try {
            setIntelligence(db, "email-monitor", "seen", seenKey, "1", 100);
          } catch (err) {
            console.warn("[ReplyMonitor] DB dedup save failed:", err.message);
          }

          // Alert Kirill — strip HTML special chars to avoid Telegram parse errors
          const safeFrom = (parsed.from?.text || from).replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const safeSubject = subject.replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const safeBody = bodyText.replace(/</g, "&lt;").replace(/>/g, "&gt;");
          await tgSendToKirill(
            `${platform.emoji} <b>Новое письмо — ${platform.label}</b>\n\n` +
            `<b>От:</b> ${safeFrom}\n` +
            `<b>Тема:</b> ${safeSubject}\n\n` +
            `${safeBody}\n\n` +
            `⚡️ Проверь и ответь быстро — время реакции важно!`
          );
          console.log(`[ReplyMonitor] Notified Kirill about ${platform.label}: ${subject}`);
        }
      } catch (err) {
        console.warn("[ReplyMonitor] scanFullInbox message error:", err.message);
      }
    }
  } catch (err) {
    console.warn("[ReplyMonitor] Full inbox scan error:", err.message);
  }
}

export async function checkForReplies() {
  if (!IMAP_USER || !IMAP_PASS) {
    const missing = [!IMAP_USER && "OUTREACH_EMAIL", !IMAP_PASS && "OUTREACH_PASSWORD"].filter(Boolean);
    throw new Error(`[ReplyMonitor] IMAP credentials missing in apps/api/.env: ${missing.join(", ")}`);
  }
  console.log(`[ReplyMonitor] IMAP config: host=${IMAP_HOST}:${IMAP_PORT} user=${IMAP_USER}`);

  const db = getDb();

  const sentEmails = db.prepare(`
    SELECT * FROM outreach_emails WHERE status = 'sent' AND reply_received_at IS NULL AND business_email IS NOT NULL AND business_email != ''
  `).all();

  console.log(`[ReplyMonitor] Checking inbox for replies to ${sentEmails.length} sent emails + full inbox scan...`);

  // Search last 30 days regardless of SEEN/UNSEEN — replies Kirill already opened in mail client
  // are SEEN and would be missed by an UNSEEN filter. Dedup system prevents double-processing.
  const _months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const _d30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const sinceDate = `${String(_d30.getDate()).padStart(2,"0")}-${_months[_d30.getMonth()]}-${_d30.getFullYear()}`;

  console.log(`[ReplyMonitor] Checking inbox for replies to ${sentEmails.length} sent emails...`);

  const replies = [];

  await new Promise((resolve, reject) => {
    const imap = new Imap({
      user: IMAP_USER,
      password: IMAP_PASS,
      host: IMAP_HOST,
      port: IMAP_PORT,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: 120000,
      connTimeout: 120000,
      socketTimeout: 120000,
    });

    imap.once("ready", async () => {
      try {
        await openInbox(imap);

        // STEP 1: Scan full inbox for Fiverr/LinkedIn/platform notifications
        await scanFullInbox(imap, db);

        // STEP 2: Check for replies from businesses we cold-emailed
        const senderEmails = sentEmails.map(e => e.business_email);

        for (const senderEmail of senderEmails) {
          try {
            const messages = await fetchMessages(
              imap,
              [["SINCE", sinceDate], ["FROM", senderEmail]],
              { bodies: "" }
            );

            for (const msg of messages) {
              const parsed = await simpleParser(msg.raw);
              const sentRecord = sentEmails.find(e => e.business_email === senderEmail);

              // Dedup: skip if already notified for this email
              const replyDedup = `reply_${senderEmail}_${msg.uid || (parsed.subject || "").slice(0, 30)}`;
              try {
                if (getIntelligenceKey(db, "email-monitor", "seen", replyDedup)) {
                  console.log(`[ReplyMonitor] Already notified for ${senderEmail}, skipping`);
                  continue;
                }
              } catch (e) { console.error("[ReplyMonitor] Reply processing error:", e.message); }

              const htmlStr = typeof parsed.html === "string" ? parsed.html : "";
              const replyText = parsed.text?.slice(0, 2000) || htmlStr.slice(0, 2000) || "";
              const subject = parsed.subject || "(no subject)";

              // Detect auto-responders (OOO, vacation, auto-reply)
              const isAutoReply = /auto[- ]?reply|automatic reply|out of office|out-of-office|on vacation|holiday|will reopen|will reply once|currently away|auto[- ]?response/i.test(subject + " " + replyText);

              // Detect bounce-backs (Apr 8 2026 fix - was creating spam in Telegram)
              const isBounce = /undelivered mail|mail delivery (failed|failure)|delivery status notification|returned to sender|mailer.daemon|mail.delivery.subsystem|postmaster|550 5\.\d|recipient.*rejected|user unknown|no such (user|recipient|mailbox)|address.*not found|550 .*does not exist/i.test(subject + " " + replyText.slice(0, 500));

              // Detect "From: Mailer-Daemon" which is the canonical bounce sender
              const fromHeader = (parsed.from?.text || "").toLowerCase();
              const isMailerDaemon = /mailer.?daemon|postmaster@|mail.delivery|noreply|do.not.reply/i.test(fromHeader);

              if (isAutoReply || isBounce || isMailerDaemon) {
                const reason = isBounce || isMailerDaemon ? "BOUNCE" : "AUTO-REPLY";
                console.log(`[ReplyMonitor] ⏭ ${reason} from ${senderEmail} (${sentRecord?.business_name}) — skipping notification`);
                // Save to DB as bounce/auto-reply, NOT a real reply
                db.prepare(`
                  UPDATE outreach_emails
                  SET reply_body = ?, updated_at = datetime('now')
                  WHERE business_email = ? AND status = 'sent'
                `).run(`[${reason}] ` + replyText.slice(0, 500), senderEmail);
                // Mark sent record as bounced if it was a hard bounce
                if (isBounce || isMailerDaemon) {
                  db.prepare(`UPDATE outreach_emails SET status='bounced' WHERE business_email = ? AND status = 'sent'`).run(senderEmail);
                }
                // V1: classify auto-replies/bounces
                try {
                  const rt = isBounce ? "autoreply" : "autoreply";
                  db.prepare(`
                    UPDATE outreach_emails
                    SET reply_type = ?, reply_sentiment = 'neutral', objection_type = 'none',
                        action_required = 'no_action', is_meaningful_reply = 0, classified_at = datetime('now')
                    WHERE business_email = ?
                  `).run(rt, senderEmail);
                } catch {}
                setIntelligence(db, "email-monitor", "seen", replyDedup, reason.toLowerCase(), 100);
                continue;
              }

              console.log(`[ReplyMonitor] 🎉 Reply from ${senderEmail} (${sentRecord?.business_name})`);
              console.log(`[ReplyMonitor] Subject: ${subject}`);

              // Update DB
              const replyTime = new Date().toISOString();
              db.prepare(`
                UPDATE outreach_emails
                SET status = 'replied', reply_received_at = ?, reply_body = ?, updated_at = datetime('now')
                WHERE business_email = ? AND status = 'sent'
              `).run(replyTime, replyText, senderEmail);

              // Mark as seen to prevent duplicates
              setIntelligence(db, "email-monitor", "seen", replyDedup, "notified", 100);

              // Track in conversation tracker
              try {
                const originalBody = sentRecord?.email_body || sentRecord?.subject || "";
                recordEmailReply(
                  sentRecord?.business_name || senderEmail,
                  replyText,
                  originalBody
                );
              } catch (convErr) {
                console.error("[ReplyMonitor] Conversation tracking error:", convErr.message);
              }

              // Update execution evidence with outcome (Layer 1)
              try {
                db.prepare(`UPDATE execution_evidence SET response_received = 1, response_text = ?, response_at = ?, outcome_value = 'reply', outcome_tier = 'tier1_reply' WHERE target_name = ? AND response_received = 0`)
                  .run(replyText.slice(0, 500), replyTime, sentRecord?.business_name || senderEmail);
              } catch (e) { console.error("[ReplyMonitor] Reply processing error:", e.message); }

              // Auto-classify reply via reply-classifier (Apr 7 2026 integration)
              // Apr 8 2026: skip Telegram notification entirely if classifier flags spam.
              // Fail open: if classifier crashes, original notification still goes out unchanged.
              let classifierBlock = "";
              let suppressNotification = false;
              try {
                const classification = classifyReply(replyText, "cold_email", null);
                if (classification && !classification.error) {
                  const emoji = { hot_interest: "🔥", soft_interest: "👀", polite_no: "🙅", hard_no: "❌", off_topic: "🤷", spam: "🗑", need_more_context: "❓" }[classification.classification] || "•";
                  classifierBlock = `\n\n${emoji} *Auto-classified:* ${classification.classification} (${classification.confidence})\n*Action:* ${classification.recommended_next_action}\n*Angle:* ${classification.next_message_angle || "-"}`;
                  console.log(`[ReplyMonitor] classified ${senderEmail}: ${classification.classification}/${classification.confidence}`);

                  // Map old classifier output to V1 structured fields
                  const replyTypeMap = {
                    hot_interest: "positive_interest", soft_interest: "soft_interest",
                    polite_no: "objection", hard_no: "objection",
                    off_topic: "unclear", spam: "spam_warning", need_more_context: "unclear",
                  };
                  const sentimentMap = {
                    hot_interest: "positive", soft_interest: "positive",
                    polite_no: "negative", hard_no: "negative",
                    off_topic: "neutral", spam: "negative", need_more_context: "neutral",
                  };
                  const objectionMap = {
                    polite_no: "not_needed", hard_no: "no_budget",
                  };
                  const actionMap = {
                    hot_interest: "follow_up", soft_interest: "follow_up",
                    polite_no: "no_action", hard_no: "suppress_contact",
                    off_topic: "manual_review", spam: "suppress_contact", need_more_context: "manual_review",
                  };
                  const meaningfulSet = new Set(["positive_interest", "soft_interest", "objection"]);

                  const rt = replyTypeMap[classification.classification] || "unclear";
                  const rs = sentimentMap[classification.classification] || "neutral";
                  const ot = objectionMap[classification.classification] || "none";
                  const ar = actionMap[classification.classification] || "manual_review";
                  const im = meaningfulSet.has(rt) ? 1 : 0;

                  // Store structured classification in outreach_emails
                  try {
                    db.prepare(`
                      UPDATE outreach_emails
                      SET reply_type = ?, reply_sentiment = ?, objection_type = ?, action_required = ?,
                          is_meaningful_reply = ?, classified_at = datetime('now')
                      WHERE business_email = ? AND status = 'replied'
                    `).run(rt, rs, ot, ar, im, senderEmail);
                    console.log(`[ReplyMonitor] V1 stored: ${senderEmail} → ${rt} meaningful=${im} action=${ar}`);

                    // Update experiment outcome if this reply belongs to an experiment
                    try {
                      const emailRow = db.prepare("SELECT template_version FROM outreach_emails WHERE business_email = ? ORDER BY sent_at DESC LIMIT 1").get(senderEmail);
                      if (emailRow?.template_version) {
                        const exp = findExperimentForEmail(db, emailRow.template_version);
                        if (exp) {
                          const outcomeType = im === 1 ? "meaningful" : (rt === "remove_request" || rs === "negative") ? "negative" : "noise";
                          recordReplyOutcome(db, exp.id, outcomeType);
                          console.log(`[ReplyMonitor] Experiment ${exp.experiment_key}: ${outcomeType} reply recorded`);
                        }
                      }
                    } catch (e) { console.error("[ReplyMonitor] experiment outcome error:", e.message); }
                  } catch (e) { console.error("[ReplyMonitor] V1 store error:", e.message); }

                  // Suppress notification for spam/hard_no with high confidence
                  if (classification.classification === "spam" || (classification.classification === "hard_no" && classification.confidence === "high")) {
                    suppressNotification = true;
                    console.log(`[ReplyMonitor] ⏭ suppressing notification - classified as ${classification.classification}`);
                  }

                  // Revenue Signal Classification V1 (Apr 14 2026)
                  // Runs only on meaningful replies (im === 1)
                  try {
                    if (im === 1) {
                      const replyLower = replyText.toLowerCase();
                      let revType = "curious_reply";
                      let revScore = 1;
                      let moneyStep = 0;
                      let followPri = 1;

                      // Quote/pricing request (highest signal)
                      if (/what.*cost|how much|pric|quote|budget|rate|fee|invest/i.test(replyLower)) {
                        revType = "quote_request"; revScore = 5; moneyStep = 1; followPri = 5;
                      }
                      // Call/meeting intent
                      else if (/let.*talk|call.*me|book.*time|schedule|meet|zoom|chat this week|hop on|15 min/i.test(replyLower)) {
                        revType = "call_intent"; revScore = 4; moneyStep = 1; followPri = 4;
                      }
                      // Commercial interest (asks for details, scope, next step)
                      else if (/send.*more|more detail|how.*work|what.*include|scope|timeline|tell me more|walk me through|show me|example/i.test(replyLower)) {
                        revType = "commercial_interest"; revScore = 3; moneyStep = 0; followPri = 3;
                      }
                      // Objection with potential
                      else if (/maybe later|not right now|already have|not.*time|check back|next quarter|revisit/i.test(replyLower)) {
                        revType = "objection_with_potential"; revScore = 2; moneyStep = 0; followPri = 2;
                      }
                      // Default: curious reply
                      else if (/interesting|thanks|cool|good point|makes sense|nice/i.test(replyLower)) {
                        revType = "curious_reply"; revScore = 1; moneyStep = 0; followPri = 1;
                      }

                      db.prepare(`
                        UPDATE outreach_emails
                        SET revenue_signal_type = ?, revenue_signal_score = ?, money_step_detected = ?,
                            followup_priority = ?, revenue_classified_at = datetime('now')
                        WHERE business_email = ? AND status = 'replied'
                      `).run(revType, revScore, moneyStep, followPri, senderEmail);
                      console.log(`[ReplyMonitor] Revenue: ${senderEmail} → ${revType} score=${revScore} money=${moneyStep} priority=${followPri}`);
                    } else {
                      // Non-meaningful: mark as not revenue relevant
                      db.prepare(`
                        UPDATE outreach_emails
                        SET revenue_signal_type = 'not_revenue_relevant', revenue_signal_score = 0,
                            money_step_detected = 0, followup_priority = 0, revenue_classified_at = datetime('now')
                        WHERE business_email = ? AND (status = 'replied' OR reply_body IS NOT NULL)
                      `).run(senderEmail);
                    }
                  } catch (e) { console.error("[ReplyMonitor] revenue classification error:", e.message); }
                }
              } catch (e) { console.error("[ReplyMonitor] classify wrapper error:", e.message); }

              if (suppressNotification) {
                setIntelligence(db, "email-monitor", "seen", replyDedup, "suppressed_classified", 100);
                continue;
              }

              // Send Telegram notification
              const notification = `🎯 *Потенциальный клиент ответил!*

🏢 *${sentRecord?.business_name || senderEmail}*
📧 ${senderEmail}
📝 *Тема:* ${subject}

💬 *Ответ:*
${(parsed.text || "").slice(0, 500)}${classifierBlock}

👆 Проверь inbox и ответь!`;

              await tgSendToKirill(notification, { parse_mode: "Markdown" });
              console.log("[ReplyMonitor] Telegram notification sent!");

              db.prepare(`
                UPDATE outreach_emails SET telegram_notified = 1 WHERE business_email = ?
              `).run(senderEmail);

              replies.push({ from: senderEmail, name: sentRecord?.business_name, subject: parsed.subject });
            }
          } catch (err) {
            console.warn(`[ReplyMonitor] Error checking ${senderEmail}:`, err.message);
          }
        }

        imap.end();
        resolve();
      } catch (err) {
        imap.end();
        reject(err);
      }
    });

    imap.once("error", reject);
    imap.connect();
  });

  db.close();
  console.log(`[ReplyMonitor] Done. Found ${replies.length} new replies.`);
  return replies;
}

async function testImapConnection() {
  if (!IMAP_USER || !IMAP_PASS) {
    console.error(`[ImapTest] FATAL: OUTREACH_EMAIL or OUTREACH_PASSWORD missing in apps/api/.env`);
    return;
  }
  console.log(`[ImapTest] Connecting to ${IMAP_HOST}:${IMAP_PORT} as ${IMAP_USER}...`);
  await new Promise((resolve, reject) => {
    const imap = new Imap({
      user: IMAP_USER, password: IMAP_PASS,
      host: IMAP_HOST, port: IMAP_PORT,
      tls: true, tlsOptions: { rejectUnauthorized: false },
      authTimeout: 30000, connTimeout: 30000,
    });
    imap.once("ready", () => {
      imap.openBox("INBOX", true, (err, box) => {
        if (err) { console.error("[ImapTest] openBox error:", err.message); imap.end(); reject(err); return; }
        console.log(`[ImapTest] OK - INBOX: ${box.messages.total} total, ${box.messages.unseen ?? "?"} unseen`);
        imap.end();
        resolve();
      });
    });
    imap.once("error", (err) => { console.error("[ImapTest] Connection FAILED:", err.message); reject(err); });
    imap.connect();
  });
}

// Overall script timeout: 300s (5 min) to prevent hanging forever
const SCRIPT_TIMEOUT = setTimeout(() => {
  console.error("[ReplyMonitor] Script timeout (300s) reached, forcing exit");
  process.exit(1);
}, 300_000);
SCRIPT_TIMEOUT.unref(); // don't keep process alive just for the timer

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--test")) {
    testImapConnection().catch(console.error);
  } else {
    checkForReplies().then(r => {
      if (r.length > 0) {
        console.log("\n🎉 New replies:");
        r.forEach(reply => console.log(`  - ${reply.name} <${reply.from}>`));
      } else {
        console.log("\n📭 No new replies.");
      }
    }).catch(console.error);
  }
}
