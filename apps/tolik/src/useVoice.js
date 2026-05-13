import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Voice pipeline hook.
 *
 * Controls the mic + audio analysis + speech playback for Tolik.
 *   state: "idle" | "listening" | "thinking" | "speaking"
 *   level: 0..1 smoothed amplitude of current source (mic when listening,
 *          audio element when speaking)
 *   transcript: last recognized user phrase
 *   answer: Tolik's last spoken text
 *
 * Public API:
 *   startListening() — begins MediaRecorder; pushes audio to /api/voice/ask on stop
 *   stopListening()  — stops mic, fires the request, transitions to "thinking"
 *
 * SPACE key push-to-talk is wired in App.jsx; this hook is the engine.
 */
export function useVoice() {
  const [state, setState] = useState("idle");
  const [level, setLevel] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [answer, setAnswer] = useState("");
  const [toolCall, setToolCall] = useState(null);
  const [toolResult, setToolResult] = useState(null);
  const [toolChain, setToolChain] = useState([]);
  const [artifact, setArtifact] = useState(null);

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(0);
  const playbackElRef = useRef(null);
  const playbackCtxRef = useRef(null);

  const tickLevel = useCallback((source) => {
    const ctx = audioCtxRef.current;
    if (!ctx || !analyserRef.current) return;
    const data = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    setLevel(Math.min(1, rms * 2.4));
    rafRef.current = requestAnimationFrame(() => tickLevel(source));
  }, []);

  const cleanupMic = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    setLevel(0);
  }, []);

  const startListening = useCallback(async () => {
    if (state === "listening" || state === "thinking" || state === "speaking") return;
    setTranscript("");
    setAnswer("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyserRef.current = analyser;
      tickLevel(source);

      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
                 : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4"
                 : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mime });
        cleanupMic();
        setState("thinking");
        await sendAudio(blob, mime);
      };
      recorderRef.current = recorder;
      recorder.start();
      setState("listening");
    } catch (e) {
      console.error("mic failed", e);
      setState("idle");
    }
  }, [state, cleanupMic, tickLevel]);

  const stopListening = useCallback(() => {
    const r = recorderRef.current;
    if (r && r.state === "recording") r.stop();
  }, []);

  const sendAudio = async (blob, mime) => {
    try {
      const buf = await blob.arrayBuffer();
      // Encode in chunks to avoid btoa(...spread...) stack overflow on long
      // audio buffers (>100KB)
      let b64 = "";
      const bytes = new Uint8Array(buf);
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        b64 += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      b64 = btoa(b64);

      // FAST path: get text + tool result first (no TTS), show it
      // immediately, then fetch audio in parallel and play.
      const r = await fetch("/api/voice/ask-fast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio_b64: b64, mime }),
      });
      const j = await r.json();
      setTranscript(j.transcript || "");
      setAnswer(j.answer || "");
      setToolCall(j.tool_call || null);
      setToolResult(j.tool_result || null);
      setToolChain(j.tool_chain || []);
      if (j.artifact) setArtifact(j.artifact);

      const spoken = (j.answer || "").trim();
      if (!spoken) { setState("idle"); return; }

      // Now fetch the audio for the spoken text. State stays "thinking"
      // visually for the few hundred ms of TTS, then flips to "speaking".
      try {
        const tr = await fetch("/api/voice/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: spoken, language: j.detected_language }),
        });
        const tj = await tr.json();
        if (tj.ok && tj.audio_b64) await playBase64Audio(tj.audio_b64, tj.mime || "audio/mpeg");
        else setState("idle");
      } catch {
        setState("idle");
      }
    } catch (e) {
      console.error("voice pipeline failed", e);
      setState("idle");
    }
  };

  const playBase64Audio = (b64, mime) => new Promise((resolve) => {
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      const audio = new Audio(url);
      playbackElRef.current = audio;

      // Hook into playback for level analysis
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      analyserRef.current = analyser;
      tickLevel(source);

      setState("speaking");
      audio.play().catch(err => console.warn("autoplay blocked", err));
      audio.onended = () => {
        cleanupMic();
        URL.revokeObjectURL(url);
        playbackElRef.current = null;
        setState("idle");
        resolve();
      };
    } catch (e) {
      console.error("playback failed", e);
      setState("idle");
      resolve();
    }
  });

  // Programmatically play an audio file already on the server (e.g. the
  // pre-rendered morning brief).
  const playRemote = useCallback(async (url) => {
    if (state !== "idle") return;
    setState("speaking");
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) { setState("idle"); return; }
      const blob = await r.blob();
      const objUrl = URL.createObjectURL(blob);
      const audio = new Audio(objUrl);
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      analyser.connect(ctx.destination);
      analyserRef.current = analyser;
      tickLevel(src);
      await audio.play().catch(() => {});
      audio.onended = () => {
        cleanupMic();
        URL.revokeObjectURL(objUrl);
        setState("idle");
      };
    } catch { setState("idle"); }
  }, [state, tickLevel, cleanupMic]);

  const clearArtifact = useCallback(() => setArtifact(null), []);

  return { state, level, transcript, answer, toolCall, toolResult, toolChain, artifact, clearArtifact, startListening, stopListening, playRemote };
}
