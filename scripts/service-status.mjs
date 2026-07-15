#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const targetUrl = normalizeBaseUrl(
  getOptionValue("--url") ||
    process.env.AGENTWATCH_URL ||
    process.env.AGENTWATCH_SERVICE_URL ||
    await discoverLocalAgentWatchUrl(),
);
const jsonOutput = args.includes("--json");
const skipServiceCheck = args.includes("--skip-service-check");
const waitMs = Number(getOptionValue("--wait-ms") || 0);
const intervalMs = Number(getOptionValue("--interval-ms") || 500);

const status = {
  schemaVersion: 1,
  targetUrl,
  checkedAt: new Date().toISOString(),
  host: {
    platform: process.platform,
    arch: process.arch,
  },
  service: skipServiceCheck ? { checked: false, status: "skipped" } : detectService(),
  reachable: false,
  checks: {},
};

await collectHttpStatusWithRetry(status);

if (jsonOutput) {
  console.log(JSON.stringify(status, null, 2));
} else {
  printHumanStatus(status);
}

if (!status.reachable) {
  process.exitCode = 1;
}

async function collectHttpStatus(target) {
  target.checks.healthz = await getJson("/healthz");
  target.checks.runtime = await getJson("/api/runtime");
  target.checks.snapshot = await getJson("/api/snapshot");
  target.checks.usage = await getJson("/api/usage?days=14");
  target.checks.remoteCheck = await getJson("/api/remote-check");
  target.reachable = target.checks.healthz.ok && target.checks.runtime.ok;

  if (target.checks.runtime.ok) {
    const runtime = target.checks.runtime.data;
    target.runtime = {
      name: runtime.name,
      version: runtime.version,
      runtime: runtime.runtime,
      platform: runtime.platform,
      bindHost: runtime.bindHost,
      trayEnabled: runtime.trayEnabled,
      localUrl: runtime.localUrl,
      lanUrls: Array.isArray(runtime.lanUrls) ? runtime.lanUrls : [],
    };
  }
  if (target.checks.snapshot.ok) {
    const snapshot = target.checks.snapshot.data;
    target.snapshot = {
      status: snapshot.activity?.status,
      activeProcessCount: snapshot.activity?.activeProcessCount,
      totalCpu: snapshot.activity?.totalCpu,
      totalMemory: snapshot.activity?.totalMemory,
    };
  }
  if (target.checks.remoteCheck.ok) {
    const remote = target.checks.remoteCheck.data;
    target.remoteCheck = {
      clientIp: remote.clientIp,
      loopback: remote.loopback,
      remoteClient: remote.remoteClient,
      sameHostIp: remote.sameHostIp,
    };
  }
  for (const check of Object.values(target.checks)) {
    delete check.data;
  }
}

async function collectHttpStatusWithRetry(target) {
  const deadline = Date.now() + Math.max(0, waitMs);
  let first = true;
  while (first || Date.now() < deadline) {
    first = false;
    await collectHttpStatus(target);
    if (target.reachable) return;
    if (Date.now() >= deadline) return;
    await sleep(Math.max(50, intervalMs));
  }
}

async function getJson(pathname) {
  const url = new URL(pathname, targetUrl);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) {
      return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    }
    return { ok: true, status: response.status, data: await response.json() };
  } catch (error) {
    return { ok: false, error: error.message };
  }
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

function detectService() {
  if (process.platform === "darwin") {
    const uid = typeof process.getuid === "function" ? process.getuid() : null;
    const target = uid === null ? "com.agentwatch.monitor" : `gui/${uid}/com.agentwatch.monitor`;
    const result = spawnSync("launchctl", ["print", target], { encoding: "utf8" });
    const output = `${result.stdout || ""}${result.stderr || ""}`;
    return {
      checked: true,
      manager: "launchctl",
      name: "com.agentwatch.monitor",
      installed: result.status === 0,
      running: result.status === 0 && /(?:state = running|pid = \d+)/i.test(output),
      status: result.status === 0 ? "installed" : "missing",
    };
  }
  if (process.platform === "linux") {
    const active = spawnSync("systemctl", ["--user", "is-active", "agentwatch.service"], { encoding: "utf8" });
    const enabled = spawnSync("systemctl", ["--user", "is-enabled", "agentwatch.service"], { encoding: "utf8" });
    const activeText = (active.stdout || active.stderr || "").trim();
    const enabledText = (enabled.stdout || enabled.stderr || "").trim();
    return {
      checked: true,
      manager: "systemd-user",
      name: "agentwatch.service",
      installed: !["not-found", "No such file or directory"].some((marker) => `${activeText}\n${enabledText}`.includes(marker)),
      running: active.status === 0 && activeText === "active",
      enabled: enabled.status === 0 && enabledText === "enabled",
      status: activeText || "unknown",
    };
  }
  if (process.platform === "win32") {
    const result = spawnSync("schtasks", ["/Query", "/TN", "AgentWatchMonitor", "/FO", "LIST"], { encoding: "utf8" });
    const output = `${result.stdout || ""}${result.stderr || ""}`;
    const statusLine = output.match(/^Status:\s*(.+)$/im)?.[1]?.trim();
    return {
      checked: true,
      manager: "schtasks",
      name: "AgentWatchMonitor",
      installed: result.status === 0,
      running: /running/i.test(statusLine || ""),
      status: statusLine || (result.status === 0 ? "installed" : "missing"),
    };
  }
  return {
    checked: true,
    manager: "unknown",
    name: "agentwatch",
    installed: null,
    running: null,
    status: "unsupported-platform",
  };
}

function printHumanStatus(target) {
  console.log(`AgentWatch service: ${target.reachable ? "reachable" : "not reachable"}`);
  console.log(`Target: ${target.targetUrl}`);
  if (target.service.checked) {
    console.log(`Service manager: ${target.service.manager} (${target.service.status})`);
    if (typeof target.service.running === "boolean") {
      console.log(`Service running: ${target.service.running ? "yes" : "no"}`);
    }
  }
  if (target.runtime) {
    console.log(`Runtime: ${target.runtime.runtime} ${target.runtime.version || ""}`.trim());
    console.log(`Bind: ${target.runtime.bindHost}`);
    console.log(`Tray enabled: ${target.runtime.trayEnabled}`);
    console.log(`Local URL: ${target.runtime.localUrl}`);
    for (const lanUrl of target.runtime.lanUrls) {
      console.log(`LAN URL: ${lanUrl}`);
    }
  }
  if (target.snapshot) {
    console.log(`Activity: ${target.snapshot.status || "unknown"} (${target.snapshot.activeProcessCount ?? 0} active)`);
  }
  if (target.remoteCheck) {
    console.log(`Current client: ${target.remoteCheck.clientIp} remote=${target.remoteCheck.remoteClient}`);
  }
  for (const [name, check] of Object.entries(target.checks)) {
    if (!check.ok) {
      console.log(`${name}: failed (${check.error || check.status || "unknown"})`);
    }
  }
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function getOptionValue(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
