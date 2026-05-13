# Content Department — Integration Spec (written BEFORE build)

Goal: Visual Agent + post text + hashtags + purpose become a **single department**
that the rest of substrate is aware of, can interact with, and that fires
autonomously without operator CLI invocation.

Author: 2026-05-13. Build follows this spec; no check is added post-hoc.

---

## Definition: what "Content Department" means

A coordinated set of:
- **State**: `content_queue` table (pending ideas) + `department-state.json` (live status)
- **Brain**: `content-orchestrator.mjs` (decides when to compose, what to compose)
- **Hands**: existing `content-bot`, `content-curator-bot`, `visual-agent`, `post-writer`
- **Gates**: `content-quality-gate` (already exists), `egress-guard` (already in render)
- **Output**: unified Telegram card (image/video + text + hashtags + purpose + suggested time)

---

## Success checks (each must pass before "done")

### D1 — Single TG card contains EVERYTHING
When the department fires, ONE Telegram message arrives at Kirill's chat. The caption MUST contain, in this exact order:
- 🎯 PURPOSE: 1-line "why we're making this post"
- 📝 POST TEXT: full LinkedIn copy (100-300 words, Kirill voice, no em dash)
- 🏷️ HASHTAGS: 5-7 hashtags
- ⏰ SUGGESTED TIME: when to publish (ISO + human-readable)
- 🎨 ASSET: level + template + accent (technical metadata)
- 🆔 asset_id (for callback routing)

Attachment: PNG (static), MP4 (motion), or MP4 (scroll)

**Verifiable by:** open msg in TG, all 6 sections present, no missing fields.

### D2 — Auto-fires WITHOUT operator CLI
The department must fire on at least ONE of these triggers without Kirill running anything:
- Daily cron slot (1-2 posts/week per memory cap; checks if slot is due)
- Awareness signal flagged as post-worthy
- Opportunity transition (won deal → case study queued)

**Verifiable by:** kill the operator's terminal. Wait 24h. A TG card arrives.

For build-time verification: simulate cron tick via `node scripts/factory/content-orchestrator.mjs --tick --force-now`. Card arrives in TG.

### D3 — Quality gate enforced
Post text MUST pass:
- No em dash (memory rule)
- No "guaranteed/100x/millions" (forbidden_phrases)
- 100-300 words (not too short, not too long)
- Has hook (first 2 lines)
- Has CTA (last paragraph)
- Hashtags lowercase, no spaces, 5-7 count

**Verifiable by:** quality-gate test on output before TG dispatch. Reject = no TG message.

### D4 — System awareness (other depts can ask)
The rest of substrate must be able to answer "what is content dept doing":
- `.data/content/department-state.json` exists, updated each fire, schema:
  `{ last_fire_at, last_post_published_at, queue_depth, next_scheduled_at, posts_this_week, status }`
- `wiki/content/content-department.md` describes inputs, outputs, schedule, current state
- `cortex-conversation` / `orchestrator-loop` morning brief includes content dept status line
- Tolik tool `content_status()` returns the state

**Verifiable by:** 
- `cat .data/content/department-state.json` → valid JSON with all 6 fields populated
- `node apps/tolik/tools/content-tools.mjs status` → prints state summary

### D5 — Other depts can hand off
- awareness-bot can call `enqueueContentIdea({ source: "awareness", signal_id, priority })` 
- opp-transition can call `enqueueContentIdea({ source: "opp-win", opp_id, recipe: "apollo-case" })`
- These enqueues create rows in `content_queue` table
- Content-orchestrator drains queue on tick

**Verifiable by:** insert test row via API, run content-orchestrator --tick, row marked processed + asset created.

### D6 — Operator can intervene without bypass
Via Telegram callback buttons (existing infrastructure, just extended):
- ✅ Publish → status="approved" (Kirill manually uploads to LinkedIn)
- ✏️ Edit text → status="edit_text_requested", text saved to sandbox-review/
- 🖼️ Edit visual → status="regen_visual_requested" (re-runs visual-agent)
- ⏰ Schedule → opens schedule prompt (defer to chosen time)
- ❌ Skip → status="rejected", no publish, no retry
- 🎲 Regenerate → full re-run

**Verifiable by:** synthetic callback test (similar to test-callback-synthetic.mjs) covering all 6 actions.

### D7 — No spam (max 1 card/day under autonomous mode)
Per memory rules: 1-2 posts/week cap; no telegram spam.
Department fires AT MOST 1 card per 24h in autonomous mode. Operator can manually trigger more via Tolik.

**Verifiable by:** run --tick twice within 1h with no new signals; only first one produces card.

---

## Files to be built

```
scripts/content/post-writer.mjs              — generates post text + hashtags + purpose
scripts/content/content-orchestrator.mjs     — dept brain, scheduled
scripts/content/content-queue.mjs            — queue API (enqueue, drain, mark processed)
scripts/content/dept-state.mjs               — writes department-state.json
wiki/content/content-department.md           — wiki page (read by other depts)
apps/tolik/tools/content-tools.mjs           — UPDATE: add status/compose/recent
scripts/content/tg-approval.mjs              — UPDATE: unified caption with all 6 sections + 6 buttons
```

DB additions:
```
ALTER TABLE content_visual_assets ADD COLUMN post_text TEXT;
ALTER TABLE content_visual_assets ADD COLUMN hashtags TEXT;        -- JSON array
ALTER TABLE content_visual_assets ADD COLUMN purpose TEXT;
ALTER TABLE content_visual_assets ADD COLUMN suggested_post_at TEXT;
ALTER TABLE content_visual_assets ADD COLUMN source_signal_id TEXT;

CREATE TABLE content_queue (
  id INTEGER PRIMARY KEY,
  created_at TEXT,
  source TEXT,          -- 'awareness' | 'opp-win' | 'scheduled' | 'manual'
  source_ref TEXT,      -- signal_id / opp_id
  priority INTEGER,     -- 1=high, 5=low
  idea TEXT,            -- the post hook
  post_type TEXT,
  asset_level TEXT,
  status TEXT,          -- 'pending' | 'composed' | 'rejected' | 'expired'
  composed_asset_id TEXT,
  processed_at TEXT
);
```

Cron:
```
0 9 * * *  node scripts/factory/content-orchestrator.mjs --tick
```

---

## What's intentionally OUT of scope (will not be built without ask)

- Auto-publish to LinkedIn (Kirill keeps manual upload control)
- A/B testing of multiple variants in TG (one card = one decision)
- Multi-platform (Threads/X) — single platform first
- Auto-rescheduling on engagement metrics
- Removing existing content-bot.mjs / content-curator-bot.mjs (they continue working in parallel; orchestrator integrates them rather than replaces)
