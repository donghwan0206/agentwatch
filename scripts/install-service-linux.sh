#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_BINARY="${AGENTWATCH_BINARY:-$ROOT_DIR/src-tauri/target/release/agentwatch-server}"
INSTALL_DIR="${AGENTWATCH_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/agentwatch}"
BINARY="${AGENTWATCH_SERVICE_BINARY:-$INSTALL_DIR/agentwatch-server}"
PORT="${AGENTWATCH_PORT:-}"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/agentwatch.service"
DRY_RUN="${AGENTWATCH_SERVICE_DRY_RUN:-}"

if [[ -z "$DRY_RUN" ]] && ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl is required for Linux user service installation." >&2
  exit 1
fi

if [[ ! -x "$SOURCE_BINARY" ]]; then
  echo "AgentWatch server binary not found or not executable: $SOURCE_BINARY" >&2
  echo "Run: npm run build" >&2
  exit 1
fi

mkdir -p "$UNIT_DIR" "$INSTALL_DIR"

if [[ "$SOURCE_BINARY" != "$BINARY" ]]; then
  install -m 0755 "$SOURCE_BINARY" "$BINARY"
fi

cat >"$UNIT" <<UNIT
[Unit]
Description=AgentWatch Rust monitor server
After=network-online.target

[Service]
Type=simple
WorkingDirectory="$INSTALL_DIR"
ExecStart="$BINARY"
Restart=always
RestartSec=3
UNIT

if [[ -n "$PORT" ]]; then
  cat >>"$UNIT" <<UNIT
Environment="AGENTWATCH_PORT=$PORT"
UNIT
fi

if [[ -n "${AGENTWATCH_DB:-}" ]]; then
  cat >>"$UNIT" <<UNIT
Environment="AGENTWATCH_DB=$AGENTWATCH_DB"
UNIT
fi

cat >>"$UNIT" <<UNIT

[Install]
WantedBy=default.target
UNIT

if [[ -n "$DRY_RUN" ]]; then
  echo "AgentWatch systemd user service dry run: $UNIT"
  echo "Installed binary: $BINARY"
  if [[ -n "$PORT" ]]; then
    echo "Dashboard: http://127.0.0.1:$PORT"
  else
    echo "Dashboard: configured by ~/.agentwatch/config.json or selected automatically"
  fi
  exit 0
fi

systemctl --user daemon-reload
systemctl --user enable --now agentwatch.service

if command -v loginctl >/dev/null 2>&1; then
  loginctl enable-linger "$USER" >/dev/null 2>&1 || true
fi

echo "AgentWatch systemd user service installed: $UNIT"
echo "Installed binary: $BINARY"
if [[ -n "$PORT" ]]; then
  echo "Dashboard: http://127.0.0.1:$PORT"
else
  echo "Dashboard: check /api/runtime for the selected port"
fi
