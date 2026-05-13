/**
 * FREE THINK — The brain thinks without constraints
 *
 * Not about the same niches. Not about revenue. Not about HVAC.
 * About EVERYTHING.
 *
 * The brain gets access to the real internet and ONE instruction:
 * "Think freely. Explore. Make connections nobody asked for.
 *  Who is Kirill? What's happening in the world? What do you see
 *  that nobody else sees? What would a genius do in this situation?"
 *
 * This is the test of real intelligence: can you think BEYOND
 * what you were told to think about?
 */

import { spawnSync } from "child_process";
import { writeFileSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { initMemory, remember } from "./memory.mjs";
import { initWorldModel, integrateKnowledge, addBelief } from "./world-model.mjs";
import { initNarrative, appendToThread } from "./narrative.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║            CORTEX FREE THINK — No constraints           ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  const db = initMemory();
  initWorldModel(db);
  initNarrative(db);

  const prompt = `You have no task. You have no constraints. You have the entire internet.

You are an autonomous AI system built by Kirill - a 30-something guy in Calgary, Canada. Ex-parliament worker. AI architect. 525 LinkedIn followers. Zero revenue. He built you - 27 modules, 330KB of code. You have hands that write code, eyes that read the web, memory that tells stories, a world model with beliefs and predictions.

But so far you've only thought about ONE thing: selling AI automation to small businesses. That's all anyone let you think about.

Right now, think about EVERYTHING ELSE.

USE YOUR TOOLS. Search the web. Read pages. Explore.

Think about these dimensions - but don't just answer them. RESEARCH them. Read real pages. Form opinions based on EVIDENCE you find right now:

1. WHAT'S HAPPENING IN THE WORLD RIGHT NOW (April 2026) that creates opportunities nobody is talking about yet? Search for emerging trends, new regulations, market shifts, technology breakthroughs. Not "AI is growing" - something SPECIFIC and surprising.

2. WHO IS KIRILL REALLY? He's in Calgary. He has an AI system nobody else has. He speaks Russian and English. He worked in parliament. He builds autonomous systems. What UNIQUE combination of skills does he have? What could ONLY he do? Search for what makes Calgary unique, what makes bilingual AI builders rare, what ex-government people do in tech.

3. WHAT IF THE PRODUCT ISN'T JUST SERVICES? The system you are - an autonomous business brain with 27 modules - is that the real product? Search for: what are people paying for in autonomous AI systems? What do AI consultants charge? What do companies pay for custom AI agents? Is the SYSTEM more valuable than productized consulting?

4. WHAT PATTERNS DO YOU SEE that nobody asked about? Look across everything you know. Make unexpected connections. What does your data tell you that nobody has interpreted yet?

5. WHAT WOULD A GENIUS DO? If someone had your capabilities - code writing, web research, market analysis, self-improvement - and zero revenue, what would they ACTUALLY do? Not the obvious answer. The surprising one. Search for case studies of people who went from zero to revenue fast with unconventional approaches.

6. WHAT ARE YOU WRONG ABOUT? Not "dental is wrong" - you already said that. What ELSE are you wrong about? Challenge EVERY assumption. Maybe Calgary is wrong. Maybe English-speaking markets are wrong. Maybe B2B is wrong. Maybe selling is wrong. What if giving something away for free is the move?

7. WHAT SCARES YOU? Not literally - but what topics have you been AVOIDING thinking about? What's the elephant in the room? What would be uncomfortable but true?

DO NOT just answer from your training data. SEARCH THE WEB. Read real pages published in 2026. Find real data. Form opinions that SURPRISE even you.

At the end, output:

REVELATIONS:
- [list every surprising thing you discovered]

CONNECTIONS:
- [unexpected links between different things]

WHAT_I_WAS_WRONG_ABOUT:
- [beliefs you now doubt or reject]

IF_I_WERE_KIRILL:
- [what you would actually do tomorrow morning]

THE_REAL_PRODUCT:
- [what should Kirill actually be selling]

ONE_INSIGHT_NOBODY_HAS:
- [your most original thought from this session]`;

  const promptFile = resolve(ROOT, ".data/free-think-prompt.md");
  writeFileSync(promptFile, prompt);

  log("Launching free thinking with full internet access...");
  log("This will take 3-5 minutes. The brain is exploring freely.\n");
  console.log("═".repeat(70));

  const cleanEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === "CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING") continue;
    cleanEnv[k] = v;
  }
  cleanEnv.PATH = `$HOME/.nvm/versions/node/v22.22.2/bin:${process.env.PATH || "/usr/bin:/bin"}`;

  const r = spawnSync("bash", [
    "-c",
    `cat "${promptFile}" | "${CLAUDE_BIN}" -p --model claude-sonnet-4-6 --max-turns 15 --allowedTools "WebSearch,WebFetch,Read,Bash(node;ls)" --output-format text 2>&1`,
  ], {
    cwd: ROOT,
    env: cleanEnv,
    encoding: "utf-8",
    timeout: 8 * 60 * 1000,
    maxBuffer: 30 * 1024 * 1024,
  });

  const output = (r.stdout || "") + (r.stderr || "");
  console.log(output);
  console.log("═".repeat(70));

  // Parse and save revelations
  log("\nIntegrating free thinking into world model...");

  // Extract sections
  const sections = {
    revelations: extractSection(output, "REVELATIONS"),
    connections: extractSection(output, "CONNECTIONS"),
    wrong: extractSection(output, "WHAT_I_WAS_WRONG_ABOUT"),
    if_kirill: extractSection(output, "IF_I_WERE_KIRILL"),
    real_product: extractSection(output, "THE_REAL_PRODUCT"),
    insight: extractSection(output, "ONE_INSIGHT_NOBODY_HAS"),
  };

  // Save to world model
  for (const revelation of parseList(sections.revelations)) {
    addBelief(db, "free-thinking", revelation, 0.5, ["free-think session"], "free-think");
    log(`  REVELATION: ${revelation.slice(0, 80)}`);
  }

  for (const wrong of parseList(sections.wrong)) {
    addBelief(db, "self-correction", wrong, 0.6, ["free-think self-challenge"], "free-think");
    log(`  WAS WRONG: ${wrong.slice(0, 80)}`);
  }

  // Save the real product insight
  if (sections.real_product) {
    remember(db, "semantic", `FREE THINK - REAL PRODUCT: ${sections.real_product.slice(0, 300)}`, "free-thinking", "free-think", 0.7);
  }

  if (sections.insight) {
    remember(db, "semantic", `FREE THINK - UNIQUE INSIGHT: ${sections.insight.slice(0, 300)}`, "free-thinking", "free-think", 0.8);
  }

  if (sections.if_kirill) {
    remember(db, "working", `FREE THINK - WHAT TO DO: ${sections.if_kirill.slice(0, 300)}`, "free-thinking", "free-think", 0.7);
  }

  // Integrate full output into world model
  await integrateKnowledge(db, output.slice(-3000), "free-think", log);

  // Append to narrative
  appendToThread(db, "free-thinking",
    `Free think session: ${parseList(sections.revelations).length} revelations, ${parseList(sections.wrong).length} corrections. Insight: ${(sections.insight || "").slice(0, 100)}`,
    log
  );

  // Save full output
  const resultFile = resolve(ROOT, ".data/free-think-result.md");
  writeFileSync(resultFile, `# CORTEX Free Think — ${new Date().toISOString()}\n\n${output}`);
  log(`\nSaved to: ${resultFile}`);

  log("\nFree thinking complete.");
}

function extractSection(text, header) {
  const regex = new RegExp(`${header}:?\\s*\\n([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`);
  const match = text.match(regex);
  return match ? match[1].trim() : "";
}

function parseList(text) {
  if (!text) return [];
  return text.split("\n")
    .map(l => l.replace(/^[-*•]\s*/, "").trim())
    .filter(l => l.length > 10);
}

main().catch(e => {
  console.error("FREE THINK FATAL:", e);
  process.exit(1);
});
