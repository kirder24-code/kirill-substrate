/**
 * FIELD KIT EXECUTOR
 *
 * Closes the loop: cortex-daemon generates field kits, Kirill approves via Telegram,
 * this bot SEARCHES for actual businesses matching the kit and sends personalized
 * action cards back to Telegram.
 *
 * Flow:
 *   1. Read active kits from .data/active-field-kits.json
 *   2. For each kit, run Brave Search with kit-derived queries
 *   3. Extract business details via callAI (MODEL_MINI)
 *   4. Personalize opener from kit template
 *   5. Send action cards to Telegram (send/skip/stop buttons)
 *   6. Track in field_kit_leads DB table
 *
 * Schedule: every 6h at :40 during business hours (UTC 14-02 = 8AM-8PM Calgary)
 * Run: node scripts/factory/field-kit-executor.mjs
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const KITS_PATH = resolve(ROOT, ".data/active-field-kits.json");

// ── Imports from orchestrator ────────────────────────────────────────
import {
  callAI, MODEL_MINI, tgSendToKirill, heartbeat,
  env, getDb, reportError, clearError, preflight, isCleanOutreach
} from "./orchestrator.mjs";

const BOT_ID = "field-kit-executor";
const BOT_NAME = "FieldKitExecutor";
const BRAVE_KEY = env.BRAVE_SEARCH_API_KEY || env.BRAVE_API_KEY || "";
const MAX_LEADS_PER_KIT = 5;

// ── Preflight ────────────────────────────────────────────────────────
const check = preflight([
  { name: "BRAVE_SEARCH_API_KEY", value: BRAVE_KEY },
  { name: "TELEGRAM_BOT_TOKEN", value: env.TELEGRAM_BOT_TOKEN },
  { name: "TELEGRAM_CHAT_ID", value: env.TELEGRAM_CHAT_ID },
]);
if (!check.ok) {
  console.error(`[${BOT_ID}] Preflight failed: ${check.message}`);
  process.exit(1);
}

// ── DB setup ─────────────────────────────────────────────────────────
function ensureTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS field_kit_leads (
      id TEXT PRIMARY KEY,
      kit_id TEXT NOT NULL,
      business_name TEXT,
      business_url TEXT,
      job_post_url TEXT,
      hiring_for TEXT,
      pain_signal TEXT,
      contact_method TEXT,
      opener_text TEXT,
      status TEXT DEFAULT 'found',
      created_at TEXT,
      sent_at TEXT,
      actioned_at TEXT
    )
  `);
}

// ── Brave Search ─────────────────────────────────────────────────────
async function braveSearch(query, count = 10) {
  if (!BRAVE_KEY) return [];
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "X-Subscription-Token": BRAVE_KEY },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error(`[${BOT_ID}] Brave API ${res.status}: ${res.statusText}`);
      return [];
    }
    const data = await res.json();
    return (data?.web?.results || []).map(r => ({
      title: r.title || "",
      url: r.url || "",
      description: r.description || "",
    }));
  } catch (e) {
    console.error(`[${BOT_ID}] Brave fetch error:`, e.message);
    return [];
  }
}

// ── Load active kits ─────────────────────────────────────────────────
function loadKits() {
  if (!existsSync(KITS_PATH)) return [];
  try {
    const raw = readFileSync(KITS_PATH, "utf-8");
    const kits = JSON.parse(raw);
    return Array.isArray(kits) ? kits.filter(k => k && k.id) : [];
  } catch (e) {
    console.error(`[${BOT_ID}] Failed to read kits:`, e.message);
    return [];
  }
}

function saveKits(kits) {
  writeFileSync(KITS_PATH, JSON.stringify(kits, null, 2));
}

// ── Search for businesses matching a kit ─────────────────────────────
async function searchForKit(kit, db) {
  const queries = kit.search_queries || [];
  if (queries.length === 0) {
    // Generate queries from target_description
    const generated = await callAI(
      `Generate 3-4 specific search queries to find real businesses matching this target.
Include location-specific queries (Calgary, Canada) and job board queries (Indeed, LinkedIn).
Return JSON: { "queries": ["query1", "query2", ...] }`,
      `Kit: ${kit.title}\nTarget: ${kit.target_description}`,
      MODEL_MINI,
      true,
    );
    if (generated?.queries?.length) {
      queries.push(...generated.queries);
    } else {
      queries.push(`${kit.target_description} Calgary`);
      queries.push(`${kit.target_description} hiring Indeed`);
    }
  }

  // Deduplicate against already-found leads for this kit
  const existingUrls = new Set(
    db.prepare(`SELECT business_url FROM field_kit_leads WHERE kit_id = ?`).all(kit.id)
      .map(r => r.business_url).filter(Boolean)
  );

  const allResults = [];
  for (const q of queries.slice(0, 4)) {
    const results = await braveSearch(q, 10);
    for (const r of results) {
      if (!existingUrls.has(r.url)) {
        allResults.push({ ...r, query: q });
      }
    }
    // Rate limit: 1 req/sec for Brave free tier
    await new Promise(r => setTimeout(r, 1100));
  }

  console.log(`[${BOT_ID}] Kit "${kit.title}": ${allResults.length} raw results from ${queries.length} queries`);
  return allResults;
}

// ── Extract business details via AI ──────────────────────────────────
async function extractBusiness(result, kit) {
  try {
    const extracted = await callAI(
      `Extract business details from this search result. This is for a field kit targeting: "${kit.target_description}".

Return JSON:
{
  "business_name": "actual company name or null if unclear",
  "hiring_for": "what position/role they are hiring for, or null",
  "pain_signal": "what pain this suggests (e.g. 'scaling team, needs automation')",
  "contact_method": "how to reach them (e.g. 'apply page', 'email on site', 'LinkedIn')",
  "relevant": true/false - is this actually a business matching our target?
}

Be strict: if this is a blog post, news article, or aggregator page (not a real business), set relevant=false.`,
      `Title: ${result.title}\nURL: ${result.url}\nDescription: ${result.description}`,
      MODEL_MINI,
      true,
    );
    return extracted;
  } catch (e) {
    console.error(`[${BOT_ID}] Extract error:`, e.message);
    return null;
  }
}

// ── Personalize opener ───────────────────────────────────────────────
async function personalizeOpener(business, kit) {
  try {
    const template = kit.opener_template || "";
    const result = await callAI(
      `Write a short, personalized cold outreach opener (2-3 sentences max) for this specific business.

Rules:
- Reference their SPECIFIC situation (what they are hiring for, their pain)
- No em dashes - use hyphens only
- No AI-tells (no "I noticed", "I came across", "streamline", "leverage", "seamlessly")
- Straight to the point - what you can do for them
- Conversational tone, like a peer, not a vendor
- End with a simple question or CTA
${template ? `\nBase template to adapt: ${template}` : ""}
${kit.close_line ? `\nClose with: ${kit.close_line}` : ""}

Return JSON: { "opener": "the personalized message" }`,
      `Business: ${business.business_name}
Hiring for: ${business.hiring_for || "unknown"}
Pain: ${business.pain_signal || "growth"}
URL: ${business.url}
Kit context: ${kit.title} - ${kit.target_description}`,
      MODEL_MINI,
      true,
    );
    return result?.opener || null;
  } catch (e) {
    console.error(`[${BOT_ID}] Personalize error:`, e.message);
    return null;
  }
}

// ── Send action card to Telegram ─────────────────────────────────────
async function sendActionCard(lead, kit) {
  const lines = [
    `<b>${kit.title}</b>`,
    ``,
    `<b>${lead.business_name}</b>`,
  ];
  if (lead.hiring_for) lines.push(`Hiring: ${lead.hiring_for}`);
  if (lead.pain_signal) lines.push(`Signal: ${lead.pain_signal}`);
  if (lead.job_post_url || lead.business_url) {
    lines.push(`<a href="${lead.job_post_url || lead.business_url}">Open link</a>`);
  }
  if (lead.opener_text) {
    lines.push(``);
    lines.push(`<code>${lead.opener_text.slice(0, 800)}</code>`);
  }
  if (lead.contact_method) {
    lines.push(``);
    lines.push(`Contact: ${lead.contact_method}`);
  }

  const text = lines.join("\n").slice(0, 3800);

  await tgSendToKirill(text, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Sent it", callback_data: `kit_sent:${lead.id}` },
          { text: "Skip", callback_data: `kit_skip:${lead.id}` },
        ],
        [
          { text: "Stop this kit", callback_data: `kit_stop:${kit.id}` },
        ],
      ],
    },
  });
}

// ── Main execution ───────────────────────────────────────────────────
async function run() {
  const db = getDb();
  ensureTable(db);

  const kits = loadKits();
  if (kits.length === 0) {
    console.log(`[${BOT_ID}] No active field kits. Nothing to do.`);
    heartbeat(db, BOT_ID, BOT_NAME, "no active kits", {}, { status: "ok", last_success_at: new Date().toISOString() });
    db.close();
    return;
  }

  console.log(`[${BOT_ID}] Processing ${kits.length} active kit(s)`);

  let totalSent = 0;

  for (const kit of kits) {
    try {
      // Search for businesses
      const rawResults = await searchForKit(kit, db);
      if (rawResults.length === 0) {
        console.log(`[${BOT_ID}] Kit "${kit.title}": no new results`);
        continue;
      }

      let sentForKit = 0;

      for (const result of rawResults) {
        if (sentForKit >= MAX_LEADS_PER_KIT) break;

        // Extract business details
        const business = await extractBusiness(result, kit);
        if (!business || !business.relevant || !business.business_name) continue;

        // Personalize opener
        const opener = await personalizeOpener(
          { ...business, url: result.url },
          kit,
        );

        // Quality check
        if (opener && !isCleanOutreach(opener)) {
          console.warn(`[${BOT_ID}] Opener failed quality check for ${business.business_name}, regenerating...`);
          continue;
        }

        // Save to DB
        const leadId = randomUUID();
        const now = new Date().toISOString();
        db.prepare(`
          INSERT INTO field_kit_leads (id, kit_id, business_name, business_url, job_post_url, hiring_for, pain_signal, contact_method, opener_text, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'found', ?)
        `).run(
          leadId, kit.id,
          business.business_name, result.url, result.url,
          business.hiring_for || null,
          business.pain_signal || null,
          business.contact_method || null,
          opener || null,
          now,
        );

        // Send to Telegram
        const lead = {
          id: leadId,
          business_name: business.business_name,
          business_url: result.url,
          job_post_url: result.url,
          hiring_for: business.hiring_for,
          pain_signal: business.pain_signal,
          contact_method: business.contact_method,
          opener_text: opener,
        };

        await sendActionCard(lead, kit);

        // Mark as sent
        db.prepare(`UPDATE field_kit_leads SET status = 'sent', sent_at = ? WHERE id = ?`)
          .run(new Date().toISOString(), leadId);

        sentForKit++;
        totalSent++;

        // Small delay between Telegram messages
        await new Promise(r => setTimeout(r, 500));
      }

      console.log(`[${BOT_ID}] Kit "${kit.title}": sent ${sentForKit} action cards`);
    } catch (e) {
      console.error(`[${BOT_ID}] Error processing kit "${kit.title}":`, e.message);
      reportError(db, BOT_ID, BOT_NAME, e.message, "crash");
    }
  }

  // Heartbeat
  heartbeat(db, BOT_ID, BOT_NAME, `processed ${kits.length} kits, sent ${totalSent} cards`, {
    kits: kits.length,
    cards_sent: totalSent,
  }, { status: "ok", last_success_at: new Date().toISOString() });
  clearError(db, BOT_ID);

  console.log(`[${BOT_ID}] Done. ${totalSent} total action cards sent.`);
  db.close();
}

run().catch(e => {
  console.error(`[${BOT_ID}] Fatal:`, e);
  try {
    const db = getDb();
    reportError(db, BOT_ID, BOT_NAME, e.message, "crash");
    db.close();
  } catch {}
  process.exit(1);
});
