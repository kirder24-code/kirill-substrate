/**
 * scripts/tolik/conversation.mjs
 *
 * Persisted conversation memory so Tolik remembers what was just said.
 * Each turn = {ts, user, tolik, tool, lang}. Stored in
 * .data/tolik-conversation.jsonl, capped at last 200 turns total.
 *
 * Voice-bridge calls:
 *   recordTurn({user, tolik, ...}) after each response
 *   getRecentTurns(n=8) before each new response → injected into prompt
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const CONV_PATH = resolve(ROOT, ".data/tolik-conversation.jsonl");
const MAX_TURNS = 200;

function ensureDir() { if (!existsSync(dirname(CONV_PATH))) mkdirSync(dirname(CONV_PATH), { recursive: true }); }

export function recordTurn({ user, tolik, tool, lang, tool_args }) {
  if (!user && !tolik) return;
  ensureDir();
  const turn = {
    ts: new Date().toISOString(),
    user: user || "",
    tolik: tolik || "",
    tool: tool || null,
    tool_args: tool_args || null,
    lang: lang || "russian",
  };
  appendFileSync(CONV_PATH, JSON.stringify(turn) + "\n");
  // Trim to last MAX_TURNS
  try {
    const lines = readFileSync(CONV_PATH, "utf-8").split("\n").filter(Boolean);
    if (lines.length > MAX_TURNS) {
      writeFileSync(CONV_PATH, lines.slice(-MAX_TURNS).join("\n") + "\n");
    }
  } catch {}
}

export function getRecentTurns(n = 8) {
  if (!existsSync(CONV_PATH)) return [];
  try {
    return readFileSync(CONV_PATH, "utf-8").split("\n").filter(Boolean).slice(-n)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

/**
 * Build a compact "what we just talked about" block for the LLM. Returns
 * empty string if no recent turns.
 */
export function getConversationBlock(n = 8) {
  const turns = getRecentTurns(n);
  if (turns.length === 0) return "";
  // Skip turns older than 30 minutes - they're probably stale context.
  const cutoff = Date.now() - 30 * 60_000;
  const fresh = turns.filter(t => new Date(t.ts).getTime() >= cutoff);
  if (fresh.length === 0) return "";
  const lines = fresh.map(t => {
    const userLine = `Kirill: ${t.user.slice(0, 200)}`;
    const tolikLine = t.tolik ? `Tolik: ${t.tolik.slice(0, 200)}${t.tool ? ` [ran tool: ${t.tool}]` : ""}` : "";
    return [userLine, tolikLine].filter(Boolean).join("\n");
  });
  return `=== RECENT CONVERSATION (last ${fresh.length} turns, freshest at bottom) ===
${lines.join("\n\n")}
=== END CONVERSATION ===`;
}

/**
 * Return turn-pairs as OpenAI messages for proper multi-turn calling.
 * Use this instead of injecting as text when you want true context.
 */
export function getConversationMessages(n = 8) {
  const turns = getRecentTurns(n);
  if (turns.length === 0) return [];
  const cutoff = Date.now() - 30 * 60_000;
  const fresh = turns.filter(t => new Date(t.ts).getTime() >= cutoff);
  const msgs = [];
  for (const t of fresh) {
    if (t.user) msgs.push({ role: "user", content: t.user });
    if (t.tolik) msgs.push({ role: "assistant", content: t.tolik });
  }
  return msgs;
}
