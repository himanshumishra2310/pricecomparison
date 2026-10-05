#!/bin/bash
# One-command setup of the office Mac as the main crawler. Safe to run again.
#   cd pricecomparison && scripts/setup-mac.sh
# It checks everything the 2-hourly job needs, tests it on one property, and only then switches the schedule on.
set -u
cd "$(dirname "$0")/.."
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
bad()  { printf "  \033[31m✗\033[0m %s\n" "$1"; }
step() { printf "\n\033[1m%s\033[0m\n" "$1"; }
die()  { bad "$1"; echo; echo "Fix this and run scripts/setup-mac.sh again."; exit 1; }

step "1. Tools"
export PATH="$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
command -v git >/dev/null || die "git is missing. Install it with: xcode-select --install"
ok "git found"
if ! command -v node >/dev/null; then
  echo "  Node.js is not installed. Installing it now (no admin password needed)..."
  if command -v brew >/dev/null; then brew install node >/dev/null 2>&1 || die "Could not install Node with Homebrew"
  else scripts/install-node-mac.sh || die "Could not download Node. Check the internet connection, or install Node 20+ from https://nodejs.org"
  fi
  export PATH="$HOME/.local/node/bin:$PATH"
  command -v node >/dev/null || die "Node is still not found after installing"
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || die "Node $NODE_MAJOR is too old. Install Node 20 or newer."
ok "Node $(node -v)"
if [ -d "/Applications/Google Chrome.app" ]; then ok "Google Chrome found"; else
  export BROWSER_CHANNEL=""; echo "  Google Chrome not found. Installing the built-in browser instead..."
  npx playwright install chromium >/dev/null 2>&1 && ok "Built-in Chromium installed" || die "Could not install a browser"
fi
npm install --no-audit --no-fund >/dev/null 2>&1 && ok "Project packages installed" || die "npm install failed"

step "2. GitHub login (the Mac must be able to push results without asking for a password)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
GH_USER="himanshumishra2310"
git config --global credential.helper osxkeychain >/dev/null 2>&1 || true
can_push() { GIT_TERMINAL_PROMPT=0 git push --dry-run origin "HEAD:$BRANCH" >/dev/null 2>&1; }
if can_push; then ok "Can push to GitHub ($BRANCH)"; else
  echo "  GitHub does not accept your account password for Git. It needs a one-time access token instead."
  echo "  (Being signed in to github.com in the browser, including with Gmail, does not count for Git.)"
  echo
  echo "  Do this once. It takes about 2 minutes:"
  echo "    1. Open https://github.com/settings/personal-access-tokens/new  (sign in with Gmail as usual)"
  echo "    2. Token name: saltstayz-office-mac      Expiration: 1 year"
  echo "    3. Repository access: 'Only select repositories' > choose 'pricecomparison'"
  echo "    4. Permissions > Repository permissions > Contents: 'Read and write'"
  echo "    5. Click 'Generate token' and copy it (it starts with github_pat_)"
  echo
  open "https://github.com/settings/personal-access-tokens/new" >/dev/null 2>&1 || true
  for attempt in 1 2 3; do
    printf "  Paste the token here (it will not show on screen), then press Return: "
    read -r -s TOKEN; echo
    [ -n "$TOKEN" ] || { bad "Nothing pasted."; continue; }
    printf 'protocol=https\nhost=github.com\nusername=%s\npassword=%s\n\n' "$GH_USER" "$TOKEN" | git credential approve
    TOKEN=""
    if can_push; then ok "Token saved in the Mac keychain. Can push to GitHub ($BRANCH)"; break; fi
    printf 'protocol=https\nhost=github.com\nusername=%s\n\n' "$GH_USER" | git credential reject
    bad "GitHub rejected that token. Check it is for the 'pricecomparison' repository with Contents: Read and write."
    [ "$attempt" -eq 3 ] && die "GitHub login still not working"
  done
  echo "  Note: this token expires in 1 year. Put a reminder in the calendar to make a new one and re-run this setup."
fi

step "3. Is this connection in India? (Google must list MakeMyTrip and Goibibo)"
mkdir -p logs
HEADLESS=true DEBUG_SCREENSHOTS=0 BROWSER_CHANNEL="${BROWSER_CHANNEL-chrome}" BROWSER_PROFILE_DIR=.profile node scripts/check-india.js 2>&1 | sed 's/^/  /'
if [ "${PIPESTATUS[0]}" -eq 0 ]; then ok "MakeMyTrip / Goibibo are visible from this connection"; else
  bad "Google does not show MakeMyTrip or Goibibo from this connection."
  echo "     This Mac must be on an Indian internet connection (office broadband, no VPN to another country)."
  echo "     If it is, send the lines above to the person who set this up."
  die "Not an Indian view of Google"
fi

step "4. Alerts (optional)"
if [ -f .env ]; then ok ".env found (email / WhatsApp settings are read from it)"; else
  cp .env.example .env; echo "  Created .env from the example. Fill in the email / WhatsApp lines whenever you are ready:"; echo "     open -e $(pwd)/.env"
fi
if [ -z "${BROWSER_CHANNEL-x}" ] && ! grep -q '^BROWSER_CHANNEL=' .env; then echo 'BROWSER_CHANNEL=' >> .env; fi

step "5. Switch on the every-2-hours schedule"
scripts/install-mac-schedule.sh && ok "Schedule installed. The first full run is starting now (takes about 10 to 15 minutes)."

step "Done"
echo "  Dashboard : https://himanshumishra2310.github.io/pricecomparison/"
echo "  Logs      : $(pwd)/logs/   (tail -f logs/\$(date +%F).log)"
echo "  Keep this Mac plugged in, on the office network, and logged in. In System Settings > Battery (or Energy),"
echo "  turn on 'Prevent automatic sleeping when the display is off'."
echo "  If the Mac is off, GitHub covers for it automatically after 3 hours (without MakeMyTrip and Goibibo)."
