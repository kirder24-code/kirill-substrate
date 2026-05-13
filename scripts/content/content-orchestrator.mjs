/**
 * scripts/content/content-orchestrator.mjs
 *
 * The Content Department brain. Runs on a cron tick (or manual --tick).
 *
 * What it does on each tick:
 *   1. Refresh dept-state.json
 *   2. Anti-spam guard: no autonomous fire if last fire < 22h (D7)
 *   3. Drain content_queue (highest priority pending row), OR
 *      auto-discover from signal-hooks if queue empty AND --auto-discover
 *   4. For chosen idea: compose visual (via runVisualAgent) + post text (via writePost)
 *   5. Persist post_text/hashtags/purpose to content_visual_assets row
 *   6. Dispatch ONE unified TG card with everything inline (D1)
 *   7. Mark queue row processed
 *   8. Refresh dept-state.json again
 *
 * CLI:
 *   node scripts/content/content-orchestrator.mjs --tick              # one cycle
 *   node scripts/content/content-orchestrator.mjs --tick --force-now  # bypass anti-spam
 *   node scripts/content/content-orchestrator.mjs --tick --auto-discover  # also scan signal-hooks
 *   node scripts/content/content-orchestrator.mjs --tick --dry-run    # plan only, no compose
 *   node scripts/content/content-orchestrator.mjs --status            # print dept state
 */

import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

import { runVisualAgent } from "./visual-agent.mjs";
import { writePost } from "./post-writer.mjs";
import { pickNext, markComposing, markProcessed, expireStale, enqueueContentIdea, getQueueDepth } from "./content-queue.mjs";
import { refreshState } from "./dept-state.mjs";
import { updateAsset, getAsset, listRecent as listRecentAssets } from "./content-store.mjs";
import { findSignals } from "./signal-hooks.mjs";
import { pickFreshStyle } from "./visual-history.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");

const ANTI_SPAM_HOURS = 22;  // D7: no autonomous fire if last fire < 22h

function lastAutonomousFireAt() {
  if (!existsSync(DB_PATH)) return null;
  const c = new Database(DB_PATH, { readonly: true });
  try {
    // Look for assets with idea_source !== 'manual' in last 48h
    const r = c.prepare(`SELECT created_at FROM content_visual_assets WHERE idea_source != 'manual' OR idea_source IS NULL ORDER BY created_at DESC LIMIT 1`).get();
    return r?.created_at ? new Date(r.created_at) : null;
  } finally { c.close(); }
}

function hoursAgo(date) {
  if (!date) return Infinity;
  return (Date.now() - date.getTime()) / 3_600_000;
}

async function autoDiscoverIdea() {
  // Use signal-hooks to find one fresh post-worthy signal
  const signals = findSignals({ sinceMinutes: 1440 });
  const eligible = signals.filter(s => s.decision?.ok);
  if (!eligible.length) return null;
  const top = eligible[0];
  return {
    source: top.source === "opp-transition" ? "opp-win" : (top.source === "proactive" ? "signal-hook" : top.source),
    source_ref: String(top.source_ref || ""),
    idea: top.title,
    context: top.body,
    post_type: "general",
    asset_level: "static",  // default to static for auto-discovery
    priority: 3,
    linked_opp_id: top.linked_opp_id,
    audience: top.audience || "general",
  };
}

export async function tick({ forceNow = false, autoDiscover = false, dryRun = false } = {}) {
  const startedAt = new Date().toISOString();
  console.log(`[content-orchestrator] tick @ ${startedAt} (forceNow=${forceNow} autoDiscover=${autoDiscover} dryRun=${dryRun})`);

  // 0. Expire stale queue items first
  const expired = expireStale({ olderThanDays: 7 });
  if (expired.expired > 0) console.log(`  expired ${expired.expired} stale queue rows`);

  // 1. Refresh state (early)
  refreshState({ status_note: "tick_started" });

  // 2. Anti-spam check
  if (!forceNow) {
    const last = lastAutonomousFireAt();
    const hrs = hoursAgo(last);
    if (hrs < ANTI_SPAM_HOURS) {
      const reason = `anti_spam: last autonomous fire ${hrs.toFixed(1)}h ago, need ${ANTI_SPAM_HOURS}h`;
      console.log(`  ${reason}`);
      refreshState({ status_note: reason });
      return { ok: true, action: "skipped", reason };
    }
  }

  // 3. Pick next idea: queue first, then auto-discover if enabled
  let pickedRow = pickNext();
  let queue_id = pickedRow?.id || null;
  let ideaSpec;

  if (pickedRow) {
    ideaSpec = {
      source: pickedRow.source,
      source_ref: pickedRow.source_ref,
      idea: pickedRow.idea,
      context: pickedRow.context || "",
      post_type: pickedRow.post_type || "general",
      asset_level: pickedRow.asset_level || "static",
      recipe: pickedRow.recipe,
      priority: pickedRow.priority,
    };
    console.log(`  drained queue id=${pickedRow.id} (${ideaSpec.source}): ${ideaSpec.idea.slice(0, 80)}`);
  } else if (autoDiscover) {
    ideaSpec = await autoDiscoverIdea();
    if (!ideaSpec) {
      const reason = "no_idea: queue empty + signal-hooks found nothing eligible";
      console.log(`  ${reason}`);
      refreshState({ status_note: reason });
      return { ok: true, action: "skipped", reason };
    }
    console.log(`  auto-discovered from ${ideaSpec.source}: ${ideaSpec.idea.slice(0, 80)}`);
    // Enqueue the auto-discovered idea so it's persisted, then immediately drain
    const eq = enqueueContentIdea(ideaSpec);
    if (eq.ok) queue_id = eq.id;
  } else {
    const reason = "queue_empty: no pending ideas, autoDiscover off";
    console.log(`  ${reason}`);
    refreshState({ status_note: reason });
    return { ok: true, action: "skipped", reason };
  }

  if (dryRun) {
    refreshState({ status_note: `dry_run: would compose ${ideaSpec.idea.slice(0,60)}` });
    return { ok: true, action: "dry_run", plan: ideaSpec, queue_id };
  }

  // 4. Mark queue row as composing
  if (queue_id) markComposing(queue_id);
  refreshState({ status_note: `composing: ${ideaSpec.idea.slice(0,60)}` });

  // 5. Pre-pick fresh style (template + accent) so output VARIES vs recent history.
  // Only applies to static level (motion = kinetic/animated-flow auto-routed by content; scroll = recipe/panel-driven).
  let stylePick = null;
  if (ideaSpec.asset_level === "static") {
    stylePick = pickFreshStyle({ post_type: ideaSpec.post_type });
    console.log(`  fresh style: template=${stylePick.template} accent=${stylePick.accent_color} (${stylePick.template_reason})`);
  }

  // Run visual-agent (fast mode default for autonomous tick; full only for opp-win or scroll)
  const useFull = (ideaSpec.source === "opp-win") || (ideaSpec.asset_level === "scroll" && !ideaSpec.recipe);
  console.log(`  → visual-agent (${useFull ? "full" : "fast"}, level=${ideaSpec.asset_level})`);
  const va = await runVisualAgent({
    idea: ideaSpec.idea,
    context: ideaSpec.context,
    post_type: ideaSpec.post_type,
    asset_level: ideaSpec.asset_level,
    recipe: ideaSpec.recipe,
    mode: useFull ? "full" : "fast",
    template_hint: ideaSpec.template_hint || stylePick?.template,
    accent_hint: ideaSpec.accent_hint || stylePick?.accent_color,
    auto_telegram: false,  // we'll send unified card OURSELVES after post-writer
  });
  if (!va.ok) {
    if (queue_id) markProcessed(queue_id, { status: "rejected", notes: `visual_agent_failed: ${va.reason}` });
    refreshState({ status_note: `visual_agent_failed: ${va.reason}` });
    return { ok: false, action: "compose_failed", stage: "visual", reason: va.reason };
  }
  console.log(`  ✓ visual ${va.asset_level} → ${va.primary_path}`);

  // 6. Run post-writer
  const brief = JSON.parse(readFileSync(va.brief_json_path, "utf-8"));
  const pw = await writePost({
    brief,
    idea: ideaSpec.idea,
    post_type: ideaSpec.post_type,
    context: ideaSpec.context,
  });
  if (!pw.ok) {
    if (queue_id) markProcessed(queue_id, { status: "rejected", notes: `post_writer_failed: ${pw.reason} ${JSON.stringify(pw.issues || {})}` });
    refreshState({ status_note: `post_writer_failed: ${pw.reason}` });
    return { ok: false, action: "compose_failed", stage: "post_writer", reason: pw.reason, issues: pw.issues, draft: pw.draft, visual: va };
  }
  console.log(`  ✓ post text ${pw.word_count}w + ${pw.hashtags.length} hashtags + purpose set`);

  // 7. Persist text/hashtags/purpose to asset row
  updateAsset(va.db_id, {
    post_text: pw.post_text,
    hashtags: pw.hashtags,
    purpose: pw.purpose,
    suggested_post_at: pw.suggested_post_at,
    source_signal_id: ideaSpec.source_ref || null,
    idea_source: ideaSpec.source,
    idea_source_ref: ideaSpec.source_ref || null,
  });

  // 8. Dispatch unified TG card
  const { sendUnifiedCard } = await import("./tg-approval.mjs");
  const tg = await sendUnifiedCard({ asset_id: va.db_id });
  if (!tg.ok) {
    if (queue_id) markProcessed(queue_id, { composed_asset_id: va.db_id, status: "composed", notes: `tg_dispatch_failed: ${tg.reason}` });
    refreshState({ status_note: `tg_dispatch_failed: ${tg.reason}` });
    return { ok: false, action: "tg_failed", reason: tg.reason, asset_id: va.db_id };
  }
  console.log(`  ✓ TG card delivered, message_id=${tg.message_id}`);

  if (queue_id) markProcessed(queue_id, { composed_asset_id: va.db_id, status: "composed" });
  refreshState({ status_note: `composed: ${va.db_id}` });

  return {
    ok: true,
    action: "composed",
    asset_id: va.db_id,
    asset_level: va.asset_level,
    primary_path: va.primary_path,
    telegram_message_id: tg.message_id,
    purpose: pw.purpose,
    word_count: pw.word_count,
    hashtag_count: pw.hashtags.length,
    suggested_post_at: pw.suggested_post_at,
  };
}

/**
 * Regenerate one asset with FORCED different template + accent vs what was rejected.
 * Triggered by Kirill clicking 🎲 Regen or 🖼️ Edit visual.
 *
 * Strategy: re-compose the same idea, but pass template+accent hints that EXCLUDE
 * what was just rejected. Different template/color = visibly different output.
 */
export async function regenAsset(asset_id, { force_template = null, force_accent = null } = {}) {
  const rejected = getAsset(asset_id);
  if (!rejected) return { ok: false, reason: "asset_not_found", asset_id };

  const post_type = rejected.brief?.post_type || rejected.template_type === "news-card" ? "news"
    : rejected.template_type === "quote-card" ? "provocation"
    : "general";

  // Build "avoid" lists from this asset PLUS history
  const avoid_templates = [rejected.template_type].filter(Boolean);
  const avoid_accents = [rejected.accent_color].filter(Boolean);
  const stylePick = pickFreshStyle({ post_type, avoid_templates, avoid_accents });

  const new_template = force_template || stylePick.template;
  const new_accent = force_accent || stylePick.accent_color;

  console.log(`[regen] asset=${asset_id} OLD=${rejected.template_type}/${rejected.accent_color} → NEW=${new_template}/${new_accent}`);

  refreshState({ status_note: `regen: ${asset_id} → ${new_template}/${new_accent}` });

  // Mark the original as regen_in_progress so we don't pick it up again
  updateAsset(asset_id, { status: "regen_in_progress" });

  const va = await runVisualAgent({
    idea: rejected.idea_text || rejected.brief?.big_title || "(no idea)",
    context: rejected.brief?.context || "",
    post_type,
    asset_level: rejected.asset_level || "static",
    recipe: null,
    mode: "fast",
    template_hint: new_template,
    accent_hint: new_accent,
    auto_telegram: false,
  });
  if (!va.ok) {
    updateAsset(asset_id, { status: "regen_failed" });
    return { ok: false, stage: "visual", reason: va.reason };
  }

  // Write post text using the SAME post_type, fresh visual
  const brief = JSON.parse(readFileSync(va.brief_json_path, "utf-8"));
  const pw = await writePost({ brief, idea: rejected.idea_text, post_type });
  if (!pw.ok) {
    updateAsset(asset_id, { status: "regen_failed" });
    return { ok: false, stage: "post_writer", reason: pw.reason, issues: pw.issues };
  }

  // Persist text to NEW asset row
  updateAsset(va.db_id, {
    post_text: pw.post_text,
    hashtags: pw.hashtags,
    purpose: pw.purpose,
    suggested_post_at: pw.suggested_post_at,
    idea_source: "regen",
    idea_source_ref: asset_id,  // link back to original
  });

  // Dispatch unified card
  const { sendUnifiedCard } = await import("./tg-approval.mjs");
  const tg = await sendUnifiedCard({ asset_id: va.db_id });
  if (!tg.ok) return { ok: false, stage: "tg", reason: tg.reason, new_asset_id: va.db_id };

  // Mark original as regenerated (history kept for variety calculations)
  updateAsset(asset_id, { status: "regenerated_replaced_by_" + va.db_id });
  refreshState({ status_note: `regen_complete: ${asset_id} → ${va.db_id}` });

  return {
    ok: true,
    original_asset_id: asset_id,
    new_asset_id: va.db_id,
    template_swap: { from: rejected.template_type, to: new_template },
    accent_swap: { from: rejected.accent_color, to: new_accent },
    telegram_message_id: tg.message_id,
  };
}

/**
 * Process all pending regen requests (Kirill clicked 🎲 Regen or 🖼️ Edit visual).
 * Called from the daemon tick or as a separate cron.
 */
export async function processRegenQueue() {
  if (!existsSync(DB_PATH)) return { ok: false, reason: "no_db" };
  const c = new Database(DB_PATH, { readonly: true });
  let pending;
  try {
    pending = c.prepare(`SELECT id FROM content_visual_assets WHERE status IN ('regen_requested','regen_visual_requested') ORDER BY updated_at ASC LIMIT 3`).all();
  } finally { c.close(); }
  if (!pending.length) return { ok: true, processed: 0 };
  const results = [];
  for (const row of pending) {
    const r = await regenAsset(row.id);
    results.push({ id: row.id, result: r });
  }
  return { ok: true, processed: results.length, results };
}

/**
 * Daemon mode: runs tick on an interval (default 3h). Use as a pulse module
 * for fully autonomous operation. autoDiscover=true means it also scans
 * signal-hooks when queue is empty.
 */
export async function runDaemon({ intervalHours = 3, autoDiscover = true } = {}) {
  console.log(`[content-orchestrator-daemon] starting, interval=${intervalHours}h autoDiscover=${autoDiscover}`);
  const intervalMs = Math.max(60_000, intervalHours * 3_600_000);
  while (true) {
    try {
      // First: process any pending regens (Kirill clicked 🎲 or 🖼️)
      const rg = await processRegenQueue();
      if (rg.ok && rg.processed > 0) console.log(`[daemon] processed ${rg.processed} regen request(s)`);
      // Then: regular tick
      const r = await tick({ forceNow: false, autoDiscover, dryRun: false });
      console.log(`[daemon] tick result: ${r.action}${r.reason ? ` (${r.reason})` : ""}`);
    } catch (e) {
      console.error(`[daemon] tick crashed: ${e.message}`);
      refreshState({ status_note: `daemon_crash: ${e.message}` });
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  if (args.includes("--status")) {
    const s = refreshState({ status_note: "cli_status" });
    console.log(JSON.stringify(s, null, 2));
    process.exit(0);
  }

  if (args.includes("--regen")) {
    const idIdx = args.indexOf("--regen");
    const target = args[idIdx + 1];
    if (target && !target.startsWith("--")) {
      regenAsset(target).then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(r.ok ? 0 : 1); });
    } else {
      processRegenQueue().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); });
    }
  } else if (args.includes("--daemon")) {
    const hrIdx = args.indexOf("--interval-hours");
    const intervalHours = hrIdx >= 0 ? Number(args[hrIdx + 1]) : 3;
    const autoDiscover = !args.includes("--no-auto-discover");
    runDaemon({ intervalHours, autoDiscover }).catch(e => {
      console.error("daemon crashed:", e);
      process.exit(2);
    });
  } else {
    // One-shot tick mode
    const opts = {
      forceNow: args.includes("--force-now"),
      autoDiscover: args.includes("--auto-discover"),
      dryRun: args.includes("--dry-run"),
    };
    tick(opts).then(r => {
      console.log(`\nresult: ${JSON.stringify(r, null, 2)}`);
      process.exit(r.ok ? 0 : 1);
    }).catch(e => {
      console.error("tick crashed:", e);
      process.exit(2);
    });
  }
}
