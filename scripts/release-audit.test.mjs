import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "agentwatch-audit-test-"));

try {
  writeCompleteFixture(dir);
  let audit = runAudit(dir);
  assert.equal(audit.status, 0, audit.stderr);
  let payload = readAudit(dir);
  assert.equal(payload.platforms.every((platform) => platform.status === "passed"), true);

  writeCompleteFixture(dir);
  writeTrayReport(dir, "macos", trayReport("macos", {
    manualChecks: manualChecks("passed").filter((check) => check.id !== "startsHidden"),
  }));
  audit = runAudit(dir);
  assert.equal(audit.status, 0, audit.stderr);
  payload = readAudit(dir);
  assert.equal(platformCheck(payload, "macos", "trayIndicator").status, "missing");
  assert.equal(platformByName(payload, "macos").status, "incomplete");

  writeCompleteFixture(dir);
  rmSync(join(dir, "AgentWatch.msi"), { force: true });
  audit = runAudit(dir);
  assert.equal(audit.status, 0, audit.stderr);
  payload = readAudit(dir);
  const windowsPackage = platformCheck(payload, "windows", "desktopPackage");
  assert.equal(windowsPackage.status, "missing");
  assert.match(windowsPackage.evidence, /Windows MSI installer missing/);

  console.log("release-audit tests ok");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

function writeCompleteFixture(targetDir) {
  rmSync(targetDir, { recursive: true, force: true });
  write(join(targetDir, "AgentWatch-macOS.app.zip"), "mac app");
  write(join(targetDir, "AgentWatch-Setup.exe"), "windows nsis");
  write(join(targetDir, "AgentWatch.msi"), "windows msi");
  write(join(targetDir, "AgentWatch.AppImage"), "linux appimage");
  write(join(targetDir, "agentwatch.deb"), "linux deb");
  write(join(targetDir, "agentwatch.rpm"), "linux rpm");
  write(join(targetDir, "agentwatch-server-macOS"), "mac server");
  write(join(targetDir, "agentwatch-server-Windows.exe"), "windows server");
  write(join(targetDir, "agentwatch-server-Linux"), "linux server");

  for (const platform of ["macos", "windows", "linux"]) {
    writeJson(targetDir, `agentwatch-release-manifest-${platform}.json`, { schemaVersion: 1 });
    writeJson(targetDir, `performance-comparison-${platform}.json`, performanceReport());
    writeJson(targetDir, `service-verification-${platform}.json`, { manualResult: "passed" });
    writeJson(targetDir, `service-lifecycle-${platform}.json`, { result: "passed" });
    writeJson(targetDir, `lan-preflight-${platform}.json`, lanPreflightReport());
    writeJson(targetDir, `remote-client-verification-${platform}.json`, {
      result: "passed",
      automatedChecks: { sameHost: false },
    });
    writeTrayReport(targetDir, platform, trayReport(platform));
  }
}

function performanceReport() {
  return {
    benchmark: {
      delta: {
        headlessVsPython: {
          startupMs: { value: -1 },
          avgResponseMs: { value: -1 },
          p95ResponseMs: { value: -1 },
        },
      },
    },
  };
}

function lanPreflightReport() {
  return {
    readyForRemoteViewer: true,
    checks: {
      bindHost: { ok: true },
      lanUrl: { ok: true },
      lanHealthz: { ok: true },
      dashboard: { ok: true },
    },
  };
}

function trayReport(platform, overrides = {}) {
  const target = indicatorTarget(platform);
  return {
    manualResult: "passed",
    visualTarget: target,
    automatedChecks: {
      indicatorTarget: target,
      runtimeIndicatorTarget: target,
      runtime: "tauri-rust",
      trayEnabled: true,
      startsHiddenConfig: "passed",
      platform,
    },
    manualChecks: manualChecks("passed"),
    screenshots: [{ path: "/tmp/tray.png", bytes: 1, sha256: "a".repeat(64) }],
    ...overrides,
  };
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

function indicatorTarget(platform) {
  if (platform === "macos") return "macos-menu-bar";
  if (platform === "windows") return "windows-notification-area";
  if (platform === "linux") return "linux-tray";
  return "desktop-tray";
}

function writeTrayReport(targetDir, platform, data) {
  writeJson(targetDir, `tray-verification-${platform}.json`, data);
}

function writeJson(targetDir, file, data) {
  write(join(targetDir, file), `${JSON.stringify(data, null, 2)}\n`);
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function runAudit(targetDir, ...args) {
  return spawnSync(process.execPath, ["scripts/release-audit.mjs", targetDir, ...args], {
    encoding: "utf8",
  });
}

function readAudit(targetDir) {
  return JSON.parse(readFileSync(join(targetDir, "completion-audit.json"), "utf8"));
}

function platformByName(payload, name) {
  return payload.platforms.find((platform) => platform.name === name);
}

function platformCheck(payload, platformName, checkId) {
  return platformByName(payload, platformName).checks.find((check) => check.id === checkId);
}
