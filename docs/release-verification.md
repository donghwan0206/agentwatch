# AgentWatch Release Verification

This file records what CI proves for the Rust monitor service, service deployment helpers, and browser-based LAN verification.

## Automated CI Gates

For every platform job:

- Headless Rust server build
- `smoke:headless`
- Platform service installer dry-run against the built server binary
- `bench:report:service`
- `release:collect -- --service-only`
- `release:finalize -- --service-only`
- Release manifest generation after finalization, with file sizes and SHA-256 hashes
- Release status generation and checksum refresh
- `release:readiness -- --service-only --automated-only --platform <platform>`

## Release Assets

Tag builds publish the default browser-dashboard service bundles:

- `agentwatch-service-release-macOS.tar.gz`, `agentwatch-service-release-Windows.tar.gz`, and `agentwatch-service-release-Linux.tar.gz` service-only bundles
- Headless Rust monitor binary for each platform inside the matching service bundle
- `install-service-macos.sh`, `uninstall-service-macos.sh`, `install-service-linux.sh`, `uninstall-service-linux.sh`, `install-service-windows.ps1`, and `uninstall-service-windows.ps1`
- `agentwatch-verify-service.mjs`, `verify-service-macos.sh`, `verify-service-linux.sh`, `verify-service-windows.cmd`, and `verify-service-windows.ps1`
- `agentwatch-verify-service-lifecycle.mjs`
- `agentwatch-service-status.mjs`
- `agentwatch-lan-preflight.mjs`
- `agentwatch-verify-remote-client.mjs`
- `agentwatch-import-remote-report.mjs`
- `verify-remote-macos.sh`, `verify-remote-linux.sh`, `verify-remote-windows.cmd`, and `verify-remote-windows.ps1`
- `performance-comparison-<platform>.json` and `.md`
- `agentwatch-release-manifest-<platform>.json`
- `agentwatch-release-status.mjs`
- `agentwatch-release-audit.mjs`
- `agentwatch-release-readiness.mjs`
- `agentwatch-release-next-steps.mjs`
- `agentwatch-refresh-release-evidence.mjs`
- `release-summary.md`
- `service-quickstart.md`
- `remote-verification.md`
- `completion-audit.json` and `.md`
- `SHA256SUMS.txt`
- `release-verification.md`

To assemble a local release folder from the current platform build:

```bash
npm run package:local -- --assets release-assets
npm run release:readiness -- release-assets --service-only --automated-only --platform macos
```

`package:local` is the browser-dashboard release path. It builds and collects only the Rust monitor server, writes headless smoke plus LAN preflight evidence, writes Rust-vs-Python performance evidence, finalizes service/browser verification helpers, writes the release manifest after finalization, and does not require a desktop UI package. `package:service-local` is a compatibility alias for the same service-only flow. Use `--platform windows` or `--platform linux` in the readiness command on those platforms, or omit `--platform` only when the release folder contains every platform.

CI creates service-only release tarballs with:

```bash
npm run release:bundle-service -- --input service-release-assets --output release-assets
```

The bundler fails incomplete service artifact folders. Each folder must include a headless Rust server binary, `SHA256SUMS.txt`, `release-status.json`, `release-status.md`, `remote-verification.md`, completion audit files, install/uninstall helpers, and the service/remote verifier scripts needed to validate the browser UI from another LAN machine.

If a native wrapper is explicitly requested later, `npm run package:desktop-local -- --assets release-assets` or the manual workflow with `include_desktop: true` produces per-platform desktop release artifacts. After the macOS, Windows, and Linux package jobs upload `agentwatch-release-<OS>` folders, CI bundles and verifies desktop archives with:

```bash
npm run release:bundle-desktop -- --input desktop-release-assets --output desktop-archives
npm run release:verify-desktop-archives -- desktop-archives
npm run release:desktop-status -- --archives desktop-archives --output desktop-archives/desktop-release-status.md
```

The resulting `agentwatch-desktop-release-<OS>.tar.gz` files contain the native app package, the matching headless Rust monitor binary, release metadata, and service/remote/tray verifier helpers. Desktop release folders also include `agentwatch-import-tray-report.mjs` so tray reports are validated before being copied into release evidence. The verifier checks recursive internal checksums, including nested screenshot evidence files, required helper scripts, platform package requirements, wrong-platform server contamination, and `release-status.json` evidence that package, headless, manifest, performance, and LAN preflight checks passed before the archives are uploaded. The desktop status report reads the tarballs and shows whether all Windows/macOS/Linux archives are present and final-ready, or which remote/tray/audit evidence is still blocking readiness. Use `npm run release:next-steps -- --assets release-assets --archives desktop-archives` from a source checkout, or `node agentwatch-release-next-steps.mjs --assets .` from an extracted release folder, to print copy-ready commands for the remaining blockers.

When that manual desktop workflow is run from a `v*` tag, the `desktop-github-release` job downloads `agentwatch-desktop-release-archives`, re-verifies the archives with `--require-final`, checks the desktop status report with `--check`, verifies the checksum file, waits for the service release job, then uploads the desktop archives to the same GitHub Release. Incomplete desktop archives can still exist as workflow artifacts, but they are not published as final GitHub Release assets.

On Linux CI, packaged app smoke and fallback smoke run under Xvfb with `AGENTWATCH_NO_TRAY=1`, then tray-enabled config evidence is collected separately with `dbus-run-session -- xvfb-run -a node scripts/verify-tray-config.mjs --output-dir release-assets`. The generated config report must show `runtimeIndicatorTarget: "linux-tray"` before Linux desktop readiness can pass.

After real remote-client reports and passed tray/menu-bar reports have been added for every platform, rerun the archive verifier with `--require-final`. That stricter mode requires `release-status.json` to report `overall: "ready"` and rejects archives that still have service, lifecycle, remote, tray, or audit blockers.

`bench:report:service` launches the Rust headless server and Python development server on isolated ports, then writes machine-local startup, latency, and RSS comparison evidence to `performance-comparison-<platform>.json` and `.md`. The report includes `performanceVerdict.status`; it is `passed` only when Rust headless startup, average response, p95 response, and RSS all measure lower than Python on that machine. `release:status` and `release:readiness` reject stale verdicts that disagree with the measured `headlessVsPython` deltas. These files are evidence attachments, not package assets, so release manifests exclude them while `SHA256SUMS.txt` still covers them when present.

After adding service and real remote-browser reports, run:

```bash
npm run release:status -- release-assets --service-only --platform macos
node release-assets/agentwatch-release-status.mjs release-assets --service-only --platform macos
npm run release:readiness -- release-assets --service-only --platform macos
```

`npm run release:readiness -- release-assets --service-only --automated-only --platform <platform>` fails until the selected target platform has a headless Rust monitor binary, the release includes service installer/uninstaller scripts and browser/service verifiers, and the platform has a valid release manifest, completion audit, plus performance comparison JSON/Markdown evidence. Full `npm run release:readiness -- release-assets --service-only --platform <platform>` also requires a valid `manualResult: "passed"` service verification report, a passed service lifecycle report, a passed remote client verification report, and a passed completion-audit platform status. Omit `--platform` only for all-platform release folders. Service-only readiness does not require desktop app packages, tray reports, or tray screenshots.

Desktop readiness requires the same Rust monitor, performance, service, lifecycle, and remote browser evidence plus native app package evidence and a passed tray/menu-bar report on each target OS. macOS requires the app zip or DMG, Windows requires NSIS and MSI installers, and Linux requires AppImage, deb, and rpm packages. Import tray evidence with `npm run release:import-tray -- --report /path/to/tray-verification-<platform>.json --assets release-assets --platform <platform>`, then run `npm run release:refresh -- release-assets --platform <platform> --check`. The tray report must prove `runtime: "tauri-rust"`, `trayEnabled: true`, the expected indicator target, source contracts for menu/tooltip/open-dashboard/close-to-tray, manual notes, and screenshot evidence after real desktop checks. Screenshot evidence paths must match the target indicator, such as `macos-menu-bar.png`, `windows-tray.png`, or `linux-tray.png`.

Use `npm run release:tray-manual -- --source tray-verification-<platform>.json --output tray-verification-<platform>.json --check <id>=passed --screenshot /path/to/<platform-tray-screenshot>.png` to record real manual tray checks one by one. It leaves unchecked items pending and only writes `manualResult: "passed"` after every required platform check is passed; Windows also requires `windowsNoConsole=passed`.

A valid manifest must match the target platform and list the expected service assets with correct byte counts and SHA-256 hashes. `completion-audit.json` must match service-only mode and include the Rust monitor, performance, service, remote browser, and manifest requirement checks for each selected platform. `SHA256SUMS.txt` must cover every top-level release file except itself and match the current file contents. A valid service report must show `rust-headless`, `trayEnabled: false`, `bindHost: "0.0.0.0"`, service registration check `passed`, LAN URL reachability check `passed`, lifecycle uninstall evidence `passed`, working dashboard assets, `/api/usage` evidence, token/quota/thread/goal dashboard markers, and passed service manual checks. A valid lifecycle report must show uninstall, endpoint shutdown, reinstall, service verification, and healthy recovery steps all passed. A valid remote client report must be generated from a different LAN host, target a non-loopback URL, show `sameHost: false`, and prove the browser dashboard assets plus `/api/usage` load through the LAN URL.

## Manual Service Gates

Run this on each target OS after copying or installing the release server binary:

```bash
./install-service-macos.sh
./install-service-linux.sh
powershell -ExecutionPolicy Bypass -File .\install-service-windows.ps1 -StartNow
```

Then write the service verification report:

```bash
node agentwatch-verify-service.mjs --url http://127.0.0.1:<selected-port> --report service-verification-macos.json --manual-result passed --manual-notes "LaunchAgent, login start, LAN URL, and uninstall verified."
./verify-service-macos.sh --manual-result passed --manual-notes "LaunchAgent, login start, LAN URL, and uninstall verified."
./verify-service-linux.sh --manual-result passed --manual-notes "systemd user service, login start, LAN URL, and uninstall verified."
verify-service-windows.cmd --manual-result passed --manual-notes "Scheduled Task, login start, LAN URL, and uninstall verified."
powershell -ExecutionPolicy Bypass -File .\verify-service-windows.ps1 --% --manual-result passed --manual-notes "Scheduled Task, login start, LAN URL, and uninstall verified."
```

To prove uninstall/reinstall recovery and leave the service running again:

```bash
node agentwatch-verify-service-lifecycle.mjs --yes --url http://127.0.0.1:<selected-port> --report service-lifecycle-macos.json
```

Then confirm:

1. `GET /healthz` returns `{"ok":true,...}`.
2. `GET /api/runtime` reports `runtime: "rust-headless"` and `trayEnabled: false`.
3. The browser dashboard loads from another LAN machine at `http://<agent-machine-ip>:<port>`.
4. The service restarts after logout/login or reboot.
5. `./uninstall-service-*.sh` or `uninstall-service-windows.ps1` removes the background service cleanly.

For a non-registering installer check on macOS or Linux, set `AGENTWATCH_SERVICE_DRY_RUN=1`; this writes the service descriptor but skips `launchctl` or `systemctl`.

Before moving to the viewer machine, run:

```bash
node agentwatch-lan-preflight.mjs --url http://127.0.0.1:<selected-port>
```

This must report `Ready for remote viewer: yes`; it is still local-only evidence until a different LAN client produces `remoteClient: true`.

## Remote Browser Gate

Run this from the machine that will view the UI, not from the agent machine:

```bash
node agentwatch-verify-remote-client.mjs --url http://<agent-machine-ip>:<selected-port> --report remote-client-verification-macos.json
./verify-remote-macos.sh --url http://<agent-machine-ip>:<selected-port>
./verify-remote-linux.sh --url http://<agent-machine-ip>:<selected-port>
verify-remote-windows.cmd -Url http://<agent-machine-ip>:<selected-port>
powershell -ExecutionPolicy Bypass -File .\verify-remote-windows.ps1 -Url http://<agent-machine-ip>:<selected-port>
```

From a source checkout, the equivalent command is:

```bash
npm run verify:remote -- --url http://<agent-machine-ip>:<selected-port> --report release-assets/remote-client-verification-<platform>.json
```

If the viewer machine only has a browser, open `http://<agent-machine-ip>:<selected-port>`, click `검증 JSON` in the Remote Verify panel, and import the downloaded report from a source checkout:

```bash
npm run release:import-remote -- --report /path/to/remote-client-verification-<platform>.json --assets release-assets --platform <platform> --service-only
npm run release:refresh -- release-assets --service-only --platform <platform> --check
```

The verifier rejects loopback URLs by default and writes a final-valid report only when the client host differs from the service host reported by `/api/runtime`. For local development on the agent machine, add `--allow-same-host`; that writes `result: "local-only"` evidence and exits successfully, but final `release:readiness` will not accept it.
