---
description: Switch Tolik to CODE mode — voice commands paste into active Claude Code Terminal
---

# /code-mode

Switch Tolik to **code mode**. Every voice command after wake-word "Толик" pastes directly into your active Claude Code Terminal via clipboard + Cmd+V + Enter.

This is the killer use case: hands-free pair-programming with the FULL Claude Code (Max subscription, your MCP servers, full repo context) — not Tolik's separate OpenAI sub-loop.

```bash
curl -s -X POST http://127.0.0.1:4789/api/tolik/mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"code"}' | python3 -c "import sys,json; r=json.load(sys.stdin); print(f'Mode → {r.get(\"mode\")}' if r.get('ok') else f'FAIL: {r}')"
```

Voice equivalent: say **"Толик, кодить"** (or "code mode") at any time.

To switch back: `/brain-mode` or say **"Толик, мозг"**.
