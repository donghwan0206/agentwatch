#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { arch, hostname, platform, release, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.AGENTWATCH_VERIFY_PORT
  ? Number(process.env.AGENTWATCH_VERIFY_PORT)
  : await findAvailablePort(8895, 8935);
const holdMs = Number(process.env.AGENTWATCH_VERIFY_HOLD_MS || "0");
const reportPath = getOptionValue("--report") || process.env.AGENTWATCH_VERIFY_REPORT || null;
const requestedAppPath = getOptionValue("--app") || process.env.AGENTWATCH_APP || null;
const manualResult = normalizeManualResult(
  getOptionValue("--manual-result") || process.env.AGENTWATCH_MANUAL_RESULT || "pending",
);
const manualNotes = getOptionValue("--manual-notes") || process.env.AGENTWATCH_MANUAL_NOTES || null;
const manualCheckItems = [
  ["startsHidden", "app starts with the main window hidden and only the tray/menu-bar indicator visible"],
  ["trayIconVisible", "tray/menu-bar icon is visible on a real desktop session"],
  ["trayMenuItems", "tray menu shows Runtime, Agents, Local, LAN, Open dashboard, and Quit"],
  ["trayTooltip", "tray tooltip includes status, process count, CPU, Local URL, and LAN URL"],
  ["openDashboard", "Open dashboard brings the existing window to the front"],
  ["closeKeepsHealthz", "closing the main window hides it while /healthz remains healthy"],
  ["quitExitsApp", "Quit exits the app"],
  ["lanUrlReachable", "a second LAN device can open the reported LAN URL"],
];
const platformManualCheckItems = {
  windows: [["windowsNoConsole", "Windows release build starts without a console window"]],
};
const screenshotPaths = getOptionValues("--screenshot")
  .concat(splitList(process.env.AGENTWATCH_SCREENSHOTS))
  .map((screenshotPath) => resolve(screenshotPath));
validateManualEvidence();
const hiddenStartup = verifyHiddenStartupContract();
const traySourceContract = verifyTraySourceContract();
const dbPath = join(tmpdir(), `agentwatch-verify-${process.pid}.sqlite3`);
const appPath = findAppBinary();

if (!appPath) {
  console.error(
    "AgentWatch app binary was not found. Run `npm run build` first, or pass `--app <path>`.",
  );
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
  const snapshot = await getJson(`http://127.0.0.1:${port}/api/snapshot`);
  const dashboardHtml = await getText(`http://127.0.0.1:${port}/`);
  assert(dashboardHtml.includes("AgentWatch"), "dashboard HTML missing AgentWatch marker");
  const appJs = await getText(`http://127.0.0.1:${port}/app.js`);
  assert(appJs.includes("/api/snapshot"), "dashboard JS missing snapshot API usage");
  const stylesCss = await getText(`http://127.0.0.1:${port}/styles.css`);
  assert(stylesCss.includes(":root"), "dashboard CSS missing root styles");
  const usage = await getJson(`http://127.0.0.1:${port}/api/usage?days=366`);
  const usageChecks = validateUsageContracts(dashboardHtml, appJs, stylesCss, usage);
  const providerHistory = await getJson(`http://127.0.0.1:${port}/api/provider-history?minutes=180`);
  const providerHistoryChecks = validateProviderHistoryContract(providerHistory);

  assert(runtime.runtime === "tauri-rust", "runtime.runtime mismatch");
  assert(runtime.name === "agentwatch", "runtime.name mismatch");
  assert(typeof runtime.version === "string" && runtime.version.length > 0, "runtime.version missing");
  assert(runtime.trayEnabled === true, "tray mode is not enabled");
  assert(runtime.port === port, `runtime.port expected ${port}, got ${runtime.port}`);
  const target = visualTargetFor(runtime.platform);
  assert(runtime.indicatorTarget === target.id, `runtime.indicatorTarget expected ${target.id}, got ${runtime.indicatorTarget || "missing"}`);

  printChecklist(runtime, snapshot);

  if (holdMs > 0) {
    await sleep(holdMs);
  } else {
    await waitForEnter();
  }

  writeReport(reportPath, runtime, snapshot, usageChecks, providerHistoryChecks);
} finally {
  await stopChild(child);
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

if (stderr.trim()) {
  console.error(stderr.trim());
}

function printChecklist(runtime, snapshot) {
  const lanUrls = runtime.lanUrls?.length ? runtime.lanUrls : ["LAN unavailable"];
  const target = visualTargetFor(runtime.platform);
  const manualChecks = manualChecksFor(runtime.platform);
  console.log("");
  console.log("AgentWatch tray verification");
  console.log("============================");
  console.log(`Runtime: ${runtime.runtime}`);
  console.log(`Version: ${runtime.version}`);
  console.log(`Platform: ${runtime.platform}`);
  console.log(`Tray enabled: ${runtime.trayEnabled}`);
  console.log(`Indicator target: ${target.label}`);
  console.log(`Hidden startup config: ${hiddenStartup.status}`);
  console.log(`Local URL: ${runtime.localUrl}`);
  console.log(`LAN URL: ${lanUrls[0]}`);
  console.log(`Status: ${snapshot.activity?.status}`);
  console.log(`Processes: ${snapshot.activity?.activeProcessCount}`);
  console.log(`CPU: ${snapshot.activity?.totalCpu?.toFixed?.(1) ?? "unknown"}%`);
  console.log("");
  console.log("Manual checks:");
  manualChecks.forEach(([, label], index) => {
    console.log(`${index + 1}. ${label}`);
  });
  console.log("");
  console.log(`Manual result recorded in report: ${manualResult}`);
  if (reportPath && screenshotPaths.length > 0) {
    console.log(holdMs > 0 ? "Screenshot evidence files:" : "Capture/update screenshot files before pressing Enter:");
    for (const screenshotPath of screenshotPaths) {
      console.log(`- ${screenshotPath}`);
    }
  }
  if (holdMs > 0) {
    console.log(`Auto-stopping verification after ${holdMs}ms.`);
  } else {
    console.log("Press Enter here to stop the verification process.");
  }
}

function writeReport(targetPath, runtime, snapshot, usageChecks, providerHistoryChecks) {
  if (!targetPath) return;
  const target = visualTargetFor(runtime.platform);

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    verifier: "scripts/verify-tray.mjs",
    requestedAppPath,
    appBinary: appPath,
    visualTarget: target.id,
    visualTargetLabel: target.label,
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
      providerHistoryEndpoint: providerHistoryChecks.endpoint,
      providerHistoryCount: providerHistoryChecks.count,
      dashboardHtml: "passed",
      dashboardJs: "passed",
      dashboardCss: "passed",
      startsHiddenConfig: hiddenStartup.status,
      startsHiddenDetail: hiddenStartup.detail,
      trayMenuContract: traySourceContract.menu.status,
      trayMenuContractDetail: traySourceContract.menu.detail,
      trayTooltipContract: traySourceContract.tooltip.status,
      trayTooltipContractDetail: traySourceContract.tooltip.detail,
      openDashboardContract: traySourceContract.openDashboard.status,
      openDashboardContractDetail: traySourceContract.openDashboard.detail,
      closeToTrayContract: traySourceContract.closeToTray.status,
      closeToTrayContractDetail: traySourceContract.closeToTray.detail,
      windowsNoConsoleContract: traySourceContract.windowsNoConsole.status,
      windowsNoConsoleContractDetail: traySourceContract.windowsNoConsole.detail,
      usageEndpoint: "passed",
      usageDashboardHtml: usageChecks.dashboardHtml,
      usageDashboardJs: usageChecks.dashboardJs,
      usageDashboardCss: usageChecks.dashboardCss,
      usageDaily: usageChecks.daily,
      usageTotals: usageChecks.totals,
      usageQuotas: usageChecks.quotas,
      usageThreads: usageChecks.threads,
      usageGoals: usageChecks.goals,
      usageProviderCount: usageChecks.providerCount,
      runtime: runtime.runtime,
      version: runtime.version,
      platform: runtime.platform,
      indicatorTarget: target.id,
      runtimeIndicatorTarget: runtime.indicatorTarget,
      trayEnabled: runtime.trayEnabled,
      port: runtime.port,
      localUrl: runtime.localUrl,
      lanUrls: runtime.lanUrls || [],
      status: snapshot.activity?.status || null,
      activeProcessCount: snapshot.activity?.activeProcessCount ?? null,
      totalCpu: snapshot.activity?.totalCpu ?? null,
    },
    manualChecksRequired: manualChecksFor(runtime.platform).map(([, label]) => label),
    manualChecks: manualChecksFor(runtime.platform).map(([id, label]) => ({
      id,
      label,
      status: manualResult === "passed" ? "passed" : manualResult === "failed" ? "failed" : "pending",
    })),
    manualResult,
    manualNotes,
    screenshots: screenshotPaths.map(readEvidenceFile),
  };

  mkdirSync(dirname(resolve(targetPath)), { recursive: true });
  writeFileSync(targetPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Verification report: ${targetPath}`);
}

function manualChecksFor(runtimePlatform) {
  return manualCheckItems.concat(platformManualCheckItems[runtimePlatform] || []);
}

function verifyHiddenStartupContract() {
  try {
    const config = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
    const libRs = readFileSync(join(root, "src-tauri", "src", "lib.rs"), "utf8");
    const mainWindow = (config.app?.windows || []).find((windowConfig) => windowConfig.label === "main");
    const windowHidden = mainWindow?.visible === false;
    const trayDefaultEnabled = /let\s+tray_enabled\s*=\s*!no_tray_mode\(\)/.test(libRs);
    const showGated =
      /if\s+!tray_installed\s*\|\|\s*show_window_on_start\(\)\s*\{[\s\S]*?window\.show\(\)/.test(libRs);
    const overrideEnv = libRs.includes("AGENTWATCH_SHOW_WINDOW_ON_START");
    const trayFailureFallback =
      /Err\(error\)[\s\S]*AgentWatch tray setup failed[\s\S]*false/.test(libRs);
    const platformDefault =
      /cfg\(target_os = "macos"\)[\s\S]*fn\s+default_show_window_on_start\(\)\s*->\s*bool[\s\S]*false/.test(libRs) &&
      /cfg\(not\(target_os = "macos"\)\)[\s\S]*fn\s+default_show_window_on_start\(\)\s*->\s*bool[\s\S]*true/.test(libRs);
    const ok = windowHidden && trayDefaultEnabled && showGated && overrideEnv && trayFailureFallback && platformDefault;
    return {
      status: ok ? "passed" : "failed",
      detail: [
        `main.visible=${String(mainWindow?.visible)}`,
        `trayDefaultEnabled=${String(trayDefaultEnabled)}`,
        `showWindowGated=${String(showGated)}`,
        `overrideEnv=${String(overrideEnv)}`,
        `trayFailureFallback=${String(trayFailureFallback)}`,
        `platformDefault=${String(platformDefault)}`,
      ].join("; "),
    };
  } catch (error) {
    return {
      status: "failed",
      detail: error.message,
    };
  }
}

function verifyTraySourceContract() {
  try {
    const trayRs = readFileSync(join(root, "src-tauri", "src", "tray.rs"), "utf8");
    const requiredMenuIds = [
      "status",
      "runtime",
      "agents",
      "local_url",
      "lan_url",
      "update_status",
      "update_check",
      "update_install",
      "open",
      "quit",
    ];
    const requiredMenuLabels = [
      "AgentWatch monitoring",
      "Runtime:",
      "Agents:",
      "Local:",
      "LAN:",
      "Update:",
      "Check for updates",
      "Install update",
      "Open dashboard",
      "Quit",
    ];
    const missingIds = requiredMenuIds.filter((id) => !trayRs.includes(`"${id}"`));
    const missingLabels = requiredMenuLabels.filter((label) => !trayRs.includes(label));
    const menuOk =
      missingIds.length === 0 &&
      missingLabels.length === 0 &&
      /Menu::with_items[\s\S]*status[\s\S]*runtime[\s\S]*agents[\s\S]*local_url[\s\S]*lan_url[\s\S]*open[\s\S]*quit/.test(
        trayRs,
      ) &&
      /fn\s+agent_summary[\s\S]*take\(3\)[\s\S]*Agents:/.test(trayRs) &&
      /"open"\s*=>\s*show_main_window/.test(trayRs) &&
      /"update_check"[\s\S]*update_state\.check\(\)\.await/.test(trayRs) &&
      /"update_install"[\s\S]*update_state\.install\(\)\.await/.test(trayRs) &&
      /"quit"\s*=>\s*app\.exit\(0\)/.test(trayRs);

    const requiredTooltipParts = [
      "AgentWatch monitoring",
      "processes",
      "CPU",
      "Local",
      "LAN",
    ];
    const missingTooltipParts = requiredTooltipParts.filter((part) => !trayRs.includes(part));
    const tooltipOk =
      missingTooltipParts.length === 0 &&
      /tray\.set_tooltip/.test(trayRs) &&
      /fn\s+agent_monitor_icon/.test(trayRs) &&
      /Image::new_owned/.test(trayRs) &&
      /cfg\(target_os = "macos"\)[\s\S]*\.icon_as_template\(true\)/.test(trayRs) &&
      /cfg\(not\(target_os = "macos"\)\)[\s\S]*put_pixel_rgba[\s\S]*red[\s\S]*green[\s\S]*blue/.test(trayRs) &&
      /tooltip:\s*format!\([\s\S]*AgentWatch monitoring[\s\S]*processes[\s\S]*CPU[\s\S]*Local[\s\S]*tooltip_lan/.test(
        trayRs,
      );
    const openDashboardOk =
      /"open"\s*=>\s*show_main_window/.test(trayRs) &&
      /TrayIconEvent::Click[\s\S]*show_main_window/.test(trayRs) &&
      /fn\s+show_main_window[\s\S]*window\.show\(\)[\s\S]*window\.set_focus\(\)/.test(trayRs);

    const libRs = readFileSync(join(root, "src-tauri", "src", "lib.rs"), "utf8");
    const mainRs = readFileSync(join(root, "src-tauri", "src", "main.rs"), "utf8");
    const closeToTrayOk =
      /CloseRequested[\s\S]*api\.prevent_close\(\)[\s\S]*window\.hide\(\)/.test(libRs) &&
      /let\s+server\s*=\s*server::spawn_server/.test(libRs);
    const windowsNoConsoleOk =
      /cfg_attr\(\s*all\(target_os\s*=\s*"windows",\s*not\(debug_assertions\)\),\s*windows_subsystem\s*=\s*"windows"\s*\)/.test(
        mainRs,
      );

    return {
      menu: {
        status: menuOk ? "passed" : "failed",
        detail: [
          `missingIds=${missingIds.join(",") || "none"}`,
          `missingLabels=${missingLabels.join(",") || "none"}`,
        ].join("; "),
      },
      tooltip: {
        status: tooltipOk ? "passed" : "failed",
        detail: `missingTooltipParts=${missingTooltipParts.join(",") || "none"}; explicitTitle=${/format!\("AW \{label\} \{process_count\}"\)/.test(trayRs)}; startingTitle=${/"AW starting"/.test(trayRs)}`,
      },
      openDashboard: {
        status: openDashboardOk ? "passed" : "failed",
        detail: `menuOpenAction=${/"open"\s*=>\s*show_main_window/.test(trayRs)}; trayClickAction=${/TrayIconEvent::Click[\s\S]*show_main_window/.test(trayRs)}; showMainWindow=${/fn\s+show_main_window[\s\S]*window\.show\(\)[\s\S]*window\.set_focus\(\)/.test(trayRs)}`,
      },
      closeToTray: {
        status: closeToTrayOk ? "passed" : "failed",
        detail: `preventCloseHide=${/CloseRequested[\s\S]*api\.prevent_close\(\)[\s\S]*window\.hide\(\)/.test(libRs)}; serverSpawnedInSetup=${/let\s+server\s*=\s*server::spawn_server/.test(libRs)}`,
      },
      windowsNoConsole: {
        status: windowsNoConsoleOk ? "passed" : "failed",
        detail: `windowsSubsystem=${String(windowsNoConsoleOk)}`,
      },
    };
  } catch (error) {
    return {
      menu: { status: "failed", detail: error.message },
      tooltip: { status: "failed", detail: error.message },
      openDashboard: { status: "failed", detail: error.message },
      closeToTray: { status: "failed", detail: error.message },
      windowsNoConsole: { status: "failed", detail: error.message },
    };
  }
}

function validateProviderHistoryContract(payload) {
  assert(Array.isArray(payload?.providerHistory), "providerHistory missing");
  return {
    endpoint: "passed",
    count: payload.providerHistory.length,
  };
}

function validateUsageContracts(dashboardHtml, appJs, stylesCss, payload) {
  assert(dashboardHtml.includes('data-i18n="tokens.title"'), "dashboard HTML missing token grass marker");
  assert(dashboardHtml.includes('data-i18n="threads.title"'), "dashboard HTML missing Codex thread token marker");
  assert(dashboardHtml.includes('data-i18n="quota.title"'), "dashboard HTML missing quota marker");
  assert(dashboardHtml.includes("observedTokens"), "dashboard HTML missing observed token total");
  assert(dashboardHtml.includes("maxDayTokens"), "dashboard HTML missing max day token marker");
  assert(dashboardHtml.includes('data-i18n="providerLogs.title"'), "dashboard HTML missing provider history marker");
  assert(dashboardHtml.includes('data-i18n="remote.title"'), "dashboard HTML missing browser remote verification marker");
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

function visualTargetFor(runtimePlatform) {
  if (runtimePlatform === "macos") {
    return { id: "macos-menu-bar", label: "macOS menu bar" };
  }
  if (runtimePlatform === "windows") {
    return { id: "windows-notification-area", label: "Windows notification area" };
  }
  if (runtimePlatform === "linux") {
    return { id: "linux-tray", label: "Linux tray/status notifier" };
  }
  return { id: "desktop-tray", label: "desktop tray/status area" };
}

function findAppBinary() {
  if (requestedAppPath) {
    return resolveAppPath(requestedAppPath);
  }

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

function resolveAppPath(candidatePath) {
  const resolved = resolve(candidatePath);
  if (!existsSync(resolved)) {
    throw new Error(`AgentWatch app path does not exist: ${resolved}`);
  }

  const stat = statSync(resolved);
  if (stat.isFile()) {
    return resolved;
  }

  if (stat.isDirectory() && platform() === "darwin" && resolved.endsWith(".app")) {
    const executableName = basename(resolved, ".app").toLowerCase();
    const candidates = [
      join(resolved, "Contents", "MacOS", executableName),
      join(resolved, "Contents", "MacOS", "agentwatch"),
      join(resolved, "Contents", "MacOS", "AgentWatch"),
    ];
    const appExecutable = candidates.find((candidate) => existsSync(candidate));
    if (appExecutable) return appExecutable;
  }

  throw new Error(`AgentWatch app path is not an executable file: ${resolved}`);
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

async function findAvailablePort(startPort, endPort) {
  for (let candidate = startPort; candidate <= endPort; candidate += 1) {
    if (await canBind(candidate)) {
      return candidate;
    }
  }
  throw new Error(`No available verification port found from ${startPort} to ${endPort}`);
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function waitForEnter() {
  return new Promise((resolveWait) => {
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdin.once("data", () => resolveWait());
  });
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
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
  if (screenshotPaths.length === 0) {
    throw new Error("at least one --screenshot is required when --manual-result passed is used");
  }
}

function splitList(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readEvidenceFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Screenshot evidence file does not exist: ${filePath}`);
  }
  const stat = statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`Screenshot evidence path is not a file: ${filePath}`);
  }
  const content = readFileSync(filePath);
  return {
    path: filePath,
    bytes: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
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
