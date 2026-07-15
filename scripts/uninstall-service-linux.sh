#!/usr/bin/env bash
set -euo pipefail

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/agentwatch.service"
INSTALL_DIR="${AGENTWATCH_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/agentwatch}"
INSTALLED_BINARY="${AGENTWATCH_SERVICE_BINARY:-$INSTALL_DIR/agentwatch-server}"

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user disable --now agentwatch.service >/dev/null 2>&1 || true
  systemctl --user daemon-reload >/dev/null 2>&1 || true
fi

rm -f "$UNIT"
rm -f "$INSTALLED_BINARY"

echo "AgentWatch systemd user service removed"
