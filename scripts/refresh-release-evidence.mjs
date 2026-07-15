#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const checkReadiness = args.includes("--check");
const serviceOnly = args.includes("--service-only");
const platform = getOptionValue("--platform");
const assetDir = resolve(positionalArgs()[0] || "release-assets");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const packagedMode = basename(fileURLToPath(import.meta.url)).startsWith("agentwatch-");

const commands = packagedMode ? packagedCommands() : sourceCommands();

for (const [command, commandArgs] of commands) {
  runCommand(command, commandArgs);
}

if (packagedMode) {
  if (dryRun) {
    console.log(`write SHA256SUMS.txt for ${assetDir}`);
  } else {
    writeChecksums();
  }
}

if (checkReadiness) {
  runCommand(...readinessCommand());
}

if (!dryRun) {
  console.log(`release evidence refreshed: ${assetDir}`);
}

function runCommand(command, commandArgs) {
  if (dryRun) {
    console.log([command, ...commandArgs].join(" "));
    return;
  }
  const result = spawnSync(command, commandArgs, { stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function sourceCommands() {
  return [
    ["npm", ["run", "release:finalize", "--", assetDir].concat(serviceOnly ? ["--service-only"] : [])],
    ["npm", ["run", "release:manifest", "--", assetDir]],
    statusCommand({ json: true }),
    statusCommand({ json: false }),
    [
      "npm",
      ["run", "release:next-steps", "--", "--assets", assetDir, "--output", `${assetDir}/release-next-steps.md`]
        .concat(serviceOnly ? ["--service-only"] : []),
    ],
    ["npm", ["run", "release:finalize", "--", assetDir, "--checksums-only"].concat(serviceOnly ? ["--service-only"] : [])],
  ];
}

function packagedCommands() {
  return [
    ["node", [helperPath("agentwatch-release-audit.mjs"), assetDir].concat(serviceOnly ? ["--service-only"] : [])],
    statusCommand({ json: true }),
    statusCommand({ json: false }),
    [
      "node",
      [helperPath("agentwatch-release-next-steps.mjs"), "--assets", assetDir, "--output", `${assetDir}/release-next-steps.md`]
        .concat(serviceOnly ? ["--service-only"] : []),
    ],
  ];
}

function statusCommand({ json }) {
  if (packagedMode) {
    return [
      "node",
      [helperPath("agentwatch-release-status.mjs"), assetDir]
        .concat(serviceOnly ? ["--service-only"] : [])
        .concat(platform ? ["--platform", platform] : [])
        .concat(json ? ["--json", "--output", `${assetDir}/release-status.json`] : ["--output", `${assetDir}/release-status.md`]),
    ];
  }
  return [
    "npm",
    ["run", "release:status", "--", assetDir]
      .concat(serviceOnly ? ["--service-only"] : [])
      .concat(platform ? ["--platform", platform] : [])
      .concat(json ? ["--json", "--output", `${assetDir}/release-status.json`] : ["--output", `${assetDir}/release-status.md`]),
  ];
}

function readinessCommand() {
  if (packagedMode) {
    return [
      "node",
      [helperPath("agentwatch-release-readiness.mjs"), assetDir]
        .concat(serviceOnly ? ["--service-only"] : [])
        .concat(platform ? ["--platform", platform] : []),
    ];
  }
  return [
    "npm",
    ["run", "release:readiness", "--", assetDir]
      .concat(serviceOnly ? ["--service-only"] : [])
      .concat(platform ? ["--platform", platform] : []),
  ];
}

function helperPath(name) {
  const path = join(scriptDir, name);
  if (!existsSync(path)) {
    throw new Error(`Packaged helper missing: ${name}`);
  }
  return path;
}

function writeChecksums() {
  const files = collectFilesRecursive(assetDir)
    .filter((file) => file !== "SHA256SUMS.txt")
    .sort((left, right) => left.localeCompare(right));
  if (files.length === 0) {
    throw new Error(`No release assets found in ${assetDir}`);
  }
  const sums = files
    .map((file) => `${sha256(join(assetDir, file))}  ${file}`)
    .join("\n");
  writeFileSync(join(assetDir, "SHA256SUMS.txt"), `${sums}\n`);
  console.log(`release checksums refreshed: ${assetDir}`);
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

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function positionalArgs() {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--platform") {
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
