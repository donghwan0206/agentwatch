import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(
  process.env.AGENTWATCH_RELEASE_ROOT || scriptDir,
  process.env.AGENTWATCH_RELEASE_ROOT ? "." : "..",
);
const args = process.argv.slice(2);
const serviceOnly = args.includes("--service-only");
const checksumsOnly = args.includes("--checksums-only");
const assetDir = resolve(args.find((arg) => !arg.startsWith("--")) || "release-assets");

mkdirSync(assetDir, { recursive: true });

const commonFiles = [
  ["docs/release-verification.md", "release-verification.md"],
  ["docs/service-quickstart.md", "service-quickstart.md"],
  ["scripts/verify-service.mjs", "agentwatch-verify-service.mjs"],
  ["scripts/verify-service-lifecycle.mjs", "agentwatch-verify-service-lifecycle.mjs"],
  ["scripts/service-status.mjs", "agentwatch-service-status.mjs"],
  ["scripts/lan-preflight.mjs", "agentwatch-lan-preflight.mjs"],
  ["scripts/verify-remote-client.mjs", "agentwatch-verify-remote-client.mjs"],
  ["scripts/import-remote-report.mjs", "agentwatch-import-remote-report.mjs"],
  ["scripts/release-audit.mjs", "agentwatch-release-audit.mjs"],
  ["scripts/release-readiness.mjs", "agentwatch-release-readiness.mjs"],
  ["scripts/release-status.mjs", "agentwatch-release-status.mjs"],
  ["scripts/release-next-steps.mjs", "agentwatch-release-next-steps.mjs"],
  ["scripts/refresh-release-evidence.mjs", "agentwatch-refresh-release-evidence.mjs"],
  ["scripts/verify-remote-macos.sh", "verify-remote-macos.sh"],
  ["scripts/verify-remote-linux.sh", "verify-remote-linux.sh"],
  ["scripts/verify-remote-windows.cmd", "verify-remote-windows.cmd"],
  ["scripts/verify-remote-windows.ps1", "verify-remote-windows.ps1"],
  ["scripts/verify-service-macos.sh", "verify-service-macos.sh"],
  ["scripts/verify-service-linux.sh", "verify-service-linux.sh"],
  ["scripts/verify-service-windows.cmd", "verify-service-windows.cmd"],
  ["scripts/verify-service-windows.ps1", "verify-service-windows.ps1"],
  ["scripts/install-service-macos.sh", "install-service-macos.sh"],
  ["scripts/uninstall-service-macos.sh", "uninstall-service-macos.sh"],
  ["scripts/install-service-linux.sh", "install-service-linux.sh"],
  ["scripts/uninstall-service-linux.sh", "uninstall-service-linux.sh"],
  ["scripts/install-service-windows.ps1", "install-service-windows.ps1"],
  ["scripts/uninstall-service-windows.ps1", "uninstall-service-windows.ps1"],
];

const desktopFiles = [
  ["scripts/import-tray-report.mjs", "agentwatch-import-tray-report.mjs"],
  ["scripts/tray-manual-report.mjs", "agentwatch-tray-manual-report.mjs"],
  ["scripts/verify-tray.mjs", "agentwatch-verify-tray.mjs"],
  ["scripts/verify-tray-config.mjs", "agentwatch-verify-tray-config.mjs"],
  ["scripts/verify-tray-macos.sh", "verify-tray-macos.sh"],
  ["scripts/verify-tray-macos-capture.sh", "verify-tray-macos-capture.sh"],
  ["scripts/verify-tray-linux.sh", "verify-tray-linux.sh"],
  ["scripts/verify-tray-linux-capture.sh", "verify-tray-linux-capture.sh"],
  ["scripts/verify-tray-windows.cmd", "verify-tray-windows.cmd"],
  ["scripts/verify-tray-windows.ps1", "verify-tray-windows.ps1"],
  ["scripts/verify-tray-windows-capture.ps1", "verify-tray-windows-capture.ps1"],
];

if (!checksumsOnly) {
  const requiredFiles = serviceOnly ? commonFiles : commonFiles.concat(desktopFiles);

  for (const [source, destination] of requiredFiles) {
    copyFileSync(join(root, source), join(assetDir, destination));
  }

  if (serviceOnly) {
    removeDesktopOnlyFiles(assetDir);
  }

  const summary = spawnSync("node", [join(scriptDir, "release-summary.mjs"), assetDir].concat(serviceOnly ? ["--service-only"] : []), {
    encoding: "utf8",
  });
  if (summary.status !== 0) {
    throw new Error(`release summary failed: ${summary.stderr || summary.stdout || `exit ${summary.status}`}`);
  }
  if (summary.stdout.trim()) {
    console.log(summary.stdout.trim());
  }

  const audit = spawnSync("node", [join(scriptDir, "release-audit.mjs"), assetDir].concat(serviceOnly ? ["--service-only"] : []), {
    encoding: "utf8",
  });
  if (audit.status !== 0) {
    throw new Error(`completion audit failed: ${audit.stderr || audit.stdout || `exit ${audit.status}`}`);
  }
  if (audit.stdout.trim()) {
    console.log(audit.stdout.trim());
  }

  const remoteGuide = spawnSync("node", [join(scriptDir, "release-remote-guide.mjs"), assetDir].concat(serviceOnly ? ["--service-only"] : []), {
    encoding: "utf8",
  });
  if (remoteGuide.status !== 0) {
    throw new Error(`remote verification guide failed: ${remoteGuide.stderr || remoteGuide.stdout || `exit ${remoteGuide.status}`}`);
  }
  if (remoteGuide.stdout.trim()) {
    console.log(remoteGuide.stdout.trim());
  }

  if (!serviceOnly) {
    const trayGuide = spawnSync("node", [join(scriptDir, "release-tray-guide.mjs"), assetDir], {
      encoding: "utf8",
    });
    if (trayGuide.status !== 0) {
      throw new Error(`tray verification guide failed: ${trayGuide.stderr || trayGuide.stdout || `exit ${trayGuide.status}`}`);
    }
    if (trayGuide.stdout.trim()) {
      console.log(trayGuide.stdout.trim());
    }
  }
}

const sums = collectFilesRecursive(assetDir)
  .filter((file) => file !== "SHA256SUMS.txt")
  .sort((left, right) => left.localeCompare(right))
  .map((file) => `${sha256(join(assetDir, file))}  ${file}`)
  .join("\n");

if (!sums) {
  throw new Error(`No release assets found in ${assetDir}`);
}

writeFileSync(join(assetDir, "SHA256SUMS.txt"), `${sums}\n`);
console.log(`release assets finalized: ${assetDir}`);

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function collectFilesRecursive(directory) {
  const files = [];
  for (const name of readdirSync(directory).sort((left, right) => left.localeCompare(right))) {
    const path = join(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...collectFilesRecursive(path));
    } else if (stat.isFile()) {
      files.push(relative(assetDir, path).replace(/\\/g, "/"));
    }
  }
  return files;
}

function removeDesktopOnlyFiles(directory) {
  const names = [
    "agentwatch-verify-tray.mjs",
    "agentwatch-verify-tray-config.mjs",
    "agentwatch-import-tray-report.mjs",
    "agentwatch-tray-manual-report.mjs",
    "tray-verification.md",
    "verify-tray-macos.sh",
    "verify-tray-macos-capture.sh",
    "verify-tray-linux.sh",
    "verify-tray-linux-capture.sh",
    "verify-tray-windows.cmd",
    "verify-tray-windows.ps1",
    "verify-tray-windows-capture.ps1",
  ];
  for (const name of names) {
    const path = join(directory, name);
    if (existsSync(path)) {
      rmSync(path, { force: true });
    }
  }
}
