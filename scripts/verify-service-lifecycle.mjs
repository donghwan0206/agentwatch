#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, homedir, hostname, platform, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const confirmed = process.argv.includes("--yes") || isTruthy(process.env.AGENTWATCH_LIFECYCLE_YES);
const targetUrl = normalizeBaseUrl(
  getOptionValue("--url") ||
    process.env.AGENTWATCH_SERVICE_URL ||
    process.env.AGENTWATCH_URL ||
    await discoverLocalAgentWatchUrl(),
);
const reportPath = getOptionValue("--report") || process.env.AGENTWATCH_LIFECYCLE_REPORT || null;
const serviceName = getOptionValue("--service-name") || process.env.AGENTWATCH_SERVICE_NAME || defaultServiceName();
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

if (!confirmed) {
  throw new Error("Refusing to change service state without --yes");
}

const steps = [];

try {
  steps.push(runServiceCommand("uninstall"));
  await waitUntilServiceAbsent();
  await waitUntilHttpUnavailable(targetUrl);
  steps.push({
    name: "uninstallClean",
    status: "passed",
    detail: "service registration removed and HTTP endpoint stopped responding",
  });

  steps.push(runServiceCommand("install"));
  await waitUntilHttpAvailable(targetUrl);
  await runVerifier();
  steps.push({
    name: "reinstallHealthy",
    status: "passed",
    detail: "service reinstalled and endpoint verification passed",
  });

  writeReport("passed");
} catch (error) {
  steps.push({ name: "error", status: "failed", detail: error.message });
  const restore = runServiceCommand("install", { tolerateFailure: true });
  steps.push({ ...restore, name: "restoreAfterFailure" });
  writeReport("failed");
  throw error;
}

function runServiceCommand(action, options = {}) {
  const currentPlatform = platform();
  const script =
    action === "install"
      ? {
          darwin: ["bash", ["scripts/install-service-macos.sh"]],
          linux: ["bash", ["scripts/install-service-linux.sh"]],
          win32: ["powershell", ["-ExecutionPolicy", "Bypass", "-File", "scripts/install-service-windows.ps1", "-StartNow"]],
        }[currentPlatform]
      : {
          darwin: ["bash", ["scripts/uninstall-service-macos.sh"]],
          linux: ["bash", ["scripts/uninstall-service-linux.sh"]],
          win32: ["powershell", ["-ExecutionPolicy", "Bypass", "-File", "scripts/uninstall-service-windows.ps1"]],
        }[currentPlatform];

  if (!script) {
    throw new Error(`Unsupported platform for lifecycle verification: ${currentPlatform}`);
  }

  const [command, args] = script;
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  const step = {
    name: action,
    status: result.status === 0 ? "passed" : "failed",
    command: [command, ...args].join(" "),
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
  if (result.status !== 0 && !options.tolerateFailure) {
    throw new Error(`${action} command failed: ${result.stderr || result.stdout}`);
  }
  return step;
}

async function runVerifier() {
  const result = spawnSync(
    process.execPath,
    ["scripts/verify-service.mjs", "--url", targetUrl],
    { cwd: root, encoding: "utf8", env: process.env },
  );
  steps.push({
    name: "verifyService",
    status: result.status === 0 ? "passed" : "failed",
    command: `node scripts/verify-service.mjs --url ${targetUrl}`,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  });
  if (result.status !== 0) {
    throw new Error(`service verification failed after reinstall: ${result.stderr || result.stdout}`);
  }
}

async function waitUntilServiceAbsent() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (!servicePresent()) return;
    await sleep(500);
  }
  throw new Error(`${serviceName} still appears registered after uninstall`);
}

function servicePresent() {
  const currentPlatform = platform();
  if (currentPlatform === "darwin") {
    const domain = `gui/${process.getuid?.() ?? ""}/${serviceName}`;
    return spawnSync("launchctl", ["print", domain], { encoding: "utf8" }).status === 0;
  }
  if (currentPlatform === "linux") {
    return spawnSync("systemctl", ["--user", "is-active", serviceName], { encoding: "utf8" }).status === 0;
  }
  if (currentPlatform === "win32") {
    return spawnSync("schtasks.exe", ["/Query", "/TN", serviceName], { encoding: "utf8" }).status === 0;
  }
  return false;
}

async function waitUntilHttpUnavailable(url) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${url}/healthz`, { cache: "no-store" });
    } catch {
      return;
    }
    await sleep(500);
  }
  throw new Error(`${url}/healthz still responds after uninstall`);
}

async function waitUntilHttpAvailable(url) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/healthz`, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // Keep polling until launchd/systemd finishes starting the service.
    }
    await sleep(500);
  }
  throw new Error(`${url}/healthz did not respond after install`);
}

function writeReport(result) {
  if (!reportPath) return;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    verifier: "scripts/verify-service-lifecycle.mjs",
    targetUrl,
    serviceName,
    result,
    host: {
      hostname: hostname(),
      platform: platform(),
      release: release(),
      arch: arch(),
    },
    steps,
  };
  mkdirSync(dirname(resolve(reportPath)), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Service lifecycle report: ${reportPath}`);
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

async function discoverLocalAgentWatchUrl() {
  const candidates = candidatePorts().map((port) => `http://127.0.0.1:${port}`);
  for (const candidate of candidates) {
    try {
      const health = await fetch(`${candidate}/healthz`, { signal: AbortSignal.timeout(600) });
      if (!health.ok) continue;
      const runtimeResponse = await fetch(`${candidate}/api/runtime`, { signal: AbortSignal.timeout(600) });
      if (!runtimeResponse.ok) continue;
      const runtime = await runtimeResponse.json();
      if (runtime.name === "agentwatch") return runtime.localUrl || candidate;
    } catch {
      // Try the next candidate port.
    }
  }
  return `http://127.0.0.1:${configuredPort() || 8765}`;
}

function candidatePorts() {
  const configured = configuredPort();
  const ports = [];
  if (configured) ports.push(configured);
  for (let port = 8765; port <= 8799; port += 1) {
    ports.push(port);
  }
  return [...new Set(ports)];
}

function configuredPort() {
  const envPort = Number(process.env.AGENTWATCH_PORT || "");
  if (Number.isInteger(envPort) && envPort > 0) return envPort;
  try {
    const config = JSON.parse(readFileSync(join(homedir(), ".agentwatch", "config.json"), "utf8"));
    const port = Number(config.port || 0);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

function getOptionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function defaultServiceName() {
  const currentPlatform = platform();
  if (currentPlatform === "darwin") return "com.agentwatch.monitor";
  if (currentPlatform === "linux") return "agentwatch.service";
  if (currentPlatform === "win32") return "AgentWatchMonitor";
  return "agentwatch";
}

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
