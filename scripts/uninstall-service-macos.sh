#!/usr/bin/env bash
set -euo pipefail

LABEL="${AGENTWATCH_LAUNCHD_LABEL:-com.agentwatch.monitor}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
INSTALL_DIR="${AGENTWATCH_INSTALL_DIR:-$HOME/Library/Application Support/AgentWatch}"
INSTALLED_BINARY="${AGENTWATCH_SERVICE_BINARY:-$INSTALL_DIR/agentwatch-server}"

launchctl bootout "gui/$UID" "$PLIST" >/dev/null 2>&1 || true
rm -f "$PLIST"
rm -f "$INSTALLED_BINARY"

echo "AgentWatch LaunchAgent removed: $LABEL"
