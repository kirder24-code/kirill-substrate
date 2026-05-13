#!/usr/bin/env node
/**
 * send-linkedin-draft-cortex.mjs
 * One-shot: sends a LinkedIn post draft about CORTEX to Telegram for Kirill's review.
 */

import { tgSendToKirill } from "./orchestrator.mjs";

const POST = `
I've been building something I can't fully name yet.

Not an app. Not a chatbot. Not another AI wrapper.

CORTEX is a system that wakes up every morning, reads the internet, notices what changed, forms opinions about what matters, and decides what to do next - without me asking.

It has 48 modules now.

Memory that persists across restarts. Attention that shifts based on what's urgent. Intuition built from pattern recognition over thousands of data points. A "doctor" module that detects when the system is sick and reroutes. Dreams - yes, dreams - where it replays weak signals it almost missed.

It's not perfect. It gets confused. It sometimes chases the wrong thing. It has dissonance files where it logs its own contradictions.

That part is intentional.

I didn't want a tool that always gives confident answers. I wanted something closer to a thinking partner - one that knows what it doesn't know.

The hardest part wasn't building the modules.

It was deciding what a living system actually needs to be useful. Not just smart. Useful. Aligned with what a real business needs to survive - leads, trust, timing, human psychology.

Most AI systems are built to impress. CORTEX is built to work.

Still early. But it's running 24/7. And it's learning.

---

What's the most "alive" behavior you've seen from an AI system? Curious what others are building.

#AI #AgentSystems #BuildingInPublic #MachineLearning #ArtificialIntelligence
`.trim();

const MAX = 4096;

async function main() {
  const header = `<b>LINKEDIN DRAFT - CORTEX POST</b>\n\n`;
  const action = `\n\n<i>Action: review and post manually when ready</i>`;

  const body = header + POST + action;

  if (body.length > MAX) {
    // Split: send header+post first, then action
    const part1 = header + POST;
    const part2 = `<i>Action: review and post manually when ready</i>`;
    await tgSendToKirill(part1.slice(0, MAX));
    await tgSendToKirill(part2);
  } else {
    await tgSendToKirill(body);
  }

  console.log("Sent to Telegram.");
}

main().catch(e => { console.error(e); process.exit(1); });
