import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "agentwatch-release-status-test-"));

try {
  writeFixture(dir);
  const serviceOnly = runStatus(dir, "--service-only");
  assert.equal(serviceOnly.status, 0, serviceOnly.stderr);
  assert.match(serviceOnly.stdout, /Overall: incomplete/);
  assert.match(serviceOnly.stdout, /\| macOS \| skipped \| passed \| passed \| passed \| passed \| passed \| passed \| missing \| skipped \| incomplete \| remote-verification\.md \|/);

  const json = runStatus(dir, "--service-only", "--json");
  assert.equal(json.status, 0, json.stderr);
  const payload = JSON.parse(json.stdout);
  assert.equal(payload.serviceOnly, true);
  assert.equal(payload.platforms.find((platform) => platform.name === "macos").checks.lanPreflight, "passed");
  assert.equal(payload.platforms.find((platform) => platform.name === "macos").checks.remote, "missing");
  assert.deepEqual(payload.platforms.find((platform) => platform.name === "macos").issues.remote, ["remote client verification missing"]);
  assert.equal(payload.platforms.find((platform) => platform.name === "macos").nextGuide, "remote-verification.md");

  const macosOnly = runStatus(dir, "--service-only", "--platform", "macos", "--json");
  assert.equal(macosOnly.status, 0, macosOnly.stderr);
  const macosPayload = JSON.parse(macosOnly.stdout);
  assert.equal(macosPayload.platform, "macos");
  assert.equal(macosPayload.platforms.length, 1);
  assert.equal(macosPayload.platforms[0].name, "macos");

  const invalidPlatform = runStatus(dir, "--platform", "solaris");
  assert.notEqual(invalidPlatform.status, 0, "unsupported platform should fail");
  assert.match(invalidPlatform.stderr, /Unsupported platform filter: solaris/);

  writeFixture(dir);
  writeJson(dir, "performance-comparison-macos.json", {
    schemaVersion: 1,
    host: { platform: "darwin" },
    benchmark: {
      rustHeadless: { runtime: "rust-headless", platform: "macos", startupMs: 200, avgResponseMs: 2, p95ResponseMs: 5, rssMb: 45 },
      python: { runtime: "python", startupMs: 100, avgResponseMs: 1, p95ResponseMs: 4, rssMb: 30 },
      delta: {
        headlessVsPython: {
          startupMs: { value: 100 },
          avgResponseMs: { value: 1 },
          p95ResponseMs: { value: 1 },
          rssMb: { value: 15 },
        },
      },
    },
  });
  const invalidPerformance = runStatus(dir, "--service-only", "--platform", "macos", "--json");
  assert.equal(invalidPerformance.status, 0, invalidPerformance.stderr);
  const invalidPerformancePayload = JSON.parse(invalidPerformance.stdout);
  assert.equal(invalidPerformancePayload.platforms[0].checks.performance, "invalid");
  assert.deepEqual(
    invalidPerformancePayload.platforms[0].issues.performance,
    ["performanceVerdict"],
  );

  writeFixture(dir);
  const staleVerdictReport = performanceReport();
  staleVerdictReport.performanceVerdict.requirements[0].actualDelta = { value: -999 };
  writeJson(dir, "performance-comparison-macos.json", staleVerdictReport);
  const staleVerdict = runStatus(dir, "--service-only", "--platform", "macos", "--json");
  assert.equal(staleVerdict.status, 0, staleVerdict.stderr);
  const staleVerdictPayload = JSON.parse(staleVerdict.stdout);
  assert.equal(staleVerdictPayload.platforms[0].checks.performance, "invalid");
  assert.deepEqual(staleVerdictPayload.platforms[0].issues.performance, ["performanceVerdict-startupMs-delta"]);

  writeFixture(dir);
  writeJson(dir, "remote-client-verification-macos.json", remoteReport({ sameHost: true }));
  const invalidRemote = runStatus(dir, "--service-only", "--platform", "macos", "--json");
  assert.equal(invalidRemote.status, 0, invalidRemote.stderr);
  assert.equal(JSON.parse(invalidRemote.stdout).platforms[0].checks.remote, "invalid");

  writeFixture(dir);
  writeFileSync(join(dir, "AgentWatch-macOS.app.zip"), "app");
  const missingTray = runStatus(dir, "--platform", "macos", "--json");
  assert.equal(missingTray.status, 0, missingTray.stderr);
  const missingTrayPayload = JSON.parse(missingTray.stdout);
  assert.equal(missingTrayPayload.platforms[0].checks.tray, "missing");
  assert.equal(missingTrayPayload.platforms[0].nextGuide, "tray-verification.md");

  writeFixture(dir);
  writeFileSync(join(dir, "AgentWatch-macOS.app.zip"), "app");
  writeJson(dir, "tray-verification-macos.json", {
    manualResult: "passed",
    visualTarget: "macos-menu-bar",
    automatedChecks: {
      healthz: "passed",
      runtimeEndpoint: "passed",
      snapshotEndpoint: "passed",
      usageEndpoint: "passed",
      usageProviderCount: 1,
      providerHistoryEndpoint: "passed",
      providerHistoryCount: 1,
      startsHiddenConfig: "passed",
      trayMenuContract: "passed",
      trayTooltipContract: "passed",
      openDashboardContract: "passed",
      closeToTrayContract: "passed",
      runtime: "tauri-rust",
      trayEnabled: true,
      indicatorTarget: "macos-menu-bar",
      runtimeIndicatorTarget: "macos-menu-bar",
      platform: "macos",
    },
    manualChecks: [
      "startsHidden",
      "trayIconVisible",
      "trayMenuItems",
      "trayTooltip",
      "openDashboard",
      "closeKeepsHealthz",
      "quitExitsApp",
      "lanUrlReachable",
    ].map((id) => ({ id, label: id, status: "passed" })),
    screenshots: [{ path: "/tmp/tray.png", bytes: 1, sha256: "a".repeat(64) }],
  });
  writeJson(dir, "tray-config-verification-macos.json", {
    configOnly: true,
    automatedChecks: {
      runtime: "tauri-rust",
      trayEnabled: true,
      startsHiddenConfig: "passed",
      trayMenuContract: "passed",
      trayTooltipContract: "passed",
      openDashboardContract: "passed",
      closeToTrayContract: "passed",
      runtimeIndicatorTarget: "macos-menu-bar",
    },
  });
  const trayConfigStatus = runStatus(dir, "--platform", "macos", "--json");
  assert.equal(trayConfigStatus.status, 0, trayConfigStatus.stderr);
  const trayIssues = JSON.parse(trayConfigStatus.stdout).platforms[0].issues.tray || [];
  assert.equal(trayIssues.includes("startsHiddenConfig"), false);

  writeJson(dir, "tray-verification-macos-capture.json", {
    manualResult: "pending",
    visualTarget: "macos-menu-bar",
    automatedChecks: {
      runtime: "tauri-rust",
      trayEnabled: true,
      indicatorTarget: "macos-menu-bar",
      runtimeIndicatorTarget: "macos-menu-bar",
      platform: "macos",
    },
    manualChecks: [],
    screenshots: [{ path: "/tmp/macos-menu-bar.png", bytes: 1, sha256: "b".repeat(64) }],
  });
  const exactTrayPreferred = runStatus(dir, "--platform", "macos", "--json");
  assert.equal(exactTrayPreferred.status, 0, exactTrayPreferred.stderr);
  assert.equal(JSON.parse(exactTrayPreferred.stdout).platforms[0].checks.tray, "passed");

  const invalidScreenshotTray = JSON.parse(readFileSync(join(dir, "tray-verification-macos.json"), "utf8"));
  invalidScreenshotTray.screenshots = [{ path: "", bytes: 0, sha256: "not-a-sha" }];
  writeJson(dir, "tray-verification-macos.json", invalidScreenshotTray);
  const invalidScreenshotStatus = runStatus(dir, "--platform", "macos", "--json");
  assert.equal(invalidScreenshotStatus.status, 0, invalidScreenshotStatus.stderr);
  const invalidScreenshotIssues = JSON.parse(invalidScreenshotStatus.stdout).platforms[0].issues.tray || [];
  assert.deepEqual(
    invalidScreenshotIssues.filter((issue) => issue.startsWith("screenshot")),
    ["screenshot1Path", "screenshot1Bytes", "screenshot1Sha256"],
  );

  writeFixture(dir);
  writeJson(dir, "service-verification-macos.json", serviceReport({
    providerHistoryEndpoint: "missing",
    providerHistoryCount: -1,
  }));
  const invalidProviderHistory = runStatus(dir, "--service-only", "--platform", "macos", "--json");
  assert.equal(invalidProviderHistory.status, 0, invalidProviderHistory.stderr);
  const invalidProviderHistoryPayload = JSON.parse(invalidProviderHistory.stdout);
  assert.equal(invalidProviderHistoryPayload.platforms[0].checks.service, "invalid");
  assert.deepEqual(invalidProviderHistoryPayload.platforms[0].issues.service, [
    "providerHistoryEndpoint",
    "providerHistoryCount",
  ]);

  console.log("release-status tests ok");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

function writeFixture(targetDir) {
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  for (const file of [
    "agentwatch-server-macOS",
    "remote-verification.md",
    "tray-verification.md",
    "release-verification.md",
  ]) {
    writeFileSync(join(targetDir, file), file);
  }
  writeJson(targetDir, "agentwatch-release-manifest-macos.json", {
    schemaVersion: 1,
    app: { version: "0.2.0" },
    build: { platform: "macos" },
    automatedGates: automatedGates(),
    assets: [assetEvidence(targetDir, "agentwatch-server-macOS")],
  });
  writeJson(targetDir, "performance-comparison-macos.json", performanceReport());
  writeJson(targetDir, "service-verification-macos.json", serviceReport());
  writeJson(targetDir, "service-lifecycle-macos.json", lifecycleReport());
  writeJson(targetDir, "lan-preflight-macos.json", lanPreflightReport());
  writeJson(targetDir, "completion-audit.json", {
    schemaVersion: 1,
    serviceOnly: true,
    platforms: [
      { name: "macos", status: "incomplete" },
      { name: "windows", status: "incomplete" },
      { name: "linux", status: "incomplete" },
    ],
  });
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

function lanPreflightReport(overrides = {}) {
  return {
    schemaVersion: 1,
    targetUrl: "http://127.0.0.1:8765/",
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
      runtime: "rust-headless",
      platform: "macos",
      bindHost: "0.0.0.0",
      lanUrls: ["http://192.168.0.10:8765"],
    },
    ...overrides,
  };
}

function assetEvidence(targetDir, file) {
  const content = readFileSync(join(targetDir, file));
  return {
    name: file,
    bytes: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

function performanceReport() {
  const headlessVsPython = {
    startupMs: { value: -180 },
    avgResponseMs: { value: -2.1 },
    p95ResponseMs: { value: -4.2 },
    rssMb: { value: -14 },
  };
  return {
    schemaVersion: 1,
    host: { platform: "darwin" },
    benchmark: {
      rustHeadless: { runtime: "rust-headless", platform: "macos", startupMs: 20, avgResponseMs: 0.4, p95ResponseMs: 0.8, rssMb: 16 },
      python: { runtime: "python", startupMs: 200, avgResponseMs: 2.5, p95ResponseMs: 5, rssMb: 30 },
      delta: {
        headlessVsPython,
      },
    },
    performanceVerdict: performanceVerdict(headlessVsPython),
  };
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

function serviceReport(overrides = {}) {
  return {
    manualResult: "passed",
    automatedChecks: {
      healthz: "passed",
      runtimeEndpoint: "passed",
      snapshotEndpoint: "passed",
      usageEndpoint: "passed",
      usageProviderCount: 1,
      providerHistoryEndpoint: "passed",
      providerHistoryCount: 3,
      lanUrlReachable: "passed",
      serviceRegistered: "passed",
      loginStartContract: "passed",
      runtime: "rust-headless",
      trayEnabled: false,
      bindHost: "0.0.0.0",
      platform: "macos",
      ...overrides,
    },
  };
}

function lifecycleReport() {
  return {
    schemaVersion: 1,
    result: "passed",
    host: { platform: "darwin" },
    steps: ["uninstall", "uninstallClean", "install", "verifyService", "reinstallHealthy"].map((name) => ({
      name,
      status: "passed",
    })),
  };
}

function remoteReport(overrides = {}) {
  return {
    schemaVersion: 1,
    result: "passed",
    targetUrl: "http://192.168.0.10:8765",
    automatedChecks: {
      healthz: "passed",
      runtimeEndpoint: "passed",
      snapshotEndpoint: "passed",
      usageEndpoint: "passed",
      usageProviderCount: 1,
      providerHistoryEndpoint: "passed",
      providerHistoryCount: 3,
      remoteCheckEndpoint: "passed",
      remoteClient: true,
      clientIp: "192.168.0.24",
      clientAddress: "192.168.0.24:53124",
      sameHostIp: false,
      loopback: false,
      runtime: "rust-headless",
      trayEnabled: false,
      bindHost: "0.0.0.0",
      platform: "macos",
      sameHost: false,
      ...overrides,
    },
  };
}

function writeJson(targetDir, file, data) {
  writeFileSync(join(targetDir, file), `${JSON.stringify(data, null, 2)}\n`);
}

function runStatus(targetDir, ...args) {
  return spawnSync(process.execPath, ["scripts/release-status.mjs", targetDir, ...args], {
    encoding: "utf8",
  });
}
