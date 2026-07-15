import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const args = process.argv.slice(2);
const inputDir = resolve(getOptionValue("--input") || args.find((arg) => !arg.startsWith("--")) || "service-release-assets");
const outputDir = resolve(getOptionValue("--output") || "release-assets");

if (!existsSync(inputDir) || !statSync(inputDir).isDirectory()) {
  throw new Error(`Service release asset directory missing: ${inputDir}`);
}

mkdirSync(outputDir, { recursive: true });

const artifactDirs = readdirSync(inputDir)
  .map((name) => join(inputDir, name))
  .filter((path) => statSync(path).isDirectory())
  .sort((left, right) => left.localeCompare(right));

if (artifactDirs.length === 0) {
  throw new Error(`No service release artifact directories found in ${inputDir}`);
}

for (const artifactDir of artifactDirs) {
  assertNonEmptyDirectory(artifactDir);
  assertServiceBundleReady(artifactDir);
  const archiveName = `${basename(artifactDir)}.tar.gz`;
  const archivePath = join(outputDir, archiveName);
  const result = spawnSync("tar", ["-C", artifactDir, "-czf", archivePath, "."], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`tar failed for ${artifactDir}: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  console.log(`service release archive: ${archivePath}`);
}

function assertNonEmptyDirectory(directory) {
  const entries = readdirSync(directory).filter((name) => name !== ".DS_Store");
  if (entries.length === 0) {
    throw new Error(`Service release artifact directory is empty: ${directory}`);
  }
}

function assertServiceBundleReady(directory) {
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
    "agentwatch-verify-service.mjs",
    "agentwatch-verify-service-lifecycle.mjs",
    "agentwatch-service-status.mjs",
    "agentwatch-lan-preflight.mjs",
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

  const serverFiles = [
    "agentwatch-server-macOS",
    "agentwatch-server-Windows.exe",
    "agentwatch-server-Linux",
  ];
  if (!serverFiles.some((file) => entries.has(file))) {
    throw new Error(`Service release artifact ${basename(directory)} is missing a headless Rust monitor binary`);
  }
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
