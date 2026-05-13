/**
 * Draft a r/forhire post for Kirill to post manually.
 * No API needed. Kirill posts it, clients come inbound.
 */
import { callAI } from "../factory/orchestrator.mjs";

const POST = `[FOR HIRE] AI Automation Architect | Calgary & Remote | $1,500–5,000 CAD/project

**What I do:**
I turn your manual business processes into autonomous systems.
Not hype — working automations that save real hours.

**Recent builds:**
• CRM pipeline that auto-qualifies leads and notifies reps (saved 8 hrs/week)
• Invoice + reporting system that runs itself every Monday (no more manual spreadsheets)
• Client onboarding flow: intake → contract → welcome email → CRM, fully automated

**Best fit if you:**
✓ Run a growing business with a small team (1–20 people)
✓ Spend 5+ hours/week on the same repetitive tasks
✓ Need it done fast — I deliver working MVPs in 3–7 days

**Tech:** n8n · Node.js · OpenAI · Notion · Make · Zapier migrations
**Background:** 5+ years directing high-stakes operations (government level), M.Sc. Systems Engineering

**Pricing:**
• Simple automation: $1,500–2,500 CAD
• Full AI Orchestrator: $3,000–8,000 CAD
• Monthly retainer: $1,500–2,500/month

**Industries I've worked with:** Accounting, Legal, Real Estate, Marketing Agencies, IT Services, Property Management

DM me or comment what you're trying to automate — happy to give a quick read on whether it's worth it.

*Calgary-based, work remotely across Canada and US.*`;

console.log("=== POST FOR r/forhire ===\n");
console.log(POST);
console.log("\n=== ALSO POST ON: ===");
console.log("• r/forhire");
console.log("• r/slavelabour (smaller budget clients)");
console.log("• r/hiring4 ");
console.log("• r/entrepreneur (as a comment on relevant threads)");
console.log("\n=== FACEBOOK GROUPS (manual post) ===");
console.log("• 'Calgary Entrepreneurs & Business Owners'");
console.log("• 'Calgary Small Business Network'");
console.log("• 'Alberta Entrepreneurs'");
