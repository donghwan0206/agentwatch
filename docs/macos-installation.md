# macOS Installation

AgentWatch supports two no-cost installation paths. The macOS build is ad-hoc signed and is not Apple-notarized.

## Terminal Installer

Run:

```bash
curl -fsSL https://github.com/donghwan0206/agentwatch/releases/latest/download/install-macos-app.sh | bash
```

The installer downloads the latest `AgentWatch.app.tar.gz`, verifies its published SHA-256 checksum and code signature, installs it in `/Applications`, removes the download quarantine attribute, and launches it. It asks for the macOS administrator password only when `/Applications` is not writable.

## DMG With Manual Approval

1. Download the latest `AgentWatch_<version>_aarch64.dmg` from the GitHub Release.
2. Open the DMG and drag `AgentWatch.app` to `Applications`.
3. Try to open AgentWatch once.
4. Open System Settings, select Privacy & Security, and choose Open Anyway for AgentWatch when that option is available.
5. If macOS only offers Move to Trash, run:

```bash
xattr -dr com.apple.quarantine /Applications/AgentWatch.app
open /Applications/AgentWatch.app
```

Only remove quarantine from an AgentWatch package downloaded from the official GitHub repository. Developer ID signing and Apple notarization will be added separately if Apple distribution credentials become available.
