#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const args = process.argv.slice(2);
const archiveDir = resolve(getOptionValue("--archives") || positionalArgs()[0] || "desktop-archives");
const jsonOutput = args.includes("--json");
const check = args.includes("--check");
const outputPath = getOptionValue("--output");
const platformFilter = getOptionValue("--platform");

const platforms = [
  { name: "macos", label: "macOS", archive: "agentwatch-desktop-release-macOS.tar.gz" },
  { name: "windows", label: "Windows", archive: "agentwatch-desktop-release-Windows.tar.gz" },
  { name: "linux", label: "Linux", archive: "agentwatch-desktop-release-Linux.tar.gz" },
];

const selectedPlatforms = platformFilter
  ? platforms.filter((platform) => platform.name === normalizePlatformName(platformFilter))
  : platforms;

if (platformFilter && selectedPlatforms.length === 0) {
  throw new Error(`Unsupported platform filter: ${platformFilter}`);
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  archiveDir,
  platform: platformFilter ? normalizePlatformName(platformFilter) : "all",
  platforms: selectedPlatforms.map(platformArchiveStatus),
  unexpectedArchives: unexpectedArchives(),
};
report.overall = report.platforms.every((platform) => platform.blockers.length === 0) &&
  report.unexpectedArchives.length === 0
  ? "ready"
  : "incomplete";

const rendered = jsonOutput ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report);
if (outputPath) writeFileSync(resolve(outputPath), rendered);
process.stdout.write(rendered);

if (check && report.overall !== "ready") {
  process.exitCode = 1;
}

function platformArchiveStatus(platform) {
  const archivePath = join(archiveDir, platform.archive);
  if (!existsSync(archivePath)) {
    return {
      name: platform.name,
      label: platform.label,
      archive: platform.archive,
      archiveStatus: "missing",
      releaseOverall: "missing",
      checks: {},
      blockers: [`archive missing: ${platform.archive}`],
      nextAction: "Run the manual desktop package workflow for this platform.",
    };
  }
  if (!statSync(archivePath).isFile()) {
    return {
      name: platform.name,
      label: platform.label,
      archive: platform.archive,
      archiveStatus: "invalid",
      releaseOverall: "invalid",
      checks: {},
      blockers: [`archive path is not a file: ${platform.archive}`],
      nextAction: "Replace the archive with a valid desktop release tarball.",
    };
  }

  const status = readArchiveReleaseStatus(archivePath);
  if (status.error) {
    return {
      name: platform.name,
      label: platform.label,
      archive: platform.archive,
      archiveStatus: "invalid",
      releaseOverall: "invalid",
      checks: {},
      blockers: [status.error],
      nextAction: "Rebuild the desktop release archive with release-status.json included.",
    };
  }

  const statusData = status.data;
  const platformStatus = Array.isArray(statusData.platforms)
    ? statusData.platforms.find((entry) => entry?.name === platform.name)
    : null;
  const blockers = [];
  if (statusData.serviceOnly !== false) {
    blockers.push("release-status.json is not a desktop status report");
  }
  if (statusData.platform !== platform.name) {
    blockers.push(`release-status.json platform is ${statusData.platform || "missing"}, expected ${platform.name}`);
  }
  if (!platformStatus) {
    blockers.push(`${platform.name} platform status missing`);
  }
  const checks = platformStatus?.checks || {};
  for (const checkName of ["package", "headless", "manifest", "performance", "service", "lifecycle", "remote", "tray", "audit"]) {
    if (checks[checkName] !== "passed") {
      blockers.push(`${checkName}: ${checks[checkName] || "missing"}`);
    }
  }
  if (statusData.overall !== "ready") {
    blockers.push(`overall: ${statusData.overall || "missing"}`);
  }
  if (Array.isArray(platformStatus?.blockers)) {
    for (const blocker of platformStatus.blockers) {
      if (!blockers.includes(blocker)) blockers.push(blocker);
    }
  }

  return {
    name: platform.name,
    label: platform.label,
    archive: platform.archive,
    archiveStatus: "present",
    releaseOverall: statusData.overall || "missing",
    checks,
    blockers,
    nextAction: blockers.length === 0 ? "none" : nextAction(checks),
  };
}

function readArchiveReleaseStatus(archivePath) {
  for (const member of ["./release-status.json", "release-status.json"]) {
    const result = spawnSync("tar", ["-xOf", archivePath, member], { encoding: "utf8" });
    if (result.status !== 0) continue;
    try {
      return { data: JSON.parse(result.stdout) };
    } catch (error) {
      return { error: `${basename(archivePath)} release-status.json is invalid JSON: ${error.message}` };
    }
  }
  return { error: `${basename(archivePath)} is missing release-status.json` };
}

function nextAction(checks) {
  if (checks.package !== "passed") return "Build the native desktop package for this platform.";
  if (checks.service !== "passed" || checks.lifecycle !== "passed") {
    return "Run service install/lifecycle verification on this platform.";
  }
  if (checks.tray !== "passed") return "Import a passed tray/menu-bar verification report.";
  if (checks.remote !== "passed") return "Import a real second-device LAN browser verification report.";
  if (checks.audit !== "passed") return "Refresh release evidence after importing missing reports.";
  return "Refresh release evidence and rerun desktop archive status.";
}

function renderMarkdown(payload) {
  const lines = [
    "# AgentWatch Desktop Release Status",
    "",
    `Generated: ${payload.generatedAt}`,
    `Archive dir: ${payload.archiveDir}`,
    `Overall: ${payload.overall}`,
    "",
    "| Platform | Archive | Overall | Package | Headless | Manifest | Performance | Service | Lifecycle | Remote | Tray | Audit | Next |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const platform of payload.platforms) {
    const checks = platform.checks || {};
    lines.push([
      platform.label,
      platform.archiveStatus,
      platform.releaseOverall,
      checks.package || "missing",
      checks.headless || "missing",
      checks.manifest || "missing",
      checks.performance || "missing",
      checks.service || "missing",
      checks.lifecycle || "missing",
      checks.remote || "missing",
      checks.tray || "missing",
      checks.audit || "missing",
      platform.nextAction,
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  lines.push("", "## Blockers", "");
  for (const platform of payload.platforms) {
    lines.push(`- ${platform.label}: ${platform.blockers.length ? platform.blockers.join(", ") : "none"}`);
  }
  if (payload.unexpectedArchives.length > 0) {
    lines.push("", "## Unexpected Archives", "");
    for (const archive of payload.unexpectedArchives) lines.push(`- ${archive}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function unexpectedArchives() {
  if (!existsSync(archiveDir) || !statSync(archiveDir).isDirectory()) {
    return [`archive directory missing: ${archiveDir}`];
  }
  const expected = new Set(platforms.map((platform) => platform.archive));
  return readdirSync(archiveDir)
    .filter((name) => name.endsWith(".tar.gz") && !expected.has(name))
    .sort((left, right) => left.localeCompare(right));
}

function positionalArgs() {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--archives" || arg === "--output" || arg === "--platform") {
      index += 1;
      continue;
    }
    if (!arg.startsWith("--")) values.push(arg);
  }
  return values;
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

function normalizePlatformName(value) {
  const lower = String(value || "").toLowerCase();
  if (lower.includes("mac") || lower === "darwin") return "macos";
  if (lower.includes("win")) return "windows";
  if (lower.includes("linux")) return "linux";
  return lower;
}
