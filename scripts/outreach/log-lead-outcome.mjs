/**
 * log-lead-outcome.mjs
 * Logs a single outcome event for an HVAC lead in unified JSONL format.
 * Also updates followup_due_at and next_step in the queue file.
 *
 * Usage:
 *   node scripts/outreach/log-lead-outcome.mjs <id> <outcome> [channel] [notes] [followup_iso]
 *
 * Outcomes: delivered | replied | meeting | refusal | next_step
 * Channels: phone | sms | email | whatsapp | voicemail
 *
 * Examples:
 *   node scripts/outreach/log-lead-outcome.mjs hvac-001 delivered phone
 *   node scripts/outreach/log-lead-outcome.mjs hvac-002 replied phone "interested, call back Mon"
 *   node scripts/outreach/log-lead-outcome.mjs hvac-003 meeting phone "" 2026-04-21T10:00:00
 *   node scripts/outreach/log-lead-outcome.mjs hvac-004 refusal phone "not interested"
 *   node scripts/outreach/log-lead-outcome.mjs hvac-005 next_step phone "send email first" 2026-04-19T09:00:00
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const QUEUE_PATH = '.data/manual-hvac-queue.json';
const LOG_PATH = '.data/hvac-outcome-log.jsonl';

const VALID_OUTCOMES = ['delivered', 'replied', 'meeting', 'refusal', 'next_step'];
const VALID_CHANNELS = ['phone', 'sms', 'email', 'whatsapp', 'voicemail', ''];

function usage() {
  console.error('Usage: node scripts/outreach/log-lead-outcome.mjs <id> <outcome> [channel] [notes] [followup_iso]');
  console.error(`Outcomes: ${VALID_OUTCOMES.join(' | ')}`);
  console.error(`Channels: ${VALID_CHANNELS.filter(Boolean).join(' | ')}`);
  process.exit(1);
}

function loadQueue() {
  if (!existsSync(QUEUE_PATH)) {
    console.error(`Queue not found: ${QUEUE_PATH}`);
    console.error('Run: node scripts/outreach/queue-manual-hvac.mjs');
    process.exit(1);
  }
  return JSON.parse(readFileSync(QUEUE_PATH, 'utf8'));
}

function saveQueue(queue) {
  queue.updatedAt = new Date().toISOString();
  writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2), 'utf8');
}

function appendLog(entry) {
  const dir = dirname(LOG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n', 'utf8');
}

function applyOutcomeToLead(lead, outcome, channel, notes, followupIso) {
  const s = lead.status;

  if (outcome === 'delivered') {
    s.delivered = true;
    if (!s.followup_due_at) {
      const due = new Date();
      due.setHours(due.getHours() + 48);
      s.followup_due_at = due.toISOString();
    }
  } else if (outcome === 'replied') {
    s.delivered = true;
    s.replied = true;
  } else if (outcome === 'meeting') {
    s.delivered = true;
    s.replied = true;
    s.meeting = true;
  } else if (outcome === 'refusal') {
    s.delivered = true;
    s.refusal = true;
    s.followup_due_at = '';
    s.next_step = '';
  } else if (outcome === 'next_step') {
    s.delivered = true;
    if (notes) s.next_step = notes;
  }

  if (followupIso) {
    s.followup_due_at = followupIso;
  }

  if (notes && outcome !== 'next_step') {
    s.notes = notes;
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) usage();

  const [id, outcome, channel = '', notes = '', followupIso = ''] = args;

  if (!VALID_OUTCOMES.includes(outcome)) {
    console.error(`Invalid outcome: ${outcome}`);
    usage();
  }

  const queue = loadQueue();
  const lead = queue.leads.find(l => l.id === id);
  if (!lead) {
    console.error(`Lead not found: ${id}`);
    process.exit(1);
  }

  const entry = {
    ts: new Date().toISOString(),
    id,
    company: lead.company,
    outcome,
    channel: channel || null,
    notes: notes || null,
    followup_due_at: followupIso || null,
  };

  applyOutcomeToLead(lead, outcome, channel, notes, followupIso);
  saveQueue(queue);
  appendLog(entry);

  console.log(`Logged: ${id} ${outcome}${channel ? ' via ' + channel : ''}${notes ? ' - ' + notes : ''}`);
  if (lead.status.followup_due_at) {
    console.log(`Follow-up due: ${lead.status.followup_due_at}`);
  }
  console.log(`Queue saved: ${QUEUE_PATH}`);
  console.log(`Log appended: ${LOG_PATH}`);
}

main();
