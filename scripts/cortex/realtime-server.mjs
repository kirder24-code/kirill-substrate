/**
 * CORTEX REAL-TIME SERVER + DASHBOARD + TELEGRAM CONTROL
 *
 * All-in-one Express server:
 * 1. WEBHOOKS — Vapi, email, form, Fiverr → instant events
 * 2. DASHBOARD — HTML page showing brain state, decisions, KPD, channels
 * 3. TELEGRAM — /status /pause /resume /force /budget commands
 * 4. IMAP POLLING — checks email inbox every 2 min, pushes replies
 *
 * Port: 3847
 */

import express from "express";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const PORT = process.env.CORTEX_PORT || 3847;
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const ENV_PATH = resolve(ROOT, "apps/api/.env");

// Load env
const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

// Event queue - daemon reads and clears this
const eventQueue = [];

export function drainEvents() {
  const events = [...eventQueue];
  eventQueue.length = 0;
  return events;
}

export function hasEvents() {
  return eventQueue.length > 0;
}

// ── START SERVER ───────────────────────────────────────────────────────

export function startRealtimeServer(log = console.log) {
  const app = express();
  app.use(express.json());

  // ══════════════════════════════════════════════════════════════════════
  // WEBHOOKS
  // ══════════════════════════════════════════════════════════════════════

  app.get("/health", (req, res) => {
    res.json({ status: "alive", uptime: process.uptime(), pendingEvents: eventQueue.length, pid: process.pid });
  });

  app.post("/webhook/vapi", (req, res) => {
    const { type, call } = req.body || {};
    log(`[REALTIME] Vapi event: ${type}`);
    eventQueue.push({
      type: "vapi_webhook", subtype: type,
      data: { callId: call?.id, phoneNumber: call?.customer?.number, status: call?.status, duration: call?.duration, transcript: call?.transcript?.slice(0, 500) },
      receivedAt: new Date().toISOString(), priority: type === "end-of-call-report" ? "high" : "normal",
    });
    res.json({ ok: true });
  });

  app.post("/webhook/email-reply", (req, res) => {
    const { from, subject, body, leadId } = req.body || {};
    log(`[REALTIME] Email reply from: ${from}`);
    eventQueue.push({ type: "email_reply", data: { from, subject, body: body?.slice(0, 500), leadId }, receivedAt: new Date().toISOString(), priority: "high" });
    res.json({ ok: true });
  });

  app.post("/webhook/form", (req, res) => {
    const { name, email, phone, business, message } = req.body || {};
    log(`[REALTIME] Form submission: ${name} - ${business}`);
    eventQueue.push({ type: "form_submission", data: { name, email, phone, business, message: message?.slice(0, 500) }, receivedAt: new Date().toISOString(), priority: "critical" });
    res.json({ ok: true });
  });

  app.post("/webhook/fiverr", (req, res) => {
    const { orderId, buyerName, package: pkg, status } = req.body || {};
    log(`[REALTIME] Fiverr: ${status} - ${buyerName}`);
    eventQueue.push({ type: "fiverr_order", data: { orderId, buyerName, package: pkg, status }, receivedAt: new Date().toISOString(), priority: "critical" });
    res.json({ ok: true });
  });

  app.post("/trigger/cycle", (req, res) => {
    const { reason } = req.body || {};
    log(`[REALTIME] Manual cycle trigger: ${reason || "no reason"}`);
    eventQueue.push({ type: "manual_trigger", data: { reason }, receivedAt: new Date().toISOString(), priority: "high" });
    res.json({ ok: true, message: "Cycle triggered" });
  });

  // ══════════════════════════════════════════════════════════════════════
  // STATUS API (JSON)
  // ══════════════════════════════════════════════════════════════════════

  app.get("/status", (req, res) => {
    try {
      const data = buildStatusData();
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // DASHBOARD (HTML)
  // ══════════════════════════════════════════════════════════════════════

  app.get("/dashboard", (req, res) => {
    try {
      const data = buildStatusData();
      res.send(renderDashboard(data));
    } catch (e) {
      res.status(500).send(`<pre>Error: ${e.message}</pre>`);
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // CONTROL API
  // ══════════════════════════════════════════════════════════════════════

  app.post("/control/pause", (req, res) => {
    import("./config-injection.mjs").then(m => {
      const config = m.readConfig();
      config.global.paused = true;
      m.writeConfig(config);
      log("[CONTROL] System PAUSED");
      res.json({ ok: true, message: "System paused" });
    }).catch(e => res.status(500).json({ error: e.message }));
  });

  app.post("/control/resume", (req, res) => {
    import("./config-injection.mjs").then(m => {
      const config = m.readConfig();
      config.global.paused = false;
      m.writeConfig(config);
      log("[CONTROL] System RESUMED");
      res.json({ ok: true, message: "System resumed" });
    }).catch(e => res.status(500).json({ error: e.message }));
  });

  app.post("/control/budget", (req, res) => {
    const { amount } = req.body || {};
    if (!amount || amount < 0) return res.status(400).json({ error: "amount required" });
    import("./config-injection.mjs").then(m => {
      const config = m.readConfig();
      config.global.daily_budget_usd = amount;
      m.writeConfig(config);
      log(`[CONTROL] Budget set to $${amount}`);
      res.json({ ok: true, budget: amount });
    }).catch(e => res.status(500).json({ error: e.message }));
  });

  // ══════════════════════════════════════════════════════════════════════
  // TELEGRAM WEBHOOK (for /commands)
  // ══════════════════════════════════════════════════════════════════════

  app.post("/webhook/telegram", async (req, res) => {
    const msg = req.body?.message;
    if (!msg?.text || String(msg.chat?.id) !== env.TELEGRAM_CHAT_ID) return res.json({ ok: true });

    const text = msg.text.trim();
    const reply = async (t) => {
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: msg.chat.id, text: t, parse_mode: "HTML" }),
      }).catch(() => {});
    };

    try {
      if (text === "/cortex" || text === "/status") {
        const data = buildStatusData();
        await reply(
          `<b>CORTEX STATUS</b>\n` +
          `Uptime: ${data.uptime}s | PID: ${data.pid}\n` +
          `Memory: ${data.memory}\n` +
          `Budget: $${data.config?.spent?.toFixed(2)} / $${data.config?.budget?.toFixed(2)}\n` +
          `Paused: ${data.config?.paused ? "YES" : "no"}\n` +
          `Leads: ${data.db?.total_leads || 0} | Replies: ${data.db?.emails_replied || 0}\n` +
          `Last decision: ${data.lastDecision?.slice(0, 200) || "none"}\n` +
          `Channels: ${data.topChannels || "no data"}`
        );
      } else if (text === "/pause") {
        const m = await import("./config-injection.mjs");
        const config = m.readConfig();
        config.global.paused = true;
        m.writeConfig(config);
        await reply("CORTEX PAUSED");
        log("[TELEGRAM] System paused by Kirill");
      } else if (text === "/resume") {
        const m = await import("./config-injection.mjs");
        const config = m.readConfig();
        config.global.paused = false;
        m.writeConfig(config);
        await reply("CORTEX RESUMED");
        log("[TELEGRAM] System resumed by Kirill");
      } else if (text === "/force") {
        eventQueue.push({ type: "manual_trigger", data: { reason: "Kirill /force" }, receivedAt: new Date().toISOString(), priority: "high" });
        await reply("Forced cycle triggered");
        log("[TELEGRAM] Force cycle by Kirill");
      } else if (text.startsWith("/budget")) {
        const amt = parseFloat(text.split(" ")[1]);
        if (amt && amt > 0) {
          const m = await import("./config-injection.mjs");
          const config = m.readConfig();
          config.global.daily_budget_usd = amt;
          m.writeConfig(config);
          await reply(`Budget set to $${amt}`);
        } else {
          await reply("Usage: /budget 5.00");
        }
      } else if (text && !text.startsWith("/")) {
        // Free-form message from Kirill - acknowledge immediately, queue for brain
        await reply(`Слышу. Думаю...`);
        eventQueue.push({
          type: "telegram_command",
          data: { text, from: msg.from?.username || "kirill" },
          receivedAt: new Date().toISOString(),
          priority: "critical",
        });
        log(`[TELEGRAM] Message received: "${text.slice(0, 80)}"`);
      }
    } catch (e) {
      log(`[TELEGRAM] Command error: ${e.message}`);
    }

    res.json({ ok: true });
  });

  // ── START ─────────────────────────────────────────────────────────
  let portRetries = 0;
  const MAX_PORT_RETRIES = 5;
  let currentPort = PORT;

  function tryListen() {
    const server = app.listen(currentPort, () => {
      log(`[REALTIME] Server on port ${currentPort} | Dashboard: http://localhost:${currentPort}/dashboard`);
    });

    server.on("error", (e) => {
      if (e.code === "EADDRINUSE" && portRetries < MAX_PORT_RETRIES) {
        portRetries++;
        currentPort++;
        log(`[REALTIME] Port ${currentPort - 1} in use, trying ${currentPort} (attempt ${portRetries}/${MAX_PORT_RETRIES})`);
        server.close();
        tryListen();
      } else if (e.code === "EADDRINUSE") {
        log(`[REALTIME] All ports ${PORT}-${currentPort} in use. Dashboard disabled.`);
      } else {
        log(`[REALTIME] Server error: ${e.message}`);
      }
    });

    return server;
  }

  const server = tryListen();

  // Start IMAP email polling
  startEmailPolling(log);

  return server;
}

// ══════════════════════════════════════════════════════════════════════
// STATUS DATA BUILDER
// ══════════════════════════════════════════════════════════════════════

function buildStatusData() {
  const data = { pid: process.pid, uptime: Math.round(process.uptime()), memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + "MB", pendingEvents: eventQueue.length };

  // Config
  try {
    const configPath = resolve(ROOT, ".data/cortex-config.json");
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      data.config = { paused: config.global?.paused, budget: config.global?.daily_budget_usd, spent: config.global?.spent_today_usd };
    }
  } catch {}

  // Strategy
  try {
    const stratPath = resolve(ROOT, ".data/cortex-strategy.json");
    if (existsSync(stratPath)) {
      const strat = JSON.parse(readFileSync(stratPath, "utf-8"));
      data.channels = strat.channels;
      data.momentum = strat.momentum;
      data.topChannels = Object.entries(strat.channels || {}).sort(([,a],[,b]) => b.weight - a.weight).slice(0, 5).map(([n,d]) => `${n}:${d.weight}`).join(", ");
    }
  } catch {}

  // DB stats
  try {
    const db = new Database(DB_PATH, { readonly: true });
    data.db = {};
    try { data.db.total_leads = db.prepare("SELECT COUNT(*) as c FROM leads").get()?.c || 0; } catch {}
    try { data.db.emails_sent = db.prepare("SELECT COUNT(*) as c FROM outreach_emails WHERE status='sent'").get()?.c || 0; } catch {}
    try { data.db.emails_replied = db.prepare("SELECT COUNT(*) as c FROM outreach_emails WHERE status='replied'").get()?.c || 0; } catch {}

    // Recent decisions
    try {
      const dec = db.prepare("SELECT decision, decided_at FROM cortex_decisions ORDER BY decided_at DESC LIMIT 1").get();
      data.lastDecision = dec ? `${dec.decided_at}: ${dec.decision}` : null;
    } catch {}

    // KPD
    try {
      data.kpd = db.prepare(`SELECT bot_name, COUNT(*) as runs, ROUND(AVG(kpd_score),2) as avg_kpd, ROUND(SUM(cost_usd),2) as cost FROM cortex_kpd WHERE run_at > datetime('now','-3 days') GROUP BY bot_name ORDER BY avg_kpd DESC`).all();
    } catch { data.kpd = []; }

    // Recent decisions list
    try {
      data.decisions = db.prepare("SELECT decided_at, decision, reasoning FROM cortex_decisions ORDER BY decided_at DESC LIMIT 10").all();
    } catch { data.decisions = []; }

    // Healing
    try {
      const healPath = resolve(ROOT, ".data/cortex-healing-state.json");
      if (existsSync(healPath)) {
        const heal = JSON.parse(readFileSync(healPath, "utf-8"));
        data.healing = Object.entries(heal.bots || {}).filter(([,b]) => b.disabled || b.consecutiveFailures >= 2).map(([name, b]) => ({ name, disabled: b.disabled, failures: b.consecutiveFailures, reason: b.disabledReason }));
      }
    } catch {}

    db.close();
  } catch {}

  return data;
}

// ══════════════════════════════════════════════════════════════════════
// DASHBOARD HTML RENDERER
// ══════════════════════════════════════════════════════════════════════

function utcToCalgary(utcStr) {
  if (!utcStr) return "";
  try {
    const d = new Date(utcStr.includes("T") ? utcStr : utcStr + "Z");
    return d.toLocaleTimeString("en-CA", { timeZone: "America/Edmonton", hour12: false });
  } catch { return utcStr?.slice(11, 19) || ""; }
}

function renderDashboard(data) {
  const channelRows = Object.entries(data.channels || {})
    .sort(([,a],[,b]) => b.weight - a.weight)
    .map(([name, ch]) => `<tr><td>${name}</td><td><b>${ch.weight}</b></td><td>${ch.leads || 0}</td><td>${ch.qualified || 0}</td></tr>`)
    .join("");

  const kpdRows = (data.kpd || [])
    .map(k => `<tr><td>${k.bot_name}</td><td>${k.avg_kpd}</td><td>${k.runs}</td><td>$${k.cost}</td></tr>`)
    .join("");

  const decisionRows = (data.decisions || []).slice(0, 8)
    .map(d => `<tr><td>${utcToCalgary(d.decided_at)}</td><td>${(d.decision || "").slice(0, 120)}</td></tr>`)
    .join("");

  const healingRows = (data.healing || [])
    .map(h => `<tr><td>${h.name}</td><td>${h.disabled ? "DISABLED" : `${h.failures} fails`}</td><td>${h.reason || "-"}</td></tr>`)
    .join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>CORTEX Dashboard</title>
<meta http-equiv="refresh" content="30">
<style>
  body{font-family:monospace;background:#0a0a0a;color:#00ff41;padding:20px;max-width:1200px;margin:0 auto}
  h1{color:#00ff41;border-bottom:1px solid #00ff41}
  h2{color:#0af;margin-top:30px}
  table{border-collapse:collapse;width:100%;margin:10px 0}
  td,th{border:1px solid #333;padding:6px 10px;text-align:left}
  th{background:#111;color:#0af}
  tr:hover{background:#111}
  .stat{display:inline-block;background:#111;padding:10px 20px;margin:5px;border:1px solid #333;border-radius:4px}
  .stat b{font-size:1.4em;color:#0f0}
  .stat.warn b{color:#ff0}
  .stat.bad b{color:#f00}
  .controls{margin:20px 0}
  .btn{background:#111;color:#0f0;border:1px solid #0f0;padding:8px 16px;cursor:pointer;margin:5px;font-family:monospace}
  .btn:hover{background:#0f0;color:#000}
  .btn.danger{border-color:#f00;color:#f00}
  .btn.danger:hover{background:#f00;color:#000}
</style></head><body>
<h1>CORTEX v2 DASHBOARD</h1>
<div>
  <span class="stat">PID <b>${data.pid}</b></span>
  <span class="stat">Uptime <b>${Math.round(data.uptime/60)}m</b></span>
  <span class="stat">Memory <b>${data.memory}</b></span>
  <span class="stat ${data.config?.paused ? 'bad' : ''}">Status <b>${data.config?.paused ? "PAUSED" : "RUNNING"}</b></span>
  <span class="stat ${(data.config?.spent || 0) > (data.config?.budget || 5) * 0.8 ? 'warn' : ''}">Budget <b>$${(data.config?.spent || 0).toFixed(2)} / $${(data.config?.budget || 0).toFixed(2)}</b></span>
  <span class="stat">Leads <b>${data.db?.total_leads || 0}</b></span>
  <span class="stat">Replies <b>${data.db?.emails_replied || 0}</b></span>
  <span class="stat">Momentum <b>${data.momentum?.trend || "?"} (${data.momentum?.changePercent > 0 ? "+" : ""}${data.momentum?.changePercent || 0}%)</b></span>
</div>

<div class="controls">
  <button class="btn" onclick="fetch('/trigger/cycle',{method:'POST'}).then(()=>location.reload())">Force Cycle</button>
  <button class="btn ${data.config?.paused ? '' : 'danger'}" onclick="fetch('/control/${data.config?.paused ? 'resume' : 'pause'}',{method:'POST'}).then(()=>location.reload())">${data.config?.paused ? 'Resume' : 'Pause'}</button>
</div>

<h2>CHANNEL WEIGHTS (feedback loops)</h2>
<table><tr><th>Channel</th><th>Weight</th><th>Leads</th><th>Qualified</th></tr>${channelRows || "<tr><td colspan=4>no data</td></tr>"}</table>

<h2>BOT KPD (last 3 days)</h2>
<table><tr><th>Bot</th><th>Avg KPD</th><th>Runs</th><th>Cost</th></tr>${kpdRows || "<tr><td colspan=4>no data</td></tr>"}</table>

<h2>RECENT DECISIONS</h2>
<table><tr><th>Time</th><th>Decision</th></tr>${decisionRows || "<tr><td colspan=2>no decisions yet</td></tr>"}</table>

${healingRows ? `<h2>SELF-HEALING</h2><table><tr><th>Bot</th><th>Status</th><th>Reason</th></tr>${healingRows}</table>` : ""}

<p style="color:#555;margin-top:30px">Auto-refresh: 30s | Events pending: ${data.pendingEvents} | Last update: ${new Date().toLocaleTimeString("en-CA", { timeZone: "America/Edmonton" })}</p>
</body></html>`;
}

// ══════════════════════════════════════════════════════════════════════
// IMAP EMAIL POLLING (every 2 min)
// ══════════════════════════════════════════════════════════════════════

function startEmailPolling(log) {
  const IMAP_USER = env.SMTP_USER || env.IMAP_USER;
  const IMAP_PASS = env.SMTP_PASS || env.IMAP_PASS;
  const IMAP_HOST = env.IMAP_HOST || "imap.mail.me.com";

  if (!IMAP_USER || !IMAP_PASS) {
    log("[IMAP] No IMAP credentials, email polling disabled");
    return;
  }

  async function checkEmails() {
    try {
      const Imap = (await import("imap")).default;
      const { simpleParser } = await import("mailparser");

      const imap = new Imap({
        user: IMAP_USER, password: IMAP_PASS, host: IMAP_HOST,
        port: 993, tls: true, tlsOptions: { rejectUnauthorized: false },
      });

      imap.once("ready", () => {
        imap.openBox("INBOX", true, (err, box) => {
          if (err) { imap.end(); return; }

          // Search for unseen emails in last 2 minutes
          const since = new Date(Date.now() - 3 * 60 * 1000);
          imap.search(["UNSEEN", ["SINCE", since]], (err, results) => {
            if (err || !results?.length) { imap.end(); return; }

            const f = imap.fetch(results.slice(0, 5), { bodies: "" });
            f.on("message", (msg) => {
              msg.on("body", (stream) => {
                simpleParser(stream, (err, parsed) => {
                  if (err) return;
                  eventQueue.push({
                    type: "email_reply",
                    data: {
                      from: parsed.from?.text || "unknown",
                      subject: parsed.subject || "",
                      body: (parsed.text || "").slice(0, 500),
                    },
                    receivedAt: new Date().toISOString(),
                    priority: "high",
                  });
                  log(`[IMAP] New email: ${parsed.from?.text} - ${parsed.subject}`);
                });
              });
            });
            f.once("end", () => imap.end());
          });
        });
      });

      imap.once("error", () => {});
      imap.connect();
    } catch (e) {
      // Silently fail - IMAP is optional
    }
  }

  // Check every 2 minutes
  setInterval(checkEmails, 2 * 60 * 1000);
  // First check after 30s
  setTimeout(checkEmails, 30_000);
  log("[IMAP] Email polling started (every 2 min)");
}
