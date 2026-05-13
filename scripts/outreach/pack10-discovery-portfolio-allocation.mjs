/**
 * Pack 10 — Client Discovery, Surface Mapping & Opportunity Portfolio Allocation
 *
 * The last missing capability: how the system finds clients in the field,
 * chooses the best discovery surface, maps signals to buyer types,
 * and allocates limited time/energy across a portfolio of opportunities.
 *
 * Finding clients is a PRIMARY survival function — equal to converting them.
 *
 * Sources: Packs 5-9 (synthesis), Stress Tests 1-4 (applied patterns),
 * Close/SaaStr/Hormozi/HCP/ServiceTitan/Reddit (reuse), system truths.
 */

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 1: STRUCTURED RULES
// ══════════════════════════════════════════════════════════════════════════════

export const PACK10_EXTRACTED_RULES = [

  {
    source: "Pack 5 Client Hunting + Pack 9 Discovery Surface Map (synthesis)",
    tier: "primary",
    type: "discovery_is_survival",
    pattern: "Discovery is not a setup task that happens once during list building. It is a continuous survival function that runs every day. The system must scan multiple surfaces, qualify signals in real time, and feed the pipeline with fresh opportunities. An empty pipeline with perfect deal-handling = $0.",
    evidence: "Pack 6: '$0 revenue, clock running.' 193 emails from one surface (Yellow Pages) = 0 human replies. ST1-4: every test had 5-7 simultaneous signals — the system must be discovering at that rate continuously.",
    anti_pattern: "Building a list once and sending to it until it's exhausted. Only scanning one surface. Treating discovery as 'done' after initial scrape. Spending 80% of time on deal handling with an empty pipeline.",
    applicable_to_us: true,
    why_applicable: "Current system scrapes Yellow Pages → sends cold email. One surface, one channel. Must expand to 6+ surfaces with daily rotation. Pipeline starvation kills faster than bad deal handling.",
    confidence: "high",
    extracted_rule: "50% of daily system time goes to DISCOVERY (finding + qualifying new leads). 50% goes to CONVERSION (handling active leads). Neither drops below 30%. If pipeline is empty: 70% discovery. If pipeline is full with active deals: 30% discovery. Discovery never goes to zero.",
    target_component: "daily operating loop (Pack 6), portfolio strategy",
    expected_metric_change: "continuous pipeline flow instead of batch-and-starve",
    review_window: "14 days",
    risk: "medium — discovery time competes with deal time. Balance is critical.",
    apply_mode: "build",
  },
  {
    source: "Hormozi $100M Leads + Pack 5 + SaaStr First 10 (synthesis)",
    tier: "primary",
    type: "surface_hierarchy",
    pattern: "Hormozi: warm → content → cold → paid. SaaStr Lemkin: first 10 come from hustle, not systems — network, knocking on doors, events. Pack 5: 84% of B2B starts with referral. Warm surfaces convert 5-10x better than cold. BUT warm surfaces are FINITE (525 LinkedIn connections). Cold surfaces are infinite but low-conversion. The system must exhaust warm before scaling cold.",
    evidence: "Money_score: warm LinkedIn 21/30, cold email 15/30. ST1: warm intro scored 28/30. ST4: both warm intros were top-ranked despite complications.",
    anti_pattern: "Starting with cold email before warm network is used. Scaling cold volume instead of deepening warm relationships. Treating warm and cold as interchangeable. Letting warm network sit unused because cold email is automatable.",
    applicable_to_us: true,
    why_applicable: "Kirill has 525 LinkedIn connections. At 10/day = 52 days before exhausted. This is a FINITE high-conversion resource with a shelf life. Every day it sits unused = wasted potential. Meanwhile cold email from fresh domain has unknown conversion.",
    confidence: "high",
    extracted_rule: "SURFACE PRIORITY ORDER: (1) Active warm leads (replies, intros in progress). (2) Warm outreach (new messages to network). (3) Referral asks from any completed interaction. (4) Cold email to scored leads. (5) Reddit/community engagement. (6) Everything else. Never skip 1-3 to do 4-6. Warm has expiration — cold doesn't.",
    target_component: "daily operating loop, portfolio strategy, send-outreach.mjs",
    expected_metric_change: "faster first client from warm channel",
    review_window: "30 days",
    risk: "low — warm outreach has zero cost beyond Kirill's time",
    apply_mode: "semi_auto",
  },
  {
    source: "Stress Tests 1-4 + Pack 8 Ambiguity Protocol (synthesis)",
    tier: "primary",
    type: "signal_combination_scoring",
    pattern: "Single signals are unreliable (Pack 9: 'interested' = 20% confidence). Signal COMBINATIONS are predictive. Pattern across all stress tests: owner + pain + pricing question + warm intro = 60-80% confidence = full investment. Growth signal + no engagement = 20% = minimal investment. Champion + enthusiasm + no signer feedback = 50% max = capped investment. The system must score combinations, not individual signals.",
    evidence: "ST1: warm + owner + Jobber + pricing = 28/30. ST4: warm + owner + 5 messages + trust scar = 60%. ST3: growth signals + 0 reply = 20%. ST2: champion 4 messages + no signer = 50%.",
    anti_pattern: "Scoring leads by single strongest signal (ignoring red flags). Averaging signals (hides the weakness). Treating all combinations as linear addition.",
    applicable_to_us: true,
    why_applicable: "Pack 8 added confidence scoring. Pack 10 defines HOW combinations create the score. Authority is multiplicative (0 authority = 0 value regardless of other signals). Pain is additive. Warm channel is a multiplier, not a standalone.",
    confidence: "high",
    extracted_rule: "COMBINATION SCORING: Start at 0. Authority confirmed = base 30 (without authority, max score is 25 regardless of other signals). Pain described = +20. Warm channel = ×1.3 multiplier. Tool signal = +10. Pricing question = +15. Urgency behavior (fast responses) = +10. Growth signal (paper only) = +5. Champion only (no signer) = cap at 50 regardless of other positives. Deception flag = -15 each. Score determines tier allocation (see Portfolio Model).",
    target_component: "lead scoring logic, confidence scoring (Pack 8)",
    expected_metric_change: "effort allocated proportional to real deal probability",
    review_window: "after 20 leads scored",
    risk: "medium — weights are estimates until validated by outcomes. Adjust after 10+ deal outcomes.",
    apply_mode: "build",
  },
  {
    source: "Pack 6 Scarcity Priority + Pack 9 Pressure Rounds + ST1-4 (synthesis)",
    tier: "primary",
    type: "portfolio_allocation_doctrine",
    pattern: "Across all stress tests, the system handled 5-7 simultaneous signals. The pattern that worked: rank by money proximity → invest deep in top 2 → lightweight handling for 2-3 more → kill the rest. The MISTAKE to avoid: giving equal attention to all signals. Equal attention = none get enough. Concentrated attention = top 1-2 convert.",
    evidence: "ST1: 4 signals → focus on warm landscaping = correct. ST4: 7 signals → electrical + garage door + lightweight roofing + kill plumbing/fiverr = correct. Pack 6 scarcity tiers: money now → proof now → pipeline now → later → distractions.",
    anti_pattern: "Equal time across all opportunities. Following up on 7 leads with the same cadence. Building artifacts for leads that haven't qualified. Refusing to kill weak paths because 'you never know.'",
    applicable_to_us: true,
    why_applicable: "Kirill is solo. System assists but Kirill closes. 4-6 hours of real selling time per day. If spread across 7 leads = 35-50 min each = nothing gets enough attention. If concentrated on top 2 = 1.5-2h each = deals move.",
    confidence: "high",
    extracted_rule: "MAX 2 PATHS get deep investment (demo, one-pager, multiple exchanges, Kirill time). 2-3 more get lightweight handling (one qualifying message, reusable artifact, template response). Everything else gets one touch or kill. This is not optional — it's a capacity constraint. Spreading thin = losing everything.",
    target_component: "daily operating loop, portfolio ranking",
    expected_metric_change: "top paths progress faster, fewer deals lost to neglect",
    review_window: "weekly",
    risk: "medium — might kill a real opportunity ranked #4. Acceptable: better to close #1-2 than chase #1-7 and close none.",
    apply_mode: "build",
  },
  {
    source: "Pack 5 Disqualification + Pack 9 False Signals + ST3-4 (synthesis)",
    tier: "primary",
    type: "discovery_discipline",
    pattern: "Discoverability ≠ reachability ≠ buyability. A business visible on Yellow Pages (discoverable) may have a generic email (not reachable to decision-maker) and no pain (not a buyer). A Reddit poster describing pain (discoverable + pain signal) may be an employee with no budget (not a buyer). Each surface has a CONVERSION FUNNEL: discovered → reachable → qualifiable → buyer.",
    evidence: "Pack 5: 193 emails to scraped businesses = 0 human replies (discoverable ≠ buyable). ST3: plumbing 'not sure it's worth changing' = reachable but not a buyer. ST4: ServiceTitan 3 opens 0 reply = discoverable + reachable but not engaging.",
    anti_pattern: "Counting discovered businesses as pipeline. Counting sent emails as outreach success. Treating 'found their website' as a lead. Confusing a long list with a good list.",
    applicable_to_us: true,
    why_applicable: "System must track the funnel: businesses_found → leads_qualified → leads_contacted → replies_received → deals_progressed. The ratio at each step reveals which surfaces are productive and which are noise generators.",
    confidence: "high",
    extracted_rule: "DISCOVERY FUNNEL per surface: count (1) businesses_found, (2) leads_with_owner_contact, (3) leads_contacted, (4) meaningful_replies, (5) deals_progressed. If a surface produces 100 found but 0 meaningful replies → surface or channel is broken. If another produces 10 found but 3 replies → that surface is 30x more efficient per lead. Allocate time by reply-per-hour, not found-per-hour.",
    target_component: "find-businesses.mjs, analytics, portfolio strategy",
    expected_metric_change: "time shifted from high-volume low-conversion surfaces to low-volume high-conversion surfaces",
    review_window: "30 days",
    risk: "low",
    apply_mode: "auto",
  },
  {
    source: "r/sweatystartup + Pack 5 Practitioner Reality + SaaStr First 10 (synthesis)",
    tier: "primary",
    type: "ugly_but_real_surfaces",
    pattern: "Real first clients come from ugly channels: friends asking friends, $5 Craigslist ads, door knocker flyers, Nextdoor posts, business cards on bulletin boards, Thumbtack leads at $30-60 each. These are uncomfortable, manual, and unscalable — and they're exactly what produces first revenue. Lemkin: 'first 10 won't come to you, go to them.' The system must not dismiss low-tech discovery because it's unsophisticated.",
    evidence: "Pack 5: $0→$15K/month from 5,000 door hangers. Google My Business + early reviews = organic discovery. Thumbtack users = high-value leads (understand cost-per-lead). SaaStr: 'beer money' first customers = foundation for everything after.",
    anti_pattern: "Only using digital/automated discovery. Dismissing local physical channels as beneath the system. Waiting for inbound instead of outbound hustle. Optimizing cold email deliverability while ignoring the warm network sitting unused.",
    applicable_to_us: true,
    why_applicable: "Kirill is in Calgary. Local events, local groups, local directories, Nextdoor, Google Maps research = all viable and underused. A conversation at a Calgary Chamber of Commerce event is worth 100 cold emails.",
    confidence: "high",
    extracted_rule: "Include at least ONE local/physical discovery action per week: attend a local event, post in a Calgary Facebook group, check Nextdoor for service business discussions, or visit a local business area and note businesses with estimates on their website. These are low-volume, high-trust interactions. One real conversation > 50 cold emails.",
    target_component: "weekly operating loop (Pack 6), discovery playbook",
    expected_metric_change: "one additional warm lead per week from local/physical channels",
    review_window: "monthly",
    risk: "low — time investment is 1-2 hours/week",
    apply_mode: "semi_auto",
  },
  {
    source: "Pack 8 Champion Conversion + ST2-4 Champion Patterns (synthesis)",
    tier: "primary",
    type: "champion_surface_rules",
    pattern: "Champions appear on specific surfaces: Reddit (ops managers), warm intros (spouses, office managers, friends), LinkedIn (employees at target companies). Each champion surface has different conversion probability. Reddit ops manager → owner (ST3: promising, ST4: confirmed path). Warm intro spouse → husband owner (ST2-4: common but authority-gapped). Office manager → anti-tech owner (ST3-4: weak, replacement fear blocks). Champions are NOT buyers — they're ACCESS PATHS to buyers.",
    evidence: "ST3: garage door ops manager → owner path rated promising. ST4: landscaping OM → anti-software owner rated weak. All stress tests: champion confidence capped at 50% until signer engages.",
    anti_pattern: "Treating champion discovery as buyer discovery. Investing demo-level effort before signer is engaged. Scoring champion leads the same as owner-direct leads. Not assessing champion strength before investing.",
    applicable_to_us: true,
    why_applicable: "System must distinguish: discovery surface produced an OWNER (direct path) vs discovery surface produced a CHAMPION (indirect path requiring additional conversion). Same surface can produce both. LinkedIn might surface an owner (direct) or their employee (champion). Route and investment differ completely.",
    confidence: "high",
    extracted_rule: "When a discovery surface produces a contact, immediately classify: OWNER-DIRECT (can sign, direct path) or CHAMPION-PATH (cannot sign, must reach signer through them). Owner-direct: full investment justified. Champion-path: max 30 min + one artifact until signer engages. Classification happens at first message, not after 5 exchanges.",
    target_component: "deal-assist.mjs (contact_type classification), lead scoring",
    expected_metric_change: "capped investment in champion paths, more investment in direct-owner paths",
    review_window: "after 10 champion-path outcomes",
    risk: "low",
    apply_mode: "build",
  },
  {
    source: "Pack 9 False Signal Table + ST4 Learning Logic (synthesis)",
    tier: "primary",
    type: "paper_strong_behavior_weak",
    pattern: "Some surfaces produce leads that look excellent on paper (growth signals, hiring, tool usage, owner email found) but show zero behavioral engagement (don't reply, don't click, don't engage). ST2-4 ServiceTitan leads: strong paper signals, zero replies. These are 'paper-strong, behavior-weak' leads. Paper signals indicate potential pain; behavioral signals indicate felt pain. Only felt pain drives purchases.",
    evidence: "ST2: ServiceTitan 2 opens 0 reply. ST3: same. ST4: 3 opens 1 click 0 reply. All correctly deprioritized below behavior-strong leads with weaker paper signals.",
    anti_pattern: "Prioritizing paper-strong leads over behavior-strong leads. Sending 4th and 5th touches to leads with 0 behavioral engagement. Assuming growth = pain when the company may have already solved it.",
    applicable_to_us: true,
    why_applicable: "System must rank behavioral signals above paper signals. A lead who replied 'what's the price?' from a directory scrape (weak paper, strong behavior) outranks a ServiceTitan lead with 2 locations + hiring + 3 opens + 0 reply (strong paper, weak behavior).",
    confidence: "high",
    extracted_rule: "BEHAVIOR > PAPER. Always. Behavioral signals (reply, question, pain description, pricing ask, demo request) = active intent. Paper signals (hiring, growth, tool usage, reviews) = potential intent. Active intent leads get 2x the investment of potential intent leads. Paper-strong + behavior-weak after 2 touches = deprioritize. One behavior signal from ANY surface > five paper signals from a premium surface.",
    target_component: "lead scoring, portfolio ranking, send-outreach.mjs priority",
    expected_metric_change: "effort shifted from impressive-looking cold leads to actually-engaging leads",
    review_window: "after 30 leads processed",
    risk: "low",
    apply_mode: "auto",
  },
  {
    source: "Pack 6 Daily Loop + Pack 9 Multi-Surface Discovery + ST1-4 Pattern (synthesis)",
    tier: "primary",
    type: "discovery_rotation_protocol",
    pattern: "System must rotate across discovery surfaces, not fixate on one. Daily: scan 3 surfaces actively. Weekly: review all surfaces for missed opportunities. Monthly: assess per-surface conversion rates and reallocate. The rotation prevents surface fatigue (diminishing returns from repeated scanning of same source) and ensures new opportunity types enter the pipeline.",
    evidence: "Pack 9: 16 surfaces cataloged. Pack 6: daily loop has outreach step but not multi-surface rotation. ST1-4: system always had multi-source signals to work with — in reality, these must be actively discovered, not assumed to arrive.",
    anti_pattern: "Scanning same directory every day for new leads. Only checking email for replies. Not proactively searching LinkedIn, Reddit, job boards, Google Maps for fresh signals. Waiting for signals to come to you.",
    applicable_to_us: true,
    why_applicable: "Current daily loop: check replies → send outreach from existing list. Missing: actively discover NEW leads from different surfaces. The list is finite. Surfaces are not.",
    confidence: "high",
    extracted_rule: "DAILY DISCOVERY ROTATION: Pick 2 surfaces from top 6 (warm network, LinkedIn, Google Reviews, job boards, Reddit, company websites). Spend 30 min scanning each. Goal: 3-5 new qualified leads per day from varied surfaces. Log: surface → leads_found → leads_qualified. Weekly: compare surface productivity. Monthly: drop worst performer, try a new surface from the extended list.",
    target_component: "daily operating loop (new: discovery rotation step), find-businesses.mjs",
    expected_metric_change: "3-5 new qualified leads/day from diverse surfaces vs batch-scrape-and-exhaust",
    review_window: "monthly",
    risk: "medium — 1 hour/day on discovery vs other priorities. Justified by pipeline survival.",
    apply_mode: "build",
  },
  {
    source: "All Stress Tests + Pack 7-8 Learning Loop (meta-synthesis)",
    tier: "primary",
    type: "surface_learning_feedback",
    pattern: "After 30 days of multi-surface discovery, the system will know: which surfaces produce owner-direct leads (highest value), which produce champion-path leads (medium value with investment cap), which produce noise (false signals). This learning must feed back into surface allocation. Double time on productive surfaces. Cut unproductive ones. But: 30 leads minimum before concluding a surface is unproductive (Pack 4C: min_test_size rule).",
    evidence: "Pack 4C: change one variable per test, min 30 samples. Pack 6: 'system that doesn't change behavior from outcomes is not learning.' Pack 7: 1=anecdote, 3=pattern, 5=rule.",
    anti_pattern: "Concluding a surface is bad after 3 leads. Concluding a surface is great after 1 success. Never measuring surface conversion rates. Measuring found-count instead of reply-rate.",
    applicable_to_us: true,
    why_applicable: "We need to know: does LinkedIn discovery produce better leads than directory scraping? Does Reddit produce more owner-direct contacts than Google Reviews? These answers come from tracking, not guessing.",
    confidence: "high",
    extracted_rule: "SURFACE EFFECTIVENESS TRACKING: For each surface, track: leads_found, leads_qualified, leads_contacted, replies_received, deals_progressed, revenue_generated. Calculate: reply_per_lead and revenue_per_hour_spent. After 30 leads per surface: rank surfaces. Double time on top 3. Cut bottom 3. Re-evaluate monthly.",
    target_component: "analytics, portfolio strategy, discovery rotation",
    expected_metric_change: "discovery time concentrated on most productive surfaces",
    review_window: "monthly",
    risk: "low",
    apply_mode: "auto",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 2: OUTPUT A — DISCOVERY SURFACE TABLE
// ══════════════════════════════════════════════════════════════════════════════

export const DISCOVERY_SURFACE_TABLE = [
  {
    surface: "Warm network (Kirill's direct contacts)",
    buyer_type: "Friends/colleagues who ARE service business owners, or who KNOW service business owners",
    strongest_signals: "Personal connection. Mutual trust. Known business type. Can ask directly.",
    common_false_positives: "People who say 'I know someone' but never introduce. People who are enthusiastic about the IDEA but don't know actual service business owners.",
    best_entry: "Personal message: 'I help service businesses stop losing clients to slow follow-up. Know anyone who might need that?'",
    effort: "Low per contact (2 min message). Total: 525 connections × 2 min = ~17 hours to exhaust.",
    expected_value: "Highest conversion. 84% B2B starts with referral. Trust pre-exists.",
    when_to_use: "ALWAYS. First priority. 10 messages/day until exhausted.",
    when_to_avoid: "Never avoid. This is finite and expiring. Use now.",
  },
  {
    surface: "Referrals from any interaction",
    buyer_type: "Service business owners referred by someone they trust",
    strongest_signals: "Named introduction from a mutual contact. Specific person at specific company.",
    common_false_positives: "Vague 'I'll mention you' with no follow-through. Referrals to people who don't actually have the pain.",
    best_entry: "Warm message referencing introducer: '[Name] mentioned you might...'",
    effort: "Zero discovery effort (referrals come from previous interactions). High follow-up value.",
    expected_value: "Highest close rate. Borrowed trust eliminates trust gap.",
    when_to_use: "After EVERY positive interaction: 'Know anyone else who might benefit?'",
    when_to_avoid: "Never avoid asking. Even from lost deals: 'We weren't the right fit, but do you know anyone who...'",
  },
  {
    surface: "LinkedIn (profiles, posts, job changes, growth signals)",
    buyer_type: "Service business owners active on LinkedIn. Employees at target companies. 2nd-degree connections.",
    strongest_signals: "Owner title + service business + Calgary. Posts about business challenges. Job change to 'started my own company.' New hire announcements.",
    common_false_positives: "People who like/comment on business content but are employees with no authority. Ghost profiles with no activity. Companies too large for our ICP.",
    best_entry: "Connection request with personalized note (200 chars). DM if 1st-degree. Reference their post or mutual connection.",
    effort: "Medium (15 min/day scanning + 5 min per personalized connection request).",
    expected_value: "Medium-high for 1st/2nd degree. Low for cold 3rd-degree.",
    when_to_use: "Daily. Second priority after warm outreach.",
    when_to_avoid: "Don't spam 3rd-degree connections with pitches. Don't send generic connection requests.",
  },
  {
    surface: "Reddit (pain subreddits: smallbusiness, sweatystartup, HVAC, Plumbing, etc.)",
    buyer_type: "Service business owners/ops people describing problems in their own words",
    strongest_signals: "Posts about: losing estimates, can't follow up, too busy, missed calls, things falling through cracks. Ops managers asking for tool recommendations.",
    common_false_positives: "Learners ('how do I build automation myself'). Employees venting with no authority. Old posts (>48h = lost relevance). Posts from large companies.",
    best_entry: "Helpful comment first (value, no pitch). DM only after engagement. Never pitch in comments.",
    effort: "Medium (30 min/day scanning + 5 min per comment). Manual posting required.",
    expected_value: "Low volume, high signal quality. Pain is self-reported = strongest intent indicator. Ops-manager-to-owner champion path validated in ST3-4.",
    when_to_use: "Daily. 3-5 relevant threads/week in target subreddits.",
    when_to_avoid: "Subreddits where we're banned. Posts asking 'how to learn.' Posts older than 48h.",
  },
  {
    surface: "Local directories / Yellow Pages / company websites",
    buyer_type: "Any service business in target verticals + geography",
    strongest_signals: "Owner name findable. Personal email findable. Website with estimate form. Active Google listing.",
    common_false_positives: "Businesses with only generic email. Franchises (decisions at HQ). Defunct businesses still listed. Solo operators too small for our pricing.",
    best_entry: "Cold email with personalized audit paragraph referencing their specific business/tools",
    effort: "Medium-high (research per business: 5-10 min. Email: 3 min. Volume: 10-15/day).",
    expected_value: "Low-medium per lead. High volume available. Quality depends entirely on enrichment (owner name, email, website research).",
    when_to_use: "Daily cold email sends during 8-11 AM window. After warm outreach is sent.",
    when_to_avoid: "When warm leads are waiting for responses. When cold email deliverability is broken.",
  },
  {
    surface: "Google Reviews / Google Maps",
    buyer_type: "Service businesses that care about reputation and growth",
    strongest_signals: "10-50 reviews (sweet spot). Owner responds to reviews (engaged). Review complaints about 'never called back' or 'slow to respond' = exact pain signal. Recent review surge = growing.",
    common_false_positives: "0 reviews (too new or doesn't care). 200+ reviews (likely franchise/too large). Only ancient reviews (stagnant business).",
    best_entry: "Cold email referencing specific review signal: 'I noticed a few reviews mention callback speed — that's exactly what I help with.'",
    effort: "Medium (15-30 min researching reviews for 5-10 businesses).",
    expected_value: "Medium-high when pain signal found in reviews. This is EVIDENCE of pain from THEIR customers, not our assumption.",
    when_to_use: "Weekly deep scan of target categories in Calgary. Cross-reference with directory leads.",
    when_to_avoid: "Don't reference negative reviews in a way that feels like an attack. Frame as 'I noticed some customers mentioned...'",
  },
  {
    surface: "Job boards (Indeed, LinkedIn Jobs)",
    buyer_type: "Growing service businesses hiring operational roles",
    strongest_signals: "Hiring: dispatcher, estimator, office manager, service coordinator = operational overload. Multiple postings = rapid growth. Recent posting (< 14 days) = current pain.",
    common_false_positives: "Hiring for leadership/sales roles (different pain). Job posts > 30 days old (may be filled). Staffing agency posts (not end employer).",
    best_entry: "Cold email referencing growth: 'I noticed you're hiring a dispatcher — usually means more calls/estimates than your current setup handles.'",
    effort: "Low (15 min/week scanning. 3-5 relevant new postings per week in Calgary).",
    expected_value: "Medium-high. Hiring = growth = operational pain. But cold = need strong first message.",
    when_to_use: "Weekly scan. Cross-reference with directory leads and LinkedIn.",
    when_to_avoid: "Don't contact about the job posting itself. Reference growth, not the specific role.",
  },
  {
    surface: "Growth / expansion signals (new locations, new service areas, fleet expansion)",
    buyer_type: "Businesses in active growth phase",
    strongest_signals: "New location page on website. New service area on Google Maps. Multiple job posts simultaneously. New branded vehicle (local observation). Increasing review volume.",
    common_false_positives: "PAPER-STRONG, BEHAVIOR-WEAK (ST2-4). Growth on paper ≠ felt pain. They may have already hired for the problem. 6+ month old growth signals = stale.",
    best_entry: "Cold email referencing specific growth: 'Congrats on [expansion] — that usually means more estimates than your follow-up can handle.'",
    effort: "Medium (30 min/week scanning websites + job boards + Google Maps for growth indicators).",
    expected_value: "Medium when behavior matches. Low when paper-only. Always pair with behavioral verification (did they reply?).",
    when_to_use: "Weekly scan. Use to enrich cold leads found from other surfaces. Don't use as standalone surface.",
    when_to_avoid: "Don't over-invest in paper-strong leads that show zero engagement after 2 touches.",
  },
  {
    surface: "Tool-specific communities (Jobber FB group, HCP community, ServiceTitan forums)",
    buyer_type: "Service business owners/managers who ALREADY pay for tools = confirmed budget",
    strongest_signals: "Posts about tool limitations: 'Jobber doesn't auto follow-up.' 'Wish HCP had better texting.' 'How do you handle missed calls?'",
    common_false_positives: "Posts about basic tool usage (not our ICP). Tool vendor employees. Users who are satisfied (no gap to fill).",
    best_entry: "Helpful answer: 'I've built this for businesses on Jobber — here's how the follow-up works.' DM if they engage.",
    effort: "Low (15 min/day scanning. 1-2 comments/week).",
    expected_value: "High per lead. Users with tools + expressed limitations = warm buyers. But very low volume.",
    when_to_use: "Daily passive scan. Comment only when genuine gap is expressed.",
    when_to_avoid: "Don't pitch in groups with strict no-solicitation rules. Don't comment on basic how-to questions.",
  },
  {
    surface: "Marketplaces (Fiverr, Upwork)",
    buyer_type: "Businesses posting jobs for automation / CRM / follow-up work",
    strongest_signals: "Job posted for specific automation. Budget stated. Detailed requirements. Business name visible.",
    common_false_positives: "Low-budget jobs (<$500). 'ASAP' + '$400' = wants cheap labor. 'More work later' promises. Agencies posting on behalf of clients.",
    best_entry: "Response on platform at $750+ OR identify the business behind the posting and contact directly off-platform.",
    effort: "Low (10 min/day scanning relevant categories).",
    expected_value: "Low per marketplace lead (price competition). Higher if you can identify and contact the business directly off-platform.",
    when_to_use: "Daily scan for leads. Monthly for cash flow if pipeline is empty.",
    when_to_avoid: "Don't compete on price. Don't accept below $750. Don't count 'future work' as value.",
  },
  {
    surface: "Local groups / business communities (Facebook groups, Nextdoor, Chamber of Commerce)",
    buyer_type: "Local service business owners active in community",
    strongest_signals: "Business owners posting about their services. Neighbors recommending/complaining about businesses. Local business events announced.",
    common_false_positives: "Consumer discussions (not our market). Groups with no-solicitation rules. MLM/insurance networking events.",
    best_entry: "Community participation first. Establish presence. Offer value. DM after rapport. Or: identify businesses being discussed and contact directly.",
    effort: "Low-medium (30 min/week for online groups. 2-3 hours for in-person event).",
    expected_value: "Medium per contact. Hyperlocal trust. In-person events = highest trust per interaction.",
    when_to_use: "Weekly online scan. Monthly in-person event. Calgary-specific.",
    when_to_avoid: "Don't pitch in groups. Don't attend events just to sell. Provide value first.",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3: OUTPUT B — SIGNAL COMBINATION TABLE
// ══════════════════════════════════════════════════════════════════════════════

export const SIGNAL_COMBINATION_TABLE = [
  {
    combination: "Owner + tool signal + pain wording",
    meaning: "Decision-maker reachable + already invests in workflow tools + feels the problem. Near-ideal buyer.",
    strength: "85-90%",
    route: "Cold email with tool-specific audit. Reference their tool + their pain. Scope within 24h if they reply.",
    effort_justified: "FULL. Demo if asked. Scope fast. Follow-up sequence.",
  },
  {
    combination: "Champion + urgency + explicit forward request",
    meaning: "Internal advocate who wants to move fast and is asking for ammunition to sell to signer. Active champion path.",
    strength: "55-65% (capped by champion dependency)",
    route: "Internal Selling Kit: one-pager + visual + ROI + forwarding text. Send within 24h. Cap investment at 30 min until signer engages.",
    effort_justified: "MEDIUM. One artifact. 2 follow-ups. Kill if signer doesn't appear in 10 days.",
  },
  {
    combination: "Price ask + no pain described",
    meaning: "Price filtering, not buying. They want a number to compare against budget or competitor, not because they've decided to buy.",
    strength: "25-35%",
    route: "Range + qualifier: '$750-$1,500 depending on scope. Quick question — are you the owner? What's your biggest follow-up challenge?'",
    effort_justified: "MINIMAL. One qualifying message. If they engage with qualifier → upgrade. If ghost → done.",
  },
  {
    combination: "Growth signal + no engagement (paper-strong, behavior-weak)",
    meaning: "Business is growing on paper but doesn't feel operational pain enough to respond to outreach. May have already solved it.",
    strength: "15-25%",
    route: "Audit-based second touch referencing specific growth signals. Max 3 total touches.",
    effort_justified: "MINIMAL. One adapted email. No demo. No artifact. If 0 reply after 3 touches → mark lost.",
  },
  {
    combination: "Warm intro + anti-software owner",
    meaning: "Trust channel is strong but buyer has a pre-existing aversion to tech. Common in service businesses. Trust helps, but tech fear is a deep barrier.",
    strength: "40-55%",
    route: "Champion-equip with anti-complexity kit. Zero tech language. 3-step experience description. 'Not software — just texts and alerts.' Must pass through champion to owner.",
    effort_justified: "MEDIUM. One-pager + simple visual. But capped: if owner doesn't engage after champion forwards → accept it.",
  },
  {
    combination: "Ops manager + owner access claim",
    meaning: "Employee who uses tools daily + says they can reach the signer. Champion with operational credibility. ST3-4 validated this path.",
    strength: "35-50% (depends on whether owner actually engages)",
    route: "Send concrete artifact (demo + pricing + forwarding text). Ops manager forwards. One follow-up. Owner engages or doesn't.",
    effort_justified: "MEDIUM. One artifact (20-30 min, reusable template). 2 follow-ups max. Kill if no owner in 10 days.",
  },
  {
    combination: "Marketplace + future upside promise",
    meaning: "They want cheap work now and are using 'more later' as negotiation leverage. Future promise = $0 value in all observed cases.",
    strength: "10-20%",
    route: "Counter at $750. Evaluate current deal only. Ignore future promise.",
    effort_justified: "MINIMAL. One counter-offer. Accept at $750+ or walk.",
  },
  {
    combination: "Owner-direct + pricing question + timeline question + scope discussion",
    meaning: "ACTIVE BUYER. Signer in conversation, evaluating price, asking when, discussing what's included. Highest-intent pattern across all stress tests.",
    strength: "75-90%",
    route: "Value-stack scope immediately. Include guarantee. Specific start date. This is the path that closes.",
    effort_justified: "MAXIMUM. Demo if asked. Scope within hours. Kirill's personal attention. Invoice prep ready.",
  },
  {
    combination: "Cold reply 'interested' + no qualifier answered",
    meaning: "Polite acknowledgment. Canadian courtesy. NOT buying behavior. Will likely ghost after receiving any actual information.",
    strength: "10-20%",
    route: "One qualifying question. If answered → real, upgrade. If silence → dead. Do NOT send scope or pricing.",
    effort_justified: "MINIMAL. One message. One follow-up if silence. Then kill.",
  },
  {
    combination: "Owner + trust scar ('burned by software') + still engaging (5+ messages)",
    meaning: "Buyer with deep interest and deep fear. They WANT to buy but are protecting themselves. Engagement despite fear = strong underlying intent.",
    strength: "55-70%",
    route: "Anti-complexity demo + guarantee front-loaded. Zero tech language. 'Not software. Just texts and alerts.' ST4: this was the primary money path.",
    effort_justified: "FULL but careful. Every artifact must pass simplicity test. Over-selling = confirms their fear. Under-selling = they don't see value. Calibrated middle.",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 4: OUTPUT C — SURFACE ENTRY STRATEGY TABLE
// ══════════════════════════════════════════════════════════════════════════════

export const SURFACE_ENTRY_TABLE = [
  {
    surface: "Warm network",
    first_move: "Personal message asking if they know service business owners with follow-up pain",
    second_move: "If they name someone → ask for introduction. If vague → 'No worries, just thought I'd ask.'",
    what_not_to_do: "Pitch THEM if they're not a service business owner. Explain your whole system. Send a long message.",
    when_to_build_artifact: "Only after introduction is made and prospect engages",
    when_to_walk: "After 2 non-responses from the same contact. Don't ask 3 times.",
  },
  {
    surface: "Referrals",
    first_move: "Personal message to prospect referencing introducer by name",
    second_move: "Ask about their specific pain. Match to their business type.",
    what_not_to_do: "Send generic template. Fail to mention introducer. Pitch immediately.",
    when_to_build_artifact: "After prospect describes pain or asks for proof",
    when_to_walk: "If prospect is polite but no pain described after 2 exchanges → they took the call as a favor, not because they need help.",
  },
  {
    surface: "LinkedIn",
    first_move: "Connection request with personalized 200-char note referencing their business or a shared connection",
    second_move: "Once connected: one DM with value + qualifier. NOT a pitch.",
    what_not_to_do: "Pitch in connection request. Send 3 DMs before they reply. Target companies over 50 employees.",
    when_to_build_artifact: "After they express interest or ask questions",
    when_to_walk: "Connection accepted but no reply to DM → one follow-up. Still nothing → move on.",
  },
  {
    surface: "Reddit",
    first_move: "Helpful comment on pain thread. Zero pitch. Pure value.",
    second_move: "If they engage (reply, upvote, DM) → respond. If DM → qualify authority.",
    what_not_to_do: "Pitch in comments. DM without prior engagement. Comment on old threads.",
    when_to_build_artifact: "After DM confirms authority and interest",
    when_to_walk: "After helpful comment gets no engagement. Or after DM reveals learner/no-authority.",
  },
  {
    surface: "Directories / company websites",
    first_move: "Research business (website, tools, reviews, owner name) → personalized cold email with audit paragraph",
    second_move: "If reply → classify and route per deal-assist. If silence → follow-up day 3, day 7, day 14, breakup.",
    what_not_to_do: "Send to generic emails without researching. Skip owner-name research. Use same template for all categories.",
    when_to_build_artifact: "After meaningful reply that describes pain or asks for proof",
    when_to_walk: "After complete follow-up sequence with no response (4 touches).",
  },
  {
    surface: "Google Reviews",
    first_move: "Research reviews for callback/follow-up complaints → cold email referencing the specific signal",
    second_move: "If reply → route per deal-assist. If silence → standard follow-up.",
    what_not_to_do: "Quote negative reviews back to them aggressively. Reference specific customer names from reviews.",
    when_to_build_artifact: "After reply indicates interest",
    when_to_walk: "After standard cold follow-up sequence with no reply.",
  },
  {
    surface: "Job boards",
    first_move: "Cold email referencing their growth: 'Noticed you're hiring a [role] — that usually means [pain].'",
    second_move: "Standard deal-assist flow if they reply.",
    what_not_to_do: "Apply for the job. Mention the specific job posting URL. Contact HR instead of owner.",
    when_to_build_artifact: "After reply confirms pain and authority",
    when_to_walk: "After 2 cold touches with no reply. Growth signal was paper-only.",
  },
  {
    surface: "Tool communities",
    first_move: "Helpful answer to a question about tool limitations. Mention you've built solutions for this.",
    second_move: "If they engage → DM with more details. Qualify authority.",
    what_not_to_do: "Pitch in the group. Post promotional content. Argue with tool vendors.",
    when_to_build_artifact: "After DM confirms they want to see something specific",
    when_to_walk: "After comment gets no engagement. Or DM reveals no authority/budget.",
  },
  {
    surface: "Marketplaces",
    first_move: "Counter at $750. Clear scope. No negotiation on first message.",
    second_move: "If they accept → define scope in writing before starting. If they push below $750 → walk.",
    what_not_to_do: "Accept below $750. Promise 'more work later' has value. Compete on price.",
    when_to_build_artifact: "After payment received. Not before.",
    when_to_walk: "Immediately if budget < $750 and no counter-acceptance.",
  },
  {
    surface: "Local groups / events",
    first_move: "Attend, participate, provide value. Exchange cards. Follow up within 24h with personal email.",
    second_move: "Reference the conversation: 'Great meeting you at [event]. Here's that follow-up thing I mentioned.'",
    what_not_to_do: "Pitch at the event. Collect cards and mass-email. Skip events because they're 'not scalable.'",
    when_to_build_artifact: "After follow-up conversation shows interest",
    when_to_walk: "After one follow-up email with no response. In-person contacts who don't reply to email = they were being polite at the event.",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 5: OUTPUT D — OPPORTUNITY PORTFOLIO ALLOCATION MODEL
// ══════════════════════════════════════════════════════════════════════════════

export const PORTFOLIO_ALLOCATION_MODEL = {
  description: "Strict model for allocating Kirill's scarce time across simultaneous opportunities. Max 2 deep paths + 2-3 lightweight + kill the rest.",

  scoring_dimensions: [
    { dimension: "money_distance", weight: "25%", description: "How many steps to cash? 1-2 = high. 5+ = low." },
    { dimension: "authority_quality", weight: "20%", description: "Signer in conversation = high. Champion only = medium. Unknown = low." },
    { dimension: "behavioral_engagement", weight: "15%", description: "Multiple messages + questions + pricing ask = high. One 'interested' = low. Opens without reply = near-zero." },
    { dimension: "pain_clarity", weight: "15%", description: "Described specific pain in own words = high. Generic 'interested' = low. Satisfied with status quo = zero." },
    { dimension: "trust_channel", weight: "10%", description: "Warm intro = high. Community engagement = medium. Cold = low." },
    { dimension: "effort_to_move", weight: "5%", description: "One message can advance = low effort (good). Needs demo + one-pager + partner review = high effort." },
    { dimension: "strategic_value", weight: "5%", description: "First client in a vertical = high. First unaffiliated client = high. Marketplace client = low." },
    { dimension: "deception_risk", weight: "5%", description: "Verified signals = low risk. Unverified + positive language = high risk. Deduction applied." },
  ],

  tiers: [
    {
      tier: 1,
      name: "DEEP INVESTMENT",
      criteria: "Score 65+. Signer engaged OR strong verified champion. Real pain. Short money distance.",
      max_slots: 2,
      resources: "Kirill's personal attention. Custom demo if requested. Scope within hours. Multiple exchanges. One-pager for stakeholders. Full follow-up sequence.",
      time_per_day: "1-2 hours per path",
      examples: "ST1 warm landscaping owner. ST4 electrical owner. Any owner-direct with pain + pricing question.",
    },
    {
      tier: 2,
      name: "SYSTEM-ASSISTED PRIORITY",
      criteria: "Score 45-64. Champion path with forward commitment. Or: owner contact with some uncertainty.",
      max_slots: 3,
      resources: "Reusable artifact (one-pager from template, adapted demo). System prepares, Kirill reviews 30 sec. Standard follow-up sequence.",
      time_per_day: "15-30 min per path",
      examples: "ST3 garage door ops manager. ST4 landscaping OM. Roofing owner with price ceiling.",
    },
    {
      tier: 3,
      name: "LIGHTWEIGHT EXPLORATORY",
      criteria: "Score 25-44. Some positive signal but major unknowns. Price-filtering leads. Unqualified contacts.",
      max_slots: "unlimited",
      resources: "ONE qualifying message. Template-based. No custom artifact. No demo. No Kirill time beyond review.",
      time_per_day: "5 min per path (one message + wait)",
      examples: "Cold 'send prices' lead. Reddit 'interested' DM without authority confirmed. ServiceTitan 2nd touch.",
    },
    {
      tier: 4,
      name: "ONE-TOUCH AND WAIT",
      criteria: "Score 10-24. Paper signals only. No behavioral engagement. Or: one message sent, waiting for response.",
      max_slots: "unlimited",
      resources: "One outreach message (cold email, follow-up). Auto follow-up sequence. Zero Kirill time.",
      time_per_day: "0 (system handles automatically)",
      examples: "Cold email to directory lead. Follow-up sequence on non-responsive lead. ServiceTitan after 2nd touch.",
    },
    {
      tier: 5,
      name: "KILL / IGNORE",
      criteria: "Score <10. Confirmed non-buyer. Below price floor. No authority path. Satisfied with status quo.",
      max_slots: "N/A",
      resources: "Zero. Mark dead. Log reason. Never contact again (or schedule far-future re-approach if timing was the only issue).",
      time_per_day: "0",
      examples: "Fiverr <$750. Plumbing 'not worth changing.' Generic email with no owner findable after research.",
    },
  ],

  rebalancing_rules: [
    "If a Tier 1 path closes or dies → promote highest Tier 2 to Tier 1.",
    "If a Tier 3 lead replies with strong signal → promote to Tier 2 immediately.",
    "If a Tier 1 path stalls for 7+ days → demote to Tier 2. Promote next best.",
    "Weekly: review all tier assignments. Are the right 2 paths in Tier 1?",
    "Never have 0 paths in Tier 1. If all are weak, the LEAST weak gets Tier 1 treatment.",
    "Discovery rotation fills Tiers 3-4 daily. Conversion handles Tiers 1-2.",
  ],
};


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 6: OUTPUT E — DISCOVERY PLAYBOOK BY BUYER TYPE
// ══════════════════════════════════════════════════════════════════════════════

export const DISCOVERY_PLAYBOOK = [
  {
    buyer_type: "Direct owner (service business, 5-30 employees)",
    where_to_find: "LinkedIn (profile search by title + industry + location). Directories + website research (About page). Google Reviews (owner responds). Warm network ('know any business owners?'). Local events.",
    signal_that_matters: "Owner name confirmed. Personal email found (not info@). Website with estimate form. 10-50 Google reviews. Active on LinkedIn.",
    how_to_enter: "Warm: personal message via intro. Cold: personalized email with audit referencing their business. LinkedIn: connection request with specific note.",
    what_to_avoid: "Generic email to info@. Pitch before research. Long first message. Feature-focused language.",
    what_makes_them_worth_chasing: "They can say YES without asking anyone. Shortest path to cash. Every owner-direct conversation is worth 3 champion-path conversations.",
  },
  {
    buyer_type: "Spouse / co-owner",
    where_to_find: "Warm intros (friend says 'talk to Mike's wife, she handles the office'). Reply to cold email from a non-owner email that mentions 'my husband owns it.'",
    signal_that_matters: "Describes operational pain. References the owner/partner. Willing to show materials to signer. Gives timeline for partner review.",
    how_to_enter: "Through the champion with Internal Selling Kit. Never bypass them to reach the partner directly (insults them).",
    what_to_avoid: "Sending scope directly to the partner without the champion's involvement. Treating spouse as secretary. Over-investing before signer engages.",
    what_makes_them_worth_chasing: "They live the pain daily. Strong emotional motivation. But: capped investment until signer engages.",
  },
  {
    buyer_type: "Office manager",
    where_to_find: "Replies to cold emails (they manage the inbox). Warm intros ('talk to their office manager'). Tool communities (they manage the tools).",
    signal_that_matters: "Describes follow-up pain. References estimates sitting. Knows the numbers (volume, loss rate). BUT: may fear replacement.",
    how_to_enter: "Position tool as helping them, not replacing them. 'Catches what you can't get to when you're already handling something else.'",
    what_to_avoid: "Treating them as buyer (they can't sign). Ignoring replacement fear. Investing demo-level effort before they commit to showing the owner.",
    what_makes_them_worth_chasing: "Only if they COMMIT to showing the owner AND don't have replacement fear. If either is missing → max 30 min investment.",
  },
  {
    buyer_type: "Ops lead / operations manager",
    where_to_find: "Reddit DMs (self-identify in pain threads). LinkedIn (title search). Warm intros from industry contacts.",
    signal_that_matters: "Understands the problem operationally. Claims access to owner. Asks for 'something concrete I can show.' ST3-4 validated this path.",
    how_to_enter: "Concrete artifact: demo + pricing + forwarding text. They asked for it — give it. Then: 'Did the owner get a chance to look?'",
    what_to_avoid: "Over-investing before owner engages. Building custom demos (reuse templates). Following up more than 3 times.",
    what_makes_them_worth_chasing: "When they deliver the signer. Until then: medium investment, hard 10-day deadline on owner engagement.",
  },
  {
    buyer_type: "Marketplace buyer (Fiverr, Upwork)",
    where_to_find: "Marketplace job postings. Inbound messages on Fiverr/Upwork gig pages.",
    signal_that_matters: "Budget ≥ $750. Specific automation need described. Business name visible (can research off-platform).",
    how_to_enter: "Counter at $750 minimum. Clear scope definition before starting. Ignore 'future work' promises.",
    what_to_avoid: "Accepting below $750. Competing on price. Counting future work as current value. Spending more than 15 min before payment.",
    what_makes_them_worth_chasing: "Cash flow ONLY. No case study value. No referral value. No repeat at good pricing. Only if pipeline is empty.",
  },
  {
    buyer_type: "Paper-strong growth lead (ServiceTitan-level signals)",
    where_to_find: "Website research (new locations, new service pages). Job boards (hiring dispatchers). Google Maps (new listings). ServiceTitan/Jobber public case studies.",
    signal_that_matters: "Behavioral engagement only. Paper signals are necessary but not sufficient. Opens + clicks without reply = paper-strong, behavior-weak.",
    how_to_enter: "Cold email with growth-specific reference. Second touch with audit. Max 3 touches total.",
    what_to_avoid: "Investing more than 3 touches on paper-only leads. Treating opens/clicks as engagement. Building artifacts for non-responsive leads.",
    what_makes_them_worth_chasing: "Only when behavioral engagement appears. Until then: Tier 4 (one-touch-and-wait).",
  },
  {
    buyer_type: "Warm intro lead (any type)",
    where_to_find: "Kirill's network. Post-delivery referral asks. Friend-of-friend introductions. Event follow-ups.",
    signal_that_matters: "Quality of the intro (named introduction > 'I'll mention you'). Prospect's own engagement after intro (pain described > polite questions > silence).",
    how_to_enter: "Personal message referencing introducer. Ask about their specific situation. Match to their business type.",
    what_to_avoid: "Assuming warm = buyer. Intro = warm channel, not warm intent. Must still qualify pain, authority, timing.",
    what_makes_them_worth_chasing: "Trust advantage over cold. But trust advantage expires if prospect doesn't describe pain within 2 exchanges. Warm + no pain = warm dead end.",
  },
  {
    buyer_type: "Cold pricing lead ('send me your prices')",
    where_to_find: "Cold email replies. LinkedIn DM responses. Any outreach response that asks only about price.",
    signal_that_matters: "Did they answer the qualifier? Real evaluators answer questions because they want the right scope. Intel collectors take the number and disappear.",
    how_to_enter: "Range + qualifier: '$750-$1,500 depending on scope. Are you the owner? What's your biggest follow-up challenge?'",
    what_to_avoid: "Sending bare price without qualifier. Sending full scope without confirming authority. Following up more than twice if qualifier ignored.",
    what_makes_them_worth_chasing: "Only after qualifier answered. Before that: 25% confidence. After qualifier answered with specifics: 50%+.",
  },
];


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 7: OUTPUT F — SYSTEM CHANGES
// ══════════════════════════════════════════════════════════════════════════════

export const SYSTEM_CHANGES = {

  research_business: [
    {
      change: "Multi-surface lead enrichment",
      current: "Single-source: Yellow Pages scrape",
      new: "For each lead: check Google Reviews (count + owner responds?), check website (estimate form? team page? tool badges?), check LinkedIn (owner profile?), check Indeed (hiring?). Store all surface data per lead.",
    },
    {
      change: "Add discovery_surface field",
      current: "Leads have no source-surface tracking",
      new: "Every lead records: which surface discovered it, which enrichment surfaces were checked, which signals found per surface.",
    },
  ],

  send_outreach: [
    {
      change: "Route selection per discovery surface",
      current: "All leads get same cold email template",
      new: "Template selected based on strongest signal: tool_detected → tool-specific audit. growth_signal → growth-reference email. review_pain → review-reference email. warm_intro → personal message (never template).",
    },
    {
      change: "Priority order by combination score",
      current: "Sends in order found",
      new: "Sends in order of combination_score: owner + tool + pain wording first. Generic directory leads last.",
    },
  ],

  lead_scoring: [
    {
      change: "Combination-based scoring",
      current: "Individual signal weights added",
      new: "Authority = base requirement (0 authority = max 25 points). Pain = additive (+20). Warm channel = multiplier (×1.3). Tool = additive (+10). Pricing ask = additive (+15). Behavioral engagement = additive (+10). Paper signals = additive (+5). Champion-only = cap at 50. Deception flags = -15 each.",
    },
  ],

  champion_scoring: [
    {
      change: "Champion path investment cap",
      current: "No cap — champions get same investment as direct owners",
      new: "Champion paths: max 30 min artifact creation + 2 follow-ups until signer engages. Hard 10-day deadline. If signer doesn't appear → demote to Tier 4 or kill.",
    },
  ],

  discovery_prioritization: [
    {
      change: "Daily discovery rotation protocol",
      current: "No structured discovery scanning",
      new: "Daily: pick 2 of top 6 surfaces. Scan 30 min each. Goal: 3-5 new qualified leads/day. Weekly: compare surface productivity. Monthly: drop worst, try new.",
    },
  ],

  artifact_prioritization: [
    {
      change: "Artifact creation gated by tier",
      current: "Artifacts built when requested by any lead",
      new: "Tier 1: custom artifact (demo, one-pager) within 24h. Tier 2: reusable artifact adapted from template within 48h. Tier 3-5: no artifact until promoted.",
    },
  ],

  portfolio_ranking: [
    {
      change: "Formal tier system with max slots",
      current: "Informal priority based on gut feel",
      new: "5-tier system. Max 2 Tier 1. Max 3 Tier 2. Unlimited Tier 3-4. Weekly rebalancing. Promotion/demotion based on engagement changes.",
    },
  ],

  sla_rules: [
    {
      change: "Response SLA by tier",
      current: "2h SLA for all pricing questions, 4h for others",
      new: "Tier 1: 1h for any message. Tier 2: 4h. Tier 3: 24h. Tier 4: auto-sequence only. These SLAs are FIRM — Tier 1 always gets fastest response.",
    },
  ],

  kill_pause: [
    {
      change: "Standardized kill/pause triggers by tier",
      current: "Ad-hoc decisions per lead",
      new: "Kill triggers: satisfied with status quo + explicit statement. Below price floor + no counter-acceptance. Champion silent 10 days post-equipping. 3 cold touches + 0 response. Pause triggers: timing objection with specific future date. Champion forwarded but no signer feedback yet (wait 10 days).",
    },
  ],

  time_allocation: [
    {
      change: "50/50 discovery/conversion split",
      current: "Most time on conversion (deal handling), discovery as batch task",
      new: "50% discovery (scanning surfaces, qualifying new leads, sending first-touch messages). 50% conversion (active deals, follow-ups, artifacts, Kirill prep). Adjusts: empty pipeline → 70/30 discovery. Full pipeline → 30/70 conversion. Never 0% either way.",
    },
  ],
};


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 8: OUTPUT G — FINAL DISCOVERY DOCTRINE
// ══════════════════════════════════════════════════════════════════════════════

export const DISCOVERY_DOCTRINE = {
  statement:
    "The system hunts for service-business owners with operational pain across every surface where they're findable, qualifies them by behavioral engagement not paper signals, enters through the route that matches how they were found, concentrates deep investment on the 2 closest-to-cash opportunities, and continuously learns which surfaces and routes produce money — killing what doesn't, doubling what does.",

  principles: [
    {
      id: 1,
      principle: "Discovery is half the job, not a setup task.",
      operational: "50% of daily time goes to finding new leads across multiple surfaces. Pipeline starvation kills faster than bad deal handling. A perfectly handled deal with an empty pipeline behind it = one sale then nothing.",
    },
    {
      id: 2,
      principle: "Surface determines route. Route determines first message.",
      operational: "A lead found via warm intro gets a personal message. Same person found via directory gets a cold email with audit. Same person found via Reddit gets a helpful comment then DM. Never use the wrong route for the discovery surface. It signals laziness or automation, which destroys the trust the surface created.",
    },
    {
      id: 3,
      principle: "Behavior outranks paper. Always.",
      operational: "One reply with pain described > five growth signals with zero engagement. One pricing question from a directory lead > two locations + hiring + opened email 3 times from a 'premium' lead. Invest proportional to behavioral engagement, not paper impressiveness.",
    },
    {
      id: 4,
      principle: "Owner-direct paths are worth 3x champion paths.",
      operational: "Every message exchanged with the signer is worth 3 messages exchanged with a champion, because champion messages must be TRANSLATED and FORWARDED — both lossy processes. When the system finds an owner: maximum investment. When it finds a champion: capped investment until signer appears.",
    },
    {
      id: 5,
      principle: "Concentrate, don't spread.",
      operational: "Max 2 deep paths at any time. 2-3 lightweight. Kill the rest. Spreading attention across 7 opportunities means none get enough to close. Concentrated attention on the top 2 means at least one converts. This is a capacity constraint, not a preference.",
    },
    {
      id: 6,
      principle: "Warm is finite. Use it first.",
      operational: "525 LinkedIn connections. Local events. Friends of friends. These are the highest-conversion surfaces AND they expire (people move, forget, lose relevance). Cold email from directories is always available. Warm is not. The system must exhaust warm outreach velocity (10/day) before investing heavily in cold.",
    },
    {
      id: 7,
      principle: "Measure surfaces by replies, not by leads found.",
      operational: "A surface that produces 100 leads with 0 replies is worse than a surface that produces 5 leads with 2 replies. Discovery effectiveness = meaningful replies per hour spent scanning that surface. Track per-surface. Double the best. Cut the worst. Monthly.",
    },
    {
      id: 8,
      principle: "Every interaction is a discovery opportunity.",
      operational: "After every deal (won, lost, or stalled): 'Know anyone else who might benefit?' After every community comment: monitor for DMs. After every event: follow up with every card within 24h. Discovery is continuous, not scheduled.",
    },
  ],
};


// ══════════════════════════════════════════════════════════════════════════════
// SECTION 9: PRACTICAL SUMMARY
// ══════════════════════════════════════════════════════════════════════════════

export const PRACTICAL_SUMMARY = {

  top_5_discovery_surface_rules: [
    "1. WARM NETWORK FIRST, ALWAYS. 525 LinkedIn connections at 10/day = 52 days. This is the highest-conversion surface and it EXPIRES. Cold email will always be available. Warm won't. 10 warm messages before any cold email sends, every day.",
    "2. DAILY DISCOVERY ROTATION: pick 2 surfaces from top 6 (warm, LinkedIn, Google Reviews, job boards, Reddit, company websites). Scan 30 min each. Goal: 3-5 new qualified leads per day. One surface alone produces pipeline starvation.",
    "3. SURFACE DETERMINES ROUTE. Lead found via warm intro → personal message. Via directory → cold email with audit. Via Reddit → helpful comment then DM. Via Google Reviews → cold email referencing their reviews. Same person, different surfaces = completely different first message.",
    "4. MEASURE SURFACES BY REPLIES, NOT LEADS FOUND. A surface producing 100 leads with 0 replies is noise. A surface producing 5 leads with 2 replies is gold. Track meaningful_replies_per_hour_scanning per surface. Monthly: double top 3, cut bottom 3.",
    "5. INCLUDE ONE LOCAL/PHYSICAL DISCOVERY ACTION PER WEEK. Calgary Chamber event. Facebook group post. Nextdoor scan. Business card exchange. One in-person conversation = trust level that takes 20 emails to build. Low volume, highest trust per contact.",
  ],

  top_5_signal_combination_rules: [
    "1. AUTHORITY IS MULTIPLICATIVE, NOT ADDITIVE. Owner confirmed = base 30 points. No authority = max 25 points regardless of everything else. A perfect lead with no authority path is a dead lead. Always verify authority in first 2 messages.",
    "2. OWNER + PAIN + PRICING QUESTION = ACT NOW. This combination appeared in ST1, ST2, ST4 as the primary money path every time. When the signer describes pain and asks about price in the same conversation = highest intent pattern. Response SLA: 1 hour.",
    "3. CHAMPION + ENTHUSIASM ≠ DEAL. Confidence cap at 50% until signer engages directly. ST2: wife sent 6 messages, husband hadn't been reached. ST3: sister sent 4 messages, brother unknown. ST4: OM proactive but conflicted. Champion energy is not buyer commitment.",
    "4. GROWTH SIGNALS WITHOUT BEHAVIORAL ENGAGEMENT = TIER 4 ONLY. Hiring + new location + opened email 3 times + zero reply = interesting targeting, zero intent. Max 3 cold touches. No artifacts. No Kirill time. Paper signals are potential, not proof.",
    "5. 'INTERESTED' FROM COLD + NO QUALIFIER ANSWERED = 20% CONFIDENCE. Canadian politeness. Curiosity. Boredom. All produce 'interested.' Only upgrades to 50%+ when they answer a qualifying question with specifics. Until then: one template message, one follow-up, done.",
  ],

  top_5_portfolio_allocation_rules: [
    "1. MAX 2 DEEP PATHS AT ANY TIME. Kirill is solo. 4-6 hours selling time per day. Spread across 7 leads = 35 min each = nothing converts. Concentrated on top 2 = 1.5-2h each = deals move. This is capacity math, not preference.",
    "2. TIER 1 GETS 1-HOUR SLA. TIER 3 GETS 24-HOUR. A warm owner asking about pricing waits 1 hour max. A cold 'send prices' lead waits 24h. SLA reflects deal probability. Never make Tier 1 wait because you're composing a reply to Tier 3.",
    "3. 50% DISCOVERY, 50% CONVERSION — EVERY DAY. Pipeline starvation kills faster than bad deal handling. Empty pipeline + perfect close skills = one sale then nothing. Full pipeline + decent close skills = continuous revenue. Adjust: empty pipeline = 70/30. Full = 30/70. Never 0% discovery.",
    "4. CHAMPION PATHS GET HARD 10-DAY DEADLINE. After equipping champion with one-pager/artifact: if signer doesn't engage within 10 days, demote to Tier 4 or kill. Champion enthusiasm without signer engagement is the most seductive form of false progress.",
    "5. WEEKLY REBALANCING IS MANDATORY. Every 7 days: are the right 2 paths in Tier 1? Has a Tier 3 lead produced strong new signals? Has a Tier 1 path stalled? Promote, demote, kill. The portfolio is alive — treat it as such.",
  ],

  top_3_doctrine_changes: [
    "1. ADD DAILY DISCOVERY ROTATION TO OPERATING LOOP. Between 'reply check' and 'outreach execution' in the daily loop: 1 hour of multi-surface scanning. This is not optional and not something that happens 'when there's time.' It's a survival function with equal priority to deal handling.",
    "2. IMPLEMENT COMBINATION SCORING FOR LEAD PRIORITIZATION. Replace individual signal weights with combination-based scoring where authority is multiplicative, behavioral engagement weighs 3x paper signals, and champion-only paths are capped at 50. This changes which leads get Kirill's time.",
    "3. TRACK AND COMPARE SURFACE EFFECTIVENESS MONTHLY. replies_per_hour and revenue_per_surface are the metrics that matter. After 30 days: double time on top 3 surfaces, cut bottom 3, try one new surface from the extended list. The system must learn WHERE its clients actually come from, not just how to handle them after they arrive.",
  ],
};
