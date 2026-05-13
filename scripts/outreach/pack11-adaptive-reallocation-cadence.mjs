/**
 * Pack 11 — Adaptive Surface Reallocation & Multi-Day Hunt Cadence
 *
 * The final capability: how the system lives across real days where surfaces
 * give mixed signals, replies arrive with delay, hot leads interrupt discovery,
 * and attention must be reallocated without chaos.
 *
 * Sources: Packs 5-10 (synthesis), Stress Tests 1-5 (applied patterns),
 * all doctrine layers (build, deal-assist, zero-to-trust, scoring, learning).
 */

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 1: STRUCTURED RULES
// ══════════════════════════════════════════════════════════════════════════════

export const PACK11_EXTRACTED_RULES = [

  {
    source: "Pack 10 Portfolio + Pack 6 Daily Loop + FST5 Day Plan (synthesis)",
    tier: "primary",
    type: "reply_driven_reallocation",
    pattern: "The plan you make at 8 AM is never the plan you execute at noon. Replies change everything. A Day 1 discovery plan becomes a Day 1 deal-handling day the moment a review-based lead replies with pain described. FST5 reserved Kirill Review #3 for exactly this — 'if reply arrives, everything stops.' The system must have pre-defined interrupt rules, not ad-hoc reactions.",
    evidence: "FST5: 'Replies always interrupt discovery.' Pack 6 daily loop: reply check is Step 1 before all outreach. ST1-4: every test started with triage of unexpected simultaneous signals.",
    anti_pattern: "Finishing today's discovery batch before checking inbox. Treating all replies as equal urgency. Letting a pricing question sit for 4 hours because you're 'in the flow' of LinkedIn research. Alternatively: dropping everything for a Reddit learner DM.",
    applicable_to_us: true,
    why_applicable: "Kirill has 2-4 hours/day. A warm intro reply at 10 AM is worth more than the remaining 8 LinkedIn connection requests. But a Fiverr counter-offer at 10 AM is NOT worth interrupting those 8 requests. The system must know the difference instantly.",
    confidence: "high",
    extracted_rule: "REPLY INTERRUPT PROTOCOL: Check inbox every 45 min during work window. When reply arrives, classify IMMEDIATELY: (A) Tier 1 interrupt (owner with pain/pricing/demo request from warm or review-based lead) → stop current task, respond within 60 min, then resume. (B) Tier 2 scheduled (champion request, cold qualifier response, LinkedIn DM) → respond within 4h, don't interrupt current batch. (C) Tier 3 queue (marketplace counter, Reddit learner, follow-up reminder) → batch at end of work window. Classification takes 30 seconds. The 30-second classification prevents 30-minute wrong-priority detours.",
    target_component: "daily operating loop, SLA logic, reply interrupt rules",
    expected_metric_change: "hot leads responded to within 60 min, no discovery time lost to low-priority replies",
    review_window: "after 20 reply events",
    risk: "low — 45-min inbox checks are minimal overhead",
    apply_mode: "build",
  },
  {
    source: "Pack 10 Discovery Rotation + Pack 6 Weekly Loop + FST5 Learning Logic (synthesis)",
    tier: "primary",
    type: "surface_performance_measurement",
    pattern: "FST5 Learning #3: '0 replies from 8 sends on DAY ONE is not a failure. Cold email reply rates are measured across the full follow-up sequence (4 touches over 14 days), not from one send.' But also Pack 4C: 'min_test_size 30 for sender/copy, 50 for channel.' The system must NOT overreact to one day's data AND must NOT ignore a surface that's consistently dead after 30+ sends.",
    evidence: "Pack 4C: 30-send minimum before copy conclusions. 50-attempt minimum before channel conclusions. FST5: correctly predicted 0 same-day replies as normal.",
    anti_pattern: "Concluding a surface is dead after 6 sends and 0 replies (1 day). Continuing to invest in a surface after 50 sends and 0 replies (3 weeks). Never measuring surface performance at all. Measuring by 'leads found' instead of 'replies received.'",
    applicable_to_us: true,
    why_applicable: "We need clear thresholds: at what point does silence become signal? 6 sends = too early. 30 sends = minimal viable data. 50 sends = conclusive. These numbers prevent both panic-pivoting and zombie-surface persistence.",
    confidence: "high",
    extracted_rule: "SURFACE EVALUATION THRESHOLDS: (A) 0-15 sends: NO conclusions. Normal variance. Continue. (B) 15-30 sends: EARLY SIGNAL. 0 replies = amber. 1+ reply = green. Amber = examine copy/targeting but don't cut surface. (C) 30-50 sends: VIABLE DATA. 0 replies = surface or copy is broken. Test: change copy with same surface. If still 0 → cut surface. 1-2% reply rate = normal cold. 3%+ = good, increase allocation. (D) 50+ sends: CONCLUSIVE. 0 meaningful replies = kill surface. 2%+ = scale. Track per surface, not aggregate.",
    target_component: "surface scoring, portfolio strategy, weekly review",
    expected_metric_change: "surfaces get fair test before being cut, dead surfaces get cut before wasting 100+ sends",
    review_window: "at each threshold (15, 30, 50 sends)",
    risk: "low",
    apply_mode: "auto",
  },
  {
    source: "All Stress Tests + Pack 10 Allocation Model (meta-synthesis)",
    tier: "primary",
    type: "pipeline_compounding_discipline",
    pattern: "Day 1: 15 sends → Day 2-4: replies trickle in → Day 3-5: qualified leads need artifacts/scope → Day 5-7: deals in pricing stage need Kirill attention. This creates a WAVE: discovery → qualification → conversion. The wave must be continuous, not batch. If you stop discovery on Day 3 because Day 1 sends produced replies, pipeline dries up by Day 10. If you keep discovering on Day 5 but ignore Day 1 replies, qualified leads go cold.",
    evidence: "FST5: 'Pipeline starvation kills faster than bad deal handling.' Pack 6: '50% discovery, 50% conversion — every day.' Pack 10: 'Never 0% discovery.'",
    anti_pattern: "Feast/famine cycle: send 100 emails → stop → handle replies → replies dry up → panic send 100 more. Or: discovery every day but never following up. Or: following up every day but never discovering new leads.",
    applicable_to_us: true,
    why_applicable: "System must maintain BOTH streams simultaneously. Today's discovery creates Friday's replies. Today's replies from Monday's discovery create today's deals. Both streams must flow every day.",
    confidence: "high",
    extracted_rule: "PIPELINE FLOW RULE: Every workday must include BOTH discovery sends AND reply/deal handling. Minimum: 5 new touches + all pending reply responses. When active deals demand more time → discovery drops to 5 new touches (floor, never zero). When pipeline is empty → discovery rises to 15 new touches (ceiling per FST5). The 5-touch floor is NON-NEGOTIABLE even on the busiest deal day. It takes 3 minutes per template touch = 15 minutes to maintain pipeline flow.",
    target_component: "daily operating loop, time allocation",
    expected_metric_change: "continuous pipeline flow, no feast/famine cycles",
    review_window: "weekly",
    risk: "low — 15 min/day minimum discovery is minimal overhead",
    apply_mode: "build",
  },
  {
    source: "Pack 8 Ambiguity + Pack 9 False Signals + ST4 Learning (synthesis)",
    tier: "primary",
    type: "hot_lead_interruption_rules",
    pattern: "ST1: warm landscaping reply was correctly prioritized over all other work. ST4: electrical owner 5 messages = correctly prioritized over 6 other signals. BUT: ST4 also correctly continued roofing/garage door in parallel. Hot leads steal FOCUS, not all time. A hot lead that needs a demo takes 45 min of build + 15 min Kirill review. The remaining hour of the work window still goes to other paths.",
    evidence: "ST1-4: top path got 60-70% of attention, not 100%. FST5: 15 touches distributed across surfaces, not all to one.",
    anti_pattern: "Dropping everything for one hot lead and ignoring all others. Treating a hot lead as if it's already closed (it's not — it's just the closest to cash). Spending 3 hours on one demo while 5 other leads get zero attention.",
    applicable_to_us: true,
    why_applicable: "When a warm intro lead replies with 'what would this cost?' — that's a Tier 1 interrupt. But the response takes 10 minutes (scope email). After that: back to discovery. The demo, if needed, takes 30-45 min. After that: back to discovery. Hot leads get FAST response + allocated build time, not all-day monopoly on attention.",
    confidence: "high",
    extracted_rule: "HOT LEAD TIME ALLOCATION: Tier 1 reply → 60-min response SLA → allocated build time if artifact needed (max 45 min) → return to day plan. A hot lead gets: immediate response + one artifact + one Kirill review. It does NOT get: 3 hours of research, a custom multi-page proposal, Kirill's entire day, or cancellation of all other outreach. Max hot-lead time per day: 90 min (response + artifact + review). Remaining time: discovery + other path maintenance.",
    target_component: "daily operating loop, interruption protocol, artifact queue",
    expected_metric_change: "hot leads served fast without starving pipeline",
    review_window: "after 5 hot-lead events",
    risk: "medium — under-investing in a real deal to maintain schedule. Mitigate: if deal reaches commitment stage (invoice ready), give it ALL remaining time. Commitment > discovery.",
    apply_mode: "build",
  },
  {
    source: "Pack 7 Learning Loop + Pack 9 Misleading Signal Learning + FST5 Learning Logic (synthesis)",
    tier: "primary",
    type: "day_to_day_adaptation",
    pattern: "FST5 correctly noted: 'evaluate after 30 sends per surface, not 6. Today is day 1 of a 14-day test.' But WITHIN the 14-day test, micro-adaptations happen: Day 2 reply from a review-based lead → slightly increase review-based allocation tomorrow. Day 3: 0 LinkedIn accepts → don't cut LinkedIn, but try different connection-note approach on Day 4. Small adjustments, not pivots. Pivots happen at 30-send threshold. Adjustments happen daily.",
    evidence: "Pack 4C: change ONE variable per test. Pack 7: 1=anecdote, 3=pattern, 5=rule. FST5: 'don't conclude surface is bad from one day.'",
    anti_pattern: "Pivoting strategy after one bad day. Keeping exact same approach after a week of zero signal. Changing two variables at once (different surface + different copy). Never adjusting anything ('stick to the plan no matter what').",
    applicable_to_us: true,
    why_applicable: "System needs TWO speeds of adaptation: (1) MICRO (daily): small allocation shifts based on yesterday's signals. More touches to surface that produced a reply. Different angle on surface that got opens but no replies. (2) MACRO (at 30/50-send thresholds): surface-level decisions to scale, reduce, or kill.",
    confidence: "high",
    extracted_rule: "TWO-SPEED ADAPTATION: DAILY micro-adjustments: if surface X produced a reply yesterday, add 2 more touches to X today. If surface Y got 5 opens, 0 replies, try a different subject line on Y tomorrow (one variable change). If surface Z got 0 opens, check deliverability before concluding anything. THRESHOLD macro-decisions: at 30 sends evaluate reply rate. At 50 sends make scale/cut decision. These are different processes. Daily adjustments don't wait for thresholds. Threshold decisions don't happen on single-day data.",
    target_component: "daily planning logic, tomorrow-planning rules, surface scoring",
    expected_metric_change: "faster convergence on productive surfaces without premature cutting",
    review_window: "daily (micro), at thresholds (macro)",
    risk: "low",
    apply_mode: "auto",
  },
  {
    source: "Pack 10 Tier System + Pack 6 Scarcity Priority + All STs (synthesis)",
    tier: "primary",
    type: "tier_promotion_demotion",
    pattern: "Across ST1-4, leads moved between tiers based on new signals: plumbing 'not sure worth changing' → killed from Tier 3. Garage door ops manager → promoted from Tier 3 to Tier 2 when owner engaged. Warm intro → started Tier 2, promoted to Tier 1 when owner asked about pricing. The portfolio is ALIVE — it changes daily based on new signals. But changes must follow rules, not gut.",
    evidence: "Pack 10: 'If Tier 1 path stalls for 7+ days → demote to Tier 2.' 'If Tier 3 lead replies with strong signal → promote to Tier 2 immediately.'",
    anti_pattern: "Static tier assignments that never change. Promoting based on hope ('maybe they'll reply tomorrow'). Not demoting stalled Tier 1 leads (emotional attachment). Promoting every positive signal to Tier 1 (capacity overflow).",
    applicable_to_us: true,
    why_applicable: "Max 2 Tier 1 slots. When both are full and a third strong lead appears → one must be demoted. When both are empty → the two strongest Tier 2 leads promote. The system must do this daily, not weekly.",
    confidence: "high",
    extracted_rule: "DAILY TIER REVIEW (5 min, during morning inbox check): (1) Any Tier 1 path gone silent for 48h+ since last exchange? → Demote to Tier 2. Free the slot. (2) Any Tier 2/3 lead that replied with strong signal (pain + pricing + authority)? → Promote to Tier 1 if slot available. (3) Any Tier 2 champion path past 10-day signer deadline? → Demote to Tier 4 or kill. (4) Any Tier 3 lead that answered qualifier with owner + pain? → Promote to Tier 2. (5) Are 2 Tier 1 slots filled? If not → promote highest Tier 2. Pipeline must always have 2 active paths getting deep attention.",
    target_component: "portfolio ranking, daily planning logic",
    expected_metric_change: "top 2 paths always reflect current reality, not yesterday's",
    review_window: "daily",
    risk: "medium — demoting a lead that was about to reply. Mitigate: demote doesn't mean kill. Tier 2 still gets 4h SLA.",
    apply_mode: "build",
  },
  {
    source: "FST5 Day Plan + Pack 6 Operating Posture + Pack 10 Allocation (synthesis)",
    tier: "primary",
    type: "next_batch_preparation",
    pattern: "FST5 warned: 'Treat today's 15 sends as enough and don't send any more this week = pipeline starvation in 7 days.' The LAST 15 min of every work session must prepare TOMORROW's batch: research 5-10 leads, queue them for morning send, note which surfaces to scan. This prevents the morning from starting cold — wasting 30+ min on 'what do I do today?'",
    evidence: "FST5: 'Tomorrow's first action: research and queue next 15.' Pack 6 daily loop step 7: prepare Kirill brief for next day.",
    anti_pattern: "Ending the work day with 'I'll figure out tomorrow morning.' Starting each day from zero — researching, finding, qualifying before sending anything. Result: first touch doesn't go out until 10 AM.",
    applicable_to_us: true,
    why_applicable: "If Kirill's work window is 8-11 AM Calgary, the first touch should go out at 8:05 AM, not 9:30 AM after an hour of research. This requires YESTERDAY's last 15 min to prep TODAY's batch.",
    confidence: "high",
    extracted_rule: "END-OF-DAY PREP (last 15 min of every work session): (1) Research 5-10 leads for tomorrow. (2) Draft or queue emails for morning send. (3) Note which 2 surfaces to scan tomorrow (rotate from Pack 10 top 6). (4) Review tier assignments — any promotions/demotions needed? (5) Check follow-up queue — any auto follow-ups going out tomorrow? Result: tomorrow starts with SENDING, not RESEARCHING. First touch at 8:05 AM.",
    target_component: "daily operating loop (new: end-of-day prep step)",
    expected_metric_change: "30+ min saved each morning, first touches go out 60-90 min earlier",
    review_window: "after 5 workdays using this protocol",
    risk: "low — 15 min prep prevents 45 min morning scramble",
    apply_mode: "build",
  },
  {
    source: "Pack 3B Delivery + Pack 7 Win/Loss + All STs Deal Handling (synthesis)",
    tier: "primary",
    type: "deal_day_protocol",
    pattern: "When a deal reaches commitment stage (buyer says 'yes, let's do it'), it gets ALL remaining daily time. This is the ONE exception to the 50/50 discovery/conversion split. Commitment → invoice → payment → delivery kickoff should happen within hours, not days. Every hour of delay at commitment stage = increased risk of buyer cooling off, partner changing mind, or competitor entering.",
    evidence: "Pack 6 scarcity tier: 'MONEY NOW — if any Money Now action exists, do it before ANYTHING else.' Pack 3B delivery: 'Send invoice within 2 hours of acceptance.'",
    anti_pattern: "Treating commitment stage same as pricing stage. Sending invoice 'tomorrow' because today's discovery batch isn't done. Doing research while a committed buyer waits for an invoice.",
    applicable_to_us: true,
    why_applicable: "First client commitment will come with no warning. System must be ready to pivot the ENTIRE day to closing. Discovery can miss one day. A committed buyer cannot miss their window.",
    confidence: "high",
    extracted_rule: "COMMITMENT OVERRIDE: When any lead reaches commitment stage ('let's do it' / 'send the invoice' / 'ready to start'): (1) All other work pauses. (2) Kirill prepares invoice within 1 hour. (3) Confirmation + invoice sent. (4) After invoice sent, resume other work. This is the ONLY scenario where discovery floor (5 touches/day) can be skipped. Commitment events are rare — when they happen, they get everything.",
    target_component: "daily operating loop (commitment override rule)",
    expected_metric_change: "zero deals lost at commitment stage due to slow invoice",
    review_window: "after first commitment event",
    risk: "low — commitment events are rare, override is temporary (1-2 hours max)",
    apply_mode: "build",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 2: OUTPUT A — ADAPTIVE REALLOCATION TABLE
// ══════════════════════════════════════════════════════════════════════════════

export const ADAPTIVE_REALLOCATION_TABLE = [
  {
    situation: "10 cold sends, 0 replies after 24h",
    likely_means: "Normal. Cold email average response time is 24-72h. Most replies come after follow-up touch, not first send.",
    what_NOT_to_conclude: "That the surface, copy, or targeting is broken. 24h is zero data for cold email.",
    reduce: "Nothing.",
    increase: "Nothing. Day 3 follow-ups are already queued automatically.",
    wait_before_changing: "Until Day 7 (after first follow-up has gone out). Evaluate: opens + follow-up replies.",
  },
  {
    situation: "10 cold sends, 0 replies after full sequence (4 touches over 14 days)",
    likely_means: "Surface or copy is underperforming. 0/10 after full sequence = 0% reply rate. Below the 1-3% cold email baseline.",
    what_NOT_to_conclude: "That the entire channel is dead. 10 is below min_test_size (30). Could be bad batch (all generic emails, wrong category).",
    reduce: "Don't send more from the same batch. Research quality may be the issue.",
    increase: "Research effort on NEXT batch: stricter quality gates (owner email required, tool signal preferred). Try different copy angle on next 10.",
    wait_before_changing: "Until 30 total sends across 2-3 batches. If 0/30 → surface or copy is broken. Change ONE variable (copy first).",
  },
  {
    situation: "3 warm asks, no intros produced",
    likely_means: "These 3 contacts don't know service business owners. Or: they do but won't follow through.",
    what_NOT_to_conclude: "That warm network doesn't work. Sample size 3 is meaningless. Contact #4 might produce the golden intro.",
    reduce: "Nothing.",
    increase: "Send 3 more warm asks tomorrow to DIFFERENT contacts. Try 10 total before evaluating warm network quality.",
    wait_before_changing: "Until 10 warm asks sent across multiple days. If 0/10 produce intros → Kirill's immediate network may not have service business connections. Try 2nd-degree LinkedIn approach instead.",
  },
  {
    situation: "LinkedIn connections accepted but no DMs replied to",
    likely_means: "They accepted the connection (low-effort action) but DM didn't compel a response. DM may have been too sales-y, or they just accept all connections.",
    what_NOT_to_conclude: "That LinkedIn owners don't engage. Connection acceptance = awareness. DM content may need adjustment.",
    reduce: "Nothing on connections (keep sending).",
    increase: "Try different DM approach: shorter, more specific question instead of pitch. 'Hey [name], quick question — do your missed calls in the evenings ever cost you jobs? Trying to understand the pattern for Calgary [category] businesses.'",
    wait_before_changing: "After 10 DMs with 0 responses → test new DM template. After 20 DMs, 0 responses → LinkedIn DM may not work for this audience. Consider LinkedIn posts/comments instead of direct DM.",
  },
  {
    situation: "Reddit gets DMs from non-buyers (learners, employees with no authority)",
    likely_means: "Reddit surfaces pain-aware people, but many lack authority/budget. The signal is real (they understand the problem) but the buyer qualification fails.",
    what_NOT_to_conclude: "That Reddit is worthless. The pain intelligence is valuable. The conversion path needs adjustment: find OWNERS in threads, not just anyone discussing the problem.",
    reduce: "Time spent engaging with non-authority DMs (one qualifier question, then disengage if no owner path).",
    increase: "Filter for posts by self-identified owners ('I own a...', 'my business...', 'as the owner...'). Comment only on owner-authored posts.",
    wait_before_changing: "After 5 DMs with 0 owner connections → adjust targeting to owner-authored posts only. Don't cut Reddit entirely — it's the only surface where pain is described in the buyer's own words.",
  },
  {
    situation: "Review-based leads open but do not reply",
    likely_means: "They saw the email (opened = aware), the review reference got their attention, but something didn't compel a response. Either: the CTA was weak, the email was too long, or they're thinking about it.",
    what_NOT_to_conclude: "That review-based approach doesn't work. Opens without replies = the TARGETING works (they read it) but the CONVERSION COPY needs work.",
    reduce: "Nothing on the surface.",
    increase: "Follow-up Day 3 with different angle: 'I mentioned your reviews last time — here's a 2-min walkthrough of what the follow-up would look like for [category] businesses.' Adds the demo artifact as value-add.",
    wait_before_changing: "After 15 review-based sends: if open rate >30% but reply rate <2% → copy problem, not targeting problem. Test shorter email. Test different CTA ('Can I send a 2-min demo?' vs 'Worth a look?').",
  },
  {
    situation: "Growth-signal leads reply weakly ('maybe', 'send info', 'not right now')",
    likely_means: "Growth is real but pain isn't felt acutely. They're growing but managing. Paper-strong, behavior-weak as predicted by ST2-4 pattern.",
    what_NOT_to_conclude: "That growth signals are useless. They identify the RIGHT companies — but the entry copy may need to target a more specific pain than general 'growing fast.'",
    reduce: "Effort on generic 'noticed you're growing' angle.",
    increase: "Specificity: instead of 'more estimates than you can handle' try 'what happens when your new dispatcher is on 2 calls and a third comes in?' More vivid = more felt.",
    wait_before_changing: "After 15 growth-signal sends. If weak replies persist → growth signals are enrichment data, not standalone targeting. Use them to enrich directory/review leads, not as primary surface.",
  },
  {
    situation: "One hot buyer appears mid-discovery day",
    likely_means: "A reply from today's or yesterday's sends just escalated a lead to Tier 1. Real buyer signal: owner + pain + pricing question or demo request.",
    what_NOT_to_conclude: "That discovery should stop for the day. Hot lead gets 90 min max (response + artifact + review). Remaining time returns to discovery.",
    reduce: "Today's remaining discovery batch from 15 to 10 (sacrifice 5 low-priority touches to free time for hot lead).",
    increase: "All attention on hot lead response: draft scope/demo, Kirill review, send. Then return to plan.",
    wait_before_changing: "N/A — immediate reallocation. Resume discovery after hot lead is served.",
  },
  {
    situation: "Artifact request appears while discovery queue is half-done",
    likely_means: "A lead (likely Tier 2) has asked for demo or one-pager. This is a positive signal but not a Tier 1 interrupt (they're not asking about pricing yet — they're evaluating).",
    what_NOT_to_conclude: "That you should stop everything and build the artifact right now. Unless it's from a Tier 1 lead, the artifact can be built in 4-24h.",
    reduce: "Nothing from current discovery batch.",
    increase: "Schedule artifact build for after current discovery batch is sent. If it's a reusable artifact (already built) → adapt and send in 10 min.",
    wait_before_changing: "If the request is from a Tier 1 lead → interrupt, build artifact now (90-min hot lead protocol). If Tier 2 → build after today's sends, send within 24h. If Tier 3 → send reusable template artifact, no custom build.",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3: OUTPUT B — 5-DAY OPERATING CADENCE
// ══════════════════════════════════════════════════════════════════════════════

export const FIVE_DAY_CADENCE = {
  description: "Strict 5-day cycle that balances discovery, follow-up, deal work, and learning. Not rigid — hot leads override any day's plan. But without a plan, days blur into reactive noise.",

  days: [
    {
      day: "Day 1 (Monday)",
      primary: "HEAVY DISCOVERY — refill pipeline after weekend gap",
      secondary: "Process any weekend replies",
      surfaces: "Warm network (5 asks) + review-based research (8 leads) + LinkedIn (5 connection requests) = 18 touches",
      must_happen: "15+ new touches sent. Inbox checked 3x. All weekend replies processed first.",
      can_wait: "Artifact builds (unless Tier 1 requested). Surface evaluation. Template optimization.",
      rationale: "Monday = freshest audience attention. Highest open rates. Pipeline should be fullest by end of Monday.",
    },
    {
      day: "Day 2 (Tuesday)",
      primary: "DISCOVERY + EARLY REPLY HANDLING",
      secondary: "Day 3 auto follow-ups from last week's sends go out",
      surfaces: "Growth-signal enriched (5 leads) + directory-enriched (5 leads) + Reddit (2 comments) = 12 touches + reply handling",
      must_happen: "10+ new touches. All replies from yesterday processed within SLA. Auto follow-ups checked for accuracy.",
      can_wait: "New surface research (use Monday's research pipeline). LinkedIn (connections from Monday still pending acceptance).",
      rationale: "Monday's sends start producing opens/replies Tuesday. Balance new sends with incoming signal processing.",
    },
    {
      day: "Day 3 (Wednesday)",
      primary: "DEAL WORK — artifacts, scopes, follow-ups for active leads",
      secondary: "Moderate discovery (5-touch floor)",
      surfaces: "Whatever surfaces produced replies Mon-Tue get extra attention. 5 new touches to maintain pipeline floor.",
      must_happen: "All pending artifacts built and sent. All Tier 1-2 leads have next actions complete. 5 new touches minimum.",
      can_wait: "New surface exploration. Research for later batches. Template testing.",
      rationale: "Mid-week = replies from Monday/Tuesday arrive. Deals need attention. Discovery drops to floor but doesn't stop.",
    },
    {
      day: "Day 4 (Thursday)",
      primary: "DISCOVERY SECOND WAVE + warm network refresh",
      secondary: "Follow-up on Wednesday's deal work",
      surfaces: "Warm network (5 new asks) + best-performing cold surface (8 leads) = 13 touches",
      must_happen: "10+ new touches. Warm asks to fresh contacts (not repeats from Monday). Check: did Monday's warm asks produce any intros?",
      can_wait: "Artifact builds (unless Tier 1). Surface evaluation still too early (wait for Friday review).",
      rationale: "Thursday sends arrive Friday (high open rate for end-of-week emails). Second warm-network wave catches contacts who were busy Monday.",
    },
    {
      day: "Day 5 (Friday)",
      primary: "WEEKLY REVIEW + light discovery + prep for next week",
      secondary: "Process all remaining replies. Clean pipeline.",
      surfaces: "5 new touches (floor). Best-performing surface only.",
      must_happen: "WEEKLY REVIEW (30 min): surface performance, tier rebalancing, kill/pause decisions, what worked this week, what didn't. PREP: research 10-15 leads for Monday batch. Queue emails.",
      can_wait: "New experiments. Template changes (decide during review, implement Monday). New surface trials.",
      rationale: "Friday = reflection + preparation. The week's data is in. Make decisions. Prepare Monday's ammunition. Don't start anything that can't finish today.",
    },
  ],

  invariants: [
    "Inbox checked 3x per day minimum (morning, mid-session, end-session). Replies always processed within SLA regardless of day type.",
    "5-touch discovery floor NEVER broken except on Commitment Override day.",
    "Auto follow-up sequences run daily regardless (system-managed, no Kirill time).",
    "Tier 1 leads get 60-min SLA every day, no exceptions.",
    "End-of-day prep (last 15 min) happens every day — tomorrow's batch is ALWAYS ready.",
  ],
};


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 4: OUTPUT C — INTERRUPTION PRIORITY TABLE
// ══════════════════════════════════════════════════════════════════════════════

export const INTERRUPTION_TABLE = [
  {
    event: "Warm intro reply: owner describes pain and asks about pricing",
    interrupt: "YES — immediately",
    speed: "60 min SLA",
    why: "Highest-value signal possible. Owner + warm + pain + pricing = Tier 1 instant. Every hour of delay reduces close probability.",
    who_handles: "Kirill drafts response, system provides template + Kirill review",
    what_gets_postponed: "Current discovery batch. Resume after response sent (10-15 min).",
  },
  {
    event: "Cold lead replies: 'what's the price?'",
    interrupt: "YES — within current session",
    speed: "2h SLA",
    why: "Pricing question = intent score 3+. But cold = needs qualification first. Not as urgent as warm. Can respond within current work session.",
    who_handles: "System drafts range + qualifier. Kirill reviews if batch review time available.",
    what_gets_postponed: "Nothing — fits within normal workflow. Send during next inbox check.",
  },
  {
    event: "Champion asks for forwardable kit",
    interrupt: "NO — scheduled response",
    speed: "4h SLA (same-day delivery)",
    why: "Champion is forwarding to signer. Signer won't see it for hours/days regardless. Our speed to champion matters less than artifact QUALITY. Take 30 min to prepare correctly.",
    who_handles: "System generates kit from template. Kirill reviews (1 of 3 daily reviews).",
    what_gets_postponed: "Nothing. Build kit after current batch. Send by end of work session.",
  },
  {
    event: "Low-budget marketplace 'yes' at $750",
    interrupt: "NO — end of day batch",
    speed: "24h",
    why: "Marketplace deal at floor price. Not urgent despite their stated urgency. Our response at 5 PM vs 10 AM doesn't change outcome. Don't let marketplace crowd out higher-EV work.",
    who_handles: "System sends scope confirmation template. Kirill reviews scope only if custom.",
    what_gets_postponed: "Nothing. Handle in end-of-session batch.",
  },
  {
    event: "Reddit learner DM",
    interrupt: "NO — batch at end of session",
    speed: "24h",
    why: "Learner, not buyer. One helpful tip then disengage. Not worth interrupting ANY productive work.",
    who_handles: "System sends one-tip template. No Kirill review needed.",
    what_gets_postponed: "Nothing.",
  },
  {
    event: "Artifact request from confirmed owner (Tier 1-2)",
    interrupt: "YES — allocated build time",
    speed: "90-min hot lead protocol if Tier 1. 24h if Tier 2.",
    why: "Owner asking to see something = evaluation behavior. Tier 1 = fast. Tier 2 = today, not instant.",
    who_handles: "System builds from template. Kirill reviews + records Loom if needed.",
    what_gets_postponed: "If Tier 1: sacrifice 5 low-priority discovery touches. If Tier 2: build after current batch.",
  },
  {
    event: "Follow-up reminder fires (auto sequence)",
    interrupt: "NO",
    speed: "Auto-sent, no human action",
    why: "System handles entirely. Pre-written. Zero Kirill time. These run in background regardless of what day type it is.",
    who_handles: "System (auto boundary).",
    what_gets_postponed: "Nothing.",
  },
  {
    event: "Angry reply from review-based lead",
    interrupt: "YES — carefully",
    speed: "2h SLA",
    why: "Reputational risk. Angry owner in a small Calgary market = potential damage. But DON'T respond in 5 minutes — draft carefully. Tone matters more than speed here.",
    who_handles: "System drafts apology + exit. Kirill reviews (mandatory — reputational risk). 'I apologize if my email came across the wrong way. I'll remove you from my list immediately. Sorry for the inconvenience.'",
    what_gets_postponed: "Current task pauses for 10 min draft + Kirill review. Then resume.",
  },
  {
    event: "Buyer says 'let's do it' / 'send invoice'",
    interrupt: "YES — EVERYTHING STOPS",
    speed: "60 min. Commitment Override.",
    why: "This is the MONEY NOW moment. Only event that triggers Commitment Override. Invoice within 1 hour. All other work pauses until invoice sent + confirmed.",
    who_handles: "Kirill prepares invoice (Wave). System sends confirmation email. Kirill sends invoice link.",
    what_gets_postponed: "EVERYTHING. Discovery, other replies, artifacts, research. Resume after invoice sent.",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 5: OUTPUT D — MULTI-DAY PIPELINE COMPOUNDING MODEL
// ══════════════════════════════════════════════════════════════════════════════

export const PIPELINE_COMPOUNDING = {
  flow: [
    {
      stage: "DISCOVERY (Day N)",
      input: "Surface scanning + lead research",
      output: "15 new touches sent. Queued in auto follow-up sequences.",
      creates: "Reply inventory in 24-72h. Opens/clicks in 4-24h. Auto follow-ups at Day 3, 7, 14.",
    },
    {
      stage: "REPLY INVENTORY (Day N+1 to N+3)",
      input: "Replies trickle in from Day N sends + auto follow-ups from prior batches",
      output: "Classified replies: Tier 1 interrupts, Tier 2 scheduled, Tier 3 batched",
      creates: "Qualified leads needing artifacts/scope. Champion paths needing kits. Deal conversations.",
    },
    {
      stage: "DEAL QUEUE (Day N+2 to N+5)",
      input: "Qualified leads from reply inventory",
      output: "Artifacts built. Scopes sent. Pricing discussions. Champion equipping.",
      creates: "Artifact pressure on build time. Kirill review demand. Active negotiations.",
    },
    {
      stage: "CONVERSION (Day N+5 to N+14)",
      input: "Active deals in pricing/scope/commitment stages",
      output: "Closed deals, lost deals, stalled deals",
      creates: "Revenue (if closed). Learnings (always). Case study material (if closed + permitted). Referral asks (if closed).",
    },
  ],

  compounding_rules: [
    "Day N discovery creates Day N+3 replies. If you skip Day N discovery, Day N+3 has no replies to handle. Pipeline dries up by Day N+7.",
    "Day N+2 artifacts must not consume Day N+2's discovery time. Build AFTER sending new touches, not instead of.",
    "Day N+5 deal work may need 60-70% of daily time. Discovery drops to floor (5 touches) but NEVER zero. The 5-touch floor ensures Day N+8 still has pipeline.",
    "Auto follow-ups compound: Day 1 batch gets follow-up Day 4. Day 2 batch gets follow-up Day 5. By Day 5, you're sending 10 new touches + 10 auto follow-ups = 20 total outgoing messages daily with only 10 requiring fresh effort.",
    "PIPELINE HEALTH CHECK: if fewer than 3 leads are in stages interested/qualified/pricing at any time → pipeline is thin. Increase discovery allocation next 2 days.",
  ],

  anti_starvation_protocol: {
    trigger: "Fewer than 3 leads in active stages (interested+) AND no Tier 1 leads",
    action: "Next 2 workdays: discovery allocation increases to 70%. Only deal maintenance (follow-ups, SLA replies) on conversion side. Goal: 30 new touches in 2 days from multiple surfaces.",
    returns_to_normal: "When 3+ leads are in active stages again.",
  },
};


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 6: OUTPUT E — SURFACE REALLOCATION RULES
// ══════════════════════════════════════════════════════════════════════════════

export const SURFACE_REALLOCATION_RULES = [
  {
    surface: "Warm network",
    min_sample: "10 asks across 5+ different contacts",
    metric: "intros_produced / asks_sent",
    promising_early: "1+ named intro from first 5 asks",
    misleading_early: "1 person says 'I know someone' but never follows through (count as 0 until actual intro happens)",
    scale_up: "If 2+ intros from 10 asks (20%+ intro rate) → message 5 more contacts/day instead of 3",
    reduce: "If 0/10 intros after trying diverse contacts → Kirill's immediate network may not have service business connections. Shift to LinkedIn 2nd-degree targeting.",
    pause: "If all 525 connections have been asked (52 days at 10/day). Surface is FINITE. Move to referral asks from completed deals instead.",
  },
  {
    surface: "Review-based cold",
    min_sample: "15 sends to businesses with verified callback complaints in reviews",
    metric: "meaningful_replies / sends",
    promising_early: "1+ reply from first 8 sends (12.5%+ = very strong for cold). Or: high open rate (40%+) even if 0 replies yet.",
    misleading_early: "High open rate with 0 replies after full sequence = targeting works, copy doesn't convert. Don't confuse opens with interest.",
    scale_up: "If 2+ meaningful replies from 15 sends → double allocation. This surface has externally-verified pain = highest cold-email quality.",
    reduce: "If 0/30 after copy iteration → reviews may not translate to willingness to accept help from strangers. Reduce to 2/day and test different entry angle.",
    pause: "If 0/50 after two copy variants → surface produces awareness but not engagement. Pause and redirect to warm/LinkedIn.",
  },
  {
    surface: "LinkedIn owners",
    min_sample: "15 connection requests to owner-titled profiles",
    metric: "connections_accepted AND dms_replied / requests_sent",
    promising_early: "50%+ acceptance rate AND 1+ DM reply from first 10 accepts",
    misleading_early: "High acceptance with 0 DM replies = they accept everyone but ignore messages. Acceptance alone means nothing.",
    scale_up: "If DM reply rate >15% from accepted connections → increase to 8 requests/day. This is a warm-ish channel that compounds (more connections = more visibility).",
    reduce: "If 0 DM replies from 15 accepted connections → DM template needs rewrite. Test question-based DM vs pitch-based.",
    pause: "If 0/30 DM replies after template iteration → LinkedIn DM doesn't work for this audience. Pivot to LinkedIn content (posts/comments) instead of direct outreach.",
  },
  {
    surface: "Growth signals",
    min_sample: "15 sends to growth-verified businesses with owner email found",
    metric: "meaningful_replies / sends",
    promising_early: "1+ reply engaging with the growth reference specifically ('yeah, we are getting busier')",
    misleading_early: "'Interesting' or 'send info' without engaging with growth angle = they replied to any cold email, growth reference wasn't the hook.",
    scale_up: "If 2+ growth-engaged replies from 15 → increase. Growth + pain felt = strong combination.",
    reduce: "If 0/30 after copy iteration → growth signals are enrichment data, not standalone targeting. Use to enrich review/directory leads, not as primary surface.",
    pause: "If 0/50 → growth on paper ≠ growth pain felt. Paper-strong-behavior-weak confirmed. Use growth data only for lead enrichment.",
  },
  {
    surface: "Reddit",
    min_sample: "10 helpful comments in owner-authored pain threads",
    metric: "dms_received AND dms_from_owners / comments_posted",
    promising_early: "1 owner DM from first 5 comments",
    misleading_early: "DMs from non-owners (learners, employees). Upvotes without DMs. Comments engagement that stays public (no DM = no private conversation).",
    scale_up: "If 2+ owner DMs from 10 comments → increase to 5 comments/day on owner-authored threads only. Reddit becomes a warm-generation engine.",
    reduce: "If 10 comments, only learner DMs → filter more strictly for owner-authored posts. If 0 DMs at all → reduce to 1 comment/day (brand presence only, not lead gen).",
    pause: "Never fully pause — Reddit provides pain language intelligence even when it doesn't produce leads. But reduce to maintenance mode (1 comment every 2 days) if 20 comments produce 0 owner DMs.",
  },
  {
    surface: "Directories / Yellow Pages",
    min_sample: "30 sends to enriched leads (owner email + website verified)",
    metric: "meaningful_replies / sends",
    promising_early: "1-2 replies from 15 enriched sends = normal for cold email. The enrichment is the key — unenriched directory sends have near-zero rates.",
    misleading_early: "Replies to unenriched sends (generic email, no research) = luck, not replicable.",
    scale_up: "If 3%+ reply rate from enriched sends → increase enrichment research capacity. More research per lead = more qualified sends.",
    reduce: "If 0/30 enriched sends → copy or targeting problem. Test different categories. Test different email angle.",
    pause: "If 0/50 enriched sends after copy iteration → directory sourcing isn't working for this ICP. Focus on review-based and warm channels.",
  },
  {
    surface: "Marketplace (Fiverr/Upwork)",
    min_sample: "5 counter-offers at $750",
    metric: "accepted_at_750 / counters_sent",
    promising_early: "1 acceptance at $750 from first 3 counters",
    misleading_early: "'Let me think about it' from marketplace buyer = they found someone cheaper. Acceptance at $600 = below floor, don't count as success.",
    scale_up: "If 2+ acceptances at $750 from 5 counters → marketplace at $750 is cash-flow viable. Maintain 3 counters/day as background activity. But NEVER increase to primary surface — these are cash-flow deals, not growth deals.",
    reduce: "If 0/5 at $750 → marketplace buyers won't pay our price. Expected and acceptable. Marketplace is always lowest priority.",
    pause: "If 0/10 at $750 → marketplace is not viable at our pricing. Stop sending counters. Only re-engage if a project description is EXACTLY our ICP with budget stated at $750+.",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 7: OUTPUT F — TODAY/TOMORROW ALLOCATION LOGIC
// ══════════════════════════════════════════════════════════════════════════════

export const TOMORROW_LOGIC = [
  {
    if_today: "Today produced 2+ replies with pain/pricing signals",
    tomorrow_changes: "Tomorrow = 60% conversion / 40% discovery. Respond to all replies first (these are now Tier 1-2 leads). Build artifacts if requested. Discovery drops to 8 touches but doesn't stop. End-of-day: prep next batch from best-performing surface.",
  },
  {
    if_today: "Today produced only opens (5+ opens, 0 replies)",
    tomorrow_changes: "Tomorrow = same plan as today (50/50). Opens without replies = signals received but not compelling. Day 3 auto follow-ups will go out. Don't change copy yet — follow-up often triggers the reply the first email didn't. Research next batch from a DIFFERENT surface to diversify.",
  },
  {
    if_today: "Today produced nothing (0 opens, 0 replies, 0 engagement)",
    tomorrow_changes: "Tomorrow = 60% discovery / 40% conversion. Increase discovery effort because pipeline is producing nothing. Check: are emails being delivered? (Deliverability issue?) Are we sending to real addresses? (Data quality issue?) If deliverability is fine → test different surface tomorrow. Don't repeat same surface that produced zero.",
  },
  {
    if_today: "Today produced one hot buyer (owner + pain + pricing in same thread)",
    tomorrow_changes: "Tomorrow = handle hot buyer FIRST (60-min SLA, artifact if needed, scope if ready). Then: 40% discovery / remaining conversion work. Hot buyer gets Tier 1 slot immediately. If both Tier 1 slots were empty → this lead fills one. If one was occupied → evaluate: is this new lead stronger? If yes → promote, demote the other.",
  },
  {
    if_today: "Today produced only weak signals ('interesting', 'send info', 'maybe later')",
    tomorrow_changes: "Tomorrow = 55% discovery / 45% conversion. Weak signals get Tier 3-4 treatment (one qualifying follow-up each, batch processed). Increase discovery to bring in stronger signals. Evaluate: were today's touches going to the right quality leads? Tighten quality gates for tomorrow's batch.",
  },
  {
    if_today: "Today produced one marketplace close at $750",
    tomorrow_changes: "Tomorrow = 50/50 (standard). Marketplace close is cash flow, not strategy change. Begin marketplace delivery during allocated build time. Discovery continues normally — marketplace clients don't generate referrals or case studies. Don't let marketplace delivery eat all of tomorrow's time. Strict scope boundary.",
  },
  {
    if_today: "Today produced two champion paths but no signer engagement",
    tomorrow_changes: "Tomorrow = 50/50 (standard). Both champion paths get Tier 2 treatment (one-pager/artifact sent, 10-day clock started). Do NOT invest Tier 1 effort in champion paths without signer engagement. Discovery continues to find direct-owner leads that could become Tier 1. The champion paths will either produce signers or they won't — our equipping is done, now we wait.",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 8: OUTPUT G — SYSTEM CHANGES
// ══════════════════════════════════════════════════════════════════════════════

export const SYSTEM_CHANGES = {
  daily_planning: [
    {
      change: "Add end-of-day prep step",
      current: "Day ends when work is done",
      new: "Last 15 min of every session: research 5-10 leads, queue emails, note tomorrow's surfaces, review tier assignments. Tomorrow starts with SENDING, not researching.",
    },
    {
      change: "Add morning tier review (5 min)",
      current: "No formal daily tier check",
      new: "First 5 min: check inbox for overnight replies → reclassify tiers → promote/demote as needed → then begin day's primary focus.",
    },
    {
      change: "Add pipeline health check to Friday review",
      current: "Weekly review exists (Pack 6) but no anti-starvation trigger",
      new: "If fewer than 3 leads in active stages → next 2 days = 70% discovery mode. Returns to 50/50 when 3+ active leads exist.",
    },
  ],

  sla_logic: [
    {
      change: "Tier-based SLA with interrupt classification",
      current: "2h for pricing, 4h for others",
      new: "Tier 1 owner with pain/pricing = 60 min. Cold pricing question = 2h. Champion kit request = 4h (same-day). Marketplace = 24h. Learner = 24h. Commitment = 60 min EVERYTHING STOPS.",
    },
  ],

  portfolio_ranking: [
    {
      change: "Daily 5-min tier review instead of weekly only",
      current: "Weekly rebalancing",
      new: "Daily: quick promote/demote based on overnight signals. Weekly: deep review with surface performance, kill/pause decisions, allocation changes.",
    },
  ],

  artifact_queue: [
    {
      change: "Artifact timing gated by lead tier",
      current: "Artifacts built when requested",
      new: "Tier 1 request = build within 90 min (hot lead protocol). Tier 2 = build within 24h. Tier 3 = send reusable template, no custom build. Tier 4-5 = no artifact.",
    },
  ],

  reply_interrupt: [
    {
      change: "Add 30-second reply classification protocol",
      current: "All replies checked during inbox review",
      new: "Every reply gets instant 30-second classification: Tier 1 interrupt / Tier 2 scheduled / Tier 3 batched. Classification determines whether to pause current work or continue.",
    },
  ],

  tomorrow_planning: [
    {
      change: "Add today→tomorrow allocation logic",
      current: "Tomorrow planned ad-hoc",
      new: "Based on today's signal quality (replies/opens/nothing/hot-buyer/weak/champions), tomorrow's discovery/conversion split adjusts per the TOMORROW_LOGIC table. Not ad-hoc — rule-based.",
    },
  ],

  surface_scoring: [
    {
      change: "Formal surface evaluation at 15/30/50 send thresholds",
      current: "No formal surface evaluation",
      new: "At 15 sends: early signal check (amber/green). At 30 sends: viable data check (scale/investigate/watch). At 50 sends: conclusive decision (scale/cut/kill). Track per surface independently.",
    },
  ],

  cadence_templates: [
    {
      change: "5-day operating cadence with day-type definitions",
      current: "Every day treated the same",
      new: "Monday: heavy discovery. Tuesday: discovery + early replies. Wednesday: deal work + floor discovery. Thursday: second discovery wave. Friday: review + prep. Invariants: inbox 3x/day, 5-touch floor, Tier 1 SLA, end-of-day prep.",
    },
  ],
};


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 9: OUTPUT H — FINAL ADAPTIVE HUNT DOCTRINE
// ══════════════════════════════════════════════════════════════════════════════

export const ADAPTIVE_HUNT_DOCTRINE = {
  statement:
    "The system hunts every day, adapts every evening, reallocates every morning, and compounds pipeline over weeks — never panicking from one day's silence, never ignoring a week's pattern, never letting hot leads starve the pipeline, and never letting pipeline-filling distract from closing live deals.",

  principles: [
    {
      id: 1,
      principle: "Two speeds of adaptation: daily micro, threshold macro.",
      operational: "DAILY: if surface X got a reply yesterday → add 2 more touches today. If subject line Y got 0 opens → try different subject tomorrow. THRESHOLD: at 30 sends, evaluate reply rate. At 50, make scale/cut decision. Daily adjustments are small tuning knobs. Threshold decisions are switch flips. Don't confuse them.",
    },
    {
      id: 2,
      principle: "Replies change the plan. Nothing else does.",
      operational: "Opens don't change the plan (they confirm delivery, not interest). Learner DMs don't change the plan. Marketplace counters don't change the plan. But an owner replying with pain + pricing question IMMEDIATELY reshuffles the day's priorities. Train the system to distinguish: signals that deserve reallocation vs signals that are just noise with a positive valence.",
    },
    {
      id: 3,
      principle: "The 5-touch floor is non-negotiable.",
      operational: "Even on the busiest deal day — even when Kirill is building a demo, sending an invoice, and handling an objection all at once — 5 new discovery touches go out. 15 minutes. Template-based if necessary. These 5 touches are the pipeline's heartbeat. Skipping them for one day is survivable. Skipping for three days creates a reply gap on Day 7 that takes a week to recover from.",
    },
    {
      id: 4,
      principle: "Yesterday's last 15 minutes determine today's first 60.",
      operational: "End-of-day prep is the highest-leverage 15 minutes of the day. Tomorrow's batch is researched, drafted, and queued. Tomorrow's surfaces are chosen. Tomorrow's tier assignments are updated. Without this: tomorrow starts with 45 minutes of 'what should I do?' With this: tomorrow starts with sending.",
    },
    {
      id: 5,
      principle: "Commitment is the only event that overrides everything.",
      operational: "When a buyer says 'let's do it': invoice within 60 minutes. All other work pauses. This is the ONE exception to the 5-touch floor, the 50/50 split, and the daily cadence. Commitment events are rare and precious. When they happen, the system drops everything and captures the money. After invoice sent: resume normal operations.",
    },
    {
      id: 6,
      principle: "Silence for one day is normal. Silence for one week is data.",
      operational: "0 replies from 15 sends after 24 hours = expected (cold email average is 48-72h for first replies, often after follow-up). 0 replies from 45 sends over 7 days including follow-ups = something is wrong. The system must distinguish patience (24-72h after a batch) from denial (7+ days across 2+ batches). React to patterns, not to single-day outcomes.",
    },
    {
      id: 7,
      principle: "Pipeline health is measured weekly, not daily.",
      operational: "Daily: count replies and classify them. Weekly: how many leads are in active stages? How many Tier 1 slots are filled? How many surfaces are producing? How many sends went out this week total? If active leads < 3 → anti-starvation mode (70% discovery for 2 days). If active leads > 5 → reduce discovery to 30%, focus on conversion.",
    },
    {
      id: 8,
      principle: "The system that prepared yesterday hunts better today.",
      operational: "A system that ends each day with tomorrow's batch ready, tomorrow's surfaces chosen, and today's learnings noted will outperform a system that starts each day fresh by 10x. Preparation compounds. The difference between 8:05 AM first-touch and 9:30 AM first-touch is 90 minutes of prime sending window — every day, compounding over weeks.",
    },
  ],
};


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 10: PRACTICAL SUMMARY
// ══════════════════════════════════════════════════════════════════════════════

export const PRACTICAL_SUMMARY = {

  top_5_reallocation_rules: [
    "1. TWO SPEEDS OF ADAPTATION. Daily micro: +2 touches to surface that got a reply, different subject line on surface that got opens but no replies. Threshold macro: at 30 sends evaluate reply rate, at 50 sends make scale/cut decision. Don't pivot strategy from one bad day. Don't ignore a bad month.",
    "2. SURFACE EVALUATION: 0-15 SENDS = NO CONCLUSIONS. 15-30 = EARLY SIGNAL. 30-50 = VIABLE DATA. 50+ = CONCLUSIVE. Most surfaces need 30+ sends before you can judge them. Cutting a surface after 6 sends = panic. Continuing after 50 sends with 0 replies = denial.",
    "3. HOT LEAD GETS 90 MIN, NOT THE WHOLE DAY. Owner with pain + pricing → 60 min response + 30 min artifact if needed. Then BACK to discovery. Hot leads are served fast, not served exclusively. The 5-touch discovery floor survives even hot-lead days.",
    "4. REPLIES CHANGE THE PLAN. OPENS DON'T. An email opened 3 times with no reply = they looked and passed. An email replied to with 'what's the price' = reallocation event. Train the system to ignore vanity signals (opens, clicks, accepts) and respond only to behavioral commitments (replies, questions, requests).",
    "5. ANTI-STARVATION TRIGGER: FEWER THAN 3 ACTIVE LEADS → 70% DISCOVERY FOR 2 DAYS. Pipeline health is a leading indicator. When it drops below 3 active leads, the system's survival instinct kicks in: heavy discovery for 48 hours to refill. Returns to 50/50 when 3+ active leads exist.",
  ],

  top_5_cadence_rules: [
    "1. END-OF-DAY PREP IS THE MOST VALUABLE 15 MINUTES. Research 5-10 leads, queue emails, choose tomorrow's surfaces, update tier assignments. Tomorrow starts with SENDING at 8:05 AM, not RESEARCHING at 9:30 AM. This 15 minutes saves 45 minutes every morning and adds 90 minutes of prime sending window per week.",
    "2. 5-DAY CYCLE: MONDAY HEAVY DISCOVERY → TUESDAY DISCOVERY + REPLIES → WEDNESDAY DEAL WORK → THURSDAY SECOND WAVE → FRIDAY REVIEW + PREP. Not rigid (hot leads override any day), but without a cycle, days blur into reactive noise. The cycle creates rhythm. Rhythm creates consistency. Consistency creates pipeline.",
    "3. 5-TOUCH FLOOR IS NON-NEGOTIABLE. Even on the busiest deal day. 5 new touches = 15 minutes of template sends. These are the pipeline's heartbeat. Skip 1 day = survivable. Skip 3 days = reply gap on Day 7 that takes a week to recover. The floor exists because it's cheaper to maintain than to restart.",
    "4. AUTO FOLLOW-UPS COMPOUND DAILY. Day 1 batch gets Day 4 follow-up. Day 2 gets Day 5. By Day 5 you're producing 10 new touches + 10 auto follow-ups = 20 total outgoing with only 10 requiring fresh effort. The system does the compounding math. Let it run.",
    "5. FRIDAY REVIEW IS WHERE STRATEGY CHANGES. Not Monday. Not mid-week in a panic. Friday: surface performance, tier rebalancing, kill/pause decisions, what worked, what didn't. Prep Monday's heavy discovery batch. Strategy changes are DECIDED on Friday and EXECUTED starting Monday.",
  ],

  top_5_interruption_rules: [
    "1. COMMITMENT OVERRIDES EVERYTHING. 'Let's do it' / 'send invoice' = all work stops. Invoice within 60 min. This is the only event that overrides the 5-touch floor. Commitment events are rare — when they happen, capture the money instantly.",
    "2. WARM OWNER REPLY WITH PAIN/PRICING = 60-MIN SLA. This is the highest-value signal besides commitment. Don't let it sit for 4 hours because you're researching LinkedIn profiles. Stop current batch. Respond. Resume.",
    "3. COLD PRICING QUESTION = 2H SLA, NOT 60 MIN. Pricing question from cold lead needs qualification first. Important but not as urgent as warm. Respond within current work session, not instantly.",
    "4. CHAMPION KIT REQUEST = SAME-DAY, NOT INSTANT. Champion is forwarding to signer who won't see it for hours/days. Speed to champion matters less than artifact quality. Build correctly, send by end of session.",
    "5. MARKETPLACE, LEARNERS, FOLLOW-UP REMINDERS = NEVER INTERRUPT. Batch at end of session. These are Tier 3-4 events that don't deserve interrupting ANY productive work. 24h response is fine.",
  ],

  top_3_doctrine_changes: [
    "1. ADD END-OF-DAY PREP AND MORNING TIER REVIEW TO DAILY LOOP. The current daily loop (Pack 6) starts with reply check and moves to outreach. Insert: (A) last 15 min of each day = prep tomorrow's batch. (B) first 5 min of each day = morning tier review (promote/demote based on overnight signals). These two additions turn reactive days into prepared days.",
    "2. IMPLEMENT TWO-SPEED ADAPTATION WITH FORMAL SURFACE THRESHOLDS. Replace 'evaluate surfaces monthly' (Pack 10) with continuous two-speed system: daily micro-adjustments (touch allocation shifts) + formal threshold evaluations at 15/30/50 sends per surface. This prevents both panic-pivoting and zombie-surface persistence.",
    "3. ADD PIPELINE HEALTH CHECK WITH ANTI-STARVATION TRIGGER. Every Friday (and any day it's noticed): count active leads in stages interested+. If <3 → 70% discovery for next 2 workdays. If >5 → 30% discovery, focus on conversion. This single metric prevents the feast/famine cycle that kills solo operators. The pipeline is a living thing — it needs monitoring, not just feeding.",
  ],
};
