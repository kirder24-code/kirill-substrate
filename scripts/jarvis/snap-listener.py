#!/usr/bin/env python3
"""
scripts/jarvis/snap-listener.py

Port of Chi Chen's Jarvis double-snap detector (core/snap.py), adapted to
Tolik substrate. On a double-snap (two RMS spikes within MAX_GAP seconds),
POSTs to webhook-server's /api/tolik/snap endpoint which triggers a full
session launch: greeting, app launcher, window arrange, wake-word loop.

Runs as a long-living daemon. Lightweight: sounddevice + numpy only.

Tunable via env vars:
  TOLIK_SNAP_THRESHOLD   RMS threshold above which a sample is a snap.
                          Default 0.07. Decrease in quiet rooms (0.04-0.05),
                          increase in noisy ones (0.10-0.12). Run with
                          --calibrate to see live RMS levels.
  TOLIK_SNAP_MIN_GAP     Minimum seconds between two snaps (debounce). 0.1
  TOLIK_SNAP_MAX_GAP     Maximum seconds between two snaps. 1.2
  TOLIK_WEBHOOK_URL      Base URL for webhook-server. Default localhost:4789.

Usage:
  python scripts/jarvis/snap-listener.py              # daemon mode
  python scripts/jarvis/snap-listener.py --calibrate  # print live RMS
"""

import os
import sys
import time
import argparse
from pathlib import Path

import numpy as np
import sounddevice as sd
import requests

SAMPLE_RATE = 44100
BLOCK_SIZE = 1024

THRESHOLD = float(os.getenv("TOLIK_SNAP_THRESHOLD", "0.07"))
MIN_GAP = float(os.getenv("TOLIK_SNAP_MIN_GAP", "0.1"))
MAX_GAP = float(os.getenv("TOLIK_SNAP_MAX_GAP", "1.2"))
COOLDOWN_SEC = float(os.getenv("TOLIK_SNAP_COOLDOWN", "15.0"))
WEBHOOK = os.getenv("TOLIK_WEBHOOK_URL", "http://127.0.0.1:4789")

# Pid file so we can stop the daemon cleanly
PID_FILE = Path(__file__).parents[2] / ".data" / "tolik-snap-listener.pid"
# Shared mute flag — voice-loop touches this while TTS is playing through
# speakers so snap-listener doesn't mis-detect Tolik's own voice as a snap.
MUTE_FLAG = Path(__file__).parents[2] / ".data" / "tolik-tts-playing.flag"


def is_muted():
    """True if voice-loop is currently playing TTS (don't trigger on own audio)."""
    if not MUTE_FLAG.exists():
        return False
    try:
        # Stale flag protection — if older than 30s, ignore
        return (time.time() - MUTE_FLAG.stat().st_mtime) < 30
    except Exception:
        return False


def write_pid():
    PID_FILE.parent.mkdir(parents=True, exist_ok=True)
    PID_FILE.write_text(str(os.getpid()))


def notify_snap():
    """POST to webhook-server. Fire and forget — short timeout."""
    try:
        r = requests.post(f"{WEBHOOK}/api/tolik/snap", json={"ts": time.time()}, timeout=2)
        print(f"[snap-listener] POST /api/tolik/snap → {r.status_code}", flush=True)
    except Exception as e:
        print(f"[snap-listener] webhook unreachable: {e}", flush=True)


def calibrate(seconds=30):
    """Print live RMS values so user can pick a good THRESHOLD."""
    print(f"[snap-listener] Calibration mode — listening {seconds}s. Snap your fingers a few times.")
    print(f"[snap-listener] Current THRESHOLD = {THRESHOLD}")
    print(f"[snap-listener] Set TOLIK_SNAP_THRESHOLD to a value just below your snap spikes.\n")
    peaks = []
    start = time.time()

    def cb(indata, frames, time_info, status):
        rms = float(np.sqrt(np.mean(indata ** 2)))
        if rms > 0.02:  # ignore silence
            peaks.append(rms)
            bar = "█" * min(int(rms * 60), 60)
            marker = "  ← SNAP" if rms > THRESHOLD else ""
            print(f"  RMS={rms:.3f} {bar}{marker}", flush=True)

    with sd.InputStream(samplerate=SAMPLE_RATE, blocksize=BLOCK_SIZE, channels=1, dtype="float32", callback=cb):
        while time.time() - start < seconds:
            time.sleep(0.05)

    if peaks:
        print(f"\n[snap-listener] Summary over {seconds}s:")
        print(f"  Max RMS: {max(peaks):.3f}")
        print(f"  Mean RMS (active): {sum(peaks)/len(peaks):.3f}")
        print(f"  Recommended THRESHOLD: {max(0.04, 0.7 * max(peaks)):.3f}")


_state = {"last_snap": 0.0, "count": 0, "armed": True}


def audio_callback(indata, frames, time_info, status):
    if not _state["armed"]:
        return
    # Skip while Tolik is speaking — his own TTS through speakers would
    # otherwise look like snaps and trigger feedback loop.
    if is_muted():
        return
    now = time.time()
    rms = float(np.sqrt(np.mean(indata ** 2)))
    if rms <= THRESHOLD:
        return
    gap = now - _state["last_snap"]
    if gap < MIN_GAP:
        return  # debounce — the same snap still ringing
    if gap <= MAX_GAP and _state["count"] >= 1:
        print(f"[snap-listener] DOUBLE SNAP (RMS={rms:.3f}, gap={gap:.2f}s)", flush=True)
        _state["armed"] = False
        notify_snap()
        # COOLDOWN: 15s default — long enough for the boot sequence + greeting
        # to finish playing, so the greeting itself doesn't re-trigger us.
        def _rearm():
            time.sleep(COOLDOWN_SEC)
            _state["count"] = 0
            _state["last_snap"] = 0.0
            _state["armed"] = True
            print(f"[snap-listener] Re-armed (after {COOLDOWN_SEC:.0f}s cooldown).", flush=True)
        import threading
        threading.Thread(target=_rearm, daemon=True).start()
    else:
        _state["count"] = 1
        print(f"[snap-listener] Snap 1 (RMS={rms:.3f}) — waiting for snap 2...", flush=True)
    _state["last_snap"] = now


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--calibrate", action="store_true", help="Print live RMS, don't run daemon")
    parser.add_argument("--seconds", type=int, default=30, help="Calibration window")
    args = parser.parse_args()

    if args.calibrate:
        calibrate(args.seconds)
        return

    write_pid()
    print(f"[snap-listener] PID {os.getpid()} | threshold={THRESHOLD} | gap=[{MIN_GAP},{MAX_GAP}]s | webhook={WEBHOOK}")
    print(f"[snap-listener] Snap twice to launch a Tolik session...", flush=True)

    try:
        with sd.InputStream(samplerate=SAMPLE_RATE, blocksize=BLOCK_SIZE, channels=1, dtype="float32", callback=audio_callback):
            while True:
                time.sleep(0.5)
    except KeyboardInterrupt:
        print("\n[snap-listener] Shutdown.")
    except Exception as e:
        print(f"[snap-listener] Fatal: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
