/**
 * AWARENESS SANDBOX - Isolated git worktree for testing awareness items
 *
 * Production lives in linkedin-brand-os/ (cron, real outreach, real DB).
 * Sandbox lives in linkedin-brand-os-sandbox/ on branch sandbox/<item-id>.
 * It has:
 *   - its own git working tree (changes do NOT touch main)
 *   - its own .data/sandbox.sqlite (snapshot of prod DB at creation time)
 *   - its own .env.sandbox with DRY_RUN=1 and fake SMTP/TG
 *
 * Commands:
 *   create  <item-id>   create worktree + snapshot DB + sandbox env
 *   list                show all sandboxes
 *   status  <item-id>   show worktree path, branch, diff stats
 *   shell   <item-id>   print cd command for the sandbox
 *   promote <item-id>   merge sandbox branch into main (after Kirill OK)
 *   discard <item-id>   remove worktree, delete branch, no merge
 *
 * Production cron is unaffected: it only runs from main worktree.
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");
const PARENT_DIR = resolve(PROJECT_ROOT, "..");
const DB_PATH = resolve(PROJECT_ROOT, ".data/linkedin-brand-os.sqlite");
const REGISTRY = resolve(PROJECT_ROOT, ".data/awareness/sandboxes.json");

function sh(cmd, opts = {}) {
  return execSync(cmd, { cwd: PROJECT_ROOT, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], ...opts });
}

function loadRegistry() {
  if (!existsSync(REGISTRY)) return {};
  try { return JSON.parse(readFileSync(REGISTRY, "utf-8")); } catch { return {}; }
}
function saveRegistry(reg) {
  mkdirSync(dirname(REGISTRY), { recursive: true });
  writeFileSync(REGISTRY, JSON.stringify(reg, null, 2));
}

function getItem(itemId) {
  const db = new Database(DB_PATH, { readonly: true });
  const item = db.prepare("SELECT * FROM awareness_items WHERE id = ?").get(itemId);
  db.close();
  return item;
}

function shortId(itemId) {
  return itemId.slice(0, 8);
}

function worktreePath(itemId) {
  return resolve(PARENT_DIR, `linkedin-brand-os-sandbox-${shortId(itemId)}`);
}

function branchName(itemId) {
  return `sandbox/${shortId(itemId)}`;
}

// ───────────────────────────────────────────────────────────────────────────

function cmdCreate(itemId) {
  const item = getItem(itemId);
  if (!item) { console.error(`Item not found: ${itemId}`); process.exit(1); }

  const wt = worktreePath(itemId);
  const branch = branchName(itemId);
  const reg = loadRegistry();

  if (reg[itemId]) { console.error(`Sandbox already exists at ${reg[itemId].path}`); process.exit(1); }
  if (existsSync(wt)) { console.error(`Path already exists: ${wt}`); process.exit(1); }

  console.log(`[sandbox] item: ${item.title}`);
  console.log(`[sandbox] branch: ${branch}`);
  console.log(`[sandbox] path: ${wt}`);

  // 1. ensure clean main commit so worktree starts clean
  const dirty = sh("git status --porcelain").trim();
  if (dirty) {
    console.log(`[sandbox] uncommitted changes in main, creating safety commit`);
    sh("git add -A");
    try { sh(`git commit -m "Pre-sandbox checkpoint for ${shortId(itemId)}"`); } catch {}
  }

  // 2. create worktree on a new branch from current HEAD
  sh(`git worktree add -b ${branch} "${wt}" HEAD`);
  console.log(`[sandbox] worktree created`);

  // 3. snapshot DB into sandbox
  const sandboxDb = resolve(wt, ".data/sandbox.sqlite");
  mkdirSync(dirname(sandboxDb), { recursive: true });
  copyFileSync(DB_PATH, sandboxDb);
  console.log(`[sandbox] DB snapshot copied -> .data/sandbox.sqlite`);

  // 4. write .env.sandbox with safe defaults
  const envSandbox = resolve(wt, "apps/api/.env.sandbox");
  mkdirSync(dirname(envSandbox), { recursive: true });
  let baseEnv = "";
  const prodEnv = resolve(PROJECT_ROOT, "apps/api/.env");
  if (existsSync(prodEnv)) baseEnv = readFileSync(prodEnv, "utf-8");
  const sandboxEnv = baseEnv
    + "\n\n# === SANDBOX OVERRIDES ===\n"
    + "SANDBOX=1\n"
    + "DRY_RUN=1\n"
    + "DB_PATH=./.data/sandbox.sqlite\n"
    + "DISABLE_OUTREACH=1\n"
    + "DISABLE_REDDIT_POSTING=1\n"
    + "DISABLE_TELEGRAM_SEND=1\n"
    + "TELEGRAM_CHAT_ID=SANDBOX_NOOP\n"
    + "SMTP_HOST=localhost.invalid\n";
  writeFileSync(envSandbox, sandboxEnv);
  console.log(`[sandbox] env written -> apps/api/.env.sandbox (DRY_RUN, no real sends)`);

  // 5. write item context for the sandbox session
  const ctx = resolve(wt, ".data/awareness/SANDBOX_ITEM.md");
  mkdirSync(dirname(ctx), { recursive: true });
  writeFileSync(ctx, [
    `# Sandbox Item: ${item.title}`,
    ``,
    `**ID:** ${item.id}`,
    `**URL:** ${item.url}`,
    `**Score:** ${item.score}/20`,
    `**Category:** ${item.category}`,
    ``,
    `## Why it matters`,
    item.why_matters || "(none)",
    ``,
    `## Action target`,
    item.action_target || "(none)",
    ``,
    `## Action type`,
    item.action_type || "(none)",
    ``,
    `## Sandbox rules`,
    `- All env vars in apps/api/.env.sandbox override real ones`,
    `- DB is .data/sandbox.sqlite (snapshot, not prod)`,
    `- DRY_RUN=1, DISABLE_OUTREACH=1, DISABLE_TELEGRAM_SEND=1`,
    `- Production cron only runs against main, not this branch`,
    `- When done: promote (merge to main) or discard (delete worktree)`,
  ].join("\n"));

  // 6. register
  reg[itemId] = {
    item_id: itemId,
    title: item.title,
    branch,
    path: wt,
    created_at: new Date().toISOString(),
  };
  saveRegistry(reg);

  console.log(`\n✅ Sandbox ready.`);
  console.log(`   cd ${wt}`);
  console.log(`   # work on the change, run bots with: node --env-file=apps/api/.env.sandbox <bot>`);
  console.log(`   # when done: node scripts/factory/awareness-sandbox.mjs promote ${shortId(itemId)}`);
  console.log(`   #     or:    node scripts/factory/awareness-sandbox.mjs discard ${shortId(itemId)}`);
}

function resolveItemId(partial) {
  const reg = loadRegistry();
  const hit = Object.keys(reg).find(k => k === partial || k.startsWith(partial));
  return hit || null;
}

function cmdList() {
  const reg = loadRegistry();
  const entries = Object.values(reg);
  if (entries.length === 0) { console.log("No active sandboxes."); return; }
  console.log(`\n${entries.length} active sandbox(es):\n`);
  for (const s of entries) {
    console.log(`  ${shortId(s.item_id)}  ${s.title.slice(0, 60)}`);
    console.log(`           branch: ${s.branch}`);
    console.log(`           path:   ${s.path}`);
    console.log(`           since:  ${s.created_at}`);
    console.log();
  }
}

function cmdStatus(partial) {
  const itemId = resolveItemId(partial);
  if (!itemId) { console.error(`No sandbox matches: ${partial}`); process.exit(1); }
  const reg = loadRegistry();
  const s = reg[itemId];
  console.log(`Sandbox: ${s.title}`);
  console.log(`Branch:  ${s.branch}`);
  console.log(`Path:    ${s.path}`);
  try {
    const diff = execSync(`git -C "${s.path}" diff --stat main`, { encoding: "utf-8" });
    console.log(`\nDiff vs main:\n${diff || "(no changes yet)"}`);
  } catch (e) {
    console.log(`\nDiff failed: ${e.message}`);
  }
}

function cmdPromote(partial) {
  const itemId = resolveItemId(partial);
  if (!itemId) { console.error(`No sandbox matches: ${partial}`); process.exit(1); }
  const reg = loadRegistry();
  const s = reg[itemId];

  // commit any pending changes in the sandbox
  try {
    execSync(`git -C "${s.path}" add -A`);
    const dirty = execSync(`git -C "${s.path}" status --porcelain`, { encoding: "utf-8" }).trim();
    if (dirty) {
      execSync(`git -C "${s.path}" commit -m "Sandbox final state for ${shortId(itemId)}"`);
    }
  } catch (e) {
    console.error(`Could not finalize sandbox commits: ${e.message}`);
    process.exit(1);
  }

  // merge into main
  console.log(`[promote] merging ${s.branch} into main`);
  try {
    sh(`git merge --no-ff ${s.branch} -m "Promote sandbox ${shortId(itemId)}: ${s.title}"`);
  } catch (e) {
    console.error(`Merge failed: ${e.message}`);
    console.error(`Resolve conflicts manually in main, then re-run.`);
    process.exit(1);
  }

  // remove worktree
  try { sh(`git worktree remove "${s.path}" --force`); } catch {}
  try { sh(`git branch -D ${s.branch}`); } catch {}

  delete reg[itemId];
  saveRegistry(reg);
  console.log(`✅ Promoted and cleaned up.`);
}

function cmdDiscard(partial) {
  const itemId = resolveItemId(partial);
  if (!itemId) { console.error(`No sandbox matches: ${partial}`); process.exit(1); }
  const reg = loadRegistry();
  const s = reg[itemId];
  console.log(`[discard] removing worktree ${s.path}`);
  try { sh(`git worktree remove "${s.path}" --force`); } catch (e) { console.error(`worktree remove: ${e.message}`); }
  try { sh(`git branch -D ${s.branch}`); } catch (e) { console.error(`branch -D: ${e.message}`); }
  delete reg[itemId];
  saveRegistry(reg);
  console.log(`✅ Sandbox discarded.`);
}

// ───────────────────────────────────────────────────────────────────────────

const cmd = process.argv[2];
const arg = process.argv[3];

switch (cmd) {
  case "create":  cmdCreate(arg); break;
  case "list":    cmdList(); break;
  case "status":  cmdStatus(arg); break;
  case "promote": cmdPromote(arg); break;
  case "discard": cmdDiscard(arg); break;
  default:
    console.log("Usage:");
    console.log("  awareness-sandbox.mjs create  <item-id>");
    console.log("  awareness-sandbox.mjs list");
    console.log("  awareness-sandbox.mjs status  <item-id|short>");
    console.log("  awareness-sandbox.mjs promote <item-id|short>");
    console.log("  awareness-sandbox.mjs discard <item-id|short>");
}
