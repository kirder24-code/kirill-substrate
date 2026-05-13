/**
 * scripts/survival/factory-dispatcher.mjs
 *
 * Substrate -> factory dispatch via file-drop request mechanism.
 *
 * Substrate's dispatch_to_factory action writes a request to
 * .data/factory-requests/<id>.json. A small watcher script
 * (factory-request-runner.mjs, started by pulse-daemon) polls this
 * directory, executes the appropriate factory bot in spawn mode, and
 * writes a result file to .data/factory-results/<id>.json.
 *
 * Substrate's poll_factory_results action reads completed results and
 * folds them back into opportunities or specialist context.
 *
 * Safety: only allow-listed factory scripts can be invoked. NOT
 * arbitrary execution. Each request has a budget cap (default 5 min,
 * SIGTERM after).
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import crypto from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const REQ_DIR = resolve(ROOT, ".data/factory-requests");
const RES_DIR = resolve(ROOT, ".data/factory-results");
const NODE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/node";

// Allow-listed factory scripts substrate can invoke. KEEP THIS SHORT.
// Anything not in this list cannot be dispatched.
const DISPATCHABLE = {
  // bot-name -> { script, args(default), timeout_ms, description }
  "research-bot-v2": {
    script: "scripts/factory/research-bot-v2.mjs",
    default_args: ["--batch"],
    timeout_ms: 5 * 60_000,
    description: "Research one batch of intel sources for a topic",
  },
  "discovery-engine": {
    script: "scripts/cortex/discovery-engine.mjs",
    default_args: [],
    timeout_ms: 5 * 60_000,
    description: "Run discovery engine for opportunity surfacing",
  },
  "scout-bot": {
    script: "scripts/factory/scout-bot.mjs",
    default_args: ["once"],
    timeout_ms: 3 * 60_000,
    description: "Run scout-bot once (find ICP signals)",
  },
};

function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }

export function listDispatchable() {
  return Object.entries(DISPATCHABLE).map(([k, v]) => ({ name: k, description: v.description }));
}

// --- substrate-side action: dispatch_to_factory ---

export const dispatchToFactoryMeta = {
  description: "Substrate writes a request file to ask a factory bot for work. Watcher (factory-request-runner) executes async.",
  side_effect_class: "auto",
  expected_signal: "factory_request_queued",
  expected_signal_delay_min: 0,
  estimated_cost_usd: 0.0,
};

export async function runDispatchToFactory({ strategy }) {
  const params = strategy.parameters_json ? JSON.parse(strategy.parameters_json) : {};
  const bot_name = params.bot_name || "research-bot-v2";
  const args = params.args || DISPATCHABLE[bot_name]?.default_args || [];
  if (!DISPATCHABLE[bot_name]) {
    return { ok: false, reason: "bot_not_dispatchable", bot_name, allowed: Object.keys(DISPATCHABLE) };
  }
  ensureDir(REQ_DIR);
  const id = `req-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const req = {
    id,
    queued_at: new Date().toISOString(),
    bot_name,
    args,
    requester_strategy_id: strategy.id,
    status: "queued",
  };
  writeFileSync(resolve(REQ_DIR, `${id}.json`), JSON.stringify(req, null, 2));
  return { ok: true, id, bot_name, args };
}

// --- substrate-side action: poll_factory_results ---

export const pollFactoryResultsMeta = {
  description: "Read .data/factory-results/ for completed factory requests, fold results into substrate's view.",
  side_effect_class: "auto",
  expected_signal: "factory_results_polled",
  expected_signal_delay_min: 0,
  estimated_cost_usd: 0.0,
};

export async function runPollFactoryResults({ strategy }) {
  ensureDir(RES_DIR);
  const files = readdirSync(RES_DIR).filter(f => f.endsWith(".json"));
  if (files.length === 0) return { ok: true, results: 0 };
  const summaries = [];
  for (const f of files) {
    try {
      const r = JSON.parse(readFileSync(resolve(RES_DIR, f), "utf-8"));
      summaries.push({
        id: r.id, bot: r.bot_name, status: r.status,
        exit_code: r.exit_code, stdout_size: (r.stdout || "").length,
        finished_at: r.finished_at,
      });
    } catch {}
  }
  return { ok: true, results: summaries.length, summaries: summaries.slice(0, 10) };
}

// --- watcher / runner: meant to be invoked by pulse-daemon hourly ---

export async function runWatcherTick() {
  ensureDir(REQ_DIR);
  ensureDir(RES_DIR);
  const requests = readdirSync(REQ_DIR).filter(f => f.endsWith(".json"));
  if (requests.length === 0) return { processed: 0 };
  const out = [];
  for (const reqFile of requests) {
    const reqPath = resolve(REQ_DIR, reqFile);
    let req;
    try { req = JSON.parse(readFileSync(reqPath, "utf-8")); } catch { continue; }
    if (req.status !== "queued") continue;
    const def = DISPATCHABLE[req.bot_name];
    if (!def) {
      writeResult(req, { status: "rejected_unknown_bot" });
      try { unlinkSync(reqPath); } catch {}
      continue;
    }
    const r = await execFactoryBot({ scriptRel: def.script, args: req.args, timeout_ms: def.timeout_ms });
    writeResult(req, r);
    try { unlinkSync(reqPath); } catch {}
    out.push({ id: req.id, bot: req.bot_name, exit_code: r.exit_code });
  }
  return { processed: out.length, results: out };
}

function writeResult(req, result) {
  const out = {
    ...req,
    ...result,
    finished_at: new Date().toISOString(),
  };
  writeFileSync(resolve(RES_DIR, `${req.id}.json`), JSON.stringify(out, null, 2));
}

function execFactoryBot({ scriptRel, args, timeout_ms }) {
  return new Promise((resolveP) => {
    const scriptPath = resolve(ROOT, scriptRel);
    if (!existsSync(scriptPath)) {
      return resolveP({ status: "rejected_script_missing", scriptPath });
    }
    const child = spawn(NODE_BIN, [scriptPath, ...args], { cwd: ROOT });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const t = setTimeout(() => {
      killed = true;
      try { child.kill("SIGTERM"); } catch {}
    }, timeout_ms);
    child.stdout.on("data", d => stdout += d.toString());
    child.stderr.on("data", d => stderr += d.toString());
    child.on("close", (code) => {
      clearTimeout(t);
      resolveP({
        status: killed ? "timeout" : (code === 0 ? "ok" : "failed"),
        exit_code: code,
        stdout: stdout.slice(0, 8000),
        stderr: stderr.slice(0, 4000),
      });
    });
    child.on("error", (e) => {
      clearTimeout(t);
      resolveP({ status: "spawn_error", error: e.message });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  if (cmd === "watch") {
    console.log(JSON.stringify(await runWatcherTick(), null, 2));
  } else if (cmd === "list") {
    console.log(JSON.stringify(listDispatchable(), null, 2));
  } else {
    console.log("commands: watch (run one tick) | list");
  }
}
