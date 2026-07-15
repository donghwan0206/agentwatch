#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_PATH="${1:-/Applications/AgentWatch.app}"
shift || true

VERIFIER="$SCRIPT_DIR/agentwatch-verify-tray.mjs"
if [[ ! -f "$VERIFIER" ]]; then
  VERIFIER="$SCRIPT_DIR/verify-tray.mjs"
fi

REPORT="${AGENTWATCH_VERIFY_REPORT:-$SCRIPT_DIR/tray-verification-macos.json}"
SCREENSHOT="${AGENTWATCH_MACOS_TRAY_SCREENSHOT:-$SCRIPT_DIR/screenshots/macos-menu-bar.png}"
REGION="${AGENTWATCH_MACOS_SCREENSHOT_REGION:-0,0,1800,140}"
CAPTURE_DELAY_SECONDS="${AGENTWATCH_MACOS_CAPTURE_DELAY_SECONDS:-3}"
HOLD_MS="${AGENTWATCH_VERIFY_HOLD_MS:-7000}"
VERIFY_PID=""

cleanup() {
  if [[ -n "$VERIFY_PID" ]] && kill -0 "$VERIFY_PID" >/dev/null 2>&1; then
    kill "$VERIFY_PID" >/dev/null 2>&1 || true
    wait "$VERIFY_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

USER_ARGS=("$@")
for ((index = 0; index < ${#USER_ARGS[@]}; index += 1)); do
  if [[ "${USER_ARGS[$index]}" == "--screenshot" && $((index + 1)) -lt ${#USER_ARGS[@]} ]]; then
    SCREENSHOT="${USER_ARGS[$((index + 1))]}"
  fi
  if [[ "${USER_ARGS[$index]}" == "--report" && $((index + 1)) -lt ${#USER_ARGS[@]} ]]; then
    REPORT="${USER_ARGS[$((index + 1))]}"
  fi
done

mkdir -p "$(dirname "$SCREENSHOT")"

ARGS=(--app "$APP_PATH" "${USER_ARGS[@]}")
HAS_REPORT=0
HAS_SCREENSHOT=0
for arg in "${USER_ARGS[@]}"; do
  if [[ "$arg" == "--report" ]]; then
    HAS_REPORT=1
  fi
  if [[ "$arg" == "--screenshot" ]]; then
    HAS_SCREENSHOT=1
  fi
done
if [[ "$HAS_REPORT" == 0 ]]; then
  ARGS+=(--report "$REPORT")
fi
if [[ "$HAS_SCREENSHOT" == 0 ]]; then
  ARGS+=(--screenshot "$SCREENSHOT")
fi

AGENTWATCH_VERIFY_HOLD_MS="$HOLD_MS" \
  node "$VERIFIER" "${ARGS[@]}" &
VERIFY_PID=$!

sleep "$CAPTURE_DELAY_SECONDS"
screencapture -x -R "$REGION" "$SCREENSHOT"

wait "$VERIFY_PID"
VERIFY_PID=""

echo "macOS menu-bar screenshot: $SCREENSHOT"
