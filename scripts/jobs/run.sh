#!/usr/bin/env bash
# Wrapper to run find-jobs.py in the venv.
# Examples:
#   scripts/jobs/run.sh
#   scripts/jobs/run.sh --linkedin --top 30
#   scripts/jobs/run.sh --titles "AI Engineer" "LLM Engineer" --locations Portugal Remote

set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$DIR/.venv/bin/python" "$DIR/find-jobs.py" "$@"
