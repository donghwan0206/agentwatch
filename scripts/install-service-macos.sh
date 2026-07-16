#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
if [[ -n "${AGENTWATCH_BINARY:-}" ]]; then
  SOURCE_BINARY="$AGENTWATCH_BINARY"
elif [[ -x "$SCRIPT_DIR/agentwatch-server-macOS" ]]; then
  SOURCE_BINARY="$SCRIPT_DIR/agentwatch-server-macOS"
else
  SOURCE_BINARY="$ROOT_DIR/src-tauri/target/release/agentwatch-server"
fi
INSTALL_DIR="${AGENTWATCH_INSTALL_DIR:-$HOME/Library/Application Support/AgentWatch}"
BINARY="${AGENTWATCH_SERVICE_BINARY:-$INSTALL_DIR/agentwatch-server}"
PORT="${AGENTWATCH_PORT:-}"
LABEL="${AGENTWATCH_LAUNCHD_LABEL:-com.agentwatch.monitor}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/AgentWatch"
DRY_RUN="${AGENTWATCH_SERVICE_DRY_RUN:-}"

xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  printf '%s' "$value"
}

if [[ ! -x "$SOURCE_BINARY" ]]; then
  echo "AgentWatch server binary not found or not executable: $SOURCE_BINARY" >&2
  echo "Run: npm run build" >&2
  exit 1
fi

mkdir -p "$(dirname "$PLIST")" "$LOG_DIR" "$INSTALL_DIR"

if [[ "$SOURCE_BINARY" != "$BINARY" ]]; then
  install -m 0755 "$SOURCE_BINARY" "$BINARY"
fi

ESCAPED_LABEL="$(xml_escape "$LABEL")"
ESCAPED_BINARY="$(xml_escape "$BINARY")"
ESCAPED_ROOT_DIR="$(xml_escape "$ROOT_DIR")"
ESCAPED_LOG_DIR="$(xml_escape "$LOG_DIR")"
ESCAPED_HOME="$(xml_escape "$HOME")"

cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$ESCAPED_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$ESCAPED_BINARY</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$ESCAPED_ROOT_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>$ESCAPED_HOME</string>
PLIST

if [[ -n "$PORT" ]]; then
  ESCAPED_PORT="$(xml_escape "$PORT")"
  cat >>"$PLIST" <<PLIST
    <key>AGENTWATCH_PORT</key>
    <string>$ESCAPED_PORT</string>
PLIST
fi

if [[ -n "${AGENTWATCH_DB:-}" ]]; then
  ESCAPED_DB="$(xml_escape "$AGENTWATCH_DB")"
  cat >>"$PLIST" <<PLIST
    <key>AGENTWATCH_DB</key>
    <string>$ESCAPED_DB</string>
PLIST
fi

cat >>"$PLIST" <<PLIST
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$ESCAPED_LOG_DIR/agentwatch.out.log</string>
  <key>StandardErrorPath</key>
  <string>$ESCAPED_LOG_DIR/agentwatch.err.log</string>
</dict>
</plist>
PLIST

if [[ -n "$DRY_RUN" ]]; then
  echo "AgentWatch LaunchAgent dry run: $PLIST"
  if [[ -n "$PORT" ]]; then
    echo "Dashboard: http://127.0.0.1:$PORT"
  else
    echo "Dashboard: configured by ~/.agentwatch/config.json or selected automatically"
  fi
  exit 0
fi

launchctl bootout "gui/$UID" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID" "$PLIST"
launchctl enable "gui/$UID/$LABEL"
launchctl kickstart -k "gui/$UID/$LABEL"

echo "AgentWatch LaunchAgent installed: $PLIST"
if [[ -n "$PORT" ]]; then
  echo "Dashboard: http://127.0.0.1:$PORT"
else
  echo "Dashboard: open the AgentWatch app or check /api/runtime for the selected port"
fi
