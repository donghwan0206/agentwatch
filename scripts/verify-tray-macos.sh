#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_PATH="${1:-/Applications/AgentWatch.app}"
shift || true
VERIFIER="$SCRIPT_DIR/agentwatch-verify-tray.mjs"
if [[ ! -f "$VERIFIER" ]]; then
  VERIFIER="$SCRIPT_DIR/verify-tray.mjs"
fi

ARGS=(--app "$APP_PATH" "$@")
HAS_REPORT=0
for arg in "$@"; do
  if [[ "$arg" == "--report" ]]; then
    HAS_REPORT=1
    break
  fi
done
if [[ "$HAS_REPORT" == 0 ]]; then
  ARGS+=(--report "${AGENTWATCH_VERIFY_REPORT:-$SCRIPT_DIR/tray-verification-macos.json}")
fi

node "$VERIFIER" "${ARGS[@]}"
