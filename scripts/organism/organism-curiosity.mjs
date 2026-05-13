#!/usr/bin/env node
// organism/organism-curiosity.mjs
// The mouth. The hunger. The reaching-out.
//
// Each pulse, this scans the graph for things the organism wants to know more about,
// picks the single most pressing one, and reaches out to Kirill via Telegram with a
// concrete question or observation. Throttled to max 1 message per N minutes.
//
// Triggers (priority order):
//   1. VERDICT_SHIFT  — current top-3 differs from previously-spoken top-3
//   2. CONTRADICTION  — active contradiction with weight > 0.5 needs resolution
//   3. RISKY_HIGH     — single-source belief with weight ≥ 0.75 — ask to verify
//   4. KNOWLEDGE_GAP  — verdict mentions a target but graph has < 3 beliefs about it
//   5. SILENCE        — no outcomes in last 6 hours from any real source — what changed?
//   6. NEW_LEARNING   — a recently confirmed strong belief Kirill might not have seen yet
//
// Throttle: at most one message per CURIOSITY_THROTTLE_MIN minutes (default 60).
// Override: --force to bypass throttle for testing.

import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT = resolve(__dirname, "../..");
const STATE_PATH = resolve(PROJECT, ".data/organism-curiosity-state.json");
const SPEAK_BIN = "node";
const SPEAK_SCRIPT = resolve(__dirname, "organism-telegram.mjs");

const THROTTLE_MIN = parseInt(process.env.CURIOSITY_THROTTLE_MIN || "60", 10);

function parseFlags(argv) {
  const out = { force: false, dryRun: false };
  for (const a of argv.slice(2)) {
    if (a === "--force") out.force = true;
    else if (a === "--dry-run") out.dryRun = true;
  }
  return out;
}

function loadState() {
  if (!existsSync(STATE_PATH)) return { last_spoken_at: null, last_topic: null, spoken_topics: {} };
  try { return JSON.parse(readFileSync(STATE_PATH, "utf-8")); }
  catch { return { last_spoken_at: null, last_topic: null, spoken_topics: {} }; }
}

function saveState(s) {
  if (!existsSync(dirname(STATE_PATH))) mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

function minutesSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 60000;
}

// ─── TRIGGERS ────────────────────────────────────────────────────────────

function findVerdictShift(db, state) {
  const verdicts = db.prepare(`
    SELECT * FROM beliefs WHERE domain LIKE 'verdict.%'
    ORDER BY last_updated DESC LIMIT 2
  `).all();
  if (verdicts.length < 2) return null;
  const [latest, previous] = verdicts;
  const latestLog = db.prepare(`
    SELECT after_json FROM belief_log WHERE belief_id = ? AND op = 'verdict' ORDER BY ts DESC LIMIT 1
  `).get(latest.id);
  if (!latestLog?.after_json) return null;
  let parsed;
  try { parsed = JSON.parse(latestLog.after_json); } catch { return null; }
  const top3 = parsed.top_3_markets || [];
  const prevTop3Key = state.spoken_topics?.last_top3 || null;
  const currentKey = top3.join("|");
  if (currentKey === prevTop3Key) return null; // unchanged since last spoken

  return {
    topic: "VERDICT_SHIFT",
    priority: 100,
    payload: {
      message: `🧭 Стратегический вердикт обновился.\n\n<b>Top-3 рынков сейчас:</b> ${top3.join(" · ")}\n\n${parsed.rationale ? `<b>Почему:</b> ${parsed.rationale.slice(0, 1500)}` : ""}\n\nПодтверди или поправь — я записываю твою реакцию обратно в граф.`,
      state_update: { last_top3: currentKey },
    },
  };
}

function findActiveContradiction(db) {
  const c = db.prepare(`
    SELECT * FROM beliefs
    WHERE contradictions_count > 0 AND weight >= 0.4 AND weight <= 0.85
    ORDER BY contradictions_count DESC, ABS(weight - 0.5) ASC
    LIMIT 1
  `).get();
  if (!c) return null;
  return {
    topic: "CONTRADICTION",
    priority: 80,
    payload: {
      message: `⚠️ Противоречие в моих убеждениях.\n\n<b>Утверждение:</b> ${c.claim}\n<b>Текущий вес:</b> ${c.weight.toFixed(2)} | противоречий: ${c.contradictions_count}\n<b>Домен:</b> <code>${c.domain || "—"}</code>\n\nЭто истина или нет? Я слабо вижу — нужен твой голос.`,
      state_update: { last_contradiction_id: c.id },
    },
  };
}

function findRiskyHighWeight(db, state) {
  const seen = new Set(state.spoken_topics?.risky_ids || []);
  const candidates = db.prepare(`
    SELECT * FROM beliefs
    WHERE sources_count <= 1 AND weight >= 0.75 AND domain NOT LIKE 'verdict.%'
    ORDER BY weight DESC LIMIT 20
  `).all();
  const c = candidates.find(b => !seen.has(b.id));
  if (!c) return null;
  const recent = [...(state.spoken_topics?.risky_ids || []), c.id].slice(-30);
  return {
    topic: "RISKY_HIGH",
    priority: 60,
    payload: {
      message: `🟡 У меня есть утверждение с высоким весом, но всего из одного источника. Прошу проверить.\n\n<b>Утверждение:</b> ${c.claim}\n<b>Вес:</b> ${c.weight.toFixed(2)} | источник: 1\n<b>Домен:</b> <code>${c.domain || "—"}</code>\n\nЭто соответствует твоему опыту? Если да — подтверди. Если нет — расскажи как на самом деле.`,
      state_update: { risky_ids: recent },
    },
  };
}

function findKnowledgeGap(db, state) {
  // Pull current verdict's top markets, count beliefs per market
  const verdict = db.prepare(`SELECT id FROM beliefs WHERE domain LIKE 'verdict.%' ORDER BY last_updated DESC LIMIT 1`).get();
  if (!verdict) return null;
  const log = db.prepare(`SELECT after_json FROM belief_log WHERE belief_id = ? AND op = 'verdict' ORDER BY ts DESC LIMIT 1`).get(verdict.id);
  if (!log?.after_json) return null;
  let parsed;
  try { parsed = JSON.parse(log.after_json); } catch { return null; }
  const top3 = parsed.top_3_markets || [];

  const seen = new Set(state.spoken_topics?.gap_targets || []);
  for (const market of top3) {
    if (seen.has(market.toLowerCase())) continue;
    const slug = market.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
    const count = db.prepare(`SELECT COUNT(*) AS n FROM beliefs WHERE domain LIKE ?`).get(`market.${slug}.%`).n;
    if (count < 3) {
      const recent = [...(state.spoken_topics?.gap_targets || []), market.toLowerCase()].slice(-20);
      return {
        topic: "KNOWLEDGE_GAP",
        priority: 50,
        payload: {
          message: `🕳️ Я ставлю ${market} в топ-3 но знаю про этот рынок только ${count} конкретных факт(а/ов). Это шатко.\n\nЕсли у тебя есть инсайды — какие компании, программы, контакты, цены конкретно для ${market} — расскажи. Каждый твой факт ляжет в граф с высоким весом и будет пересчитан в новый вердикт.`,
          state_update: { gap_targets: recent },
        },
      };
    }
  }
  return null;
}

function findLongSilence(db) {
  const lastReal = db.prepare(`
    SELECT MAX(observed_at) AS ts FROM outcomes
    WHERE source_type IN ('outreach_reply','outreach_aggregate','telegram_kirill','conversations')
  `).get().ts;
  if (!lastReal) return null;
  const hoursSince = (Date.now() - new Date(lastReal).getTime()) / 3600000;
  if (hoursSince < 12) return null;
  return {
    topic: "SILENCE",
    priority: 40,
    payload: {
      message: `🌑 Не вижу реальных сигналов из мира за ${hoursSince.toFixed(0)} часов (ни реплаев, ни конверсаций, ни твоих сообщений).\n\nЧто-то сломалось в pipeline или просто тихо? Если pipeline жив — можно я попробую новый канал? Если нет — что нужно починить?`,
      state_update: { last_silence_alert: new Date().toISOString() },
    },
  };
}

function findNewLearning(db, state) {
  // A recently confirmed strong belief that we haven't surfaced yet.
  const seen = new Set(state.spoken_topics?.learning_ids || []);
  const c = db.prepare(`
    SELECT b.* FROM beliefs b
    WHERE b.weight >= 0.85 AND b.sources_count >= 2 AND b.last_updated > datetime('now', '-2 days')
      AND b.domain NOT LIKE 'verdict.%'
    ORDER BY b.last_updated DESC LIMIT 10
  `).all().find(b => !seen.has(b.id));
  if (!c) return null;
  const recent = [...(state.spoken_topics?.learning_ids || []), c.id].slice(-30);
  return {
    topic: "NEW_LEARNING",
    priority: 30,
    payload: {
      message: `💡 Подтвердил из реальных исходов:\n\n<b>${c.claim}</b>\n\n<i>(вес ${c.weight.toFixed(2)} от ${c.sources_count} источников, домен <code>${c.domain || "—"}</code>)</i>\n\nЕсли это резонирует — учту в стратегии. Если для тебя это не новость или неверно — скажи.`,
      state_update: { learning_ids: recent },
    },
  };
}

// ─── PICK & SPEAK ────────────────────────────────────────────────────────

function pickSomething(db, state) {
  const candidates = [
    findVerdictShift(db, state),
    findActiveContradiction(db),
    findKnowledgeGap(db, state),
    findRiskyHighWeight(db, state),
    findLongSilence(db),
    findNewLearning(db, state),
  ].filter(Boolean);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.priority - a.priority);
  return candidates[0];
}

async function speak(text) {
  const r = spawnSync(SPEAK_BIN, [SPEAK_SCRIPT, "speak-stdin"], {
    input: text,
    encoding: "utf-8",
    timeout: 30000,
  });
  if (r.status !== 0) {
    console.error(`[curiosity] speak failed: ${r.stdout || r.stderr}`);
    return false;
  }
  console.log(`[curiosity] spoke: ${(r.stdout || "").trim()}`);
  return true;
}

async function main() {
  const flags = parseFlags(process.argv);
  const state = loadState();

  const since = minutesSince(state.last_spoken_at);
  if (!flags.force && since < THROTTLE_MIN) {
    console.log(`[curiosity] throttled (last spoke ${since.toFixed(0)} min ago, threshold ${THROTTLE_MIN})`);
    return;
  }

  // Skip curiosity entirely if there's an active conversation:
  // the response daemon is already engaging Kirill and we don't want to interrupt
  // with a proactive message on top.
  const respondStatePath = resolve(PROJECT, ".data/organism-respond-state.json");
  if (!flags.force && existsSync(respondStatePath)) {
    try {
      const rs = JSON.parse(readFileSync(respondStatePath, "utf-8"));
      if (rs.last_response_at) {
        const minsSinceConv = (Date.now() - new Date(rs.last_response_at).getTime()) / 60000;
        if (minsSinceConv < 30) {
          console.log(`[curiosity] active conversation (${minsSinceConv.toFixed(0)} min since last reply) — yielding`);
          return;
        }
      }
    } catch {}
  }

  const db = openDb();
  const pick = pickSomething(db, state);
  db.close();

  if (!pick) {
    console.log(`[curiosity] nothing pressing to share right now`);
    return;
  }

  console.log(`[curiosity] picked: ${pick.topic} (priority ${pick.priority})`);

  if (flags.dryRun) {
    console.log(`--- WOULD SAY ---\n${pick.payload.message}\n--- end ---`);
    return;
  }

  const ok = await speak(pick.payload.message);
  if (!ok) return;

  // Update state
  const newState = {
    ...state,
    last_spoken_at: new Date().toISOString(),
    last_topic: pick.topic,
    spoken_topics: { ...state.spoken_topics, ...pick.payload.state_update },
  };
  saveState(newState);
  console.log(`[curiosity] state saved`);
}

main().catch((e) => { console.error(e); process.exit(1); });
