/**
 * scripts/content/motion-render.mjs
 *
 * Render a motion brief into MP4 + GIF.
 *
 * Pipeline:
 *   1. Build HTML from motion template (kinetic-text-loop, animated-flow, ...)
 *   2. Playwright loads HTML in headless Chromium with recordVideo enabled
 *   3. Wait `duration_sec` so the CSS animation completes one full loop
 *   4. Close context → finalizes WEBM video
 *   5. ffmpeg WEBM → MP4 (H.264, web-friendly)
 *   6. ffmpeg MP4 → GIF (LinkedIn fallback, capped at 6MB target)
 *   7. Egress check on rendered HTML before recording
 *
 * Public API:
 *   renderMotion({ brief })
 *     → { ok, slug, motion_template, duration_sec,
 *         webm_path, mp4_path, gif_path, manifest_path,
 *         mp4_bytes, gif_bytes }
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, renameSync, unlinkSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const TEMPLATES_DIR = resolve(__dirname, "templates");
const ASSETS_DIR = resolve(ROOT, ".data/content-assets");
const STYLE_PATH = resolve(__dirname, "visual-style.json");

const MOTION_TEMPLATES = ["kinetic-text-loop", "animated-flow"];

const ACCENT_HEX = {
  cyan:  "#00c8ff",
  gold:  "#f5b042",
  red:   "#ff5252",
  amber: "#ffa726",
  green: "#3ee07a",
};

const EGRESS_PATTERNS = [
  [/sk-ant-[\w-]{16,}/i, "Anthropic API key"],
  [/sk_live_[\w]{16,}/i, "Stripe live key"],
  [/sk_test_[\w]{16,}/i, "Stripe test key"],
  [/sk-proj-[\w-]{16,}/i, "OpenAI project key"],
  [/sk-[A-Za-z0-9]{20,}/, "Generic API key"],
  [/ghp_[\w]{36}/, "GitHub PAT"],
  [/AKIA[0-9A-Z]{16}/, "AWS access key"],
  [/AIza[\w-]{35}/, "Google API key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/i, "Private key PEM"],
  [/\/Users\/[a-z]+\/(Desktop|Documents|Downloads|.claude|.ssh)/i, "Internal filesystem path"],
  [/apps\/api\/\.env/i, "Internal .env reference"],
];
function inspectForEgress(text, scope = "unknown") {
  for (const [rx, label] of EGRESS_PATTERNS) {
    const m = text.match(rx);
    if (m) return { safe: false, scope, label, matched: m[0].slice(0, 30) + "…" };
  }
  return { safe: true };
}

function escapeHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function substitute(template, vars) {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    const re = new RegExp(`\\{\\{${k}\\}\\}`, "g");
    out = out.replace(re, v == null ? "" : String(v));
  }
  return out;
}

// Words-html: split big_title by spaces, mark accent on bracketed token, stagger entry timing
function buildWordsHtml(big_title) {
  // Allow [accent]word[/accent] markup inside the title
  const tokens = [];
  let work = big_title || "";
  // Replace accent markup with placeholders to keep grouping
  work = work.replace(/\[accent\](.*?)\[\/accent\]/g, (_, inner) => `ACC${inner}/ACC`);
  let i = 0;
  for (const piece of work.split(/(\s+)/)) {
    if (/^\s+$/.test(piece)) { tokens.push(piece); continue; }
    const isAccent = piece.startsWith("ACC");
    const text = piece.replace(/^ACC/, "").replace(/\/ACC$/, "");
    const delay = (i * 0.18).toFixed(2);
    tokens.push(`<span class="word${isAccent ? " accent" : ""}" style="animation-delay:${delay}s">${escapeHtml(text)}</span>`);
    i++;
  }
  return tokens.join("");
}

function renderAccent(s) {
  return String(s || "").replace(/\[accent\](.*?)\[\/accent\]/g, (_, w) => `<span class="accent">${escapeHtml(w)}</span>`);
}

// Steps for animated-flow: each step staggered, with arrow between (except last)
function buildStepsHtml(flow_steps, duration_sec) {
  if (!Array.isArray(flow_steps) || flow_steps.length === 0) return "";
  const n = flow_steps.length;
  const stepInterval = (duration_sec - 1.5) / n;
  const out = [];
  for (let i = 0; i < n; i++) {
    const step = flow_steps[i];
    const stepDelay = (i * stepInterval).toFixed(2);
    const arrowDelay = (i * stepInterval + 0.4).toFixed(2);
    out.push(`<div class="step" style="animation-delay:${stepDelay}s"><div class="num">${String(i+1).padStart(2,"0")}</div><div class="body"><div class="label">${escapeHtml(step.label)}</div><div class="desc">${escapeHtml(step.desc)}</div></div></div>`);
    if (i < n - 1) {
      out.push(`<div class="arrow" style="animation-delay:${arrowDelay}s; transform-origin:left center; height:18px; align-self:center;">━━ ▶</div>`);
    }
  }
  return out.join("\n");
}

const VARS_BUILDER = {
  "kinetic-text-loop": (brief, style, accent_hex, duration_sec, loopVars) => ({
    big_title: brief.big_title,
    words_html: buildWordsHtml(brief.big_title),
    accent_hex,
    duration_sec: String(duration_sec),
    ...loopVars,
    kicker: brief.kicker || "SUBSTRATE",
    kicker_tag: brief.kicker_tag || "MOTION",
    brand: brief.brand || style.brand || "SUBSTRATE",
    domain: brief.domain || style.domain || "launchsoloai.com",
  }),
  "animated-flow": (brief, style, accent_hex, duration_sec, loopVars) => ({
    big_title: brief.big_title || "",
    big_title_html: renderAccent(brief.big_title || ""),
    steps_html: buildStepsHtml(brief.flow_steps || [], duration_sec),
    accent_hex,
    duration_sec: String(duration_sec),
    ...loopVars,
    kicker: brief.kicker || "SUBSTRATE",
    kicker_tag: brief.kicker_tag || "FLOW",
    brand: brief.brand || style.brand || "SUBSTRATE",
    domain: brief.domain || style.domain || "launchsoloai.com",
  }),
};

function ensureFfmpeg() {
  try { execFileSync("ffmpeg", ["-version"], { stdio: ["ignore", "ignore", "ignore"] }); return true; }
  catch { return false; }
}

export async function renderMotion({ brief }) {
  if (!brief) return { ok: false, reason: "no_brief" };
  if (!brief.slug) return { ok: false, reason: "no_slug" };
  if (!ensureFfmpeg()) return { ok: false, reason: "ffmpeg_missing" };

  const template = brief.type || "kinetic-text-loop";
  if (!MOTION_TEMPLATES.includes(template)) return { ok: false, reason: "unknown_motion_template", template };

  let style;
  try { style = JSON.parse(readFileSync(STYLE_PATH, "utf-8")); }
  catch (e) { return { ok: false, reason: "style_load_failed", error: e.message }; }

  const briefScan = inspectForEgress(JSON.stringify(brief), "brief.json");
  if (!briefScan.safe) return { ok: false, reason: "egress_blocked_brief", detail: briefScan };

  const accent = brief.accent_color || "cyan";
  const accent_hex = ACCENT_HEX[accent] || ACCENT_HEX.cyan;

  // Animation timing: by default 4s loop with 0.5s fade-out and 0.5s pause before reset
  const duration_sec = Math.max(3, Math.min(12, brief.duration_sec || 5));
  // 4s -> fade_out_at = (3.0 / 4.0) * 100 = 75 %, fade_done_at = 87.5%, reset_at = 95%
  const fadeStartT = duration_sec - 1.0;
  const fadeDoneT  = duration_sec - 0.5;
  const resetT     = duration_sec - 0.05;
  const tplPath = resolve(TEMPLATES_DIR, `${template}.html`);
  if (!existsSync(tplPath)) return { ok: false, reason: "template_not_found", path: tplPath };
  const tplRaw = readFileSync(tplPath, "utf-8");

  const loopVars = {
    fade_out_at: ((fadeStartT / duration_sec) * 100).toFixed(2),
    fade_done_at: ((fadeDoneT  / duration_sec) * 100).toFixed(2),
    reset_at:     ((resetT     / duration_sec) * 100).toFixed(2),
  };
  const builder = VARS_BUILDER[template];
  if (!builder) return { ok: false, reason: "no_vars_builder", template };
  const vars = builder(brief, style, accent_hex, duration_sec, loopVars);
  const html = substitute(tplRaw, vars);

  const htmlScan = inspectForEgress(html, "rendered_html");
  if (!htmlScan.safe) return { ok: false, reason: "egress_blocked_html", detail: htmlScan };

  const outDir = resolve(ASSETS_DIR, brief.slug);
  mkdirSync(outDir, { recursive: true });
  const htmlPath = resolve(outDir, "motion.html");
  writeFileSync(htmlPath, html);
  writeFileSync(resolve(outDir, "brief.json"), JSON.stringify(brief, null, 2));

  // Playwright record
  const videoDir = resolve(outDir, "_video");
  mkdirSync(videoDir, { recursive: true });

  let browser = null;
  let webmPath = null;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
      viewport: { width: 1080, height: 1080 },
      recordVideo: { dir: videoDir, size: { width: 1080, height: 1080 } },
    });
    const page = await ctx.newPage();
    await page.goto("file://" + htmlPath, { waitUntil: "domcontentloaded", timeout: 30_000 });
    // Wait for at least 2 full loop cycles — gives ffmpeg material to trim from a steady-state moment
    await page.waitForTimeout(Math.round(duration_sec * 1000) + 500);
    const vid = page.video();
    await ctx.close();   // finalizes the .webm
    await browser.close();
    browser = null;
    if (vid) webmPath = await vid.path();
  } catch (e) {
    try { if (browser) await browser.close(); } catch {}
    return { ok: false, reason: "playwright_record_failed", error: e.message };
  }

  // Some Playwright versions don't return path() correctly; fallback: pick newest .webm in videoDir
  if (!webmPath || !existsSync(webmPath)) {
    const files = readdirSync(videoDir).filter(f => f.endsWith(".webm"));
    if (!files.length) return { ok: false, reason: "no_webm_recorded" };
    webmPath = resolve(videoDir, files.sort()[files.length - 1]);
  }

  // Stable webm path inside outDir
  const webmFinal = resolve(outDir, "motion.webm");
  try { renameSync(webmPath, webmFinal); } catch (e) {
    try { writeFileSync(webmFinal, readFileSync(webmPath)); } catch {}
  }

  // ffmpeg: webm → mp4 (H.264, faststart, trimmed to ONE full loop = duration_sec)
  const mp4Final = resolve(outDir, "motion.mp4");
  try {
    execFileSync("ffmpeg", [
      "-y",
      "-i", webmFinal,
      "-t", String(duration_sec),
      "-vf", `fps=30,scale=1080:1080:flags=lanczos`,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-preset", "medium",
      "-crf", "20",
      "-movflags", "+faststart",
      "-an",
      mp4Final,
    ], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    return { ok: false, reason: "ffmpeg_mp4_failed", error: String(e.stderr || e.message).slice(0, 300) };
  }

  // ffmpeg: mp4 → gif via 2-pass palette (clean, smaller)
  const gifFinal = resolve(outDir, "motion.gif");
  const palettePath = resolve(outDir, "_palette.png");
  try {
    execFileSync("ffmpeg", [
      "-y", "-i", mp4Final,
      "-vf", "fps=18,scale=720:720:flags=lanczos,palettegen=stats_mode=full",
      palettePath,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    execFileSync("ffmpeg", [
      "-y", "-i", mp4Final, "-i", palettePath,
      "-lavfi", "fps=18,scale=720:720:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=4",
      gifFinal,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    try { unlinkSync(palettePath); } catch {}
  } catch (e) {
    // mp4 still valid even if gif fails; surface but don't block
    console.error(`gif convert warn: ${String(e.stderr || e.message).slice(0, 160)}`);
  }

  const mp4_bytes = existsSync(mp4Final) ? statSync(mp4Final).size : 0;
  const gif_bytes = existsSync(gifFinal) ? statSync(gifFinal).size : 0;

  const manifest = {
    slug: brief.slug,
    asset_level: "motion",
    motion_template: template,
    duration_sec,
    rendered_at: new Date().toISOString(),
    files: { html: "motion.html", webm: "motion.webm", mp4: "motion.mp4", gif: "motion.gif", brief: "brief.json" },
    bytes: { mp4: mp4_bytes, gif: gif_bytes },
    big_title: brief.big_title,
    accent_color: accent,
  };
  const manifestPath = resolve(outDir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return {
    ok: true,
    slug: brief.slug,
    motion_template: template,
    duration_sec,
    html_path: htmlPath.replace(ROOT + "/", ""),
    webm_path: webmFinal.replace(ROOT + "/", ""),
    mp4_path: mp4Final.replace(ROOT + "/", ""),
    gif_path: existsSync(gifFinal) ? gifFinal.replace(ROOT + "/", "") : null,
    manifest_path: manifestPath.replace(ROOT + "/", ""),
    mp4_bytes,
    gif_bytes,
  };
}

// CLI smoke
if (import.meta.url === `file://${process.argv[1]}`) {
  const which = process.argv[2] || "kinetic";
  const slug = `motion-smoke-${which}-${Date.now()}`;
  const briefs = {
    "kinetic": {
      slug,
      type: "kinetic-text-loop",
      asset_level: "motion",
      accent_color: "cyan",
      duration_sec: 5,
      kicker: "SUBSTRATE",
      kicker_tag: "PRINCIPLE",
      big_title: "Substrate refuses to fake [accent]done[/accent]",
    },
    "flow": {
      slug,
      type: "animated-flow",
      asset_level: "motion",
      accent_color: "cyan",
      duration_sec: 8,
      kicker: "SUBSTRATE",
      kicker_tag: "PIPELINE",
      big_title: "How a [accent]signal[/accent] becomes a sale",
      flow_steps: [
        { label: "SIGNAL",   desc: "Awareness brief flags a market shift" },
        { label: "RESEARCH", desc: "Scout evaluates the lead against ICP" },
        { label: "OFFER",    desc: "Brief is drafted, claims are verified" },
        { label: "OUTREACH", desc: "Message ships through chosen channel" },
        { label: "REPLY",    desc: "Response logged, classified by intent" },
        { label: "LEARN",    desc: "Outcome feeds belief graph + future plays" },
      ],
    },
  };
  const brief = briefs[which];
  if (!brief) { console.error(`unknown smoke: ${which} — try kinetic|flow`); process.exit(2); }
  renderMotion({ brief }).then(r => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  });
}
