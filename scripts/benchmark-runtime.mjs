import { spawn, execFile } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.AGENTWATCH_BENCH_PORT || "8890");
const requestCount = Number(process.env.AGENTWATCH_BENCH_REQUESTS || "40");
const dbPath = join(tmpdir(), `agentwatch-bench-${process.pid}.sqlite3`);
const appPath = findAppBinary();

if (!appPath) {
  console.error("Built AgentWatch binary was not found. Run `npm run build` first.");
  process.exit(1);
}

for (const suffix of ["", "-shm", "-wal"]) {
  rmSync(`${dbPath}${suffix}`, { force: true });
}

const startedAt = performance.now();
const child = spawn(appPath, {
  cwd: root,
  env: {
    ...process.env,
    AGENTWATCH_PORT: String(port),
    AGENTWATCH_DB: dbPath,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stdout.on("data", () => {});
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

try {
  await waitForHealth(port);
  const startupMs = Math.round(performance.now() - startedAt);
  const runtime = await getJson(`http://127.0.0.1:${port}/api/runtime`);
  const snapshot = await getJson(`http://127.0.0.1:${port}/api/snapshot`);
  const latencies = [];
  for (let index = 0; index < requestCount; index += 1) {
    const target =
      index % 2 === 0
        ? `http://127.0.0.1:${port}/healthz`
        : `http://127.0.0.1:${port}/api/snapshot`;
    const requestStartedAt = performance.now();
    await getJson(target);
    latencies.push(performance.now() - requestStartedAt);
  }
  latencies.sort((left, right) => left - right);
  const rssMb = await rssMbFor(child.pid);

  console.log(
    JSON.stringify(
      {
        app: appPath,
        pid: child.pid,
        port,
        runtimePort: runtime.port,
        runtime: runtime.runtime,
        name: runtime.name,
        version: runtime.version,
        platform: runtime.platform,
        trayEnabled: runtime.trayEnabled,
        localUrl: runtime.localUrl,
        lanUrlCount: runtime.lanUrls?.length || 0,
        startupMs,
        requests: requestCount,
        avgResponseMs: round1(average(latencies)),
        p95ResponseMs: round1(percentile(latencies, 0.95)),
        rssMb,
        status: snapshot.activity?.status,
        activeProcessCount: snapshot.activity?.activeProcessCount,
      },
      null,
      2,
    ),
  );
} finally {
  await stopChild(child);
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
    await sleep(250);
  }
  throw new Error(`AgentWatch did not become healthy: ${lastError?.message || "timeout"}`);
}

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

async function rssMbFor(pid) {
  if (!pid) return null;
  try {
    if (platform() === "win32") {
      const { stdout } = await execFileAsync("powershell", [
        "-NoProfile",
        "-Command",
        `(Get-Process -Id ${pid}).WorkingSet64`,
      ]);
      return round1(Number(stdout.trim()) / 1024 / 1024);
    }
    const { stdout } = await execFileAsync("ps", ["-o", "rss=", "-p", String(pid)]);
    return round1(Number(stdout.trim()) / 1024);
  } catch {
    return null;
  }
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, quantile) {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.ceil(values.length * quantile) - 1);
  return values[index];
}

function round1(value) {
  return Math.round(value * 10) / 10;
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
