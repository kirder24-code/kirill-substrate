#!/usr/bin/env node
// organism/propose-action.mjs
// The organism reads its own graph state and proposes concrete actions to Kirill.
// Each proposal has: action_type, target, payload, rationale grounded in beliefs.
// Sent to Kirill via Telegram with approval pattern.
//
// Subcommands:
//   generate           — analyze graph, generate up to N proposals, write to action_proposals table
//   notify             — send pending proposals to Kirill (max 1 per pulse, highest confidence first)
//   approve <id>       — mark proposal approved (called by respond daemon when Kirill says yes)
//   reject <id>        — mark proposal rejected
//   list               — show pending proposals

import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  openDb, totalBeliefs, recordProposal, listPendingProposals, approveProposal, rejectProposal,
} from "./db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, "../..");
const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";

function callClaudeAsync(prompt, label) {
  return new Promise((resolveDone) => {
    const tmpFile = resolve(PROJECT, `.data/organism-${label}-prompt.tmp`);
    if (!existsSync(dirname(tmpFile))) mkdirSync(dirname(tmpFile), { recursive: true });
    writeFileSync(tmpFile, prompt);
    const proc = spawn("bash", ["-c", `cat "${tmpFile}" | "${CLAUDE_BIN}" -p --model claude-sonnet-4-6 --max-turns 4 --output-format text 2>&1`], { cwd: PROJECT });
    let stdout = "";
    proc.stdout.on("data", d => stdout += d.toString());
    proc.stderr.on("data", d => stdout += d.toString());
    const timer = setTimeout(() => proc.kill("SIGKILL"), 90000);
    proc.on("close", (code) => { clearTimeout(timer); resolveDone(code === 0 ? stdout.trim() : null); });
  });
}

function extractJson(raw) {
  let text = raw;
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) text = m[1];
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0) throw new Error("no JSON");
  const c = text.slice(first, last + 1);
  try { return JSON.parse(c); }
  catch { return JSON.parse(c.replace(/,\s*([\]}])/g, "$1")); }
}

function buildContext(db) {
  const verdict = db.prepare(`SELECT * FROM beliefs WHERE domain LIKE 'verdict.%' ORDER BY last_updated DESC LIMIT 1`).get();
  let verdictDetail = null;
  if (verdict) {
    const log = db.prepare(`SELECT after_json FROM belief_log WHERE belief_id = ? AND op = 'verdict' ORDER BY ts DESC LIMIT 1`).get(verdict.id);
    if (log?.after_json) try { verdictDetail = JSON.parse(log.after_json); } catch {}
  }
  const top = db.prepare(`SELECT id, claim, weight, domain, sources_count FROM beliefs WHERE weight >= 0.7 AND domain NOT LIKE 'verdict.%' ORDER BY weight DESC LIMIT 25`).all();
  const recent = db.prepare(`SELECT id, claim, weight, domain FROM beliefs WHERE last_updated > datetime('now', '-3 days') AND origin LIKE 'outcome%' ORDER BY weight DESC LIMIT 10`).all();
  const recentReplies = db.prepare(`SELECT description, signal_value, observed_at FROM outcomes WHERE source_type = 'outreach_reply' AND observed_at > datetime('now', '-30 days') ORDER BY observed_at DESC LIMIT 5`).all();
  return { verdict, verdictDetail, top, recent, recentReplies };
}

const ACTION_TYPES = `
- "reddit_comment_draft": payload {subreddit, post_url, comment_text} — draft a comment to add to a specific Reddit post the organism believes is high-leverage
- "linkedin_post_draft": payload {topic, hook, body} — draft a LinkedIn post matching current strategic verdict
- "email_followup_draft": payload {to, subject, body, prospect_id} — draft a follow-up to an existing outreach reply that needs handling
- "outreach_segment_pause": payload {segment, reason} — propose pausing further outreach to a segment whose silence is now strongly believed
- "outreach_segment_open": payload {segment, target_count, channel} — propose starting outreach to a new segment based on graph priorities
- "research_query": payload {topic, target_market, specific_questions} — propose a research task to fill a knowledge gap (Kirill or claude can execute)
`;

function proposalsPrompt(ctx) {
  const verdictBlock = ctx.verdict ? `${ctx.verdict.claim}\n${ctx.verdictDetail?.rationale ? `Rationale: ${ctx.verdictDetail.rationale.slice(0, 600)}` : ""}` : "(no verdict)";
  const topList = ctx.top.map(b => `[id=${b.id} w=${b.weight.toFixed(2)} src=${b.sources_count}] ${b.claim} (${b.domain})`).join("\n");
  const recentList = ctx.recent.map(b => `[id=${b.id} w=${b.weight.toFixed(2)}] ${b.claim}`).join("\n");
  const repliesList = ctx.recentReplies.map(r => `[${r.observed_at}] ${r.description.slice(0, 200)}`).join("\n");

  return `You propose CONCRETE actions for Kirill based on the organism's current belief graph.

Strategic verdict:
${verdictBlock}

Top high-confidence beliefs:
${topList}

Recent outcome-driven beliefs (last 3 days):
${recentList}

Recent real email replies that may need follow-up:
${repliesList || "(none)"}

Available action types:
${ACTION_TYPES}

Generate 2-4 concrete action proposals. Each must:
1. Be GROUNDED in specific belief IDs from above. List them.
2. Have a CONCRETE payload — actual subreddit, actual subject, actual body draft. NOT "write a comment about X". Write the comment.
3. Have a clear rationale tying belief evidence to action.
4. Have an expected_outcome — what would success look like.
5. Have a confidence 0-1.

Output JSON:
{
  "proposals": [
    {
      "action_type": "reddit_comment_draft",
      "target": "r/AI_Agents post about workflow patterns",
      "payload": {"subreddit": "AI_Agents", "post_url": "https://reddit.com/r/AI_Agents/comments/...", "comment_text": "Full comment draft, 100-200 words, addressing the OP's point with operator-level specifics drawn from the belief graph"},
      "rationale": "Belief #X (w=0.93) says comment-first converts 5-10x better than DM. Belief #Y (w=0.85) confirms r/AI_Agents has Canadian buyers. Posting here = high-leverage trust touchpoint per current verdict.",
      "related_belief_ids": [101, 132],
      "expected_outcome": "1-3 upvotes, 0-1 organic DM in response, signal about whether this voice resonates with practitioners",
      "confidence": 0.7
    }
  ]
}

Be practical. Don't propose if you don't have a real concrete payload. Quality > quantity.

CRITICAL: Output ONLY JSON. Pure JSON. No prose.`;
}

async function generateCmd() {
  const db = openDb();
  const ctx = buildContext(db);
  if (totalBeliefs(db) < 50) {
    console.log("[propose] graph too small (<50 beliefs) — skipping");
    db.close(); return;
  }

  console.log("[propose] generating action proposals from current graph...");
  const raw = await callClaudeAsync(proposalsPrompt(ctx), "propose-action");
  if (!raw) { console.error("[propose] no output from Claude"); db.close(); return; }

  let parsed;
  try { parsed = extractJson(raw); }
  catch (e) { console.error(`[propose] parse failed: ${e.message}`); db.close(); return; }

  const proposals = parsed.proposals || [];
  console.log(`[propose] Claude proposed ${proposals.length} actions`);

  for (const p of proposals) {
    if (!p.action_type || !p.target || !p.payload || !p.rationale) {
      console.log(`  skip incomplete proposal: ${JSON.stringify(p).slice(0, 120)}`);
      continue;
    }
    const id = recordProposal(db, {
      action_type: p.action_type,
      target: p.target,
      payload: p.payload,
      rationale: p.rationale,
      related_belief_ids: p.related_belief_ids || [],
      expected_outcome: p.expected_outcome || null,
      confidence: typeof p.confidence === "number" ? p.confidence : 0.5,
    });
    console.log(`  recorded #${id}: ${p.action_type} | conf ${p.confidence} | ${p.target.slice(0, 60)}`);
  }
  db.close();
}

function fmtProposalForKirill(p) {
  const payload = JSON.parse(p.payload_json);
  let body = `🎯 <b>Предлагаю действие #${p.id}</b> (confidence ${p.confidence.toFixed(2)})\n\n<b>Тип:</b> ${p.action_type}\n<b>Цель:</b> ${p.target}\n\n<b>Что делать:</b>\n`;
  if (payload.comment_text) body += `<i>${payload.comment_text.slice(0, 600)}</i>\n\n`;
  else if (payload.body) body += `<i>${payload.body.slice(0, 600)}</i>\n\n`;
  else body += `<code>${JSON.stringify(payload).slice(0, 400)}</code>\n\n`;
  body += `<b>Почему:</b> ${p.rationale.slice(0, 400)}\n\n`;
  if (p.expected_outcome) body += `<b>Ожидаю:</b> ${p.expected_outcome.slice(0, 200)}\n\n`;
  body += `Ответь "approve ${p.id}" или "reject ${p.id} причина".`;
  return body;
}

async function notifyCmd() {
  const db = openDb();
  const pending = listPendingProposals(db, { limit: 1 });
  if (pending.length === 0) {
    console.log("[propose-notify] no pending proposals");
    db.close(); return;
  }
  const p = pending[0];

  // Don't re-notify the same proposal twice in a short window — track via a marker file.
  const stateFile = resolve(PROJECT, ".data/organism-propose-notify-state.json");
  let state = {};
  try { if (existsSync(stateFile)) state = JSON.parse(readFileSync(stateFile, "utf-8")); } catch {}
  if (state[`p${p.id}`]) {
    console.log(`[propose-notify] proposal #${p.id} already notified at ${state[`p${p.id}`]}`);
    db.close(); return;
  }

  const text = fmtProposalForKirill(p);
  const speakScript = resolve(__dirname, "organism-telegram.mjs");
  const r = spawnSync("node", [speakScript, "speak-stdin"], { input: text, encoding: "utf-8" });
  if (r.status === 0) {
    console.log(`[propose-notify] sent proposal #${p.id} to Kirill`);
    state[`p${p.id}`] = new Date().toISOString();
    writeFileSync(stateFile, JSON.stringify(state, null, 2));
  } else {
    console.error(`[propose-notify] send failed: ${r.stdout || r.stderr}`);
  }
  db.close();
}

function approveCmd(id) {
  const db = openDb();
  const numId = parseInt(id, 10);
  approveProposal(db, numId);
  const p = db.prepare("SELECT * FROM action_proposals WHERE id = ?").get(numId);
  console.log(`[propose] approved #${numId}: status=${p?.status}`);
  db.close();
}

function rejectCmd(id, notes = null) {
  const db = openDb();
  rejectProposal(db, parseInt(id, 10), notes);
  console.log(`[propose] rejected #${id}`);
  db.close();
}

function listCmd() {
  const db = openDb();
  const pending = listPendingProposals(db, { limit: 20 });
  console.log(`=== ${pending.length} pending proposals ===`);
  for (const p of pending) {
    console.log(`#${p.id} [${p.confidence.toFixed(2)}] ${p.action_type} -> ${p.target.slice(0, 80)}`);
    console.log(`   ${p.rationale.slice(0, 150)}`);
  }
  db.close();
}

const cmd = process.argv[2];
const arg = process.argv[3];
const arg2 = process.argv.slice(4).join(" ");
(async () => {
  if (cmd === "generate") await generateCmd();
  else if (cmd === "notify") await notifyCmd();
  else if (cmd === "approve") approveCmd(arg);
  else if (cmd === "reject") rejectCmd(arg, arg2);
  else if (cmd === "list") listCmd();
  else { console.error("Usage: generate | notify | approve <id> | reject <id> [notes] | list"); process.exit(1); }
})();
