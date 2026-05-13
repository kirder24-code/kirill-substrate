import { tgSendToKirill } from "./orchestrator.mjs";

const url = "https://reddit.com/r/AI_Agents/comments/1stevxo/";
const draft = `What part of your workflow is eating the most time - listings, lead follow-up, or qualification? I build custom AI pipelines for exactly this. Just finished one for a service biz that cut their follow-up time by 80%. Happy to show you what that could look like for real estate - 20 min call?`;

const msg = `🔥 *LIVE BUYER — r/AI_Agents (real estate AI)*\n\n${url}\n\n*Draft comment:*\n${draft}`;

await tgSendToKirill(msg);
console.log("Sent.");
