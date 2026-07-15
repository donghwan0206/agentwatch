import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const serviceOnly = args.includes("--service-only");
const jsonOutput = args.includes("--json");
const outputPath = getOptionValue("--output");
const platformFilter = getOptionValue("--platform");
const assetDir = resolve(positionalArgs()[0] || "release-assets");
const files = readFiles(assetDir);

const platforms = [
  {
    name: "macos",
    label: "macOS",
    runtimePlatform: "macos",
    hostPlatform: "darwin",
    headless: "agentwatch-server-macOS",
    packageRules: [
      {
        label: "macOS app zip or DMG",
        matches: (file) => file === "AgentWatch-macOS.app.zip" || file.endsWith(".dmg"),
      },
    ],
    trayTarget: "macos-menu-bar",
  },
  {
    name: "windows",
    label: "Windows",
    runtimePlatform: "windows",
    hostPlatform: "win32",
    headless: "agentwatch-server-Windows.exe",
    packageRules: [
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
    trayTarget: "windows-notification-area",
  },
  {
    name: "linux",
    label: "Linux",
    runtimePlatform: "linux",
    hostPlatform: "linux",
    headless: "agentwatch-server-Linux",
    packageRules: [
      { label: "Linux AppImage", matches: (file) => file.endsWith(".AppImage") },
      { label: "Linux deb", matches: (file) => file.endsWith(".deb") },
      { label: "Linux rpm", matches: (file) => file.endsWith(".rpm") },
    ],
    trayTarget: "linux-tray",
  },
];

const selectedPlatforms = platformFilter
  ? platforms.filter((platform) => platform.name === normalizePlatformName(platformFilter))
  : platforms;

if (platformFilter && selectedPlatforms.length === 0) {
  throw new Error(`Unsupported platform filter: ${platformFilter}`);
}

const status = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  serviceOnly,
  platform: platformFilter ? normalizePlatformName(platformFilter) : "all",
  assetDir,
  guides: {
    remote: hasFile("remote-verification.md") ? "remote-verification.md" : null,
    tray: hasFile("tray-verification.md") ? "tray-verification.md" : null,
    release: hasFile("release-verification.md") ? "release-verification.md" : null,
  },
  platforms: selectedPlatforms.map(platformStatus),
};
status.overall = status.platforms.every((platform) => platform.blockers.length === 0)
  ? "ready"
  : "incomplete";

const rendered = jsonOutput ? `${JSON.stringify(status, null, 2)}\n` : renderMarkdown(status);
if (outputPath) {
  writeFileSync(resolve(outputPath), rendered);
}
process.stdout.write(rendered);

function platformStatus(platform) {
  const service = findJson(`service-verification-${platform.name}`);
  const lifecycle = findJson(`service-lifecycle-${platform.name}`);
  const lanPreflight = findJson(`lan-preflight-${platform.name}`);
  const remote = findJson(`remote-client-verification-${platform.name}`);
  const tray = findJson(`tray-verification-${platform.name}`);
  const manifest = findJson(`agentwatch-release-manifest-${platform.name}`);
  const performance = findJson(`performance-comparison-${platform.name}`);
  const audit = findAuditPlatform(platform.name);
  const packageFilesByRule = platform.packageRules.map((rule) => ({
    rule,
    files: files.filter(rule.matches),
  }));
  const packages = packageFilesByRule.flatMap((entry) => entry.files);
  const packageErrors = serviceOnly
    ? []
    : packageFilesByRule
        .filter((entry) => entry.files.length === 0)
        .map((entry) => `${entry.rule.label} missing`);
  const headlessErrors = hasFile(platform.headless) ? [] : ["headless Rust monitor binary missing"];
  const manifestErrors = validateManifest(platform, manifest?.data, packageFilesByRule);
  const performanceErrors = validatePerformance(platform, performance?.data);
  const serviceErrors = validateService(platform, service?.data);
  const lifecycleErrors = validateLifecycle(platform, lifecycle?.data);
  const lanPreflightErrors = validateLanPreflight(platform, lanPreflight?.data);
  const remoteErrors = validateRemote(platform, remote?.data);
  const trayErrors = serviceOnly ? [] : validateTray(platform, tray?.data);
  const auditErrors = validateAudit(audit);
  const checks = {
    package: serviceOnly
      ? "skipped"
      : packageErrors.length === 0
        ? "passed"
        : "missing",
    headless: headlessErrors.length === 0 ? "passed" : "missing",
    manifest: statusFromErrors(manifest, manifestErrors),
    performance: statusFromErrors(performance, performanceErrors),
    service: statusFromErrors(service, serviceErrors),
    lifecycle: statusFromErrors(lifecycle, lifecycleErrors),
    lanPreflight: statusFromErrors(lanPreflight, lanPreflightErrors),
    remote: statusFromErrors(remote, remoteErrors),
    tray: serviceOnly ? "skipped" : statusFromErrors(tray, trayErrors),
    audit: auditStatus(audit),
  };
  const issues = compactIssues({
    package: packageErrors,
    headless: headlessErrors,
    manifest: manifest ? manifestErrors : ["release manifest missing"],
    performance: performance ? performanceErrors : ["performance comparison missing"],
    service: service ? serviceErrors : ["service verification missing"],
    lifecycle: lifecycle ? lifecycleErrors : ["service lifecycle missing"],
    lanPreflight: lanPreflight ? lanPreflightErrors : ["LAN preflight missing"],
    remote: remote ? remoteErrors : ["remote client verification missing"],
    tray: serviceOnly ? [] : tray ? trayErrors : ["tray verification missing"],
    audit: auditErrors,
  }, checks);
  const blockers = [];
  for (const [key, value] of Object.entries(checks)) {
    if (key === "lanPreflight" && value === "missing") {
      continue;
    }
    if (value !== "passed" && value !== "skipped") {
      blockers.push(`${key}: ${value}`);
    }
  }
  return {
    name: platform.name,
    label: platform.label,
    checks,
    issues,
    blockers,
    nextGuide: nextGuide(checks),
  };
}

function nextGuide(checks) {
  if (checks.service !== "passed" || checks.lifecycle !== "passed") {
    return "release-verification.md";
  }
  if (!serviceOnly && checks.tray !== "passed") return "tray-verification.md";
  if (checks.remote !== "passed") return "remote-verification.md";
  return "release-verification.md";
}

function renderMarkdown(payload) {
  const lines = [
    "# AgentWatch Release Status",
    "",
    `Generated: ${payload.generatedAt}`,
    `Mode: ${payload.serviceOnly ? "service-only" : "desktop"}`,
    `Overall: ${payload.overall}`,
    "",
    "| Platform | Package | Headless | Manifest | Performance | Service | Lifecycle | LAN Preflight | Remote | Tray | Audit | Next |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const platform of payload.platforms) {
    const c = platform.checks;
    lines.push([
      platform.label,
      c.package,
      c.headless,
      c.manifest,
      c.performance,
      c.service,
      c.lifecycle,
      c.lanPreflight,
      c.remote,
      c.tray,
      c.audit,
      platform.nextGuide,
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  lines.push("", "## Blockers", "");
  for (const platform of payload.platforms) {
    lines.push(`- ${platform.label}: ${platform.blockers.length ? platform.blockers.join(", ") : "none"}`);
  }
  lines.push("", "## Issues", "");
  for (const platform of payload.platforms) {
    const entries = Object.entries(platform.issues || {}).filter(([, values]) => values.length > 0);
    if (entries.length === 0) {
      lines.push(`- ${platform.label}: none`);
      continue;
    }
    for (const [check, values] of entries) {
      lines.push(`- ${platform.label} ${check}: ${values.join(", ")}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function findAuditPlatform(platformName) {
  const audit = findJson("completion-audit");
  const platform = audit?.data?.platforms?.find((candidate) => candidate.name === platformName) || null;
  if (!audit || !platform) return null;
  return { ...platform, validServiceOnly: audit.data?.serviceOnly === serviceOnly };
}

function positionalArgs() {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--output" || arg === "--platform") {
      index += 1;
      continue;
    }
    if (!arg.startsWith("--")) values.push(arg);
  }
  return values;
}

function normalizePlatformName(value) {
  const lower = String(value || "").toLowerCase();
  if (lower.includes("mac") || lower === "darwin") return "macos";
  if (lower.includes("win")) return "windows";
  if (lower.includes("linux")) return "linux";
  return lower;
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

function readFiles(directory) {
  try {
    return readdirSync(directory).sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

function hasFile(file) {
  return files.includes(file);
}

function findJson(prefix) {
  const candidates = files.filter((file) => file.startsWith(prefix) && file.endsWith(".json"));
  candidates.sort((left, right) => scoreJsonCandidate(left, prefix) - scoreJsonCandidate(right, prefix) || left.localeCompare(right));
  for (const file of candidates) {
    try {
      return { file, data: JSON.parse(readFileSync(join(assetDir, file), "utf8")) };
    } catch {
      // Try the next matching candidate.
    }
  }
  return null;
}

function scoreJsonCandidate(file, prefix) {
  return file === `${prefix}.json` ? 0 : 1;
}

function statusFromErrors(report, errors) {
  if (!report) return "missing";
  return errors.length === 0 ? "passed" : "invalid";
}

function auditStatus(audit) {
  if (!audit) return "missing";
  if (!audit.validServiceOnly) return "invalid";
  return audit.status || "missing";
}

function validateAudit(audit) {
  const errors = [];
  if (!audit) return ["completion audit platform missing"];
  if (!audit.validServiceOnly) errors.push("serviceOnly mode mismatch");
  if (audit.status !== "passed") errors.push(`status is ${audit.status || "missing"}`);
  return errors;
}

function compactIssues(issueMap, checks) {
  const result = {};
  for (const [key, values] of Object.entries(issueMap)) {
    if (key === "lanPreflight" && checks[key] === "missing") continue;
    if (checks[key] === "passed" || checks[key] === "skipped") continue;
    result[key] = values;
  }
  return result;
}

function validateManifest(platform, data, packageFilesByRule) {
  const errors = [];
  const assets = Array.isArray(data?.assets) ? data.assets : [];
  if (data?.schemaVersion !== 1) errors.push("schemaVersion");
  if (data?.build?.platform !== platform.name) errors.push("platform");
  if (typeof data?.app?.version !== "string" || data.app.version.length === 0) errors.push("version");
  errors.push(...validateAutomatedGates(data?.automatedGates));
  if (assets.length === 0) errors.push("assets");
  for (const asset of assets) {
    if (!asset || typeof asset.name !== "string" || !files.includes(asset.name)) {
      errors.push("asset");
      continue;
    }
    const actual = assetEvidence(asset.name);
    if (asset.bytes !== actual.bytes || asset.sha256 !== actual.sha256) errors.push(asset.name);
  }
  if (hasFile(platform.headless) && !assets.some((asset) => asset.name === platform.headless)) {
    errors.push("headless");
  }
  if (!serviceOnly) {
    for (const { rule, files: matchedFiles } of packageFilesByRule) {
      if (matchedFiles.length > 0 && !matchedFiles.some((file) => assets.some((asset) => asset.name === file))) {
        errors.push(rule.label);
      }
    }
  }
  return errors;
}

function validateAutomatedGates(gates) {
  const errors = [];
  if (!Array.isArray(gates) || gates.length === 0) {
    return ["automatedGates"];
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
    if (!gates.includes(requiredGate)) errors.push(`automatedGates:${requiredGate}`);
  }
  return errors;
}

function validatePerformance(platform, data) {
  const errors = [];
  const benchmark = data?.benchmark || {};
  const headless = benchmark.rustHeadless || {};
  const python = benchmark.python || {};
  const desktop = benchmark.rustDesktop || {};
  const verdict = data?.performanceVerdict;
  const benchmarkSkipped = benchmark.status === "skipped" || verdict?.status === "skipped";
  if (data?.schemaVersion !== 1) errors.push("schemaVersion");
  if (data?.host?.platform && data.host.platform !== platform.hostPlatform) errors.push("host");
  if (benchmarkSkipped) {
    if (benchmark.status !== "skipped") errors.push("benchmark-status");
    if (typeof benchmark.error !== "string" || benchmark.error.length === 0) {
      errors.push("benchmark-error");
    }
    errors.push(...validatePerformanceVerdict(benchmark, verdict));
    return errors;
  }
  if (!serviceOnly && desktop.runtime !== "tauri-rust") errors.push("desktop");
  if (headless.runtime !== "rust-headless") errors.push("headless");
  if (headless.platform && headless.platform !== platform.runtimePlatform) errors.push("headlessPlatform");
  if (python.runtime !== "python") errors.push("python");
  const delta = benchmark.delta?.headlessVsPython;
  for (const metric of ["startupMs", "avgResponseMs", "p95ResponseMs"]) {
    if (typeof headless[metric] !== "number") errors.push(`headless-${metric}`);
    if (typeof python[metric] !== "number") errors.push(`python-${metric}`);
    if (typeof delta?.[metric]?.value !== "number") {
      errors.push(`delta-${metric}`);
    }
  }
  if (
    headless.rssMb !== null &&
    headless.rssMb !== undefined &&
    python.rssMb !== null &&
    python.rssMb !== undefined &&
    typeof delta?.rssMb?.value !== "number"
  ) {
    errors.push("delta-rssMb");
  }
  errors.push(...validatePerformanceVerdict(benchmark, verdict));
  return errors;
}

function validatePerformanceVerdict(benchmark, verdict) {
  const errors = [];
  const delta = benchmark.delta?.headlessVsPython;
  if (!verdict || typeof verdict !== "object") {
    errors.push("performanceVerdict");
  } else {
    if (!["passed", "failed", "skipped"].includes(verdict.status)) {
      errors.push("performanceVerdict-status");
    }
    if (verdict.comparison !== "headlessVsPython") errors.push("performanceVerdict-comparison");
    const requirements = Array.isArray(verdict.requirements) ? verdict.requirements : [];
    for (const metric of ["startupMs", "avgResponseMs", "p95ResponseMs", "rssMb"]) {
      const requirement = requirements.find((entry) => entry?.metric === metric);
      if (!requirement) {
        errors.push(`performanceVerdict-${metric}`);
        continue;
      }
      if (typeof requirement.passed !== "boolean") errors.push(`performanceVerdict-${metric}`);
      const expectedDelta = delta?.[metric]?.value;
      const actualDelta = requirement.actualDelta?.value;
      if (typeof expectedDelta === "number" && actualDelta !== expectedDelta) {
        errors.push(`performanceVerdict-${metric}-delta`);
      }
    }
  }
  return errors;
}

function validateService(platform, data) {
  const checks = data?.automatedChecks || {};
  const errors = [];
  if (data?.manualResult !== "passed") errors.push("manualResult");
  if (checks.runtime !== "rust-headless") errors.push("runtime");
  if (checks.trayEnabled !== false) errors.push("tray");
  if (checks.bindHost !== "0.0.0.0") errors.push("bindHost");
  if (checks.platform && checks.platform !== platform.runtimePlatform) errors.push("platform");
  for (const field of ["healthz", "runtimeEndpoint", "snapshotEndpoint", "usageEndpoint", "lanUrlReachable", "serviceRegistered", "loginStartContract"]) {
    if (checks[field] !== "passed") errors.push(field);
  }
  if (!Number.isInteger(checks.usageProviderCount) || checks.usageProviderCount <= 0) errors.push("usageProviderCount");
  errors.push(...validateProviderHistoryChecks(checks));
  return errors;
}

function validateLifecycle(platform, data) {
  const errors = [];
  if (data?.schemaVersion !== 1) errors.push("schemaVersion");
  if (data?.result !== "passed") errors.push("result");
  if (data?.host?.platform && data.host.platform !== platform.hostPlatform) errors.push("host");
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  for (const name of ["uninstall", "uninstallClean", "install", "verifyService", "reinstallHealthy"]) {
    if (!steps.some((step) => step.name === name && step.status === "passed")) errors.push(name);
  }
  return errors;
}

function validateLanPreflight(platform, data) {
  const errors = [];
  const checks = data?.checks || {};
  if (data?.schemaVersion !== 1) errors.push("schemaVersion");
  if (data?.readyForRemoteViewer !== true) errors.push("readyForRemoteViewer");
  if (data?.reachable !== true) errors.push("reachable");
  if (checks.healthz?.ok !== true) errors.push("healthz");
  if (checks.runtime?.ok !== true) errors.push("runtime");
  if (checks.bindHost?.ok !== true || checks.bindHost?.value !== "0.0.0.0") errors.push("bindHost");
  if (checks.lanUrl?.ok !== true || !isLanUrl(checks.lanUrl?.value)) errors.push("lanUrl");
  if (checks.lanHealthz?.ok !== true || !isLanHealthzUrl(checks.lanHealthz?.url)) errors.push("lanHealthz");
  if (checks.dashboard?.ok !== true) errors.push("dashboard");
  if (checks.remoteCheck?.ok !== true) errors.push("remoteCheck");
  if (data?.runtime?.runtime !== "rust-headless") errors.push("runtimeName");
  if (data?.runtime?.platform && data.runtime.platform !== platform.runtimePlatform) errors.push("platform");
  return errors;
}

function validateRemote(platform, data) {
  const checks = data?.automatedChecks || {};
  const errors = [];
  if (data?.schemaVersion !== 1) errors.push("schemaVersion");
  if (data?.result !== "passed") errors.push("result");
  if (!/^http:\/\/[^/]+:\d+/.test(data?.targetUrl || "") || /^http:\/\/(localhost|127\.|127\.0\.0\.1|\[?::1\]?)/i.test(data?.targetUrl || "")) {
    errors.push("targetUrl");
  }
  if (checks.runtime !== "rust-headless") errors.push("runtime");
  if (checks.trayEnabled !== false) errors.push("tray");
  if (checks.bindHost !== "0.0.0.0") errors.push("bindHost");
  if (checks.sameHost !== false) errors.push("sameHost");
  if (checks.platform && checks.platform !== platform.runtimePlatform) errors.push("platform");
  for (const field of ["healthz", "runtimeEndpoint", "snapshotEndpoint", "usageEndpoint"]) {
    if (checks[field] !== "passed") errors.push(field);
  }
  if (!Number.isInteger(checks.usageProviderCount) || checks.usageProviderCount <= 0) errors.push("usageProviderCount");
  errors.push(...validateProviderHistoryChecks(checks));
  errors.push(...validateRemoteCheckChecks(checks));
  return errors;
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

function isLanHealthzUrl(value) {
  if (!isLanUrl(value)) return false;
  try {
    return new URL(value).pathname === "/healthz";
  } catch {
    return false;
  }
}

function validateTray(platform, data) {
  const checks = data?.automatedChecks || {};
  const manualChecks = Array.isArray(data?.manualChecks) ? data.manualChecks : [];
  const errors = [];
  if (data?.manualResult !== "passed") errors.push("manualResult");
  for (const id of requiredTrayManualCheckIds(platform.name)) {
    if (!manualChecks.some((check) => check.id === id && check.status === "passed")) {
      errors.push(id);
    }
  }
  if (data?.visualTarget !== platform.trayTarget) errors.push("visualTarget");
  if (checks.indicatorTarget !== platform.trayTarget) errors.push("indicatorTarget");
  if (checks.runtimeIndicatorTarget !== platform.trayTarget) errors.push("runtimeIndicatorTarget");
  if (checks.runtime !== "tauri-rust") errors.push("runtime");
  if (checks.trayEnabled !== true) errors.push("tray");
  if (checks.startsHiddenConfig !== "passed" && !trayConfigPassed(platform.name)) errors.push("startsHiddenConfig");
  if (checks.trayMenuContract !== "passed" && !trayConfigPassed(platform.name)) errors.push("trayMenuContract");
  if (checks.trayTooltipContract !== "passed" && !trayConfigPassed(platform.name)) errors.push("trayTooltipContract");
  if (checks.openDashboardContract !== "passed" && !trayConfigPassed(platform.name)) errors.push("openDashboardContract");
  if (checks.closeToTrayContract !== "passed" && !trayConfigPassed(platform.name)) errors.push("closeToTrayContract");
  if (
    platform.name === "windows" &&
    checks.windowsNoConsoleContract !== "passed" &&
    !trayConfigPassed(platform.name)
  ) {
    errors.push("windowsNoConsoleContract");
  }
  if (checks.platform && checks.platform !== platform.runtimePlatform) errors.push("platform");
  const screenshots = Array.isArray(data?.screenshots) ? data.screenshots : [];
  if (screenshots.length === 0) {
    errors.push("screenshots");
  }
  screenshots.forEach((screenshot, index) => {
    const label = `screenshot${index + 1}`;
    if (typeof screenshot?.path !== "string" || screenshot.path.length === 0) {
      errors.push(`${label}Path`);
    }
    if (!Number.isInteger(screenshot?.bytes) || screenshot.bytes <= 0) {
      errors.push(`${label}Bytes`);
    }
    if (typeof screenshot?.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(screenshot.sha256)) {
      errors.push(`${label}Sha256`);
    }
  });
  for (const field of ["healthz", "runtimeEndpoint", "snapshotEndpoint", "usageEndpoint"]) {
    if (checks[field] !== "passed") errors.push(field);
  }
  if (!Number.isInteger(checks.usageProviderCount) || checks.usageProviderCount <= 0) errors.push("usageProviderCount");
  errors.push(...validateProviderHistoryChecks(checks));
  return errors;
}

function validateProviderHistoryChecks(checks) {
  const errors = [];
  if (checks.providerHistoryEndpoint !== "passed") errors.push("providerHistoryEndpoint");
  if (!Number.isInteger(checks.providerHistoryCount) || checks.providerHistoryCount < 0) {
    errors.push("providerHistoryCount");
  }
  return errors;
}

function validateRemoteCheckChecks(checks) {
  const errors = [];
  if (checks.remoteCheckEndpoint !== "passed") errors.push("remoteCheckEndpoint");
  if (checks.remoteClient !== true) errors.push("remoteClient");
  if (checks.sameHostIp !== false) errors.push("sameHostIp");
  if (checks.loopback !== false) errors.push("loopback");
  if (typeof checks.clientIp !== "string" || checks.clientIp.length === 0) errors.push("clientIp");
  return errors;
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
  const expectedTarget = platforms.find((platform) => platform.name === platformName)?.trayTarget;
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
    checks.runtimeIndicatorTarget === expectedTarget
  );
}

function assetEvidence(file) {
  const content = readFileSync(join(assetDir, file));
  return {
    bytes: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}
