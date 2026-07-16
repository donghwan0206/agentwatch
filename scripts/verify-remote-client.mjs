#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { arch, hostname, platform, release } from "node:os";
import { dirname, resolve } from "node:path";

const targetUrl = normalizeBaseUrl(getOptionValue("--url") || process.env.AGENTWATCH_REMOTE_URL);
const reportPath = getOptionValue("--report") || process.env.AGENTWATCH_REMOTE_REPORT || null;
const allowLoopback = process.argv.includes("--allow-loopback") || isTruthy(process.env.AGENTWATCH_REMOTE_ALLOW_LOOPBACK);
const allowSameHost = process.argv.includes("--allow-same-host") || isTruthy(process.env.AGENTWATCH_REMOTE_ALLOW_SAME_HOST);

if (!targetUrl) {
  throw new Error("--url http://<agent-machine-ip>:<port> is required");
}

const parsedTarget = new URL(targetUrl);
if (!allowLoopback && isLoopbackHost(parsedTarget.hostname)) {
  throw new Error("Remote client verification must target the agent machine LAN IP, not loopback");
}

const client = {
  hostname: hostname(),
  platform: platform(),
  release: release(),
  arch: arch(),
};

const health = await getJson(`${targetUrl}/healthz`);
assert(health.ok === true, "healthz did not return ok=true");

const runtime = await getJson(`${targetUrl}/api/runtime`);
assert(runtime.runtime === "rust-headless", "runtime.runtime mismatch");
assert(runtime.name === "agentwatch", "runtime.name mismatch");
assert(runtime.trayEnabled === false, "service tray mode must be false");
assert(runtime.bindHost === "0.0.0.0", "service bindHost must be 0.0.0.0");
assert(Number.isInteger(runtime.port) && runtime.port > 0, "runtime.port missing");

const snapshot = await getJson(`${targetUrl}/api/snapshot`);
assert(snapshot.activity, "snapshot.activity missing");
assert(Array.isArray(snapshot.providers), "snapshot.providers missing");

const dashboardHtml = await getText(`${targetUrl}/`);
assert(dashboardHtml.includes("AgentWatch"), "dashboard HTML missing AgentWatch marker");
const appJs = await getText(`${targetUrl}/app.js`);
assert(appJs.includes("/api/snapshot"), "dashboard JS missing snapshot API usage");
const stylesCss = await getText(`${targetUrl}/styles.css`);
assert(stylesCss.includes(":root"), "dashboard CSS missing root styles");
const usage = await getJson(`${targetUrl}/api/usage?days=366`);
const usageChecks = validateUsageContracts(dashboardHtml, appJs, stylesCss, usage);
const providerHistory = await getJson(`${targetUrl}/api/provider-history?minutes=180`);
const providerHistoryChecks = validateProviderHistoryContract(providerHistory);
const remoteCheck = await getJson(`${targetUrl}/api/remote-check`);
const remoteCheckChecks = validateRemoteCheckContract(remoteCheck);

const sameHost = sameHostname(client.hostname, runtime.hostname) || remoteCheck.sameHostIp === true || remoteCheck.loopback === true;
const result = sameHost || remoteCheck.remoteClient !== true ? "local-only" : "passed";
if (result !== "passed" && !allowSameHost) {
  writeReport(reportPath, runtime, snapshot, client, sameHost, result, usageChecks, providerHistoryChecks, remoteCheckChecks);
  throw new Error(
    `Remote client check did not prove a different LAN machine (client ${remoteCheckChecks.clientIp}); run this verifier from another LAN machine`,
  );
}

printSummary(runtime, snapshot, client, sameHost, result);
writeReport(reportPath, runtime, snapshot, client, sameHost, result, usageChecks, providerHistoryChecks, remoteCheckChecks);

function printSummary(runtimePayload, snapshotPayload, clientPayload, sameHostPayload, resultPayload) {
  console.log("");
  console.log("AgentWatch remote client verification");
  console.log("=====================================");
  console.log(`Target URL: ${targetUrl}`);
  console.log(`Client host: ${clientPayload.hostname}`);
  console.log(`Agent host: ${runtimePayload.hostname || "unknown"}`);
  console.log(`Same host: ${sameHostPayload}`);
  console.log(`Client IP: ${remoteCheckChecks.clientIp}`);
  console.log(`Remote client: ${remoteCheckChecks.remoteClient}`);
  console.log(`Runtime: ${runtimePayload.runtime}`);
  console.log(`Platform: ${runtimePayload.platform}`);
  console.log(`Status: ${snapshotPayload.activity?.status}`);
  console.log(`Processes: ${snapshotPayload.activity?.activeProcessCount}`);
  console.log(`Result: ${resultPayload}`);
}

function writeReport(targetPath, runtimePayload, snapshotPayload, clientPayload, sameHostPayload, resultPayload, usageChecksPayload, providerHistoryChecksPayload, remoteCheckChecksPayload) {
  if (!targetPath) return;

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    verifier: "scripts/verify-remote-client.mjs",
    targetUrl,
    client: clientPayload,
    result: resultPayload,
    automatedChecks: {
      healthz: "passed",
      runtimeEndpoint: "passed",
      snapshotEndpoint: "passed",
      providerHistoryEndpoint: providerHistoryChecksPayload.endpoint,
      providerHistoryCount: providerHistoryChecksPayload.count,
      remoteCheckEndpoint: remoteCheckChecksPayload.endpoint,
      remoteClient: remoteCheckChecksPayload.remoteClient,
      clientIp: remoteCheckChecksPayload.clientIp,
      clientAddress: remoteCheckChecksPayload.clientAddress,
      sameHostIp: remoteCheckChecksPayload.sameHostIp,
      loopback: remoteCheckChecksPayload.loopback,
      dashboardHtml: "passed",
      dashboardJs: "passed",
      dashboardCss: "passed",
      usageEndpoint: "passed",
      usageDashboardHtml: usageChecksPayload.dashboardHtml,
      usageDashboardJs: usageChecksPayload.dashboardJs,
      usageDashboardCss: usageChecksPayload.dashboardCss,
      usageDaily: usageChecksPayload.daily,
      usageTotals: usageChecksPayload.totals,
      usageQuotas: usageChecksPayload.quotas,
      usageThreads: usageChecksPayload.threads,
      usageGoals: usageChecksPayload.goals,
      usageProviderCount: usageChecksPayload.providerCount,
      runtime: runtimePayload.runtime,
      version: runtimePayload.version,
      platform: runtimePayload.platform,
      trayEnabled: runtimePayload.trayEnabled,
      bindHost: runtimePayload.bindHost,
      port: runtimePayload.port,
      localUrl: runtimePayload.localUrl,
      lanUrls: runtimePayload.lanUrls || [],
      agentHostname: runtimePayload.hostname || null,
      clientHostname: clientPayload.hostname,
      sameHost: sameHostPayload,
      status: snapshotPayload.activity?.status || null,
      activeProcessCount: snapshotPayload.activity?.activeProcessCount ?? null,
      totalCpu: snapshotPayload.activity?.totalCpu ?? null,
    },
  };

  mkdirSync(dirname(resolve(targetPath)), { recursive: true });
  writeFileSync(targetPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Remote client verification report: ${targetPath}`);
}

function validateRemoteCheckContract(payload) {
  assert(payload && typeof payload === "object", "remote-check response missing");
  assert(typeof payload.clientIp === "string" && payload.clientIp.length > 0, "remote-check clientIp missing");
  assert(typeof payload.clientAddress === "string" && payload.clientAddress.length > 0, "remote-check clientAddress missing");
  assert(typeof payload.remoteClient === "boolean", "remote-check remoteClient missing");
  assert(typeof payload.sameHostIp === "boolean", "remote-check sameHostIp missing");
  assert(typeof payload.loopback === "boolean", "remote-check loopback missing");
  return {
    endpoint: "passed",
    remoteClient: payload.remoteClient,
    clientIp: payload.clientIp,
    clientAddress: payload.clientAddress,
    sameHostIp: payload.sameHostIp,
    loopback: payload.loopback,
  };
}

function validateProviderHistoryContract(payload) {
  assert(Array.isArray(payload?.providerHistory), "providerHistory missing");
  return {
    endpoint: "passed",
    count: payload.providerHistory.length,
  };
}

function validateUsageContracts(dashboardHtml, appJs, stylesCss, payload) {
  assert(dashboardHtml.includes("일별 토큰 잔디"), "dashboard HTML missing token grass marker");
  assert(dashboardHtml.includes("최근 Codex 스레드 토큰"), "dashboard HTML missing Codex thread token marker");
  assert(dashboardHtml.includes("남은 사용량"), "dashboard HTML missing quota marker");
  assert(dashboardHtml.includes("observedTokens"), "dashboard HTML missing observed token total");
  assert(dashboardHtml.includes("maxDayTokens"), "dashboard HTML missing max day token marker");
  assert(dashboardHtml.includes("Provider별 최근 로그"), "dashboard HTML missing provider history marker");
  assert(dashboardHtml.includes("브라우저 원격 검증"), "dashboard HTML missing browser remote verification marker");
  assert(appJs.includes("/api/usage?days=366"), "dashboard JS missing usage API usage");
  assert(appJs.includes("/api/provider-history?minutes=180"), "dashboard JS missing provider history API usage");
  assert(appJs.includes("/api/remote-check"), "dashboard JS missing remote-check API usage");
  assert(appJs.includes("renderGoalUsage"), "dashboard JS missing goal usage renderer");
  assert(appJs.includes("observedTokens"), "dashboard JS missing observed token renderer");
  assert(appJs.includes("maxDayTokens"), "dashboard JS missing max day token renderer");
  assert(appJs.includes("renderProviderHistory"), "dashboard JS missing provider history renderer");
  assert(appJs.includes("buildBrowserRemoteReport"), "dashboard JS missing browser remote report builder");
  assert(stylesCss.includes(".token-grass"), "dashboard CSS missing token grass styles");
  assert(stylesCss.includes(".token-stats"), "dashboard CSS missing token stat styles");
  assert(stylesCss.includes(".thread-row"), "dashboard CSS missing thread row styles");
  assert(stylesCss.includes(".provider-history-row"), "dashboard CSS missing provider history row styles");
  assert(stylesCss.includes(".top-menu"), "dashboard CSS missing compact header menu styles");
  assert(stylesCss.includes(".remote-verify-facts"), "dashboard CSS missing remote verification styles");

  const usage = Array.isArray(payload?.usage) ? payload.usage : null;
  assert(usage, "usage response missing usage array");
  const codex = usage.find((item) => item.provider === "codex") || usage[0];
  assert(codex, "usage response has no provider rows");
  assert(Array.isArray(codex.daily), "usage.daily missing");
  assert(codex.totals && typeof codex.totals === "object", "usage.totals missing");
  assert(Number.isFinite(Number(codex.totals.observedTokens)), "usage.totals.observedTokens missing");
  assert(Array.isArray(codex.quotas), "usage.quotas missing");
  assert(Array.isArray(codex.threads), "usage.threads missing");
  assert(Array.isArray(codex.goals), "usage.goals missing");

  return {
    dashboardHtml: "passed",
    dashboardJs: "passed",
    dashboardCss: "passed",
    daily: "passed",
    totals: "passed",
    quotas: "passed",
    threads: "passed",
    goals: "passed",
    providerCount: usage.length,
  };
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeBaseUrl(value) {
  if (!value) return null;
  return String(value).replace(/\/+$/, "");
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

function isLoopbackHost(value) {
  const host = String(value || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.startsWith("127.");
}

function sameHostname(left, right) {
  if (!left || !right) return false;
  return normalizeHostname(left) === normalizeHostname(right);
}

function normalizeHostname(value) {
  return String(value).trim().toLowerCase().replace(/\.local$/, "");
}

function isTruthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ""));
}
