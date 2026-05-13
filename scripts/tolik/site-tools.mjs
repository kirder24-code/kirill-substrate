/**
 * scripts/tolik/site-tools.mjs
 *
 * Tools for the live marketing site (apps/web → launchsoloai.com) and
 * the new command/tolik sites. Tolik can read structure, edit content,
 * and commit. Deploy is left to Kirill - Tolik only stages the change.
 *
 * Sandbox: only paths under apps/web, apps/command-site, dashboard,
 * scripts/tolik are writable.
 */

import { execFile } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

const SITE_TARGETS = {
  "launchsoloai":     "apps/web",
  "command":          "apps/command-site",
  "tolik":            "apps/tolik",
  "dashboard":        "dashboard",
};

function sandboxOK(absPath) {
  return Object.values(SITE_TARGETS).some(t => absPath.startsWith(resolve(ROOT, t) + "/"));
}

export async function site_list({ target }) {
  const dir = SITE_TARGETS[target];
  if (!dir) return { ok: false, reason: "unknown_target", available: Object.keys(SITE_TARGETS) };
  const abs = resolve(ROOT, dir);
  if (!existsSync(abs)) return { ok: false, reason: "target_missing" };
  const fs = await import("node:fs");
  function walk(d, depth = 0, out = []) {
    if (depth > 3 || out.length > 80) return out;
    for (const name of fs.readdirSync(d)) {
      if (name.startsWith(".") || name === "node_modules" || name === "dist") continue;
      const full = resolve(d, name);
      const stat = fs.statSync(full);
      const rel = full.replace(ROOT + "/", "");
      if (stat.isDirectory()) {
        out.push({ kind: "dir", path: rel });
        walk(full, depth + 1, out);
      } else {
        out.push({ kind: "file", path: rel, size: stat.size });
      }
      if (out.length > 80) break;
    }
    return out;
  }
  return { ok: true, target, root: dir, entries: walk(abs) };
}

export async function site_edit({ path, find, replace }) {
  if (!path || typeof find !== "string" || typeof replace !== "string") {
    return { ok: false, reason: "need_path_find_replace" };
  }
  const abs = resolve(ROOT, path);
  if (!sandboxOK(abs)) return { ok: false, reason: "outside_sandbox", allowed: Object.values(SITE_TARGETS) };
  if (!existsSync(abs)) return { ok: false, reason: "file_not_found", path };
  const before = readFileSync(abs, "utf-8");
  if (!before.includes(find)) return { ok: false, reason: "find_not_found_in_file", hint: `Строка не найдена в файле. Сначала fs_read посмотри что там есть, потом выбери уникальный фрагмент.` };
  const occurrences = before.split(find).length - 1;
  if (occurrences > 1) {
    // Show surrounding context for each occurrence so model can pick a unique
    // find string in the next iteration
    const contexts = [];
    let idx = 0, found = 0;
    while ((idx = before.indexOf(find, idx)) >= 0 && found < 4) {
      const start = Math.max(0, idx - 60);
      const end = Math.min(before.length, idx + find.length + 60);
      contexts.push(`...${before.slice(start, end).replace(/\s+/g, " ")}...`);
      idx += find.length; found++;
    }
    return {
      ok: false,
      reason: "find_string_not_unique",
      occurrences,
      hint: `Строка "${find}" встречается ${occurrences} раз. Используй БОЛЕЕ ДЛИННЫЙ уникальный фрагмент, включающий окружающий текст. Контексты:`,
      contexts,
    };
  }
  const after = before.replace(find, replace);
  writeFileSync(abs, after);
  return {
    ok: true,
    path,
    bytes_before: before.length,
    bytes_after: after.length,
    delta: after.length - before.length,
  };
}

export async function site_git_status() {
  try {
    const { stdout } = await exec("git", ["-C", ROOT, "status", "--short"], { encoding: "utf-8", maxBuffer: 1024 * 1024 });
    const lines = stdout.split("\n").filter(Boolean);
    return { ok: true, changed: lines.length, lines };
  } catch (e) { return { ok: false, reason: "git_failed", error: e.message }; }
}

export async function site_git_diff({ path }) {
  try {
    const args = ["-C", ROOT, "diff", "--no-color"];
    if (path) args.push("--", path);
    const { stdout } = await exec("git", args, { encoding: "utf-8", maxBuffer: 4 * 1024 * 1024 });
    return { ok: true, diff: stdout.slice(0, 8000), truncated: stdout.length > 8000 };
  } catch (e) { return { ok: false, reason: "git_failed", error: e.message }; }
}
