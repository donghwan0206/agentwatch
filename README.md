# AgentWatch

AgentWatch is a small LAN dashboard for watching local LLM and coding-agent processes from another machine on the same network.

It is intentionally local-first:

- Runs on the machine that hosts Codex, Claude Code, Gemini CLI, ChatGPT, OpenCode, OpenClaw, Hermes, Aider, Goose, Cursor Agent, Qwen Code, Ollama, LM Studio, or llama.cpp.
- Exposes a browser dashboard on `0.0.0.0`, so another LAN device can open `http://<agent-machine-ip>:<selected-port>`.
- Logs process snapshots and status changes to SQLite.
- Logs active provider-level snapshots, including status, process count, CPU, and memory, for later timeline inspection.
- Shows Codex remaining quota when Codex local rate-limit logs are available.
- Shows a GitHub-style daily token activity grid from local Codex token-usage events.
- Reads process metadata only. It does not read prompts, replies, source files, terminal buffers, or project contents.

## Rust Monitor Server

The primary runtime is a standalone Rust server. It runs on the machine that hosts the agents and serves the browser UI directly:

- `sysinfo` reads local processes without shelling out to `ps`.
- `axum` serves the same LAN dashboard on `0.0.0.0`, using `8765` by default and falling back through `8799` if needed.
- Activity snapshots and status changes are persisted to SQLite.
- The same process serves `/`, `/app.js`, `/styles.css`, and the JSON API, so no desktop UI package is required.
- Other machines on the same LAN open `http://<agent-machine-ip>:<selected-port>` in a normal browser.

Install the JavaScript wrapper dependencies once:

```bash
npm install
```

Run the Rust monitor server:

```bash
npm run dev
```

Build the release server binary:

```bash
npm run build
```

The binary is written to:

```text
src-tauri/target/release/agentwatch-server
```

Run it directly on the monitoring machine:

```bash
src-tauri/target/release/agentwatch-server
```

By default the server uses the saved `~/.agentwatch/config.json` port when present, otherwise it tries `8765` and falls back through `8799`. To force a port for that process:

```bash
AGENTWATCH_PORT=8876 src-tauri/target/release/agentwatch-server
```

The server prints the local URL and the LAN URL shape. You can also check the selected port and detected LAN URLs with:

```bash
curl http://127.0.0.1:<selected-port>/api/runtime
```

Provider-level activity logs are available from the same browser API:

```bash
curl "http://127.0.0.1:<selected-port>/api/provider-history?minutes=180"
```

Then open this from another device on the same network:

```text
http://<agent-machine-ip>:<selected-port>
```

Create a service-only release folder for the current OS:

```bash
npm run package:local -- --assets release-assets
npm run release:archive-service -- --input release-assets
npm run release:readiness -- release-assets --service-only --automated-only --platform macos
npm run release:status -- release-assets --service-only --platform macos
```

`package:local` packages the Rust monitor server and service/browser verification helpers only. It does not include a desktop UI package, tray wrapper, or tray verification files. `package:service-local` is kept as a compatibility alias for the same browser-only flow.
The local packaging command also runs the headless smoke test, writes `lan-preflight-<platform>.json`, and includes `release-status.json` plus `release-status.md`, so automated readiness can prove the LAN browser endpoint is reachable before manual remote-client evidence exists.
The archive command writes `agentwatch-service-release-<OS>.tar.gz` for copying to the agent machine.
Inside a downloaded release folder, the equivalent status command is `node agentwatch-release-status.mjs . --service-only --platform macos`.
CI publishes the same service-only contents as `agentwatch-service-release-<OS>.tar.gz`; locally, `npm run release:bundle-service -- --input service-release-assets --output release-assets` creates those archives from downloaded service artifacts. Tagged GitHub releases upload these service archives by default, after `npm run release:verify-service-archives -- release-assets` proves that all three OS archives are present and contain no desktop/tray package files. The bundler refuses incomplete service folders that lack install/uninstall helpers, status reports, the remote verification guide, or verifier scripts. After real remote-browser reports are added and release status is ready, add `--require-final` to reject archives that still have service, remote, lifecycle, or audit blockers.

## Run as a Service

Build once, then install the Rust monitor as a user-level background service on the agent machine:

```bash
npm run build
```

macOS:

```bash
npm run service:install:mac
npm run service:uninstall:mac
```

The macOS installer copies the server binary to `~/Library/Application Support/AgentWatch/agentwatch-server` and points the LaunchAgent there, avoiding protected workspace folders such as Documents.

Linux with user systemd:

```bash
npm run service:install:linux
npm run service:uninstall:linux
```

Windows PowerShell:

```powershell
npm run service:install:windows -- -StartNow
npm run service:uninstall:windows
```

Use the first-run dashboard prompt to save the browser port, or set `AGENTWATCH_PORT` before installation only when you need an environment-level override. Set `AGENTWATCH_DB` to store SQLite data somewhere other than `~/.agentwatch/agentwatch.sqlite3`. The service runs under your user account so it can see the same local agent processes and Codex usage logs as an interactive session.

Check whether the installed service and browser API are reachable:

```bash
npm run service:status
npm run service:status -- --wait-ms 10000
npm run service:status -- --url http://127.0.0.1:<selected-port> --json
npm run verify:lan -- --url http://127.0.0.1:<selected-port>
node agentwatch-service-status.mjs --url http://127.0.0.1:<selected-port>
```

The status command prints the service manager state, runtime, local URL, LAN URLs, current activity, and whether the current client is a real remote browser. Use `--wait-ms` immediately after installing or restarting the service so the command waits through the short startup window instead of failing on the first refused connection. The LAN preflight command checks that the service is bound to `0.0.0.0`, advertises a non-loopback LAN URL, responds through that LAN URL's `/healthz`, and serves current dashboard assets before you move to a second device.

To generate the macOS LaunchAgent or Linux systemd user unit without registering it:

```bash
AGENTWATCH_SERVICE_DRY_RUN=1 npm run service:install:mac
AGENTWATCH_SERVICE_DRY_RUN=1 npm run service:install:linux
```

After installing the service, write a JSON verification report:

```bash
npm run verify:service -- --url http://127.0.0.1:<selected-port> --report release-assets/service-verification-<platform>.json
npm run verify:service -- --url http://127.0.0.1:<selected-port> --report release-assets/service-verification-<platform>.json --manual-result passed --manual-notes "Service starts on login, LAN URL works, and uninstall was checked."
```

Use `--skip-service-check` only when you want endpoint/UI verification before registering the background service. Use `--skip-lan-check` only for pre-LAN checks; final release evidence should include a passed LAN URL health check.

From the browser/viewer machine on the same LAN, verify real remote access:

```bash
npm run verify:remote -- --url http://<agent-machine-ip>:<selected-port> --report release-assets/remote-client-verification-<platform>.json
```

From a downloaded release folder, use the platform wrapper on the viewer machine:

```bash
./verify-remote-macos.sh --url http://<agent-machine-ip>:<selected-port>
./verify-remote-linux.sh --url http://<agent-machine-ip>:<selected-port>
verify-remote-windows.cmd -Url http://<agent-machine-ip>:<selected-port>
```

The finalized release folder also includes `remote-verification.md`, which records copy-ready commands and the detected LAN URL when service evidence is already present.

This checks the browser dashboard and API over the LAN URL. It rejects loopback targets by default and final release readiness accepts only reports from a different host than the agent machine.
If the viewer machine only has a browser, open the LAN URL, click `검증 JSON` in the Remote Verify panel, then import the downloaded file from the source checkout:

```bash
npm run release:import-remote -- --report /path/to/remote-client-verification-<platform>.json --assets release-assets --platform <platform> --service-only
npm run release:refresh -- release-assets --service-only --platform <platform> --check
```

To verify uninstall and reinstall recovery on the current OS:

```bash
npm run verify:service:lifecycle -- --yes --url http://127.0.0.1:<selected-port> --report release-assets/service-lifecycle-<platform>.json
```

When `verify:service` writes `release-assets/service-verification-<platform>.json`, it automatically reads the matching lifecycle report and marks `uninstallClean` as passed if uninstall/reinstall recovery was proven.

For final service-only release readiness, run:

```bash
npm run release:readiness -- release-assets --service-only --platform macos
```

Use `--platform windows` or `--platform linux` on those systems, or omit `--platform` when the release folder contains all three platforms. That gate requires the headless Rust binary, release manifest, performance evidence, passed service report, passed lifecycle report, and a passed remote browser report. It intentionally does not require a Tauri desktop app or tray screenshot.

## Packaging Scope

The supported deployment path is the Rust monitor service plus the browser dashboard it serves over LAN. The UI is not packaged as a desktop app for this flow. Any Tauri/tray code in the repository is retained as experimental scaffolding and is outside the normal release checklist. Use `npm run package:desktop-local -- ...` only when a native wrapper is explicitly requested.

See [docs/packaging.md](docs/packaging.md) for service-only package paths and release checks.

`npm test` checks the Rust server, browser UI smoke path, service release helpers, Python compatibility tests, and Rust unit tests.

## Python Development Server

```bash
python3 agent_monitor.py --host 0.0.0.0 --port 8765
```

Open one of the printed URLs from a browser. From another device, use the LAN URL:

```text
http://<agent-machine-ip>:<selected-port>
```

The Rust server uses the same URL shape. If it had to fall back because `8765` was busy, use the selected port printed by the process or reported by `/api/runtime`.

## API

- `GET /api/runtime` - selected port, local URL, LAN URLs, bind host, platform, runtime, version, and `trayEnabled: false` for the service runtime.
- `GET /api/snapshot` - current provider and activity state.
- `GET /api/history?minutes=180` - recent activity score snapshots.
- `GET /api/events?limit=100` - status transition log.
- `GET /api/usage?days=366` - Codex quota, daily token usage, and recent thread token totals.
- `GET /healthz` - service health check.

## Data

The Rust server writes activity snapshots and status-change events to:

```text
~/.agentwatch/agentwatch.sqlite3
```

Override it with:

```bash
AGENTWATCH_DB=/path/to/agentwatch.sqlite3 npm run dev
```

The Python development server default database lives at:

```text
data/agentwatch.sqlite3
```

Both database paths are ignored by Git. Override the Python server path with `--db`.

## Detection

AgentWatch detects command lines containing known CLI/app identifiers:

- OpenAI Codex
- Claude Code
- Gemini CLI
- ChatGPT
- OpenCode
- OpenClaw
- Hermes

Detection is deliberately conservative and based on local process metadata. The Rust implementation keeps the active patterns in `src-tauri/src/monitor.rs`; the Python server remains as a development reference in `agent_monitor.py`.

## Usage and Quota

Codex usage is read from local Codex SQLite logs when present:

- `~/.codex/logs_2.sqlite` for rate-limit snapshots and per-turn token events.
- `~/.codex/state_5.sqlite` for thread-level cumulative token totals.
- `~/.codex/goals_1.sqlite` for active Codex goal token usage and token-budget remaining values when a budget exists.

Quota values only appear when Codex has emitted a local `codex.rate_limits` event. If that event is not present yet, the dashboard keeps the token grass and goal/thread token cards visible and shows quota as unavailable instead of guessing. Goal remaining tokens are shown only when the Codex goal has an explicit token budget; unbounded goals show used tokens without fabricating a remaining value.

## Test

```bash
npm test
```

This runs the Python regression tests, Rust tests, server smoke contracts, and service release checks.

After building the Rust server, run the browser/API smoke test:

```bash
npm run smoke:headless
```

`smoke:headless` launches the standalone Rust monitor server, checks `/healthz`, `/api/runtime`, `/api/snapshot`, `/api/history`, verifies that `/`, `/app.js`, and `/styles.css` load for the browser UI, verifies SQLite log creation, and then stops the process. It reports `runtime: "rust-headless"` and `trayEnabled: false`, choosing a free port from `8893` to `8933` unless `AGENTWATCH_HEADLESS_SMOKE_PORT` is set.

For a local runtime performance snapshot:

```bash
npm run bench:runtime
npm run bench:headless
npm run bench:python
npm run bench:report:service -- release-assets
```

The benchmarks launch the Rust server and the Python development server on isolated ports, then report startup time, API response latency, RSS memory, detected activity status, and active process count. The headless server is the relevant comparison for the browser-only deployment.
