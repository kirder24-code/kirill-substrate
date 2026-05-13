/**
 * publish-insight.mjs
 *
 * Takes an approved draft from sandbox-review/site/insights/drafts/<slug>.md,
 * renders it to HTML using the same dark theme as the main site, regenerates
 * the insights index page, and deploys via vercel.
 *
 * Built April 7 2026. Called by telegram-control insight_approve handler.
 *
 * Usage: node scripts/factory/publish-insight.mjs <slug>
 */
import { readFileSync, writeFileSync, readdirSync, renameSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const SITE = resolve(ROOT, "sandbox-review/site");
const INSIGHTS = resolve(SITE, "insights");
const DRAFTS = resolve(INSIGHTS, "drafts");
const PUBLISHED = resolve(INSIGHTS, "published");
if (!existsSync(PUBLISHED)) mkdirSync(PUBLISHED, { recursive: true });

const slug = process.argv[2];
if (!slug) { console.error("usage: publish-insight.mjs <slug>"); process.exit(1); }

const draftPath = resolve(DRAFTS, `${slug}.md`);
if (!existsSync(draftPath)) { console.error(`draft not found: ${draftPath}`); process.exit(1); }

const md = readFileSync(draftPath, "utf-8");

// Parse frontmatter
const fmMatch = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
if (!fmMatch) { console.error("draft missing frontmatter"); process.exit(1); }
const fm = Object.fromEntries(fmMatch[1].split("\n").map(l => {
  const i = l.indexOf(":");
  return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
}));
const body = fmMatch[2];

// Tiny markdown to HTML (only what we need)
function mdToHtml(s) {
  // Remove frontmatter if any (defensive)
  s = s.replace(/^---[\s\S]*?---\n/, "");
  // Headings
  s = s.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  s = s.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  s = s.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  // Horizontal rules
  s = s.replace(/^---$/gm, "<hr>");
  // Bold
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic
  s = s.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, "<em>$1</em>");
  // Links
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // Inline code
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Email
  s = s.replace(/(kirill@launchsoloai\.com)/g, '<a href="mailto:$1">$1</a>');
  // Paragraphs (split on blank lines)
  const blocks = s.split(/\n\n+/).map(b => {
    b = b.trim();
    if (!b) return "";
    if (b.startsWith("<h") || b.startsWith("<hr")) return b;
    return `<p>${b.replace(/\n/g, " ")}</p>`;
  });
  return blocks.join("\n");
}

const headlineMatch = body.match(/^# (.+)$/m);
const headline = headlineMatch ? headlineMatch[1] : fm.title || "Untitled";
const date = fm.date || new Date().toISOString().slice(0, 10);

// Build the post HTML using same theme as main site
const postHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${headline} - launchsoloai insights</title>
<meta name="description" content="${headline}. Insights from launchsoloai.com - written by Kirill, solo AI/automation consultant in Calgary.">
<meta property="og:title" content="${headline}">
<meta property="og:type" content="article">
<meta property="og:url" content="https://launchsoloai.com/insights/${slug}.html">
<meta name="author" content="Kirill D.">
<link rel="canonical" href="https://launchsoloai.com/insights/${slug}.html">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<script defer src="/_vercel/insights/script.js"></script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "${headline.replace(/"/g, '\\"')}",
  "datePublished": "${date}",
  "author": {
    "@type": "Person",
    "name": "Kirill D.",
    "url": "https://launchsoloai.com",
    "sameAs": "https://www.linkedin.com/in/kirill-derhachenko-138059240"
  },
  "publisher": {
    "@type": "Organization",
    "name": "launchsoloai",
    "url": "https://launchsoloai.com"
  },
  "mainEntityOfPage": "https://launchsoloai.com/insights/${slug}.html"
}
</script>
<style>
  :root {
    --bg: #0a0a0a; --bg-card: #131313; --bg-soft: #1a1a1a;
    --line: #262626; --line-soft: #1f1f1f;
    --ink: #f5f5f5; --ink-soft: #a3a3a3; --ink-mute: #666666;
    --accent: #ff6b35; --accent-soft: rgba(255, 107, 53, 0.1);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { font-size: 17px; scroll-behavior: smooth; }
  body {
    font-family: 'Inter', -apple-system, sans-serif;
    background: var(--bg); color: var(--ink);
    line-height: 1.7; -webkit-font-smoothing: antialiased;
  }
  .topbar {
    border-bottom: 1px solid var(--line-soft); padding: 18px 0;
    position: sticky; top: 0;
    background: rgba(10, 10, 10, 0.85);
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    z-index: 100;
  }
  .topbar-inner {
    max-width: 760px; margin: 0 auto; padding: 0 24px;
    display: flex; justify-content: space-between; align-items: center;
  }
  .brand {
    font-family: 'JetBrains Mono', monospace; font-weight: 600;
    font-size: 0.95rem; color: var(--ink); text-decoration: none;
  }
  .brand span { color: var(--accent); }
  .topbar nav a {
    color: var(--ink-soft); text-decoration: none;
    font-size: 0.9rem; font-weight: 500; margin-left: 24px;
  }
  .topbar nav a:hover { color: var(--ink); }
  article {
    max-width: 680px; margin: 0 auto; padding: 70px 24px 60px;
  }
  .meta {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.78rem; color: var(--accent);
    text-transform: uppercase; letter-spacing: 0.1em;
    margin-bottom: 18px;
  }
  h1 {
    font-size: clamp(1.9rem, 5vw, 2.8rem);
    line-height: 1.2; font-weight: 700;
    letter-spacing: -0.025em; margin-bottom: 28px;
  }
  h2 {
    font-size: 1.4rem; font-weight: 600;
    margin: 38px 0 14px;
    letter-spacing: -0.015em; color: var(--ink);
  }
  p { margin-bottom: 20px; color: var(--ink-soft); font-size: 1.02rem; }
  p strong { color: var(--ink); }
  hr {
    border: none; height: 1px; background: var(--line);
    margin: 38px 0;
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  code {
    font-family: 'JetBrains Mono', monospace;
    background: var(--bg-card); border: 1px solid var(--line);
    padding: 2px 6px; border-radius: 4px; font-size: 0.9em;
  }
  .related {
    background: var(--bg-card); border: 1px solid var(--line);
    border-radius: 12px; padding: 28px 30px;
    margin-top: 50px;
  }
  .related h3 {
    font-size: 1rem; font-weight: 600;
    color: var(--ink); margin-bottom: 14px;
    letter-spacing: -0.01em;
    display: flex; align-items: center; gap: 10px;
  }
  .related h3::before {
    content: ''; width: 24px; height: 1px; background: var(--accent);
  }
  .related-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px; margin-top: 16px;
  }
  .related-link {
    display: block; padding: 14px 16px;
    background: var(--bg); border: 1px solid var(--line);
    border-radius: 8px; text-decoration: none;
    transition: all 0.15s;
  }
  .related-link:hover {
    border-color: var(--accent); transform: translateY(-1px);
  }
  .related-link strong {
    display: block; color: var(--ink);
    font-size: 0.92rem; font-weight: 600;
    margin-bottom: 4px;
  }
  .related-link span {
    color: var(--ink-mute); font-size: 0.8rem;
    font-family: 'JetBrains Mono', monospace;
  }
  .back {
    display: inline-block; margin-top: 30px;
    font-family: 'JetBrains Mono', monospace; font-size: 0.85rem;
    color: var(--ink-mute); text-decoration: none;
  }
  .back:hover { color: var(--accent); }
  footer {
    border-top: 1px solid var(--line-soft); padding: 40px 0;
    text-align: center; margin-top: 60px;
  }
  footer p {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.78rem; color: var(--ink-mute); max-width: none;
  }
</style>
</head>
<body>
<header class="topbar">
  <div class="topbar-inner">
    <a href="/" class="brand">launchsolo<span>.</span>ai</a>
    <nav>
      <a href="/">Home</a>
      <a href="/insights/">Insights</a>
    </nav>
  </div>
</header>
<article>
  <div class="meta">${date} · Insight</div>
  ${mdToHtml(body)}

  <div class="related">
    <h3>If this matched your situation</h3>
    <p style="color: var(--ink-soft); font-size: 0.92rem; margin-top: 6px;">These are the productized engagements I run. Same fixed-scope, same async only, same audit-before-payment terms.</p>
    <div class="related-grid">
      <a href="/#offers" class="related-link">
        <strong>Vibe-Code Audit</strong>
        <span>$1,500-2,500 CAD · 1 week</span>
      </a>
      <a href="/#offers" class="related-link">
        <strong>Reply Chaser Automation</strong>
        <span>$1,500 CAD · 1 week</span>
      </a>
      <a href="/#offers" class="related-link">
        <strong>First 10 Customers</strong>
        <span>$2,000 CAD · 1 week</span>
      </a>
      <a href="/#offers" class="related-link">
        <strong>Custom AI / n8n</strong>
        <span>$2,500-8,000 CAD</span>
      </a>
    </div>
  </div>

  <a href="/insights/" class="back">← All insights</a>
</article>
<footer><p>kirill@launchsoloai.com · Calgary · No tracking · No frameworks</p></footer>
</body>
</html>`;

// Write the post HTML
const postHtmlPath = resolve(INSIGHTS, `${slug}.html`);
writeFileSync(postHtmlPath, postHtml);
console.log(`[publish] wrote ${postHtmlPath}`);

// Move draft to published/
renameSync(draftPath, resolve(PUBLISHED, `${slug}.md`));
console.log(`[publish] moved draft to published/`);

// Regenerate insights index page
const allPublished = readdirSync(PUBLISHED).filter(f => f.endsWith(".md")).map(f => {
  const c = readFileSync(resolve(PUBLISHED, f), "utf-8");
  const fmm = c.match(/^---\n([\s\S]*?)\n---/);
  const meta = fmm ? Object.fromEntries(fmm[1].split("\n").map(l => { const i = l.indexOf(":"); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })) : {};
  const titleMatch = c.match(/^# (.+)$/m);
  const bodyExcerpt = c.replace(/^---[\s\S]*?---\n/, "").replace(/^# .+$/m, "").trim().slice(0, 220);
  return {
    slug: f.replace(/\.md$/, ""),
    title: titleMatch ? titleMatch[1] : meta.title || "Untitled",
    date: meta.date || "",
    excerpt: bodyExcerpt.replace(/[#*]/g, "").trim() + "...",
  };
}).sort((a, b) => (b.date || "").localeCompare(a.date || ""));

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Insights - launchsoloai</title>
<meta name="description" content="Field notes from a solo automation consultant. Patterns I see in the wild, what usually breaks, what to actually do about it.">
<meta property="og:title" content="Insights - launchsoloai">
<link rel="canonical" href="https://launchsoloai.com/insights/">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<script defer src="/_vercel/insights/script.js"></script>
<style>
  :root {
    --bg: #0a0a0a; --bg-card: #131313;
    --line: #262626; --line-soft: #1f1f1f;
    --ink: #f5f5f5; --ink-soft: #a3a3a3; --ink-mute: #666666;
    --accent: #ff6b35;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { font-size: 17px; }
  body {
    font-family: 'Inter', sans-serif; background: var(--bg);
    color: var(--ink); line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .topbar {
    border-bottom: 1px solid var(--line-soft); padding: 18px 0;
    position: sticky; top: 0; z-index: 100;
    background: rgba(10, 10, 10, 0.85);
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  }
  .topbar-inner {
    max-width: 760px; margin: 0 auto; padding: 0 24px;
    display: flex; justify-content: space-between; align-items: center;
  }
  .brand {
    font-family: 'JetBrains Mono', monospace; font-weight: 600;
    font-size: 0.95rem; color: var(--ink); text-decoration: none;
  }
  .brand span { color: var(--accent); }
  .topbar nav a {
    color: var(--ink-soft); text-decoration: none;
    font-size: 0.9rem; font-weight: 500; margin-left: 24px;
  }
  main { max-width: 760px; margin: 0 auto; padding: 70px 24px 60px; }
  .label {
    font-family: 'JetBrains Mono', monospace; font-size: 0.78rem;
    color: var(--accent); text-transform: uppercase;
    letter-spacing: 0.1em; margin-bottom: 14px;
    display: flex; align-items: center; gap: 10px;
  }
  .label::before { content: ''; width: 24px; height: 1px; background: var(--accent); }
  h1 {
    font-size: clamp(2rem, 5vw, 2.8rem);
    line-height: 1.15; font-weight: 700;
    letter-spacing: -0.025em; margin-bottom: 18px;
    max-width: 22ch;
  }
  .lead {
    font-size: 1.08rem; color: var(--ink-soft);
    max-width: 56ch; margin-bottom: 50px;
  }
  .post-list { display: flex; flex-direction: column; gap: 16px; }
  .post {
    background: var(--bg-card); border: 1px solid var(--line);
    border-radius: 12px; padding: 26px 28px;
    text-decoration: none; color: var(--ink);
    transition: all 0.2s; display: block;
  }
  .post:hover {
    border-color: var(--accent); transform: translateY(-2px);
  }
  .post-date {
    font-family: 'JetBrains Mono', monospace; font-size: 0.78rem;
    color: var(--ink-mute); margin-bottom: 8px;
  }
  .post h2 {
    font-size: 1.2rem; font-weight: 600;
    margin-bottom: 10px; letter-spacing: -0.01em;
  }
  .post p {
    color: var(--ink-soft); font-size: 0.92rem;
    line-height: 1.55; margin: 0;
  }
  footer {
    border-top: 1px solid var(--line-soft);
    padding: 40px 0; text-align: center; margin-top: 60px;
  }
  footer p {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.78rem; color: var(--ink-mute);
  }
</style>
</head>
<body>
<header class="topbar">
  <div class="topbar-inner">
    <a href="/" class="brand">launchsolo<span>.</span>ai</a>
    <nav>
      <a href="/">Home</a>
      <a href="/insights/">Insights</a>
    </nav>
  </div>
</header>
<main>
  <div class="label">Insights</div>
  <h1>Field notes from the wild.</h1>
  <p class="lead">Patterns I keep seeing in service businesses and post-launch SaaS. What is happening, why it matters, and one thing to actually do about it. Written by Kirill, updated as the patterns appear. <a href="/" style="color: var(--accent);">See what I do →</a></p>
  <div class="post-list">
    ${allPublished.map(p => `
    <a href="/insights/${p.slug}.html" class="post">
      <div class="post-date">${p.date}</div>
      <h2>${p.title}</h2>
      <p>${p.excerpt}</p>
    </a>`).join("")}
  </div>
</main>
<footer><p>kirill@launchsoloai.com · Calgary · No tracking · No frameworks</p></footer>
</body>
</html>`;

writeFileSync(resolve(INSIGHTS, "index.html"), indexHtml);
console.log(`[publish] regenerated insights/index.html with ${allPublished.length} posts`);

// Update sitemap
const sitemapPath = resolve(SITE, "sitemap.xml");
const today = new Date().toISOString().slice(0, 10);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://launchsoloai.com/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://launchsoloai.com/insights/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>https://launchsoloai.com/faq.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.85</priority>
  </url>
${allPublished.map(p => `  <url>
    <loc>https://launchsoloai.com/insights/${p.slug}.html</loc>
    <lastmod>${p.date || today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`).join("\n")}
</urlset>`;
writeFileSync(sitemapPath, sitemap);
console.log(`[publish] updated sitemap.xml with ${allPublished.length} insight URLs`);

// Deploy via vercel
console.log(`[publish] deploying to Vercel...`);
const deploy = spawnSync("bash", ["-c", `cd "${SITE}" && $HOME/.nvm/versions/node/v22.22.2/bin/vercel --prod --yes 2>&1 | tail -5`], { encoding: "utf-8", timeout: 5 * 60 * 1000 });
console.log(deploy.stdout || deploy.stderr || "no output");
console.log(`[publish] done. Live at https://launchsoloai.com/insights/${slug}.html`);
