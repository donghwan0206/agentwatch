#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const assetDir = resolve(getOptionValue("--assets") || positionalArgs()[0] || "release-assets");
const archiveDir = resolve(getOptionValue("--archives") || "desktop-archives");
const outputPath = getOptionValue("--output");
const jsonOutput = args.includes("--json");
const serviceOnly = args.includes("--service-only");
const platformFilter = getOptionValue("--platform");

const status = readJsonIfExists(join(assetDir, "release-status.json"));
const desktopStatus = readJsonIfExists(join(archiveDir, "desktop-release-status.json"));
const releaseIsServiceOnly = Boolean(status?.serviceOnly ?? serviceOnly);
const platforms = selectedPlatforms(status, desktopStatus, releaseIsServiceOnly);
const payload = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  assetDir,
  archiveDir,
  serviceOnly: releaseIsServiceOnly,
  platforms: platforms.map(nextStepsForPlatform),
};
payload.overall = payload.platforms.every((platform) => platform.steps.length === 0) ? "ready" : "incomplete";

const rendered = jsonOutput ? `${JSON.stringify(payload, null, 2)}\n` : renderMarkdown(payload);
if (outputPath) writeFileSync(resolve(outputPath), rendered);
process.stdout.write(rendered);

function selectedPlatforms(releaseStatus, archiveStatus, releaseServiceOnly) {
  const fromRelease = Array.isArray(releaseStatus?.platforms)
    ? releaseStatus.platforms.map((platform) => platform.name).filter(Boolean)
    : [];
  const fromArchives = !releaseServiceOnly && Array.isArray(archiveStatus?.platforms)
    ? archiveStatus.platforms.map((platform) => platform.name).filter(Boolean)
    : [];
  const names = [...new Set(fromRelease.concat(fromArchives))];
  const filtered = platformFilter ? names.filter((name) => name === normalizePlatformName(platformFilter)) : names;
  if (platformFilter && filtered.length === 0) {
    throw new Error(`Unsupported or unavailable platform filter: ${platformFilter}`);
  }
  return filtered.length > 0 ? filtered : ["macos", "windows", "linux"];
}

function nextStepsForPlatform(platformName) {
  const releasePlatform = status?.platforms?.find((platform) => platform.name === platformName) || null;
  const desktopPlatform = desktopStatus?.platforms?.find((platform) => platform.name === platformName) || null;
  const checks = releasePlatform?.checks || desktopPlatform?.checks || {};
  const steps = [];

  if (desktopPlatform?.archiveStatus === "missing") {
    steps.push({
      id: "build-desktop-archive",
      title: `Build ${labelFor(platformName)} desktop archive on ${labelFor(platformName)}`,
      commands: desktopBuildCommands(platformName),
    });
    if (!releasePlatform) {
      return {
        name: platformName,
        label: labelFor(platformName),
        checks,
        blockers: desktopPlatform?.blockers || [],
        steps,
      };
    }
  }

  if (checks.service && checks.service !== "passed") {
    steps.push({
      id: "verify-service",
      title: `Run ${labelFor(platformName)} service verification`,
      commands: [
        `node agentwatch-verify-service-lifecycle.mjs --yes --report service-lifecycle-${platformName}.json`,
        `node agentwatch-verify-service.mjs --report service-verification-${platformName}.json --lifecycle-report service-lifecycle-${platformName}.json --manual-result passed --manual-notes "Verified service startup, LAN health, login/startup behavior, and clean uninstall/reinstall on ${labelFor(platformName)}."`,
        refreshCommand(platformName),
      ],
    });
  }

  if (checks.remote !== "passed") {
    const report = `remote-client-verification-${platformName}.json`;
    const url = remoteUrlFor(platformName);
    steps.push({
      id: "verify-remote-browser",
      title: `Verify browser UI from a second LAN device for ${labelFor(platformName)}`,
      commands: [
        `node agentwatch-verify-remote-client.mjs --url ${url} --report ${report}`,
        importRemoteCommand(`/path/to/${report}`, platformName),
        refreshCommand(platformName),
      ],
      browser: [
        `Open ${url} from a different LAN device.`,
        "Confirm the Remote Verify panel says remote.",
        `Download 검증 JSON as ${report}.`,
      ],
    });
  }

  if (!payloadServiceOnly() && checks.tray !== "passed") {
    const screenshotName = screenshotNameFor(platformName);
    const report = `tray-verification-${platformName}.json`;
    steps.push({
      id: "verify-tray",
      title: `Record passed tray/menu-bar evidence for ${labelFor(platformName)}`,
      commands: trayCommands(platformName, report, screenshotName),
    });
  }

  if (checks.audit && checks.audit !== "passed") {
    steps.push({
      id: "refresh-audit",
      title: `Refresh release evidence for ${labelFor(platformName)} after importing reports`,
    commands: [refreshCommand(platformName), readinessCommand(platformName)],
    });
  }

  return {
    name: platformName,
    label: labelFor(platformName),
    checks,
    blockers: releasePlatform?.blockers || desktopPlatform?.blockers || [],
    steps,
  };
}

function desktopBuildCommands(platformName) {
  const assets = `release-assets-desktop-${platformName}`;
  return [
    `npm run package:desktop-local -- --assets ${assets} --platform ${platformName}${platformName === "macos" ? " --dmg" : ""}`,
    `npm run release:readiness -- ${assets} --automated-only --platform ${platformName}`,
    "After all platform folders are available, rerun:",
    "npm run release:bundle-desktop -- --input desktop-release-assets --output desktop-archives",
    "npm run release:verify-desktop-archives -- desktop-archives --allow-partial",
    "npm run release:desktop-status -- --archives desktop-archives --output desktop-archives/desktop-release-status.md",
  ];
}

function trayCommands(platformName, report, screenshotName) {
  const commonManualChecks = [
    "startsHidden=passed",
    "trayIconVisible=passed",
    "trayMenuItems=passed",
    "trayTooltip=passed",
    "openDashboard=passed",
    "closeKeepsHealthz=passed",
    "quitExitsApp=passed",
    "lanUrlReachable=passed",
  ];
  const checks = platformName === "windows" ? commonManualChecks.concat("windowsNoConsole=passed") : commonManualChecks;
  const checksText = checks.map((check) => `--check ${check}`).join(" ");
  const capture = {
    macos: `./verify-tray-macos-capture.sh /Applications/AgentWatch.app --report ${report} --screenshot screenshots/${screenshotName}`,
    windows: `powershell -ExecutionPolicy Bypass -File .\\verify-tray-windows-capture.ps1 -Report ${report} -Screenshot screenshots\\${screenshotName}`,
    linux: `./verify-tray-linux-capture.sh --report ${report} --screenshot screenshots/${screenshotName}`,
  }[platformName] || `node agentwatch-verify-tray.mjs --report ${report} --screenshot screenshots/${screenshotName}`;
  return [
    capture,
    `node agentwatch-tray-manual-report.mjs --source ${report} --output ${report} ${checksText} --screenshot screenshots/${screenshotName} --manual-notes "Verified tray/menu-bar behavior on ${labelFor(platformName)}."`,
    importTrayCommand(`/path/to/${report}`, platformName),
    refreshCommand(platformName),
  ];
}

function remoteUrlFor(platformName) {
  const guide = readTextIfExists(join(assetDir, "remote-verification.md"));
  const guideUrl = targetUrlFromGuide(guide, labelFor(platformName));
  if (payloadServiceOnly()) {
    const serviceUrl = serviceReportUrlFor(platformName);
    if (serviceUrl) return serviceUrl;
    if (guideUrl) return withPort(guideUrl, "8765");
  }
  if (guideUrl) return guideUrl;
  const preflight = readJsonIfExists(join(assetDir, `lan-preflight-${platformName}.json`));
  const preflightUrl = preflight?.checks?.lanUrl?.value || preflight?.runtime?.lanUrls?.[0];
  if (payloadServiceOnly() && preflightUrl) return withPort(preflightUrl, "8765");
  return preflightUrl || "http://<agent-machine-ip>:<selected-port>";
}

function targetUrlFromGuide(guide, platformLabel) {
  const header = `## ${platformLabel} Agent Machine`;
  const start = guide.indexOf(header);
  if (start === -1) return null;
  const nextHeader = guide.indexOf("\n## ", start + header.length);
  const section = nextHeader === -1 ? guide.slice(start) : guide.slice(start, nextHeader);
  const match = section.match(/Target URL: `([^`]+)`/);
  return match?.[1] || null;
}

function serviceReportUrlFor(platformName) {
  const report = readJsonIfExists(join(assetDir, `service-verification-${platformName}.json`));
  const checks = report?.automatedChecks || {};
  const candidates = [
    checks.lanUrlChecked,
    ...(Array.isArray(checks.lanUrls) ? checks.lanUrls : []),
  ].filter(Boolean);
  return candidates.map(baseHttpUrl).find((url) => /^http:\/\/[^/]+:\d+/i.test(url) && !isLoopbackUrl(url)) || null;
}

function baseHttpUrl(value) {
  try {
    const url = new URL(value);
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return String(value || "").replace(/\/+$/, "");
  }
}

function withPort(value, port) {
  try {
    const url = new URL(value);
    url.port = port;
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value;
  }
}

function isLoopbackUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.startsWith("127.");
  } catch {
    return false;
  }
}

function renderMarkdown(report) {
  const lines = [
    "# AgentWatch Next Release Steps",
    "",
    `Generated: ${report.generatedAt}`,
    `Assets: ${report.assetDir}`,
    `Archives: ${report.archiveDir}`,
    `Overall: ${report.overall}`,
    "",
  ];
  for (const platform of report.platforms) {
    lines.push(`## ${platform.label}`, "");
    if (platform.blockers.length > 0) {
      lines.push(`Blockers: ${platform.blockers.join(", ")}`, "");
    }
    if (platform.steps.length === 0) {
      lines.push("No remaining steps detected.", "");
      continue;
    }
    for (const step of platform.steps) {
      lines.push(`### ${step.title}`, "");
      if (step.browser?.length) {
        lines.push("Browser-only path:", "");
        for (const item of step.browser) lines.push(`- ${item}`);
        lines.push("");
      }
      lines.push("```bash");
      for (const command of step.commands) lines.push(command);
      lines.push("```", "");
    }
  }
  return `${lines.join("\n")}\n`;
}

function refreshCommand(platformName, options = {}) {
  const checkFlag = options.check ? " --check" : "";
  if (hasPackagedHelper("agentwatch-refresh-release-evidence.mjs")) {
    return `node agentwatch-refresh-release-evidence.mjs ${shellPath(assetDir)}${payloadServiceOnlyFlag()} --platform ${platformName}${checkFlag}`;
  }
  return `npm run release:refresh -- ${shellPath(assetDir)}${payloadServiceOnlyFlag()} --platform ${platformName}${checkFlag}`;
}

function importRemoteCommand(reportPath, platformName) {
  if (hasPackagedHelper("agentwatch-import-remote-report.mjs")) {
    return `node agentwatch-import-remote-report.mjs --report ${reportPath} --assets ${shellPath(assetDir)} --platform ${platformName}${payloadServiceOnlyFlag()}`;
  }
  return `npm run release:import-remote -- --report ${reportPath} --assets ${shellPath(assetDir)} --platform ${platformName}${payloadServiceOnlyFlag()}`;
}

function importTrayCommand(reportPath, platformName) {
  if (hasPackagedHelper("agentwatch-import-tray-report.mjs")) {
    return `node agentwatch-import-tray-report.mjs --report ${reportPath} --assets ${shellPath(assetDir)} --platform ${platformName}`;
  }
  return `npm run release:import-tray -- --report ${reportPath} --assets ${shellPath(assetDir)} --platform ${platformName}`;
}

function readinessCommand(platformName) {
  if (hasPackagedHelper("agentwatch-release-status.mjs")) {
    return `node agentwatch-release-status.mjs ${shellPath(assetDir)}${payloadServiceOnlyFlag()} --platform ${platformName}`;
  }
  return `npm run release:readiness -- ${shellPath(assetDir)}${payloadServiceOnlyFlag()} --platform ${platformName}`;
}

function hasPackagedHelper(name) {
  return existsSync(join(assetDir, name));
}

function payloadServiceOnly() {
  return Boolean(status?.serviceOnly ?? serviceOnly);
}

function payloadServiceOnlyFlag() {
  return payloadServiceOnly() ? " --service-only" : "";
}

function screenshotNameFor(platformName) {
  return {
    macos: "macos-menu-bar.png",
    windows: "windows-tray.png",
    linux: "linux-tray.png",
  }[platformName] || `${platformName}-tray.png`;
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function readTextIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function labelFor(platformName) {
  return { macos: "macOS", windows: "Windows", linux: "Linux" }[platformName] || platformName;
}

function shellPath(path) {
  return path.includes(" ") ? `"${path}"` : path;
}

function normalizePlatformName(value) {
  const lower = String(value || "").toLowerCase();
  if (lower.includes("mac") || lower === "darwin") return "macos";
  if (lower.includes("win")) return "windows";
  if (lower.includes("linux")) return "linux";
  return lower;
}

function positionalArgs() {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (["--assets", "--archives", "--output", "--platform"].includes(arg)) {
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
