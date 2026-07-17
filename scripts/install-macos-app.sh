#!/usr/bin/env bash
set -euo pipefail

RELEASE_BASE_URL="${AGENTWATCH_RELEASE_BASE_URL:-https://github.com/donghwan0206/agentwatch/releases/latest/download}"
INSTALL_DIR="${AGENTWATCH_INSTALL_DIR:-/Applications}"
ARCHIVE_NAME="AgentWatch.app.tar.gz"
CHECKSUM_NAME="${ARCHIVE_NAME}.sha256"
DITTO_BIN="${AGENTWATCH_DITTO_BIN:-ditto}"
CODESIGN_BIN="${AGENTWATCH_CODESIGN_BIN:-codesign}"
XATTR_BIN="${AGENTWATCH_XATTR_BIN:-xattr}"
OPEN_BIN="${AGENTWATCH_OPEN_BIN:-open}"

if [[ "$(uname -s)" != "Darwin" && "${AGENTWATCH_ALLOW_NON_MACOS_TEST:-0}" != "1" ]]; then
  echo "AgentWatch desktop installer requires macOS." >&2
  exit 1
fi

if [[ "$(uname -m)" != "arm64" && "${AGENTWATCH_ALLOW_NON_MACOS_TEST:-0}" != "1" ]]; then
  echo "The current AgentWatch macOS release supports Apple Silicon only." >&2
  exit 1
fi

for command in curl tar shasum "$DITTO_BIN" "$CODESIGN_BIN" "$XATTR_BIN"; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Required command not found: $command" >&2
    exit 1
  }
done

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agentwatch-install.XXXXXX")"
BACKUP_PATH=""
DESTINATION=""
ROLLBACK_REQUIRED=0
cleanup() {
  if [[ "$ROLLBACK_REQUIRED" == "1" && -n "$DESTINATION" ]]; then
    run_privileged rm -rf "$DESTINATION" || true
    if [[ -n "$BACKUP_PATH" && -d "$BACKUP_PATH" ]]; then
      run_privileged mv "$BACKUP_PATH" "$DESTINATION" || true
    fi
  fi
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

run_privileged() {
  if [[ "${#SUDO[@]}" -gt 0 ]]; then
    "${SUDO[@]}" "$@"
  else
    "$@"
  fi
}

echo "Downloading AgentWatch..."
curl --fail --location --silent --show-error --retry 3 \
  "$RELEASE_BASE_URL/$ARCHIVE_NAME" -o "$TEMP_DIR/$ARCHIVE_NAME"
curl --fail --location --silent --show-error --retry 3 \
  "$RELEASE_BASE_URL/$CHECKSUM_NAME" -o "$TEMP_DIR/$CHECKSUM_NAME"

EXPECTED="$(awk 'NF { print $1; exit }' "$TEMP_DIR/$CHECKSUM_NAME")"
ACTUAL="$(shasum -a 256 "$TEMP_DIR/$ARCHIVE_NAME" | awk '{ print $1 }')"
if [[ ! "$EXPECTED" =~ ^[0-9a-fA-F]{64}$ || "$ACTUAL" != "$EXPECTED" ]]; then
  echo "AgentWatch archive checksum verification failed." >&2
  exit 1
fi

tar -xzf "$TEMP_DIR/$ARCHIVE_NAME" -C "$TEMP_DIR"
STAGED_APP="$TEMP_DIR/AgentWatch.app"
if [[ ! -d "$STAGED_APP" ]]; then
  echo "AgentWatch.app was not found in the release archive." >&2
  exit 1
fi
"$CODESIGN_BIN" --verify --deep --strict --verbose=2 "$STAGED_APP"

SUDO=()
if [[ ! -d "$INSTALL_DIR" ]]; then
  mkdir -p "$INSTALL_DIR" 2>/dev/null || {
    sudo -v
    SUDO=(sudo)
    run_privileged mkdir -p "$INSTALL_DIR"
  }
elif [[ ! -w "$INSTALL_DIR" ]]; then
  sudo -v
  SUDO=(sudo)
fi

if [[ "${AGENTWATCH_NO_STOP:-0}" != "1" ]]; then
  pkill -x agentwatch 2>/dev/null || true
fi
DESTINATION="$INSTALL_DIR/AgentWatch.app"
if [[ -d "$DESTINATION" ]]; then
  BACKUP_PATH="$INSTALL_DIR/.AgentWatch.app.backup.$$"
  run_privileged mv "$DESTINATION" "$BACKUP_PATH"
fi

ROLLBACK_REQUIRED=1
if ! run_privileged "$DITTO_BIN" "$STAGED_APP" "$DESTINATION"; then
  echo "AgentWatch installation failed; restoring the previous app." >&2
  exit 1
fi
run_privileged "$XATTR_BIN" -dr com.apple.quarantine "$DESTINATION"
"$CODESIGN_BIN" --verify --deep --strict --verbose=2 "$DESTINATION"

if [[ -n "$BACKUP_PATH" && -d "$BACKUP_PATH" ]]; then
  run_privileged rm -rf "$BACKUP_PATH"
  BACKUP_PATH=""
fi
ROLLBACK_REQUIRED=0

if [[ "${AGENTWATCH_NO_LAUNCH:-0}" != "1" ]]; then
  "$OPEN_BIN" "$DESTINATION"
fi

echo "AgentWatch installed at $DESTINATION"
