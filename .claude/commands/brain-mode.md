---
description: Switch Tolik to BRAIN mode — voice commands run through Tolik's agentic loop (OpenAI tools + substrate)
---

# /brain-mode

Switch Tolik back to **brain mode** (default). Every voice command runs through Tolik's full agentic loop — multi-step tool calling, substrate awareness (atlas, ISAs, beliefs), morning brief, content drafting, dispatch to specialists.

```bash
curl -s -X POST http://127.0.0.1:4789/api/tolik/mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"brain"}' | python3 -c "import sys,json; r=json.load(sys.stdin); print(f'Mode → {r.get(\"mode\")}' if r.get('ok') else f'FAIL: {r}')"
```

Voice equivalent: say **"Толик, мозг"** (or "brain mode") at any time.
