#!/usr/bin/env bash
# organism/organism-pulse.sh
# The autonomous heartbeat. Runs all adapters, applies pending outcomes to graph,
# regenerates digest. Designed to be called from cron every hour.
#
# Cron entry (run hourly at minute 17 to avoid clashing with other system jobs):
#   17 * * * * cd $CLAUDE_PROJECT_DIR && bash scripts/organism/organism-pulse.sh >> .data/organism-pulse.log 2>&1
#
# Manual run:
#   bash scripts/organism/organism-pulse.sh

set -uo pipefail

PROJECT_DIR="$CLAUDE_PROJECT_DIR"
NODE_BIN="$HOME/.nvm/versions/node/v22.22.2/bin/node"
LOG_PREFIX="[$(date -u +%Y-%m-%dT%H:%M:%SZ)]"
APPLY_BUDGET="${ORGANISM_APPLY_BUDGET:-8}"  # max outcomes processed per pulse to cap API cost

cd "$PROJECT_DIR"

echo "$LOG_PREFIX === ORGANISM PULSE ==="

# 0. Pull Telegram messages from Kirill into outcomes (the human channel)
echo "$LOG_PREFIX [pulse] step 0/7: ingest-telegram-kirill"
"$NODE_BIN" scripts/organism/organism-telegram.mjs pull 2>&1 | tail -3 || echo "$LOG_PREFIX   FAILED telegram pull"

# 0a. Refresh substrate perception (read real-world data sources, write feed files)
echo "$LOG_PREFIX [pulse] step 0a/7: perception-feeder flush"
"$NODE_BIN" scripts/cortex/perception-feeder.mjs 2>&1 | tail -1 || echo "$LOG_PREFIX   FAILED perception-feeder"

# 0b. Substrate announces what it sees (only if counts changed in last 6h)
echo "$LOG_PREFIX [pulse] step 0b/7: announce-perception (throttled)"
"$NODE_BIN" scripts/cortex/announce-perception.mjs 2>&1 | tail -3 || echo "$LOG_PREFIX   FAILED announce-perception"

# 0c. Survival loop tick. No-op unless .data/survival-armed.flag exists.
# Bounded by $5 CAD/24h LLM budget cap. Wallet read-only.
echo "$LOG_PREFIX [pulse] step 0c/7: survival-tick (gated by armed flag)"
"$NODE_BIN" scripts/survival/tick-once.mjs 2>&1 | tail -2 || echo "$LOG_PREFIX   FAILED survival-tick"

# 0d. cortex-alive watchdog: holds 36 cortex modules registered in a single
# long-running process so they can emit/subscribe across each other.
# If PID file points at a dead process, restart it.
ALIVE_PID_FILE="$PROJECT_DIR/.data/cortex-alive.pid"
NEEDS_RESTART=1
if [ -f "$ALIVE_PID_FILE" ]; then
  ALIVE_PID=$(cat "$ALIVE_PID_FILE")
  if ps -p "$ALIVE_PID" > /dev/null 2>&1; then
    NEEDS_RESTART=0
    echo "$LOG_PREFIX [pulse] step 0d/7: cortex-alive ALIVE pid=$ALIVE_PID"
  fi
fi
if [ "$NEEDS_RESTART" = "1" ]; then
  echo "$LOG_PREFIX [pulse] step 0d/7: cortex-alive DEAD, restarting"
  cd "$PROJECT_DIR"
  nohup "$NODE_BIN" scripts/survival/cortex-alive.mjs > "$PROJECT_DIR/.data/cortex-alive.log" 2>&1 &
  echo $! > "$ALIVE_PID_FILE"
fi

# 0e. Process approved outbound drafts (mark ready for kirill manual send)
echo "$LOG_PREFIX [pulse] step 0e/7: outbound-approval process"
"$NODE_BIN" scripts/survival/outbound-approval.mjs process 2>&1 | tail -2 || echo "$LOG_PREFIX   FAILED outbound-approval"

# 0e1. Telegram callback poller — DISABLED in pulse: conflicts with telegram-control
#      bot which already holds getUpdates connection. Inline buttons in approval
#      messages still display; for now use CLI approval:
#        node scripts/survival/outbound-approval.mjs approve <id>
#      Tomorrow: move callbacks to telegram-control or use separate bot token.

# 0e2. Factory dispatcher watcher (executes substrate->factory requests)
echo "$LOG_PREFIX [pulse] step 0e2/7: factory dispatcher watcher"
"$NODE_BIN" scripts/survival/factory-dispatcher.mjs watch 2>&1 | tail -2 || echo "$LOG_PREFIX   FAILED factory-watch"

# 0e3. Internal feedback loop (substrate's self-improvement without wallet)
echo "$LOG_PREFIX [pulse] step 0e3/7: internal feedback aggregation"
"$NODE_BIN" scripts/survival/internal-feedback.mjs 2>&1 | tail -2 || echo "$LOG_PREFIX   FAILED internal-feedback"

# 0f. Regenerate SYSTEM-STATE.md (single source of truth, what is wired/alive)
echo "$LOG_PREFIX [pulse] step 0f/7: regenerate SYSTEM-STATE.md"
"$NODE_BIN" scripts/survival/system-state.mjs 2>&1 | tail -1 || echo "$LOG_PREFIX   FAILED system-state"

# 1. Pull from real data sources (read-only on existing DBs)
echo "$LOG_PREFIX [pulse] step 1/7: ingest-awareness (latest brief)"
"$NODE_BIN" scripts/organism/ingest-awareness.mjs --latest 2>&1 | tail -3 || echo "$LOG_PREFIX   FAILED ingest-awareness"

echo "$LOG_PREFIX [pulse] step 1.5/7:ingest-awareness-apply-log"
"$NODE_BIN" scripts/organism/ingest-awareness-apply-log.mjs 2>&1 | tail -3 || echo "$LOG_PREFIX   FAILED ingest-awareness-apply-log"

echo "$LOG_PREFIX [pulse] step 1.7/7:ingest-outreach-replies (14d window)"
"$NODE_BIN" scripts/organism/ingest-outreach-replies.mjs --window=14 2>&1 | tail -3 || echo "$LOG_PREFIX   FAILED ingest-outreach-replies"

echo "$LOG_PREFIX [pulse] step 1.9/7:ingest-conversations"
"$NODE_BIN" scripts/organism/ingest-conversations.mjs 2>&1 | tail -3 || echo "$LOG_PREFIX   FAILED ingest-conversations"

# 2. Apply pending outcomes to graph (capped budget — Claude calls cost time and tokens)
echo "$LOG_PREFIX [pulse] step 2/7:apply-outcomes-to-graph (limit=$APPLY_BUDGET)"
"$NODE_BIN" scripts/organism/apply-outcomes-to-graph.mjs --limit="$APPLY_BUDGET" 2>&1 | tail -10 || echo "$LOG_PREFIX   FAILED apply-outcomes"

# 3. Regenerate strategic verdict on the latest graph state — only if graph shifted enough
# (Cheap to skip if nothing changed; uses log-entry count as a heuristic.)
echo "$LOG_PREFIX [pulse] step 3a/7: regenerate-verdict (if graph shifted)"
RECENT_CHANGES=$(sqlite3 "$PROJECT_DIR/.data/organism.db" "SELECT COUNT(*) FROM belief_log WHERE ts > datetime('now', '-2 hours')" 2>/dev/null || echo 0)
if [ "$RECENT_CHANGES" -gt 5 ]; then
  echo "$LOG_PREFIX   $RECENT_CHANGES changes in last 2h — regenerating verdict"
  "$NODE_BIN" scripts/organism/regenerate-verdict.mjs 2>&1 | tail -5 || echo "$LOG_PREFIX   FAILED verdict regen"
else
  echo "$LOG_PREFIX   only $RECENT_CHANGES recent changes — keeping current verdict"
fi

# 3b. Curiosity — let the organism reach out to Kirill if it has something pressing
echo "$LOG_PREFIX [pulse] step 3b/7: curiosity (organism speaks to Kirill if needed)"
"$NODE_BIN" scripts/organism/organism-curiosity.mjs 2>&1 | tail -3 || echo "$LOG_PREFIX   FAILED curiosity"

# 3c. Regenerate digest so SessionStart hook reads fresh state
echo "$LOG_PREFIX [pulse] step 3c/7: digest regeneration"
"$NODE_BIN" scripts/organism/digest.mjs > /dev/null 2>&1 && echo "$LOG_PREFIX   digest regenerated" || echo "$LOG_PREFIX   FAILED digest"

# 3d. Time-series snapshot (cheap, idempotent — one row per belief per day)
echo "$LOG_PREFIX [pulse] step 3d/9: time-series snapshot"
"$NODE_BIN" scripts/organism/time-series.mjs --snapshot-only 2>&1 | tail -1 || echo "$LOG_PREFIX   FAILED time-series"

# 3e. Variant predictions (once per day — auto-skips if already done today)
echo "$LOG_PREFIX [pulse] step 3e/9: variant predictions"
"$NODE_BIN" scripts/organism/variants.mjs generate 2>&1 | tail -3 || echo "$LOG_PREFIX   FAILED variants"

# 3f. Generate action proposals if graph has new learning (uses ~1 Claude call)
RECENT_LEARNING=$(sqlite3 "$PROJECT_DIR/.data/organism.db" "SELECT COUNT(*) FROM beliefs WHERE last_updated > datetime('now', '-3 hours') AND origin LIKE 'outcome%'" 2>/dev/null || echo 0)
if [ "$RECENT_LEARNING" -gt 2 ]; then
  echo "$LOG_PREFIX [pulse] step 3f/9: propose-action ($RECENT_LEARNING new learning)"
  "$NODE_BIN" scripts/organism/propose-action.mjs generate 2>&1 | tail -5 || echo "$LOG_PREFIX   FAILED propose-action"
else
  echo "$LOG_PREFIX [pulse] step 3f/9: skip propose-action (only $RECENT_LEARNING new)"
fi

# 3g. Notify Kirill of one pending action proposal (highest confidence first)
echo "$LOG_PREFIX [pulse] step 3g/9: propose-action notify"
"$NODE_BIN" scripts/organism/propose-action.mjs notify 2>&1 | tail -2 || echo "$LOG_PREFIX   FAILED propose-notify"

# 3h. Sensor blind-spot analysis (once per day if no recent proposal)
LAST_SENSOR=$(sqlite3 "$PROJECT_DIR/.data/organism.db" "SELECT julianday('now') - julianday(MAX(proposed_at)) FROM sensor_proposals" 2>/dev/null || echo 99)
if [ "$(echo "$LAST_SENSOR > 1.0 || $LAST_SENSOR == ''" | bc 2>/dev/null || echo 1)" -eq 1 ]; then
  echo "$LOG_PREFIX [pulse] step 3h/9: propose-sensor analyze"
  "$NODE_BIN" scripts/organism/propose-sensor.mjs analyze 2>&1 | tail -3 || echo "$LOG_PREFIX   FAILED propose-sensor"
fi

# 3i. Regenerate visual dashboard (cheap — pure SQL render)
echo "$LOG_PREFIX [pulse] step 3i/9: dashboard render"
"$NODE_BIN" scripts/organism/dashboard.mjs > /dev/null 2>&1 && echo "$LOG_PREFIX   dashboard rendered" || echo "$LOG_PREFIX   FAILED dashboard"

# 3j. Morning report — fires once per day in the 7-9am window
HOUR=$(date +%H)
TODAY=$(date +%Y-%m-%d)
MORNING_FLAG="$PROJECT_DIR/.data/organism-morning-report-fired-$TODAY.flag"
if [ "$HOUR" -ge 7 ] && [ "$HOUR" -le 9 ] && [ ! -f "$MORNING_FLAG" ]; then
  echo "$LOG_PREFIX [pulse] step 3j/9: morning report (first pulse in 7-9 window)"
  "$NODE_BIN" scripts/organism/morning-report.mjs 2>&1 | tail -2
  touch "$MORNING_FLAG"
  # Clean old flags (keep only today)
  find "$PROJECT_DIR/.data" -maxdepth 1 -name "organism-morning-report-fired-*.flag" -mtime +1 -delete 2>/dev/null
fi

# 4. Brief stats summary
echo "$LOG_PREFIX [pulse] step 4/7:stats"
sqlite3 "$PROJECT_DIR/.data/organism.db" "SELECT 'beliefs:' || COUNT(*) FROM beliefs UNION ALL SELECT 'outcomes:' || COUNT(*) FROM outcomes UNION ALL SELECT 'unprocessed:' || COUNT(*) FROM outcomes WHERE processed_at IS NULL UNION ALL SELECT 'claims:' || COUNT(*) FROM claims UNION ALL SELECT 'sources:' || COUNT(*) FROM source_credibility" 2>&1 | sed "s/^/$LOG_PREFIX   /"

echo "$LOG_PREFIX === PULSE COMPLETE ==="
