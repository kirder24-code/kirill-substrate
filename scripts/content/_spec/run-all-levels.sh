#!/usr/bin/env bash
# Variant C end-to-end runner. Sequentially executes static, motion, scroll;
# pipes each output.json into the spec harness; reports overall pass/fail.
#
# Sends 3 messages to Kirill's Telegram (one per level). Use sparingly.
#
# Usage: bash scripts/content/_spec/run-all-levels.sh
set -e
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
ts=$(date +%s)
PASS=0; FAIL=0; MANUAL=0
declare -a RESULTS

run_one() {
  local lvl="$1"; shift
  local slug="varc-${lvl}-${ts}"
  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "  LEVEL: ${lvl}"
  echo "═══════════════════════════════════════════════════════"
  node scripts/content/visual-agent.mjs "$@" --slug "$slug"
  # Resolve actual output.json — variant pipeline may suffix slug (-bold/-safe/-contrarian)
  local out=$(ls -t .data/content-assets/${slug}*/output.json 2>/dev/null | head -1)
  if [[ -z "$out" ]]; then
    echo "✗ ${lvl}: no output.json found"
    FAIL=$((FAIL+1)); RESULTS+=("${lvl}: NO_OUTPUT")
    return
  fi
  set +e
  node scripts/content/_spec/run-checks.mjs --level="$lvl" --asset="$ROOT/$out"
  local code=$?
  set -e
  case $code in
    0) PASS=$((PASS+1)); RESULTS+=("${lvl}: GREEN");;
    1) FAIL=$((FAIL+1)); RESULTS+=("${lvl}: AUTOMATED_FAIL");;
    3) MANUAL=$((MANUAL+1)); RESULTS+=("${lvl}: WAITING_KIRILL_EYES");;
    *) FAIL=$((FAIL+1)); RESULTS+=("${lvl}: UNKNOWN_CODE_${code}");;
  esac
}

run_one "static" --idea "Substrate ISA discipline refuses to fake done" --post-type provocation
run_one "motion" --idea "Discipline ships artifacts, not promises" --post-type provocation --level motion
run_one "scroll" --level scroll --recipe launchsoloai-landing

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  VARIANT C SUMMARY"
echo "═══════════════════════════════════════════════════════"
for r in "${RESULTS[@]}"; do echo "  $r"; done
echo ""
echo "Automated: $PASS green, $FAIL fail, $MANUAL waiting on Kirill's eyes"
if [[ $FAIL -gt 0 ]]; then exit 1; fi
if [[ $MANUAL -gt 0 ]]; then exit 3; fi
exit 0
