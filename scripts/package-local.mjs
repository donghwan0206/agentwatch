import { spawnSync } from "node:child_process";
import { platform as nodePlatform } from "node:os";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipBuild = args.includes("--skip-build");
const desktop = args.includes("--desktop") || args.includes("--app");
const serviceOnly = !desktop;
const includeDmg = args.includes("--dmg") || args.includes("--mac-dmg");
const assetDir = optionValue("--assets") || "release-assets";
const platformName = normalizePlatform(
  optionValue("--platform") || process.env.AGENTWATCH_PACKAGE_PLATFORM || nodePlatform(),
);

if (desktop && args.includes("--service-only")) {
  throw new Error("--desktop and --service-only cannot be used together");
}
if (!desktop && includeDmg) {
  throw new Error("--dmg requires --desktop");
}

const buildScript = {
  macos: includeDmg ? "build:mac:release" : "build:mac",
  windows: "build:windows",
  linux: "build:linux",
}[platformName];

if (!buildScript) {
  throw new Error(`Unsupported package platform: ${platformName}`);
}

const commands = [];
if (!skipBuild) {
  commands.push(["npm", ["run", "build:server"]]);
  if (desktop) {
    commands.push(["npm", ["run", buildScript]]);
  }
}
commands.push([
  "npm",
  ["run", "smoke:headless"],
  { AGENTWATCH_HEADLESS_SMOKE_LAN_PREFLIGHT_REPORT: `${assetDir}/lan-preflight-${platformName}.json` },
]);
commands.push(["npm", ["run", serviceOnly ? "bench:report:service" : "bench:report", "--", assetDir]]);
if (desktop && platformName !== "linux") {
  commands.push(["node", ["scripts/verify-tray-config.mjs", "--output-dir", assetDir]]);
}
commands.push(["npm", ["run", "release:collect", "--", assetDir].concat(serviceOnly ? ["--service-only"] : [])]);
commands.push(["npm", ["run", "release:finalize", "--", assetDir].concat(serviceOnly ? ["--service-only"] : [])]);
commands.push(["npm", ["run", "release:manifest", "--", assetDir]]);
commands.push(["npm", ["run", "release:status", "--", assetDir, "--platform", platformName, "--json", "--output", `${assetDir}/release-status.json`].concat(serviceOnly ? ["--service-only"] : [])]);
commands.push(["npm", ["run", "release:status", "--", assetDir, "--platform", platformName, "--output", `${assetDir}/release-status.md`].concat(serviceOnly ? ["--service-only"] : [])]);
commands.push(["npm", ["run", "release:next-steps", "--", "--assets", assetDir, "--output", `${assetDir}/release-next-steps.md`].concat(serviceOnly ? ["--service-only"] : [])]);
commands.push(["npm", ["run", "release:manifest", "--", assetDir]]);
commands.push(["npm", ["run", "release:finalize", "--", assetDir, "--checksums-only"].concat(serviceOnly ? ["--service-only"] : [])]);

for (const [command, commandArgs, commandEnv] of commands) {
  if (dryRun) {
    const envPrefix = commandEnv
      ? Object.entries(commandEnv).map(([key, value]) => `${key}=${value}`).join(" ")
      : "";
    console.log([envPrefix, command, ...commandArgs].filter(Boolean).join(" "));
    continue;
  }

  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    env: commandEnv ? { ...process.env, ...commandEnv } : process.env,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!dryRun) {
  console.log(`local package assets ready: ${assetDir}`);
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

function normalizePlatform(value) {
  const lower = String(value || "").toLowerCase();
  if (lower.includes("mac") || lower === "darwin") return "macos";
  if (lower.includes("win")) return "windows";
  if (lower.includes("linux")) return "linux";
  return lower.replace(/[^a-z0-9]+/g, "-") || "unknown";
}
