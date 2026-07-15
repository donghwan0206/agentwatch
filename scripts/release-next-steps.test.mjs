import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = mkdtempSync(join(tmpdir(), "agentwatch-next-steps-test-"));

try {
  const assets = join(root, "release-assets");
  const archives = join(root, "desktop-archives");
  mkdirSync(assets, { recursive: true });
  mkdirSync(archives, { recursive: true });
  writeFileSync(join(assets, "release-status.json"), JSON.stringify({
    schemaVersion: 1,
    serviceOnly: false,
    platforms: [
      {
        name: "macos",
        checks: {
          package: "passed",
          service: "passed",
          lifecycle: "passed",
          remote: "missing",
          tray: "invalid",
          audit: "incomplete",
        },
        blockers: ["remote: missing", "tray: invalid", "audit: incomplete"],
      },
    ],
  }, null, 2));
  writeFileSync(join(assets, "remote-verification.md"), [
    "# Guide",
    "",
    "## macOS Agent Machine",
    "",
    "Target URL: `http://192.168.50.93:8765`",
    "",
  ].join("\n"));
  for (const helper of [
    "agentwatch-import-remote-report.mjs",
    "agentwatch-import-tray-report.mjs",
    "agentwatch-refresh-release-evidence.mjs",
    "agentwatch-release-status.mjs",
  ]) {
    writeFileSync(join(assets, helper), "console.log('helper');\n");
  }
  writeFileSync(join(archives, "desktop-release-status.json"), JSON.stringify({
    schemaVersion: 1,
    platforms: [
      {
        name: "macos",
        archiveStatus: "present",
        blockers: ["remote: missing", "tray: invalid"],
        checks: { remote: "missing", tray: "invalid", audit: "incomplete" },
      },
      {
        name: "windows",
        archiveStatus: "missing",
        blockers: ["archive missing: agentwatch-desktop-release-Windows.tar.gz"],
        checks: {},
      },
    ],
  }, null, 2));

  const markdown = run(["--assets", assets, "--archives", archives]);
  assert.equal(markdown.status, 0, markdown.stderr);
  assert.match(markdown.stdout, /AgentWatch Next Release Steps/);
  assert.match(markdown.stdout, /node agentwatch-verify-remote-client\.mjs --url http:\/\/192\.168\.50\.93:8765 --report remote-client-verification-macos\.json/);
  assert.match(markdown.stdout, /node agentwatch-import-remote-report\.mjs --report \/path\/to\/remote-client-verification-macos\.json/);
  assert.match(markdown.stdout, /node agentwatch-import-tray-report\.mjs --report \/path\/to\/tray-verification-macos\.json/);
  assert.match(markdown.stdout, /node agentwatch-refresh-release-evidence\.mjs/);
  assert.match(markdown.stdout, /agentwatch-tray-manual-report\.mjs/);
  assert.match(markdown.stdout, /npm run package:desktop-local -- --assets release-assets-desktop-windows --platform windows/);
  assert.doesNotMatch(markdown.stdout, /remote-client-verification-windows\.json/);
  assert.doesNotMatch(markdown.stdout, /tray-verification-windows\.json/);

  const json = run(["--assets", assets, "--archives", archives, "--platform", "macos", "--json"]);
  assert.equal(json.status, 0, json.stderr);
  const payload = JSON.parse(json.stdout);
  assert.equal(payload.platforms.length, 1);
  assert.equal(payload.platforms[0].name, "macos");
  assert.deepEqual(payload.platforms[0].steps.map((step) => step.id), [
    "verify-remote-browser",
    "verify-tray",
    "refresh-audit",
  ]);

  for (const helper of [
    "agentwatch-import-remote-report.mjs",
    "agentwatch-import-tray-report.mjs",
    "agentwatch-refresh-release-evidence.mjs",
    "agentwatch-release-status.mjs",
  ]) {
    rmSync(join(assets, helper), { force: true });
  }
  const sourceCheckout = run(["--assets", assets, "--archives", archives]);
  assert.equal(sourceCheckout.status, 0, sourceCheckout.stderr);
  assert.match(sourceCheckout.stdout, /npm run release:import-remote/);
  assert.match(sourceCheckout.stdout, /npm run release:import-tray/);
  assert.match(sourceCheckout.stdout, /npm run release:refresh/);

  const serviceAssets = join(root, "service-assets");
  mkdirSync(serviceAssets, { recursive: true });
  writeFileSync(join(serviceAssets, "release-status.json"), JSON.stringify({
    schemaVersion: 1,
    serviceOnly: true,
    platforms: [
      {
        name: "macos",
        checks: {
          headless: "passed",
          service: "missing",
          lifecycle: "missing",
          remote: "missing",
          tray: "skipped",
          audit: "incomplete",
        },
        blockers: ["service: missing", "remote: missing"],
      },
    ],
  }, null, 2));
  writeFileSync(join(serviceAssets, "remote-verification.md"), [
    "# Guide",
    "",
    "## macOS Agent Machine",
    "",
    "Target URL: `http://192.168.50.93:8893`",
    "",
  ].join("\n"));
  const serviceOnly = run(["--assets", serviceAssets, "--archives", archives, "--service-only"]);
  assert.equal(serviceOnly.status, 0, serviceOnly.stderr);
  assert.match(serviceOnly.stdout, /Run macOS service verification/);
  assert.match(serviceOnly.stdout, /http:\/\/192\.168\.50\.93:8765/);
  assert.doesNotMatch(serviceOnly.stdout, /http:\/\/192\.168\.50\.93:8893/);
  assert.doesNotMatch(serviceOnly.stdout, /Build Windows desktop archive/);
  assert.doesNotMatch(serviceOnly.stdout, /Build Linux desktop archive/);
  assert.doesNotMatch(serviceOnly.stdout, /verify-tray/);

  console.log("release next steps tests ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function run(extraArgs) {
  return spawnSync(process.execPath, ["scripts/release-next-steps.mjs", ...extraArgs], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}
