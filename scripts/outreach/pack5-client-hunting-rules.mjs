/**
 * Pack 5 — Client Hunting & Money Capture
 *
 * Machine-usable rules extracted from 16 sources.
 * Purpose: find buyers, filter non-buyers, choose route, push toward money, stop wasting time on curiosity.
 *
 * Source materials: Close (6), SaaStr (4), Housecall Pro (3), ServiceTitan (1), r/sweatystartup (2)
 */

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 1: STRUCTURED RULES — PER SOURCE EXTRACTION
// ══════════════════════════════════════════════════════════════════════════════

export const PACK5_EXTRACTED_RULES = [

  // ── GROUP 1: Close — Prospecting / Qualification / Disqualification ────────

  // SOURCE 1: Close — Sales Prospecting Complete Guide
  {
    source: "Close — Sales Prospecting: Complete Guide",
    tier: "primary",
    type: "prospecting_process",
    pattern: "82% of reps who exceeded quota ALWAYS research before reaching out. Lead ≠ Prospect. Lead = unqualified potential. Prospect = completed qualification.",
    evidence: "Close blog, survey stat: 82% quota-exceeding reps research first",
    anti_pattern: "Blasting cold emails without researching the business first. Treating every lead as a prospect.",
    applicable_to_us: true,
    why_applicable: "Our send-outreach.mjs sends to scraped businesses. Adding even basic research (website check, tool detection) before sending = higher reply rate.",
    confidence: "high",
    extracted_rule: "NEVER contact without research. Check website, tools visible, owner name, business size. A lead becomes a prospect only after research confirms ICP fit.",
    target_component: "send-outreach.mjs, researchBusiness()",
    expected_metric_change: "reply_rate +15-25% from researched vs blind sends",
    review_window: "30 days",
    risk: "low — research adds 5s per lead but saves wasted emails",
    apply_mode: "auto",
  },
  {
    source: "Close — Sales Prospecting: Complete Guide",
    tier: "primary",
    type: "discovery_questions",
    pattern: "Discovery must surface: challenges/pain, buyer timeline, other decision-makers, urgency level, budget/authority. Value questions: 'How much money would you save?', 'What happens if unsolved in 6 months?'",
    evidence: "Close 5-step prospecting process, Step 3",
    anti_pattern: "Pitching immediately without understanding their situation. Asking yes/no questions instead of open-ended discovery.",
    applicable_to_us: true,
    why_applicable: "When a lead replies with curiosity or pricing ask, our deal-assist response should include 1-2 discovery questions to qualify before sending scope.",
    confidence: "high",
    extracted_rule: "Every breakdown email must include at least ONE qualifying question: 'What tool do you use for estimates now?' or 'How many open estimates do you have at any time?' This filters real buyers from browsers.",
    target_component: "deal-assist.mjs (send_breakdown template)",
    expected_metric_change: "qualified_reply_rate +20%, fewer scope emails to non-buyers",
    review_window: "14 days",
    risk: "low — one question doesn't hurt tone",
    apply_mode: "semi_auto",
  },
  {
    source: "Close — Sales Prospecting: Complete Guide",
    tier: "primary",
    type: "referral_priority",
    pattern: "84% of B2B buyers start with a referral, not a salesperson. Proactively contact highest-ROI customers for introductions.",
    evidence: "Close blog referral stat",
    anti_pattern: "Only doing cold outreach. Never asking satisfied contacts for introductions.",
    applicable_to_us: true,
    why_applicable: "We have zero clients yet, but the moment client #1 closes, referral ask must be automatic. Also: any warm intro lead should be prioritized above cold leads.",
    confidence: "high",
    extracted_rule: "Warm intro leads get 3x priority score over cold leads. After any successful delivery, system queues referral ask at day 7 post-delivery.",
    target_component: "money_score logic, send-followups.mjs",
    expected_metric_change: "referral_pipeline_creation from 0 to active",
    review_window: "after first client delivery",
    risk: "zero — asking costs nothing",
    apply_mode: "auto",
  },

  // SOURCE 2: Close — 4 Factors to Qualify Prospects
  {
    source: "Close — 4 Factors to Qualify Prospects",
    tier: "primary",
    type: "qualification_framework",
    pattern: "BANT (Budget, Authority, Need, Timing) applied practically: ICP match → Needs assessment (individual/team/company) → Decision-making process → Competitive landscape. Disqualify if company size too small, no budget allocated, decision timeline misaligned.",
    evidence: "Close qualification framework, example: 'if less than $100/year, recommend they not buy and use a spreadsheet instead'",
    anti_pattern: "Trying to sell to everyone who replies. No minimum threshold for engagement. Treating all interest as equal.",
    applicable_to_us: true,
    why_applicable: "We need a minimum-viable qualification check: does this business have enough revenue that $1,500 is reasonable? Are we talking to the owner? Is their pain real or hypothetical?",
    confidence: "high",
    extracted_rule: "Qualification gate before sending scope: (1) Business has employees or subcontractors (not solo hobbyist), (2) Owner or decision-maker in conversation, (3) Active pain mentioned (not just curiosity), (4) No signal they're shopping for cheapest option. If any fail → send lighter touch, not full scope.",
    target_component: "deal-assist.mjs (pre-scope qualification)",
    expected_metric_change: "scope_to_close_ratio improvement, fewer wasted scopes",
    review_window: "30 days",
    risk: "medium — over-qualification could filter real buyers. Start lenient.",
    apply_mode: "semi_auto",
  },
  {
    source: "Close — 4 Factors to Qualify Prospects",
    tier: "primary",
    type: "red_flag_detection",
    pattern: "Watch for incongruencies: prospect says urgency but asks vague questions. Claims budget but won't discuss numbers. Says decision-maker but defers everything. Pay attention to tone/context, not just words.",
    evidence: "Close: 'Sales surprises aren't surprises — they're just the result of not qualifying properly'",
    anti_pattern: "Taking every reply at face value. Not noticing when words don't match behavior.",
    applicable_to_us: true,
    why_applicable: "Deal-assist should flag incongruencies: e.g., 'let's do it' but no prior pricing discussion = suspicious. 'What's the price' but from generic email = likely not owner.",
    confidence: "high",
    extracted_rule: "Flag reply as INCONGRUENT if: (1) high-intent words but zero prior engagement, (2) pricing ask from non-owner email, (3) 'ready to start' without ever discussing scope. Incongruent replies → semi_auto with explicit Kirill warning.",
    target_component: "deal-assist.mjs (classifyReply enhancement)",
    expected_metric_change: "fewer false-positive 'hot leads'",
    review_window: "14 days",
    risk: "low — flagging doesn't block, just warns",
    apply_mode: "semi_auto",
  },

  // SOURCE 3: Close — Sales Qualified Leads
  {
    source: "Close — Sales Qualified Leads",
    tier: "primary",
    type: "lead_scoring",
    pattern: "Lead scoring: demographic criteria = 1 point, behavioral signal (download/visit) = 2 points, high-intent action (trial/meeting request) = 3 points. Contact highest-scoring first.",
    evidence: "Close SQL generation process, Step 4",
    anti_pattern: "Contacting leads in order they were found. No scoring. First-in-first-out queue.",
    applicable_to_us: true,
    why_applicable: "Our outreach sends to businesses in whatever order they're scraped. Scoring by signals (owner email found, tool detected, website active, reviews exist) would prioritize better leads.",
    confidence: "high",
    extracted_rule: "Score leads before sending: owner_email_found=+3, tool_signal_detected=+2, active_website=+1, reviews_exist=+1, growth_signal=+2, seasonal_peak_timing=+2. Send to highest scores first. Skip scores below 3.",
    target_component: "send-outreach.mjs (lead selection order), money_score logic",
    expected_metric_change: "reply_rate +20-30% from better targeting order",
    review_window: "30 days",
    risk: "low — reordering is free",
    apply_mode: "auto",
  },
  {
    source: "Close — Sales Qualified Leads",
    tier: "secondary",
    type: "sql_behavioral_signals",
    pattern: "SQL = matched ICP + expressed interest + agreed to meet + behavioral signals + fits demographics. MQL vs SQL: MQL = general potential, SQL = higher probability. Don't treat MQLs as SQLs.",
    evidence: "Close SQL characteristics checklist",
    anti_pattern: "Treating 'tell me more' as same quality as 'what's the price'. No differentiation between curiosity and buying intent.",
    applicable_to_us: true,
    why_applicable: "Our deal-assist already classifies intent 0-5 but doesn't track progression. A lead that goes curiosity → pricing ask is more valuable than a fresh pricing ask with no history.",
    confidence: "medium",
    extracted_rule: "Track lead progression: curiosity_reply + follow_up_reply = intent escalation = +2 to money_score. Single curiosity reply with no follow-up after 7 days = stalling = deprioritize.",
    target_component: "deal-assist.mjs, stage tracking",
    expected_metric_change: "better follow-up allocation",
    review_window: "30 days",
    risk: "low",
    apply_mode: "auto",
  },

  // SOURCE 4: Close — B2B Qualifying Questions
  {
    source: "Close — B2B Qualifying Questions",
    tier: "primary",
    type: "qualification_questions",
    pattern: "Stop pitching, start asking. 4 categories: ICP verification, needs discovery, decision/budget, competition. 'Most sales reps lose deals not from bad pitches, but from talking to wrong people.' Before call: select 3-5 qualifying questions. After call: record insights, tailor next steps.",
    evidence: "Close B2B qualifying guide: 'Great salespeople don't talk their way into deals — they ask their way in.'",
    anti_pattern: "Sending full scope to anyone who asks. No qualifying questions in email flow. Pitching features before understanding situation.",
    applicable_to_us: true,
    why_applicable: "Our email templates pitch immediately. Adding 1 qualifying question per reply would filter buyers from browsers at near-zero cost.",
    confidence: "high",
    extracted_rule: "Embed qualifying question in EVERY non-auto reply: curiosity → 'What tool do you use for estimates right now?', pricing → 'How many estimates do you send per month roughly?', pain → 'How many of those turn into actual jobs?' Their answer reveals budget/need/authority.",
    target_component: "deal-assist.mjs (RESPONSE_DRAFTS)",
    expected_metric_change: "qualification_accuracy +30%",
    review_window: "14 days",
    risk: "low — one question is natural",
    apply_mode: "build",
  },

  // SOURCE 5: Close Help — Prospecting
  {
    source: "Close Help — Prospecting",
    tier: "tertiary",
    type: "process_definition",
    pattern: "Prospecting = turning a prospect (who may not know you) into an opportunity. Once you have an opportunity, you can turn them into customers. Categorize leads by conversion likelihood into buckets/lists.",
    evidence: "Close Help docs definition",
    anti_pattern: "Treating all contacts as same stage. No bucketing by likelihood.",
    applicable_to_us: true,
    why_applicable: "Reinforces that our outreach DB needs likelihood buckets, not just 'contacted/not contacted'.",
    confidence: "medium",
    extracted_rule: "Add conversion_likelihood field to outreach DB: high/medium/low/skip. Based on research signals. High = owner email + tool signal + active pain. Medium = owner email + active website. Low = generic email or no signals. Skip = enterprise/institution/generic.",
    target_component: "send-outreach.mjs, find-businesses.mjs",
    expected_metric_change: "effort_allocation improvement",
    review_window: "30 days",
    risk: "low",
    apply_mode: "auto",
  },

  // SOURCE 6: Close Help — Lead Statuses
  {
    source: "Close Help — Lead Statuses",
    tier: "secondary",
    type: "stage_definition",
    pattern: "Outbound statuses: Potential → Interested → Qualified → Customer → Not Interested → Bad Fit. Start with high-level statuses, refine as process matures. Colors help visual scanning.",
    evidence: "Close CRM lead status examples",
    anti_pattern: "Too many statuses too early. Complex pipeline before you have deal flow.",
    applicable_to_us: true,
    why_applicable: "Our deal-assist has 11 stages which is too many for current volume. Should simplify to match Close's proven outbound set.",
    confidence: "high",
    extracted_rule: "Simplify active tracking to 6 statuses: potential (researched, not contacted) → contacted (email sent) → interested (replied positively) → qualified (BANT signals present) → customer (paid) → dead (not interested / bad fit / lost). Add substatus only when volume justifies it.",
    target_component: "deal-assist.mjs (DEAL_STAGES), stage tracking",
    expected_metric_change: "cleaner pipeline visibility",
    review_window: "60 days",
    risk: "low — simplification reduces confusion",
    apply_mode: "build",
  },

  // ── GROUP 2: SaaStr — Founder-led first money ─────────────────────────────

  // SOURCE 7: SaaStr — Should Founder Handle Sales
  {
    source: "SaaStr — Should Founder Handle Sales Themself",
    tier: "primary",
    type: "founder_sales_rule",
    pattern: "Founder MUST close at least first 10 customers personally. 95% of the time, founder should do sales. Even if 'terrible' at it — still close 10. Then hire 2 reps (not 1) to A/B test. Then demand gen. Then VP Sales to SCALE, not to figure out if you have a process.",
    evidence: "Jason Lemkin, SaaStr: 'How can you figure out who to hire, if you can't even close 10 customers yourself? Really... you can't.'",
    anti_pattern: "Hiring someone to sell before you've sold 10 yourself. Delegating sales before understanding the process. Stepping out of sales after hiring VP.",
    applicable_to_us: true,
    why_applicable: "Kirill IS the founder-seller. System assists but Kirill closes. This validates our semi_auto boundary: system prepares, Kirill decides on money conversations.",
    confidence: "high",
    extracted_rule: "Until 10 paid clients: Kirill is the closer. System's job = find leads, prepare materials, draft replies. System NEVER closes deals autonomously. After 10 clients: evaluate which parts can be delegated.",
    target_component: "deal-assist.mjs (boundary logic), autonomy-policy.mjs",
    expected_metric_change: "correct role allocation, no premature automation of closing",
    review_window: "until 10 clients",
    risk: "zero — this IS our current architecture",
    apply_mode: "already_applied",
  },

  // SOURCE 8: SaaStr — How Do I Get My First 10 Customers
  {
    source: "SaaStr — How Do I Get My First 10 Customers",
    tier: "primary",
    type: "first_customers_playbook",
    pattern: "First 10 = hustle, not systems. (1) Start with network — people buy from people they trust. (2) Knock on doors literally/figuratively — cold emails, cold calls, events. (3) Offer trials/discounts to lower barrier. (4) Leverage early adopters (smaller companies, more flexible). (5) Lean on relationships for intros/referrals. (6) PR — any press = a lead or two. (7) S-tier content weekly.",
    evidence: "Jason Lemkin: 'The first 10 customers won't come to you. You have to go to them.'",
    anti_pattern: "Waiting for inbound. Building perfect system before having clients. Expecting leads to come from automated pipeline alone.",
    applicable_to_us: true,
    why_applicable: "We're at 0 clients. System should maximize Kirill's outbound effort, not replace it. Every warm intro, every Calgary connection, every service business event = higher priority than cold email #47.",
    confidence: "high",
    extracted_rule: "Priority order for lead sources: (1) warm intros from network, (2) local Calgary events/connections, (3) referrals from any contact, (4) cold email to researched targets, (5) content-generated inbound. Never skip steps 1-3 to focus on step 4.",
    target_component: "portfolio_strategy, lead selection order",
    expected_metric_change: "faster time to first client",
    review_window: "until 5 clients",
    risk: "low",
    apply_mode: "semi_auto",
  },

  // SOURCE 9: SaaStr — Acquiring Your First Customer
  {
    source: "SaaStr — Acquiring Your First Customer",
    tier: "secondary",
    type: "smb_learning_threshold",
    pattern: "With SMBs, you may need 20-50 paying customers to have enough data to draw true opinions. With enterprise, even 1 can show you the future. SMB diversity = ICP confusion. Spend time with customers in person/phone — less time = less learning.",
    evidence: "Jason Lemkin's experience across two startups: Fortune 500 vs SMB",
    anti_pattern: "Drawing ICP conclusions from 1-2 SMB clients. Not talking to customers directly. Making strategy decisions from too little data.",
    applicable_to_us: true,
    why_applicable: "We sell to service-business SMBs. First 3-5 clients won't define our ICP reliably. Must keep vertical options open and learn from each client conversation.",
    confidence: "high",
    extracted_rule: "Do NOT narrow ICP until 10+ paid clients. Track what vertical, what size, what pain, what closed them — but don't exclude verticals based on <5 data points. Every client gets a post-delivery debrief call.",
    target_component: "portfolio_strategy, validation-framework.json",
    expected_metric_change: "prevents premature ICP lock-in",
    review_window: "until 10 clients",
    risk: "low",
    apply_mode: "semi_auto",
  },

  // SOURCE 10: SaaStr — The 10th Sale is the Hardest
  {
    source: "SaaStr — The 10th Sale is the Hardest",
    tier: "primary",
    type: "false_progress_warning",
    pattern: "First few sales are from unscalable techniques: ex-boss, random meeting, crazy cold call. The danger zone is 2-3 customers → 10. First sales = chutzpah, not engine. The real breakthrough = 'customer from the ether' who signs up without knowing you. 10 UNAFFILIATED paying customers = earliest product-market fit.",
    evidence: "Lemkin: 'tons of founders with 2 or 3 customers that then really struggle to get to 10. But almost never met anyone that got to 10 unaffiliated paying customers that dropped to 0.'",
    anti_pattern: "Counting friends/family as real clients. Treating first sale as proof of repeatable process. Stopping hustle after first close.",
    applicable_to_us: true,
    why_applicable: "Critical reality check. First client may come from warm intro — that's fine but doesn't prove the cold outreach engine works. Must track: how did each client find us? Affiliated or unaffiliated?",
    confidence: "high",
    extracted_rule: "Track acquisition_source for every client: affiliated (network/intro/referral) vs unaffiliated (cold email/content/inbound). First 3 affiliated clients ≠ product-market fit. System must continue cold outreach even after warm deals close. Goal: first unaffiliated client = real signal.",
    target_component: "stage tracking, validation-framework.json",
    expected_metric_change: "honest progress tracking",
    review_window: "ongoing",
    risk: "zero — tracking costs nothing",
    apply_mode: "auto",
  },

  // ── GROUP 3: Service-business buyer behavior ──────────────────────────────

  // SOURCE 11: Housecall Pro — Pipeline Getting Started
  {
    source: "Housecall Pro — Getting Started with Pipeline",
    tier: "primary",
    type: "service_business_pipeline",
    pattern: "3 boards: Leads (New→First Contact→Second→Third→Won/Lost), Estimates (Unscheduled→Scheduled→In Progress→Completed→Sent→On Hold→Approved→Rejected), Jobs (Unscheduled→Scheduled→In Progress→Completed→Invoice Sent→Invoice Paid). Automations: auto-SMS at each stage, auto-Lost after 3rd contact with no response, auto-archive Won/Lost after X days.",
    evidence: "Housecall Pro pipeline with 17 automations across 3 boards",
    anti_pattern: "No follow-up cadence. Manual tracking of estimate status. No automatic Lost marking.",
    applicable_to_us: true,
    why_applicable: "This IS how our target customers' businesses work. Their pipeline = Leads → Estimates → Jobs → Invoices. Our automation must plug into this exact flow. When we say 'your estimates follow up on themselves' — this is what we're automating.",
    confidence: "high",
    extracted_rule: "When generating audits, reference their ACTUAL pipeline stages: 'How many estimates are sitting in Sent status with no follow-up? How many went to Lost that could have been saved with a 72h text?' This speaks their language.",
    target_component: "generate-audit.mjs, deal-assist.mjs (response templates)",
    expected_metric_change: "higher resonance in outreach, prospect feels understood",
    review_window: "14 days",
    risk: "low",
    apply_mode: "build",
  },
  {
    source: "Housecall Pro — Getting Started with Pipeline",
    tier: "primary",
    type: "follow_up_cadence_evidence",
    pattern: "Housecall Pro automates: First follow-up (SMS after X days in Sent), Second follow-up (SMS+email), Third follow-up (SMS+email), then auto-decline. For leads: same 3-touch then auto-Lost. This is STANDARD in the industry — not a premium feature, a baseline expectation.",
    evidence: "17 built-in automations in Housecall Pro pipeline",
    anti_pattern: "Selling follow-up automation as innovative. Ignoring that many prospects already have some version of this.",
    applicable_to_us: true,
    why_applicable: "Our pitch must acknowledge that tools like HCP already do basic follow-up. Our value = BETTER follow-up (personalized text, not template), PLUS the estimate-to-job conversion tracking they don't get from HCP alone.",
    confidence: "high",
    extracted_rule: "In outreach and audit, position against existing tool limitations: 'Housecall Pro sends the same template to everyone. What if your $15K roofing estimate got the same follow-up as a $200 drain clean?' Differentiate on intelligence, not automation.",
    target_component: "generate-audit.mjs, write-email.mjs",
    expected_metric_change: "stronger positioning vs 'I already have HCP'",
    review_window: "30 days",
    risk: "medium — must be accurate about HCP limitations",
    apply_mode: "semi_auto",
  },

  // SOURCE 13: Housecall Pro — Pipeline Features
  {
    source: "Housecall Pro — Pipeline Features Page",
    tier: "secondary",
    type: "market_metrics",
    pattern: "HCP platform: 200K+ users, 100M+ jobs completed, 35% average revenue growth after first year, 8+ hours saved per week. 4.7/5 stars. Industry-specific templates for HVAC, cleaning, handyman, electrical, plumbing.",
    evidence: "Housecall Pro features page metrics",
    anti_pattern: "Ignoring that prospects may already use HCP. Pitching automation to someone who has it.",
    applicable_to_us: true,
    why_applicable: "If prospect already uses HCP, our pitch changes: 'You have the pipeline — but are you actually using the automation? Most HCP users don't configure follow-ups.' Detection: ask what tools they use.",
    confidence: "medium",
    extracted_rule: "Add tool_detection to qualification: if prospect uses HCP/Jobber/ServiceTitan → they understand automation → pitch is 'optimization' not 'introduction'. If no tool → pitch is 'you're losing money to manual tracking'.",
    target_component: "researchBusiness(), generate-audit.mjs",
    expected_metric_change: "better message-market fit",
    review_window: "30 days",
    risk: "low",
    apply_mode: "auto",
  },

  // SOURCE 14: ServiceTitan — Above + Beyond success story
  {
    source: "ServiceTitan — Above + Beyond saves $1.2M in unsold estimates",
    tier: "primary",
    type: "roi_evidence",
    pattern: "$20M business recovered $1M in one year from unsold estimates by assigning ONE person to follow up every day. Close rate up 55-60%. Average ticket up 29%. The follow-up coordinator role = 'a million-dollar job'. Most techs give away too much info (customers DIY), or don't greet properly. AI coaching improved conversion.",
    evidence: "Above + Beyond Service Co, Edmond OK, Vincent Price quote: 'If you're not using Field Pro, you're losing money.'",
    anti_pattern: "Assuming service businesses don't have enough unsold estimates to justify follow-up automation. Underselling the ROI.",
    applicable_to_us: true,
    why_applicable: "THIS IS OUR PROOF STORY. A $20M company recovered $1M from follow-up alone. Our target is smaller businesses ($500K-$5M) — even 10% of that ratio = $50K-$500K recoverable revenue. Our audit should calculate this.",
    confidence: "high",
    extracted_rule: "Audit ROI formula: estimate_volume × average_ticket × loss_rate × recovery_rate = annual recoverable revenue. Use ServiceTitan data as benchmark: 29% ticket increase possible, 55-60% close rate achievable. For a $1M business: ~$100K-$200K in unsold estimates sitting there.",
    target_component: "generate-audit.mjs (ROI calculation), deal-assist.mjs (objection handling)",
    expected_metric_change: "stronger ROI story in outreach",
    review_window: "14 days",
    risk: "medium — numbers must be conservative for smaller businesses",
    apply_mode: "semi_auto",
  },
  {
    source: "ServiceTitan — Above + Beyond saves $1.2M in unsold estimates",
    tier: "primary",
    type: "dedicated_followup_person",
    pattern: "Above + Beyond assigned ONE dedicated person to follow up on unsold estimates every day. That person's ONLY job. Result: $1M+ recovered. This is what we're replacing with automation for smaller businesses that can't afford a dedicated person.",
    evidence: "Vincent Price: 'All she does is go through the unsold estimates and unsold jobs, every day, day in and day out.'",
    anti_pattern: "Pitching automation as nice-to-have. Not framing it as 'you can't afford a full-time person for this, but automation does it for $1,500 once'.",
    applicable_to_us: true,
    why_applicable: "Perfect pitch angle: 'Big companies hire someone full-time to chase estimates. You can't. But for $1,500, your estimates chase themselves.' This reframes the price as 1/40th of a full-time hire.",
    confidence: "high",
    extracted_rule: "Add to audit template: 'Companies like Above + Beyond (a $20M plumbing/HVAC business) hired a full-time person just to follow up on unsold estimates — and recovered over $1M in one year. For your business, automation does the same job at a fraction of the cost.'",
    target_component: "generate-audit.mjs, deal-assist.mjs (handle_price_objection)",
    expected_metric_change: "stronger price justification, reduced price objections",
    review_window: "14 days",
    risk: "low — factual, sourced claim",
    apply_mode: "build",
  },

  // ── GROUP 4: Practitioner first-client reality ────────────────────────────

  // SOURCE 15: r/sweatystartup — How did you get first clients (cleaning)
  {
    source: "r/sweatystartup — How did you get your first clients?",
    tier: "secondary",
    type: "practitioner_channels",
    pattern: "Real first-client channels for service businesses: (1) Facebook friends/groups, (2) Craigslist $5 ads, (3) Nextdoor app, (4) Door knockers/flyers — one person went 0 to $15K/month in 6-7 months with 5,000 door hangers, (5) Word of mouth from friends, (6) Yard signs, (7) Thumbtack (expensive but works initially), (8) Google My Business + early reviews, (9) Business cards on bulletin boards.",
    evidence: "Multiple r/sweatystartup commenters with real results",
    anti_pattern: "Thinking service businesses acquire clients through sophisticated digital marketing. They don't — it's physical, local, word-of-mouth.",
    applicable_to_us: true,
    why_applicable: "Our TARGET CUSTOMERS got their first clients through these channels. When we write cold emails, we should speak this language: 'You got your first clients through word of mouth and Nextdoor. Now you're getting more estimates than you can follow up on.'",
    confidence: "high",
    extracted_rule: "Outreach messaging should reference THEIR reality: local ads, word of mouth, door-to-door. Don't use tech/SaaS language. 'You're busy actually doing the work — who's following up on the estimates you sent last week?' resonates because they ARE busy doing physical work.",
    target_component: "write-email.mjs, generate-audit.mjs",
    expected_metric_change: "higher emotional resonance in cold emails",
    review_window: "14 days",
    risk: "low",
    apply_mode: "build",
  },
  {
    source: "r/sweatystartup — How did you get your first clients?",
    tier: "secondary",
    type: "discount_as_entry",
    pattern: "Multiple practitioners gave 50% discount to first client for testimonial/portfolio. Early clients = learning experiences + referral sources, not profit centers. Family friend as first client with steep discount is NORMAL.",
    evidence: "Jimboy10: '50% discount so you can display your work and/or testimonials'",
    anti_pattern: "Expecting full-price payment from first client. Not leveraging first client for testimonials/referrals.",
    applicable_to_us: true,
    why_applicable: "Kirill's first client could be a pilot at $750 with guaranteed testimonial + case study rights. This is standard practice, not desperation.",
    confidence: "medium",
    extracted_rule: "For first 3 clients: pilot pricing ($750) is acceptable IF client agrees to: (1) written testimonial, (2) before/after metrics, (3) referral to 1-2 similar businesses. Frame as 'pilot pricing' not 'discount'.",
    target_component: "deal-assist.mjs (pricing strategy), portfolio_strategy",
    expected_metric_change: "faster first client closure, trust asset creation",
    review_window: "until 3 clients",
    risk: "medium — must not become permanent pricing",
    apply_mode: "semi_auto",
  },

  // SOURCE 16: r/sweatystartup — Best way to get first clients (remodel)
  {
    source: "r/sweatystartup — Best way to get first clients (remodel)",
    tier: "secondary",
    type: "referral_reality",
    pattern: "Word of mouth is #1. But one 20-year veteran with 5-star reviews says 'almost zero referrals ever' — gets jobs from website/Google. Real paper business cards beat digital for residential services. Thumbtack works initially but gets expensive ($30-60 per lead) and clients are cheap. Film walkthroughs of projects on cell phone for organic content.",
    evidence: "Multiple practitioners, BluffingTrips: '20 years, nothing but raving 5-star reviews, almost zero referrals'",
    anti_pattern: "Assuming referrals will happen automatically from good work. Some industries/services don't generate referral conversations naturally.",
    applicable_to_us: true,
    why_applicable: "Two insights: (1) Referrals aren't automatic — must be actively requested, (2) Google/website presence matters even for local service businesses. Our audit should check: does this business have Google reviews? Active website? These are signals of a business that invests in growth.",
    confidence: "high",
    extracted_rule: "Qualification signal: Google reviews count. 0 reviews = either new or doesn't care about growth. 10+ reviews = invests in reputation = more likely buyer. 50+ reviews = established, may already have systems = harder sell but bigger budget. Add google_review_count to lead scoring.",
    target_component: "researchBusiness(), money_score logic",
    expected_metric_change: "better lead quality filtering",
    review_window: "30 days",
    risk: "low",
    apply_mode: "auto",
  },
  {
    source: "r/sweatystartup — Best way to get first clients (remodel)",
    tier: "secondary",
    type: "thumbtack_reality",
    pattern: "Thumbtack: $30-60 per lead, low conversion rate, clients are price-shoppers. 'With those costs probably better to generate your own leads.' Multiple practitioners confirm: good to start, bad long-term.",
    evidence: "horegeno + benmarvin on Thumbtack costs and flaky clients",
    anti_pattern: "Targeting businesses that primarily use Thumbtack/HomeAdvisor for leads — they're already paying $30-60/lead and are price-sensitive.",
    applicable_to_us: true,
    why_applicable: "Business paying $30-60/lead on Thumbtack = perfect prospect. We can say: 'You're paying $40/lead on Thumbtack. 60% of those don't convert. What if the ones who got an estimate but didn't book got an automatic follow-up? That's free leads from work you already did.'",
    confidence: "high",
    extracted_rule: "Thumbtack/HomeAdvisor users = high-value leads for us. They understand cost-per-lead. Our pitch: 'You're paying $X per NEW lead. Following up on EXISTING estimates costs $0 per lead.' If research shows Thumbtack presence → increase lead priority +2.",
    target_component: "researchBusiness(), generate-audit.mjs, money_score logic",
    expected_metric_change: "stronger pitch to lead-buying businesses",
    review_window: "14 days",
    risk: "low",
    apply_mode: "build",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 2: OUTPUT A — BUYER DETECTION TABLE
// ══════════════════════════════════════════════════════════════════════════════

export const BUYER_DETECTION_TABLE = [
  // ── High-value buyer signals ──
  { signal: "Owner replies personally from named email", likely_means: "Decision-maker is engaged, has authority", classification: "buyer", next_action: "Send breakdown + qualifying question within 4h" },
  { signal: "Mentions specific pain: 'losing estimates', 'can't follow up'", likely_means: "Active operational problem, felt urgency", classification: "buyer", next_action: "Send pain-matched breakdown with ROI estimate" },
  { signal: "Asks 'what's the price'", likely_means: "Past curiosity, in evaluation mode, has budget conversation internally", classification: "buyer", next_action: "Send scope with pricing + pilot option. Queue 48h follow-up." },
  { signal: "Asks 'when can you start'", likely_means: "Decision made, ready to commit, budget available", classification: "buyer", next_action: "Send confirmation + invoice within 1 hour. Kirill verifies amount." },
  { signal: "References specific tool: 'we use Jobber but...'", likely_means: "Already invested in systems, understands automation value, looking for upgrade", classification: "buyer", next_action: "Position as optimization of existing tool. Higher budget likely." },
  { signal: "Has 10-50 Google reviews", likely_means: "Invests in growth, established enough to afford services, cares about reputation", classification: "buyer", next_action: "Reference their reviews in outreach. They understand customer experience." },
  { signal: "Seasonal business approaching peak (spring for landscaping, fall for HVAC)", likely_means: "About to get overwhelmed with estimates, urgency is real", classification: "buyer", next_action: "Time-sensitive pitch: 'Get this running before your busy season starts'" },
  { signal: "Business on Thumbtack/HomeAdvisor paying for leads", likely_means: "Already spending on lead gen, understands cost-per-lead, our ROI math clicks instantly", classification: "buyer", next_action: "Pitch: 'You pay $40/lead for new ones. Following up on unsold estimates = free leads.'" },

  // ── Browser / learner signals ──
  { signal: "'Tell me more' with no specifics", likely_means: "Mildly curious, no urgency, may be shopping for ideas", classification: "browser", next_action: "Send brief breakdown with qualifying question. If no reply in 7 days → deprioritize." },
  { signal: "Generic email (info@, contact@, office@)", likely_means: "Not the owner. Gatekeeper or admin. No authority.", classification: "no_authority", next_action: "Ask for redirect to owner. If no redirect in 5 days → skip." },
  { signal: "'Interesting, will think about it'", likely_means: "Polite no. No real intent. Classic brush-off.", classification: "browser", next_action: "One follow-up at 7 days. If silence → mark Lost." },
  { signal: "Asks for free advice / detailed how-to", likely_means: "Learner, wants knowledge not service, will DIY", classification: "learner", next_action: "Give one actionable tip (proves expertise). If they ask for more free help → disengage." },

  // ── Low-budget signals ──
  { signal: "'Can you do it cheaper?', 'any discounts?'", likely_means: "Price is primary concern. Budget constrained or commodity mindset.", classification: "low_budget", next_action: "Offer pilot option once. If they negotiate further → walk away." },
  { signal: "Fiverr/Upwork inquiry pattern", likely_means: "Shopping for lowest price. Will compare you to $50 freelancers.", classification: "low_budget", next_action: "Do not engage. Not our market." },
  { signal: "Solo operator, no employees, no website", likely_means: "Too small. $1,500 is a large % of revenue. High churn risk.", classification: "low_budget", next_action: "Skip. They need to grow first." },

  // ── Authority signals ──
  { signal: "Reply includes 'I need to check with...' or 'let me talk to my partner'", likely_means: "Not the decision-maker, or shared authority", classification: "no_authority", next_action: "Ask: 'Would it help if I sent a one-page summary they can review?' Get the actual DM involved." },
  { signal: "Uses 'we' language, mentions team decisions", likely_means: "Likely manager or employee, not sole owner", classification: "no_authority", next_action: "Qualify: 'Are you the one who decides on tools for the business?' If no → ask for intro to owner." },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3: OUTPUT B — QUALIFICATION STACK
// ══════════════════════════════════════════════════════════════════════════════

export const QUALIFICATION_STACK = {
  description: "Practical qualification layer for our outreach system. Each signal adds to or subtracts from money_score.",

  budget_signals: [
    { signal: "Business has employees (not solo)", score_impact: +2, detection: "Website 'our team' page, job listings, crew photos" },
    { signal: "Active Thumbtack/HomeAdvisor profile (paying for leads)", score_impact: +3, detection: "Research shows Thumbtack listing with reviews" },
    { signal: "Uses paid tools (Jobber, HCP, ServiceTitan)", score_impact: +3, detection: "Website footer, login page, tool badge" },
    { signal: "Solo operator, no visible team", score_impact: -2, detection: "Website shows only owner, no team page" },
    { signal: "Asks about discount before understanding scope", score_impact: -3, detection: "Reply mentions cheaper/discount/free before seeing price" },
    { signal: "Fiverr/Upwork buyer language", score_impact: -5, detection: "Mentions freelancer platforms, asks for hourly rate" },
  ],

  authority_signals: [
    { signal: "Owner email (firstname@ or owner's name@)", score_impact: +3, detection: "Email matches owner name from website" },
    { signal: "Reply from personal email of identified owner", score_impact: +4, detection: "Email header matches researched owner" },
    { signal: "Generic email (info@, contact@, office@)", score_impact: -2, detection: "Email prefix check" },
    { signal: "'I need to check with...'", score_impact: -2, detection: "Reply text pattern" },
    { signal: "Title is 'estimator', 'office manager', 'admin'", score_impact: -1, detection: "LinkedIn/website title check" },
  ],

  need_signals: [
    { signal: "Mentions specific pain: losing estimates, missed calls", score_impact: +4, detection: "Reply text pattern matching specific_pain" },
    { signal: "Describes current manual process that's failing", score_impact: +3, detection: "Reply mentions spreadsheets, sticky notes, forgetting" },
    { signal: "References tool frustration: 'Jobber doesn't do X'", score_impact: +3, detection: "Reply mentions tool limitation" },
    { signal: "General curiosity only: 'sounds interesting'", score_impact: +0, detection: "curiosity classification with no pain mentioned" },
    { signal: "Already has full automation: 'we use ServiceTitan + Field Pro'", score_impact: -3, detection: "They describe a working system" },
  ],

  timing_signals: [
    { signal: "Approaching busy season (spring for outdoor, fall for HVAC)", score_impact: +3, detection: "Calendar + business category" },
    { signal: "Just got busy: 'can't keep up with estimates'", score_impact: +4, detection: "Reply indicates volume spike" },
    { signal: "'Not right now', 'maybe later', 'next quarter'", score_impact: -2, detection: "objection_timing classification" },
    { signal: "Off-season with low volume", score_impact: -1, detection: "Calendar + category (e.g., landscaping in winter)" },
  ],

  urgency_signals: [
    { signal: "Asks about timeline: 'when can you start'", score_impact: +5, detection: "ready_to_start classification" },
    { signal: "Mentions deadline: 'before spring', 'this month'", score_impact: +4, detection: "Reply mentions specific timeframe" },
    { signal: "Replies within 1 hour of our email", score_impact: +2, detection: "Reply timestamp vs send timestamp" },
    { signal: "Takes 5+ days to reply", score_impact: -1, detection: "Reply delay" },
    { signal: "Second reply without prompting", score_impact: +3, detection: "Multiple replies in sequence" },
  ],

  tool_signals: [
    { signal: "Uses Jobber", score_impact: +2, detection: "Website/research", meaning: "Has budget for tools, understands workflow software" },
    { signal: "Uses Housecall Pro", score_impact: +2, detection: "Website/research", meaning: "Has pipeline concept, may need optimization" },
    { signal: "Uses ServiceTitan", score_impact: +1, detection: "Website/research", meaning: "Larger business, may be harder sell but bigger deal" },
    { signal: "No visible tools / spreadsheet mention", score_impact: +1, detection: "Research shows no tools", meaning: "Greenfield opportunity, easier sell" },
    { signal: "Uses enterprise ERP/CRM", score_impact: -3, detection: "Website/research", meaning: "Too large for us, wrong market" },
  ],

  local_growth_signals: [
    { signal: "Calgary-based (our primary market)", score_impact: +2, detection: "Address/phone area code" },
    { signal: "Hiring / job postings visible", score_impact: +3, detection: "Website careers page, Indeed listings" },
    { signal: "Recently expanded (new location, new service)", score_impact: +3, detection: "Website news, Google review volume increase" },
    { signal: "Stagnant (same reviews for 2+ years)", score_impact: -1, detection: "Google review dates" },
    { signal: "Multiple locations", score_impact: +2, detection: "Website/Google Maps", meaning: "Bigger deal potential" },
  ],

  // Score thresholds
  thresholds: {
    hot_lead: { min_score: 12, action: "Contact within 24h, personalized email, priority queue" },
    warm_lead: { min_score: 6, action: "Contact within 48h, standard researched email" },
    cool_lead: { min_score: 2, action: "Contact within 7 days, lighter touch" },
    skip: { min_score: -Infinity, max_score: 1, action: "Do not contact. Log reason. Move to next." },
  },
};


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 4: OUTPUT C — CLIENT HUNTING RULES
// ══════════════════════════════════════════════════════════════════════════════

export const CLIENT_HUNTING_RULES = {
  contact_first: [
    "Owner email found + tool signal detected (Jobber/HCP/ServiceTitan) + service business in target vertical",
    "Warm intro from network + any service business + Calgary",
    "Business with 10-50 Google reviews + active website + approaching busy season",
    "Business visibly growing: hiring, new location, increased review volume",
    "Thumbtack/HomeAdvisor user (paying for leads, understands cost-per-acquisition)",
  ],

  deprioritize: [
    "Generic email only (info@, contact@) — no owner email found",
    "Solo operator with no team, no website, no reviews",
    "Off-season business with no urgency signal",
    "Business that already has sophisticated automation (ServiceTitan + Field Pro)",
    "Business outside our target verticals (landscaping, HVAC, plumbing, roofing, cleaning, electrical, moving, auto repair)",
  ],

  skip_entirely: [
    "Enterprise/institution (EY, KPMG, hospitals, government, universities)",
    "Fiverr/Upwork/marketplace buyer language",
    "Generic/placeholder email (noreply@, test@, example@)",
    "Business with zero web presence AND no phone answer (likely defunct)",
    "Franchise corporate HQ (decisions made at national level, not local owner)",
    "Business that has explicitly said 'remove me' or 'not interested' in past",
  ],
};


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 5: OUTPUT D — ROUTE SELECTION TABLE
// ══════════════════════════════════════════════════════════════════════════════

export const ROUTE_SELECTION_TABLE = [
  {
    lead_type: "Owner with visible Jobber + open estimates pain",
    best_route: "cold_email_with_audit",
    backup_route: "audit_first_then_scope",
    what_not_to_do: "Don't pitch generic automation. Reference their specific tool and the estimate leak problem.",
    why: "They already understand tools. Speak to the gap in their current setup.",
  },
  {
    lead_type: "Manager with no authority",
    best_route: "ask_for_redirect_to_owner",
    backup_route: "send_one_pager_they_can_forward",
    what_not_to_do: "Don't invest time selling to them. Don't send scope. Don't discuss pricing.",
    why: "No authority = no deal. Get to the decision-maker or move on.",
  },
  {
    lead_type: "Warm intro but unclear pain",
    best_route: "discovery_call_or_email",
    backup_route: "send_audit_to_surface_pain",
    what_not_to_do: "Don't pitch immediately. Don't send pricing. Don't assume they have the problem we solve.",
    why: "Warm intro = trust advantage. Use it to qualify, not to sell prematurely.",
  },
  {
    lead_type: "Fiverr buyer with low budget",
    best_route: "not_worth_pursuing",
    backup_route: "none",
    what_not_to_do: "Don't engage. Don't offer discount. Don't explain why you're worth more.",
    why: "They will compare you to $50 freelancers. Any time spent here is wasted.",
  },
  {
    lead_type: "Reddit DM from learner",
    best_route: "give_one_free_tip_then_qualify",
    backup_route: "not_worth_pursuing",
    what_not_to_do: "Don't offer free consulting. Don't send scope. Don't assume they'll become a buyer.",
    why: "Learners want knowledge, not services. One tip builds reputation; ongoing help is charity.",
  },
  {
    lead_type: "Company with growth signal + owner email found",
    best_route: "cold_email_with_audit",
    backup_route: "warm_ask_if_any_network_connection_exists",
    what_not_to_do: "Don't use generic template. Research their growth and reference it specifically.",
    why: "Growth = pain. They're getting more work than their current process can handle.",
  },
  {
    lead_type: "Seasonal business approaching peak",
    best_route: "cold_email_with_timing_urgency",
    backup_route: "audit_first_with_seasonal_ROI",
    what_not_to_do: "Don't contact during off-season. Don't remove urgency from messaging.",
    why: "Timing creates natural urgency. 'Get this running before April' is real pressure.",
  },
  {
    lead_type: "Business using Thumbtack (paying $30-60/lead)",
    best_route: "cold_email_comparing_lead_cost",
    backup_route: "audit_showing_unsold_estimate_value",
    what_not_to_do: "Don't ignore their existing lead-gen spend. It's your strongest comparison point.",
    why: "They already spend money on leads. Our pitch = 'get more from leads you already paid for'.",
  },
  {
    lead_type: "Reply: 'tell me more'",
    best_route: "send_breakdown_with_qualifying_question",
    backup_route: "send_audit_if_data_available",
    what_not_to_do: "Don't send full scope yet. Don't treat as hot lead. Don't ignore — they replied.",
    why: "Curiosity ≠ buying intent. Qualify before investing more effort.",
  },
  {
    lead_type: "Reply: 'what's the price'",
    best_route: "send_scope_with_pilot_option",
    backup_route: "send_breakdown_first_if_no_prior_context",
    what_not_to_do: "Don't give a number without scope. Don't delay — pricing ask = active evaluation.",
    why: "Pricing question = they're comparing options. Fast, clear scope wins.",
  },
  {
    lead_type: "Reply: 'too expensive'",
    best_route: "offer_pilot_at_reduced_price_once",
    backup_route: "walk_away_gracefully",
    what_not_to_do: "Don't negotiate twice. Don't lower price without reducing scope. Don't chase.",
    why: "First price anchors all future deals. One concession (pilot) is acceptable. Two = commodity positioning.",
  },
  {
    lead_type: "Reply: 'not right now'",
    best_route: "acknowledge_and_schedule_follow_up_in_30_days",
    backup_route: "auto_breakup_email",
    what_not_to_do: "Don't push. Don't follow up weekly. Don't treat as lost — they may buy later.",
    why: "Timing objection is often honest. Respect it. One scheduled touchpoint is enough.",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 6: OUTPUT E — MONEY CAPTURE STAGES
// ══════════════════════════════════════════════════════════════════════════════

export const MONEY_CAPTURE_STAGES = [
  {
    stage: "stranger",
    definition: "Business identified, not yet contacted",
    real_progress: "Research completed, lead scored, owner email verified",
    false_progress: "Added to list without research. 'We have 500 leads!' means nothing if unscored.",
    next_action: "Score → if score >= 6, move to 'contacted'. If score < 2, skip.",
    system_boundary: "auto",
  },
  {
    stage: "contacted",
    definition: "Email sent, no reply yet",
    real_progress: "Email delivered (no bounce), personalized content, correct recipient",
    false_progress: "Email sent to generic/bounced address. High volume of sends with no replies.",
    next_action: "Wait 3 days → first follow-up. Wait 7 days → second. Wait 14 → breakup.",
    system_boundary: "auto",
  },
  {
    stage: "interested",
    definition: "Replied with curiosity or positive signal",
    real_progress: "Actual reply with engagement (question, comment, request for info)",
    false_progress: "Auto-reply (OOO). 'Thanks' with no follow-up question. Read receipt only.",
    next_action: "Send breakdown with qualifying question. Classify intent.",
    system_boundary: "semi_auto",
  },
  {
    stage: "qualified",
    definition: "BANT signals confirmed: budget plausible, authority confirmed, need stated, timing active",
    real_progress: "They answered qualifying question with specifics. Owner confirmed. Pain described.",
    false_progress: "'Sounds interesting, send more info' — no specifics given. Still browsing.",
    next_action: "Send scope with pricing. Queue 48h follow-up.",
    system_boundary: "semi_auto",
  },
  {
    stage: "pricing_active",
    definition: "Scope sent, pricing visible, prospect evaluating",
    real_progress: "They asked a question about the scope. They mentioned discussing with partner. They asked about timeline.",
    false_progress: "Silence after scope sent. Opened email but no reply (vanity metric).",
    next_action: "48h follow-up: 'Any questions about the scope?' Day 7 breakup if silence.",
    system_boundary: "semi_auto",
  },
  {
    stage: "scope_active",
    definition: "Negotiating scope, discussing options, pilot vs full",
    real_progress: "Back-and-forth on specifics: which features, which timeline, pilot option interest",
    false_progress: "Endless questions with no commitment signal. 'What else can you add for the same price?'",
    next_action: "Answer questions. If 3+ exchanges without commitment → ask directly: 'Should we move forward or is the timing not right?'",
    system_boundary: "semi_auto",
  },
  {
    stage: "commitment",
    definition: "Verbal yes, awaiting invoice/payment",
    real_progress: "They said 'let's do it', 'send the invoice', 'ready to start'. Explicit commitment.",
    false_progress: "'Sounds great' without action. 'I'll get back to you' (= not committed).",
    next_action: "Send confirmation + invoice within 1 hour. Kirill inserts Wave link. Verify amount.",
    system_boundary: "semi_auto — Kirill verifies invoice amount + scope match",
  },
  {
    stage: "paid",
    definition: "Invoice paid (at least 50% deposit)",
    real_progress: "Money in account. Payment confirmed.",
    false_progress: "'I'll pay tomorrow' (not paid). Invoice sent but not paid for 5+ days.",
    next_action: "Confirm receipt. Schedule kickoff. Start build on next Monday.",
    system_boundary: "semi_auto — Kirill confirms payment received",
  },
  {
    stage: "lost",
    definition: "Deal dead. Prospect disengaged, disqualified, or declined.",
    real_progress: "Clear signal: 'not interested', 'went with someone else', silence after breakup email",
    false_progress: "Marking as lost after one follow-up. Giving up too early on qualified leads.",
    next_action: "Log loss_reason. If qualified but timing wrong → schedule 30-day re-approach. If bad fit → never contact again.",
    system_boundary: "auto — log and archive",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 7: OUTPUT F — DISQUALIFICATION RULES
// ══════════════════════════════════════════════════════════════════════════════

export const DISQUALIFICATION_RULES = [
  {
    trigger: "low_budget_marketplace_buyer",
    signals: ["Mentions Fiverr/Upwork", "Asks for hourly rate", "Compares to $50 freelancers", "First question is 'can you do it cheaper'"],
    action: "Do not engage. Not our market.",
    why: "Marketplace buyers optimize for lowest price. Our $1,500 minimum = automatic rejection in their frame. Time spent = pure waste.",
    exception: "None.",
  },
  {
    trigger: "wrong_contact_person",
    signals: ["Generic email (info@, contact@)", "Title: estimator, admin, receptionist", "'I don't handle this'", "'You should talk to...'"],
    action: "One redirect ask. If no redirect in 5 days → skip.",
    why: "Non-decision-makers can't buy. Max one attempt to get to owner.",
    exception: "If they proactively offer to forward and follow through → keep alive.",
  },
  {
    trigger: "no_urgency",
    signals: ["'Not right now'", "'Maybe next quarter'", "'We're in our slow season'", "Reply takes 10+ days"],
    action: "Acknowledge, schedule 30-day re-approach, remove from active pipeline.",
    why: "No urgency = no close. Following up weekly burns goodwill. One touchpoint at appropriate time.",
    exception: "If they specify a date ('call me in March') → schedule exactly that date.",
  },
  {
    trigger: "curiosity_with_no_movement",
    signals: ["'Tell me more' → sent breakdown → no reply for 7 days", "Multiple questions but never answers qualifying questions", "Reads emails (opens) but never replies"],
    action: "One breakup email. If no reply → mark Lost. Do not re-engage.",
    why: "Curiosity without action = browsing. After breakdown + 7 days silence, probability of close approaches zero.",
    exception: "If they come back later with specific pain → re-engage from scratch.",
  },
  {
    trigger: "weak_fit",
    signals: ["Solo operator with no employees", "Revenue likely under $200K/year", "No website, no Google reviews, no visible business presence", "Industry we don't serve (retail, restaurant, salon)"],
    action: "Skip. Do not contact.",
    why: "$1,500 is too large a % of their revenue. High payment risk. No referral value. Wrong industry = wrong product-market fit.",
    exception: "If they approach us (inbound), give one free tip. Don't pursue.",
  },
  {
    trigger: "commodity_buyer",
    signals: ["'Can you match [competitor] price?'", "'I found someone for $500'", "Negotiates before understanding scope", "Asks for itemized hourly breakdown"],
    action: "State our price once. If they negotiate again → walk away.",
    why: "Commodity buyers anchor to lowest price. First deal at discount = all future deals at discount. This is pricing precedent damage.",
    exception: "Pilot option ($750) offered ONCE, with scope reduction, not as negotiation concession.",
  },
  {
    trigger: "tire_kicker",
    signals: ["Multiple 'tell me more' cycles with no progression", "Asks same questions repeatedly", "Requests free demo/sample/prototype before any commitment", "Wants comprehensive proposal before confirming budget"],
    action: "After 3 exchanges with no qualification progress → disengage. 'It sounds like the timing might not be right. Happy to reconnect when you're ready.'",
    why: "Tire kickers consume disproportionate time. 80% of wasted effort comes from 20% of non-buyers who seem interested.",
    exception: "None. If they're real, they'll come back with urgency.",
  },
  {
    trigger: "permanently_low_value",
    signals: ["Hobbyist side-business", "Seasonal-only with 3-month operation", "Family-run with no growth intent", "Explicitly says 'we're happy staying small'"],
    action: "Do not contact. Not our ICP.",
    why: "No growth intent = no need for automation. They'll manage manually forever. Our service requires a business with enough volume to justify it.",
    exception: "None.",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 8: OUTPUT G — PRACTITIONER REALITY RULES
// ══════════════════════════════════════════════════════════════════════════════

export const PRACTITIONER_REALITY_RULES = {
  how_first_clients_actually_appear: [
    "Friends and family — almost always the first 1-3 clients for any service business",
    "Facebook friends/groups — a friend posts looking for service, you respond in DM",
    "Craigslist $5 ads — still works for local services, especially cleaning and handyman",
    "Nextdoor app — hyperlocal, neighbors recommending to neighbors",
    "Door knockers/flyers — physical distribution, 5,000 door hangers = $15K/month in 6-7 months (cleaning)",
    "Word of mouth — BUT not automatic. 20-year veteran with 5-star reviews reports 'almost zero referrals'",
    "Google My Business — reviews from early clients build organic discovery",
    "Thumbtack/HomeAdvisor — expensive ($30-60/lead) but works as starter channel",
    "Yard signs at job sites — free advertising while you work",
    "Business cards on bulletin boards — hardware stores, grocery stores, laundromats",
  ],

  ugly_but_real_channels: [
    "Door-to-door flyer distribution (0 to $15K/month proven)",
    "Craigslist $5 ads (still generates cleaning/handyman leads)",
    "Asking every friend and family member directly (uncomfortable but #1 source)",
    "50% discount for first client in exchange for testimonial (standard practice)",
    "Calling local businesses from Yellow Pages / Google Maps (our current approach)",
    "Showing up at local events without a booth (SaaStr: 'just hustle')",
  ],

  what_founders_do_before_trust_exists: [
    "Give steep discounts (50%) for first clients to get testimonials and portfolio",
    "Do a few cheap/free jobs for people you know — they spread the word",
    "Film walkthroughs of projects on cell phone for organic social proof",
    "Leverage any personal connection, however weak",
    "Use platforms that provide trust infrastructure (Thumbtack, Nextdoor) until you build your own",
    "Focus on Google reviews from day one — even 3-5 reviews changes perception",
    "Honest positioning: 'I'm building my client base. Here's what I guarantee.'",
  ],

  local_low_friction_routes: [
    "Nextdoor (hyperlocal, neighbors trust neighbors)",
    "Google My Business (free, builds compounding visibility)",
    "Local Facebook groups (community-based, low-cost posting)",
    "Physical flyers in target neighborhoods (proven at scale for cleaning)",
    "Business cards at hardware stores (zero cost, targeted foot traffic)",
    "Referral from first client (must be ASKED, not expected)",
  ],
};


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 9: OUTPUT H — WHAT SHOULD CHANGE IN OUR SYSTEM NOW
// ══════════════════════════════════════════════════════════════════════════════

export const SYSTEM_CHANGES = {
  lead_scoring_changes: [
    { field: "owner_email_found", weight: +3, status: "ADD", reason: "Owner email = decision-maker reachable. Biggest single predictor of reply quality." },
    { field: "tool_signal_detected", weight: +2, status: "ADD", reason: "Jobber/HCP/ServiceTitan = budget for tools, understands automation." },
    { field: "google_review_count", weight: "+1 to +3 scaled", status: "ADD", reason: "0 reviews = maybe skip. 10-50 = sweet spot. 50+ = established but harder sell." },
    { field: "thumbtack_presence", weight: +2, status: "ADD", reason: "Already paying for leads. Our ROI pitch clicks instantly." },
    { field: "seasonal_timing_match", weight: +2, status: "ADD", reason: "Approaching busy season = real urgency." },
    { field: "growth_signal", weight: +3, status: "ADD", reason: "Hiring/expanding = more estimates than they can handle." },
    { field: "generic_email_penalty", weight: -2, status: "ADD", reason: "info@/contact@ = gatekeeper, not buyer." },
    { field: "solo_operator_penalty", weight: -2, status: "ADD", reason: "Too small for our price point." },
  ],

  paths_to_favor: [
    "Warm intros from any source → 3x priority over cold email",
    "Calgary businesses with owner email + tool signal → top of queue",
    "Businesses approaching busy season → time-sensitive outreach",
    "Pricing-ask replies → scope within same day (fastest path to money)",
    "Thumbtack users → specific cost-comparison pitch",
  ],

  instant_priority_increase: [
    "Reply received (any positive reply from any lead = immediate attention)",
    "Owner confirmed as responder (not admin/employee)",
    "Specific pain described in reply (not generic curiosity)",
    "Pricing question asked (= active evaluation mode)",
    "Second reply without prompting (= genuine interest, not politeness)",
    "Timeline mentioned ('before spring', 'this month', 'ASAP')",
  ],

  instant_disqualification: [
    "Fiverr/Upwork/marketplace buyer language → skip immediately",
    "Enterprise/institution domain → skip immediately",
    "Generic email + no owner name findable → deprioritize to bottom",
    "Explicit 'not interested' or 'remove me' → remove, never contact",
    "Solo hobbyist with no web presence → skip",
    "Reply asking for free work/consulting → one tip, then disengage",
  ],
};


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 10: "WHO IS WORTH CHASING?" TABLE
// ══════════════════════════════════════════════════════════════════════════════

export const WHO_IS_WORTH_CHASING = [
  {
    lead_type: "Owner with direct email + tool signal (Jobber/HCP)",
    why_matters: "Decision-maker reachable + understands automation + has budget for tools",
    first_move: "Cold email with personalized audit referencing their tool",
    second_move: "Follow-up at day 3 with specific ROI estimate",
    verdict: "CONTINUE — highest conversion probability",
  },
  {
    lead_type: "Office manager",
    why_matters: "Cannot make purchasing decisions. Will forward if motivated, but usually won't.",
    first_move: "Ask: 'Who handles the tools/software decisions?'",
    second_move: "If no redirect in 5 days → skip",
    verdict: "PAUSE — one redirect attempt, then kill",
  },
  {
    lead_type: "Estimator",
    why_matters: "Feels the pain daily but has zero authority. Could be internal champion if owner is accessible.",
    first_move: "Ask for owner intro: 'Would the owner be open to a quick look at this?'",
    second_move: "Send one-pager they can forward",
    verdict: "PAUSE — useful as intro path only. Don't sell to them.",
  },
  {
    lead_type: "Growth-stage service business (hiring, expanding)",
    why_matters: "More work than process can handle. Pain is acute and growing. Budget exists from revenue growth.",
    first_move: "Cold email referencing their growth: 'Congrats on the expansion — who's following up on all those new estimates?'",
    second_move: "Audit with volume-based ROI calculation",
    verdict: "CONTINUE — second-highest priority after owner+tool",
  },
  {
    lead_type: "Seasonal service business (landscaping spring, HVAC fall)",
    why_matters: "Natural urgency window. Before season = setup time. During season = too busy. After season = too late.",
    first_move: "Time-sensitive cold email: 'Get this running before your phones start ringing'",
    second_move: "Follow-up with seasonal ROI: 'Last spring you probably had X estimates. How many got a follow-up?'",
    verdict: "CONTINUE — but only during 4-8 week window before their busy season",
  },
  {
    lead_type: "Warm intro lead (any service business)",
    why_matters: "Trust already exists through connection. Skips cold-to-warm barrier entirely. 84% of B2B starts with referral.",
    first_move: "Personal email referencing the intro: 'Mike mentioned you might...'",
    second_move: "Discovery question about their current estimate follow-up process",
    verdict: "CONTINUE — highest priority regardless of other signals",
  },
  {
    lead_type: "Fiverr buyer",
    why_matters: "DOESN'T matter. They optimize for cheapest price. Will compare you to $50 freelancers. Will waste 3 hours negotiating to save $100.",
    first_move: "Do not engage",
    second_move: "N/A",
    verdict: "KILL — immediately. Zero exceptions.",
  },
  {
    lead_type: "Reddit learner",
    why_matters: "Wants knowledge, not service. Asking 'how to build this myself' = they won't pay someone else.",
    first_move: "One free tip that demonstrates expertise",
    second_move: "If they ask for more free help → 'Happy to help as a paid project. Here's what that looks like.'",
    verdict: "KILL — unless they explicitly ask about hiring someone. Then CONTINUE.",
  },
  {
    lead_type: "Price shopper ('can you do it cheaper?')",
    why_matters: "Price is their only criterion. First deal at discount = permanent pricing anchor. Will shop again next time.",
    first_move: "State price. Offer pilot once ($750 with reduced scope).",
    second_move: "If they negotiate further → 'Sounds like the timing/fit might not be right. No worries.'",
    verdict: "PAUSE — one pilot offer. If rejected → KILL.",
  },
  {
    lead_type: "'Tell me more' responder",
    why_matters: "Mild curiosity. May become buyer or may be browsing. Unknown until qualified.",
    first_move: "Send breakdown with ONE qualifying question: 'What tool do you use for estimates now?'",
    second_move: "If they answer with specifics → CONTINUE to scope. If silence 7 days → breakup email → KILL.",
    verdict: "CONTINUE conditionally — qualify within 7 days or kill.",
  },
  {
    lead_type: "'What's the price?' responder",
    why_matters: "HIGH value signal. They're evaluating. They have budget conversation happening internally or are ready to decide.",
    first_move: "Send scope with pricing + pilot option within same day",
    second_move: "48h follow-up: 'Any questions about the scope?'",
    verdict: "CONTINUE — fast response critical. Every hour of delay reduces close probability.",
  },
  {
    lead_type: "'Not right now' responder",
    why_matters: "Not dead, just not now. Honest timing objection. May convert in 30-90 days.",
    first_move: "Acknowledge: 'Totally understand. Mind if I check back in a month?'",
    second_move: "One scheduled follow-up at 30 days. If still no → remove from active pipeline.",
    verdict: "PAUSE — one 30-day follow-up. If still no → KILL.",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 11: PRACTICAL SUMMARY
// ══════════════════════════════════════════════════════════════════════════════

export const PRACTICAL_SUMMARY = {

  top_5_buyer_selection_rules: [
    "1. OWNER EMAIL + TOOL SIGNAL = TOP PRIORITY. If you can reach the decision-maker AND they already use workflow tools, they understand automation value AND can pay. Contact these first, always.",
    "2. WARM INTROS BEAT COLD EMAIL 10:1. Any lead from a personal connection gets 3x priority score. 84% of B2B starts with a referral. Network contacts → warm asks → cold email. Never reverse this order.",
    "3. PRICING QUESTION = FASTEST PATH TO MONEY. When someone asks 'what's the price', they're evaluating RIGHT NOW. Respond within hours, not days. Every day of delay cuts close probability in half.",
    "4. SEASONAL TIMING CREATES REAL URGENCY. Landscaping before spring, HVAC before fall. Contact 4-8 weeks before their peak season. The urgency is built-in and genuine — you don't have to create it.",
    "5. GROWTH SIGNALS = PAIN SIGNALS. A business that's hiring, expanding, or increasing review volume is getting more work than their current process handles. They FEEL the estimate leak problem.",
  ],

  top_5_disqualification_rules: [
    "1. MARKETPLACE BUYERS (FIVERR/UPWORK) = INSTANT KILL. They will compare you to $50 freelancers. No amount of explanation changes their price frame. Walk away before wasting a single minute.",
    "2. CURIOSITY + 7 DAYS SILENCE = DEAD. If they said 'tell me more' and you sent a breakdown but heard nothing for 7 days, they're not buying. One breakup email, then remove from active pipeline.",
    "3. GENERIC EMAIL + NO OWNER FINDABLE = BOTTOM OF QUEUE. info@, contact@, office@ means you're talking to a gatekeeper. One redirect attempt. If no owner surfaces in 5 days → skip.",
    "4. NEGOTIATES BEFORE UNDERSTANDING SCOPE = COMMODITY BUYER. If their first response to pricing is 'can you do it cheaper' without asking a single question about what's included, they'll never pay your price. Pilot offer once. If rejected → walk away.",
    "5. 3+ EXCHANGES WITH NO QUALIFICATION PROGRESS = TIRE KICKER. If they keep asking questions but never answer yours, never confirm budget, never reveal authority — they're consuming your time for free. Disengage with 'timing might not be right' and move on.",
  ],

  one_main_insight: "THE SYSTEM'S JOB IS NOT TO CONTACT MORE PEOPLE — IT'S TO CONTACT THE RIGHT PEOPLE FASTER AND STOP CHASING THE WRONG ONES SOONER. Every hour spent on a Fiverr buyer, a generic-email gatekeeper, or a silent curiosity-seeker is an hour NOT spent on the owner with a Jobber account who asked 'what's the price?' Lead volume is vanity. Qualified lead response speed is the only metric that correlates with money.",
};
