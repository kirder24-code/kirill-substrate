import { handleCallback } from "$CLAUDE_PROJECT_DIR/scripts/content/tg-approval.mjs";
import Database from "better-sqlite3";

// Pull latest asset's callback_token
const c = new Database("$CLAUDE_PROJECT_DIR/.data/linkedin-brand-os.sqlite", { readonly: true });
const row = c.prepare("SELECT id, callback_token, status FROM content_visual_assets WHERE callback_token IS NOT NULL ORDER BY created_at DESC LIMIT 1").get();
c.close();
console.log("Latest asset:", row);

// Test 1: invalid format
const r1 = await handleCallback({ callback_query: { id: "test-1", data: "garbage", message: { chat: { id: 1 }, message_id: 1 } } });
console.log("invalid format →", JSON.stringify(r1));

// Test 2: legacy format (should still work)
const r2 = await handleCallback({ callback_query: { id: "test-2", data: `content:approve:${row.id}`, message: { chat: { id: 1 }, message_id: 1 } } });
console.log("legacy format →", JSON.stringify(r2));

// Reset status so re-tests work
const c2 = new Database("$CLAUDE_PROJECT_DIR/.data/linkedin-brand-os.sqlite");
c2.prepare("UPDATE content_visual_assets SET status='pending_approval' WHERE id=?").run(row.id);
c2.close();

// Test 3: new compact format (this is what we use now)
const r3 = await handleCallback({ callback_query: { id: "test-3", data: `c:a:${row.callback_token}`, message: { chat: { id: 1 }, message_id: 1 } } });
console.log("compact c:a: →", JSON.stringify(r3));

// Reset
const c3 = new Database("$CLAUDE_PROJECT_DIR/.data/linkedin-brand-os.sqlite");
c3.prepare("UPDATE content_visual_assets SET status='pending_approval' WHERE id=?").run(row.id);
c3.close();

// Test 4: compact reject
const r4 = await handleCallback({ callback_query: { id: "test-4", data: `c:r:${row.callback_token}`, message: { chat: { id: 1 }, message_id: 1 } } });
console.log("compact c:r: →", JSON.stringify(r4));

// Test 5: unknown token
const r5 = await handleCallback({ callback_query: { id: "test-5", data: `c:a:nonexistent`, message: { chat: { id: 1 }, message_id: 1 } } });
console.log("unknown token →", JSON.stringify(r5));
