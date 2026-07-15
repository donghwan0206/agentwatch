import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const serviceOnly = args.includes("--service-only");
const assetDir = resolve(args.find((arg) => !arg.startsWith("--")) || "release-assets");
const files = readFiles(assetDir);

const platforms = [
  {
    name: "macos",
    label: "macOS",
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
    headless: "agentwatch-server-Linux",
    packageRules: [
      { label: "Linux AppImage", matches: (file) => file.endsWith(".AppImage") },
      { label: "Linux deb", matches: (file) => file.endsWith(".deb") },
      { label: "Linux rpm", matches: (file) => file.endsWith(".rpm") },
    ],
    trayTarget: "linux-tray",
  },
];

const audit = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  serviceOnly,
  assetDir,
  platforms: platforms.map(auditPlatform),
};

mkdirSync(assetDir, { recursive: true });
writeFileSync(join(assetDir, "completion-audit.json"), `${JSON.stringify(audit, null, 2)}\n`);
writeFileSync(join(assetDir, "completion-audit.md"), renderMarkdown(audit));
console.log(`completion audit written: ${join(assetDir, "completion-audit.md")}`);

function auditPlatform(platform) {
  const packageFilesByRule = platform.packageRules.map((rule) => ({
    rule,
    files: files.filter(rule.matches),
  }));
  const packages = packageFilesByRule.flatMap((entry) => entry.files);
  const manifest = findJson(`agentwatch-release-manifest-${platform.name}`);
  const performance = findJson(`performance-comparison-${platform.name}`);
  const service = findJson(`service-verification-${platform.name}`);
  const lifecycle = findJson(`service-lifecycle-${platform.name}`);
  const lanPreflight = findJson(`lan-preflight-${platform.name}`);
  const remote = findJson(`remote-client-verification-${platform.name}`);
  const tray = findJson(`tray-verification-${platform.name}`);
  const checks = [
    check(
      "rustHeadlessMonitor",
      "Rust headless monitor binary exists",
      hasFile(platform.headless),
      platform.headless,
    ),
    check(
      "rustFasterThanPython",
      "Rust headless benchmark is faster than Python",
      performanceIsFaster(performance?.data),
      performance?.file || "performance report missing",
    ),
    check(
      "serviceInstallable",
      "Background service install/start/LAN/uninstall evidence is passed",
      service?.data?.manualResult === "passed" && lifecycle?.data?.result === "passed",
      service?.file && lifecycle?.file ? `${service.file}, ${lifecycle.file}` : "service/lifecycle report missing",
    ),
    lanPreflightCheck(platform, lanPreflight),
    check(
      "browserLanRemote",
      "Dashboard is verified from another LAN browser machine",
      remote?.data?.result === "passed" && remote?.data?.automatedChecks?.sameHost === false,
      remote?.file || "remote client report missing",
    ),
    serviceOnly
      ? skip("desktopPackage", "Desktop app package is not required for service-only release")
      : check(
          "desktopPackage",
          "Desktop package exists for this OS",
          packageFilesByRule.every((entry) => entry.files.length > 0),
          packageFilesByRule
            .map((entry) => entry.files.length ? entry.files.join(", ") : `${entry.rule.label} missing`)
            .join("; "),
        ),
    serviceOnly
      ? skip("trayIndicator", "Tray/menu-bar indicator is not required for service-only release")
      : check(
          "trayIndicator",
          "Tray/menu-bar indicator evidence is passed",
          trayPassed(tray?.data, platform.trayTarget, platform.name),
          tray?.file || "tray report missing",
        ),
    check(
      "releaseManifest",
      "Release manifest exists for this OS",
      Boolean(manifest),
      manifest?.file || "manifest missing",
    ),
  ];
  return {
    name: platform.name,
    label: platform.label,
    status: checks.every((item) => item.status === "passed" || item.status === "skipped")
      ? "passed"
      : "incomplete",
    checks,
  };
}

function lanPreflightReady(data) {
  return (
    data?.readyForRemoteViewer === true &&
    data?.checks?.bindHost?.ok === true &&
    data?.checks?.lanUrl?.ok === true &&
    data?.checks?.lanHealthz?.ok === true &&
    data?.checks?.dashboard?.ok === true
  );
}

function check(id, label, passed, evidence) {
  return { id, label, status: passed ? "passed" : "missing", evidence };
}

function skip(id, label) {
  return { id, label, status: "skipped", evidence: "service-only release" };
}

function lanPreflightCheck(platform, lanPreflight) {
  const label = "Agent machine is ready for a second LAN browser";
  if (!lanPreflight && !hasFile(platform.headless)) {
    return { id: "lanPreflightReady", label, status: "skipped", evidence: "platform asset not present" };
  }
  return check(
    "lanPreflightReady",
    label,
    lanPreflightReady(lanPreflight?.data),
    lanPreflight?.file || "lan preflight report missing",
  );
}

function performanceIsFaster(data) {
  const delta = data?.benchmark?.delta?.headlessVsPython;
  return ["startupMs", "avgResponseMs", "p95ResponseMs"].every(
    (metric) => typeof delta?.[metric]?.value === "number" && delta[metric].value < 0,
  );
}

function trayPassed(data, expectedTarget, platformName) {
  const checks = data?.automatedChecks || {};
  return (
    data?.manualResult === "passed" &&
    manualChecksPassed(data?.manualChecks, platformName) &&
    data?.visualTarget === expectedTarget &&
    checks.indicatorTarget === expectedTarget &&
    checks.runtimeIndicatorTarget === expectedTarget &&
    checks.runtime === "tauri-rust" &&
    checks.trayEnabled === true &&
    (checks.startsHiddenConfig === "passed" || trayConfigPassed(platformName, expectedTarget)) &&
    Array.isArray(data.screenshots) &&
    data.screenshots.length > 0
  );
}

function manualChecksPassed(manualChecks, platformName) {
  if (!Array.isArray(manualChecks)) return false;
  return requiredTrayManualCheckIds(platformName).every((id) =>
    manualChecks.some((check) => check.id === id && check.status === "passed"),
  );
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

function trayConfigPassed(platformName, expectedTarget) {
  const report = findJson(`tray-config-verification-${platformName}`)?.data;
  const checks = report?.automatedChecks || {};
  return (
    report?.configOnly === true &&
    checks.runtime === "tauri-rust" &&
    checks.trayEnabled === true &&
    checks.startsHiddenConfig === "passed" &&
    checks.runtimeIndicatorTarget === expectedTarget
  );
}

function renderMarkdown(auditPayload) {
  const lines = [
    "# AgentWatch Completion Audit",
    "",
    `Generated: ${auditPayload.generatedAt}`,
    "",
    auditPayload.serviceOnly
      ? "Mode: Service-only release (LAN browser monitor)"
      : "Mode: desktop/package release with optional tray wrapper evidence",
    "",
  ];
  for (const platform of auditPayload.platforms) {
    lines.push(`## ${platform.label}: ${platform.status}`, "");
    lines.push("| Requirement | Status | Evidence |");
    lines.push("| --- | --- | --- |");
    for (const item of platform.checks) {
      lines.push(`| ${item.label} | ${item.status} | ${String(item.evidence).replaceAll("|", "\\|")} |`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
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
    const data = readJson(file);
    if (data) return { file, data };
  }
  return null;
}

function scoreJsonCandidate(file, prefix) {
  return file === `${prefix}.json` ? 0 : 1;
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(join(assetDir, file), "utf8"));
  } catch {
    return null;
  }
}
