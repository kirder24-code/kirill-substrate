#!/usr/bin/env node
/**
 * update-snapshot.mjs
 * Reads system state from multiple sources and writes a fresh SNAPSHOT.md.
 * Can be called from hooks, cron, or manually: node scripts/update-snapshot.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(ROOT, '.data');
const SNAPSHOT_PATH = join(ROOT, '.claude', 'SNAPSHOT.md');

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function readLinesSafe(path, count) {
  try {
    const text = readFileSync(path, 'utf-8');
    return text.split('\n').slice(0, count).join('\n');
  } catch {
    return '';
  }
}

function countDaemons() {
  try {
    const out = execSync(
      'ps aux | grep -E "(orchestrator|sonnet-bots|telegram-control)" | grep -v grep | wc -l',
      { encoding: 'utf-8' }
    );
    return parseInt(out.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function queryDb() {
  const dbPath = join(DATA, 'linkedin-brand-os.sqlite');
  if (!existsSync(dbPath)) return { leads: 0, sent: 0, replies: 0 };

  const db = new Database(dbPath, { readonly: true });
  try {
    const leads = db.prepare('SELECT COUNT(*) AS c FROM leads').get().c;
    const sent = db.prepare("SELECT COUNT(*) AS c FROM outreach_emails WHERE status='sent'").get().c;
    const replies = db.prepare('SELECT COUNT(*) AS c FROM outreach_emails WHERE reply_received_at IS NOT NULL').get().c;
    return { leads, sent, replies };
  } finally {
    db.close();
  }
}

function buildHypothesisLine(discovery) {
  if (!discovery?.activeHypothesis) return 'None active';
  const h = discovery.activeHypothesis;
  const conf = h.confidence ? ` ${h.confidence} confidence` : '';
  const started = h.startedAt ? ` Started ${h.startedAt.slice(0, 10)}.` : '';
  return `${h.market?.slice(0, 120) || 'Unknown'} -${conf}.${started}`;
}

function buildDirectiveLine(directivesText) {
  if (!directivesText) return 'Unknown';
  // Look for the ## Bottleneck or ## Analysis section
  const lines = directivesText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('## Analysis') || lines[i].startsWith('## Bottleneck')) {
      // Return the next non-empty line
      for (let j = i + 1; j < lines.length && j < i + 4; j++) {
        const trimmed = lines[j].trim();
        if (trimmed && !trimmed.startsWith('#')) return trimmed.slice(0, 200);
      }
    }
  }
  return 'See wiki/directives.md';
}

// --- Main ---

const discovery = readJsonSafe(join(DATA, 'cortex-discovery-state.json'));
const loopState = readJsonSafe(join(DATA, 'orchestrator-loop-state.json'));
const directivesText = readLinesSafe(join(ROOT, 'wiki', 'directives.md'), 15);
const missionText = readLinesSafe(join(ROOT, 'MISSION.md'), 5);

const { leads, sent, replies } = queryDb();
const daemons = countDaemons();

const branch = loopState?.branch || 'unknown';
const cycleNum = loopState?.cycleNum || '?';
const directiveLine = buildDirectiveLine(directivesText);
const hypothesisLine = buildHypothesisLine(discovery);

const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

const snapshot = `# SNAPSHOT - System State
Last updated: ${now}

## Revenue
$0 | Target: first paying client

## Pipeline
- Leads: ${leads} total
- Emails sent: ${sent}, replies: ${replies}
- Active hypothesis: ${hypothesisLine}

## System Health
- Daemons: ${daemons}/3 alive
- Last orchestrator action: ${branch} (cycle ${cycleNum})
- Last brain directive: ${directiveLine}

## Current Session Focus
<empty - filled during session>

## Blockers
<empty - filled during session>
`;

writeFileSync(SNAPSHOT_PATH, snapshot, 'utf-8');
console.log(`SNAPSHOT.md updated at ${now}`);
console.log(`  Leads: ${leads} | Sent: ${sent} | Replies: ${replies} | Daemons: ${daemons}/3`);
