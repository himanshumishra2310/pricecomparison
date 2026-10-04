#!/bin/bash
# Installs a launchd job that runs scripts/run-mac.sh every 2 hours on this Mac.
# launchd (not cron) is used because it also catches up after the Mac wakes from sleep.
set -e
cd "$(dirname "$0")/.."
REPO="$(pwd)"
LABEL="com.saltstayz.rateparity"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$REPO/logs"
chmod +x "$REPO/scripts/run-mac.sh"

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$REPO/scripts/run-mac.sh</string></array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>StartInterval</key><integer>7200</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$REPO/logs/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$REPO/logs/launchd.err.log</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
</dict>
</plist>
PL

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Installed. The checker now runs every 2 hours (and once right now)."
echo "Logs: $REPO/logs/   Stop it with: scripts/uninstall-mac-schedule.sh"
