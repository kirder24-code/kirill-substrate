#!/bin/bash
# add-cron-entry.sh - Always adds cron entry with required cd + log redirect.
# Usage: add-cron-entry.sh "<schedule>" "<script_relative_path>" "<log_name>"
# Example: add-cron-entry.sh "0 4 * * *" "scripts/outreach/find-businesses.mjs" "find-businesses"
#
# Created Apr 7 2026 after forgetting `cd` 3 times in one session despite the rule.
set -e

if [ $# -ne 3 ]; then
  echo "usage: $0 <schedule> <script_path> <log_name>"
  echo "example: $0 '0 4 * * *' scripts/outreach/find-businesses.mjs find-businesses"
  exit 1
fi

SCHED="$1"
SCRIPT="$2"
LOGNAME="$3"
PROJECT="$CLAUDE_PROJECT_DIR"
NODE="$HOME/.nvm/versions/node/v22.22.2/bin/node"

ENTRY="$SCHED cd $PROJECT && $NODE $SCRIPT >> /tmp/lbo-$LOGNAME.log 2>&1"

# Check if already present
if crontab -l 2>/dev/null | grep -qF "$SCRIPT"; then
  echo "[add-cron] $SCRIPT already in crontab, skipping"
  crontab -l | grep -F "$SCRIPT"
  exit 0
fi

(crontab -l 2>/dev/null; echo "$ENTRY") | crontab -
echo "[add-cron] added: $ENTRY"
