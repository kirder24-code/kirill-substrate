#!/usr/bin/env bash
# SessionStart hook — injects the organism digest at the start of every Claude session.
# The digest is the persistent memory of the organism (belief graph) — Claude reads it
# and starts the conversation already knowing what the organism currently believes.

set -euo pipefail

PROJECT_DIR="$CLAUDE_PROJECT_DIR"
DIGEST_PATH="$PROJECT_DIR/.data/organism-digest.md"
NODE_BIN="$HOME/.nvm/versions/node/v22.22.2/bin/node"

# Regenerate digest from current organism state (cheap — pure SQL reads, no LLM).
"$NODE_BIN" "$PROJECT_DIR/scripts/organism/digest.mjs" >/dev/null 2>&1 || true

# Output the digest if it exists. Anything we print goes into the session context.
if [[ -f "$DIGEST_PATH" ]]; then
  echo "═══════════════════════════════════════════════════════════════════════"
  echo "  ORGANISM DIGEST (auto-injected by SessionStart hook)"
  echo "═══════════════════════════════════════════════════════════════════════"
  echo ""
  cat "$DIGEST_PATH"
  echo ""
  echo "═══════════════════════════════════════════════════════════════════════"
fi
