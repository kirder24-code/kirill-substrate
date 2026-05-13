/**
 * One-shot: send AU fiscal-year LinkedIn post draft to Kirill via Telegram.
 * Run: node scripts/factory/send-au-linkedin-draft.mjs
 * Delete after use or keep for audit trail.
 */
import { tgSendToKirill } from "./orchestrator.mjs";

const DRAFT = `📋 <b>LINKEDIN DRAFT — AU FY26 Sprint</b>

---

Australian founders: you have 6 weeks to spend your FY26 tech budget on something that compounds into FY27.

Three things I see killing AU startup momentum right now:

- Outreach still manual: founders spending 3+ hours/day on LinkedIn DMs that go nowhere
- No pipeline visibility: leads fall through the cracks because there is no system, just a spreadsheet and good intentions
- Ops eating founder time: 20-30% of the week on tasks that could run on autopilot

If any of these hit home, the June 30 deadline is actually your leverage - not a pressure.

DM me if you want a 20-min scope call before June 30.

---
<i>Do NOT auto-post. Reply approve/edit/skip.</i>`;

await tgSendToKirill(DRAFT);
console.log("[AU-draft] Sent LinkedIn draft to Kirill via Telegram.");
