#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const args = process.argv.slice(2);
const reportPath = getOptionValue("--report") || positionalArgs()[0];
const assetDir = resolve(getOptionValue("--assets") || positionalArgs()[1] || "release-assets");

if (!reportPath) {
  throw new Error("Usage: node scripts/import-tray-report.mjs --report <tray-verification.json> [--assets release-assets] [--platform macos|windows|linux]");
}

const report = readJson(resolve(reportPath));
const platformName = normalizePlatformName(
  getOptionValue("--platform") ||
    report.automatedChecks?.platform ||
    report.host?.platform ||
    report.visualTarget ||
    inferPlatformFromFilename(reportPath),
);
const platform = platformFor(platformName);
const errors = validateTrayReport(platform, report);

if (errors.length > 0) {
  throw new Error(`Tray report invalid: ${errors.join("; ")}`);
}

mkdirSync(assetDir, { recursive: true });
const destination = join(assetDir, `tray-verification-${platform.name}.json`);
writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Imported tray report: ${destination}`);
console.log(`Indicator target: ${indicatorTargetFor(platform.name)}`);
console.log(`Screenshots: ${report.screenshots.length}`);
console.log(`Next: npm run release:refresh -- ${assetDir} --platform ${platform.name} --check`);

function validateTrayReport(platform, data) {
  const errors = [];
  const checks = data.automatedChecks || {};

  if (data.schemaVersion !== 1) {
    errors.push("schemaVersion is not 1");
  }
  if (data.manualResult !== "passed") {
    errors.push("manualResult is not passed");
  }
  if (typeof data.manualNotes !== "string" || data.manualNotes.trim().length === 0) {
    errors.push("manualNotes missing");
  }

  const manualChecks = Array.isArray(data.manualChecks) ? data.manualChecks : [];
  if (manualChecks.length === 0) {
    errors.push("manualChecks missing");
  }
  requireManualChecks(errors, manualChecks, requiredTrayManualCheckIds(platform.name));
  for (const check of manualChecks) {
    if (typeof check.id !== "string" || check.id.length === 0) {
      errors.push("manual check id missing");
    }
    if (typeof check.label !== "string" || check.label.length === 0) {
      errors.push(`manual check ${check.id || "unknown"} label missing`);
    }
    if (check.status !== "passed") {
      errors.push(`manual check ${check.id || check.label || "unknown"} is not passed`);
    }
  }

  for (const [field, label] of [
    ["healthz", "healthz check did not pass"],
    ["runtimeEndpoint", "runtime endpoint check did not pass"],
    ["snapshotEndpoint", "snapshot endpoint check did not pass"],
    ["dashboardHtml", "dashboard HTML check did not pass"],
    ["dashboardJs", "dashboard JS check did not pass"],
    ["dashboardCss", "dashboard CSS check did not pass"],
    ["startsHiddenConfig", "hidden startup config check did not pass"],
    ["trayMenuContract", "tray menu contract check did not pass"],
    ["trayTooltipContract", "tray tooltip contract check did not pass"],
    ["openDashboardContract", "open dashboard contract check did not pass"],
    ["closeToTrayContract", "close-to-tray contract check did not pass"],
  ]) {
    if (checks[field] !== "passed") {
      errors.push(label);
    }
  }
  if (platform.name === "windows" && checks.windowsNoConsoleContract !== "passed") {
    errors.push("Windows no-console contract check did not pass");
  }

  errors.push(...validateUsageChecks(checks));

  if (checks.runtime !== "tauri-rust") {
    errors.push(`runtime is ${checks.runtime || "missing"}, expected tauri-rust`);
  }
  const expectedIndicatorTarget = indicatorTargetFor(platform.name);
  if (data.visualTarget !== expectedIndicatorTarget) {
    errors.push(`visualTarget is ${data.visualTarget || "missing"}, expected ${expectedIndicatorTarget}`);
  }
  if (checks.indicatorTarget !== expectedIndicatorTarget) {
    errors.push(`indicatorTarget is ${checks.indicatorTarget || "missing"}, expected ${expectedIndicatorTarget}`);
  }
  if (checks.runtimeIndicatorTarget !== expectedIndicatorTarget) {
    errors.push(`runtimeIndicatorTarget is ${checks.runtimeIndicatorTarget || "missing"}, expected ${expectedIndicatorTarget}`);
  }
  if (checks.trayEnabled !== true) {
    errors.push("trayEnabled is not true");
  }
  if (typeof checks.version !== "string" || checks.version.length === 0) {
    errors.push("version is missing");
  }
  if (!Number.isInteger(checks.port) || checks.port <= 0) {
    errors.push("port is missing or invalid");
  }
  if (typeof checks.localUrl !== "string" || !checks.localUrl.startsWith("http://127.0.0.1:")) {
    errors.push("localUrl is missing or invalid");
  }
  if (!Array.isArray(checks.lanUrls)) {
    errors.push("lanUrls is missing or invalid");
  }
  if (checks.platform && normalizePlatformName(checks.platform) !== platform.name) {
    errors.push(`runtime platform is ${checks.platform}, expected ${platform.runtimePlatform}`);
  }
  if (!checks.platform && data.host?.platform && normalizePlatformName(data.host.platform) !== platform.name) {
    errors.push(`host platform is ${data.host.platform}, expected ${platform.hostPlatform}`);
  }

  const screenshots = Array.isArray(data.screenshots) ? data.screenshots : [];
  if (screenshots.length === 0) {
    errors.push("screenshots missing");
  }
  screenshots.forEach((screenshot, index) => {
    if (typeof screenshot.path !== "string" || screenshot.path.length === 0) {
      errors.push(`screenshot ${index + 1} path missing`);
    } else if (!screenshotPathMatchesPlatform(screenshot.path, platform.name)) {
      errors.push(`screenshot ${index + 1} path does not match ${platform.name} tray target`);
    }
    if (!Number.isInteger(screenshot.bytes) || screenshot.bytes <= 0) {
      errors.push(`screenshot ${index + 1} bytes invalid`);
    }
    if (typeof screenshot.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(screenshot.sha256)) {
      errors.push(`screenshot ${index + 1} sha256 invalid`);
    }
  });

  return errors;
}

function validateUsageChecks(checks) {
  const errors = [];
  for (const [field, label] of [
    ["usageEndpoint", "usage endpoint check did not pass"],
    ["usageDashboardHtml", "usage dashboard HTML check did not pass"],
    ["usageDashboardJs", "usage dashboard JS check did not pass"],
    ["usageDashboardCss", "usage dashboard CSS check did not pass"],
    ["usageDaily", "usage daily check did not pass"],
    ["usageTotals", "usage totals check did not pass"],
    ["usageQuotas", "usage quotas check did not pass"],
    ["usageThreads", "usage threads check did not pass"],
    ["usageGoals", "usage goals check did not pass"],
  ]) {
    if (checks[field] !== "passed") {
      errors.push(label);
    }
  }
  if (!Number.isInteger(checks.usageProviderCount) || checks.usageProviderCount <= 0) {
    errors.push("usageProviderCount is missing or invalid");
  }
  if (checks.providerHistoryEndpoint !== "passed") {
    errors.push("providerHistory endpoint check did not pass");
  }
  if (!Number.isInteger(checks.providerHistoryCount) || checks.providerHistoryCount < 0) {
    errors.push("providerHistoryCount is missing or invalid");
  }
  return errors;
}

function requireManualChecks(errors, manualChecks, requiredIds) {
  const statuses = new Map(manualChecks.map((check) => [check.id, check.status]));
  for (const id of requiredIds) {
    if (statuses.get(id) !== "passed") {
      errors.push(`manual check ${id} is not passed`);
    }
  }
}

function requiredTrayManualCheckIds(platformName) {
  return [
    "startsHidden",
    "trayIconVisible",
    "trayMenuItems",
    "trayTooltip",
    "openDashboard",
    "closeKeepsHealthz",
    "quitExitsApp",
    "lanUrlReachable",
    ...(platformName === "windows" ? ["windowsNoConsole"] : []),
  ];
}

function indicatorTargetFor(platformName) {
  if (platformName === "macos") return "macos-menu-bar";
  if (platformName === "windows") return "windows-notification-area";
  if (platformName === "linux") return "linux-tray";
  return "desktop-tray";
}

function screenshotPathMatchesPlatform(path, platformName) {
  const normalized = String(path || "").replace(/\\/g, "/").toLowerCase();
  const expected = {
    macos: ["macos-menu-bar", "menu-bar"],
    windows: ["windows-tray", "windows-notification-area"],
    linux: ["linux-tray"],
  }[platformName] || [platformName];
  return expected.some((part) => normalized.includes(part));
}

function platformFor(value) {
  const normalized = normalizePlatformName(value);
  const platforms = {
    macos: { name: "macos", runtimePlatform: "macos", hostPlatform: "darwin" },
    windows: { name: "windows", runtimePlatform: "windows", hostPlatform: "win32" },
    linux: { name: "linux", runtimePlatform: "linux", hostPlatform: "linux" },
  };
  const platform = platforms[normalized];
  if (!platform) {
    throw new Error(`Unsupported or missing platform: ${value || "missing"}`);
  }
  return platform;
}

function inferPlatformFromFilename(path) {
  return basename(path).match(/tray-verification-([a-z0-9_-]+)\.json/i)?.[1] || "";
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read tray report ${path}: ${error.message}`);
  }
}

function positionalArgs() {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--report" || arg === "--assets" || arg === "--platform") {
      index += 1;
      continue;
    }
    if (!arg.startsWith("--")) {
      values.push(arg);
    }
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
  if (lower.includes("mac") || lower === "darwin" || lower === "macos-menu-bar") return "macos";
  if (lower.includes("win") || lower === "windows-notification-area") return "windows";
  if (lower.includes("linux") || lower === "linux-tray") return "linux";
  return lower;
}
