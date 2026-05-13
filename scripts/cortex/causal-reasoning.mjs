/**
 * CORTEX CAUSAL REASONING ENGINE
 *
 * Teaches the system to think in cause-effect chains like a business developer.
 *
 * When a major AI release happens, a human business mind thinks:
 *   SIGNAL → WHY does it matter → WHO will pay → WHERE are they →
 *   WHAT to offer → HOW to get there first → ACTION
 *
 * This module replicates that chain. Not one prompt - six steps,
 * each feeding the next. The output is not "interesting news" but
 * "here are 3 people to contact TODAY about THIS opportunity."
 *
 * Triggered by: hunger-engine when it detects a major release,
 * or manually via: node scripts/cortex/causal-reasoning.mjs "OpenAI released Images 2.0"
 *
 * Cost: ~3 Claude CLI calls per chain ($0 on Max subscription)
 */

import { spawnSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const CHAINS_DIR = resolve(ROOT, ".data/reasoning-chains");
const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";

// Ensure chains directory exists
try {
  const { mkdirSync } = await import("fs");
  mkdirSync(CHAINS_DIR, { recursive: true });
} catch {}

// ── Claude CLI helper ───────────────────────────────────────────────────

function askClaude(prompt, timeout = 90_000) {
  const promptFile = resolve(ROOT, ".data/causal-prompt.md");
  writeFileSync(promptFile, prompt);

  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING;
  cleanEnv.PATH = `$HOME/.nvm/versions/node/v22.22.2/bin:${process.env.PATH || "/usr/bin:/bin"}`;

  const r = spawnSync("bash", [
    "-c",
    `cat "${promptFile}" | "${CLAUDE_BIN}" -p --model claude-sonnet-4-6 --max-turns 1 --output-format text 2>&1`,
  ], {
    cwd: ROOT,
    env: cleanEnv,
    encoding: "utf-8",
    timeout,
    maxBuffer: 5 * 1024 * 1024,
  });

  const output = ((r.stdout || "") + (r.stderr || "")).trim();
  if (!output || r.status !== 0) return null;

  const jsonMatch = output.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch {}
  }
  return output;
}

// ── Step 1: WHAT happened and WHY does it matter? ───────────────────────

function step1_analyze(signal) {
  return askClaude(`You are a business analyst. A major event happened in AI/tech:

"${signal}"

Analyze this with business logic:

1. WHAT exactly was released/announced?
2. WHY did they build this? (What market demand does this serve?)
3. HOW BIG is the opportunity? (How many businesses will need help with this?)
4. TIMING: Is this the right moment? (First 48 hours after release = maximum opportunity)

Return JSON:
{
  "what": "clear description of the release",
  "why_it_matters": "the market demand behind this",
  "opportunity_size": "small|medium|large|massive",
  "timing": "urgent (just released)|fresh (this week)|stale (old news)",
  "key_insight": "the ONE thing most people will miss about this"
}`);
}

// ── Step 2: WHO will pay for help? ──────────────────────────────────────

function step2_buyers(analysis) {
  return askClaude(`You are a customer researcher. A new AI product was released:

${JSON.stringify(analysis, null, 2)}

WHO will struggle to adopt this and PAY for help? Think in segments:

1. Small businesses (restaurants, clinics, real estate, retail) - no tech team
2. Solo founders / startups - need to ship fast
3. Agencies / consultants - need to offer this to THEIR clients
4. Content creators / marketers - need practical workflows
5. Enterprise teams - need integration with existing tools

For each relevant segment, describe:
- Their specific pain with this new tech
- Their budget range
- Their urgency level
- Why they can't do it themselves

Return JSON:
{
  "segments": [
    {
      "name": "segment name",
      "pain": "their specific struggle",
      "budget_range": "$X-$Y",
      "urgency": "high|medium|low",
      "why_cant_diy": "why they need help",
      "example_buyer": "concrete example: 'dentist in Calgary who wants AI product photos'"
    }
  ],
  "best_segment": "which segment to target FIRST and why"
}`);
}

// ── Step 3: WHERE are they right now? ───────────────────────────────────

function step3_channels(analysis, buyers) {
  return askClaude(`You are a channel strategist. We identified buyers who need help with a new AI release:

RELEASE: ${analysis.what}
BEST SEGMENT: ${buyers.best_segment}
TARGET BUYERS: ${JSON.stringify(buyers.segments?.slice(0, 3), null, 2)}

WHERE are these people RIGHT NOW asking for help or discussing this?

Be EXTREMELY SPECIFIC. Not "Reddit" but "r/realestateinvesting - 3 posts this week about AI photos".
Not "LinkedIn" but "search LinkedIn for 'AI product photography' - founders posting about this".

Think about:
1. Reddit subreddits where this segment hangs out
2. Specific Google searches they're making right now
3. Twitter/X conversations happening right now
4. YouTube comments on tutorials about this
5. Facebook groups for this industry
6. Slack/Discord communities
7. Forum threads (IndieHackers, HackerNews, ProductHunt)
8. Industry-specific platforms

Return JSON:
{
  "channels": [
    {
      "platform": "exact platform",
      "location": "exact URL, subreddit, group name, or search query",
      "signal_type": "what to look for (posts asking for help, job postings, complaints)",
      "volume": "high|medium|low",
      "competition": "how many others are already offering help here"
    }
  ],
  "search_queries": ["exact Google/Reddit search queries to find these buyers NOW"],
  "fastest_channel": "which channel to hit FIRST for fastest response"
}`);
}

// ── Step 4: WHAT to offer and at WHAT price? ────────────────────────────

function step4_offer(analysis, buyers, channels) {
  const bestSegment = buyers.segments?.find(s => s.name === buyers.best_segment) || buyers.segments?.[0];

  return askClaude(`You are a service designer for Kirill D. - AI workflow architect in Calgary, Canada.

NEW OPPORTUNITY:
${analysis.what}
${analysis.key_insight}

TARGET BUYER:
${JSON.stringify(bestSegment, null, 2)}

KIRILL'S CAPABILITIES:
- Builds AI workflows, automations, integrations
- Claude CLI, n8n, API integrations, custom code
- Can deliver in 1-2 weeks
- Price range: $1,500 - $10,000 CAD

Design a SPECIFIC service offering:

Return JSON:
{
  "service_name": "catchy, specific name",
  "description": "2 sentences: what Kirill does for them",
  "deliverables": ["specific deliverable 1", "specific deliverable 2", "specific deliverable 3"],
  "price_cad": 2500,
  "timeline": "X days",
  "value_proposition": "why this is worth 10x the price",
  "objection_handler": "what to say when they ask 'can't I just do this myself?'",
  "proof_point": "how to demonstrate value in 5 minutes (free audit, demo, example)"
}`);
}

// ── Step 5: Draft outreach for the fastest channel ──────────────────────

function step5_outreach(analysis, buyers, channels, offer) {
  return askClaude(`You are an outreach specialist. Write a value-first message for this opportunity:

OPPORTUNITY: ${analysis.what}
TARGET: ${buyers.best_segment}
CHANNEL: ${channels.fastest_channel}
OFFER: ${offer.service_name} - ${offer.description}

Write THREE versions of outreach (different angles):

Rules:
- Value FIRST - give them something useful before asking for anything
- NO buzzwords (no "leverage", "streamline", "game-changer")
- NO em dashes (use hyphens only)
- Short: max 4 sentences for Reddit/forum, max 6 for email
- End with soft CTA ("happy to share more" not "book a call")
- Sound like a human who just built this, not a salesperson

Return JSON:
{
  "drafts": [
    {
      "angle": "what angle this version uses",
      "channel": "where to post this",
      "text": "the actual message",
      "target_url": "specific URL/thread to post in (if applicable)"
    }
  ],
  "linkedin_post_idea": "a short LinkedIn post about this opportunity (not selling, sharing insight)",
  "threads_post_idea": "a short Threads post (under 500 chars)"
}`);
}

// ── Main: Run the full causal chain ─────────────────────────────────────

export async function runCausalChain(signal, log = console.log) {
  const chainId = `chain-${Date.now()}`;
  log(`[causal] === CHAIN ${chainId} STARTING ===`);
  log(`[causal] Signal: "${signal.slice(0, 100)}"`);

  const chain = { signal, startedAt: new Date().toISOString(), steps: {} };

  // Step 1: WHAT & WHY
  log("[causal] Step 1/5: Analyzing signal...");
  chain.steps.analysis = step1_analyze(signal);
  if (!chain.steps.analysis) {
    log("[causal] Step 1 failed - aborting");
    return null;
  }
  log(`[causal] → Opportunity: ${chain.steps.analysis.opportunity_size}, Timing: ${chain.steps.analysis.timing}`);

  // Skip stale opportunities
  if (chain.steps.analysis.timing === "stale") {
    log("[causal] Stale signal - skipping (too old to be first)");
    return null;
  }

  // Step 2: WHO
  log("[causal] Step 2/5: Finding buyers...");
  chain.steps.buyers = step2_buyers(chain.steps.analysis);
  if (!chain.steps.buyers) {
    log("[causal] Step 2 failed - aborting");
    return null;
  }
  log(`[causal] → Best segment: ${chain.steps.buyers.best_segment}`);
  log(`[causal] → ${(chain.steps.buyers.segments || []).length} segments identified`);

  // Step 3: WHERE
  log("[causal] Step 3/5: Finding channels...");
  chain.steps.channels = step3_channels(chain.steps.analysis, chain.steps.buyers);
  if (!chain.steps.channels) {
    log("[causal] Step 3 failed - aborting");
    return null;
  }
  log(`[causal] → Fastest channel: ${chain.steps.channels.fastest_channel}`);
  log(`[causal] → ${(chain.steps.channels.search_queries || []).length} search queries`);

  // Step 4: WHAT TO OFFER
  log("[causal] Step 4/5: Designing offer...");
  chain.steps.offer = step4_offer(chain.steps.analysis, chain.steps.buyers, chain.steps.channels);
  if (!chain.steps.offer) {
    log("[causal] Step 4 failed - aborting");
    return null;
  }
  log(`[causal] → Offer: ${chain.steps.offer.service_name} at $${chain.steps.offer.price_cad}`);

  // Step 5: OUTREACH DRAFTS
  log("[causal] Step 5/5: Drafting outreach...");
  chain.steps.outreach = step5_outreach(chain.steps.analysis, chain.steps.buyers, chain.steps.channels, chain.steps.offer);
  if (!chain.steps.outreach) {
    log("[causal] Step 5 failed - partial chain");
  }

  // Save full chain
  chain.completedAt = new Date().toISOString();
  const chainPath = resolve(CHAINS_DIR, `${chainId}.json`);
  writeFileSync(chainPath, JSON.stringify(chain, null, 2));
  log(`[causal] Chain saved: ${chainPath}`);

  // Send summary to Telegram
  try {
    const envPath = resolve(ROOT, "apps/api/.env");
    const env = Object.fromEntries(
      readFileSync(envPath, "utf-8").split("\n")
        .filter(l => l && !l.startsWith("#") && l.includes("="))
        .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
    );

    const summary = [
      `CAUSAL CHAIN COMPLETE`,
      ``,
      `Signal: ${signal.slice(0, 100)}`,
      `Opportunity: ${chain.steps.analysis.opportunity_size} | ${chain.steps.analysis.timing}`,
      `Key insight: ${chain.steps.analysis.key_insight?.slice(0, 150)}`,
      ``,
      `Target: ${chain.steps.buyers.best_segment}`,
      `Channel: ${chain.steps.channels?.fastest_channel}`,
      ``,
      `Offer: ${chain.steps.offer.service_name}`,
      `Price: $${chain.steps.offer.price_cad} CAD`,
      `${chain.steps.offer.description?.slice(0, 150)}`,
      ``,
      chain.steps.outreach?.drafts?.[0] ? `Draft 1 (${chain.steps.outreach.drafts[0].channel}):\n${chain.steps.outreach.drafts[0].text?.slice(0, 300)}` : "",
      ``,
      `Search queries to find buyers NOW:`,
      ...(chain.steps.channels?.search_queries?.slice(0, 3) || []).map(q => `  "${q}"`),
    ].filter(Boolean).join("\n").slice(0, 4000);

    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: summary }),
    }).catch(() => {});

    log("[causal] Summary sent to Telegram");
  } catch (e) {
    log(`[causal] Telegram send failed: ${e.message}`);
  }

  log(`[causal] === CHAIN COMPLETE ===`);
  return chain;
}

// ── CLI entry point ─────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length > 0) {
  const signal = args.join(" ");
  console.log(`Running causal chain for: "${signal}"`);
  runCausalChain(signal).then(chain => {
    if (chain) {
      console.log(`\nChain complete. ${Object.keys(chain.steps).length} steps.`);
      console.log(`Offer: ${chain.steps.offer?.service_name} at $${chain.steps.offer?.price_cad}`);
    } else {
      console.log("Chain aborted (stale or failed).");
    }
  });
}
