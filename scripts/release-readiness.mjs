import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const args = process.argv.slice(2);
const automatedOnly = args.includes("--automated-only");
const serviceOnly = args.includes("--service-only");
const platformFilter = getOptionValue("--platform");
const assetDir = resolve(positionalArgs()[0] || "release-assets");
const files = readAssetFiles(assetDir);
const topLevelFiles = files.filter(isTopLevelAssetPath);
const allPlatforms = [
  {
    name: "macos",
    runtimePlatform: "macos",
    hostPlatform: "darwin",
    manifestPlatform: "macos",
    headless: (file) => file === "agentwatch-server-macOS",
    packages: [
      {
        label: "macOS app zip or DMG",
        matches: (file) => file === "AgentWatch-macOS.app.zip" || file.endsWith(".dmg"),
      },
    ],
  },
  {
    name: "windows",
    runtimePlatform: "windows",
    hostPlatform: "win32",
    manifestPlatform: "windows",
    headless: (file) => file === "agentwatch-server-Windows.exe",
    packages: [
      {
        label: "Windows NSIS installer",
        matches: (file) =>
          !file.startsWith("agentwatch-server-") &&
          file.toLowerCase().endsWith(".exe"),
      },
      {
        label: "Windows MSI installer",
        matches: (file) =>
          !file.startsWith("agentwatch-server-") &&
          file.toLowerCase().endsWith(".msi"),
      },
    ],
  },
  {
    name: "linux",
    runtimePlatform: "linux",
    hostPlatform: "linux",
    manifestPlatform: "linux",
    headless: (file) => file === "agentwatch-server-Linux",
    packages: [
      { label: "Linux AppImage", matches: (file) => file.endsWith(".AppImage") },
      { label: "Linux deb", matches: (file) => file.endsWith(".deb") },
      { label: "Linux rpm", matches: (file) => file.endsWith(".rpm") },
    ],
  },
];
const platforms = platformFilter
  ? allPlatforms.filter((platform) => platform.name === normalizePlatformName(platformFilter))
  : allPlatforms;

if (platformFilter && platforms.length === 0) {
  throw new Error(`Unsupported platform filter: ${platformFilter}`);
}

const results = platforms.map(checkPlatform);
const missing = results.filter((result) => result.status !== "ready");

for (const result of results) {
  const marker = result.status === "ready" ? "READY" : "MISSING";
  console.log(`${marker} ${result.platform}`);
  for (const line of result.details) {
    console.log(`  - ${line}`);
  }
}

if (!hasFile("SHA256SUMS.txt")) {
  reportReleaseIssue("SHA256SUMS.txt missing");
} else {
  for (const error of validateSha256Sums()) {
    reportReleaseIssue(`SHA256SUMS.txt invalid: ${error}`);
  }
}

if (!hasFile("release-verification.md")) {
  reportReleaseIssue("release-verification.md missing");
}

if (!hasFile("service-quickstart.md")) {
  reportReleaseIssue("service-quickstart.md missing");
}

if (!hasFile("release-summary.md")) {
  reportReleaseIssue("release-summary.md missing");
}

if (!hasFile("release-next-steps.md")) {
  reportReleaseIssue("release-next-steps.md missing");
}

if (!hasFile("remote-verification.md")) {
  reportReleaseIssue("remote-verification.md missing");
}

if (!serviceOnly && !hasFile("tray-verification.md")) {
  reportReleaseIssue("tray-verification.md missing");
}

if (!hasFile("completion-audit.json")) {
  reportReleaseIssue("completion-audit.json missing");
} else {
  for (const error of validateCompletionAuditJson(readJson("completion-audit.json"))) {
    reportReleaseIssue(`completion-audit.json invalid: ${error}`);
  }
}

if (!hasFile("completion-audit.md")) {
  reportReleaseIssue("completion-audit.md missing");
}

if (!serviceOnly && !hasFile("agentwatch-verify-tray.mjs")) {
  reportReleaseIssue("agentwatch-verify-tray.mjs missing");
}

if (!serviceOnly && !hasFile("agentwatch-verify-tray-config.mjs")) {
  reportReleaseIssue("agentwatch-verify-tray-config.mjs missing");
}

if (!serviceOnly && !hasFile("agentwatch-import-tray-report.mjs")) {
  reportReleaseIssue("agentwatch-import-tray-report.mjs missing");
}

if (!serviceOnly && !hasFile("agentwatch-tray-manual-report.mjs")) {
  reportReleaseIssue("agentwatch-tray-manual-report.mjs missing");
}

if (!hasFile("agentwatch-verify-service.mjs")) {
  reportReleaseIssue("agentwatch-verify-service.mjs missing");
}

if (!hasFile("agentwatch-verify-service-lifecycle.mjs")) {
  reportReleaseIssue("agentwatch-verify-service-lifecycle.mjs missing");
}

if (!hasFile("agentwatch-service-status.mjs")) {
  reportReleaseIssue("agentwatch-service-status.mjs missing");
}

if (!hasFile("agentwatch-lan-preflight.mjs")) {
  reportReleaseIssue("agentwatch-lan-preflight.mjs missing");
}

if (!hasFile("agentwatch-verify-remote-client.mjs")) {
  reportReleaseIssue("agentwatch-verify-remote-client.mjs missing");
}

if (!hasFile("agentwatch-import-remote-report.mjs")) {
  reportReleaseIssue("agentwatch-import-remote-report.mjs missing");
}

if (!hasFile("agentwatch-release-audit.mjs")) {
  reportReleaseIssue("agentwatch-release-audit.mjs missing");
}

if (!hasFile("agentwatch-release-readiness.mjs")) {
  reportReleaseIssue("agentwatch-release-readiness.mjs missing");
}

if (!hasFile("agentwatch-release-status.mjs")) {
  reportReleaseIssue("agentwatch-release-status.mjs missing");
}

if (!hasFile("agentwatch-release-next-steps.mjs")) {
  reportReleaseIssue("agentwatch-release-next-steps.mjs missing");
}

if (!hasFile("agentwatch-refresh-release-evidence.mjs")) {
  reportReleaseIssue("agentwatch-refresh-release-evidence.mjs missing");
}

for (const launcher of [
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
  ...(serviceOnly
    ? []
    : [
        "verify-tray-macos.sh",
        "verify-tray-macos-capture.sh",
        "verify-tray-linux.sh",
        "verify-tray-linux-capture.sh",
        "verify-tray-windows.cmd",
        "verify-tray-windows.ps1",
        "verify-tray-windows-capture.ps1",
      ]),
]) {
  if (!hasFile(launcher)) {
    reportReleaseIssue(`${launcher} missing`);
  }
}

if (missing.length > 0) {
  process.exit(1);
}

function checkPlatform(platform) {
  const details = [];
  const packageFilesByRule = [];
  for (const packageRule of serviceOnly ? [] : platform.packages) {
    const packageFiles = topLevelFiles.filter(packageRule.matches);
    packageFilesByRule.push({ rule: packageRule, files: packageFiles });
    if (packageFiles.length === 0) {
      details.push(`${packageRule.label} missing`);
    } else {
      details.push(`${packageRule.label}: ${packageFiles.join(", ")}`);
    }
  }

  const manifest = findJson(`agentwatch-release-manifest-${platform.name}`);
  if (!manifest) {
    details.push("release manifest missing");
  } else {
    details.push(`release manifest: ${manifest.file}`);
    const manifestErrors = validateManifest(platform, manifest.data, packageFilesByRule);
    for (const error of manifestErrors) {
      details.push(`release manifest invalid: ${error}`);
    }
  }

  const headlessFiles = topLevelFiles.filter(platform.headless);
  if (headlessFiles.length === 0) {
    details.push("headless Rust monitor binary missing");
  } else {
    details.push(`headless Rust monitor: ${headlessFiles.join(", ")}`);
  }

  const performanceReport = findJson(`performance-comparison-${platform.name}`);
  const performanceMarkdown = topLevelFiles.find(
    (file) => file === `performance-comparison-${platform.name}.md`,
  );
  if (!performanceReport) {
    details.push("performance comparison JSON missing");
  } else {
    details.push(`performance comparison JSON: ${performanceReport.file}`);
    const performanceErrors = validatePerformanceReport(platform, performanceReport.data);
    for (const error of performanceErrors) {
      details.push(`performance comparison invalid: ${error}`);
    }
  }
  if (!performanceMarkdown) {
    details.push("performance comparison markdown missing");
  } else {
    details.push(`performance comparison markdown: ${performanceMarkdown}`);
  }

  const lanPreflight = findJson(`lan-preflight-${platform.name}`);
  if (!lanPreflight) {
    details.push("LAN preflight report missing");
  } else {
    details.push(`LAN preflight: ${lanPreflight.file}`);
    const lanPreflightErrors = validateLanPreflightReport(platform, lanPreflight.data);
    for (const error of lanPreflightErrors) {
      details.push(`LAN preflight invalid: ${error}`);
    }
  }

  if (automatedOnly) {
    details.push("service verification: skipped in automated-only mode");
    details.push("service lifecycle: skipped in automated-only mode");
    details.push("remote client verification: skipped in automated-only mode");
    if (!serviceOnly) {
      details.push("tray verification: skipped in automated-only mode");
    }
  } else {
    const serviceReport = findPassedServiceReport(platform.name);
    if (!serviceReport) {
      details.push("passed service verification report missing");
    } else {
      details.push(`service verification: ${serviceReport.file}`);
      const serviceErrors = validateServiceReport(platform, serviceReport.data);
      for (const error of serviceErrors) {
        details.push(`service verification invalid: ${error}`);
      }
    }

    const lifecycleReport = findPassedLifecycleReport(platform.name);
    if (!lifecycleReport) {
      details.push("passed service lifecycle report missing");
    } else {
      details.push(`service lifecycle: ${lifecycleReport.file}`);
      const lifecycleErrors = validateLifecycleReport(platform, lifecycleReport.data);
      for (const error of lifecycleErrors) {
        details.push(`service lifecycle invalid: ${error}`);
      }
    }

    const remoteReport = findPassedRemoteClientReport(platform.name);
    if (!remoteReport) {
      details.push("passed remote client verification report missing");
    } else {
      details.push(`remote client verification: ${remoteReport.file}`);
      const remoteErrors = validateRemoteClientReport(platform, remoteReport.data);
      for (const error of remoteErrors) {
        details.push(`remote client verification invalid: ${error}`);
      }
    }

    if (!serviceOnly) {
      const trayReport = findPassedTrayReport(platform.name);
      if (!trayReport) {
        details.push("passed tray verification report missing");
      } else {
        details.push(`tray verification: ${trayReport.file}`);
        const trayErrors = validateTrayReport(platform, trayReport.data);
        for (const error of trayErrors) {
          details.push(`tray verification invalid: ${error}`);
        }
      }
    }
  }

  return {
    platform: platform.name,
    status: details.some(isBlockingDetail) ? "missing" : "ready",
    details,
  };
}

function isBlockingDetail(detail) {
  return (
    detail.includes("missing") ||
    detail.includes("has no assets") ||
    detail.includes("invalid")
  );
}

function readAssetFiles(directory, current = directory) {
  try {
    const found = [];
    for (const name of readdirSync(current).sort((left, right) => left.localeCompare(right))) {
      const path = resolve(current, name);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        found.push(...readAssetFiles(directory, path));
      } else if (stat.isFile()) {
        found.push(relative(directory, path).replace(/\\/g, "/"));
      }
    }
    return found;
  } catch (error) {
    throw new Error(`Cannot read release asset directory ${directory}: ${error.message}`);
  }
}

function positionalArgs() {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--platform") {
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
  if (lower.includes("mac") || lower === "darwin") return "macos";
  if (lower.includes("win")) return "windows";
  if (lower.includes("linux")) return "linux";
  return lower;
}

function hasFile(file) {
  return topLevelFiles.includes(file);
}

function reportReleaseIssue(detail) {
  missing.push({
    platform: "release",
    status: "missing",
    details: [detail],
  });
  console.log("MISSING release");
  console.log(`  - ${detail}`);
}

function findJson(prefix) {
  const file = topLevelFiles
    .filter((candidate) => candidate.startsWith(prefix) && candidate.endsWith(".json"))
    .sort((left, right) => scoreJsonCandidate(left, prefix) - scoreJsonCandidate(right, prefix) || left.localeCompare(right))[0];
  if (!file) return null;
  return { file, data: readJson(file) };
}

function scoreJsonCandidate(file, prefix) {
  return file === `${prefix}.json` ? 0 : 1;
}

function findPassedTrayReport(platformName) {
  return findPassedJson(`tray-verification-${platformName}`, (data) => data?.manualResult === "passed");
}

function findPassedServiceReport(platformName) {
  return findPassedJson(`service-verification-${platformName}`, (data) => data?.manualResult === "passed");
}

function findPassedLifecycleReport(platformName) {
  return findPassedJson(`service-lifecycle-${platformName}`, (data) => data?.result === "passed");
}

function findPassedRemoteClientReport(platformName) {
  return findPassedJson(`remote-client-verification-${platformName}`, (data) => data?.result === "passed");
}

function findPassedJson(prefix, isPassed) {
  const exactFile = `${prefix}.json`;
  if (topLevelFiles.includes(exactFile)) {
    const data = readJson(exactFile);
    return isPassed(data) ? { file: exactFile, data } : null;
  }
  const candidates = topLevelFiles.filter(
    (file) =>
      file.startsWith(prefix) &&
      file.endsWith(".json"),
  );
  candidates.sort((left, right) => scoreJsonCandidate(left, prefix) - scoreJsonCandidate(right, prefix) || left.localeCompare(right));
  for (const file of candidates) {
    const data = readJson(file);
    if (isPassed(data)) {
      return { file, data };
    }
  }
  return null;
}

function validateManifest(platform, data, packageFilesByRule) {
  const errors = [];
  const assets = Array.isArray(data.assets) ? data.assets : [];

  if (data.schemaVersion !== 1) {
    errors.push("schemaVersion is not 1");
  }
  if (data.build?.platform !== platform.manifestPlatform) {
    errors.push(`build platform is ${data.build?.platform || "missing"}, expected ${platform.manifestPlatform}`);
  }
  if (typeof data.app?.version !== "string" || data.app.version.length === 0) {
    errors.push("app version missing");
  }
  errors.push(...validateAutomatedGates(data.automatedGates));
  if (assets.length === 0) {
    errors.push("has no assets");
  }

  for (const asset of assets) {
    if (typeof asset.name !== "string" || asset.name.length === 0) {
      errors.push("asset name missing");
      continue;
    }
    if (!topLevelFiles.includes(asset.name)) {
      errors.push(`asset ${asset.name} not found in release directory`);
      continue;
    }
    const actual = readAssetEvidence(asset.name);
    if (!Number.isInteger(asset.bytes) || asset.bytes <= 0) {
      errors.push(`asset ${asset.name} bytes invalid`);
    } else if (asset.bytes !== actual.bytes) {
      errors.push(`asset ${asset.name} bytes mismatch`);
    }
    if (typeof asset.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
      errors.push(`asset ${asset.name} sha256 invalid`);
    } else if (asset.sha256 !== actual.sha256) {
      errors.push(`asset ${asset.name} sha256 mismatch`);
    }
  }

  for (const { rule, files: matchedFiles } of packageFilesByRule) {
    if (matchedFiles.length > 0 && !matchedFiles.some((file) => assets.some((asset) => asset.name === file))) {
      errors.push(`${rule.label} missing from manifest assets`);
    }
  }

  const headlessFiles = topLevelFiles.filter(platform.headless);
  if (headlessFiles.length > 0 && !headlessFiles.some((file) => assets.some((asset) => asset.name === file))) {
    errors.push("headless Rust monitor binary missing from manifest assets");
  }

  return errors;
}

function validateAutomatedGates(gates) {
  const errors = [];
  if (!Array.isArray(gates) || gates.length === 0) {
    return ["automatedGates missing"];
  }
  for (const requiredGate of [
    "npm test",
    "headless Rust monitor build",
    "headless smoke test",
    "LAN preflight against advertised LAN /healthz",
    "Rust-vs-Python performance comparison",
    "release asset collection",
    "release readiness automated gate",
  ]) {
    if (!gates.includes(requiredGate)) {
      errors.push(`automated gate ${requiredGate} missing`);
    }
  }
  return errors;
}

function validateSha256Sums() {
  const errors = [];
  const expectedFiles = files.filter((file) => file !== "SHA256SUMS.txt");
  const content = readFileSync(resolve(assetDir, "SHA256SUMS.txt"), "utf8");
  const entries = new Map();

  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const match = line.match(/^([a-f0-9]{64}) [ *](.+)$/);
    if (!match) {
      errors.push(`line ${index + 1} is malformed`);
      continue;
    }
    const [, sha256, file] = match;
    if (!isSafeRelativeAssetPath(file)) {
      errors.push(`${file} must be a safe relative release asset path`);
      continue;
    }
    if (entries.has(file)) {
      errors.push(`${file} is listed more than once`);
      continue;
    }
    entries.set(file, sha256);
  }

  for (const file of expectedFiles) {
    if (!entries.has(file)) {
      errors.push(`${file} missing from SHA256SUMS.txt`);
      continue;
    }
    const actual = readAssetEvidence(file).sha256;
    if (entries.get(file) !== actual) {
      errors.push(`${file} sha256 mismatch`);
    }
  }

  for (const file of entries.keys()) {
    if (!files.includes(file)) {
      errors.push(`${file} listed but not found in release directory`);
    }
  }

  return errors;
}

function isSafeRelativeAssetPath(file) {
  if (!file || file.startsWith("/") || file.startsWith("\\") || file.includes("\\")) {
    return false;
  }
  const parts = file.split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

function isTopLevelAssetPath(file) {
  return !String(file).includes("/");
}

function validateCompletionAuditJson(data) {
  const errors = [];
  if (data.schemaVersion !== 1) {
    errors.push("schemaVersion is not 1");
  }
  if (data.serviceOnly !== serviceOnly) {
    errors.push(`serviceOnly is ${String(data.serviceOnly)}, expected ${String(serviceOnly)}`);
  }
  if (typeof data.generatedAt !== "string" || data.generatedAt.length === 0) {
    errors.push("generatedAt missing");
  }
  const auditPlatforms = Array.isArray(data.platforms) ? data.platforms : [];
  if (auditPlatforms.length === 0) {
    errors.push("platforms missing");
    return errors;
  }
  for (const platform of platforms) {
    const auditPlatform = auditPlatforms.find((candidate) => candidate.name === platform.name);
    if (!auditPlatform) {
      errors.push(`${platform.name} platform audit missing`);
      continue;
    }
    const checks = Array.isArray(auditPlatform.checks) ? auditPlatform.checks : [];
    if (checks.length === 0) {
      errors.push(`${platform.name} checks missing`);
    }
    const requiredChecks = [
      "rustHeadlessMonitor",
      "rustFasterThanPython",
      "serviceInstallable",
      "lanPreflightReady",
      "browserLanRemote",
      "desktopPackage",
      "trayIndicator",
      "releaseManifest",
    ];
    for (const checkId of requiredChecks) {
      if (!checks.some((check) => check.id === checkId)) {
        errors.push(`${platform.name} ${checkId} check missing`);
      }
    }
    if (!automatedOnly && auditPlatform.status !== "passed") {
      errors.push(`${platform.name} status is ${auditPlatform.status || "missing"}, expected passed`);
    }
  }
  return errors;
}

function validateTrayReport(platform, data) {
  const errors = [];
  const checks = data.automatedChecks || {};

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
  if (checks.healthz !== "passed") {
    errors.push("healthz check did not pass");
  }
  if (checks.runtimeEndpoint !== "passed") {
    errors.push("runtime endpoint check did not pass");
  }
  if (checks.snapshotEndpoint !== "passed") {
    errors.push("snapshot endpoint check did not pass");
  }
  if (checks.dashboardHtml !== "passed") {
    errors.push("dashboard HTML check did not pass");
  }
  if (checks.dashboardJs !== "passed") {
    errors.push("dashboard JS check did not pass");
  }
  if (checks.dashboardCss !== "passed") {
    errors.push("dashboard CSS check did not pass");
  }
  if (checks.startsHiddenConfig !== "passed" && !trayConfigPassed(platform.name)) {
    errors.push("hidden startup config check did not pass");
  }
  if (checks.trayMenuContract !== "passed" && !trayConfigPassed(platform.name)) {
    errors.push("tray menu contract check did not pass");
  }
  if (checks.trayTooltipContract !== "passed" && !trayConfigPassed(platform.name)) {
    errors.push("tray tooltip contract check did not pass");
  }
  if (checks.openDashboardContract !== "passed" && !trayConfigPassed(platform.name)) {
    errors.push("open dashboard contract check did not pass");
  }
  if (checks.closeToTrayContract !== "passed" && !trayConfigPassed(platform.name)) {
    errors.push("close-to-tray contract check did not pass");
  }
  if (
    platform.name === "windows" &&
    checks.windowsNoConsoleContract !== "passed" &&
    !trayConfigPassed(platform.name)
  ) {
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
  if (checks.platform && checks.platform !== platform.runtimePlatform) {
    errors.push(`runtime platform is ${checks.platform}, expected ${platform.runtimePlatform}`);
  }
  if (!checks.platform && data.host?.platform !== platform.hostPlatform) {
    errors.push(
      `host platform is ${data.host?.platform || "missing"}, expected ${platform.hostPlatform}`,
    );
  }

  const screenshots = Array.isArray(data.screenshots) ? data.screenshots : [];
  if (screenshots.length === 0) {
    errors.push("screenshots missing");
  }
  screenshots.forEach((screenshot, index) => {
    if (typeof screenshot.path !== "string" || screenshot.path.length === 0) {
      errors.push(`screenshot ${index + 1} path missing`);
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

function indicatorTargetFor(platformName) {
  if (platformName === "macos") return "macos-menu-bar";
  if (platformName === "windows") return "windows-notification-area";
  if (platformName === "linux") return "linux-tray";
  return "desktop-tray";
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

function trayConfigPassed(platformName) {
  const report = findJson(`tray-config-verification-${platformName}`)?.data;
  const checks = report?.automatedChecks || {};
  return (
    report?.configOnly === true &&
    checks.runtime === "tauri-rust" &&
    checks.trayEnabled === true &&
    checks.startsHiddenConfig === "passed" &&
    checks.trayMenuContract === "passed" &&
    checks.trayTooltipContract === "passed" &&
    checks.openDashboardContract === "passed" &&
    checks.closeToTrayContract === "passed" &&
    (platformName !== "windows" || checks.windowsNoConsoleContract === "passed") &&
    checks.runtimeIndicatorTarget === indicatorTargetFor(platformName)
  );
}

function validateServiceReport(platform, data) {
  const errors = [];
  const checks = data.automatedChecks || {};

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
  requireManualChecks(errors, manualChecks, [
    "startsOnLogin",
    "lanUrlReachable",
    "uninstallClean",
  ]);
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
    ["lanUrlReachable", "LAN URL reachability check did not pass"],
    ["serviceRegistered", "service registration check did not pass"],
    ["loginStartContract", "login-start contract check did not pass"],
  ]) {
    if (checks[field] !== "passed") {
      errors.push(label);
    }
  }
  errors.push(...validateUsageChecks(checks));
  if (typeof checks.serviceName !== "string" || checks.serviceName.length === 0) {
    errors.push("serviceName missing");
  }
  if (checks.lifecycleUninstallClean !== "passed") {
    errors.push("lifecycleUninstallClean is not passed");
  }
  if (checks.runtime !== "rust-headless") {
    errors.push(`runtime is ${checks.runtime || "missing"}, expected rust-headless`);
  }
  if (checks.trayEnabled !== false) {
    errors.push("trayEnabled is not false");
  }
  if (checks.bindHost !== "0.0.0.0") {
    errors.push(`bindHost is ${checks.bindHost || "missing"}, expected 0.0.0.0`);
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
  if (checks.platform && checks.platform !== platform.runtimePlatform) {
    errors.push(`runtime platform is ${checks.platform}, expected ${platform.runtimePlatform}`);
  }
  if (!checks.platform && data.host?.platform !== platform.hostPlatform) {
    errors.push(
      `host platform is ${data.host?.platform || "missing"}, expected ${platform.hostPlatform}`,
    );
  }

  const evidenceFiles = Array.isArray(data.evidenceFiles) ? data.evidenceFiles : [];
  evidenceFiles.forEach((evidence, index) => {
    if (typeof evidence.path !== "string" || evidence.path.length === 0) {
      errors.push(`evidence ${index + 1} path missing`);
    }
    if (!Number.isInteger(evidence.bytes) || evidence.bytes <= 0) {
      errors.push(`evidence ${index + 1} bytes invalid`);
    }
    if (typeof evidence.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(evidence.sha256)) {
      errors.push(`evidence ${index + 1} sha256 invalid`);
    }
  });

  return errors;
}

function requireManualChecks(errors, manualChecks, requiredIds) {
  for (const id of requiredIds) {
    const check = manualChecks.find((candidate) => candidate.id === id);
    if (!check) {
      errors.push(`manual check ${id} missing`);
    } else if (check.status !== "passed") {
      errors.push(`manual check ${id} is not passed`);
    }
  }
}

function validateLifecycleReport(platform, data) {
  const errors = [];
  if (data.schemaVersion !== 1) {
    errors.push("schemaVersion is not 1");
  }
  if (data.result !== "passed") {
    errors.push("result is not passed");
  }
  if (data.host?.platform && data.host.platform !== platform.hostPlatform) {
    errors.push(`host platform is ${data.host.platform}, expected ${platform.hostPlatform}`);
  }
  if (typeof data.serviceName !== "string" || data.serviceName.length === 0) {
    errors.push("serviceName missing");
  }
  if (typeof data.targetUrl !== "string" || !data.targetUrl.startsWith("http://127.0.0.1:")) {
    errors.push("targetUrl is missing or invalid");
  }
  const steps = Array.isArray(data.steps) ? data.steps : [];
  const requiredSteps = ["uninstall", "uninstallClean", "install", "verifyService", "reinstallHealthy"];
  for (const requiredStep of requiredSteps) {
    const step = steps.find((candidate) => candidate.name === requiredStep);
    if (!step) {
      errors.push(`step ${requiredStep} missing`);
    } else if (step.status !== "passed") {
      errors.push(`step ${requiredStep} is not passed`);
    }
  }
  return errors;
}

function validateRemoteClientReport(platform, data) {
  const errors = [];
  const checks = data.automatedChecks || {};

  if (data.schemaVersion !== 1) {
    errors.push("schemaVersion is not 1");
  }
  if (data.result !== "passed") {
    errors.push("result is not passed");
  }
  if (typeof data.targetUrl !== "string" || !/^http:\/\/[^/]+:\d+/.test(data.targetUrl)) {
    errors.push("targetUrl is missing or invalid");
  } else if (/^http:\/\/(localhost|127\.|127\.0\.0\.1|\[?::1\]?)/i.test(data.targetUrl)) {
    errors.push("targetUrl must be a LAN URL, not loopback");
  }
  if (typeof data.client?.hostname !== "string" || data.client.hostname.length === 0) {
    errors.push("client hostname missing");
  }
  for (const [field, label] of [
    ["healthz", "healthz check did not pass"],
    ["runtimeEndpoint", "runtime endpoint check did not pass"],
    ["snapshotEndpoint", "snapshot endpoint check did not pass"],
    ["dashboardHtml", "dashboard HTML check did not pass"],
    ["dashboardJs", "dashboard JS check did not pass"],
    ["dashboardCss", "dashboard CSS check did not pass"],
  ]) {
    if (checks[field] !== "passed") {
      errors.push(label);
    }
  }
  errors.push(...validateUsageChecks(checks));
  if (checks.runtime !== "rust-headless") {
    errors.push(`runtime is ${checks.runtime || "missing"}, expected rust-headless`);
  }
  if (checks.trayEnabled !== false) {
    errors.push("trayEnabled is not false");
  }
  if (checks.bindHost !== "0.0.0.0") {
    errors.push(`bindHost is ${checks.bindHost || "missing"}, expected 0.0.0.0`);
  }
  if (checks.sameHost !== false) {
    errors.push("remote client ran on the same host as the service");
  }
  if (checks.remoteCheckEndpoint !== "passed") {
    errors.push("remote-check endpoint check did not pass");
  }
  if (checks.remoteClient !== true) {
    errors.push("server-side remote check did not prove a remote client");
  }
  if (checks.sameHostIp !== false) {
    errors.push("server-side remote check reports a same-host IP");
  }
  if (checks.loopback !== false) {
    errors.push("server-side remote check reports loopback");
  }
  if (typeof checks.clientIp !== "string" || checks.clientIp.length === 0) {
    errors.push("remote-check clientIp missing");
  }
  if (typeof checks.agentHostname !== "string" || checks.agentHostname.length === 0) {
    errors.push("agentHostname missing");
  }
  if (typeof checks.clientHostname !== "string" || checks.clientHostname.length === 0) {
    errors.push("clientHostname missing");
  }
  if (!Number.isInteger(checks.port) || checks.port <= 0) {
    errors.push("port is missing or invalid");
  }
  if (typeof checks.localUrl !== "string" || !checks.localUrl.startsWith("http://127.0.0.1:")) {
    errors.push("localUrl is missing or invalid");
  }
  if (!Array.isArray(checks.lanUrls) || checks.lanUrls.length === 0) {
    errors.push("lanUrls is missing or invalid");
  }
  if (checks.platform && checks.platform !== platform.runtimePlatform) {
    errors.push(`runtime platform is ${checks.platform}, expected ${platform.runtimePlatform}`);
  }
  return errors;
}

function validateLanPreflightReport(platform, data) {
  const errors = [];
  const checks = data.checks || {};

  if (data.schemaVersion !== 1) {
    errors.push("schemaVersion is not 1");
  }
  if (data.reachable !== true) {
    errors.push("target service was not reachable");
  }
  if (data.readyForRemoteViewer !== true) {
    errors.push("readyForRemoteViewer is not true");
  }
  if (checks.healthz?.ok !== true) {
    errors.push("local healthz check did not pass");
  }
  if (checks.runtime?.ok !== true) {
    errors.push("runtime check did not pass");
  }
  if (checks.bindHost?.ok !== true || checks.bindHost?.value !== "0.0.0.0") {
    errors.push(`bindHost is ${checks.bindHost?.value || "missing"}, expected 0.0.0.0`);
  }
  if (checks.lanUrl?.ok !== true || !isLanUrl(checks.lanUrl?.value)) {
    errors.push("LAN URL is missing or loopback-only");
  }
  if (checks.lanHealthz?.ok !== true || !isLanHealthzUrl(checks.lanHealthz?.url)) {
    errors.push("LAN healthz check did not pass");
  }
  if (checks.dashboard?.ok !== true) {
    errors.push("dashboard asset check did not pass");
  }
  if (checks.remoteCheck?.ok !== true) {
    errors.push("remote-check contract check did not pass");
  }
  if (data.runtime?.runtime !== "rust-headless") {
    errors.push(`runtime is ${data.runtime?.runtime || "missing"}, expected rust-headless`);
  }
  if (data.runtime?.platform && data.runtime.platform !== platform.runtimePlatform) {
    errors.push(`runtime platform is ${data.runtime.platform}, expected ${platform.runtimePlatform}`);
  }
  return errors;
}

function isLanHealthzUrl(value) {
  if (!isLanUrl(value)) return false;
  try {
    return new URL(value).pathname === "/healthz";
  } catch {
    return false;
  }
}

function isLanUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host !== "localhost" && host !== "0.0.0.0" && host !== "::1" && !host.startsWith("127.");
  } catch {
    return false;
  }
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

function validatePerformanceReport(platform, data) {
  const errors = [];
  const benchmark = data.benchmark || {};
  const desktop = benchmark.rustDesktop || {};
  const headless = benchmark.rustHeadless || {};
  const python = benchmark.python || {};
  const verdict = data.performanceVerdict;
  const benchmarkSkipped = benchmark.status === "skipped" || verdict?.status === "skipped";

  if (data.schemaVersion !== 1) {
    errors.push("schemaVersion is not 1");
  }
  if (data.host?.platform && data.host.platform !== platform.hostPlatform) {
    errors.push(`host platform is ${data.host.platform}, expected ${platform.hostPlatform}`);
  }
  if (benchmarkSkipped) {
    if (benchmark.status !== "skipped") {
      errors.push("benchmark status is not skipped");
    }
    if (typeof benchmark.error !== "string" || benchmark.error.length === 0) {
      errors.push("benchmark skipped error missing");
    }
    return errors.concat(validatePerformanceVerdict(benchmark, verdict));
  }
  if (!serviceOnly && desktop.runtime !== "tauri-rust") {
    errors.push(`desktop runtime is ${desktop.runtime || "missing"}, expected tauri-rust`);
  }
  if (!serviceOnly && desktop.platform && desktop.platform !== platform.runtimePlatform) {
    errors.push(`desktop platform is ${desktop.platform}, expected ${platform.runtimePlatform}`);
  }
  if (headless.runtime !== "rust-headless") {
    errors.push(`headless runtime is ${headless.runtime || "missing"}, expected rust-headless`);
  }
  if (headless.platform && headless.platform !== platform.runtimePlatform) {
    errors.push(`headless platform is ${headless.platform}, expected ${platform.runtimePlatform}`);
  }
  if (python.runtime !== "python") {
    errors.push(`python runtime is ${python.runtime || "missing"}, expected python`);
  }

  for (const [label, runtime] of [
    ...(serviceOnly ? [] : [["desktop", desktop]]),
    ["headless", headless],
    ["python", python],
  ]) {
    for (const metric of ["startupMs", "avgResponseMs", "p95ResponseMs"]) {
      if (typeof runtime[metric] !== "number" || runtime[metric] < 0) {
        errors.push(`${label} ${metric} missing or invalid`);
      }
    }
    if (runtime.rssMb !== null && runtime.rssMb !== undefined) {
      if (typeof runtime.rssMb !== "number" || runtime.rssMb < 0) {
        errors.push(`${label} rssMb invalid`);
      }
    }
  }

  const headlessVsPython = benchmark.delta?.headlessVsPython;
  if (!headlessVsPython) {
    errors.push("headlessVsPython delta missing");
  } else {
    for (const metric of ["startupMs", "avgResponseMs", "p95ResponseMs"]) {
      const delta = headlessVsPython[metric];
      if (!delta || typeof delta.value !== "number") {
        errors.push(`headlessVsPython ${metric} delta missing`);
      }
    }
    if (
      headless.rssMb !== null &&
      headless.rssMb !== undefined &&
      python.rssMb !== null &&
      python.rssMb !== undefined
    ) {
      const delta = headlessVsPython.rssMb;
      if (!delta || typeof delta.value !== "number") {
        errors.push("headlessVsPython rssMb delta missing");
      }
    }
  }
  errors.push(...validatePerformanceVerdict(benchmark, verdict));
  return errors;
}

function validatePerformanceVerdict(benchmark, verdict) {
  const errors = [];
  const headlessVsPython = benchmark.delta?.headlessVsPython;
  if (!verdict || typeof verdict !== "object") {
    errors.push("performanceVerdict missing");
  } else {
    if (!["passed", "failed", "skipped"].includes(verdict.status)) {
      errors.push(`performanceVerdict status is ${verdict.status || "missing"}, expected passed, failed, or skipped`);
    }
    if (verdict.comparison !== "headlessVsPython") {
      errors.push(`performanceVerdict comparison is ${verdict.comparison || "missing"}, expected headlessVsPython`);
    }
    const requirements = Array.isArray(verdict.requirements) ? verdict.requirements : [];
    for (const metric of ["startupMs", "avgResponseMs", "p95ResponseMs", "rssMb"]) {
      const requirement = requirements.find((item) => item?.metric === metric);
      if (!requirement) {
        errors.push(`performanceVerdict ${metric} requirement missing`);
        continue;
      }
      if (typeof requirement.passed !== "boolean") {
        errors.push(`performanceVerdict ${metric} passed flag missing`);
      }
      const expectedDelta = headlessVsPython?.[metric]?.value;
      const actualDelta = requirement.actualDelta?.value;
      if (typeof expectedDelta === "number" && actualDelta !== expectedDelta) {
        errors.push(`performanceVerdict ${metric} actualDelta does not match headlessVsPython delta`);
      }
    }
  }
  return errors;
}

function readJson(file) {
  const path = resolve(assetDir, file);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot parse ${file}: ${error.message}`);
  }
}

function readAssetEvidence(file) {
  const path = resolve(assetDir, file);
  const content = readFileSync(path);
  return {
    bytes: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}
