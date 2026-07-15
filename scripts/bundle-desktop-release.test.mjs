import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "agentwatch-desktop-bundle-test-"));
const input = join(root, "input");
const output = join(root, "output");

try {
  mkdirSync(input, { recursive: true });
  writeArtifact("agentwatch-release-macOS", [
    "AgentWatch-macOS.app.zip",
    "agentwatch-server-macOS",
  ]);
  writeArtifact("agentwatch-release-Windows", [
    "AgentWatch_0.2.0_x64-setup.exe",
    "AgentWatch_0.2.0_x64_en-US.msi",
    "agentwatch-server-Windows.exe",
  ]);
  writeArtifact("agentwatch-release-Linux", [
    "AgentWatch_0.2.0_amd64.AppImage",
    "AgentWatch_0.2.0_amd64.deb",
    "AgentWatch-0.2.0-1.x86_64.rpm",
    "agentwatch-server-Linux",
  ]);

  const ok = runBundle(input, output);
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(readdirSync(output).sort(), [
    "agentwatch-desktop-release-Linux.tar.gz",
    "agentwatch-desktop-release-macOS.tar.gz",
    "agentwatch-desktop-release-Windows.tar.gz",
  ].sort());

  const brokenInput = join(root, "broken");
  mkdirSync(brokenInput, { recursive: true });
  writeArtifact("agentwatch-release-Windows", [
    "AgentWatch_0.2.0_x64-setup.exe",
    "agentwatch-server-Windows.exe",
  ], brokenInput);
  const broken = runBundle(brokenInput, join(root, "broken-output"));
  assert.notEqual(broken.status, 0, "missing MSI should fail");
  assert.match(broken.stderr, /Windows MSI installer/);

  console.log("desktop bundle tests ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function writeArtifact(name, platformFiles, base = input) {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  for (const file of [...commonFiles(), ...platformFiles]) {
    writeFileSync(join(dir, file), file);
  }
}

function commonFiles() {
  return [
    "SHA256SUMS.txt",
    "release-verification.md",
    "service-quickstart.md",
    "release-summary.md",
    "release-status.json",
    "release-status.md",
    "release-next-steps.md",
    "remote-verification.md",
    "tray-verification.md",
    "completion-audit.json",
    "completion-audit.md",
    "agentwatch-verify-service.mjs",
    "agentwatch-verify-service-lifecycle.mjs",
    "agentwatch-service-status.mjs",
    "agentwatch-lan-preflight.mjs",
    "agentwatch-verify-remote-client.mjs",
    "agentwatch-import-remote-report.mjs",
    "agentwatch-import-tray-report.mjs",
    "agentwatch-tray-manual-report.mjs",
    "agentwatch-release-audit.mjs",
    "agentwatch-release-readiness.mjs",
    "agentwatch-release-status.mjs",
    "agentwatch-release-next-steps.mjs",
    "agentwatch-refresh-release-evidence.mjs",
    "agentwatch-verify-tray.mjs",
    "agentwatch-verify-tray-config.mjs",
    "verify-service-macos.sh",
    "verify-service-linux.sh",
    "verify-service-windows.cmd",
    "verify-service-windows.ps1",
    "verify-remote-macos.sh",
    "verify-remote-linux.sh",
    "verify-remote-windows.cmd",
    "verify-remote-windows.ps1",
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
}

function runBundle(source, destination) {
  return spawnSync(process.execPath, [
    "scripts/bundle-desktop-release.mjs",
    "--input",
    source,
    "--output",
    destination,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}
