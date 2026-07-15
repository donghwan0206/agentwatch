#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFIER="$SCRIPT_DIR/agentwatch-verify-service.mjs"
if [[ ! -f "$VERIFIER" ]]; then
  VERIFIER="$SCRIPT_DIR/verify-service.mjs"
fi

ARGS=(--report "${AGENTWATCH_SERVICE_REPORT:-$SCRIPT_DIR/service-verification-macos.json}")
if [[ -n "${AGENTWATCH_SERVICE_URL:-}" ]]; then
  ARGS=(--url "$AGENTWATCH_SERVICE_URL" "${ARGS[@]}")
fi

node "$VERIFIER" "${ARGS[@]}" "$@"
