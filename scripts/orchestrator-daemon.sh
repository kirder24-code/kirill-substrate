#!/usr/bin/env bash
# ORCHESTRATOR DAEMON — runs loop every 10 minutes as background process
# Not cron — avoids macOS "Operation not permitted" issue
# Start: nohup bash scripts/orchestrator-daemon.sh &

PROJECT_DIR="$CLAUDE_PROJECT_DIR"
LOG_FILE="$PROJECT_DIR/.logs/orchestrator-loop.log"
PID_FILE="$PROJECT_DIR/.data/orchestrator-daemon.pid"

# Prevent duplicate daemons
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Daemon already running (PID $OLD_PID)"
    exit 0
  fi
fi
echo $$ > "$PID_FILE"
trap 'rm -f "$PID_FILE"' EXIT

echo "$(date) Orchestrator daemon started (PID $$, every 10 min)" >> "$LOG_FILE"

while true; do
  if ! node "$PROJECT_DIR/scripts/outreach/revenue-gate.mjs" --log-path "$PROJECT_DIR/.data/outreach-log.json" > "$PROJECT_DIR/.data/revenue-gate-status.json"; then
    echo "$(date) Revenue gate failed: no approved external outreach outcome in the last 72h" >> "$LOG_FILE"
    exit 1
  fi
  /bin/bash "$PROJECT_DIR/scripts/orchestrator-loop.sh" 2>&1
  sleep 1800
done
