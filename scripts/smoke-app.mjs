import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { platform, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fallbackMode =
  process.env.AGENTWATCH_SMOKE_FALLBACK === "1" || process.argv.includes("--fallback");
const forcedPort = Number(process.env.AGENTWATCH_SMOKE_PORT || "8880");
const noTrayMode = isTruthy(process.env.AGENTWATCH_NO_TRAY) || process.argv.includes("--no-tray");
const expectedTrayEnabled = !noTrayMode;
const dbPath = join(tmpdir(), `agentwatch-smoke-${process.pid}.sqlite3`);
const appPath = findAppBinary();

if (!appPath) {
  console.error("Built AgentWatch binary was not found. Run `npm run build` first.");
  process.exit(1);
}

for (const suffix of ["", "-shm", "-wal"]) {
  rmSync(`${dbPath}${suffix}`, { force: true });
}

const portGuard = fallbackMode ? await occupyDefaultPort() : null;
const child = spawn(appPath, {
  cwd: root,
  env: {
    ...process.env,
    AGENTWATCH_DB: dbPath,
    ...(noTrayMode ? { AGENTWATCH_NO_TRAY: "1" } : {}),
    ...(fallbackMode ? {} : { AGENTWATCH_PORT: String(forcedPort) }),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stdout.on("data", () => {});
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

try {
  const selectedPort = fallbackMode ? await waitForFallbackHealth() : forcedPort;
  if (!fallbackMode) {
    await waitForHealth(selectedPort);
  }

  const runtime = await getJson(`http://127.0.0.1:${selectedPort}/api/runtime`);
  assert(runtime.port === selectedPort, `runtime.port expected ${selectedPort}, got ${runtime.port}`);
  assert(runtime.localUrl === `http://127.0.0.1:${selectedPort}`, "runtime.localUrl mismatch");
  assert(Array.isArray(runtime.lanUrls), "runtime.lanUrls missing");
  assert(runtime.runtime === "tauri-rust", "runtime.runtime mismatch");
  assert(runtime.name === "agentwatch", "runtime.name mismatch");
  assert(typeof runtime.version === "string" && runtime.version.length > 0, "runtime.version missing");
  assert(
    runtime.trayEnabled === expectedTrayEnabled,
    `runtime.trayEnabled expected ${expectedTrayEnabled}, got ${runtime.trayEnabled}`,
  );
  const expectedIndicatorTarget = indicatorTargetForPlatform(platform(), expectedTrayEnabled);
  assert(
    (runtime.indicatorTarget ?? null) === expectedIndicatorTarget,
    `runtime.indicatorTarget expected ${expectedIndicatorTarget}, got ${runtime.indicatorTarget}`,
  );
  assert(typeof runtime.platform === "string" && runtime.platform.length > 0, "runtime.platform missing");

  const snapshot = await getJson(`http://127.0.0.1:${selectedPort}/api/snapshot`);
  assert(snapshot.activity, "snapshot.activity missing");
  assert(Array.isArray(snapshot.providers), "snapshot.providers missing");

  await sleep(11_000);
  const history = await getJson(`http://127.0.0.1:${selectedPort}/api/history?minutes=180`);
  assert(Array.isArray(history.history), "history array missing");
  assert(history.history.length >= 1, "history did not record any snapshots");
  assert(existsSync(dbPath), "SQLite activity log was not created");

  console.log(
    `smoke ok: ${appPath} port=${selectedPort} status=${snapshot.activity.status} history=${history.history.length}`,
  );
} finally {
  await stopChild(child);
  await portGuard?.close();
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

if (stderr.trim()) {
  console.error(stderr.trim());
}

function findAppBinary() {
  const candidates =
    platform() === "win32"
      ? [join(root, "src-tauri", "target", "release", "agentwatch.exe")]
      : [
          join(root, "src-tauri", "target", "release", "agentwatch"),
          join(
            root,
            "src-tauri",
            "target",
            "release",
            "bundle",
            "macos",
            "AgentWatch.app",
            "Contents",
            "MacOS",
            "agentwatch",
          ),
        ];
  return candidates.find((candidate) => existsSync(candidate));
}

async function occupyDefaultPort() {
  const server = createServer((socket) => socket.end());
  return new Promise((resolveGuard, rejectGuard) => {
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        resolveGuard({ close: async () => {} });
      } else {
        rejectGuard(error);
      }
    });
    server.listen(8765, "0.0.0.0", () => {
      resolveGuard({
        close: () =>
          new Promise((resolveClose) => {
            server.close(() => resolveClose());
          }),
      });
    });
  });
}

async function waitForHealth(targetPort) {
  const deadline = Date.now() + 20_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const health = await getJson(`http://127.0.0.1:${targetPort}/healthz`);
      if (health.ok) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw new Error(`AgentWatch did not become healthy: ${lastError?.message || "timeout"}`);
}

async function waitForFallbackHealth() {
  const ports = Array.from({ length: 8799 - 8766 + 1 }, (_, index) => 8766 + index);
  const deadline = Date.now() + 20_000;
  let lastError = null;
  while (Date.now() < deadline) {
    for (const targetPort of ports) {
      try {
        const health = await getJson(`http://127.0.0.1:${targetPort}/healthz`);
        if (health.ok) return targetPort;
      } catch (error) {
        lastError = error;
      }
    }
    await sleep(500);
  }
  throw new Error(`AgentWatch did not fall back from 8765: ${lastError?.message || "timeout"}`);
}

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isTruthy(value) {
  return ["1", "true", "yes"].includes(String(value || "").toLowerCase());
}

function indicatorTargetForPlatform(value, trayEnabled) {
  if (!trayEnabled) return null;
  if (value === "darwin") return "macos-menu-bar";
  if (value === "win32") return "windows-notification-area";
  if (value === "linux") return "linux-tray";
  return "desktop-tray";
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function stopChild(processHandle) {
  if (processHandle.exitCode !== null || processHandle.signalCode !== null) {
    return;
  }

  const exited = new Promise((resolveExit) => {
    processHandle.once("exit", resolveExit);
  });

  processHandle.kill(platform() === "win32" ? undefined : "SIGINT");
  const timeout = sleep(5_000).then(() => {
    if (processHandle.exitCode === null && processHandle.signalCode === null) {
      processHandle.kill("SIGKILL");
    }
  });
  await Promise.race([exited, timeout]);
}
