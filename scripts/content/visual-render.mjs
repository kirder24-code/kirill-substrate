/**
 * scripts/content/visual-render.mjs
 *
 * Renders a brief (structured JSON) into PNG asset(s).
 * Supports 8 templates with type-specific variable substitution.
 * Egress check at 3 points (brief, HTML, manifest).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const TEMPLATES_DIR = resolve(__dirname, "templates");
const ASSETS_DIR = resolve(ROOT, ".data/content-assets");
const STYLE_PATH = resolve(__dirname, "visual-style.json");

const TEMPLATE_DIMENSIONS = {
  "idea-card":      { w: 1080, h: 1080 },
  "news-card":      { w: 1080, h: 1080 },
  "stat-hero":      { w: 1080, h: 1080 },
  "quote-card":     { w: 1080, h: 1080 },
  "before-after":   { w: 1080, h: 1080 },
  "system-diagram": { w: 1080, h: 1350 },
  "proof-frame":    { w: 1080, h: 1080 },
  "carousel-slide": { w: 1080, h: 1350 },
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
  [/whsec_[\w]{16,}/i, "Webhook secret"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/i, "Private key PEM"],
  [/\/Users\/[a-z]+\/(Desktop|Documents|Downloads|.claude|.ssh)/i, "Internal filesystem path"],
  [/apps\/api\/\.env/i, "Internal .env reference"],
  [/process\.env\.[A-Z_]{4,}/i, "process.env reference"],
];

function inspectForEgress(text, scope = "unknown") {
  if (!text || typeof text !== "string") return { safe: true };
  for (const [rx, label] of EGRESS_PATTERNS) {
    const m = text.match(rx);
    if (m) return { safe: false, scope, label, matched: m[0].slice(0, 30) + "…", reason: `egress check blocked in ${scope}: ${label}` };
  }
  return { safe: true };
}

function inspectForSoftClaims(text, forbidden) {
  if (!text || !Array.isArray(forbidden)) return { safe: true };
  const lower = text.toLowerCase();
  for (const phrase of forbidden) {
    if (lower.includes(phrase.toLowerCase())) return { safe: false, label: "forbidden_phrase", matched: phrase };
  }
  return { safe: true };
}

function substitute(template, vars) {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    const re = new RegExp(`\\{\\{${k}\\}\\}`, "g");
    out = out.replace(re, v == null ? "" : String(v));
  }
  return out;
}

function escapeHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderAccentMarkup(text) {
  if (!text) return "";
  return text.replace(/\[accent\](.*?)\[\/accent\]/g, '<span class="accent">$1</span>')
             .replace(/\[em\](.*?)\[\/em\]/g, '<span class="em">$1</span>');
}

// ─── Template-specific variable builders ────────────────────────────────

function varsForIdeaCard(brief, style) {
  const stepsHtml = (brief.diagram?.steps || []).map(s =>
    `<div class="step"><div class="label">${escapeHtml(s.label)}</div><div class="desc">${escapeHtml(s.desc)}</div></div>`
  ).join("\n      ");
  return {
    kicker: brief.kicker || style.brand.toUpperCase(),
    big_title: brief.big_title,
    big_title_html: renderAccentMarkup(brief.big_title),
    subtitle_block: brief.subtitle ? `<div class="subtitle">${escapeHtml(brief.subtitle)}</div>` : "",
    steps_html: stepsHtml,
    brand: brief.brand || style.brand,
    author: brief.author || style.author,
    domain: brief.domain || style.domain,
  };
}

function varsForNewsCard(brief, style) {
  const numberBlock = brief.primary_number
    ? `<div class="big-number">${escapeHtml(brief.primary_number)}</div><div class="big-number-context">${escapeHtml(brief.primary_number_context || "")}</div>`
    : "";
  const deadlineBlock = brief.deadline_framing
    ? `<div class="deadline">${escapeHtml(brief.deadline_framing)}</div>` : "";
  return {
    kicker: brief.kicker || "NEWS",
    accent_class: brief.accent_color || "cyan",
    timestamp_text: brief.timestamp_text || `AS OF ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()}`,
    deadline_block: deadlineBlock,
    big_number_block: numberBlock,
    big_title: brief.big_title,
    big_title_html: renderAccentMarkup(brief.big_title),
    source_line: brief.source_line || "",
    brand: brief.brand || style.brand,
    author: brief.author || style.author,
    domain: brief.domain || style.domain,
  };
}

function varsForStatHero(brief, style) {
  return {
    kicker: brief.kicker || "SUBSTRATE · STATS",
    accent_class: brief.accent_color || "cyan",
    stat_value: brief.stat_value || brief.primary_number || "?",
    stat_unit: brief.stat_unit || "",
    big_title: brief.big_title || brief.context || "",
    context_html: renderAccentMarkup(brief.context || brief.subtitle || ""),
    brand: brief.brand || style.brand,
    author: brief.author || style.author,
    domain: brief.domain || style.domain,
  };
}

function varsForQuoteCard(brief, style) {
  return {
    kicker: brief.kicker || "SUBSTRATE · PRINCIPLE",
    accent_class: brief.accent_color || "cyan",
    big_title: brief.quote || brief.big_title || "",
    quote_html: renderAccentMarkup(brief.quote || brief.big_title || ""),
    attribution: brief.attribution || `${style.author}`,
    brand: brief.brand || style.brand,
    author: brief.author || style.author,
    domain: brief.domain || style.domain,
  };
}

function varsForBeforeAfter(brief, style) {
  const bItems = (brief.before_items || []).map(i => `<div class="col-item">${escapeHtml(i)}</div>`).join("");
  const aItems = (brief.after_items || []).map(i => `<div class="col-item">${escapeHtml(i)}</div>`).join("");
  return {
    kicker: brief.kicker || "SUBSTRATE · TRANSFORMATION",
    big_title: brief.big_title,
    big_title_html: renderAccentMarkup(brief.big_title),
    before_label: brief.before_label || "BEFORE",
    before_title: brief.before_title || "Old way",
    before_items_html: bItems,
    after_label: brief.after_label || "AFTER",
    after_title: brief.after_title || "New way",
    after_items_html: aItems,
    brand: brief.brand || style.brand,
    author: brief.author || style.author,
    domain: brief.domain || style.domain,
  };
}

function varsForSystemDiagram(brief, style) {
  const layersHtml = (brief.layers || brief.diagram?.layers || []).map((l, idx) => {
    const highlight = l.highlight ? " highlight" : "";
    const num = String(idx + 1).padStart(2, "0");
    return `<div class="layer${highlight}"><div class="layer-num">L${num}</div><div class="layer-label">${escapeHtml(l.label)}</div><div class="layer-desc">${escapeHtml(l.desc)}</div></div>`;
  }).join("\n      ");
  return {
    kicker: brief.kicker || "SUBSTRATE · ARCHITECTURE",
    big_title: brief.big_title,
    big_title_html: renderAccentMarkup(brief.big_title),
    subtitle_block: brief.subtitle ? `<div class="subtitle">${escapeHtml(brief.subtitle)}</div>` : "",
    layers_html: layersHtml,
    brand: brief.brand || style.brand,
    author: brief.author || style.author,
    domain: brief.domain || style.domain,
  };
}

function varsForProofFrame(brief, style) {
  const body = (brief.proof_lines || []).map(l => {
    if (l.kind === "prompt") return `<span class="prompt">$ ${escapeHtml(l.text)}</span>`;
    if (l.kind === "success") return `<span class="success">${escapeHtml(l.text)}</span>`;
    if (l.kind === "label") return `<span class="label">${escapeHtml(l.text)}</span>`;
    return `<span class="output">${escapeHtml(l.text)}</span>`;
  }).join("\n");
  return {
    kicker: brief.kicker || "SUBSTRATE · PROOF",
    big_title: brief.big_title,
    big_title_html: renderAccentMarkup(brief.big_title),
    proof_titlebar: brief.proof_titlebar || "terminal",
    proof_body_html: body,
    source_line: brief.source_line || "",
    brand: brief.brand || style.brand,
    author: brief.author || style.author,
    domain: brief.domain || style.domain,
  };
}

function varsForCarouselSlide(brief, style, slide, slideTotal) {
  const role = slide.role || "body";
  const isCta = role === "cta";
  const bodyBlock = slide.body ? `<div class="body-text">${escapeHtml(slide.body)}</div>` : "";
  const ctaBlock = isCta && slide.cta_text ? `<div class="cta-button">${escapeHtml(slide.cta_text)}</div>` : "";
  const swipeHint = (slide.n < slideTotal) ? "SWIPE →" : "END";
  return {
    role_class: role,
    accent_class: brief.accent_color || "cyan",
    kicker: brief.kicker || "SUBSTRATE",
    slide_counter: `${String(slide.n).padStart(2, "0")} / ${String(slideTotal).padStart(2, "0")}`,
    slide_n: slide.n,
    slide_total: slideTotal,
    headline_html: renderAccentMarkup(slide.headline || ""),
    body_block: bodyBlock,
    cta_block: ctaBlock,
    brand: brief.brand || style.brand,
    swipe_hint: swipeHint,
  };
}

const VARS_BUILDER = {
  "idea-card":      varsForIdeaCard,
  "news-card":      varsForNewsCard,
  "stat-hero":      varsForStatHero,
  "quote-card":     varsForQuoteCard,
  "before-after":   varsForBeforeAfter,
  "system-diagram": varsForSystemDiagram,
  "proof-frame":    varsForProofFrame,
};

// ─── Main render ────────────────────────────────────────────────────────
export async function renderVisual({ brief, template = "idea-card" }) {
  if (!brief) return { ok: false, reason: "no_brief" };
  if (!brief.slug) return { ok: false, reason: "no_slug" };

  let style;
  try { style = JSON.parse(readFileSync(STYLE_PATH, "utf-8")); }
  catch (e) { return { ok: false, reason: "style_load_failed", error: e.message }; }

  const briefScan = inspectForEgress(JSON.stringify(brief), "brief.json");
  if (!briefScan.safe) return { ok: false, reason: "egress_blocked_brief", detail: briefScan };

  for (const field of ["big_title", "subtitle", "quote", "context", "headline"]) {
    if (brief[field]) {
      const scan = inspectForSoftClaims(brief[field], style.forbidden_phrases || []);
      if (!scan.safe) return { ok: false, reason: "soft_claim_blocked", field, detail: scan };
    }
  }

  if (template === "carousel-slide" && Array.isArray(brief.slides)) {
    return renderCarousel({ brief, style });
  }

  const tplPath = resolve(TEMPLATES_DIR, `${template}.html`);
  if (!existsSync(tplPath)) return { ok: false, reason: "template_not_found", path: tplPath };
  const tplRaw = readFileSync(tplPath, "utf-8");

  const builder = VARS_BUILDER[template];
  if (!builder) return { ok: false, reason: "no_vars_builder", template };
  const vars = builder(brief, style);
  const html = substitute(tplRaw, vars);

  const htmlScan = inspectForEgress(html, "rendered_html");
  if (!htmlScan.safe) return { ok: false, reason: "egress_blocked_html", detail: htmlScan };

  const outDir = resolve(ASSETS_DIR, brief.slug);
  mkdirSync(outDir, { recursive: true });
  const htmlPath = resolve(outDir, "slide-1.html");
  const pngPath = resolve(outDir, "slide-1.png");
  writeFileSync(htmlPath, html);
  writeFileSync(resolve(outDir, "brief.json"), JSON.stringify(brief, null, 2));

  const dims = TEMPLATE_DIMENSIONS[template] || { w: 1080, h: 1080 };
  let browser = null;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: dims.w, height: dims.h }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto("file://" + htmlPath, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: pngPath, type: "png", clip: { x: 0, y: 0, width: dims.w, height: dims.h } });
    await browser.close();
    browser = null;
  } catch (e) {
    try { if (browser) await browser.close(); } catch {}
    return { ok: false, reason: "render_failed", error: e.message };
  }

  const pngBytes = statSync(pngPath).size;
  const manifest = {
    slug: brief.slug, type: brief.type || template, template, dimensions: dims,
    rendered_at: new Date().toISOString(),
    files: { html: "slide-1.html", png: "slide-1.png", brief: "brief.json" },
    png_bytes: pngBytes, brand: vars.brand, big_title: brief.big_title,
    hard_claims: brief.hard_claims || [], soft_claims: brief.soft_claims || [],
  };
  const manifestScan = inspectForEgress(JSON.stringify(manifest), "manifest");
  if (!manifestScan.safe) return { ok: false, reason: "egress_blocked_manifest", detail: manifestScan };
  writeFileSync(resolve(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  return {
    ok: true, slug: brief.slug, template, dimensions: dims,
    png_path: pngPath.replace(ROOT + "/", ""),
    html_path: htmlPath.replace(ROOT + "/", ""),
    manifest_path: resolve(outDir, "manifest.json").replace(ROOT + "/", ""),
    bytes: pngBytes,
  };
}

async function renderCarousel({ brief, style }) {
  const tplPath = resolve(TEMPLATES_DIR, "carousel-slide.html");
  const tplRaw = readFileSync(tplPath, "utf-8");
  const slides = brief.slides || [];
  if (slides.length < 2) return { ok: false, reason: "carousel_too_few_slides", count: slides.length };

  const dims = { w: 1080, h: 1350 };
  const outDir = resolve(ASSETS_DIR, brief.slug);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "brief.json"), JSON.stringify(brief, null, 2));

  const slidePaths = [];
  let browser = null;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    for (const slide of slides) {
      const vars = varsForCarouselSlide(brief, style, slide, slides.length);
      const html = substitute(tplRaw, vars);
      const htmlScan = inspectForEgress(html, `carousel_slide_${slide.n}`);
      if (!htmlScan.safe) { await browser.close(); return { ok: false, reason: "egress_blocked_html", slide: slide.n, detail: htmlScan }; }
      const htmlPath = resolve(outDir, `slide-${slide.n}.html`);
      const pngPath = resolve(outDir, `slide-${slide.n}.png`);
      writeFileSync(htmlPath, html);
      const ctx = await browser.newContext({ viewport: { width: dims.w, height: dims.h }, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      await page.goto("file://" + htmlPath, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: pngPath, type: "png", clip: { x: 0, y: 0, width: dims.w, height: dims.h } });
      await ctx.close();
      slidePaths.push({ n: slide.n, role: slide.role, png: pngPath.replace(ROOT + "/", ""), html: htmlPath.replace(ROOT + "/", "") });
    }
    await browser.close();
  } catch (e) {
    try { if (browser) await browser.close(); } catch {}
    return { ok: false, reason: "carousel_render_failed", error: e.message };
  }

  const manifest = {
    slug: brief.slug, type: "carousel", template: "carousel-slide",
    slide_count: slidePaths.length, dimensions: dims,
    rendered_at: new Date().toISOString(), slides: slidePaths,
    big_title: brief.big_title, hard_claims: brief.hard_claims || [], soft_claims: brief.soft_claims || [],
  };
  writeFileSync(resolve(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  let totalBytes = 0;
  for (const s of slidePaths) { try { totalBytes += statSync(resolve(ROOT, s.png)).size; } catch {} }

  return {
    ok: true, slug: brief.slug, template: "carousel-slide", is_carousel: true,
    slide_count: slidePaths.length, slides: slidePaths,
    manifest_path: resolve(outDir, "manifest.json").replace(ROOT + "/", ""),
    bytes: totalBytes,
    png_path: slidePaths[0]?.png,
  };
}

// CLI: render test brief for any template
if (import.meta.url === `file://${process.argv[1]}`) {
  const template = process.argv[2] || "stat-hero";
  const testBriefs = {
    "stat-hero": {
      slug: `test-${template}-${Date.now()}`, type: "stat-hero", accent_color: "cyan",
      kicker: "SUBSTRATE · NUMBERS",
      stat_value: "$0", stat_unit: "revenue in 30 days",
      context: "Built 420 modules. Made [em]nothing[/em]. Here is what changed.",
    },
    "quote-card": {
      slug: `test-${template}-${Date.now()}`, type: "quote-card", accent_color: "cyan",
      kicker: "SUBSTRATE · PRINCIPLE",
      quote: "An AI agent without a verification layer is a [em]confident hallucinator[/em], not an employee.",
      attribution: "Kirill D. · Substrate",
    },
    "before-after": {
      slug: `test-${template}-${Date.now()}`, type: "before-after",
      kicker: "SUBSTRATE · TRANSFORMATION",
      big_title: "Manual chaos → Disciplined [accent]Substrate[/accent]",
      before_label: "BEFORE", before_title: "Manual ops",
      before_items: ["Forgotten follow-ups", "No memory between sessions", "Claims without proof", "Telegram spam every hour"],
      after_label: "AFTER", after_title: "Substrate-led",
      after_items: ["ISA-gated transitions", "591 persistent beliefs", "Verification doctrine enforced", "Drafts-only Telegram"],
    },
    "system-diagram": {
      slug: `test-${template}-${Date.now()}`, type: "system-diagram",
      kicker: "SUBSTRATE · ARCHITECTURE",
      big_title: "Five-layer [accent]substrate[/accent]",
      subtitle: "Each layer has one job. Failures stay local.",
      layers: [
        { label: "Voice (Tolik)", desc: "Operator interface · 49 tools · 23 modules" },
        { label: "Discipline", desc: "ISA gates · egress · verification doctrine" },
        { label: "Brain (Cortex)", desc: "591 beliefs · 912 outcomes · 162 modules", highlight: true },
        { label: "Hands (Factory)", desc: "138 bots · scout · content · sales · awareness" },
        { label: "Storage", desc: "5 active SQLite · 137 memory files" },
      ],
    },
    "proof-frame": {
      slug: `test-${template}-${Date.now()}`, type: "proof-frame",
      kicker: "SUBSTRATE · PROOF",
      big_title: "Substrate refuses to close an opp [accent]without proof[/accent]",
      proof_titlebar: "node scripts/survival/opportunity-store.mjs",
      proof_lines: [
        { kind: "prompt", text: "transition('opp-australia', 'done')" },
        { kind: "output", text: "" },
        { kind: "label", text: "ISA Gate response:" },
        { kind: "output", text: "Error: isa_gate_blocked" },
        { kind: "output", text: "  reason: '9/9 criterion ISCs still pending'" },
        { kind: "output", text: "  pending: ['ISC-1','ISC-2','ISC-3', ...]" },
        { kind: "success", text: "" },
        { kind: "success", text: "State NOT changed. Discipline holds." },
      ],
      source_line: "Source: substrate live run, 2026-05-13",
    },
    "news-card": {
      slug: `test-${template}-${Date.now()}`, type: "news-card", accent_color: "red",
      kicker: "CANADA · BDC LIFT",
      timestamp_text: "AS OF 24 APR 2026",
      deadline_framing: "ROLLING INTAKE · NO CUTOFF",
      primary_number: "$500M", primary_number_context: "AI ADOPTION FUND · 2.25% RATE",
      big_title: "BDC launches [accent]LIFT[/accent] — Canadian SMBs can finance AI adoption at 2.25%",
      source_line: "Source: BDC announcement, 2026-04-24",
    },
  };
  const b = testBriefs[template];
  if (!b) { console.error(`unknown template: ${template}`); process.exit(2); }
  renderVisual({ brief: b, template }).then(r => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  });
}
