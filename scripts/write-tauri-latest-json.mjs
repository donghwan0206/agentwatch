import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const input = resolve(optionValue("--input") || ".");
const output = optionValue("--output");
const fragmentOutput = optionValue("--fragment");
const fragmentsRoot = optionValue("--fragments");
const copyTo = optionValue("--copy-to");
const version = optionValue("--version") || process.env.GITHUB_REF_NAME?.replace(/^v/, "") || readPackageVersion();
const baseUrl = optionValue("--base-url");

if (fragmentsRoot) {
  writeCombinedLatestJson();
} else {
  writePlatformFragment();
}

function writePlatformFragment() {
  if (!fragmentOutput) {
    throw new Error("--fragment is required when --fragments is not used");
  }
  const platform = normalizePlatform(optionValue("--platform") || process.env.RUNNER_OS);
  const arch = normalizeArch(optionValue("--arch") || process.env.RUNNER_ARCH || process.arch);
  const platformKey = `${platform}-${arch}`;
  const pair = selectUpdaterPair(findUpdaterPairs(input), platform);
  if (!pair) {
    throw new Error(`No updater artifact/signature pair found for ${platformKey} in ${input}`);
  }
  const fragmentPath = resolve(fragmentOutput);
  mkdirSync(dirname(fragmentPath), { recursive: true });
  writeJson(fragmentPath, {
    version,
    platforms: {
      [platformKey]: {
        artifact: pair.artifact,
        signatureFile: pair.signatureFile,
        signature: readFileSync(pair.signaturePath, "utf8").trim(),
      },
    },
  });
  console.log(`tauri updater fragment: ${fragmentPath}`);
}

function writeCombinedLatestJson() {
  if (!output || !baseUrl) {
    throw new Error("--output and --base-url are required with --fragments");
  }
  const fragmentPaths = walk(resolve(fragmentsRoot)).filter((file) => basename(file) === "updater-fragment.json");
  if (fragmentPaths.length === 0) {
    throw new Error(`No updater-fragment.json files found in ${fragmentsRoot}`);
  }
  const latest = {
    version,
    notes: "",
    pub_date: new Date().toISOString(),
    platforms: {},
  };
  if (copyTo) {
    mkdirSync(resolve(copyTo), { recursive: true });
  }

  for (const fragmentPath of fragmentPaths.sort()) {
    const fragment = JSON.parse(readFileSync(fragmentPath, "utf8"));
    const fragmentDir = dirname(fragmentPath);
    for (const [platformKey, platformInfo] of Object.entries(fragment.platforms || {})) {
      const artifactPath = resolve(fragmentDir, platformInfo.artifact);
      const signaturePath = resolve(fragmentDir, platformInfo.signatureFile);
      if (!existsSync(artifactPath)) throw new Error(`Updater artifact missing: ${artifactPath}`);
      if (!existsSync(signaturePath)) throw new Error(`Updater signature missing: ${signaturePath}`);
      const assetName = basename(artifactPath);
      const sigName = basename(signaturePath);
      if (copyTo) {
        copyFileSync(artifactPath, join(resolve(copyTo), assetName));
        copyFileSync(signaturePath, join(resolve(copyTo), sigName));
      }
      latest.platforms[platformKey] = {
        signature: readFileSync(signaturePath, "utf8").trim(),
        url: `${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(assetName)}`,
      };
    }
  }

  const outputPath = resolve(output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeJson(outputPath, latest);
  console.log(`tauri latest.json: ${outputPath}`);
}

function findUpdaterPairs(root) {
  const files = walk(root);
  return files
    .filter((file) => file.endsWith(".sig"))
    .map((signaturePath) => {
      const artifactPath = signaturePath.slice(0, -4);
      if (!existsSync(artifactPath)) return null;
      return {
        artifact: relativeTo(input, artifactPath),
        artifactPath,
        signatureFile: relativeTo(input, signaturePath),
        signaturePath,
      };
    })
    .filter(Boolean);
}

function selectUpdaterPair(pairs, platform) {
  const candidates = pairs.filter((pair) => platformMatcher(platform, basename(pair.artifactPath)));
  return candidates.sort((left, right) => priority(platform, basename(left.artifactPath)) - priority(platform, basename(right.artifactPath)))[0] || null;
}

function platformMatcher(platform, name) {
  if (platform === "darwin") return name.endsWith(".app.tar.gz");
  if (platform === "windows") return name.endsWith(".exe") || name.endsWith(".msi");
  if (platform === "linux") return name.endsWith(".AppImage");
  return false;
}

function priority(platform, name) {
  if (platform === "windows" && name.endsWith(".exe")) return 0;
  if (platform === "windows" && name.endsWith(".msi")) return 1;
  return 0;
}

function walk(root) {
  if (!existsSync(root)) return [];
  const out = [];
  for (const entry of readdirSync(root)) {
    const file = join(root, entry);
    const stat = statSync(file);
    if (stat.isDirectory()) out.push(...walk(file));
    if (stat.isFile()) out.push(file);
  }
  return out;
}

function relativeTo(root, file) {
  const prefix = resolve(root) + "/";
  const resolved = resolve(file);
  return resolved.startsWith(prefix) ? resolved.slice(prefix.length) : resolved;
}

function normalizePlatform(value) {
  const lower = String(value || "").toLowerCase();
  if (lower.includes("mac") || lower === "darwin") return "darwin";
  if (lower.includes("win")) return "windows";
  if (lower.includes("linux")) return "linux";
  throw new Error(`Unsupported updater platform: ${value || "missing"}`);
}

function normalizeArch(value) {
  const lower = String(value || "").toLowerCase();
  if (["arm64", "aarch64"].includes(lower)) return "aarch64";
  if (["x64", "x86_64", "amd64"].includes(lower)) return "x86_64";
  if (["ia32", "i686"].includes(lower)) return "i686";
  if (lower === "armv7") return "armv7";
  throw new Error(`Unsupported updater arch: ${value || "missing"}`);
}

function readPackageVersion() {
  return JSON.parse(readFileSync("package.json", "utf8")).version;
}

function optionValue(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
