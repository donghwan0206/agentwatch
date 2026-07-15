import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const serviceOnly = args.includes("--service-only");
const assetDir = resolve(args.find((arg) => !arg.startsWith("--")) || "release-assets");
const outputPath = join(assetDir, "release-summary.md");
const files = readFiles(assetDir);

const platforms = [
  {
    name: "macos",
    label: "macOS",
    packages: (file) => file === "AgentWatch-macOS.app.zip" || file.endsWith(".dmg"),
    headless: "agentwatch-server-macOS",
  },
  {
    name: "windows",
    label: "Windows",
    packages: (file) =>
      !file.startsWith("agentwatch-server-") &&
      (file.toLowerCase().endsWith(".exe") || file.toLowerCase().endsWith(".msi")),
    headless: "agentwatch-server-Windows.exe",
  },
  {
    name: "linux",
    label: "Linux",
    packages: (file) => file.endsWith(".AppImage") || file.endsWith(".deb") || file.endsWith(".rpm"),
    headless: "agentwatch-server-Linux",
  },
];

const rows = platforms.map(summarizePlatform);

mkdirSync(assetDir, { recursive: true });
writeFileSync(outputPath, renderSummary(rows));
console.log(`release summary written: ${outputPath}`);

function summarizePlatform(platform) {
  const packages = files.filter(platform.packages);
  const manifest = findJson(`agentwatch-release-manifest-${platform.name}`);
  const performance = findJson(`performance-comparison-${platform.name}`);
  const performanceMarkdown = hasFile(`performance-comparison-${platform.name}.md`);
  const service = findServiceReport(platform.name);
  const lifecycle = findLifecycleReport(platform.name);
  const lanPreflight = findLanPreflightReport(platform.name);
  const remote = findRemoteClientReport(platform.name);
  const tray = findTrayReport(platform.name);
  return {
    platform: platform.label,
    packages: serviceOnly ? [] : packages,
    headless: hasFile(platform.headless),
    manifest: Boolean(manifest),
    performance: Boolean(performance && performanceMarkdown),
    performanceSummary: performanceSummary(performance?.data),
    serviceResult: service?.data?.manualResult || "missing",
    lifecycleResult: lifecycle?.data?.result || "missing",
    lanPreflightResult: lanPreflightResult(lanPreflight?.data),
    remoteResult: remote?.data?.result || "missing",
    trayResult: serviceOnly ? "not required" : tray?.data?.manualResult || "missing",
    trayScreenshots: Array.isArray(tray?.data?.screenshots) ? tray.data.screenshots.length : 0,
    blockers: blockers({ packages, platform, manifest, performance, performanceMarkdown, service, lifecycle, lanPreflight, remote, tray }),
  };
}

function blockers({ packages, platform, manifest, performance, performanceMarkdown, service, lifecycle, lanPreflight, remote, tray }) {
  const missing = [];
  if (!serviceOnly && packages.length === 0) missing.push("package");
  if (!hasFile(platform.headless)) missing.push("headless");
  if (!manifest) missing.push("manifest");
  if (!performance || !performanceMarkdown) missing.push("performance");
  if (service?.data?.manualResult !== "passed") missing.push("passed service report");
  if (lifecycle?.data?.result !== "passed") missing.push("passed service lifecycle");
  if (lanPreflight && lanPreflightResult(lanPreflight.data) !== "ready") missing.push("valid LAN preflight");
  if (remote?.data?.result !== "passed") missing.push("passed remote client report");
  if (!serviceOnly && tray?.data?.manualResult !== "passed") missing.push("passed tray report");
  return missing;
}

function renderSummary(rows) {
  return [
    "# AgentWatch Release Summary",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "| Platform | Packages | Headless | Manifest | Performance | Service result | Lifecycle | LAN preflight | Remote client | Tray result | Blockers |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) =>
      [
        row.platform,
        serviceOnly ? "not required" : row.packages.length ? row.packages.join("<br>") : "missing",
        mark(row.headless),
        mark(row.manifest),
        row.performance ? row.performanceSummary : "missing",
        row.serviceResult,
        row.lifecycleResult,
        row.lanPreflightResult,
        row.remoteResult,
        `${row.trayResult}${row.trayScreenshots ? ` (${row.trayScreenshots} screenshot)` : ""}`,
        row.blockers.length ? row.blockers.join(", ") : "none",
      ].join(" | "),
    ).map((row) => `| ${row} |`),
    "",
    serviceOnly
      ? "Service-only readiness does not require desktop app packages or tray reports. Final service readiness requires each platform's service report, service lifecycle report, and remote client report to be passed."
      : "Automated-only readiness can pass before service, remote-client, and tray reports, but final release readiness requires each platform's service report, service lifecycle report, remote client report, and tray report to be passed.",
    "",
  ].join("\n");
}

function performanceSummary(data) {
  const delta = data?.benchmark?.delta?.headlessVsPython;
  const avg = delta?.avgResponseMs?.percent;
  const p95 = delta?.p95ResponseMs?.percent;
  const rss = delta?.rssMb?.percent;
  if ([avg, p95, rss].every((value) => typeof value === "number")) {
    return `headless vs Python avg ${avg}%, p95 ${p95}%, RSS ${rss}%`;
  }
  return "present";
}

function mark(value) {
  return value ? "yes" : "missing";
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
  const file = files
    .filter((candidate) => candidate.startsWith(prefix) && candidate.endsWith(".json"))
    .sort((left, right) => scoreJsonCandidate(left, prefix) - scoreJsonCandidate(right, prefix) || left.localeCompare(right))[0];
  if (!file) return null;
  return { file, data: readJson(file) };
}

function scoreJsonCandidate(file, prefix) {
  return file === `${prefix}.json` ? 0 : 1;
}

function findTrayReport(platformName) {
  return findPreferredReport(`tray-verification-${platformName}`, (data) => data?.manualResult === "passed");
}

function findServiceReport(platformName) {
  return findPreferredReport(`service-verification-${platformName}`, (data) => data?.manualResult === "passed");
}

function findLifecycleReport(platformName) {
  return findPreferredReport(`service-lifecycle-${platformName}`, (data) => data?.result === "passed");
}

function findLanPreflightReport(platformName) {
  return findPreferredReport(`lan-preflight-${platformName}`, () => false);
}

function findRemoteClientReport(platformName) {
  return findPreferredReport(`remote-client-verification-${platformName}`, (data) => data?.result === "passed");
}

function findPreferredReport(prefix, isPassed) {
  const exactFile = `${prefix}.json`;
  if (files.includes(exactFile)) {
    return { file: exactFile, data: readJson(exactFile) };
  }
  const candidates = files
    .filter((file) => file.startsWith(prefix) && file.endsWith(".json"))
    .sort((left, right) => scoreJsonCandidate(left, prefix) - scoreJsonCandidate(right, prefix) || left.localeCompare(right));
  for (const file of candidates) {
    const data = readJson(file);
    if (isPassed(data)) return { file, data };
  }
  if (candidates.length > 0) {
    const file = candidates[0];
    return { file, data: readJson(file) };
  }
  return null;
}

function lanPreflightResult(data) {
  if (!data) return "missing";
  return data.readyForRemoteViewer === true && data.checks?.lanHealthz?.ok === true ? "ready" : "invalid";
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(join(assetDir, file), "utf8"));
  } catch {
    return null;
  }
}
