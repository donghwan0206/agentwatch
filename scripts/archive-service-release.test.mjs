import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "agentwatch-archive-service-test-"));

try {
  const assets = join(root, "agentwatch-service-release-macOS");
  writeServiceAssets(assets);

  const archive = join(root, "agentwatch-service-release-macOS.tar.gz");
  const created = run([
    "scripts/archive-service-release.mjs",
    "--input",
    assets,
    "--output",
    archive,
  ]);
  assert.equal(created.status, 0, created.stderr);
  assert.match(created.stdout, /service release archive:/);
  assert.equal(existsSync(archive), true);

  const listing = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" });
  assert.equal(listing.status, 0, listing.stderr);
  assert.match(listing.stdout, /agentwatch-server-macOS/);
  assert.match(listing.stdout, /agentwatch-service-status\.mjs/);
  assert.match(listing.stdout, /agentwatch-lan-preflight\.mjs/);
  assert.match(listing.stdout, /service-quickstart\.md/);
  assert.match(listing.stdout, /release-next-steps\.md/);
  assert.match(listing.stdout, /agentwatch-release-next-steps\.mjs/);
  assert.match(listing.stdout, /remote-verification\.md/);

  rmSync(join(assets, "release-next-steps.md"));
  const rejected = run([
    "scripts/archive-service-release.mjs",
    "--input",
    assets,
    "--output",
    join(root, "broken.tar.gz"),
  ]);
  assert.notEqual(rejected.status, 0, "incomplete service release should fail");
  assert.match(rejected.stderr, /release-next-steps\.md/);

  console.log("archive service release tests ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function writeServiceAssets(targetDir) {
  for (const file of [
    "agentwatch-server-macOS",
    "SHA256SUMS.txt",
    "release-verification.md",
    "service-quickstart.md",
    "release-summary.md",
    "release-status.json",
    "release-status.md",
    "release-next-steps.md",
    "remote-verification.md",
    "completion-audit.json",
    "completion-audit.md",
    "agentwatch-service-status.mjs",
    "agentwatch-lan-preflight.mjs",
    "agentwatch-verify-service.mjs",
    "agentwatch-verify-service-lifecycle.mjs",
    "agentwatch-verify-remote-client.mjs",
    "agentwatch-import-remote-report.mjs",
    "agentwatch-release-audit.mjs",
    "agentwatch-release-readiness.mjs",
    "agentwatch-release-status.mjs",
    "agentwatch-release-next-steps.mjs",
    "agentwatch-refresh-release-evidence.mjs",
    "agentwatch-release-manifest-macos.json",
    "verify-service-macos.sh",
    "verify-service-linux.sh",
    "verify-service-windows.cmd",
    "verify-service-windows.ps1",
    "verify-remote-macos.sh",
    "verify-remote-linux.sh",
    "verify-remote-windows.cmd",
    "verify-remote-windows.ps1",
    "install-service-macos.sh",
    "uninstall-service-macos.sh",
    "install-service-linux.sh",
    "uninstall-service-linux.sh",
    "install-service-windows.ps1",
    "uninstall-service-windows.ps1",
  ]) {
    write(join(targetDir, file), file);
  }
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function run(args) {
  return spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}
