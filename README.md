# AgentWatch

AgentWatch is a local-first desktop monitor for LLM and coding agents. Run it on the machine where your agents are working, then open its dashboard from any browser on the same local network.

The desktop app contains everything required for normal use:

- A Rust monitoring service that runs in the background.
- A tray or menu-bar app for opening the dashboard, checking updates, and quitting.
- A browser dashboard served over the local network.
- SQLite storage for activity history and normalized token usage.

Closing the dashboard does not stop monitoring. AgentWatch continues running in the tray until you choose **Quit**.

## Features

- Shows only agents and local model runtimes that are currently detected.
- Tracks process count, CPU, memory, recent activity, and status changes.
- Displays Codex remaining usage when a supported quota source is available.
- Builds a GitHub-style daily token history from local Codex, Claude, and Gemini logs.
- Filters token history by all providers, Codex, Claude, or Gemini.
- Stores collected history locally so it remains available after app upgrades.
- Supports English, Korean, Japanese, and Simplified Chinese. The dashboard initially follows the viewer browser's language.
- Supports over-the-air update checks from the dashboard and tray menu.
- Lets you configure the dashboard port and custom token-log locations.

AgentWatch detects OpenAI Codex, Claude Code, Gemini CLI, ChatGPT, OpenCode, OpenClaw, Hermes, Aider, Goose, Cursor Agent, Qwen Code, Ollama, LM Studio, and llama.cpp.

## How It Works

```text
Agent machine                                      Viewer machine
+---------------------------------------------+    +---------------------+
| AgentWatch desktop app                      |    | Any modern browser  |
|                                             |    |                     |
| Tray UI -> Rust monitor -> SQLite -> HTTP   |<---| LAN dashboard URL   |
+---------------------------------------------+    +---------------------+
```

The monitor binds to `0.0.0.0`, so the dashboard is available both locally and from other devices on the same LAN. AgentWatch does not require a cloud dashboard account.

## Installation

Download files only from the [latest AgentWatch release](https://github.com/donghwan0206/agentwatch/releases/latest).

| OS | Recommended installation | Current prebuilt architecture |
| --- | --- | --- |
| macOS 11 or later | Homebrew Cask | Apple Silicon (`aarch64`) |
| Windows | Setup executable | 64-bit (`x64`) |
| Linux | AppImage | 64-bit (`amd64`) |

### macOS

#### Homebrew Cask (recommended)

Install:

```bash
brew install --cask donghwan0206/agentwatch/agentwatch
```

Upgrade:

```bash
brew upgrade --cask donghwan0206/agentwatch/agentwatch
```

Uninstall:

```bash
brew uninstall --cask donghwan0206/agentwatch/agentwatch
```

The [AgentWatch Homebrew tap](https://github.com/donghwan0206/homebrew-agentwatch) follows published releases and pins the DMG checksum.

#### Terminal installer

The installer downloads the latest app archive, verifies its SHA-256 checksum and bundle signature, installs it in `/Applications`, removes the download quarantine attribute, and launches AgentWatch.

```bash
curl -fsSL https://github.com/donghwan0206/agentwatch/releases/latest/download/install-macos-app.sh | bash
```

#### DMG

1. Download `AgentWatch_<version>_aarch64.dmg` from the latest release.
2. Open the DMG.
3. Drag **AgentWatch** to the **Applications** shortcut.
4. Start AgentWatch from Applications.

The free macOS build is ad-hoc signed but is not Apple-notarized. Gatekeeper may require manual approval. See [macOS installation and Gatekeeper instructions](docs/macos-installation.md) for the exact steps.

### Windows

1. Download `AgentWatch_<version>_x64-setup.exe` from the latest release.
2. Run the installer for the current user.
3. Start AgentWatch from the Start menu.
4. Use the AgentWatch icon in the notification area to reopen the dashboard or quit monitoring.

The updater signature files published beside the installer are used by AgentWatch's updater. The installer is not currently Authenticode-signed, so Windows SmartScreen may show a warning. Confirm that the file came from the official GitHub release before choosing **More info > Run anyway**.

Do not install a service-only package for normal desktop use. The Windows desktop installer already includes the background monitor and keeps it running while the dashboard is closed.

### Linux

1. Download `AgentWatch_<version>_amd64.AppImage` from the latest release.
2. Make it executable.
3. Launch it from your file manager or application launcher.

For a first launch from a terminal:

```bash
chmod +x AgentWatch_*_amd64.AppImage
./AgentWatch_*_amd64.AppImage
```

The tray icon requires a desktop environment with StatusNotifier/AppIndicator support. The packaged Linux release is currently built for `amd64` systems.

## First Run

1. Launch AgentWatch on the machine that runs your agents.
2. Open the dashboard from the tray or menu-bar icon.
3. Open the **Port** menu to save a preferred port. AgentWatch uses `8765` by default and tries ports through `8799` when the preferred port is unavailable.
4. Allow AgentWatch through the operating-system firewall if prompted.
5. Copy the displayed **LAN URL** and open it on another device connected to the same network.

Example:

```text
http://192.168.1.25:8765
```

`http://127.0.0.1:<port>` and `http://localhost:<port>` work only on the agent machine. Other devices must use the displayed LAN IP address.

The dashboard defaults to the viewer browser's preferred language. Use the `EN`, `한국어`, `日本語`, or `中文` shortcuts in the header to override it for that browser.

## Updates

AgentWatch checks the GitHub release feed for desktop updates. Use either of these interfaces:

- Open **Update** in the dashboard header.
- Choose **Check for updates** or **Install update** from the tray menu.

Homebrew users can also update explicitly with:

```bash
brew upgrade --cask donghwan0206/agentwatch/agentwatch
```

If an in-app update is unavailable for a platform, install the newest package from the [latest release](https://github.com/donghwan0206/agentwatch/releases/latest).

## Token Usage and Quota

AgentWatch scans common local usage locations and lets you add provider-specific paths from the **Token log locations** panel.

Default sources include:

- **Codex:** `$CODEX_HOME` or `~/.codex`, including `logs_2.sqlite` and `sessions/**/*.jsonl`.
- **Claude:** `$CLAUDE_CONFIG_DIR` or `~/.claude`, plus common Claude desktop and Claude Code locations.
- **Gemini:** `$GEMINI_CONFIG_DIR` or `~/.gemini`, plus common Gemini desktop locations.

Parsed token events are normalized into `~/.agentwatch/usage.sqlite`. Rescanning updates this cache incrementally instead of deleting previously collected history.

Codex quota lookup uses the following sources in order:

1. The ChatGPT usage endpoint with the existing local Codex authentication file.
2. The installed Codex app-server interface when available.
3. The newest rate-limit snapshot in local Codex SQLite or JSONL logs.

Claude and Gemini token history can be collected from local logs, but their remaining quota may stay unavailable when those products do not expose a compatible local quota source. AgentWatch does not estimate missing quota values.

## Data and Privacy

AgentWatch reads local process metadata such as process name, command line, CPU, and memory. Sensitive command-line fields are redacted before display. It does not inspect prompts, replies, source files, terminal buffers, or project contents.

Local files are stored under the current user's home directory:

| Path | Purpose |
| --- | --- |
| `~/.agentwatch/config.json` | Saved port and custom usage-log paths |
| `~/.agentwatch/agentwatch.sqlite3` | Activity snapshots and status-change history |
| `~/.agentwatch/usage.sqlite` | Normalized daily token event cache |

On Windows, `~` means the current `%USERPROFILE%` directory.

Monitoring data is not uploaded to an AgentWatch service. Outbound HTTPS requests are limited to product functions such as Codex quota lookup through ChatGPT and application update checks through GitHub.

## Configuration

Most settings are available in the dashboard. Environment variables are intended for advanced or headless deployments.

| Variable | Purpose |
| --- | --- |
| `AGENTWATCH_PORT` | Force the listening port for the current process |
| `AGENTWATCH_DB` | Override the activity SQLite database path |
| `CODEX_HOME` | Override the Codex data root |
| `CLAUDE_CONFIG_DIR` | Override the Claude data root |
| `GEMINI_CONFIG_DIR` | Override the Gemini data root |

AgentWatch binds only within the configured host process and does not provide authentication. Use it on a trusted local network; do not expose its port directly to the public internet.

## Advanced Headless Server

The standalone Rust server is available for machines where a tray app is not appropriate. It is not required when using the desktop app.

```bash
npm ci
npm run build:server
src-tauri/target/release/agentwatch-server
```

Set a fixed port when needed:

```bash
AGENTWATCH_PORT=8876 src-tauri/target/release/agentwatch-server
```

See [the service quickstart](docs/service-quickstart.md) for macOS LaunchAgent, Linux systemd user service, and Windows Scheduled Task instructions. See [packaging documentation](docs/packaging.md) for the distinction between desktop and service-only artifacts.

## API

The embedded and headless Rust servers expose the same local HTTP API:

- `GET /api/runtime` - runtime, selected port, local URL, LAN URLs, platform, and version.
- `GET /api/snapshot` - current provider and process activity.
- `GET /api/history?minutes=180` - recent aggregate activity.
- `GET /api/provider-history?minutes=180` - recent activity grouped by provider.
- `GET /api/events?limit=100` - recent status transitions.
- `GET /api/usage?days=366` - quota, daily token history, goals, and recent Codex thread totals.
- `GET /api/usage-locations` - detected and configured token-log locations.
- `GET /healthz` - health check.

## Development

Prerequisites:

- Node.js 22
- Stable Rust toolchain
- Python 3 for compatibility tests
- The platform prerequisites required by Tauri 2

Install dependencies and run the desktop app:

```bash
npm ci
npm run dev:app
```

Run only the headless Rust server:

```bash
npm run dev:server
```

Run the test suite:

```bash
npm test
```

Build a platform package on its matching operating system:

```bash
npm run build:mac:release
npm run build:windows
npm run build:linux
```

The browser UI lives in `static/`, the Rust/Tauri application in `src-tauri/`, release tooling in `scripts/`, and advanced release documentation in `docs/`.
