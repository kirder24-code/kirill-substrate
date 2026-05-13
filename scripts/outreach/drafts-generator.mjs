#!/usr/bin/env node
/**
 * drafts-generator.mjs
 * Reads manual-voice-agent-queue.json and prints copy-ready outreach drafts
 * for all undelivered leads. Output: JSON draft list to stdout.
 *
 * Usage: node scripts/outreach/drafts-generator.mjs [--csv]
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../");
const QUEUE_PATH = path.join(ROOT, ".data/manual-voice-agent-queue.json");

const csvMode = process.argv.includes("--csv");

const queue = JSON.parse(readFileSync(QUEUE_PATH, "utf8"));

const drafts = [];

for (const lead of queue.leads) {
  if (lead.status?.delivered) continue;

  const langSignal = lead.lang_signal || "en";

  if (lead.drafts?.en) {
    drafts.push({
      lead_id: lead.id,
      company: lead.company,
      email: lead.email,
      phone: lead.phone,
      lang: "en",
      subject: lead.drafts.en.subject,
      body: lead.drafts.en.body,
    });
  }

  if (langSignal === "ru" && lead.drafts?.ru) {
    drafts.push({
      lead_id: lead.id,
      company: lead.company,
      email: lead.email,
      phone: lead.phone,
      lang: "ru",
      subject: lead.drafts.ru.subject,
      body: lead.drafts.ru.body,
    });
  }

  // Always include RU if a draft exists and no lang signal is set (include both)
  if (langSignal !== "ru" && lead.drafts?.ru) {
    drafts.push({
      lead_id: lead.id,
      company: lead.company,
      email: lead.email,
      phone: lead.phone,
      lang: "ru",
      subject: lead.drafts.ru.subject,
      body: lead.drafts.ru.body,
    });
  }
}

if (csvMode) {
  const escape = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const headers = ["lead_id", "company", "email", "phone", "lang", "subject", "body"];
  console.log(headers.join(","));
  for (const d of drafts) {
    console.log(headers.map((h) => escape(d[h] ?? "")).join(","));
  }
} else {
  console.log(JSON.stringify({ generated_at: new Date().toISOString(), count: drafts.length, drafts }, null, 2));
}
