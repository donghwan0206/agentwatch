import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const platforms = {
  macos: ["macos", "darwin", ["AgentWatch-macOS.app.zip", "agentwatch-server-macOS"]],
  windows: ["windows", "win32", ["AgentWatch-Setup.exe", "AgentWatch.msi", "agentwatch-server-Windows.exe"]],
  linux: ["linux", "linux", ["AgentWatch.AppImage", "agentwatch.deb", "agentwatch.rpm", "agentwatch-server-Linux"]],
};

const dir = mkdtempSync(join(tmpdir(), "agentwatch-readiness-test-"));

try {
  writeBaseAssets(dir);
  writeValidReports(dir);
  writeSha256Sums(dir);
  const completeReadiness = runReadiness(dir);
  assert.equal(
    completeReadiness.status,
    0,
    `complete release evidence should pass\n${completeReadiness.stdout}\n${completeReadiness.stderr}`,
  );

  writeBaseAssets(dir);
  writeValidReports(dir);
  mkdirSync(join(dir, "screenshots"), { recursive: true });
  writeFileSync(join(dir, "screenshots", "macos-menu-bar.png"), "png");
  writeSha256Sums(dir);
  assert.equal(
    runReadiness(dir, "--platform", "macos").status,
    0,
    "release readiness should accept nested screenshot evidence covered by SHA256SUMS",
  );

  writeBaseAssets(dir);
  writeValidReports(dir);
  rmSync(join(dir, "AgentWatch-macOS.app.zip"), { force: true });
  mkdirSync(join(dir, "screenshots"), { recursive: true });
  writeFileSync(join(dir, "screenshots", "not-a-package.dmg"), "not really a package");
  writeSha256Sums(dir);
  const nestedPackageOnly = runReadiness(dir, "--platform", "macos", "--automated-only");
  assert.notEqual(nestedPackageOnly.status, 0, "nested dmg evidence must not satisfy macOS package readiness");
  assert.match(nestedPackageOnly.stdout, /macOS app zip or DMG missing/);

  writeBaseAssets(dir);
  writeValidReports(dir);
  writeRemoteClientReport(dir, "macos", browserDashboardRemoteReport("macos"));
  writeSha256Sums(dir);
  assert.equal(
    runReadiness(dir, "--platform", "macos").status,
    0,
    "browser-downloaded remote verification evidence should pass readiness",
  );

  writeBaseAssets(dir);
  writeValidReports(dir);
  {
    const trayPath = join(dir, "tray-verification-macos.json");
    const tray = JSON.parse(readFileSync(trayPath, "utf8"));
    delete tray.automatedChecks.startsHiddenConfig;
    writeFileSync(trayPath, JSON.stringify(tray, null, 2));
  }
  writeTrayConfigReport(dir, "macos");
  writeSha256Sums(dir);
  assert.equal(
    runReadiness(dir, "--platform", "macos").status,
    0,
    "separate tray config verification should satisfy hidden startup config evidence",
  );

  writeBaseAssets(dir);
  writeValidReports(dir);
  writeFileSync(
    join(dir, "tray-verification-macos-capture.json"),
    JSON.stringify(report("macos", "darwin"), null, 2),
  );
  writeReport(dir, "macos", report("macos", "darwin", {
    root: { manualResult: "pending", manualChecks: [] },
  }));
  writeSha256Sums(dir);
  const staleCaptureTray = runReadiness(dir, "--platform", "macos");
  assert.notEqual(
    staleCaptureTray.status,
    0,
    "suffixed tray capture evidence must not override a canonical pending tray report",
  );
  assert.match(staleCaptureTray.stdout, /passed tray verification report missing/);
  rmSync(join(dir, "tray-verification-macos-capture.json"), { force: true });

  writeBaseAssets(dir);
  writeValidReports(dir);
  removeDesktopPackageFiles(dir);
  removeTrayReports(dir);
  writeServiceOnlyManifests(dir);
  writeCompletionAudit(dir, { serviceOnly: true });
  writeSha256Sums(dir);
  assert.equal(
    runReadiness(dir, "--service-only").status,
    0,
    "service-only readiness should pass without desktop packages or tray reports",
  );
  assert.notEqual(
    runReadiness(dir).status,
    0,
    "default readiness should still require desktop packages and tray reports",
  );

  writeBaseAssets(dir);
  writeValidReports(dir);
  removeDesktopPackageFiles(dir);
  removeTrayReports(dir);
  writeServiceOnlyManifests(dir);
  writeServiceOnlyPerformanceReport(dir, "macos");
  writeCompletionAudit(dir, { serviceOnly: true });
  writeSha256Sums(dir);
  assert.equal(
    runReadiness(dir, "--service-only", "--platform", "macos").status,
    0,
    "single-platform service-only readiness should accept headless-only performance evidence",
  );

  writeBaseAssets(dir);
  removeReports(dir);
  writeSha256Sums(dir);
  assert.equal(
    runReadiness(dir, "--automated-only").status,
    0,
    "automated-only readiness should pass without tray reports",
  );
  const missingManual = runReadiness(dir);
  assert.notEqual(missingManual.status, 0, "final readiness should still require manual reports");
  assert.match(missingManual.stdout, /passed service verification report missing/);
  assert.match(missingManual.stdout, /passed service lifecycle report missing/);
  assert.match(missingManual.stdout, /passed remote client verification report missing/);
  assert.match(missingManual.stdout, /passed tray verification report missing/);

  writeReport(dir, "windows", report("windows", "win32", {
    automatedChecks: { runtime: "rust-headless", trayEnabled: false },
    screenshot: { sha256: "not-a-real-hash" },
  }));
  const invalidRuntime = runReadiness(dir);
  assert.notEqual(invalidRuntime.status, 0, "invalid tray report should fail");
  assert.match(invalidRuntime.stdout, /runtime is rust-headless/);
  assert.match(invalidRuntime.stdout, /trayEnabled is not true/);
  assert.match(invalidRuntime.stdout, /sha256 invalid/);

  writeValidReports(dir);
  writeSha256Sums(dir);
  writeReport(dir, "linux", report("windows", "linux"));
  const wrongPlatform = runReadiness(dir);
  assert.notEqual(wrongPlatform.status, 0, "wrong target platform should fail");
  assert.match(wrongPlatform.stdout, /runtime platform is windows, expected linux/);

  writeValidReports(dir);
  writeManifest(dir, "linux", ["AgentWatch.AppImage", "agentwatch.deb"], { platform: "windows" });
  writeSha256Sums(dir);
  const invalidManifest = runReadiness(dir);
  assert.notEqual(invalidManifest.status, 0, "invalid manifest should fail");
  assert.match(invalidManifest.stdout, /build platform is windows, expected linux/);
  assert.match(invalidManifest.stdout, /Linux rpm missing from manifest assets/);
  assert.match(invalidManifest.stdout, /headless Rust monitor binary missing from manifest assets/);

  writeBaseAssets(dir);
  writeValidReports(dir);
  rmSync(join(dir, "AgentWatch.msi"), { force: true });
  writeManifest(dir, "windows", ["AgentWatch-Setup.exe", "agentwatch-server-Windows.exe"]);
  writeSha256Sums(dir);
  const missingWindowsMsi = runReadiness(dir, "--platform", "windows", "--automated-only");
  assert.notEqual(missingWindowsMsi.status, 0, "Windows readiness should require MSI alongside NSIS");
  assert.match(missingWindowsMsi.stdout, /Windows MSI installer missing/);

  writeBaseAssets(dir);
  writeValidReports(dir);
  writePerformanceReport(dir, "windows", {
    benchmark: {
      rustDesktop: { runtime: "tauri-rust", platform: "windows", startupMs: 1, avgResponseMs: 1, p95ResponseMs: 1 },
      rustHeadless: { runtime: "python", platform: "windows", startupMs: 1, avgResponseMs: 1, p95ResponseMs: 1 },
      python: { runtime: "python", startupMs: 1, avgResponseMs: 1, p95ResponseMs: 1 },
      delta: {},
    },
  });
  writeSha256Sums(dir);
  const invalidPerformance = runReadiness(dir);
  assert.notEqual(invalidPerformance.status, 0, "invalid performance report should fail");
  assert.match(invalidPerformance.stdout, /headless runtime is python/);
  assert.match(invalidPerformance.stdout, /headlessVsPython delta missing/);

  writeBaseAssets(dir);
  writeValidReports(dir);
  const slowerDelta = {
    startupMs: { value: 100, percent: 50 },
    avgResponseMs: { value: 1, percent: 50 },
    p95ResponseMs: { value: 1, percent: 20 },
    rssMb: { value: 15, percent: 50 },
  };
  writePerformanceReport(dir, "macos", {
    benchmark: {
      rustDesktop: { runtime: "tauri-rust", platform: "macos", startupMs: 1, avgResponseMs: 1, p95ResponseMs: 1 },
      rustHeadless: { runtime: "rust-headless", platform: "macos", startupMs: 300, avgResponseMs: 3, p95ResponseMs: 6, rssMb: 45 },
      python: { runtime: "python", startupMs: 200, avgResponseMs: 2, p95ResponseMs: 5, rssMb: 30 },
      delta: { headlessVsPython: slowerDelta },
    },
    performanceVerdict: performanceVerdict(slowerDelta, "failed"),
  });
  writeSha256Sums(dir);
  const slowerHeadlessPerformance = runReadiness(dir);
  assert.equal(slowerHeadlessPerformance.status, 0, "slower Rust headless report should remain diagnostic");

  writeBaseAssets(dir);
  writeValidReports(dir);
  writeSha256Sums(dir);
  writeReport(dir, "macos", report("macos", "darwin", { root: { manualNotes: "" } }));
  const missingNotes = runReadiness(dir);
  assert.notEqual(missingNotes.status, 0, "missing manual notes should fail");
  assert.match(missingNotes.stdout, /manualNotes missing/);

  writeBaseAssets(dir);
  writeValidReports(dir);
  writeSha256Sums(dir);
  writeReport(dir, "windows", report("windows", "win32", {
    root: { visualTarget: "macos-menu-bar" },
    automatedChecks: { indicatorTarget: "macos-menu-bar" },
  }));
  const wrongIndicatorTarget = runReadiness(dir);
  assert.notEqual(wrongIndicatorTarget.status, 0, "wrong tray indicator target should fail");
  assert.match(wrongIndicatorTarget.stdout, /visualTarget is macos-menu-bar, expected windows-notification-area/);
  assert.match(wrongIndicatorTarget.stdout, /indicatorTarget is macos-menu-bar, expected windows-notification-area/);

  writeBaseAssets(dir);
  writeValidReports(dir);
  writeSha256Sums(dir);
  writeReport(dir, "macos", report("macos", "darwin", {
    root: { manualChecks: manualChecks("passed").filter((check) => check.id !== "startsHidden") },
  }));
  const missingTrayManualCheck = runReadiness(dir);
  assert.notEqual(missingTrayManualCheck.status, 0, "missing tray manual check should fail");
  assert.match(missingTrayManualCheck.stdout, /manual check startsHidden missing/);

  writeBaseAssets(dir);
  writeValidReports(dir);
  writeReport(dir, "macos", report("macos", "darwin", {
    root: { manualChecks: manualChecks("passed").filter((check) => check.id !== "windowsNoConsole") },
  }));
  writeSha256Sums(dir);
  assert.equal(
    runReadiness(dir).status,
    0,
    "macOS tray readiness should not require the Windows no-console check",
  );

  writeBaseAssets(dir);
  writeValidReports(dir);
  writeReport(dir, "windows", report("windows", "win32", {
    root: { manualChecks: manualChecks("passed").filter((check) => check.id !== "windowsNoConsole") },
  }));
  writeSha256Sums(dir);
  const missingWindowsNoConsole = runReadiness(dir);
  assert.notEqual(missingWindowsNoConsole.status, 0, "Windows tray readiness should require no-console evidence");
  assert.match(missingWindowsNoConsole.stdout, /manual check windowsNoConsole missing/);

  writeBaseAssets(dir);
  writeValidReports(dir);
  writeReport(dir, "windows", report("windows", "win32", {
    automatedChecks: { windowsNoConsoleContract: "failed" },
  }));
  writeSha256Sums(dir);
  const missingWindowsNoConsoleContract = runReadiness(dir);
  assert.notEqual(missingWindowsNoConsoleContract.status, 0, "Windows tray readiness should require no-console source contract");
  assert.match(missingWindowsNoConsoleContract.stdout, /Windows no-console contract check did not pass/);

  writeBaseAssets(dir);
  writeValidReports(dir);
  writeSha256Sums(dir);
  writeServiceReport(dir, "linux", serviceReport("linux", "linux", {
    root: { manualChecks: serviceManualChecks("passed").filter((check) => check.id !== "uninstallClean") },
  }));
  const missingServiceManualCheck = runReadiness(dir);
  assert.notEqual(missingServiceManualCheck.status, 0, "missing service manual check should fail");
  assert.match(missingServiceManualCheck.stdout, /manual check uninstallClean missing/);

  writeBaseAssets(dir);
  writeValidReports(dir);
  writeSha256Sums(dir);
  writeReport(dir, "macos", report("macos", "darwin", {
    automatedChecks: { dashboardHtml: "missing", dashboardJs: "missing", dashboardCss: "missing" },
  }));
  const missingDashboardEvidence = runReadiness(dir);
  assert.notEqual(missingDashboardEvidence.status, 0, "missing tray dashboard evidence should fail");
  assert.match(missingDashboardEvidence.stdout, /dashboard HTML check did not pass/);
  assert.match(missingDashboardEvidence.stdout, /dashboard JS check did not pass/);
  assert.match(missingDashboardEvidence.stdout, /dashboard CSS check did not pass/);

  writeBaseAssets(dir);
  writeValidReports(dir);
  writeSha256Sums(dir);
  writeServiceReport(dir, "macos", serviceReport("macos", "darwin", {
    automatedChecks: { usageEndpoint: "missing", usageGoals: "missing", usageProviderCount: 0 },
  }));
  const missingUsageEvidence = runReadiness(dir);
  assert.notEqual(missingUsageEvidence.status, 0, "missing service usage evidence should fail");
  assert.match(missingUsageEvidence.stdout, /usage endpoint check did not pass/);
  assert.match(missingUsageEvidence.stdout, /usage goals check did not pass/);
  assert.match(missingUsageEvidence.stdout, /usageProviderCount is missing or invalid/);

  writeBaseAssets(dir);
  writeValidReports(dir);
  writeSha256Sums(dir);
  writeServiceReport(dir, "macos", serviceReport("macos", "darwin", {
    automatedChecks: { providerHistoryEndpoint: "missing", providerHistoryCount: -1 },
  }));
  const missingProviderHistoryEvidence = runReadiness(dir);
  assert.notEqual(missingProviderHistoryEvidence.status, 0, "missing provider history evidence should fail");
  assert.match(missingProviderHistoryEvidence.stdout, /providerHistory endpoint check did not pass/);
  assert.match(missingProviderHistoryEvidence.stdout, /providerHistoryCount is missing or invalid/);

  writeBaseAssets(dir);
  writeValidReports(dir);
  writeLanPreflightReport(dir, "macos", lanPreflightReport("macos", {
    checks: { lanHealthz: { ok: false, url: "http://192.168.0.10:8765/healthz" } },
  }));
  writeSha256Sums(dir);
  const invalidLanPreflight = runReadiness(dir, "--platform", "macos", "--automated-only");
  assert.notEqual(invalidLanPreflight.status, 0, "invalid LAN preflight should fail automated readiness");
  assert.match(invalidLanPreflight.stdout, /LAN preflight invalid: LAN healthz check did not pass/);

  writeBaseAssets(dir);
  writeValidReports(dir);
  writeSha256Sums(dir);
  writeRemoteClientReport(dir, "macos", remoteClientReport("macos", "agent-host", "agent-host"));
  const sameHostRemote = runReadiness(dir);
  assert.notEqual(sameHostRemote.status, 0, "same-host remote report should fail");
  assert.match(sameHostRemote.stdout, /remote client ran on the same host/);

  writeBaseAssets(dir);
  writeValidReports(dir);
  writeSha256Sums(dir, { "AgentWatch-Setup.exe": "0".repeat(64) });
  const invalidSums = runReadiness(dir);
  assert.notEqual(invalidSums.status, 0, "invalid SHA256SUMS should fail");
  assert.match(invalidSums.stdout, /SHA256SUMS\.txt invalid: AgentWatch-Setup\.exe sha256 mismatch/);

  writeBaseAssets(dir);
  writeValidReports(dir);
  rmSync(join(dir, "completion-audit.json"), { force: true });
  writeSha256Sums(dir);
  const missingCompletionAudit = runReadiness(dir);
  assert.notEqual(missingCompletionAudit.status, 0, "missing completion audit should fail");
  assert.match(missingCompletionAudit.stdout, /completion-audit\.json missing/);

  console.log("release-readiness tests ok");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

function writeBaseAssets(targetDir) {
  const files = [
    "AgentWatch-macOS.app.zip",
    "AgentWatch-Setup.exe",
    "AgentWatch.msi",
    "AgentWatch.AppImage",
    "agentwatch.deb",
    "agentwatch.rpm",
    "agentwatch-server-macOS",
    "agentwatch-server-Windows.exe",
    "agentwatch-server-Linux",
    "release-verification.md",
    "service-quickstart.md",
    "release-summary.md",
    "release-next-steps.md",
    "remote-verification.md",
    "tray-verification.md",
    "completion-audit.json",
    "completion-audit.md",
    "agentwatch-verify-remote-client.mjs",
    "agentwatch-import-remote-report.mjs",
    "agentwatch-import-tray-report.mjs",
    "agentwatch-tray-manual-report.mjs",
    "agentwatch-release-audit.mjs",
    "agentwatch-release-readiness.mjs",
    "agentwatch-release-status.mjs",
    "agentwatch-release-next-steps.mjs",
    "agentwatch-refresh-release-evidence.mjs",
    "agentwatch-verify-service.mjs",
    "agentwatch-verify-service-lifecycle.mjs",
    "agentwatch-service-status.mjs",
    "agentwatch-lan-preflight.mjs",
    "verify-remote-macos.sh",
    "verify-remote-linux.sh",
    "verify-remote-windows.cmd",
    "verify-remote-windows.ps1",
    "verify-service-macos.sh",
    "verify-service-linux.sh",
    "verify-service-windows.cmd",
    "verify-service-windows.ps1",
    "agentwatch-verify-tray.mjs",
    "agentwatch-verify-tray-config.mjs",
    "verify-tray-macos.sh",
    "verify-tray-macos-capture.sh",
    "verify-tray-linux.sh",
    "verify-tray-linux-capture.sh",
    "verify-tray-windows.cmd",
    "verify-tray-windows.ps1",
    "verify-tray-windows-capture.ps1",
    "install-service-macos.sh",
    "uninstall-service-macos.sh",
    "install-service-linux.sh",
    "uninstall-service-linux.sh",
    "install-service-windows.ps1",
    "uninstall-service-windows.ps1",
  ];
  for (const file of files) {
    writeFileSync(join(targetDir, file), "x");
  }
  for (const [platform, [, , assets]] of Object.entries(platforms)) {
    writeManifest(targetDir, platform, assets);
    writePerformanceReport(targetDir, platform);
    writeLanPreflightReport(targetDir, platform, lanPreflightReport(platforms[platform][0]));
  }
  writeCompletionAudit(targetDir);
}

function writeValidReports(targetDir) {
  for (const [platform, [runtimePlatform, hostPlatform]] of Object.entries(platforms)) {
    writeReport(targetDir, platform, report(runtimePlatform, hostPlatform));
    writeServiceReport(targetDir, platform, serviceReport(runtimePlatform, hostPlatform));
    writeLifecycleReport(targetDir, platform, lifecycleReport(hostPlatform));
    writeRemoteClientReport(targetDir, platform, remoteClientReport(runtimePlatform, `agent-${platform}`, `client-${platform}`));
  }
}

function removeReports(targetDir) {
  for (const platform of Object.keys(platforms)) {
    rmSync(join(targetDir, `tray-verification-${platform}.json`), { force: true });
    rmSync(join(targetDir, `service-verification-${platform}.json`), { force: true });
    rmSync(join(targetDir, `service-lifecycle-${platform}.json`), { force: true });
    rmSync(join(targetDir, `remote-client-verification-${platform}.json`), { force: true });
  }
}

function removeDesktopPackageFiles(targetDir) {
  for (const file of [
    "AgentWatch-macOS.app.zip",
    "AgentWatch-Setup.exe",
    "AgentWatch.msi",
    "AgentWatch.AppImage",
    "agentwatch.deb",
    "agentwatch.rpm",
  ]) {
    rmSync(join(targetDir, file), { force: true });
  }
}

function removeTrayReports(targetDir) {
  for (const platform of Object.keys(platforms)) {
    rmSync(join(targetDir, `tray-verification-${platform}.json`), { force: true });
  }
}

function writeServiceOnlyManifests(targetDir) {
  writeManifest(targetDir, "macos", ["agentwatch-server-macOS"]);
  writeManifest(targetDir, "windows", ["agentwatch-server-Windows.exe"]);
  writeManifest(targetDir, "linux", ["agentwatch-server-Linux"]);
}

function writeReport(targetDir, platform, data) {
  writeFileSync(join(targetDir, `tray-verification-${platform}.json`), JSON.stringify(data, null, 2));
}

function writeServiceReport(targetDir, platform, data) {
  writeFileSync(join(targetDir, `service-verification-${platform}.json`), JSON.stringify(data, null, 2));
}

function writeLifecycleReport(targetDir, platform, data) {
  writeFileSync(join(targetDir, `service-lifecycle-${platform}.json`), JSON.stringify(data, null, 2));
}

function writeRemoteClientReport(targetDir, platform, data) {
  writeFileSync(join(targetDir, `remote-client-verification-${platform}.json`), JSON.stringify(data, null, 2));
}

function writeTrayConfigReport(targetDir, platform) {
  writeFileSync(
    join(targetDir, `tray-config-verification-${platform}.json`),
    JSON.stringify(
      {
        configOnly: true,
        automatedChecks: {
          runtime: "tauri-rust",
          trayEnabled: true,
          startsHiddenConfig: "passed",
          trayMenuContract: "passed",
          trayTooltipContract: "passed",
          openDashboardContract: "passed",
          closeToTrayContract: "passed",
          windowsNoConsoleContract: platform === "windows" ? "passed" : undefined,
          runtimeIndicatorTarget: indicatorTargetFor(platform),
        },
      },
      null,
      2,
    ),
  );
}

function writeLanPreflightReport(targetDir, platform, data) {
  writeFileSync(join(targetDir, `lan-preflight-${platform}.json`), JSON.stringify(data, null, 2));
}

function writeManifest(targetDir, platform, assets, overrides = {}) {
  writeFileSync(
    join(targetDir, `agentwatch-release-manifest-${platform}.json`),
    JSON.stringify(
      {
        schemaVersion: 1,
        app: { version: "0.2.0" },
        build: { platform, ...overrides },
        automatedGates: automatedGates(),
        assets: assets.map((name) => assetEvidence(targetDir, name)),
      },
      null,
      2,
    ),
  );
}

function automatedGates() {
  return [
    "npm test",
    "headless Rust monitor build",
    "headless smoke test",
    "LAN preflight against advertised LAN /healthz",
    "Rust-vs-Python performance comparison",
    "release asset collection",
    "release readiness automated gate",
  ];
}

function assetEvidence(targetDir, name) {
  const content = readFileSync(join(targetDir, name));
  return {
    name,
    bytes: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

function writeSha256Sums(targetDir, overrides = {}) {
  const files = [
    "AgentWatch-macOS.app.zip",
    "AgentWatch-Setup.exe",
    "AgentWatch.msi",
    "AgentWatch.AppImage",
    "agentwatch.deb",
    "agentwatch.rpm",
    "agentwatch-server-macOS",
    "agentwatch-server-Windows.exe",
    "agentwatch-server-Linux",
    "release-verification.md",
    "service-quickstart.md",
    "release-summary.md",
    "release-next-steps.md",
    "remote-verification.md",
    "tray-verification.md",
    "completion-audit.json",
    "completion-audit.md",
    "agentwatch-verify-remote-client.mjs",
    "agentwatch-import-remote-report.mjs",
    "agentwatch-import-tray-report.mjs",
    "agentwatch-tray-manual-report.mjs",
    "agentwatch-release-audit.mjs",
    "agentwatch-release-readiness.mjs",
    "agentwatch-release-status.mjs",
    "agentwatch-release-next-steps.mjs",
    "agentwatch-refresh-release-evidence.mjs",
    "agentwatch-verify-service.mjs",
    "agentwatch-verify-service-lifecycle.mjs",
    "agentwatch-service-status.mjs",
    "agentwatch-lan-preflight.mjs",
    "verify-remote-macos.sh",
    "verify-remote-linux.sh",
    "verify-remote-windows.cmd",
    "verify-remote-windows.ps1",
    "verify-service-macos.sh",
    "verify-service-linux.sh",
    "verify-service-windows.cmd",
    "verify-service-windows.ps1",
    "agentwatch-verify-tray.mjs",
    "agentwatch-verify-tray-config.mjs",
    "verify-tray-macos.sh",
    "verify-tray-macos-capture.sh",
    "verify-tray-linux.sh",
    "verify-tray-linux-capture.sh",
    "verify-tray-windows.cmd",
    "verify-tray-windows.ps1",
    "verify-tray-windows-capture.ps1",
    "install-service-macos.sh",
    "uninstall-service-macos.sh",
    "install-service-linux.sh",
    "uninstall-service-linux.sh",
    "install-service-windows.ps1",
    "uninstall-service-windows.ps1",
    "performance-comparison-macos.json",
    "performance-comparison-macos.md",
    "performance-comparison-windows.json",
    "performance-comparison-windows.md",
    "performance-comparison-linux.json",
    "performance-comparison-linux.md",
    "lan-preflight-macos.json",
    "lan-preflight-windows.json",
    "lan-preflight-linux.json",
    "agentwatch-release-manifest-macos.json",
    "agentwatch-release-manifest-windows.json",
    "agentwatch-release-manifest-linux.json",
    "service-verification-macos.json",
    "service-verification-windows.json",
    "service-verification-linux.json",
    "service-lifecycle-macos.json",
    "service-lifecycle-windows.json",
    "service-lifecycle-linux.json",
    "remote-client-verification-macos.json",
    "remote-client-verification-windows.json",
    "remote-client-verification-linux.json",
    "tray-verification-macos.json",
    "tray-config-verification-macos.json",
    "tray-verification-windows.json",
    "tray-verification-linux.json",
  ];
  const nestedFiles = ["screenshots/macos-menu-bar.png", "screenshots/not-a-package.dmg"];
  const lines = files
    .concat(nestedFiles)
    .filter((file) => existsSync(join(targetDir, file)))
    .sort((left, right) => left.localeCompare(right))
    .map((file) => `${overrides[file] || assetEvidence(targetDir, file).sha256}  ${file}`);
  writeFileSync(join(targetDir, "SHA256SUMS.txt"), `${lines.join("\n")}\n`);
}

function writeCompletionAudit(targetDir, options = {}) {
  const serviceOnly = Boolean(options.serviceOnly);
  const audit = {
    schemaVersion: 1,
    generatedAt: "2026-07-07T00:00:00.000Z",
    serviceOnly,
    platforms: Object.keys(platforms).map((platform) => ({
      name: platform,
      label: platform,
      status: "passed",
      checks: [
        ["rustHeadlessMonitor", "Rust headless monitor binary exists", "passed"],
        ["rustFasterThanPython", "Rust headless benchmark is faster than Python", "passed"],
        ["serviceInstallable", "Background service install/start/LAN/uninstall evidence is passed", "passed"],
        ["lanPreflightReady", "Agent machine is ready for a second LAN browser", "passed"],
        ["browserLanRemote", "Dashboard is verified from another LAN browser machine", "passed"],
        [
          "desktopPackage",
          serviceOnly
            ? "Desktop app package is not required for service-only release"
            : "Desktop package exists for this OS",
          serviceOnly ? "skipped" : "passed",
        ],
        [
          "trayIndicator",
          serviceOnly
            ? "Tray/menu-bar indicator is not required for service-only release"
            : "Tray/menu-bar indicator evidence is passed",
          serviceOnly ? "skipped" : "passed",
        ],
        ["releaseManifest", "Release manifest exists for this OS", "passed"],
      ].map(([id, label, status]) => ({ id, label, status, evidence: "test" })),
    })),
  };
  writeFileSync(join(targetDir, "completion-audit.json"), JSON.stringify(audit, null, 2));
  writeFileSync(
    join(targetDir, "completion-audit.md"),
    serviceOnly
      ? "# AgentWatch Completion Audit\n\nMode: Service-only release (LAN browser monitor)\n"
      : "# AgentWatch Completion Audit\n\nMode: desktop/package release with optional tray wrapper evidence\n",
  );
}

function writePerformanceReport(targetDir, platform, overrides = {}) {
  const [runtimePlatform, hostPlatform] = platforms[platform];
  writeFileSync(
    join(targetDir, `performance-comparison-${platform}.json`),
    JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: "2026-07-07T00:00:00.000Z",
        host: { platform: hostPlatform, release: "test", arch: "test" },
        benchmark: {
          rustDesktop: {
            runtime: "tauri-rust",
            platform: runtimePlatform,
            startupMs: 100,
            avgResponseMs: 1.2,
            p95ResponseMs: 2.4,
            rssMb: 80,
          },
          rustHeadless: {
            runtime: "rust-headless",
            platform: runtimePlatform,
            startupMs: 20,
            avgResponseMs: 0.4,
            p95ResponseMs: 0.8,
            rssMb: 16,
          },
          python: {
            runtime: "python",
            startupMs: 200,
            avgResponseMs: 2.5,
            p95ResponseMs: 5,
            rssMb: 30,
          },
          delta: {
            headlessVsPython: {
              startupMs: { value: -180, percent: -90 },
              avgResponseMs: { value: -2.1, percent: -84 },
              p95ResponseMs: { value: -4.2, percent: -84 },
              rssMb: { value: -14, percent: -46.7 },
            },
          },
        },
        performanceVerdict: performanceVerdict({
          startupMs: { value: -180, percent: -90 },
          avgResponseMs: { value: -2.1, percent: -84 },
          p95ResponseMs: { value: -4.2, percent: -84 },
          rssMb: { value: -14, percent: -46.7 },
        }),
        ...overrides,
      },
      null,
      2,
    ),
  );
  writeFileSync(join(targetDir, `performance-comparison-${platform}.md`), "# performance\n");
}

function performanceVerdict(headlessVsPython, status = "passed") {
  return {
    status,
    comparison: "headlessVsPython",
    requirements: [
      ["startupMs", "Rust headless startup lower than Python"],
      ["avgResponseMs", "Rust headless average response lower than Python"],
      ["p95ResponseMs", "Rust headless p95 response lower than Python"],
      ["rssMb", "Rust headless RSS lower than Python"],
    ].map(([metric, label]) => ({
      metric,
      label,
      actualDelta: headlessVsPython[metric] ?? null,
      passed: Boolean(headlessVsPython[metric] && headlessVsPython[metric].value < 0),
    })),
  };
}

function writeServiceOnlyPerformanceReport(targetDir, platform) {
  const [runtimePlatform, hostPlatform] = platforms[platform];
  writePerformanceReport(targetDir, platform, {
    host: { platform: hostPlatform, release: "test", arch: "test" },
    benchmark: {
      rustDesktop: null,
      rustHeadless: {
        runtime: "rust-headless",
        platform: runtimePlatform,
        startupMs: 20,
        avgResponseMs: 0.4,
        p95ResponseMs: 0.8,
        rssMb: 16,
      },
      python: {
        runtime: "python",
        startupMs: 200,
        avgResponseMs: 2.5,
        p95ResponseMs: 5,
        rssMb: 30,
      },
      delta: {
        desktopVsPython: null,
        headlessVsPython: {
          startupMs: { value: -180, percent: -90 },
          avgResponseMs: { value: -2.1, percent: -84 },
          p95ResponseMs: { value: -4.2, percent: -84 },
          rssMb: { value: -14, percent: -46.7 },
        },
        headlessVsDesktop: null,
      },
    },
  });
}

function lanPreflightReport(runtimePlatform, overrides = {}) {
  const report = {
    schemaVersion: 1,
    targetUrl: "http://127.0.0.1:8765/",
    checkedAt: "2026-07-07T00:00:00.000Z",
    reachable: true,
    readyForRemoteViewer: true,
    remoteEvidenceSatisfied: false,
    checks: {
      healthz: { ok: true },
      runtime: { ok: true },
      bindHost: { ok: true, value: "0.0.0.0" },
      lanUrl: { ok: true, value: "http://192.168.0.10:8765" },
      lanHealthz: { ok: true, url: "http://192.168.0.10:8765/healthz" },
      dashboard: { ok: true },
      remoteCheck: { ok: true },
    },
    runtime: {
      name: "agentwatch",
      version: "0.2.0",
      runtime: "rust-headless",
      platform: runtimePlatform,
      bindHost: "0.0.0.0",
      trayEnabled: false,
      localUrl: "http://127.0.0.1:8765",
      lanUrls: ["http://192.168.0.10:8765"],
    },
    remoteCheck: {
      clientIp: "127.0.0.1",
      loopback: true,
      sameHostIp: false,
      remoteClient: false,
    },
  };
  return {
    ...report,
    ...overrides,
    checks: {
      ...report.checks,
      ...(overrides.checks || {}),
    },
    runtime: {
      ...report.runtime,
      ...(overrides.runtime || {}),
    },
  };
}

function report(runtimePlatform, hostPlatform, overrides = {}) {
  return {
    schemaVersion: 1,
    host: { platform: hostPlatform },
    visualTarget: indicatorTargetFor(runtimePlatform),
    visualTargetLabel: indicatorTargetLabelFor(runtimePlatform),
    automatedChecks: {
      healthz: "passed",
      runtimeEndpoint: "passed",
      snapshotEndpoint: "passed",
      dashboardHtml: "passed",
      dashboardJs: "passed",
      dashboardCss: "passed",
      startsHiddenConfig: "passed",
      trayMenuContract: "passed",
      trayTooltipContract: "passed",
      openDashboardContract: "passed",
      closeToTrayContract: "passed",
      windowsNoConsoleContract: runtimePlatform === "windows" ? "passed" : undefined,
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
      providerHistoryEndpoint: "passed",
      providerHistoryCount: 3,
      runtime: "tauri-rust",
      version: "0.2.0",
      platform: runtimePlatform,
      indicatorTarget: indicatorTargetFor(runtimePlatform),
      runtimeIndicatorTarget: indicatorTargetFor(runtimePlatform),
      trayEnabled: true,
      port: 8895,
      localUrl: "http://127.0.0.1:8895",
      lanUrls: ["http://192.168.0.10:8895"],
      status: "busy",
      activeProcessCount: 1,
      totalCpu: 1.2,
      ...overrides.automatedChecks,
    },
    manualResult: "passed",
    manualNotes: "Verified on target desktop.",
    manualChecks: manualChecks("passed"),
    screenshots: [
      {
        path: "/tmp/agentwatch-tray.png",
        bytes: 12,
        sha256: "b".repeat(64),
        ...overrides.screenshot,
      },
    ],
    ...overrides.root,
  };
}

function indicatorTargetFor(runtimePlatform) {
  if (runtimePlatform === "macos") return "macos-menu-bar";
  if (runtimePlatform === "windows") return "windows-notification-area";
  if (runtimePlatform === "linux") return "linux-tray";
  return "desktop-tray";
}

function indicatorTargetLabelFor(runtimePlatform) {
  if (runtimePlatform === "macos") return "macOS menu bar";
  if (runtimePlatform === "windows") return "Windows notification area";
  if (runtimePlatform === "linux") return "Linux tray/status notifier";
  return "desktop tray/status area";
}

function serviceReport(runtimePlatform, hostPlatform, overrides = {}) {
  return {
    schemaVersion: 1,
    host: { platform: hostPlatform },
    automatedChecks: {
      healthz: "passed",
      runtimeEndpoint: "passed",
      snapshotEndpoint: "passed",
      dashboardHtml: "passed",
      dashboardJs: "passed",
      dashboardCss: "passed",
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
      providerHistoryEndpoint: "passed",
      providerHistoryCount: 3,
      lanUrlReachable: "passed",
      lanUrlChecked: "http://192.168.0.10:8765",
      lanUrlDetail: "healthz ok",
      serviceRegistered: "passed",
      serviceName: hostPlatform === "darwin" ? "com.agentwatch.monitor" : hostPlatform === "win32" ? "AgentWatchMonitor" : "agentwatch.service",
      serviceDetail: "registered",
      loginStartContract: "passed",
      loginStartContractDetail: "login start configured",
      lifecycleReport: `service-lifecycle-${runtimePlatform}.json`,
      lifecycleUninstallClean: "passed",
      runtime: "rust-headless",
      version: "0.2.0",
      platform: runtimePlatform,
      trayEnabled: false,
      bindHost: "0.0.0.0",
      port: 8765,
      localUrl: "http://127.0.0.1:8765",
      lanUrls: ["http://192.168.0.10:8765"],
      status: "busy",
      activeProcessCount: 1,
      totalCpu: 1.2,
      ...overrides.automatedChecks,
    },
    manualResult: "passed",
    manualNotes: "Verified service install, login start, LAN access, and uninstall on target OS.",
    manualChecks: serviceManualChecks("passed"),
    evidenceFiles: [
      {
        path: "/tmp/agentwatch-service.txt",
        bytes: 12,
        sha256: "c".repeat(64),
        ...overrides.evidence,
      },
    ],
    ...overrides.root,
  };
}

function lifecycleReport(hostPlatform, overrides = {}) {
  const serviceName =
    hostPlatform === "darwin"
      ? "com.agentwatch.monitor"
      : hostPlatform === "win32"
        ? "AgentWatchMonitor"
        : "agentwatch.service";
  return {
    schemaVersion: 1,
    targetUrl: "http://127.0.0.1:8765",
    serviceName,
    result: "passed",
    host: { platform: hostPlatform },
    steps: [
      "uninstall",
      "uninstallClean",
      "install",
      "verifyService",
      "reinstallHealthy",
    ].map((name) => ({ name, status: "passed" })),
    ...overrides,
  };
}

function remoteClientReport(runtimePlatform, agentHostname, clientHostname, overrides = {}) {
  return {
    schemaVersion: 1,
    targetUrl: "http://192.168.0.10:8765",
    client: {
      hostname: clientHostname,
      platform: "darwin",
      release: "test",
      arch: "arm64",
      ...overrides.client,
    },
    result: "passed",
    automatedChecks: {
      healthz: "passed",
      runtimeEndpoint: "passed",
      snapshotEndpoint: "passed",
      dashboardHtml: "passed",
      dashboardJs: "passed",
      dashboardCss: "passed",
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
      providerHistoryEndpoint: "passed",
      providerHistoryCount: 3,
      remoteCheckEndpoint: "passed",
      remoteClient: agentHostname !== clientHostname,
      clientIp: agentHostname === clientHostname ? "192.168.0.10" : "192.168.0.24",
      clientAddress: agentHostname === clientHostname ? "192.168.0.10:53124" : "192.168.0.24:53124",
      sameHostIp: agentHostname === clientHostname,
      loopback: false,
      runtime: "rust-headless",
      version: "0.2.0",
      platform: runtimePlatform,
      trayEnabled: false,
      bindHost: "0.0.0.0",
      port: 8765,
      localUrl: "http://127.0.0.1:8765",
      lanUrls: ["http://192.168.0.10:8765"],
      agentHostname,
      clientHostname,
      sameHost: agentHostname === clientHostname,
      status: "busy",
      activeProcessCount: 1,
      totalCpu: 1.2,
      ...overrides.automatedChecks,
    },
    ...overrides.root,
  };
}

function browserDashboardRemoteReport(runtimePlatform) {
  return remoteClientReport(runtimePlatform, "agent-macos", "browser-192.168.0.24", {
    root: {
      verifier: "browser-dashboard",
      targetUrl: "http://192.168.0.10:8765",
      client: {
        hostname: "browser-192.168.0.24",
        platform: "MacIntel",
        release: "Mozilla/5.0 test browser",
        arch: "browser",
      },
    },
    automatedChecks: {
      clientHostname: "browser-192.168.0.24",
      sameHost: false,
      remoteClient: true,
      clientIp: "192.168.0.24",
      clientAddress: "192.168.0.24:53124",
      sameHostIp: false,
      loopback: false,
    },
  });
}

function manualChecks(status) {
  return [
    "startsHidden",
    "trayIconVisible",
    "trayMenuItems",
    "trayTooltip",
    "openDashboard",
    "closeKeepsHealthz",
    "quitExitsApp",
    "lanUrlReachable",
    "windowsNoConsole",
  ].map((id) => ({ id, label: id, status }));
}

function serviceManualChecks(status) {
  return [
    "startsOnLogin",
    "lanUrlReachable",
    "uninstallClean",
  ].map((id) => ({ id, label: id, status }));
}

function runReadiness(targetDir, ...args) {
  return spawnSync(process.execPath, ["scripts/release-readiness.mjs", targetDir, ...args], {
    encoding: "utf8",
  });
}
