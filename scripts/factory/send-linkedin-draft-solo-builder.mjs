#!/usr/bin/env node
/**
 * send-linkedin-draft-solo-builder.mjs
 * One-shot: sends LinkedIn post draft about solo builder AI tool pain points to Telegram.
 */

import { tgSendToKirill } from "./orchestrator.mjs";

const POST = `
Nobody talks about the ceiling you hit as a solo AI builder.

Not the ceiling of ideas. The ceiling of tools.

You're 3 weeks into a project. Claude is reasoning better than ever. Cursor is autocompleting whole functions. You feel unstoppable.

Then you hit the wall.

Claude's context window fills up mid-session. The model forgets what it built 20 minutes ago. You paste the same file for the third time this hour.

Cursor starts hallucinating imports. The autocomplete is confident and completely wrong. You spend 40 minutes debugging code you didn't write.

QA becomes a guessing game. No test suite. No staging environment. Just you, refreshing prod, hoping nothing breaks.

The tools are incredible. But they weren't designed for someone running a full product alone.

Here's what I've learned after building 48 modules of an autonomous system solo:

The bottleneck isn't AI capability. It's orchestration.

You need systems that remember across sessions. That hand off context without losing it. That run checks before shipping - not after.

When you build those layers, the tools stop being ceilings. They become floors.

Still expensive to build. Still worth it.

---

Solo builders: where does your AI workflow break down first?

#AI #SoloFounder #BuildingInPublic #AITools #ProductDevelopment
`.trim();

const MAX = 4096;

async function main() {
  const header = `<b>LINKEDIN DRAFT - SOLO BUILDER AI PAIN</b>\n\n`;
  const action = `\n\n<i>Action: review and post manually when ready</i>`;

  const body = header + POST + action;

  if (body.length > MAX) {
    const part1 = header + POST;
    const part2 = `<i>Action: review and post manually when ready</i>`;
    await tgSendToKirill(part1.slice(0, MAX));
    await tgSendToKirill(part2);
  } else {
    await tgSendToKirill(body);
  }

  console.log("Sent to Telegram. Length:", body.length);
}

main().catch(e => { console.error(e); process.exit(1); });
