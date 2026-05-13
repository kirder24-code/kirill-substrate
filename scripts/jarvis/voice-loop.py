#!/usr/bin/env python3
"""
scripts/jarvis/voice-loop.py

Port of Chi Chen's Jarvis voice_loop (core/voice_loop.py), adapted to Tolik.
Vosk offline wake-word "Толик" → record until silence → STT → POST to
webhook-server. Backend decides what to do based on current mode (code vs
brain).

Vosk runs entirely locally — no internet, no Google STT round-trip. The
trade-off is recognition quality vs cloud STT, but for the wake-word + short
commands it's plenty.

Models:
  scripts/jarvis/models/ru-small  — Russian (default for Tolik)
  scripts/jarvis/models/en-small  — English fallback

Env vars:
  TOLIK_VOSK_LANG    "ru" | "en"  (default ru)
  TOLIK_WAKE_WORDS   Comma-separated wake words to match in partial
                      transcript. Default: "толик,tolik,jarvis"
  TOLIK_WEBHOOK_URL  Default http://127.0.0.1:4789
  TOLIK_VOICE_ENDPOINT  default /api/tolik/voice-command
"""

import os
import sys
import json
import time
import wave
from pathlib import Path

import numpy as np
import sounddevice as sd
import requests

# Suppress Vosk logs
os.environ["VOSK_LOG_LEVEL"] = "-1"
from vosk import Model, KaldiRecognizer, SetLogLevel
SetLogLevel(-1)

SAMPLE_RATE = 16000
BLOCK_SIZE = 4000  # ~250ms

LANG = os.getenv("TOLIK_VOSK_LANG", "ru")
WAKE_WORDS = [w.strip().lower() for w in os.getenv("TOLIK_WAKE_WORDS", "толик,tolik,jarvis").split(",")]
WEBHOOK = os.getenv("TOLIK_WEBHOOK_URL", "http://127.0.0.1:4789")
VOICE_ENDPOINT = os.getenv("TOLIK_VOICE_ENDPOINT", "/api/tolik/voice-command")

MODELS_DIR = Path(__file__).parent / "models"
MODEL_PATH = MODELS_DIR / ("ru-small" if LANG == "ru" else "en-small")
PID_FILE = Path(__file__).parents[2] / ".data" / "tolik-voice-loop.pid"
# Shared mute flag — set while playing TTS so snap-listener and our own
# wake-word loop both ignore audio that's actually Tolik's own voice through
# the speakers.
MUTE_FLAG = Path(__file__).parents[2] / ".data" / "tolik-tts-playing.flag"

SILENCE_THRESHOLD = 0.012   # RMS below which we consider silence
SILENCE_DURATION = 1.2       # seconds of silence ends recording
MAX_RECORDING = 20           # cap, seconds
PRE_ROLL_BLOCKS = 4          # ignore first N blocks after wake (mic settling)


def write_pid():
    PID_FILE.parent.mkdir(parents=True, exist_ok=True)
    PID_FILE.write_text(str(os.getpid()))


def play_beep():
    """Tink.aiff confirmation beep via macOS afplay."""
    import subprocess
    subprocess.Popen(["afplay", "/System/Library/Sounds/Tink.aiff"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def record_until_silence(stream, max_blocks=int(MAX_RECORDING * SAMPLE_RATE / BLOCK_SIZE)):
    """Read from open stream until trailing silence. Returns bytes (PCM16)."""
    audio_bytes = bytearray()
    silent_blocks = 0
    silent_block_target = int(SILENCE_DURATION * SAMPLE_RATE / BLOCK_SIZE)
    blocks_read = 0
    speech_seen = False

    while blocks_read < max_blocks:
        chunk, _ = stream.read(BLOCK_SIZE)
        audio_bytes.extend(chunk.tobytes())
        blocks_read += 1
        # RMS on int16
        arr = np.frombuffer(chunk.tobytes(), dtype=np.int16).astype(np.float32) / 32768.0
        rms = float(np.sqrt(np.mean(arr ** 2)))
        if rms > SILENCE_THRESHOLD:
            speech_seen = True
            silent_blocks = 0
        else:
            silent_blocks += 1
        if speech_seen and silent_blocks >= silent_block_target:
            break
    return bytes(audio_bytes)


def transcribe(audio_bytes, model):
    """Full-utterance Vosk transcription on captured PCM16."""
    rec = KaldiRecognizer(model, SAMPLE_RATE)
    rec.SetWords(True)
    rec.AcceptWaveform(audio_bytes)
    final = json.loads(rec.FinalResult())
    return final.get("text", "").strip()


def set_muted(active):
    """Touch/remove the mute flag so snap-listener + this loop skip mic during TTS."""
    try:
        if active:
            MUTE_FLAG.parent.mkdir(parents=True, exist_ok=True)
            MUTE_FLAG.touch()
        else:
            MUTE_FLAG.unlink(missing_ok=True)
    except Exception:
        pass


def play_audio_b64(audio_b64, mime="audio/mpeg"):
    """Decode base64 audio and play via macOS afplay. Sets mute flag during
    playback so snap-listener and our wake-loop ignore Tolik's own voice."""
    import base64
    import tempfile
    import subprocess
    try:
        data = base64.b64decode(audio_b64)
        ext = "mp3"
        if "wav" in mime: ext = "wav"
        elif "ogg" in mime: ext = "ogg"
        with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as f:
            f.write(data)
            path = f.name
        set_muted(True)
        try:
            # afplay blocks — Tolik finishes before we listen for next command
            subprocess.run(["afplay", path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        finally:
            set_muted(False)
        try: os.unlink(path)
        except Exception: pass
        return True
    except Exception as e:
        set_muted(False)
        print(f"[voice-loop] audio playback failed: {e}", flush=True)
        return False


def send_to_backend(text):
    """POST the transcript to webhook-server. Backend routes to mode and
    returns text + (in brain mode) audio_b64. We play the audio."""
    if not text:
        print("[voice-loop] empty transcript, skipping send")
        return None
    try:
        r = requests.post(
            f"{WEBHOOK}{VOICE_ENDPOINT}",
            json={"text": text, "ts": time.time(), "source": "vosk-jarvis-bridge"},
            timeout=120,  # /api/voice/ask can take 5-15s for LLM + TTS
        )
        try:
            data = r.json()
        except Exception:
            data = {"raw": r.text[:300]}

        # Print summary (skip audio_b64 which is huge)
        summary = {k: v for k, v in data.items() if k not in ("audio_b64",)}
        if data.get("audio_b64"):
            summary["audio_bytes"] = len(data["audio_b64"])
        print(f"[voice-loop] backend → {r.status_code}: {json.dumps(summary)[:300]}", flush=True)

        # Play audio if backend returned it (brain mode)
        if data.get("audio_b64"):
            print(f"[voice-loop] playing TTS reply ({len(data['audio_b64'])} bytes)…", flush=True)
            play_audio_b64(data["audio_b64"], data.get("mime", "audio/mpeg"))
        elif data.get("spoken"):
            # Mode-switch ack — speak via macOS `say` since no TTS audio returned
            import subprocess
            subprocess.Popen(["say", "-v", "Daniel", data["spoken"]],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        return data
    except Exception as e:
        print(f"[voice-loop] backend unreachable: {e}", flush=True)
        return None


def main():
    if not MODEL_PATH.exists():
        print(f"[voice-loop] Model not found: {MODEL_PATH}", file=sys.stderr)
        print(f"             Download via: curl -L https://alphacephei.com/vosk/models/vosk-model-small-{LANG}-*.zip", file=sys.stderr)
        sys.exit(2)

    write_pid()
    print(f"[voice-loop] PID {os.getpid()} | model={MODEL_PATH.name} | wake_words={WAKE_WORDS}")
    print(f"[voice-loop] Loading Vosk model...", flush=True)
    model = Model(str(MODEL_PATH))
    print(f"[voice-loop] Model ready. Listening for wake word...", flush=True)

    wake_rec = KaldiRecognizer(model, SAMPLE_RATE)
    last_partial = ""

    def is_self_speaking():
        """True if Tolik's TTS is currently playing — don't capture own voice."""
        if not MUTE_FLAG.exists(): return False
        try: return (time.time() - MUTE_FLAG.stat().st_mtime) < 30
        except Exception: return False

    try:
        with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="int16", blocksize=BLOCK_SIZE) as stream:
            while True:
                chunk, _ = stream.read(BLOCK_SIZE)
                # Skip wake-word detection entirely while we're talking
                if is_self_speaking():
                    # Reset recognizer to drop any audio we captured during TTS
                    wake_rec = KaldiRecognizer(model, SAMPLE_RATE)
                    last_partial = ""
                    continue
                data = chunk.tobytes()
                is_final = wake_rec.AcceptWaveform(data)

                if is_final:
                    # End-of-utterance reached — check the FULL final transcript
                    final = json.loads(wake_rec.Result()).get("text", "").lower().strip()
                    last_partial = ""
                    if not final:
                        continue
                    # Wake-word fires only if the final transcript IS the wake word,
                    # OR it's the LAST word of a short utterance (≤ 4 words).
                    words = final.split()
                    if not words:
                        continue
                    last_word = words[-1].strip(".,!?")
                    fires = (
                        last_word in WAKE_WORDS or
                        (len(words) <= 4 and any(w in WAKE_WORDS for w in words))
                    )
                    if not fires:
                        # Tolik mentioned mid-sentence in long utterance — ignore
                        wake_rec = KaldiRecognizer(model, SAMPLE_RATE)
                        continue

                    print(f"[voice-loop] WAKE (final): '{final}' → recording…", flush=True)
                    play_beep()
                    # Discard pre-roll (mic settling)
                    for _ in range(PRE_ROLL_BLOCKS):
                        stream.read(BLOCK_SIZE)
                    audio = record_until_silence(stream)
                    text = transcribe(audio, model)
                    print(f"[voice-loop] HEARD: '{text}'", flush=True)
                    send_to_backend(text)
                    wake_rec = KaldiRecognizer(model, SAMPLE_RATE)
                    last_partial = ""
                    print(f"[voice-loop] Listening for wake word...", flush=True)
                else:
                    # Partial — only print if changed (cleaner log)
                    partial = json.loads(wake_rec.PartialResult()).get("partial", "").lower()
                    if partial and partial != last_partial and len(partial) < 80:
                        last_partial = partial
    except KeyboardInterrupt:
        print("\n[voice-loop] Shutdown.")
    except Exception as e:
        print(f"[voice-loop] Fatal: {e}", file=sys.stderr)
        import traceback; traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
