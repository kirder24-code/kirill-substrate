/**
 * scripts/content/scroll-render.mjs
 *
 * Render a scroll-experience brief: composes a landing-page HTML from sections,
 * captures (1) a top-to-bottom scroll-video MP4 and (2) a multi-page PDF.
 *
 * Brief shape (built by visual-agent --level=scroll --recipe=<name> or by panel):
 *   {
 *     slug, page_purpose, accent_color, cta_url,
 *     sections: [{ n, type, headline, body, kicker, layers?, terminal?, pricing?, cta_text }],
 *   }
 *
 * Output:
 *   { ok, html_path, scroll_mp4_path, pdf_path, manifest_path, html_bytes,
 *     mp4_bytes, pdf_bytes, section_count, cta_url }
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, renameSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const TEMPLATES_DIR = resolve(__dirname, "templates");
const ASSETS_DIR = resolve(ROOT, ".data/content-assets");
const STYLE_PATH = resolve(__dirname, "visual-style.json");

const ACCENT_HEX = { cyan: "#00c8ff", gold: "#f5b042", red: "#ff5252", amber: "#ffa726", green: "#3ee07a" };

const EGRESS_PATTERNS = [
  [/sk-ant-[\w-]{16,}/i, "Anthropic API key"],
  [/sk_live_[\w]{16,}/i, "Stripe live key"],
  [/sk-[A-Za-z0-9]{20,}/, "Generic API key"],
  [/ghp_[\w]{36}/, "GitHub PAT"],
  [/AKIA[0-9A-Z]{16}/, "AWS access key"],
  [/AIza[\w-]{35}/, "Google API key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/i, "Private key"],
  [/\/Users\/[a-z]+\/(Desktop|Documents|Downloads|.claude|.ssh)/i, "Internal filesystem path"],
  [/apps\/api\/\.env/i, "Internal .env"],
];
function inspectForEgress(text, scope) {
  for (const [rx, label] of EGRESS_PATTERNS) {
    const m = text.match(rx);
    if (m) return { safe: false, scope, label };
  }
  return { safe: true };
}

function escapeHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function renderAccent(s) {
  return String(s || "").replace(/\[accent\](.*?)\[\/accent\]/g, (_, w) => `<span class="accent">${escapeHtml(w)}</span>`);
}

function buildSectionHtml(section, accent_hex, brand, domain) {
  const k = section.kicker || `SUBSTRATE · ${section.type?.toUpperCase() || "SECTION"}`;
  const kicker = `<div class="kicker">${escapeHtml(k.split("·")[0]?.trim())}<span class="dot"> ·</span> ${escapeHtml((k.split("·")[1] || "").trim())}</div>`;
  const footer = `<div class="footer-row"><span>${escapeHtml(brand)}</span><span class="domain">${escapeHtml(domain)}</span></div>`;
  let body = "";
  switch (section.type) {
    case "hero":
      body = `${kicker}<h1>${renderAccent(section.headline)}</h1>${section.body ? `<p style="margin-top:48px">${escapeHtml(section.body)}</p>` : ""}${section.cta_text ? `<a class="cta-link" href="${escapeHtml(section.cta_url || "#")}">${escapeHtml(section.cta_text)}</a>` : ""}`;
      break;
    case "problem":
    case "solution":
      body = `${kicker}<h2>${renderAccent(section.headline)}</h2><p>${escapeHtml(section.body || "")}</p>`;
      if (Array.isArray(section.bullets)) body += `<ul>${section.bullets.map(b => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`;
      break;
    case "system":
      body = `${kicker}<h2>${renderAccent(section.headline)}</h2>`;
      if (Array.isArray(section.layers)) {
        body += `<div class="stack">` + section.layers.map((l, i) =>
          `<div class="layer${l.highlight ? " highlight" : ""}"><div class="num">L${String(i+1).padStart(2,"0")}</div><div class="name">${escapeHtml(l.name)}</div><div class="desc">${escapeHtml(l.desc)}</div></div>`
        ).join("") + `</div>`;
      }
      break;
    case "proof":
      body = `${kicker}<h2>${renderAccent(section.headline)}</h2><p>${escapeHtml(section.body || "")}</p>`;
      if (section.terminal) {
        const lines = (section.terminal.lines || []).map(l => {
          if (l.kind === "prompt") return `<div><span class="prompt">$ ${escapeHtml(l.text)}</span></div>`;
          if (l.kind === "ok") return `<div class="ok">${escapeHtml(l.text)}</div>`;
          if (l.kind === "err") return `<div class="err">${escapeHtml(l.text)}</div>`;
          return `<div>${escapeHtml(l.text)}</div>`;
        }).join("");
        body += `<div class="terminal"><div class="bar">${escapeHtml(section.terminal.title || "terminal")}</div><div class="body">${lines}</div></div>`;
      }
      break;
    case "pricing":
      body = `${kicker}<h2>${renderAccent(section.headline)}</h2><p>${escapeHtml(section.body || "")}</p>`;
      if (Array.isArray(section.tiers)) {
        body += `<div class="pricing-grid">` + section.tiers.map(t =>
          `<div class="price-card${t.featured ? " featured" : ""}"><div class="tier">${escapeHtml(t.tier)}</div><div class="amount">${escapeHtml(t.amount)}</div><div class="unit">${escapeHtml(t.unit || "")}</div><ul>${(t.includes || []).map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul></div>`
        ).join("") + `</div>`;
      }
      break;
    case "cta":
      body = `${kicker}<h2>${renderAccent(section.headline)}</h2>${section.body ? `<p>${escapeHtml(section.body)}</p>` : ""}${section.cta_text ? `<a class="cta-link" href="${escapeHtml(section.cta_url || "#")}">${escapeHtml(section.cta_text)}</a>` : ""}`;
      break;
    default:
      body = `${kicker}<h2>${renderAccent(section.headline || "")}</h2>${section.body ? `<p>${escapeHtml(section.body)}</p>` : ""}`;
  }
  return `<section data-section="${section.type}">${body}${footer}</section>`;
}

function ensureFfmpeg() {
  try { execFileSync("ffmpeg", ["-version"], { stdio: ["ignore", "ignore", "ignore"] }); return true; }
  catch { return false; }
}

export async function renderScroll({ brief }) {
  if (!brief?.slug) return { ok: false, reason: "no_slug" };
  if (!Array.isArray(brief.sections) || brief.sections.length < 4 || brief.sections.length > 8) {
    return { ok: false, reason: "invalid_section_count", count: brief.sections?.length };
  }
  if (!ensureFfmpeg()) return { ok: false, reason: "ffmpeg_missing" };

  let style;
  try { style = JSON.parse(readFileSync(STYLE_PATH, "utf-8")); }
  catch (e) { return { ok: false, reason: "style_load_failed", error: e.message }; }

  const briefScan = inspectForEgress(JSON.stringify(brief), "brief.json");
  if (!briefScan.safe) return { ok: false, reason: "egress_blocked_brief", detail: briefScan };

  const accent_hex = ACCENT_HEX[brief.accent_color] || ACCENT_HEX.cyan;
  const brand = brief.brand || style.brand || "SUBSTRATE";
  const domain = brief.domain || style.domain || "launchsoloai.com";

  const tplPath = resolve(TEMPLATES_DIR, "landing-page.html");
  const tplRaw = readFileSync(tplPath, "utf-8");

  const sectionsHtml = brief.sections.map(s => buildSectionHtml(s, accent_hex, brand, domain)).join("\n");
  const html = tplRaw
    .replace(/\{\{page_title\}\}/g, escapeHtml(brief.page_title || brief.sections[0]?.headline || "Substrate"))
    .replace(/\{\{accent_hex\}\}/g, accent_hex)
    .replace(/\{\{sections_html\}\}/g, sectionsHtml);

  const htmlScan = inspectForEgress(html, "rendered_html");
  if (!htmlScan.safe) return { ok: false, reason: "egress_blocked_html", detail: htmlScan };

  const outDir = resolve(ASSETS_DIR, brief.slug);
  mkdirSync(outDir, { recursive: true });
  const htmlPath = resolve(outDir, "landing.html");
  writeFileSync(htmlPath, html);
  writeFileSync(resolve(outDir, "brief.json"), JSON.stringify(brief, null, 2));

  // Playwright: open page, record scroll video, also save PDF
  const videoDir = resolve(outDir, "_video");
  mkdirSync(videoDir, { recursive: true });

  const VIEWPORT_W = 1920, VIEWPORT_H = 1080;
  const scrollMp4 = resolve(outDir, "scroll.mp4");
  const pdfPath = resolve(outDir, "landing.pdf");

  let browser = null;
  let webmPath = null;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
      viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
      recordVideo: { dir: videoDir, size: { width: VIEWPORT_W, height: VIEWPORT_H } },
    });
    const page = await ctx.newPage();
    await page.goto("file://" + htmlPath, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(800);

    // Programmatic scroll: 400px/sec, target full page height
    const pageHeight = await page.evaluate(() => document.body.scrollHeight);
    const pxPerSec = 350;
    const totalScroll = pageHeight - VIEWPORT_H;
    const totalSec = Math.max(8, Math.min(50, totalScroll / pxPerSec));
    const steps = Math.round(totalSec * 30); // 30fps
    const stepPx = totalScroll / steps;
    await page.waitForTimeout(800); // settle at top
    for (let i = 0; i < steps; i++) {
      await page.evaluate(([sp, i]) => window.scrollTo(0, sp * (i + 1)), [stepPx, i]);
      await page.waitForTimeout(1000 / 30);
    }
    await page.waitForTimeout(800);

    // PDF (full page)
    await page.emulateMedia({ media: "screen" });
    await page.pdf({ path: pdfPath, width: `${VIEWPORT_W}px`, height: `${VIEWPORT_H}px`, printBackground: true });

    const vid = page.video();
    await ctx.close();
    await browser.close();
    browser = null;
    if (vid) webmPath = await vid.path();
  } catch (e) {
    try { if (browser) await browser.close(); } catch {}
    return { ok: false, reason: "playwright_scroll_failed", error: e.message };
  }

  if (!webmPath || !existsSync(webmPath)) {
    const files = readdirSync(videoDir).filter(f => f.endsWith(".webm"));
    if (!files.length) return { ok: false, reason: "no_webm_recorded" };
    webmPath = resolve(videoDir, files.sort()[files.length - 1]);
  }
  const webmFinal = resolve(outDir, "scroll.webm");
  try { renameSync(webmPath, webmFinal); } catch (e) {
    try { writeFileSync(webmFinal, readFileSync(webmPath)); } catch {}
  }

  // ffmpeg: webm → mp4 (no fixed duration cap; full recorded length)
  try {
    execFileSync("ffmpeg", [
      "-y", "-i", webmFinal,
      "-vf", "fps=30,scale=1920:1080:flags=lanczos",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "22",
      "-movflags", "+faststart", "-an",
      scrollMp4,
    ], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    return { ok: false, reason: "ffmpeg_mp4_failed", error: String(e.stderr || e.message).slice(0, 300) };
  }

  const mp4_bytes = existsSync(scrollMp4) ? statSync(scrollMp4).size : 0;
  const pdf_bytes = existsSync(pdfPath) ? statSync(pdfPath).size : 0;
  const html_bytes = existsSync(htmlPath) ? statSync(htmlPath).size : 0;

  const manifest = {
    slug: brief.slug, asset_level: "scroll",
    section_count: brief.sections.length,
    page_purpose: brief.page_purpose || "marketing-landing",
    cta_url: brief.cta_url || null,
    rendered_at: new Date().toISOString(),
    files: { html: "landing.html", scroll_mp4: "scroll.mp4", pdf: "landing.pdf", webm: "scroll.webm", brief: "brief.json" },
    bytes: { html: html_bytes, mp4: mp4_bytes, pdf: pdf_bytes },
  };
  const manifestPath = resolve(outDir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return {
    ok: true,
    slug: brief.slug,
    html_path: htmlPath.replace(ROOT + "/", ""),
    scroll_mp4_path: scrollMp4.replace(ROOT + "/", ""),
    pdf_path: pdfPath.replace(ROOT + "/", ""),
    webm_path: webmFinal.replace(ROOT + "/", ""),
    manifest_path: manifestPath.replace(ROOT + "/", ""),
    html_bytes, mp4_bytes, pdf_bytes,
    section_count: brief.sections.length,
    cta_url: brief.cta_url || null,
  };
}

// CLI smoke
if (import.meta.url === `file://${process.argv[1]}`) {
  const slug = `scroll-smoke-${Date.now()}`;
  const brief = {
    slug,
    page_purpose: "marketing-landing",
    page_title: "Substrate — AI OS for solo operators",
    accent_color: "cyan",
    cta_url: "https://launchsoloai.com",
    sections: [
      { type: "hero", kicker: "SUBSTRATE · LAUNCHSOLOAI", headline: "AI operating systems for [accent]solo operators[/accent].", body: "Substrate replaces the chatbot with a disciplined AI OS — one operator, full pipeline, real artifacts.", cta_text: "Book a diagnostic →", cta_url: "https://launchsoloai.com" },
      { type: "problem", kicker: "PROBLEM · COMMON", headline: "Most AI agents are [accent]chatbots[/accent] in disguise.", body: "They look smart in demos. In production they hallucinate, lose context, and skip verification.", bullets: ["No memory between sessions","No verification of claims","No ability to act outside one prompt","No discipline when things go wrong"] },
      { type: "system", kicker: "SUBSTRATE · ARCHITECTURE", headline: "Five layers. Each layer has one job.", layers: [
        { name: "Voice (Tolik)", desc: "Operator interface, 49 tools, real-time conversation" },
        { name: "Discipline", desc: "ISA gates, verification doctrine, egress guard" },
        { name: "Brain (Cortex)", desc: "591 beliefs, learning loop, world model", highlight: true },
        { name: "Hands (Factory)", desc: "138 bots: scout, content, sales, awareness" },
        { name: "Storage", desc: "5 active SQLite, 137 memory files, organism DB" },
      ]},
      { type: "proof", kicker: "PROOF · LIVE", headline: "Discipline that [accent]refuses[/accent] to fake done.", body: "Every opportunity transition must pass the ISA gate. No bypass.", terminal: { title: "node scripts/survival/opportunity-store.mjs", lines: [
        { kind: "prompt", text: "transition('opp-australia', 'done')" },
        { kind: "text",   text: "ISA Gate response:" },
        { kind: "err",    text: "Error: isa_gate_blocked" },
        { kind: "text",   text: "  reason: '9/9 criterion ISCs still pending'" },
        { kind: "ok",     text: "State NOT changed. Discipline holds." },
      ]}},
      { type: "pricing", kicker: "ENGAGEMENT", headline: "Three ways to [accent]work together[/accent].", tiers: [
        { tier: "Diagnostic", amount: "$1,500", unit: "CAD · 1 week", includes: ["Audit current workflow","Identify top 3 wins","Build ROI model","No commitment"] },
        { tier: "NBFC pattern", amount: "$5,000", unit: "CAD · 3 days", includes: ["Apollo-Finvest 3-day build","Multi-vendor AI stack","Compliance gates","Production deploy"], featured: true },
        { tier: "Custom build", amount: "$10,000", unit: "CAD · 2-3 weeks", includes: ["Full Substrate adaptation","Industry-specific gates","Hand-off + training","30 days support"] },
      ]},
      { type: "cta", kicker: "NEXT STEP", headline: "Book a [accent]15-minute[/accent] diagnostic.", body: "No pitch. We'll look at your workflow on a call and tell you whether Substrate makes sense.", cta_text: "Book the diagnostic →", cta_url: "https://launchsoloai.com" },
    ],
  };
  renderScroll({ brief }).then(r => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  });
}
