/**
 * scripts/tolik/openai-tts.mjs
 *
 * Tolik's primary voice when OPENAI_API_KEY is set. Uses OpenAI's
 * gpt-4o-mini-tts (or tts-1) with the `onyx` voice - a deep, natural
 * male voice that speaks Russian and English with human quality.
 *
 * Pricing (as of 2026):
 *   tts-1:      $0.015 per 1K chars (~$0.015/min spoken)
 *   gpt-4o-mini-tts: $0.015 per 1K chars (~equiv quality, newer)
 *
 * A 300-character response ≈ $0.0045 per voice reply. Cheap.
 *
 * Falls through to ElevenLabs/say if call fails.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");

function envMap() {
  if (!existsSync(ENV_PATH)) return {};
  return Object.fromEntries(
    readFileSync(ENV_PATH, "utf-8").split("\n")
      .filter(l => l && !l.startsWith("#") && l.includes("="))
      .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
  );
}

// Voice options that handle Russian well:
//   ash    — newest male, very natural, conversational (Tolik default)
//   onyx   — deepest male, calm, authoritative
//   echo   — softer male, more conversational
//   sage   — newer warm/neutral male
// All support Russian via OpenAI's multilingual model.
const TOLIK_VOICE_DEFAULT = process.env.TOLIK_OPENAI_VOICE || "ash";

export async function openaiTTS(text, opts = {}) {
  const env = envMap();
  const key = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, reason: "no_openai_key" };
  if (!text || !text.trim()) return { ok: false, reason: "empty_text" };

  const voice = opts.voice || TOLIK_VOICE_DEFAULT;
  // tts-1 is the fastest OpenAI TTS (~600ms for short text).
  // gpt-4o-mini-tts is more natural but ~2x slower and not needed for the
  // realtime voice path. Use that one only for morning brief (longer audio,
  // latency does not matter).
  const model = opts.model || "tts-1";
  const speed = opts.speed ?? 1.0;
  const instructions = opts.instructions || "Speak in a calm, warm, confident, natural male voice. Tolik talking to his friend Kirill - no hype, no broadcast tone, just plain conversation.";

  try {
    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        voice,
        input: text.slice(0, 4000),
        response_format: "mp3",
        speed,
        ...(model === "gpt-4o-mini-tts" ? { instructions } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) {
      const body = await r.text();
      return { ok: false, reason: "openai_tts_http_" + r.status, body };
    }
    const buf = Buffer.from(await r.arrayBuffer());
    return {
      ok: true,
      audio_b64: buf.toString("base64"),
      mime: "audio/mpeg",
      voice,
      engine: "openai_tts",
      bytes: buf.length,
    };
  } catch (e) { return { ok: false, reason: "openai_tts_threw", error: e.message }; }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = process.argv.slice(2).join(" ") || "Привет Кирилл, я Толик. Слушаю тебя";
  const r = await openaiTTS(text);
  console.log(JSON.stringify({ ...r, audio_b64: r.audio_b64 ? `<${r.bytes} bytes>` : null }, null, 2));
  if (r.ok) {
    // Save to /tmp for quick playback test
    const path = "/tmp/tolik-onyx-test.mp3";
    const fs = await import("node:fs");
    fs.writeFileSync(path, Buffer.from(r.audio_b64, "base64"));
    console.log("saved:", path);
    console.log("play with: afplay " + path);
  }
}
