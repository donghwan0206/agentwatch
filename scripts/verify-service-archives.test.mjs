import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "agentwatch-service-archives-test-"));

try {
  const assets = join(root, "release-assets");
  mkdirSync(assets, { recursive: true });
  writeArchive(assets, "agentwatch-service-release-macOS", "agentwatch-server-macOS");
  writeArchive(assets, "agentwatch-service-release-Windows", "agentwatch-server-Windows.exe");
  writeArchive(assets, "agentwatch-service-release-Linux", "agentwatch-server-Linux");

  const valid = run(["scripts/verify-service-archives.mjs", assets]);
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /service archives verified/);

  const partialAssets = join(root, "partial-assets");
  mkdirSync(partialAssets, { recursive: true });
  writeArchive(partialAssets, "agentwatch-service-release-macOS", "agentwatch-server-macOS");
  const partialAllowed = run(["scripts/verify-service-archives.mjs", partialAssets, "--allow-partial"]);
  assert.equal(partialAllowed.status, 0, partialAllowed.stderr);
  const partialRejected = run(["scripts/verify-service-archives.mjs", partialAssets]);
  assert.notEqual(partialRejected.status, 0, "missing platform archives should fail by default");
  assert.match(partialRejected.stderr, /Windows service archive missing/);

  const contaminated = join(root, "contaminated-assets");
  mkdirSync(contaminated, { recursive: true });
  writeArchive(contaminated, "agentwatch-service-release-macOS", "agentwatch-server-macOS", ["tray-verification.md"]);
  const contaminatedResult = run(["scripts/verify-service-archives.mjs", contaminated, "--allow-partial"]);
  assert.notEqual(contaminatedResult.status, 0, "tray files in service archive should fail");
  assert.match(contaminatedResult.stderr, /desktop\/tray files/);

  const wrongServer = join(root, "wrong-server-assets");
  mkdirSync(wrongServer, { recursive: true });
  writeArchive(wrongServer, "agentwatch-service-release-macOS", "agentwatch-server-Windows.exe");
  const wrongServerResult = run(["scripts/verify-service-archives.mjs", wrongServer, "--allow-partial"]);
  assert.notEqual(wrongServerResult.status, 0, "wrong platform server should fail");
  assert.match(wrongServerResult.stderr, /agentwatch-server-macOS/);

  const missingStatus = join(root, "missing-status-assets");
  mkdirSync(missingStatus, { recursive: true });
  writeArchive(missingStatus, "agentwatch-service-release-macOS", "agentwatch-server-macOS", [], ["release-status.json"]);
  const missingStatusResult = run(["scripts/verify-service-archives.mjs", missingStatus, "--allow-partial"]);
  assert.notEqual(missingStatusResult.status, 0, "missing release status should fail");
  assert.match(missingStatusResult.stderr, /release-status\.json/);

  const badChecksum = join(root, "bad-checksum-assets");
  mkdirSync(badChecksum, { recursive: true });
  writeArchive(badChecksum, "agentwatch-service-release-macOS", "agentwatch-server-macOS", {
    corruptAfterChecksum: "release-status.json",
  });
  const badChecksumResult = run(["scripts/verify-service-archives.mjs", badChecksum, "--allow-partial"]);
  assert.notEqual(badChecksumResult.status, 0, "bad internal checksums should fail");
  assert.match(badChecksumResult.stderr, /checksum mismatch/);

  const badScript = join(root, "bad-script-assets");
  mkdirSync(badScript, { recursive: true });
  writeArchive(badScript, "agentwatch-service-release-macOS", "agentwatch-server-macOS", {
    invalidScripts: ["agentwatch-release-status.mjs"],
  });
  const badScriptResult = run(["scripts/verify-service-archives.mjs", badScript, "--allow-partial"]);
  assert.notEqual(badScriptResult.status, 0, "invalid embedded scripts should fail");
  assert.match(badScriptResult.stderr, /embedded script agentwatch-release-status\.mjs failed syntax check/);

  const badShell = join(root, "bad-shell-assets");
  mkdirSync(badShell, { recursive: true });
  writeArchive(badShell, "agentwatch-service-release-macOS", "agentwatch-server-macOS", {
    invalidShellScripts: ["verify-remote-macos.sh"],
  });
  const badShellResult = run(["scripts/verify-service-archives.mjs", badShell, "--allow-partial"]);
  assert.notEqual(badShellResult.status, 0, "invalid embedded shell scripts should fail");
  assert.match(badShellResult.stderr, /embedded shell script verify-remote-macos\.sh failed syntax check/);

  const staleServiceStatus = join(root, "stale-service-status-assets");
  mkdirSync(staleServiceStatus, { recursive: true });
  writeArchive(staleServiceStatus, "agentwatch-service-release-macOS", "agentwatch-server-macOS", {
    staleServiceStatus: true,
  });
  const staleServiceStatusResult = run(["scripts/verify-service-archives.mjs", staleServiceStatus, "--allow-partial"]);
  assert.notEqual(staleServiceStatusResult.status, 0, "service status without startup wait support should fail");
  assert.match(staleServiceStatusResult.stderr, /startup wait support/);

  const badNextSteps = join(root, "bad-next-steps-assets");
  mkdirSync(badNextSteps, { recursive: true });
  writeArchive(badNextSteps, "agentwatch-service-release-macOS", "agentwatch-server-macOS", {
    badNextSteps: true,
  });
  const badNextStepsResult = run(["scripts/verify-service-archives.mjs", badNextSteps, "--allow-partial"]);
  assert.notEqual(badNextStepsResult.status, 0, "service next steps with desktop guidance should fail");
  assert.match(badNextStepsResult.stderr, /desktop guidance/);

  const badStatus = join(root, "bad-status-assets");
  mkdirSync(badStatus, { recursive: true });
  writeArchive(badStatus, "agentwatch-service-release-macOS", "agentwatch-server-macOS", {
    badReleaseStatus: true,
  });
  const badStatusResult = run(["scripts/verify-service-archives.mjs", badStatus, "--allow-partial"]);
  assert.notEqual(badStatusResult.status, 0, "invalid release status should fail");
  assert.match(badStatusResult.stderr, /release-status\.json headless check is missing, expected passed/);

  const incompleteFinal = join(root, "incomplete-final-assets");
  mkdirSync(incompleteFinal, { recursive: true });
  writeArchive(incompleteFinal, "agentwatch-service-release-macOS", "agentwatch-server-macOS");
  const incompleteFinalResult = run(["scripts/verify-service-archives.mjs", incompleteFinal, "--allow-partial", "--require-final"]);
  assert.notEqual(incompleteFinalResult.status, 0, "require-final should reject incomplete service status");
  assert.match(incompleteFinalResult.stderr, /release-status\.json overall is incomplete, expected ready/);

  const readyFinal = join(root, "ready-final-assets");
  mkdirSync(readyFinal, { recursive: true });
  writeArchive(readyFinal, "agentwatch-service-release-macOS", "agentwatch-server-macOS", {
    finalReleaseStatus: true,
  });
  const readyFinalResult = run(["scripts/verify-service-archives.mjs", readyFinal, "--allow-partial", "--require-final"]);
  assert.equal(readyFinalResult.status, 0, readyFinalResult.stderr);

  console.log("service archive verifier tests ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function writeArchive(assetDir, archiveBaseName, serverName, optionsOrExtraFiles = [], omitFiles = []) {
  const options = Array.isArray(optionsOrExtraFiles)
    ? { extraFiles: optionsOrExtraFiles, omitFiles }
    : optionsOrExtraFiles;
  const directory = join(assetDir, archiveBaseName);
  const omitted = new Set(options.omitFiles || []);
  const platformName = platformFromArchiveName(archiveBaseName);
  for (const file of [
    serverName,
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
    ...(options.extraFiles || []),
  ]) {
    if (omitted.has(file)) continue;
    writeFileSync(joinWithParents(directory, file), fileContent(file, { ...options, platformName }));
  }
  writeSha256Sums(directory);
  if ((options.omitFiles || []).includes("SHA256SUMS.txt")) {
    rmSync(join(directory, "SHA256SUMS.txt"), { force: true });
  }
  if (options.corruptAfterChecksum) {
    writeFileSync(join(directory, options.corruptAfterChecksum), "modified after checksums\n");
  }
  const result = spawnSync("tar", ["-C", directory, "-czf", join(assetDir, `${archiveBaseName}.tar.gz`), "."], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  rmSync(directory, { recursive: true, force: true });
}

function writeSha256Sums(directory) {
  const lines = readdirSync(directory)
    .filter((name) => name !== "SHA256SUMS.txt")
    .filter((name) => statSync(join(directory, name)).isFile())
    .sort()
    .map((name) => `${sha256(join(directory, name))}  ${name}`);
  writeFileSync(join(directory, "SHA256SUMS.txt"), `${lines.join("\n")}\n`);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fileContent(file, options) {
  if ((options.invalidScripts || []).includes(file)) {
    return "function {\n";
  }
  if (file.endsWith(".mjs")) {
    if (file === "agentwatch-service-status.mjs") {
      return options.staleServiceStatus
        ? "console.log('service status');\n"
        : "function collectHttpStatusWithRetry() {}\nconsole.log('--wait-ms');\n";
    }
    return `console.log(${JSON.stringify(file)});\n`;
  }
  if ((options.invalidShellScripts || []).includes(file)) {
    return "if then\n";
  }
  if (file.endsWith(".sh")) {
    return `#!/usr/bin/env bash\nset -euo pipefail\necho ${JSON.stringify(file)}\n`;
  }
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
  if (file === "release-next-steps.md") {
    return options.badNextSteps
      ? [
          "# AgentWatch Next Release Steps",
          "",
          `## ${labelForPlatform(options.platformName)}`,
          "",
          "node agentwatch-verify-remote-client.mjs --url http://192.168.50.93:8765 --report remote-client-verification.json",
          "verify-tray-macos.sh",
          "npm run package:desktop-local -- --platform windows",
          "",
        ].join("\n")
      : [
          "# AgentWatch Next Release Steps",
          "",
          `## ${labelForPlatform(options.platformName)}`,
          "",
          "```bash",
          "node agentwatch-verify-remote-client.mjs --url http://192.168.50.93:8765 --report remote-client-verification.json",
          "```",
          "",
        ].join("\n");
  }
  return file;
}

function releaseStatus(platformName, badReleaseStatus = false, finalReleaseStatus = false) {
  const checks = badReleaseStatus
    ? {}
    : {
        package: "skipped",
        headless: "passed",
        manifest: "passed",
        performance: "passed",
        lanPreflight: "passed",
        tray: "skipped",
        ...(finalReleaseStatus
          ? {
              service: "passed",
              lifecycle: "passed",
              remote: "passed",
              audit: "passed",
            }
          : {}),
      };
  return {
    schemaVersion: 1,
    serviceOnly: true,
    platform: platformName,
    overall: finalReleaseStatus ? "ready" : "incomplete",
    platforms: [
      {
        name: platformName,
        checks,
        blockers: finalReleaseStatus ? [] : ["remote: missing", "audit: incomplete"],
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

function labelForPlatform(platformName) {
  return { macos: "macOS", windows: "Windows", linux: "Linux" }[platformName] || platformName;
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
