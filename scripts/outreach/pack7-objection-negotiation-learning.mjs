/**
 * Pack 7 — Objection, Stakeholder, Negotiation & Learning Discipline
 *
 * Last-mile selling reality: what objections really mean, how multi-decision-maker
 * deals work, how to protect price/margin, and how to learn from every outcome.
 *
 * Sources: Close (8 articles), Hormozi (reuse Pack 2), PG (reuse Pack 4),
 * Castos/DesignJoy (reuse Pack 4B), Pack 4C adaptation, Pack 5 hunting rules.
 */

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 1: STRUCTURED RULES — PER SOURCE EXTRACTION
// ══════════════════════════════════════════════════════════════════════════════

export const PACK7_EXTRACTED_RULES = [

  // ── SOURCE 1: Close — 25 Sales Objections ─────────────────────────────────

  {
    source: "Close — Sales Objections: How to Overcome and Win More Deals",
    tier: "primary",
    type: "objection_taxonomy",
    pattern: "6 objection types: Lack of Budget, Lack of Need, Lack of Trust, Lack of Urgency, Lack of Authority, Hard No. Each requires different response. Price objections often MASK other concerns (trust, need, timing). Acknowledge → Respond → Learn. Log every objection in CRM.",
    evidence: "Close objection framework with 25 templates across 6 types",
    anti_pattern: "Treating all objections the same. Responding to 'too expensive' with discount before diagnosing what's really behind it. Arguing with the objection instead of asking about it.",
    applicable_to_us: true,
    why_applicable: "Our deal-assist has 3 objection types (price, trust, timing). Needs expansion to cover the full spectrum: budget vs need vs trust vs urgency vs authority vs hard no.",
    confidence: "high",
    extracted_rule: "Before responding to ANY objection, diagnose which of the 6 types it is. Price objection → ask 'Is this about budget, or is there something else?' Trust objection → share proof. Need objection → re-qualify pain. Urgency → tie to seasonal timing. Authority → find the signer. Hard no → log, learn, move on.",
    target_component: "deal-assist.mjs (objection classification)",
    expected_metric_change: "fewer mishandled objections, higher objection-to-close conversion",
    review_window: "after 5 objection encounters",
    risk: "low",
    apply_mode: "build",
  },

  // ── SOURCE 2: Close — 18 Price Objection Strategies ───────────────────────

  {
    source: "Close — 18 Proven Strategies to Overcome Price Objections",
    tier: "primary",
    type: "price_objection_diagnosis",
    pattern: "Virtual Close Technique: 'If I could offer this at [price], would we have a deal right now?' If YES immediately = genuine price objection. If new concerns appear = price is SMOKESCREEN for something else (trust, need, timing). 5 hidden causes: lack of funds, wants discount, uninterested, dislikes product, perceives low value.",
    evidence: "Steli Efti (Close CEO): 'If you never receive the too expensive objection, your price is too low.'",
    anti_pattern: "Immediately offering discount when someone says 'too expensive'. Assuming price is the real issue. Dropping price without reducing scope.",
    applicable_to_us: true,
    why_applicable: "Our deal-assist handle_price_objection immediately offers pilot/reduced options. Should first DIAGNOSE whether price is real objection or smokescreen. Saves from unnecessary discounting.",
    confidence: "high",
    extracted_rule: "When prospect says 'too expensive': Step 1 — Ask diagnostic question: 'Is it the budget that's the concern, or is there something else about the scope that doesn't feel right?' Step 2 — If budget is real → offer pilot ($750). If smokescreen → address the real objection (trust/need/timing). Step 3 — ONLY reduce scope/price AFTER confirming budget is the genuine blocker.",
    target_component: "deal-assist.mjs (handle_price_objection rewrite)",
    expected_metric_change: "fewer unnecessary discounts, better diagnosis of real objections",
    review_window: "after 3 price objections",
    risk: "medium — must not feel like interrogation",
    apply_mode: "build",
  },
  {
    source: "Close — 18 Price Objection Strategies",
    tier: "primary",
    type: "cost_of_inaction",
    pattern: "Calculate cost of NOT buying. 'Every month staying with old solution costs you $X in lost revenue.' Frame price as investment against ongoing loss, not expense. Hormozi: value must be 10x price for a no-brainer.",
    evidence: "Strategy 17: 'Adopting our platform generates $15k/month additional revenue. Every month of delay costs $15k.'",
    anti_pattern: "Defending the price by listing features. Competing on price with cheaper alternatives. Letting prospect frame it as 'cost' instead of 'investment'.",
    applicable_to_us: true,
    why_applicable: "Our audit already calculates recoverable revenue. Must USE this number explicitly in price objection handling: 'You're losing ~$X/year to estimates that never get a callback. The system costs $1,500 once.'",
    confidence: "high",
    extracted_rule: "In every price objection response, include the cost-of-inaction number from audit: 'Based on your volume, you're leaving roughly $[X] on the table each year from estimates that go cold. The follow-up system costs $750 and pays for itself if it recovers even 2-3 jobs.'",
    target_component: "deal-assist.mjs (handle_price_objection), generate-audit.mjs",
    expected_metric_change: "reframes price conversation from cost to ROI",
    review_window: "after 3 price conversations",
    risk: "low — factual, uses their own numbers",
    apply_mode: "build",
  },
  {
    source: "Close — 18 Price Objection Strategies",
    tier: "primary",
    type: "guarantee_risk_reversal",
    pattern: "Money-back guarantee reduces perceived risk. Demonstrates product confidence. Alleviates quality concerns. Hormozi: risk reversal makes the offer feel safe — buyer has nothing to lose.",
    evidence: "Strategy 18 + Hormozi $100M Offers: 'The more risk you can reverse, the more people will buy.'",
    anti_pattern: "Offering guarantee without limits (open-ended liability). Never mentioning guarantee until asked. Making buyer carry all the risk.",
    applicable_to_us: true,
    why_applicable: "We already have a guarantee in trust objection handler: '5 hours/month savings within 30 days or I keep refining.' Must make this MORE prominent — include in scope, not just objection response.",
    confidence: "high",
    extracted_rule: "Include guarantee in EVERY scope email, not just when objection arises: 'If the system doesn't save you at least 5 hours/month within 30 days, I'll keep refining until it does — at no extra charge.' This removes the risk from the buyer's side before they even raise it.",
    target_component: "deal-assist.mjs (send_scope template, send_confirmation template)",
    expected_metric_change: "fewer trust/price objections at scope stage",
    review_window: "after 5 scopes sent",
    risk: "medium — must be able to deliver on guarantee",
    apply_mode: "build",
  },

  // ── SOURCE 3: Close — Buying Signals ──────────────────────────────────────

  {
    source: "Close — What Are Buying Signals",
    tier: "secondary",
    type: "signal_interpretation",
    pattern: "Buying signals: pricing inquiry, detailed questions about fit, rapid response time, engagement with content. BUT signals 'can be misinterpreted as they are not always explicit indications of intent.' Must consider entire conversation and behavior pattern, not single signals.",
    evidence: "Close buying signals glossary: caveat about misinterpretation",
    anti_pattern: "Treating single positive signal (email open, 'interesting') as buying intent. Escalating effort based on one signal without pattern.",
    applicable_to_us: true,
    why_applicable: "Reinforces Pack 6 Self-Correction: misreading signal strength. System already guards against this. This adds: look at PATTERN of signals, not single events.",
    confidence: "medium",
    extracted_rule: "Buying signal strength requires PATTERN, not single event. One pricing question = intent 3. Pricing question + fast reply + specific pain described = intent 4. Pricing question + fast reply + pain + timeline + asks about start date = intent 5. Single 'interesting' + silence = intent 1 regardless of how enthusiastic the word was.",
    target_component: "deal-assist.mjs (intent_score escalation logic)",
    expected_metric_change: "more accurate intent scoring",
    review_window: "ongoing",
    risk: "low",
    apply_mode: "auto",
  },

  // ── SOURCE 4: Close — How to Follow Up ────────────────────────────────────

  {
    source: "Close — How to Follow Up with Prospects",
    tier: "primary",
    type: "follow_up_discipline",
    pattern: "44% of salespeople quit after one follow-up. 80% of prospects say no 4 times before saying yes. 8 follow-up touches average to reach a prospect. Cadence: Day 1 → +2 → +7 → +7 → +14 → +30 → monthly. Cold: max 6 attempts then breakup. Warm: continue until definitive response. Never guilt-trip ('Why haven't you responded?').",
    evidence: "Close follow-up stats: 92% of qualified leads require follow-up. 92% of salespeople give up after 4 nos.",
    anti_pattern: "Giving up after 1-2 follow-ups. Following up too frequently (every day). Guilt-based messaging. 'Just checking in' without value.",
    applicable_to_us: true,
    why_applicable: "Our follow-up cadence: 48h + day 7 breakup. This is TOO aggressive on breakup and TOO FEW touches. Should extend to: 48h → day 7 → day 14 → day 30 → then breakup. Especially for warm leads where 'not now' doesn't mean 'never'.",
    confidence: "high",
    extracted_rule: "Extend follow-up cadence for warm/qualified leads: 48h (auto check-in) → Day 7 (value-add, not just 'checking in') → Day 14 (new angle or proof asset) → Day 30 (seasonal relevance or new case study) → Day 45 (breakup). Cold leads keep current 48h + day 7 breakup. Follow-ups must ADD something — never 'just following up'.",
    target_component: "deal-assist.mjs (AUTO_FOLLOWUPS), send-followups.mjs",
    expected_metric_change: "recover leads that would have been killed at day 7",
    review_window: "after 10 follow-up sequences complete",
    risk: "low — more touches on warm leads only",
    apply_mode: "build",
  },

  // ── SOURCE 5: Close — "I Need to Think About It" / The No ────────────────

  {
    source: "Close — How to Deal with 'I Need to Think About It'",
    tier: "primary",
    type: "think_about_it_diagnosis",
    pattern: "Three types of No: (1) Generic No (early stage) = lacks info, not rejecting product — respond with 'let me explain better.' (2) Maybe No (mid-stage) = specific objection, 'not yet' — address the specific blocker, follow up quarterly. (3) Real No (late stage) = misalignment after 3 months — log, learn, move on. 'Think about it' is almost always Type 1 or Type 2, rarely Type 3.",
    evidence: "Close: Track daily rejection rate. 'If you aren't getting rejected daily, your goals aren't ambitious enough.'",
    anti_pattern: "Accepting 'I need to think about it' at face value and waiting. Not asking what specifically they need to think about. Treating all 'think about it' responses the same.",
    applicable_to_us: true,
    why_applicable: "When a lead says 'I need to think about it' or 'need to check with partner' — our system currently treats it as timing objection (auto, 'check back later'). Should instead diagnose: what specifically are they thinking about? Is it price, scope, trust, or genuine multi-stakeholder process?",
    confidence: "high",
    extracted_rule: "When prospect says 'I need to think about it': immediately ask 'Totally understand — is there a specific part you want to think through? The scope, the price, or something else?' Their answer reveals: price concern → handle as price objection. Scope confusion → clarify scope. Trust gap → offer proof. 'Just need time' with no specifics → likely stall. Partner check → genuine multi-stakeholder process.",
    target_component: "deal-assist.mjs (new classification: stall_diagnosis)",
    expected_metric_change: "convert some 'think about it' to actionable objection handling",
    review_window: "after 5 'think about it' encounters",
    risk: "low — one question is natural",
    apply_mode: "build",
  },

  // ── SOURCE 6: Close — "Too Expensive" (same article as Source 2) ──────────

  {
    source: "Close — How to Respond to 'Too Expensive'",
    tier: "primary",
    type: "silence_technique",
    pattern: "Strategic silence after hearing 'too expensive' — pause and wait. Forces prospect to elaborate and reveal the REAL reason. Most people fill silence with truth. Then ask: 'How are you currently dealing with the issue our offer is designed to solve?'",
    evidence: "Strategy 5 (Kris Lippi): silence forces prospect to reveal actual underlying concern",
    anti_pattern: "Immediately defending price. Talking more to fill awkward silence. Offering discount reflexively to 'save' the conversation.",
    applicable_to_us: true,
    why_applicable: "In email/text-based selling, silence = don't immediately reply with reduced offer. Wait. Ask a question. Let them elaborate. Our handle_price_objection immediately offers two lower options — should first ask a diagnostic question.",
    confidence: "high",
    extracted_rule: "When 'too expensive' arrives via email: do NOT immediately send the pilot/reduced option. First reply with ONE diagnostic question: 'I hear you — $1,500 is real money. Is it the total amount, or is there a part of the scope that doesn't feel worth it to you?' THEN based on their answer, offer pilot/reduced/value-reframe as appropriate.",
    target_component: "deal-assist.mjs (handle_price_objection — restructure as 2-step)",
    expected_metric_change: "preserve full pricing more often, reduce unnecessary discounting",
    review_window: "after 3 price objections",
    risk: "medium — delay could lose impatient buyer. Mitigate with fast reply time.",
    apply_mode: "build",
  },

  // ── SOURCE 7: Close — Decision Maker / Gatekeepers ────────────────────────

  {
    source: "Close — Decision Maker: How to Identify the Right One",
    tier: "primary",
    type: "gatekeeper_handling",
    pattern: "Treat gatekeepers as PARTNERS not obstacles. Research decision-maker before calling. Address 3 stakeholder levels: company needs, departmental needs, individual needs. Show gatekeeper how connecting you benefits THEM. Never fabricate connections. Scripts: 'Maybe you can help me...', 'I'm wondering who handles...'",
    evidence: "Close gatekeeper article with 6 strategies and multiple scripts",
    anti_pattern: "Trying to go around the gatekeeper. Treating them dismissively. Pitching to the gatekeeper as if they're the buyer. Fabricating authority references.",
    applicable_to_us: true,
    why_applicable: "When we hit an office manager or admin (generic email reply, 'I don't handle this'), we need a specific redirect script that treats them as ally, not obstacle.",
    confidence: "high",
    extracted_rule: "When reply comes from non-decision-maker: (1) Thank them. (2) Ask for help: 'Would you mind pointing me to whoever handles the tools and systems side? I'd appreciate the intro.' (3) Make it easy: 'If it helps, I can send you a one-paragraph summary you could forward.' (4) If they redirect → follow the redirect with their name as reference. (5) If no redirect in 5 days → deprioritize.",
    target_component: "deal-assist.mjs (ask_for_redirect template rewrite)",
    expected_metric_change: "higher redirect success rate",
    review_window: "after 5 redirect attempts",
    risk: "low",
    apply_mode: "build",
  },

  // ── SOURCE 8: Close — Selling to Multiple Decision Makers ─────────────────

  {
    source: "Close — How to Sell to Multiple Decision Makers",
    tier: "primary",
    type: "champion_strategy",
    pattern: "Internal champion = someone at prospect's organization who advocates for your product. Benefits: intel on buying process, shorter cycle, deal recovery. BUT: don't overrely on champion's selling ability — THEY cannot sell as well as you. Always get direct access to decision-maker. Provide champion with: FAQs, case studies, presentation decks, demos. Template: 'Let's schedule a quick call with you, me, and [decision-makers].'",
    evidence: "Close: 'YOU should talk with decision-makers — not just your champions.' Team selling increases win rates 258%.",
    anti_pattern: "Letting the champion sell on your behalf. Giving them complex materials and hoping they explain it. Never speaking to the actual decision-maker. Over-relying on internal advocacy.",
    applicable_to_us: true,
    why_applicable: "Critical for our scenario: prospect's wife is champion, husband is owner. We MUST equip her with simple materials AND get to the husband directly. She can introduce but she can't close.",
    confidence: "high",
    extracted_rule: "When prospect says 'I need to check with partner/husband/boss': (1) Equip the champion: 'Want me to send a one-page summary they can review? Scope, price, timeline — everything on one page.' (2) Offer direct access: 'Happy to answer any questions they have directly — sometimes it's easier than playing telephone.' (3) Don't just wait. Prepare the one-pager immediately. (4) If no response in 5 days → ask champion: 'Did [partner] get a chance to look at it? Anything I can clarify for them?'",
    target_component: "deal-assist.mjs (new: handle_partner_check), templates/partner-summary-template",
    expected_metric_change: "fewer deals lost at partner-check stage",
    review_window: "after 3 multi-stakeholder encounters",
    risk: "low",
    apply_mode: "build",
  },
  {
    source: "Close — How to Sell to Multiple Decision Makers",
    tier: "primary",
    type: "champion_equipping",
    pattern: "Provide champions with: FAQs they'll face, case studies, demo screenshots, ROI summary, pricing justification. Champions lose credibility when they can't answer the decision-maker's questions. The one-pager must ANSWER the questions the decision-maker will ask, not just describe what you do.",
    evidence: "Close: 'When champions lack answers, it damages their credibility with decision-makers.'",
    anti_pattern: "Sending champion your full pitch deck. Giving them too much material. Expecting them to read and relay a long email. Leaving them without answers to predictable questions.",
    applicable_to_us: true,
    why_applicable: "Our one-pager must anticipate what the husband/partner will ask: What is it? What does it cost? How long? What do I have to do? What if it doesn't work? These 5 questions, answered clearly, on one page.",
    confidence: "high",
    extracted_rule: "Partner/owner one-pager template must answer exactly 5 questions: (1) What is this? [One sentence: automatic follow-up on open estimates so jobs don't go to competitors] (2) What does it cost? [$750 pilot / $1,500 full, 50/50 split] (3) How long? [3-5 business days] (4) What do I have to do? [Give access to Jobber/CRM, 30 min review at the end] (5) What if it doesn't work? [Guarantee: 5 hours/month saved in 30 days or free refinement]",
    target_component: "deal-assist.mjs (new template: partner_summary), .data/templates/",
    expected_metric_change: "partner closes faster because their questions are pre-answered",
    review_window: "after 3 partner-check situations",
    risk: "low",
    apply_mode: "build",
  },

  // ── SOURCE 9-10: SaaStr + Housecall Pro / ServiceTitan (reuse) ────────────

  {
    source: "SaaStr + ServiceTitan (reuse from Pack 2/5)",
    tier: "primary",
    type: "founder_multi_stakeholder",
    pattern: "Founder must close first 10 personally (Lemkin). In service businesses, 'owner' is often a couple or family. ServiceTitan: Above + Beyond has sales manager (Vincent) + owner (Jason Brady). The person who USES the tool and the person who PAYS are often different people.",
    evidence: "Pack 2 (Lemkin founder-closes-10) + Pack 5 (ServiceTitan: Vincent manages, Jason owns)",
    anti_pattern: "Selling only to the user. Ignoring the payer. Assuming one person makes all decisions in a small business.",
    applicable_to_us: true,
    why_applicable: "HVAC/landscaping/plumbing businesses are often family-owned. The person who answers our email (office manager, spouse, operations person) may NOT be the signer. System must detect this early.",
    confidence: "high",
    extracted_rule: "Early in conversation, ask: 'Are you the one who'd sign off on something like this, or would someone else need to be involved?' If multiple stakeholders → immediately prepare one-pager and offer direct access. Don't wait until they tell you at the end.",
    target_component: "deal-assist.mjs (add authority check to send_breakdown template)",
    expected_metric_change: "earlier detection of multi-stakeholder dynamics",
    review_window: "after 5 conversations",
    risk: "low — natural question",
    apply_mode: "build",
  },

  // ── SOURCE 11: Hormozi — Value, Guarantees, Risk Reversal ─────────────────

  {
    source: "Hormozi — $100M Offers (reuse from Pack 2)",
    tier: "primary",
    type: "value_equation",
    pattern: "Value = (Dream Outcome × Perceived Likelihood) / (Time Delay × Effort Required). Increase value by: making outcome bigger, increasing likelihood (proof/guarantee), reducing time (faster delivery), reducing effort (you do everything). Risk reversal: the MORE risk you remove from buyer, the more they buy. Guarantee should be specific and measurable.",
    evidence: "Hormozi $100M Offers value equation + risk reversal chapter",
    anti_pattern: "Competing on price (reducing numerator). Making buyer do lots of work (increasing denominator). Vague guarantees ('satisfaction guaranteed' = meaningless). No guarantee at all.",
    applicable_to_us: true,
    why_applicable: "Our offer: Dream Outcome = stop losing jobs to slow follow-up. Likelihood = demo + guarantee increase this. Time Delay = 3-5 days (fast). Effort = minimal (give us Jobber access, 30 min review). Our guarantee ('5 hours/month or free refinement') is specific. Must use this framing in ALL price conversations.",
    confidence: "high",
    extracted_rule: "When framing price, always stack the value equation: 'You'll stop losing estimates to slow follow-up [dream outcome]. I build it in 3 days [low time delay]. You give me Jobber access and 30 minutes for review [low effort]. If it doesn't save you 5 hours/month within 30 days, I keep working on it at no extra charge [risk reversal]. Investment: $750 for the pilot.' This makes $750 feel like nothing vs the value.",
    target_component: "deal-assist.mjs (send_scope template rewrite with value stack)",
    expected_metric_change: "fewer price objections because value is pre-framed",
    review_window: "after 5 scopes sent",
    risk: "low",
    apply_mode: "build",
  },

  // ── SOURCE 12: Paul Graham — Do Things That Don't Scale ───────────────────

  {
    source: "Paul Graham — Do Things That Don't Scale (reuse from Pack 4)",
    tier: "primary",
    type: "manual_closing",
    pattern: "Recruit users individually. Do things that don't scale. Superhuman: manual onboarding = 2x activation + 2x referrals. Serve ONE user perfectly as consultant, then expand. Manual = learning. Learning = competitive advantage. Don't automate what you haven't done manually 10 times.",
    evidence: "PG essay + Pack 3B Castos/Superhuman extraction",
    anti_pattern: "Trying to automate sales before first 10 clients. Building self-serve before understanding the sales conversation. Avoiding manual work because it's 'not scalable'.",
    applicable_to_us: true,
    why_applicable: "Every manual deal Kirill closes teaches us what the automated system should eventually do. The manual conversations reveal objections, stakeholder patterns, and pricing reactions that no framework can predict.",
    confidence: "high",
    extracted_rule: "Every manual interaction is research. Log: what they asked, what objection they raised, what convinced them, what almost lost them, who else was involved, how long it took. These logs become the rules. Pack 7 itself cannot predict what Calgary HVAC owners actually say — only the real conversations can. Manual today = automated tomorrow.",
    target_component: "win/loss logging protocol, learning loop",
    expected_metric_change: "each manual deal improves the system",
    review_window: "ongoing",
    risk: "zero",
    apply_mode: "already_applied",
  },

  // ── SOURCE 13-14: Castos / DesignJoy (reuse) ─────────────────────────────

  {
    source: "Castos + DesignJoy (reuse from Pack 4B)",
    tier: "secondary",
    type: "scope_discipline",
    pattern: "Castos: service funded SaaS. Started at $500K/year service revenue before building product. DesignJoy: productized service at fixed scope — one request at a time, no scope creep. Both: define what's INCLUDED and what's NOT INCLUDED explicitly.",
    evidence: "Pack 4B extraction: stair-step model, scope boundaries",
    anti_pattern: "Saying yes to every add-on request. Bundling more scope without more price. Letting 'could you also add X' become unbounded.",
    applicable_to_us: true,
    why_applicable: "'Could it also text missed callers AND remind maintenance customers?' = two add-ons on top of a pilot. If we say yes to all three at $750, we're doing $2,500 of work for $750. Must phase-split.",
    confidence: "high",
    extracted_rule: "Every scope must have explicit NOT INCLUDED section. When prospect asks 'could you also add X': (1) Validate the idea: 'Great idea — that would definitely add value.' (2) Phase it: 'Let's get the estimate follow-up running first. Once you see it working, we add missed-call as Phase 2.' (3) Price it: 'Each additional process is $750.' Never absorb scope without price.",
    target_component: "deal-assist.mjs (scope_expansion_handler), .data/templates/07-scope-reply-draft.md",
    expected_metric_change: "protected margin, no scope creep",
    review_window: "after 3 scope conversations",
    risk: "medium — must not feel rigid. Frame as 'better to start small and prove it'",
    apply_mode: "build",
  },

  // ── SOURCE 15-16: Pack 4C + Pack 5 (reuse, synthesized) ──────────────────

  {
    source: "Pack 4C Adaptation + Pack 5 Client Hunting (synthesis)",
    tier: "primary",
    type: "win_loss_learning",
    pattern: "Pack 4C: change ONE variable per failed test. If same failure 3x → systemic, not individual. Pack 5: repeated stall at same stage → fix the stage, not the lead. Repeated win pattern → codify it. 3+ instances = rule. 1 instance = anecdote.",
    evidence: "Pack 4C adaptation rules + Pack 5 learning loop",
    anti_pattern: "Learning the wrong lesson from one deal (overfitting). Changing everything after one failure. Keeping same approach after 3 identical failures. Not logging anything.",
    applicable_to_us: true,
    why_applicable: "After every deal — win, loss, or stall — system must log structured data and extract rules only from PATTERNS, not single events.",
    confidence: "high",
    extracted_rule: "Win/loss logging mandatory after every deal exit. Fields: stage_lost_at, objection_type, stakeholder_count, what_worked, what_failed, would_do_differently. After 3 identical loss reasons → systemic fix required (change template/process). After 3 identical win patterns → codify as default approach. After 1 unusual outcome → log as anecdote, do NOT change system.",
    target_component: "deal-assist.mjs, validation-framework.json, learning loop",
    expected_metric_change: "system improves with each deal, doesn't overreact to single events",
    review_window: "after every deal outcome",
    risk: "low",
    apply_mode: "auto",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 2: OUTPUT A — OBJECTION DIAGNOSIS TABLE
// ══════════════════════════════════════════════════════════════════════════════

export const OBJECTION_DIAGNOSIS_TABLE = [
  {
    phrase: "Too expensive",
    likely_real_meaning: "One of 5 things: (1) genuinely can't afford it, (2) can afford it but wants discount, (3) doesn't see enough value for the price, (4) price is smokescreen for trust/need/timing issue, (5) comparison to cheaper alternative",
    hidden_fear: "Fear of wasting money on something that doesn't work. Fear of looking bad to partner for spending.",
    what_NOT_to_assume: "Do NOT assume they can't afford it. Do NOT assume they want a discount. Most 'too expensive' = value not clear enough, not budget too small.",
    best_response_type: "DIAGNOSE FIRST. Ask: 'Is it the amount, or is there a part of the scope that doesn't feel worth it?' Then: if budget → pilot at $750. If value → cost-of-inaction reframe. If smokescreen → address real objection.",
    boundary: "semi_auto",
    risk_if_handled_badly: "Immediate discount = pricing precedent damage. All future deals anchored lower. Or: arguing about price = adversarial, kills relationship.",
  },
  {
    phrase: "I need to think about it",
    likely_real_meaning: "One of 4 things: (1) genuinely processing — needs time, (2) specific concern they haven't voiced, (3) polite way of saying no, (4) need to check with someone else (authority issue)",
    hidden_fear: "Fear of making a wrong decision. Fear of commitment. Or: they don't have authority and are embarrassed to say so.",
    what_NOT_to_assume: "Do NOT assume they'll actually think about it and come back. Do NOT wait passively. Do NOT assume it's a no.",
    best_response_type: "DIAGNOSE. Ask: 'Totally understand — is there a specific part you want to think through? The scope, the price, or something else?' Their answer reveals the real blocker.",
    boundary: "semi_auto",
    risk_if_handled_badly: "Accepting at face value and waiting = deal goes cold silently. Pushing too hard = feels pressured, walks away.",
  },
  {
    phrase: "I need to check with my partner / husband / boss",
    likely_real_meaning: "One of 3 things: (1) genuinely needs co-decision (common in family businesses), (2) using partner as shield to avoid saying no, (3) needs partner's approval on spending specifically (not on concept)",
    hidden_fear: "Fear of partner disagreeing. Fear of being seen as making unilateral decision. Or: they themselves aren't convinced but want to blame partner.",
    what_NOT_to_assume: "Do NOT assume it's a stall. In service businesses, partner co-ownership is common and real. But also do NOT assume the deal is progressing — it's paused until partner weighs in.",
    best_response_type: "EQUIP THE CHAMPION. Send one-pager answering partner's 5 predictable questions. Offer direct access: 'Happy to answer their questions directly.' Set follow-up timeline: 'When do you think they'll have a chance to look?'",
    boundary: "semi_auto",
    risk_if_handled_badly: "Not equipping champion = partner only hears secondhand version, rejects. Pushing to bypass partner = disrespects their business structure.",
  },
  {
    phrase: "Not right now / maybe later / bad timing",
    likely_real_meaning: "One of 3 things: (1) genuinely wrong timing (off-season, too busy, mid-other-project), (2) low priority — not painful enough, (3) polite rejection they don't want to make explicit",
    hidden_fear: "Fear of overcommitting when already stretched. Or: no real fear — they just don't feel the pain acutely enough.",
    what_NOT_to_assume: "Do NOT assume they'll reach out when timing is right. They won't. Do NOT assume it's permanent no either.",
    best_response_type: "ACKNOWLEDGE + SEASONAL REFRAME + SCHEDULE. 'Totally understand. One thought — [seasonal timing reference]. But if later works better, mind if I check back in [specific timeframe]?' Get a date, not a vague 'later'.",
    boundary: "auto",
    risk_if_handled_badly: "Too persistent = annoying. Too passive = forgotten. Wrong timing for follow-up = missed season.",
  },
  {
    phrase: "Can you show me / any examples / proof",
    likely_real_meaning: "BUYING SIGNAL masked as objection. They're interested enough to want to evaluate. They need visual/tangible proof to move forward. They can't imagine the abstract — they need to SEE it.",
    hidden_fear: "Fear of buying something they can't visualize. Fear of vaporware. 'Will this actually work for MY business?'",
    what_NOT_to_assume: "Do NOT assume this is skepticism. It's evaluation behavior. They're moving FORWARD, not backward. Do NOT delay — this request has a short shelf life.",
    best_response_type: "BUILD MODE. Produce demo/walkthrough specific to THEIR business within 24h. The faster you show something real, the more credibility jumps.",
    boundary: "semi_auto (Kirill records Loom), auto (system builds demo artifact)",
    risk_if_handled_badly: "Slow response = momentum dies. Generic demo = 'this isn't for MY business' feeling. Over-promising in demo = delivery can't match.",
  },
  {
    phrase: "Have you done this before / any case studies",
    likely_real_meaning: "Trust deficit. They want proof of competence. Standard buying behavior — checking references before spending.",
    hidden_fear: "Fear of being someone's guinea pig. Fear of hiring amateur. 'What if they take my money and can't deliver?'",
    what_NOT_to_assume: "Do NOT assume this kills the deal. Every service provider faces this question. Pre-approved honest template handles it. Do NOT fabricate case studies.",
    best_response_type: "HONEST + GUARANTEE. Pre-approved template: 'Building my client base in Calgary. Here's what I can show: working demo, specific process, guarantee. If it doesn't save 5 hours/month in 30 days, I keep refining free.'",
    boundary: "auto (pre-approved template)",
    risk_if_handled_badly: "Lying about experience = eventual credibility collapse. Being defensive = looks weak. Being vague = doesn't resolve the trust gap.",
  },
  {
    phrase: "What exactly do I get / what's included",
    likely_real_meaning: "POSITIVE SIGNAL. They're evaluating scope to decide if price is fair. This is pre-purchase clarification, not objection. They want to understand what they're paying for.",
    hidden_fear: "Fear of hidden costs. Fear of paying for things they don't need. Fear of post-purchase surprise.",
    what_NOT_to_assume: "Do NOT assume they're trying to negotiate. They want clarity. Do NOT list every feature — they want the 3-4 things that matter to THEM.",
    best_response_type: "SCOPE CLARITY. Send clear scope with: what's included (3-4 bullet points), what's NOT included, timeline, guarantee. Keep it simple. If they ask this, your previous communication was too vague.",
    boundary: "semi_auto (Kirill verifies scope accuracy)",
    risk_if_handled_badly: "Vague answer = they lose confidence. Too detailed = overwhelming. Missing 'not included' = scope creep later.",
  },
  {
    phrase: "Could you also add X / what about Y too",
    likely_real_meaning: "POSITIVE SIGNAL + SCOPE CREEP RISK. They see value and want more. This means they're bought in on the concept. But: unbounded add-ons without price adjustment = margin death.",
    hidden_fear: "They want maximum value. They're testing what they can get for the money. Underneath: 'Can I get a better deal by bundling?'",
    what_NOT_to_assume: "Do NOT assume you must say yes to keep the deal. Do NOT assume they'll walk away if you scope-split. Most people respect 'let's start with X, add Y later.'",
    best_response_type: "VALIDATE + PHASE-SPLIT + PRICE. 'Great idea — that would definitely help. Let's get [core] running first. Once you see it working, we add [add-on] as Phase 2 for another $750.' Never absorb extra scope without extra price.",
    boundary: "semi_auto (scope/price change = Kirill decides)",
    risk_if_handled_badly: "Saying yes to everything = doing $3K of work for $750. Saying flat no = kills enthusiasm. Right answer: yes, as a separate phase.",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3: OUTPUT B — STAKEHOLDER TABLE
// ══════════════════════════════════════════════════════════════════════════════

export const STAKEHOLDER_TABLE = [
  {
    phrase: "I need to check with my partner",
    likely_situation: "Co-owned business (common: husband/wife, two partners). Both have financial authority. One handles operations (your contact), one handles money/strategy.",
    what_it_might_really_mean: "Genuine: 'My co-owner needs to approve spending.' OR Stall: 'I'm not convinced but don't want to say no directly.'",
    proof_doc_needed: "One-pager answering 5 questions: (1) What is it? (2) What does it cost? (3) How long? (4) What do I do? (5) What if it doesn't work? — simple enough to read in 60 seconds.",
    follow_up_timing: "Ask: 'When do you think they'll have a chance to look?' → follow up 24h after that date. If no date given → follow up in 48h.",
    stall_indicator: "If after one-pager + follow-up + 7 days = still no partner response → likely stall. Send one closing message: 'Sounds like timing might not be right. Happy to reconnect whenever.' Then stop.",
  },
  {
    phrase: "I need to check with my husband / wife (they own the company)",
    likely_situation: "Your contact is involved in operations but NOT the financial decision-maker. Husband/wife is the owner who signs checks.",
    what_it_might_really_mean: "Almost always genuine in service businesses. Family-owned = shared decisions. But YOUR CONTACT may not have fully sold themselves yet.",
    proof_doc_needed: "Same one-pager, BUT add: estimated ROI specific to their business. Husband/wife who wasn't in the conversation needs NUMBERS, not story.",
    follow_up_timing: "48h after one-pager sent. Offer: 'Happy to answer their questions directly — sometimes it's easier than playing telephone.'",
    stall_indicator: "If partner 'keeps pushing it back' through 2+ follow-ups → your champion isn't championing. Ask directly: 'Is there a concern I can help address?'",
  },
  {
    phrase: "My office manager handles that / my team needs to see it",
    likely_situation: "Owner delegates operational decisions to a manager. Manager may have veto power (can say no) but not approval power (can't say yes alone).",
    what_it_might_really_mean: "Owner wants buy-in before spending. OR Owner wants to distance themselves from the sales conversation.",
    proof_doc_needed: "Demo video (2-min Loom) showing the manager's daily workflow improvement. Manager's concern is 'will this make my job harder or easier?' — demo must answer: EASIER.",
    follow_up_timing: "Ask owner: 'Would it help if I sent [manager] a quick walkthrough of what their day would look like?' Get manager's email. Send demo directly.",
    stall_indicator: "If manager never watches demo + owner goes quiet → owner wasn't serious. One follow-up to owner: 'Should we revisit this later?' If no response → mark Lost.",
  },
  {
    phrase: "I need approval / this has to go through...",
    likely_situation: "Formal or semi-formal approval process. More common in larger businesses (20+ employees) or franchises.",
    what_it_might_really_mean: "Real process. Cannot shortcut. Must work within it.",
    proof_doc_needed: "Formal scope document: clear deliverables, timeline, cost, ROI projection, guarantee. Format that can be attached to an approval email or printed.",
    follow_up_timing: "Ask: 'What does the approval process look like? How long does it usually take?' Follow up at their stated timeline + 2 days buffer.",
    stall_indicator: "If approval 'keeps getting delayed' through 3+ cycles → deprioritize. This is organizational friction, not buying intent.",
  },
  {
    phrase: "Let me talk to [name]",
    likely_situation: "Specific person mentioned = real stakeholder. They're telling you WHO the decision-maker is.",
    what_it_might_really_mean: "Genuine. Use this information. Ask: 'What does [name] typically care about most — the cost, the time savings, or something else?' This tells you what to optimize the one-pager for.",
    proof_doc_needed: "Customized one-pager emphasizing whatever the named stakeholder cares about (cost → ROI focus, time → efficiency focus, risk → guarantee focus).",
    follow_up_timing: "48h after they talk to [name]. Ask: 'How did the conversation with [name] go? Anything I can help clarify?'",
    stall_indicator: "[Name] 'hasn't had time' after 2 follow-ups → the deal isn't a priority for the actual decision-maker. Deprioritize.",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 4: OUTPUT C — NEGOTIATION DECISION TABLE
// ══════════════════════════════════════════════════════════════════════════════

export const NEGOTIATION_TABLE = [
  {
    scenario: "Too expensive — genuine budget constraint",
    hold: false,
    reduce_scope: true,
    split_phase: true,
    pilot: true,
    guarantee: true,
    walk_away: false,
    action: "Offer pilot at $750 with reduced scope (one process only). Include guarantee. Phase 2 priced separately.",
    reasoning: "They want it but can't afford full price. Pilot lets them pay what they can for immediate value. Guarantee removes risk.",
  },
  {
    scenario: "Too expensive — value not clear enough",
    hold: true,
    reduce_scope: false,
    split_phase: false,
    pilot: false,
    guarantee: true,
    walk_away: false,
    action: "Reframe with cost-of-inaction. 'You're losing ~$X/year to estimates that go cold. $1,500 pays for itself if it recovers 2-3 jobs.' Add guarantee.",
    reasoning: "Don't drop price when value is the issue. Make the value tangible. If they still say no after reframe → then offer pilot.",
  },
  {
    scenario: "Too expensive — smokescreen for another concern",
    hold: true,
    reduce_scope: false,
    split_phase: false,
    pilot: false,
    guarantee: false,
    walk_away: false,
    action: "Diagnose. 'Is it the amount, or is there something else about this that doesn't feel right?' Address the real concern first.",
    reasoning: "Discounting doesn't solve trust/need/timing problems. Diagnose before prescribe.",
  },
  {
    scenario: "Wants smaller version / start small",
    hold: false,
    reduce_scope: true,
    split_phase: true,
    pilot: true,
    guarantee: true,
    walk_away: false,
    action: "MATCH THEIR FRAME. Pilot at $750 for one process. Explicitly name Phase 2. This is their invitation to pilot — take it.",
    reasoning: "'Start small' = pilot invitation. They're telling you the route. Resistance here = pushing against the buyer's own preference.",
  },
  {
    scenario: "Asks for extra feature ('could you also add X')",
    hold: true,
    reduce_scope: false,
    split_phase: true,
    pilot: false,
    guarantee: false,
    walk_away: false,
    action: "Validate + phase: 'Great idea. Let's get [core] working first, then add [X] as Phase 2 for $750.' Never absorb scope without price.",
    reasoning: "Add-on request = they see value. Good signal. But bundling without pricing = margin death. Phase-split preserves both enthusiasm and margin.",
  },
  {
    scenario: "Asks to bundle everything for one price",
    hold: true,
    reduce_scope: false,
    split_phase: true,
    pilot: false,
    guarantee: false,
    walk_away: false,
    action: "If 2 processes: $1,500 total is acceptable (full price). If 3+: 'I can do [A+B] for $1,500 as one build. [C] would be Phase 2 at $750.' Set a ceiling.",
    reasoning: "Bundling 2 things at full price = fine. Bundling 3+ at same price = you're working for $500/process. Hold the line.",
  },
  {
    scenario: "Wants to wait / not right now",
    hold: false,
    reduce_scope: false,
    split_phase: false,
    pilot: false,
    guarantee: false,
    walk_away: false,
    action: "Acknowledge + seasonal reframe + get a date. 'Makes sense. Mind if I check back [specific date]?' If they give date → schedule. If vague → 30-day follow-up then breakup.",
    reasoning: "Don't push against genuine timing. But don't accept vague 'later'. Get a date or set your own.",
  },
  {
    scenario: "Wants proof / demo before discussing price",
    hold: false,
    reduce_scope: false,
    split_phase: false,
    pilot: false,
    guarantee: false,
    walk_away: false,
    action: "BUILD MODE. Produce demo within 24h. Show them something specific to their business. Then pricing follows naturally from 'do you want this built for real?'",
    reasoning: "This is a buying signal, not a stall. They want to evaluate. Give them something to evaluate. Speed matters — every day of delay cools interest.",
  },
  {
    scenario: "Wants price before understanding scope",
    hold: true,
    reduce_scope: false,
    split_phase: false,
    pilot: false,
    guarantee: false,
    walk_away: false,
    action: "Give range, not specific: 'Typically $750-$1,500 depending on what you need. To give you an exact number, can I ask a couple quick questions about your setup?'",
    reasoning: "They're price-filtering. If range scares them → probably low-budget, save both parties time. If range is acceptable → qualification continues.",
  },
  {
    scenario: "Competitor comparison ('someone else quoted $500')",
    hold: true,
    reduce_scope: false,
    split_phase: false,
    pilot: false,
    guarantee: true,
    walk_away: true,
    action: "'Fair point. The difference is usually in what happens after delivery — support, refinement, and guarantee. If it doesn't save you 5 hours/month in 30 days, I keep working at no charge. Does the other quote include that?' If they choose cheaper → walk away gracefully.",
    reasoning: "Don't compete on price with cheaper alternatives. Compete on guarantee + delivery quality. If they're pure price shoppers → not our buyer.",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 5: OUTPUT D — WIN / LOSS LOGGING PROTOCOL
// ══════════════════════════════════════════════════════════════════════════════

export const WIN_LOSS_PROTOCOL = {
  description: "Mandatory after EVERY deal exit (win, loss, or stall). No exceptions.",

  log_fields: {
    deal_id: "unique identifier",
    business_name: "string",
    vertical: "landscaping / plumbing / hvac / roofing / cleaning / electrical / other",
    business_size: "solo / 2-5 / 6-15 / 16-30 / 30+",
    acquisition_source: "warm_intro / cold_email / reddit / fiverr / linkedin / inbound / other",
    affiliated: "true (network) / false (unaffiliated stranger)",
    contact_role: "owner / co-owner / spouse / manager / admin / estimator / unknown",
    decision_makers_count: "1 / 2 / 3+",
    tool_detected: "jobber / hcp / servicetitan / none / unknown",
    first_reply_to_close_days: "number (or null if not closed)",

    // Outcome
    outcome: "won / lost / stalled",
    stage_reached: "interested / qualified / pricing_active / scope_active / commitment / paid",
    stage_lost_at: "which stage the deal died (if lost/stalled)",
    revenue: "number in CAD (0 if lost)",
    offer_type: "pilot / full / custom / phased",
    price_final: "number (what they actually paid or were quoted)",

    // Objection data
    objections_raised: "[array of objection types encountered]",
    objection_that_killed: "which objection ended the deal (if any)",
    objection_responses_used: "[array of which response types were tried]",

    // Stakeholder data
    partner_check_occurred: "boolean",
    partner_was_reached: "boolean",
    one_pager_sent: "boolean",
    champion_effectiveness: "strong / weak / none",

    // Learning
    what_worked: "free text — what moved the deal forward",
    what_failed: "free text — what stalled or killed it",
    would_do_differently: "free text — hindsight improvement",
    surprise: "anything unexpected about this deal",
  },

  what_changes_after_logging: {
    rule_upgrade: {
      trigger: "3+ wins with same pattern",
      action: "Codify the pattern as default approach. Example: 3 deals closed with pilot-first → pilot becomes default offer, not fallback.",
      what_changes: "deal-assist.mjs default templates, send_scope default offer type",
    },
    rule_downgrade: {
      trigger: "3+ losses at same stage with same objection",
      action: "Fix the systemic cause. Example: 3 deals lost at partner-check → one-pager wasn't good enough OR authority wasn't detected early enough.",
      what_changes: "partner one-pager template, authority detection in send_breakdown",
    },
    hypothesis_change: {
      trigger: "3+ losses in same vertical OR 3+ wins in same vertical",
      action: "Losses → deprioritize vertical. Wins → prioritize vertical. Example: 3 HVAC wins → HVAC becomes primary target.",
      what_changes: "validation-framework.json hypothesis scoring, send-outreach.mjs targeting",
    },
    offer_change: {
      trigger: "3+ price objections at same price point OR 3+ easy closes at same price",
      action: "Objections → test lower entry point or stronger value framing. Easy closes → test higher price.",
      what_changes: "deal-assist.mjs pricing in templates, pilot price",
    },
    route_change: {
      trigger: "3+ wins from one channel while another channel produces 0",
      action: "Double resources to winning channel. Pause losing channel.",
      what_changes: "portfolio_ranking, daily time allocation",
    },
    template_change: {
      trigger: "Kirill edits a template >50% of the time OR 3+ same-type objections not handled by existing template",
      action: "Rewrite template. Add new objection handler.",
      what_changes: "deal-assist.mjs RESPONSE_DRAFTS, objection handlers",
    },
  },

  one_off_vs_rule: {
    one_off: "Unusual outcome with unique circumstances. Example: deal lost because prospect's building flooded. Log as anecdote. Do NOT change system.",
    pattern: "Same outcome 3+ times with similar circumstances. Example: 3 deals stall at partner-check. Change the partner-equipping process.",
    rule: "Never change system behavior based on 1 outcome. 3 identical outcomes = mandatory system change. 5+ = high-confidence rule.",
  },
};


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 6: OUTPUT E — WHAT SHOULD CHANGE IN OUR SYSTEM NOW
// ══════════════════════════════════════════════════════════════════════════════

export const SYSTEM_CHANGES = {

  deal_assist_changes: [
    {
      change: "Restructure handle_price_objection as 2-step",
      current: "Immediately offers pilot ($750) and reduced ($1,000) options",
      new: "Step 1: Diagnostic question — 'Is it the amount, or is there a part of the scope that doesn't feel right?' Step 2: Based on answer → pilot / value-reframe / address real objection",
      why: "Prevents unnecessary discounting when price is smokescreen",
    },
    {
      change: "Add handle_think_about_it classification",
      current: "Not separately classified — falls into unclassified or timing",
      new: "New pattern: /think about it|need to think|give me some time|let me consider/i → intent_score 2, boundary semi_auto, action: diagnose_stall",
      why: "'Think about it' requires different handling than 'not right now'",
    },
    {
      change: "Add handle_partner_check classification",
      current: "Falls into unclassified — treated as generic stall",
      new: "New pattern: /check with.*(partner|husband|wife|boss|co-owner)|need.*approval|need to discuss/i → intent_score 3, boundary semi_auto, action: equip_champion",
      why: "Partner check is multi-stakeholder dynamic, not a stall. Requires one-pager + direct access offer.",
    },
    {
      change: "Add handle_scope_expansion classification",
      current: "Not classified — falls into curiosity or unclassified",
      new: "New pattern: /could you also|what about adding|can it also|would it handle/i → intent_score 3, boundary semi_auto, action: validate_and_phase_split",
      why: "Scope expansion requests are positive signals that must be phased, not absorbed or rejected",
    },
    {
      change: "Add authority check to send_breakdown template",
      current: "Breakdown has qualifying question about tools but not authority",
      new: "Add to breakdown: 'Quick question — are you the one who'd sign off on something like this, or would someone else need to be involved?'",
      why: "Early authority detection prevents investing in non-decision-makers",
    },
    {
      change: "Add guarantee to send_scope template",
      current: "Guarantee only appears in trust objection handler",
      new: "Add to every scope: 'If this doesn't save you at least 5 hours/month within 30 days, I keep refining until it does — no extra charge.'",
      why: "Proactive risk reversal reduces objections before they arise. Hormozi: remove risk = more sales.",
    },
    {
      change: "Add cost-of-inaction to scope template",
      current: "Scope lists features and price but not what inaction costs",
      new: "Add above pricing: 'Based on your [X] estimates per month, you're likely leaving $[Y] on the table annually from ones that go cold.'",
      why: "Frames price as tiny compared to ongoing loss. $750 vs $50K/year lost = obvious decision.",
    },
    {
      change: "Add NOT INCLUDED section to scope template",
      current: "Scope lists what's included but not exclusions",
      new: "Add: 'NOT INCLUDED (future phase if you want): [specific items mentioned but not in this scope]'",
      why: "Explicit exclusions prevent scope creep and set up Phase 2 naturally.",
    },
  ],

  stage_tracking_changes: [
    {
      change: "Add partner_check_pending substage",
      where: "Between scope_active and commitment",
      data: "partner_name, one_pager_sent, follow_up_count, days_in_partner_check",
      why: "Partner check is a distinct phase with its own SLA and follow-up cadence",
    },
    {
      change: "Track objections per lead",
      where: "Add objections_log array to each lead record",
      data: "{ type, date, response_used, outcome }",
      why: "Pattern detection across leads requires objection-level data",
    },
  ],

  follow_up_changes: [
    {
      change: "Extend warm lead follow-up cadence",
      current: "48h check-in → day 7 breakup",
      new: "48h check-in → day 7 value-add → day 14 new angle → day 30 seasonal → day 45 breakup",
      why: "80% say no 4 times before yes. Our current cadence gives up after 2 touches. Too aggressive on breakup for warm leads.",
      cold_keeps: "Cold leads keep 48h + day 7 breakup (unchanged)",
    },
  ],

  new_templates_needed: [
    {
      template: "partner_summary_one_pager",
      purpose: "One-page document for champion to forward to decision-maker",
      must_answer: ["What is this?", "What does it cost?", "How long?", "What do I have to do?", "What if it doesn't work?"],
      format: "Clean, scannable, 60-second read. No pitch language. Facts only.",
    },
    {
      template: "diagnose_stall_response",
      purpose: "Response to 'I need to think about it'",
      content: "'Totally understand — is there a specific part you want to think through? The scope, the price, or something else?'",
    },
    {
      template: "scope_expansion_response",
      purpose: "Response to 'could you also add X'",
      content: "'Great idea — that would definitely add value. Let's get [core] working first. Once you see it live, we add [X] as Phase 2 for $750.'",
    },
    {
      template: "diagnose_price_response",
      purpose: "First response to 'too expensive' (before offering alternatives)",
      content: "'I hear you — $[X] is real money. Is it the total amount, or is there a part of the scope that doesn't feel worth it?'",
    },
    {
      template: "authority_check_question",
      purpose: "Embedded in breakdown/early reply",
      content: "'Quick question — are you the one who'd sign off on something like this, or would someone else need to be involved?'",
    },
  ],
};


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 7: PRACTICAL SUMMARY
// ══════════════════════════════════════════════════════════════════════════════

export const PRACTICAL_SUMMARY = {

  top_5_objection_meaning_rules: [
    "1. 'TOO EXPENSIVE' IS USUALLY NOT ABOUT PRICE. Ask diagnostic question BEFORE offering discount. 'Is it the amount, or is something about the scope not feeling right?' Most price objections mask trust, value, or timing issues. Discounting a trust problem doesn't fix the trust problem.",
    "2. 'I NEED TO THINK ABOUT IT' = SOMETHING SPECIFIC IS UNRESOLVED. Ask what specifically. Their answer reveals the real blocker. If price → handle as price. If scope → clarify. If partner → equip champion. If truly vague → likely a stall, follow up once then accept it.",
    "3. 'CHECK WITH MY PARTNER' IN SERVICE BUSINESSES IS USUALLY REAL, NOT A STALL. Family-owned businesses make joint financial decisions. Equip the champion with a 60-second one-pager answering 5 predictable questions. Offer direct access to the partner. This is a phase in the buying process, not a dead end.",
    "4. 'CAN YOU SHOW ME' IS A BUYING SIGNAL, NOT AN OBJECTION. They want to evaluate. This is forward motion. Produce a demo within 24 hours specific to THEIR business. Speed matters enormously here — delay kills the momentum they just created.",
    "5. 'COULD YOU ALSO ADD X' IS THE BEST SIGNAL AND THE BIGGEST TRAP. It means they're bought in on the concept. But absorbing extra scope without extra price = margin death. Always validate + phase-split + price separately. 'Let's get [core] working first. Add [X] as Phase 2.'",
  ],

  top_5_negotiation_rules: [
    "1. DIAGNOSE BEFORE YOU DISCOUNT. Every 'too expensive' gets a diagnostic question first, not an immediate pilot offer. If the real issue is trust or value, discounting doesn't fix it — it just makes you cheaper AND still mistrusted.",
    "2. NEVER ABSORB SCOPE WITHOUT PRICE. When prospect asks 'could you also add X' — the answer is always 'yes, as Phase 2 for $[price]'. Three features at $750 = working for $250/feature. Two features at $1,500 = working for $750/feature. Hold the line.",
    "3. INCLUDE GUARANTEE IN EVERY SCOPE, NOT JUST WHEN OBJECTED. '5 hours/month savings in 30 days or free refinement.' Proactive risk reversal kills objections before they form. Buyer has nothing to lose = easier yes.",
    "4. USE COST-OF-INACTION IN EVERY PRICE CONVERSATION. '$750 once vs ~$X/year you're currently losing.' When the alternative to buying is continuing to lose money, your price looks small. This reframe must be backed by their specific numbers from the audit.",
    "5. FIRST PRICE ANCHORS ALL FUTURE PRICES. Pilot at $750 with reduced scope = acceptable. Full project discount to $500 = permanent damage. Every concession removes scope, never just removes price. If they negotiate below $750 → walk away gracefully. 'Sounds like timing might not be right.'",
  ],

  top_3_learning_rules: [
    "1. ONE OUTCOME = ANECDOTE. THREE OUTCOMES = PATTERN. FIVE = RULE. Never change system behavior from one deal. But when 3 deals stall at the same stage for the same reason, that's a systemic problem — fix the stage, not the lead. When 3 deals close through the same approach, that's the playbook — codify it.",
    "2. LOG THE OBJECTION THAT KILLED THE DEAL, NOT JUST THE OUTCOME. 'Lost' tells you nothing. 'Lost at scope stage because partner rejected without seeing one-pager' tells you exactly what to fix. Every deal exit must record: stage_lost_at, objection_that_killed, what_worked, what_failed, would_do_differently.",
    "3. WINS ARE AS IMPORTANT TO LEARN FROM AS LOSSES. Most systems only log failures. But knowing WHAT CLOSED a deal (which channel, which pitch, which objection handler, how fast you responded) is what builds the playbook for the next 10 deals. After every win: what worked and why? After every loss: what broke and where?",
  ],
};
