import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { platform, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.AGENTWATCH_HEADLESS_SMOKE_PORT
  ? Number(process.env.AGENTWATCH_HEADLESS_SMOKE_PORT)
  : await findAvailablePort(8893, 8933);
const dbPath = join(tmpdir(), `agentwatch-headless-smoke-${process.pid}.sqlite3`);
const appPath = findHeadlessBinary();

if (!appPath) {
  console.error("Built AgentWatch headless binary was not found. Run `npm run build:server` first.");
  process.exit(1);
}

for (const suffix of ["", "-shm", "-wal"]) {
  rmSync(`${dbPath}${suffix}`, { force: true });
}

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
  const runtime = await getJson(`http://127.0.0.1:${port}/api/runtime`);
  assert(runtime.port === port, `runtime.port expected ${port}, got ${runtime.port}`);
  assert(runtime.runtime === "rust-headless", "runtime.runtime mismatch");
  assert(runtime.name === "agentwatch", "runtime.name mismatch");
  assert(runtime.trayEnabled === false, "headless tray mode must be false");
  assert((runtime.indicatorTarget ?? null) === null, "headless runtime must not report an indicator target");
  assert(runtime.localUrl === `http://127.0.0.1:${port}`, "runtime.localUrl mismatch");
  assert(Array.isArray(runtime.lanUrls), "runtime.lanUrls missing");

  const snapshot = await getJson(`http://127.0.0.1:${port}/api/snapshot`);
  assert(snapshot.activity, "snapshot.activity missing");
  assert(Array.isArray(snapshot.providers), "snapshot.providers missing");

  const remoteCheck = await getJson(`http://127.0.0.1:${port}/api/remote-check`);
  assert(typeof remoteCheck.clientIp === "string" && remoteCheck.clientIp.length > 0, "remote-check clientIp missing");
  assert(remoteCheck.loopback === true, "loopback remote-check must identify local smoke client");
  assert(remoteCheck.remoteClient === false, "loopback remote-check must not pass as a remote LAN client");

  const html = await getText(`http://127.0.0.1:${port}/`);
  assert(html.includes("AgentWatch"), "browser dashboard HTML missing AgentWatch marker");
  assert(html.includes("copyLanUrlBtn"), "browser dashboard HTML missing LAN URL copy button");
  const script = await getText(`http://127.0.0.1:${port}/app.js`);
  assert(script.includes("/api/snapshot"), "browser dashboard JS does not load snapshot API");
  assert(script.includes("copyLanUrl"), "browser dashboard JS missing LAN URL copy handler");
  const styles = await getText(`http://127.0.0.1:${port}/styles.css`);
  assert(styles.includes(":root"), "browser dashboard CSS missing root styles");
  assert(styles.includes(".copy-url-btn"), "browser dashboard CSS missing LAN URL copy styles");

  if (process.env.AGENTWATCH_HEADLESS_SMOKE_LAN_PREFLIGHT_REPORT) {
    await writeLanPreflightReport(port, process.env.AGENTWATCH_HEADLESS_SMOKE_LAN_PREFLIGHT_REPORT);
  }

  await sleep(11_000);
  const history = await getJson(`http://127.0.0.1:${port}/api/history?minutes=180`);
  assert(Array.isArray(history.history), "history array missing");
  assert(history.history.length >= 1, "history did not record any snapshots");
  assert(existsSync(dbPath), "SQLite activity log was not created");

  console.log(
    `headless smoke ok: ${appPath} port=${port} status=${snapshot.activity.status} history=${history.history.length}`,
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

function findHeadlessBinary() {
  const candidates =
    platform() === "win32"
      ? [join(root, "src-tauri", "target", "release", "agentwatch-server.exe")]
      : [join(root, "src-tauri", "target", "release", "agentwatch-server")];
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
  throw new Error(`AgentWatch headless server did not become healthy: ${lastError?.message || "timeout"}`);
}

async function findAvailablePort(startPort, endPort) {
  for (let candidate = startPort; candidate <= endPort; candidate += 1) {
    if (await canBind(candidate)) {
      return candidate;
    }
  }
  throw new Error(`No available headless smoke port found from ${startPort} to ${endPort}`);
}

function canBind(candidatePort) {
  const server = createServer();
  return new Promise((resolveBind) => {
    server.once("error", () => resolveBind(false));
    server.listen(candidatePort, "0.0.0.0", () => {
      server.close(() => resolveBind(true));
    });
  });
}

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

async function getText(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.text();
}

async function writeLanPreflightReport(targetPort, reportPath) {
  mkdirSync(dirname(resolve(reportPath)), { recursive: true });
  const child = spawn(process.execPath, [
    join(root, "scripts", "lan-preflight.mjs"),
    "--url",
    `http://127.0.0.1:${targetPort}`,
    "--json",
    "--report",
    reportPath,
  ], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const status = await new Promise((resolveStatus) => {
    child.on("close", resolveStatus);
  });
  if (status !== 0) {
    throw new Error(`LAN preflight failed during headless smoke: ${stderr || stdout || `exit ${status}`}`);
  }
  console.log(`lan preflight report: ${reportPath}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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
