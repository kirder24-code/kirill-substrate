# Substrate

**An autonomous AI operating system built solo in 37 days.**

459 modules across 14 departments. 16,611 wiki entries. 591 organism beliefs in a persistent graph. 144 commits. 1 developer.

A single-person experiment in what one operator + LLMs can ship when you treat AI as production infrastructure rather than a chatbot wrapper.

Built April 6 - May 13, 2026 by Kirill D.

---

## Why this exists

I wanted to find out what an AI system looks like when you stop building "agents that answer questions" and start building an organism: persistent memory that survives across sessions, a learning loop that updates behavior from real conversations, verification gates that refuse to claim "done" without evidence, and multi-vendor LLM routing as production infrastructure rather than a prompt-in-a-textbox.

Substrate is the result. It is not a framework. It is not a library. It is a working installation of a single-tenant AI operating system, with real cognitive layers, real disciplined execution, and a closed learning loop.

---

## At a glance

| | |
|---|---|
| **Code modules** | 477 (JavaScript ESM / TypeScript / Python) |
| **Languages** | Node.js (ESM `.mjs`), Python 3.13, TypeScript, React Native |
| **Wiki entries** | 16,611 markdown documents |
| **Organism beliefs** | 591 (in persistent SQLite graph) |
| **Tracked outcomes** | 912 |
| **Active behavioral directives** | 14 (extracted from operator voice via learning loop) |
| **Auto-loaded memory files** | 139 (4 types: user / feedback / project / reference) |
| **Cortex state files** | 88 (json + md, surviving across sessions) |
| **Multi-vendor LLM providers** | Anthropic Claude, OpenAI GPT, Google Gemini, Groq Llama |
| **Build window** | April 6 - May 13, 2026 (37 days, solo) |
| **Commits** | 144 |

---

## Architecture: 5 layers

```
┌──────────────────────────────────────────────────────────────┐
│ 1. AIR — Operator Interface                                  │
│    Tolik Mission Control (voice + browser UI),               │
│    49 registered tools, push-to-talk, slash commands         │
├──────────────────────────────────────────────────────────────┤
│ 2. DISCIPLINE — Honesty Enforcement                          │
│    ISA gate, Egress guard, Injection scanner,                │
│    Billing guard, Safe-send wrapper, Verification Doctrine   │
├──────────────────────────────────────────────────────────────┤
│ 3. BRAIN — Cortex (135 cognitive modules)                    │
│    Perception, working memory, attention, meta-observer,     │
│    emotions, dreams, hunger engine, curiosity, world model,  │
│    deep-think 3-stage adversarial reasoning, free-think      │
├──────────────────────────────────────────────────────────────┤
│ 4. DEPARTMENTS — Specialized Workstreams                     │
│    Factory (146) · Outreach (50) · Survival (40)             │
│    Organism (25) · Content / Visual Agent (24) · Tolik (23)  │
│    Jobs aggregator · Policy · Automation · Jarvis layer      │
├──────────────────────────────────────────────────────────────┤
│ 5. SOIL — Memory & Persistence                               │
│    SQLite belief graph (591 beliefs, 912 outcomes),          │
│    16,611-entry Wiki Brain, 139 auto-memory files,           │
│    cortex state json/md, content-store with history          │
└──────────────────────────────────────────────────────────────┘
```

---

## Cognitive layers (the Cortex)

135 modules implementing a functionalist cognitive architecture inspired by Global Workspace Theory and active-inference reasoning.

| Module group | What it does |
|---|---|
| **cortex-executor** | Causal-closure engine: every action produces a verifiable artifact within a bounded scope or escalates |
| **perception** | Sensory-grounded loop that converts raw events into typed perceptions before reasoning |
| **working-memory** | Active integration tier, not just retrieval. Keeps salient items hot for the next decision cycle |
| **goal-formation** | Autonomous goal proposal grounded in mission injection + recent outcomes |
| **meta-observer** | Watches the system reason about itself, flags loops and contradictions |
| **deep-think** | 3-stage adversarial reasoning: Planner (GPT-4o) → Critic (GPT-4o-mini) → Resolver |
| **free-think** | Unconstrained reasoning over current beliefs without task context |
| **world-model** | Belief graph + prediction layer; integrates new knowledge into existing structure |
| **emotions / dreams / curiosity / hunger** | Affective drivers that bias attention and action selection |
| **causal-reasoning / causal-world-model** | Track which decisions led to which outcomes for learning |
| **evolution-engine** | Mutates strategies based on outcome tracking |
| **conscious-doctor** | Self-diagnostic loop |

Cortex modules write to and read from a shared belief graph. Every cycle produces outcomes that feed back into beliefs.

---

## Memory system — how sessions accumulate

**The most important architectural choice in Substrate is that nothing is session-scoped.**

Most LLM apps start every conversation from a blank context. Substrate does the opposite. Every conversation, every outcome, every directive the operator gives, every belief the system forms, every artifact it produces, persists. The next conversation begins with the full weight of every prior one.

This is why a 37-day single-developer build has 591 beliefs, 912 outcomes, and 14 behavioral directives that survived across sessions: the system was never reset.

A four-tier persistence stack makes this work:

**Tier 1 — Auto-memory** (139 files, loaded into every Claude conversation)

Four memory types, each with frontmatter (`type:`, `description:`) and structured body. Auto-loaded at session start so the assistant arrives with full context:

- `user_*` — facts about the operator (role, skills, location, goals, preferences)
- `feedback_*` — operational guidance with **rule + Why + How-to-apply** structure. Example: "Never display the operator's full surname" survived all 144 commits because it lives here
- `project_*` — current initiatives, deadlines, decisions (with absolute dates so they remain interpretable as time passes)
- `reference_*` — pointers to external systems (Slack channels, dashboards, Linear projects)

The assistant maintains this memory itself, writing new entries when it learns something durable, updating existing entries when facts change.

**Tier 2 — Organism belief graph** (591 beliefs + 912 outcomes)

A SQLite-backed graph where every action is attributed back to a belief, every belief carries a confidence weight (0.0-1.0), and outcomes feed back to update those weights. Queryable from any module.

Example belief: "Chain businesses with 3+ locations have higher AI workflow budget than solo founders" (weight 0.74, last updated 2026-05-13 from 12 observed outcomes).

**Tier 3 — Wiki Brain** (16,611 markdown entries)

Following the Karpathy LLM-wiki pattern. Persistent knowledge structured as interlinked notes, retrievable via RAG. Concepts, entities, market analyses, technical patterns — all written once, referenced forever.

**Tier 4 — Cortex state** (88 json + md files)

Working state for individual cognitive modules: emotions log, curiosity queue, attention focus, dreams, surprise log, blind spots, dissonance tracker. Each module has its own state file that survives between cycles.

---

## Learning loop — how the system gets smarter

A closed loop converts every operator conversation into permanent behavior change:

```
operator voice
   ↓
running log of conversations (Tier 4)
   ↓
feedback-extractor.mjs runs Claude CLI as a subprocess
   ↓
extracts directives with confidence scores (0.85-0.98)
   ↓
written to active-directives state file (Tier 4)
   ↓
all bots read on next startup → behavior change
   ↓
outcomes of new behavior tracked in organism graph (Tier 2)
   ↓
beliefs updated, low-confidence directives marked superseded
```

A verified end-to-end run: the operator stated a new rule by voice → feedback-extractor extracted it as a directive at confidence 0.95 → next bot iteration carried the rule. The system updates its own behavior from natural language.

**Why this compounds:** every session contributes durable artifacts to Tiers 1-4. Three months in, the system knows things no model could have been trained on — operator preferences, local conventions, project history, what worked, what failed. The longer it runs, the harder it is to replace.

---

## Discipline layer (Honesty Enforcement)

A set of gates that prevent the system from lying to itself or its operator.

| Component | What it blocks |
|---|---|
| **ISA gate** (`opportunity-store.transition()`) | Refuses to mark an opportunity `done` without all Information State Criteria verified |
| **ISA-Check** | Static completeness validator for Ideal State Artifact files |
| **CheckpointPerISC** | Auto-commits a checkpoint on every `[ ] → [x]` flip so progress is forensically traceable |
| **Egress guard** | Blocks credential leaks (`sk-ant-*`, `sk_live_*`, AWS keys, `.env` paths) in outbound messages |
| **Injection scanner** | 25+ prompt-injection patterns scanned on incoming content before LLM ingestion |
| **Safe-send wrapper** | Wraps 15 outbound sites (Telegram, email, Reddit, LinkedIn) with disclosure + verification |
| **Billing guard** | `enforceOAuthBilling()` in 7 daemon entry-points strips `ANTHROPIC_API_KEY` to force OAuth Max-plan billing rather than per-token API spend |
| **Tool-failure tracker** | Structured `.data/tool-failures.jsonl` for every tool that returned an error |
| **Verification Doctrine** | A probe-table per artifact type. "Looks fine / should work / tests pass" is not evidence. Single-tool yes/no probe required for every "done" claim |

---

## Visual Agent / Content Department

A team-of-designers pipeline that turns substrate-detected signals into 1080x1080 LinkedIn / TikTok / YouTube content assets.

```
signal-hooks (scans awareness / scout / opp feeds)
   ↓
visual-orchestrator (parallel consultation, 5-7 specialists in 3.5s)
   ↓
visual-synthesizer (gpt-4o merges panel into unified brief)
   ↓
variant-generator (3 variants: safe / bold / contrarian)
   ↓
visual-judge (multimodal gpt-4o reads the rendered PNGs and picks winner)
   ↓
content-store (history-aware, anti-repeat: rotates accent and layout)
```

**15 specialist personas:** visual-psychologist, brand-designer, news-designer, sales-designer, educational-designer, provocation-designer, carousel-strategist, localization-designer, trend-watcher, animation-strategist, motion-designer, web-experience-designer, interaction-designer, visual-creative-director, visual-researcher.

**Three modes:** FAST ($0.005 / asset), FULL ($0.025 / asset), BRIEF-ONLY ($0).
**End-to-end measured:** 6 specialists → unified brief → 3 variants → judge picks bold → asset saved in **18 seconds, $0.024**.

---

## Operator interface (Tolik)

The system has a single human operator. The interface to it is a voice + browser dashboard called Tolik.

- `apps/tolik` (Vite, port 5190) — Mission Control: weather widget, substrate status, push-to-talk, mode toggle
- `voice-bridge.mjs` — speech → router (regex + intent) → tool execution; 49 tools registered
- **Two modes:**
  - **Brain mode** — Tolik runs an agentic loop with full substrate access
  - **Code mode** — voice transcript is pasted into the active Claude Code Terminal via osascript bridge
- **Jarvis layer** (built, off by default) — `snap-listener.py` for double-snap detection, Vosk RU+EN offline wake word, paste-to-Claude bridge
- **Five slash commands** (`/tolik`, `/tolik-stop`, `/code-mode`, `/brain-mode`, `/snap-calibrate`)
- **Telegram channel** for asynchronous notifications with safe-send wrapping

---

## Multi-vendor AI architecture

Provider routing is treated as production infrastructure, not configuration.

| Provider | Role |
|---|---|
| **Anthropic Claude** | Primary reasoning for cortex deep-think Stage 1 + free-think; subprocess Claude CLI on Max plan as a tool-using agent |
| **OpenAI GPT-4o / GPT-5.4-mini** | Adversarial critic + resolver in deep-think; visual synthesizer + multimodal judge |
| **Google Gemini 2.5 Flash** | Demo primary (250K TPM free tier, 41x more headroom than Groq free) |
| **Groq Llama 3.1 8B Instant** | Production cost-optimal fallback ($0.05/M input, $0.08/M output) |

**Switch is one env var.** Both fetched via raw HTTP, not vendor SDKs, because vendor SDKs add hidden coupling that breaks on mobile runtimes and edge environments. Raw HTTP keeps the adapter contract clean.

**Tool-calling adapter pattern**: schema converter functions translate between vendor APIs so the same agent code targets both.

---

## Engineering patterns introduced

| Pattern | What it solves |
|---|---|
| **ISA gate (Ideal State Artifact)** | Refuses "done" claims without verified Information State Criteria. Prevents the "looks fine" failure mode |
| **Multi-vendor failover via single env flag** | One env var flips the entire AI stack. Free-tier walls become non-issues |
| **Subprocess Claude CLI agent pattern** | Run multi-tool agents on Anthropic Max plan without per-token API spend. Used by feedback-extractor, deep-read, and ad-hoc reasoning |
| **Belief graph as organism memory** | 591 beliefs persist across sessions with confidence weights. Outcomes feed back into belief updates. Not session-scoped state |
| **Closed learning loop** | Operator voice → feedback-extractor → directives → bot behavior change on next run. Confidence-scored (0.85-0.98) |
| **Verification Doctrine** | Probe-table per artifact type: HTML asset, sent message, DB row, posted content. Single-tool yes/no probe required before "done" |
| **Egress / Injection / Billing guards** | Production-grade safety boundary as middleware, not policy |

---

## Tech stack

- **Runtimes:** Node.js (ESM `.mjs`), Python 3.13, TypeScript, Bash
- **AI providers:** Anthropic Claude (via CLI subprocess + API), OpenAI GPT, Google Gemini, Groq Llama
- **Data:** SQLite (multi-DB topology: brain, cortex, business, factory, leads, brand-os), Markdown wiki (16K entries)
- **UI:** Vite + React (Tolik Mission Control), Telegram Bot API (operator notifications)
- **Automation:** n8n self-hosted, Playwright (browser agent on :4790), webhook server (:4789)
- **Local AI:** Ollama (offline LLM deployment for sensitive workflows)
- **Voice:** Vosk (offline RU+EN wake word), TTS (Mac native), Web Speech API
- **Visual:** HTML/CSS templates + Puppeteer rendering for 1080x1080 social assets
- **Job aggregator:** `python-jobspy` (Indeed, LinkedIn, Glassdoor, Google scraping) for market intelligence

---

## Repository structure

```
substrate/
├── scripts/
│   ├── cortex/          # 135 cognitive modules (brain)
│   ├── factory/         # 146 production bots (outreach, scouts, monitors)
│   ├── outreach/        # 50 outreach pipeline modules
│   ├── survival/        # 40 supervisor + ISA gate modules
│   ├── organism/        # 25 organism-wide state modules
│   ├── content/         # 24 modules + 15 visual specialist personas
│   ├── tolik/           # 23 operator tools (router, intel, voice bridge)
│   ├── jobs/            # AI job aggregator (JobSpy + Claude deep-read)
│   ├── policy/          # 6 enforcement modules
│   ├── automation/      # 5 task automation
│   ├── jarvis/          # 3 hybrid voice OS modules
│   ├── command/         # 3 command bridges
│   └── lib/             # 2 shared utilities
├── apps/
│   ├── tolik/           # Vite Mission Control UI (port 5190)
│   ├── api/             # Fastify API (legacy)
│   └── web/             # React dashboard (legacy)
├── packages/            # Monorepo workspace (shared types, orchestrator, db)
├── wiki/                # 16,611-entry Wiki Brain (Karpathy LLM-wiki pattern)
├── .data/               # Runtime state (gitignored where sensitive)
│   ├── SUBSTRATE-ATLAS.md    # 537-line full system reference
│   ├── cortex-*.json         # 88 cortex state files
│   └── experiments/          # Experiment ledgers
└── .claude/
    └── commands/        # 5 slash commands for Claude Code integration
```

---

## Build journal

| Date | Milestone |
|---|---|
| **Apr 6** | First commit |
| **Apr 14** | Wave Pipeline (7 waves, 27 bots) + Wiki Brain (23 pages) + System Brain (GPT-5.4) |
| **Apr 17** | Cortex 100%: 15 modules, adversarial brain, evolution engine, conscious doctor, body map, dashboard |
| **Apr 18** | Cortex v3: 38 modules, emotions, world model, voice chat, self-thinking brain |
| **Apr 22-27** | Deep brain layers, Claude switch, X/Threads launch, voice assistant for live interview |
| **May 9-10** | Substrate self-developing pivot. Self-construction layer (19 modules). Cortex functionalist build (17 modules wired) |
| **May 11** | Perception loop closed end-to-end. First real organism cycle: message 8852 sent with verified counts |
| **May 12-13** | Substrate Atlas (537-line system reference). Visual Agent full team-of-designers pipeline (15 specialist personas). ISA discipline layer. Learning Loop verified end-to-end |

---

## What I learned building this

1. **Persistent memory changes the system from "tool" to "organism".** Session-scoped state means starting over every time. A belief graph that survives across sessions, with confidence-weighted updates, lets the system actually compound learning rather than reset it.

2. **Multi-vendor failover via one env flag beats single-vendor optimization.** Single-vendor builds hit free-tier walls. Multi-vendor with a schema adapter pattern makes provider choice a runtime decision, not an architectural one.

3. **Tool calling beats prompt engineering for non-trivial agents.** Schema-validated tools give AI answers that are bounded, auditable, repeatable. Prompt engineering alone produces generic.

4. **The hardest part is not the model, it's the discipline layer.** The Verification Doctrine, ISA gate, and egress / injection / billing guards together took as much design work as the cognitive modules. Without them the system optimistically claims "done" and lies to its operator.

5. **Subprocess Claude CLI is an underused pattern.** Running a Max-plan Claude CLI as a tool-using subprocess lets one developer build multi-step agents without per-token API spend.

6. **A closed learning loop is small in code but huge in compounding.** Voice conversation → feedback-extractor → active-directives → next-run behavior is around 200 lines, but it is what turns Substrate from a static install into something that updates itself.

7. **Verification Doctrine prevents "looks fine" lies.** Every artifact type gets a single-tool yes/no probe. Tests passing is not evidence that the feature works.

---

## Author

**Kirill D.**
Calgary, Alberta, Canada → relocating
[linkedin.com/in/kirill-derhachenko-138059240](https://www.linkedin.com/in/kirill-derhachenko-138059240)

Background: 5.5 years Senior Project Manager + Head of Public Operations at Verkhovna Rada (Ukraine Parliament), leading multi-disciplinary teams of 10+ on electoral campaigns, procurement operations, strategic communications. Bachelor of Radiophysics and Bioengineering, V.N. Karazin Kharkiv National University.

Built Substrate solo, evenings and weekends, April-May 2026.

---

## License

This repository documents a personal AI architecture experiment. Substantial portions of the design (ISA gate, Verification Doctrine, multi-vendor failover pattern, pre-flight risk simulator, organism belief graph) are documented as patterns that may be reapplied. The implementation is single-tenant and not a framework.

Inquiries: see LinkedIn above.
