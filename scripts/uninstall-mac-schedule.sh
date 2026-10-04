#!/bin/bash
# Stops the every-2-hours job on this Mac.
PLIST="$HOME/Library/LaunchAgents/com.saltstayz.rateparity.plist"
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "Removed the schedule. Runs will no longer happen automatically."
