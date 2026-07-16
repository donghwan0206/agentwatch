#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, homedir, hostname, platform, release } from "node:os";
import { dirname, join, resolve } from "node:path";

const targetUrl = normalizeBaseUrl(
  getOptionValue("--url") ||
    process.env.AGENTWATCH_SERVICE_URL ||
    process.env.AGENTWATCH_URL ||
    await discoverLocalAgentWatchUrl(),
);
const reportPath = getOptionValue("--report") || process.env.AGENTWATCH_SERVICE_REPORT || null;
const manualResult = normalizeManualResult(
  getOptionValue("--manual-result") || process.env.AGENTWATCH_MANUAL_RESULT || "pending",
);
const manualNotes = getOptionValue("--manual-notes") || process.env.AGENTWATCH_MANUAL_NOTES || null;
const skipServiceCheck = process.argv.includes("--skip-service-check") || isTruthy(process.env.AGENTWATCH_SKIP_SERVICE_CHECK);
const skipLanCheck = process.argv.includes("--skip-lan-check") || isTruthy(process.env.AGENTWATCH_SKIP_LAN_CHECK);
const serviceName = getOptionValue("--service-name") || process.env.AGENTWATCH_SERVICE_NAME || defaultServiceName();
const lifecycleReportPath = getOptionValue("--lifecycle-report") || process.env.AGENTWATCH_LIFECYCLE_REPORT || null;
const evidencePaths = getOptionValues("--evidence")
  .concat(splitList(process.env.AGENTWATCH_EVIDENCE_FILES))
  .map((filePath) => resolve(filePath));

validateManualEvidence();

const health = await getJson(`${targetUrl}/healthz`);
assert(health.ok === true, "healthz did not return ok=true");

const runtime = await getJson(`${targetUrl}/api/runtime`);
assert(runtime.runtime === "rust-headless", "runtime.runtime mismatch");
assert(runtime.name === "agentwatch", "runtime.name mismatch");
assert(typeof runtime.version === "string" && runtime.version.length > 0, "runtime.version missing");
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

const serviceRegistration = verifyServiceRegistration();
const loginStartContract = verifyLoginStartContract();
const lanReachability = await verifyLanUrlReachability(runtime);
const lifecycleEvidence = readLifecycleEvidence(runtime.platform);

printSummary(runtime, snapshot, serviceRegistration, lanReachability, lifecycleEvidence);
writeReport(reportPath, runtime, snapshot, serviceRegistration, lanReachability, lifecycleEvidence, usageChecks, providerHistoryChecks);

function printSummary(runtimePayload, snapshotPayload, serviceRegistrationPayload, lanReachabilityPayload, lifecycleEvidencePayload) {
  const lanUrls = runtimePayload.lanUrls?.length ? runtimePayload.lanUrls : ["LAN unavailable"];
  console.log("");
  console.log("AgentWatch service verification");
  console.log("===============================");
  console.log(`Runtime: ${runtimePayload.runtime}`);
  console.log(`Version: ${runtimePayload.version}`);
  console.log(`Platform: ${runtimePayload.platform}`);
  console.log(`Tray enabled: ${runtimePayload.trayEnabled}`);
  console.log(`Local URL: ${runtimePayload.localUrl}`);
  console.log(`LAN URL: ${lanUrls[0]}`);
  console.log(`LAN reachability: ${lanReachabilityPayload.status}`);
  console.log(`Service registration: ${serviceRegistrationPayload.status}`);
  console.log(`Lifecycle uninstall evidence: ${lifecycleEvidencePayload.uninstallClean}`);
  console.log(`Status: ${snapshotPayload.activity?.status}`);
  console.log(`Processes: ${snapshotPayload.activity?.activeProcessCount}`);
  console.log(`Manual result recorded in report: ${manualResult}`);
}

function writeReport(targetPath, runtimePayload, snapshotPayload, serviceRegistrationPayload, lanReachabilityPayload, lifecycleEvidencePayload, usageChecksPayload, providerHistoryChecksPayload) {
  if (!targetPath) return;

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    verifier: "scripts/verify-service.mjs",
    targetUrl,
    host: {
      hostname: hostname(),
      platform: platform(),
      release: release(),
      arch: arch(),
    },
    automatedChecks: {
      healthz: "passed",
      runtimeEndpoint: "passed",
      snapshotEndpoint: "passed",
      providerHistoryEndpoint: providerHistoryChecksPayload.endpoint,
      providerHistoryCount: providerHistoryChecksPayload.count,
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
      lanUrlReachable: lanReachabilityPayload.status,
      lanUrlChecked: lanReachabilityPayload.url,
      lanUrlDetail: lanReachabilityPayload.detail,
      serviceRegistered: serviceRegistrationPayload.status,
      serviceName: serviceRegistrationPayload.serviceName,
      serviceDetail: serviceRegistrationPayload.detail,
      loginStartContract: loginStartContract.status,
      loginStartContractDetail: loginStartContract.detail,
      lifecycleReport: lifecycleEvidencePayload.path,
      lifecycleUninstallClean: lifecycleEvidencePayload.uninstallClean,
      runtime: runtimePayload.runtime,
      version: runtimePayload.version,
      platform: runtimePayload.platform,
      trayEnabled: runtimePayload.trayEnabled,
      bindHost: runtimePayload.bindHost,
      port: runtimePayload.port,
      localUrl: runtimePayload.localUrl,
      lanUrls: runtimePayload.lanUrls || [],
      status: snapshotPayload.activity?.status || null,
      activeProcessCount: snapshotPayload.activity?.activeProcessCount ?? null,
      totalCpu: snapshotPayload.activity?.totalCpu ?? null,
    },
    manualChecksRequired: manualServiceChecks().map(([, label]) => label),
    manualChecks: manualServiceChecks().map(([id, label]) => ({
      id,
      label,
      status: manualStatusFor(id, lifecycleEvidencePayload),
    })),
    manualResult,
    manualNotes,
    evidenceFiles: evidencePaths.map(readEvidenceFile),
  };

  mkdirSync(dirname(resolve(targetPath)), { recursive: true });
  writeFileSync(targetPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Service verification report: ${targetPath}`);
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
  assert(dashboardHtml.includes("copyLanUrlBtn"), "dashboard HTML missing LAN URL copy button");
  assert(appJs.includes("/api/usage?days=366"), "dashboard JS missing usage API usage");
  assert(appJs.includes("/api/provider-history?minutes=180"), "dashboard JS missing provider history API usage");
  assert(appJs.includes("/api/remote-check"), "dashboard JS missing remote-check API usage");
  assert(appJs.includes("renderGoalUsage"), "dashboard JS missing goal usage renderer");
  assert(appJs.includes("observedTokens"), "dashboard JS missing observed token renderer");
  assert(appJs.includes("maxDayTokens"), "dashboard JS missing max day token renderer");
  assert(appJs.includes("renderProviderHistory"), "dashboard JS missing provider history renderer");
  assert(appJs.includes("buildBrowserRemoteReport"), "dashboard JS missing browser remote report builder");
  assert(appJs.includes("copyLanUrl"), "dashboard JS missing LAN URL copy handler");
  assert(stylesCss.includes(".token-grass"), "dashboard CSS missing token grass styles");
  assert(stylesCss.includes(".token-stats"), "dashboard CSS missing token stat styles");
  assert(stylesCss.includes(".thread-row"), "dashboard CSS missing thread row styles");
  assert(stylesCss.includes(".provider-history-row"), "dashboard CSS missing provider history row styles");
  assert(stylesCss.includes(".top-menu"), "dashboard CSS missing compact header menu styles");
  assert(stylesCss.includes(".remote-verify-facts"), "dashboard CSS missing remote verification styles");
  assert(stylesCss.includes(".copy-url-btn"), "dashboard CSS missing LAN URL copy styles");

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

function manualStatusFor(id, lifecycleEvidencePayload) {
  if (manualResult === "passed") return "passed";
  if (manualResult === "failed") return "failed";
  if (id === "uninstallClean" && lifecycleEvidencePayload.uninstallClean === "passed") {
    return "passed";
  }
  return "pending";
}

function manualServiceChecks() {
  return [
    ["startsOnLogin", "service starts after login or reboot"],
    ["lanUrlReachable", "reported LAN URL responds to the service health check"],
    ["uninstallClean", "service uninstaller removes the background registration cleanly"],
  ];
}

function verifyServiceRegistration() {
  if (skipServiceCheck) {
    return { status: "skipped", serviceName, detail: "--skip-service-check" };
  }

  const currentPlatform = platform();
  if (currentPlatform === "darwin") {
    const domain = `gui/${process.getuid?.() ?? ""}/${serviceName}`;
    const result = spawnSync("launchctl", ["print", domain], { encoding: "utf8" });
    assert(result.status === 0, `macOS LaunchAgent not registered: ${result.stderr || result.stdout}`);
    assert(result.stdout.includes("state = running"), "macOS LaunchAgent is not running");
    return { status: "passed", serviceName, detail: firstDetailLine(result.stdout, /state =|program =|pid =/) };
  }

  if (currentPlatform === "linux") {
    const active = spawnSync("systemctl", ["--user", "is-active", serviceName], { encoding: "utf8" });
    assert(active.status === 0, `systemd user service is not active: ${active.stderr || active.stdout}`);
    return { status: "passed", serviceName, detail: `systemctl --user is-active ${serviceName}: ${active.stdout.trim()}` };
  }

  if (currentPlatform === "win32") {
    const result = spawnSync("schtasks.exe", ["/Query", "/TN", serviceName], { encoding: "utf8" });
    assert(result.status === 0, `Windows Scheduled Task not registered: ${result.stderr || result.stdout}`);
    return { status: "passed", serviceName, detail: firstDetailLine(result.stdout, /TaskName:|Status:/) };
  }

  return { status: "skipped", serviceName, detail: `unsupported platform ${currentPlatform}` };
}

function verifyLoginStartContract() {
  const currentPlatform = platform();
  if (currentPlatform === "darwin") {
    const plist = resolve(process.env.HOME || "", "Library", "LaunchAgents", `${serviceName}.plist`);
    try {
      const content = readFileSync(plist, "utf8");
      const runAtLoad = /<key>RunAtLoad<\/key>\s*<true\/>/.test(content);
      const keepAlive = /<key>KeepAlive<\/key>\s*<true\/>/.test(content);
      const programArguments = /<key>ProgramArguments<\/key>/.test(content);
      return {
        status: runAtLoad && keepAlive && programArguments ? "passed" : "failed",
        detail: `plist=${plist}; RunAtLoad=${runAtLoad}; KeepAlive=${keepAlive}; ProgramArguments=${programArguments}`,
      };
    } catch (error) {
      return { status: "failed", detail: `plist=${plist}; ${error.message}` };
    }
  }

  if (currentPlatform === "linux") {
    const enabled = spawnSync("systemctl", ["--user", "is-enabled", serviceName], { encoding: "utf8" });
    return {
      status: enabled.status === 0 ? "passed" : "failed",
      detail: `systemctl --user is-enabled ${serviceName}: ${(enabled.stdout || enabled.stderr || "").trim()}`,
    };
  }

  if (currentPlatform === "win32") {
    const query = spawnSync("schtasks.exe", ["/Query", "/TN", serviceName, "/V", "/FO", "LIST"], { encoding: "utf8" });
    const output = `${query.stdout || ""}\n${query.stderr || ""}`;
    const atLogon = /Logon|At logon|AtLogOn/i.test(output);
    return {
      status: query.status === 0 && atLogon ? "passed" : "failed",
      detail: atLogon ? "Scheduled Task has logon trigger" : firstDetailLine(output, /TaskName:|Status:|Schedule Type:/),
    };
  }

  return { status: "skipped", detail: `unsupported platform ${currentPlatform}` };
}

function readLifecycleEvidence(runtimePlatform) {
  const path = lifecycleReportPath || defaultLifecycleReportPath(runtimePlatform);
  if (!path || !existsSync(path)) {
    return { path: path || null, uninstallClean: "missing" };
  }

  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    const steps = Array.isArray(data.steps) ? data.steps : [];
    const uninstallClean = steps.find((step) => step.name === "uninstallClean");
    const reinstallHealthy = steps.find((step) => step.name === "reinstallHealthy");
    if (data.result === "passed" && uninstallClean?.status === "passed" && reinstallHealthy?.status === "passed") {
      return { path, uninstallClean: "passed" };
    }
    return { path, uninstallClean: "failed" };
  } catch (error) {
    return { path, uninstallClean: `invalid: ${error.message}` };
  }
}

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

async function verifyLanUrlReachability(runtimePayload) {
  const lanUrl = runtimePayload.lanUrls?.[0] || null;
  if (!lanUrl) {
    assert(skipLanCheck, "runtime.lanUrls is empty; use --skip-lan-check only for pre-LAN checks");
    return { status: "skipped", url: null, detail: "--skip-lan-check and no LAN URL" };
  }

  if (skipLanCheck) {
    return { status: "skipped", url: lanUrl, detail: "--skip-lan-check" };
  }

  const health = await getJson(`${normalizeBaseUrl(lanUrl)}/healthz`);
  assert(health.ok === true, `LAN URL healthz did not return ok=true: ${lanUrl}`);
  return { status: "passed", url: lanUrl, detail: "healthz ok" };
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

function defaultServiceName() {
  const currentPlatform = platform();
  if (currentPlatform === "darwin") return "com.agentwatch.monitor";
  if (currentPlatform === "linux") return "agentwatch.service";
  if (currentPlatform === "win32") return "AgentWatchMonitor";
  return "agentwatch";
}

function defaultLifecycleReportPath(runtimePlatform) {
  if (!reportPath) return null;
  return join(dirname(resolve(reportPath)), `service-lifecycle-${runtimePlatform}.json`);
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

function getOptionValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== name) continue;
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${name} requires a value`);
    }
    values.push(value);
  }
  return values;
}

function normalizeManualResult(value) {
  const normalized = String(value || "pending").toLowerCase();
  if (!["pending", "passed", "failed"].includes(normalized)) {
    throw new Error("--manual-result must be pending, passed, or failed");
  }
  return normalized;
}

function validateManualEvidence() {
  if (manualResult !== "passed") return;
  if (!manualNotes || manualNotes.trim().length === 0) {
    throw new Error("--manual-notes is required when --manual-result passed is used");
  }
}

function splitList(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function firstDetailLine(value, pattern) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => pattern.test(line)) || "registered";
}

function readEvidenceFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Evidence file does not exist: ${filePath}`);
  }
  const content = readFileSync(filePath);
  return {
    path: filePath,
    bytes: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}
