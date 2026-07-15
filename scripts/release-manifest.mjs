import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { arch, platform as nodePlatform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetDir = resolve(process.argv[2] || "release-assets");
const platformName = normalizePlatform(process.env.RUNNER_OS || nodePlatform());
const outputPath = resolve(
  process.env.AGENTWATCH_RELEASE_MANIFEST ||
    join(assetDir, `agentwatch-release-manifest-${platformName}.json`),
);

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const cargoToml = readFileSync(join(root, "src-tauri", "Cargo.toml"), "utf8");
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1] || null;
const files = collectAssets(assetDir, outputPath);

if (files.length === 0) {
  throw new Error(`No release assets found in ${assetDir}`);
}

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  app: {
    name: packageJson.name,
    version: packageJson.version,
    cargoVersion,
  },
  build: {
    platform: platformName,
    runnerOs: process.env.RUNNER_OS || null,
    runnerArch: process.env.RUNNER_ARCH || arch(),
    node: process.version,
    gitSha: process.env.GITHUB_SHA || null,
    gitRef: process.env.GITHUB_REF_NAME || process.env.GITHUB_REF || null,
    workflowRunId: process.env.GITHUB_RUN_ID || null,
  },
  assets: files,
  automatedGates: [
    "npm test",
    "headless Rust monitor build",
    "headless smoke test",
    "LAN preflight against advertised LAN /healthz",
    "Rust-vs-Python performance comparison",
    "native desktop package build when desktop packaging is enabled",
    "packaged desktop runtime smoke test when desktop packaging is enabled",
    "packaged desktop fallback-port smoke test when desktop packaging is enabled",
    "service installer dry-run on CI runners",
    "release asset collection",
    "release manifest/checksum finalization",
    "release readiness automated gate",
  ],
  manualDesktopGates: [
    "tray/menu-bar enabled app starts with the main window hidden",
    "tray/menu-bar icon is visible on a real desktop session",
    "tray menu shows Runtime, Local, LAN, Open dashboard, and Quit",
    "tray tooltip includes status, process count, CPU, Local URL, and LAN URL",
    "Open dashboard brings the existing window to the front",
    "closing the main window hides it while /healthz remains healthy",
    "Quit exits the app",
    "a second LAN device can open the reported LAN URL",
    "Windows release build starts without a console window",
  ],
};

writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`release manifest written: ${outputPath}`);

function collectAssets(directory, manifestPath) {
  const manifestFile = resolve(manifestPath);
  return readdirSync(directory)
    .map((name) => {
      const path = resolve(directory, name);
      return { name, path };
    })
    .filter(({ name, path }) => {
      if (path === manifestFile) return false;
      if (name.startsWith("agentwatch-release-manifest-")) return false;
      if (name === "SHA256SUMS.txt") return false;
      if (name === "release-verification.md") return false;
      if (name === "release-status.json") return false;
      if (name === "release-status.md") return false;
      if (name === "release-summary.md") return false;
      if (name === "remote-verification.md") return false;
      if (name === "tray-verification.md") return false;
      if (name === "completion-audit.json") return false;
      if (name === "completion-audit.md") return false;
      if (name.startsWith("agentwatch-") && name.endsWith(".mjs")) return false;
      if (name === "agentwatch-verify-tray.mjs") return false;
      if (name === "agentwatch-verify-service.mjs") return false;
      if (name === "agentwatch-verify-service-lifecycle.mjs") return false;
      if (name === "agentwatch-verify-remote-client.mjs") return false;
      if (name === "agentwatch-release-status.mjs") return false;
      if (name.startsWith("verify-tray-")) return false;
      if (name.startsWith("verify-service-")) return false;
      if (name.startsWith("verify-remote-")) return false;
      if (name.startsWith("install-service-")) return false;
      if (name.startsWith("uninstall-service-")) return false;
      if (name.startsWith("service-lifecycle-") && name.endsWith(".json")) return false;
      if (name.startsWith("service-verification-") && name.endsWith(".json")) return false;
      if (name.startsWith("remote-client-verification-") && name.endsWith(".json")) return false;
      if (name.startsWith("tray-verification-") && name.endsWith(".json")) return false;
      if (name.startsWith("performance-comparison-")) return false;
      return statSync(path).isFile();
    })
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(({ name, path }) => {
      const content = readFileSync(path);
      return {
        name,
        bytes: content.length,
        sha256: createHash("sha256").update(content).digest("hex"),
      };
    });
}

function normalizePlatform(value) {
  const lower = String(value || "").toLowerCase();
  if (lower.includes("mac") || lower === "darwin") return "macos";
  if (lower.includes("win")) return "windows";
  if (lower.includes("linux")) return "linux";
  return lower.replace(/[^a-z0-9]+/g, "-") || "unknown";
}
