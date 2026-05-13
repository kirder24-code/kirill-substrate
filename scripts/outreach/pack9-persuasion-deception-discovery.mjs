/**
 * Pack 9 — Persuasion, Pressure Negotiation, Deception Detection & Discovery Discipline
 *
 * Two mandates:
 * 1. DISCOVERY: find buyers across all viable surfaces, read signals correctly, choose route
 * 2. CONVERSION: handle hesitation, pressure negotiation, detect false signals, protect margin
 *
 * The system must be equally strong at finding clients and converting them.
 * Client discovery is a PRIMARY survival function, not secondary to deal handling.
 *
 * Sources: Close (5 articles reuse), Hormozi Offers + Leads (reuse),
 * Packs 6-8 (synthesis), Stress Tests 2-3 (applied cases).
 */

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 1: STRUCTURED RULES — PER SOURCE EXTRACTION
// ══════════════════════════════════════════════════════════════════════════════

export const PACK9_EXTRACTED_RULES = [

  // ── DISCOVERY SURFACE RULES ───────────────────────────────────────────────

  {
    source: "Hormozi — $100M Leads: Core Four + Discovery Surfaces (synthesis)",
    tier: "primary",
    type: "discovery_surface_mandate",
    pattern: "Hormozi Core Four: warm outreach → free content → cold outreach → paid ads. But discovery surfaces extend far beyond these four CHANNELS. Surfaces = WHERE you find buyer signals. Channels = HOW you contact them. A hiring signal on Indeed is a surface. Cold email to that company is the channel. System must scan ALL surfaces and route through the best channel for each.",
    evidence: "Hormozi sequence: warm → content → cold → ads. Pack 5: owner email + tool signal = highest lead. Pack 6: daily loop starts with reply check, then outreach.",
    anti_pattern: "Only scanning one surface (e.g., Yellow Pages). Only using one channel (e.g., cold email). Assuming discovery is done once during list building. Not re-scanning surfaces as new signals appear.",
    applicable_to_us: true,
    why_applicable: "System currently discovers leads via Yellow Pages scrape for cold email. This is ONE surface, ONE channel. Must expand to: LinkedIn connections, Google reviews, job boards, Reddit threads, local directories, tool-specific communities, Nextdoor, Facebook groups, referral asks, review sites.",
    confidence: "high",
    extracted_rule: "Discovery is continuous, not a one-time list build. System must scan multiple surfaces daily and route discovered leads through the best channel. Surface → signal → qualification → channel selection → contact. A lead discovered on Indeed (hiring dispatcher) might be best contacted via warm LinkedIn intro, not cold email.",
    target_component: "find-businesses.mjs, daily operating loop (Pack 6), send-outreach.mjs",
    expected_metric_change: "broader lead pipeline, higher quality leads from multi-surface discovery",
    review_window: "30 days",
    risk: "medium — too many surfaces at once = shallow scanning. Prioritize 5-6 highest-signal surfaces.",
    apply_mode: "build",
  },
  {
    source: "Pack 5 Client Hunting + Pack 8 Route Quality (synthesis)",
    tier: "primary",
    type: "surface_signal_mapping",
    pattern: "Each discovery surface produces different signal types and different buyer types. LinkedIn = warm connections + growth signals. Google Reviews = business health + customer volume. Indeed/job boards = hiring = growth pain. Reddit = pain-in-own-words. Directories = contact info. Tool communities = budget for tools. Each surface requires different qualification and different route.",
    evidence: "Pack 5: owner email + tool signal = top lead. Pack 8: Hormozi route hierarchy: warm > content > cold > paid.",
    anti_pattern: "Treating all discovered leads the same regardless of source surface. Using same email template for a lead found via warm intro vs one scraped from directory. Not adapting route to discovery context.",
    applicable_to_us: true,
    why_applicable: "A landscaping owner found via Alex's LinkedIn intro requires a completely different first message than the same owner found via Yellow Pages scrape. The surface determines the route.",
    confidence: "high",
    extracted_rule: "Surface → Route mapping is mandatory. Lead from warm network → warm personal message. Lead from LinkedIn → warm-ish DM referencing mutual connection or their content. Lead from Reddit pain thread → helpful comment first, DM later. Lead from directory/scrape → cold email with audit. Lead from job board (hiring) → cold email referencing their growth. NEVER use cold email template for warm-discovered leads.",
    target_component: "send-outreach.mjs (route selection per source), write-email.mjs",
    expected_metric_change: "higher response rate from route-matched outreach",
    review_window: "after 30 multi-surface sends",
    risk: "low",
    apply_mode: "build",
  },

  // ── PERSUASION RULES ──────────────────────────────────────────────────────

  {
    source: "Close — 'I Need to Think About It' + Pack 8 Buyer Psychology (synthesis)",
    tier: "primary",
    type: "hesitation_classification",
    pattern: "5 types of hesitation: (1) Healthy processing — they need 24-48h to genuinely decide. Give space + time-bound check-in. (2) Unvoiced specific concern — something bothers them but they won't name it. Diagnostic question extracts it. (3) Authority gap — they need someone else's approval. Shift to champion-equipping. (4) Polite exit — they've decided no but avoid saying it. Test with permission: 'If timing isn't right, totally fine to say so.' (5) Fear paralysis — they want to buy but fear of wrong decision freezes them. Guarantee + simplicity defuses this.",
    evidence: "Close: 3 types of No (generic, maybe, real). Pack 8: 'silence after think-about-it is where deals die.'",
    anti_pattern: "Treating all hesitation as 'they need more time.' Pushing harder on someone who's politely exiting. Waiting passively on someone who has an unvoiced concern. Sending more information to someone who's fear-paralyzed (information increases fear, doesn't reduce it).",
    applicable_to_us: true,
    why_applicable: "Stress Test 3: plumbing sister's brother is predicted to hesitate ('hates complicated tech'). That's Type 5 (fear paralysis). Response = simplicity + guarantee, not more features or harder push.",
    confidence: "high",
    extracted_rule: "After any hesitation signal, classify type before responding: (1) Healthy → give 48h, one check-in. (2) Unvoiced concern → 'Is there something specific I can clarify?' (3) Authority gap → 'Does someone else need to weigh in?' (4) Polite exit → 'If timing isn't right, no worries at all.' (5) Fear paralysis → simplify offer + emphasize guarantee + reduce perceived commitment ('just the pilot, 3 days, $750, nothing to lose').",
    target_component: "deal-assist.mjs (hesitation_type classification)",
    expected_metric_change: "correct response to each hesitation type, fewer mishandled stalls",
    review_window: "after 10 hesitation encounters",
    risk: "low",
    apply_mode: "build",
  },
  {
    source: "Close — Follow Up + Buying Signals + Pack 8 Signal Patterns (synthesis)",
    tier: "primary",
    type: "momentum_creation",
    pattern: "Moving from 'sounds good' to concrete next step requires a SPECIFIC ask, not an open question. 'Want to move forward?' = vague (easy to defer). 'I can start Monday — should I send the invoice?' = concrete (forces yes/no). 'Would Thursday work for a quick look at the demo?' = specific. The buyer's brain needs a defined action to commit to, not a general sentiment to agree with.",
    evidence: "Close: 'Specify next steps explicitly. Book subsequent meeting immediately.' Hormozi: reduce time delay and effort to increase value perception.",
    anti_pattern: "Ending messages with 'let me know what you think' (invites delay). Asking 'are you interested?' (they already said they were). Leaving the next step undefined.",
    applicable_to_us: true,
    why_applicable: "Our scope template ends with 'Want to move forward?' — decent but improvable. Should be: 'Want to move forward? I can start [specific day].' The concrete date makes it real.",
    confidence: "high",
    extracted_rule: "Every message that advances the deal must end with a SPECIFIC next step, not an open question. Templates: After breakdown → 'Want me to put together a specific scope? Takes 5 min to read.' After scope → 'Want to move forward? I can start [next Monday].' After demo → 'Should I send the scope with pricing?' After pricing → 'Invoice for $375 to start — should I send it?' Each step narrows to a binary yes/no with a concrete action attached.",
    target_component: "deal-assist.mjs (all response templates — CTA rewrite)",
    expected_metric_change: "faster stage progression, fewer indefinite 'maybe' states",
    review_window: "after 10 scope/pricing conversations",
    risk: "low — specificity feels helpful, not pushy",
    apply_mode: "build",
  },
  {
    source: "Hormozi — $100M Offers: Urgency Without Pressure (synthesis)",
    tier: "primary",
    type: "natural_urgency",
    pattern: "Ethical urgency comes from REAL constraints, not manufactured ones. For service businesses: seasonal timing is real urgency. Capacity limits are real urgency. 'I can take on 2 new projects this month' is real (if true). 'Special offer expires Friday' is manufactured (and transparent). The best urgency = the buyer's own timeline: 'You mentioned spring is your busy season — if the follow-up is running before April, you catch the first wave of estimates.'",
    evidence: "Hormozi: 4 ethical urgency methods (cohort, seasonal, pricing, exploding opportunity). Pack 6: seasonal timing = real urgency for HVAC/landscaping/roofing.",
    anti_pattern: "Manufactured deadline when no real deadline exists. Fake scarcity ('only 2 spots left') when capacity is unlimited. Pressuring a decision when the buyer genuinely needs time. Creating urgency for urgency's sake.",
    applicable_to_us: true,
    why_applicable: "Our real urgency sources: (1) seasonal timing for service businesses, (2) Kirill's capacity (solo operator, genuinely limited slots), (3) existing revenue leak getting worse daily. All three are honest and usable.",
    confidence: "high",
    extracted_rule: "Only use urgency that is TRUE: (1) Seasonal: 'Spring estimates start in [weeks] — if the system is running before then, you catch every one.' (2) Capacity: 'I can take on [X] projects this month' (only say when true). (3) Cost of delay: 'Every week without follow-up automation is another $[X] in estimates going cold.' Never fabricate deadlines or scarcity.",
    target_component: "deal-assist.mjs (urgency framing in scope/follow-up templates)",
    expected_metric_change: "decision acceleration without trust damage",
    review_window: "after 5 scope conversations",
    risk: "medium — capacity urgency must be honest. Lying about slots = trust collapse if discovered.",
    apply_mode: "semi_auto",
  },

  // ── PRESSURE NEGOTIATION RULES ────────────────────────────────────────────

  {
    source: "Close — 'Too Expensive' + Hormozi Pricing + Pack 7-8 Negotiation (synthesis)",
    tier: "primary",
    type: "repeated_pressure_defense",
    pattern: "Buyers who pressure on price don't stop after one attempt. Pattern: (1) 'Too expensive' → you offer pilot. (2) 'Can you do the pilot cheaper?' → second push. (3) 'What if we just need the basic version?' → scope reduction request that's really another price push. (4) 'We might have more work later' → future promise as leverage for current discount. Each escalation tests whether you'll keep folding. If you fold twice, they'll push a third time.",
    evidence: "Pack 7: 'first price anchors all future deals.' Pack 8: 'never discount main offer — add bonuses instead.' Hormozi: 'people want expensive things, they just need a reason.'",
    anti_pattern: "Folding on each successive push. Offering new concession each time without removing scope. Treating each push as a new negotiation instead of a continuation. Never walking away.",
    applicable_to_us: true,
    why_applicable: "Stress Test 3: roofing owner said '$1,000 cap.' If after offering $750 pilot they say 'can you do $500?' — that's the second push. If we fold → next push will be $300. System must recognize multi-round pressure.",
    confidence: "high",
    extracted_rule: "PRESSURE ESCALATION PROTOCOL: Push 1 ('too expensive') → diagnose root, offer pilot if budget is real. Push 2 ('cheaper?') → hold: '$750 is the pilot floor — includes guarantee and support.' Push 3 ('what about basic?') → tradeoff: 'I can remove the guarantee and support for $500, but I'd recommend the $750 version.' Push 4 (any further) → walk: 'Sounds like the fit might not be right at this price point. Happy to reconnect if that changes.' Max 3 concession conversations. After that = they're squeezing, not buying.",
    target_component: "deal-assist.mjs (pressure_round tracking per lead)",
    expected_metric_change: "protected floor price, fewer multi-round negotiations ending in bad deals",
    review_window: "after 5 multi-round negotiations",
    risk: "medium — walking away from real buyer who genuinely can only afford $500. Acceptable: we can't deliver value at $500.",
    apply_mode: "build",
  },
  {
    source: "Pack 7 Scope Protection + Pack 8 Negotiation Architecture (synthesis)",
    tier: "primary",
    type: "tradeoff_not_discount",
    pattern: "When buyer pushes on price, offer TRADEOFF not discount. Remove scope, don't reduce price on same scope. 'I can do $500 but without the guarantee and support' = tradeoff. '$500 for the same thing' = discount. Tradeoffs protect margin AND educate the buyer on what they're paying for. When they see what gets removed, they often realize the full price was fair.",
    evidence: "Hormozi: 'never discount, add bonuses.' Pack 7: 'never absorb scope without price.' Pack 8: validate → phase → price.",
    anti_pattern: "Reducing price without reducing anything. Offering 'just this once' discount. Removing invisible things (support, guarantee) without making the removal explicit. Bundling more into the same price.",
    applicable_to_us: true,
    why_applicable: "Our tradeoff stack: $750 pilot = workflow + walkthrough + docs + 7 days support + guarantee. $500 = workflow + walkthrough only. No support, no guarantee, no docs. This makes $750 look like the obvious choice.",
    confidence: "high",
    extracted_rule: "TRADEOFF STACK for price pressure: $750 = full pilot (workflow + walkthrough + docs + 7 days support + guarantee). $500 = stripped (workflow + walkthrough only, no support, no guarantee, no docs). $375 = diagnostic only (assessment + recommendation, no build). Present all three if buyer pushes hard. Most choose $750 after seeing what $500 lacks. If they choose $500 → they get $500 worth of work, which is exactly fair.",
    target_component: "deal-assist.mjs (tiered_offer presentation)",
    expected_metric_change: "most buyers self-select to $750 after seeing tradeoffs",
    review_window: "after 5 price negotiations",
    risk: "low — transparent and fair",
    apply_mode: "build",
  },

  // ── FALSE SIGNAL / DECEPTION DETECTION ────────────────────────────────────

  {
    source: "Pack 6 Self-Correction + Stress Tests 2-3 (synthesis)",
    tier: "primary",
    type: "false_signal_taxonomy",
    pattern: "10 categories of false signals observed across stress tests and pack learnings: (1) Fake urgency: 'need this ASAP' but takes 2 weeks to respond. (2) Fake budget ceiling: stated limit is negotiation anchor, not real constraint. (3) Fake partner check: partner doesn't exist or champion never forwards. (4) Fake champion strength: 4 messages of enthusiasm, zero follow-through with signer. (5) Fake curiosity as evaluation: 'send prices' with no intent to buy. (6) Fake interest for intel: collecting pricing to use with cheaper vendor. (7) Fake 'maybe later': permanent no dressed as timing. (8) Fake complexity fear: actually means 'I don't trust you.' (9) Fake price objection: actually weak pain. (10) Fake internal process: 'it has to go through approval' = soft no.",
    evidence: "ST2: HVAC authority discovered at msg 6. ST3: plumbing brother predicted to say no to 'complicated tech.' Pack 6: 'mistaking warm politeness for intent.'",
    anti_pattern: "Taking all signals at face value. Assuming stated urgency is real. Assuming stated budget ceiling is hard. Assuming champion enthusiasm equals signer engagement. Treating every 'interested' as buying intent.",
    applicable_to_us: true,
    why_applicable: "At 0 clients, every positive signal feels precious. The temptation to interpret everything optimistically is strongest when you're desperate for validation. System must be SKEPTICAL of positive signals, not optimistic.",
    confidence: "high",
    extracted_rule: "VERIFICATION RULE: Every positive signal gets ONE verification test before the system invests heavily. Urgency → verified by response speed (claim urgency but reply in 5 days = fake). Budget → verified by reaction to pricing (real budget constraint = asks about pilot; fake = disappears). Champion → verified by follow-through (strong = relays signer feedback; fake = goes silent). Interest → verified by answering qualifying question (real = answers; fake = deflects). Do NOT invest more than 15 minutes in any signal that hasn't passed verification.",
    target_component: "deal-assist.mjs (signal_verified boolean per lead), confidence scoring",
    expected_metric_change: "50%+ reduction in time wasted on false signals",
    review_window: "after 20 signals processed",
    risk: "low — verification is a single question, not interrogation",
    apply_mode: "build",
  },
  {
    source: "Pack 8 Ambiguity Protocol + Pack 6 Failure Modes (synthesis)",
    tier: "primary",
    type: "deception_specific_rules",
    pattern: "Specific deception patterns with detection and response: FAKE URGENCY → test: if they say 'urgent' but don't respond to your message within 24h, urgency is performative. FAKE BUDGET → test: Virtual Close ('if I could do $X, would we have a deal right now?') — if new objections appear, budget was smokescreen. FAKE PARTNER → test: 'When do you think they'll look?' + 'Would it help if I spoke with them?' — if both deflected, partner may not exist as real gate. FAKE MARKETPLACE UPSIDE → 'more work later' is NEVER bankable. Evaluate current deal only.",
    evidence: "Close Virtual Close technique. Pack 8 ambiguity: dangerous unknowns must be resolved. ST3: Fiverr 'more work later' correctly identified as non-bankable.",
    anti_pattern: "Believing stated urgency without behavior match. Believing stated budget without testing it. Believing 'more work later' promises from marketplace buyers. Waiting indefinitely for a partner who may not exist.",
    applicable_to_us: true,
    why_applicable: "Every stress test had at least one false signal. System must have detection rules that fire BEFORE heavy investment, not after.",
    confidence: "high",
    extracted_rule: "6 deception detection tests, each requiring <30 seconds: (1) URGENCY TEST: Do they respond within 24h of their own 'urgent' claim? If no → fake urgency. (2) BUDGET TEST: Virtual Close — 'If I could do [$X], would we have a deal?' New concerns = smokescreen. (3) PARTNER TEST: Ask for timeline + offer direct access. Both deflected = likely no real partner gate. (4) CHAMPION TEST: Did champion relay signer's specific feedback within stated timeline? If not → champion didn't forward. (5) INTEREST TEST: Did they answer qualifying question? If deflected → not real interest. (6) MARKETPLACE TEST: 'More work later' — evaluate ONLY the current deal at current price. Future promises = $0 value.",
    target_component: "deal-assist.mjs (deception_flags per lead), confidence scoring",
    expected_metric_change: "earlier exit from deceptive situations",
    review_window: "after 15 deals tracked",
    risk: "medium — false positive on deception test could kill real deal. Use as FLAG not as auto-kill.",
    apply_mode: "semi_auto",
  },

  // ── DISCOVERY-SPECIFIC RULES ──────────────────────────────────────────────

  {
    source: "Pack 5 Client Hunting + Hormozi Leads + Stress Tests (synthesis)",
    tier: "primary",
    type: "discovery_surface_catalog",
    pattern: "16 discovery surfaces exist for our ICP, each with different signal types, buyer types, and optimal routes. System must scan at least 5 surfaces continuously, not just cold email list building.",
    evidence: "Pack 5: owner email + tool signal = top lead. Hormozi: warm > cold. ST3: Reddit ops manager → owner was promising path. Pack 5: Thumbtack users = high-value leads.",
    anti_pattern: "Only using Yellow Pages scrape. Only using one surface per day. Not adapting route to surface. Treating all surfaces as equal signal quality.",
    applicable_to_us: true,
    why_applicable: "Current system discovers leads from: Yellow Pages scrape (for cold email), Reddit threads (for comments), LinkedIn (manual). Must expand to: Google reviews, job boards, Jobber/HCP communities, Nextdoor, Facebook groups, referral asks, review site scanning.",
    confidence: "high",
    extracted_rule: "See DISCOVERY_SURFACE_MAP export below for full 16-surface catalog with signals, buyer types, routes, and ignore rules per surface.",
    target_component: "find-businesses.mjs, daily operating loop, portfolio strategy",
    expected_metric_change: "3-5x broader lead pipeline from multi-surface discovery",
    review_window: "30 days",
    risk: "medium — must not spread too thin. Prioritize top 6 surfaces.",
    apply_mode: "build",
  },

  // ── META-LEARNING RULES ───────────────────────────────────────────────────

  {
    source: "Pack 6 Self-Correction + Pack 7-8 Learning Loop (synthesis)",
    tier: "primary",
    type: "misleading_signal_learning",
    pattern: "When a signal looked strong but was false, the system must log the DISCREPANCY (what was expected vs what happened) not just the outcome. The discrepancy reveals which verification was missing. 1 misleading case = anecdote (log, don't change). 3 misleading cases with same pattern = new detection rule. Never change system-wide behavior from one deceptive case — that's over-learning.",
    evidence: "Pack 6: '1 outcome = anecdote, 3 = pattern, 5 = rule.' Pack 7: 'avoid learning wrong lesson from one case.'",
    anti_pattern: "Over-learning from one deceptive case ('champions never work' after one silent champion). Under-learning from repeated deception ('keep trusting marketplace promises' after 3 fake 'more work later'). Not logging the discrepancy (only logging 'lost').",
    applicable_to_us: true,
    why_applicable: "System will encounter misleading signals. The discipline is: log what was misleading and WHY, but don't overreact to a single case. Pattern emerges only after 3+ identical discrepancies.",
    confidence: "high",
    extracted_rule: "MISLEADING SIGNAL LOG: For every signal that turned out false, record: { signal_type, what_we_expected, what_actually_happened, which_verification_would_have_caught_it, system_change_needed: 'none' | 'flag_added' | 'rule_changed' }. Change system_change_needed from 'none' to 'flag_added' only after 3 identical discrepancies. Change to 'rule_changed' only after 5+.",
    target_component: "win/loss protocol (Pack 7), confidence scoring, deal-assist.mjs",
    expected_metric_change: "system improves detection without over-correcting",
    review_window: "after 15 deals",
    risk: "low",
    apply_mode: "auto",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 2: DISCOVERY SURFACE MAP
// ══════════════════════════════════════════════════════════════════════════════

export const DISCOVERY_SURFACE_MAP = [
  {
    surface: "Warm network (Kirill's contacts)",
    signal_type: "Personal connection, shared context, existing trust",
    buyer_type: "Friends, ex-colleagues, community contacts who know service business owners",
    what_signal_matters: "Someone Kirill knows personally who either owns a service business OR knows someone who does",
    optimal_route: "Personal message: 'Hey, I help service businesses stop losing clients to slow follow-up. Know anyone who might need that?'",
    what_to_ignore: "People who are enthusiastic but don't actually know service business owners",
    priority: 1,
    capacity: "525 LinkedIn connections. At 10/day = ~52 days. Finite. Use NOW.",
    expected_quality: "Highest conversion rate. 84% of B2B starts with referral.",
  },
  {
    surface: "Referrals from any contact",
    signal_type: "Introduction from someone the prospect trusts",
    buyer_type: "Service business owner connected through mutual contact",
    what_signal_matters: "Named introduction to a specific person at a specific company",
    optimal_route: "Warm email/message referencing the introducer by name",
    what_to_ignore: "Vague 'I'll mention you to someone' without a name or introduction",
    priority: 2,
    capacity: "Unlimited in theory. Grows after each successful delivery.",
    expected_quality: "Highest close rate. Borrowed trust = trust gap nearly eliminated.",
  },
  {
    surface: "LinkedIn (profiles, posts, connections)",
    signal_type: "Job titles, company pages, posted content, mutual connections, growth signals",
    buyer_type: "Service business owners who are active on LinkedIn. Calgary connections. 2nd-degree through mutual contacts.",
    what_signal_matters: "Owner title + service business + Calgary. Posts about business challenges. Hiring announcements. New service expansion.",
    optimal_route: "Connection request with 200-char note. Or DM if 1st-degree. Always reference mutual connection or their specific post.",
    what_to_ignore: "Companies with 100+ employees (too large). Non-service businesses. People with no activity (ghost profiles).",
    priority: 3,
    capacity: "~200 connection requests/week (LinkedIn limit). 200-char note limit (no Premium).",
    expected_quality: "Medium-high for 1st/2nd degree. Low for cold 3rd-degree.",
  },
  {
    surface: "Google Reviews / Google Maps",
    signal_type: "Business health, customer volume, reputation investment, owner responsiveness",
    buyer_type: "Service businesses that care about growth (have reviews) but aren't enterprise-level",
    what_signal_matters: "10-50 reviews = sweet spot (established, growing, not corporate). Owner responds to reviews = engaged owner. Recent review surge = growing. Review complaints about 'never called back' = our exact pain signal.",
    optimal_route: "Cold email with specific reference: 'I noticed your reviews mention great work but a few customers mention callback speed — that's exactly what I help with.'",
    what_to_ignore: "0 reviews (too new or doesn't care). 200+ reviews (likely too large/franchise). Only negative reviews (business may be failing).",
    priority: 4,
    capacity: "Unlimited scanning. 15 emails/day for contact.",
    expected_quality: "Medium. Cold but highly targeted if review signals are specific.",
  },
  {
    surface: "Job boards (Indeed, LinkedIn Jobs)",
    signal_type: "Hiring = growth = pain. Hiring dispatcher/estimator/office manager = specifically our ICP's pain",
    buyer_type: "Growing service businesses that need operational help",
    what_signal_matters: "Hiring: dispatcher, estimator, office manager, service coordinator. These roles = the company is feeling operational overload.",
    optimal_route: "Cold email: 'I noticed you're hiring a dispatcher — usually means more calls/estimates than your current setup can handle. What if the routine follow-ups handled themselves?'",
    what_to_ignore: "Hiring for leadership/executive roles (different pain). Hiring at staffing agencies. Job posts more than 30 days old (may be filled).",
    priority: 5,
    capacity: "Scan weekly. 5-10 new relevant postings/week in Calgary market.",
    expected_quality: "Medium-high. Growth pain is real and current. But cold = need strong first message.",
  },
  {
    surface: "Reddit (r/smallbusiness, r/sweatystartup, r/Entrepreneur, r/HVAC, r/Plumbing)",
    signal_type: "Pain described in own words, problems shared publicly, requests for help",
    buyer_type: "Service business owners (or ops people) posting about operational problems",
    what_signal_matters: "Posts about: losing estimates, can't follow up, too busy, things falling through cracks, need CRM help, overwhelmed with calls. These are our EXACT buyers describing their pain unprompted.",
    optimal_route: "Helpful comment first (value, no pitch). If they engage → DM. Never pitch in comments.",
    what_to_ignore: "Posts asking 'how to learn automation' (learners). Posts from large companies. Posts older than 48h (lost relevance). Posts in subreddits where we've been banned.",
    priority: 6,
    capacity: "3-5 comments/day. Manual posting required.",
    expected_quality: "Low volume, high signal. Pain is self-reported = strongest intent indicator.",
  },
  {
    surface: "Business directories (Yellow Pages, Yelp, BBB, local chambers)",
    signal_type: "Contact info, category, location, basic business details",
    buyer_type: "Any service business in target verticals + target geography",
    what_signal_matters: "Owner name findable. Personal email findable. Website exists. Category matches (landscaping, plumbing, HVAC, roofing, cleaning, electrical, moving, auto repair).",
    optimal_route: "Cold email with personalized audit paragraph",
    what_to_ignore: "Generic emails only (info@). No website. Enterprise/franchise. Categories outside ICP.",
    priority: 7,
    capacity: "Hundreds of leads. But quality depends on enrichment (owner name, email, website check).",
    expected_quality: "Low-medium. High volume, low conversion without enrichment. Better with research layer.",
  },
  {
    surface: "Company websites (direct research)",
    signal_type: "Tools used (Jobber, HCP, ServiceTitan visible), team size, services offered, estimate request forms, 'About Us' page with owner name",
    buyer_type: "Service businesses with online presence = invested in growth",
    what_signal_matters: "Tool badges/logins visible in footer (Jobber, HCP). 'Request an estimate' form = they get estimates. Team page with 5-20 people = right size. Owner name + photo = reachable.",
    optimal_route: "Cold email referencing their specific tools/setup: 'I noticed you use Jobber and have an estimate form on your site — what happens to estimates that don't get a callback?'",
    what_to_ignore: "No website (too small/too old-school for our service). Template website with no real content. Websites of franchises (decision made at HQ).",
    priority: 8,
    capacity: "5-10 deep researches/day. Time-intensive but highest quality cold leads.",
    expected_quality: "High for cold. Research makes cold feel warm.",
  },
  {
    surface: "Nextdoor / Facebook local groups",
    signal_type: "Local business recommendations, complaints about service businesses, business owners posting offers",
    buyer_type: "Local service business owners active in community",
    what_signal_matters: "Business owner posting in local group about their services. Neighbors recommending/complaining about service businesses (indirect signal). Posts like 'looking for a landscaper' = that landscaper has demand and may need follow-up help.",
    optimal_route: "Community engagement first. DM after establishing presence. Or: identify businesses being recommended and contact them directly via cold email.",
    what_to_ignore: "Consumer complaints about businesses (not our problem to solve). Groups with strict no-solicitation rules.",
    priority: 9,
    capacity: "30 min/day scanning. Manual.",
    expected_quality: "Low volume, hyperlocal. Good for Calgary-specific leads.",
  },
  {
    surface: "Tool-specific communities (Jobber Facebook group, HCP community, ServiceTitan forums)",
    signal_type: "Users discussing tool limitations, asking for integrations, complaining about missing features",
    buyer_type: "Service business owners/managers who ALREADY use and pay for tools = confirmed budget for tech",
    what_signal_matters: "Posts about: 'Jobber doesn't follow up on estimates automatically.' 'Wish HCP had better text follow-up.' 'How do you handle missed calls?' These are buying signals in disguise.",
    optimal_route: "Helpful answer in community: 'I've built this for a few businesses — here's how it works with Jobber.' DM if they engage.",
    what_to_ignore: "Posts about basic tool usage (not our ICP). Posts from Jobber/HCP employees (not buyers).",
    priority: 10,
    capacity: "15 min/day scanning. 1-2 helpful comments/day.",
    expected_quality: "High. Users with tools + expressed limitations = warm buyers.",
  },
  {
    surface: "Review sites (Capterra, G2, Software Advice — for OUR competitors)",
    signal_type: "Businesses reviewing competing automation tools = active buyers or recent buyers in our space",
    buyer_type: "Service businesses that looked at or tried competitor solutions",
    what_signal_matters: "Reviews mentioning: 'too expensive', 'didn't work for us', 'looking for something simpler'. These are FAILED COMPETITOR EXPERIENCES = they still have the pain.",
    optimal_route: "Cold email: 'I saw you tried [competitor]. A lot of service businesses find it's too complex. What I build is simpler — 3-step follow-up that runs behind [their tool].'",
    what_to_ignore: "Positive reviews with no complaints (satisfied buyer, not our prospect). Reviews from enterprise companies.",
    priority: 11,
    capacity: "Weekly scan. Low volume of relevant reviews.",
    expected_quality: "High if found. They already tried to solve the problem = validated pain + budget.",
  },
  {
    surface: "Thumbtack / HomeAdvisor profiles",
    signal_type: "Service businesses paying $30-60/lead for new customers = understand acquisition cost",
    buyer_type: "Service businesses that spend money on lead generation",
    what_signal_matters: "Active Thumbtack profile with recent reviews = spending on leads regularly. Our pitch: 'You pay $40/lead for new ones. Following up on existing estimates costs $0/lead.'",
    optimal_route: "Cold email with lead-cost comparison: 'You're paying [$X/lead] on Thumbtack. What if the estimates you already sent followed up on themselves?'",
    what_to_ignore: "Inactive profiles (no recent reviews). Businesses with <5 reviews (too new/small).",
    priority: 12,
    capacity: "Weekly scan. Cross-reference with directory leads.",
    expected_quality: "High. They understand cost-per-lead. Our ROI pitch clicks instantly.",
  },
  {
    surface: "Local events / trade shows / chamber of commerce",
    signal_type: "Face-to-face networking. Business owners in one room.",
    buyer_type: "Local business owners who invest time in growth activities",
    what_signal_matters: "Kirill attending and having real conversations. Business cards exchanged. Follow-up within 24h.",
    optimal_route: "In-person introduction → next-day email referencing conversation: 'Great meeting you at [event]. Here's that follow-up system I mentioned.'",
    what_to_ignore: "MLM/insurance people at networking events. Events with no service business attendees.",
    priority: 13,
    capacity: "1-2 events/month. High time investment but highest trust per contact.",
    expected_quality: "Very high per contact. In-person = maximum trust. Low volume.",
  },
  {
    surface: "ServiceTitan / Jobber / HCP public case studies and customer lists",
    signal_type: "Named service businesses using specific tools = confirmed tool signal + confirmed category",
    buyer_type: "Service businesses mentioned in tool vendor case studies, testimonials, or customer lists",
    what_signal_matters: "Named business + tool confirmed + category confirmed. Cross-reference with owner email search.",
    optimal_route: "Cold email: 'I noticed you use ServiceTitan — most ST users I talk to wish the estimate follow-up was more automated. Is that something your team deals with?'",
    what_to_ignore: "Businesses in case studies for features unrelated to our service. Very large businesses (100+ employees).",
    priority: 14,
    capacity: "One-time research. 20-50 leads extractable.",
    expected_quality: "Medium-high. Tool confirmed = budget exists. But cold contact.",
  },
  {
    surface: "Fiverr / Upwork (marketplace signals)",
    signal_type: "Businesses posting jobs for automation / follow-up / CRM work",
    buyer_type: "Businesses with proven budget who are actively seeking automation help",
    what_signal_matters: "Jobs posted for: 'CRM automation', 'follow-up system', 'missed call handling', 'estimate follow-up'. These are buyers with stated pain AND budget. BUT: marketplace pricing expectations are low.",
    optimal_route: "Response on platform at OUR pricing. Or: identify the business behind the posting and contact them directly off-platform.",
    what_to_ignore: "Jobs under $500. Jobs requesting hourly workers. Jobs from agencies (not end users).",
    priority: 15,
    capacity: "Scan daily. Low volume of relevant posts.",
    expected_quality: "Medium. Verified pain + budget. But price expectations are marketplace-level.",
  },
  {
    surface: "Expansion signals (new locations, new service areas, new vehicles, new branding)",
    signal_type: "Growth evidence visible publicly: new Google Maps locations, new service area pages, fleet expansion, rebranding",
    buyer_type: "Businesses in active growth phase where operational processes are breaking",
    what_signal_matters: "New location page on website. New service area added to Google Maps. Job posts for drivers/technicians. New branded vehicle spotted (local). These = more volume than current process handles.",
    optimal_route: "Cold email referencing specific growth: 'Congrats on the new [area/location] — that usually means more estimates than your current follow-up can handle.'",
    what_to_ignore: "Growth signals at enterprise level (100+). Growth signals more than 6 months old (may have already solved the problem).",
    priority: 16,
    capacity: "Weekly scan. Cross-reference job boards + Google Maps + websites.",
    expected_quality: "Medium-high. Growth = pain. But they didn't ask for help.",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3: OUTPUT A — HESITATION DIAGNOSIS TABLE
// ══════════════════════════════════════════════════════════════════════════════

export const HESITATION_DIAGNOSIS_TABLE = [
  {
    phrase: "I need to think about it",
    real_meaning: "Something specific is unresolved but they can't or won't name it",
    hesitation_type: "unvoiced_concern OR authority_gap OR polite_exit",
    what_NOT_to_assume: "That they'll actually think and come back. Most won't.",
    best_next_move: "Diagnostic: 'Is there a specific part you want to think through — the scope, the price, or something else?'",
    when_to_push: "If they name a specific concern — address it immediately",
    when_to_wait: "If they say 'just need time' — give 48h, one check-in",
    when_to_close_loop: "If silence after check-in + 7 days → 'No worries if timing's off. Happy to reconnect whenever.'",
  },
  {
    phrase: "Looks good",
    real_meaning: "Polite acknowledgment. NOT commitment. They're being agreeable without moving forward.",
    hesitation_type: "polite_interest — no momentum",
    what_NOT_to_assume: "That 'looks good' = 'I want to buy.' It means 'I'm not rejecting you yet.'",
    best_next_move: "Concrete next step: 'Great — should I send the scope with pricing? Takes 2 minutes to read.'",
    when_to_push: "Immediately. 'Looks good' needs to be converted to action or it evaporates.",
    when_to_wait: "Never wait on 'looks good.' It's not a commitment, it's a placeholder.",
    when_to_close_loop: "If they don't take the concrete next step within 48h → follow up once. Then standard cadence.",
  },
  {
    phrase: "Send it over / send me the info",
    real_meaning: "3 possibilities: (1) genuine request for materials, (2) avoiding live conversation where they'd have to commit, (3) collecting intel with no intent to buy",
    hesitation_type: "avoidance OR genuine_request",
    what_NOT_to_assume: "That sending info will advance the deal. It usually doesn't — they'll 'review' it and go silent.",
    best_next_move: "Send but with embedded qualifier: 'Sending now. Quick question — are you the one who'd decide on this, or does it need to go through someone else?'",
    when_to_push: "After sending: 'Did you get a chance to look? Any questions?' at 48h.",
    when_to_wait: "After the 48h check-in, if no response.",
    when_to_close_loop: "Standard follow-up cadence. If silence after 3 touches → done.",
  },
  {
    phrase: "Not right now",
    real_meaning: "Either genuinely wrong timing OR low priority OR permanent no dressed as timing",
    hesitation_type: "timing OR low_pain OR hidden_no",
    what_NOT_to_assume: "That 'not right now' means 'later yes.' It usually means 'never unless something changes.'",
    best_next_move: "Seasonal anchor + specific date: 'Totally get it. Mind if I check back before [their busy season]? That's when most [category] see the biggest spike in estimates.'",
    when_to_push: "Only if you can tie to THEIR calendar (busy season, end of quarter, hiring timeline)",
    when_to_wait: "If they give a specific future date → schedule exactly that",
    when_to_close_loop: "If vague 'later' with no specifics → one 30-day follow-up → breakup. Accept the no.",
  },
  {
    phrase: "Maybe later",
    real_meaning: "Softer version of 'not right now.' Almost always means no. They're being kind.",
    hesitation_type: "soft_no (80%) OR genuine_low_priority (20%)",
    what_NOT_to_assume: "That 'maybe later' contains real intent. The word 'maybe' is doing heavy lifting — it's their way of not rejecting you directly.",
    best_next_move: "Give permission to say no: 'Totally fine either way. If it's not a fit right now, no worries — I'd rather know than keep bugging you.'",
    when_to_push: "Don't push. This phrase indicates push-aversion. Pushing = they ghost.",
    when_to_wait: "One 30-day follow-up with new value (seasonal angle or proof asset). That's it.",
    when_to_close_loop: "If no response to 30-day follow-up → permanent close. Log as soft_no.",
  },
  {
    phrase: "I'll get back to you",
    real_meaning: "Unlikely to initiate contact. This transfers responsibility TO THEM — most people don't follow through.",
    hesitation_type: "responsibility_transfer — deal will die unless you hold the thread",
    what_NOT_to_assume: "That they'll actually get back to you. <10% do. Don't wait — you own the follow-up.",
    best_next_move: "Accept but take control: 'Sounds good. I'll check in [specific day] — if you've had a chance to look by then, great. If not, no worries.'",
    when_to_push: "At your stated check-in date. Not before.",
    when_to_wait: "Between now and your stated check-in date. Don't follow up early.",
    when_to_close_loop: "If they don't respond to your check-in + one follow-up → standard cadence → breakup.",
  },
  {
    phrase: "I need to check internally / need approval",
    real_meaning: "Multi-stakeholder situation activated. Could be genuine process OR could be shield.",
    hesitation_type: "authority_gap (70%) OR excuse_shield (30%)",
    what_NOT_to_assume: "That internal process is real. Test: ask who specifically, what timeline, and offer direct access. Genuine = gives details. Shield = stays vague.",
    best_next_move: "Equip: 'Want me to send a one-page summary they can review? Usually makes the internal conversation easier.'",
    when_to_push: "If they accept one-pager AND give timeline → follow up at stated time",
    when_to_wait: "After equipping champion, wait for their stated timeline + 2 days buffer",
    when_to_close_loop: "If no stakeholder engagement after one-pager + 2 follow-ups (14 days) → 'Sounds like timing isn't right.' Close.",
  },
  {
    phrase: "Can you remind me next month",
    real_meaning: "Usually a polite exit framed as a future commitment. Giving a specific future date makes them feel less guilty about saying no today.",
    hesitation_type: "scheduled_decline (60%) OR genuine_timing (40%)",
    what_NOT_to_assume: "That next month they'll be ready. They usually aren't. But: some seasonal businesses DO have real monthly cycles.",
    best_next_move: "Accept: 'Absolutely. I'll reach out [specific date]. If anything changes before then, I'm here.'",
    when_to_push: "On exactly the date they specified. Not before, not a week after.",
    when_to_wait: "Between now and that date. Calendar it. Don't think about this lead until then.",
    when_to_close_loop: "If they don't respond on the specified date + one follow-up → 'Checking back as promised. If priorities have shifted, totally understand.' If silence → close.",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 4: OUTPUT B — PRESSURE NEGOTIATION TABLE
// ══════════════════════════════════════════════════════════════════════════════

export const PRESSURE_NEGOTIATION_TABLE = [
  {
    buyer_move: "Too expensive (first push)",
    what_they_want: "Lower price OR reassurance that value justifies cost",
    good_faith_or_squeeze: "Unknown until diagnosed. Ask first.",
    best_response: "Diagnose root: 'Is it the amount, or is there something about the scope that doesn't feel right?' Then route per 5-root model.",
    tradeoff: "If budget = real → pilot $750. If value = unclear → cost-of-inaction reframe. If exit = polite no → accept.",
    line_not_to_cross: "Never discount without reducing scope.",
    when_to_walk: "If they exit politely after reframe → accept gracefully.",
  },
  {
    buyer_move: "Under $1,000 (stated ceiling)",
    what_they_want: "Price certainty. They're filtering, not necessarily negotiating.",
    good_faith_or_squeeze: "Usually good faith. This is their mental budget for 'small operational tool.'",
    best_response: "$750 pilot fits under their ceiling. State clearly: '$750. One process. 3 days. Guarantee included.'",
    tradeoff: "None needed — $750 is under $1,000.",
    line_not_to_cross: "Don't offer $500 to seem extra-competitive. $750 is already under their number.",
    when_to_walk: "If they negotiate below $750 after you've already met their stated ceiling → squeezing. Walk.",
  },
  {
    buyer_move: "Can you also add X (scope expansion, first ask)",
    what_they_want: "Maximum value. Testing what's included.",
    good_faith_or_squeeze: "Good faith. They see value and want more — positive signal.",
    best_response: "Validate → Phase → Price: 'Great idea. Let's get [core] running first. [X] is Phase 2: $750.'",
    tradeoff: "Time phasing. They get X, just not in the first delivery.",
    line_not_to_cross: "Never absorb scope without price. Max 2 processes per $1,500.",
    when_to_walk: "Don't walk on first ask — it's a buying signal. Walk if they demand 3+ features at one-feature price.",
  },
  {
    buyer_move: "If this works there may be more later (future promise as leverage)",
    what_they_want: "Current discount in exchange for non-binding future promise",
    good_faith_or_squeeze: "SQUEEZE. 'Maybe more later' is never bankable. 95% never materializes.",
    best_response: "'I appreciate that — let's make sure this first project delivers results, and we can definitely talk about more.' Evaluate current deal ONLY at current price.",
    tradeoff: "None. Future promises have $0 net present value.",
    line_not_to_cross: "Never discount current deal based on future promise. Ever.",
    when_to_walk: "If they make current deal conditional on believing the future promise → this is manipulation. Walk.",
  },
  {
    buyer_move: "Can you do this one cheaper (second push after pilot offered)",
    what_they_want: "Testing whether you'll fold again. If you offered pilot after 'too expensive,' they want to see if pilot has a further discount.",
    good_faith_or_squeeze: "SQUEEZE. Second push = testing your floor.",
    best_response: "Hold with tradeoff visibility: '$750 is the pilot floor — includes guarantee, support, and documentation. I could do $500 but without support and guarantee. Most people prefer the $750 version.'",
    tradeoff: "Strip to $500: workflow + walkthrough only. No support, no guarantee, no docs.",
    line_not_to_cross: "Never go below $500 for any built deliverable. Below that = charity.",
    when_to_walk: "If they push a third time → 'Sounds like the fit might not be right at this price point. No worries.'",
  },
  {
    buyer_move: "I can get someone else to do it for less (competitor leverage)",
    what_they_want: "Price match or justification for premium",
    good_faith_or_squeeze: "Could be either. They may have a real quote or they may be bluffing.",
    best_response: "Compete on guarantee, not price: 'Makes sense to compare. The difference is usually post-delivery: support, refinement, and the guarantee. If it doesn't save 5 hours/month, I keep working free. Does the other quote include that?'",
    tradeoff: "None. Our value prop IS the guarantee + support + refinement.",
    line_not_to_cross: "Never match a competitor's lower price. Never ask 'how much are they charging?'",
    when_to_walk: "If they say 'I'm going with the cheaper option' → graceful exit: 'Makes sense. If it doesn't work out, I'm here.' (often they come back)",
  },
  {
    buyer_move: "We only need something basic (scope reduction as price lever)",
    what_they_want: "Smaller price through smaller scope. May be genuine or may be testing.",
    good_faith_or_squeeze: "Usually good faith. 'Basic' = they want simple, which is what our pilot IS.",
    best_response: "Match their frame: 'That's exactly what the pilot is — [one process], nothing extra. $750 for the basic version. We add more only if you want later.'",
    tradeoff: "Our pilot IS basic. Reframe it as such. Don't create a 'super-basic' tier below pilot.",
    line_not_to_cross: "Don't create a $300 'basic' tier that undercuts your pilot positioning.",
    when_to_walk: "If 'basic' means 'I want the full thing for less' → hold: 'The pilot is the basic version.'",
  },
  {
    buyer_move: "Bundle these together (asking for discount via volume)",
    what_they_want: "Per-unit price reduction through bundling. 3 processes at price of 2.",
    good_faith_or_squeeze: "Good faith if they want multiple processes. Squeeze if they want all at one-process price.",
    best_response: "2 processes = $1,500 (full price, not discounted). 3 processes = $2,000 ($250 saved, 12% volume discount). Frame: 'I can do [A+B] for $1,500 or all three for $2,000 — saves $250 over doing them separately.'",
    tradeoff: "Small volume discount on 3+ only. Never bundle 3 at $1,500 (= $500/process).",
    line_not_to_cross: "Minimum $667/process for bundles. Below that = unsustainable for delivery quality.",
    when_to_walk: "If they want 3+ at $1,000 total → 'That's below what I can deliver quality work for.' Walk.",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 5: OUTPUT C — FALSE SIGNAL TABLE
// ══════════════════════════════════════════════════════════════════════════════

export const FALSE_SIGNAL_TABLE = [
  {
    signal: "Strong champion (4+ messages, proactive, anticipates objections)",
    why_looks_strong: "High engagement. They're doing selling work for you. Feels like the deal is moving.",
    why_may_be_false: "Champion enthusiasm ≠ signer commitment. ST3 plumbing sister: 4 messages, perfect champion behavior — but brother may never read the one-pager. Champion's excitement is about THEIR relationship with you, not the signer's willingness to pay.",
    how_to_verify: "Did champion relay signer's specific feedback within stated timeline? If yes = real. If silence after forwarding = champion either didn't forward or signer said no and champion won't relay it.",
    system_mistake_to_avoid: "Counting champion messages as deal progress. Revenue = $0 until signer commits.",
    confidence_to_assign: "50% until signer engages directly. Then re-evaluate.",
  },
  {
    signal: "Warm intro (friend introduced you)",
    why_looks_strong: "Trust transfer. Highest quality lead source. 84% of B2B starts with referral.",
    why_may_be_false: "Intro ≠ interest. Friend may have introduced without asking if prospect is interested. Prospect may take the call out of politeness to the friend, not because they have the pain.",
    how_to_verify: "Does prospect describe specific pain in first 2 messages? If yes = intro landed on real need. If they ask vague questions without mentioning their own problem = polite engagement, not buying behavior.",
    system_mistake_to_avoid: "Assuming warm intro = warm buyer. Intro = warm channel, not warm intent.",
    confidence_to_assign: "60% at intro. Upgrades to 80% only if prospect describes specific pain unprompted.",
  },
  {
    signal: "Pricing ask ('what does this cost?')",
    why_looks_strong: "Intent score 3. They're evaluating. Active buying behavior.",
    why_may_be_false: "Price question can be: (1) genuine evaluation, (2) intel collection for cheaper vendor, (3) idle curiosity with no intent, (4) gatekeeper forwarding boss's question without context. ST3 landscaping: 'just send prices' + ghost = intel collection or idle filtering.",
    how_to_verify: "Do they answer your qualifying question back? Real evaluator answers. Intel collector ignores or deflects.",
    system_mistake_to_avoid: "Fast-tracking to scope based on pricing question alone without verifying authority and pain.",
    confidence_to_assign: "45% at pricing question. Upgrades to 70% if they answer qualifier + describe pain.",
  },
  {
    signal: "Stated budget ceiling ('under $1,000')",
    why_looks_strong: "They're telling you their constraint. Useful for offer matching.",
    why_may_be_false: "Budget ceiling is often an ANCHOR, not a hard limit. They say $1,000 to see if you'll drop. Real test: does the ceiling MATCH their business size? A $2M revenue company saying 'under $1,000' for critical operations = likely anchoring. A $200K solo operator saying same = likely real.",
    how_to_verify: "Business size check. 5+ employees + established business + stated $1,000 cap = probably anchoring. Solo operator + $1,000 cap = probably real. Also: pilot at $750 fits under $1,000, so it's often moot — test by offering.",
    system_mistake_to_avoid: "Pre-discounting below your pilot because they stated a ceiling. $750 is under $1,000. Offer it.",
    confidence_to_assign: "Budget is real: 60%. Ceiling is exact: 30% (they'd probably accept $1,100 if value is clear).",
  },
  {
    signal: "Partner check ('need to check with my husband/partner')",
    why_looks_strong: "In family businesses, this is usually genuine. Shows they're taking it seriously enough to discuss.",
    why_may_be_false: "~30% of 'partner checks' are shields. The partner either doesn't exist as a real gate, or the champion has already decided no but uses partner as excuse. ST2 HVAC: partner check was genuine (family business). But could easily be someone who's not interested hiding behind 'my partner'.",
    how_to_verify: "Ask for timeline + offer direct access + send one-pager. Genuine: accepts all three, gives specific timeline. Shield: deflects timeline, declines direct access, doesn't forward one-pager.",
    system_mistake_to_avoid: "Waiting indefinitely for a partner who may never be consulted.",
    confidence_to_assign: "Genuine: 65%. Shield: 35%. Resolves within 7 days either way.",
  },
  {
    signal: "'We already use [tool]' (Jobber/HCP/ServiceTitan)",
    why_looks_strong: "Tool signal = budget for tech. They understand automation. Higher quality lead per Pack 5.",
    why_may_be_false: "Using a tool ≠ wanting additional tools. They may be: satisfied with current setup, in contract, or using it as 'we're already covered' objection.",
    how_to_verify: "Ask what's missing: 'How does Jobber handle your estimate follow-up right now?' If they describe a gap = real opportunity. If 'it's fine' = not our buyer.",
    system_mistake_to_avoid: "Assuming tool user = tool buyer. Tool user who's satisfied = dead end.",
    confidence_to_assign: "Tool user + describes gap = 70%. Tool user + 'it's fine' = 20%.",
  },
  {
    signal: "Growth signals (hiring, new location, new service area)",
    why_looks_strong: "Growth = pain. More volume than current process handles. Paper-strong signal.",
    why_may_be_false: "Growth signals are LAGGING indicators. Company may have already solved the operational pain by hiring. Or: growth signals exist on paper but they don't feel overwhelmed. ST2/3: ServiceTitan leads with strong growth signals never replied.",
    how_to_verify: "Did they reply to outreach that referenced their growth? If yes = growth pain is felt. If 2 emails with growth references + 0 reply = they don't feel it or already handled it.",
    system_mistake_to_avoid: "Over-investing in 'great on paper' leads that show zero engagement. Growth signals matter only if the COMPANY feels the growth pain.",
    confidence_to_assign: "Without engagement: 25%. With engagement referencing growth pain: 65%.",
  },
  {
    signal: "'Ops manager can get owner attention'",
    why_looks_strong: "Self-identified champion with explicit access path. Gave specific condition ('if it looks concrete'). ST3 rated this as strong.",
    why_may_be_false: "'Probably' = maybe. 'Can get attention' ≠ 'will get attention.' Ops managers overestimate their influence with owners regularly. Owner may glance at forwarded artifact and ignore it.",
    how_to_verify: "Did owner engage within 7 days of forwarding? If yes = ops manager delivered. If not = influence was overstated.",
    system_mistake_to_avoid: "Building custom artifacts for ops managers who can't actually deliver the signer. Cap investment at 30 min until owner appears.",
    confidence_to_assign: "After artifact sent: 35% until owner engages. After owner engages: 70%.",
  },
  {
    signal: "'Interested' (generic positive response)",
    why_looks_strong: "They replied! After 0 replies from many sends, ANY positive response feels significant.",
    why_may_be_false: "Most common false signal. 'Interested' with no follow-up question, no pain described, no authority confirmed = polite acknowledgment. Canadian politeness especially produces 'interested' responses that mean nothing.",
    how_to_verify: "Did they engage with your qualifying question? Genuine interest answers questions. Polite interest deflects or goes silent.",
    system_mistake_to_avoid: "Treating 'interested' as intent_score 3. It's intent_score 1 until qualified.",
    confidence_to_assign: "'Interested' alone: 20%. 'Interested' + answers qualifier: 50%. 'Interested' + describes pain: 65%.",
  },
  {
    signal: "'Urgent' / 'need this fast'",
    why_looks_strong: "Urgency = close fast. Skip nurture phase. Go straight to scope.",
    why_may_be_false: "Stated urgency often doesn't match behavior. If they say 'urgent' but take 4 days to respond to your reply = urgency was performative. Fiverr buyers especially say 'urgent' to justify low prices ('no time to shop around').",
    how_to_verify: "Response speed test. Truly urgent = they respond within hours. Fake urgent = days between messages despite 'ASAP' language.",
    system_mistake_to_avoid: "Skipping qualification because they said 'urgent.' Urgency without authority/budget/pain = fast path to nowhere.",
    confidence_to_assign: "'Urgent' + responds within 4h: 70%. 'Urgent' + responds in 3 days: 15%.",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 6: OUTPUT D — DECEPTION DETECTION RULES
// ══════════════════════════════════════════════════════════════════════════════

export const DECEPTION_DETECTION_RULES = [
  {
    type: "fake_urgency",
    how_it_looks: "Buyer says 'need this ASAP' or 'urgent, can you start this week?'",
    how_to_detect: "Response speed test. Truly urgent buyers respond within hours. Send reply with concrete next step: 'I can start Monday — should I send the invoice?' If they don't respond for 2+ days → urgency was performative.",
    correct_response: "Respond fast (match their stated urgency). But gate investment: don't skip qualification because they said 'urgent.' Qualify authority and pain in the same message as your fast response.",
    what_changes_in_system: "Flag: urgency_stated but response_speed_slow → deception_flag = fake_urgency. Reduce confidence by 30 points.",
  },
  {
    type: "fake_budget_limit",
    how_it_looks: "'We can only spend $500' or 'our budget is tight' from a company with 15 employees and 3 service trucks.",
    how_to_detect: "Cross-reference stated budget with business indicators. 15+ employees + service fleet + active website = revenue likely $500K+. '$500 budget' for critical operational tool at that revenue = likely anchoring. Virtual Close: 'If I could do $750, would we have a deal?' If yes = budget wasn't real. If new objections = budget was real but other issues exist.",
    correct_response: "Don't challenge their stated budget directly. Offer $750 pilot with value stack. Let them self-select up if the value is clear.",
    what_changes_in_system: "Log: stated_budget vs business_size_indicators. If discrepancy detected → add note: possible_anchoring. Don't auto-adjust price.",
  },
  {
    type: "fake_internal_approval",
    how_it_looks: "'I need to run this by my team' or 'it has to go through our process' from a 5-person company where the owner is talking to you.",
    how_to_detect: "5-person company with owner in conversation = no real 'process.' Owner IS the process. Ask: 'What does the approval process look like?' If vague = stall. If specific ('I need to discuss with my bookkeeper') = real.",
    correct_response: "Offer to help: 'Want me to send a one-page summary that makes the internal conversation easy?' If they accept = possibly real. If they deflect = stall.",
    what_changes_in_system: "Flag: internal_process_claimed at company_size < 10 employees + contact = owner → deception_flag = possible_soft_no.",
  },
  {
    type: "fake_complexity_objection",
    how_it_looks: "'We don't want anything complicated' before seeing ANY details about your solution.",
    how_to_detect: "They can't know it's complicated because they haven't seen it. This is pre-emptive fear, not product feedback. Test: show 3-step visual. If fear dissolves = it was fear of the unknown. If they still object after seeing simplicity = deeper issue (trust, need, or exit).",
    correct_response: "Show, don't argue. 3-step visual: trigger → action → result. 'That's the whole thing.' If they still hesitate → ask: 'Is there something else that's not feeling right?'",
    what_changes_in_system: "If complexity objection dissolves after visual → was fear, correctly handled. If persists → escalate to deeper diagnosis (trust/need/exit).",
  },
  {
    type: "fake_price_evaluation",
    how_it_looks: "'Just send me your prices' with no qualifying engagement. No pain described. No authority confirmed.",
    how_to_detect: "Real price evaluators answer qualifying questions because they want the right scope. Fake evaluators ignore qualifiers because they only want a number to compare.",
    correct_response: "Give range + qualifier in same message. If they engage with qualifier = real. If they take number and disappear = intel collection.",
    what_changes_in_system: "Flag: price_asked + qualifier_ignored → deception_flag = intel_collection. Don't follow up more than once.",
  },
  {
    type: "fake_marketplace_upside",
    how_it_looks: "'If this works there may be more work' or 'we have other projects too' — always FUTURE tense.",
    how_to_detect: "Ask: 'What would the next project be?' If they describe something specific → possibly real. If vague ('we always need automation help') → leverage language with no substance. Also: has this person EVER followed through on a 'more later' promise? (N/A for first interaction — assume it's fake.)",
    correct_response: "'That's great to hear — let's make sure this first one delivers, and we can talk about next steps.' Evaluate current deal at current price. Future promises = $0 value.",
    what_changes_in_system: "Hard rule: future_work_promised → weight_in_pricing = 0. Never discount based on future promise.",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 7: OUTPUT E — PERSUASION DECISION RULES
// ══════════════════════════════════════════════════════════════════════════════

export const PERSUASION_DECISION_RULES = {
  description: "When the buyer is hesitating, choose ONE of these actions. Not two. Not three. One.",

  decision_tree: [
    {
      condition: "Buyer said 'looks good' or 'interesting' but hasn't committed to next step",
      action: "ASK DIRECT QUESTION",
      template: "'Should I send the scope with pricing?' or 'Want me to put together a quick walkthrough?'",
      why: "Vague positivity needs a concrete yes/no to move forward. Give them a specific thing to say yes to.",
    },
    {
      condition: "Buyer expressed fear (complexity, change, unknown, risk of bad investment)",
      action: "SIMPLIFY + GUARANTEE",
      template: "3-step description + 'If it doesn't save 5 hours/month in 30 days, I keep refining free.'",
      why: "Fear responds to simplicity and safety. More information increases fear. Less complexity + no risk = fear dissolves.",
    },
    {
      condition: "Buyer said 'too expensive' or asked about price",
      action: "DIAGNOSE ROOT FIRST",
      template: "'Is it the amount, or is there something about the scope that doesn't feel right?'",
      why: "5 possible roots. Wrong response to wrong root = wasted opportunity. 30 seconds of diagnosis saves the deal.",
    },
    {
      condition: "Buyer asked for proof (demo, examples, case studies)",
      action: "BUILD PROOF — FAST",
      template: "Demo walkthrough or screenshots within 24h, specific to their business/tool",
      why: "This is evaluation behavior = forward motion. 24-48h shelf life. Speed = credibility.",
    },
    {
      condition: "Buyer needs another person's approval",
      action: "EQUIP CHAMPION",
      template: "One-pager + ROI line + forwarding text. 'Want me to send something they can review? Takes 60 seconds to read.'",
      why: "Champion can't sell as well as you. Arm them with pre-built ammunition for the signer's predictable questions.",
    },
    {
      condition: "Buyer went silent after positive engagement",
      action: "ONE VALUE-ADD FOLLOW-UP then PAUSE",
      template: "New angle, seasonal reference, or proof asset — NOT 'just checking in'",
      why: "Silence ≠ no. But silence after 2 follow-ups = probably no. One value-add gives them a reason to re-engage.",
    },
    {
      condition: "Buyer gave clear signals this is a polite exit",
      action: "ACCEPT AND EXIT GRACEFULLY",
      template: "'Sounds like timing might not be right. No worries at all — I'm here whenever it makes sense.'",
      why: "Pushing a polite no into a hard no = burned bridge. Graceful exit = they might come back. Or refer you.",
    },
    {
      condition: "Buyer is enthusiastic but keeps adding scope without committing",
      action: "REDIRECT TO COMMITMENT",
      template: "'Love the ideas. Let's start with [core] and build from there. Should I send the invoice to kick off?'",
      why: "Scope expansion without commitment = they're designing, not buying. Redirect to a YES/NO on the core before discussing add-ons.",
    },
  ],
};


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 8: OUTPUT F — LEARNING FROM MISLEADING CASES
// ══════════════════════════════════════════════════════════════════════════════

export const MISLEADING_SIGNAL_LEARNING = {
  log_format: {
    signal_type: "what the signal was (e.g., 'strong_champion', 'warm_intro', 'pricing_ask')",
    what_expected: "what the system expected would happen based on the signal",
    what_happened: "what actually happened",
    discrepancy: "the specific gap between expectation and reality",
    verification_missing: "which verification test would have caught this earlier",
    time_wasted: "hours invested before the signal was revealed as false",
    confidence_adjustment: "how much the default confidence for this signal type should decrease (only after 3+ cases)",
  },

  change_protocol: {
    after_1_case: "LOG ONLY. Record the discrepancy. Do NOT change any system behavior. One misleading case could be bad luck, unique circumstances, or incorrect assessment of 'misleading.'",
    after_3_cases_same_pattern: "ADD FLAG. Add a verification requirement for this signal type. Example: 3 strong champions who never delivered → add 'champion_verification_pending' flag that requires signer feedback within 7 days before investing more than 30 min.",
    after_5_cases_same_pattern: "CHANGE RULE. Adjust default confidence score for this signal type. Example: 5 'interested' cold replies that all ghosted after qualifier → reduce 'interested' cold reply confidence from 40% to 25%.",
    never_change_from_one_case: [
      "Pricing strategy (one price rejection ≠ wrong pricing)",
      "Channel strategy (one dead channel lead ≠ dead channel)",
      "Vertical targeting (one bad HVAC deal ≠ HVAC is wrong ICP)",
      "Champion approach (one failed champion ≠ champions don't work)",
      "Offer structure (one rejected pilot ≠ pilots don't work)",
    ],
  },

  distinguishing_bad_luck_from_pattern: {
    bad_luck_indicators: [
      "Unique external factor (prospect's business had an emergency, family crisis, etc.)",
      "Different root cause each time (one failed on price, one on timing, one on authority)",
      "Low sample size with high variation (3 cases, 3 different failure modes)",
    ],
    pattern_indicators: [
      "Same failure mode 3+ times (all failed at partner-check, all failed after 'interested')",
      "Same signal type 3+ times (all 'strong champions' who went silent)",
      "Same stage 3+ times (all deals die between scope-sent and commitment)",
    ],
    rule: "Pattern = same failure point with same signal type across 3+ cases. Bad luck = different failure points or different signal types. Only change system for patterns, not bad luck.",
  },
};


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 9: OUTPUT G — WHAT SHOULD CHANGE IN OUR SYSTEM NOW
// ══════════════════════════════════════════════════════════════════════════════

export const SYSTEM_CHANGES = {

  deal_assist_changes: [
    {
      change: "Add hesitation_type classification",
      current: "Stalls treated as one type",
      new: "5 types: healthy_processing, unvoiced_concern, authority_gap, polite_exit, fear_paralysis. Each has different response.",
    },
    {
      change: "Add pressure_round counter per lead",
      current: "Each price push handled independently",
      new: "Track push_count. Push 1 = diagnose. Push 2 = hold with tradeoff. Push 3 = walk away.",
    },
    {
      change: "Add signal_verified boolean per lead",
      current: "Signals taken at face value",
      new: "Each positive signal starts unverified. Verified after passing one test (qualifier answered, response speed matched urgency, champion relayed feedback). Actions gated by verification.",
    },
    {
      change: "Add deception_flags array per lead",
      current: "No deception tracking",
      new: "Flags: fake_urgency, fake_budget, fake_partner, fake_interest, intel_collection. Each triggered by specific test failure.",
    },
    {
      change: "Rewrite all CTAs as concrete next steps",
      current: "Many end with 'let me know what you think' or 'want to move forward?'",
      new: "Every CTA = specific binary action: 'Should I send the scope?' / 'I can start Monday — want me to send the invoice?' / 'Want a 2-min walkthrough?'",
    },
    {
      change: "Add tiered_offer to price objection handling",
      current: "Pilot $750 or reduced $1,000",
      new: "3 tiers visible: $750 full pilot (workflow + docs + support + guarantee). $500 stripped (workflow + walkthrough only). $375 diagnostic (assessment + recommendation only).",
    },
  ],

  discovery_changes: [
    {
      change: "Implement multi-surface discovery scanning",
      current: "Single surface: Yellow Pages scrape",
      new: "Daily rotation across top 6 surfaces: warm network, LinkedIn, Google Reviews, job boards, Reddit, company websites. Weekly scan of remaining 10 surfaces.",
    },
    {
      change: "Add surface_source field to all leads",
      current: "Leads tracked by channel (cold_email, reddit) but not by discovery surface",
      new: "Every lead records: discovery_surface (where found), contact_channel (how contacted), qualification_source (what qualifying info came from where).",
    },
    {
      change: "Route selection per discovery surface",
      current: "All cold-email leads get same template",
      new: "Route matched to surface: warm network → personal message. LinkedIn → DM with mutual reference. Google Reviews → cold email with review reference. Job board → cold email with hiring reference.",
    },
  ],

  confidence_scoring_changes: [
    {
      change: "Add signal_verified weight to confidence score",
      current: "Confidence based on resolved unknowns only (Pack 8)",
      new: "Confidence = resolved_unknowns_score + signal_verification_score - deception_flags_penalty. Example: authority confirmed (+25) + pain described (+20) + signal verified (+15) - fake_urgency_flag (-15) = 45%.",
    },
  ],

  logging_additions: [
    { field: "hesitation_type", type: "5 categories", why: "Track which hesitation types convert vs die" },
    { field: "pressure_round_count", type: "number", why: "Track how many price pushes before outcome" },
    { field: "signal_verified", type: "boolean", why: "Track verified vs unverified signal conversion rates" },
    { field: "deception_flags", type: "string[]", why: "Track false signal patterns over time" },
    { field: "discovery_surface", type: "string", why: "Track which surfaces produce highest quality leads" },
    { field: "discrepancy_log", type: "object[]", why: "Track misleading signal patterns for learning loop" },
    { field: "concrete_cta_used", type: "boolean", why: "Track whether specific CTA vs vague CTA affects conversion" },
  ],
};


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 10: PRACTICAL SUMMARY
// ══════════════════════════════════════════════════════════════════════════════

export const PRACTICAL_SUMMARY = {

  top_5_persuasion_rules: [
    "1. EVERY MESSAGE MUST END WITH A CONCRETE NEXT STEP. Not 'let me know' — 'Should I send the scope?' Not 'what do you think' — 'I can start Monday, want me to send the invoice?' Specific binary asks create decisions. Open questions create delays.",
    "2. CLASSIFY HESITATION TYPE BEFORE RESPONDING. Five types, five responses: healthy processing → give 48h. Unvoiced concern → ask 'what specifically?' Authority gap → equip champion. Polite exit → give permission to say no. Fear paralysis → simplify + guarantee. Wrong response to wrong type = deal dies.",
    "3. URGENCY MUST BE REAL OR NOT USED AT ALL. Seasonal timing, genuine capacity limits, cost of delay — all honest. 'Limited spots' when capacity is unlimited = trust destruction if discovered. The buyer's own deadline is the strongest urgency you can invoke.",
    "4. 'LOOKS GOOD' IS NOT PROGRESS — IT'S A PLACEHOLDER. Convert immediately to concrete action: 'Great — should I send the scope?' If they don't take the next step within 48h, 'looks good' was polite interest, not intent.",
    "5. FEAR RESPONDS TO SIMPLICITY AND SAFETY, NOT MORE INFORMATION. When they say 'complicated' or 'big setup' — show 3 steps. When they worry about risk — state guarantee. More features, more detail, more selling = more fear. Less = less fear.",
  ],

  top_5_false_signal_rules: [
    "1. VERIFY BEFORE INVESTING. Every positive signal gets ONE verification test before the system spends more than 15 minutes. Urgency → response speed test. Interest → qualifying question. Champion → did they relay signer feedback? Budget → do they engage with pilot offer? Unverified signals = max 15 min investment.",
    "2. CHAMPION ENTHUSIASM ≠ SIGNER COMMITMENT. A champion who sends 4 excited messages but never delivers signer feedback is not a strong champion — they're an enthusiastic non-buyer. Revenue = $0 until the signer says yes. Confidence stays at 50% until signer engages directly.",
    "3. 'INTERESTED' FROM A COLD LEAD = 20% CONFIDENCE, NOT 50%. Canadian politeness. Curiosity. Boredom. All produce 'interested' responses. Only upgrades when they answer a qualifying question (50%) or describe specific pain unprompted (65%). Treat accordingly.",
    "4. 'URGENT' + SLOW RESPONSE = FAKE URGENCY. If someone says 'ASAP' but takes 3 days to reply to your message, their urgency is performative. Real urgency matches behavior to words. Flag discrepancy, reduce confidence by 30 points.",
    "5. 'MORE WORK LATER' = $0 PRESENT VALUE. Always. Every marketplace buyer, every price-negotiating prospect, every budget-constrained lead says this. In all recorded cases across all stress tests, future promises have never materialized. Evaluate current deal only.",
  ],

  top_5_negotiation_rules: [
    "1. TRACK PRESSURE ROUNDS. First push = diagnose. Second push = hold with visible tradeoff. Third push = walk away. Buyers who push 3+ times are squeezing, not buying. Each fold teaches them to push again. Stop at 3.",
    "2. TRADEOFFS, NOT DISCOUNTS. $750 = full pilot. $500 = stripped (no support, no guarantee, no docs). $375 = diagnostic only. When buyer sees what gets removed at each tier, most self-select to $750. Tradeoffs make the full price look like the obvious choice.",
    "3. DISCOVERY SURFACE DETERMINES ROUTE, NOT JUST CHANNEL. A lead found through a warm intro gets a personal message. Same lead found via directory scrape gets a cold email with audit. Same lead found via job board gets a growth-pain reference. Surface → signal → route → channel. Never use the same template for different discovery contexts.",
    "4. SCAN 6 SURFACES DAILY, NOT JUST ONE. Warm network + LinkedIn + Google Reviews + Job boards + Reddit + Company websites = daily rotation. Yellow Pages scrape alone is one surface producing cold leads only. Multi-surface discovery = higher quality pipeline at same time investment.",
    "5. FUTURE PROMISES CARRY ZERO WEIGHT IN PRICING. 'If this works, more later' → evaluate current deal at current price. 'We have other projects' → great, let's close this one first. Never discount today's deal for tomorrow's promise. Never.",
  ],

  top_3_learning_rules: [
    "1. LOG THE DISCREPANCY, NOT JUST THE OUTCOME. When a signal is misleading, record: what was expected, what happened, which verification test would have caught it. 'Lost' teaches nothing. 'Champion looked strong but never forwarded because she wasn't actually committed to the idea herself' teaches everything.",
    "2. 1 CASE = LOG. 3 CASES = FLAG. 5 CASES = RULE CHANGE. One misleading champion = bad luck. Three misleading champions who all went silent after equipping = add 'champion_verification_pending' requirement. Five 'interested' cold replies that all ghosted = reduce default confidence for that signal. Never change system from one case. Never ignore three identical cases.",
    "3. DISCOVERY EFFECTIVENESS MUST BE MEASURED PER SURFACE. Track: leads_found, replies_received, deals_progressed, revenue_generated — per discovery surface. After 30 days: which surfaces produce qualified leads? Double those. Which produce noise? Deprioritize. The system's survival depends on finding buyers efficiently, not just finding them at all.",
  ],
};
