/**
 * AWARENESS RESEARCH - Deep evidence gathering before applying any item
 *
 * For each awareness item, before deciding if it is safe to apply:
 * 1. Fetch full source URL content
 * 2. Fetch community feedback (HN comments, Reddit comments, GitHub issues)
 * 3. Check version/compatibility
 * 4. Identify SPECIFIC file changes needed
 * 5. Classify risk based on evidence, not just keywords
 * 6. Produce research report with citations
 *
 * Output: .data/awareness/research/<item_id>.md
 *
 * This is the missing layer between "flagged" and "applied".
 */

import Database from "better-sqlite3";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../../.data/linkedin-brand-os.sqlite");
const ENV_PATH = resolve(__dirname, "../../apps/api/.env");
const RESEARCH_DIR = resolve(__dirname, "../../.data/awareness/research");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

// ═══════════════════════════════════════════════════════════════════════════
// FETCHERS
// ═══════════════════════════════════════════════════════════════════════════

async function fetchReddit(url) {
  // Convert to JSON API
  let jsonUrl = url.replace("reddit.com", "old.reddit.com");
  if (!jsonUrl.endsWith(".json")) {
    jsonUrl = jsonUrl.replace(/\/$/, "") + ".json";
  }
  try {
    const r = await fetch(jsonUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; research-bot/1.0)" },
      signal: AbortSignal.timeout(20000)
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    const data = await r.json();
    const post = data[0]?.data?.children?.[0]?.data;
    if (!post) return { ok: false, error: "no post data" };

    const comments = (data[1]?.data?.children || [])
      .filter(c => c.kind === "t1")
      .map(c => ({
        author: c.data.author,
        body: (c.data.body || "").slice(0, 1500),
        score: c.data.score || 0,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    return {
      ok: true,
      post: {
        title: post.title,
        selftext: post.selftext || "",
        score: post.score,
        comments_count: post.num_comments,
        created: new Date(post.created_utc * 1000).toISOString(),
      },
      comments
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function fetchWebPage(url) {
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(20000)
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    const html = await r.text();

    // Rough content extraction - strip scripts/styles/nav
    let content = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "");

    // Extract title
    const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "";

    // Extract main text content
    const textOnly = content
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 6000);

    return { ok: true, title, content: textOnly };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function fetchHNComments(hnUrl) {
  const idMatch = hnUrl.match(/item\?id=(\d+)/);
  if (!idMatch) return { ok: false, error: "not an HN item URL" };
  const id = idMatch[1];
  try {
    const itemRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
    const item = await itemRes.json();
    if (!item) return { ok: false, error: "item not found" };

    const commentIds = (item.kids || []).slice(0, 15);
    const comments = [];
    for (const cid of commentIds) {
      try {
        const c = await (await fetch(`https://hacker-news.firebaseio.com/v0/item/${cid}.json`)).json();
        if (c && c.text && !c.deleted) {
          comments.push({
            author: c.by,
            body: c.text.replace(/<[^>]+>/g, "").slice(0, 1000),
            score: c.score || 0
          });
        }
      } catch {}
    }
    return {
      ok: true,
      post: {
        title: item.title,
        score: item.score,
        comments_count: item.descendants
      },
      comments
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EVIDENCE-BASED RISK ANALYSIS via Claude CLI
// ═══════════════════════════════════════════════════════════════════════════

import { execSync } from "child_process";

async function analyzeWithClaude(item, researchData) {
  const prompt = `You are the Safety Reviewer for Kirill's AI revenue system.

CURRENT SYSTEM:
- Node.js orchestrator using Claude CLI + OpenAI API
- 10 active bots: scout, outreach, reddit-monitor, sales, research, linkedin-hunter, analytics, telegram-control, orchestrator-loop, awareness-bot
- Tech stack: Node.js 22, SQLite, nodemailer, Reddit API, cron
- OpenAI models: gpt-4o, gpt-4o-mini
- 12 learning packs + swarm alignment package
- Git initialized today as safety net
- Zero revenue, 0 meaningful replies yet
- System is LIVE in production (running bots in cron)

ITEM TO EVALUATE:
Title: ${item.title}
Category: ${item.category}
URL: ${item.url}
Why it matters: ${item.why_matters}
Action target: ${item.action_target}
Action type: ${item.action_type}

RESEARCH DATA COLLECTED:
${JSON.stringify(researchData).slice(0, 6000)}

YOUR JOB:
Analyze the evidence and return a JSON report. Be honest about uncertainty.

Return JSON:
{
  "actual_risk_level": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "risk_reasoning": "one paragraph explaining what you see in the evidence",
  "what_would_change": "specific files/configs/prompts that would need to change (be concrete)",
  "what_could_break": ["specific failure modes"],
  "evidence_for_safety": ["proof from research that this works"],
  "evidence_against_safety": ["warnings/issues/negative comments found"],
  "compatibility_check": "is this compatible with our Node 22 + Claude CLI + cron setup?",
  "required_version": "any version requirements mentioned",
  "test_plan": "how to test this safely in isolation",
  "recommendation": "APPLY_SAFELY" | "APPLY_WITH_CAUTION" | "RESEARCH_MORE" | "DO_NOT_APPLY" | "MANUAL_PLAN_REQUIRED",
  "confidence_in_recommendation": "high" | "medium" | "low",
  "kirill_decision_factors": ["specific things Kirill needs to know to decide"]
}

CRITICAL RULES:
- Use only short hyphens (-), never em dashes
- If research_data is empty or error, recommend RESEARCH_MORE
- If community feedback shows broken/regressions, recommend DO_NOT_APPLY
- If it involves API migration, always MANUAL_PLAN_REQUIRED
- If it is just documentation/rule, can be APPLY_SAFELY
- Be honest about what you do not know`;

  const tmpFile = resolve(RESEARCH_DIR, ".tmp-research-prompt.txt");
  if (!existsSync(RESEARCH_DIR)) mkdirSync(RESEARCH_DIR, { recursive: true });
  writeFileSync(tmpFile, prompt);

  try {
    const claudeBin = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
    // Boris Charny adaptive thinking flaw workaround (April 7 2026)
    const output = execSync(
      `cat "${tmpFile}" | ${claudeBin} -p --output-format text --max-turns 1 2>&1`,
      {
        encoding: "utf-8",
        timeout: 180000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: "1" },
      }
    );

    const jsonMatch = output.match(/\{[\s\S]*"recommendation"[\s\S]*\}/);
    if (!jsonMatch) {
      return { error: "No JSON in Claude response", raw: output.slice(0, 500) };
    }
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    return { error: e.message.slice(0, 500) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN RESEARCH PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

async function researchItem(item) {
  console.log(`\n[Research] ${item.title.slice(0, 60)}...`);
  const evidence = { source: null, comments: null, page: null };

  // Fetch primary source based on URL type
  if (item.url.includes("reddit.com")) {
    const reddit = await fetchReddit(item.url);
    evidence.source = reddit;
    if (reddit.ok) {
      console.log(`  Reddit post: ${reddit.post.title.slice(0, 60)}`);
      console.log(`  Comments: ${reddit.comments.length}`);
    } else {
      console.log(`  Reddit fetch failed: ${reddit.error}`);
    }
  } else if (item.url.includes("news.ycombinator.com")) {
    const hn = await fetchHNComments(item.url);
    evidence.source = hn;
  } else {
    const page = await fetchWebPage(item.url);
    evidence.page = page;
    if (page.ok) {
      console.log(`  Page fetched: ${page.content.length} chars`);
    } else {
      console.log(`  Page fetch failed: ${page.error}`);
    }
  }

  // Analyze with Claude
  console.log(`  Analyzing with Claude...`);
  const analysis = await analyzeWithClaude(item, evidence);

  return { item, evidence, analysis };
}

function formatResearchReport(result) {
  const { item, analysis } = result;
  if (analysis.error) {
    return `# Research Failed: ${item.title}\n\nError: ${analysis.error}\n`;
  }

  let md = `# Research Report: ${item.title}\n\n`;
  md += `**URL:** ${item.url}\n`;
  md += `**Original Score:** ${item.score}/20\n`;
  md += `**Category:** ${item.category}\n\n`;
  md += `## Actual Risk: ${analysis.actual_risk_level}\n\n`;
  md += `${analysis.risk_reasoning}\n\n`;
  md += `## What Would Change\n${analysis.what_would_change}\n\n`;

  if (analysis.what_could_break?.length) {
    md += `## What Could Break\n`;
    for (const r of analysis.what_could_break) md += `- ${r}\n`;
    md += `\n`;
  }

  if (analysis.evidence_for_safety?.length) {
    md += `## Evidence For Safety\n`;
    for (const e of analysis.evidence_for_safety) md += `- ${e}\n`;
    md += `\n`;
  }

  if (analysis.evidence_against_safety?.length) {
    md += `## Evidence Against Safety\n`;
    for (const e of analysis.evidence_against_safety) md += `- ${e}\n`;
    md += `\n`;
  }

  md += `## Compatibility\n${analysis.compatibility_check}\n`;
  if (analysis.required_version) md += `**Required version:** ${analysis.required_version}\n`;
  md += `\n## Test Plan\n${analysis.test_plan}\n\n`;
  md += `## Recommendation: ${analysis.recommendation}\n`;
  md += `**Confidence:** ${analysis.confidence_in_recommendation}\n\n`;

  if (analysis.kirill_decision_factors?.length) {
    md += `## What Kirill Needs to Decide\n`;
    for (const f of analysis.kirill_decision_factors) md += `- ${f}\n`;
  }

  return md;
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════

if (process.argv[1] && process.argv[1].endsWith("awareness-research.mjs")) {
  const db = new Database(DB_PATH);
  const cmd = process.argv[2] || "research_all";

  if (!existsSync(RESEARCH_DIR)) mkdirSync(RESEARCH_DIR, { recursive: true });

  if (cmd === "research_all") {
    // Research all items not yet researched
    const items = db.prepare(`
      SELECT * FROM awareness_items
      WHERE status IN ('new', 'apply_now', 'later')
      ORDER BY score DESC
    `).all();

    console.log(`[Research] ${items.length} items to analyze`);

    const results = [];
    for (const item of items) {
      const reportFile = resolve(RESEARCH_DIR, `${item.id}.md`);
      if (existsSync(reportFile)) {
        console.log(`  Skip (already researched): ${item.title.slice(0, 50)}`);
        continue;
      }

      const result = await researchItem(item);
      const report = formatResearchReport(result);
      writeFileSync(reportFile, report);

      // Update DB with analysis
      if (result.analysis && !result.analysis.error) {
        db.prepare(`
          CREATE TABLE IF NOT EXISTS awareness_research (
            item_id TEXT PRIMARY KEY,
            actual_risk TEXT,
            recommendation TEXT,
            confidence TEXT,
            report_path TEXT,
            created_at TEXT NOT NULL
          )
        `).run();
        db.prepare(`
          INSERT OR REPLACE INTO awareness_research
          (item_id, actual_risk, recommendation, confidence, report_path, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          item.id,
          result.analysis.actual_risk_level,
          result.analysis.recommendation,
          result.analysis.confidence_in_recommendation,
          reportFile,
          new Date().toISOString()
        );
      }

      results.push({ item, analysis: result.analysis });
      await new Promise(r => setTimeout(r, 2000));
    }

    console.log(`\n[Research] Done. Reports in ${RESEARCH_DIR}`);
    console.log(`\n=== SUMMARY ===`);
    const byRec = {};
    for (const r of results) {
      const rec = r.analysis?.recommendation || "ERROR";
      byRec[rec] = (byRec[rec] || 0) + 1;
    }
    for (const [rec, count] of Object.entries(byRec)) {
      console.log(`  ${rec}: ${count}`);
    }
  }

  if (cmd === "research_apply_now") {
    // Closes the apply_now dead end. Auto-research only items flagged as apply_now
    // that don't yet have a report on disk. Idempotent — safe to run on cron.
    const items = db.prepare(`
      SELECT * FROM awareness_items
      WHERE status = 'apply_now'
      ORDER BY score DESC
    `).all();

    let processed = 0, skipped = 0, errors = 0;
    for (const item of items) {
      const reportFile = resolve(RESEARCH_DIR, `${item.id}.md`);
      if (existsSync(reportFile)) { skipped++; continue; }

      console.log(`[auto-research] processing apply_now item: ${item.title.slice(0, 60)}`);
      try {
        const result = await researchItem(item);
        const report = formatResearchReport(result);
        writeFileSync(reportFile, report);

        if (result.analysis && !result.analysis.error) {
          db.prepare(`
            CREATE TABLE IF NOT EXISTS awareness_research (
              item_id TEXT PRIMARY KEY,
              actual_risk TEXT,
              recommendation TEXT,
              confidence TEXT,
              report_path TEXT,
              created_at TEXT NOT NULL
            )
          `).run();
          db.prepare(`
            INSERT OR REPLACE INTO awareness_research
            (item_id, actual_risk, recommendation, confidence, report_path, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            item.id,
            result.analysis.actual_risk_level,
            result.analysis.recommendation,
            result.analysis.confidence_in_recommendation,
            reportFile,
            new Date().toISOString()
          );
        }
        processed++;
      } catch (e) {
        console.error(`[auto-research] failed on ${item.id}: ${e.message}`);
        errors++;
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    console.log(`[auto-research] processed=${processed} skipped=${skipped} errors=${errors} total_apply_now=${items.length}`);
  }

  if (cmd === "summary") {
    const rows = db.prepare(`
      SELECT a.title, a.score, r.actual_risk, r.recommendation, r.confidence
      FROM awareness_items a
      LEFT JOIN awareness_research r ON r.item_id = a.id
      ORDER BY
        CASE r.recommendation
          WHEN 'APPLY_SAFELY' THEN 1
          WHEN 'APPLY_WITH_CAUTION' THEN 2
          WHEN 'RESEARCH_MORE' THEN 3
          WHEN 'MANUAL_PLAN_REQUIRED' THEN 4
          WHEN 'DO_NOT_APPLY' THEN 5
          ELSE 6
        END,
        a.score DESC
    `).all();

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("AWARENESS ITEMS - EVIDENCE-BASED RECOMMENDATIONS");
    console.log("═══════════════════════════════════════════════════════════\n");

    for (const row of rows) {
      const rec = row.recommendation || "NOT_RESEARCHED";
      const risk = row.actual_risk || "?";
      const conf = row.confidence || "?";
      const emoji = {
        APPLY_SAFELY: "🟢",
        APPLY_WITH_CAUTION: "🟡",
        RESEARCH_MORE: "🔵",
        MANUAL_PLAN_REQUIRED: "🟠",
        DO_NOT_APPLY: "🔴",
        NOT_RESEARCHED: "⚪"
      }[rec] || "⚫";
      console.log(`${emoji} [${row.score}/20] ${row.title.slice(0, 70)}`);
      console.log(`   Risk: ${risk} | Rec: ${rec} | Confidence: ${conf}`);
      console.log();
    }
  }

  db.close();
}
