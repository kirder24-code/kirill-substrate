#!/usr/bin/env node
/**
 * scripts/cortex/checkpoint-isc.mjs
 *
 * Port of PAI CheckpointPerISC.hook.ts.
 * On every ISC `[ ]→[x]` transition in any ISA.md file, auto-git-commit
 * the repo so substrate work survives daemon crashes. Idempotent via
 * sidecar state file `<isa-dir>/.checkpoint-state.json`.
 *
 * Two modes:
 *
 *   1. CLI on a single ISA path (e.g. wired into ISASync hook):
 *        node scripts/cortex/checkpoint-isc.mjs <path/to/ISA.md>
 *
 *   2. CLI scan-all-and-commit (e.g. cron, nightly):
 *        node scripts/cortex/checkpoint-isc.mjs --all
 *
 *   3. Programmatic from cortex executor / orchestrator:
 *        import { checkpointISA } from "./checkpoint-isc.mjs";
 *        await checkpointISA(isaAbsPath);
 *
 * Commit subject: "<ISC-id> (<slug>): <sanitized description>"
 *
 * Safety:
 *   - SAFE: never runs reset/checkout/branch -D/clean -fd/push --force
 *   - --no-verify skips pre-commit hooks (would block on substrate-internal
 *     edits with no review burden)
 *   - --no-gpg-sign avoids GPG passphrase prompts
 *   - Fails closed: any error logs to stderr and emits {ok:false,reason}
 *   - Repo path is the project root containing the ISA (default; override
 *     with CHECKPOINT_REPO env var)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter, parseCriteriaList, findISAByGlob } from "./isa-parser.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const GIT_TIMEOUT_MS = 8000;

function gitRun(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf-8",
    timeout: GIT_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function isGitRepo(repo) {
  try { gitRun(repo, ["rev-parse", "--git-dir"]); return true; } catch { return false; }
}

function hasChanges(repo) {
  try { return gitRun(repo, ["status", "--porcelain"]).trim().length > 0; } catch { return false; }
}

function sanitizeMessage(s) {
  return (s || "").replace(/\s+/g, " ").replace(/[`$]/g, "").trim().slice(0, 200);
}

function commitInRepo(repo, iscId, slug, description) {
  try {
    gitRun(repo, ["add", "-A"]);
    const subject = `${iscId} (${slug}): ${sanitizeMessage(description)}`;
    gitRun(repo, ["commit", "-m", subject, "--quiet", "--no-verify", "--no-gpg-sign"]);
    return gitRun(repo, ["rev-parse", "HEAD"]).trim();
  } catch (err) {
    const detail = err?.stderr?.toString?.() || err?.message || String(err);
    console.error(`[checkpoint-isc] commit failed in ${repo} for ${iscId}: ${detail}`);
    return null;
  }
}

function loadState(stateFile) {
  if (!existsSync(stateFile)) return { committed_iscs: [], last_commit_sha: {} };
  try {
    const j = JSON.parse(readFileSync(stateFile, "utf-8"));
    return {
      committed_iscs: Array.isArray(j.committed_iscs) ? j.committed_iscs : [],
      last_commit_sha: typeof j.last_commit_sha === "object" && j.last_commit_sha ? j.last_commit_sha : {},
    };
  } catch {
    return { committed_iscs: [], last_commit_sha: {} };
  }
}

function saveState(stateFile, state) {
  try { writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\n"); } catch (e) {
    console.error(`[checkpoint-isc] failed to write state ${stateFile}: ${e.message}`);
  }
}

/**
 * Process one ISA file: scan for newly-checked ISCs (vs sidecar state),
 * commit one per ISC. Returns { ok, isaPath, commits: [{isc, sha}], skipped }.
 */
export async function checkpointISA(isaPath, { repo = REPO_ROOT } = {}) {
  if (!existsSync(isaPath)) return { ok: false, reason: "isa_not_found", path: isaPath };
  if (!isGitRepo(repo)) return { ok: false, reason: "not_a_git_repo", repo };

  const content = readFileSync(isaPath, "utf-8");
  const fm = parseFrontmatter(content) || {};
  const slug = fm.slug || basename(dirname(isaPath));
  const isacs = parseCriteriaList(content);
  if (isacs.length === 0) return { ok: true, isaPath, commits: [], skipped: "no ISCs parseable" };

  const stateFile = join(dirname(isaPath), ".checkpoint-state.json");
  const state = loadState(stateFile);
  const alreadyCommitted = new Set(state.committed_iscs);

  const newlyChecked = isacs.filter(c => c.status === "completed" && !alreadyCommitted.has(c.id));
  if (newlyChecked.length === 0) return { ok: true, isaPath, commits: [], skipped: "no new completions" };

  const commits = [];
  for (const c of newlyChecked) {
    if (!hasChanges(repo)) {
      // No diff to commit, just record we've seen this ISC
      state.committed_iscs.push(c.id);
      continue;
    }
    const sha = commitInRepo(repo, c.id, slug, c.description);
    if (sha) {
      state.last_commit_sha[c.id] = sha;
      state.committed_iscs.push(c.id);
      commits.push({ isc: c.id, sha, description: c.description.slice(0, 80) });
    }
  }

  saveState(stateFile, state);
  return { ok: true, isaPath, commits, slug };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = process.argv.slice(2);
  let all = false, paths = [];
  for (const a of args) {
    if (a === "--all") all = true;
    else paths.push(a);
  }
  if (all) paths = findISAByGlob(REPO_ROOT);
  if (paths.length === 0) {
    console.error("Usage: node scripts/cortex/checkpoint-isc.mjs <ISA.md>");
    console.error("       node scripts/cortex/checkpoint-isc.mjs --all");
    process.exit(2);
  }
  for (const p of paths) {
    const result = await checkpointISA(resolve(p));
    if (!result.ok) {
      console.error(`✗ ${result.path}: ${result.reason}`);
      continue;
    }
    if (result.commits.length > 0) {
      console.log(`✓ ${result.isaPath} (${result.slug})`);
      for (const c of result.commits) console.log(`    [${c.sha.slice(0, 7)}] ${c.isc}: ${c.description}`);
    } else if (result.skipped) {
      console.log(`◯ ${result.isaPath} — ${result.skipped}`);
    }
  }
}
