import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Wake-word listener that uses Chrome's built-in webkitSpeechRecognition
 * API. Continuous, free, local-ish (Chrome routes through Google but
 * doesn't keep audio - just text recognition).
 *
 * Triggers `onWake()` when it hears any of:
 *   "толик", "толя", "hey tolik", "tolik", "толика"
 *
 * Auto-restarts on transient errors. Pauses while Tolik is THINKING or
 * SPEAKING so it doesn't pick up his own voice through the speakers.
 *
 * Public API:
 *   enabled (bool)  — currently listening
 *   enable() / disable() — toggle
 *   lastHeard       — last recognized phrase for debug display
 */
// JavaScript regex \b matches ASCII word boundaries only. Cyrillic words
// would never trigger with /\bтолик\b/. Use Unicode property escapes or
// just substring match against lowercased input.
function hitsWakeWord(text) {
  const t = text.toLowerCase();
  // Tolerate Whisper-like spellings the Chrome recognizer might return
  return (
    t.includes("толик") ||
    t.includes("толик ") ||
    t.includes("толя") ||
    t.includes("толи ") ||
    t.includes("толич") ||
    t.includes("tolik") ||
    t.includes("tolic") ||
    t.includes("tolyk") ||
    t.includes("толика")
  );
}

export function useWakeWord({ onWake, pause }) {
  const [enabled, setEnabled] = useState(false);
  const [lastHeard, setLastHeard] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [running, setRunning] = useState(false);
  const recRef = useRef(null);
  const enabledRef = useRef(false);
  const pauseRef = useRef(false);
  const lastTriggerAt = useRef(0);

  useEffect(() => { pauseRef.current = pause; }, [pause]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  const start = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setErrorMsg("Браузер не поддерживает распознавание. Используй Chrome.");
      return false;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "ru-RU";
    rec.maxAlternatives = 3;

    rec.onstart = () => { setRunning(true); setErrorMsg(""); };
    rec.onresult = (event) => {
      if (pauseRef.current) return;
      // Combine final + interim results; also check all alternatives
      let texts = [];
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        for (let j = 0; j < result.length; j++) {
          texts.push(result[j].transcript);
        }
      }
      const combined = texts.join(" ").trim();
      if (combined) setLastHeard(combined.slice(-80));
      if (!combined) return;
      if (hitsWakeWord(combined)) {
        const now = Date.now();
        if (now - lastTriggerAt.current < 3000) return;
        lastTriggerAt.current = now;
        onWake?.();
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed") {
        setErrorMsg("Микрофон запрещён. Разреши в настройках сайта.");
        setEnabled(false);
        enabledRef.current = false;
        setRunning(false);
        return;
      }
      if (e.error === "no-speech" || e.error === "aborted") {
        // benign, will restart via onend
        return;
      }
      setErrorMsg(`Ошибка: ${e.error}`);
    };
    rec.onend = () => {
      setRunning(false);
      if (enabledRef.current && !pauseRef.current) {
        // Restart immediately on natural end (Chrome stops after ~1min silence)
        setTimeout(() => {
          if (enabledRef.current && !pauseRef.current) {
            try { rec.start(); } catch (e) {
              // Swallow "already started" — benign race when pause toggled
              if (!/already started/i.test(e.message)) setErrorMsg("restart failed: " + e.message);
            }
          }
        }, 250);
      }
    };

    recRef.current = rec;
    try {
      rec.start();
      return true;
    } catch (e) {
      if (/already started/i.test(e.message)) return true; // already running - fine
      setErrorMsg("start failed: " + e.message);
      return false;
    }
  }, [onWake]);

  const stop = useCallback(() => {
    if (recRef.current) {
      try { recRef.current.stop(); } catch {}
      recRef.current = null;
    }
    setLastHeard("");
  }, []);

  const enable = useCallback(() => {
    if (enabledRef.current) return;
    const ok = start();
    if (ok) setEnabled(true);
  }, [start]);

  const disable = useCallback(() => {
    setEnabled(false);
    enabledRef.current = false;
    stop();
  }, [stop]);

  // Pause/resume the recognizer when the consumer flips `pause` (e.g. while
  // Tolik is speaking - prevents him from wake-tripping on his own voice).
  useEffect(() => {
    if (!enabledRef.current) return;
    if (pause) {
      try { recRef.current?.stop(); } catch {}
    }
    // When un-pausing we let onend → restart timer handle it. Calling
    // start() here races with that timer and triggers "already started".
  }, [pause]);

  useEffect(() => () => stop(), [stop]);

  return { enabled, lastHeard, enable, disable, errorMsg, running };
}
