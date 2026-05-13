#!/usr/bin/env node
// organism/ingest-conversations.mjs
// Adapter: pulls the conversations table — each conversation is a relationship the system
// has with a specific prospect, with a stage in the funnel. Stage transitions are
// signals about which channels and segments produce real engagement.
//
// Idempotent via source_ref = "conversation/<id>/stage/<stage>".

import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, recordOutcome, totalOutcomes } from "./db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, "../..");
const SRC_DB_PATH = resolve(PROJECT, ".data/linkedin-brand-os.sqlite");

function parseFlags(argv) {
  const out = { dryRun: false };
  for (const a of argv.slice(2)) if (a === "--dry-run") out.dryRun = true;
  return out;
}

function existsRef(orgDb, source_ref) {
  return !!orgDb.prepare("SELECT id FROM outcomes WHERE source_ref = ? LIMIT 1").get(source_ref);
}

const STAGE_SIGNAL = {
  first_contact: { type: "stage_first_contact", value: 0.3 },
  replied: { type: "stage_replied", value: 0.6 },
  engaged: { type: "stage_engaged", value: 0.75 },
  qualifying: { type: "stage_qualifying", value: 0.85 },
  proposing: { type: "stage_proposing", value: 0.9 },
  closing: { type: "stage_closing", value: 0.95 },
  won: { type: "stage_won", value: 1.0 },
  lost: { type: "stage_lost", value: -0.3 },
  dormant: { type: "stage_dormant", value: 0.1 },
};

function describeConversation(c, sig) {
  return `Conversation ${c.id.slice(0, 8)}: prospect "${c.prospect_name || "anon"}" on ${c.platform || "?"}/${c.channel || "?"} reached stage "${c.stage}" (signal value ${sig.value}). Pain: ${(c.prospect_pain || "n/a").slice(0, 200)}. Our offer: ${(c.our_offer || "n/a").slice(0, 200)}. First contact ${c.first_contact_at}, last interaction ${c.last_interaction_at}.`;
}

function ingest(orgDb, srcDb, flags) {
  const rows = srcDb.prepare(`
    SELECT id, prospect_name, platform, channel, first_contact_at, last_interaction_at,
           stage, prospect_pain, our_offer, next_action, next_action_reason
    FROM conversations
    ORDER BY last_interaction_at DESC NULLS LAST, created_at DESC
  `).all();

  let inserted = 0, skipped = 0;
  for (const c of rows) {
    const sig = STAGE_SIGNAL[c.stage];
    if (!sig) { skipped++; continue; }
    const ref = `conversation/${c.id}/stage/${c.stage}`;
    if (existsRef(orgDb, ref)) { skipped++; continue; }

    const platform = (c.platform || "unknown").toLowerCase();
    const channel = (c.channel || "unknown").toLowerCase();
    const target = `${platform}_${channel}`;

    if (!flags.dryRun) {
      recordOutcome(orgDb, {
        source_type: "conversations",
        source_ref: ref,
        signal_type: sig.type,
        signal_value: sig.value,
        description: describeConversation(c, sig),
        related_action_type: channel.includes("dm") ? `${platform}_dm` : channel.includes("comment") ? `${platform}_comment` : `${platform}_${channel}`,
        related_target: target,
        observed_at: c.last_interaction_at || c.first_contact_at,
        meta: {
          conversation_id: c.id,
          platform,
          channel,
          stage: c.stage,
          pain_summary: c.prospect_pain?.slice(0, 200),
        },
      });
    }
    inserted++;
  }

  return { inserted, skipped, total: rows.length };
}

function main() {
  const flags = parseFlags(process.argv);
  const srcDb = new Database(SRC_DB_PATH, { readonly: true });
  const orgDb = openDb();
  const before = totalOutcomes(orgDb);

  const r = orgDb.transaction(() => ingest(orgDb, srcDb, flags))();
  const after = totalOutcomes(orgDb);

  console.log(`[conversations] read ${r.total} rows, inserted ${r.inserted}, skipped ${r.skipped}`);
  console.log(`[conversations] outcomes: ${before} -> ${after} (delta +${after - before})`);

  srcDb.close();
  orgDb.close();
}

main();
