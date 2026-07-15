#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const assetDir = resolve(getOptionValue("--assets") || args.find((arg) => !arg.startsWith("--")) || "desktop-archives");
const requireAllPlatforms = !args.includes("--allow-partial");
const requireFinal = args.includes("--require-final");

if (!existsSync(assetDir) || !statSync(assetDir).isDirectory()) {
  throw new Error(`Desktop archive directory missing: ${assetDir}`);
}

const platforms = [
  {
    name: "macos",
    label: "macOS",
    archive: "agentwatch-desktop-release-macOS.tar.gz",
    server: "agentwatch-server-macOS",
    assets: [
      { label: "macOS app zip", matches: (file) => file === "AgentWatch-macOS.app.zip" },
    ],
  },
  {
    name: "windows",
    label: "Windows",
    archive: "agentwatch-desktop-release-Windows.tar.gz",
    server: "agentwatch-server-Windows.exe",
    assets: [
      {
        label: "Windows NSIS installer",
        matches: (file) => !file.startsWith("agentwatch-server-") && file.toLowerCase().endsWith(".exe"),
      },
      { label: "Windows MSI installer", matches: (file) => file.toLowerCase().endsWith(".msi") },
    ],
  },
  {
    name: "linux",
    label: "Linux",
    archive: "agentwatch-desktop-release-Linux.tar.gz",
    server: "agentwatch-server-Linux",
    assets: [
      { label: "Linux AppImage", matches: (file) => file.endsWith(".AppImage") },
      { label: "Linux deb", matches: (file) => file.endsWith(".deb") },
      { label: "Linux rpm", matches: (file) => file.endsWith(".rpm") },
    ],
  },
];

const archives = new Set(readdirSync(assetDir).filter((name) => name.endsWith(".tar.gz")));

for (const platform of platforms) {
  if (!archives.has(platform.archive)) {
    if (requireAllPlatforms) {
      throw new Error(`${platform.label} desktop archive missing: ${platform.archive}`);
    }
    continue;
  }
  verifyArchive(platform);
}

const expectedArchives = new Set(platforms.map((platform) => platform.archive));
for (const archive of archives) {
  if (!expectedArchives.has(archive)) {
    throw new Error(`Unexpected desktop archive: ${archive}`);
  }
}

console.log(`desktop archives verified: ${assetDir}`);

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

  for (const file of required) {
    if (!entrySet.has(file)) {
      throw new Error(`${platform.archive} is missing ${file}`);
    }
  }

  for (const rule of platform.assets) {
    const matches = entries.filter(rule.matches);
    if (matches.length === 0) {
      throw new Error(`${platform.archive} is missing ${rule.label}`);
    }
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
  const directory = mkdtempSync(join(tmpdir(), "agentwatch-desktop-archive-"));
  try {
    const result = spawnSync("tar", ["-xzf", archivePath, "-C", directory], { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`tar extraction failed for ${archiveName}: ${result.stderr || result.stdout || `exit ${result.status}`}`);
    }

    const files = collectFilesRecursive(directory).sort();
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

function verifyEmbeddedReleaseStatus(directory, archiveName, platform) {
  const statusPath = join(directory, "release-status.json");
  let status;
  try {
    status = JSON.parse(readFileSync(statusPath, "utf8"));
  } catch (error) {
    throw new Error(`${archiveName} release-status.json is invalid JSON: ${error.message}`);
  }
  if (status.serviceOnly !== false) {
    throw new Error(`${archiveName} release-status.json is not a desktop status report`);
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
  for (const check of ["package", "headless", "manifest", "performance", "lanPreflight"]) {
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
    for (const check of ["service", "lifecycle", "remote", "tray", "audit"]) {
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
    if (
      file.startsWith("/") ||
      file.startsWith("\\") ||
      file.includes("\\") ||
      file.split("/").includes("..") ||
      file.split("/").includes("")
    ) {
      throw new Error(`${archiveName} checksum path is invalid: ${file}`);
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

function normalizeEntry(entry) {
  return entry.replace(/^\.\//, "").replace(/\/$/, "");
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
