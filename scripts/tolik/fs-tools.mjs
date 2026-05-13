/**
 * scripts/tolik/fs-tools.mjs
 *
 * Tolik's file-system hands: read files, list directories, grep code,
 * open files in VS Code. All sandboxed to the project root - Tolik never
 * walks outside the repo (no /etc, no /Users/.../Documents, no $HOME).
 *
 * Path safety: every path is resolved and re-checked to be inside ROOT
 * before any read. Symlinks pointing outside are rejected.
 */

import { readFileSync, readdirSync, statSync, existsSync, realpathSync } from "node:fs";
import { execFile } from "node:child_process";
import { resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

const READ_BYTES_CAP = 200_000;     // refuse files larger than this
const LIST_ENTRIES_CAP = 200;

function safeResolve(input) {
  if (typeof input !== "string" || !input) return { ok: false, reason: "no_path" };
  // Normalize against ROOT regardless of whether input is absolute or relative
  const abs = input.startsWith("/") ? resolve(input) : resolve(ROOT, input);
  // Catch symlink escapes
  let real;
  try { real = existsSync(abs) ? realpathSync(abs) : abs; }
  catch { real = abs; }
  if (!real.startsWith(ROOT + sep) && real !== ROOT) {
    return { ok: false, reason: "path_outside_repo", path: real };
  }
  return { ok: true, abs: real };
}

export async function fs_read({ path }) {
  const r = safeResolve(path);
  if (!r.ok) return r;
  if (!existsSync(r.abs)) return { ok: false, reason: "not_found", path };
  const st = statSync(r.abs);
  if (st.isDirectory()) return { ok: false, reason: "is_directory", hint: "use fs_list" };
  if (st.size > READ_BYTES_CAP) return { ok: false, reason: "too_large", bytes: st.size, cap: READ_BYTES_CAP };
  const content = readFileSync(r.abs, "utf-8");
  return {
    ok: true,
    path: relative(ROOT, r.abs),
    bytes: st.size,
    lines: content.split("\n").length,
    content,
  };
}

export async function fs_list({ path }) {
  const r = safeResolve(path || ".");
  if (!r.ok) return r;
  if (!existsSync(r.abs)) return { ok: false, reason: "not_found", path };
  const st = statSync(r.abs);
  if (!st.isDirectory()) return { ok: false, reason: "not_a_directory" };
  const entries = readdirSync(r.abs).slice(0, LIST_ENTRIES_CAP).map(name => {
    const sub = resolve(r.abs, name);
    try {
      const s = statSync(sub);
      return {
        name,
        kind: s.isDirectory() ? "dir" : "file",
        size: s.isFile() ? s.size : null,
        modified: s.mtime.toISOString(),
      };
    } catch { return { name, kind: "unknown" }; }
  });
  return { ok: true, path: relative(ROOT, r.abs), count: entries.length, entries };
}

export async function fs_grep({ query, dir = "scripts", max_results = 30 }) {
  if (!query) return { ok: false, reason: "no_query" };
  const dirR = safeResolve(dir);
  if (!dirR.ok) return dirR;
  try {
    // Use ripgrep if available (way faster), fallback to grep -rn
    let cmd, args;
    try {
      await exec("which", ["rg"]);
      cmd = "rg";
      args = ["-n", "--max-count", "3", "--max-columns", "200", "-l", "false", "--no-heading", query, dirR.abs];
    } catch {
      cmd = "grep";
      args = ["-rn", "--max-count=3", query, dirR.abs];
    }
    const { stdout } = await exec(cmd, args, { encoding: "utf-8", maxBuffer: 4 * 1024 * 1024, timeout: 8000 });
    const lines = stdout.split("\n").filter(Boolean).slice(0, max_results)
      .map(l => l.replace(ROOT + "/", ""));
    return { ok: true, query, dir: relative(ROOT, dirR.abs), matches: lines, count: lines.length };
  } catch (e) {
    // Non-zero exit just means no matches
    return { ok: true, query, dir, matches: [], count: 0 };
  }
}

export async function fs_open_editor({ path }) {
  const r = safeResolve(path);
  if (!r.ok) return r;
  if (!existsSync(r.abs)) return { ok: false, reason: "not_found", path };
  try {
    // Try VS Code first, fall back to default app
    try { await exec("code", [r.abs]); }
    catch { await exec("open", [r.abs]); }
    return { ok: true, opened: relative(ROOT, r.abs) };
  } catch (e) {
    return { ok: false, reason: "open_failed", error: e.message };
  }
}

export async function fs_tail_log({ name, n = 40 }) {
  // Convenience for the LLM: short names → known log files
  const LOG_MAP = {
    "webhook-server":      ".data/webhook-server.log",
    "tolik-browser-agent": ".data/tolik-browser-agent.log",
    "tolik-dev":           ".data/tolik-dev.log",
    "command-dev":         ".data/command-dev.log",
    "pulse-daemon":        ".data/pulse-daemon.log",
    "cortex-daemon":       ".data/cortex-daemon.log",
    "orchestrator":        ".data/orchestrator-daemon.log",
  };
  const path = LOG_MAP[name] || name;
  const r = safeResolve(path);
  if (!r.ok) return r;
  if (!existsSync(r.abs)) return { ok: false, reason: "log_not_found", name, resolved: path };
  try {
    const { stdout } = await exec("tail", [String(`-${Math.min(200, Math.max(1, n))}`), r.abs], { encoding: "utf-8", maxBuffer: 1024 * 1024 });
    return { ok: true, log: name, path: relative(ROOT, r.abs), lines: stdout.split("\n").filter(Boolean) };
  } catch (e) { return { ok: false, reason: "tail_failed", error: e.message }; }
}
