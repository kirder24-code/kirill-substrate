---
description: Calibrate the snap-listener threshold — print live RMS while you snap
---

# /snap-calibrate

Run snap-listener in calibration mode for 30 seconds. Print live RMS levels so you can pick a good `TOLIK_SNAP_THRESHOLD`.

```bash
cd $CLAUDE_PROJECT_DIR
scripts/jarvis/.venv/bin/python scripts/jarvis/snap-listener.py --calibrate --seconds 30
```

When done, edit your `.env` (or your shell rc) and set:

```
TOLIK_SNAP_THRESHOLD=<recommended value from the output>
```

Then restart snap-listener via `/tolik-stop` then `/tolik`.
