import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "agentwatch-tray-manual-test-"));

try {
  const source = join(root, "tray-verification-macos.json");
  const screenshot = join(root, "macos-menu-bar.png");
  const partialOutput = join(root, "partial.json");
  const passedOutput = join(root, "passed.json");
  writeJson(source, trayReport("macos"));
  writeFileSync(screenshot, "png bytes");

  const partial = run([
    "scripts/tray-manual-report.mjs",
    "--source",
    source,
    "--output",
    partialOutput,
    "--check",
    "startsHidden=passed",
    "--screenshot",
    screenshot,
    "--replace-screenshots",
    "--manual-notes",
    "Started hidden and screenshot captured.",
  ]);
  assert.equal(partial.status, 0, partial.stderr);
  const partialReport = JSON.parse(readFileSync(partialOutput, "utf8"));
  assert.equal(partialReport.manualResult, "pending");
  assert.equal(partialReport.manualChecks.find((check) => check.id === "startsHidden").status, "passed");
  assert.equal(partialReport.screenshots.length, 1);
  assert.equal(partialReport.screenshots[0].bytes, 9);
  assert.equal(partialReport.manualNotes, "Started hidden and screenshot captured.");

  const allChecks = manualCheckIds("macos").flatMap((id) => ["--check", `${id}=passed`]);
  const passed = run([
    "scripts/tray-manual-report.mjs",
    "--source",
    partialOutput,
    "--output",
    passedOutput,
    ...allChecks,
  ]);
  assert.equal(passed.status, 0, passed.stderr);
  const passedReport = JSON.parse(readFileSync(passedOutput, "utf8"));
  assert.equal(passedReport.manualResult, "passed");
  assert.equal(passedReport.manualChecks.every((check) => check.status === "passed"), true);
  assert.equal(passedReport.screenshots.length, 1);

  const invalid = run([
    "scripts/tray-manual-report.mjs",
    "--source",
    source,
    "--output",
    join(root, "invalid.json"),
    "--check",
    "notARealCheck=passed",
  ]);
  assert.notEqual(invalid.status, 0, "unknown manual check id should fail");
  assert.match(invalid.stderr, /unknown manual check id/);

  console.log("tray manual report tests ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function trayReport(platform) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-09T00:00:00.000Z",
    verifier: "scripts/verify-tray.mjs",
    visualTarget: platform === "macos" ? "macos-menu-bar" : platform,
    host: { platform: platform === "macos" ? "darwin" : platform },
    automatedChecks: {
      runtime: "tauri-rust",
      platform,
      trayEnabled: true,
    },
    manualChecks: manualCheckIds(platform).map((id) => ({ id, label: id, status: "pending" })),
    manualResult: "pending",
    manualNotes: null,
    screenshots: [],
  };
}

function manualCheckIds(platform) {
  return [
    "startsHidden",
    "trayIconVisible",
    "trayMenuItems",
    "trayTooltip",
    "openDashboard",
    "closeKeepsHealthz",
    "quitExitsApp",
    "lanUrlReachable",
    ...(platform === "windows" ? ["windowsNoConsole"] : []),
  ];
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function run(args) {
  return spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}
