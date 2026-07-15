#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:-src-tauri/target/release/bundle/macos/AgentWatch.app}"
OUTPUT_DIR="${2:-src-tauri/target/release/bundle/dmg}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "create-macos-dmg.sh must run on macOS" >&2
  exit 1
fi

if [[ ! -d "$APP_PATH" ]]; then
  echo "macOS app bundle missing: $APP_PATH" >&2
  exit 1
fi

if ! command -v hdiutil >/dev/null 2>&1; then
  echo "hdiutil is required to create a macOS DMG" >&2
  exit 1
fi

VERSION="$(node -p "require('./package.json').version")"
ARCH="$(uname -m)"
if [[ "$ARCH" == "arm64" ]]; then
  ARCH="aarch64"
fi
OUTPUT_PATH="$OUTPUT_DIR/AgentWatch_${VERSION}_${ARCH}.dmg"
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agentwatch-dmg.XXXXXX")"
cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

mkdir -p "$OUTPUT_DIR"
rm -f "$OUTPUT_PATH"

ditto "$APP_PATH" "$STAGING_DIR/AgentWatch.app"
ln -s /Applications "$STAGING_DIR/Applications"

hdiutil create \
  -volname "AgentWatch" \
  -srcfolder "$STAGING_DIR" \
  -ov \
  -format UDZO \
  "$OUTPUT_PATH"

echo "macOS DMG written: $OUTPUT_PATH"
