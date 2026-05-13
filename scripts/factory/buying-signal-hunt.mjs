/**
 * buying-signal-hunt.mjs
 *
 * End-to-end Reddit prospect discovery pipeline. Replaces /tmp/hunt_*.mjs scripts.
 *
 * Pipeline:
 *   1. Pull top posts from buyer-rich subs (week + month windows)
 *   2. For each post: walk comment thread, regex-match buying signals
 *   3. For each unique signal author: insert as lead (stage='new')
 *   4. Run lead-enrichment-bot on each new lead (Sonnet 4.6 multi-tool agent)
 *   5. Output JSON of enriched leads ready for dispatch-reddit-drafts
 *
 * Run:
 *   node scripts/factory/buying-signal-hunt.mjs           - full hunt
 *   node scripts/factory/buying-signal-hunt.mjs --dry     - hunt without enrichment (faster)
 *
 * Cron candidate: every 4h. But: anonymous Reddit limit makes this fragile.
 * Defer cron until Reddit OAuth is set up.
 */
import Database from "better-sqlite3";
import { spawnSync } from "child_process";
import { writeFileSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { readPurpose, appendLog } from "../../wiki/reader.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const db = new Database(resolve(ROOT, ".data/linkedin-brand-os.sqlite"));
const env = Object.fromEntries(
  readFileSync(resolve(ROOT, "apps/api/.env"), "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const TG = env.TELEGRAM_BOT_TOKEN, CHAT = env.TELEGRAM_CHAT_ID;
const UA = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36";

const SUBS = ["SaaS", "startups", "Entrepreneur", "smallbusiness", "freelance", "consulting", "indiebiz", "EntrepreneurRideAlong", "vibecoding", "buildinpublic", "microsaas", "nocode",
  // Chain / franchise / multi-location business verticals (Apr 28 2026)
  "franchising", "franchise", "restaurantowners", "PropertyManagement",
];
const WINDOWS = [["week", 10], ["month", 30]];

// ── Signal detection: broad pain + intent matching ──────────────────
// Old regex was too narrow (19 DM-request phrases only). Now matches
// actual business pain and buying intent that Kirill's ICP expresses.
const SIGNAL_PATTERNS = [
  // Direct buying intent (original patterns, still valid)
  /\b(would love to dm|could you dm|happy to pay|where can i hire|how do i find someone|looking for someone to|need someone to|would pay for|how much do you charge|do you take clients|is this a service you offer|can you help me|need help with|looking to hire|anyone offer this|i would pay|can someone help)\b/i,
  // Operational pain - business owner overwhelmed
  /\b(manual process|doing it manually|wasting time|too much admin|can't keep up|falling behind|buried in work|overwhelmed|wearing too many hats|doing everything myself|stretched thin|short-staffed|understaffed|hours a day on|hours per week on)\b/i,
  // Automation / tool seeking
  /\b(automate|automation|workflow automation|zapier|n8n|make\.com|looking for software|looking for a tool|need a tool|is there a way to automate|how do i automate|ai for my|ai for our)\b/i,
  // Hiring / outsourcing intent
  /\b(looking for a developer|need a developer|hire a developer|looking for a consultant|hire a consultant|looking for an agency|looking to outsource|need someone to build|build me a|build for me)\b/i,
  // SaaS founder pain - first customers, sales system
  /\b(no sales|zero sales|can't get customers|first customers|first paying|no revenue|how to get clients|finding clients|getting clients|client acquisition|no leads|where to find customers)\b/i,
  // Vibe-coded app pain - broken apps, bugs, code review
  /\b(vibe.?cod|app is broken|full of bugs|buggy|code review|code audit|cursor.?(app|project|built)|built with cursor|built with ai|ai.?generated.?code|technical debt|falling apart)\b/i,
  // Process friction
  /\b(missed follow.?up|inbox chaos|leads falling through|losing customers|losing business|missed appointment|no follow.?up system|follow.?up manually|scheduling nightmare|booking system)\b/i,
  // Budget / cost pain
  /\b(can't afford to hire|cost of hiring|too expensive to hire|spending too much on|costing us|losing money|burning cash|budget for)\b/i,
  // Chain / franchise / multi-location business pain (Apr 28 2026)
  /\b(multiple locations|multi-location|franchise|franchisee|chain of|across locations|between locations|all our stores|all our branches|each location|per location|head office|headquarters|standardize|standardization)\b/i,
];

function matchesSignal(text) {
  return SIGNAL_PATTERNS.some(p => p.test(text));
}

// Hard reject: consumers, students, job seekers - not business operators
const CONSUMER_REJECT = /\b(just moved|new to the area|looking for a dentist|need a dentist|looking for a doctor|need a plumber|looking for a plumber|my professor|my class|for school|for my assignment|my apartment|my landlord|my lease|looking for work|seeking employment|open to opportunities|resume|hiring me|student project|university course)\b/i;

const NOT_AUTHOR = /^(automoderator|\[deleted\]|None)$/i;

const NOW = () => new Date().toISOString();

async function tg(text) {
  if (!TG || !CHAT) return;
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text, parse_mode: "HTML", disable_web_page_preview: true }),
  }).catch(() => {});
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function discoverPosts() {
  const seen = new Set();
  const posts = [];
  let blocked = 0;
  for (const sub of SUBS) {
    for (const [t, maxAge] of WINDOWS) {
      try {
        const d = await fetchJson(`https://www.reddit.com/r/${sub}/top.json?t=${t}&limit=30`);
        for (const c of (d?.data?.children || [])) {
          const p = c.data;
          if (seen.has(p.id)) continue;
          seen.add(p.id);
          const ageDays = (Date.now() / 1000 - p.created_utc) / 86400;
          if (ageDays > maxAge) continue;
          if (p.num_comments < 5) continue; // lowered from 20 - many pain posts have few comments
          posts.push({ sub, id: p.id, ups: p.ups, comments: p.num_comments, ageDays: +ageDays.toFixed(1), title: p.title, permalink: p.permalink });
        }
      } catch (e) {
        if (String(e).includes("429")) blocked++;
        console.log(`[hunt] r/${sub} ${t}: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 2500));
    }
  }
  return { posts, blocked };
}

async function scanComments(post) {
  try {
    const d = await fetchJson(`https://www.reddit.com${post.permalink}.json?limit=200`);
    const signals = [];
    const seenAuthors = new Set();

    // Also check the OP post itself - the post author often IS the prospect
    const opData = d[0]?.data?.children?.[0]?.data;
    if (opData) {
      const opText = `${opData.title || ""} ${opData.selftext || ""}`;
      if (matchesSignal(opText) && !CONSUMER_REJECT.test(opText) && opData.author && !NOT_AUTHOR.test(opData.author)) {
        seenAuthors.add(opData.author);
        signals.push({ author: opData.author, ups: opData.score || 0, snippet: opText.replace(/\n/g, " ").slice(0, 250), isOP: true });
      }
    }

    function walk(children) {
      for (const cc of children) {
        if (cc.kind !== "t1") continue;
        const b = cc.data;
        const body = b.body || "";
        if (seenAuthors.has(b.author)) continue; // one signal per author per thread
        if (matchesSignal(body) && !CONSUMER_REJECT.test(body) && b.author && !NOT_AUTHOR.test(b.author)) {
          seenAuthors.add(b.author);
          signals.push({ author: b.author, ups: b.ups, snippet: body.replace(/\n/g, " ").slice(0, 250) });
        }
        const reps = b.replies;
        if (reps && typeof reps === "object") walk(reps.data.children);
      }
    }
    walk(d[1].data.children);
    return signals;
  } catch (e) { return []; }
}

const insertLead = db.prepare(`
  INSERT OR IGNORE INTO leads (id, name, source, source_platform, source_url, pain_description, score, stage, first_signal_at, created_at, updated_at, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)
`);
const findExistingByName = db.prepare(`SELECT id FROM leads WHERE name = ? AND source LIKE 'reddit%' LIMIT 1`);

function persistLead(prospect, post) {
  const existing = findExistingByName.get(prospect.author);
  if (existing) return { id: existing.id, isNew: false };
  const id = `hunt-${prospect.author.toLowerCase().slice(0, 20)}-${Date.now().toString(36)}`;
  insertLead.run(
    id, prospect.author, "reddit_buying_signal_hunt", `reddit_r_${post.sub}`,
    `https://reddit.com${post.permalink}`,
    `In thread "${post.title.slice(0, 100)}": ${prospect.snippet}`,
    15, NOW(), NOW(), NOW(),
    `Found by buying-signal-hunt ${NOW().slice(0, 10)}. Source post age ${post.ageDays}d.`
  );
  return { id, isNew: true };
}

function enrichLead(leadId) {
  const r = spawnSync("node", [resolve(__dirname, "lead-enrichment-bot.mjs"), leadId], {
    cwd: ROOT, encoding: "utf-8", timeout: 6 * 60 * 1000,
  });
  if (r.status !== 0) return null;
  return db.prepare(`SELECT * FROM lead_enrichment WHERE lead_id=?`).get(leadId);
}

(async () => {
  // Check if system-brain paused scouts
  const { existsSync: _fe } = await import("fs");
  if (_fe(import.meta.dirname + "/../../../../Desktop/linkedin-brand-os/.data/scouts-paused.flag") || _fe("$CLAUDE_PROJECT_DIR/.data/scouts-paused.flag")) { console.log("[hunt] PAUSED by system-brain"); process.exit(0); }
  const dryRun = process.argv.includes("--dry");
  console.log(`[hunt] starting (dry=${dryRun})`);

  const { posts, blocked } = await discoverPosts();
  console.log(`[hunt] discovered ${posts.length} candidate posts (${blocked} sub fetches blocked)`);

  if (posts.length === 0) {
    if (blocked > 0) {
      await tg(`<b>⚠️ buying-signal-hunt: Reddit 429</b>\n\nAll discovery requests blocked by rate limit. Skip this run, retry in 1h or set up Reddit OAuth.`);
    }
    db.close();
    return;
  }

  const allProspects = [];
  let scanned = 0;
  for (const post of posts) {
    if (scanned >= 30) break;
    scanned++;
    const signals = await scanComments(post);
    for (const s of signals) {
      const persisted = persistLead(s, post);
      if (persisted.isNew) {
        allProspects.push({ leadId: persisted.id, author: s.author, snippet: s.snippet, post });
      }
    }
    await new Promise(r => setTimeout(r, 2500));
  }
  console.log(`[hunt] found ${allProspects.length} new prospects across ${scanned} threads`);

  if (allProspects.length === 0) {
    // Don't spam Telegram with "0 results" - log only
    console.log(`[hunt] 0 new prospects across ${scanned} threads`);
    db.close();
    return;
  }

  // Enrichment phase
  if (dryRun) {
    await tg(`<b>🔍 buying-signal-hunt (dry): ${allProspects.length} new prospects</b>\n\n${allProspects.slice(0, 10).map(p => `• u/${p.author} (r/${p.post.sub})`).join("\n")}`);
    db.close();
    return;
  }

  console.log(`[hunt] enriching ${allProspects.length} prospects...`);
  const enriched = [];
  for (const p of allProspects) {
    const e = enrichLead(p.leadId);
    enriched.push({ ...p, enrichment: e });
    console.log(`[hunt] enriched ${p.author}: ${e?.classification || "FAIL"}/${e?.recommended_action || "?"}`);
  }

  // Bucket by classification
  const buckets = { ready_buyer: [], warming: [], peer: [], lurker: [], not_fit: [], failed: [] };
  for (const e of enriched) {
    const cls = e.enrichment?.classification || "failed";
    (buckets[cls] || buckets.failed).push(e);
  }

  let summary = `<b>🎯 buying-signal-hunt: ${enriched.length} new prospects, enriched</b>\n\n`;
  for (const [k, v] of Object.entries(buckets)) {
    if (v.length > 0) summary += `${k === "ready_buyer" ? "🔥" : k === "warming" ? "✅" : k === "peer" ? "🤝" : k === "failed" ? "⚠️" : "⏸"} <b>${k}:</b> ${v.length}\n`;
  }
  const actionable = [...buckets.ready_buyer, ...buckets.warming];
  summary += `\n<b>${actionable.length} actionable</b> (ready_buyer + warming).\n`;
  if (actionable.length > 0) {
    summary += `\nTop actionable:\n`;
    for (const a of actionable.slice(0, 5)) {
      summary += `• u/${a.author} (${a.enrichment.classification}/${a.enrichment.confidence}): ${a.enrichment.next_message_angle?.slice(0, 100)}\n`;
    }
    summary += `\nLead IDs ready for drafting are in lead_enrichment table. Drafting drafts JSON next.`;
  }
  await tg(summary);
  db.close();
})();
