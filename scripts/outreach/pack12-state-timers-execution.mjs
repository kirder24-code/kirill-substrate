/**
 * Pack 12 — State Memory, Timers & Execution Control
 *
 * The final capability: converts all doctrine from Packs 1-11 into
 * controllable execution state. The system becomes a stateful organism
 * that remembers what's happening, what's pending, what's due, and
 * what action must happen next — derived from live state, not abstract reasoning.
 *
 * Principle: event → state update → queue update → timer update → next action
 *
 * Sources: Packs 5-11 (synthesis), Stress Tests 1-5 + 5-Day Execution Test,
 * all doctrine layers (build, deal-assist, learning, portfolio, SLA).
 */

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 1: STRUCTURED RULES
// ══════════════════════════════════════════════════════════════════════════════

export const PACK12_EXTRACTED_RULES = [

  {
    source: "Pack 6 Daily Loop + Pack 11 Cadence + 5-Day Test (synthesis)",
    tier: "primary",
    type: "state_driven_execution",
    pattern: "Across the 5-Day Test, every morning started with a tier review: what changed overnight? What timers are due? What replies arrived? The system made decisions FROM STATE, not from re-analyzing the situation. State is the compressed truth of everything that's happened. Without state, every morning starts from zero — rethinking, re-triaging, re-prioritizing. With state: scan objects, check timers, pick highest-priority action, execute.",
    evidence: "5-Day Test: 'Morning tier review: check overnight replies, reclassify tiers.' Pack 11: 'Daily 5-min tier review.' Pack 6 next-best-action: 9-step waterfall from current state.",
    anti_pattern: "Re-analyzing the entire situation every morning. Forgetting where a lead was in the pipeline. Losing track of timers. Not knowing which follow-ups are due. Treating every interaction as if it's the first.",
    applicable_to_us: true,
    why_applicable: "System currently has no persistent execution state between sessions. Every conversation starts by reading memory files and reconstructing context. A stateful system would start with: 'Lead X is in pricing stage, timer fires in 3h, artifact was sent yesterday, wife hasn't responded yet — what's the action?'",
    confidence: "high",
    extracted_rule: "The system must maintain a live EXECUTION STATE that persists between sessions. State includes: all active leads with their tier/stage/timers, all pending follow-ups with due dates, all artifact requests with delivery status, all active deals with signer/champion status, all queues (reply, discovery, artifact, research). Morning start = read state → pick action. Not: read everything → re-analyze → decide.",
    target_component: "new: execution-state.json or execution-state DB table",
    expected_metric_change: "zero context loss between sessions, 30+ min saved per morning",
    review_window: "after 5 workdays using state",
    risk: "medium — state must be accurate. Stale state = wrong actions. Update protocol is critical.",
    apply_mode: "build",
  },
  {
    source: "Pack 11 Interruption + 5-Day Test Timer Events (synthesis)",
    tier: "primary",
    type: "timer_as_action_trigger",
    pattern: "5-Day Test had 12+ timer events: 48h follow-ups, Day 5 follow-ups, Day 7 breakups, Day 10 champion timeouts, partner review waits. Each timer, when it fires, changes what the system should do next. A timer isn't a reminder — it's an ACTION TRIGGER that modifies execution state. When a 48h follow-up fires, the lead's state changes from 'waiting' to 'follow-up-due' and enters the follow-up queue.",
    evidence: "5-Day Test: Day 3 auto follow-ups from Day 1 sends. Day 5 LinkedIn follow-up. Day 7 Reddit follow-up queued. Pack 11: champion 10-day timeout.",
    anti_pattern: "Timers as mental notes ('I should follow up Wednesday'). Missing timer events because they're not tracked. Following up too early (before timer). Following up too late (timer expired, lead went cold). Running timers in your head instead of in state.",
    applicable_to_us: true,
    why_applicable: "With 15+ active leads across multiple stages, each with different timers, human memory fails. The execution state must track every timer and surface the ones that fire TODAY in the morning queue.",
    confidence: "high",
    extracted_rule: "Every timer is a record: { lead_id, timer_type, start_date, fire_date, action_on_fire, cancel_condition, escalation_if_ignored }. On each session start, system scans all timers and surfaces those where fire_date <= today. These enter the follow-up queue AUTOMATICALLY. Kirill doesn't need to remember — the state remembers.",
    target_component: "new: timer registry in execution state",
    expected_metric_change: "zero missed follow-ups, zero late breakups",
    review_window: "after 10 timer events processed",
    risk: "low — timers are deterministic and verifiable",
    apply_mode: "build",
  },
  {
    source: "Pack 10 Portfolio Tiers + Pack 11 Tier Promotion + 5-Day Test (synthesis)",
    tier: "primary",
    type: "queue_as_execution_driver",
    pattern: "The 5-Day Test maintained 5 tier queues simultaneously. Leads moved between tiers based on events (reply, silence, timer fire, commitment). The queues ARE the execution plan: process Tier 1 first, then Tier 2, then discovery, then Tier 3-4 batch. Without queues, the system picks actions by reasoning about all leads simultaneously — slow and error-prone. With queues: scan top queue, pick first item, execute, repeat.",
    evidence: "Pack 10: 5-tier model with max slots. Pack 11: daily tier review. 5-Day Test: morning tier review → pick actions from tiers.",
    anti_pattern: "No queues — every action requires full re-analysis. Queues that never update (stale). Too many queues (cognitive overhead). Queues without priority (which queue to process first?).",
    applicable_to_us: true,
    why_applicable: "System needs exactly 8 queues that map to the daily operating loop: (1) reply queue, (2) timer/follow-up queue, (3) Tier 1 deal queue, (4) Tier 2 deal queue, (5) artifact queue, (6) discovery queue, (7) research queue, (8) kill/archive queue. Process in this order. First non-empty queue gets attention.",
    confidence: "high",
    extracted_rule: "8 queues processed in priority order: REPLY → TIMER → TIER1 → TIER2 → ARTIFACT → DISCOVERY → RESEARCH → KILL. On session start: populate queues from state. Process first item in highest-priority non-empty queue. After completing: re-check queues (a reply may have arrived). Repeat until session time expires. This is the execution loop.",
    target_component: "new: queue manager in execution state",
    expected_metric_change: "actions always in correct priority order, zero 'what should I do next?' moments",
    review_window: "after 5 workdays",
    risk: "low",
    apply_mode: "build",
  },
  {
    source: "All Stress Tests State Transitions (meta-synthesis)",
    tier: "primary",
    type: "event_driven_state_transitions",
    pattern: "Every stress test was a sequence of events that changed lead states: ST1 warm reply → contacted→interested→qualified→pricing. ST4 electrical 5 messages → interested→qualified→trust_objection→pricing. 5-Day Test plumbing: stranger→contacted→interested→partner_check→pricing. Each event triggers a SPECIFIC state change with SPECIFIC consequences (new timer, new queue entry, tier change).",
    evidence: "ST1-4: explicit tier assignments changed as events occurred. 5-Day: day-by-day tier promotion/demotion based on events.",
    anti_pattern: "State changes without triggers (moving a lead forward because 'it feels like progress'). Missing state changes when events happen (not updating after a reply). Inconsistent state (lead shows 'interested' but last event was a breakup email).",
    applicable_to_us: true,
    why_applicable: "The system must have a TRANSITION TABLE: for each event type, what state change happens, what timer starts, what queue updates, what tier changes. This makes state updates mechanical, not judgment-based.",
    confidence: "high",
    extracted_rule: "See STATE_TRANSITION_MAP export below. Every event has exactly one set of consequences: new_stage, new_tier, timers_started, timers_cancelled, queues_entered, queues_exited. State updates are ATOMIC — all consequences apply together, not partially.",
    target_component: "new: transition engine in execution state",
    expected_metric_change: "consistent, reliable state updates across all leads",
    review_window: "after 20 state transitions",
    risk: "medium — wrong transition rules = wrong actions. Must be validated against stress test patterns.",
    apply_mode: "build",
  },
  {
    source: "Pack 6 Next-Best-Action + Pack 11 Hot Lead Protocol + 5-Day Test (synthesis)",
    tier: "primary",
    type: "next_action_from_state",
    pattern: "Pack 6 defined a 9-step next-best-action waterfall. Pack 11 added interruption classification. 5-Day Test applied both: scan queues → process highest priority → check for interrupts → continue. The next-best-action engine doesn't THINK about what to do — it READS the state and the queues and picks the first actionable item.",
    evidence: "Pack 6: 'Check money now → check replies → check follow-ups → check build blockers → check Kirill queue → check kills → send outreach → prepare tomorrow → system improvement.' 5-Day Test: every day followed this pattern from state.",
    anti_pattern: "Deciding next action by reasoning from scratch. Picking actions based on what feels important rather than what the state says is due. Skipping queue steps ('I'll do discovery first because I feel like it').",
    applicable_to_us: true,
    why_applicable: "The execution loop must be mechanical: read queues in priority order → pick first actionable item → execute → update state → re-read queues. No reasoning required for queue selection. Reasoning only needed for the CONTENT of the response, not for WHAT to do next.",
    confidence: "high",
    extracted_rule: "EXECUTION LOOP: (1) Read reply queue — if non-empty, classify first reply (Tier 1 interrupt? Tier 2 scheduled? Tier 3 batch?). Handle Tier 1 immediately. (2) Read timer queue — any timers firing now? Execute their actions. (3) Read Tier 1 deal queue — any Tier 1 leads with pending actions? Handle. (4) Read Tier 2 queue. (5) Read artifact queue. (6) Read discovery queue. (7) Read research queue. (8) Process kills/archives. After each action: update state, re-scan queues. The loop runs until session time expires.",
    target_component: "new: execution loop engine",
    expected_metric_change: "zero priority inversions, always working on highest-value action",
    review_window: "after 5 sessions",
    risk: "low — mechanical process, easy to verify",
    apply_mode: "build",
  },
  {
    source: "Pack 11 End-of-Day Prep + 5-Day Test Persistence (synthesis)",
    tier: "primary",
    type: "state_persistence_protocol",
    pattern: "5-Day Test: end-of-day prep was: research leads, queue emails, note surfaces, update tiers. This is STATE PERSISTENCE — saving the execution state so tomorrow starts fast. Without persistence: tomorrow morning re-reads all memory files, re-analyzes all leads, re-figures out what's pending. With persistence: tomorrow reads state.json → sees what's due → starts executing in 5 minutes.",
    evidence: "Pack 11: 'Last 15 min = prep tomorrow's batch.' 5-Day Test: 'End-of-day prep: queue Day N+1 batch.'",
    anti_pattern: "Ending the session without saving state. Trusting memory files to reconstruct execution context. Starting each session by re-reading all packs and re-analyzing from scratch.",
    applicable_to_us: true,
    why_applicable: "Current system has no persistent execution state. Context is reconstructed each session from memory files + conversation history. A state file would make session start instant and error-free.",
    confidence: "high",
    extracted_rule: "END-OF-SESSION PROTOCOL: (1) Update all lead stages in state. (2) Update all timer fire dates. (3) Update queue contents. (4) Update tier assignments. (5) Note tomorrow's priority surfaces. (6) Queue tomorrow's discovery batch. (7) Save state. SESSION START PROTOCOL: (1) Load state. (2) Check timers due today. (3) Check reply queue. (4) Begin execution loop. No re-analysis needed. State IS the truth.",
    target_component: "new: execution-state.json with persistence protocol",
    expected_metric_change: "session start time from 30+ min to 5 min",
    review_window: "after 5 sessions with persistence",
    risk: "medium — stale or corrupted state = wrong actions. Must validate state against reality at least weekly.",
    apply_mode: "build",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 2: OUTPUT A — STATE OBJECT TABLE
// ══════════════════════════════════════════════════════════════════════════════

export const STATE_OBJECTS = {

  lead: {
    description: "Any discovered business/person that the system is tracking",
    required_fields: {
      id: "unique string",
      business_name: "string",
      contact_name: "string | null",
      contact_role: "owner | co_owner | spouse | office_manager | ops_lead | estimator | admin | unknown",
      contact_email: "string | null",
      discovery_surface: "warm | referral | linkedin | reddit | directory | reviews | job_board | growth_signal | marketplace | local_group | tool_community",
      vertical: "landscaping | plumbing | hvac | roofing | cleaning | electrical | moving | auto_repair | garage_door | other",
      stage: "stranger | contacted | interested | qualified | pricing_active | scope_active | partner_check | commitment | paid | stalled | lost | killed",
      tier: "1 | 2 | 3 | 4 | 5",
      confidence_score: "0-100",
      authority_confirmed: "boolean",
      pain_described: "boolean",
      tool_detected: "string | null (jobber | hcp | servicetitan | none)",
      created_at: "ISO date",
      last_event_at: "ISO date",
      last_event_type: "string",
    },
    optional_fields: {
      champion_id: "string | null — if this lead has a separate champion contact",
      signer_id: "string | null — if signer is different from contact",
      signal_sequence: "string[] — ordered list of signal types received",
      objections_log: "array of { type, date, response_used, resolved }",
      deception_flags: "string[] — fake_urgency, fake_budget, etc.",
      pressure_round_count: "number — how many price pushes",
      signal_verified: "boolean",
      acquisition_affiliated: "boolean — warm/referral vs cold/stranger",
      notes: "string — free text",
    },
    events_that_update: [
      "email_sent → stage: contacted, timer: follow_up_48h started",
      "reply_received → stage: interested, tier recalculated, reply queue entered",
      "pain_described → pain_described: true, confidence +20",
      "authority_confirmed → authority_confirmed: true, confidence +25",
      "pricing_asked → stage: pricing_active, intent_score 3+",
      "scope_sent → stage: scope_active, timer: follow_up_48h started",
      "partner_mentioned → stage: partner_check, champion_id set, timer: partner_review_5d started",
      "commitment_received → stage: commitment, COMMITMENT OVERRIDE triggered",
      "payment_received → stage: paid",
      "silence_after_timer → stall check, possible demotion",
      "explicit_no → stage: lost, loss_reason logged",
      "kill_trigger → stage: killed, archived",
    ],
  },

  champion: {
    description: "A contact who is not the signer but has path to the signer",
    required_fields: {
      id: "unique string",
      lead_id: "string — which lead this champion is for",
      name: "string",
      role: "spouse | office_manager | ops_lead | employee | friend_referral",
      strength: "strong | weak | conflicted | unknown",
      kit_sent: "boolean",
      kit_sent_at: "ISO date | null",
      signer_engaged: "boolean",
      signer_engaged_at: "ISO date | null",
      forward_requested: "boolean",
      forward_confirmed: "boolean",
    },
    events_that_update: [
      "champion_identified → create champion record, link to lead",
      "kit_requested → forward_requested: true",
      "kit_sent → kit_sent: true, timer: champion_timeout_10d started",
      "signer_feedback_relayed → signer_engaged: true, strength: strong",
      "silence_after_kit → strength: weak (if 5+ days)",
      "champion_timeout_fires → escalate or kill champion path",
    ],
  },

  active_deal: {
    description: "A lead that has progressed to pricing or beyond",
    required_fields: {
      lead_id: "string",
      offer_type: "pilot | full | phased | custom",
      price_quoted: "number",
      scope_description: "string",
      not_included: "string[] — explicit exclusions",
      guarantee_stated: "boolean",
      invoice_sent: "boolean",
      invoice_amount: "number | null",
      payment_received: "boolean",
      payment_amount: "number | null",
      started_at: "ISO date",
      signer_count: "number (1 or 2+)",
    },
    events_that_update: [
      "scope_sent → deal created with price + scope + exclusions",
      "scope_expansion_requested → logged in objections, phase_split_offered",
      "commitment_received → invoice_sent: pending",
      "invoice_sent → invoice_sent: true, timer: payment_48h started",
      "payment_received → payment_received: true, delivery begins",
    ],
  },

  artifact: {
    description: "Any trust asset or proof material created for a lead",
    required_fields: {
      id: "unique string",
      lead_id: "string",
      type: "demo_visual | one_pager | loom | scope_doc | forwarding_text | roi_calc",
      status: "queued | building | ready | sent | reused",
      requested_at: "ISO date",
      due_by: "ISO date (Tier 1: +4h, Tier 2: +24h)",
      sent_at: "ISO date | null",
      reusable: "boolean",
      base_template_id: "string | null — if adapted from reusable template",
    },
    events_that_update: [
      "artifact_requested → status: queued, due_by calculated from lead tier",
      "build_started → status: building",
      "build_complete → status: ready, enters Kirill review if needed",
      "kirill_approved → status: ready (confirmed)",
      "sent_to_lead → status: sent, sent_at set",
      "reused_for_another_lead → creates new artifact record with base_template_id",
    ],
  },

  timer: {
    description: "Any time-based trigger that will fire an action",
    required_fields: {
      id: "unique string",
      lead_id: "string",
      type: "follow_up_48h | follow_up_day5 | follow_up_day7 | breakup_day14 | champion_timeout_10d | partner_review_5d | reply_sla | artifact_due | payment_wait_48h | reactivation_30d",
      start_date: "ISO date",
      fire_date: "ISO date",
      status: "active | fired | cancelled | expired",
      action_on_fire: "string — what happens when timer fires",
      cancel_condition: "string — what event cancels this timer",
      escalation_if_ignored: "string — what happens if the action isn't taken within 24h of firing",
    },
    events_that_update: [
      "timer_created → status: active",
      "fire_date_reached → status: fired, action enters appropriate queue",
      "cancel_condition_met → status: cancelled (e.g., lead replied before follow-up fired)",
      "action_completed → timer archived",
      "action_ignored_24h → escalation logic triggered",
    ],
  },

  objection_record: {
    description: "Logged objection from any lead interaction",
    required_fields: {
      id: "unique string",
      lead_id: "string",
      type: "price | trust | complexity | timing | authority | need | scope_creep | competitor | hard_no",
      root: "budget | deal_seeking | polite_exit | dislike | low_value | genuine | unknown",
      phrase: "string — exact words used",
      response_used: "string — which response template/approach",
      resolved: "boolean",
      pressure_round: "number — which push this was (1, 2, 3+)",
      date: "ISO date",
    },
  },

  learning_record: {
    description: "Post-deal outcome log for pattern detection",
    required_fields: {
      lead_id: "string",
      outcome: "won | lost | stalled",
      stage_reached: "string",
      stage_lost_at: "string | null",
      objection_that_killed: "string | null",
      what_worked: "string",
      what_failed: "string",
      would_do_differently: "string",
      discovery_surface: "string",
      contact_role: "string",
      affiliated: "boolean",
      deal_duration_days: "number",
      revenue: "number",
      date: "ISO date",
    },
  },

  surface_stats: {
    description: "Per-surface performance tracking for reallocation decisions",
    required_fields: {
      surface: "string",
      total_sent: "number",
      opens: "number",
      meaningful_replies: "number",
      deals_progressed: "number",
      revenue_generated: "number",
      last_updated: "ISO date",
      evaluation_stage: "early (0-15) | signal (15-30) | viable (30-50) | conclusive (50+)",
    },
  },
};


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3: OUTPUT B — TIMER TABLE
// ══════════════════════════════════════════════════════════════════════════════

export const TIMER_TABLE = [
  {
    type: "follow_up_48h",
    starts_when: "First email/scope/artifact sent to any lead",
    what_it_means: "Enough time for them to read and process. If no response → gentle check-in.",
    action_on_fire: "Send pre-written check-in: 'Any questions about [what was sent]?'",
    cancelled_by: "Lead replies before timer fires (any reply cancels this timer)",
    escalation: "If check-in also gets no reply → starts day_7 timer",
    if_ignored: "Lead sits without follow-up, goes cold silently. 48h gap becomes 5-day gap.",
  },
  {
    type: "follow_up_day5",
    starts_when: "48h follow-up sent with no response (for warm/Tier 2 leads)",
    what_it_means: "Second touch. Value-add angle or new proof asset.",
    action_on_fire: "Send value-add follow-up: new angle, seasonal reference, or proof snippet.",
    cancelled_by: "Lead replies",
    escalation: "If no response → day_7 or day_14 timer based on lead warmth",
    if_ignored: "Warm lead cooling with no intervention. Could have been saved with timely touch.",
  },
  {
    type: "follow_up_day7",
    starts_when: "After 48h follow-up for cold leads. After day5 for warm leads.",
    what_it_means: "Third touch. For cold: breakup territory. For warm: persistence touch.",
    action_on_fire: "Cold: breakup email ('If timing's not right, no worries'). Warm: 'Happy to answer any questions directly.'",
    cancelled_by: "Lead replies",
    escalation: "Cold: lead marked stalled after breakup. Warm: day_14 timer.",
    if_ignored: "Cold lead stays in active queue consuming attention with zero progression.",
  },
  {
    type: "champion_timeout_10d",
    starts_when: "Internal selling kit sent to champion for forwarding to signer",
    what_it_means: "Champion has had 10 days to forward and get signer feedback. If no signer engagement by now → champion didn't deliver or signer said no.",
    action_on_fire: "Send final message to champion: 'Did [signer] get a chance to look? If timing's not right, no worries.' Demote lead to Tier 4 or kill.",
    cancelled_by: "Signer engages directly (any signer response cancels)",
    escalation: "If champion says 'they're busy, maybe next week' → extend 5 days (ONCE). If still silence → kill.",
    if_ignored: "Champion path stays in Tier 2-3 indefinitely, consuming follow-up effort with zero signer engagement. The most common attention leak.",
  },
  {
    type: "partner_review_5d",
    starts_when: "Lead says 'need to check with partner/husband/wife' and one-pager is sent",
    what_it_means: "Partner has been given materials. 5 days is reasonable review time for a co-decision.",
    action_on_fire: "Send to lead: 'Did [partner] get a chance to look? Anything I can clarify for them?'",
    cancelled_by: "Partner (or lead) responds with partner's feedback or decision",
    escalation: "If no partner response after follow-up → offer direct access: 'Would it help if I answered their questions directly?'",
    if_ignored: "Partner check becomes infinite 'they're busy' loop. Most common deal-killing stall pattern.",
  },
  {
    type: "breakup_day14",
    starts_when: "Day 7 follow-up sent to warm lead with no response",
    what_it_means: "14 days of engagement with no forward movement. Time to acknowledge and exit.",
    action_on_fire: "Send breakup: 'Sounds like timing might not be right. Happy to reconnect whenever makes sense.'",
    cancelled_by: "Lead replies before timer fires",
    escalation: "After breakup: lead moves to killed or reactivation_30d (if pain was real but timing was off)",
    if_ignored: "Dead lead stays in active pipeline indefinitely. Pollutes tier assignments and attention allocation.",
  },
  {
    type: "reply_sla",
    starts_when: "Any reply received from any lead",
    what_it_means: "Clock is ticking on our response. Speed = credibility.",
    action_on_fire: "Tier 1: 60 min (already past SLA — escalate). Tier 2: 4h. Tier 3: 24h.",
    cancelled_by: "Response sent to the lead",
    escalation: "Tier 1 reply unanswered for 2h → Kirill notification. Tier 2 unanswered for 8h → auto-demote urgency flag.",
    if_ignored: "Hot lead goes cold because we didn't respond. The most expensive single failure the system can make.",
  },
  {
    type: "artifact_due",
    starts_when: "Lead requests artifact (demo, one-pager, scope doc)",
    what_it_means: "Prospect is evaluating. The ask has a shelf life. Fast delivery = credibility.",
    action_on_fire: "Tier 1: 4h overdue → escalate to Kirill. Tier 2: 24h overdue → send what's ready even if imperfect.",
    cancelled_by: "Artifact delivered",
    escalation: "Tier 1 artifact 8h overdue = prospect has likely cooled. Send with apology for delay.",
    if_ignored: "'Can you show me something' goes unanswered. Prospect concludes we can't deliver. Trust destroyed before deal starts.",
  },
  {
    type: "reactivation_30d",
    starts_when: "Lead marked as stalled/lost with timing as the reason (not hard no or bad fit)",
    what_it_means: "Timing was wrong, not fit. Check back in 30 days — season may have changed, project may have freed up.",
    action_on_fire: "Send reactivation touch: seasonal angle or new capability. 'A few weeks ago the timing wasn't right. [Seasonal reason] is coming up — still something you'd want to solve?'",
    cancelled_by: "Lead reactivates from inbound (they contact us first)",
    escalation: "If reactivation gets no response → mark permanently lost. Don't reactivate twice.",
    if_ignored: "Recoverable lead stays dead permanently. Some 'not right now' leads DO buy later — the 30d touch catches them.",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 4: OUTPUT C — EXECUTION QUEUE TABLE
// ══════════════════════════════════════════════════════════════════════════════

export const EXECUTION_QUEUES = [
  {
    queue: "reply_queue",
    what_enters: "Any incoming reply from any lead, via any channel (email, Reddit DM, LinkedIn, marketplace)",
    what_exits: "After reply is classified and responded to (or classified and batched for later)",
    priority: "HIGHEST. Always processed first.",
    sla: "Tier 1: 60 min. Tier 2: 4h. Tier 3: 24h. Classification takes 30 seconds.",
    who_handles: "System classifies + drafts. Kirill reviews if semi_auto/founder boundary.",
    common_mistake: "Processing replies in arrival order instead of tier order. A Tier 3 'send me info' from 8 AM should NOT be handled before a Tier 1 pricing question from 9 AM.",
  },
  {
    queue: "timer_queue",
    what_enters: "Timers that have fire_date <= today. Auto-populated from timer registry each morning.",
    what_exits: "After timer action is executed or timer is cancelled by an event.",
    priority: "SECOND. After replies, before deal work.",
    sla: "Same-session for all except reactivation_30d (which can wait until discovery batch).",
    who_handles: "System sends auto follow-ups. Kirill reviews only champion_timeout and partner_review actions (they affect active deals).",
    common_mistake: "Not checking timer queue daily. A Day 7 breakup that doesn't fire = dead lead stays in active pipeline consuming attention.",
  },
  {
    queue: "tier1_deal_queue",
    what_enters: "Tier 1 leads with pending actions: scope to send, artifact to deliver, objection to handle, commitment to capture.",
    what_exits: "After the pending action is completed. Lead stays Tier 1 until stall or close.",
    priority: "THIRD. The closest-to-money work.",
    sla: "All Tier 1 pending actions completed same session.",
    who_handles: "Kirill directly. System prepares drafts + artifacts.",
    common_mistake: "Having Tier 1 leads with no defined next action. Every Tier 1 lead must always have exactly ONE pending action. If it doesn't → state is incomplete.",
  },
  {
    queue: "tier2_deal_queue",
    what_enters: "Tier 2 leads with pending actions: follow-up, champion equipping, qualification.",
    what_exits: "After pending action completed. May be promoted to Tier 1 or demoted.",
    priority: "FOURTH.",
    sla: "All Tier 2 actions completed same day.",
    who_handles: "System handles most (templates, artifact adaptation). Kirill reviews champion-facing or scope-adjacent actions.",
    common_mistake: "Tier 2 leads accumulating without action. If 3+ Tier 2 leads have no defined next action → state hygiene problem.",
  },
  {
    queue: "artifact_queue",
    what_enters: "Artifact requests from any tier. Includes: demo builds, one-pager generation, scope doc creation, Loom recording.",
    what_exits: "After artifact is built, reviewed, and sent. Or: reusable artifact is adapted and sent.",
    priority: "FIFTH. After deal handling, before discovery.",
    sla: "Tier 1 artifacts: 4h. Tier 2: 24h. Tier 3+: send reusable template, no custom build.",
    who_handles: "System builds from templates. Kirill reviews and/or records Loom.",
    common_mistake: "Building custom artifacts for Tier 3+ leads. Reusable template is sufficient. Custom builds only for Tier 1-2.",
  },
  {
    queue: "discovery_queue",
    what_enters: "Researched leads ready for first-touch outreach. Pre-queued during end-of-day prep.",
    what_exits: "After first-touch email/message is sent. Lead creates a new record in state with stage: contacted.",
    priority: "SIXTH. After all active deal work is done for the session.",
    sla: "5-touch floor daily (non-negotiable). 15-touch target on discovery-heavy days.",
    who_handles: "System sends (auto for pre-approved templates). Kirill reviews personalized batches.",
    common_mistake: "Discovery queue empty because end-of-day prep was skipped. Tomorrow starts with nothing queued. 45 min lost to morning research.",
  },
  {
    queue: "research_queue",
    what_enters: "Businesses identified from surfaces that need enrichment before outreach: owner name, email, website, tool check, review scan.",
    what_exits: "After research is complete. Lead either enters discovery queue (qualified) or kill queue (not qualified).",
    priority: "SEVENTH. Research fills tomorrow's discovery queue.",
    sla: "5-10 leads researched per end-of-day prep session.",
    who_handles: "System (automated for website/tool/review checks). Manual for owner name/email where automated research fails.",
    common_mistake: "Researching during prime sending hours. Research belongs in the last 15-30 min of the session, not the first.",
  },
  {
    queue: "kill_archive_queue",
    what_enters: "Leads hitting kill triggers: explicit no, below floor, satisfied with status quo, champion timeout with no signer, breakup timer expired, dead marketplace.",
    what_exits: "After lead is marked killed in state, learning record created, and lead archived.",
    priority: "LOWEST. Process at end of session or during Friday review.",
    sla: "Same-week. Dead leads should not persist in active queues longer than one Friday review cycle.",
    who_handles: "System marks killed. Learning record may need Kirill input for what_worked/what_failed.",
    common_mistake: "Not processing kills. Dead leads accumulate, pollute tier counts, and create false sense of pipeline health.",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 5: OUTPUT D — STATE TRANSITION MAP
// ══════════════════════════════════════════════════════════════════════════════

export const STATE_TRANSITION_MAP = [
  {
    event: "First outreach email sent",
    from_stage: "stranger",
    to_stage: "contacted",
    tier_change: "→ Tier 4 (one-touch-and-wait)",
    timers_started: ["follow_up_48h"],
    timers_cancelled: [],
    queues: "Lead exits discovery_queue, enters timer_queue (48h follow-up pending)",
  },
  {
    event: "Lead replies with interest/curiosity (no pain or pricing yet)",
    from_stage: "contacted",
    to_stage: "interested",
    tier_change: "→ Tier 3 (unless warm intro → Tier 2)",
    timers_started: ["reply_sla"],
    timers_cancelled: ["follow_up_48h (reply cancels pending follow-up)"],
    queues: "Enters reply_queue for classification. After response: enters appropriate tier queue.",
  },
  {
    event: "Lead describes specific pain",
    from_stage: "interested",
    to_stage: "qualified",
    tier_change: "→ Tier 2 (if authority unknown) or Tier 1 (if authority confirmed)",
    timers_started: [],
    timers_cancelled: [],
    queues: "Confidence score updated (+20). Lead promoted in tier queue.",
  },
  {
    event: "Lead asks about pricing",
    from_stage: "interested OR qualified",
    to_stage: "pricing_active",
    tier_change: "→ Tier 1 (if authority confirmed) or Tier 2 (if not)",
    timers_started: ["reply_sla (60 min for Tier 1, 2h for Tier 2)"],
    timers_cancelled: [],
    queues: "Enters tier1 or tier2 deal queue with pending action: send_scope.",
  },
  {
    event: "Scope sent with pricing",
    from_stage: "pricing_active",
    to_stage: "scope_active",
    tier_change: "No change",
    timers_started: ["follow_up_48h"],
    timers_cancelled: [],
    queues: "Pending action: await_response. Timer manages follow-up.",
  },
  {
    event: "Lead mentions partner/wife/boss needs to approve",
    from_stage: "any active stage",
    to_stage: "partner_check",
    tier_change: "Stays same tier but adds champion record",
    timers_started: ["partner_review_5d"],
    timers_cancelled: [],
    queues: "Champion record created. Kit generation enters artifact_queue. Lead's pending action: equip_champion.",
  },
  {
    event: "Champion asks for forwardable kit",
    from_stage: "partner_check",
    to_stage: "partner_check (no stage change)",
    tier_change: "No change",
    timers_started: ["artifact_due (Tier-based SLA)", "champion_timeout_10d (starts when kit is sent)"],
    timers_cancelled: [],
    queues: "Artifact enters artifact_queue. Champion strength: forward_requested = true.",
  },
  {
    event: "Signer engages directly (partner/owner responds)",
    from_stage: "partner_check",
    to_stage: "qualified OR pricing_active (depending on signer's message)",
    tier_change: "→ Tier 1 (signer is now in conversation)",
    timers_started: ["reply_sla (60 min — signer is Tier 1)"],
    timers_cancelled: ["champion_timeout_10d", "partner_review_5d"],
    queues: "Champion record updated: signer_engaged = true. Lead enters tier1_deal_queue.",
  },
  {
    event: "Trust objection raised ('burned by software', 'have you done this before')",
    from_stage: "any active stage",
    to_stage: "same stage (objection doesn't change stage)",
    tier_change: "No change (objection is within-stage event)",
    timers_started: ["follow_up_48h (after response sent, wait for their reaction)"],
    timers_cancelled: [],
    queues: "Objection logged. Response drafted and queued for Kirill review (semi_auto for trust objections from Tier 1-2).",
  },
  {
    event: "Lead says 'let's do it' / 'send invoice' / 'ready to start'",
    from_stage: "scope_active OR pricing_active",
    to_stage: "commitment",
    tier_change: "→ COMMITMENT OVERRIDE (supersedes all tiers)",
    timers_started: ["payment_wait_48h (after invoice sent)"],
    timers_cancelled: ["ALL other timers for this lead"],
    queues: "ALL other queues paused. Invoice preparation is sole priority. Active_deal record created.",
  },
  {
    event: "Payment received",
    from_stage: "commitment",
    to_stage: "paid",
    tier_change: "Lead exits tier system. Enters delivery tracking.",
    timers_started: ["delivery_start (next business day)"],
    timers_cancelled: ["payment_wait_48h"],
    queues: "Lead exits all sales queues. Enters delivery queue. Learning record preparation begins (for post-delivery logging).",
  },
  {
    event: "Silence after follow-up sequence complete (all timers expired)",
    from_stage: "any active stage",
    to_stage: "stalled",
    tier_change: "→ Tier 4 or Tier 5 depending on prior stage",
    timers_started: ["reactivation_30d (if pain was real but timing was off)"],
    timers_cancelled: ["all active timers"],
    queues: "Lead exits active tier queues. If reactivation timer set → enters timer_queue. Otherwise → kill_archive_queue.",
  },
  {
    event: "Explicit no / 'not interested' / 'remove me'",
    from_stage: "any",
    to_stage: "killed",
    tier_change: "→ Tier 5",
    timers_started: [],
    timers_cancelled: ["ALL timers for this lead"],
    queues: "Enters kill_archive_queue. Learning record created immediately. No reactivation timer (this is a hard no).",
  },
  {
    event: "Scope creep push #3+ (repeated expansion without commitment)",
    from_stage: "scope_active",
    to_stage: "scope_active (unchanged) OR lost (if walk-away triggered)",
    tier_change: "No change unless walk-away → Tier 5",
    timers_started: [],
    timers_cancelled: [],
    queues: "Pressure_round_count incremented. If count >= 3 → walk-away response queued. If they don't commit after walk-away → kill.",
  },
  {
    event: "Reactivation timer fires (30 days after stall)",
    from_stage: "stalled",
    to_stage: "contacted (re-entered pipeline)",
    tier_change: "→ Tier 4 (low-touch until they re-engage)",
    timers_started: ["follow_up_48h (after reactivation message)"],
    timers_cancelled: [],
    queues: "Reactivation message enters discovery_queue (treated as new outreach). If no response → killed permanently.",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 6: OUTPUT E — NEXT-BEST-ACTION ENGINE
// ══════════════════════════════════════════════════════════════════════════════

export const NEXT_ACTION_ENGINE = {
  description: "Given the current execution state, this engine selects the one best next action. It reads queues in priority order and picks the first actionable item.",

  execution_loop: [
    {
      step: 1,
      name: "CHECK COMMITMENT OVERRIDE",
      condition: "Any lead in stage: commitment with invoice not yet sent?",
      if_yes: "STOP EVERYTHING. Prepare and send invoice. This overrides all other steps.",
      if_no: "→ Step 2",
    },
    {
      step: 2,
      name: "CHECK REPLY QUEUE",
      condition: "Any unprocessed replies?",
      if_yes: "Classify highest-tier reply (30 sec). If Tier 1 → respond now (60 min SLA). If Tier 2 → respond this session. If Tier 3 → batch for end of session.",
      if_no: "→ Step 3",
    },
    {
      step: 3,
      name: "CHECK TIMER QUEUE",
      condition: "Any timers firing today?",
      if_yes: "Execute highest-priority timer action. Follow-up sends are auto. Champion/partner timeouts need assessment.",
      if_no: "→ Step 4",
    },
    {
      step: 4,
      name: "CHECK TIER 1 DEAL QUEUE",
      condition: "Any Tier 1 leads with pending actions?",
      if_yes: "Execute the pending action: send scope, build artifact, handle objection, prepare invoice.",
      if_no: "→ Step 5",
    },
    {
      step: 5,
      name: "CHECK TIER 2 DEAL QUEUE",
      condition: "Any Tier 2 leads with pending actions?",
      if_yes: "Execute: send follow-up, adapt artifact, equip champion.",
      if_no: "→ Step 6",
    },
    {
      step: 6,
      name: "CHECK ARTIFACT QUEUE",
      condition: "Any artifacts requested and not yet built?",
      if_yes: "Build highest-priority artifact. Reuse template where possible. Kirill review if needed.",
      if_no: "→ Step 7",
    },
    {
      step: 7,
      name: "CHECK DISCOVERY QUEUE",
      condition: "Is discovery floor (5 touches) met today? Are there leads queued for outreach?",
      if_yes_unmet: "Send discovery touches until floor is met or queue is empty.",
      if_floor_met: "→ Step 8",
      if_queue_empty: "→ Step 8 (research to fill queue)",
    },
    {
      step: 8,
      name: "CHECK RESEARCH QUEUE",
      condition: "Is tomorrow's discovery batch prepared (5-10 leads researched and queued)?",
      if_no: "Research leads for tomorrow. This is end-of-day prep.",
      if_yes: "→ Step 9",
    },
    {
      step: 9,
      name: "CHECK KILL/ARCHIVE QUEUE",
      condition: "Any leads pending kill or archive?",
      if_yes: "Process: mark killed, create learning records, archive.",
      if_no: "→ Step 10",
    },
    {
      step: 10,
      name: "SESSION COMPLETE",
      condition: "All queues empty or session time expired.",
      action: "Run end-of-session protocol: update all lead states, check timers for tomorrow, save execution state.",
    },
  ],

  re_check_rule: "After completing any action, re-check Step 2 (reply queue). A reply may have arrived during the action. Replies always take priority over continuing down the step list.",

  commitment_override: "Step 1 supersedes everything. When a buyer says 'yes': invoice within 60 min. All other steps wait. This is the only exception to the normal queue order.",
};


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 7: OUTPUT F — MEMORY PERSISTENCE RULES
// ══════════════════════════════════════════════════════════════════════════════

export const MEMORY_PERSISTENCE = {

  must_survive_to_tomorrow: [
    "All lead records with stage != killed (active pipeline)",
    "All timer records with status: active (pending actions)",
    "All champion records with signer_engaged: false (unresolved champion paths)",
    "All active_deal records (pricing through delivery)",
    "All artifact records with status != sent (pending builds/reviews)",
    "Discovery queue for tomorrow (pre-researched leads)",
    "Surface stats (cumulative counts for reallocation decisions)",
    "Tier assignments for all active leads",
  ],

  gets_archived: [
    "Killed lead records → move to archive after learning_record is created. Keep in archive for 90 days (for pattern detection across killed leads).",
    "Completed timers (status: fired + action_completed) → archive after 7 days.",
    "Sent artifacts → archive after 30 days (keep reference for template reuse).",
    "Paid deals → archive after delivery + 30 days post-delivery support window.",
  ],

  gets_downgraded_automatically: [
    "Tier 1 lead with no event for 48h → demote to Tier 2",
    "Tier 2 lead with no event for 7 days → demote to Tier 3",
    "Tier 3 lead with no event for 14 days → demote to Tier 4 or kill",
    "Champion with kit_sent + no signer_engaged for 10 days → champion strength: weak, lead demoted",
    "Surface stats with 0 meaningful replies at 50+ sent → surface status: failed",
  ],

  reactivation_conditions: [
    "Lead with stage: stalled + timer: reactivation_30d fires → re-enter as contacted, Tier 4",
    "Killed lead who contacts US (inbound) → re-create as interested, Tier 2 (they came back = real intent)",
    "Paused surface that gets a late reply from an old send → reactivate lead only, not the surface",
  ],

  dead_stays_dead: [
    "Hard no ('not interested', 'remove me', 'stop emailing') → permanently killed. No reactivation timer.",
    "Below price floor + refused counter → permanently killed.",
    "Marketplace buyer who ghosted after price counter → permanently killed.",
    "Angry reply + apology sent → permanently killed. Do not re-contact.",
  ],

  memory_decay: {
    hot: "0-48h old state = fully current. Actions based on this are high confidence.",
    warm: "3-7 days old = probably current. Check for updates before acting.",
    cooling: "8-14 days old = may be stale. Verify before any significant action (scope, pricing).",
    cold: "15-30 days old = likely stale. Treat as reactivation candidate, not active lead.",
    expired: "30+ days old = archived. Only resurface via reactivation_30d timer or inbound from lead.",
  },
};


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 8: OUTPUT G — SYSTEM CHANGES
// ══════════════════════════════════════════════════════════════════════════════

export const SYSTEM_CHANGES = {

  data_model: {
    change: "Create execution-state.json as the live operating state",
    structure: {
      leads: "array of lead objects per STATE_OBJECTS.lead schema",
      champions: "array of champion objects",
      active_deals: "array of deal objects",
      artifacts: "array of artifact objects",
      timers: "array of timer objects",
      queues: {
        reply: "lead_ids with unprocessed replies",
        timer: "timer_ids firing today",
        tier1: "lead_ids in Tier 1 with pending actions",
        tier2: "lead_ids in Tier 2 with pending actions",
        artifact: "artifact_ids pending build",
        discovery: "lead_ids researched and ready for first-touch",
        research: "business_ids needing enrichment",
        kill: "lead_ids pending kill/archive",
      },
      surface_stats: "per-surface performance counters",
      session_metadata: {
        last_session_date: "ISO date",
        discovery_touches_today: "number",
        kirill_reviews_used: "number",
        next_session_priorities: "string[]",
      },
    },
  },

  timer_handling: {
    change: "Timer registry with automatic fire detection",
    implementation: "On each session start: scan timers where fire_date <= today AND status = active. Move to timer_queue. Process in priority order. After action: update timer status to fired.",
  },

  queue_handling: {
    change: "8 priority-ordered queues with automatic population",
    implementation: "On session start: populate reply_queue from inbox check. Populate timer_queue from timer scan. Populate tier queues from lead records. Populate discovery_queue from pre-researched leads. Process in order: reply → timer → tier1 → tier2 → artifact → discovery → research → kill.",
  },

  tier_updates: {
    change: "Event-driven tier promotion/demotion per STATE_TRANSITION_MAP",
    implementation: "Every event (reply, silence, timer fire, commitment) triggers a transition lookup. Transition specifies new tier, timers to start/cancel, queues to enter/exit. Updates are atomic.",
  },

  next_action: {
    change: "10-step execution loop replaces 'figure out what to do'",
    implementation: "Loop reads queues in order, picks first actionable item, executes, updates state, re-checks reply queue, continues. No reasoning about priorities needed — the queue order IS the priority.",
  },

  day_start_view: {
    change: "Command center view from execution state",
    produces: "On session start, display: (1) Tier 1 leads + pending actions. (2) Timers firing today. (3) Unprocessed replies. (4) Discovery queue depth. (5) Pipeline health (active leads count). This is the 5-min morning briefing, generated from state.",
  },

  end_of_day: {
    change: "Formalized persistence protocol",
    implementation: "Last 15 min: update all lead stages. Update timer fire dates. Populate tomorrow's discovery queue. Save execution-state.json. Note next session priorities.",
  },

  follow_up_automation: {
    change: "Timer-driven follow-up instead of memory-based",
    implementation: "Every outreach action creates a timer. Timer fires → follow-up enters timer_queue → system sends pre-written message. No human memory required. Kirill only involved for champion/partner follow-ups (semi_auto).",
  },

  artifact_tracking: {
    change: "Artifact lifecycle tracking from request to delivery",
    implementation: "Artifact requested → enters artifact_queue with due_by (Tier-based SLA). Build started → status: building. Complete → status: ready, enters Kirill review if needed. Sent → status: sent. Reused → new record with base_template_id reference.",
  },
};


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 9: OUTPUT H — FINAL EXECUTION DOCTRINE
// ══════════════════════════════════════════════════════════════════════════════

export const EXECUTION_DOCTRINE = {
  statement:
    "The system is a stateful execution organism. It does not reason about what to do — it reads its state and executes the highest-priority action from its queues. Events change the state. State changes update the queues. Queues determine the action. Actions produce events. The loop runs until the session ends. Between sessions, state persists. Tomorrow starts where today left off.",

  principles: [
    {
      id: 1,
      principle: "State is truth. Queues are decisions. Actions are execution.",
      operational: "The system never asks 'what should I do?' It asks 'what does the state say?' Lead X is in pricing_active with reply_sla timer at 45 min → action: draft scope response. Champion Y has kit_sent 8 days ago with signer_engaged: false → action: follow-up or prepare timeout. The state CONTAINS the decision.",
    },
    {
      id: 2,
      principle: "Every event has exactly one set of state consequences.",
      operational: "When a reply arrives, the transition map specifies: new stage, new tier, timers to start, timers to cancel, queues to enter. No ambiguity. No judgment needed for the STATE UPDATE — only for the CONTENT of the response. The what-to-do-next is mechanical. The how-to-do-it is where intelligence goes.",
    },
    {
      id: 3,
      principle: "Timers are not reminders. They are action triggers.",
      operational: "A timer that fires changes execution state: a lead moves from 'waiting' to 'follow-up-due.' The follow-up enters the timer_queue. The system processes it in queue order. If the timer is ignored for 24h → escalation. Timers are the system's autonomic nervous system — they ensure nothing is forgotten even when attention is elsewhere.",
    },
    {
      id: 4,
      principle: "Queues are processed in fixed priority order. Always.",
      operational: "Reply → Timer → Tier 1 → Tier 2 → Artifact → Discovery → Research → Kill. This order never changes. A discovery batch is NEVER processed before a Tier 1 pending action. A marketplace reply is NEVER processed before a warm-intro pricing question. The queue order IS the strategy, encoded as execution priority.",
    },
    {
      id: 5,
      principle: "State must persist or the system resets to zero every morning.",
      operational: "End-of-session: save all lead records, timer states, queue contents, tier assignments, surface stats. Start-of-session: load state, scan timers, populate queues, display command center, begin execution loop. The 15-minute end-of-day save is what makes the 5-minute morning start possible. Without persistence, every morning is a 30-minute reconstruction.",
    },
    {
      id: 6,
      principle: "Stale state is more dangerous than no state.",
      operational: "A lead marked as 'Tier 1, pricing_active' from 2 weeks ago is not Tier 1 anymore — it's stalled or dead. Memory_decay rules apply: 0-48h = current. 3-7d = probably current. 8-14d = verify. 15-30d = reactivation candidate. 30d+ = archived. The system must auto-downgrade leads whose state hasn't been updated by real events.",
    },
    {
      id: 7,
      principle: "The commitment override is the one exception to everything.",
      operational: "When a buyer says 'let's do it': the execution loop breaks. All queues pause. Invoice within 60 minutes. This is the only event that supersedes queue priority, timer schedules, discovery floors, and session plans. Commitment events are the organism's feeding response — when prey is caught, everything else waits.",
    },
    {
      id: 8,
      principle: "The system learns from state patterns, not from individual events.",
      operational: "After 20+ leads have passed through the state machine, patterns emerge: 'leads that reach pricing_active from review-based surface close 3x more than from directory surface.' 'Champion paths with strength: strong close 4x more than strength: weak.' These patterns come from STATE DATA, not from reasoning. The state machine is also the learning machine.",
    },
  ],
};


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 10: PRACTICAL SUMMARY
// ══════════════════════════════════════════════════════════════════════════════

export const PRACTICAL_SUMMARY = {

  top_5_state_rules: [
    "1. EVERY LEAD HAS A RECORD WITH STAGE, TIER, TIMERS, AND PENDING ACTION. No lead exists in the system's awareness without a state record. 'I think there was a plumbing lead...' = state failure. The record is the truth. If it's not in the record, it doesn't exist.",
    "2. EVERY EVENT TRIGGERS A STATE TRANSITION. Reply received → stage changes, tier recalculated, timers updated, queues re-populated. The transition map is mechanical — no judgment needed for the state update itself. Intelligence goes into the response content, not into figuring out what changed.",
    "3. STATE PERSISTS BETWEEN SESSIONS. End-of-session: save everything. Start-of-session: load everything. The 15-minute save protocol creates the 5-minute start protocol. Without persistence, every morning is a 30-minute reconstruction from memory files.",
    "4. STALE STATE AUTO-DEGRADES. Tier 1 with no event for 48h → Tier 2. Tier 2 with no event for 7d → Tier 3. Champion with no signer for 10d → strength: weak. These happen automatically. The system doesn't keep dead leads warm out of optimism.",
    "5. THE STATE MACHINE IS ALSO THE LEARNING MACHINE. After 20+ leads pass through, patterns in state data reveal: which surfaces produce closeable leads, which objections are terminal, which champion types deliver signers. State data → pattern detection → rule updates. This is how the system improves.",
  ],

  top_5_timer_rules: [
    "1. EVERY OUTREACH ACTION CREATES A TIMER. Email sent → follow_up_48h timer. Scope sent → follow_up_48h. Kit sent to champion → champion_timeout_10d. Commitment received → payment_wait_48h. No action without a timer = no follow-through guarantee.",
    "2. TIMERS FIRE INTO QUEUES, NOT INTO HUMAN MEMORY. When a timer fires, its action enters the appropriate queue. The system processes it in queue order. Kirill doesn't remember 'I need to follow up with that plumber Wednesday' — the timer remembers and the queue presents it.",
    "3. REPLIES CANCEL PENDING TIMERS. Any reply from a lead cancels their pending follow-up timer. The reply enters the reply_queue instead. This prevents: sending a follow-up 2 hours after the lead already responded.",
    "4. CHAMPION TIMEOUT IS 10 DAYS, NOT INFINITE. Kit sent → 10 days → if no signer engagement → final message to champion → demote or kill. This prevents the #1 attention leak: champion paths that consume follow-up effort for weeks with zero signer engagement.",
    "5. REACTIVATION IS 30 DAYS, ONE SHOT. Leads lost to timing (not hard no) get one 30-day reactivation touch. If no response → permanently killed. This captures the 'not right now' leads who become 'now' — without creating zombie leads that never die.",
  ],

  top_5_queue_rules: [
    "1. FIXED PRIORITY ORDER: REPLY → TIMER → TIER1 → TIER2 → ARTIFACT → DISCOVERY → RESEARCH → KILL. This order never changes. A Tier 1 pricing question always beats a discovery batch. A discovery batch always beats research. Research always beats processing kills. The order IS the strategy.",
    "2. RE-CHECK REPLY QUEUE AFTER EVERY ACTION. A reply may have arrived during a 10-minute scope draft. Replies always jump to the front. Process the reply, then continue where you left off.",
    "3. DISCOVERY QUEUE MUST HAVE 5+ ITEMS EVERY MORNING. End-of-day prep fills tomorrow's discovery queue. If it's empty → morning starts with research instead of sending. This costs 30-45 minutes of prime sending time. The prep protocol prevents this.",
    "4. EVERY TIER 1 LEAD MUST HAVE EXACTLY ONE PENDING ACTION. If a Tier 1 lead has no defined next action → state is incomplete. Either: they need a response (→ reply queue), they need an artifact (→ artifact queue), or they're waiting for a timer (→ timer queue). 'No pending action' for Tier 1 = bug.",
    "5. KILL QUEUE IS PROCESSED WEEKLY, NOT DAILY. Dead leads waiting to be archived don't need same-day processing. Friday review = process all kills, create learning records, clean pipeline. This prevents kill processing from stealing time from active deal work.",
  ],

  top_3_doctrine_changes: [
    "1. CREATE EXECUTION-STATE.JSON AS THE LIVE OPERATING STATE. This single file (or DB table) contains: all leads with stages/tiers/timers, all queues, all champions, all deals, all artifacts, all surface stats. Session start = load state. Session end = save state. This is the #1 change that converts the system from a reasoning engine into an execution organism.",
    "2. IMPLEMENT THE 10-STEP EXECUTION LOOP AS THE SESSION DRIVER. No more 'what should I do next?' The loop reads queues in fixed priority order and picks the first actionable item. Intelligence goes into response content and judgment calls, not into deciding what to work on. The queue order handles prioritization mechanically.",
    "3. IMPLEMENT TIMER REGISTRY WITH AUTOMATIC FIRE DETECTION. Every outreach action creates a timer. Session start scans for timers due today. Fired timers enter queues. This single mechanism prevents: missed follow-ups, zombie champion paths, stale leads sitting in active pipeline, and the mental load of tracking 15+ pending deadlines in human memory.",
  ],
};
