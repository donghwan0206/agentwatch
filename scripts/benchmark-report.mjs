import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, hostname, platform as nodePlatform, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const serviceOnly = args.includes("--service-only");
const fromJson = argValue("--from-json");
const assetDir = resolve(positionalArgs()[0] || "release-assets");
const platformName = normalizePlatform(process.env.RUNNER_OS || nodePlatform());
const jsonPath = join(assetDir, `performance-comparison-${platformName}.json`);
const markdownPath = join(assetDir, `performance-comparison-${platformName}.md`);

mkdirSync(assetDir, { recursive: true });

const comparison = fromJson ? readComparison(fromJson) : await runBenchmarkCompare();
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  host: {
    hostname: hostname(),
    platform: nodePlatform(),
    release: release(),
    arch: arch(),
  },
  benchmark: comparison,
  performanceVerdict: buildPerformanceVerdict(comparison),
};

writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(markdownPath, renderMarkdown(report));

console.log(`performance comparison written: ${jsonPath}`);
console.log(`performance summary written: ${markdownPath}`);

async function runBenchmarkCompare() {
  const { stdout, stderr } = await execFileAsync("node", ["scripts/benchmark-compare.mjs"].concat(serviceOnly ? ["--service-only"] : []), {
    cwd: root,
    env: process.env,
    maxBuffer: 1024 * 1024 * 16,
  });
  if (stderr.trim()) {
    process.stderr.write(stderr);
  }
  return JSON.parse(stdout);
}

function renderMarkdown(report) {
  const { benchmark } = report;
  const rows = [
    ...(benchmark.rustDesktop ? [["Rust desktop", benchmark.rustDesktop]] : []),
    ["Rust headless", benchmark.rustHeadless],
    ["Python", benchmark.python],
  ];
  return [
    "# AgentWatch Performance Comparison",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Host: ${report.host.platform} ${report.host.release} ${report.host.arch}`,
    "",
    "| Runtime | Startup ms | Avg response ms | P95 response ms | RSS MB | Status | Active processes |",
    "| --- | ---: | ---: | ---: | ---: | --- | ---: |",
    ...rows.map(([label, data]) =>
      [
        label,
        data.startupMs,
        data.avgResponseMs,
        data.p95ResponseMs,
        data.rssMb ?? "n/a",
        data.status ?? "n/a",
        data.activeProcessCount ?? "n/a",
      ].join(" | "),
    ).map((row) => `| ${row} |`),
    "",
    "## Verdict",
    "",
    `Status: ${report.performanceVerdict.status}`,
    "",
    ...report.performanceVerdict.requirements.map(
      (requirement) =>
        `- ${requirement.label}: ${requirement.passed ? "passed" : "failed"} (${formatDelta(requirement.actualDelta)})`,
    ),
    "",
    "## Delta vs Python",
    "",
    "Negative values mean the Rust runtime measured lower than Python on this machine.",
    "",
    "| Comparison | Startup ms | Avg response ms | P95 response ms | RSS MB |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...(benchmark.delta.desktopVsPython ? [deltaRow("Desktop vs Python", benchmark.delta.desktopVsPython)] : []),
    deltaRow("Headless vs Python", benchmark.delta.headlessVsPython),
    "",
    benchmark.note,
    "",
  ].join("\n");
}

function buildPerformanceVerdict(benchmark) {
  const comparison = benchmark?.delta?.headlessVsPython ?? {};
  const requirements = [
    verdictRequirement("startupMs", comparison.startupMs, "Rust headless startup lower than Python"),
    verdictRequirement("avgResponseMs", comparison.avgResponseMs, "Rust headless average response lower than Python"),
    verdictRequirement("p95ResponseMs", comparison.p95ResponseMs, "Rust headless p95 response lower than Python"),
    verdictRequirement("rssMb", comparison.rssMb, "Rust headless RSS lower than Python"),
  ];
  return {
    status: requirements.every((requirement) => requirement.passed) ? "passed" : "failed",
    comparison: "headlessVsPython",
    requirements,
  };
}

function verdictRequirement(metric, delta, label) {
  const value = delta && typeof delta.value === "number" ? delta.value : null;
  return {
    metric,
    label,
    actualDelta: delta ?? null,
    passed: typeof value === "number" && value < 0,
  };
}

function deltaRow(label, data) {
  return `| ${label} | ${formatDelta(data.startupMs)} | ${formatDelta(data.avgResponseMs)} | ${formatDelta(data.p95ResponseMs)} | ${formatDelta(data.rssMb)} |`;
}

function formatDelta(delta) {
  if (!delta || typeof delta.value !== "number") return "n/a";
  const percent = typeof delta.percent === "number" ? ` (${delta.percent}%)` : "";
  return `${delta.value}${percent}`;
}

function normalizePlatform(value) {
  const lower = String(value || "").toLowerCase();
  if (lower.includes("mac") || lower === "darwin") return "macos";
  if (lower.includes("win")) return "windows";
  if (lower.includes("linux")) return "linux";
  return lower.replace(/[^a-z0-9]+/g, "-") || "unknown";
}

function readComparison(path) {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

function argValue(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function positionalArgs() {
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--from-json") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) continue;
    positional.push(arg);
  }
  return positional;
}
