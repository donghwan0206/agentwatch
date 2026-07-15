import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { arch, platform as nodePlatform } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(
  process.env.AGENTWATCH_RELEASE_ROOT || dirname(fileURLToPath(import.meta.url)),
  process.env.AGENTWATCH_RELEASE_ROOT ? "." : "..",
);
const args = process.argv.slice(2);
const serviceOnly = args.includes("--service-only");
const assetDir = resolve(args.find((arg) => !arg.startsWith("--")) || "release-assets");
const platformName = normalizePlatform(process.env.RUNNER_OS || nodePlatform());

mkdirSync(assetDir, { recursive: true });

const copied = collectForPlatform(platformName);

if (copied.length === 0) {
  throw new Error(`No ${platformName} release assets were collected into ${assetDir}`);
}

for (const file of copied) {
  console.log(`release asset: ${file}`);
}

function collectForPlatform(platformName) {
  if (serviceOnly) {
    return [collectHeadlessServer(platformName)];
  }

  switch (platformName) {
    case "macos":
      return collectMacosAssets();
    case "windows":
      return collectWindowsAssets();
    case "linux":
      return collectLinuxAssets();
    default:
      throw new Error(`Unsupported release platform: ${platformName}`);
  }
}

function collectHeadlessServer(platformName) {
  switch (platformName) {
    case "macos":
      return copyRequired(headlessServerPath(false), "agentwatch-server-macOS");
    case "windows":
      return copyRequired(headlessServerPath(true), "agentwatch-server-Windows.exe");
    case "linux":
      return copyRequired(headlessServerPath(false), "agentwatch-server-Linux");
    default:
      throw new Error(`Unsupported release platform: ${platformName}`);
  }
}

function collectMacosAssets() {
  const copied = [];
  const appBundle = join(root, "src-tauri", "target", "release", "bundle", "macos", "AgentWatch.app");
  const appZip = join(assetDir, "AgentWatch-macOS.app.zip");
  if (!existsSync(appBundle)) {
    throw new Error(`macOS app bundle missing: ${appBundle}`);
  }
  const result = spawnSync("ditto", ["-c", "-k", "--keepParent", appBundle, appZip], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`ditto failed: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  copied.push(appZip);
  for (const file of listBundleFiles("dmg", (file) => file.toLowerCase().endsWith(".dmg"))) {
    copied.push(copyFile(file, basename(file)));
  }
  copied.push(...copyUpdaterPairs("macos", (file) => {
    const name = basename(file);
    return name.endsWith(".app.tar.gz") || name.endsWith(".app.tar.gz.sig");
  }));
  copied.push(copyRequired(headlessServerPath(false), "agentwatch-server-macOS"));
  return copied;
}

function collectWindowsAssets() {
  const copied = [];
  copied.push(...copyMatchingRequired(
    "nsis",
    (file) => file.toLowerCase().endsWith(".exe") && !basename(file).startsWith("agentwatch-server-"),
    "Windows NSIS installer",
  ));
  copied.push(...copyMatchingRequired(
    "msi",
    (file) => file.toLowerCase().endsWith(".msi"),
    "Windows MSI installer",
  ));
  copied.push(...copyUpdaterPairs("nsis", (file) => {
    const name = basename(file).toLowerCase();
    if (name.startsWith("agentwatch-server-")) return false;
    return name.endsWith(".exe") || name.endsWith(".exe.sig");
  }));
  copied.push(...copyUpdaterPairs("msi", (file) => {
    const name = basename(file).toLowerCase();
    return name.endsWith(".msi") || name.endsWith(".msi.sig");
  }));
  copied.push(copyRequired(headlessServerPath(true), "agentwatch-server-Windows.exe"));
  return copied;
}

function collectLinuxAssets() {
  const copied = [];
  for (const { target, label, suffix } of [
    { target: "appimage", label: "Linux AppImage package", suffix: ".AppImage" },
    { target: "deb", label: "Linux deb package", suffix: ".deb" },
    { target: "rpm", label: "Linux rpm package", suffix: ".rpm" },
  ]) {
    copied.push(...copyMatchingRequired(target, (file) => file.endsWith(suffix), label));
  }
  copied.push(...copyUpdaterPairs("appimage", (file) => {
    const name = basename(file);
    return name.endsWith(".AppImage") || name.endsWith(".AppImage.sig");
  }));
  copied.push(copyRequired(headlessServerPath(false), "agentwatch-server-Linux"));
  return copied;
}

function copyUpdaterPairs(target, predicate) {
  const directory = join(root, "src-tauri", "target", "release", "bundle", target);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .map((file) => join(directory, file))
    .filter((file) => statSync(file).isFile() && predicate(file))
    .sort((left, right) => left.localeCompare(right))
    .map((file) => copyFile(file, basename(file)));
}

function copyMatchingRequired(target, predicate, label) {
  const files = listBundleFiles(target, predicate);
  if (files.length === 0) {
    const directory = join(root, "src-tauri", "target", "release", "bundle", target);
    throw new Error(`${label} missing: ${directory}`);
  }
  return files.map((file) => copyFile(file, basename(file)));
}

function listBundleFiles(target, predicate) {
  const directory = join(root, "src-tauri", "target", "release", "bundle", target);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .map((file) => join(directory, file))
    .filter((file) => statSync(file).isFile() && predicate(file))
    .sort((left, right) => left.localeCompare(right));
}

function headlessServerPath(windows) {
  return join(root, "src-tauri", "target", "release", windows ? "agentwatch-server.exe" : "agentwatch-server");
}

function copyRequired(source, destinationName) {
  if (!existsSync(source)) {
    throw new Error(`required release asset missing: ${source}`);
  }
  return copyFile(source, destinationName);
}

function copyFile(source, destinationName) {
  const destination = join(assetDir, destinationName);
  copyFileSync(source, destination);
  return destination;
}

function normalizePlatform(value) {
  const lower = String(value || "").toLowerCase();
  if (lower.includes("mac") || lower === "darwin") return "macos";
  if (lower.includes("win")) return "windows";
  if (lower.includes("linux")) return "linux";
  return lower.replace(/[^a-z0-9]+/g, "-") || "unknown";
}
