import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

try {
  assertReportVerdict("passed", {
    startupMs: { value: -150, percent: -50 },
    avgResponseMs: { value: -2.1, percent: -70 },
    p95ResponseMs: { value: -4.4, percent: -80 },
    rssMb: { value: -12.5, percent: -40 },
  });

  assertReportVerdict("failed", {
    startupMs: { value: -150, percent: -50 },
    avgResponseMs: { value: 0.2, percent: 10 },
    p95ResponseMs: { value: -4.4, percent: -80 },
    rssMb: null,
  });

  console.log("benchmark-report tests ok");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

function assertReportVerdict(expectedStatus, headlessVsPython) {
  const dir = mkdtempSync(join(tmpdir(), "agentwatch-benchmark-report-"));
  try {
    const assetsDir = join(dir, "assets");
    const fixturePath = join(dir, "comparison.json");
    writeFileSync(fixturePath, `${JSON.stringify(comparisonFixture(headlessVsPython), null, 2)}\n`);

    const result = spawnSync(
      process.execPath,
      ["scripts/benchmark-report.mjs", "--service-only", "--from-json", fixturePath, assetsDir],
      { cwd: root, encoding: "utf8", env: { ...process.env, RUNNER_OS: "macOS" } },
    );
    assert.equal(result.status, 0, result.stderr);

    const report = JSON.parse(readFileSync(join(assetsDir, "performance-comparison-macos.json"), "utf8"));
    assert.equal(report.performanceVerdict.status, expectedStatus);
    assert.equal(report.performanceVerdict.comparison, "headlessVsPython");
    assert.equal(report.performanceVerdict.requirements.length, 4);

    const markdown = readFileSync(join(assetsDir, "performance-comparison-macos.md"), "utf8");
    assert.match(markdown, new RegExp(`Status: ${expectedStatus}`));
    assert.match(markdown, /Rust headless startup lower than Python/);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

function comparisonFixture(headlessVsPython) {
  return {
    rustDesktop: null,
    rustHeadless: {
      startupMs: 100,
      avgResponseMs: 1,
      p95ResponseMs: 2,
      rssMb: 20,
      status: "busy",
      activeProcessCount: 3,
    },
    python: {
      startupMs: 250,
      avgResponseMs: 3,
      p95ResponseMs: 6,
      rssMb: 32,
      status: "busy",
      activeProcessCount: 3,
    },
    delta: {
      desktopVsPython: null,
      headlessVsPython,
      headlessVsDesktop: null,
    },
    note:
      "Negative delta means the left runtime measured lower. Service-only mode compares the Rust monitor server against the Python development server without Tauri desktop overhead.",
  };
}
