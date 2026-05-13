/**
 * scripts/tolik/code-delegate.mjs
 *
 * Tolik's most powerful hand: when Kirill says "open VS Code and give it
 * a task to build X", Tolik can:
 *   1. Open VS Code at the repo root
 *   2. Spawn a Claude Code CLI session in a NEW Terminal window with
 *      the task pre-loaded as the first prompt
 *   3. Track the delegation in .data/tolik-delegations/<id>.md
 *   4. Notify Kirill via Telegram when delegation completes or stalls
 *
 * Two modes:
 *   - "interactive": opens Terminal + claude CLI, Kirill watches it work
 *   - "background": spawns claude -p with task, output streams to a file,
 *                   Tolik notifies TG when done
 *
 * The Claude binary path comes from llm-think.mjs - reusing the same
 * CLI that survival uses.
 */

import { execFile, spawn } from "node:child_process";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import crypto from "node:crypto";

import { tg_send_to_me } from "./tg-tools.mjs";

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DELEGATIONS_DIR = resolve(ROOT, ".data/tolik-delegations");
const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";

function ensureDir() { if (!existsSync(DELEGATIONS_DIR)) mkdirSync(DELEGATIONS_DIR, { recursive: true }); }

function delegationId() {
  return `${new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-")}-${crypto.randomBytes(2).toString("hex")}`;
}

export async function delegate_to_coder({ task, mode = "interactive", context_files = [] }) {
  if (!task || !task.trim()) return { ok: false, reason: "no_task" };
  ensureDir();
  const id = delegationId();
  const taskPath = resolve(DELEGATIONS_DIR, `${id}-task.md`);
  const outputPath = resolve(DELEGATIONS_DIR, `${id}-output.md`);

  const contextBlock = context_files.length > 0
    ? `\n\nRELEVANT FILES:\n${context_files.map(f => `- ${f}`).join("\n")}`
    : "";

  const fullTask = `# Task delegated by Tolik on behalf of Kirill

**Delegation ID:** ${id}
**Started:** ${new Date().toISOString()}

## What Kirill asked for
${task}
${contextBlock}

## Rules
- This is a real codebase. Read CLAUDE.md if it exists. Understand existing patterns before adding new ones.
- NO em dashes anywhere. Hyphens only.
- Match the project's existing code style.
- When you finish, write your final report into ${outputPath}.
- If you need clarification, write the question into ${outputPath} and stop - Tolik will relay it.
`;
  writeFileSync(taskPath, fullTask);

  if (mode === "interactive") {
    // Open VS Code on the repo (background, idempotent if already open)
    try { await exec("code", [ROOT]); } catch { try { await exec("open", ["-a", "Visual Studio Code", ROOT]); } catch {} }

    // Open a new Terminal window with claude pre-loaded with the task
    const cmd = `cd "${ROOT}" && cat "${taskPath}" | "${CLAUDE_BIN}" 2>&1 | tee "${outputPath}"`;
    const osa = `tell application "Terminal" to do script "${cmd.replace(/"/g, '\\"')}"`;
    try { await exec("osascript", ["-e", osa]); }
    catch (e) { return { ok: false, reason: "terminal_failed", error: e.message, task_file: taskPath }; }

    return {
      ok: true,
      mode,
      delegation_id: id,
      task_file: taskPath.replace(ROOT + "/", ""),
      output_file: outputPath.replace(ROOT + "/", ""),
      message: "VS Code opened, Claude Code launched in a new Terminal window with the task. Watch it work.",
    };
  }

  // mode === "background"
  // Spawn claude -p (non-interactive) with the task; stream output to file.
  const proc = spawn("sh", ["-c", `cat "${taskPath}" | "${CLAUDE_BIN}" -p --max-turns 30 --output-format text > "${outputPath}" 2>&1`], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
  });
  proc.unref();
  writeFileSync(resolve(DELEGATIONS_DIR, `${id}-pid`), String(proc.pid));

  // Fire-and-forget notification when output file gets non-trivial size
  pollUntilDone(outputPath, id, task).catch(() => {});

  return {
    ok: true,
    mode,
    delegation_id: id,
    pid: proc.pid,
    task_file: taskPath.replace(ROOT + "/", ""),
    output_file: outputPath.replace(ROOT + "/", ""),
    message: "Background Claude session started. Tolik will notify in Telegram when it finishes.",
  };
}

async function pollUntilDone(outputPath, id, task) {
  const { existsSync, statSync, readFileSync } = await import("node:fs");
  // Check every 30s for up to 30min
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 30_000));
    if (!existsSync(outputPath)) continue;
    const size = statSync(outputPath).size;
    // If output settled (no growth in 30s window since previous check), assume done
    if (size === 0) continue;
    // Read last lines and detect "Claude finished" - heuristic: last write > 30s ago
    const mtime = statSync(outputPath).mtime.getTime();
    if (Date.now() - mtime > 30_000) {
      const tail = readFileSync(outputPath, "utf-8").slice(-1500);
      const preview = tail.length > 1500 ? "…" + tail : tail;
      await tg_send_to_me({
        text: `✅ <b>Делегация завершена</b>\n<i>${id}</i>\n<i>Задача:</i> ${task.slice(0, 200)}\n\n<b>Хвост вывода:</b>\n<pre>${preview.replace(/</g, "&lt;")}</pre>\n📁 .data/tolik-delegations/${id}-output.md`,
      });
      return;
    }
  }
  // Timeout
  await tg_send_to_me({ text: `⏰ Делегация ${id} ещё работает после 30 минут. Проверь .data/tolik-delegations/${id}-output.md` });
}

export async function delegation_status({ delegation_id }) {
  if (!delegation_id) return { ok: false, reason: "no_id" };
  const outputPath = resolve(DELEGATIONS_DIR, `${delegation_id}-output.md`);
  if (!existsSync(outputPath)) return { ok: false, reason: "no_output_yet" };
  const fs = await import("node:fs");
  const stat = fs.statSync(outputPath);
  const content = fs.readFileSync(outputPath, "utf-8");
  const ageMs = Date.now() - stat.mtime.getTime();
  return {
    ok: true,
    delegation_id,
    bytes: stat.size,
    last_write: stat.mtime.toISOString(),
    seconds_since_last_write: Math.round(ageMs / 1000),
    likely_done: ageMs > 30_000,
    tail: content.slice(-1200),
  };
}

export async function delegations_list() {
  if (!existsSync(DELEGATIONS_DIR)) return { ok: true, delegations: [] };
  const fs = await import("node:fs");
  const files = fs.readdirSync(DELEGATIONS_DIR).filter(f => f.endsWith("-task.md"));
  const list = files.map(f => {
    const id = f.replace("-task.md", "");
    const out = resolve(DELEGATIONS_DIR, `${id}-output.md`);
    const out_exists = existsSync(out);
    return {
      id,
      task_file: `.data/tolik-delegations/${f}`,
      has_output: out_exists,
      output_size: out_exists ? fs.statSync(out).size : 0,
      output_mtime: out_exists ? fs.statSync(out).mtime.toISOString() : null,
    };
  }).sort((a, b) => (b.output_mtime || "").localeCompare(a.output_mtime || ""));
  return { ok: true, delegations: list };
}
