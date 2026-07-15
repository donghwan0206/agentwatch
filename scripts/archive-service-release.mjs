#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const inputDir = resolve(getOptionValue("--input") || args.find((arg) => !arg.startsWith("--")) || "release-assets-service-check");

if (!existsSync(inputDir) || !statSync(inputDir).isDirectory()) {
  throw new Error(`Service release asset directory missing: ${inputDir}`);
}

assertServiceReleaseReady(inputDir);

const platform = inferPlatform(inputDir);
const outputPath = resolve(
  getOptionValue("--output") ||
    join(dirname(inputDir), `agentwatch-service-release-${platform.label}.tar.gz`),
);

const result = spawnSync("tar", ["-C", inputDir, "-czf", outputPath, "."], {
  encoding: "utf8",
});
if (result.status !== 0) {
  throw new Error(`tar failed for ${inputDir}: ${result.stderr || result.stdout || `exit ${result.status}`}`);
}

console.log(`service release archive: ${outputPath}`);

function assertServiceReleaseReady(directory) {
  const entries = new Set(readdirSync(directory).filter((name) => name !== ".DS_Store"));
  const required = [
    "SHA256SUMS.txt",
    "release-verification.md",
    "service-quickstart.md",
    "release-summary.md",
    "release-status.json",
    "release-status.md",
    "release-next-steps.md",
    "remote-verification.md",
    "completion-audit.json",
    "completion-audit.md",
    "agentwatch-service-status.mjs",
    "agentwatch-lan-preflight.mjs",
    "agentwatch-verify-service.mjs",
    "agentwatch-verify-service-lifecycle.mjs",
    "agentwatch-verify-remote-client.mjs",
    "agentwatch-import-remote-report.mjs",
    "agentwatch-release-audit.mjs",
    "agentwatch-release-readiness.mjs",
    "agentwatch-release-status.mjs",
    "agentwatch-release-next-steps.mjs",
    "agentwatch-refresh-release-evidence.mjs",
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
  ];
  for (const file of required) {
    if (!entries.has(file)) {
      throw new Error(`Service release artifact ${basename(directory)} is missing ${file}`);
    }
  }

  if (!["agentwatch-server-macOS", "agentwatch-server-Windows.exe", "agentwatch-server-Linux"].some((file) => entries.has(file))) {
    throw new Error(`Service release artifact ${basename(directory)} is missing a headless Rust monitor binary`);
  }
}

function inferPlatform(directory) {
  const entries = new Set(readdirSync(directory));
  if (entries.has("agentwatch-server-macOS") || hasManifest(entries, "macos")) {
    return { name: "macos", label: "macOS" };
  }
  if (entries.has("agentwatch-server-Windows.exe") || hasManifest(entries, "windows")) {
    return { name: "windows", label: "Windows" };
  }
  if (entries.has("agentwatch-server-Linux") || hasManifest(entries, "linux")) {
    return { name: "linux", label: "Linux" };
  }
  throw new Error(`Cannot infer service release platform from ${directory}`);
}

function hasManifest(entries, platform) {
  return entries.has(`agentwatch-release-manifest-${platform}.json`);
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
