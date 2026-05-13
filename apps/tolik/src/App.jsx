import React, { useEffect, useState, useCallback, useRef } from "react";
import Sphere from "./Sphere.jsx";
import { useVoice } from "./useVoice.js";
import { useWakeWord } from "./useWakeWord.js";

const fmtTime = (d) => d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fmtDate = (d) => d.toISOString().slice(0, 10);

async function fetchJson(path, fallback) {
  try {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) return fallback;
    return await r.json();
  } catch { return fallback; }
}

const KIND_LABELS = { observation: "OBSERVATION", praise: "PRAISE", recommendation: "RECOMMEND", alert: "ALERT", nudge: "NUDGE" };
const STATE_LABEL = { idle: "READY", listening: "LISTENING", thinking: "THINKING", speaking: "SPEAKING" };

function formatNumber(n) {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(Math.round(n));
}

export default function App() {
  const { state, level, transcript, answer, toolCall, toolResult, toolChain, artifact, clearArtifact, startListening, stopListening, playRemote } = useVoice();
  const [now, setNow] = useState(new Date());
  const [brief, setBrief] = useState(null);
  const [opps, setOpps] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [goals, setGoals] = useState([]);
  const [thoughts, setThoughts] = useState([]);
  const [metrics, setMetrics] = useState({});
  const [briefPlayed, setBriefPlayed] = useState(false);
  const [weather, setWeather] = useState(null);

  // Fetch weather every 30 minutes (server caches it for 30min anyway)
  useEffect(() => {
    const fetchWeather = () => fetchJson("/api/tolik/weather", null).then(w => w?.ok && setWeather(w));
    fetchWeather();
    const id = setInterval(fetchWeather, 30 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    const [b, o, d, g, m] = await Promise.all([
      fetchJson("/api/state/brief", null),
      fetchJson("/api/state/opportunities", { opportunities: [] }),
      fetchJson("/api/state/departments", []),
      fetchJson("/api/tolik/goals", { goals: [] }),
      fetchJson("/api/state/metrics", {}),
    ]);
    setBrief(b);
    setOpps((o.opportunities || []).slice(0, 6));
    setDepartments((d || []).slice(0, 6));
    setGoals(g.goals || []);
    setMetrics(m || {});
  }, []);

  // SSE thoughts feed — DISPLAYS thoughts in the side panel only.
  // AUTO-SPEAK is INTENTIONALLY DISABLED — proactive thoughts firing
  // randomly while user is mid-conversation made Tolik say two things at
  // once + interrupt user. Thoughts appear silently in the right panel; if
  // Kirill wants to hear one, he can click it (TODO add click-to-speak).
  useEffect(() => {
    const es = new EventSource("/api/tolik/thoughts");
    es.onmessage = (ev) => {
      try {
        const t = JSON.parse(ev.data);
        setThoughts(prev => {
          if (prev.find(x => x.ts === t.ts)) return prev;
          return [t, ...prev].slice(0, 20);
        });
      } catch {}
    };
    return () => es.close();
  }, [state]);

  useEffect(() => {
    refresh();
    const t = setInterval(() => setNow(new Date()), 1000);
    const p = setInterval(refresh, 30_000);
    const ping = () => fetch("/api/tolik/presence", { method: "POST" }).catch(() => {});
    ping();
    const pingInt = setInterval(ping, 60_000);

    // Auto morning greet on dashboard mount. Server returns 204 if already
    // greeted today; otherwise audio_b64 with personalized greeting + brief.
    // Browsers require a user gesture to autoplay - we try once, if blocked,
    // a button appears on screen.
    const greetKey = "tolik-greet-" + new Date().toISOString().slice(0, 10);
    if (!sessionStorage.getItem(greetKey)) {
      fetch("/api/tolik/greet").then(r => r.status === 204 ? null : r.json()).then(j => {
        if (!j?.ok || !j.audio_b64) return;
        sessionStorage.setItem(greetKey, "1");
        const bin = atob(j.audio_b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([bytes], { type: j.mime || "audio/mpeg" }));
        const audio = new Audio(url);
        audio.play().catch(() => {
          // Autoplay blocked - stash the URL for the button to use
          window.__tolikGreetUrl = url;
          window.__tolikGreetText = j.text;
          window.dispatchEvent(new CustomEvent("tolik-greet-blocked"));
        });
        audio.onended = () => URL.revokeObjectURL(url);
      }).catch(() => {});
    }
    return () => { clearInterval(t); clearInterval(p); clearInterval(pingInt); };
  }, [refresh]);

  // Surface a "play greeting" button when autoplay was blocked
  const [greetBlocked, setGreetBlocked] = useState(false);
  useEffect(() => {
    const onBlocked = () => setGreetBlocked(true);
    window.addEventListener("tolik-greet-blocked", onBlocked);
    return () => window.removeEventListener("tolik-greet-blocked", onBlocked);
  }, []);

  // Boot-sequence on snap is DISABLED — caused feedback loops where Tolik's
  // own TTS through speakers triggered the snap-listener which triggered the
  // greeting which triggered another snap, etc. Snap-listener is no longer
  // running. Greeting plays once per day via the existing /api/tolik/greet
  // path (above in useEffect) and that's it. Push-to-talk via spacebar is
  // the primary interaction.
  const [bootFlare] = useState(false);
  const playBlockedGreet = useCallback(() => {
    if (!window.__tolikGreetUrl) return;
    const audio = new Audio(window.__tolikGreetUrl);
    audio.play().catch(() => {});
    audio.onended = () => { URL.revokeObjectURL(window.__tolikGreetUrl); window.__tolikGreetUrl = null; };
    setGreetBlocked(false);
  }, []);

  // Wake word + manual hold logic
  const manualHoldRef = useRef(false);
  const wakeTriggeredRef = useRef(false);
  const silenceStartAtRef = useRef(0);
  const sessionStartAtRef = useRef(0);
  const wake = useWakeWord({
    onWake: () => {
      if (state === "idle") {
        wakeTriggeredRef.current = true;
        manualHoldRef.current = false;
        sessionStartAtRef.current = Date.now();
        silenceStartAtRef.current = 0;
        startListening();
      }
    },
    pause: state !== "idle",
  });
  useEffect(() => {
    if (state !== "listening") { silenceStartAtRef.current = 0; return; }
    if (!wakeTriggeredRef.current || manualHoldRef.current) return;
    const nowMs = Date.now();
    if (nowMs - sessionStartAtRef.current < 1000) return;
    if (level < 0.05) {
      if (silenceStartAtRef.current === 0) silenceStartAtRef.current = nowMs;
      if (nowMs - silenceStartAtRef.current >= 2500) {
        wakeTriggeredRef.current = false;
        silenceStartAtRef.current = 0;
        stopListening();
      }
    } else silenceStartAtRef.current = 0;
  }, [level, state, stopListening]);

  const beginManualHold = useCallback(() => {
    manualHoldRef.current = true;
    wakeTriggeredRef.current = false;
    silenceStartAtRef.current = 0;
    startListening();
  }, [startListening]);
  const endManualHold = useCallback(() => {
    manualHoldRef.current = false;
    stopListening();
  }, [stopListening]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.code === "Space" && !e.repeat && !e.target.matches("input,textarea")) {
        e.preventDefault();
        beginManualHold();
      }
    };
    const onKeyUp = (e) => {
      if (e.code === "Space") {
        e.preventDefault();
        endManualHold();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [beginManualHold, endManualHold]);

  return (
    <div className={`shell ${bootFlare ? "boot-flare" : ""}`}>
      {/* TOP STRIP */}
      <div className="top">
        <div className="brand">ТОЛИК · BRAND OS</div>
        <div className="ticker">
          <span>SYSTEM <span className="green">ONLINE</span></span>
          <span>PIPELINE <span className="gold">${formatNumber(metrics.pipeline_usd)}</span></span>
          <span>LEADS/WK <span className="green">{goals.find(g => g.id === "qualified_leads_week")?.current ?? "—"}</span></span>
          <span>OPPS <span>{metrics.active_builds ?? "—"}</span></span>
          <span>LLM 24H <span className={(metrics.cost_24h ?? 0) > 5 ? "amber" : ""}>${(departments.find(d => d.name === "FINANCE")?.message || "").match(/\$[\d.]+/)?.[0] || "—"}</span></span>
        </div>
        <div className="clock">{fmtTime(now)} · {fmtDate(now)}</div>
        {weather && (
          <div className="weather" title={`${weather.city} (Open-Meteo)`}>
            <span className="weather-temp">{weather.temp_c >= 0 ? "+" : ""}{weather.temp_c}°</span>
            <span className="weather-cond">{weather.condition}</span>
            <span className="weather-city">{weather.city}</span>
          </div>
        )}
        <div className={`status-pill ${state}`}><span className="dot" />{STATE_LABEL[state]}</div>
      </div>

      {/* MAIN 4-COL GRID */}
      <div className="stage">
        {/* COLUMN 1: LIVE METRICS + DEPARTMENTS */}
        <div className="col">
          <div className="panel">
            <h4>// LIVE METRICS</h4>
            <div className="metric-big">
              <div className="v cyan">${formatNumber(metrics.pipeline_usd ?? 0)}</div>
              <div className="l">Pipeline Value</div>
            </div>
            <div className="metric-big">
              <div className="v gold">{metrics.decisions_due ?? 0}</div>
              <div className="l">Decisions Due</div>
            </div>
            <div className="metric-big">
              <div className="v green">{metrics.active_builds ?? 0}</div>
              <div className="l">Active Builds</div>
            </div>
            <div className="metric-big">
              <div className="v amber">{metrics.pipeline_delta_pct >= 0 ? "+" : ""}{metrics.pipeline_delta_pct ?? 0}%</div>
              <div className="l">MoM Activity</div>
            </div>
          </div>
          <div className="panel tall">
            <h4>// DEPARTMENTS <span className="badge">{departments.length}</span></h4>
            <div className="scroll">
              {departments.map(d => (
                <div className="dept-row" key={d.name}>
                  <div className={`dot ${d.status || "amber"}`} />
                  <div className="dept-name">{d.name}</div>
                  <div className="dept-msg">{d.message}</div>
                </div>
              ))}
              {departments.length === 0 && <div style={{ color: "var(--text-3)", fontSize: 11 }}>Loading…</div>}
            </div>
          </div>
        </div>

        {/* COLUMN 2: BRIEF + OPPS + INTEL */}
        <div className="col">
          <div className="panel">
            <h4>// УТРЕННИЙ БРИФ {brief?.generated_at ? <span className="badge">{new Date(brief.generated_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</span> : null}</h4>
            <div style={{ fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.5 }}>
              {brief?.text?.slice(0, 320) || "Ещё не синтезирован."}
              {brief?.text?.length > 320 ? "…" : ""}
            </div>
            {brief?.text && !briefPlayed && (
              <button
                className="btn"
                style={{ marginTop: 10, fontSize: 9, padding: "5px 12px" }}
                onClick={async () => { setBriefPlayed(true); await playRemote("/api/tolik/brief.mp3"); }}
                disabled={state !== "idle"}
              >▶ ПРОСЛУШАТЬ</button>
            )}
          </div>
          <div className="panel tall">
            <h4>// PIPELINE INTEL <span className="badge">{opps.length}</span></h4>
            <div className="scroll">
              {opps.map(o => (
                <div className="mini-list-item" key={o.id}>
                  <div className="tag">{o.state} · {o.source}</div>
                  <div className="txt">{o.title}</div>
                </div>
              ))}
              {opps.length === 0 && <div style={{ color: "var(--text-3)", fontSize: 11 }}>Loading…</div>}
            </div>
          </div>
        </div>

        {/* COLUMN 3: SPHERE + LIVE OVERLAY + CHAIN STRIP */}
        <div className="col center-stage">
          <div className="panel" style={{ flex: 1, padding: 0, position: "relative" }}>
            <div className="sphere-zone">
              <Sphere state={state} audioLevel={level} />
              {artifact && (
                <div className="artifact-overlay">
                  <div className="artifact-head">
                    <div>
                      <div className="kind">Артефакт · {artifact.kind}</div>
                      <div className="title">{artifact.title}</div>
                    </div>
                    <button className="artifact-close" onClick={clearArtifact}>× ЗАКРЫТЬ</button>
                  </div>
                  <iframe
                    title={artifact.title}
                    srcDoc={`<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=DM+Sans:wght@300;400;500&family=JetBrains+Mono:wght@300;400;500&display=swap" rel="stylesheet"><style>:root{--void:#07070d;--arc:#00c8ff;--gold:#c9a84c;--green:#00e676;--amber:#ffab00;--red:#ff3d5a;--text:#e6f6ff;--text-2:rgba(230,246,255,0.6);--text-3:rgba(230,246,255,0.32);--border:rgba(0,200,255,0.18);--surface:rgba(0,200,255,0.04);}*{box-sizing:border-box}body{margin:0;padding:18px;background:transparent;color:var(--text);font-family:"DM Sans",sans-serif;font-size:13px;line-height:1.55}h1,h2,h3,h4{font-family:"Syne",sans-serif;font-weight:700;color:var(--text);margin:0 0 8px}h1{font-size:18px}h2{font-size:15px;color:var(--arc)}h3{font-size:13px}.mono,code,pre{font-family:"JetBrains Mono",monospace;font-size:11px}table{width:100%;border-collapse:collapse;margin:8px 0}th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--border);font-size:12px}th{font-family:"JetBrains Mono",monospace;font-size:9px;letter-spacing:0.16em;text-transform:uppercase;color:var(--text-3);background:var(--surface)}.tag{display:inline-block;font-family:"JetBrains Mono",monospace;font-size:9px;letter-spacing:0.12em;padding:2px 8px;border-radius:2px;text-transform:uppercase}.tag.arc{background:rgba(0,200,255,0.1);color:var(--arc);border:1px solid var(--arc-border)}.tag.gold{background:rgba(201,168,76,0.1);color:var(--gold)}.tag.green{background:rgba(0,230,118,0.1);color:var(--green)}.tag.red{background:rgba(255,61,90,0.1);color:var(--red)}.tag.amber{background:rgba(255,171,0,0.1);color:var(--amber)}ul{padding-left:18px}li{margin-bottom:4px}a{color:var(--arc);text-decoration:none}svg{max-width:100%}</style></head><body>${artifact.html}</body></html>`}
                    sandbox="allow-same-origin"
                    style={{ flex: 1, width: "100%", border: "none", minHeight: 280, background: "transparent" }}
                  />
                </div>
              )}
              <div className="live-overlay">
                {state === "listening" && <>
                  <div className="label">ВЫ ГОВОРИТЕ…</div>
                  <div className="text" style={{ color: "var(--arc)" }}>Слушаю</div>
                </>}
                {state === "thinking" && <>
                  <div className="label">ВЫ СКАЗАЛИ</div>
                  <div className="text">{transcript || "…"}</div>
                </>}
                {state === "speaking" && <>
                  <div className="label">ТОЛИК</div>
                  <div className="text">{answer}</div>
                </>}
                {state === "idle" && answer && <>
                  <div className="label">ПОСЛЕДНИЙ ОТВЕТ</div>
                  <div className="text" style={{ color: "var(--text-2)" }}>{answer}</div>
                </>}
                {state === "idle" && !answer && <>
                  <div className="label">УДЕРЖИВАЙ ПРОБЕЛ · СКАЖИ «ТОЛИК»</div>
                  <div className="text" style={{ color: "var(--text-3)" }}>Я слушаю фон</div>
                </>}
              </div>
            </div>
            <div className="chain-strip">
              <div className="h">// TOOL CHAIN {toolChain?.length > 0 && <span style={{ color: "var(--text-3)" }}> · {toolChain.length} steps</span>}</div>
              <div className="chain-items">
                {toolChain && toolChain.length > 0 ? toolChain.map((t, i) => (
                  <div key={i} className={`chain-item ${t.ok ? "ok" : "fail"}`}>
                    <span className="step">{i+1}.</span>{t.action}
                  </div>
                )) : <div style={{ color: "var(--text-3)", fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}>idle - нет активной задачи</div>}
              </div>
            </div>
          </div>
        </div>

        {/* COLUMN 4: TARGETS + THOUGHTS */}
        <div className="col">
          <div className="panel">
            <h4>// ЦЕЛИ <span className="badge">{goals.length}</span></h4>
            {goals.slice(0, 4).map(g => (
              <div className="bar-row" key={g.id}>
                <div className="bar-label">
                  <span>{g.label}</span>
                  <span className="val" style={{ color: g.status === "done" ? "var(--green)" : g.status === "on_track" ? "var(--arc)" : g.status === "starting" ? "var(--amber)" : "var(--red)" }}>
                    {g.current}/{g.target} {g.unit}
                  </span>
                </div>
                <div className="bar-track">
                  <div className="bar-fill" style={{
                    width: `${Math.min(100, g.pct)}%`,
                    background: g.pct >= 100 ? "var(--green)" : g.pct >= 70 ? "var(--arc)" : g.pct >= 30 ? "var(--amber)" : "var(--red)",
                  }} />
                </div>
              </div>
            ))}
            {goals.length === 0 && <div style={{ color: "var(--text-3)", fontSize: 11 }}>Loading…</div>}
          </div>
          <div className="panel tall">
            <h4>// ЧТО ТОЛИК ДУМАЕТ <span className="badge">{thoughts.length}</span></h4>
            <div className="scroll">
              {thoughts.length === 0 && (
                <div style={{ color: "var(--text-3)", fontSize: 11 }}>Толик молчит. Демон proactive-loop наблюдает.</div>
              )}
              {thoughts.map((t, i) => (
                <div className="thought" key={`${t.ts}-${i}`}>
                  <div className="thought-head">
                    <span className={`thought-kind ${t.kind}`}>{KIND_LABELS[t.kind] || t.kind}</span>
                    <span className="thought-time">{new Date(t.ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <div className="thought-body">{t.spoken}</div>
                  {t.why && <div className="thought-why">{t.why}</div>}
                  {t.action_offered && <span className="thought-action">→ {t.action_offered}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* BOTTOM CONTROL BAR */}
      <div className="bottom">
        <div className="left">
          {greetBlocked && (
            <button className="btn primary" onClick={playBlockedGreet}>
              ▶ ПРОСЛУШАТЬ ПРИВЕТСТВИЕ
            </button>
          )}
          <button
            className={`btn btn-toggle ${wake.enabled ? "on" : ""}`}
            onClick={() => wake.enabled ? wake.disable() : wake.enable()}
          >
            {wake.enabled ? "● СЛУШАЮ «ТОЛИК»" : "○ СКАЖИ «ТОЛИК»"}
          </button>
          <span style={wake.enabled ? { color: wake.errorMsg ? "var(--red)" : (wake.running ? "var(--arc)" : "var(--amber)") } : {}}>
            {wake.errorMsg ? `⚠ ${wake.errorMsg}` : wake.enabled ? (wake.lastHeard ? `🎙 «${wake.lastHeard.slice(-40)}»` : (wake.running ? "🎙 фон" : "ON")) : ""}
          </span>
        </div>
        <button
          className={`btn ${state === "listening" ? "recording" : "primary"}`}
          onMouseDown={(e) => { e.preventDefault(); beginManualHold(); }}
          onMouseUp={(e) => { e.preventDefault(); endManualHold(); }}
          onMouseLeave={(e) => { if (state === "listening" && manualHoldRef.current) endManualHold(); }}
          disabled={state === "thinking" || state === "speaking"}
        >
          {state === "listening" ? "● ОТПУСТИТЕ" : state === "thinking" ? "ДУМАЮ…" : state === "speaking" ? "ГОВОРЮ…" : "🎤 НАЖМИ (SPACE)"}
        </button>
        <div className="right">
          <span>RU/EN ADAPTIVE</span>
          <span>TICK 60S</span>
        </div>
      </div>
    </div>
  );
}
