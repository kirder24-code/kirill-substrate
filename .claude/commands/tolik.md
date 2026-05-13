---
description: Start the full Tolik hybrid voice OS — snap listener + Vosk wake word + mode router
---

# /tolik — start Tolik voice OS

Starts the full Tolik hybrid stack:

1. **snap-listener.py** — double-snap detector (calls `/api/tolik/snap` on hit)
2. **voice-loop.py** — Vosk wake-word "Толик" + STT → POST to `/api/tolik/voice-command`
3. **webhook-server.mjs** + **browser-agent.mjs** — backend if not already up
4. **proactive-loop.mjs** — autonomous thoughts

Voice flow:

```
double-snap → /api/tolik/snap → launch-session.sh
              (opens VS Code, Tolik dashboard, Claude Code Terminal, arranges windows)

"Толик" wake word → beep → record → STT → /api/tolik/voice-command
  → mode router
       ↳ "code" mode → paste into active Claude Code Terminal (via osascript)
       ↳ "brain" mode → existing voice-bridge (OpenAI agentic loop)

Voice mode-switch:
  "Толик, кодить"  → code mode
  "Толик, мозг"   → brain mode
```

Execute the following bash commands to start all daemons:

```bash
cd $CLAUDE_PROJECT_DIR

# 1. Start webhook-server if not running
if ! lsof -i :4789 -sTCP:LISTEN -P -n >/dev/null 2>&1; then
  nohup node scripts/survival/webhook-server.mjs > .data/webhook-server.log 2>&1 & disown
fi

# 2. Start browser-agent (Tolik's hands)
if ! lsof -i :4790 -sTCP:LISTEN -P -n >/dev/null 2>&1; then
  nohup node scripts/tolik/browser-agent.mjs > .data/tolik-browser-agent.log 2>&1 & disown
fi

# 3. Start snap-listener (Python venv)
if ! pgrep -f "scripts/jarvis/snap-listener.py" >/dev/null; then
  nohup scripts/jarvis/.venv/bin/python scripts/jarvis/snap-listener.py > .data/tolik-snap-listener.log 2>&1 & disown
fi

# 4. Start voice-loop (Vosk wake word)
if ! pgrep -f "scripts/jarvis/voice-loop.py" >/dev/null; then
  nohup scripts/jarvis/.venv/bin/python scripts/jarvis/voice-loop.py > .data/tolik-voice-loop.log 2>&1 & disown
fi

sleep 2
echo "=== Tolik hybrid OS status ==="
lsof -i :4789 -sTCP:LISTEN -P -n | grep -v COMMAND | awk '{print "webhook-server:", $2}'
lsof -i :4790 -sTCP:LISTEN -P -n | grep -v COMMAND | awk '{print "browser-agent:", $2}'
pgrep -f "snap-listener.py" | xargs -I{} echo "snap-listener: {}"
pgrep -f "voice-loop.py" | xargs -I{} echo "voice-loop: {}"
echo "Mode: $(curl -s http://127.0.0.1:4789/api/tolik/mode | python3 -c 'import sys,json;print(json.load(sys.stdin).get("mode","?"))')"
```

After this runs: snap your fingers twice to launch a full session, then say "Толик ..." for any voice command.
