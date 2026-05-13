#!/bin/bash
FILE="$CLAUDE_PROJECT_DIR/.logs/orchestrator-decisions.log"
LINES=$(wc -l < "$FILE" 2>/dev/null || echo 0)
if [ "$LINES" -gt 20 ]; then
  head -n -15 "$FILE" >> "${FILE}.archive"
  tail -15 "$FILE" > "${FILE}.tmp"
  mv "${FILE}.tmp" "$FILE"
  echo "Compacted: kept last 15, archived $(($LINES - 15))"
fi
