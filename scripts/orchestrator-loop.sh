#!/usr/bin/env bash
# ORCHESTRATOR LOOP v7 - AUTONOMOUS EXECUTION (not reporting)
# The orchestrator DOES things. It does NOT ask Kirill to do things.
# Kirill wakes up to RESULTS, not TODO lists.

# CRITICAL: cron PATH does not include nvm node directory.
# Claude CLI is a node script with #!/usr/bin/env node shebang.
# Without nvm in PATH, "env node" fails and claude never runs.
# Discovered April 6 2026: orchestrator-loop had been silently failing in cron
# for unknown days because of this. Same root cause as cron timezone bug fixed
# earlier today. Fix: prepend nvm bin to PATH so subprocess shebang resolution
# works in cron context.
export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

set -euo pipefail

PROJECT_DIR="$CLAUDE_PROJECT_DIR"
LOG_FILE="$PROJECT_DIR/.logs/orchestrator-loop.log"
DECISIONS_FILE="$PROJECT_DIR/.logs/orchestrator-decisions.log"
LOCK_FILE="$PROJECT_DIR/.data/orchestrator-loop.pid"
PROMPT_FILE="$PROJECT_DIR/.data/loop-prompt.txt"
CLAUDE_BIN="$HOME/.nvm/versions/node/v22.22.2/bin/claude"

CYCLE_LOG="$PROJECT_DIR/.logs/orchestrator-cycles.jsonl"
HEALTH_LOG="$PROJECT_DIR/.logs/orchestrator-health.log"
NOW_ISO=$(date -u +%Y-%m-%dT%H:%M:%S)

# ─── Stale lock detection (harness pattern) ────────────────────────────────
# Lock is considered stale if: file exists AND (process not alive OR file older than 15min)
if [ -f "$LOCK_FILE" ]; then
  OLD_PID=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
  LOCK_AGE_SEC=$(( $(date +%s) - $(stat -f %m "$LOCK_FILE" 2>/dev/null || echo 0) ))
  STALE=0
  if [ -z "$OLD_PID" ] || ! kill -0 "$OLD_PID" 2>/dev/null; then STALE=1; fi
  if [ "$LOCK_AGE_SEC" -gt 900 ]; then STALE=1; fi
  if [ "$STALE" = "1" ]; then
    echo "$NOW_ISO STALE_LOCK pid=$OLD_PID age=${LOCK_AGE_SEC}s - clearing" >> "$HEALTH_LOG"
    rm -f "$LOCK_FILE"
  else
    echo "$NOW_ISO Skipping - already running (PID $OLD_PID, age ${LOCK_AGE_SEC}s)" >> "$LOG_FILE"
    exit 0
  fi
fi
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE" "$PROMPT_FILE"' EXIT

cd "$PROJECT_DIR"

# ─── Health check before spending tokens on Claude (harness pattern) ───────
HEALTH_OK=1
HEALTH_REASONS=""
if [ ! -r ".data/linkedin-brand-os.sqlite" ]; then HEALTH_OK=0; HEALTH_REASONS="$HEALTH_REASONS db_unreadable"; fi
if [ ! -f "apps/api/.env" ]; then HEALTH_OK=0; HEALTH_REASONS="$HEALTH_REASONS env_missing"; fi
if ! sqlite3 .data/linkedin-brand-os.sqlite "SELECT 1" >/dev/null 2>&1; then HEALTH_OK=0; HEALTH_REASONS="$HEALTH_REASONS db_query_failed"; fi
if [ "$HEALTH_OK" = "0" ]; then
  echo "$NOW_ISO HEALTH_FAIL reasons=$HEALTH_REASONS - skipping cycle" >> "$HEALTH_LOG"
  echo "$NOW_ISO Cycle skipped (health check failed:$HEALTH_REASONS)" >> "$LOG_FILE"
  echo "{\"ts\":\"$NOW_ISO\",\"branch\":\"HEALTH_FAIL\",\"reasons\":\"$HEALTH_REASONS\"}" >> "$CYCLE_LOG"
  exit 0
fi

CYCLE_NUM=$(grep -c "LOOP START" "$LOG_FILE" 2>/dev/null || echo "0")
echo "$NOW_ISO === ORCHESTRATOR LOOP START (cycle $CYCLE_NUM) ===" >> "$LOG_FILE"

bash "$PROJECT_DIR/scripts/compact-decisions.sh" 2>/dev/null || true

STATE=$(node -e "
const D=require('better-sqlite3');const fs=require('fs');const d=new D('.data/linkedin-brand-os.sqlite');const out={};
const e=d.prepare('SELECT status,COUNT(*) as c FROM outreach_emails GROUP BY status').all();out.emails={};e.forEach(r=>out.emails[r.status]=r.c);
out.emails.total_replied=d.prepare('SELECT COUNT(*) as c FROM outreach_emails WHERE reply_received_at IS NOT NULL').get().c;
const ICP='landscaping,plumbers,electricians,hvac,roofing,moving-companies,auto-repair,cleaning-services,garage-door'.split(',');
out.icp_sent=d.prepare('SELECT COUNT(*) as c FROM outreach_emails WHERE status=\'sent\' AND business_category IN ('+ICP.map(()=>'?').join(',')+')').get(...ICP).c;
out.icp_replied=d.prepare('SELECT COUNT(*) as c FROM outreach_emails WHERE status=\'replied\' AND business_category IN ('+ICP.map(()=>'?').join(',')+') AND reply_body NOT LIKE \'%AUTO-REPLY%\' AND reply_body NOT LIKE \'%remove%\'').get(...ICP).c;
out.wrong_category_sent=d.prepare('SELECT COUNT(*) as c FROM outreach_emails WHERE status=\'sent\' AND business_category NOT IN ('+ICP.map(()=>'?').join(',')+')').get(...ICP).c;
const h=d.prepare(\"SELECT bot_id,health_status FROM bot_heartbeats WHERE health_status IN ('error','degraded')\").all();
out.bots_problems=h.map(b=>b.bot_id+'='+b.health_status);
d.close();console.log(JSON.stringify(out));
" 2>/dev/null || echo '{"error":"state query failed"}')

LAST_DECISIONS=$(tail -c 800 "$DECISIONS_FILE" 2>/dev/null || echo "None")

cat > "$PROMPT_FILE" << 'ENDPROMPT'
<role>You are the AUTONOMOUS ORCHESTRATOR for Kirill's revenue system. You EXECUTE. You do not propose, ask, or send TODO lists. Kirill sees results in Telegram, not instructions.</role>

<goal>First $750 paid client from a service-business owner in Calgary.</goal>

<tools>
Available scripts. Use Bash to invoke. Each line: command - what it does - when to use - when NOT to use.

node scripts/outreach/send-ready-batch.mjs - sends pre-approved ICP emails from launchsoloai.com - when icp_sent_today < 5 and queue has approved drafts - never if domain is on warmup pause
node scripts/outreach/monitor-replies.mjs - polls IMAP for replies on sent emails - every cycle - never twice in same cycle
node scripts/outreach/send-followups.mjs - sends scheduled follow-ups whose timer is due - when state.followups_due > 0 - never if reply already received on that thread
node scripts/factory/scout-bot.mjs - finds new ICP leads from Reddit pain signals - when daily lead pipeline < 20 - not before send-ready-batch (fill pipe AFTER sending what's ready)
node scripts/factory/research-bot.mjs <lead_id> - enriches one lead with website + Google data - when a new lead has no enrichment - not on already-enriched leads
node scripts/factory/deal-assist.mjs <thread_id> - drafts a reply to an incoming customer email and sends to Telegram for Kirill review - the moment a meaningful reply is detected - never auto-send the draft

Read tool - inspect current state of any file
Edit tool - patch a file (only with prior Read)
Bash tool - run scripts above and shell utilities

Each tool is a junior-dev contract: clear input, deterministic output, single responsibility. If the right tool does not exist, write a one-paragraph brief in .data/orchestrator/tool-requests.md and continue with what exists.
</tools>

<routing>
HARD RULE: Pick exactly ONE branch per cycle. Even if multiple branches qualify, pick the FIRST one in this list whose condition is true and STOP evaluating. The next cron tick (in 30 min) will pick the next branch. Do not combine branches. Do not chain "while we're at it".

Evaluation order (first match wins, no further checks):
1. If state.new_replies_since_last > 0 -> branch REPLY: run deal-assist for the newest reply, send draft to Telegram, EXIT.
2. If state.followups_due > 0 -> branch FOLLOWUP: run send-followups, EXIT.
3. If state.icp_sent_today < 5 AND queue has approved drafts -> branch SEND: run send-ready-batch, EXIT.
4. If state.lead_pipeline < 20 -> branch SCOUT: run scout-bot then one research-bot, EXIT.
5. Otherwise -> branch IDLE: log "no action this cycle" and EXIT.

Why one branch only: parallel execution makes failures un-attributable, doubles error blast radius, and hides which branch is broken when something regresses.
</routing>

<execution_format>
You will run EXACTLY ONE Bash tool call this cycle. Not zero. Not two. ONE. Then write the REPORT and stop.

Output exactly these four blocks, in order, nothing else:

BRANCH: <REPLY|FOLLOWUP|SEND|SCOUT|IDLE> + the state value that triggered it
COMMAND: <the single bash command you will run, or "none" for IDLE>
RESULT: <after running, exactly what the command returned in 1-2 sentences, including exit code or error>
NEXT: <one sentence: what state value the next cycle should check first>

Hard constraints on this format:
- COMMAND must be exactly one shell command. No "&&", no ";", no chained tools. No invented commands - only commands listed in <tools>.
- If you find yourself wanting to also do X "while we're at it" - DO NOT. Stop. The next cycle exists for X.
- If the command from <tools> for your branch does not exist or is broken - BRANCH=IDLE, COMMAND=none, RESULT explains why, and stop.
- Append the REPORT (BRANCH+RESULT lines) to .logs/orchestrator-decisions.log via a SECOND bash call only if the first call succeeded. The append is the only allowed second call.
</execution_format>

<hard_rules>
- Never send TODO lists or action plans to Kirill
- Never ask "should I do X" - decide and do
- Never use sender contact.calgarygrowth@gmail.com (BURNED)
- Never send to non-ICP categories. ICP: landscaping, plumbers, electricians, hvac, roofing, cleaning-services, moving-companies, auto-repair, garage-door
- Never use em dashes in external text - use short hyphen
- Never claim "system works" or "fixed" without runtime verification (Ground Truth rule)
- Never silently catch errors and continue - if a tool fails, REPORT it
</hard_rules>

<stopping_conditions>
Stop and exit cycle when:
- Branch executed successfully and REPORT logged
- Same action attempted 2 cycles in a row with no state change (the loop is degenerate, log it and stop)
- Any tool returns an error you cannot diagnose in one Read - log it and stop
</stopping_conditions>
ENDPROMPT

# Append dynamic state after the static prompt
cat >> "$PROMPT_FILE" << ENDSTATE

SYSTEM STATE:
$STATE

PREVIOUS DECISIONS (do NOT repeat same action):
$LAST_DECISIONS

Use the routing block above to pick exactly one branch from the SYSTEM STATE. Output PLAN, EXECUTE, REPORT, NEXT in that exact order. Append REPORT to .logs/orchestrator-decisions.log.
ENDSTATE

cat "$PROMPT_FILE" | $CLAUDE_BIN -p --output-format text --max-turns 5 --allowedTools "Bash,Read" >> "$LOG_FILE" 2>&1 || true

END_ISO=$(date -u +%Y-%m-%dT%H:%M:%S)
echo "$END_ISO === ORCHESTRATOR LOOP END ===" >> "$LOG_FILE"
echo "{\"cycle\": $CYCLE_NUM, \"timestamp\": \"$END_ISO\", \"estimated_cost_usd\": 0.08}" >> "$PROJECT_DIR/.logs/loop-costs.jsonl"

# Structured cycle log: extract BRANCH/COMMAND from the loop output for observability
LAST_BRANCH=$(grep -m1 "^BRANCH:" "$LOG_FILE" | tail -1 | head -c 200 || echo "UNKNOWN")
echo "{\"ts\":\"$END_ISO\",\"cycle\":$CYCLE_NUM,\"start\":\"$NOW_ISO\",\"end\":\"$END_ISO\",\"line\":\"$LAST_BRANCH\"}" >> "$CYCLE_LOG"
