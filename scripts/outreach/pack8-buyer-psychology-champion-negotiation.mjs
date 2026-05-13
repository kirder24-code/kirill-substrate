/**
 * Pack 8 — Buyer Psychology, Champion Conversion & Negotiation Under Ambiguity
 *
 * Hardest last-mile selling problems. Extends Pack 7 with deeper psychology layers,
 * champion mechanics, negotiation architecture, and ambiguity discipline.
 *
 * Sources: Close (6), Pack 7 stakeholder + Pack 5 qualification (reuse),
 * Hormozi $100M Offers + Leads (deep extraction), PG Do Things That Don't Scale,
 * Castos (reuse), Pack 6 doctrine, Pack 4C adaptation, Stress Tests 1-2 (applied cases).
 */

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 1: STRUCTURED RULES — PER SOURCE EXTRACTION
// ══════════════════════════════════════════════════════════════════════════════

export const PACK8_EXTRACTED_RULES = [

  // ── SOURCE 1: Close — "Too Expensive" (deeper layer beyond Pack 7) ────────

  {
    source: "Close — How to Respond to 'Too Expensive'",
    tier: "primary",
    type: "price_objection_psychology",
    pattern: "Price objection has 5 distinct roots: (1) genuinely insufficient funds, (2) has money but wants a deal, (3) uninterested — using price as polite exit, (4) dislikes something about you/product, (5) perceives low value vs alternatives. Virtual Close Test: 'If I could offer this at $X, would we have a deal right now?' YES instantly = real budget issue. New concerns appear = price was masking something else entirely.",
    evidence: "Close CEO Steli Efti: Virtual Close technique + 5 hidden causes framework",
    anti_pattern: "Treating all 'too expensive' the same. Offering discount to someone whose real objection is trust. Dropping price for someone who's using price as polite exit (they won't buy at ANY price).",
    applicable_to_us: true,
    why_applicable: "Pack 7 added 2-step diagnosis. Pack 8 adds the deeper layer: WHICH of the 5 roots is it? Each root has a completely different correct response. Discount only works for root #1. Roots #3-4 should trigger graceful exit, not harder selling.",
    confidence: "high",
    extracted_rule: "After initial diagnostic ('Is it the amount or something else about the scope?'), classify into 5 roots: (1) Budget=real → pilot at $750. (2) Wants deal → hold price, add guarantee, reframe value. (3) Polite exit → test: 'Is this something you actually want to solve right now, or is the timing just off?' If timing → schedule. If vague → accept the no gracefully. (4) Dislike → ask what's not sitting right. Fix or walk away. (5) Low value perception → cost-of-inaction reframe with their specific numbers.",
    target_component: "deal-assist.mjs (handle_price_objection 5-root classification)",
    expected_metric_change: "zero unnecessary discounts to non-budget objectors",
    review_window: "after 5 price objections",
    risk: "medium — over-diagnosing could feel like interrogation. Keep questions natural.",
    apply_mode: "build",
  },

  // ── SOURCE 2: Close — "I Need to Think About It" (psychology layer) ───────

  {
    source: "Close — How to Deal with 'I Need to Think About It'",
    tier: "primary",
    type: "stall_psychology",
    pattern: "Three types of No: Generic (early, lacks info), Maybe (mid-stage, specific blocker), Real (misalignment). 'Think about it' is almost never what it sounds like. Underneath: fear of making wrong decision, unvoiced specific concern, need for another person's input, or genuine processing time. The SILENCE after 'think about it' is where deals die — not the words themselves.",
    evidence: "Close: 'If you aren't getting rejected daily, your goals aren't ambitious enough.' Track rejection rate as health metric.",
    anti_pattern: "Accepting 'think about it' and waiting passively. Pushing harder (creates adversarial dynamic). Sending more information (overwhelms, doesn't address the unvoiced concern).",
    applicable_to_us: true,
    why_applicable: "Pack 7 added diagnose-the-stall question. Pack 8 adds: what to do with EACH answer. And critically — what to do when they DON'T answer the diagnostic question (just repeat 'I just need some time'). That's the hardest case.",
    confidence: "high",
    extracted_rule: "After diagnostic question ('what specifically are you thinking through?'): (A) They name price → handle as price objection. (B) They name scope → clarify scope. (C) They name partner → equip champion. (D) They say 'just need time' with no specifics → this is either genuine processing or hidden no. Give ONE time-bound next step: 'No rush at all. Mind if I check back Thursday?' If Thursday = silence → one more touch. If still silence → accept the no. Do NOT interpret vague 'need time' as buying signal.",
    target_component: "deal-assist.mjs (stall_diagnosis branching logic)",
    expected_metric_change: "faster resolution of 'think about it' — either to next step or to clean exit",
    review_window: "after 5 stall encounters",
    risk: "low",
    apply_mode: "build",
  },

  // ── SOURCE 3: Close — Buying Signals (pattern-based interpretation) ───────

  {
    source: "Close — What Are Buying Signals",
    tier: "primary",
    type: "signal_pattern_reading",
    pattern: "Buying signals must be read as PATTERNS not isolated events. Single signal = noise. Pattern of signals = intent. Key patterns: (1) Speed of reply acceleration (replies getting faster = interest rising). (2) Question specificity increase (from 'what do you do' to 'how would this work with Jobber' = moving from browsing to evaluating). (3) Stakeholder introduction ('my partner should see this' = they're internally selling). (4) Future language ('when could you start' vs 'if we did this').",
    evidence: "Close: signals 'can be misinterpreted as they are not always explicit indications.' Full conversation context required.",
    anti_pattern: "Treating email open as engagement. Treating 'interesting' as intent. Treating single pricing question from unknown contact as hot lead. Interpreting every question as buying signal.",
    applicable_to_us: true,
    why_applicable: "Stress Test 2 revealed: warm HVAC lead's message pattern (6 messages with escalating specificity + pricing question + stakeholder introduction + scope expansion) = clear buying pattern. System must detect these multi-signal patterns, not just classify individual messages.",
    confidence: "high",
    extracted_rule: "Intent escalation detection: track signal_sequence per lead. Pattern A (browsing→evaluating): 'tell me more' → specific question about their tool/setup → pricing question = intent escalating, respond fast. Pattern B (stalling): 'interesting' → silence → 'still thinking' → silence = intent flat, stop investing. Pattern C (champion emerging): any mention of another person who 'should see this' = multi-stakeholder mode activated. Pattern D (buying): pricing question + timeline question + scope discussion in same thread = intent 4-5, treat as active deal.",
    target_component: "deal-assist.mjs (signal_sequence tracking per lead)",
    expected_metric_change: "better allocation of Kirill's time to genuinely escalating leads",
    review_window: "after 10 multi-message conversations",
    risk: "low",
    apply_mode: "build",
  },

  // ── SOURCE 4: Close — Follow-Up (value-add discipline) ────────────────────

  {
    source: "Close — How to Follow Up with Prospects",
    tier: "primary",
    type: "follow_up_value_discipline",
    pattern: "80% of prospects say no 4 times before yes. But follow-up must ADD VALUE each time, not just 'check in.' Each touch should bring something new: relevant stat, new proof asset, seasonal angle, case study snippet. 'Just following up' = worst follow-up possible. SMS: 97% opened within 15 minutes (vs email open rates). Omnichannel: alternate between email, text, voice. Never guilt-trip.",
    evidence: "Close: 44% quit after one follow-up. 92% give up after four nos. Average 8 touches to reach prospect.",
    anti_pattern: "'Just checking in' follow-ups. Same message repeated. Same channel every time. Following up daily (too frequent). Quitting after 2 touches on warm leads.",
    applicable_to_us: true,
    why_applicable: "Pack 7 extended cadence to 48h→7→14→30→45. Pack 8 adds: what each touch must CONTAIN. A follow-up without new value is spam, regardless of timing.",
    confidence: "high",
    extracted_rule: "Each follow-up must carry a specific value payload: Touch 1 (48h): 'Any questions about the scope?' (natural check-in). Touch 2 (Day 7): New angle — seasonal urgency, relevant stat, or audit insight they haven't seen. Touch 3 (Day 14): Proof asset — demo screenshot, industry result, or 'I built something similar for [anonymous case]'. Touch 4 (Day 30): Market trigger — 'Spring is starting, this is when most estimates come in.' Touch 5 (Day 45): Breakup — 'If timing isn't right, no worries.' Each touch must be different channel if possible (email → text → email → text → email).",
    target_component: "deal-assist.mjs (AUTO_FOLLOWUPS with value payloads), send-followups.mjs",
    expected_metric_change: "higher response rate on follow-ups, fewer dead sequences",
    review_window: "after 10 complete follow-up sequences",
    risk: "low",
    apply_mode: "build",
  },

  // ── SOURCE 5-6: Close — 25 + 44 Objections (pattern extraction) ──────────

  {
    source: "Close — Sales Objections (25 + 44 combined extraction)",
    tier: "primary",
    type: "objection_hidden_dynamics",
    pattern: "Every objection contains a HIDDEN DYNAMIC beyond the words. 'We already have someone' = fear of switching cost + loyalty to existing person. 'Not a priority' = either wrong pitch angle or genuine deprioritization. 'Just send info' = avoiding live conversation where they'd have to say no. 'I've heard negative things' = they've ALREADY formed an opinion, you're playing defense. The response must address the DYNAMIC, not just the words.",
    evidence: "Close: 'Pay attention to context, not just content. Listen to tone and enthusiasm level.' Watch for contradictions between answers.",
    anti_pattern: "Responding to the literal words of an objection. Ignoring the emotional subtext. Treating 'send me info' as a real request for information (it's an escape route).",
    applicable_to_us: true,
    why_applicable: "Stress Test 2: roofing lead's 'interested, under $1,000 maybe, probably not worth it' — the word 'probably' and 'maybe' reveal uncertainty, not rejection. The hidden dynamic: they're comparing cost to their existing manual person's time. Response must address THAT comparison, not just our price.",
    confidence: "high",
    extracted_rule: "For each objection, identify and address the hidden dynamic: 'Too expensive' → dynamic: comparing to something (what?). 'Already have someone' → dynamic: switching cost fear. 'Send me info' → dynamic: avoiding commitment conversation. 'Not a priority' → dynamic: either wrong angle or genuine. Test: 'Is solving [specific pain] important to you?' If yes → wrong angle. If no → genuine deprioritization, schedule later.",
    target_component: "deal-assist.mjs (hidden_dynamic field per objection type)",
    expected_metric_change: "responses that address root cause, not surface objection",
    review_window: "after 10 objection encounters",
    risk: "low",
    apply_mode: "build",
  },

  // ── SOURCE 7-8: Close — Decision Makers + Multi-Stakeholder ───────────────

  {
    source: "Close — Decision Maker + Multi-Stakeholder Selling",
    tier: "primary",
    type: "champion_power_assessment",
    pattern: "Internal champion benefits: intel on buying process, shorter cycle, deal recovery. BUT champion ≠ closer. 'Don't overrely on champion's selling ability. When they lack answers, it damages their credibility.' Always push for direct signer access. Champions need: FAQs, case studies, demos, presentation materials. Provide them with ANSWERS to the questions they'll face, not just information about your product.",
    evidence: "Close: 'YOU should talk with decision-makers — not just your champions.' Team selling increases win rates 258%.",
    anti_pattern: "Relying on champion to sell internally without equipping them. Never speaking to the actual signer. Over-equipping with complex materials (they won't use them). Pushing for signer access before champion is committed (feels like you're going around them).",
    applicable_to_us: true,
    why_applicable: "Stress Test 2 HVAC scenario: wife is champion, husband is signer. System must assess champion STRENGTH — how committed is she? How well can she sell internally? What support does she need?",
    confidence: "high",
    extracted_rule: "Champion strength assessment: STRONG champion = asks proactive questions, offers to show partner, gives timeline, comes back with partner's specific concerns. WEAK champion = says 'I'll mention it', goes silent, gives no timeline, never relays partner's feedback. For strong champions: equip with one-pager + offer direct signer access. For weak champions: push harder for direct signer access ('would it help if I spoke with them directly?'). If champion goes silent after equipping → the champion has decided not to champion. Accept it.",
    target_component: "deal-assist.mjs (champion_strength scoring), stakeholder handling logic",
    expected_metric_change: "faster identification of weak vs strong champions, appropriate escalation",
    review_window: "after 5 multi-stakeholder deals",
    risk: "medium — pushing for direct access too early can offend champion",
    apply_mode: "build",
  },

  // ── SOURCE 9-10: Pack 7 + Pack 5 (synthesized champion rules) ─────────────

  {
    source: "Pack 7 Stakeholder + Pack 5 Qualification (synthesis)",
    tier: "primary",
    type: "authority_detection_timing",
    pattern: "Pack 7: ask authority question early. Pack 5: owner email = highest priority lead signal. Stress Test 2: authority wasn't detected until message 6 of 6 ('husband owns it'). Six messages invested before discovering she can't sign. Earlier detection = earlier correct routing.",
    evidence: "Stress Test 2 HVAC: 6 messages before authority revealed. Ideal: detected by message 2.",
    anti_pattern: "Waiting for the prospect to volunteer authority info. Assuming the person who emails back is the signer. Only asking about authority when pricing comes up.",
    applicable_to_us: true,
    why_applicable: "System must embed authority detection in the FIRST substantive reply, not after scope/pricing. First reply should include: 'Are you the one who'd sign off on something like this, or would someone else need to be involved?' This doesn't feel pushy in context of a warm intro.",
    confidence: "high",
    extracted_rule: "Authority detection MUST happen in first or second message exchange. Embed naturally: 'Quick question — are decisions like this something you handle, or does someone else need to weigh in?' If answer reveals multi-stakeholder → immediately shift to champion-equipping mode BEFORE sending scope or pricing. Never send pricing to someone who can't approve it — send them the one-pager to forward instead.",
    target_component: "deal-assist.mjs (authority_check in send_breakdown, timing logic)",
    expected_metric_change: "fewer deals that invest 5+ messages before discovering non-authority contact",
    review_window: "after 5 multi-message conversations",
    risk: "low — natural question in business context",
    apply_mode: "build",
  },

  // ── SOURCE 11: Hormozi — $100M Offers (value equation + guarantees) ───────

  {
    source: "Hormozi — $100M Offers: Value Equation + Guarantee Architecture",
    tier: "primary",
    type: "value_framing",
    pattern: "Value = (Dream Outcome × Perceived Likelihood) / (Time Delay × Effort). Increase value by: (1) making outcome bigger + more specific, (2) increasing certainty (proof + guarantee), (3) reducing time to result, (4) reducing buyer effort. 'People pay for certainty.' 'Beginner mistake: make bigger claims. Expert move: reduce time and effort.' Done-for-you > DIY. Guarantee types: unconditional, conditional (Hormozi's favorite: 'If you don't get X in Y time, we Z'), anti-guarantee, performance-based.",
    evidence: "Hormozi: 'If you can reduce time delay to zero and effort to zero, you have infinitely valuable product.' Conditional guarantee example: 'If you don't get 20 clients in 30 days, next month free.'",
    anti_pattern: "Competing on price (reduces numerator instead of increasing it). Making buyer do significant work. Vague guarantees ('satisfaction guaranteed'). No guarantee at all. Claiming bigger outcomes without backing with proof or guarantee.",
    applicable_to_us: true,
    why_applicable: "Our value stack: Dream Outcome = stop losing jobs to slow follow-up. Likelihood = demo + guarantee. Time = 3 days. Effort = give us access + 30 min review. This is already strong but must be COMMUNICATED in this order in every scope. Additionally: our guarantee ('5 hours/month or free refinement') is conditional — Hormozi's favorite type. Should be MORE prominent.",
    confidence: "high",
    extracted_rule: "Every scope email must present the value equation explicitly: (1) 'Here's what changes: [dream outcome in their language]' (2) 'Here's why it'll work: [demo/proof/guarantee]' (3) 'Here's how fast: 3 business days' (4) 'Here's your effort: give me access, 30 min review at the end, that's it.' (5) 'Here's the guarantee: If this doesn't save you 5+ hours/month in 30 days, I keep working at no charge.' Price comes AFTER the value stack, not before.",
    target_component: "deal-assist.mjs (send_scope template — value stack ordering)",
    expected_metric_change: "fewer price objections because value is pre-framed",
    review_window: "after 5 scopes sent",
    risk: "low",
    apply_mode: "build",
  },
  {
    source: "Hormozi — $100M Offers: Pricing Psychology",
    tier: "primary",
    type: "pricing_psychology",
    pattern: "'Those who pay the most, pay the most attention.' 'There is no strategic benefit to being second cheapest.' 'People want to buy expensive things — they just need a reason.' Price-Quality Virtuous Cycle: higher price → better results possible → higher customer attention → better outcomes → justifies higher price. Never discount the main offer — add bonuses instead.",
    evidence: "Hormozi: generic weight-loss $19. Weight-loss for shift-nurses: $1,997. Same core program. Dan Kennedy: no benefit to second cheapest.",
    anti_pattern: "Racing to be cheapest. Discounting to win deal (trains buyers that prices are negotiable). Lowering price without removing scope. Feeling guilty about charging $1,500 for 3 days of work.",
    applicable_to_us: true,
    why_applicable: "$1,500 for a 3-day build with guarantee and support is NOT expensive for what it delivers. $750 pilot is even more reasonable. The system must never apologize for or soften the price. Price confidence = credibility signal.",
    confidence: "high",
    extracted_rule: "Never soften price delivery. State it clearly with value context, not apologetically. Wrong: 'It would be... about $750... if that works for your budget.' Right: '$750. Half upfront, half on delivery. 3 business days. Includes walkthrough, docs, and 7 days of support. Guarantee: saves 5 hours/month in 30 days or I keep refining free.' Confidence in stating price = confidence in delivering value.",
    target_component: "deal-assist.mjs (pricing delivery tone), Pack 6 operating posture",
    expected_metric_change: "fewer reflexive discounting decisions",
    review_window: "ongoing",
    risk: "low — confidence is earned by delivering",
    apply_mode: "already_applied",
  },

  // ── SOURCE 12: Hormozi — $100M Leads (route quality + warm first) ─────────

  {
    source: "Hormozi — $100M Leads: Core Four + Route Quality",
    tier: "primary",
    type: "route_quality_hierarchy",
    pattern: "Only 4 ways to generate leads: (1) Warm Outreach (private, 1:1), (2) Free Content (public, 1:many), (3) Cold Outreach (private, 1:1), (4) Paid Ads (public, 1:many). Sequence: warm → content → cold → ads. Rule of 100: 100 contacts/day OR 100 min content OR $100 ads, for 100 days. 'More, Better, New': first do MORE of what's working, then do it BETTER, then try something NEW. Warm leads > cold (trust pre-exists). Referral leads = highest quality.",
    evidence: "Hormozi Lead Quality Hierarchy: referral > warm > content > cold > paid",
    anti_pattern: "Starting with cold outreach before exhausting warm network. Adding new channels before current channel is maxed. Optimizing before having enough volume. Splitting attention across 4 channels with <100 attempts each.",
    applicable_to_us: true,
    why_applicable: "Our portfolio: warm LinkedIn (money_score 21/30) is ABOVE cold email (15/30) in money proximity — Hormozi confirms this. System should ensure Kirill's warm outreach is maxed before investing heavily in cold. Rule of 100: we should be hitting 100 contacts/day or 100 minutes content/day. Currently doing ~15 emails/day.",
    confidence: "high",
    extracted_rule: "Route priority for Kirill's daily time: (1) Reply to warm leads FIRST (highest conversion). (2) Send warm outreach — message 5-10 LinkedIn connections per day asking 'know anyone who...' (3) THEN cold email to scored leads. (4) Reddit content only when 1-3 are done for the day. Never skip warm to do cold. Warm outreach ceiling: Kirill's 525 LinkedIn connections. At 10/day = 52 days before exhausted. This channel has a shelf life — use it NOW.",
    target_component: "daily operating loop (Pack 6), portfolio strategy",
    expected_metric_change: "more warm conversations, faster first client",
    review_window: "30 days",
    risk: "low",
    apply_mode: "semi_auto",
  },

  // ── SOURCE 13: Paul Graham — Do Things That Don't Scale ───────────────────

  {
    source: "Paul Graham — Do Things That Don't Scale (applied to negotiation)",
    tier: "primary",
    type: "manual_negotiation_advantage",
    pattern: "Manual selling = learning what automated systems can never discover. Every manual price conversation teaches: what budget feels natural, what scope sounds right, what words close, what words lose. Superhuman: manual onboarding = 2x activation. The discomfort of manual selling IS the competitive advantage — you learn what scripts to write for the automation.",
    evidence: "PG: 'recruit users individually.' Pack 3B: Superhuman manual onboarding = 2x referrals.",
    anti_pattern: "Trying to template every conversation before having 10 real ones. Avoiding manual selling because it's uncomfortable. Assuming Pack 7-8 rules replace the need for real conversations.",
    applicable_to_us: true,
    why_applicable: "These packs give Kirill better starting frameworks. But the real rules will come from his first 10 conversations. Every framework here is a hypothesis until tested against real Calgary HVAC/landscaping/plumbing owners.",
    confidence: "high",
    extracted_rule: "Packs 1-8 = starting frameworks. Real rules come from logged outcomes of actual conversations. After every real conversation, log: what they said that surprised you, what response worked, what response failed, what the packs predicted vs what actually happened. First 10 conversations will rewrite 30% of these rules. That's correct — it means the system is learning.",
    target_component: "learning loop (Pack 6), win/loss protocol (Pack 7)",
    expected_metric_change: "framework accuracy improves with each real conversation",
    review_window: "after 10 real conversations",
    risk: "zero",
    apply_mode: "already_applied",
  },

  // ── SOURCE 14-15: Castos + Pack 7 Negotiation (scope protection) ──────────

  {
    source: "Castos + Pack 7 Negotiation Logic (synthesis)",
    tier: "primary",
    type: "scope_boundary_architecture",
    pattern: "Castos: fixed scope, one request at a time. Pack 7: never absorb scope without price. Hormozi: never discount the main offer — add bonuses instead. Synthesis: when buyer asks for more, the STRUCTURE of the response matters more than the answer. Structure: validate → phase → price. This preserves enthusiasm AND margin.",
    evidence: "Pack 7 negotiation table + Castos productized service model + Hormozi bonus architecture",
    anti_pattern: "Saying 'no' flatly to add-on requests. Saying 'yes' and absorbing everything. Negotiating scope while discussing price (conflating two different conversations).",
    applicable_to_us: true,
    why_applicable: "Stress Test 2 HVAC: 3 features requested (missed calls + text missed callers + maintenance reminders). The validate→phase→price structure handled it perfectly. Must be encoded as default behavior, not ad-hoc.",
    confidence: "high",
    extracted_rule: "Scope expansion protocol — 3 steps, always in this order: (1) VALIDATE: 'Great idea — that would definitely add value.' (never say 'no' or 'that's out of scope'). (2) PHASE: 'Let's get [core] working first. Once you see it live, [add-on] is Phase 2.' (3) PRICE: 'Same structure: $750 per additional process.' Optional Step 4 if they push to bundle: 'I can do [A+B] together for $1,500. [C] stays Phase 3.' Max 2 processes per $1,500. Never 3+ at one price.",
    target_component: "deal-assist.mjs (scope_expansion_handler — formalized protocol)",
    expected_metric_change: "protected margin on all multi-scope deals",
    review_window: "after 3 scope expansion conversations",
    risk: "low — framing makes it feel collaborative, not restrictive",
    apply_mode: "build",
  },

  // ── SOURCE 16: Pack 6 + Pack 4C (ambiguity discipline) ────────────────────

  {
    source: "Pack 6 Judgment + Pack 4C Adaptation (ambiguity synthesis)",
    tier: "primary",
    type: "ambiguity_operating_rules",
    pattern: "Pack 6: 'paranoid about false progress.' Pack 4C: 'change ONE variable per test, never two.' Stress Tests: system had to act under incomplete information (HVAC husband's preferences unknown, roofing lead's real budget unknown, Reddit DM's authority unknown). The system assigned confidence levels and chose actions appropriate to each confidence band. Ambiguity is permanent — the goal isn't to eliminate it but to act correctly within it.",
    evidence: "Stress Test 1: warm lead scored 28/30 money_score despite unknown husband. Stress Test 2: correctly identified 3 unknown variables and assigned actions per confidence level.",
    anti_pattern: "Waiting for perfect information before acting (paralysis). Assuming certainty where none exists (false confidence). Treating all uncertainty as equal (it's not — authority uncertainty is dangerous, timing uncertainty is manageable).",
    applicable_to_us: true,
    why_applicable: "Every real deal will have unknowns. System must have a disciplined protocol for which unknowns to tolerate, which to resolve, and which to escalate.",
    confidence: "high",
    extracted_rule: "Ambiguity classification: (1) DANGEROUS unknowns (must resolve before proceeding): authority, budget existence, whether contact can actually sign. (2) IMPORTANT unknowns (resolve soon but don't block action): specific budget number, timeline preference, scope details. (3) TOLERABLE unknowns (act despite): competitor situation, internal politics, partner's personality. For dangerous unknowns: probe immediately. For important unknowns: probe within next 2 messages. For tolerable unknowns: act on best guess, adjust when new info arrives.",
    target_component: "deal-assist.mjs (ambiguity scoring), decision protocol (Pack 6)",
    expected_metric_change: "fewer deals that invest heavily before resolving dangerous unknowns",
    review_window: "after 10 deals",
    risk: "low",
    apply_mode: "build",
  },

  // ── SOURCE 17: Pack 4C (adaptation under failed expectations) ─────────────

  {
    source: "Pack 4C Escape & Adaptation (applied to negotiation failure)",
    tier: "primary",
    type: "negotiation_failure_adaptation",
    pattern: "Pack 4C: 'If same failure 3x → systemic, not individual.' Applied to negotiation: if 3 deals die at same objection → the objection handler is broken, not the leads. If 3 deals die at partner check → champion equipping is broken. If 3 deals accept pilot but refuse full → pilot is the ceiling, not the entry.",
    evidence: "Pack 4C adaptation rules + Pack 7 learning protocol",
    anti_pattern: "Blaming individual leads for systemic failures. Changing the entire offer after one loss. Not tracking WHERE in the conversation deals die.",
    applicable_to_us: true,
    why_applicable: "First 10 conversations will reveal patterns. System must be ready to adapt to those patterns, not just log them.",
    confidence: "high",
    extracted_rule: "After every 3 deals that reach the same stage: compare outcomes. If 3/3 pass a stage → that stage is working, don't touch it. If 2/3 fail at a stage → amber, monitor. If 3/3 fail at same stage → RED: mandatory fix before next deal reaches that stage. Specific triggers: 3 price objections at $1,500 → test opening with pilot-first. 3 partner-check stalls → push for direct signer access earlier. 3 'too complicated' → simplify demo/messaging. 3 scope-creep kills → tighten NOT INCLUDED section.",
    target_component: "win/loss protocol (Pack 7), deal-assist.mjs (systemic fix triggers)",
    expected_metric_change: "system improves at the exact point where deals break",
    review_window: "after every 3 deals at same stage",
    risk: "medium — must not overreact to 3 similar but actually different situations",
    apply_mode: "semi_auto",
  },

  // ── SOURCE 18: Stress Tests 1-2 (applied learnings) ──────────────────────

  {
    source: "Stress Tests 1 + 2 (internal applied cases)",
    tier: "primary",
    type: "applied_judgment_rules",
    pattern: "ST1: warm landscaping lead scored 28/30 — system correctly prioritized despite 4 simultaneous signals. Fiverr $250 killed instantly. Reddit learner got one tip. Cold lead got qualification within 2h SLA. ST2: HVAC revealed authority gap at message 6 — system correctly identified hidden risk but noted earlier detection needed. Roofing $1,000 cap correctly diagnosed as possible pilot buyer. ServiceTitan signal lead correctly got route change (audit-based second touch instead of repeat).",
    evidence: "Both stress tests completed with correct triage, boundary assignment, and failure mode identification",
    anti_pattern: "Treating all signals as equal priority. Investing in learners/low-budget buyers. Single-threading on one lead while others go cold. Ignoring authority signals until late in conversation.",
    applicable_to_us: true,
    why_applicable: "Stress tests proved the system can think operationally. Pack 8 codifies the implicit judgments from those tests into explicit rules.",
    confidence: "high",
    extracted_rule: "5 codified stress-test learnings: (1) Warm + pain + timing > cold + pricing question — always. (2) Authority detection must happen by message 2, not message 6. (3) Multiple deals must run in PARALLEL — never single-thread. Responding to cold lead within 2h SLA while working HVAC demo is correct. (4) 'Under $1,000' + interest = pilot buyer, not waste. One qualifying exchange to confirm. (5) Signal lead with 2 opens + 0 reply = change angle, don't repeat. Audit-based second touch > 'just following up'.",
    target_component: "deal-assist.mjs, daily operating loop",
    expected_metric_change: "stress-test-level judgment in real operations",
    review_window: "ongoing",
    risk: "low",
    apply_mode: "already_applied",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 2: OUTPUT A — BUYER PSYCHOLOGY TABLE
// ══════════════════════════════════════════════════════════════════════════════

export const BUYER_PSYCHOLOGY_TABLE = [
  {
    phrase: "Too expensive",
    likely_real_meaning: "5 possible roots: (1) genuinely can't afford, (2) wants a deal, (3) polite exit from a no, (4) dislikes something specific, (5) doesn't see enough value for price",
    hidden_fear: "Fear of wasting money. Fear of looking foolish to partner/spouse for spending. Fear of buying something that doesn't deliver.",
    what_NOT_to_assume: "Do NOT assume they can't afford it. Most who say 'too expensive' CAN pay — they don't see WHY they should.",
    response_needed: "DIAGNOSE first: 'Is it the amount, or is there something about the scope that doesn't feel right?' Then route to correct root.",
    stage: "pricing_active → either commitment (if resolved) or lost (if roots 3-4)",
    risk_if_misread: "Discounting when real issue is trust = cheaper AND still mistrusted. Pushing harder when it's a polite exit = harassing someone who's already said no.",
  },
  {
    phrase: "I need to think about it",
    likely_real_meaning: "Something specific is unresolved but they can't or won't name it yet. Could be: price concern, scope confusion, need to consult someone, or hidden no they're softening.",
    hidden_fear: "Fear of making the wrong decision. Fear of commitment. 'What if this doesn't work and I wasted money?'",
    what_NOT_to_assume: "Do NOT assume they're actually going to think about it. They usually won't — they'll forget or avoid. Do NOT assume it's a hard no either.",
    response_needed: "Ask what specifically they're thinking through. If they name it → handle that objection. If vague 'just need time' → give ONE time-bound check-in. If silence after that → accept the no.",
    stage: "scope_active → either qualification (if concern surfaces) or stalled",
    risk_if_misread: "Waiting passively = deal dies in silence. Pushing hard = adversarial dynamic, permanent loss.",
  },
  {
    phrase: "Not right now / maybe later",
    likely_real_meaning: "3 possibilities: (1) genuinely wrong timing (off-season, mid-project, budget cycle), (2) pain not acute enough to act, (3) polite permanent no",
    hidden_fear: "Fear of overcommitting when already stretched. Or no fear at all — they genuinely don't feel enough pain.",
    what_NOT_to_assume: "Do NOT assume they'll call back when timing is right. They won't. But do NOT assume it's never either — seasonal businesses have real timing constraints.",
    response_needed: "Seasonal reframe if applicable: 'One thought — spring/summer is when most [category] estimates spike.' Get specific date: 'Mind if I check back [date]?' If vague → 30-day follow-up then breakup.",
    stage: "interested → scheduled_follow_up or lost",
    risk_if_misread: "Too persistent = annoying. Too passive = forgotten. Best: one seasonal anchor + one check-in + clean exit.",
  },
  {
    phrase: "Can you show me / any examples",
    likely_real_meaning: "BUYING SIGNAL. They're interested enough to evaluate. They need visual/tangible proof. Moving from abstract interest to concrete assessment.",
    hidden_fear: "Fear of buying vaporware. 'Will this actually work for MY business, not just in theory?'",
    what_NOT_to_assume: "Do NOT assume this is skepticism or stalling. It's evaluation behavior = forward motion. Do NOT delay — this has a 24-48h shelf life.",
    response_needed: "BUILD MODE. Produce demo specific to their business within 24h. Faster = more credible. Show THEIR workflow, not generic screenshots.",
    stage: "interested → qualified (once they see proof and engage with it)",
    risk_if_misread: "Slow response = momentum dies completely. Generic demo = 'not for my business' feeling. Over-promising in demo = delivery can't match.",
  },
  {
    phrase: "Have you done this before",
    likely_real_meaning: "Trust deficit check. Standard buying behavior — verifying competence before spending. NOT a rejection — it's a purchasing checkpoint.",
    hidden_fear: "Fear of being a guinea pig. 'What if they take my money and can't deliver?'",
    what_NOT_to_assume: "Do NOT assume this kills the deal. EVERY new service provider faces this. Do NOT fabricate case studies.",
    response_needed: "Honest + guarantee: 'Building my client base. Working demo, specific process, guarantee: 5 hours/month savings in 30 days or I keep refining free.' Pre-approved template. Auto boundary.",
    stage: "interested → qualified (if trust gap addressed) or lost (if they need extensive proof we can't provide)",
    risk_if_misread: "Lying about experience = eventual collapse. Being defensive = looks weak. Being too honest without guarantee = no reason to trust.",
  },
  {
    phrase: "I need to check with my partner / husband / boss",
    likely_real_meaning: "In service businesses, usually GENUINE co-decision. But also reveals: your contact is champion, not signer. The sale hasn't started yet — it starts when the signer sees the proposal.",
    hidden_fear: "Fear of partner disagreeing. Fear of being seen as making unilateral decision. Or: they themselves aren't convinced but want external excuse.",
    what_NOT_to_assume: "Do NOT assume it's a stall in family-owned businesses. Do NOT assume it's genuine either — diagnose. Do NOT assume the deal is progressing — it's paused until signer engages.",
    response_needed: "Equip champion: one-pager answering 5 questions. Offer direct signer access. Set follow-up timing. Assess champion strength.",
    stage: "scope_active → partner_check_pending → either commitment or stalled",
    risk_if_misread: "Not equipping champion = partner hears garbled version, rejects. Bypassing champion to reach signer directly = offends your ally.",
  },
  {
    phrase: "We don't want something complicated",
    likely_real_meaning: "FEAR SIGNAL, not objection. They've been burned by technology before. Or they're pre-defending against partner/team saying 'too complex'. Or they're overwhelmed and any new thing feels like more complexity.",
    hidden_fear: "Fear of more work, not less. 'We're already drowning — don't add another thing I have to manage.'",
    what_NOT_to_assume: "Do NOT assume they think YOUR solution is complicated. They're expressing a general fear. Do NOT respond with feature list (confirms complexity fear). Do NOT say 'it's not complicated' (dismisses their concern).",
    response_needed: "Describe EXPERIENCE in 3 steps, not technology: 'Call missed → customer gets text → your team gets alert. That's it.' No mention of n8n, APIs, webhooks. Zero jargon.",
    stage: "interested → qualified (once simplicity fear is resolved)",
    risk_if_misread: "Technical explanation = confirms their fear. Dismissing concern = they don't feel heard. Right: show, don't explain.",
  },
  {
    phrase: "Could you also add X / what about Y too",
    likely_real_meaning: "STRONGEST buying signal + biggest margin trap. They see value and want more = fully bought in on concept. But unbounded additions without price = doing 3x work for 1x payment.",
    hidden_fear: "Fear of missing out on value. 'If I'm already paying, I should get as much as possible.' Or: testing how much they can get for the money.",
    what_NOT_to_assume: "Do NOT assume you must say yes to keep the deal. Do NOT assume they'll walk if you scope-split. Most buyers respect 'let's start small.'",
    response_needed: "Validate → Phase → Price. Always in this order. 'Great idea — definitely valuable. Let's get [core] working first. [Add-on] is Phase 2, same structure: $750.'",
    stage: "scope_active → negotiation",
    risk_if_misread: "Absorbing scope = $3K work for $750. Flat 'no' = kills enthusiasm of a bought-in buyer. Phase-split = both parties win.",
  },
  {
    phrase: "Maybe later / let me think / not sure yet",
    likely_real_meaning: "SOFT STALL. They're not saying no but not moving forward. Usually means: something specific is unresolved but they're conflict-averse and won't name it.",
    hidden_fear: "Fear of confrontation. They don't want to reject you directly. Or: genuine indecision — they can see value but something holds them back.",
    what_NOT_to_assume: "Do NOT assume waiting will resolve it. The unresolved concern will grow in the silence, not shrink. Do NOT push harder — conflict-averse people shut down under pressure.",
    response_needed: "One gentle diagnostic: 'Totally understand. If there's anything specific holding you back — the price, the timing, the scope — happy to address it. Otherwise I'll check back [date].' Give them permission to voice the real concern without pressure.",
    stage: "interested → either qualification (if they open up) or scheduled_follow_up",
    risk_if_misread: "Waiting = permanent stall. Pushing = permanent exit. One gentle probe + time-bound follow-up = best odds.",
  },
  {
    phrase: "Just send me the price",
    likely_real_meaning: "PRICE FILTER. They want a number to compare against their internal budget or against competitors. They're NOT ready to buy — they're sorting. If price is in range → conversation continues. If not → instant disqualification.",
    hidden_fear: "Fear of wasting time on something they can't afford. Or: fear of a sales pitch if they engage in conversation.",
    what_NOT_to_assume: "Do NOT assume they're ready for a scope. They're not — they want a number only. Do NOT refuse ('I need to understand your situation first') — this creates friction and they leave. Do NOT send just a number without context — it'll always seem expensive without the value frame.",
    response_needed: "Give range with value context: 'Typically $750 for a pilot, $1,500 for the full build. Depends on scope. Quick question — are you the one who handles tools/software decisions for the business?' Range filters budget + qualifying question filters authority in one message.",
    stage: "contacted → either interested (if range fits) or lost (if range exceeds budget)",
    risk_if_misread: "Refusing to give price = they leave. Giving price without value = sticker shock. Range + qualifier = efficient filter for both sides.",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3: OUTPUT B — CHAMPION CONVERSION TABLE
// ══════════════════════════════════════════════════════════════════════════════

export const CHAMPION_CONVERSION_TABLE = [
  {
    contact_type: "Spouse / co-owner",
    real_power: "Operational influence, often daily decision authority, but financial decisions shared with partner. Can champion strongly because they live the pain daily. Can also block if they decide it's not worth the hassle.",
    how_to_help_sell_internally: "One-pager answering partner's 5 questions. ROI line using their specific numbers. Offer: 'Happy to answer their questions directly.' Frame in partner's likely language: cost vs return, not features.",
    doc_asset_needed: "Partner one-pager (60-sec read): what it is, cost, timeline, effort required, guarantee. Plus one ROI line specific to their business.",
    when_to_ask_for_signer: "After champion confirms interest AND asks about price. 'Would it help if I spoke with [partner] directly? Sometimes easier than secondhand.'",
    when_to_stay_through_champion: "When champion is strong (proactive questions, gives timeline, relays partner's specific concerns). Don't go around a strong champion — it insults them.",
    weak_champion_signal: "Says 'I'll mention it' → goes silent. No timeline given. No follow-up on partner's reaction. 'They're busy' repeated 2+ times.",
  },
  {
    contact_type: "Office manager",
    real_power: "Veto power (can say no) but rarely approval power (can't say yes alone). Daily user of whatever you build. Can sabotage if they perceive threat to their role.",
    how_to_help_sell_internally: "Show their workflow IMPROVING, not disappearing. Demo must show their view: 'Instead of manually checking voicemail and calling back 20 people, you see who's been auto-texted. You only handle the complex callbacks.' They must see themselves IN the system, not replaced BY it.",
    doc_asset_needed: "2-min demo video showing their daily workflow improvement. NOT a sales pitch — a 'here's what your Tuesday would look like' walkthrough.",
    when_to_ask_for_signer: "Through the champion (spouse/owner), not through the manager. Manager's role is to NOT block, not to approve.",
    when_to_stay_through_champion: "Always. Never pitch to office manager as if they're the buyer. They're a stakeholder to be won over, not a decision-maker to be sold.",
    weak_champion_signal: "N/A — office manager is not a champion. They're a stakeholder whose resistance must be prevented.",
  },
  {
    contact_type: "Ops lead (home services company)",
    real_power: "High influence on tool decisions. May have budget for operational tools. But title ≠ owner. Must confirm authority explicitly.",
    how_to_help_sell_internally: "If they need owner approval: give them a business case, not a product demo. 'Show your boss: we're losing X calls/month → this recovers Y → costs Z → pays for itself in [timeframe].' Numbers, not features.",
    doc_asset_needed: "ROI business case one-pager (not product spec). Owner asks 'why should I spend this money?' not 'how does it work?'",
    when_to_ask_for_signer: "Immediately after qualifying authority: 'Are you the one who'd sign off on this?' If no → 'Would you be open to looping in whoever does? I can make the case easy for them.'",
    when_to_stay_through_champion: "Only if they explicitly say 'I handle tool decisions and have budget authority.' Then treat as buyer.",
    weak_champion_signal: "Says 'I'll run it by the team' with no timeline. Uses 'we' language but can't name who specifically decides.",
  },
  {
    contact_type: "Estimator",
    real_power: "Feels the pain daily (writes estimates that never get callbacks). Zero purchasing authority. Useful as intro path to owner only.",
    how_to_help_sell_internally: "Don't. Estimators can't sell to owners. They can INTRODUCE: 'Would the owner be open to a quick look at this? I can put together a 60-second summary.'",
    doc_asset_needed: "Short forwarding text (2 sentences) they can paste to the owner: 'Hey [boss], someone reached out about automating our estimate follow-ups. Might save us from losing the ones that go cold. Here's their summary: [link/one-pager]'",
    when_to_ask_for_signer: "Immediately. Estimator is not a champion — they're a routing path.",
    when_to_stay_through_champion: "Never. Get to owner within 1 exchange. If estimator can't or won't connect → dead end.",
    weak_champion_signal: "Says 'interesting' but won't forward or introduce. They're sympathetic but won't stick their neck out.",
  },
  {
    contact_type: "Manager with tool authority",
    real_power: "CAN approve tool purchases under a threshold (often $500-$2,000 for SMBs). May not need owner approval for operational tools. High value contact.",
    how_to_help_sell_internally: "May not need to sell internally at all. Confirm: 'Do you have authority to bring in a tool like this, or does it need to go through someone else?' If yes → treat as buyer. If 'under $1K I can decide' → pilot at $750 is under their authority.",
    doc_asset_needed: "Standard scope with pricing and guarantee. No one-pager needed if they have authority.",
    when_to_ask_for_signer: "Already speaking to them if they confirm authority.",
    when_to_stay_through_champion: "Stay with them. They ARE the buyer for pilot-sized deals.",
    weak_champion_signal: "Claims authority but keeps deferring: 'Let me check...' → 'Actually my boss should see this...' → authority was overstated.",
  },
  {
    contact_type: "Employee with pain but no budget",
    real_power: "Zero purchasing authority. May have high enthusiasm because they suffer from the problem daily. Dangerous: high engagement signals that mask zero buying power.",
    how_to_help_sell_internally: "Give them one forwarding text + one-pager. Low effort ask: 'Would you mind forwarding this to whoever handles these decisions? Takes 10 seconds.'",
    doc_asset_needed: "Pre-written forwarding text (copy-paste ready) + one-pager attachment.",
    when_to_ask_for_signer: "First message. If they can't connect you → one forwarding text → if no response from owner → dead end.",
    when_to_stay_through_champion: "Never. One forwarding attempt. If it doesn't land → stop.",
    weak_champion_signal: "Asks many questions, very engaged, but never mentions forwarding or connecting you to anyone. They're learning, not buying.",
  },
  {
    contact_type: "Friend / referral intro contact (like Alex)",
    real_power: "Trust bridge. Their endorsement transfers credibility. They may or may not know the prospect's pain — they're connecting, not qualifying.",
    how_to_help_sell_internally: "They already did their job (the intro). Don't ask them to sell. Thank them. If the deal progresses, mention their name in every exchange to maintain the trust bridge.",
    doc_asset_needed: "None for the referrer. But every message to the prospect should reference the intro: 'Alex mentioned...' / 'Since Alex connected us...'",
    when_to_ask_for_signer: "If intro contact ≠ buyer, ask buyer directly after first message. The intro already warmed the path.",
    when_to_stay_through_champion: "Never go back through the referrer for negotiation or objection handling. Direct relationship with buyer from first exchange.",
    weak_champion_signal: "N/A — referrer's job is done at intro. Don't measure their strength as champion.",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 4: OUTPUT C — NEGOTIATION DECISION TABLE
// ══════════════════════════════════════════════════════════════════════════════

export const NEGOTIATION_TABLE = [
  {
    situation: "Too expensive — real budget constraint",
    hold: false, reduce_scope: true, phase_split: true, pilot: true, guarantee: true, bundle: false, walk_away: false,
    action: "Pilot at $750. Single process. Guarantee included. 'If budget opens up later, Phase 2 is ready.'",
  },
  {
    situation: "Too expensive — value not perceived",
    hold: true, reduce_scope: false, phase_split: false, pilot: false, guarantee: true, bundle: false, walk_away: false,
    action: "Cost-of-inaction reframe with their specific numbers. 'You're leaving ~$X/year on the table. $750 pays for itself in 2-3 recovered jobs.' Add guarantee. Only offer pilot after reframe fails.",
  },
  {
    situation: "Too expensive — polite exit",
    hold: false, reduce_scope: false, phase_split: false, pilot: false, guarantee: false, bundle: false, walk_away: true,
    action: "Test: 'Is this something you actually want to solve right now?' If vague → graceful exit: 'Sounds like timing might not be right. Happy to reconnect whenever.' Don't discount a no.",
  },
  {
    situation: "Under $1,000 / tight budget stated",
    hold: false, reduce_scope: true, phase_split: false, pilot: true, guarantee: true, bundle: false, walk_away: false,
    action: "$750 pilot with single-process scope. Fits under stated ceiling. Include guarantee. If they negotiate below $750 → 'That's our pilot floor. Sounds like timing might not be right.'",
  },
  {
    situation: "Can you include X (add-on request)",
    hold: true, reduce_scope: false, phase_split: true, pilot: false, guarantee: false, bundle: false, walk_away: false,
    action: "Validate → Phase → Price. 'Great idea. Let's get [core] working first. [X] is Phase 2: $750.' Never absorb.",
  },
  {
    situation: "Let's do it, but can you add Y",
    hold: false, reduce_scope: false, phase_split: true, pilot: false, guarantee: false, bundle: true, walk_away: false,
    action: "They've committed — GREAT. Bundle if Y is small: 'I'll include [Y] in the build.' Bundle if Y is another process: 'I can do both for $1,500.' Never bundle 3+ at one price. Get commitment confirmed before scope discussion.",
  },
  {
    situation: "Not sure yet / need more time",
    hold: false, reduce_scope: false, phase_split: false, pilot: false, guarantee: false, bundle: false, walk_away: false,
    action: "One diagnostic question: 'Is there something specific I can clarify — the scope, the price, or something else?' Then one time-bound check-in. Then accept outcome.",
  },
  {
    situation: "Send me price only (no conversation)",
    hold: false, reduce_scope: false, phase_split: false, pilot: false, guarantee: false, bundle: false, walk_away: false,
    action: "Give range + qualifier: 'Typically $750 pilot, $1,500 full build. Quick question — are you the one who handles these decisions?' Filter budget AND authority in one message.",
  },
  {
    situation: "We want something simple",
    hold: false, reduce_scope: true, phase_split: true, pilot: true, guarantee: true, bundle: false, walk_away: false,
    action: "MATCH their frame. Pilot = simple by definition. Describe in 3 steps, not features. 'Call missed → text sent → alert received. That's it.' Phase 2 later if they want more.",
  },
  {
    situation: "My partner needs to approve",
    hold: false, reduce_scope: false, phase_split: false, pilot: false, guarantee: false, bundle: false, walk_away: false,
    action: "Equip champion: one-pager answering 5 questions. Offer direct access. Set follow-up date. Assess champion strength. If weak champion + 14 days silence → accept the no.",
  },
  {
    situation: "Competitor quoted cheaper",
    hold: true, reduce_scope: false, phase_split: false, pilot: false, guarantee: true, bundle: false, walk_away: true,
    action: "Compete on guarantee, not price. 'The difference is usually post-delivery: support, refinement, and the guarantee. Does the other quote include that?' If they choose cheaper → walk away gracefully. Never match a lower competitor's price.",
  },
  {
    situation: "Already have manual follow-up person",
    hold: true, reduce_scope: false, phase_split: false, pilot: false, guarantee: false, bundle: false, walk_away: false,
    action: "Don't compete with the person — complement them. 'Your follow-up person handles the important callbacks. The system handles the routine ones — 24h text, 72h email — so nothing slips through when they're busy.' If they're satisfied with manual → probably not our buyer.",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 5: OUTPUT D — AMBIGUITY PROTOCOL
// ══════════════════════════════════════════════════════════════════════════════

export const AMBIGUITY_PROTOCOL = {
  description: "Strict protocol for acting under incomplete information. Not all unknowns are equal. Some must be resolved. Some can be tolerated.",

  unknown_classification: {
    dangerous: {
      definition: "Unknown that, if wrong, leads to wasted deal investment or irreversible error.",
      examples: [
        "Authority: is this person a signer or champion?",
        "Budget existence: does this business actually have money for this?",
        "Contact identity: are we talking to owner, manager, or employee?",
        "Interest genuineness: is this real inquiry or polite browsing?",
      ],
      required_action: "MUST resolve before sending scope or pricing. Probe in first 2 messages.",
      max_messages_to_tolerate: 2,
    },
    important: {
      definition: "Unknown that shapes the offer but doesn't invalidate the opportunity.",
      examples: [
        "Exact budget number (range known, exact unknown)",
        "Timeline preference (some urgency vs high urgency)",
        "Scope details (core pain known, specifics fuzzy)",
        "Tool they currently use (category known, specific tool unknown)",
        "Number of estimates per month (business size known, volume unknown)",
      ],
      required_action: "Resolve within next 2 exchanges. Send qualifying question. Can proceed with demo or breakdown while waiting.",
      max_messages_to_tolerate: 4,
    },
    tolerable: {
      definition: "Unknown that would be nice to know but doesn't change the action.",
      examples: [
        "Competitor situation (they may be evaluating others)",
        "Internal politics (who likes/dislikes new tools)",
        "Partner's personality (cautious vs impulsive)",
        "How they found us or why they're looking now",
        "Their experience with past service providers",
      ],
      required_action: "Act on best guess. Update when info arrives naturally. Do NOT probe — feels like interrogation.",
      max_messages_to_tolerate: "unlimited — may never learn, and that's okay",
    },
  },

  confidence_bands: [
    {
      band: "HIGH (80-100%)",
      definition: "Authority confirmed, pain described, budget plausible, timing active.",
      allowed_actions: "Send scope. Send pricing. Send demo. Commit to build timeline.",
      example: "Owner replied personally, described missed-call pain, asked about pricing, summer season active.",
    },
    {
      band: "MEDIUM (50-79%)",
      definition: "Some dangerous unknowns resolved, some important unknowns pending.",
      allowed_actions: "Send breakdown with qualifying question. Send demo. Do NOT send scope/pricing until authority confirmed.",
      example: "Someone at the company replied with interest, but role unclear. Pain mentioned but authority unconfirmed.",
    },
    {
      band: "LOW (20-49%)",
      definition: "Dangerous unknowns unresolved. Not clear if real opportunity.",
      allowed_actions: "Send ONE qualifying message. Wait for response. Do NOT invest in demo, scope, or follow-up sequence.",
      example: "Generic email reply saying 'interested.' No pain mentioned. No name. Unknown authority.",
    },
    {
      band: "INSUFFICIENT (<20%)",
      definition: "Almost no information. Could be spam, bot, or wrong person.",
      allowed_actions: "Ignore or send one-line qualifier. Invest zero time beyond that.",
      example: "Fiverr message saying 'need automation fast, $400.' Reddit DM saying 'this is interesting' with no context.",
    },
  ],

  when_to_probe: "When a dangerous unknown exists and the deal is worth pursuing. Ask ONE clear question. Wait for answer before next action.",
  when_to_build_proof: "When confidence is MEDIUM+ and the specific blocker is 'show me' / 'prove it' / trust gap. Build demo, not scope.",
  when_to_escalate: "When answer to probe creates ambiguity that only Kirill can resolve: unusual business type, custom scope, pricing edge case, emotional complexity.",
  when_to_pause: "When confidence is LOW and probing question went unanswered for 48h+. Don't invest more. Wait for signal.",
  when_to_act_anyway: "When important unknowns exist but dangerous unknowns are resolved. You know who the buyer is, you know the pain is real, you don't know exact budget — send scope anyway with pilot option. Imperfect action > perfect inaction.",
};


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 6: OUTPUT E — INTERNAL SELLING KIT
// ══════════════════════════════════════════════════════════════════════════════

export const INTERNAL_SELLING_KIT = {
  description: "Minimum kit the system generates for a champion to forward internally. Must be producible in <30 minutes.",

  components: {
    one_pager: {
      purpose: "60-second read for the signer who wasn't in any conversation",
      must_answer: [
        "What is this? (one sentence, their language)",
        "What does it cost? (exact number, payment terms)",
        "How long? (exact days)",
        "What do I have to do? (their effort: usually 'give access + 30 min review')",
        "What if it doesn't work? (guarantee, specific and measurable)",
      ],
      format: "Clean markdown or PDF. No pitch language. No logos. No 'about us' section. Facts only.",
      must_NOT_include: "Feature lists, technical details, company history, testimonials (they haven't asked for them)",
    },

    roi_line: {
      purpose: "One sentence the signer can understand in 5 seconds",
      template: "You're [doing X manually / losing $Y per month to Z]. This costs $[price] once and [specific result].",
      example_hvac: "You're losing $6,000-$24,000/month in missed calls that go to competitors. This costs $750 once and texts every missed caller back within 60 seconds.",
      example_landscaping: "You're leaving ~$50K/year on the table from estimates that never get a callback. This costs $750 and follows up on every estimate automatically.",
    },

    scope_summary: {
      purpose: "What they're buying in 3 bullet points",
      format: "• [What it does — one sentence]\n• [Timeline — exact days]\n• [Guarantee — specific measurable outcome]",
      example: "• Auto text-back to every missed caller within 60 seconds, plus alert to your office manager\n• 3 business days to build and deliver\n• If it doesn't save 5+ hours/month in 30 days, I keep refining at no charge",
    },

    included_not_included: {
      purpose: "Prevent scope creep AND set up Phase 2",
      format: "INCLUDED: [3-4 items]. NOT INCLUDED (future phase): [1-2 items mentioned in conversation].",
      why_critical: "Signer who wasn't in conversation will assume everything discussed is included unless explicitly excluded.",
    },

    simple_visual: {
      purpose: "One image/diagram showing the 3-step flow",
      format: "3 boxes with arrows: [Trigger] → [Action] → [Result]. Example: Missed Call → Auto Text to Caller → Alert to Team.",
      why_critical: "Signer processes visuals faster than text. One diagram = instant understanding of what this IS.",
    },

    forwarding_text: {
      purpose: "Pre-written message the champion can copy-paste to the signer",
      template: "Hey [signer name], someone Alex connected us with helps service businesses stop losing calls/estimates to slow follow-up. Looks simple and the price is reasonable ($750). Here's the one-page summary: [attachment]. Let me know what you think.",
      why_critical: "Champions won't write their own pitch. They'll forward your email verbatim — or not at all. Give them a message designed for forwarding.",
    },
  },

  generation_triggers: [
    "Any mention of partner, husband, wife, boss, co-owner, 'need to check with'",
    "Any mention of team needing to see it",
    "Any mention of approval process",
    "Champion explicitly asks 'can you send me something I can show them'",
  ],

  delivery: "System generates all components automatically. Kirill reviews one-pager + ROI line (30 sec) before sending. Semi_auto boundary.",
};


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 7: OUTPUT F — WHAT SHOULD CHANGE IN OUR SYSTEM NOW
// ══════════════════════════════════════════════════════════════════════════════

export const SYSTEM_CHANGES = {

  deal_assist_changes: [
    {
      change: "Add 5-root price objection classification",
      current: "2-step diagnosis (ask then offer pilot)",
      new: "3-step: diagnose root (budget/deal-seeking/polite-exit/dislike/low-value) → route to correct handler per root → only offer pilot for root #1",
      why: "Prevents discounting when price is smokescreen for trust/exit/value issues",
    },
    {
      change: "Add signal_sequence tracking per lead",
      current: "Each message classified independently",
      new: "Track message history per lead: [curiosity, pricing_ask, scope_expansion] = escalating pattern (high value). [curiosity, silence, curiosity] = flat pattern (low value).",
      why: "Pattern-based intent scoring is more accurate than single-message classification",
    },
    {
      change: "Move authority check to message 1-2",
      current: "Authority check in breakdown template (message 3+)",
      new: "Authority question in FIRST substantive reply: 'Are decisions like this something you handle, or does someone else need to weigh in?'",
      why: "Stress Test 2: authority discovered at message 6. Must happen by message 2.",
    },
    {
      change: "Add champion_strength field to lead tracking",
      current: "No champion tracking",
      new: "When multi-stakeholder detected, track: champion_committed (boolean), timeline_given (boolean), signer_questions_relayed (boolean), one_pager_sent (boolean), follow_up_count_in_partner_check (number)",
      why: "Distinguishes strong champions (proactive) from weak ones (passive) for correct escalation",
    },
    {
      change: "Add value-stack ordering to scope template",
      current: "Scope lists features then price",
      new: "Hormozi value equation order: dream outcome → likelihood (proof/guarantee) → time (3 days) → effort (minimal) → THEN price. Price after value, never before.",
      why: "Hormozi: 'Perception of value must precede perception of price'",
    },
    {
      change: "Add value-add payloads to follow-up sequence",
      current: "Follow-ups are 'checking in' messages",
      new: "Each follow-up carries specific value: Touch 1: question. Touch 2: new angle/stat. Touch 3: proof asset. Touch 4: market trigger. Touch 5: breakup.",
      why: "'Just following up' is worst follow-up. Each touch must earn attention.",
    },
  ],

  one_pager_generation: {
    change: "Create automated one-pager generator",
    current: "No one-pager system exists",
    new: "Given: business_name, category, pain_described, price, scope → system generates one-pager answering 5 signer questions + ROI line + forwarding text",
    trigger: "Any message containing partner/husband/wife/boss/approval/team keywords",
    why: "Every multi-stakeholder deal needs this. Currently built ad-hoc. Must be automatic.",
  },

  offer_selection: {
    change: "Default to pilot-first for new conversations",
    current: "Full $1,500 in scope template, pilot as alternative",
    new: "Lead with pilot ($750) as the default recommendation. Full ($1,500) as 'if you want to include [additional process]'. Hormozi: reduce effort/risk perception for buyer.",
    why: "Pilot = lower risk, faster yes, faster first client, faster case study. Full price comes naturally as Phase 2.",
  },

  ambiguity_scoring: {
    change: "Add confidence_score per lead",
    current: "No confidence tracking — only intent_score",
    new: "Confidence score based on resolved unknowns: authority_confirmed (+25), pain_described (+20), budget_plausible (+15), timing_active (+15), contact_identity_clear (+15), tool_detected (+10). Max 100. Actions gated by band: <20 = minimal, 20-49 = qualify, 50-79 = demo/breakdown, 80+ = scope/pricing.",
    why: "Prevents sending scope to low-confidence leads. Prevents under-investing in high-confidence leads.",
  },

  logging_additions: [
    { field: "authority_confirmed_at_message", type: "number", why: "Track how early authority is detected" },
    { field: "champion_strength", type: "strong/weak/none", why: "Predict multi-stakeholder deal outcomes" },
    { field: "objection_root", type: "budget/deal_seeking/polite_exit/dislike/low_value", why: "Deeper price objection analysis" },
    { field: "signal_sequence", type: "array of classification types in order", why: "Pattern-based intent scoring" },
    { field: "confidence_score", type: "0-100", why: "Gate actions by information quality" },
    { field: "value_stack_used", type: "boolean", why: "Track whether Hormozi value equation was applied" },
    { field: "one_pager_generated", type: "boolean", why: "Track multi-stakeholder deal handling" },
  ],
};


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 8: PRACTICAL SUMMARY
// ══════════════════════════════════════════════════════════════════════════════

export const PRACTICAL_SUMMARY = {

  top_5_buyer_psychology_rules: [
    "1. EVERY OBJECTION HAS A HIDDEN DYNAMIC. 'Too expensive' might mean 'I don't trust you enough to justify the spend.' 'Need to think' might mean 'I need my husband to agree.' 'Not right now' might mean 'I'm never going to buy.' The literal words are the surface — the dynamic underneath determines the correct response. Always diagnose before responding.",
    "2. BUYING SIGNALS ARE PATTERNS, NOT EVENTS. One 'interesting' = nothing. One pricing question = maybe. Pricing question + timeline question + scope discussion + stakeholder introduction in the same thread = ACTIVE BUYER. Track the sequence, not just the latest message.",
    "3. 'SHOW ME' IS THE STRONGEST SIGNAL BEFORE 'SEND INVOICE.' When someone asks to see something, they're evaluating — moving from abstract interest to concrete assessment. This has a 24-48h shelf life. Build and deliver the demo FAST. Delay kills the momentum they created.",
    "4. 'COMPLICATED' IS A FEAR, NOT A FACT. When they say 'we don't want complicated,' they're not describing your product (they haven't seen it). They're expressing anxiety about change. Response must address the fear: describe the EXPERIENCE in 3 steps, not the technology in 30 features.",
    "5. SILENCE AFTER 'I'LL THINK ABOUT IT' IS WHERE DEALS DIE. Not the words — the gap after them. One diagnostic question ('what specifically are you thinking through?') + one time-bound check-in ('mind if I check back Thursday?') + acceptance of outcome. Three chances to save it, then let go.",
  ],

  top_5_champion_conversion_rules: [
    "1. DETECT AUTHORITY BY MESSAGE 2, NOT MESSAGE 6. Embed in first reply: 'Are decisions like this something you handle, or does someone else need to weigh in?' Natural question. Saves 4+ messages of investment in the wrong person.",
    "2. A CHAMPION WHO GOES SILENT AFTER EQUIPPING HAS DECIDED NOT TO CHAMPION. If you sent the one-pager, offered direct access, followed up twice, and heard nothing — the champion has internally decided this isn't worth pushing. Accept it. Don't chase the champion harder than they want to be chased.",
    "3. THE ONE-PAGER MUST ANSWER THE SIGNER'S QUESTIONS, NOT YOURS. Signer asks: What? How much? How long? What do I do? What if it fails? Answer those 5 things on one page. No feature lists, no 'about us,' no testimonials they didn't request.",
    "4. ALWAYS INCLUDE A FORWARDING TEXT. Champions won't write their own pitch. They'll forward your email verbatim or (more likely) not at all. Pre-write the exact message they send to the signer. Make it 2 sentences. Make it copy-paste ready.",
    "5. PUSH FOR DIRECT SIGNER ACCESS WHEN CHAMPION IS WEAK. Strong champion = proactive, gives timeline, relays questions. Weak champion = 'I'll mention it,' then goes silent. For weak champions: 'Would it help if I spoke with them directly? Sometimes easier than back-and-forth.' This is rescue, not bypassing.",
  ],

  top_5_negotiation_rules: [
    "1. PRICE AFTER VALUE, NEVER BEFORE. Hormozi value equation: dream outcome → proof/guarantee → time → effort → THEN price. When price follows a value stack, $750 feels like nothing. When price arrives first, $750 feels like a lot. Order matters more than amount.",
    "2. VALIDATE → PHASE → PRICE. For every scope expansion request: 'Great idea. Let's get [core] working first. [Add-on] is Phase 2: $750.' Three words that protect margin: 'same structure, same price.' Never absorb. Never refuse. Phase.",
    "3. STATE PRICE WITH CONFIDENCE, NOT APOLOGY. '$750. Half upfront, half on delivery. 3 business days. Guarantee included.' Confidence in price = confidence in delivery. Hedging ('about $750... if that works...') signals uncertainty about your own value.",
    "4. ONLY DISCOUNT FOR REAL BUDGET CONSTRAINTS — NEVER FOR POLITE EXITS OR LOW-VALUE PERCEPTION. Diagnose the root first. If they genuinely can't afford it → pilot. If they don't see the value → reframe with cost-of-inaction + guarantee. If they're exiting politely → accept the no. Discounting a no doesn't turn it into a yes.",
    "5. THE GUARANTEE IS YOUR STRONGEST NEGOTIATION TOOL. 'If it doesn't save 5 hours/month in 30 days, I keep refining free.' This should appear in every scope, not just when objections arise. Proactive risk reversal kills objections before they form. Buyer has nothing to lose = easier yes.",
  ],

  top_3_ambiguity_rules: [
    "1. NOT ALL UNKNOWNS ARE EQUAL. Authority unknown = DANGEROUS (resolve before sending scope). Budget unknown = IMPORTANT (resolve within 2 exchanges). Partner's personality unknown = TOLERABLE (act on best guess). Classify the unknown before deciding whether to probe, act, or wait.",
    "2. IMPERFECT ACTION BEATS PERFECT INACTION — BUT ONLY WHEN DANGEROUS UNKNOWNS ARE RESOLVED. If you know WHO the buyer is and WHAT their pain is but don't know their exact budget → send scope with pilot option. If you DON'T know who the buyer is → stop. Probe. Don't invest in scope for someone who might be an office manager browsing on lunch break.",
    "3. CONFIDENCE SCORE GATES ACTIONS. Under 20%: ignore or one-line qualifier. 20-49%: one qualifying message, invest nothing more. 50-79%: demo and breakdown OK, no scope/pricing yet. 80%+: scope, pricing, build, full investment. The system must know what it doesn't know — and limit its actions accordingly.",
  ],
};
