/**
 * scripts/tolik/atlas.mjs
 *
 * Tolik's atlas of the whole organism. ONE-stop catalog where every bot,
 * action, persona, channel, DB, daemon is documented with:
 *   - what it is
 *   - what it does
 *   - when to use it
 *
 * Generated from source file headers (JSDoc-style /** ... block at top of
 * each .mjs file in scripts/) + curated tables (channels, personas, dbs).
 *
 * Cached at .data/tolik-atlas.md and .data/tolik-atlas.json (indexed by
 * section/name/keywords for fast retrieval). Rebuilds on demand or daily.
 *
 * Public surface:
 *   buildAtlas()                     - regenerate + cache the atlas
 *   atlasLookup({query, section?})   - search atlas; returns matched entries
 *   atlasSection({section})          - return one section verbatim
 *   getAtlasOverview()               - compact 1-liner of every section
 *                                       (for prompt: tells Tolik what
 *                                        domains atlas covers, so he calls
 *                                        sub_atlas with the right keyword)
 */

import { readFileSync, readdirSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ATLAS_MD   = resolve(ROOT, ".data/tolik-atlas.md");
const ATLAS_JSON = resolve(ROOT, ".data/tolik-atlas.json");
const PERSONAS_DIR = resolve(ROOT, "scripts/survival/personas");
const CHANNEL_REGISTRY = resolve(ROOT, "scripts/survival/channel-registry.md");
const SURVIVAL_DB = resolve(ROOT, ".data/survival.db");

function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }

// Extract the first description sentence from a JSDoc /** ... */ block.
function describeFromSource(filePath) {
  try {
    const head = readFileSync(filePath, "utf-8").slice(0, 2500);
    const block = head.match(/\/\*\*([\s\S]*?)\*\//);
    if (!block) return "";
    const lines = block[1].split("\n").map(l => l.replace(/^\s*\*\s?/, "").trim()).filter(Boolean);
    // Skip header lines that just repeat the file path. Take next 1-3 meaty lines.
    const meaty = lines.filter(l => !l.startsWith("scripts/") && l.length > 15 && !l.startsWith("@"));
    return meaty.slice(0, 3).join(" ").slice(0, 240);
  } catch { return ""; }
}

function listBotsCategorized() {
  const cats = [
    { dir: "scripts/factory", label: "factory" },
    { dir: "scripts/survival", label: "survival" },
    { dir: "scripts/cortex", label: "cortex" },
    { dir: "scripts/tolik", label: "tolik" },
    { dir: "scripts/organism", label: "organism" },
    { dir: "scripts/command", label: "command" },
    { dir: "scripts/outreach", label: "outreach" },
  ];
  const out = {};
  for (const { dir, label } of cats) {
    const abs = resolve(ROOT, dir);
    if (!existsSync(abs)) continue;
    const files = readdirSync(abs).filter(f => f.endsWith(".mjs") || f.endsWith(".sh")).sort();
    out[label] = files.map(f => ({
      name: f.replace(/\.(mjs|sh)$/, ""),
      file: `${dir}/${f}`,
      desc: describeFromSource(resolve(abs, f)),
    }));
  }
  return out;
}

function listActions() {
  if (!existsSync(SURVIVAL_DB)) return [];
  try {
    const db = new Database(SURVIVAL_DB, { readonly: true, fileMustExist: true });
    const rows = db.prepare(`SELECT DISTINCT action_id, SUM(attempts) AS attempts, SUM(food_received_usd) AS food FROM policy_strategies GROUP BY action_id ORDER BY attempts DESC`).all();
    db.close();
    return rows;
  } catch { return []; }
}

function listPersonas() {
  if (!existsSync(PERSONAS_DIR)) return [];
  return readdirSync(PERSONAS_DIR).filter(f => f.endsWith(".md")).map(f => {
    const path = resolve(PERSONAS_DIR, f);
    try {
      const head = readFileSync(path, "utf-8").slice(0, 1500);
      // First H1 line + the "Distilled expert knowledge" section start
      const title = (head.match(/^#\s+(.+)/m) || [, f.replace(/\.md$/, "")])[1];
      const lines = head.split("\n").filter(l => l.trim() && !l.startsWith("#")).slice(0, 4);
      return { name: f.replace(/\.md$/, ""), title: title.trim(), desc: lines.join(" ").trim().slice(0, 320) };
    } catch { return { name: f.replace(/\.md$/, ""), title: f, desc: "" }; }
  });
}

function listDBs() {
  const dir = resolve(ROOT, ".data");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith(".db")).map(f => {
    const path = resolve(dir, f);
    try {
      const db = new Database(path, { readonly: true, fileMustExist: true });
      const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map(r => r.name);
      const counts = {};
      for (const t of tables.slice(0, 5)) {
        try { counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n; } catch {}
      }
      db.close();
      return { file: f, tables, sample_counts: counts };
    } catch { return { file: f, tables: [], sample_counts: {} }; }
  });
}

function readChannelRegistry() {
  if (!existsSync(CHANNEL_REGISTRY)) return "(channel-registry.md not found)";
  return readFileSync(CHANNEL_REGISTRY, "utf-8");
}

export function buildAtlas() {
  const bots = listBotsCategorized();
  const actions = listActions();
  const personas = listPersonas();
  const dbs = listDBs();
  const channelRegistry = readChannelRegistry();
  const generatedAt = new Date().toISOString();

  // Markdown rendering
  const md = [];
  md.push(`# Tolik's Atlas of the Organism`);
  md.push(`*Generated ${generatedAt}*\n`);
  md.push(`This is the COMPLETE catalog of what Tolik can see, call, or talk about. Each entry has 1-2 lines describing what it does, so Tolik knows when to use it.\n`);

  // Section: actions
  md.push(`## Substrate Actions (${actions.length} registered)`);
  md.push(`Actions Tolik can invoke via sub_run_action. Each was seeded by survival/experiment-runner and has its own runner module.\n`);
  for (const a of actions) {
    md.push(`- **${a.action_id}** — ${a.attempts || 0} attempts, food $${(a.food || 0).toFixed(2)}`);
  }

  // Section: specialists
  md.push(`\n## Specialist Personas (${personas.length} domain experts Tolik can dispatch to)`);
  md.push(`Each is a self-contained expert prompt (3-6K words) with 2026 B2B SMB services knowledge. Tolik calls dispatch_to_specialist({specialist:"<name>", question:"..."}) for domain advice.\n`);
  for (const p of personas) {
    md.push(`### ${p.name}\n${p.title}\n\n${p.desc}\n`);
  }

  // Section: factory bots
  md.push(`\n## Factory Bots (${bots.factory?.length || 0} autonomous workers)`);
  md.push(`Long-running bots that scan, score, and act on opportunities/leads/content. Each runs via orchestrator-daemon or manually.\n`);
  for (const b of (bots.factory || [])) {
    md.push(`- **${b.name}** — ${b.desc || "(no description in source)"}`);
  }

  // Section: survival
  md.push(`\n## Survival Core (${bots.survival?.length || 0} substrate plumbing modules)`);
  md.push(`Action runners, policy ledger, budget guard, identity, perception, channel-registry.\n`);
  for (const b of (bots.survival || [])) {
    md.push(`- **${b.name}** — ${b.desc || ""}`);
  }

  // Section: cortex
  md.push(`\n## Cortex (${bots.cortex?.length || 0} higher-order cognition modules)`);
  md.push(`Meta-cognition: dreams, attention, hunger, world-check, surprise detection, doctrine update.\n`);
  for (const b of (bots.cortex?.slice(0, 60) || [])) {
    md.push(`- **${b.name}** — ${b.desc || ""}`);
  }

  // Section: tolik own modules
  md.push(`\n## Tolik's Own Modules (${bots.tolik?.length || 0})`);
  for (const b of (bots.tolik || [])) {
    md.push(`- **${b.name}** — ${b.desc || ""}`);
  }

  // Section: organism
  if (bots.organism?.length) {
    md.push(`\n## Organism Pulse (${bots.organism.length})`);
    for (const b of bots.organism) md.push(`- **${b.name}** — ${b.desc || ""}`);
  }

  // Section: command
  if (bots.command?.length) {
    md.push(`\n## Command Layer (${bots.command.length})`);
    for (const b of bots.command) md.push(`- **${b.name}** — ${b.desc || ""}`);
  }

  // Section: dbs
  md.push(`\n## Databases (${dbs.length})`);
  for (const d of dbs) {
    md.push(`- **.data/${d.file}** — tables: ${d.tables.slice(0, 8).join(", ")}${d.tables.length > 8 ? ` (+${d.tables.length - 8} more)` : ""}`);
  }

  // Section: channel registry verbatim
  md.push(`\n## Channel Registry (Kirill's 22 channels with market+audience+voice rules)`);
  md.push(channelRegistry);

  const finalMd = md.join("\n");

  // JSON index for fast keyword lookup
  const index = {
    generated_at: generatedAt,
    sections: {
      actions: actions.map(a => ({ name: a.action_id, kind: "action", attempts: a.attempts })),
      personas: personas.map(p => ({ name: p.name, kind: "persona", title: p.title })),
      factory: (bots.factory || []).map(b => ({ name: b.name, kind: "factory_bot", desc: b.desc })),
      survival: (bots.survival || []).map(b => ({ name: b.name, kind: "survival_module", desc: b.desc })),
      cortex: (bots.cortex || []).map(b => ({ name: b.name, kind: "cortex_module", desc: b.desc })),
      tolik: (bots.tolik || []).map(b => ({ name: b.name, kind: "tolik_module", desc: b.desc })),
      organism: (bots.organism || []).map(b => ({ name: b.name, kind: "organism_module", desc: b.desc })),
      command: (bots.command || []).map(b => ({ name: b.name, kind: "command_module", desc: b.desc })),
      dbs: dbs.map(d => ({ name: d.file, kind: "database", tables: d.tables })),
    },
  };

  ensureDir(dirname(ATLAS_MD));
  writeFileSync(ATLAS_MD, finalMd);
  writeFileSync(ATLAS_JSON, JSON.stringify(index, null, 2));

  return {
    ok: true,
    md_path: ATLAS_MD,
    json_path: ATLAS_JSON,
    chars: finalMd.length,
    counts: {
      actions: actions.length,
      personas: personas.length,
      factory: bots.factory?.length || 0,
      survival: bots.survival?.length || 0,
      cortex: bots.cortex?.length || 0,
      tolik: bots.tolik?.length || 0,
      dbs: dbs.length,
    },
  };
}

function loadIndex() {
  if (!existsSync(ATLAS_JSON)) buildAtlas();
  try { return JSON.parse(readFileSync(ATLAS_JSON, "utf-8")); }
  catch { return null; }
}

/**
 * Search atlas by keyword. Returns up to 12 matched entries across all
 * sections. Each entry has {section, name, kind, desc}.
 */
export async function sub_atlas({ query, section } = {}) {
  const idx = loadIndex();
  if (!idx) return { ok: false, reason: "atlas_unavailable" };
  if (!query && !section) return { ok: true, overview: getAtlasOverview() };
  const q = (query || "").toLowerCase();
  const hits = [];
  const sections = section ? [section] : Object.keys(idx.sections);
  for (const sec of sections) {
    const items = idx.sections[sec] || [];
    for (const it of items) {
      const haystack = `${it.name} ${it.title || ""} ${it.desc || ""}`.toLowerCase();
      if (!q || haystack.includes(q)) {
        hits.push({ section: sec, ...it });
        if (hits.length >= 30) break;
      }
    }
    if (hits.length >= 30) break;
  }
  return {
    ok: true,
    query,
    section: section || null,
    hits: hits.slice(0, 12),
    total_matched: hits.length,
    overview: hits.length === 0 ? getAtlasOverview() : undefined,
  };
}

export function getAtlasOverview() {
  const idx = loadIndex();
  if (!idx) return "(atlas not generated yet)";
  const s = idx.sections;
  return `Atlas sections (use sub_atlas with keyword OR section to dive in):
- actions (${s.actions?.length || 0}) — substrate actions you can invoke
- personas (${s.personas?.length || 0}) — domain experts: ${(s.personas || []).map(p => p.name).slice(0, 12).join(", ")}
- factory (${s.factory?.length || 0}) — autonomous workers (scanners, scorers, drafters)
- survival (${s.survival?.length || 0}) — substrate plumbing (action runners, ledger)
- cortex (${s.cortex?.length || 0}) — meta-cognition modules
- tolik (${s.tolik?.length || 0}) — Tolik's own modules
- dbs (${s.dbs?.length || 0}) — databases
Use sub_atlas({query:"keyword"}) to find specific bots/modules.`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2] || "build";
  if (cmd === "build") {
    const r = buildAtlas();
    console.log(JSON.stringify(r, null, 2));
  } else if (cmd === "search") {
    const q = process.argv.slice(3).join(" ");
    sub_atlas({ query: q }).then(r => console.log(JSON.stringify(r, null, 2)));
  } else if (cmd === "overview") {
    console.log(getAtlasOverview());
  }
}
