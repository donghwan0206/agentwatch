import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const args = process.argv.slice(2);
const inputDir = resolve(getOptionValue("--input") || args.find((arg) => !arg.startsWith("--")) || "desktop-release-assets");
const outputDir = resolve(getOptionValue("--output") || "release-assets");

if (!existsSync(inputDir) || !statSync(inputDir).isDirectory()) {
  throw new Error(`Desktop release asset directory missing: ${inputDir}`);
}

mkdirSync(outputDir, { recursive: true });

const artifactDirs = readdirSync(inputDir)
  .map((name) => join(inputDir, name))
  .filter((path) => statSync(path).isDirectory())
  .sort((left, right) => left.localeCompare(right));

if (artifactDirs.length === 0) {
  throw new Error(`No desktop release artifact directories found in ${inputDir}`);
}

for (const artifactDir of artifactDirs) {
  assertNonEmptyDirectory(artifactDir);
  const platform = detectPlatform(artifactDir);
  assertDesktopBundleReady(artifactDir, platform);
  const archiveName = `${basename(artifactDir).replace(/^agentwatch-release-/i, "agentwatch-desktop-release-")}.tar.gz`;
  const archivePath = join(outputDir, archiveName);
  const result = spawnSync("tar", ["-C", artifactDir, "-czf", archivePath, "."], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`tar failed for ${artifactDir}: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  console.log(`desktop release archive: ${archivePath}`);
}

function assertNonEmptyDirectory(directory) {
  const entries = readdirSync(directory).filter((name) => name !== ".DS_Store");
  if (entries.length === 0) {
    throw new Error(`Desktop release artifact directory is empty: ${directory}`);
  }
}

function detectPlatform(directory) {
  const lower = basename(directory).toLowerCase();
  if (lower.includes("mac")) return "macos";
  if (lower.includes("win")) return "windows";
  if (lower.includes("linux")) return "linux";
  const entries = new Set(readdirSync(directory).filter((name) => name !== ".DS_Store"));
  if (entries.has("agentwatch-server-macOS")) return "macos";
  if (entries.has("agentwatch-server-Windows.exe")) return "windows";
  if (entries.has("agentwatch-server-Linux")) return "linux";
  throw new Error(`Cannot detect desktop artifact platform: ${directory}`);
}

function assertDesktopBundleReady(directory, platform) {
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
    "tray-verification.md",
    "completion-audit.json",
    "completion-audit.md",
    "agentwatch-verify-service.mjs",
    "agentwatch-verify-service-lifecycle.mjs",
    "agentwatch-service-status.mjs",
    "agentwatch-lan-preflight.mjs",
    "agentwatch-verify-remote-client.mjs",
    "agentwatch-import-remote-report.mjs",
    "agentwatch-import-tray-report.mjs",
    "agentwatch-tray-manual-report.mjs",
    "agentwatch-release-audit.mjs",
    "agentwatch-release-readiness.mjs",
    "agentwatch-release-status.mjs",
    "agentwatch-release-next-steps.mjs",
    "agentwatch-refresh-release-evidence.mjs",
    "agentwatch-verify-tray.mjs",
    "agentwatch-verify-tray-config.mjs",
    "verify-service-macos.sh",
    "verify-service-linux.sh",
    "verify-service-windows.cmd",
    "verify-service-windows.ps1",
    "verify-remote-macos.sh",
    "verify-remote-linux.sh",
    "verify-remote-windows.cmd",
    "verify-remote-windows.ps1",
    "verify-tray-macos.sh",
    "verify-tray-macos-capture.sh",
    "verify-tray-linux.sh",
    "verify-tray-linux-capture.sh",
    "verify-tray-windows.cmd",
    "verify-tray-windows.ps1",
    "verify-tray-windows-capture.ps1",
    "install-service-macos.sh",
    "uninstall-service-macos.sh",
    "install-service-linux.sh",
    "uninstall-service-linux.sh",
    "install-service-windows.ps1",
    "uninstall-service-windows.ps1",
  ];
  for (const file of required) {
    if (!entries.has(file)) {
      throw new Error(`Desktop release artifact ${basename(directory)} is missing ${file}`);
    }
  }

  for (const rule of platformAssetRules(platform)) {
    const matches = [...entries].filter(rule.matches);
    if (matches.length === 0) {
      throw new Error(`Desktop release artifact ${basename(directory)} is missing ${rule.label}`);
    }
  }
}

function platformAssetRules(platform) {
  switch (platform) {
    case "macos":
      return [
        { label: "AgentWatch-macOS.app.zip", matches: (file) => file === "AgentWatch-macOS.app.zip" },
        { label: "agentwatch-server-macOS", matches: (file) => file === "agentwatch-server-macOS" },
      ];
    case "windows":
      return [
        { label: "agentwatch-server-Windows.exe", matches: (file) => file === "agentwatch-server-Windows.exe" },
        {
          label: "Windows NSIS installer",
          matches: (file) => !file.startsWith("agentwatch-server-") && file.toLowerCase().endsWith(".exe"),
        },
        { label: "Windows MSI installer", matches: (file) => file.toLowerCase().endsWith(".msi") },
      ];
    case "linux":
      return [
        { label: "agentwatch-server-Linux", matches: (file) => file === "agentwatch-server-Linux" },
        { label: "Linux AppImage package", matches: (file) => file.endsWith(".AppImage") },
        { label: "Linux deb package", matches: (file) => file.endsWith(".deb") },
        { label: "Linux rpm package", matches: (file) => file.endsWith(".rpm") },
      ];
    default:
      throw new Error(`Unsupported desktop artifact platform: ${platform}`);
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
