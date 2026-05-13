# Visual Agent Variant C — Success Checks (written BEFORE build)

This file is the spec. Code does not get to claim "done" until the corresponding probe below returns ✓ to Kirill via Telegram.

Author: 2026-05-13, before Wave 1 implementation started.
Rule: every check must be runnable as a one-liner that a human can verify by looking at the **output**, not the **logs**.

---

## LEVEL 1 — STATIC ASSET (baseline, already mostly built)

A run of `node scripts/content/visual-agent.mjs --level=static --topic="<any-topic>"` succeeds iff ALL of these are true:

| # | Check | How Kirill verifies |
|---|---|---|
| S1 | A real PNG file exists at the path returned in the JSON output | `ls -la <path>` shows file > 50 KB |
| S2 | The PNG opens and renders without corruption | Preview it on macOS; image displays |
| S3 | The PNG matches Substrate brand (dark void bg, cyan/gold/amber accent, Syne/Inter fonts) | Visual inspection: looks like Substrate, not like Canva |
| S4 | A Telegram message is delivered to Kirill's chat with the PNG attached + 4 inline buttons (Publish / Edit / Reject / Variants) | Kirill opens Telegram, sees the message + image |
| S5 | The brief metadata in DB (`content_visual_assets`) matches what's in the PNG (template, accent, headline text) | `sqlite3 .data/linkedin-brand-os.sqlite "SELECT * FROM content_visual_assets ORDER BY id DESC LIMIT 1"` |
| S6 | No forbidden phrases ("guaranteed", "100x", "millions") in any text rendered on the image | grep through brief.json |
| S7 | End-to-end wall time < 30 sec | timestamp in log |

---

## LEVEL 2 — MOTION ASSET (new)

A run of `node scripts/content/visual-agent.mjs --level=motion --topic="<any-topic>"` succeeds iff ALL of these are true:

| # | Check | How Kirill verifies |
|---|---|---|
| M1 | A real **MP4 file** exists at the path returned in the JSON output | `ls -la <path>` shows .mp4 file |
| M2 | The MP4 is between 100 KB and 8 MB (LinkedIn upload comfort zone) | `ls -la` size check |
| M3 | The MP4 duration is between 3 and 12 seconds | `ffprobe <path>` shows duration in range |
| M4 | The MP4 plays in macOS QuickTime without errors | Kirill double-clicks the file; it plays |
| M5 | The MP4 has visible content matching brief (kinetic text / animated flow / state transformation) — not a black screen | Kirill watches it |
| M6 | Frame 0 and final frame are pixel-equivalent IF brief said `loop: true` | Visual: video can be set to loop without jump |
| M7 | A separate **GIF version** of same content is also produced (for LinkedIn feed autoplay fallback) | `ls -la <path>.gif` shows file < 6 MB |
| M8 | A Telegram message is delivered to Kirill with the MP4 attached + same 4 inline buttons | Kirill sees video preview play in Telegram |
| M9 | DB row in `content_visual_assets` records `asset_level='motion'` + paths to BOTH mp4 and gif | sqlite3 query |
| M10 | End-to-end wall time < 90 sec (Playwright record + ffmpeg) | timestamp |

---

## LEVEL 3 — SCROLL / WEB EXPERIENCE (new)

A run of `node scripts/content/visual-agent.mjs --level=scroll --topic="<any-topic>" --recipe="<launchsoloai-landing|apollo-case|substrate-explainer>"` succeeds iff ALL of these are true:

| # | Check | How Kirill verifies |
|---|---|---|
| W1 | A real **HTML file** with all CSS/JS inlined exists at the path returned | `ls -la <path>.html` |
| W2 | Opening that HTML in browser shows N full-viewport sections (where N = 4 to 8 per web-experience-designer spec) | Kirill opens the file in Safari |
| W3 | Scrolling reveals each section with the specified animations (fade+translate, hero pin, etc.) | Kirill scrolls; visible |
| W4 | A **scroll-recording MP4** of the page being scrolled at human pace from top to bottom is produced | `ls -la <path>.scroll.mp4` |
| W5 | The scroll MP4 is between 10 and 60 seconds (depends on section count) | `ffprobe` duration |
| W6 | A **multi-page PDF** version exists (one section per page) | `ls -la <path>.pdf` |
| W7 | Brief includes a CTA destination URL — and it's preserved verbatim in the rendered HTML (no invented URLs) | grep HTML for the URL |
| W8 | The HTML passes egress check (no API keys, no $HOME/ paths leaked) | egress-guard scan |
| W9 | Telegram message delivered with PDF + scroll MP4 attached + inline buttons | Kirill checks Telegram |
| W10 | All numeric claims in HTML match substrate state (591 beliefs, etc., from organism.db at render time, NOT made-up) | hard-claim verification probe |
| W11 | DB row recorded with `asset_level='scroll'` + recipe name + N sections | sqlite3 query |

---

## ANTI-CHEAT: HOW POST-HOC TESTS WOULD FAIL

This is the trap I'm avoiding. Examples of checks that would self-confirm:

- ❌ "function returned an object" — proves nothing about user-visible output
- ❌ "file was created" — without size/format/playback checks
- ❌ "Telegram API returned 200" — Telegram returns 200 for many delivery-failed states
- ❌ "render completed without errors" — black PNG renders without errors too
- ❌ "schema matches" — if the schema was also designed during build, this is circular

Every check above either:
- Requires a non-zero file size in a specific format (verifiable by `ffprobe`/`file`/byte count)
- Requires Kirill's eyes (visual inspection step explicit)
- Compares output to brief data that came from an INDEPENDENT source (org-db, awareness, signal-hooks — written by other systems before today)

---

## DONE CRITERIA FOR EACH WAVE

- **Wave 1 (personas + structured trends + mapper):** Not user-facing. Done when `node scripts/content/visual-agent.mjs --level=static` still passes ALL S1-S7 (no regression) AND new personas are consulted (verifiable in run log).
- **Wave 2 (motion):** Done when running `--level=motion --topic="Substrate's 5-layer architecture"` produces M1-M10 all green. The MP4 must arrive in Kirill's Telegram and be watchable.
- **Wave 3 (scroll):** Done when running `--level=scroll --recipe=launchsoloai-landing` produces W1-W11 all green. Kirill opens the HTML file in a real browser and confirms the experience.
- **Wave 4 (references):** Done when visual-researcher consultation cites at least 3 references from `references-seed.json` when called on a brief, AND the JSON contains 20+ real entries. Verified by running a brief and inspecting the panel output.
- **Wave 5 (integration):** Done when all 3 levels (static + motion + scroll) can be triggered by `--level` flag and all checks above pass in a single test run. Final deliverable: a session report showing Telegram screenshots for each of the 3 levels.

---

## EXTERNAL VERIFICATION HARNESS

`scripts/content/_spec/run-checks.mjs` — runs each level, then probes each numbered check, prints a pass/fail table.

The harness does NOT live in the same file as the code being tested. It opens the outputs through ffprobe, file size checks, sqlite queries — tools written by OTHER projects, not by me in this build.

The harness is the test. If a check fails, the build is not done. No "almost works".
