#!/usr/bin/env bash
# scripts/jarvis/launch-session.sh
#
# Triggered by webhook-server when /api/tolik/snap fires (double-snap detected).
# Brings up Kirill's full dev environment in one motion. Strictly idempotent:
# if a piece is already up (terminal with claude open, Chrome tab on Tolik,
# vite running), DOESN'T duplicate it — it ACTIVATES the existing one.
#
# DEBOUNCE: writes a lock file with timestamp; refuses to fire if last fire
# was less than DEBOUNCE_SECONDS ago. Prevents the "snap twice quickly →
# 8 terminals open" failure mode that bit us in build #87.

set -euo pipefail
PROJECT="$CLAUDE_PROJECT_DIR"
LOG="$PROJECT/.data/launch-session.log"
LOCK="$PROJECT/.data/launch-session.lock"
DEBOUNCE_SECONDS=60

mkdir -p "$(dirname "$LOG")"
ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "[$(ts)] $*" >> "$LOG"; }

# ── DEBOUNCE ────────────────────────────────────────────────────────────────
if [ -f "$LOCK" ]; then
  last=$(cat "$LOCK" 2>/dev/null || echo 0)
  now=$(date +%s)
  age=$((now - last))
  if [ $age -lt $DEBOUNCE_SECONDS ]; then
    log "DEBOUNCED — last launch ${age}s ago, threshold ${DEBOUNCE_SECONDS}s. Skipping."
    afplay /System/Library/Sounds/Funk.aiff >/dev/null 2>&1 &
    exit 0
  fi
fi
date +%s > "$LOCK"

# Confirmation chime — Tink (short, neutral)
afplay /System/Library/Sounds/Tink.aiff >/dev/null 2>&1 &

log "snap-launch starting"

# ── 1. Webhook-server (port 4789) ────────────────────────────────────────────
if ! lsof -i :4789 -sTCP:LISTEN -P -n >/dev/null 2>&1; then
  log "starting webhook-server"
  cd "$PROJECT"
  nohup node scripts/survival/webhook-server.mjs > .data/webhook-server.log 2>&1 &
  disown
  log "webhook-server pid=$!"
else
  log "webhook-server already up"
fi

# ── 2. Browser-agent (port 4790, Tolik's hands) ──────────────────────────────
if ! lsof -i :4790 -sTCP:LISTEN -P -n >/dev/null 2>&1; then
  log "starting tolik browser-agent"
  cd "$PROJECT"
  nohup node scripts/tolik/browser-agent.mjs > .data/tolik-browser-agent.log 2>&1 &
  disown
  log "browser-agent pid=$!"
else
  log "browser-agent already up"
fi

# ── 3. Tolik proactive loop (autonomous thoughts) ───────────────────────────
if ! pgrep -f "tolik/proactive-loop.mjs" >/dev/null 2>&1; then
  log "starting proactive-loop"
  cd "$PROJECT"
  nohup node scripts/tolik/proactive-loop.mjs > .data/tolik-proactive-loop.log 2>&1 &
  disown
fi

# ── 4. Tolik Mission Control dashboard (vite, apps/tolik) ───────────────────
# Find the apps/tolik vite specifically by matching the process command line.
# Earlier bug: checking only port 5173/5174/5181 — but port could be ANYTHING
# (vite auto-picks next free port), and 5181 might be a different process
# entirely (e.g. a python server). Match on the process command line instead.
find_tolik_port() {
  for pid in $(pgrep -f "apps/tolik.*vite/bin/vite.js" 2>/dev/null); do
    port=$(lsof -an -p "$pid" -i TCP -sTCP:LISTEN -P 2>/dev/null | grep -v COMMAND | head -1 | awk '{print $9}' | sed 's/.*://')
    if [ -n "$port" ]; then echo "$port"; return; fi
  done
}
TOLIK_PORT="$(find_tolik_port)"

if [ -z "$TOLIK_PORT" ]; then
  log "starting Tolik Mission Control (vite, apps/tolik)"
  cd "$PROJECT/apps/tolik"
  nohup npm run dev > "$PROJECT/.data/apps-tolik-vite.log" 2>&1 &
  disown
  # Wait up to 10s for vite to bind
  for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 1
    TOLIK_PORT="$(find_tolik_port)"
    [ -n "$TOLIK_PORT" ] && break
  done
else
  log "apps/tolik vite already up on :$TOLIK_PORT"
fi

if [ -z "$TOLIK_PORT" ]; then
  log "WARN: apps/tolik vite did not bind a port within 10s"
  TOLIK_URL=""
else
  TOLIK_URL="http://127.0.0.1:$TOLIK_PORT"
fi

# ── 5. Chrome — activate EXISTING Tolik tab + force bring-to-front ──
# Critical: macOS doesn't bring Chrome to FRONT just because we activate it
# (especially across Spaces/desktops). Use `open -a` first which calls Launch
# Services to fully foreground the app, THEN activate the right tab.
log "bringing Chrome to front and selecting Tolik tab at $TOLIK_URL"
if [ -n "$TOLIK_URL" ]; then
  # `open -a -g` would background; we want foreground without -g
  open -a "Google Chrome" 2>/dev/null
  sleep 0.2
fi

chrome_existing=$(osascript 2>/dev/null <<APPLESCRIPT
tell application "Google Chrome"
  activate
  set foundIt to false
  if (count windows) is 0 then return "no-windows"
  repeat with w in windows
    set tabIdx to 0
    repeat with t in tabs of w
      set tabIdx to tabIdx + 1
      if URL of t contains "127.0.0.1:" then
        set active tab index of w to tabIdx
        set index of w to 1
        return "activated-existing"
      end if
    end repeat
  end repeat
  return "no-match"
end tell
tell application "System Events"
  set frontmost of process "Google Chrome" to true
end tell
APPLESCRIPT
) || chrome_existing="error"

case "$chrome_existing" in
  "activated-existing")
    log "Chrome: activated existing Tolik tab + foregrounded"
    ;;
  "no-match"|"no-windows"|"error"|"")
    log "Chrome: opening fresh Tolik tab at $TOLIK_URL ($chrome_existing)"
    open -a "Google Chrome" "$TOLIK_URL" 2>/dev/null || open "$TOLIK_URL"
    ;;
esac

# Force frontmost (cross-Space focus)
osascript -e 'tell application "System Events" to set frontmost of (every process whose name is "Google Chrome") to true' 2>/dev/null || true

# ── 6. Open VS Code in workspace (idempotent — focuses existing window) ────
if command -v code >/dev/null 2>&1; then
  log "focusing VS Code on workspace"
  code "$PROJECT" >/dev/null 2>&1 &
fi

# ── 7. Terminal/iTerm2 — find existing claude window, or spawn ONE ─────────
log "checking for existing terminal with claude"

# First try iTerm2 if running
if pgrep -x iTerm2 >/dev/null 2>&1; then
  iterm_status=$(osascript 2>/dev/null <<APPLESCRIPT
tell application "iTerm2"
  set foundIt to false
  if (count windows) is 0 then return "no-windows"
  repeat with w in windows
    repeat with t in tabs of w
      set sessionName to name of current session of t
      if sessionName contains "claude" then
        select t
        select w
        activate
        return "activated"
      end if
    end repeat
  end repeat
  return "no-match"
end tell
APPLESCRIPT
) || iterm_status="error"

  if [ "$iterm_status" = "activated" ]; then
    log "iTerm2: activated existing claude tab"
  else
    log "iTerm2: spawning new claude tab ($iterm_status)"
    osascript 2>/dev/null <<APPLESCRIPT || log "iTerm2 spawn failed"
tell application "iTerm2"
  activate
  if (count windows) is 0 then
    create window with default profile
  end if
  tell current window
    create tab with default profile
    tell current session
      write text "cd '$PROJECT' && claude"
    end tell
  end tell
end tell
APPLESCRIPT
  fi
else
  # Terminal.app path — check window titles for "claude"
  term_status=$(osascript 2>/dev/null <<APPLESCRIPT
tell application "Terminal"
  set foundIt to false
  if (count windows) is 0 then return "no-windows"
  repeat with w in windows
    set wname to name of w
    if wname contains "claude" then
      set index of w to 1
      activate
      return "activated"
    end if
  end repeat
  return "no-match"
end tell
APPLESCRIPT
) || term_status="error"

  if [ "$term_status" = "activated" ]; then
    log "Terminal: activated existing claude window"
  else
    log "Terminal: spawning new claude window ($term_status)"
    osascript 2>/dev/null <<APPLESCRIPT
tell application "Terminal"
  activate
  do script "cd '$PROJECT' && claude"
end tell
APPLESCRIPT
  fi
fi

# ── 8. Window arrange (best-effort, AppleScript) ────────────────────────────
sleep 3
log "arranging windows"
osascript "$PROJECT/scripts/jarvis/window-arrange.applescript" 2>>"$LOG" || true

log "snap-launch complete"
