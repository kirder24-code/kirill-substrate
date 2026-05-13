/**
 * Unified card callback test — exercises 6 action shapes:
 *   c:a c:t c:v c:s c:r c:g
 * Reads latest asset's callback_token from DB, runs handleCallback for each,
 * verifies the resulting status update. Resets status between cases.
 */

import { handleCallback } from "$CLAUDE_PROJECT_DIR/scripts/content/tg-approval.mjs";
import Database from "better-sqlite3";

const DB = "$CLAUDE_PROJECT_DIR/.data/linkedin-brand-os.sqlite";

function getLatest() {
  const c = new Database(DB, { readonly: true });
  try { return c.prepare("SELECT id, callback_token FROM content_visual_assets WHERE callback_token IS NOT NULL ORDER BY created_at DESC LIMIT 1").get(); }
  finally { c.close(); }
}

function setStatus(id, status) {
  const c = new Database(DB);
  try { c.prepare("UPDATE content_visual_assets SET status=? WHERE id=?").run(status, id); }
  finally { c.close(); }
}

function getStatus(id) {
  const c = new Database(DB, { readonly: true });
  try { return c.prepare("SELECT status FROM content_visual_assets WHERE id=?").get(id)?.status; }
  finally { c.close(); }
}

const row = getLatest();
if (!row) { console.error("no asset with callback_token in DB"); process.exit(2); }
console.log(`testing on asset_id=${row.id} (token=${row.callback_token})`);

const cases = [
  { short: "a", expect: "approved" },
  { short: "t", expect: "edit_text_requested" },
  { short: "v", expect: "regen_visual_requested" },
  { short: "s", expect: "schedule_requested" },
  { short: "r", expect: "rejected" },
  { short: "g", expect: "regen_requested" },
];

let pass = 0, fail = 0;
for (const t of cases) {
  setStatus(row.id, "pending_approval");
  const r = await handleCallback({
    callback_query: { id: `t-${t.short}`, data: `c:${t.short}:${row.callback_token}`, message: { chat: { id: 1 }, message_id: 1 } },
  });
  const actual = getStatus(row.id);
  const ok = r.ok && actual === t.expect;
  console.log(`  c:${t.short}: ${ok ? "✓" : "✗"} action=${r.action || "?"} expect=${t.expect} actual=${actual}`);
  if (ok) pass++; else fail++;
}

console.log(`\n${pass} pass, ${fail} fail (of ${cases.length})`);
process.exit(fail > 0 ? 1 : 0);
