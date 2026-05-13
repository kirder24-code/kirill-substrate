/**
 * scripts/content/signal-hooks.mjs
 *
 * Top-level signal → visual-agent dispatcher. Reads recent signals from:
 *   - awareness-bot (.data/awareness/latest.md)
 *   - scout-bot (touches.db recent buyer-intent posts)
 *   - opportunity-store (new in_progress / state transitions)
 *   - proactive-loop (autonomous thoughts marked post-worthy)
 *
 * For each signal, decides: should we make a visual? If yes, queues it.
 *
 * NOT an autonomous spawner yet — runs in DRY mode by default. Returns the
 * list of would-be-spawned ideas so operator can review. Set
 * SIGNAL_HOOKS_AUTO=1 to actually spawn visual-agent for each.
 *
 * Public API:
 *   findSignals({ since })           — scan all sources, return signal items
 *   shouldMakeVisual(signal)         — decision logic (audience, freshness, dup)
 *   spawnVisualForSignal(signal)     — calls visual-agent.mjs (if auto-enabled)
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { listRecent as listRecentAssets } from "./content-store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

// ─── 1. Awareness brief ─────────────────────────────────────────────────
function readAwarenessSignals({ sinceMinutes = 1440 } = {}) {
  const path = resolve(ROOT, ".data/awareness/latest.md");
  if (!existsSync(path)) return [];
  const age = (Date.now() - statSync(path).mtimeMs) / 60000;
  if (age > sinceMinutes) return [];
  const content = readFileSync(path, "utf-8");
  const out = [];
  // Naive parse: look for ### sections, take title + first sentence
  const sections = content.split(/^### /m);
  for (const sec of sections.slice(1)) {
    const lines = sec.split("\n");
    const title = lines[0].trim();
    const body = lines.slice(1, 8).join(" ").trim().slice(0, 400);
    if (title && title.length > 8) {
      out.push({
        source: "awareness",
        source_ref: "awareness/latest.md",
        title,
        body,
        ts: statSync(path).mtimeMs,
      });
    }
  }
  return out;
}

// ─── 2. Scout buyer-intent posts ────────────────────────────────────────
function readScoutSignals({ sinceMinutes = 4320 } = {}) {
  const dbPath = resolve(ROOT, ".data/touches.db");
  if (!existsSync(dbPath)) return [];
  try {
    const c = new Database(dbPath, { readonly: true });
    // touches has channel + body + lead_id; recent_at column may exist
    const tables = c.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name);
    if (!tables.includes("touches")) { c.close(); return []; }
    // schema-flexible
    const cols = c.prepare(`PRAGMA table_info(touches)`).all().map(r => r.name);
    const hasCreatedAt = cols.includes("created_at");
    if (!hasCreatedAt) { c.close(); return []; }
    const rows = c.prepare(`SELECT * FROM touches WHERE created_at > datetime('now', '-' || ? || ' minutes') AND channel LIKE '%reddit%' ORDER BY created_at DESC LIMIT 20`).all(sinceMinutes);
    c.close();
    return rows.map(r => ({
      source: "scout",
      source_ref: `touches:${r.id || r.touch_id || "?"}`,
      title: (r.subject || r.headline || r.body || "").slice(0, 120),
      body: (r.body || "").slice(0, 400),
      ts: new Date(r.created_at).getTime(),
    })).filter(s => s.title);
  } catch (e) {
    console.error("[signal-hooks] scout read failed:", e.message);
    return [];
  }
}

// ─── 3. Opportunity transitions ────────────────────────────────────────
function readOpportunitySignals({ sinceMinutes = 4320 } = {}) {
  const dbPath = resolve(ROOT, ".data/survival.db");
  if (!existsSync(dbPath)) return [];
  try {
    const c = new Database(dbPath, { readonly: true });
    const rows = c.prepare(`SELECT * FROM opportunities WHERE state_changed_at > datetime('now', '-' || ? || ' minutes') AND state IN ('in_progress', 'researched') ORDER BY state_changed_at DESC LIMIT 10`).all(sinceMinutes);
    c.close();
    return rows.map(r => ({
      source: "opp-transition",
      source_ref: r.id,
      title: r.title,
      body: (r.seed_text || r.notes || "").slice(0, 400),
      ts: new Date(r.state_changed_at).getTime(),
      linked_opp_id: r.id,
      audience: r.target_icp || "general",
    }));
  } catch (e) {
    console.error("[signal-hooks] opp read failed:", e.message);
    return [];
  }
}

// ─── 4. Proactive thoughts marked post-worthy ───────────────────────────
function readProactiveSignals({ sinceMinutes = 1440 } = {}) {
  const path = resolve(ROOT, ".data/tolik-thoughts.jsonl");
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
  const cutoff = Date.now() - sinceMinutes * 60000;
  const out = [];
  for (const line of lines.slice(-100)) {
    try {
      const t = JSON.parse(line);
      const ts = new Date(t.ts).getTime();
      if (ts < cutoff) continue;
      if (t.kind === "recommendation" || t.kind === "observation") {
        out.push({
          source: "proactive",
          source_ref: t.ts,
          title: (t.spoken || t.text || "").slice(0, 120),
          body: (t.spoken || t.text || "").slice(0, 400),
          ts,
        });
      }
    } catch {}
  }
  return out;
}

// ─── Decision logic ─────────────────────────────────────────────────────
export function shouldMakeVisual(signal) {
  // Don't post the same idea twice
  const recent = listRecentAssets({ days: 14 });
  const dup = recent.find(r => {
    const t = (r.idea_text || "").toLowerCase();
    const s = (signal.title || "").toLowerCase();
    return t.length > 20 && (t.includes(s.slice(0, 30)) || s.includes(t.slice(0, 30)));
  });
  if (dup) return { ok: false, reason: "duplicate_idea", existing: dup.id };

  // Need at least a meaningful title
  if (!signal.title || signal.title.length < 12) return { ok: false, reason: "title_too_short" };
  if (signal.title.length > 240) return { ok: false, reason: "title_too_long" };

  // Filter forbidden topics per memory rules
  const banned = /\b(voice\s*agent|missed\s*call|guaranteed|money\s*back)\b/i;
  if (banned.test(signal.title) || banned.test(signal.body || "")) {
    return { ok: false, reason: "banned_topic", phrase: signal.title.match(banned)?.[0] };
  }

  return { ok: true };
}

// ─── Top-level scan ─────────────────────────────────────────────────────
export function findSignals({ sinceMinutes = 1440 } = {}) {
  const all = [
    ...readAwarenessSignals({ sinceMinutes }),
    ...readScoutSignals({ sinceMinutes: sinceMinutes * 3 }),  // scout slower
    ...readOpportunitySignals({ sinceMinutes: sinceMinutes * 3 }),
    ...readProactiveSignals({ sinceMinutes }),
  ];
  // Dedup by title prefix
  const seen = new Set();
  const uniq = [];
  for (const s of all) {
    const key = (s.title || "").slice(0, 40).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniq.push(s);
  }
  // Decision filter
  return uniq.map(s => ({ ...s, decision: shouldMakeVisual(s) })).sort((a, b) => b.ts - a.ts);
}

// ─── Spawn ──────────────────────────────────────────────────────────────
export async function spawnVisualForSignal(signal) {
  if (process.env.SIGNAL_HOOKS_AUTO !== "1") {
    return { ok: false, reason: "auto_disabled", hint: "set SIGNAL_HOOKS_AUTO=1 to enable" };
  }
  // Lazy import — visual-orchestrator will be built in Round 3
  try {
    const { runVisualAgent } = await import("./visual-agent.mjs");
    return await runVisualAgent({
      idea: signal.title,
      context: signal.body,
      slug: undefined, // visual-agent generates
    });
  } catch (e) {
    return { ok: false, reason: "spawn_failed", error: e.message };
  }
}

// CLI: `node signal-hooks.mjs scan [minutes]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2] || "scan";
  const mins = parseInt(process.argv[3] || "1440");
  if (cmd === "scan") {
    const signals = findSignals({ sinceMinutes: mins });
    console.log(`Found ${signals.length} unique signals in last ${mins}min:\n`);
    for (const s of signals.slice(0, 15)) {
      const verdict = s.decision.ok ? "✓ POST" : `✗ skip (${s.decision.reason})`;
      console.log(`[${s.source}] ${verdict}`);
      console.log(`  title: ${s.title.slice(0, 100)}`);
      if (s.body) console.log(`  body:  ${s.body.slice(0, 100)}`);
      console.log("");
    }
  } else if (cmd === "run") {
    const signals = findSignals({ sinceMinutes: mins }).filter(s => s.decision.ok);
    console.log(`Spawning visual-agent for ${signals.length} eligible signals…`);
    for (const s of signals) {
      const r = await spawnVisualForSignal(s);
      console.log(`  ${s.title.slice(0, 60)}: ${r.ok ? "OK " + r.slug : "FAIL " + r.reason}`);
    }
  } else {
    console.error("Usage: signal-hooks.mjs scan [minutes] | run [minutes]");
    process.exit(2);
  }
}
