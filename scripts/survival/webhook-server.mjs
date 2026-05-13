/**
 * scripts/survival/webhook-server.mjs
 *
 * Unified webhook receiver for real-world events. Pure node:http (no
 * dependencies). Endpoints:
 *   POST /webhooks/stripe
 *   POST /webhooks/calcom
 *   GET  /health
 *
 * Each event:
 *   1. HMAC signature verification with provider's secret
 *   2. Logged to .data/survival-real-events.jsonl (append-only)
 *   3. Mapped to substrate fitness signal (real_food_received_usd
 *      bumps the originating strategy via metadata.strategy_id)
 *
 * Env required:
 *   STRIPE_WEBHOOK_SECRET  — copy from Stripe Dashboard → Webhooks
 *   CALCOM_WEBHOOK_SECRET  — copy from Cal.com Settings → Webhooks
 *
 * Run: nohup node scripts/survival/webhook-server.mjs > .data/webhook-server.log 2>&1 &
 *      echo $! > .data/webhook-server.pid
 *
 * Public exposure: use cloudflared / ngrok / fly.io to give Stripe and
 * Cal.com a public URL pointing to localhost:4789. Setup steps documented
 * inline in this file's header.
 */

import { enforceOAuthBilling } from "../lib/billing-guard.mjs";
enforceOAuthBilling();
import http from "node:http";
import { readFileSync, appendFileSync, existsSync, mkdirSync, writeFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { handleStateRequest } from "../command/state-api.mjs";
import { handleVoiceRequest, handleVoiceAskFast, handleTTSRequest } from "../command/voice-bridge.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");
const EVENTS_LOG = resolve(ROOT, ".data/survival-real-events.jsonl");
const SURVIVAL_DB = resolve(ROOT, ".data/survival.db");
const PID_PATH = resolve(ROOT, ".data/webhook-server.pid");

const PORT = Number(process.env.WEBHOOK_PORT || 4789);

function envMap() {
  if (!existsSync(ENV_PATH)) return {};
  return Object.fromEntries(
    readFileSync(ENV_PATH, "utf-8").split("\n").filter(l => l && !l.startsWith("#") && l.includes("="))
      .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
  );
}

function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }
function logEvent(obj) {
  ensureDir(dirname(EVENTS_LOG));
  appendFileSync(EVENTS_LOG, JSON.stringify(obj) + "\n");
}
function bumpStrategyFood(strategy_id, usd_amount) {
  if (!strategy_id) return false;
  try {
    const db = new Database(SURVIVAL_DB);
    db.prepare(`UPDATE policy_strategies SET food_received_usd = food_received_usd + ? WHERE id = ?`).run(usd_amount, strategy_id);
    db.close();
    return true;
  } catch { return false; }
}

function verifyStripeSignature(rawBody, signatureHeader, secret) {
  const parts = (signatureHeader || "").split(",").reduce((acc, kv) => {
    const [k, v] = kv.split("=");
    acc[k] = v;
    return acc;
  }, {});
  if (!parts.t || !parts.v1) return false;
  const signed = `${parts.t}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(signed).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1)); }
  catch { return false; }
}

function verifyCalcomSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signatureHeader.replace(/^sha256=/, "");
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided)); }
  catch { return false; }
}

function handleStripe(event) {
  const type = event.type;
  const obj = event.data?.object || {};
  let food_usd = 0;
  let attribution_strategy_id = obj.metadata?.strategy_id || null;
  if (type === "payment_intent.succeeded") food_usd = (obj.amount_received || obj.amount || 0) / 100;
  else if (type === "invoice.paid") food_usd = (obj.amount_paid || 0) / 100;
  else if (type === "charge.refunded") food_usd = -(obj.amount_refunded || 0) / 100;
  let bumped = false;
  if (food_usd !== 0 && attribution_strategy_id) bumped = bumpStrategyFood(attribution_strategy_id, food_usd);
  return { type, food_usd, attribution_strategy_id, bumped };
}

function handleCalcom(event) {
  const type = event.triggerEvent;
  const payload = event.payload || {};
  let food_usd = 0;
  if (type === "BOOKING_CREATED") food_usd = 5.0;
  else if (type === "MEETING_ENDED") food_usd = 10.0;
  else if (type === "BOOKING_CANCELLED") food_usd = -2.0;
  const attribution_strategy_id = payload.metadata?.strategy_id || null;
  let bumped = false;
  if (food_usd !== 0 && attribution_strategy_id) bumped = bumpStrategyFood(attribution_strategy_id, food_usd);
  return { type, food_usd, attribution_strategy_id, bumped, attendee_email: payload.attendees?.[0]?.email };
}

function readBody(req) {
  return new Promise((res, rej) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => res(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", rej);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, ts: new Date().toISOString() }));
    return;
  }
  // COMMAND dashboard read-only state endpoints
  if (req.method === "GET" && req.url.startsWith("/api/state")) {
    handleStateRequest(req, res);
    return;
  }
  // CORS preflight for the dashboard during local dev
  if (req.method === "OPTIONS" && req.url.startsWith("/api/")) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }
  // Tolik's artifact HTML by id - rendered in sandboxed iframe by UI
  if (req.method === "GET" && req.url?.startsWith("/api/tolik/artifact/")) {
    const id = req.url.replace("/api/tolik/artifact/", "").replace(/[^a-zA-Z0-9-]/g, "");
    const path = resolve(ROOT, ".data/tolik-artifacts", `${id}.html`);
    if (!existsSync(path)) { res.writeHead(404); res.end(); return; }
    const body = readFileSync(path, "utf-8");
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Content-Security-Policy": "default-src 'self' data:; style-src 'unsafe-inline'; font-src https://fonts.gstatic.com data:; script-src 'none'",
    });
    res.end(body);
    return;
  }
  // Tolik's thoughts feed - SSE stream of autonomous observations
  if (req.method === "GET" && req.url === "/api/tolik/thoughts") {
    const thoughtsPath = resolve(ROOT, ".data/tolik-thoughts.jsonl");
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    // Send last 20 historical thoughts on connect
    if (existsSync(thoughtsPath)) {
      try {
        const lines = readFileSync(thoughtsPath, "utf-8").split("\n").filter(Boolean).slice(-20);
        for (const l of lines) {
          res.write(`data: ${l}\n\n`);
        }
      } catch {}
    }
    // Tail mode: poll the file every 3s and emit new lines
    let lastSize = existsSync(thoughtsPath) ? statSync(thoughtsPath).size : 0;
    const interval = setInterval(() => {
      if (!existsSync(thoughtsPath)) return;
      try {
        const sz = statSync(thoughtsPath).size;
        if (sz > lastSize) {
          const fd = openSync(thoughtsPath, "r");
          const buf = Buffer.alloc(sz - lastSize);
          readSync(fd, buf, 0, buf.length, lastSize);
          closeSync(fd);
          lastSize = sz;
          const lines = buf.toString("utf-8").split("\n").filter(Boolean);
          for (const l of lines) res.write(`data: ${l}\n\n`);
        }
      } catch {}
    }, 3000);
    req.on("close", () => clearInterval(interval));
    return;
  }
  // Dashboard presence ping - tells the proactive loop that Kirill is here
  if (req.method === "POST" && req.url === "/api/tolik/presence") {
    const presencePath = resolve(ROOT, ".data/tolik-presence.json");
    writeFileSync(presencePath, JSON.stringify({ last_ping_at: new Date().toISOString() }));
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  // ──────────────────────────────────────────────────────────────────────
  // JARVIS-HYBRID endpoints (snap-listener.py, voice-loop.py, mode router)
  // ──────────────────────────────────────────────────────────────────────
  // Mode state file: { mode: "code" | "brain", updated_at }
  // - "brain" = default. Voice → existing voice-bridge agentic loop (OpenAI).
  // - "code"  = voice → paste into Kirill's active Claude Code Terminal.
  const MODE_FILE = resolve(ROOT, ".data/tolik-mode.json");
  function readMode() {
    try { return JSON.parse(readFileSync(MODE_FILE, "utf-8"))?.mode || "brain"; }
    catch { return "brain"; }
  }
  function writeMode(mode) {
    writeFileSync(MODE_FILE, JSON.stringify({ mode, updated_at: new Date().toISOString() }, null, 2));
  }

  // POST /api/content/callback — Telegram callback_query relay for content approval
  // (set TELEGRAM webhook to point here, OR run a polling worker that forwards
  // callback_query to this endpoint).
  if (req.method === "POST" && req.url === "/api/content/callback") {
    const body = await readBody(req);
    let payload;
    try { payload = JSON.parse(body); }
    catch { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, reason: "invalid_json" })); return; }
    try {
      const { handleCallback } = await import("../content/tg-approval.mjs");
      const result = await handleCallback({ callback_query: payload.callback_query });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, reason: "handler_threw", error: e.message }));
    }
    return;
  }

  // POST /api/content/send-for-approval { asset_id } — manual trigger
  if (req.method === "POST" && req.url === "/api/content/send-for-approval") {
    const body = await readBody(req);
    let payload;
    try { payload = JSON.parse(body); } catch { payload = {}; }
    const asset_id = payload?.asset_id;
    if (!asset_id) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, reason: "no_asset_id" })); return; }
    try {
      const { sendAssetForApproval } = await import("../content/tg-approval.mjs");
      const result = await sendAssetForApproval({ asset_id });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, reason: "handler_threw", error: e.message }));
    }
    return;
  }

  // POST /api/tolik/snap — fired by snap-listener.py on double-snap
  if (req.method === "POST" && req.url === "/api/tolik/snap") {
    const snapEvent = { ts: new Date().toISOString(), event: "snap" };
    appendFileSync(resolve(ROOT, ".data/tolik-snaps.jsonl"), JSON.stringify(snapEvent) + "\n");
    // Trigger session-launch script in background
    try {
      const { spawn } = await import("node:child_process");
      spawn("bash", [resolve(ROOT, "scripts/jarvis/launch-session.sh")], {
        detached: true, stdio: "ignore"
      }).unref();
    } catch (e) { console.error("[snap] launch-session failed:", e.message); }
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ ok: true, action: "session_launched" }));
    return;
  }

  // GET /api/tolik/snap-events — SSE stream of snap events for dashboard
  // boot-sequence: arc-reactor sound + sphere flare + greeting replay.
  // Only streams events NEWER than connection time — never replays history.
  if (req.method === "GET" && req.url === "/api/tolik/snap-events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write("retry: 5000\n\n");
    const snapsPath = resolve(ROOT, ".data/tolik-snaps.jsonl");
    // Start at end-of-file so we ONLY get new events, never backfill history.
    let lastSize = existsSync(snapsPath) ? statSync(snapsPath).size : 0;
    const connectedAt = Date.now();
    const interval = setInterval(() => {
      if (!existsSync(snapsPath)) return;
      try {
        const sz = statSync(snapsPath).size;
        if (sz > lastSize) {
          const fd = openSync(snapsPath, "r");
          const buf = Buffer.alloc(sz - lastSize);
          readSync(fd, buf, 0, buf.length, lastSize);
          closeSync(fd);
          lastSize = sz;
          for (const line of buf.toString("utf-8").split("\n").filter(Boolean)) {
            try {
              const evt = JSON.parse(line);
              // Double-guard: ignore events older than connection
              if (evt.ts && new Date(evt.ts).getTime() < connectedAt) continue;
              res.write(`data: ${line}\n\n`);
            } catch { /* skip malformed line */ }
          }
        }
      } catch {}
    }, 1500);
    req.on("close", () => clearInterval(interval));
    return;
  }

  // GET /api/tolik/weather — IP-geolocated current conditions via Open-Meteo.
  // Cached 30min to avoid hammering the API.
  if (req.method === "GET" && req.url === "/api/tolik/weather") {
    const cachePath = resolve(ROOT, ".data/tolik-weather-cache.json");
    let cache = null;
    try {
      if (existsSync(cachePath)) {
        cache = JSON.parse(readFileSync(cachePath, "utf-8"));
        const ageSec = (Date.now() - cache.fetched_at) / 1000;
        if (ageSec < 1800) {
          res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
          res.end(JSON.stringify({ ...cache, cached: true, age_sec: Math.round(ageSec) }));
          return;
        }
      }
    } catch {}
    try {
      const loc = await fetch("http://ip-api.com/json/", { signal: AbortSignal.timeout(4000) }).then(r => r.json()).catch(() => null);
      if (!loc?.lat) throw new Error("location_failed");
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,weathercode&temperature_unit=celsius&timezone=auto`;
      const w = await fetch(url, { signal: AbortSignal.timeout(5000) }).then(r => r.json()).catch(() => null);
      if (!w?.current) throw new Error("weather_failed");
      const code = w.current.weathercode;
      const condition =
        code === 0 ? "ясно" :
        [1,2,3].includes(code) ? "облачно" :
        [45,48].includes(code) ? "туман" :
        [51,53,55].includes(code) ? "морось" :
        [61,63,65].includes(code) ? "дождь" :
        [71,73,75].includes(code) ? "снег" :
        [80,81,82].includes(code) ? "ливень" :
        [95,96,99].includes(code) ? "гроза" : "пасмурно";
      const out = {
        ok: true,
        city: loc.city,
        temp_c: Math.round(w.current.temperature_2m),
        condition,
        code,
        fetched_at: Date.now(),
      };
      writeFileSync(cachePath, JSON.stringify(out));
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ ok: false, error: e.message, fallback: cache || null }));
    }
    return;
  }

  // GET /api/tolik/mode — read current mode
  if (req.method === "GET" && req.url === "/api/tolik/mode") {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ ok: true, mode: readMode() }));
    return;
  }

  // POST /api/tolik/mode { mode: "code" | "brain" } — set mode
  if (req.method === "POST" && req.url === "/api/tolik/mode") {
    const body = await readBody(req);
    let parsed;
    try { parsed = JSON.parse(body); } catch { parsed = {}; }
    const mode = parsed?.mode;
    if (!["code", "brain"].includes(mode)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, reason: "mode must be 'code' or 'brain'" }));
      return;
    }
    writeMode(mode);
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ ok: true, mode }));
    return;
  }

  // POST /api/tolik/voice-command { text } — main entry from voice-loop.py
  // Routes to mode: code → paste-to-cc.py | brain → voice-bridge handler
  if (req.method === "POST" && req.url === "/api/tolik/voice-command") {
    const body = await readBody(req);
    let parsed;
    try { parsed = JSON.parse(body); } catch { parsed = {}; }
    const text = (parsed?.text || "").trim();
    if (!text) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, reason: "empty text" }));
      return;
    }

    // Voice mode-switch shortcuts (Russian + English)
    const lower = text.toLowerCase();
    if (/\b(толик[,]?\s+(кодить|код|код[еи]н|code))\b/i.test(lower) || /\b(code\s+mode|кодить)\b/i.test(lower)) {
      writeMode("code");
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ ok: true, action: "mode_switched", mode: "code", spoken: "Code mode activated, sir." }));
      return;
    }
    if (/\b(толик[,]?\s+(мозг|думать|brain))\b/i.test(lower) || /\b(brain\s+mode|мозг)\b/i.test(lower)) {
      writeMode("brain");
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ ok: true, action: "mode_switched", mode: "brain", spoken: "Brain mode activated, sir." }));
      return;
    }

    appendFileSync(resolve(ROOT, ".data/tolik-voice-cmds.jsonl"), JSON.stringify({ ts: new Date().toISOString(), text, mode: readMode() }) + "\n");

    const mode = readMode();
    if (mode === "code") {
      // Paste into active Claude Code Terminal via paste-to-cc.py
      const { spawn } = await import("node:child_process");
      const venvPython = resolve(ROOT, "scripts/jarvis/.venv/bin/python");
      const pasteScript = resolve(ROOT, "scripts/jarvis/paste-to-cc.py");
      const proc = spawn(venvPython, [pasteScript, text], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = "";
      proc.stdout.on("data", d => out += d);
      proc.stderr.on("data", d => err += d);
      const code = await new Promise(r => proc.on("close", r));
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ ok: code === 0, mode: "code", paste_result: out.trim(), error: err.trim() || null }));
      return;
    }

    // BRAIN mode: forward to existing voice-bridge /api/voice/ask which
    // returns audio_b64 (synthesized TTS). voice-loop.py decodes audio_b64
    // and afplays it so Tolik actually SPEAKS the response, not just logs it.
    try {
      const r = await fetch("http://127.0.0.1:4789/api/voice/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const j = await r.json();
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({
        ok: true,
        mode: "brain",
        answer: j.answer,
        audio_b64: j.audio_b64 || null,
        mime: j.mime || "audio/mpeg",
        tool_chain: j.tool_chain,
      }));
      return;
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, mode: "brain", error: e.message }));
      return;
    }
  }
  // Tolik morning greet - returns audio MP3 of a personalized greeting +
  // today's brief. Dashboard auto-plays once per day on mount.
  if (req.method === "GET" && req.url?.startsWith("/api/tolik/greet")) {
    const greetStatePath = resolve(ROOT, ".data/tolik-greet-state.json");
    const today = new Date().toISOString().slice(0, 10);
    let lastGreeted = null;
    try { if (existsSync(greetStatePath)) lastGreeted = JSON.parse(readFileSync(greetStatePath, "utf-8")).date; } catch {}
    const force = req.url.includes("force=1");
    const alreadyGreetedToday = lastGreeted === today;
    if (alreadyGreetedToday && !force) {
      res.writeHead(204); res.end(); return;
    }
    // Build greeting text from current brief — Iron Man / J.A.R.V.I.S. tone.
    // Brief, composed, butler-like. Numbers up front.
    let briefStats = null;
    try {
      const briefPath = resolve(ROOT, ".data/command/morning-brief.json");
      if (existsSync(briefPath)) {
        briefStats = JSON.parse(readFileSync(briefPath, "utf-8"));
      }
    } catch {}
    // Pull current weather (reuse cache if fresh)
    let weather = null;
    try {
      const wcache = resolve(ROOT, ".data/tolik-weather-cache.json");
      if (existsSync(wcache)) {
        const w = JSON.parse(readFileSync(wcache, "utf-8"));
        if (Date.now() - w.fetched_at < 1800_000) weather = w;
      }
    } catch {}
    const now = new Date();
    const hour = now.getHours();
    const tod = hour < 5 ? "С возвращением, Кирилл" : hour < 12 ? "С добрым утром, Кирилл" : hour < 18 ? "С возвращением, Кирилл" : "С возвращением, Кирилл";
    const timeStr = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    const opps = briefStats?.source_stats?.opps_by_state || {};
    const drafts = briefStats?.source_stats?.drafts_awaiting ?? 0;
    const totalOpps = Object.values(opps).reduce((a, b) => a + b, 0);
    const wxStr = weather ? `${weather.city}, ${weather.temp_c >= 0 ? "плюс " : ""}${weather.temp_c}, ${weather.condition}.` : "";
    // Format: "С возвращением, Кирилл. 21:30. Calgary, плюс 15, облачно. 5 возможностей в работе, 0 черновиков ждут одобрения. Готов изложить детали."
    const greeting = `${tod}. ${timeStr}. ${wxStr} ${totalOpps} возможност${totalOpps === 1 ? "ь" : totalOpps >= 2 && totalOpps <= 4 ? "и" : "ей"} в работе, ${drafts === 0 ? "очередь черновиков пуста" : drafts + " черновиков ждут одобрения"}. ${drafts === 0 && totalOpps > 0 ? "Готов изложить детали." : "Слушаю."}`.replace(/\s+/g, " ").trim();
    try {
      const { openaiTTS } = await import("../tolik/openai-tts.mjs");
      const tts = await openaiTTS(greeting);
      if (!tts.ok) { res.writeHead(500); res.end(JSON.stringify(tts)); return; }
      writeFileSync(greetStatePath, JSON.stringify({ date: today, greeted_at: new Date().toISOString() }));
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ ok: true, text: greeting, audio_b64: tts.audio_b64, mime: tts.mime, engine: tts.engine }));
    } catch (e) {
      res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }
  // Tolik goals - read for UI
  if (req.method === "GET" && req.url === "/api/tolik/goals") {
    try {
      const { getGoals } = await import("../tolik/goals.mjs");
      const goals = getGoals();
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ ok: true, goals }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }
  // Voice: full pipeline (STT → LLM → TTS, single round-trip)
  if (req.url === "/api/voice/ask") {
    await handleVoiceRequest(req, res, readBody);
    return;
  }
  // Voice: fast variant — no TTS in response. Client fetches /api/voice/tts
  // in parallel with rendering the text, cutting perceived latency.
  if (req.url === "/api/voice/ask-fast") {
    await handleVoiceAskFast(req, res, readBody);
    return;
  }
  // Voice: TTS-only endpoint for the fast path.
  if (req.url === "/api/voice/tts") {
    await handleTTSRequest(req, res, readBody);
    return;
  }
  // Serve the rendered morning brief MP3 (Tolik says it aloud)
  if (req.method === "GET" && req.url === "/api/tolik/brief.mp3") {
    const briefMp3 = resolve(ROOT, ".data/command/morning-brief.mp3");
    if (!existsSync(briefMp3)) { res.writeHead(404); res.end(); return; }
    const buf = readFileSync(briefMp3);
    res.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "Content-Length": buf.length,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(buf);
    return;
  }
  // Manual refresh of morning brief from the dashboard button
  if (req.method === "POST" && req.url === "/api/command/brief/refresh") {
    try {
      const { generateBrief } = await import("../command/morning-brief.mjs");
      const r = await generateBrief();
      res.writeHead(r.ok ? 200 : 500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(r));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }
  // Waitlist capture from the marketing site
  if (req.method === "POST" && req.url === "/api/waitlist") {
    const raw = await readBody(req);
    let payload;
    try { payload = JSON.parse(raw); }
    catch { res.writeHead(400); res.end("invalid json"); return; }
    logEvent({ ts: new Date().toISOString(), source: "waitlist", payload });
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === "POST" && (req.url === "/webhooks/stripe" || req.url === "/webhooks/calcom")) {
    const env = envMap();
    const rawBody = await readBody(req);
    let event;
    try { event = JSON.parse(rawBody); }
    catch {
      res.writeHead(400); res.end("invalid json"); return;
    }
    if (req.url === "/webhooks/stripe") {
      const secret = env.STRIPE_WEBHOOK_SECRET;
      if (!secret) {
        logEvent({ ts: new Date().toISOString(), source: "stripe", status: "no_secret" });
        res.writeHead(500); res.end(JSON.stringify({ error: "STRIPE_WEBHOOK_SECRET not in env" })); return;
      }
      if (!verifyStripeSignature(rawBody, req.headers["stripe-signature"], secret)) {
        logEvent({ ts: new Date().toISOString(), source: "stripe", status: "invalid_signature" });
        res.writeHead(400); res.end(JSON.stringify({ error: "invalid signature" })); return;
      }
      const handled = handleStripe(event);
      logEvent({ ts: new Date().toISOString(), source: "stripe", status: "ok", event_type: event.type, event_id: event.id, handled });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ received: true, handled }));
      return;
    }
    if (req.url === "/webhooks/calcom") {
      const secret = env.CALCOM_WEBHOOK_SECRET;
      if (!secret) {
        logEvent({ ts: new Date().toISOString(), source: "calcom", status: "no_secret" });
        res.writeHead(500); res.end(JSON.stringify({ error: "CALCOM_WEBHOOK_SECRET not in env" })); return;
      }
      if (!verifyCalcomSignature(rawBody, req.headers["x-cal-signature-256"], secret)) {
        logEvent({ ts: new Date().toISOString(), source: "calcom", status: "invalid_signature" });
        res.writeHead(400); res.end(JSON.stringify({ error: "invalid signature" })); return;
      }
      const handled = handleCalcom(event);
      logEvent({ ts: new Date().toISOString(), source: "calcom", status: "ok", trigger: event.triggerEvent, handled });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ received: true, handled }));
      return;
    }
  }
  res.writeHead(404); res.end();
});

writeFileSync(PID_PATH, String(process.pid));
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[webhook-server] listening on :${PORT} pid=${process.pid}`);
});
