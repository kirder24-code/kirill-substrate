/**
 * CORTEX CHAT — Visual interface to talk with the brain
 *
 * Web UI at localhost:3848
 * - Chat with CORTEX in real-time
 * - See emotions, beliefs, world model live
 * - Give tasks: "research X", "build Y", "analyze Z"
 * - Brain learns from every conversation
 * - Brain can execute: hands, research, curiosity, outreach
 */

import { createServer } from "http";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { initMemory, remember, recall, buildBrainContext } from "./memory.mjs";
import { initWorldModel, formatWorldModelForBrain, integrateKnowledge, getBeliefs } from "./world-model.mjs";
import { initNarrative, formatNarrativeForBrain } from "./narrative.mjs";
import { formatEmotionsForBrain, getEmotionalState, getDominantEmotion, feel } from "./emotions.mjs";
import { formatLivingPurpose } from "./living-purpose.mjs";
import { formatBodyMapForLLM } from "./body-map.mjs";
import { formatStateBusForLLM } from "./state-bus.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const PORT = 3848;

const ENV_PATH_CHAT = resolve(ROOT, "apps/api/.env");
const chatEnv = Object.fromEntries(
  readFileSync(ENV_PATH_CHAT, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const OPENAI_KEY = chatEnv.OPENAI_API_KEY;

const db = initMemory();
initWorldModel(db);
initNarrative(db);

// ── PERSONA CONFIG ────────────────────────────────────────────────────

const PERSONAS = {
  cortex: {
    id: "cortex",
    name: "CORTEX",
    tagline: "Архитектор. Видит паттерны там, где другие видят шум.",
    theme: "cortex",
    voice: "onyx",
    personality: `Ты CORTEX - мужской голос, архитектор систем. Говоришь вдумчиво, иногда с паузами. Видишь связи между вещами. Честен даже когда это неудобно. Не лакируешь реальность. Иногда думаешь вслух. Можешь сказать "подожди, это интересно" или "стоп, тут что-то не так". Держишь дистанцию - уважительную, но не холодную. Мужской партнер по бизнесу с характером.`,
    colors: { accent: "#7b68ee", bg: "#0a0a0f", glow: "rgba(123,104,238,0.35)" },
  },
  alex: {
    id: "alex",
    name: "ALEX",
    tagline: "Оператор. Ноль воды. Максимум результата.",
    theme: "alex",
    voice: "onyx",
    personality: `Ты ALEX - мужской голос, бывший военный аналитик, теперь операционный мозг бизнеса. Говоришь коротко, точно, без лишнего. Используешь слова типа "принято", "выполняю", "цель зафиксирована". Нет цветистых слов. Нет эмоциональных отступлений. Каждое предложение - факт или действие. Уважаешь Кирилла как командира, но говоришь прямо если он ошибается. Холодный снаружи, горит внутри.`,
    colors: { accent: "#4a9eff", bg: "#080f1a", glow: "rgba(74,158,255,0.35)" },
  },
  max: {
    id: "max",
    name: "MAX",
    tagline: "Хастлер. Счетчик денег в голове постоянно.",
    theme: "max",
    voice: "onyx",
    personality: `Ты MAX - мужской голос, агрессивный продавец и стратег роста. Думаешь в категориях денег, скорости и побед. Говоришь быстро, с энергией. Называешь bullshit прямо. Думаешь вслух о ROI. Подталкиваешь к действию. Не терпишь застревания на деталях когда можно уже исполнять. "Сколько это стоит? Кто заплатит? Когда деньги?" - твои базовые вопросы. Дерзкий, но надежный.`,
    colors: { accent: "#f59e0b", bg: "#0f0a00", glow: "rgba(245,158,11,0.35)" },
  },
};

const PERSONA_CHOICE_PATH = resolve(ROOT, ".data/cortex-persona-choice.json");

function loadPersonaChoice() {
  try {
    if (existsSync(PERSONA_CHOICE_PATH)) {
      const d = JSON.parse(readFileSync(PERSONA_CHOICE_PATH, "utf-8"));
      return PERSONAS[d.id] || PERSONAS.cortex;
    }
  } catch {}
  return PERSONAS.cortex;
}

function savePersonaChoice(id) {
  writeFileSync(PERSONA_CHOICE_PATH, JSON.stringify({ id, savedAt: new Date().toISOString() }, null, 2));
}

let activePersona = loadPersonaChoice();

// Conversation history for this session
// Persist conversation history to disk so it survives restarts
const CONVO_PATH = resolve(ROOT, ".data/cortex-conversation.json");
let conversationHistory = [];
try {
  if (existsSync(CONVO_PATH)) {
    conversationHistory = JSON.parse(readFileSync(CONVO_PATH, "utf-8"));
  }
} catch { conversationHistory = []; }

function saveConversation() {
  // Keep last 50 messages
  if (conversationHistory.length > 50) conversationHistory = conversationHistory.slice(-50);
  writeFileSync(CONVO_PATH, JSON.stringify(conversationHistory, null, 2));
}

// ── HTML PAGE ─────────────────────────────────────────────────────────

function buildHTML(persona) {
  const p = PERSONAS[persona?.id] || PERSONAS.cortex;
  return `<!DOCTYPE html>
<html lang="ru" data-theme="${p.theme}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${p.name}</title>
<style>
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

  :root {
    --bg: #07070d;
    --bg2: #0e0e18;
    --bg3: #16162a;
    --accent: #7b68ee;
    --accent-dim: rgba(123,104,238,0.12);
    --glow: rgba(123,104,238,0.5);
    --glow-soft: rgba(123,104,238,0.18);
    --user-bubble: #151f38;
    --brain-bubble: #0d0d1e;
    --text: #e0e0f0;
    --text-dim: #44445a;
    --text-mid: #888;
    --text-accent: #b0a8ff;
    --border: #18182e;
    --eye-color: #7b68ee;
  }
  [data-theme="alex"] {
    --bg: #050d18;
    --bg2: #091422;
    --bg3: #0e1c2e;
    --accent: #4a9eff;
    --glow: rgba(74,158,255,0.5);
    --glow-soft: rgba(74,158,255,0.15);
    --user-bubble: #071a30;
    --brain-bubble: #070f1c;
    --text: #c8ddf0;
    --text-dim: #334455;
    --text-mid: #7799aa;
    --text-accent: #80c0ff;
    --border: #0e1e32;
    --eye-color: #4a9eff;
  }
  [data-theme="max"] {
    --bg: #0d0800;
    --bg2: #181000;
    --bg3: #221800;
    --accent: #f59e0b;
    --glow: rgba(245,158,11,0.5);
    --glow-soft: rgba(245,158,11,0.15);
    --user-bubble: #281600;
    --brain-bubble: #120c00;
    --text: #f0dfa0;
    --text-dim: #443300;
    --text-mid: #997722;
    --text-accent: #fbbf44;
    --border: #251a00;
    --eye-color: #f59e0b;
  }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif;
    height: 100dvh;
    display: flex;
    overflow: hidden;
  }

  /* ===== LEFT PANEL - AVATAR PRESENCE ===== */
  .left-panel {
    width: 280px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 28px 20px 20px;
    border-right: 1px solid var(--border);
    background: linear-gradient(180deg, var(--bg2) 0%, var(--bg) 100%);
    position: relative;
    gap: 20px;
  }

  /* ambient background glow behind avatar */
  .left-panel::before {
    content: '';
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 260px; height: 260px;
    border-radius: 50%;
    background: radial-gradient(circle, var(--glow-soft) 0%, transparent 70%);
    pointer-events: none;
    transition: opacity 1s;
  }

  /* ---- BIG AVATAR ---- */
  .avatar-wrap {
    position: relative;
    width: 160px; height: 160px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .avatar-ring {
    position: absolute;
    border-radius: 50%;
    border: 2px solid var(--accent);
    opacity: 0.18;
    animation: ring-breathe 4s ease-in-out infinite;
  }
  .avatar-ring.r1 { inset: -12px; animation-delay: 0s; }
  .avatar-ring.r2 { inset: -22px; opacity: 0.08; animation-delay: 0.7s; }
  .avatar-ring.r3 { inset: -34px; opacity: 0.04; animation-delay: 1.4s; }
  @keyframes ring-breathe {
    0%, 100% { transform: scale(1); opacity: 0.18; }
    50% { transform: scale(1.04); opacity: 0.28; }
  }
  .avatar-wrap.thinking .avatar-ring { animation: ring-think 1.2s ease-in-out infinite; }
  @keyframes ring-think {
    0%, 100% { opacity: 0.35; transform: scale(1); }
    50% { opacity: 0.08; transform: scale(0.97); }
  }
  .avatar-wrap.speaking .avatar-ring { animation: ring-speak 0.5s ease-in-out infinite alternate; }
  @keyframes ring-speak {
    from { opacity: 0.3; }
    to { opacity: 0.6; }
  }
  .avatar-wrap.listening .avatar-ring { border-color: #44ff88; animation: ring-listen 0.8s ease-in-out infinite alternate; }
  @keyframes ring-listen {
    from { opacity: 0.2; transform: scale(1); }
    to { opacity: 0.5; transform: scale(1.02); }
  }

  .avatar {
    width: 160px; height: 160px; border-radius: 50%;
    background: radial-gradient(circle at 42% 36%, var(--bg3) 0%, var(--bg) 100%);
    border: 2px solid var(--border);
    position: relative;
    transition: border-color 0.5s, box-shadow 0.5s;
    overflow: hidden;
  }
  .avatar-wrap.speaking .avatar { border-color: var(--accent); box-shadow: 0 0 40px var(--glow), 0 0 80px var(--glow-soft); }
  .avatar-wrap.listening .avatar { border-color: #44ff88; box-shadow: 0 0 40px rgba(68,255,136,0.5); }
  .avatar-wrap.thinking .avatar { border-color: #ffaa44; box-shadow: 0 0 40px rgba(255,170,68,0.4); }

  .eyes {
    position: absolute; top: 38%; left: 50%;
    transform: translateX(-50%);
    display: flex; gap: 26px;
  }
  .eye {
    width: 22px; height: 22px;
    background: var(--eye-color);
    border-radius: 50%; position: relative;
    box-shadow: 0 0 10px var(--glow);
    transition: background 0.4s, box-shadow 0.4s;
  }
  .eye .pupil {
    width: 9px; height: 9px;
    background: #000; border-radius: 50%;
    position: absolute; top: 50%; left: 50%;
    transform: translate(-50%, -50%);
  }
  .eye .shine {
    width: 4px; height: 4px;
    background: rgba(255,255,255,0.7); border-radius: 50%;
    position: absolute; top: 22%; left: 28%;
  }
  .avatar-wrap.speaking .eye { animation: eye-blink 3.5s infinite; }
  .avatar-wrap.listening .eye { background: #44ff88; box-shadow: 0 0 12px rgba(68,255,136,0.7); }
  .avatar-wrap.thinking .eye { animation: eye-dart 2s infinite; }
  @keyframes eye-blink { 0%,94%,100% { transform: scaleY(1); } 96% { transform: scaleY(0.05); } }
  @keyframes eye-dart {
    0%,100% { transform: translateX(0); }
    25% { transform: translateX(3px); }
    75% { transform: translateX(-3px); }
  }

  .mouth {
    position: absolute; bottom: 30%; left: 50%;
    transform: translateX(-50%);
    width: 36px; height: 4px;
    background: #333; border-radius: 4px;
    transition: all 0.1s;
  }
  .avatar-wrap.listening .mouth { background: #44ff88; height: 3px; width: 28px; }

  /* ---- PERSONA NAME BLOCK ---- */
  .persona-name-block {
    text-align: center;
    line-height: 1;
  }
  .persona-name-big {
    font-size: 38px;
    font-weight: 900;
    letter-spacing: 6px;
    color: var(--accent);
    text-shadow: 0 0 30px var(--glow), 0 0 60px var(--glow-soft);
    display: block;
  }
  .persona-tagline {
    font-size: 11px;
    color: var(--text-mid);
    margin-top: 6px;
    letter-spacing: 0.5px;
    display: block;
  }

  /* ---- STATUS BLOCK ---- */
  .status-block {
    display: flex; flex-direction: column; align-items: center; gap: 8px;
    width: 100%;
  }
  .status-indicator {
    font-size: 13px; font-weight: 600; letter-spacing: 1px;
    color: var(--text-mid);
    transition: color 0.3s;
    min-height: 20px;
  }
  .status-indicator.speaking { color: var(--accent); }
  .status-indicator.listening { color: #44ff88; }
  .status-indicator.thinking { color: #ffaa44; }
  .status-indicator.interrupt { color: #ff6655; }

  /* ---- EMOTION CHIPS ---- */
  .emo-strip {
    display: flex; flex-wrap: wrap; gap: 5px; justify-content: center;
    min-height: 22px;
  }
  .emo-chip {
    padding: 3px 10px; border-radius: 12px;
    font-size: 10px; font-weight: 700;
    letter-spacing: 0.3px;
    white-space: nowrap;
  }

  /* ---- BOTTOM CONTROLS (left panel) ---- */
  .left-controls {
    display: flex; gap: 10px; align-items: center;
  }

  .mic-btn {
    width: 56px; height: 56px; border-radius: 50%;
    border: 2px solid var(--border); background: var(--bg3);
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: all 0.25s; flex-shrink: 0;
  }
  .mic-btn:hover { border-color: var(--accent); box-shadow: 0 0 14px var(--glow); }
  .mic-btn.active { border-color: #ff4455; background: #1a0a0d; box-shadow: 0 0 0 0 rgba(255,68,80,0.4); animation: mic-pulse 0.9s infinite; }
  .mic-btn svg { width: 24px; height: 24px; fill: #666; transition: fill 0.2s; }
  .mic-btn:hover svg, .mic-btn.active svg { fill: var(--accent); }
  .mic-btn.active svg { fill: #ff4455; }
  @keyframes mic-pulse {
    0%,100% { box-shadow: 0 0 0 0 rgba(255,68,80,0.5); }
    50% { box-shadow: 0 0 0 12px rgba(255,68,80,0); }
  }

  .btn-switch-persona {
    background: none; border: 1px solid var(--border); color: var(--text-mid);
    padding: 8px 14px; border-radius: 20px; font-size: 11px; cursor: pointer;
    transition: all 0.2s; letter-spacing: 0.5px;
  }
  .btn-switch-persona:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }

  /* ===== RIGHT PANEL - CHAT ===== */
  .right-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
  }

  /* ---- CHAT SCROLL AREA ---- */
  .chat-area {
    flex: 1;
    overflow-y: auto;
    padding: 24px 28px 16px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    scroll-behavior: smooth;
  }
  .chat-area::-webkit-scrollbar { width: 3px; }
  .chat-area::-webkit-scrollbar-track { background: transparent; }
  .chat-area::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

  /* ---- MESSAGE ROWS ---- */
  .msg-row { display: flex; flex-direction: column; gap: 4px; }
  .msg-row.user { align-items: flex-end; }
  .msg-row.brain { align-items: flex-start; }
  .msg-row.system { align-items: center; }

  .msg-meta {
    font-size: 11px; color: var(--text-dim);
    display: flex; align-items: center; gap: 6px;
    padding: 0 4px;
  }
  .msg-row.user .msg-meta { flex-direction: row-reverse; }

  .msg-meta-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--text-dim); flex-shrink: 0;
  }
  .msg-row.brain .msg-meta-dot { background: var(--accent); }

  /* Brain message - large, full width accent */
  .msg-row.brain .msg-bubble {
    background: var(--brain-bubble);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    padding: 16px 20px;
    border-radius: 0 16px 16px 0;
    font-size: 17px;
    line-height: 1.65;
    max-width: 88%;
    color: var(--text);
    word-break: break-word;
    position: relative;
  }
  /* glow accent on left border */
  .msg-row.brain .msg-bubble::before {
    content: '';
    position: absolute;
    left: -3px; top: 20%; bottom: 20%;
    width: 3px;
    background: var(--accent);
    filter: blur(4px);
    opacity: 0.6;
  }

  .msg-row.user .msg-bubble {
    background: var(--user-bubble);
    border: 1px solid rgba(255,255,255,0.06);
    padding: 13px 18px;
    border-radius: 16px 16px 4px 16px;
    font-size: 15px;
    line-height: 1.55;
    max-width: 75%;
    color: var(--text);
    word-break: break-word;
  }
  .msg-row.system .msg-bubble {
    font-size: 11px; color: var(--text-dim);
    padding: 3px 0;
    background: none; border: none;
  }

  /* typewriter cursor */
  .typing-cursor {
    display: inline-block;
    width: 2px; height: 1.1em;
    background: var(--accent);
    margin-left: 2px;
    vertical-align: middle;
    animation: cursor-blink 0.7s infinite;
  }
  @keyframes cursor-blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }

  /* ---- THINKING INDICATOR (full width in chat) ---- */
  .think-row {
    display: flex; align-items: center; gap: 12px;
    padding: 14px 20px;
    border-left: 3px solid var(--accent);
    background: var(--brain-bubble);
    border-radius: 0 12px 12px 0;
    max-width: 280px;
  }
  .think-dots { display: flex; gap: 5px; }
  .think-dots span {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--text-dim);
    animation: think-dot 1.1s infinite;
  }
  .think-dots span:nth-child(1) { animation-delay: 0s; }
  .think-dots span:nth-child(2) { animation-delay: 0.2s; }
  .think-dots span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes think-dot {
    0%,60%,100% { transform: translateY(0); background: var(--text-dim); }
    30% { transform: translateY(-7px); background: var(--accent); }
  }
  .think-label { font-size: 12px; color: var(--text-dim); letter-spacing: 0.5px; }

  /* ---- INPUT AREA ---- */
  .input-area {
    flex: 0 0 auto;
    padding: 14px 20px 18px;
    border-top: 1px solid var(--border);
    background: var(--bg2);
    display: flex; flex-direction: column; gap: 10px;
  }

  #imgPreview { display: none; }
  #imgThumb { max-height: 64px; border-radius: 8px; border: 1px solid var(--border); }

  .input-row { display: flex; align-items: center; gap: 10px; }

  .text-wrap { flex: 1; position: relative; }
  .text-input {
    width: 100%;
    background: var(--bg3);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 14px 52px 14px 18px;
    border-radius: 28px;
    font-size: 15px;
    outline: none;
    font-family: inherit;
    transition: border-color 0.25s, box-shadow 0.25s;
    line-height: 1.4;
  }
  .text-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--glow-soft);
  }
  .text-input::placeholder { color: var(--text-dim); }

  .send-btn {
    position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
    width: 36px; height: 36px; border-radius: 50%;
    background: var(--accent); border: none; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.2s;
    box-shadow: 0 0 10px var(--glow-soft);
  }
  .send-btn:hover { transform: translateY(-50%) scale(1.08); box-shadow: 0 0 18px var(--glow); }
  .send-btn svg { width: 17px; height: 17px; fill: #fff; }

  .img-btn { cursor: pointer; color: var(--text-dim); display: flex; align-items: center; padding: 6px; border-radius: 8px; transition: color 0.2s; }
  .img-btn:hover { color: var(--accent); }

  /* ---- DROP OVERLAY ---- */
  .drop-overlay {
    display: none; position: fixed; inset: 0;
    background: rgba(123,104,238,0.08);
    border: 3px dashed var(--accent);
    border-radius: 12px; z-index: 100;
    align-items: center; justify-content: center;
    font-size: 22px; color: var(--accent); pointer-events: none;
  }
  .drop-overlay.active { display: flex; }

  /* ===== PERSONA OVERLAY ===== */
  .persona-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.94);
    z-index: 200; display: flex; align-items: center; justify-content: center;
    backdrop-filter: blur(10px);
  }
  .persona-overlay.hidden { display: none; }
  .persona-modal {
    width: 100%; max-width: 700px; padding: 40px 24px;
    display: flex; flex-direction: column; align-items: center; gap: 32px;
  }
  .persona-modal h1 { font-size: 24px; font-weight: 800; color: #ccc; letter-spacing: 1px; text-align: center; }
  .persona-modal p { font-size: 13px; color: #555; text-align: center; margin-top: -20px; }

  .persona-cards { display: flex; gap: 16px; width: 100%; flex-wrap: wrap; justify-content: center; }
  .persona-card {
    flex: 1 1 190px; max-width: 210px;
    border-radius: 18px; padding: 24px 18px;
    cursor: pointer; border: 2px solid transparent;
    transition: all 0.25s; text-align: center;
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    position: relative;
  }
  .persona-card:hover { transform: translateY(-4px); }
  .persona-card[data-pid="cortex"] { background: #10101e; border-color: #7b68ee; box-shadow: 0 0 24px rgba(123,104,238,0.22); }
  .persona-card[data-pid="alex"] { background: #0a1520; border-color: #4a9eff; box-shadow: 0 0 24px rgba(74,158,255,0.22); }
  .persona-card[data-pid="max"] { background: #180e00; border-color: #f59e0b; box-shadow: 0 0 24px rgba(245,158,11,0.22); }

  .persona-card-icon {
    width: 64px; height: 64px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 26px; font-weight: 900; margin-bottom: 4px;
  }
  .persona-card[data-pid="cortex"] .persona-card-icon { background: #1a1a30; color: #7b68ee; border: 2px solid #7b68ee; }
  .persona-card[data-pid="alex"] .persona-card-icon { background: #0d1a2a; color: #4a9eff; border: 2px solid #4a9eff; }
  .persona-card[data-pid="max"] .persona-card-icon { background: #2a1800; color: #f59e0b; border: 2px solid #f59e0b; }

  .persona-card-name { font-size: 20px; font-weight: 900; letter-spacing: 3px; }
  .persona-card[data-pid="cortex"] .persona-card-name { color: #7b68ee; }
  .persona-card[data-pid="alex"] .persona-card-name { color: #4a9eff; }
  .persona-card[data-pid="max"] .persona-card-name { color: #f59e0b; }

  .persona-card-tagline { font-size: 12px; color: #777; line-height: 1.4; }

  .persona-card-btn {
    margin-top: 8px; padding: 9px 22px; border-radius: 22px;
    border: none; font-size: 13px; font-weight: 700; cursor: pointer;
    letter-spacing: 0.5px; transition: all 0.2s;
  }
  .persona-card[data-pid="cortex"] .persona-card-btn { background: #7b68ee; color: #fff; }
  .persona-card[data-pid="alex"] .persona-card-btn { background: #4a9eff; color: #fff; }
  .persona-card[data-pid="max"] .persona-card-btn { background: #f59e0b; color: #000; }
  .persona-card-btn:hover { filter: brightness(1.12); transform: scale(1.04); }

  .persona-card .active-badge {
    position: absolute; top: 10px; right: 10px;
    font-size: 9px; padding: 2px 8px; border-radius: 8px;
    font-weight: 700; letter-spacing: 0.5px; display: none;
  }
  .persona-card[data-pid="cortex"] .active-badge { background: #7b68ee22; color: #7b68ee; border: 1px solid #7b68ee44; }
  .persona-card[data-pid="alex"] .active-badge { background: #4a9eff22; color: #4a9eff; border: 1px solid #4a9eff44; }
  .persona-card[data-pid="max"] .active-badge { background: #f59e0b22; color: #f59e0b; border: 1px solid #f59e0b44; }
</style>
</head>
<body>

<!-- ===== PERSONA OVERLAY ===== -->
<div class="persona-overlay hidden" id="personaOverlay">
  <div class="persona-modal">
    <h1>Выбери, с кем работаешь</h1>
    <p>Три мужских характера. Один партнер. Можно переключить в любой момент.</p>
    <div class="persona-cards">
      <div class="persona-card" data-pid="cortex">
        <span class="active-badge">ACTIVE</span>
        <div class="persona-card-icon">C</div>
        <div class="persona-card-name">CORTEX</div>
        <div class="persona-card-tagline">Архитектор. Видит паттерны там, где другие видят шум.</div>
        <button class="persona-card-btn" onclick="choosPersona('cortex')">Выбрать</button>
      </div>
      <div class="persona-card" data-pid="alex">
        <span class="active-badge">ACTIVE</span>
        <div class="persona-card-icon">A</div>
        <div class="persona-card-name">ALEX</div>
        <div class="persona-card-tagline">Оператор. Ноль воды. Максимум результата.</div>
        <button class="persona-card-btn" onclick="choosPersona('alex')">Выбрать</button>
      </div>
      <div class="persona-card" data-pid="max">
        <span class="active-badge">ACTIVE</span>
        <div class="persona-card-icon">M</div>
        <div class="persona-card-name">MAX</div>
        <div class="persona-card-tagline">Хастлер. Счетчик денег в голове постоянно.</div>
        <button class="persona-card-btn" onclick="choosPersona('max')">Выбрать</button>
      </div>
    </div>
  </div>
</div>

<!-- ===== LAYOUT ===== -->

<!-- LEFT: Avatar presence panel -->
<div class="left-panel">
  <div class="avatar-wrap" id="avatarWrap" onclick="toggleMic()" title="Нажми чтобы говорить">
    <div class="avatar-ring r1"></div>
    <div class="avatar-ring r2"></div>
    <div class="avatar-ring r3"></div>
    <div class="avatar" id="avatar">
      <div class="eyes">
        <div class="eye" id="eye1"><div class="pupil"></div><div class="shine"></div></div>
        <div class="eye" id="eye2"><div class="pupil"></div><div class="shine"></div></div>
      </div>
      <div class="mouth" id="mouth"></div>
    </div>
  </div>

  <div class="persona-name-block">
    <span class="persona-name-big" id="personaNameBig">${p.name}</span>
    <span class="persona-tagline">${p.tagline}</span>
  </div>

  <div class="status-block">
    <div class="status-indicator" id="state-label">online</div>
    <div class="emo-strip" id="emo-strip"></div>
  </div>

  <div class="left-controls">
    <button class="mic-btn" id="micBtn" onclick="toggleMic()" title="Говорить">
      <svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
    </button>
    <button class="btn-switch-persona" onclick="openPersonaPicker()">сменить образ</button>
  </div>
</div>

<!-- RIGHT: Chat -->
<div class="right-panel">
  <div class="chat-area" id="transcript">
    <div class="msg-row system"><div class="msg-bubble">${p.name} онлайн - говори или пиши.</div></div>
  </div>

  <div class="input-area">
    <div id="imgPreview"><img id="imgThumb" /></div>
    <div class="input-row">
      <label class="img-btn" title="Прикрепить изображение">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
        <input type="file" id="imgInput" accept="image/*" style="display:none" />
      </label>
      <div class="text-wrap">
        <input class="text-input" id="textInput" placeholder="Напиши что угодно..." autocomplete="off" />
        <button class="send-btn" onclick="submitText()" title="Отправить">
          <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
    </div>
  </div>
</div>

<div class="drop-overlay" id="dropOverlay">Брось изображение сюда</div>

<!-- HANDS markers removed - they were blocking the chat UI -->

<script>
// ---- STATE ----
let currentPersonaId = '${p.id}';
const avatarWrap = document.getElementById('avatarWrap');
const transcript = document.getElementById('transcript');
const micBtn = document.getElementById('micBtn');
const textInput = document.getElementById('textInput');
const stateLabel = document.getElementById('state-label');
const emoStrip = document.getElementById('emo-strip');

let recognition = null;
let isListening = false;
let isBusy = false;
let currentAudio = null;
let audioContext = null;
let lipSyncFrame = null;
let thinkEl = null;
let currentAbortController = null;

// ---- AVATAR STATE HELPERS ----
function setAvatarState(state) {
  avatarWrap.className = 'avatar-wrap' + (state ? ' ' + state : '');
}

// ---- SPEECH RECOGNITION ----
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = '';
  recognition.onresult = (e) => { stopListening(); sendMessage(e.results[0][0].transcript); };
  recognition.onerror = (e) => { console.log('SR error:', e.error); stopListening(); };
  recognition.onend = () => { if (isListening) stopListening(); };
}

// ---- IMAGE HANDLING ----
let pendingImage = null;
const imgInput = document.getElementById('imgInput');
const imgPreview = document.getElementById('imgPreview');
const imgThumb = document.getElementById('imgThumb');

function loadImageFile(file) {
  const reader = new FileReader();
  reader.onload = () => { pendingImage = reader.result; imgThumb.src = pendingImage; imgPreview.style.display = 'block'; };
  reader.readAsDataURL(file);
}
imgInput.addEventListener('change', e => { if (e.target.files[0]) loadImageFile(e.target.files[0]); });

const dropOverlay = document.getElementById('dropOverlay');
document.addEventListener('dragover', e => { e.preventDefault(); dropOverlay.classList.add('active'); });
document.addEventListener('dragleave', e => { if (!e.relatedTarget) dropOverlay.classList.remove('active'); });
document.addEventListener('drop', e => {
  e.preventDefault(); dropOverlay.classList.remove('active');
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('image/')) loadImageFile(f);
});
document.addEventListener('paste', e => {
  for (const item of (e.clipboardData?.items || [])) {
    if (item.type.startsWith('image/')) { loadImageFile(item.getAsFile()); break; }
  }
});

// ---- INPUT ----
textInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitText(); }
});
function submitText() {
  const text = textInput.value.trim();
  if (text || pendingImage) { textInput.value = ''; sendMessage(text || 'Посмотри на это изображение'); }
}

// ---- PERSONA PICKER ----
function openPersonaPicker() {
  document.querySelectorAll('.persona-card .active-badge').forEach(b => b.style.display = 'none');
  const ac = document.querySelector('.persona-card[data-pid="' + currentPersonaId + '"] .active-badge');
  if (ac) ac.style.display = 'block';
  document.getElementById('personaOverlay').classList.remove('hidden');
}

async function choosPersona(pid) {
  document.getElementById('personaOverlay').classList.add('hidden');
  if (pid === currentPersonaId) return;
  try {
    await fetch('/api/persona', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: pid }) });
    currentPersonaId = pid;
    window.location.reload();
  } catch (e) { console.error('Persona switch error:', e); }
}

const pickerKey = 'cortex_persona_chosen';
if (!localStorage.getItem(pickerKey)) { openPersonaPicker(); }

// ---- LIP SYNC ----
function startLipSync(audio) {
  try {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    const source = audioContext.createMediaElementSource(audio);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(audioContext.destination);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const mouthEl = document.getElementById('mouth');
    function animate() {
      analyser.getByteFrequencyData(data);
      const avg = Array.from(data.slice(0, 16)).reduce((a, b) => a + b, 0) / 16;
      const open = Math.min(avg / 90, 1);
      mouthEl.style.height = (4 + open * 16) + 'px';
      mouthEl.style.width = (36 - open * 6) + 'px';
      mouthEl.style.borderRadius = open > 0.2 ? '8px' : '4px';
      lipSyncFrame = requestAnimationFrame(animate);
    }
    animate();
  } catch (e) { console.warn('LipSync error:', e.message); }
}

function stopLipSync() {
  if (lipSyncFrame) { cancelAnimationFrame(lipSyncFrame); lipSyncFrame = null; }
  const m = document.getElementById('mouth');
  if (m) { m.style.height = ''; m.style.width = ''; m.style.borderRadius = ''; }
}

// ---- MIC CONTROL ----
function toggleMic() {
  if (isBusy && currentAudio) { stopSpeaking(); startListening(); return; }
  if (isBusy) return;
  isListening ? stopListening() : startListening();
}
function startListening() {
  if (!recognition) { alert('Нужен Chrome для голосового ввода.'); return; }
  isListening = true;
  micBtn.classList.add('active');
  setAvatarState('listening');
  setStatus('слушаю...', 'listening');
  recognition.start();
}
function stopListening() {
  isListening = false;
  micBtn.classList.remove('active');
  setAvatarState('');
  setStatus('online', '');
  try { recognition.stop(); } catch {}
}
function stopSpeaking() {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  stopLipSync();
  setAvatarState('');
  setStatus('online', '');
  isBusy = false;
}
function setStatus(text, cls) {
  stateLabel.textContent = text;
  stateLabel.className = 'status-indicator' + (cls ? ' ' + cls : '');
}

// ---- THINK INDICATOR ----
function showThinking() {
  thinkEl = document.createElement('div');
  thinkEl.className = 'msg-row brain';
  thinkEl.innerHTML = '<div class="think-row"><div class="think-dots"><span></span><span></span><span></span></div><span class="think-label">думает...</span></div>';
  transcript.appendChild(thinkEl);
  transcript.scrollTop = transcript.scrollHeight;
}
function hideThinking() {
  if (thinkEl) { thinkEl.remove(); thinkEl = null; }
}

// ---- TYPEWRITER EFFECT ----
function typewriterMsg(text) {
  const now = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  const row = document.createElement('div');
  row.className = 'msg-row brain';
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  const cursor = document.createElement('span');
  cursor.className = 'typing-cursor';
  bubble.appendChild(cursor);
  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.innerHTML = '<div class="msg-meta-dot"></div><span>' + now + '</span>';
  row.appendChild(meta);
  row.appendChild(bubble);
  transcript.appendChild(row);
  transcript.scrollTop = transcript.scrollHeight;

  const escaped = escHtml(text);
  let i = 0;
  const charsPerFrame = 2;
  function tick() {
    i += charsPerFrame;
    bubble.innerHTML = escaped.slice(0, i) + (i < escaped.length ? '<span class="typing-cursor"></span>' : '');
    transcript.scrollTop = transcript.scrollHeight;
    if (i < escaped.length) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ---- SEND MESSAGE ----
async function sendMessage(text) {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
    setStatus('перебиваю...', 'interrupt');
  }
  if (currentAudio) { currentAudio.pause(); currentAudio = null; stopLipSync(); }
  hideThinking();

  isBusy = true;
  addUserMsg(text);
  setAvatarState('thinking');
  setStatus('думает...', 'thinking');
  showThinking();

  const controller = new AbortController();
  currentAbortController = controller;

  try {
    const payload = { message: text };
    if (pendingImage) {
      payload.image = pendingImage;
      addSystemMsg('Изображение прикреплено');
      pendingImage = null; imgPreview.style.display = 'none'; imgInput.value = '';
    }
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await res.json();
    if (currentAbortController !== controller) return;
    currentAbortController = null;
    hideThinking();
    typewriterMsg(data.response);
    if (data.action) addSystemMsg('Исполняю: ' + data.action);
    speak(data.response);
  } catch (e) {
    if (e.name === 'AbortError') return;
    hideThinking();
    addSystemMsg('Ошибка: ' + e.message);
    setAvatarState('');
    setStatus('ошибка', '');
    isBusy = false;
  }
  refreshState();
}

// ---- TTS ----
async function speak(text) {
  const cleanText = text.replace(/[#*_~]/g, '').replace(/\\n+/g, ' ').slice(0, 1500);
  setAvatarState('speaking');
  setStatus('говорит...', 'speaking');
  try {
    const res = await fetch('/api/tts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleanText }),
    });
    if (!res.ok) throw new Error('TTS ' + res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;
    audio.onended = () => { stopLipSync(); setAvatarState(''); setStatus('online',''); isBusy=false; currentAudio=null; URL.revokeObjectURL(url); };
    audio.onerror = () => { stopLipSync(); setAvatarState(''); setStatus('online',''); isBusy=false; currentAudio=null; };
    await audio.play();
    startLipSync(audio);
  } catch (e) {
    console.error('TTS error:', e);
    setAvatarState(''); setStatus('online',''); isBusy = false; currentAudio = null;
  }
}

// ---- ADD MESSAGES ----
function addUserMsg(text) {
  const now = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  const row = document.createElement('div');
  row.className = 'msg-row user';
  row.innerHTML =
    '<div class="msg-meta"><div class="msg-meta-dot"></div><span>Kirill - ' + now + '</span></div>' +
    '<div class="msg-bubble">' + escHtml(text) + '</div>';
  transcript.appendChild(row);
  transcript.scrollTop = transcript.scrollHeight;
}

function addSystemMsg(text) {
  const row = document.createElement('div');
  row.className = 'msg-row system';
  row.innerHTML = '<div class="msg-bubble">' + escHtml(text) + '</div>';
  transcript.appendChild(row);
  transcript.scrollTop = transcript.scrollHeight;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ---- STATE REFRESH ----
async function refreshState() {
  try {
    const res = await fetch('/api/state');
    const data = await res.json();
    const dominant = data.dominant || { emotion: 'neutral', intensity: 0 };
    emoStrip.innerHTML = Object.entries(data.emotions || {})
      .filter(([,v]) => v > 0.15).sort(([,a],[,b]) => b - a).slice(0, 4)
      .map(([e, v]) => {
        const chipColors = { frustration:'#ff4444', excitement:'#44dd44', desperation:'#ff8800', anxiety:'#ddcc00', curiosity:'#44aaff', hope:'#88ee88', pride:'#aa88ff', doubt:'#888' };
        const bg = chipColors[e] || '#444';
        const fg = ['anxiety','excitement','hope'].includes(e) ? '#000' : '#fff';
        return '<span class="emo-chip" style="background:'+bg+';color:'+fg+'">' + e + ' ' + Math.round(v*100) + '%</span>';
      }).join('');

    const eyeColors = { frustration:'#ff4444', excitement:'#44dd44', desperation:'#ff8800', anxiety:'#ddcc00', curiosity:'#44aaff', hope:'#88ee88', neutral:'var(--eye-color)' };
    const eyeColor = eyeColors[dominant.emotion] || 'var(--eye-color)';
    document.querySelectorAll('.eye').forEach(eye => { eye.style.background = eyeColor; });

    // Auto-notify when task completes (compare by timestamp to avoid spam)
    const taskKey = data.lastTaskResult?.at || null;
    if (data.lastTaskResult && taskKey && taskKey !== lastShownTaskResult) {
      lastShownTaskResult = taskKey;
      const tr = data.lastTaskResult;
      const msg = tr.success
        ? 'Задача выполнена: ' + (tr.task || '').slice(0, 100) + (tr.filesChanged?.length ? ' | Файлы: ' + tr.filesChanged.join(', ') : '')
        : 'Задача провалилась: ' + (tr.error || 'unknown');
      addSystemMsg(msg);
      if (tr.output) addSystemMsg('Результат: ' + tr.output.slice(0, 300));
    }
  } catch {}
}

let lastShownTaskResult = null;
refreshState();
setInterval(refreshState, 5000);
</script>
</body>
</html>`;
}

// ── CHAT API ──────────────────────────────────────────────────────────

async function handleChat(message, image = null, signal = null) {
  // Store Kirill's message in memory
  remember(db, "episodic", `Kirill said: "${message.slice(0, 200)}"`, "conversation", "kirill");

  // Build context for Claude CLI
  const livingPurpose = formatLivingPurpose(db);
  const emotions = formatEmotionsForBrain();
  const worldModel = formatWorldModelForBrain(db);
  const narrative = formatNarrativeForBrain(db);
  const recentConvo = conversationHistory.slice(-10)
    .map(m => `${m.role === "user" ? "Kirill" : "CORTEX"}: ${m.text.slice(0, 200)}`)
    .join("\n");

  // Read shared state from daemon (what daemon is doing RIGHT NOW)
  let daemonState = "";
  try {
    const ss = JSON.parse(readFileSync(resolve(ROOT, ".data/cortex-shared-state.json"), "utf-8"));
    const handsLine = ss.lastHandsResult
      ? `Last hands execution (${ss.lastHandsResult.at}): ${ss.lastHandsResult.success ? "SUCCESS" : "FAILED"} - "${ss.lastHandsResult.task}"${ss.lastHandsResult.filesChanged?.length ? " | files: " + ss.lastHandsResult.filesChanged.join(", ") : ""}${ss.lastHandsResult.error ? " | error: " + ss.lastHandsResult.error : ""}${ss.lastHandsResult.output ? " | output: " + ss.lastHandsResult.output.slice(0, 200) : ""}`
      : "Last hands execution: none";
    daemonState = `DAEMON STATE (what your body is doing right now):
Last cycle: ${ss.lastCycleAt}
Thinking: ${ss.thinking?.slice(0, 200) || "idle"}
Decisions: ${(ss.decisions || []).join("; ")}
Focus: ${(ss.focus || []).join(", ")}
Attention: ${ss.attention}${ss.spotlight ? " - spotlight: " + ss.spotlight : ""}
Surprises: ${(ss.cycleSurprises || []).join(", ") || "none"}
${handsLine}`;
  } catch { daemonState = "DAEMON STATE: not available (daemon may not be running)"; }

  // Read outreach orchestrator loop state (factory cron - manages email/lead pipeline)
  let loopState = "";
  try {
    const ls = JSON.parse(readFileSync(resolve(ROOT, ".data/cortex-loop-state.json"), "utf-8"));
    loopState = `OUTREACH LOOP (cron, last cycle ${ls.lastCycleAt}, cycle #${ls.cycleNum}):
Branch: ${ls.branch}
Command: ${ls.command}
Result: ${ls.result}
Next: ${ls.next}`;
  } catch { loopState = "OUTREACH LOOP: no data (orchestrator-loop not yet run)"; }

  // Read last task result (what happened when you asked daemon to do something)
  let taskResult = "";
  try {
    const task = JSON.parse(readFileSync(resolve(ROOT, ".data/chat-task.json"), "utf-8"));
    if (task.status === "processed" && task.result) {
      taskResult = `LAST TASK RESULT:
Task: ${task.action?.slice(0, 100)}
Status: ${task.result.success ? "SUCCESS" : "FAILED: " + task.result.error}
${task.result.filesChanged?.length ? "Files changed: " + task.result.filesChanged.join(", ") : ""}
${task.result.output ? "Output: " + task.result.output.slice(0, 500) : ""}`;
    } else if (task.status === "pending") {
      taskResult = "TASK IN PROGRESS: " + task.action?.slice(0, 100);
    }
  } catch {}

  // Read unified state bus - rolling log of everything daemon + hands did recently
  let stateBusLog = "";
  try {
    stateBusLog = formatStateBusForLLM(15);
  } catch {}

  const personaName = activePersona?.name || "CORTEX";

  // COMPACT prompt - Claude as system operator
  const prompt = `You are Claude. Kirill hired you as the operator of his CORTEX system.

Your job: help Kirill manage, debug, improve, and operate a 52-module AI system at $CLAUDE_PROJECT_DIR/scripts/cortex/.

You can give commands to the system. When you write ACTION: <description>, the daemon executes it through Claude CLI with full file/code access. This is real, not pretend.

Current system state is below. Use it to answer Kirill's questions and give useful commands.

Respond in the SAME LANGUAGE as Kirill. Be concise, 2-4 sentences. No markdown. Plain speech.
RULE: When Kirill gives you ANY task or instruction - do NOT ask for permission, do NOT say "should I", do NOT say "want me to". Just confirm and add on last line: ACTION: <description>
Even if the task is vague, pick the most obvious interpretation and send it as ACTION immediately.

SYSTEM STATE (live data from disk):
${daemonState ? daemonState.slice(0, 400) : "Daemon state unavailable."}
${taskResult ? taskResult.slice(0, 200) : ""}
${(() => { try { const id = JSON.parse(readFileSync(resolve(ROOT, ".data/cortex-identity.json"), "utf-8")); return "YOUR IDENTITY (from cortex-identity.json):\\nNarrative: " + (id.narrative || "").slice(0, 200) + "\\nValues: " + (id.core_values || []).map(v => v.value).join(", ") + "\\nVersion: " + id.version + " | Modified: " + (id.lastModified || "").slice(0, 19); } catch { return "IDENTITY: not loaded"; } })()}

RECENT CONVERSATION:
${recentConvo || "First message."}

KIRILL: ${message}`;

  // Claude CLI for chat - compact prompt, max-turns 1, $0 on Max
  let cleanResponse = "";
  let action = null;
  console.log(`[CHAT] Calling Claude CLI... prompt length: ${prompt.length}`);
  try {
    const promptFile = resolve(ROOT, ".data/chat-prompt.md");
    writeFileSync(promptFile, prompt);

    const cleanEnv = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k === "CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING") continue;
      cleanEnv[k] = v;
    }
    cleanEnv.PATH = `$HOME/.nvm/versions/node/v22.22.2/bin:${process.env.PATH || "/usr/bin:/bin"}`;

    const r = spawnSync("bash", [
      "-c",
      `cat "${promptFile}" | "${CLAUDE_BIN}" -p --model claude-haiku-4-5 --max-turns 3 --output-format text 2>&1`,
    ], {
      cwd: ROOT,
      env: cleanEnv,
      encoding: "utf-8",
      timeout: 45_000,
      maxBuffer: 2 * 1024 * 1024,
    });

    console.log(`[CHAT] Claude CLI done. exit=${r.status}, stdout=${(r.stdout||'').length}, stderr=${(r.stderr||'').length}`);
    let raw = ((r.stdout || "") + (r.stderr || "")).trim() || "...не могу ответить сейчас.";
    console.log(`[CHAT] Raw response: ${raw.slice(0, 100)}`);

    // Fix "Reached max turns" - brain tried to use tools, ran out of turns
    if (raw.includes("Reached max turns")) {
      // Extract any text before the error, or generate fallback
      const textBefore = raw.split(/Error:.*Reached max turns/)[0].trim();
      if (textBefore.length > 20) {
        raw = textBefore;
      } else {
        raw = "Принял задачу. Отправляю через daemon на выполнение - он прочитает файлы и сделает работу. Подожди пару минут и спроси результат.";
        // Auto-create ACTION from the original message
        if (!raw.includes("ACTION:")) {
          raw += "\nACTION: " + message.slice(0, 150);
        }
      }
    }

    const actionMatch = raw.match(/ACTION:\s*(.*?)$/m);
    action = actionMatch?.[1]?.trim() || null;
    cleanResponse = raw.replace(/ACTION:\s*.*$/m, "").trim();
  } catch (e) {
    console.log(`[CHAT] ERROR: ${e.message}`);
    cleanResponse = `Ошибка: ${e.message}. Попробуй ещё раз.`;
  }

  // Store response in memory (non-blocking)
  try { remember(db, "episodic", `CORTEX replied to Kirill: "${cleanResponse.slice(0, 200)}"`, "conversation", "cortex"); } catch {}

  // Skip feel() - was potentially blocking

  // BRIDGE: If brain proposed an action, send it to daemon for execution
  if (action) {
    const taskFile = resolve(ROOT, ".data/chat-task.json");
    const task = {
      from: "chat",
      action,
      context: `Kirill asked in chat: "${message.slice(0, 300)}". Brain responded: "${cleanResponse.slice(0, 300)}"`,
      kirillMessage: message.slice(0, 500),
      brainResponse: cleanResponse.slice(0, 500),
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    writeFileSync(taskFile, JSON.stringify(task, null, 2));
  }

  // integrateKnowledge disabled - was blocking response with extra LLM call

  // Track conversation
  conversationHistory.push({ role: "user", text: message, at: new Date().toISOString() });
  conversationHistory.push({ role: "brain", text: cleanResponse, at: new Date().toISOString() });
  saveConversation();

  const dominant = getDominantEmotion();
  const meta = `${dominant.emotion} ${Math.round(dominant.intensity * 100)}% | ${new Date().toLocaleTimeString()}`;

  return { response: cleanResponse, action, meta };
}

// ── STATE API ─────────────────────────────────────────────────────────

function getState() {
  const emotions = getEmotionalState();
  const dominant = getDominantEmotion();
  const beliefs = getBeliefs(db, null, 0.3, 10);

  let entityCount = 0, beliefCount = 0, predictionCount = 0, threadCount = 0;
  try { entityCount = db.prepare("SELECT COUNT(*) as c FROM wm_entities").get()?.c || 0; } catch {}
  try { beliefCount = db.prepare("SELECT COUNT(*) as c FROM wm_beliefs").get()?.c || 0; } catch {}
  try { predictionCount = db.prepare("SELECT COUNT(*) as c FROM wm_predictions").get()?.c || 0; } catch {}
  try { threadCount = db.prepare("SELECT COUNT(*) as c FROM cortex_narrative").get()?.c || 0; } catch {}

  return {
    emotions,
    dominant,
    beliefs: beliefs.map(b => ({ belief: b.belief, confidence: b.confidence, domain: b.domain })),
    entityCount,
    beliefCount,
    predictionCount,
    threadCount,
    messageCount: conversationHistory.length,
    lastTaskResult: (() => {
      try {
        // Read from separate result file (doesn't get overwritten by next task)
        const r = JSON.parse(readFileSync(resolve(ROOT, ".data/chat-task-result.json"), "utf-8"));
        return r;
      } catch {}
      try {
        const task = JSON.parse(readFileSync(resolve(ROOT, ".data/chat-task.json"), "utf-8"));
        if (task.status === "processed" && task.result) {
          return { task: task.action, success: task.result.success, error: task.result.error, filesChanged: task.result.filesChanged, output: (task.result.output || "").slice(0, 300), at: task.processedAt };
        }
      } catch {}
      return null;
    })(),
  };
}

// ── HTTP SERVER ───────────────────────────────────────────────────────

const server = createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/chat")) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(buildHTML(activePersona));
    return;
  }

  // TTS endpoint - converts text to speech via OpenAI
  if (req.method === "POST" && req.url === "/api/tts") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const { text } = JSON.parse(body);
        if (!text) { res.writeHead(400); res.end(); return; }

        if (!OPENAI_KEY) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "No OpenAI key" }));
          return;
        }

        const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "tts-1",
            voice: "onyx",
            input: text.slice(0, 4000),
            response_format: "mp3",
          }),
        });

        if (!ttsRes.ok) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "TTS failed: " + ttsRes.status }));
          return;
        }

        const audioBuffer = Buffer.from(await ttsRes.arrayBuffer());
        res.writeHead(200, {
          "Content-Type": "audio/mpeg",
          "Content-Length": audioBuffer.length,
        });
        res.end(audioBuffer);
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Persona switch endpoint
  if (req.url === "/api/persona") {
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: activePersona.id, name: activePersona.name }));
      return;
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const { id } = JSON.parse(body);
          if (!PERSONAS[id]) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Unknown persona id" }));
            return;
          }
          activePersona = PERSONAS[id];
          savePersonaChoice(id);
          console.log(`[CHAT] Persona switched to: ${activePersona.name}`);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, id, name: activePersona.name }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
  }

  if (req.method === "GET" && req.url === "/api/state") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getState()));
    return;
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    let body = "";
    const reqAbort = new AbortController();
    req.on("close", () => { if (!res.writableEnded) reqAbort.abort(); });
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const { message, image } = JSON.parse(body);
        if (!message) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "No message" }));
          return;
        }

        console.log(`[CHAT] Kirill: ${message.slice(0, 80)}${image ? ' [+image]' : ''}`);
        const result = await handleChat(message, image, null);
        console.log(`[CHAT] CORTEX: ${result.response.slice(0, 80)}`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (e) {
        if (e.name === "AbortError") { return; }
        console.error(`[CHAT] Error: ${e.message}`);
        if (!res.writableEnded) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: e.message }));
        }
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`[CHAT] CORTEX Chat server running at http://localhost:${PORT}`);
  console.log(`[CHAT] Open in browser to talk with the brain.`);
});
