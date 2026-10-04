#!/bin/bash
# One rate-parity run on a Mac: crawl Google Hotels in Chrome, rebuild the dashboard,
# then push the results to GitHub so the online dashboard updates.
# Called by launchd every 2 hours (see install-mac-schedule.sh), or run it by hand.
set -u
cd "$(dirname "$0")/.."

# Make sure Homebrew / nvm node is on PATH when launched by launchd.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:$PATH"

# Load alert settings if present (.env is never committed).
if [ -f .env ]; then set -a; . ./.env; set +a; fi

export PROVIDER="${PROVIDER:-browser}"
export BROWSER_CHANNEL="${BROWSER_CHANNEL:-chrome}"
export BROWSER_PROFILE_DIR="${BROWSER_PROFILE_DIR:-.profile}"
export SCHEDULER="launchd on $(scutil --get ComputerName 2>/dev/null || hostname)"
export DEBUG_DIR="${DEBUG_DIR:-debug}"

mkdir -p logs
LOG="logs/$(date '+%Y-%m-%d').log"
echo "===== $(date '+%Y-%m-%d %H:%M:%S') start =====" >> "$LOG"

node src/run.js >> "$LOG" 2>&1
STATUS=$?
echo "run exit code $STATUS" >> "$LOG"

# Push results so the GitHub Pages dashboard updates.
if [ "${PUSH_RESULTS:-1}" = "1" ]; then
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  git add data docs >> "$LOG" 2>&1
  if git diff --cached --quiet; then
    echo "nothing to push" >> "$LOG"
  else
    git commit -q -m "Rate parity run $(date '+%Y-%m-%d %H:%M IST')" >> "$LOG" 2>&1
    git pull --rebase -q origin "$BRANCH" >> "$LOG" 2>&1 || true
    git push -q origin "HEAD:$BRANCH" >> "$LOG" 2>&1 && echo "pushed to $BRANCH" >> "$LOG" || echo "PUSH FAILED (check git login)" >> "$LOG"
  fi
fi

# Keep only the last 14 days of logs and debug screenshots.
find logs -name '*.log' -mtime +14 -delete 2>/dev/null
find "$DEBUG_DIR" -type f -mtime +2 -delete 2>/dev/null
echo "===== $(date '+%Y-%m-%d %H:%M:%S') end =====" >> "$LOG"
exit $STATUS
