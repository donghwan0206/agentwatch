#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:-src-tauri/target/release/bundle/macos/AgentWatch.app}"
ARCHIVE_PATH="${2:-src-tauri/target/release/bundle/macos/AgentWatch.app.tar.gz}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "verify-macos-signatures.sh must run on macOS" >&2
  exit 1
fi

codesign --verify --deep --strict --verbose=2 "$APP_PATH"

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agentwatch-signature.XXXXXX")"
cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

tar -xzf "$ARCHIVE_PATH" -C "$TEMP_DIR"
codesign --verify --deep --strict --verbose=2 "$TEMP_DIR/AgentWatch.app"

echo "macOS app and updater archive signatures are valid"
