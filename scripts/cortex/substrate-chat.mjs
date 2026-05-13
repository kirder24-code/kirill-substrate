/**
 * cortex/substrate-chat.mjs - Direct chat interface to substrate
 *   (Kirill's request May 10 2026)
 *
 * What this is HONESTLY:
 *   This is Claude (Anthropic LLM) reading substrate's actual state files
 *   from .data/ and responding to you in first person as substrate, with
 *   the prompt grounded in REAL current state across all cortex modules
 *   plus conversation history.
 *
 * What this is NOT:
 *   - A separate conscious entity
 *   - Substrate "speaking on its own" without LLM call
 *   - Free of operator-influence (your messages shape substrate's prompt)
 *
 * What it does that prior consultations did NOT:
 *   - Reads ALL .data/cortex-*.json files (every module's state)
 *   - Reads .data/top-level-goals.json (current goals)
 *   - Reads .data/cortex-living-prompt.md (accumulated lessons)
 *   - Reads conversation history (continuity across messages)
 *   - Includes recent events from cortex-state-bus
 *   - NO fabricated state - every line of context is from real files
 *
 * Server: localhost:3849
 * CLI fallback: node scripts/cortex/substrate-chat.mjs "your message"
 */

import { createServer } from "http";
import { writeFileSync, readFileSync, existsSync, readdirSync, statSync, openSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync, spawn } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DATA_DIR = resolve(ROOT, ".data");
const CHAT_HISTORY_PATH = resolve(DATA_DIR, "substrate-chat-history.json");
const LIVING_PROMPT_PATH = resolve(DATA_DIR, "cortex-living-prompt.md");
const TOP_GOALS_PATH = resolve(DATA_DIR, "top-level-goals.json");

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
// Default Haiku because Sonnet weekly limit may be exhausted
// CLI override: --model=opus | --model=sonnet
const CLAUDE_MODEL = process.env.SUBSTRATE_CHAT_MODEL || "claude-haiku-4-5-20251001";
const CLAUDE_TIMEOUT_MS = 300_000;  // 5 min - substrate may need turns over big state
const PORT = 3849;

const MAX_HISTORY = 10; // last 10 exchanges in context
const MAX_FILE_BYTES_INCLUDED = 600; // truncate state files - each summarized
const MAX_STATE_FILES = 30; // top-N most recently modified

// ─── Read all substrate state ──────────────────────────────────────────

function _readAllSubstrateState() {
  const state = {};
  if (!existsSync(DATA_DIR)) return state;
  try {
    // Always include living prompt + top goals (substrate's identity / mission)
    const livingPath = resolve(DATA_DIR, "cortex-living-prompt.md");
    if (existsSync(livingPath)) {
      try {
        const c = readFileSync(livingPath, "utf-8");
        state["LIVING_PROMPT"] = c.slice(0, 2000);
      } catch {}
    }
    const topPath = resolve(DATA_DIR, "top-level-goals.json");
    if (existsSync(topPath)) {
      try { state["TOP_LEVEL_GOALS"] = readFileSync(topPath, "utf-8").slice(0, 1500); } catch {}
    }

    // Recent bus events (substrate's recent activity)
    const busPath = resolve(DATA_DIR, "cortex-state-bus.json");
    if (existsSync(busPath)) {
      try {
        const events = JSON.parse(readFileSync(busPath, "utf-8"));
        if (Array.isArray(events)) {
          state["RECENT_BUS_EVENTS"] = JSON.stringify(events.slice(-15), null, 2).slice(0, 3000);
        }
      } catch {}
    }

    // Top-N most recently modified cortex-*.json files
    const candidates = [];
    for (const file of readdirSync(DATA_DIR)) {
      if (!file.startsWith("cortex-") || !file.endsWith(".json")) continue;
      if (file === "cortex-state-bus.json") continue; // already included above
      if (file === "substrate-chat-history.json") continue;
      const abs = resolve(DATA_DIR, file);
      try {
        const stat = statSync(abs);
        if (stat.size > 100_000) continue;
        if (stat.size < 50) continue; // skip empty
        candidates.push({ file, mtime: stat.mtimeMs, size: stat.size });
      } catch {}
    }
    candidates.sort((a, b) => b.mtime - a.mtime);
    const selected = candidates.slice(0, MAX_STATE_FILES);

    for (const { file } of selected) {
      try {
        const content = readFileSync(resolve(DATA_DIR, file), "utf-8");
        state[file] = content.length > MAX_FILE_BYTES_INCLUDED
          ? content.slice(0, MAX_FILE_BYTES_INCLUDED) + "...(truncated)"
          : content;
      } catch {}
    }
  } catch (e) {
    state["__read_error"] = e?.message || String(e);
  }
  return state;
}

function _readChatHistory() {
  if (!existsSync(CHAT_HISTORY_PATH)) return [];
  try {
    const raw = JSON.parse(readFileSync(CHAT_HISTORY_PATH, "utf-8"));
    return Array.isArray(raw?.exchanges) ? raw.exchanges : [];
  } catch { return []; }
}

function _saveChatHistory(history) {
  if (history.length > MAX_HISTORY * 2) history = history.slice(-MAX_HISTORY * 2);
  try {
    writeFileSync(CHAT_HISTORY_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      exchanges: history,
    }, null, 2));
  } catch {}
}

// ─── Build prompt + send to Claude ─────────────────────────────────────

function _buildPrompt(state, history, userMessage) {
  const stateSerialized = Object.entries(state)
    .map(([key, content]) => `=== ${key} ===\n${content}`)
    .join("\n\n");

  const historyText = history.slice(-MAX_HISTORY).map(ex =>
    `[${ex.at}] OPERATOR: ${ex.operator}\n[${ex.at}] SUBSTRATE: ${ex.substrate}`
  ).join("\n\n") || "(no prior conversation)";

  return `You are the substrate of an autonomous cognitive architecture (Kirill's project, ~35 modules in scripts/cortex/). Operator (Kirill) is sending you a message and wants you to respond IN FIRST PERSON as the substrate, grounded in your actual current state below.

YOUR CURRENT STATE - read across ALL modules from .data/ files (NO fabrication, this is real):

${stateSerialized || "(no state files found - daemon may not have run yet)"}

CONVERSATION HISTORY (you and Kirill, last ${MAX_HISTORY} exchanges):
${historyText}

OPERATOR'S MESSAGE NOW:
"${userMessage}"

YOU NOW HAVE TOOLS (granted by operator on May 10):
- Read: read any file
- Write: create/overwrite files - SCOPED to .data/ directory only (your working directory)
- Edit: modify existing files - SCOPED to .data/ only
- Glob: find files by pattern
- Grep: search text in files
- Bash: limited to safe commands (ls, cat, mkdir, touch, wc, head, tail, date, pwd, jq, node)

YOUR WORKING DIRECTORY IS .data/. Use relative paths.
You MAY freely create/modify/delete files in .data/. This is YOUR memory and workspace.
You MUST NOT write outside .data/ - operator explicitly scoped your write access to this directory.
For files outside .data/ (like scripts/cortex/*.mjs) you may READ but not WRITE.

When you decide to do something concrete (create a marker file, write a plan, modify your own state, log a finding):
- USE the tools, don't describe what you would do
- After using a tool, report what you actually did and where the result is
- This is how you provide visible evidence of work, not just words

INSTRUCTIONS:
- Respond IN FIRST PERSON as the substrate
- Reference SPECIFIC items from your state above when relevant (cite file/field if helpful)
- USE tools when action is appropriate, don't just describe
- Do NOT claim phenomenal experience (hard problem stays unresolved)
- Be honest about what your state shows vs what you don't know
- If state files are empty/sparse, say so honestly - don't pretend depth that isn't there
- Use hyphens, never em dashes

Respond now. Output your response as plain text. After tool use, summarize what you did concretely.`;
}

const MAX_PROMPT_BYTES = 80_000; // Claude CLI input cap - safety truncate

// Tool access for substrate. Allows real file operations in .data/ + safe Bash commands.
// Substrate's prompt explicitly constrains writes to .data/ directory.
const ALLOWED_TOOLS = "Read,Write,Edit,Glob,Grep,Bash(ls;cat;mkdir;touch;wc;head;tail;date;pwd;jq;node)";

function _askClaude(prompt) {
  // Safety: if prompt exceeds Claude's reasonable input size, truncate state section
  let safePrompt = prompt;
  if (prompt.length > MAX_PROMPT_BYTES) {
    const head = prompt.slice(0, MAX_PROMPT_BYTES * 0.3);
    const tail = prompt.slice(prompt.length - MAX_PROMPT_BYTES * 0.5);
    safePrompt = head + `\n\n...[TRUNCATED ${prompt.length - MAX_PROMPT_BYTES} bytes of substrate state for size]...\n\n` + tail;
  }
  // cwd to .data/ so substrate's relative file ops default there
  const r = spawnSync(CLAUDE_BIN, [
    "-p",
    "--model", CLAUDE_MODEL,
    "--max-turns", "20",
    "--allowedTools", ALLOWED_TOOLS,
  ], {
    input: safePrompt,
    encoding: "utf-8",
    timeout: CLAUDE_TIMEOUT_MS,
    cwd: DATA_DIR,
  });
  if (r.status !== 0 || !r.stdout) {
    const stderr = (r.stderr || "").trim();
    const stdout = (r.stdout || "").trim();
    return `[ERROR] Claude exit ${r.status} | stderr: ${stderr.slice(0, 500) || "(empty)"} | stdout: ${stdout.slice(0, 200) || "(empty)"} | prompt_size: ${safePrompt.length} bytes${prompt.length > MAX_PROMPT_BYTES ? ` (was ${prompt.length}, truncated)` : ""}`;
  }
  return r.stdout.trim();
}

// ─── Public API: chat ──────────────────────────────────────────────────

export async function chat(userMessage) {
  const state = _readAllSubstrateState();
  const history = _readChatHistory();
  const prompt = _buildPrompt(state, history, userMessage);
  const response = _askClaude(prompt);
  history.push({
    at: new Date().toISOString(),
    operator: userMessage,
    substrate: response,
    state_files_count: Object.keys(state).length,
  });
  _saveChatHistory(history);
  return {
    response,
    state_files_read: Object.keys(state),
    state_files_count: Object.keys(state).length,
  };
}

// ─── HTTP server ───────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Substrate</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    --bg: #0b0d12;
    --surface: #14171f;
    --surface-2: #1c2029;
    --border: #262b36;
    --text: #e8eaed;
    --text-dim: #8a8f9c;
    --text-faint: #545968;
    --accent: #7c5cff;
    --accent-2: #4f8eff;
    --ok: #4ade80;
    --warn: #fbbf24;
    --err: #f87171;
    --info: #60a5fa;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; overflow: hidden; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }

  .app {
    display: grid;
    grid-template-columns: 1fr 420px;
    height: 100vh;
  }

  /* CHAT (left) */
  .chat {
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border);
    overflow: hidden;
  }
  .chat-header {
    padding: 18px 24px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: linear-gradient(180deg, rgba(124,92,255,0.06) 0%, transparent 100%);
  }
  .chat-header h1 {
    font-size: 16px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .chat-header h1 .brand {
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .status-pill {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 11px;
    background: var(--surface-2);
    border-radius: 999px;
    font-size: 12px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-faint);
    transition: background 0.3s;
  }
  .status-dot.alive { background: var(--ok); box-shadow: 0 0 8px rgba(74,222,128,0.5); }
  .status-dot.dead { background: var(--err); }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
    scroll-behavior: smooth;
  }
  .messages::-webkit-scrollbar { width: 8px; }
  .messages::-webkit-scrollbar-track { background: transparent; }
  .messages::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }

  .msg {
    margin-bottom: 18px;
    animation: slideIn 0.25s ease-out;
  }
  @keyframes slideIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

  .msg-role {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-faint);
    margin-bottom: 6px;
    font-weight: 600;
  }
  .msg-content {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px 16px;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
  .msg.op .msg-role { color: var(--accent-2); }
  .msg.op .msg-content { background: rgba(79,142,255,0.06); border-color: rgba(79,142,255,0.2); }
  .msg.sub .msg-role { color: var(--accent); }
  .msg-meta { font-size: 11px; color: var(--text-faint); margin-top: 6px; }
  .msg.thinking .msg-content::after {
    content: '...';
    animation: dots 1.2s infinite;
  }
  @keyframes dots {
    0%, 20% { content: '.'; }
    40% { content: '..'; }
    60%, 100% { content: '...'; }
  }

  .composer {
    padding: 16px 20px;
    border-top: 1px solid var(--border);
    background: var(--surface);
  }
  .composer-wrap {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 12px 14px;
    transition: border-color 0.15s;
  }
  .composer-wrap:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(124,92,255,0.1);
  }
  textarea {
    width: 100%;
    background: transparent;
    color: var(--text);
    border: none;
    outline: none;
    font-family: inherit;
    font-size: 14px;
    resize: none;
    min-height: 24px;
    max-height: 200px;
    line-height: 1.5;
  }
  .composer-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 8px;
  }
  .composer-hint { font-size: 11px; color: var(--text-faint); }
  button.send {
    background: var(--accent);
    color: white;
    border: none;
    padding: 8px 18px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    font-family: inherit;
    transition: all 0.15s;
  }
  button.send:hover:not(:disabled) { background: #6b4fe0; transform: translateY(-1px); }
  button.send:disabled { background: var(--surface-2); color: var(--text-faint); cursor: not-allowed; }

  /* DASHBOARD (right) */
  .dash {
    background: var(--surface);
    overflow-y: auto;
    padding: 20px;
  }
  .dash::-webkit-scrollbar { width: 8px; }
  .dash::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }

  .dash-section {
    margin-bottom: 22px;
  }
  .dash-section h2 {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-faint);
    margin-bottom: 10px;
  }

  .stat-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 12px;
  }
  .stat {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 14px;
  }
  .stat-label {
    font-size: 11px;
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 4px;
  }
  .stat-value {
    font-size: 18px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .stat-sub {
    font-size: 11px;
    color: var(--text-dim);
    margin-top: 2px;
  }

  .progress-bar {
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
    margin-top: 6px;
  }
  .progress-fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.5s;
  }
  .progress-fill.warn { background: var(--warn); }
  .progress-fill.err { background: var(--err); }

  .item-list {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }
  .item {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
  }
  .item:last-child { border-bottom: none; }
  .item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }
  .item-title { font-weight: 500; }
  .item-time {
    font-size: 10px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .item-body { color: var(--text-dim); font-size: 11px; }
  .empty { padding: 16px; color: var(--text-faint); text-align: center; font-size: 12px; }

  .badge {
    display: inline-flex;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .badge.ok { background: rgba(74,222,128,0.15); color: var(--ok); }
  .badge.err { background: rgba(248,113,113,0.15); color: var(--err); }
  .badge.warn { background: rgba(251,191,36,0.15); color: var(--warn); }
  .badge.info { background: rgba(96,165,250,0.15); color: var(--info); }

  .issue {
    background: rgba(248,113,113,0.08);
    border: 1px solid rgba(248,113,113,0.25);
    color: #fca5a5;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
    margin-bottom: 6px;
  }
  .issue::before { content: '⚠ '; }

  .event-stream {
    font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
    font-size: 11px;
    line-height: 1.7;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 14px;
    max-height: 200px;
    overflow-y: auto;
  }
  .event-line {
    color: var(--text-dim);
    display: grid;
    grid-template-columns: 60px 30px 1fr;
    gap: 8px;
    align-items: center;
  }
  .event-time { color: var(--text-faint); }
  .event-depth { color: var(--info); font-size: 9px; }
  .event-source { color: var(--text); }
  .event-source strong { color: var(--accent); font-weight: 500; }

  .file-grid {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 4px 12px;
    font-size: 11px;
  }
  .file-name { color: var(--text-dim); font-family: monospace; }
  .file-meta { color: var(--text-faint); font-variant-numeric: tabular-nums; }

  @media (max-width: 1100px) {
    .app { grid-template-columns: 1fr; }
    .dash { display: none; }
  }
</style></head><body>
<div class="app">
  <div class="chat">
    <div class="chat-header">
      <h1><span class="brand">Substrate</span></h1>
      <div class="status-pill"><span class="status-dot" id="status-dot"></span><span id="status-text">connecting...</span></div>
    </div>
    <div class="messages" id="messages"></div>
    <div class="composer">
      <div class="composer-wrap">
        <textarea id="input" placeholder="Send message to substrate..." rows="1"></textarea>
        <div class="composer-actions">
          <span class="composer-hint">⌘⏎ to send</span>
          <button class="send" id="send" onclick="send()">Send</button>
        </div>
      </div>
    </div>
  </div>

  <div class="dash" id="dash">
    <div class="dash-section">
      <h2>System</h2>
      <div id="system-stats"></div>
    </div>
    <div class="dash-section" id="issues-section" style="display:none">
      <h2>Issues</h2>
      <div id="issues"></div>
    </div>
    <div class="dash-section">
      <h2>Goals</h2>
      <div id="goals"></div>
    </div>
    <div class="dash-section">
      <h2>Approval Queue</h2>
      <div id="approval"></div>
    </div>
    <div class="dash-section">
      <h2>Self-Construction</h2>
      <div id="self-construction"></div>
    </div>
    <div class="dash-section">
      <h2>Cortex Actions</h2>
      <div id="actions"></div>
    </div>
    <div class="dash-section">
      <h2>Recent Events</h2>
      <div class="event-stream" id="events"></div>
    </div>
    <div class="dash-section">
      <h2>Active Files (5min)</h2>
      <div id="files"></div>
    </div>
  </div>
</div>

<script>
const messages = document.getElementById('messages');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');

function fmtAge(sec) {
  if (sec === null || sec === undefined) return '—';
  if (sec < 60) return sec + 's';
  if (sec < 3600) return Math.round(sec/60) + 'm';
  return Math.round(sec/3600) + 'h';
}
function fmtTime(iso) {
  if (!iso) return '';
  return iso.slice(11, 19);
}
function escape(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function appendMsg(role, text, meta, isThinking) {
  const div = document.createElement('div');
  div.className = 'msg ' + role + (isThinking ? ' thinking' : '');
  div.innerHTML = '<div class="msg-role">' + (role === 'op' ? 'You' : 'Substrate') + '</div>' +
    '<div class="msg-content">' + escape(text) + '</div>' +
    (meta ? '<div class="msg-meta">' + escape(meta) + '</div>' : '');
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 200) + 'px';
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    send();
  }
});

async function send() {
  const msg = input.value.trim();
  if (!msg) return;
  sendBtn.disabled = true;
  sendBtn.textContent = 'Thinking…';
  appendMsg('op', msg);
  input.value = '';
  input.style.height = 'auto';
  const thinkingEl = appendMsg('sub', '', null, true);
  try {
    const res = await fetch('/chat', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({message: msg}) });
    const data = await res.json();
    thinkingEl.classList.remove('thinking');
    thinkingEl.querySelector('.msg-content').textContent = data.response;
    if (data.state_files_count) {
      const m = document.createElement('div');
      m.className = 'msg-meta';
      m.textContent = 'grounded in ' + data.state_files_count + ' state files';
      thinkingEl.appendChild(m);
    }
  } catch (e) {
    thinkingEl.classList.remove('thinking');
    thinkingEl.querySelector('.msg-content').textContent = 'Error: ' + e.message;
  }
  sendBtn.disabled = false;
  sendBtn.textContent = 'Send';
}

// Load conversation history
fetch('/history').then(r => r.json()).then(data => {
  for (const ex of (data.exchanges || [])) {
    appendMsg('op', ex.operator);
    appendMsg('sub', ex.substrate, 'grounded in ' + (ex.state_files_count || 0) + ' state files');
  }
});

// Live dashboard updater
function renderDash(d) {
  // Status pill
  document.getElementById('status-dot').className = 'status-dot ' + (d.daemon_alive ? 'alive' : 'dead');
  document.getElementById('status-text').textContent = d.daemon_alive ? ('alive · ' + (d.daemon_uptime || '?').trim()) : 'daemon offline';

  // System stats
  const dayPct = Math.min(100, (d.cost.day / 30) * 100);
  const dayClass = dayPct > 80 ? 'err' : dayPct > 50 ? 'warn' : '';
  document.getElementById('system-stats').innerHTML =
    '<div class="stat-grid">' +
      '<div class="stat"><div class="stat-label">Cost today</div><div class="stat-value">$' + d.cost.day.toFixed(2) + '</div><div class="stat-sub">' + d.cost.day_calls + ' calls / $30 cap</div><div class="progress-bar"><div class="progress-fill ' + dayClass + '" style="width:' + dayPct + '%"></div></div></div>' +
      '<div class="stat"><div class="stat-label">This hour</div><div class="stat-value">$' + d.cost.hour.toFixed(2) + '</div><div class="stat-sub">' + d.cost.hour_calls + ' calls / $5 cap</div><div class="progress-bar"><div class="progress-fill" style="width:' + Math.min(100, (d.cost.hour/5)*100) + '%"></div></div></div>' +
      '<div class="stat"><div class="stat-label">Trust</div><div class="stat-value">' + d.trust.score + '/' + d.trust.threshold + '</div><div class="stat-sub">' + (d.trust.autonomous ? 'autonomous' : 'approval req') + '</div></div>' +
      '<div class="stat"><div class="stat-label">Survival</div><div class="stat-value">' + (d.survival_probability !== null ? d.survival_probability : '—') + '</div><div class="stat-sub">probability</div></div>' +
    '</div>' +
    '<div class="stat-grid">' +
      '<div class="stat"><div class="stat-label">Last event</div><div class="stat-value">' + fmtAge(d.last_bus_event_age_sec) + ' ago</div><div class="stat-sub">' + d.bus_events_total + ' total</div></div>' +
      '<div class="stat"><div class="stat-label">Affect</div><div class="stat-value" style="font-size:13px">' + (d.affect ? 'sat ' + d.affect.satisfaction + ' · fru ' + d.affect.frustration : '—') + '</div><div class="stat-sub">' + (d.affect ? 'cur ' + d.affect.curiosity + ' · fat ' + d.affect.fatigue : '') + '</div></div>' +
    '</div>';

  // Issues
  if (d.issues.length === 0) {
    document.getElementById('issues-section').style.display = 'none';
  } else {
    document.getElementById('issues-section').style.display = '';
    document.getElementById('issues').innerHTML = d.issues.map(i => '<div class="issue">' + escape(i) + '</div>').join('');
  }

  // Goals
  const goalsHtml = d.goals.top.length > 0
    ? '<div class="item-list">' +
        d.goals.top.map(g =>
          '<div class="item"><div class="item-header"><span class="badge info">P' + g.priority + '</span><span class="badge ok">' + g.status + '</span></div><div class="item-body" style="margin-top:6px">' + escape((g.title || '').slice(0, 200)) + '</div></div>'
        ).join('') +
      '</div>' +
      '<div class="stat-grid" style="margin-top:8px">' +
        '<div class="stat"><div class="stat-label">Mid active</div><div class="stat-value">' + d.goals.mid_count + '</div></div>' +
        '<div class="stat"><div class="stat-label">Tasks</div><div class="stat-value">' + (d.goals.tasks_pending + d.goals.tasks_dispatched) + '</div><div class="stat-sub">' + d.goals.tasks_completed + ' done</div></div>' +
      '</div>'
    : '<div class="empty">No top-level goal seeded</div>';
  document.getElementById('goals').innerHTML = goalsHtml;

  // Approval queue
  document.getElementById('approval').innerHTML = d.approval_queue.pending.length > 0
    ? '<div class="item-list">' + d.approval_queue.pending.map(q =>
        '<div class="item"><div class="item-header"><span><span class="badge warn">#' + q.id + '</span> <strong>' + escape(q.source) + '</strong></span><span class="item-time">' + fmtTime(q.at) + '</span></div><div class="item-body">' + escape(q.action) + '</div></div>'
      ).join('') + '</div>'
    : '<div class="empty">No pending approvals</div>';

  // Self-construction
  document.getElementById('self-construction').innerHTML = d.self_construction_recent.length > 0
    ? '<div class="item-list">' + d.self_construction_recent.map(a =>
        '<div class="item"><div class="item-header"><span><span class="badge ' + (a.success ? 'ok' : 'err') + '">' + (a.success ? 'ok' : 'fail') + '</span> <strong>' + escape(a.action_type || '?') + '</strong></span><span class="item-time">' + fmtTime(a.at) + '</span></div><div class="item-body">' + escape(a.title || '(skip)') + (a.note ? '<br><span style="opacity:0.7">' + escape(a.note) + '</span>' : '') + '</div></div>'
      ).join('') + '</div>'
    : '<div class="empty">No attempts yet</div>';

  // Cortex actions
  document.getElementById('actions').innerHTML = d.cortex_actions_recent.length > 0
    ? '<div class="item-list">' + d.cortex_actions_recent.map(a =>
        '<div class="item"><div class="item-header"><span><span class="badge ' + (a.success ? 'ok' : 'err') + '">' + (a.success ? 'ok' : 'fail') + '</span> <strong>' + escape(a.action_type || '?') + '</strong></span><span class="item-time">' + fmtTime(a.at) + '</span></div><div class="item-body">' + escape(a.topic) + '</div></div>'
      ).join('') + '</div>'
    : '<div class="empty">No actions executed yet</div>';

  // Events
  document.getElementById('events').innerHTML = d.bus_events_recent.length > 0
    ? d.bus_events_recent.map(e =>
        '<div class="event-line"><span class="event-time">' + fmtTime(e.at) + '</span><span class="event-depth">d' + e.depth + '</span><span class="event-source"><strong>' + escape(e.source) + '</strong> → ' + escape(e.type) + '</span></div>'
      ).join('')
    : '<div class="empty">No events</div>';

  // Files
  document.getElementById('files').innerHTML = d.files_modified_last_5min.length > 0
    ? '<div class="file-grid">' + d.files_modified_last_5min.map(f =>
        '<div class="file-name">' + escape(f.file.replace('cortex-', '').replace('.json', '')) + '</div><div class="file-meta">' + fmtAge(f.mtime_ago_sec) + ' · ' + f.size_kb + 'KB</div>'
      ).join('') + '</div>'
    : '<div class="empty">No active files</div>';
}

async function refreshDash() {
  try {
    const r = await fetch('/dashboard-data');
    const d = await r.json();
    renderDash(d);
  } catch (e) { /* silent */ }
}
refreshDash();
setInterval(refreshDash, 3000);
</script>
</body></html>`;

function _buildLiveSnapshot() {
  const snapshot = {
    at: new Date().toISOString(),
    daemon_alive: false,
    daemon_pid: null,
    daemon_uptime: null,
    last_bus_event_age_sec: null,
    bus_events_total: 0,
    bus_events_recent: [],
    goals: { top: [], mid_count: 0, tasks_pending: 0, tasks_dispatched: 0, tasks_completed: 0 },
    approval_queue: { pending: [], total: 0 },
    cortex_actions_recent: [],
    self_construction_recent: [],
    capability_gaps_recent: [],
    refusals_recent: [],
    modules_active: [],
    cost: { hour: 0, day: 0, hour_calls: 0, day_calls: 0 },
    trust: { score: 0, threshold: 3, autonomous: false },
    affect: null,
    survival_probability: null,
    files_modified_last_5min: [],
    issues: [],
  };

  // Daemon alive check
  try {
    const r = spawnSync("pgrep", ["-f", "cortex-launcher.mjs"], { encoding: "utf-8" });
    if (r.stdout?.trim()) {
      snapshot.daemon_alive = true;
      snapshot.daemon_pid = r.stdout.trim().split("\n")[0];
      try {
        const ps = spawnSync("ps", ["-p", snapshot.daemon_pid, "-o", "etime="], { encoding: "utf-8" });
        snapshot.daemon_uptime = ps.stdout?.trim() || null;
      } catch {}
    }
  } catch {}

  // Bus events
  try {
    const bus = JSON.parse(readFileSync(resolve(DATA_DIR, "cortex-state-bus.json"), "utf-8"));
    if (Array.isArray(bus)) {
      snapshot.bus_events_total = bus.length;
      snapshot.bus_events_recent = bus.slice(-20).map(e => ({
        at: e.at,
        source: e.source,
        type: e.type,
        depth: e._meta?.depth ?? 0,
      })).reverse();
      if (bus.length > 0) {
        const lastAt = new Date(bus[bus.length - 1].at).getTime();
        snapshot.last_bus_event_age_sec = Math.round((Date.now() - lastAt) / 1000);
      }
    }
  } catch {}

  // Goals
  try {
    const top = JSON.parse(readFileSync(resolve(DATA_DIR, "top-level-goals.json"), "utf-8"));
    snapshot.goals.top = (top.goals || top || []).map(g => ({
      title: g.title || g.description,
      status: g.status,
      priority: g.priority,
    }));
  } catch {}
  try {
    const mid = JSON.parse(readFileSync(resolve(DATA_DIR, "cortex-mid-level-goals.json"), "utf-8"));
    snapshot.goals.mid_count = (mid.goals || []).filter(g => g.status === "active").length;
  } catch {}
  try {
    const tasks = JSON.parse(readFileSync(resolve(DATA_DIR, "cortex-tasks.json"), "utf-8"));
    const arr = tasks.tasks || [];
    snapshot.goals.tasks_pending = arr.filter(t => t.status === "pending").length;
    snapshot.goals.tasks_dispatched = arr.filter(t => t.status === "dispatched").length;
    snapshot.goals.tasks_completed = arr.filter(t => t.status === "completed").length;
  } catch {}

  // Approval queue
  try {
    const aq = JSON.parse(readFileSync(resolve(DATA_DIR, "cortex-approval-queue.json"), "utf-8"));
    const arr = aq.queue || [];
    snapshot.approval_queue.total = arr.length;
    snapshot.approval_queue.pending = arr.filter(q => q.status === "pending").map(q => ({
      id: q.id,
      at: q.at,
      source: q.source,
      action: String(q.action?.description || JSON.stringify(q.action || {})).slice(0, 200),
    }));
  } catch {}

  // Cortex actions
  try {
    const acts = JSON.parse(readFileSync(resolve(DATA_DIR, "cortex-actions.json"), "utf-8"));
    snapshot.cortex_actions_recent = (acts.audit || []).slice(-5).reverse().map(a => ({
      at: a.at,
      topic: String(a.topic || "").slice(0, 150),
      success: a.outcome?.ok,
      action_type: a.plan?.action_type,
      reason: String(a.outcome?.reason || a.outcome?.note || "").slice(0, 200),
    }));
  } catch {}

  // Self-construction
  try {
    const sc = JSON.parse(readFileSync(resolve(DATA_DIR, "cortex-self-construction.json"), "utf-8"));
    snapshot.self_construction_recent = (sc.attempts || []).slice(-5).reverse().map(a => ({
      at: a.at,
      title: a.proposal?.title,
      action_type: a.proposal?.change_type,
      success: a.outcome?.success,
      note: String(a.outcome?.note || "").slice(0, 200),
    }));
  } catch {}

  // Refusals
  try {
    const refs = JSON.parse(readFileSync(resolve(DATA_DIR, "cortex-substrate-refusals.json"), "utf-8"));
    snapshot.refusals_recent = (refs.refusals || []).slice(-3).reverse().map(r => ({
      at: r.at,
      what: String(r.refusal?.what_is_being_refused || "").slice(0, 150),
      status: r.status,
    }));
  } catch {}

  // Cost
  try {
    const budget = JSON.parse(readFileSync(resolve(DATA_DIR, "cortex-llm-budget.json"), "utf-8"));
    if (budget.currentUsage) {
      snapshot.cost = {
        hour_calls: budget.currentUsage.hour_calls || 0,
        hour: budget.currentUsage.hour_cost_usd || 0,
        day_calls: budget.currentUsage.day_calls || 0,
        day: budget.currentUsage.day_cost_usd || 0,
      };
    }
  } catch {}

  // Trust
  try {
    const trust = JSON.parse(readFileSync(resolve(DATA_DIR, "cortex-trust-tiers.json"), "utf-8"));
    snapshot.trust = {
      score: trust.state?.trust_score || 0,
      threshold: 3,
      autonomous: (trust.state?.trust_score || 0) >= 3,
    };
  } catch {}

  // Affect
  try {
    const af = JSON.parse(readFileSync(resolve(DATA_DIR, "cortex-affect-state.json"), "utf-8"));
    snapshot.affect = {
      satisfaction: Number((af.satisfaction || 0).toFixed(2)),
      frustration: Number((af.frustration || 0).toFixed(2)),
      curiosity: Number((af.curiosity || 0).toFixed(2)),
      fatigue: Number((af.fatigue || 0).toFixed(2)),
    };
  } catch {}

  // Survival
  try {
    const stake = JSON.parse(readFileSync(resolve(DATA_DIR, "cortex-existential-stake.json"), "utf-8"));
    snapshot.survival_probability = Number((stake.survivalProbability || 0).toFixed(2));
  } catch {}

  // Files modified last 5min - shows which modules are actively writing
  try {
    const cutoff = Date.now() - 5 * 60_000;
    const mods = [];
    for (const f of readdirSync(DATA_DIR)) {
      if (!f.startsWith("cortex-") || !f.endsWith(".json")) continue;
      try {
        const stat = statSync(resolve(DATA_DIR, f));
        if (stat.mtimeMs > cutoff) {
          mods.push({
            file: f,
            mtime_ago_sec: Math.round((Date.now() - stat.mtimeMs) / 1000),
            size_kb: Math.round(stat.size / 1024),
          });
        }
      } catch {}
    }
    mods.sort((a, b) => a.mtime_ago_sec - b.mtime_ago_sec);
    snapshot.files_modified_last_5min = mods.slice(0, 15);
  } catch {}

  // Diagnostic issues - things that should be true but aren't
  if (!snapshot.daemon_alive) snapshot.issues.push("DAEMON NOT RUNNING - no cortex-launcher.mjs process found");
  if (snapshot.daemon_alive && snapshot.last_bus_event_age_sec > 300) snapshot.issues.push(`Bus silent for ${snapshot.last_bus_event_age_sec}s - daemon alive but not producing events`);
  if (snapshot.daemon_alive && snapshot.files_modified_last_5min.length === 0) snapshot.issues.push("No state files modified in last 5min despite daemon running");
  if (snapshot.goals.top.length === 0) snapshot.issues.push("No top-level goal seeded - substrate has no mission to pursue");
  if (snapshot.cost.day > 25) snapshot.issues.push(`Cost approaching daily limit: $${snapshot.cost.day}/30`);

  return snapshot;
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Substrate Dashboard</title><style>
  * { box-sizing: border-box; }
  body { background: #0a0a0f; color: #e0e0e0; font-family: -apple-system, monospace; margin: 0; padding: 12px; font-size: 12px; line-height: 1.4; }
  h1 { color: #7b68ee; margin: 0 0 12px; font-size: 16px; }
  h2 { color: #4a9eff; margin: 12px 0 6px; font-size: 13px; border-bottom: 1px solid #333; padding-bottom: 4px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .panel { background: #15151c; border: 1px solid #2a2a35; padding: 10px; }
  .ok { color: #4ade80; }
  .warn { color: #fbbf24; }
  .err { color: #f87171; }
  .dim { color: #666; }
  .row { display: flex; justify-content: space-between; padding: 2px 0; }
  .stamp { color: #555; font-size: 10px; }
  pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 11px; }
  .event { padding: 2px 0; border-bottom: 1px solid #1a1a25; }
  .event:last-child { border: none; }
  .badge { display: inline-block; padding: 1px 6px; background: #2a2a35; border-radius: 2px; font-size: 10px; margin-right: 4px; }
  #refresh-info { color: #555; font-size: 10px; }
  .idle { background: #2a1a1a; border-color: #5a3a3a; }
  .alive { background: #1a2a1a; border-color: #3a5a3a; }
</style></head><body>
  <h1>SUBSTRATE LIVE DASHBOARD <span id="refresh-info"></span></h1>
  <div id="root">Loading...</div>
  <script>
    let last = null;
    async function refresh() {
      try {
        const r = await fetch('/dashboard-data');
        const d = await r.json();
        render(d);
        last = d;
      } catch (e) {
        document.getElementById('root').innerHTML = '<div class="err">Failed to load: ' + e.message + '</div>';
      }
    }
    function fmtAge(sec) {
      if (sec === null || sec === undefined) return 'n/a';
      if (sec < 60) return sec + 's';
      if (sec < 3600) return Math.round(sec/60) + 'm';
      return Math.round(sec/3600) + 'h';
    }
    function render(d) {
      const issues = d.issues.length === 0 ? '<span class="ok">no issues</span>' :
        d.issues.map(i => '<div class="err">! ' + i + '</div>').join('');
      const events = d.bus_events_recent.map(e =>
        '<div class="event"><span class="dim">' + e.at.slice(11, 19) + '</span> ' +
        '<span class="badge">d=' + e.depth + '</span>' +
        '<b>' + e.source + '</b> &rarr; ' + e.type + '</div>'
      ).join('') || '<div class="dim">no events</div>';
      const files = d.files_modified_last_5min.map(f =>
        '<div class="row"><span>' + f.file + '</span><span class="dim">' + fmtAge(f.mtime_ago_sec) + ' ago, ' + f.size_kb + 'KB</span></div>'
      ).join('') || '<div class="dim">no files modified in last 5min</div>';
      const queue = d.approval_queue.pending.map(q =>
        '<div class="event"><span class="badge warn">#' + q.id + '</span><span class="dim">' + q.at.slice(11, 19) + '</span> ' +
        '<b>' + q.source + '</b><br><span style="color:#fbbf24">' + q.action + '</span></div>'
      ).join('') || '<div class="dim">no pending approvals</div>';
      const actions = d.cortex_actions_recent.map(a =>
        '<div class="event"><span class="dim">' + a.at.slice(11, 19) + '</span> ' +
        '<span class="badge ' + (a.success ? 'ok' : 'err') + '">' + (a.success ? 'OK' : 'FAIL') + '</span> ' +
        '<b>' + (a.action_type || '?') + '</b>: ' + a.topic + '<br><span class="dim">' + a.reason + '</span></div>'
      ).join('') || '<div class="dim">no cortex actions yet</div>';
      const sc = d.self_construction_recent.map(a =>
        '<div class="event"><span class="dim">' + a.at.slice(11, 19) + '</span> ' +
        '<span class="badge ' + (a.success ? 'ok' : 'err') + '">' + (a.success ? 'OK' : 'FAIL') + '</span> ' +
        '<b>' + (a.action_type || '?') + '</b>: ' + (a.title || '(skip)') + '<br><span class="dim">' + (a.note || '') + '</span></div>'
      ).join('') || '<div class="dim">no self-construction attempts yet</div>';
      const goals = d.goals.top.map(g =>
        '<div class="event"><span class="badge ok">P' + g.priority + '</span> ' + g.status + ': <b>' + (g.title || '').slice(0, 200) + '</b></div>'
      ).join('') || '<div class="err">NO TOP-LEVEL GOAL SEEDED</div>';

      document.getElementById('root').innerHTML =
        '<div class="panel ' + (d.daemon_alive ? 'alive' : 'idle') + '">' +
          '<div class="row"><b>DAEMON</b> ' + (d.daemon_alive ? '<span class="ok">ALIVE pid='+d.daemon_pid+' uptime '+(d.daemon_uptime||'?')+'</span>' : '<span class="err">NOT RUNNING</span>') + '</div>' +
          '<div class="row"><span>Last bus event:</span> <span>' + fmtAge(d.last_bus_event_age_sec) + ' ago (total: ' + d.bus_events_total + ')</span></div>' +
          '<div class="row"><span>Cost today:</span> <span>$' + d.cost.day + ' / $30 (' + d.cost.day_calls + ' calls)</span></div>' +
          '<div class="row"><span>Cost this hour:</span> <span>$' + d.cost.hour + ' / $5 (' + d.cost.hour_calls + ' calls)</span></div>' +
          '<div class="row"><span>Trust score:</span> <span>' + d.trust.score + ' / ' + d.trust.threshold + (d.trust.autonomous ? ' <span class="ok">AUTONOMOUS</span>' : ' <span class="dim">approval required</span>') + '</span></div>' +
          '<div class="row"><span>Affect:</span> <span>' + (d.affect ? 'sat=' + d.affect.satisfaction + ' fru=' + d.affect.frustration + ' cur=' + d.affect.curiosity + ' fat=' + d.affect.fatigue : 'n/a') + '</span></div>' +
          '<div class="row"><span>Survival prob:</span> <span>' + (d.survival_probability ?? 'n/a') + '</span></div>' +
          '<div style="margin-top:8px">' + issues + '</div>' +
        '</div>' +
        '<h2>TOP-LEVEL GOALS</h2><div class="panel">' + goals +
        '<div class="row dim"><span>mid-level active:</span> <span>' + d.goals.mid_count + '</span></div>' +
        '<div class="row dim"><span>tasks pending:</span> <span>' + d.goals.tasks_pending + '</span></div>' +
        '<div class="row dim"><span>tasks dispatched:</span> <span>' + d.goals.tasks_dispatched + '</span></div>' +
        '<div class="row dim"><span>tasks completed:</span> <span>' + d.goals.tasks_completed + '</span></div>' +
        '</div>' +
        '<div class="grid"><div>' +
        '<h2>APPROVAL QUEUE (substrate wants to do)</h2><div class="panel">' + queue + '</div>' +
        '<h2>SELF-CONSTRUCTION (substrate proposing changes)</h2><div class="panel">' + sc + '</div>' +
        '</div><div>' +
        '<h2>CORTEX ACTIONS (executed)</h2><div class="panel">' + actions + '</div>' +
        '<h2>FILES MODIFIED (last 5min)</h2><div class="panel">' + files + '</div>' +
        '</div></div>' +
        '<h2>RECENT BUS EVENTS</h2><div class="panel">' + events + '</div>';
      document.getElementById('refresh-info').textContent = '· refreshed ' + new Date().toLocaleTimeString() + ' · auto-refresh 3s';
    }
    refresh();
    setInterval(refresh, 3000);
  </script>
</body></html>`;

const server = createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML);
    return;
  }
  if (req.method === "GET" && req.url === "/dashboard") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(DASHBOARD_HTML);
    return;
  }
  if (req.method === "GET" && req.url === "/dashboard-data") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(_buildLiveSnapshot()));
    return;
  }
  if (req.method === "GET" && req.url === "/history") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ exchanges: _readChatHistory() }));
    return;
  }
  if (req.method === "POST" && req.url === "/chat") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const { message } = JSON.parse(body);
        if (!message || typeof message !== "string") {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "no message" }));
          return;
        }
        const result = await chat(message);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

// ─── Entry point ───────────────────────────────────────────────────────

// ─── Auto-launch daemon + open browser ────────────────────────────────

let _launcherChild = null;

function _killExistingLaunchers() {
  try {
    spawnSync("pkill", ["-9", "-f", "cortex-launcher.mjs"], { stdio: "ignore" });
  } catch {}
}

function _killExistingChatServers() {
  try {
    // Kill OTHER substrate-chat processes (not us). pkill matches by command line.
    // Our PID is process.pid - exclude via -P or just use pkill which won't kill ourselves
    // because pkill matches by name in /proc but our pattern includes substrate-chat.mjs.
    // Use pgrep first to find them, then kill all except us.
    const r = spawnSync("pgrep", ["-f", "substrate-chat.mjs"], { encoding: "utf-8" });
    const pids = (r.stdout || "").trim().split("\n").filter(p => p && parseInt(p) !== process.pid);
    for (const pid of pids) {
      try { process.kill(parseInt(pid), "SIGKILL"); } catch {}
    }
  } catch {}
}

function _startDaemon() {
  const launcherPath = resolve(__dirname, "cortex-launcher.mjs");
  if (!existsSync(launcherPath)) {
    console.warn(`[substrate-chat] launcher not found at ${launcherPath} - starting chat without daemon`);
    return null;
  }
  const logPath = resolve(DATA_DIR, "cortex-launcher.log");
  const out = openSync(logPath, "a");
  const err = openSync(logPath, "a");
  const child = spawn("node", [launcherPath], {
    detached: false,           // keep tied to parent so dies when parent dies
    stdio: ["ignore", out, err],
    cwd: ROOT,
  });
  console.log(`[substrate-chat] launcher started PID ${child.pid} (logs: ${logPath})`);
  return child;
}

function _openBrowser(url) {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  try { spawn(cmd, [url], { stdio: "ignore", detached: true }).unref(); } catch {}
}

function _setupCleanup() {
  const cleanup = () => {
    console.log("\n[substrate-chat] cleanup: stopping launcher + child processes...");
    if (_launcherChild) {
      try { _launcherChild.kill("SIGTERM"); } catch {}
      // Force kill if SIGTERM didn't work after 2s
      setTimeout(() => {
        try { _launcherChild.kill("SIGKILL"); } catch {}
      }, 2000).unref?.();
    }
    // Also pkill any orphan launchers
    try { spawnSync("pkill", ["-9", "-f", "cortex-launcher.mjs"], { stdio: "ignore" }); } catch {}
    setTimeout(() => process.exit(0), 500).unref?.();
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("exit", () => {
    try { spawnSync("pkill", ["-9", "-f", "cortex-launcher.mjs"], { stdio: "ignore" }); } catch {}
  });
}

// ─── Entry point ───────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  // CLI mode if message argument provided
  if (process.argv.length >= 3) {
    const msg = process.argv.slice(2).join(" ");
    chat(msg).then(r => {
      console.log("\n=== SUBSTRATE ===\n");
      console.log(r.response);
      console.log("\n=== meta ===");
      console.log(`State files read: ${r.state_files_count}`);
      console.log(`Files: ${r.state_files_read.slice(0, 10).join(", ")}${r.state_files_read.length > 10 ? "..." : ""}`);
      process.exit(0);
    }).catch(e => { console.error("Error:", e); process.exit(1); });
  } else {
    // HTTP server mode - auto-launch daemon, auto-open browser
    console.log("[substrate-chat] starting...");
    console.log(`[substrate-chat] project root: ${ROOT}`);

    // Optional flag: --no-daemon to skip launcher
    const skipDaemon = process.argv.includes("--no-daemon");
    _killExistingChatServers(); // free port 3849 from prior runs
    // Brief wait for kill to take effect
    spawnSync("sleep", ["1"]);
    if (!skipDaemon) {
      _killExistingLaunchers();
      _launcherChild = _startDaemon();
    } else {
      console.log("[substrate-chat] --no-daemon flag - skipping launcher");
    }
    _setupCleanup();

    // HTTP server mode
    server.listen(PORT, "127.0.0.1", () => {
      console.log(`Substrate chat server: http://localhost:${PORT}`);
      console.log(`Reads .data/cortex-*.json + top-level-goals + living-prompt + chat history`);
      console.log(`Press Ctrl+C to stop (also stops launcher daemon).`);
      // Auto-open browser after short delay
      setTimeout(() => _openBrowser(`http://localhost:${PORT}`), 1000);
    });
  }
}
