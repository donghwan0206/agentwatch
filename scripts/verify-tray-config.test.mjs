import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "agentwatch-tray-config-test-"));

try {
  const fakeVerifier = join(dir, "fake-verify-tray.mjs");
  writeFileSync(fakeVerifier, `
    import { writeFileSync } from "node:fs";
    const reportPath = process.argv[process.argv.indexOf("--report") + 1];
    writeFileSync(reportPath, JSON.stringify({
      verifier: "fake",
      manualResult: "pending",
      host: { platform: "darwin" },
      automatedChecks: {
        runtime: "tauri-rust",
        platform: "macos",
        trayEnabled: true,
        startsHiddenConfig: "passed",
        trayMenuContract: "passed",
        trayTooltipContract: "passed",
        openDashboardContract: "passed",
        closeToTrayContract: "passed",
        runtimeIndicatorTarget: "macos-menu-bar"
      }
    }, null, 2));
  `);
  chmodSync(fakeVerifier, 0o755);

  const outputDir = join(dir, "assets");
  const result = spawnSync(process.execPath, [
    "scripts/verify-tray-config.mjs",
    "--output-dir",
    outputDir,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      AGENTWATCH_TRAY_CONFIG_VERIFY_SCRIPT: fakeVerifier,
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const reportPath = join(outputDir, "tray-config-verification-macos.json");
  assert.equal(existsSync(reportPath), true, "tray config report missing");
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.equal(report.configOnly, true);
  assert.equal(report.verifier, "scripts/verify-tray-config.mjs");
  assert.equal(report.sourceVerifier, "fake");
  assert.equal(report.automatedChecks.startsHiddenConfig, "passed");
  assert.equal(report.automatedChecks.trayMenuContract, "passed");
  assert.equal(report.automatedChecks.trayTooltipContract, "passed");
  assert.equal(report.automatedChecks.openDashboardContract, "passed");
  assert.equal(report.automatedChecks.closeToTrayContract, "passed");

  const windowsBadVerifier = join(dir, "windows-bad-verify-tray.mjs");
  writeFileSync(windowsBadVerifier, `
    import { writeFileSync } from "node:fs";
    const reportPath = process.argv[process.argv.indexOf("--report") + 1];
    writeFileSync(reportPath, JSON.stringify({
      manualResult: "pending",
      host: { platform: "win32" },
      automatedChecks: {
        runtime: "tauri-rust",
        platform: "windows",
        trayEnabled: true,
        startsHiddenConfig: "passed",
        trayMenuContract: "passed",
        trayTooltipContract: "passed",
        openDashboardContract: "passed",
        closeToTrayContract: "passed",
        windowsNoConsoleContract: "failed",
        runtimeIndicatorTarget: "windows-notification-area"
      }
    }, null, 2));
  `);
  const windowsBad = spawnSync(process.execPath, [
    "scripts/verify-tray-config.mjs",
    "--output-dir",
    outputDir,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      AGENTWATCH_TRAY_CONFIG_VERIFY_SCRIPT: windowsBadVerifier,
    },
  });
  assert.notEqual(windowsBad.status, 0, "Windows missing no-console contract should fail");
  assert.match(windowsBad.stderr, /windowsNoConsoleContract did not pass/);

  const badVerifier = join(dir, "bad-verify-tray.mjs");
  writeFileSync(badVerifier, `
    import { writeFileSync } from "node:fs";
    const reportPath = process.argv[process.argv.indexOf("--report") + 1];
    writeFileSync(reportPath, JSON.stringify({
      manualResult: "pending",
      automatedChecks: {
        runtime: "tauri-rust",
        platform: "macos",
        trayEnabled: true,
        startsHiddenConfig: "failed",
        trayMenuContract: "passed",
        trayTooltipContract: "passed",
        openDashboardContract: "passed",
        closeToTrayContract: "passed",
        runtimeIndicatorTarget: "macos-menu-bar"
      }
    }, null, 2));
  `);
  const bad = spawnSync(process.execPath, [
    "scripts/verify-tray-config.mjs",
    "--output-dir",
    join(dir, "bad-assets"),
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      AGENTWATCH_TRAY_CONFIG_VERIFY_SCRIPT: badVerifier,
    },
  });
  assert.notEqual(bad.status, 0, "failed hidden startup config should fail");
  assert.match(bad.stderr, /startsHiddenConfig did not pass/);

  console.log("tray config tests ok");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
