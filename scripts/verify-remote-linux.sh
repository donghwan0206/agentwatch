#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFIER="$SCRIPT_DIR/agentwatch-verify-remote-client.mjs"
if [[ ! -f "$VERIFIER" ]]; then
  VERIFIER="$SCRIPT_DIR/verify-remote-client.mjs"
fi

if [[ -z "${AGENTWATCH_REMOTE_URL:-}" && "${1:-}" != "--url" ]]; then
  echo "Usage: $0 --url http://<agent-machine-ip>:<selected-port> [--report remote-client-verification-linux.json]" >&2
  exit 2
fi

ARGS=("$@")
HAS_REPORT=0
for arg in "$@"; do
  if [[ "$arg" == "--report" ]]; then
    HAS_REPORT=1
    break
  fi
done
if [[ "$HAS_REPORT" == 0 ]]; then
  ARGS+=(--report "${AGENTWATCH_REMOTE_REPORT:-$SCRIPT_DIR/remote-client-verification-linux.json}")
fi

node "$VERIFIER" "${ARGS[@]}"
