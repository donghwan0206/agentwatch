#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const args = process.argv.slice(2);
const serviceOnly = args.includes("--service-only") || process.env.AGENTWATCH_SERVICE_ONLY === "1";
const reportPath = getOptionValue("--report") || positionalArgs()[0];
const assetDir = resolve(getOptionValue("--assets") || positionalArgs()[1] || "release-assets");

if (!reportPath) {
  throw new Error("Usage: node scripts/import-remote-report.mjs --report <remote-client-verification.json> [--assets release-assets] [--platform macos|windows|linux] [--service-only]");
}

const report = readJson(resolve(reportPath));
const platformName = normalizePlatformName(
  getOptionValue("--platform") ||
    report.automatedChecks?.platform ||
    report.platform ||
    inferPlatformFromFilename(reportPath),
);
const platform = platformFor(platformName);
const errors = validateRemoteReport(platform, report);

if (errors.length > 0) {
  throw new Error(`Remote report invalid: ${errors.join("; ")}`);
}

mkdirSync(assetDir, { recursive: true });
const destination = join(assetDir, `remote-client-verification-${platform.name}.json`);
writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Imported remote report: ${destination}`);
console.log(`Remote client IP: ${report.automatedChecks.clientIp}`);
console.log(`Next: npm run release:refresh -- ${assetDir}${serviceOnly ? " --service-only" : ""} --platform ${platform.name} --check`);

function validateRemoteReport(platform, data) {
  const errors = [];
  const checks = data.automatedChecks || {};

  if (data.schemaVersion !== 1) {
    errors.push("schemaVersion is not 1");
  }
  if (data.result !== "passed") {
    errors.push("result is not passed");
  }
  if (typeof data.targetUrl !== "string" || !/^http:\/\/[^/]+:\d+/i.test(data.targetUrl)) {
    errors.push("targetUrl is missing or invalid");
  } else if (isLocalOnlyUrl(data.targetUrl)) {
    errors.push("targetUrl must be the agent machine LAN URL, not localhost, loopback, or 0.0.0.0");
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
    ["usageEndpoint", "usage endpoint check did not pass"],
    ["providerHistoryEndpoint", "provider history endpoint check did not pass"],
    ["remoteCheckEndpoint", "remote-check endpoint check did not pass"],
  ]) {
    if (checks[field] !== "passed") {
      errors.push(label);
    }
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
  if (checks.remoteClient !== true) {
    errors.push("server-side remote check did not prove a remote client");
  }
  if (checks.sameHost !== false) {
    errors.push("remote client ran on the same host as the service");
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
  if (!Number.isInteger(checks.port) || checks.port <= 0) {
    errors.push("port is missing or invalid");
  }
  if (typeof checks.localUrl !== "string" || !checks.localUrl.startsWith("http://127.0.0.1:")) {
    errors.push("localUrl is missing or invalid");
  }
  if (!Array.isArray(checks.lanUrls) || checks.lanUrls.length === 0) {
    errors.push("lanUrls is missing or invalid");
  }
  if (checks.platform && normalizePlatformName(checks.platform) !== platform.name) {
    errors.push(`runtime platform is ${checks.platform}, expected ${platform.runtimePlatform}`);
  }

  return errors;
}

function platformFor(value) {
  const normalized = normalizePlatformName(value);
  const platforms = {
    macos: { name: "macos", runtimePlatform: "macos" },
    windows: { name: "windows", runtimePlatform: "windows" },
    linux: { name: "linux", runtimePlatform: "linux" },
  };
  const platform = platforms[normalized];
  if (!platform) {
    throw new Error(`Unsupported or missing platform: ${value || "missing"}`);
  }
  return platform;
}

function inferPlatformFromFilename(path) {
  return basename(path).match(/remote-client-verification-([a-z0-9_-]+)\.json/i)?.[1] || "";
}

function isLocalOnlyUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "localhost" || host === "0.0.0.0" || host === "::1" || host.startsWith("127.");
  } catch {
    return true;
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read remote report ${path}: ${error.message}`);
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
  if (lower.includes("mac") || lower === "darwin") return "macos";
  if (lower.includes("win")) return "windows";
  if (lower.includes("linux")) return "linux";
  return lower;
}
