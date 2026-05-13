/**
 * scripts/tolik/recorder.mjs
 *
 * Screen recording so Tolik can save proof of his own actions.
 * Uses macOS built-in `screencapture -v` for video. Saves to
 * .data/tolik-recordings/.
 *
 * Two modes:
 *   - timed: rec_start({seconds: 30}) launches screencapture with -V flag
 *     and auto-stops after N seconds. Returns the file path.
 *   - manual: rec_start({}) → rec_stop({}) bracket; useful for recording
 *     an entire voice session.
 *
 * Note: macOS will prompt for Screen Recording permission the first time.
 * Tolik handles the case where the permission is denied gracefully.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const REC_DIR = resolve(ROOT, ".data/tolik-recordings");

let _activeChild = null;
let _activePath = null;
let _activeAutoStopTimer = null;

function ensureDir() { if (!existsSync(REC_DIR)) mkdirSync(REC_DIR, { recursive: true }); }

function stampedPath() {
  const t = new Date();
  const slug = t.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return resolve(REC_DIR, `tolik-${slug}.mov`);
}

export async function rec_start({ seconds = 0 } = {}) {
  if (_activeChild) return { ok: false, reason: "already_recording", path: _activePath };
  ensureDir();
  const outPath = stampedPath();
  // `screencapture -v` records video. `-V <seconds>` auto-stops.
  // We use spawn so we can kill it on rec_stop.
  const args = ["-v"];
  if (seconds > 0) args.push("-V", String(seconds));
  args.push(outPath);

  const child = spawn("screencapture", args, { stdio: "ignore", detached: false });
  _activeChild = child;
  _activePath = outPath;

  child.on("exit", () => {
    _activeChild = null;
    if (_activeAutoStopTimer) { clearTimeout(_activeAutoStopTimer); _activeAutoStopTimer = null; }
  });

  if (seconds > 0) {
    _activeAutoStopTimer = setTimeout(() => {
      // screencapture exits on its own when -V is set; this is a safety net
      try { if (_activeChild) process.kill(_activeChild.pid, "SIGTERM"); } catch {}
    }, (seconds + 5) * 1000);
  }

  return { ok: true, recording_path: outPath, seconds: seconds || "manual_until_stop" };
}

export async function rec_stop() {
  if (!_activeChild) {
    // Maybe a previous run finished — return the most recent file
    if (!existsSync(REC_DIR)) return { ok: false, reason: "no_active_recording" };
    const files = readdirSync(REC_DIR)
      .filter(f => f.endsWith(".mov"))
      .map(f => ({ f, m: statSync(resolve(REC_DIR, f)).mtimeMs }))
      .sort((a,b) => b.m - a.m);
    if (files.length === 0) return { ok: false, reason: "no_active_recording" };
    return { ok: true, mode: "no_active_used_latest", path: resolve(REC_DIR, files[0].f) };
  }
  try { process.kill(_activeChild.pid, "SIGTERM"); } catch {}
  const path = _activePath;
  // Give screencapture a moment to flush the file
  await new Promise(r => setTimeout(r, 500));
  _activeChild = null;
  _activePath = null;
  return { ok: true, recorded_path: path };
}

export async function rec_status() {
  return {
    ok: true,
    recording: !!_activeChild,
    path: _activePath,
    pid: _activeChild?.pid || null,
  };
}
