import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "agentwatch-import-tray-test-"));

try {
  const assets = join(root, "release-assets");
  const validReport = join(root, "downloads", "tray-verification-macos.json");
  writeJson(validReport, trayReport("macos"));

  const imported = run([
    "scripts/import-tray-report.mjs",
    "--report",
    validReport,
    "--assets",
    assets,
  ]);
  assert.equal(imported.status, 0, imported.stderr);
  assert.match(imported.stdout, /Imported tray report:/);
  assert.match(imported.stdout, /Indicator target: macos-menu-bar/);
  assert.match(imported.stdout, /Screenshots: 1/);
  assert.match(imported.stdout, /release:refresh -- .*release-assets.*--platform macos --check/);
  assert.equal(existsSync(join(assets, "tray-verification-macos.json")), true);
  assert.deepEqual(
    JSON.parse(readFileSync(join(assets, "tray-verification-macos.json"), "utf8")),
    trayReport("macos"),
  );

  const pendingReport = join(root, "pending.json");
  writeJson(pendingReport, trayReport("macos", {
    root: { manualResult: "pending", screenshots: [] },
    manualStatus: "pending",
  }));
  const rejectedPending = run([
    "scripts/import-tray-report.mjs",
    "--report",
    pendingReport,
    "--assets",
    assets,
    "--platform",
    "macos",
  ]);
  assert.notEqual(rejectedPending.status, 0, "pending report should be rejected");
  assert.match(rejectedPending.stderr, /manualResult is not passed/);
  assert.match(rejectedPending.stderr, /screenshots missing/);

  const wrongPlatformReport = join(root, "tray-verification-linux.json");
  writeJson(wrongPlatformReport, trayReport("linux"));
  const rejectedPlatform = run([
    "scripts/import-tray-report.mjs",
    "--report",
    wrongPlatformReport,
    "--assets",
    assets,
    "--platform",
    "windows",
  ]);
  assert.notEqual(rejectedPlatform.status, 0, "wrong-platform report should be rejected");
  assert.match(rejectedPlatform.stderr, /visualTarget is linux-tray, expected windows-notification-area/);
  assert.match(rejectedPlatform.stderr, /runtime platform is linux, expected windows/);

  const missingWindowsCheck = join(root, "tray-verification-windows.json");
  writeJson(missingWindowsCheck, trayReport("windows", {
    omitManualIds: ["windowsNoConsole"],
    automatedChecks: { windowsNoConsoleContract: "missing" },
  }));
  const rejectedWindows = run([
    "scripts/import-tray-report.mjs",
    "--report",
    missingWindowsCheck,
    "--assets",
    assets,
  ]);
  assert.notEqual(rejectedWindows.status, 0, "missing Windows no-console report should be rejected");
  assert.match(rejectedWindows.stderr, /manual check windowsNoConsole is not passed/);
  assert.match(rejectedWindows.stderr, /Windows no-console contract check did not pass/);

  const wrongScreenshotPath = join(root, "wrong-screenshot.json");
  writeJson(wrongScreenshotPath, trayReport("windows", {
    root: {
      screenshots: [{ path: "/tmp/macos-menu-bar.png", bytes: 42, sha256: "a".repeat(64) }],
    },
  }));
  const rejectedScreenshotPath = run([
    "scripts/import-tray-report.mjs",
    "--report",
    wrongScreenshotPath,
    "--assets",
    assets,
    "--platform",
    "windows",
  ]);
  assert.notEqual(rejectedScreenshotPath.status, 0, "wrong screenshot target should be rejected");
  assert.match(rejectedScreenshotPath.stderr, /screenshot 1 path does not match windows tray target/);

  console.log("import tray report tests ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function trayReport(platform, overrides = {}) {
  const target = indicatorTarget(platform);
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-09T00:00:00.000Z",
    verifier: "scripts/verify-tray.mjs",
    requestedAppPath: null,
    appBinary: "/Applications/AgentWatch.app/Contents/MacOS/AgentWatch",
    visualTarget: target,
    visualTargetLabel: target,
    host: {
      hostname: `${platform}-desktop`,
      platform: hostPlatform(platform),
      release: "test",
      arch: "arm64",
    },
    automatedChecks: {
      healthz: "passed",
      runtimeEndpoint: "passed",
      snapshotEndpoint: "passed",
      providerHistoryEndpoint: "passed",
      providerHistoryCount: 3,
      dashboardHtml: "passed",
      dashboardJs: "passed",
      dashboardCss: "passed",
      startsHiddenConfig: "passed",
      trayMenuContract: "passed",
      trayTooltipContract: "passed",
      openDashboardContract: "passed",
      closeToTrayContract: "passed",
      windowsNoConsoleContract: platform === "windows" ? "passed" : "not-applicable",
      usageEndpoint: "passed",
      usageDashboardHtml: "passed",
      usageDashboardJs: "passed",
      usageDashboardCss: "passed",
      usageDaily: "passed",
      usageTotals: "passed",
      usageQuotas: "passed",
      usageThreads: "passed",
      usageGoals: "passed",
      usageProviderCount: 1,
      runtime: "tauri-rust",
      version: "0.2.0",
      platform,
      indicatorTarget: target,
      runtimeIndicatorTarget: target,
      trayEnabled: true,
      port: 8765,
      localUrl: "http://127.0.0.1:8765",
      lanUrls: ["http://192.168.0.10:8765"],
      status: "busy",
      activeProcessCount: 1,
      totalCpu: 1.2,
      ...overrides.automatedChecks,
    },
    manualChecksRequired: manualCheckItems(platform).map(([, label]) => label),
    manualChecks: manualCheckItems(platform)
      .filter(([id]) => !(overrides.omitManualIds || []).includes(id))
      .map(([id, label]) => ({
        id,
        label,
        status: overrides.manualStatus || "passed",
      })),
    manualResult: "passed",
    manualNotes: "Verified on target desktop.",
    screenshots: [{ path: screenshotPath(platform), bytes: 42, sha256: "a".repeat(64) }],
    ...overrides.root,
  };
}

function manualCheckItems(platform) {
  return [
    ["startsHidden", "app starts with the main window hidden and only the tray/menu-bar indicator visible"],
    ["trayIconVisible", "tray/menu-bar icon is visible on a real desktop session"],
    ["trayMenuItems", "tray menu shows Runtime, Local, LAN, Open dashboard, and Quit"],
    ["trayTooltip", "tray tooltip includes status, process count, CPU, Local URL, and LAN URL"],
    ["openDashboard", "Open dashboard brings the existing window to the front"],
    ["closeKeepsHealthz", "closing the main window hides it while /healthz remains healthy"],
    ["quitExitsApp", "Quit exits the app"],
    ["lanUrlReachable", "a second LAN device can open the reported LAN URL"],
    ...(platform === "windows" ? [["windowsNoConsole", "Windows release build starts without a console window"]] : []),
  ];
}

function indicatorTarget(platform) {
  if (platform === "macos") return "macos-menu-bar";
  if (platform === "windows") return "windows-notification-area";
  if (platform === "linux") return "linux-tray";
  throw new Error(`unknown platform ${platform}`);
}

function hostPlatform(platform) {
  if (platform === "macos") return "darwin";
  if (platform === "windows") return "win32";
  if (platform === "linux") return "linux";
  throw new Error(`unknown platform ${platform}`);
}

function screenshotPath(platform) {
  if (platform === "macos") return "/tmp/macos-menu-bar.png";
  if (platform === "windows") return "C:\\Temp\\windows-tray.png";
  if (platform === "linux") return "/tmp/linux-tray.png";
  throw new Error(`unknown platform ${platform}`);
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function run(args) {
  return spawnSync("node", args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}
