import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

const root = mkdtempSync(join(tmpdir(), "agentwatch-desktop-archives-test-"));

try {
  const assets = join(root, "desktop-archives");
  mkdirSync(assets, { recursive: true });
  writeArchive(assets, "agentwatch-desktop-release-macOS", ["AgentWatch-macOS.app.zip", "agentwatch-server-macOS"]);
  writeArchive(assets, "agentwatch-desktop-release-Windows", [
    "AgentWatch_0.2.0_x64-setup.exe",
    "AgentWatch_0.2.0_x64_en-US.msi",
    "agentwatch-server-Windows.exe",
  ]);
  writeArchive(assets, "agentwatch-desktop-release-Linux", [
    "AgentWatch_0.2.0_amd64.AppImage",
    "AgentWatch_0.2.0_amd64.deb",
    "AgentWatch-0.2.0-1.x86_64.rpm",
    "agentwatch-server-Linux",
  ]);

  const valid = run(["scripts/verify-desktop-archives.mjs", assets]);
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /desktop archives verified/);

  const partialAssets = join(root, "partial-assets");
  mkdirSync(partialAssets, { recursive: true });
  writeArchive(partialAssets, "agentwatch-desktop-release-macOS", ["AgentWatch-macOS.app.zip", "agentwatch-server-macOS"]);
  const partialAllowed = run(["scripts/verify-desktop-archives.mjs", partialAssets, "--allow-partial"]);
  assert.equal(partialAllowed.status, 0, partialAllowed.stderr);
  const partialRejected = run(["scripts/verify-desktop-archives.mjs", partialAssets]);
  assert.notEqual(partialRejected.status, 0, "missing platform archives should fail by default");
  assert.match(partialRejected.stderr, /Windows desktop archive missing/);

  const missingPackage = join(root, "missing-package-assets");
  mkdirSync(missingPackage, { recursive: true });
  writeArchive(missingPackage, "agentwatch-desktop-release-Windows", [
    "AgentWatch_0.2.0_x64-setup.exe",
    "agentwatch-server-Windows.exe",
  ]);
  const missingPackageResult = run(["scripts/verify-desktop-archives.mjs", missingPackage, "--allow-partial"]);
  assert.notEqual(missingPackageResult.status, 0, "missing MSI should fail");
  assert.match(missingPackageResult.stderr, /Windows MSI installer/);

  const badChecksum = join(root, "bad-checksum-assets");
  mkdirSync(badChecksum, { recursive: true });
  writeArchive(badChecksum, "agentwatch-desktop-release-macOS", ["AgentWatch-macOS.app.zip", "agentwatch-server-macOS"], {
    corruptAfterChecksum: "release-status.json",
  });
  const badChecksumResult = run(["scripts/verify-desktop-archives.mjs", badChecksum, "--allow-partial"]);
  assert.notEqual(badChecksumResult.status, 0, "bad internal checksum should fail");
  assert.match(badChecksumResult.stderr, /checksum mismatch/);

  const badNestedChecksum = join(root, "bad-nested-checksum-assets");
  mkdirSync(badNestedChecksum, { recursive: true });
  writeArchive(badNestedChecksum, "agentwatch-desktop-release-macOS", [
    "AgentWatch-macOS.app.zip",
    "agentwatch-server-macOS",
    "screenshots/macos-menu-bar.png",
  ], {
    corruptAfterChecksum: "screenshots/macos-menu-bar.png",
  });
  const badNestedChecksumResult = run(["scripts/verify-desktop-archives.mjs", badNestedChecksum, "--allow-partial"]);
  assert.notEqual(badNestedChecksumResult.status, 0, "bad nested checksum should fail");
  assert.match(badNestedChecksumResult.stderr, /checksum mismatch for screenshots\/macos-menu-bar\.png/);

  const wrongServer = join(root, "wrong-server-assets");
  mkdirSync(wrongServer, { recursive: true });
  writeArchive(wrongServer, "agentwatch-desktop-release-macOS", [
    "AgentWatch-macOS.app.zip",
    "agentwatch-server-macOS",
    "agentwatch-server-Windows.exe",
  ]);
  const wrongServerResult = run(["scripts/verify-desktop-archives.mjs", wrongServer, "--allow-partial"]);
  assert.notEqual(wrongServerResult.status, 0, "other platform server should fail");
  assert.match(wrongServerResult.stderr, /other platform servers/);

  const badStatus = join(root, "bad-status-assets");
  mkdirSync(badStatus, { recursive: true });
  writeArchive(badStatus, "agentwatch-desktop-release-macOS", ["AgentWatch-macOS.app.zip", "agentwatch-server-macOS"], {
    badReleaseStatus: true,
  });
  const badStatusResult = run(["scripts/verify-desktop-archives.mjs", badStatus, "--allow-partial"]);
  assert.notEqual(badStatusResult.status, 0, "invalid release status should fail");
  assert.match(badStatusResult.stderr, /release-status\.json package check is missing, expected passed/);

  const incompleteFinal = join(root, "incomplete-final-assets");
  mkdirSync(incompleteFinal, { recursive: true });
  writeArchive(incompleteFinal, "agentwatch-desktop-release-macOS", ["AgentWatch-macOS.app.zip", "agentwatch-server-macOS"]);
  const incompleteFinalResult = run(["scripts/verify-desktop-archives.mjs", incompleteFinal, "--allow-partial", "--require-final"]);
  assert.notEqual(incompleteFinalResult.status, 0, "require-final should reject incomplete release status");
  assert.match(incompleteFinalResult.stderr, /release-status\.json overall is incomplete, expected ready/);

  const readyFinal = join(root, "ready-final-assets");
  mkdirSync(readyFinal, { recursive: true });
  writeArchive(readyFinal, "agentwatch-desktop-release-macOS", ["AgentWatch-macOS.app.zip", "agentwatch-server-macOS"], {
    finalReleaseStatus: true,
  });
  const readyFinalResult = run(["scripts/verify-desktop-archives.mjs", readyFinal, "--allow-partial", "--require-final"]);
  assert.equal(readyFinalResult.status, 0, readyFinalResult.stderr);

  console.log("desktop archive verifier tests ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function writeArchive(assetDir, archiveBaseName, platformFiles, options = {}) {
  const directory = join(assetDir, archiveBaseName);
  const platformName = platformFromArchiveName(archiveBaseName);
  for (const file of [...commonFiles(), ...platformFiles]) {
    writeFileSync(joinWithParents(directory, file), fileContent(file, { ...options, platformName }));
  }
  writeSha256Sums(directory);
  if (options.corruptAfterChecksum) {
    writeFileSync(join(directory, options.corruptAfterChecksum), "modified after checksums\n");
  }
  const result = spawnSync("tar", ["-C", directory, "-czf", join(assetDir, `${archiveBaseName}.tar.gz`), "."], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  rmSync(directory, { recursive: true, force: true });
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
    "agentwatch-service-status.mjs",
    "agentwatch-lan-preflight.mjs",
    "agentwatch-verify-service.mjs",
    "agentwatch-verify-service-lifecycle.mjs",
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

function writeSha256Sums(directory) {
  const lines = collectFilesRecursive(directory)
    .filter((name) => name !== "SHA256SUMS.txt")
    .sort()
    .map((name) => `${sha256(join(directory, name))}  ${name}`);
  writeFileSync(join(directory, "SHA256SUMS.txt"), `${lines.join("\n")}\n`);
}

function collectFilesRecursive(directory, base = directory) {
  const files = [];
  for (const name of readdirSync(directory).sort((left, right) => left.localeCompare(right))) {
    const path = join(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...collectFilesRecursive(path, base));
    } else if (stat.isFile()) {
      files.push(relative(base, path).replace(/\\/g, "/"));
    }
  }
  return files;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fileContent(file, options = {}) {
  if (file.endsWith(".mjs")) return `console.log(${JSON.stringify(file)});\n`;
  if (file.endsWith(".sh")) return `#!/usr/bin/env bash\nset -euo pipefail\necho ${JSON.stringify(file)}\n`;
  if (file.endsWith(".cmd")) {
    return `@echo off\r\nsetlocal\r\npowershell -ExecutionPolicy Bypass -File "%~dp0${file.replace(/\.cmd$/i, ".ps1")}" %*\r\n`;
  }
  if (file === "release-status.json") {
    return JSON.stringify(
      releaseStatus(options.platformName, options.badReleaseStatus, options.finalReleaseStatus),
      null,
      2,
    );
  }
  return file;
}

function releaseStatus(platformName, badReleaseStatus = false, finalReleaseStatus = false) {
  const checks = badReleaseStatus
    ? {}
    : {
        package: "passed",
        headless: "passed",
        manifest: "passed",
        performance: "passed",
        lanPreflight: "passed",
        ...(finalReleaseStatus
          ? {
              service: "passed",
              lifecycle: "passed",
              remote: "passed",
              tray: "passed",
              audit: "passed",
            }
          : {}),
      };
  return {
    schemaVersion: 1,
    serviceOnly: false,
    platform: platformName,
    overall: finalReleaseStatus ? "ready" : "incomplete",
    platforms: [
      {
        name: platformName,
        checks,
        blockers: finalReleaseStatus ? [] : ["remote: missing", "tray: missing", "audit: incomplete"],
      },
    ],
  };
}

function platformFromArchiveName(name) {
  const lower = name.toLowerCase();
  if (lower.includes("macos")) return "macos";
  if (lower.includes("windows")) return "windows";
  if (lower.includes("linux")) return "linux";
  throw new Error(`unknown archive platform: ${name}`);
}

function joinWithParents(directory, file) {
  const path = join(directory, file);
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

function run(args) {
  return spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}
