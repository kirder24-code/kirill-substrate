import Database from 'better-sqlite3';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function loadEnv(path) {
  try {
    const content = readFileSync(path, 'utf8');
    const env = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return env;
  } catch {
    return {};
  }
}

const env = {
  ...loadEnv(resolve(ROOT, 'apps/api/.env')),
  ...loadEnv(resolve(ROOT, '.env')),
  ...loadEnv(resolve(ROOT, '.env.local')),
};
const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
const PROOF_PATH = resolve(ROOT, '.data/dispatch-proof-warm-replies.json');
const CARDS_PATH = resolve(ROOT, '.data/kirill-warm-reply-cards.json');

if (!BOT_TOKEN || !CHAT_ID) {
  const proof = { dispatched_at: new Date().toISOString(), error: 'Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID', message_ids: [], leads_dispatched: [] };
  writeFileSync(PROOF_PATH, JSON.stringify(proof, null, 2));
  console.error('Missing Telegram credentials');
  process.exit(1);
}

async function sendTelegram(text) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' }),
  });
  return res.json();
}

// Check proof file for existing message_ids
let proofData = null;
if (existsSync(PROOF_PATH)) {
  try {
    proofData = JSON.parse(readFileSync(PROOF_PATH, 'utf8'));
  } catch {}
}

const hasMessageIds = proofData && Array.isArray(proofData.message_ids) && proofData.message_ids.length > 0;

const DB_PATH = resolve(ROOT, '.data', 'linkedin-brand-os.sqlite');
const db = new Database(DB_PATH, { readonly: true });

if (hasMessageIds) {
  // Step 2a: proof exists - send focused top-3 reply card to Kirill
  console.log('Proof file has message_ids. Running Step 2a: top-3 warm reply card for Kirill.');

  const top3 = [];

  // Priority 1: email replies (real humans who wrote back)
  const emailReplies = db.prepare(`
    SELECT id, business_name, business_email, reply_body, reply_type, reply_sentiment,
           reply_received_at, lead_id
    FROM outreach_emails
    WHERE reply_received_at IS NOT NULL
      AND (
        is_meaningful_reply = 1
        OR reply_type IN ('interested','redirect','positive','question')
        OR (reply_body IS NOT NULL AND length(trim(reply_body)) > 20
            AND reply_type NOT IN ('autoreply','remove_request','verification_challenge','support_redirect','unclear'))
      )
    ORDER BY reply_received_at DESC
    LIMIT 3
  `).all();

  for (const e of emailReplies) {
    if (top3.length >= 3) break;
    const snippet = (e.reply_body || '').trim().replace(/\s+/g, ' ').substring(0, 200);
    const firstName = (e.business_name || 'there').split(' ')[0];
    let response;
    if (e.reply_type === 'redirect') {
      response = `Hi ${firstName}, thanks for pointing me to the right person - I appreciate it. Would it be alright if I mentioned your name when I reach out to them?`;
    } else if (e.reply_type === 'interested' || e.reply_sentiment === 'positive') {
      response = `Great to hear from you ${firstName}! I'd love to show you what I built - typically saves service businesses 5-10 hrs/week on admin. Would Tuesday or Wednesday work for a 20-min call?`;
    } else {
      response = `Hi ${firstName}, thanks for getting back to me. I help service businesses automate intake, follow-up, and admin - typically 5-10 hours saved per week. Would a quick 20-min call this week work?`;
    }
    top3.push({ type: 'email', name: e.business_name || 'Unknown', company: e.business_email || '', snippet, response, id: e.id });
  }

  // Priority 2: conversations with actual prospect replies
  if (top3.length < 3) {
    const convs = db.prepare(`
      SELECT id, prospect_name, platform, channel, stage, prospect_pain, conversation_history, next_action, updated_at
      FROM conversations
      WHERE stage IN ('replied','engaged','qualifying')
      ORDER BY updated_at DESC
      LIMIT 5
    `).all();

    for (const c of convs) {
      if (top3.length >= 3) break;
      let snippet = '';
      try {
        const hist = JSON.parse(c.conversation_history || '[]');
        const prospectMsgs = hist.filter(m => m.who === 'prospect' || m.role === 'prospect');
        if (prospectMsgs.length > 0) {
          snippet = (prospectMsgs[prospectMsgs.length - 1].text || prospectMsgs[prospectMsgs.length - 1].content || '').substring(0, 200);
        }
      } catch {}
      const firstName = (c.prospect_name || 'there').split(/[\s_]/)[0];
      let response;
      if (c.next_action && c.next_action.length > 20) {
        response = c.next_action.substring(0, 300);
      } else if (c.prospect_pain) {
        const painSnip = c.prospect_pain.substring(0, 60);
        response = `I hear you on the ${painSnip} challenge - that is exactly the kind of workflow I automate. Want to see how in 20 min?`;
      } else {
        response = `Appreciate the engagement ${firstName}. I build AI workflow systems for service businesses - saves 5-10 hrs/week on admin. Want to see what it looks like for your setup?`;
      }
      top3.push({ type: 'conversation', name: c.prospect_name || 'Unknown', company: `${c.platform || 'reddit'}`, snippet: snippet || '(no quote stored)', response, id: c.id });
    }
  }

  // Priority 3: warming leads
  if (top3.length < 3) {
    const warmLeads = db.prepare(`
      SELECT id, name, company, stage, notes, pain_description, last_contact_at
      FROM leads
      WHERE stage = 'warming'
      ORDER BY last_contact_at DESC
      LIMIT 3
    `).all();

    for (const l of warmLeads) {
      if (top3.length >= 3) break;
      const firstName = (l.name || 'there').split(' ')[0];
      const snippet = l.notes || l.pain_description || '(warming - no reply text stored)';
      const response = `Hi ${firstName}, checking in - have you had a chance to think about the workflow automation question I left? Happy to run a quick 20-min audit call if that helps move things forward.`;
      top3.push({ type: 'warming_lead', name: l.name || 'Unknown', company: l.company || '', snippet: snippet.substring(0, 180), response, id: l.id });
    }
  }

  db.close();

  if (top3.length === 0) {
    console.log('No warm reply leads found in DB for Step 2a card.');
    const cards = { generated_at: new Date().toISOString(), count: 0, cards: [], note: 'No warm reply leads found in DB' };
    writeFileSync(CARDS_PATH, JSON.stringify(cards, null, 2));
    process.exit(0);
  }

  // Build single clean Telegram message for Kirill
  const lines = ['<b>These people replied to your outreach. Here is what to say back to each one:</b>', ''];
  for (let i = 0; i < top3.length; i++) {
    const r = top3[i];
    lines.push(`<b>${i + 1}. ${r.name}</b>${r.company ? ' - ' + r.company : ''} <i>[${r.type}]</i>`);
    if (r.snippet && r.snippet !== '(no quote stored)' && r.snippet !== '(warming - no reply text stored)') {
      lines.push(`Their reply: "${r.snippet.substring(0, 160)}"`);
    }
    lines.push(`Say: ${r.response}`);
    lines.push('');
  }

  const messageText = lines.join('\n').trim();

  let sentMessageId = null;
  try {
    const res = await sendTelegram(messageText);
    if (res.ok) {
      sentMessageId = res.result.message_id;
      console.log(`Sent Kirill warm-reply card: msg_id ${sentMessageId}`);
    } else {
      console.error('Telegram send failed:', res.description);
    }
  } catch (err) {
    console.error('Telegram fetch error:', err.message);
  }

  const cards = {
    generated_at: new Date().toISOString(),
    count: top3.length,
    telegram_message_id: sentMessageId,
    cards: top3.map(r => ({
      name: r.name,
      company: r.company,
      type: r.type,
      snippet: r.snippet,
      suggested_response: r.response,
      id: r.id,
    })),
  };
  writeFileSync(CARDS_PATH, JSON.stringify(cards, null, 2));
  console.log(`Cards written to .data/kirill-warm-reply-cards.json (${top3.length} leads)`);

} else {
  // Step 2b: no proof yet - full dispatch
  console.log('No proof file or empty message_ids. Running Step 2b: full dispatch.');

  const emailReplies = db.prepare(`
    SELECT id, business_name, business_email, business_category, reply_body, reply_type,
           reply_sentiment, reply_received_at, lead_id
    FROM outreach_emails
    WHERE reply_received_at IS NOT NULL
      AND (reply_type NOT IN ('autoreply','remove_request','verification_challenge','support_redirect','unclear')
           OR (reply_type IS NULL AND reply_body IS NOT NULL AND length(trim(reply_body)) > 20))
    ORDER BY reply_received_at DESC
    LIMIT 10
  `).all();

  const warmConversations = db.prepare(`
    SELECT id, prospect_name, platform, channel, stage, prospect_pain,
           conversation_history, next_action, our_offer, updated_at
    FROM conversations
    WHERE stage IN ('replied','engaged','qualifying')
    ORDER BY updated_at DESC
    LIMIT 15
  `).all();

  const warmLeads = db.prepare(`
    SELECT id, name, company, stage, notes, pain_description, last_contact_at
    FROM leads
    WHERE stage = 'warming'
    ORDER BY last_contact_at DESC
    LIMIT 5
  `).all();

  db.close();

  const warmReplies = [];

  for (const e of emailReplies) {
    const replySnippet = (e.reply_body || '').trim().replace(/\s+/g, ' ').substring(0, 180);
    warmReplies.push({
      type: 'email',
      id: e.id,
      lead_id: e.lead_id || e.id,
      name: e.business_name || 'Unknown',
      company: e.business_name || 'Unknown',
      reply_text: replySnippet,
      reply_type: e.reply_type,
      suggested_response: buildEmailSuggestion(e),
    });
  }

  for (const c of warmConversations) {
    let prospectText = '';
    try {
      const hist = JSON.parse(c.conversation_history || '[]');
      const prospectMsgs = hist.filter(m => m.who === 'prospect');
      if (prospectMsgs.length > 0) {
        prospectText = prospectMsgs[prospectMsgs.length - 1].text?.substring(0, 200) || '';
      }
    } catch {}
    warmReplies.push({
      type: 'conversation',
      id: c.id,
      lead_id: c.id,
      name: c.prospect_name || 'Unknown',
      company: `${c.platform || 'reddit'} user`,
      reply_text: prospectText || '(no quote stored)',
      stage: c.stage,
      pain: c.prospect_pain,
      suggested_response: c.next_action || buildConvSuggestion(c),
    });
  }

  for (const l of warmLeads) {
    warmReplies.push({
      type: 'lead',
      id: l.id,
      lead_id: l.id,
      name: l.name || 'Unknown',
      company: l.company || 'Unknown',
      reply_text: l.notes || l.pain_description || '(no signal stored)',
      stage: l.stage,
      suggested_response: `Hi ${l.name?.split(' ')[0] || 'there'}, checking in - have you had a chance to think about the workflow automation question I left? Happy to run a quick 20-min audit call if that helps move things forward.`,
    });
  }

  function buildEmailSuggestion(e) {
    const name = (e.business_name || '').split(' ')[0] || 'there';
    if (e.reply_type === 'redirect') {
      return `Hi ${name}, thanks for the redirect - I'll reach out to the right contact. Would a quick 20-min call this week work to show you what I built for similar businesses?`;
    }
    if (e.reply_type === 'interested' || e.reply_sentiment === 'positive') {
      return `Great to hear from you! I'd love to show you a quick demo - I built a workflow automation system that typically saves service businesses 5-10 hours/week on admin. Would Tuesday or Wednesday work for a 20-min call?`;
    }
    return `Hi ${name}, thanks for getting back to me. I help service businesses automate their intake, follow-up, and admin workflows - typically 5-10 hours saved per week. Would a quick 20-min call this week work?`;
  }

  function buildConvSuggestion(c) {
    if (c.prospect_pain) {
      const painSnip = c.prospect_pain.substring(0, 80);
      return `I hear you on the ${painSnip} - that is exactly the kind of workflow I automate. Happy to show you how in 20 min if you're curious.`;
    }
    return `Appreciate the engagement. I build AI workflow systems for service businesses - saves 5-10 hrs/week on admin. Want to see what it looks like for your setup?`;
  }

  function formatMessage(r) {
    const lines = [
      `<b>WARM REPLY [${r.type.toUpperCase()}]</b>`,
      `<b>Name:</b> ${r.name}`,
      `<b>Company:</b> ${r.company}`,
      r.stage ? `<b>Stage:</b> ${r.stage}` : null,
      r.pain ? `<b>Pain:</b> ${r.pain.substring(0, 120)}` : null,
      ``,
      `<b>Their reply:</b>`,
      r.reply_text ? r.reply_text.substring(0, 300) : '(none stored)',
      ``,
      `<b>Suggested response:</b>`,
      r.suggested_response ? r.suggested_response.substring(0, 400) : '(none)',
      ``,
      `<b>ID:</b> <code>${r.lead_id}</code>`,
    ].filter(l => l !== null);
    return lines.join('\n');
  }

  const dispatched = [];
  const messageIds = [];
  const noRepliesFound = warmReplies.length === 0;

  if (noRepliesFound) {
    console.log('No warm replies found in DB. Writing absence proof.');
  } else {
    console.log(`Found ${warmReplies.length} warm reply records. Dispatching to Telegram...`);

    const headerRes = await sendTelegram(
      `<b>DISPATCH BYPASS - WARM REPLIES</b>\n${new Date().toISOString()}\nFound: ${warmReplies.length} records (${emailReplies.length} email, ${warmConversations.length} conversations, ${warmLeads.length} leads)`
    );
    if (headerRes.ok) messageIds.push(headerRes.result.message_id);

    for (const r of warmReplies) {
      const text = formatMessage(r);
      try {
        const res = await sendTelegram(text);
        if (res.ok) {
          messageIds.push(res.result.message_id);
          dispatched.push({ lead_id: r.lead_id, name: r.name, type: r.type, message_id: res.result.message_id });
          console.log(`  Sent: ${r.name} (${r.type}) -> msg_id ${res.result.message_id}`);
        } else {
          console.error(`  Failed for ${r.name}:`, res.description);
        }
      } catch (err) {
        console.error(`  Error sending for ${r.name}:`, err.message);
      }
    }
  }

  const proof = {
    dispatched_at: new Date().toISOString(),
    warm_replies_found: warmReplies.length,
    breakdown: {
      email_replies: emailReplies.length,
      conversations: warmConversations.length,
      warming_leads: warmLeads.length,
    },
    no_warm_replies: noRepliesFound,
    message_ids: messageIds,
    leads_dispatched: dispatched,
  };

  writeFileSync(PROOF_PATH, JSON.stringify(proof, null, 2));
  console.log(`\nProof written to .data/dispatch-proof-warm-replies.json`);
  console.log(`Dispatched: ${dispatched.length} messages, ${messageIds.length} total msg_ids`);
}
