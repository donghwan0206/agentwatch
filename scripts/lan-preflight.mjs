#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const targetUrl = normalizeBaseUrl(
  getOptionValue("--url") ||
    process.env.AGENTWATCH_URL ||
    process.env.AGENTWATCH_SERVICE_URL ||
    await discoverLocalAgentWatchUrl(),
);
const reportPath = getOptionValue("--report") || null;
const jsonOutput = args.includes("--json");
const allowLoopbackLanUrl = args.includes("--allow-loopback-lan-url");
const requestTimeoutMs = Number.parseInt(getOptionValue("--timeout-ms") || "3000", 10);

const report = {
  schemaVersion: 1,
  targetUrl,
  checkedAt: new Date().toISOString(),
  reachable: false,
  readyForRemoteViewer: false,
  remoteEvidenceSatisfied: false,
  checks: {},
  nextSteps: [],
};

try {
  await collectPreflight(report);
  report.readyForRemoteViewer = Boolean(
    report.reachable &&
      report.checks.bindHost?.ok &&
      report.checks.lanUrl?.ok &&
      report.checks.lanHealthz?.ok &&
      report.checks.dashboard?.ok,
  );
  report.remoteEvidenceSatisfied = report.remoteCheck?.remoteClient === true;
  report.nextSteps = nextSteps(report);
  writeReport(reportPath, report);
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }
  if (!report.readyForRemoteViewer) {
    process.exitCode = 1;
  }
} catch (error) {
  report.error = error.message;
  writeReport(reportPath, report);
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.error(`LAN preflight failed: ${error.message}`);
  }
  process.exitCode = 1;
}

async function collectPreflight(target) {
  const health = await getJson("/healthz");
  target.checks.healthz = { ok: health.ok === true };
  target.reachable = health.ok === true;

  const runtime = await getJson("/api/runtime");
  const lanUrls = Array.isArray(runtime.lanUrls) ? runtime.lanUrls.filter(isLanUrl) : [];
  target.runtime = {
    name: runtime.name,
    version: runtime.version,
    runtime: runtime.runtime,
    platform: runtime.platform,
    bindHost: runtime.bindHost,
    trayEnabled: runtime.trayEnabled,
    localUrl: runtime.localUrl,
    lanUrls,
  };
  target.checks.runtime = {
    ok: runtime.name === "agentwatch" && runtime.runtime === "rust-headless",
  };
  target.checks.bindHost = {
    ok: runtime.bindHost === "0.0.0.0",
    value: runtime.bindHost || null,
  };
  target.checks.lanUrl = {
    ok: lanUrls.length > 0,
    value: lanUrls[0] || null,
  };
  const lanHealthz = lanUrls[0] ? await tryGetJson(lanUrls[0], "/healthz") : { ok: false, error: "no LAN URL" };
  target.checks.lanHealthz = {
    ok: lanHealthz.ok && lanHealthz.data?.ok === true,
    url: lanUrls[0] ? new URL("/healthz", normalizeBaseUrl(lanUrls[0])).toString() : null,
    ...(lanHealthz.error ? { error: lanHealthz.error } : {}),
  };

  const dashboardHtml = await getText("/");
  const appJs = await getText("/app.js");
  const stylesCss = await getText("/styles.css");
  target.checks.dashboard = {
    ok:
      dashboardHtml.includes("AgentWatch") &&
      dashboardHtml.includes("copyLanUrlBtn") &&
      appJs.includes("/api/remote-check") &&
      stylesCss.includes(".copy-url-btn"),
  };

  const remoteCheck = await getJson("/api/remote-check");
  target.remoteCheck = {
    clientIp: remoteCheck.clientIp,
    loopback: remoteCheck.loopback,
    sameHostIp: remoteCheck.sameHostIp,
    remoteClient: remoteCheck.remoteClient,
  };
  target.checks.remoteCheck = {
    ok: typeof remoteCheck.remoteClient === "boolean" && typeof remoteCheck.clientIp === "string",
  };
}

function nextSteps(target) {
  const lanUrl = target.runtime?.lanUrls?.[0] || "http://<agent-machine-ip>:<selected-port>";
  const steps = [];
  if (!target.readyForRemoteViewer) {
    if (!target.checks.bindHost?.ok) {
      steps.push("Start AgentWatch with bindHost 0.0.0.0 so other LAN devices can connect.");
    }
    if (!target.checks.lanUrl?.ok) {
      steps.push("Check network interfaces and firewall settings; no non-loopback LAN URL was detected.");
    }
    if (target.checks.lanUrl?.ok && !target.checks.lanHealthz?.ok) {
      steps.push("The service advertises a LAN URL, but /healthz did not respond through that URL. Check firewall, VPN, and interface binding.");
    }
    if (!target.checks.dashboard?.ok) {
      steps.push("Rebuild and reinstall the Rust server so the browser dashboard assets are current.");
    }
    return steps;
  }
  steps.push(`Open ${lanUrl} from another device on the same LAN.`);
  steps.push(`From a viewer machine with Node.js: node agentwatch-verify-remote-client.mjs --url ${lanUrl} --report remote-client-verification-${target.runtime?.platform || "platform"}.json`);
  steps.push("From a browser-only viewer: click `검증 JSON` in the Remote Verify panel, then import the downloaded report.");
  if (!target.remoteEvidenceSatisfied) {
    steps.push("Current preflight is local-only; final readiness still needs remoteClient: true from a different LAN device.");
  }
  return steps;
}

function printHuman(target) {
  console.log("AgentWatch LAN preflight");
  console.log("========================");
  console.log(`Target: ${target.targetUrl}`);
  console.log(`Reachable: ${target.reachable ? "yes" : "no"}`);
  console.log(`Runtime: ${target.runtime?.runtime || "unknown"} ${target.runtime?.version || ""}`.trim());
  console.log(`Bind host: ${target.runtime?.bindHost || "unknown"}`);
  console.log(`LAN URL: ${target.runtime?.lanUrls?.[0] || "missing"}`);
  console.log(`LAN healthz: ${target.checks.lanHealthz?.ok ? "passed" : "failed"}`);
  console.log(`Ready for remote viewer: ${target.readyForRemoteViewer ? "yes" : "no"}`);
  console.log(`Current client IP: ${target.remoteCheck?.clientIp || "unknown"}`);
  console.log(`Current client is remote: ${target.remoteCheck?.remoteClient === true ? "yes" : "no"}`);
  console.log("");
  console.log("Next steps:");
  for (const step of target.nextSteps) {
    console.log(`- ${step}`);
  }
}

async function getJson(pathname) {
  return fetchJsonUrl(new URL(pathname, targetUrl));
}

async function tryGetJson(baseUrl, pathname) {
  try {
    return {
      ok: true,
      data: await fetchJsonUrl(new URL(pathname, normalizeBaseUrl(baseUrl))),
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function fetchJsonUrl(url) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(requestTimeoutMs) });
  if (!response.ok) throw new Error(`${url.pathname} returned ${response.status}`);
  return response.json();
}

async function getText(pathname) {
  const response = await fetch(new URL(pathname, targetUrl), { cache: "no-store", signal: AbortSignal.timeout(requestTimeoutMs) });
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}`);
  return response.text();
}

function writeReport(path, data) {
  if (!path) return;
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
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

function isLanUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (allowLoopbackLanUrl && host.startsWith("127.")) return true;
    return host !== "localhost" && host !== "0.0.0.0" && host !== "::1" && !host.startsWith("127.");
  } catch {
    return false;
  }
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
