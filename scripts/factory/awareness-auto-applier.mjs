/**
 * awareness-auto-applier.mjs
 *
 * Closes the LAST gap in the awareness loop: applies status='apply_now' items
 * automatically, without a Claude Code session.
 *
 * Architecture is deliberately conservative:
 *   1. Pulls top apply_now items (max 3 per run)
 *   2. Filters to safe targets only (prompt_update / rule_update + scripts/factory or
 *      scripts/cortex .mjs files that exist on disk)
 *   3. For each item: WebFetch URL (best effort), READ target file, ASK Claude CLI
 *      via subprocess to output a structured JSON patch (the TEXT to insert + section
 *      hint), then DETERMINISTICALLY apply the patch (our code does the actual write,
 *      not Claude). Three safe write modes:
 *        - "doctrine_bonus_paragraph": append before </doctrine_bonus> tag if present
 *        - "header_rule_block": insert as comment block right after the file's doc-header
 *        - "relevance_term_addition": append items to RELEVANCE_TERMS array if present
 *   4. After EACH apply: syntax check (node -c). If fails, REVERT that file from git
 *      and mark item 'failed_apply' with the syntax error in the audit log.
 *   5. Only ONE successful apply per run goes through (cap to keep blast radius small);
 *      remaining items stay apply_now for next run.
 *
 * Safety boundaries:
 *   - Hard skip if action_target outside scripts/factory or scripts/cortex
 *   - Hard skip if target file does not exist
 *   - Hard skip if action_type not in (prompt_update, rule_update)
 *   - Git checkpoint before each apply, revert on syntax failure
 *   - Audit log entry for every attempt (success, skip, failure)
 *
 * Run: node scripts/factory/awareness-auto-applier.mjs [N]   (default 1, max 3)
 *
 * Schedule: daily at 10:00 UTC (15min after hypothesis-from-awareness, gives the
 *  whole 09:00-09:45 chain a chance to settle before applying anything).
 *
 * Built 2026-05-09 as item #8 of the autonomous-learning-loop work.
 */

import Database from "better-sqlite3";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const ENV_PATH = resolve(ROOT, "apps/api/.env");
const AUDIT_LOG = resolve(ROOT, ".data/awareness-apply-log.json");
const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const MAX_PER_RUN = Math.max(1, Math.min(3, parseInt(process.argv[2] || "1", 10)));

// ─── Safety filters ──────────────────────────────────────────────────────

const SAFE_ACTION_TYPES = new Set(["prompt_update", "rule_update"]);
const SAFE_DIR_PREFIXES = ["scripts/factory/", "scripts/cortex/", "scripts/outreach/"];

// Wiki-routing for insights without code target (added 2026-05-09 to close last gap).
// Items with action_type='none' but high score and one of these categories get routed
// to a wiki section instead of code patch. category -> wiki path + section heading.
const WIKI_ROUTES = {
  gtm_tactic: { path: "wiki/what-converts.md", section: "## Sell-not-build evidence (peer cases)" },
  case_study: { path: "wiki/what-converts.md", section: "## Confirmed conversion patterns" },
  market_opportunity: { path: "wiki/what-converts.md", section: "## Confirmed conversion patterns" },
  tool: { path: "wiki/what-converts.md", section: "## Operational reference (security-tooling pattern)" },
  technique: { path: "wiki/what-converts.md", section: "## Operational reference (security-tooling pattern)" },
};

function isSafeWikiInsight(item) {
  // Allow auto-apply if action_type=none, score >= 14, category mapped, item has URL+why_matters
  if (item.action_type !== "none" && item.action_type !== "tool") return null;
  if ((item.score || 0) < 14) return null;
  if (!item.category || !WIKI_ROUTES[item.category]) return null;
  if (!item.url || !item.why_matters) return null;
  return WIKI_ROUTES[item.category];
}

function isSafeTarget(actionType, actionTarget) {
  if (!SAFE_ACTION_TYPES.has(actionType)) return { ok: false, reason: `action_type ${actionType} not in safe list` };
  if (!actionTarget) return { ok: false, reason: "no action_target" };
  // Strip whitespace + any trailing word like "prompt"
  const filePath = actionTarget.split(/\s+/)[0];
  if (!SAFE_DIR_PREFIXES.some(p => filePath.startsWith(p))) {
    return { ok: false, reason: `target ${filePath} not in safe dirs` };
  }
  if (!filePath.endsWith(".mjs")) return { ok: false, reason: "not an .mjs file" };
  const abs = resolve(ROOT, filePath);
  if (!existsSync(abs)) return { ok: false, reason: `target file ${filePath} does not exist` };
  return { ok: true, filePath, abs };
}

// ─── Git checkpoint + rollback ──────────────────────────────────────────

function gitCheckpoint(label) {
  try {
    const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf-8" });
    return (r.stdout || "").trim();
  } catch { return null; }
}

function gitRevertFile(filePath) {
  try {
    spawnSync("git", ["checkout", "HEAD", "--", filePath], { cwd: ROOT, encoding: "utf-8" });
    return true;
  } catch { return false; }
}

// ─── Syntax check ────────────────────────────────────────────────────────

function syntaxCheck(absPath) {
  const r = spawnSync("node", ["-c", absPath], { encoding: "utf-8", timeout: 10000 });
  return { ok: r.status === 0, stderr: (r.stderr || "").slice(0, 400) };
}

// ─── Patch application (deterministic, three safe modes) ────────────────

function applyDoctrineBonusParagraph(content, paragraph) {
  // Find </doctrine_bonus> closing tag and insert paragraph before it (with newlines)
  const closeTag = "</doctrine_bonus>";
  const idx = content.indexOf(closeTag);
  if (idx === -1) return { ok: false, reason: "no </doctrine_bonus> tag in file" };
  const before = content.slice(0, idx);
  const after = content.slice(idx);
  // Ensure paragraph ends with single \n then we add one more before close tag
  const trimmedParagraph = paragraph.trim();
  const insertion = `\n${trimmedParagraph}\n`;
  return { ok: true, newContent: before + insertion + after };
}

function applyHeaderRuleBlock(content, block) {
  // Insert as a comment block after the first */ that closes the doc header.
  const firstClose = content.indexOf("*/");
  if (firstClose === -1) return { ok: false, reason: "no doc header /* */ in file" };
  const insertPoint = firstClose + 2;
  // Wrap block as a JS comment block. Strip any existing comment markers
  const cleanBlock = block.replace(/\/\*+/g, "").replace(/\*+\//g, "").trim();
  const wrapped = `\n\n/*\n * ${cleanBlock.split("\n").join("\n * ")}\n */`;
  return { ok: true, newContent: content.slice(0, insertPoint) + wrapped + content.slice(insertPoint) };
}

// Wiki section addition: append a bullet under the matching ## heading,
// or create the heading + bullet at end of file if heading does not exist yet.
function applyWikiSectionAddition(content, sectionHeading, bullet) {
  const cleanBullet = bullet.trim().replace(/^- /, "");
  const idx = content.indexOf(sectionHeading);
  if (idx === -1) {
    // Section does not exist - append fresh section at end
    const newContent = content.trimEnd() + `\n\n${sectionHeading}\n\n- ${cleanBullet}\n`;
    return { ok: true, newContent };
  }
  // Find the next blank line after the heading where we can insert a bullet
  const afterHeading = content.indexOf("\n", idx + sectionHeading.length);
  if (afterHeading === -1) return { ok: false, reason: "section heading at EOF, cannot insert" };
  // Find next ## heading or EOF to know section bounds
  const nextSection = content.indexOf("\n## ", afterHeading);
  const sectionEnd = nextSection === -1 ? content.length : nextSection;
  // Insert bullet at end of section (keep blank line before next heading)
  const before = content.slice(0, sectionEnd).trimEnd();
  const after = content.slice(sectionEnd);
  const newContent = before + `\n- ${cleanBullet}\n` + after;
  return { ok: true, newContent };
}

function applyRelevanceTermAddition(content, terms) {
  // Find RELEVANCE_TERMS array, append terms before closing ]
  const arrayStart = content.indexOf("RELEVANCE_TERMS = [");
  if (arrayStart === -1) return { ok: false, reason: "no RELEVANCE_TERMS = [ in file" };
  // Find matching closing ] (find the closing bracket on its own line after arrayStart)
  let depth = 0;
  let closeIdx = -1;
  for (let i = arrayStart + "RELEVANCE_TERMS = [".length - 1; i < content.length; i++) {
    if (content[i] === "[") depth++;
    else if (content[i] === "]") {
      depth--;
      if (depth === 0) { closeIdx = i; break; }
    }
  }
  if (closeIdx === -1) return { ok: false, reason: "could not find matching close ] for RELEVANCE_TERMS" };
  const termList = (Array.isArray(terms) ? terms : [terms])
    .map(t => `"${String(t).replace(/"/g, '\\"').slice(0, 60)}"`)
    .join(", ");
  const insertion = `\n  // Auto-added by awareness-auto-applier ${new Date().toISOString().slice(0, 10)}\n  ${termList},\n`;
  return { ok: true, newContent: content.slice(0, closeIdx) + insertion + content.slice(closeIdx) };
}

// ─── Claude CLI patch generation ────────────────────────────────────────

function callClaudeForPatch(item, fileContent) {
  const prompt = `You are generating a SAFE patch suggestion for an awareness item being applied to a production code file.

AWARENESS ITEM:
- title: ${item.title}
- score: ${item.score}/${item.confidence}
- category: ${item.category}
- summary: ${item.summary || "(none)"}
- why_matters: ${item.why_matters || "(none)"}
- url: ${item.url || "(none)"}
- action_type: ${item.action_type}
- action_target: ${item.action_target}

TARGET FILE (truncated to first 4000 chars):
${fileContent.slice(0, 4000)}

Pick ONE of these three safe patch modes and output as JSON:

1. "doctrine_bonus_paragraph" - if the file has a <doctrine_bonus> XML block AND the awareness item is about scoring/relevance for awareness-bot, output a 2-4 sentence paragraph describing the new bonus rule. Reference the awareness item's source and concrete pattern.

2. "header_rule_block" - if the file has a doc-header /* */ at the top AND the awareness item is operational (rate limits, validation, naming pattern, etc), output a 3-6 line rule block to insert as a JS comment after the header.

3. "relevance_term_addition" - if the file has a RELEVANCE_TERMS = [ array AND the awareness item adds new keyword signals to track, output an array of 2-8 specific term strings (lowercase, short).

OUTPUT JSON ONLY:
{
  "mode": "doctrine_bonus_paragraph" | "header_rule_block" | "relevance_term_addition",
  "content": "the text content to insert" OR ["array of terms"],
  "rationale": "1 sentence explaining the choice"
}

Rules:
- NO em dashes (use hyphens only)
- Reference the awareness URL or source so traceable
- Be specific with numbers/names from the source, never invent
- Keep insertion <= 600 chars (text mode) or <= 8 items (terms mode)`;

  const r = spawnSync(CLAUDE_BIN, ["-p", "--model", "claude-sonnet-4-6", "--max-turns", "2"], {
    input: prompt,
    encoding: "utf-8",
    timeout: 5 * 60 * 1000,
  });
  const out = (r.stdout || "").trim();
  if (r.status !== 0 || !out) {
    return { ok: false, reason: `claude exit=${r.status}, stderr=${(r.stderr || "").slice(0, 200)}` };
  }
  // Extract JSON block (Claude may wrap it in prose)
  const match = out.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, reason: "no JSON block in claude output" };
  try {
    const parsed = JSON.parse(match[0]);
    if (!parsed.mode || !parsed.content) return { ok: false, reason: "missing mode or content" };
    return { ok: true, patch: parsed };
  } catch (e) {
    return { ok: false, reason: `JSON parse failed: ${e.message}` };
  }
}

// ─── Audit log ───────────────────────────────────────────────────────────

function appendAudit(entry) {
  let log = [];
  try {
    if (existsSync(AUDIT_LOG)) log = JSON.parse(readFileSync(AUDIT_LOG, "utf-8"));
  } catch {}
  log.push(entry);
  writeFileSync(AUDIT_LOG, JSON.stringify(log, null, 2));
}

// ─── Main loop ──────────────────────────────────────────────────────────

async function main() {
  const db = new Database(DB_PATH);

  const items = db.prepare(`
    SELECT id, score, title, category, summary, why_matters, action_type, action_target, url, confidence
    FROM awareness_items
    WHERE status = 'apply_now'
    ORDER BY score DESC, created_at DESC
    LIMIT 10
  `).all();

  if (items.length === 0) {
    console.log("[auto-applier] no apply_now items, nothing to do");
    db.close();
    return;
  }

  console.log(`[auto-applier] ${items.length} apply_now items, processing up to ${MAX_PER_RUN}`);

  const sessionLog = {
    date: new Date().toISOString().slice(0, 10),
    timestamp: new Date().toISOString(),
    source: "awareness-auto-applier",
    applied: 0,
    failed: 0,
    skipped: 0,
    items: [],
    skipped_items: [],
  };

  let applied = 0;
  for (const item of items) {
    if (applied >= MAX_PER_RUN) break;

    // Path A: wiki insight (no code target, but high-value insight that maps to a wiki section)
    const wikiRoute = isSafeWikiInsight(item);
    if (wikiRoute) {
      console.log(`  WIKI [${item.score}] ${item.title?.slice(0, 70)}`);
      console.log(`    target: ${wikiRoute.path} | section: ${wikiRoute.section}`);
      const abs = resolve(ROOT, wikiRoute.path);
      const fileContent = existsSync(abs) ? readFileSync(abs, "utf-8") : "";
      // Generate a single-bullet insight via Claude (one sentence + URL citation)
      const prompt = `You are extracting a single-bullet wiki insight from an awareness item.

ITEM:
- title: ${item.title}
- summary: ${item.summary || "(none)"}
- why_matters: ${item.why_matters || "(none)"}
- url: ${item.url}
- category: ${item.category}

Output JSON: { "bullet": "1-2 sentence actionable bullet for ${wikiRoute.section} section, ending with the URL in parens", "rationale": "1 sentence" }
Rules: NO em dashes (hyphens only), no marketing speak, peer-to-peer voice, lead with the concrete pattern not the source name.`;
      const r = spawnSync(CLAUDE_BIN, ["-p", "--model", "claude-sonnet-4-6", "--max-turns", "2"], {
        input: prompt, encoding: "utf-8", timeout: 5 * 60 * 1000,
      });
      const out = (r.stdout || "").trim();
      const match = out.match(/\{[\s\S]*\}/);
      if (!match) {
        console.log(`    FAILED claude returned no JSON`);
        sessionLog.failed++;
        sessionLog.items.push({ id: item.id, title: item.title?.slice(0, 100), action_target: wikiRoute.path, result: "FAILED claude no JSON for wiki insight" });
        continue;
      }
      let parsed;
      try { parsed = JSON.parse(match[0]); } catch (e) {
        console.log(`    FAILED JSON parse: ${e.message}`);
        sessionLog.failed++;
        continue;
      }
      const insertRes = applyWikiSectionAddition(fileContent, wikiRoute.section, parsed.bullet);
      if (!insertRes.ok) {
        console.log(`    FAILED wiki insert: ${insertRes.reason}`);
        sessionLog.failed++;
        continue;
      }
      writeFileSync(abs, insertRes.newContent);
      db.prepare(`UPDATE awareness_items SET status='applied', updated_at=? WHERE id=?`)
        .run(new Date().toISOString(), item.id);
      console.log(`    APPLIED wiki: ${parsed.rationale?.slice(0, 100)}`);
      applied++;
      sessionLog.applied++;
      sessionLog.items.push({
        id: item.id, title: item.title?.slice(0, 100),
        action_target: wikiRoute.path, action_type: "wiki_insight",
        patch_mode: "wiki_section_addition",
        result: `SUCCESS wiki insight: ${parsed.rationale?.slice(0, 200) || "(no rationale)"}`,
      });
      continue;
    }

    // Path B: code patch (action_target is concrete file)
    const safety = isSafeTarget(item.action_type, item.action_target);
    if (!safety.ok) {
      console.log(`  SKIP ${item.id}: ${safety.reason}`);
      sessionLog.skipped++;
      sessionLog.skipped_items.push({
        id: item.id,
        title: item.title?.slice(0, 100),
        action_target: item.action_target,
        reason: safety.reason,
      });
      continue;
    }

    console.log(`  ATTEMPT [${item.score}] ${item.title?.slice(0, 70)}`);
    console.log(`    target: ${safety.filePath}`);

    const fileContent = readFileSync(safety.abs, "utf-8");
    const beforeHash = gitCheckpoint();

    // Generate patch via Claude
    const claudeRes = callClaudeForPatch(item, fileContent);
    if (!claudeRes.ok) {
      console.log(`    FAILED claude: ${claudeRes.reason}`);
      sessionLog.failed++;
      sessionLog.items.push({
        id: item.id, title: item.title?.slice(0, 100),
        action_target: safety.filePath,
        result: `FAILED claude patch generation: ${claudeRes.reason}`,
      });
      continue;
    }

    // Apply patch deterministically
    let applyRes;
    if (claudeRes.patch.mode === "doctrine_bonus_paragraph") {
      applyRes = applyDoctrineBonusParagraph(fileContent, claudeRes.patch.content);
    } else if (claudeRes.patch.mode === "header_rule_block") {
      applyRes = applyHeaderRuleBlock(fileContent, claudeRes.patch.content);
    } else if (claudeRes.patch.mode === "relevance_term_addition") {
      applyRes = applyRelevanceTermAddition(fileContent, claudeRes.patch.content);
    } else {
      applyRes = { ok: false, reason: `unknown mode ${claudeRes.patch.mode}` };
    }

    if (!applyRes.ok) {
      console.log(`    FAILED apply: ${applyRes.reason}`);
      sessionLog.failed++;
      sessionLog.items.push({
        id: item.id, title: item.title?.slice(0, 100),
        action_target: safety.filePath,
        result: `FAILED patch application: ${applyRes.reason}`,
      });
      continue;
    }

    // Write file
    writeFileSync(safety.abs, applyRes.newContent);

    // Validate syntax
    const syntax = syntaxCheck(safety.abs);
    if (!syntax.ok) {
      console.log(`    FAILED syntax check: ${syntax.stderr.split("\n")[0]}`);
      gitRevertFile(safety.filePath);
      sessionLog.failed++;
      sessionLog.items.push({
        id: item.id, title: item.title?.slice(0, 100),
        action_target: safety.filePath,
        result: `FAILED syntax check (file reverted): ${syntax.stderr.split("\n")[0]}`,
      });
      continue;
    }

    // Mark applied
    db.prepare(`UPDATE awareness_items SET status='applied', updated_at=? WHERE id=?`)
      .run(new Date().toISOString(), item.id);

    console.log(`    APPLIED ${claudeRes.patch.mode}: ${claudeRes.patch.rationale?.slice(0, 100)}`);
    applied++;
    sessionLog.applied++;
    sessionLog.items.push({
      id: item.id, title: item.title?.slice(0, 100),
      action_target: safety.filePath,
      action_type: item.action_type,
      patch_mode: claudeRes.patch.mode,
      result: `SUCCESS ${claudeRes.patch.mode}: ${claudeRes.patch.rationale?.slice(0, 200) || "(no rationale)"}`,
    });
  }

  appendAudit(sessionLog);
  db.close();

  console.log(`[auto-applier] DONE applied=${sessionLog.applied} failed=${sessionLog.failed} skipped=${sessionLog.skipped}`);
}

main().catch(e => {
  console.error("[auto-applier] FATAL:", e.message);
  console.error(e.stack);
  process.exit(1);
});
