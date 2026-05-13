---
description: Stop all Tolik daemons (snap-listener, voice-loop, browser-agent, proactive-loop) but keep webhook-server
---

# /tolik-stop — stop Tolik voice OS

Kills snap-listener.py, voice-loop.py, browser-agent.mjs, proactive-loop.mjs. Leaves webhook-server up (it's needed for the dashboard + other endpoints).

```bash
cd $CLAUDE_PROJECT_DIR

for pat in "scripts/jarvis/snap-listener.py" "scripts/jarvis/voice-loop.py" "scripts/tolik/browser-agent.mjs" "scripts/tolik/proactive-loop.mjs"; do
  pids=$(pgrep -f "$pat" 2>/dev/null)
  if [ -n "$pids" ]; then
    echo "Killing $pat (pids: $pids)"
    echo "$pids" | xargs kill -TERM 2>/dev/null
    sleep 1
    # SIGKILL stragglers
    still=$(pgrep -f "$pat" 2>/dev/null)
    [ -n "$still" ] && echo "$still" | xargs kill -9 2>/dev/null
  else
    echo "Not running: $pat"
  fi
done

# Clean stale pid files
rm -f .data/tolik-snap-listener.pid .data/tolik-voice-loop.pid .data/tolik-browser-agent.pid 2>/dev/null
echo "=== Tolik stopped ==="
```
