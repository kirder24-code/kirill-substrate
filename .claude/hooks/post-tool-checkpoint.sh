#!/usr/bin/env bash
# Post-tool-use checkpoint hook
# Counts tool calls and reminds to commit every 20 calls
set -euo pipefail

COUNTER_FILE="/tmp/lbo-tool-counter.txt"
PROJECT_DIR="$CLAUDE_PROJECT_DIR"
INTERVAL=20

# Read or initialize counter
if [[ -f "$COUNTER_FILE" ]]; then
  count=$(cat "$COUNTER_FILE" 2>/dev/null || echo 0)
else
  count=0
fi

count=$((count + 1))
echo "$count" > "$COUNTER_FILE"

# Check every N calls
if (( count % INTERVAL == 0 )); then
  changes=$(git -C "$PROJECT_DIR" status --porcelain 2>/dev/null | head -5)
  if [[ -n "$changes" ]]; then
    echo "[CHECKPOINT] $count tool calls. Uncommitted changes detected:"
    echo "$changes"
    echo "Consider: commit progress + update SNAPSHOT.md"
  fi
fi
