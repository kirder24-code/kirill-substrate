# Factory Bot Registry

**Frozen file. Substrate may NOT rewrite this. Manual edit by Kirill only.**

Map of every factory bot substrate is aware of. For each bot:
- What it does
- Where it writes output (file path + format)
- Heartbeat indicator (file substrate can stat to verify aliveness)
- Whether substrate can dispatch to it (Y/N + how)

This file is the contract by which substrate consumes factory outputs.
Substrate's `factory_status` action stat-checks the heartbeat files.
Substrate's `factory_output_ingest` action reads the output files and
surfaces interesting items as opportunities or pain signals into the
substrate opportunity store.

---

## Currently running factory bots (scheduler-driven)

### research-bot / research-bot-v2
- What: pulls news + market signals from configured sources
- Output: `.data/INTEL.md` (markdown), `.data/awareness/latest.md`
- Heartbeat: `.data/awareness/latest.md` mtime
- Substrate consumes via: `ingest_organism_research` action (already wired)
- Schedule: research-bot-v2 every hour at :15 via sonnet-bots-daemon
- Dispatch from substrate: NO yet (would require sonnet-bots-daemon mod)

### scout-bot
- What: scans Reddit + other public sources for ICP signals
- Output: `scout.db` (SQLite, currently empty), `.data/scout-bot-diagnosis-*.json`
- Heartbeat: `.data/scout-bot-diagnosis-*` files mtime (latest)
- Substrate consumes via: nothing yet
- Status: appears DEGRADED (scout.db is 0 bytes)
- Dispatch from substrate: NO

### idea-bot
- What: generates content ideas from intel + state
- Output: `.data/idea-bot-last-run.json` (heartbeat only — content elsewhere)
- Heartbeat: `.data/idea-bot-last-run.json` mtime
- Substrate consumes via: nothing yet
- Dispatch from substrate: NO

### content-bot
- What: drafts content pieces (LinkedIn posts, blog drafts)
- Output: `.data/content-bot-last-run.json` (heartbeat) + draft files
- Heartbeat: `.data/content-bot-last-run.json` mtime
- Substrate consumes via: nothing yet
- Dispatch from substrate: NO

### sales-bot / linkedin-hunter / telegram-sales-agent
- What: outreach to leads, follow-ups, qualification
- Output: writes to `linkedin-brand-os.sqlite` (outreach_emails, leads tables)
- Heartbeat: process alive + recent rows in outreach_emails
- Substrate consumes via: `lead_database` (already wired — buildLeadKnowledgeBlock)
- Dispatch from substrate: NO yet

### reddit-monitor
- What: monitors specific subreddits for activity
- Output: writes to `.data/reddit-replies-monitor.json` (perception target)
- Heartbeat: `.data/reddit-replies-monitor.json` mtime
- Substrate consumes via: `perception-feeder` (already wired)
- Dispatch from substrate: NO

### community-bot
- What: engages in community channels (designed for, exact behavior unclear)
- Output: unknown without source inspection
- Heartbeat: process alive
- Substrate consumes via: nothing yet
- Dispatch from substrate: NO

### service-bot / build-bot / learn-bot / brief-agent
- What: meta/internal helpers (unclear current production value)
- Output: various internal state files
- Heartbeat: process alive
- Substrate consumes via: nothing
- Dispatch from substrate: NO

### evolution-bot
- What: meant to evolve other bots (unclear current effect)
- Output: `.data/cortex-evolution.json` and similar
- Heartbeat: file mtime
- Substrate consumes via: nothing yet
- Dispatch from substrate: NO

### trend-bot
- What: tracks trending topics
- Output: unclear
- Substrate consumes via: nothing yet

### pr-bot
- What: PR/visibility outreach
- Output: unclear
- Substrate consumes via: nothing yet

### analytics-bot
- What: produces analytics summaries
- Output: writes to `.data/cortex-*` and analytics files
- Substrate consumes via: nothing direct yet

### healthcheck
- What: monitors other bots' aliveness
- Output: writes status files
- Substrate consumes via: nothing yet

### sonnet-bots-daemon (orchestrator)
- What: schedules and runs 6 Sonnet 4.6 specialized bots on cron-like schedule
- Manages: research-bot-v2, lead-enrichment-bot, content-curator-bot,
  site-curator-bot, discovery-engine, monitor-replies
- Substrate consumes via: indirect (via files those bots produce)
- Dispatch from substrate: NO yet (this is the dispatch target for future)

### supervisor
- What: process supervisor (restarts dead bots)
- Output: writes status files
- Substrate consumes via: nothing yet

### telegram-control
- What: original Telegram bot infrastructure (predates substrate's
  telegram-listener)
- Output: writes to `.data/organism-telegram-inbox.jsonl` and similar
- Heartbeat: process alive
- Substrate consumes via: indirectly via perception-feeder reading inbox

---

## What substrate IS already consuming from factory (via existing bridges)

1. `linkedin-brand-os.sqlite` outreach_emails + leads (from sales-bot, linkedin-hunter, telegram-sales-agent) → consumed by `lead-database.mjs` and surfaced into draft_writing + opportunity_implementation_plan prompts
2. `.data/INTEL.md` (from research-bot-v2 et al) → consumed by `opportunity-actions.mjs runIngestOrganismResearch`
3. `.data/reddit-replies-monitor.json` (from reddit-monitor) → consumed by `perception-feeder.mjs`
4. `.data/email-inbox-state.json` (built from outreach_emails by perception-feeder) → also goes to feed
5. `.data/organism-telegram-inbox.jsonl` (from telegram-control) → read by substrate via perception-feeder

So substrate ALREADY indirectly reads ~5 factory output streams. The new
factory_status + factory_output_ingest actions formalize this: status gives
visibility, output_ingest opens the door to ingesting heretofore-unread
factory products (idea-bot, content-bot, scout-bot diagnoses, etc.).

---

## What's NOT yet wired (dispatch from substrate to factory)

Substrate cannot say "scout-bot, find me leads in r/AI_Agents this hour" or
"content-bot, draft 3 ideas about CDAP closure." That requires either:
(a) modifying sonnet-bots-daemon to watch a request directory
(b) substrate spawning the bot script directly via execSync (works for
    CLI-runnable bots like idea-bot, content-bot)

Option (b) is the safer night-time bridge. Will implement as follow-up
once factory_status + ingest are stable.

---

## Bot health expectations (for factory_status)

A bot is considered HEALTHY if:
- Process is running (PID alive in ps), AND
- Heartbeat file mtime within last 24h

A bot is STALE if:
- Process is running but heartbeat file > 24h old
- May indicate the bot is stuck in a bad loop

A bot is DEAD if:
- Process not running
- May or may not need restart

A bot is UNKNOWN if:
- Heartbeat file never existed (bot never ran or no heartbeat path documented)
