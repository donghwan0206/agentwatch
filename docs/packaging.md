# AgentWatch Deployment

AgentWatch's deployment unit is the standalone Rust monitor server. It runs on the agent machine, binds `0.0.0.0`, and serves both the browser dashboard and JSON API to other devices on the same LAN. The browser UI is not packaged as a desktop app.

## Local Server Build

Install dependencies once:

```bash
npm install
```

Build the current platform:

```bash
npm run build
```

Build a service-only release folder for the current platform:

```bash
npm run package:local -- --assets release-assets
npm run bench:report:service -- release-assets
npm run release:archive-service -- --input release-assets
npm run release:readiness -- release-assets --service-only --automated-only --platform macos
npm run release:bundle-service -- --input service-release-assets --output release-assets
```

This is the default deployment shape for AgentWatch: the Rust server runs on the agent machine and the UI is opened from a browser on the LAN. `package:local` skips Tauri app packaging; `package:service-local` is a compatibility alias for the same service-only flow. Replace `macos` with `windows` or `linux` on those platforms, or omit `--platform` when checking a combined all-platform release folder.
`release:archive-service` creates one local `agentwatch-service-release-<OS>.tar.gz` from a finalized service-only folder. `release:bundle-service` is for combining service-only folders downloaded from CI.
Each service release folder also includes `release-next-steps.md` plus the `agentwatch-release-*` and `agentwatch-refresh-release-evidence.mjs` helpers, so a person who only has the extracted archive can continue remote-browser, lifecycle, status, audit, readiness, and checksum refresh work without a source checkout.

Expected server output:

| Platform | Command | Output |
| --- | --- | --- |
| macOS/Linux | `npm run build` | `src-tauri/target/release/agentwatch-server` |
| Windows | `npm run build` | `src-tauri/target/release/agentwatch-server.exe` |

Run the server on the monitoring machine:

```bash
src-tauri/target/release/agentwatch-server
```

The server uses the saved `~/.agentwatch/config.json` port when present. Without a saved port it tries `8765` and falls back through `8799`. Set `AGENTWATCH_PORT` only when you need an environment-level override:

```bash
AGENTWATCH_PORT=8876 src-tauri/target/release/agentwatch-server
```

From another LAN machine, open:

```text
http://<agent-machine-ip>:<selected-port>
```

`GET /api/runtime` reports the selected port, local URL, detected LAN URLs, platform, version, runtime, and `trayEnabled: false` for the service runtime.

## Service Install

Install the built Rust server as a user-level background service on the agent machine. This is the recommended long-running deployment mode because the UI is just the browser dashboard served by `agentwatch-server`.

macOS uses a LaunchAgent:

```bash
npm run build
npm run service:install:mac
npm run service:uninstall:mac
```

The macOS installer copies the built server to `~/Library/Application Support/AgentWatch/agentwatch-server` before registering the LaunchAgent. This keeps the background service out of protected workspace folders such as Documents.

Linux uses a user systemd unit:

```bash
npm run build
npm run service:install:linux
npm run service:uninstall:linux
```

Windows uses a per-user Scheduled Task:

```powershell
npm run build
npm run service:install:windows -- -StartNow
npm run service:uninstall:windows
```

The Linux and Windows installers also copy the built server before registering the service, so the service does not depend on the original build or extracted release folder staying in place. Linux uses `${XDG_DATA_HOME:-~/.local/share}/agentwatch/agentwatch-server`. Windows uses `%LOCALAPPDATA%\AgentWatch\agentwatch-server.exe`. Override these with `AGENTWATCH_INSTALL_DIR` or `AGENTWATCH_SERVICE_BINARY` when needed.

Set these before installation when needed:

```bash
AGENTWATCH_PORT=8876
AGENTWATCH_DB=/path/to/agentwatch.sqlite3
AGENTWATCH_INSTALL_DIR=/path/to/stable/install-dir
```

The service installers do not require administrator rights in the default mode. They intentionally run as the current user so AgentWatch can see that user's local Codex logs and local agent processes.

Check the installed service and browser API status:

```bash
npm run service:status
npm run service:status -- --wait-ms 10000
npm run service:status -- --url http://127.0.0.1:<selected-port> --json
npm run verify:lan -- --url http://127.0.0.1:<selected-port>
node agentwatch-service-status.mjs --url http://127.0.0.1:<selected-port>
```

This prints the service manager state, runtime, local URL, LAN URLs, current activity, and whether the current client is a real remote browser. Use `--wait-ms` immediately after install/restart to wait through the service startup window before deciding the endpoint is down. The LAN preflight command also checks bind host, non-loopback LAN URL detection, the advertised LAN URL's `/healthz`, and current dashboard assets before a second-device remote check.

For installer verification without changing the login service state, use dry-run mode. It writes the LaunchAgent or systemd unit file but skips `launchctl` or `systemctl` registration:

```bash
AGENTWATCH_SERVICE_DRY_RUN=1 npm run service:install:mac
AGENTWATCH_SERVICE_DRY_RUN=1 npm run service:install:linux
```

After installing the service, verify the browser/API surface and write target-OS evidence:

```bash
npm run verify:service -- --url http://127.0.0.1:<selected-port> --report release-assets/service-verification-<platform>.json
./scripts/verify-service-macos.sh --manual-result passed --manual-notes "LaunchAgent, login start, LAN URL, and uninstall verified."
./scripts/verify-service-linux.sh --manual-result passed --manual-notes "systemd user service, login start, LAN URL, and uninstall verified."
powershell -ExecutionPolicy Bypass -File .\scripts\verify-service-windows.ps1 --% --manual-result passed --manual-notes "Scheduled Task, login start, LAN URL, and uninstall verified."
```

The service verifier checks service registration automatically with `launchctl`, `systemctl --user`, or `schtasks` on the target OS, and also requests the first reported LAN URL's `/healthz`. Add `--skip-service-check` or `--skip-lan-check` only for pre-install/pre-LAN checks.

From the browser/viewer machine on the same LAN, verify that the dashboard loads through the agent machine's LAN IP:

```bash
npm run verify:remote -- --url http://<agent-machine-ip>:<selected-port> --report release-assets/remote-client-verification-<platform>.json
```

If the viewer machine only has a browser, open `http://<agent-machine-ip>:<selected-port>`, check the Remote Verify panel, and click `검증 JSON`. The downloaded file uses the same `remote-client-verification-<platform>.json` schema as the CLI verifier.
Import that browser-downloaded report into the release folder from a source checkout:

```bash
npm run release:import-remote -- --report /path/to/remote-client-verification-<platform>.json --assets release-assets --platform <platform> --service-only
npm run release:refresh -- release-assets --service-only --platform <platform> --check
```

The remote verifier checks `/healthz`, `/api/runtime`, `/api/snapshot`, `/`, `/app.js`, and `/styles.css` over the LAN URL. It rejects loopback URLs and final release readiness accepts only reports where the client host differs from the service host. Use `--allow-same-host` only for local development; that report is marked `local-only`.
It also checks `/api/remote-check`, which is generated by the AgentWatch server from the TCP peer address. Final release evidence must include `remoteClient: true`, `loopback: false`, and `sameHostIp: false`; this prevents a same-machine LAN-IP check from being mistaken for a real second-device browser test.

To exercise uninstall/reinstall recovery and leave the service running again:

```bash
npm run verify:service:lifecycle -- --yes --url http://127.0.0.1:<selected-port> --report release-assets/service-lifecycle-<platform>.json
```

Run lifecycle verification before the final `verify:service` pass. The service verifier reads the matching `service-lifecycle-<platform>.json` and records `lifecycleUninstallClean: "passed"` when recovery evidence is present.

## Desktop Tray App Scope

The normal end-user release is the desktop tray app. On Windows, `AgentWatch_<version>_x64-setup.exe` installs the app that stays in the notification area, keeps the embedded Rust monitor server running after the launcher/terminal is gone, and opens the browser dashboard from the tray menu. The service-only archives remain available for headless/server-style deployments, but they intentionally do not include a tray icon.

To build the tray app locally, run `npm run package:desktop-local -- --assets release-assets` or run the GitHub workflow with `include_desktop: true`. That path builds native packages on each OS, verifies the packaged app smoke path, writes tray verification helpers, and uploads per-platform `agentwatch-release-<OS>` artifacts. The follow-up `desktop-release` job bundles those artifacts into:

- `agentwatch-desktop-release-macOS.tar.gz`
- `agentwatch-desktop-release-Windows.tar.gz`
- `agentwatch-desktop-release-Linux.tar.gz`

The desktop archive job runs:

```bash
npm run release:bundle-desktop -- --input desktop-release-assets --output desktop-archives
npm run release:verify-desktop-archives -- desktop-archives
npm run release:desktop-status -- --archives desktop-archives --output desktop-archives/desktop-release-status.md
```

`release:verify-desktop-archives` checks that each archive has the platform app package, the matching headless Rust monitor binary, service/remote/tray verifier helpers, release status files, completion audit files, and valid recursive internal checksums, including nested screenshot evidence files. It also parses `release-status.json` and requires the archive's platform to have passed package, headless, manifest, performance, and LAN preflight checks. It rejects archives with missing Windows MSI/NSIS, missing Linux AppImage/deb/rpm, missing macOS app zip, wrong-platform server binaries, malformed helper scripts, stale or invalid release status, or checksum drift.

`release:desktop-status` reads the desktop tarballs themselves and produces a cross-platform readiness table. It marks missing Windows/macOS/Linux archives, incomplete service/lifecycle/remote/tray/audit evidence, unexpected archives, and stale embedded `release-status.json` files. Add `--check` when you want the command to fail unless every desktop archive is final-ready.

Use `release:next-steps` when a release folder or desktop archive status is incomplete and you want copy-ready commands for the remaining gates:

```bash
npm run release:next-steps -- --assets release-assets --archives desktop-archives --output release-next-steps.md
```

The generated checklist reads `release-status.json`, `desktop-release-status.json`, `remote-verification.md`, and LAN preflight evidence to print the exact remote-browser URL, tray/manual report commands, refresh commands, and missing Windows/Linux desktop archive build commands.

When the manual workflow is run from a `v*` tag with `include_desktop: true`, the `desktop-github-release` job waits for the service release job, verifies the desktop archives again with `--require-final`, runs `release:desktop-status --check`, checks `desktop-archives/SHA256SUMS.txt`, and uploads `agentwatch-desktop-release-<OS>.tar.gz` plus the checksum and `desktop-release-status.json/.md` files to the same GitHub Release. The checksum file covers both the desktop tarballs and the desktop status reports.

Linux desktop CI runs packaged app smoke tests under Xvfb with tray disabled, then runs `verify-tray-config.mjs` separately inside `dbus-run-session -- xvfb-run` with tray enabled. That split keeps the smoke path stable while still collecting automated `linux-tray` runtime/config evidence for desktop release readiness.

Use `npm run release:verify-desktop-archives -- desktop-archives --require-final` only after real remote-client reports and passed tray/menu-bar reports have been copied into each platform release folder and `release-status.json` reports `overall: "ready"`. The default CI archive check intentionally accepts automated-only desktop archives so manual evidence can be added later.

Import manually generated tray/menu-bar evidence before refreshing desktop release status:

```bash
npm run release:tray-manual -- \
  --source release-assets/tray-verification-<platform>.json \
  --output release-assets/tray-verification-<platform>.json \
  --check startsHidden=passed \
  --check trayIconVisible=passed \
  --check trayMenuItems=passed \
  --check trayTooltip=passed \
  --check openDashboard=passed \
  --check closeKeepsHealthz=passed \
  --check quitExitsApp=passed \
  --check lanUrlReachable=passed \
  --screenshot /path/to/<platform-tray-screenshot>.png \
  --manual-notes "Verified on the target desktop session."
npm run release:import-tray -- --report /path/to/tray-verification-<platform>.json --assets release-assets --platform <platform>
npm run release:refresh -- release-assets --platform <platform> --check
```

For Windows, also record `--check windowsNoConsole=passed`. `release:tray-manual` keeps unchecked items pending, computes screenshot hashes, and sets `manualResult: "passed"` only after every required platform check is passed.

## Runtime Checks

Before calling a server deployment complete on a platform, verify:

1. Launching `agentwatch-server` starts a listener on `0.0.0.0`.
2. `GET /healthz` returns `{"ok":true,...}`.
3. `GET /api/snapshot` shows local agent processes.
4. Another LAN machine can open `http://<agent-machine-ip>:<port>`.
5. The browser dashboard loads `/`, `/app.js`, and `/styles.css`.
6. Activity snapshots and status-change events are written to SQLite.
7. `GET /api/runtime` reports `runtime: "rust-headless"`, app version, selected port, platform, `trayEnabled: false`, and no indicator target.

After building, the local API/DB smoke test can verify the packaged runtime:

```bash
npm run smoke:headless
```

The smoke test launches the built Rust server with isolated `AGENTWATCH_PORT` and temporary `AGENTWATCH_DB`, waits for `/healthz`, checks `/api/runtime`, `/api/snapshot`, `/api/history`, verifies SQLite log creation, verifies that the standalone server serves the browser dashboard assets, and then stops the process. It reports `runtime: "rust-headless"` with `trayEnabled: false`; by default it picks the first free port from `8893` to `8933`, or use `AGENTWATCH_HEADLESS_SMOKE_PORT` to force one.

`npm test` includes the server smoke contract, Rust unit tests, Python compatibility tests, and service release contract checks.

The fallback smoke test occupies `8765`, launches the built runtime without forcing `AGENTWATCH_PORT`, and verifies that it becomes healthy on the fallback range.

Collect service release outputs and write release metadata:

```bash
npm run package:local -- --assets release-assets
npm run release:readiness -- release-assets --service-only --automated-only --platform macos
npm run release:status -- release-assets --service-only --platform macos
```

`package:local` builds only the headless Rust server, runs the headless smoke test with a generated `lan-preflight-<platform>.json`, writes the Rust-headless-vs-Python performance report, runs `release:collect -- --service-only`, finalizes helper scripts and guides, writes the manifest from those finalized files, writes release status reports, and produces a service-only summary. `release:bundle-service` packs downloaded service-only artifact directories into `agentwatch-service-release-<OS>.tar.gz`; it refuses incomplete artifact folders that are missing the headless server, checksums, `release-status.json`, `release-status.md`, `remote-verification.md`, completion audit, install/uninstall helpers, or service/remote verifier wrappers. CI uses the same command before publishing tag releases. `release:collect -- --service-only` copies only the headless Rust monitor binary. `release:finalize -- --service-only` adds the standalone service and remote-client verifiers, platform wrapper scripts, release verification guide, release summary, completion audit, remote verification guide, and `SHA256SUMS.txt`. `release:manifest` records byte sizes, SHA-256 hashes, app version, build platform, and the automated/manual verification gates that apply to the service release. After writing `release-status.json` and `release-status.md`, rerun `release:finalize -- --checksums-only` so checksums include status reports without regenerating audit files. `npm run release:readiness -- release-assets --service-only --automated-only --platform <platform>` checks service package, manifest, checksum, helper, performance comparison, and LAN preflight completeness before service/manual/LAN-client reports exist. Full `npm run release:readiness -- release-assets --service-only --platform <platform>` requires a passed service report, service lifecycle report, and remote client report, but does not require a desktop app package or tray report.

For a local runtime performance snapshot:

```bash
npm run bench:runtime
npm run bench:headless
npm run bench:python
npm run bench:report:service -- release-assets
```

The benchmarks launch the Rust headless server and the Python development server with isolated ports and temporary SQLite databases, then print startup time, average and p95 API response time, RSS memory, activity status, and active process count. `bench:report:service` writes `performance-comparison-<platform>.json` and `.md` into the selected assets directory so local performance evidence can travel with a release candidate. The report verdict passes only when Rust headless startup, average response, p95 response, and RSS are all lower than Python on that machine. `release:status` and `release:readiness` both reject stale reports where `performanceVerdict` disagrees with the measured `headlessVsPython` deltas. Treat this as machine-local evidence, not a cross-platform pass/fail gate.

The Rust server uses the saved `~/.agentwatch/config.json` port when present. Without a saved port it tries `8765` and falls back through `8799`. Set `AGENTWATCH_PORT` only when you need an environment-level override.

The service persists activity snapshots and status-change events to:

```text
~/.agentwatch/agentwatch.sqlite3
```

Set `AGENTWATCH_DB` to force a different SQLite path.

## CI Packaging

`.github/workflows/package.yml` first builds service-only release assets on:

- `macos-latest` with `npm run build:server`
- `windows-latest` with `npm run build:server`
- `ubuntu-24.04` with `npm run build:server`

Each service job runs `smoke:headless`, dry-runs the platform service installer against the built server binary, writes `bench:report:service`, collects `release-assets-service` with `--service-only`, finalizes the service/browser verifier helpers, writes the manifest and status reports, refreshes checksums, checks `release:readiness --service-only --automated-only --platform <platform>`, and uploads `agentwatch-service-release-<OS>` artifacts. This is the CI path that matches the default LAN browser deployment.

On `v*` tag builds, CI publishes the default service-only bundles to the matching GitHub Release:

- `agentwatch-service-release-macOS.tar.gz`, `agentwatch-service-release-Windows.tar.gz`, and `agentwatch-service-release-Linux.tar.gz` service-only bundles
- `agentwatch-server-<platform>` headless Rust monitor binary inside each service-only bundle
- `install-service-macos.sh`, `uninstall-service-macos.sh`, `install-service-linux.sh`, `uninstall-service-linux.sh`, `install-service-windows.ps1`, and `uninstall-service-windows.ps1`
- `agentwatch-service-status.mjs`
- `agentwatch-lan-preflight.mjs`
- `agentwatch-verify-remote-client.mjs`
- `agentwatch-import-remote-report.mjs`
- `verify-remote-macos.sh`, `verify-remote-linux.sh`, `verify-remote-windows.cmd`, and `verify-remote-windows.ps1`
- `performance-comparison-<platform>.json` and `.md` machine-local benchmark evidence
- `agentwatch-release-manifest-<platform>.json`
- `agentwatch-release-audit.mjs`, `agentwatch-release-status.mjs`, and `agentwatch-release-next-steps.mjs` for summarizing remaining release blockers from a downloaded release folder
- `agentwatch-release-readiness.mjs` and `agentwatch-refresh-release-evidence.mjs` for regenerating audit, status, next steps, checksums, and readiness after importing remote or tray evidence
- `service-quickstart.md` with install, status, browser UI, remote evidence, and uninstall steps for service-only releases
- `release-summary.md` summarizing package, performance, service, and remote browser status
- `remote-verification.md` with copy-ready commands for running the LAN browser verifier from another machine
- `completion-audit.json` and `.md` mapping the Rust service, LAN browser, and token/quota dashboard requirements to collected evidence
- `SHA256SUMS.txt` covering every release asset
- `release-verification.md` describing automated and manual gates

For full service release readiness on one platform, run:

```bash
npm run release:readiness -- release-assets --service-only --platform macos
```

It fails until the selected platform has a headless Rust monitor binary, service installer/uninstaller scripts, browser/service verifiers, a valid `agentwatch-release-manifest-<platform>.json`, `performance-comparison-<platform>.json/.md`, a passed service verification report, a passed service lifecycle report, and a passed remote-client verification report from a different LAN machine. A valid manifest must match the target platform and list the expected service assets with correct byte counts and SHA-256 hashes. `SHA256SUMS.txt` must cover every top-level release file except itself and match the current file contents. A valid remote-client report must come from a different LAN machine and show `sameHost: false`.

CI also runs `bench:report:service` for service-only jobs. The resulting `performance-comparison-<platform>.json` and `.md` files travel with each release asset set as machine-local evidence files and include the same Rust-headless-vs-Python verdict.

`npm test` includes a workflow contract test for `.github/workflows/package.yml`. It fails if the CI service matrix stops building macOS, Windows, or Linux service assets, drops the service-only benchmark/readiness gate, drops the headless server build, stops collecting manifests after finalization, or removes the automated release-readiness gate.

For manual desktop package runs, the workflow contract also checks that `include_desktop: true` builds macOS, Windows, and Linux packages, writes release status/checksums before readiness, uploads per-platform desktop release assets, bundles those artifacts into desktop tarballs, verifies those tarballs, uploads `agentwatch-desktop-release-archives`, and publishes those archives to a tagged GitHub Release when the workflow is run on a tag.
