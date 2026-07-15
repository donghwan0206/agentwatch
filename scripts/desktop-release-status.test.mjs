import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = mkdtempSync(join(tmpdir(), "agentwatch-desktop-status-test-"));

try {
  const archives = join(root, "desktop-archives");
  mkdirSync(archives, { recursive: true });
  writeArchive(archives, "agentwatch-desktop-release-macOS", releaseStatus("macos", {
    package: "passed",
    headless: "passed",
    manifest: "passed",
    performance: "passed",
    service: "passed",
    lifecycle: "passed",
    remote: "missing",
    tray: "invalid",
    audit: "incomplete",
  }));

  const partial = runStatus(archives, "--json");
  assert.equal(partial.status, 0, partial.stderr);
  const partialPayload = JSON.parse(partial.stdout);
  assert.equal(partialPayload.overall, "incomplete");
  assert.equal(partialPayload.platforms.find((platform) => platform.name === "macos").archiveStatus, "present");
  assert.equal(partialPayload.platforms.find((platform) => platform.name === "windows").archiveStatus, "missing");
  assert.match(partial.stdout, /remote: missing/);

  const checkedPartial = runStatus(archives, "--check");
  assert.notEqual(checkedPartial.status, 0, "--check should fail incomplete desktop releases");
  assert.match(checkedPartial.stdout, /Overall: incomplete/);

  const macosOnly = runStatus(archives, "--platform", "macos", "--json");
  assert.equal(macosOnly.status, 0, macosOnly.stderr);
  const macosPayload = JSON.parse(macosOnly.stdout);
  assert.equal(macosPayload.platform, "macos");
  assert.equal(macosPayload.platforms.length, 1);
  assert.equal(macosPayload.platforms[0].nextAction, "Import a passed tray/menu-bar verification report.");

  writeArchive(archives, "agentwatch-desktop-release-macOS", readyStatus("macos"));
  writeArchive(archives, "agentwatch-desktop-release-Windows", readyStatus("windows"));
  writeArchive(archives, "agentwatch-desktop-release-Linux", readyStatus("linux"));
  const ready = runStatus(archives, "--check", "--json");
  assert.equal(ready.status, 0, ready.stderr);
  assert.equal(JSON.parse(ready.stdout).overall, "ready");

  writeFileSync(join(archives, "agentwatch-desktop-release-extra.tar.gz"), "not a tarball");
  const unexpected = runStatus(archives, "--json");
  assert.equal(unexpected.status, 0, unexpected.stderr);
  const unexpectedPayload = JSON.parse(unexpected.stdout);
  assert.equal(unexpectedPayload.overall, "incomplete");
  assert.deepEqual(unexpectedPayload.unexpectedArchives, ["agentwatch-desktop-release-extra.tar.gz"]);

  console.log("desktop release status tests ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function runStatus(archiveDir, ...extraArgs) {
  return spawnSync(
    process.execPath,
    ["scripts/desktop-release-status.mjs", "--archives", archiveDir, ...extraArgs],
    { cwd: projectRoot, encoding: "utf8" },
  );
}

function writeArchive(archiveDir, archiveBaseName, status) {
  const directory = join(archiveDir, archiveBaseName);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "release-status.json"), `${JSON.stringify(status, null, 2)}\n`);
  const result = spawnSync("tar", ["-C", directory, "-czf", join(archiveDir, `${archiveBaseName}.tar.gz`), "."], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  rmSync(directory, { recursive: true, force: true });
}

function readyStatus(platform) {
  return releaseStatus(platform, {
    package: "passed",
    headless: "passed",
    manifest: "passed",
    performance: "passed",
    service: "passed",
    lifecycle: "passed",
    remote: "passed",
    tray: "passed",
    audit: "passed",
  }, "ready");
}

function releaseStatus(platform, checks, overall = "incomplete") {
  const blockers = Object.entries(checks)
    .filter(([, value]) => value !== "passed")
    .map(([key, value]) => `${key}: ${value}`);
  return {
    schemaVersion: 1,
    serviceOnly: false,
    platform,
    overall,
    platforms: [
      {
        name: platform,
        checks,
        blockers,
      },
    ],
  };
}
