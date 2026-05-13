#!/usr/bin/env bash
# Pre-compaction hook
# Stages tracked files, updates SNAPSHOT timestamp, outputs state summary
set -euo pipefail

PROJECT_DIR="$CLAUDE_PROJECT_DIR"
SNAPSHOT="$PROJECT_DIR/SNAPSHOT.md"

cd "$PROJECT_DIR"

# Stage only tracked files (never untracked - avoids secrets)
git add -u 2>/dev/null || true

# Update SNAPSHOT timestamp if it exists
if [[ -f "$SNAPSHOT" ]]; then
  if grep -q "^Last updated:" "$SNAPSHOT" 2>/dev/null; then
    sed -i '' "s/^Last updated:.*/Last updated: $(date '+%Y-%m-%d %H:%M')/" "$SNAPSHOT"
  fi
  git add "$SNAPSHOT" 2>/dev/null || true
fi

# Output state summary for context recovery
echo "=== PRE-COMPACT STATE SUMMARY ==="
echo "Branch: $(git branch --show-current 2>/dev/null)"
echo "Time: $(date '+%Y-%m-%d %H:%M')"
echo ""
echo "--- Modified files ---"
git diff --cached --name-only 2>/dev/null | head -15
echo ""
echo "--- Recent commits ---"
git log --oneline -3 2>/dev/null
echo "=== END STATE SUMMARY ==="
