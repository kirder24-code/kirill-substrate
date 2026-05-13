# CORTEX v2 - Autonomous Business Brain

A continuously running daemon that thinks, decides, acts, measures, and learns.

## Architecture

```
CORTEX DAEMON (PM2 managed, always running)
  |
  +-- PERCEPTION (what changed?)
  |     DB polling: leads, emails, vapi calls, appointments
  |     Event bus: bot_events from orchestrator
  |     File signals: pause flags, config changes
  |
  +-- COGNITION (LLM thinking - gpt-4o-mini)
  |     Full context: state + memory + KPD + bot health + budget
  |     Decides: which workflows/bots to run, config changes, notifications
  |     Saves money: only thinks when something changed or on schedule
  |
  +-- EXECUTION (workflows + single bots)
  |     Workflows: multi-step pipelines (scout -> enrich -> outreach)
  |     Single bots: one-off tasks
  |     Budget tracking: stops when daily limit reached
  |
  +-- MEMORY (4-type cognitive memory)
  |     Episodic: "what happened" - events with outcomes
  |     Semantic: "what I know" - facts about markets, products
  |     Procedural: "how to do things" - learned best practices
  |     Working: "current state" - active context
  |
  +-- KPD MEASUREMENT (efficiency tracking)
  |     Every bot run logged: cost, output, value, KPD score
  |     Brain reads KPD to decide which bots are worth running
  |
  +-- CONFIG INJECTION (dynamic bot control)
        CORTEX writes .data/cortex-config.json
        Bots read it at startup for dynamic parameters
        Brain can change keywords, caps, enable/disable, budgets
```

## Files

- `cortex-daemon.mjs` - Main daemon (run via PM2)
- `memory.mjs` - 4-type cognitive memory system
- `bot-registry.mjs` - Registry of all 17 bots
- `workflows.mjs` - Multi-step bot pipelines (5 workflows)
- `config-injection.mjs` - Dynamic config for bots
- `kpd-bridge.mjs` - Bots import this to report results to CORTEX

## Quick Start

```bash
# Start via PM2
pm2 start ecosystem.config.cjs

# Check status
pm2 status
pm2 logs cortex

# Auto-start on boot
pm2 save && pm2 startup
```

## Workflows

| Workflow | Steps | Purpose |
|----------|-------|---------|
| lead-pipeline | scout -> enrich -> outreach | Find and contact leads |
| reply-pipeline | monitor -> classify | Watch for responses |
| content-pipeline | content -> quality | Draft and check posts |
| morning-brief | brief-agent | Daily summary for Kirill |
| opportunity-scan | awareness -> ideas | Find new markets |

## For Bot Developers

Add KPD reporting to any bot:

```javascript
import { withKPD } from "../cortex/kpd-bridge.mjs";

const kpd = withKPD("my-bot", 0.15); // estimated cost per run
if (!kpd.enabled) process.exit(0);   // CORTEX disabled this bot

// Read dynamic config
const config = kpd.config;
console.log(config.keywords); // CORTEX can change these

// ... do work ...

// Report results
kpd.done("Found 5 leads", 5, { leads_found: 5 });
// or on failure:
kpd.fail("API rate limited");
```
