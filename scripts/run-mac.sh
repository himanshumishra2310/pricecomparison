#!/bin/bash
# One rate-parity run on a Mac: crawl Google Hotels in Chrome from an Indian connection, rebuild the
# dashboard, then push the results to GitHub so the online dashboard updates.
# Called by launchd every 2 hours (see install-mac-schedule.sh), or run it by hand.
set -u
cd "$(dirname "$0")/.."

# Make sure Homebrew / nvm node is on PATH when launched by launchd.
export PATH="$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:$PATH"

# Load alert settings if present (.env is never committed).
if [ -f .env ]; then set -a; . ./.env; set +a; fi

export PROVIDER="${PROVIDER:-browser}"
export BROWSER_CHANNEL="${BROWSER_CHANNEL-chrome}"
export BROWSER_PROFILE_DIR="${BROWSER_PROFILE_DIR:-.profile}"
export SCHEDULER="office Mac ($(scutil --get ComputerName 2>/dev/null || hostname))"
export DEBUG_DIR="${DEBUG_DIR:-debug}"
export DEBUG_SCREENSHOTS=0

mkdir -p logs
LOG="logs/$(date '+%Y-%m-%d').log"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
notify() { osascript -e "display notification \"$1\" with title \"Saltstayz rate parity\"" >/dev/null 2>&1 || true; }
echo "===== $(date '+%Y-%m-%d %H:%M:%S') start =====" >> "$LOG"

# Start from the latest saved state (alerts say "new" / "resolved" against the previous run, even one GitHub made).
git pull --rebase -q -X theirs origin "$BRANCH" >> "$LOG" 2>&1 || git rebase --abort >> "$LOG" 2>&1

# caffeinate stops the Mac from going to sleep while the crawl runs.
caffeinate -i node src/run.js >> "$LOG" 2>&1
STATUS=$?
echo "run exit code $STATUS" >> "$LOG"
[ $STATUS -ne 0 ] && notify "The crawl failed. See logs/ in the pricecomparison folder."

# Warn if Google did not show MakeMyTrip / Goibibo (the Mac is not on an Indian connection, or Google changed).
if grep -q "Indian OTAs (MakeMyTrip / Goibibo) seen: NO" "$LOG"; then notify "Google is not showing MakeMyTrip or Goibibo from this connection."; fi

# Push results so the dashboard updates. -X theirs keeps this Mac's fresh results if GitHub pushed at the same time.
if [ "${PUSH_RESULTS:-1}" = "1" ]; then
  git add data docs >> "$LOG" 2>&1
  if git diff --cached --quiet; then
    echo "nothing to push" >> "$LOG"
  else
    git commit -q -m "Rate parity run $(date '+%Y-%m-%d %H:%M') (office Mac)" >> "$LOG" 2>&1
    git pull --rebase -q -X theirs origin "$BRANCH" >> "$LOG" 2>&1 || git rebase --abort >> "$LOG" 2>&1
    if git push -q origin "HEAD:$BRANCH" >> "$LOG" 2>&1; then
      echo "pushed to $BRANCH" >> "$LOG"
    else
      echo "PUSH FAILED (check git login)" >> "$LOG"
      notify "Could not push results to GitHub. Check the GitHub login on this Mac."
    fi
  fi
fi

# Keep only the last 14 days of logs and the last 2 days of debug files.
find logs -name '*.log' -mtime +14 -delete 2>/dev/null
find "$DEBUG_DIR" -type f -mtime +2 -delete 2>/dev/null
echo "===== $(date '+%Y-%m-%d %H:%M:%S') end =====" >> "$LOG"
exit $STATUS
