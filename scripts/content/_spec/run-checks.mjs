/**
 * scripts/content/_spec/run-checks.mjs
 *
 * Independent E2E success-check harness for Visual Agent Variant C.
 *
 * Written BEFORE any of the motion/scroll code, as a contract.
 * Calls external tools (ffprobe, file, sqlite3, ls) — not the code under test —
 * to ask GROUND TRUTH whether the produced artifacts are real.
 *
 * Usage:
 *   node scripts/content/_spec/run-checks.mjs --level=static --asset=<json-output-from-agent>
 *   node scripts/content/_spec/run-checks.mjs --level=motion --asset=<json>
 *   node scripts/content/_spec/run-checks.mjs --level=scroll --asset=<json>
 *
 * Exits 0 if ALL checks pass for that level. Exits 1 otherwise.
 * Prints a table of check_id / pass|fail / actual-value / how-Kirill-verifies-manually.
 */

import { execSync } from "node:child_process";
import { existsSync, statSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");

// ─── External-tool probes ───────────────────────────────────────────────

function sh(cmd) {
  try { return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
  catch (e) { return `__ERROR__ ${e.message.split("\n")[0]}`; }
}

function fileSize(path) { return existsSync(path) ? statSync(path).size : -1; }

function fileMime(path) { return existsSync(path) ? sh(`file -b --mime-type "${path}"`) : "missing"; }

function ffprobeDuration(path) {
  if (!existsSync(path)) return -1;
  const out = sh(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${path}"`);
  return out.startsWith("__ERROR__") ? -1 : parseFloat(out);
}

function sqliteLatestAsset() {
  if (!existsSync(DB_PATH)) return null;
  const out = sh(`sqlite3 "${DB_PATH}" "SELECT id, template_type, accent_color, asset_level, paths FROM content_visual_assets ORDER BY id DESC LIMIT 1" 2>/dev/null`);
  if (!out || out.startsWith("__ERROR__")) return null;
  const [id, template_type, accent_color, asset_level, paths] = out.split("|");
  return { id, template_type, accent_color, asset_level, paths };
}

function grepFile(path, needle) {
  if (!existsSync(path)) return false;
  try { return readFileSync(path, "utf8").includes(needle); } catch { return false; }
}

function fileMatchesPixelEqualEndpoints(_mp4Path) {
  // Cheap stand-in: leave as MANUAL until ffmpeg frame extract added.
  // Returning "manual" forces human eye on this check.
  return "manual";
}

// ─── Check definitions per level ────────────────────────────────────────

function checksStatic(asset) {
  const png = asset?.png_path;
  return [
    { id: "S1", label: "PNG file exists > 50KB", pass: () => fileSize(png) > 50_000, actual: () => `${fileSize(png)} bytes` },
    { id: "S2", label: "PNG file is real PNG mime", pass: () => fileMime(png) === "image/png", actual: () => fileMime(png) },
    { id: "S3", label: "Dimensions sane (≥1080 either side)", pass: () => {
        if (!existsSync(png)) return false;
        const out = sh(`sips -g pixelWidth -g pixelHeight "${png}" 2>/dev/null | tail -2`);
        const w = parseInt((out.match(/pixelWidth:\s*(\d+)/) || [])[1] || "0");
        const h = parseInt((out.match(/pixelHeight:\s*(\d+)/) || [])[1] || "0");
        return w >= 1080 && h >= 1080;
      },
      actual: () => sh(`sips -g pixelWidth -g pixelHeight "${png}" 2>/dev/null | tail -2`).replace(/\n/g, " "),
    },
    { id: "S4", label: "Telegram message_id present in asset output (proves dispatch ran)", pass: () => !!asset?.telegram_message_id, actual: () => asset?.telegram_message_id || "(none)" },
    { id: "S5", label: "DB row matches asset id", pass: () => { const r = sqliteLatestAsset(); return r && String(r.id) === String(asset?.db_id); }, actual: () => JSON.stringify(sqliteLatestAsset()) },
    { id: "S6", label: "No forbidden phrases in brief", pass: () => {
        const brief = asset?.brief_json_path;
        if (!brief || !existsSync(brief)) return false;
        const txt = readFileSync(brief, "utf8").toLowerCase();
        return !["guaranteed", "100x", "millions", "guarantee"].some(p => txt.includes(p));
      }, actual: () => asset?.brief_json_path || "(no brief path)" },
    { id: "S7", label: "Wall time < 30s", pass: () => (asset?.elapsed_ms || 0) < 30_000, actual: () => `${asset?.elapsed_ms || "?"}ms` },
  ];
}

function checksMotion(asset) {
  const mp4 = asset?.mp4_path;
  const gif = asset?.gif_path;
  return [
    { id: "M1", label: "MP4 file exists", pass: () => fileSize(mp4) > 0, actual: () => `${fileSize(mp4)} bytes` },
    { id: "M2", label: "MP4 size between 100KB and 8MB", pass: () => { const s = fileSize(mp4); return s >= 100_000 && s <= 8_000_000; }, actual: () => `${(fileSize(mp4)/1024).toFixed(0)} KB` },
    { id: "M3", label: "MP4 duration 3-12s", pass: () => { const d = ffprobeDuration(mp4); return d >= 3 && d <= 12; }, actual: () => `${ffprobeDuration(mp4)}s` },
    { id: "M4", label: "MP4 mime is video/mp4", pass: () => fileMime(mp4) === "video/mp4", actual: () => fileMime(mp4) },
    { id: "M5", label: "MP4 non-black (visual content)", pass: "manual", actual: () => "Kirill watches MP4 in QuickTime" },
    { id: "M6", label: "Loop seamless (frame 0 == final frame)", pass: () => fileMatchesPixelEqualEndpoints(mp4), actual: () => "manual visual inspection" },
    { id: "M7", label: "GIF version < 6MB", pass: () => { const s = fileSize(gif); return s > 0 && s <= 6_000_000; }, actual: () => `${(fileSize(gif)/1024).toFixed(0)} KB` },
    { id: "M8", label: "Telegram dispatch returned message_id", pass: () => !!asset?.telegram_message_id, actual: () => asset?.telegram_message_id || "(none)" },
    { id: "M9", label: "DB row records asset_level=motion + both paths", pass: () => {
        const r = sqliteLatestAsset();
        if (!r || r.asset_level !== "motion") return false;
        const paths = r.paths || "";
        return paths.includes(".mp4") && paths.includes(".gif");
      }, actual: () => JSON.stringify(sqliteLatestAsset()) },
    { id: "M10", label: "Wall time < 90s", pass: () => (asset?.elapsed_ms || 0) < 90_000, actual: () => `${asset?.elapsed_ms || "?"}ms` },
  ];
}

function checksScroll(asset) {
  const html = asset?.html_path;
  const scrollMp4 = asset?.scroll_mp4_path;
  const pdf = asset?.pdf_path;
  return [
    { id: "W1", label: "HTML file exists > 10KB", pass: () => fileSize(html) > 10_000, actual: () => `${fileSize(html)} bytes` },
    { id: "W2", label: "HTML contains 4-8 <section> tags", pass: () => {
        if (!existsSync(html)) return false;
        const txt = readFileSync(html, "utf8");
        const count = (txt.match(/<section\b/gi) || []).length;
        return count >= 4 && count <= 8;
      }, actual: () => { try { return `${(readFileSync(html,"utf8").match(/<section\b/gi)||[]).length} sections`; } catch { return "n/a"; } } },
    { id: "W3", label: "HTML opens in browser (manual)", pass: "manual", actual: () => "Kirill opens HTML in Safari" },
    { id: "W4", label: "Scroll MP4 file exists", pass: () => fileSize(scrollMp4) > 0, actual: () => `${fileSize(scrollMp4)} bytes` },
    { id: "W5", label: "Scroll MP4 duration 10-60s", pass: () => { const d = ffprobeDuration(scrollMp4); return d >= 10 && d <= 60; }, actual: () => `${ffprobeDuration(scrollMp4)}s` },
    { id: "W6", label: "Multi-page PDF exists", pass: () => fileSize(pdf) > 5_000, actual: () => `${fileSize(pdf)} bytes` },
    { id: "W7", label: "CTA URL preserved in HTML", pass: () => asset?.cta_url ? grepFile(html, asset.cta_url) : "skip", actual: () => asset?.cta_url || "(no CTA URL in brief)" },
    { id: "W8", label: "No credentials / $HOME/ in HTML", pass: () => {
        if (!existsSync(html)) return false;
        const txt = readFileSync(html, "utf8");
        return !txt.includes("$HOME/") && !/sk-[a-z0-9-]{20,}/i.test(txt);
      }, actual: () => "egress scan" },
    { id: "W9", label: "Telegram dispatch returned message_id", pass: () => !!asset?.telegram_message_id, actual: () => asset?.telegram_message_id || "(none)" },
    { id: "W10", label: "Hard-claim numbers match substrate state", pass: "manual", actual: () => "verify quoted numbers vs organism.db at render-time" },
    { id: "W11", label: "DB row records asset_level=scroll", pass: () => { const r = sqliteLatestAsset(); return r && r.asset_level === "scroll"; }, actual: () => JSON.stringify(sqliteLatestAsset()) },
  ];
}

// ─── Runner ─────────────────────────────────────────────────────────────

function parseArgs() {
  const args = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

function loadAsset(p) {
  if (!p) return {};
  if (!existsSync(p)) {
    console.error(`Asset JSON not found: ${p}`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(p, "utf8"));
}

function runChecks(level, asset) {
  const checks = level === "static" ? checksStatic(asset)
              : level === "motion" ? checksMotion(asset)
              : level === "scroll" ? checksScroll(asset)
              : null;
  if (!checks) { console.error(`Unknown level: ${level}`); process.exit(2); }

  let passed = 0, failed = 0, manual = 0;
  console.log(`\n=== Variant C success checks: level=${level} ===\n`);
  console.log(`ID    Pass     Detail`);
  console.log(`────  ───────  ─────────────────────────────────────────`);

  for (const c of checks) {
    let p;
    try { p = typeof c.pass === "function" ? c.pass() : c.pass; }
    catch (e) { p = false; }
    let icon, status;
    if (p === true) { icon = "✓"; status = "PASS"; passed++; }
    else if (p === "manual") { icon = "○"; status = "MANUAL"; manual++; }
    else if (p === "skip") { icon = "–"; status = "SKIP"; }
    else { icon = "✗"; status = "FAIL"; failed++; }
    let actual = "";
    try { actual = typeof c.actual === "function" ? c.actual() : c.actual; } catch (e) { actual = `(probe error: ${e.message})`; }
    console.log(`${c.id.padEnd(4)}  ${icon} ${status.padEnd(5)}  ${c.label} → ${actual}`);
  }

  console.log(`\nResult: ${passed} pass, ${failed} fail, ${manual} manual-check-required\n`);
  if (failed > 0) {
    console.log(`✗ BUILD NOT DONE. ${failed} automated check(s) failed.`);
    process.exit(1);
  }
  if (manual > 0) {
    console.log(`○ ${manual} check(s) require Kirill's eyes. Not done until Kirill confirms.`);
    process.exit(3);
  }
  console.log(`✓ All automated checks pass.`);
  process.exit(0);
}

const args = parseArgs();
if (!args.level) {
  console.error("Usage: run-checks.mjs --level=static|motion|scroll [--asset=path/to/asset.json]");
  process.exit(2);
}
const asset = loadAsset(args.asset);
runChecks(args.level, asset);
