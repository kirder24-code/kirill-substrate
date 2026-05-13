/**
 * scripts/tolik/brief-tts.mjs
 *
 * One-shot TTS rendering of the morning brief into an MP3 file Tolik can
 * play when Kirill opens the window. ElevenLabs multilingual_v2 + Antoni
 * voice (same as the live voice answers). Best-effort: if creds are missing
 * the dashboard still has the text version.
 */

import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sayTTS } from "./say-tts.mjs";
import { openaiTTS } from "./openai-tts.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");
const TOLIK_VOICE_ID_DEFAULT = "ErXwobaYiNCSkVz6JfRP"; // Antoni

function envMap() {
  if (!existsSync(ENV_PATH)) return {};
  return Object.fromEntries(
    readFileSync(ENV_PATH, "utf-8").split("\n")
      .filter(l => l && !l.startsWith("#") && l.includes("="))
      .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
  );
}

async function generate(text, outPath, opts = {}) {
  // Morning brief uses the higher-quality (slower) gpt-4o-mini-tts model
  // since it renders once a day - quality matters more than latency here.
  const openai = await openaiTTS(text, { model: "gpt-4o-mini-tts" });
  if (openai.ok) {
    writeFileSync(outPath, Buffer.from(openai.audio_b64, "base64"));
    return { ok: true, output: outPath, bytes: openai.bytes, engine: "openai_tts", voice: openai.voice };
  }
  const env = envMap();
  const key = env.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY;
  const vId = opts.voiceId || env.ELEVENLABS_VOICE_ID || process.env.ELEVENLABS_VOICE_ID || TOLIK_VOICE_ID_DEFAULT;
  if (!key) {
    const language = /[Ѐ-ӿ]/.test(text) ? "russian" : "english";
    const fb = await sayTTS(text, language);
    if (fb.ok) {
      writeFileSync(outPath, Buffer.from(fb.audio_b64, "base64"));
      return { ok: true, output: outPath, bytes: fb.bytes, engine: "macos_say", voice: fb.voice };
    }
    return { ok: false, reason: "all_tts_failed", openai_error: openai.reason, fallback_error: fb.reason };
  }
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vId}`, {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.52, similarity_boost: 0.78, style: 0.18, use_speaker_boost: true },
      }),
    });
    if (!r.ok) return { ok: false, reason: "tts_http_" + r.status, body: await r.text() };
    const buf = Buffer.from(await r.arrayBuffer());
    writeFileSync(outPath, buf);
    return { ok: true, output: outPath, bytes: buf.length };
  } catch (e) { return { ok: false, reason: "tts_threw", error: e.message }; }
}

export default { generate };
