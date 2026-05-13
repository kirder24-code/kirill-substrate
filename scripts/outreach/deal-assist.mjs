/**
 * Deal Assist Layer  - Risk-Based Automation Boundaries
 *
 * Every task from reply to payment is classified:
 *   auto        - system handles, no Kirill needed
 *   semi_auto   - system prepares, Kirill approves (<30 sec)
 *   founder     - Kirill decides and acts (scope ambiguity, reputational risk, walk-away)
 *
 * Justification for each boundary is specific risk, NOT generic "trust."
 */

import { generateAudit } from "./generate-audit.mjs";

// ── Reply patterns + automation boundary per action ──────────────────────────

const REPLY_PATTERNS = {
  auto_reply: {
    patterns: [/auto[- ]?reply/i, /out of office/i, /automatic reply/i, /will reopen/i, /currently away/i, /on vacation/i, /holiday/i],
    intent_score: 0,
    action: "ignore",
    boundary: "auto",
    risk_reason: "zero consequence",
  },
  remove: {
    patterns: [/remove/i, /unsubscribe/i, /stop emailing/i, /don't contact/i, /take me off/i, /not interested/i],
    intent_score: 0,
    action: "remove_and_log",
    boundary: "auto",
    risk_reason: "zero consequence  - mark removed, never contact again",
  },
  wrong_person: {
    patterns: [/wrong person/i, /I don't handle/i, /you should contact/i, /forward this to/i, /not my department/i],
    intent_score: 1,
    action: "ask_for_redirect",
    boundary: "auto",
    risk_reason: "one-sentence ask, no commitment, no risk",
  },
  curiosity: {
    patterns: [/tell me more/i, /what do you mean/i, /how does this work/i, /interesting/i, /sounds cool/i, /what exactly/i],
    intent_score: 2,
    action: "send_breakdown",
    boundary: "semi_auto",
    risk_reason: "warm lead  - tone miscalibration could lose deal. 10-sec review.",
  },
  pricing_ask: {
    patterns: [/how much/i, /what.*cost/i, /price/i, /pricing/i, /what.*charge/i, /rate/i, /budget/i, /quote.*for/i, /what would it take/i, /investment/i],
    intent_score: 3,
    action: "send_scope",
    boundary: "semi_auto",
    risk_reason: "financial  - scope defines delivery commitment. Kirill verifies scope fits this specific business.",
  },
  specific_pain: {
    patterns: [/we.*losing/i, /falling through/i, /nobody follows up/i, /can't keep up/i, /too busy/i, /forget to/i, /miss.*call/i, /open estimates/i, /chasing/i],
    intent_score: 3,
    action: "send_breakdown_then_scope",
    boundary: "semi_auto",
    risk_reason: "they described real pain  - response must match their specific situation. 30-sec review.",
  },
  ready_to_start: {
    patterns: [/let's do it/i, /how do we (get )?start/i, /send.*invoice/i, /ready to go/i, /when can you start/i, /move forward/i, /let's proceed/i, /sign me up/i, /what we need/i, /exactly what/i, /sounds great/i, /I'm in/i, /let's go/i],
    intent_score: 5,
    action: "send_confirmation_and_invoice",
    boundary: "semi_auto",
    risk_reason: "legal/financial  - invoice = payment request. Kirill verifies amount + scope match. 15 sec.",
  },
  objection_price: {
    patterns: [/too expensive/i, /too much/i, /can't afford/i, /over.*budget/i, /cheaper/i, /discount/i, /lower.*price/i],
    intent_score: 2,
    action: "handle_price_objection",
    boundary: "semi_auto",
    risk_reason: "pricing precedent  - first deal price anchors all future deals. Kirill picks: hold / pilot / reduce.",
  },
  objection_trust: {
    patterns: [/have you done this/i, /done this before/i, /any examples/i, /case stud/i, /references/i, /how do I know/i, /guarantee/i, /proof/i, /other.*compan/i, /portfolio/i, /show me/i],
    intent_score: 2,
    action: "handle_trust_objection",
    boundary: "auto",
    risk_reason: "template is honest and pre-approved. No false claims. Zero reputational risk.",
  },
  objection_timing: {
    patterns: [/not right now/i, /maybe later/i, /next month/i, /next quarter/i, /busy season/i, /think about it/i, /need to talk to/i],
    intent_score: 1,
    action: "handle_timing_objection",
    boundary: "auto",
    risk_reason: "zero consequence. 'Check back later' has no downside.",
  },
};

// ── Follow-up actions (all auto) ─────────────────────────────────────────────

const AUTO_FOLLOWUPS = {
  followup_48h: {
    boundary: "auto",
    risk_reason: "pre-written, no commitment, 'any questions?' only",
    draft: (biz) => ({
      subject: `Re: ${biz.name || "your project"}`,
      body: `Hi ${biz.firstName || "there"},\n\nJust checking in  - did you get a chance to look at the scope I sent over? Happy to answer any questions.\n\nKirill`,
    }),
  },
  breakup_day7: {
    boundary: "auto",
    risk_reason: "pre-written, loss aversion, no commitment, zero risk",
    draft: (biz) => ({
      subject: `Re: ${biz.name || "your project"}`,
      body: `Hi ${biz.firstName || "there"},\n\nWanted to follow up one last time. If the timing isn't right, totally fine  - I'll be here when it is.\n\nIf you'd rather I not reach out again, just let me know.\n\nKirill`,
    }),
  },
};

// ── Reply classifier ─────────────────────────────────────────────────────────

function classifyReply(replyText) {
  const text = (replyText || "").trim();
  if (!text || text.length < 3) return { type: "empty", intent_score: 0, action: "ignore", boundary: "auto", risk_reason: "empty reply" };

  for (const [type, config] of Object.entries(REPLY_PATTERNS)) {
    for (const rx of config.patterns) {
      if (rx.test(text)) {
        return {
          type,
          intent_score: config.intent_score,
          action: config.action,
          boundary: config.boundary,
          risk_reason: config.risk_reason,
        };
      }
    }
  }

  return { type: "unclassified", intent_score: 1, action: "send_breakdown", boundary: "semi_auto", risk_reason: "unclassified reply  - needs human review" };
}

// ── Response drafts ──────────────────────────────────────────────────────────

const RESPONSE_DRAFTS = {
  send_breakdown: (biz, audit) => ({
    subject: `Re: ${biz.name || "your business"}`,
    draft: `Hi ${biz.firstName || "there"},

Thanks for getting back to me.

${audit?.audit_paragraph || "Based on what I've seen, there's likely a meaningful amount of revenue slipping through the cracks from open estimates that don't get a callback."}

Here's one thing you could try this week without hiring anyone or buying anything:
Set a recurring reminder every Friday at 4pm to go through your open estimates and call back everyone who hasn't responded. That one habit usually recovers 10-15% of lost work.

If you want, I can put together a specific scope for automating the rest  - takes 5 minutes to read, no commitment. Want me to send it?

Kirill`,
  }),

  send_scope: (biz, audit) => ({
    subject: `Scope for ${biz.name || "your project"}`,
    draft: `Hi ${biz.firstName || "there"},

Based on what you described, here's what I'd set up:

Your estimates follow up on themselves  - customers get a text at 24h and another at 72h, so you never have to chase anyone.

You see every quote at a glance: what's open, what's won, what's lost.

If anything breaks, you'll know immediately.

TIMELINE: 5 business days
INVESTMENT: $1,500 CAD (50% upfront, 50% on delivery)
INCLUDES: Build + walkthrough + docs + 7 days support

PILOT OPTION: If you'd rather start smaller, I can do just the follow-up piece for $750.

Want to move forward? I can start ${getNextMonday()}.

Kirill`,
  }),

  send_breakdown_then_scope: (biz, audit) => ({
    subject: `Re: ${biz.name || "your business"}`,
    draft: `Hi ${biz.firstName || "there"},

That's exactly the pattern I see a lot.

${audit?.audit_paragraph || "Open estimates sitting there with no callback  - jobs going to whoever followed up first."}

${audit?.roi_estimate ? `For a business like yours, that can add up to ${audit.roi_estimate} over a year.` : "Over a year, that adds up fast."}

I can set up a system where your estimates follow up on themselves  - text at 24h, email at 72h, alert to you at day 5 if it's going cold. Takes 5 business days to build.

Want me to send a specific scope and price? Or happy to answer questions first.

Kirill`,
  }),

  send_confirmation_and_invoice: (biz) => ({
    subject: `Confirmed  - starting ${biz.name || "your project"} on ${getNextMonday()}`,
    draft: `Hi ${biz.firstName || "there"},

Great  - let's do it.

Quick confirmation:
- Scope: Quote follow-up automation (text at 24h, email at 72h, alert at day 5)
- Price: $1,500 CAD (50% now, 50% on delivery)
- Timeline: 5 business days from payment
- Support: 7 days post-delivery

Invoice for $750 (first 50%): [INSERT WAVE INVOICE LINK]

Once paid, I'll start on ${getNextMonday()}.

Kirill`,
    kirill_action: "Insert Wave invoice link. Verify amount matches agreed scope. Send.",
  }),

  handle_price_objection: (biz) => ({
    subject: `Re: ${biz.name || "your business"}`,
    draft: `Hi ${biz.firstName || "there"},

I get it  - $1,500 is real money.

Two options:

1. PILOT ($750): I build just the follow-up piece  - automatic text at 24h and 72h for open estimates. You see if it works. If it does, we do the rest later.

2. REDUCED SCOPE ($1,000): Follow-up automation + a simple view of what's open/won/lost. No dashboard, just a clean list.

Both include walkthrough + 7 days support. Which fits better?

Kirill`,
    kirill_action: "Decide: offer pilot ($750), reduced ($1,000), or hold at $1,500. Then send.",
  }),

  handle_trust_objection: (biz) => ({
    subject: `Re: ${biz.name || "your business"}`,
    draft: `Hi ${biz.firstName || "there"},

Fair question.

I'll be honest  - I'm building my client base in Calgary right now. I don't have a wall of testimonials yet.

What I can show you:
- A working demo of exactly what your follow-up system would look like
- The exact process: you describe your workflow, I build it in 5 days, you test it, you own it
- Guarantee: if it doesn't save you at least 5 hours/month within 30 days, I keep refining until it does

Happy to do a quick screen share if seeing it live would help. Or I can send screenshots  - your call.

Kirill`,
  }),

  handle_timing_objection: (biz) => ({
    subject: `Re: ${biz.name || "your business"}`,
    draft: `Hi ${biz.firstName || "there"},

No problem at all. Timing matters.

One thought  - spring is when most service businesses see the biggest spike in estimates. If the follow-up system is running before things get busy, you catch the revenue when it matters most.

But if later works better, I'll check back in a few weeks. Just let me know.

Kirill`,
  }),

  ask_for_redirect: (biz) => ({
    subject: `Re: ${biz.name || "your business"}`,
    draft: `Hi ${biz.firstName || "there"},

Thanks for letting me know. Would you mind pointing me to the right person? I'd appreciate the intro.

Kirill`,
  }),

  remove_and_log: () => ({ subject: null, draft: null }),
  ignore: () => ({ subject: null, draft: null }),
};

function getNextMonday() {
  const d = new Date();
  const day = d.getDay();
  const daysUntilMonday = day === 0 ? 1 : day === 1 ? 7 : 8 - day;
  d.setDate(d.getDate() + daysUntilMonday);
  return d.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" });
}

// ── Deal stages + loss reasons ───────────────────────────────────────────────

const DEAL_STAGES = ["reply_received", "classified", "breakdown_sent", "scope_sent", "accepted", "invoice_sent", "payment_received", "build_started", "delivered", "stalled", "lost"];
const LOSS_REASONS = ["wrong_buyer", "wrong_offer", "wrong_price", "wrong_timing", "no_trust", "no_budget", "went_silent", "chose_competitor", "unknown"];

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * @param {string} replyText
 * @param {object} business  - { name, category, email, ownerName, website }
 * @param {object} [auditData]
 * @returns {{ classification, intent_score, boundary, risk_reason, recommended_action, response_draft, close_timing, stage, followups, kirill_action }}
 */
export function assistDeal(replyText, business, auditData = null) {
  const classification = classifyReply(replyText);
  const firstName = business.ownerName ? business.ownerName.split(" ")[0] : null;
  const biz = { ...business, firstName };

  let audit = auditData;
  if (!audit && business.category) {
    try { audit = generateAudit(business, { websiteExcerpt: "", painSignals: [] }); } catch {}
  }

  const drafter = RESPONSE_DRAFTS[classification.action] || RESPONSE_DRAFTS.send_breakdown;
  const response = drafter(biz, audit);

  // Determine stage
  let stage = "reply_received";
  if (classification.intent_score >= 5) stage = "accepted";
  else if (classification.intent_score >= 2) stage = "classified";
  else if (classification.action === "remove_and_log") stage = "lost";

  // Close timing
  let close_timing;
  if (classification.intent_score >= 5) close_timing = "Send confirmation + invoice NOW. Within 1 hour.";
  else if (classification.intent_score >= 3) close_timing = "Send scope within 24h. Auto follow-up at 48h. Auto break-up at day 7.";
  else if (classification.intent_score >= 2) close_timing = "Send breakdown within 24h. If they engage, send scope 24h later.";
  else close_timing = "No action or auto-handle.";

  // Kirill action (only for semi_auto and founder)
  let kirill_action;
  if (classification.boundary === "auto") {
    kirill_action = null; // System handles entirely
  } else if (classification.boundary === "semi_auto") {
    kirill_action = response.kirill_action || "Review draft (~15 sec). Approve or edit. Send.";
  } else {
    kirill_action = "Founder decision required. See risk_reason.";
  }

  // Auto follow-ups to queue (only after scope sent)
  const followups = classification.intent_score >= 3 ? [
    { action: "followup_48h", delay_hours: 48, boundary: "auto", draft: AUTO_FOLLOWUPS.followup_48h.draft(biz) },
    { action: "breakup_day7", delay_hours: 168, boundary: "auto", draft: AUTO_FOLLOWUPS.breakup_day7.draft(biz) },
  ] : [];

  return {
    classification: classification.type,
    intent_score: classification.intent_score,
    boundary: classification.boundary,
    risk_reason: classification.risk_reason,
    recommended_action: classification.action,
    response_draft: response,
    close_timing,
    stage,
    followups,
    kirill_action,
    available_stages: DEAL_STAGES,
    loss_reasons: LOSS_REASONS,
  };
}
