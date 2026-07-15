# AgentWatch Service Quickstart

AgentWatch's default deployment is the standalone Rust monitor server. It runs on the agent machine and serves the browser UI to other devices on the same LAN. No desktop UI package is required for this mode.

## 1. Install The Service

macOS:

```bash
./install-service-macos.sh
```

Linux:

```bash
./install-service-linux.sh
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-service-windows.ps1 -StartNow
```

The installer copies the server binary into a stable per-user install directory before registering the login service.

## 2. Check Status

```bash
node agentwatch-service-status.mjs --url http://127.0.0.1:<selected-port> --wait-ms 10000
```

Use the printed `LAN URL` from another device on the same network.

## 3. Open The Browser UI

Open the LAN URL in a browser on a different machine:

```text
http://<agent-machine-ip>:<selected-port>
```

The dashboard shows active agent processes, provider history, token usage, quota windows, and daily token activity.

Before moving to another device, run a LAN preflight on the agent machine:

```bash
node agentwatch-lan-preflight.mjs --url http://127.0.0.1:<selected-port>
```

This checks that AgentWatch is reachable, bound to `0.0.0.0`, serving current dashboard assets, and advertising a non-loopback LAN URL.

## 4. Save Remote Evidence

If the viewer machine has Node.js:

```bash
node agentwatch-verify-remote-client.mjs --url http://<agent-machine-ip>:<selected-port> --report remote-client-verification-<platform>.json
```

If the viewer machine only has a browser, open the LAN URL, use the Remote Verify panel, and click `검증 JSON`. Copy the downloaded JSON back into this release folder and import it from a source checkout:

```bash
npm run release:import-remote -- --report /path/to/remote-client-verification-<platform>.json --assets <this-release-folder> --platform <platform> --service-only
npm run release:refresh -- <this-release-folder> --service-only --platform <platform> --check
```

Final release readiness accepts only real second-device evidence where `/api/remote-check` reports `remoteClient: true`, `loopback: false`, and `sameHostIp: false`.

## 5. Uninstall

macOS:

```bash
./uninstall-service-macos.sh
```

Linux:

```bash
./uninstall-service-linux.sh
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-service-windows.ps1
```
