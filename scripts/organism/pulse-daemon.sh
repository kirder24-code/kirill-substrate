#!/usr/bin/env bash
# organism/pulse-daemon.sh
# Long-running daemon that runs organism-pulse.sh once per hour.
# More reliable than cron on macOS (which is blocked from Desktop access without
# Full Disk Access permissions). Sleeps between pulses.
#
# Start:  nohup bash scripts/organism/pulse-daemon.sh > .data/pulse-daemon.log 2>&1 &
#         echo $! > .data/pulse-daemon.pid
# Stop:   kill $(cat .data/pulse-daemon.pid)
# Status: ps -p $(cat .data/pulse-daemon.pid)

set -u

PROJECT_DIR="$CLAUDE_PROJECT_DIR"
PULSE_SCRIPT="$PROJECT_DIR/scripts/organism/organism-pulse.sh"
LOG_FILE="$PROJECT_DIR/.data/organism-pulse.log"
INTERVAL_SECONDS=3600  # one hour

cd "$PROJECT_DIR"

# Run a first pulse immediately on startup so we have fresh state right away
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [pulse-daemon] starting, first pulse now then every ${INTERVAL_SECONDS}s" >> "$LOG_FILE"

while true; do
  # Run one pulse, append its output to the log
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [pulse-daemon] firing pulse" >> "$LOG_FILE"
  bash "$PULSE_SCRIPT" >> "$LOG_FILE" 2>&1 || echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [pulse-daemon] pulse exit code $?" >> "$LOG_FILE"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [pulse-daemon] sleeping ${INTERVAL_SECONDS}s" >> "$LOG_FILE"
  sleep "$INTERVAL_SECONDS"
done
