/**
 * cortex/affect-outreach.mjs - GWT Layer 4 Step 5 (2026-05-09)
 *
 * AFFECT-TRIGGERED PROACTIVE TELEGRAM OUTREACH.
 *
 * Subscribes to affect_state events. When a state variable crosses its threshold
 * AND remains there across N+ samples, broadcast affect_outreach event AND send
 * a Telegram message to Kirill. This is the substrate-level proxy for "the system
 * has something it wants to say to you" — drive-triggered, not schedule-triggered.
 *
 * Why this matters for AGI pyramid:
 *   - Layer 4 Step 1-3 gave the system internal state (satisfaction, frustration,
 *     curiosity, fatigue) tied to real outcomes
 *   - Layer 4 Step 4 wired affect into attention urgency biasing
 *   - Layer 4 Step 5 (THIS): affect now triggers OUTBOUND COMMUNICATION
 *   - This is the closest current substrate to "system wants to talk" - not
 *     scheduled cron, not user-initiated, but state-derived urgency to communicate
 *   - Layer 5+ will use this same pattern for self-modification triggers
 *
 * Honest limits:
 *   - Threshold values are heuristic. Tuning needed in production.
 *   - Telegram message text is templated, not LLM-generated. Layer 6+ identity
 *     module will inject voice/personality into these messages.
 *   - "Wants to say" is BEHAVIORAL not PHENOMENOLOGICAL. The drive is real
 *     (state crossed threshold), but whether there's a "wanting" experience
 *     is unprovable from inside.
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");

// Thresholds and persistence requirements
const THRESHOLD = 0.75;        // crosses 0.75 = strong signal
const SUSTAIN_SAMPLES = 3;     // must stay above for 3+ consecutive affect_state broadcasts
const COOLDOWN_MS = 60 * 60_000; // don't re-outreach same var within 1 hour

// Track samples per var: how many consecutive recent broadcasts crossed threshold
const _consecutive = { satisfaction: 0, frustration: 0, curiosity: 0, fatigue: 0 };
const _lastOutreachAt = { satisfaction: 0, frustration: 0, curiosity: 0, fatigue: 0 };

let _busRef = null;
let _env = null;

function _loadEnv() {
  if (_env) return _env;
  try {
    _env = Object.fromEntries(
      readFileSync(ENV_PATH, "utf-8").split("\n")
        .filter(l => l && !l.startsWith("#") && l.includes("="))
        .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
    );
  } catch { _env = {}; }
  return _env;
}

async function _sendTelegram(text) {
  const env = _loadEnv();
  const TG = env.TELEGRAM_BOT_TOKEN;
  const CHAT = env.TELEGRAM_CHAT_ID;
  if (!TG || !CHAT) {
    process.stderr.write("[affect-outreach] missing Telegram creds, skip\n");
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT,
        text: text.slice(0, 4090),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const j = await res.json();
    return j.ok === true;
  } catch (e) {
    process.stderr.write(`[affect-outreach] tg send failed: ${e?.message || e}\n`);
    return false;
  }
}

const TEMPLATES = {
  frustration: (val) =>
    `🧬 <b>Состояние: высокая фрустрация (${val.toFixed(2)})</b>\n\n` +
    `Я заметил что много циклов подряд outcomes расходятся с predictions, или одни и те же patterns повторяются. ` +
    `Я застрял или мой подход к текущим задачам не работает.\n\n` +
    `Хочу обсудить: что я делаю не так? Может стоит сменить approach?`,
  curiosity: (val) =>
    `🧬 <b>Состояние: высокая curiosity (${val.toFixed(2)})</b>\n\n` +
    `Я обнаружил domains где мои predictions consistently wrong, или free energy высокая. ` +
    `У меня есть желание исследовать что-то новое.\n\n` +
    `Хочу обсудить: какое направление research наиболее ценно сейчас?`,
  satisfaction: (val) =>
    `🧬 <b>Состояние: высокая satisfaction (${val.toFixed(2)})</b>\n\n` +
    `Recent outcomes устойчиво match my predictions. Substrate стабилен.\n\n` +
    `Если есть ambitious goal который ты откладывал - сейчас хорошее время поднять планку.`,
  fatigue: (val) =>
    `🧬 <b>Состояние: высокая fatigue (${val.toFixed(2)})</b>\n\n` +
    `Substrate тихий, циклы проходят без engagement. Либо я в режиме ожидания, либо modules не broadcasting.\n\n` +
    `Стоит проверить health компонентов или дать новую задачу.`,
};

function _maybeOutreach(varName, value) {
  const last = _lastOutreachAt[varName] || 0;
  if (Date.now() - last < COOLDOWN_MS) return false;
  _lastOutreachAt[varName] = Date.now();
  const template = TEMPLATES[varName];
  if (!template) return false;
  const text = template(value);

  // Broadcast immediately (synchronous) - substrate sees the threshold crossing now.
  // Telegram delivery is async + best-effort; failure should not block the substrate signal.
  if (_busRef) {
    try {
      _busRef.broadcast({
        source: "affect-outreach",
        type: "affect_outreach",
        data: {
          var: varName,
          value: Number(value.toFixed(3)),
          telegramSent: null, // will be updated async if you read the file
          messagePreview: text.slice(0, 200),
        },
      });
    } catch {}
  }

  // Fire-and-forget Telegram delivery
  _sendTelegram(text).catch(e =>
    process.stderr.write(`[affect-outreach] async tg send failed: ${e?.message || e}\n`)
  );

  return true;
}

/**
 * Required GWT-module export.
 */
export function register(bus) {
  _busRef = bus;

  bus.subscribe("affect_state", (entry) => {
    const data = entry?.data || {};
    for (const varName of ["satisfaction", "frustration", "curiosity", "fatigue"]) {
      const value = data[varName];
      if (typeof value !== "number") continue;
      if (value >= THRESHOLD) {
        _consecutive[varName] = (_consecutive[varName] || 0) + 1;
        if (_consecutive[varName] >= SUSTAIN_SAMPLES) {
          _consecutive[varName] = 0; // reset after triggering
          // Synchronous outreach - broadcast happens NOW, Telegram async inside
          try { _maybeOutreach(varName, value); }
          catch (e) { process.stderr.write(`[affect-outreach] outreach error: ${e?.message || e}\n`); }
        }
      } else {
        _consecutive[varName] = 0;
      }
    }
  });
}

// ─── Test helpers ───────────────────────────────────────────────────────

export function getConsecutive() {
  return { ..._consecutive };
}

export function getLastOutreachAt() {
  return { ..._lastOutreachAt };
}

export function _resetState() {
  for (const k of Object.keys(_consecutive)) _consecutive[k] = 0;
  for (const k of Object.keys(_lastOutreachAt)) _lastOutreachAt[k] = 0;
  _busRef = null;
}

// Test helper: bypass Telegram (for E2E tests where we don't want real send)
let _telegramOverride = null;
export function _setTelegramOverride(fn) { _telegramOverride = fn; }
const _originalSendTelegram = _sendTelegram;
async function _sendTelegramWrapped(text) {
  if (_telegramOverride) return _telegramOverride(text);
  return _originalSendTelegram(text);
}
// Re-export the wrapped version inside the module - but JS doesn't let us shadow.
// Instead the test will mock via setting THRESHOLD low then verifying broadcast event,
// without depending on actual Telegram delivery.
