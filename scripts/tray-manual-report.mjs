#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const sourcePath = getOptionValue("--source") || getOptionValue("--report");
const outputPath = getOptionValue("--output");
const manualNotes = getOptionValue("--manual-notes");
const checkUpdates = getOptionValues("--check").map(parseCheckUpdate);
const screenshotPaths = getOptionValues("--screenshot").map((path) => resolve(path));
const replaceScreenshots = args.includes("--replace-screenshots");

if (!sourcePath) {
  throw new Error("--source requires a tray verification JSON report");
}
if (!outputPath) {
  throw new Error("--output requires a destination report path");
}

const report = JSON.parse(readFileSync(resolve(sourcePath), "utf8"));
const platform = normalizePlatform(report.automatedChecks?.platform || report.host?.platform);
const requiredIds = requiredManualCheckIds(platform);
const manualChecks = mergeManualChecks(report.manualChecks, requiredIds, checkUpdates);
const screenshots = mergeScreenshots(report.screenshots, screenshotPaths, replaceScreenshots);

const completed = requiredIds.every((id) => manualChecks.some((check) => check.id === id && check.status === "passed"));
const failed = manualChecks.some((check) => check.status === "failed");
const manualResult = failed ? "failed" : completed ? "passed" : "pending";

const updated = {
  ...report,
  verifier: report.verifier || "scripts/tray-manual-report.mjs",
  manualResult,
  manualNotes: manualNotes ?? report.manualNotes ?? null,
  manualChecks,
  screenshots,
  manualUpdatedAt: new Date().toISOString(),
  manualUpdateSource: "scripts/tray-manual-report.mjs",
};

mkdirSync(dirname(resolve(outputPath)), { recursive: true });
writeFileSync(resolve(outputPath), `${JSON.stringify(updated, null, 2)}\n`);

console.log(`tray manual report written: ${resolve(outputPath)}`);
console.log(`Platform: ${platform}`);
console.log(`Manual result: ${manualResult}`);
console.log(`Passed checks: ${manualChecks.filter((check) => check.status === "passed").length}/${requiredIds.length}`);
console.log(`Screenshots: ${screenshots.length}`);

function mergeManualChecks(existingChecks, requiredIds, updates) {
  const byId = new Map();
  for (const check of Array.isArray(existingChecks) ? existingChecks : []) {
    if (typeof check?.id === "string" && check.id.length > 0) {
      byId.set(check.id, { ...check });
    }
  }
  for (const id of requiredIds) {
    if (!byId.has(id)) {
      byId.set(id, { id, label: id, status: "pending" });
    }
  }
  for (const update of updates) {
    if (!requiredIds.includes(update.id)) {
      throw new Error(`unknown manual check id for ${platform}: ${update.id}`);
    }
    const current = byId.get(update.id) || { id: update.id, label: update.id };
    byId.set(update.id, { ...current, status: update.status });
  }
  return [...byId.values()];
}

function mergeScreenshots(existingScreenshots, newPaths, replace) {
  const screenshots = replace ? [] : (Array.isArray(existingScreenshots) ? [...existingScreenshots] : []);
  const seen = new Set(screenshots.map((entry) => String(entry?.path || "")));
  for (const path of newPaths) {
    const evidence = readEvidenceFile(path);
    if (seen.has(evidence.path)) continue;
    screenshots.push(evidence);
    seen.add(evidence.path);
  }
  return screenshots;
}

function readEvidenceFile(path) {
  if (!existsSync(path)) {
    throw new Error(`screenshot does not exist: ${path}`);
  }
  const stat = statSync(path);
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error(`screenshot is not a non-empty file: ${path}`);
  }
  const content = readFileSync(path);
  return {
    path,
    bytes: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

function parseCheckUpdate(value) {
  const match = String(value || "").match(/^([A-Za-z0-9_-]+)=(passed|failed|pending)$/);
  if (!match) {
    throw new Error(`manual check must look like id=passed|failed|pending: ${value}`);
  }
  return { id: match[1], status: match[2] };
}

function requiredManualCheckIds(platformName) {
  const base = [
    "startsHidden",
    "trayIconVisible",
    "trayMenuItems",
    "trayTooltip",
    "openDashboard",
    "closeKeepsHealthz",
    "quitExitsApp",
    "lanUrlReachable",
  ];
  return platformName === "windows" ? base.concat("windowsNoConsole") : base;
}

function normalizePlatform(value) {
  const lower = String(value || "").toLowerCase();
  if (lower.includes("mac") || lower === "darwin") return "macos";
  if (lower.includes("win")) return "windows";
  if (lower.includes("linux")) return "linux";
  throw new Error(`unsupported tray report platform: ${value || "missing"}`);
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

function getOptionValues(name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${name} requires a value`);
    }
    values.push(value);
    index += 1;
  }
  return values;
}
