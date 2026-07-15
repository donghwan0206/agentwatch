import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "agentwatch-import-remote-test-"));

try {
  const assets = join(root, "release-assets");
  const validReport = join(root, "downloads", "remote-client-verification-macos.json");
  writeJson(validReport, remoteReport("macos"));

  const imported = run([
    "scripts/import-remote-report.mjs",
    "--report",
    validReport,
    "--assets",
    assets,
  ]);
  assert.equal(imported.status, 0, imported.stderr);
  assert.match(imported.stdout, /Imported remote report:/);
  assert.match(imported.stdout, /Remote client IP: 192\.168\.0\.24/);
  assert.match(imported.stdout, /release:refresh -- .*release-assets.*--platform macos --check/);
  assert.equal(existsSync(join(assets, "remote-client-verification-macos.json")), true);
  assert.deepEqual(
    JSON.parse(readFileSync(join(assets, "remote-client-verification-macos.json"), "utf8")),
    remoteReport("macos"),
  );

  const serviceAssets = join(root, "service-assets");
  const importedServiceOnly = run([
    "scripts/import-remote-report.mjs",
    "--report",
    validReport,
    "--assets",
    serviceAssets,
    "--service-only",
  ]);
  assert.equal(importedServiceOnly.status, 0, importedServiceOnly.stderr);
  assert.match(importedServiceOnly.stdout, /release:refresh -- .*service-assets --service-only --platform macos --check/);

  const localOnlyReport = join(root, "local-only.json");
  writeJson(localOnlyReport, remoteReport("macos", {
    root: {
      result: "local-only",
      targetUrl: "http://127.0.0.1:8765",
    },
    automatedChecks: {
      remoteClient: false,
      sameHost: true,
      sameHostIp: true,
      loopback: true,
    },
  }));
  const rejectedLocal = run([
    "scripts/import-remote-report.mjs",
    "--report",
    localOnlyReport,
    "--assets",
    assets,
    "--platform",
    "macos",
  ]);
  assert.notEqual(rejectedLocal.status, 0, "local-only report should be rejected");
  assert.match(rejectedLocal.stderr, /result is not passed/);
  assert.match(rejectedLocal.stderr, /remote client/);

  const wrongPlatformReport = join(root, "remote-client-verification-linux.json");
  writeJson(wrongPlatformReport, remoteReport("linux"));
  const rejectedPlatform = run([
    "scripts/import-remote-report.mjs",
    "--report",
    wrongPlatformReport,
    "--assets",
    assets,
    "--platform",
    "windows",
  ]);
  assert.notEqual(rejectedPlatform.status, 0, "wrong-platform report should be rejected");
  assert.match(rejectedPlatform.stderr, /runtime platform is linux, expected windows/);

  console.log("import remote report tests ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function remoteReport(platform, overrides = {}) {
  return {
    schemaVersion: 1,
    verifier: "browser-dashboard",
    targetUrl: "http://192.168.0.10:8765",
    client: {
      hostname: "browser-192.168.0.24",
      platform: "MacIntel",
      release: "Mozilla/5.0 test browser",
      arch: "browser",
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
      remoteClient: true,
      clientIp: "192.168.0.24",
      clientAddress: "192.168.0.24:53124",
      sameHostIp: false,
      loopback: false,
      runtime: "rust-headless",
      version: "0.2.0",
      platform,
      trayEnabled: false,
      bindHost: "0.0.0.0",
      port: 8765,
      localUrl: "http://127.0.0.1:8765",
      lanUrls: ["http://192.168.0.10:8765"],
      agentHostname: "agent-macos",
      clientHostname: "browser-192.168.0.24",
      sameHost: false,
      status: "busy",
      activeProcessCount: 1,
      totalCpu: 1.2,
      ...overrides.automatedChecks,
    },
    ...overrides.root,
  };
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
