#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outputDir = resolve(getOptionValue("--output-dir") || "release-assets");
const explicitReport = getOptionValue("--report");
const appPath = getOptionValue("--app");
const verifier = resolve(process.env.AGENTWATCH_TRAY_CONFIG_VERIFY_SCRIPT || join(root, "scripts", "verify-tray.mjs"));
const tempDir = mkdtempSync(join(tmpdir(), "agentwatch-tray-config-"));
const tempReport = join(tempDir, "tray-config-source.json");

try {
  const verifierArgs = [verifier, "--report", tempReport];
  if (appPath) {
    verifierArgs.push("--app", appPath);
  }
  const result = spawnSync(process.execPath, verifierArgs, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AGENTWATCH_VERIFY_HOLD_MS: "1",
      AGENTWATCH_MANUAL_RESULT: "pending",
    },
  });
  if (result.status !== 0) {
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    process.exit(result.status ?? 1);
  }

  const report = JSON.parse(readFileSync(tempReport, "utf8"));
  validateReport(report);
  const platform = normalizePlatform(report.automatedChecks?.platform || report.host?.platform);
  const outputPath = resolve(explicitReport || join(outputDir, `tray-config-verification-${platform}.json`));
  mkdirSync(dirname(outputPath), { recursive: true });
  const payload = {
    ...report,
    verifier: "scripts/verify-tray-config.mjs",
    sourceVerifier: report.verifier || "scripts/verify-tray.mjs",
    configOnly: true,
  };
  writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`tray config verification report: ${outputPath}`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function validateReport(report) {
  const checks = report?.automatedChecks || {};
  if (report?.manualResult !== "pending") {
    throw new Error(`expected pending manualResult, got ${report?.manualResult || "missing"}`);
  }
  if (checks.runtime !== "tauri-rust") {
    throw new Error(`runtime is ${checks.runtime || "missing"}, expected tauri-rust`);
  }
  if (checks.trayEnabled !== true) {
    throw new Error("trayEnabled is not true");
  }
  if (checks.startsHiddenConfig !== "passed") {
    throw new Error("startsHiddenConfig did not pass");
  }
  if (checks.trayMenuContract !== "passed") {
    throw new Error("trayMenuContract did not pass");
  }
  if (checks.trayTooltipContract !== "passed") {
    throw new Error("trayTooltipContract did not pass");
  }
  if (checks.openDashboardContract !== "passed") {
    throw new Error("openDashboardContract did not pass");
  }
  if (checks.closeToTrayContract !== "passed") {
    throw new Error("closeToTrayContract did not pass");
  }
  if (normalizePlatform(checks.platform || report.host?.platform) === "windows" && checks.windowsNoConsoleContract !== "passed") {
    throw new Error("windowsNoConsoleContract did not pass");
  }
  if (typeof checks.runtimeIndicatorTarget !== "string" || checks.runtimeIndicatorTarget.length === 0) {
    throw new Error("runtimeIndicatorTarget missing");
  }
}

function normalizePlatform(value) {
  const lower = String(value || "").toLowerCase();
  if (lower.includes("mac") || lower === "darwin") return "macos";
  if (lower.includes("win")) return "windows";
  if (lower.includes("linux")) return "linux";
  return lower.replace(/[^a-z0-9]+/g, "-") || "unknown";
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
