#!/usr/bin/env bash
# Post-compaction hook
# Outputs SNAPSHOT.md and recent git log for context recovery
set -euo pipefail

PROJECT_DIR="$CLAUDE_PROJECT_DIR"
SNAPSHOT="$PROJECT_DIR/SNAPSHOT.md"

echo "=== POST-COMPACT CONTEXT RECOVERY ==="

# Show SNAPSHOT if it exists
if [[ -f "$SNAPSHOT" ]]; then
  echo "--- SNAPSHOT.md ---"
  cat "$SNAPSHOT"
  echo ""
fi

# Show recent git history
echo "--- Last 5 commits ---"
git -C "$PROJECT_DIR" log --oneline -5 2>/dev/null

echo "=== END CONTEXT RECOVERY ==="
