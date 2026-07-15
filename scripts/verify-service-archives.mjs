#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const args = process.argv.slice(2);
const assetDir = resolve(getOptionValue("--assets") || args.find((arg) => !arg.startsWith("--")) || "release-assets");
const requireAllPlatforms = !args.includes("--allow-partial");
const requireFinal = args.includes("--require-final");

if (!existsSync(assetDir) || !statSync(assetDir).isDirectory()) {
  throw new Error(`Release asset directory missing: ${assetDir}`);
}

const platforms = [
  { name: "macos", label: "macOS", archive: "agentwatch-service-release-macOS.tar.gz", server: "agentwatch-server-macOS" },
  { name: "windows", label: "Windows", archive: "agentwatch-service-release-Windows.tar.gz", server: "agentwatch-server-Windows.exe" },
  { name: "linux", label: "Linux", archive: "agentwatch-service-release-Linux.tar.gz", server: "agentwatch-server-Linux" },
];

const archives = new Set(readdirSync(assetDir).filter((name) => name.endsWith(".tar.gz")));

for (const platform of platforms) {
  if (!archives.has(platform.archive)) {
    if (requireAllPlatforms) {
      throw new Error(`${platform.label} service archive missing: ${platform.archive}`);
    }
    continue;
  }
  verifyArchive(platform);
}

const expectedArchives = new Set(platforms.map((platform) => platform.archive));
for (const archive of archives) {
  if (!expectedArchives.has(archive)) {
    throw new Error(`Unexpected service archive: ${archive}`);
  }
}

console.log(`service archives verified: ${assetDir}`);

function verifyArchive(platform) {
  const archivePath = join(assetDir, platform.archive);
  const entries = tarList(archivePath).map(normalizeEntry).filter(Boolean);
  const entrySet = new Set(entries);
  const required = [
    platform.server,
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
  ];

  for (const file of required) {
    if (!entrySet.has(file)) {
      throw new Error(`${platform.archive} is missing ${file}`);
    }
  }

  const forbidden = entries.filter(isForbiddenDesktopEntry);
  if (forbidden.length > 0) {
    throw new Error(`${platform.archive} contains desktop/tray files: ${forbidden.join(", ")}`);
  }

  const otherPlatformServers = platforms
    .filter((candidate) => candidate.name !== platform.name)
    .map((candidate) => candidate.server)
    .filter((server) => entrySet.has(server));
  if (otherPlatformServers.length > 0) {
    throw new Error(`${platform.archive} contains other platform servers: ${otherPlatformServers.join(", ")}`);
  }

  verifyInternalChecksums(archivePath, platform.archive, platform);
}

function tarList(archivePath) {
  const result = spawnSync("tar", ["-tzf", archivePath], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`tar listing failed for ${basename(archivePath)}: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  return result.stdout.split(/\r?\n/);
}

function verifyInternalChecksums(archivePath, archiveName, platform) {
  const directory = mkdtempSync(join(tmpdir(), "agentwatch-service-archive-"));
  try {
    const result = spawnSync("tar", ["-xzf", archivePath, "-C", directory], { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`tar extraction failed for ${archiveName}: ${result.stderr || result.stdout || `exit ${result.status}`}`);
    }

    const files = readdirSync(directory).filter((name) => statSync(join(directory, name)).isFile()).sort();
    const sumsPath = join(directory, "SHA256SUMS.txt");
    if (!files.includes("SHA256SUMS.txt")) {
      throw new Error(`${archiveName} is missing SHA256SUMS.txt`);
    }
    const entries = parseSha256Sums(readFileSync(sumsPath, "utf8"), archiveName);
    for (const file of files.filter((name) => name !== "SHA256SUMS.txt")) {
      if (!entries.has(file)) {
        throw new Error(`${archiveName} checksum missing for ${file}`);
      }
      const actual = sha256(join(directory, file));
      if (entries.get(file) !== actual) {
        throw new Error(`${archiveName} checksum mismatch for ${file}`);
      }
    }
    for (const file of entries.keys()) {
      if (!files.includes(file)) {
        throw new Error(`${archiveName} checksum lists missing file ${file}`);
      }
    }
    verifyEmbeddedNodeScripts(directory, archiveName);
    verifyEmbeddedShellScripts(directory, archiveName);
    verifyEmbeddedWindowsWrappers(directory, archiveName);
    verifyEmbeddedServiceStatus(directory, archiveName);
    verifyEmbeddedNextSteps(directory, archiveName, platform);
    verifyEmbeddedReleaseStatus(directory, archiveName, platform);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function verifyEmbeddedNodeScripts(directory, archiveName) {
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".mjs")).sort()) {
    const result = spawnSync(process.execPath, ["--check", join(directory, file)], { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`${archiveName} embedded script ${file} failed syntax check: ${result.stderr || result.stdout || `exit ${result.status}`}`);
    }
  }
}

function verifyEmbeddedShellScripts(directory, archiveName) {
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sh")).sort()) {
    const result = spawnSync("bash", ["-n", join(directory, file)], { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`${archiveName} embedded shell script ${file} failed syntax check: ${result.stderr || result.stdout || `exit ${result.status}`}`);
    }
  }
}

function verifyEmbeddedWindowsWrappers(directory, archiveName) {
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".cmd")).sort()) {
    const content = readFileSync(join(directory, file), "utf8");
    if (!/^@echo off/i.test(content.trimStart()) || !/powershell/i.test(content) || !/%\*/.test(content)) {
      throw new Error(`${archiveName} embedded cmd wrapper ${file} is missing the expected launcher shape`);
    }
  }

  const powerShell = powerShellExecutable();
  if (!powerShell) return;
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".ps1")).sort()) {
    const path = join(directory, file);
    const command = `$null = [scriptblock]::Create((Get-Content -Raw ${quotePowerShellString(path)}))`;
    const result = spawnSync(powerShell, ["-NoProfile", "-Command", command], { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`${archiveName} embedded PowerShell script ${file} failed syntax check: ${result.stderr || result.stdout || `exit ${result.status}`}`);
    }
  }
}

function verifyEmbeddedServiceStatus(directory, archiveName) {
  const file = "agentwatch-service-status.mjs";
  const content = readFileSync(join(directory, file), "utf8");
  if (!content.includes("--wait-ms") || !content.includes("collectHttpStatusWithRetry")) {
    throw new Error(`${archiveName} embedded ${file} is missing startup wait support`);
  }
}

function verifyEmbeddedNextSteps(directory, archiveName, platform) {
  const content = readFileSync(join(directory, "release-next-steps.md"), "utf8");
  if (!content.includes("AgentWatch Next Release Steps")) {
    throw new Error(`${archiveName} release-next-steps.md is missing the AgentWatch heading`);
  }
  if (!content.includes(`## ${platform.label}`)) {
    throw new Error(`${archiveName} release-next-steps.md is missing ${platform.label} next steps`);
  }
  if (!content.includes("agentwatch-verify-remote-client.mjs")) {
    throw new Error(`${archiveName} release-next-steps.md is missing remote verification guidance`);
  }
  if (
    content.includes("verify-tray") ||
    content.includes("tray-verification") ||
    content.includes("desktop archive") ||
    content.includes("package:desktop-local")
  ) {
    throw new Error(`${archiveName} service release next steps include desktop guidance`);
  }
}

function verifyEmbeddedReleaseStatus(directory, archiveName, platform) {
  const statusPath = join(directory, "release-status.json");
  let status;
  try {
    status = JSON.parse(readFileSync(statusPath, "utf8"));
  } catch (error) {
    throw new Error(`${archiveName} release-status.json is invalid JSON: ${error.message}`);
  }
  if (status.serviceOnly !== true) {
    throw new Error(`${archiveName} release-status.json is not a service-only status report`);
  }
  if (status.platform !== platform.name) {
    throw new Error(`${archiveName} release-status.json platform is ${status.platform || "missing"}, expected ${platform.name}`);
  }
  const platformStatus = Array.isArray(status.platforms)
    ? status.platforms.find((entry) => entry?.name === platform.name)
    : null;
  if (!platformStatus) {
    throw new Error(`${archiveName} release-status.json is missing ${platform.name} platform status`);
  }
  const checks = platformStatus.checks || {};
  for (const check of ["headless", "manifest", "performance", "lanPreflight"]) {
    if (checks[check] !== "passed") {
      throw new Error(`${archiveName} release-status.json ${check} check is ${checks[check] || "missing"}, expected passed`);
    }
  }
  if (requireFinal) {
    if (status.overall !== "ready") {
      throw new Error(`${archiveName} release-status.json overall is ${status.overall || "missing"}, expected ready`);
    }
    if (Array.isArray(platformStatus.blockers) && platformStatus.blockers.length > 0) {
      throw new Error(`${archiveName} release-status.json has blockers: ${platformStatus.blockers.join(", ")}`);
    }
    for (const check of ["service", "lifecycle", "remote", "audit"]) {
      if (checks[check] !== "passed") {
        throw new Error(`${archiveName} release-status.json ${check} check is ${checks[check] || "missing"}, expected passed`);
      }
    }
  }
}

function powerShellExecutable() {
  if (process.env.AGENTWATCH_POWERSHELL) return process.env.AGENTWATCH_POWERSHELL;
  for (const command of ["pwsh", "powershell"]) {
    const result = spawnSync(command, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], { encoding: "utf8" });
    if (result.status === 0) return command;
  }
  return null;
}

function quotePowerShellString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function parseSha256Sums(content, archiveName) {
  const entries = new Map();
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const match = line.match(/^([a-f0-9]{64}) [ *](.+)$/);
    if (!match) {
      throw new Error(`${archiveName} checksum line ${index + 1} is malformed`);
    }
    const [, hash, file] = match;
    if (file.includes("/") || file.includes("\\")) {
      throw new Error(`${archiveName} checksum path must be top-level: ${file}`);
    }
    if (entries.has(file)) {
      throw new Error(`${archiveName} checksum lists ${file} more than once`);
    }
    entries.set(file, hash);
  }
  return entries;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function normalizeEntry(entry) {
  return entry.replace(/^\.\//, "").replace(/\/$/, "");
}

function isForbiddenDesktopEntry(entry) {
  const lower = entry.toLowerCase();
  return (
    lower === "tray-verification.md" ||
    lower.includes("verify-tray") ||
    lower.includes("tray-verification") ||
    lower.includes("tray-config-verification") ||
    lower.endsWith(".app") ||
    lower.endsWith(".appimage") ||
    lower.endsWith(".dmg") ||
    lower.endsWith(".msi") ||
    lower.endsWith(".deb") ||
    lower.endsWith(".rpm") ||
    /^agentwatch.*setup.*\.exe$/i.test(entry) ||
    /^agentwatch.*\.app\.zip$/i.test(entry)
  );
}

function getOptionValue(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}
