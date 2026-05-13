/**
 * scripts/tolik/say-tts.mjs
 *
 * Free fallback TTS using macOS built-in `say` command. Picks a voice
 * based on detected language (Russian → Milena, English → a clean male
 * default), renders to AIFF, transcodes to MP3 via ffmpeg, returns
 * base64 audio identical in shape to the ElevenLabs response.
 *
 * Used by voice-bridge.mjs when ELEVENLABS_API_KEY is missing or the
 * ElevenLabs call fails. Sound quality is robotic but the full
 * voice pipeline (STT → Claude → TTS → playback) runs end-to-end at $0.
 *
 * Requires: ffmpeg (already in /opt/homebrew/bin).
 */

import { execFile } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import crypto from "node:crypto";
import { promisify } from "node:util";

const exec = promisify(execFile);

// Best-available macOS voices for "neutral pleasant male" feel.
// English: Daniel (UK male) and Alex (US male, more natural) are top picks.
// Russian: only Milena is shipped by Apple — female, but clear and warm.
// User can override per-language via env: TOLIK_SAY_VOICE_RU, TOLIK_SAY_VOICE_EN.
const VOICE_MAP = {
  russian: process.env.TOLIK_SAY_VOICE_RU || "Milena",
  english: process.env.TOLIK_SAY_VOICE_EN || "Daniel",
};

function pickVoice(language) {
  const lang = (language || "english").toLowerCase();
  if (lang.startsWith("rus")) return VOICE_MAP.russian;
  return VOICE_MAP.english;
}

export async function sayTTS(text, language = "english") {
  if (!text || !text.trim()) return { ok: false, reason: "empty_text" };
  const voice = pickVoice(language);
  const stamp = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const aiff = resolve(tmpdir(), `tolik-say-${stamp}.aiff`);
  const mp3  = resolve(tmpdir(), `tolik-say-${stamp}.mp3`);
  try {
    // Pace down slightly. macOS default ~200wpm; 170 is calmer.
    await exec("say", ["-v", voice, "-r", "175", "-o", aiff, text], { maxBuffer: 8 * 1024 * 1024 });
    // Transcode to MP3 to match browser <audio> playback expected mime.
    await exec("ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-codec:a", "libmp3lame", "-qscale:a", "4", mp3]);
    const buf = readFileSync(mp3);
    return {
      ok: true,
      audio_b64: buf.toString("base64"),
      mime: "audio/mpeg",
      voice,
      engine: "macos_say",
      bytes: buf.length,
    };
  } catch (e) {
    return { ok: false, reason: "say_or_ffmpeg_threw", error: e.message };
  } finally {
    try { unlinkSync(aiff); } catch {}
    try { unlinkSync(mp3); } catch {}
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = process.argv.slice(2).join(" ") || "Привет Кирилл, я готов";
  const lang = /[Ѐ-ӿ]/.test(text) ? "russian" : "english";
  const r = await sayTTS(text, lang);
  console.log(JSON.stringify({ ...r, audio_b64: r.audio_b64 ? `<${r.bytes} bytes>` : null }, null, 2));
}
