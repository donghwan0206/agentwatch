import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const root = mkdtempSync(join(tmpdir(), "agentwatch-updater-json-test-"));

try {
  write(join(root, "macos", "AgentWatch.app.tar.gz"), "app");
  write(join(root, "macos", "AgentWatch.app.tar.gz.sig"), "mac-signature\n");
  assert.equal(run([
    "--input", join(root, "macos"),
    "--platform", "macos",
    "--arch", "ARM64",
    "--version", "0.2.0",
    "--fragment", join(root, "macos", "updater-fragment.json"),
  ]).status, 0);

  write(join(root, "windows", "AgentWatch_0.2.0_x64-setup.exe"), "nsis");
  write(join(root, "windows", "AgentWatch_0.2.0_x64-setup.exe.sig"), "win-signature\n");
  assert.equal(run([
    "--input", join(root, "windows"),
    "--platform", "windows",
    "--arch", "X64",
    "--version", "0.2.0",
    "--fragment", join(root, "windows", "updater-fragment.json"),
  ]).status, 0);
  const windowsFragmentPath = join(root, "windows", "updater-fragment.json");
  const generatedWindowsFragment = JSON.parse(readFileSync(windowsFragmentPath, "utf8"));
  assert.equal(
    generatedWindowsFragment.platforms["windows-x86_64"].artifact,
    "AgentWatch_0.2.0_x64-setup.exe",
  );
  generatedWindowsFragment.platforms["windows-x86_64"].artifact =
    "D:\\a\\agentwatch\\agentwatch\\release-assets\\AgentWatch_0.2.0_x64-setup.exe";
  generatedWindowsFragment.platforms["windows-x86_64"].signatureFile =
    "D:\\a\\agentwatch\\agentwatch\\release-assets\\AgentWatch_0.2.0_x64-setup.exe.sig";
  writeFileSync(windowsFragmentPath, JSON.stringify(generatedWindowsFragment, null, 2));

  write(join(root, "linux", "AgentWatch_0.2.0_amd64.AppImage"), "appimage");
  write(join(root, "linux", "AgentWatch_0.2.0_amd64.AppImage.sig"), "linux-signature\n");
  assert.equal(run([
    "--input", join(root, "linux"),
    "--platform", "linux",
    "--arch", "X64",
    "--version", "0.2.0",
    "--fragment", join(root, "linux", "updater-fragment.json"),
  ]).status, 0);

  const output = join(root, "latest.json");
  assert.equal(run([
    "--fragments", root,
    "--copy-to", join(root, "upload"),
    "--base-url", "https://github.com/donghwan0206/agentwatch/releases/download/v0.2.0",
    "--version", "0.2.0",
    "--output", output,
  ]).status, 0);

  const latest = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(latest.version, "0.2.0");
  assert.equal(latest.platforms["darwin-aarch64"].signature, "mac-signature");
  assert.equal(
    latest.platforms["darwin-aarch64"].url,
    "https://github.com/donghwan0206/agentwatch/releases/download/v0.2.0/AgentWatch.app.tar.gz",
  );
  assert.equal(latest.platforms["windows-x86_64"].signature, "win-signature");
  assert.match(latest.platforms["windows-x86_64"].url, /AgentWatch_0\.2\.0_x64-setup\.exe$/);
  assert.equal(latest.platforms["linux-x86_64"].signature, "linux-signature");
  assert.match(latest.platforms["linux-x86_64"].url, /AgentWatch_0\.2\.0_amd64\.AppImage$/);

  console.log("tauri latest json tests ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { flag: "w" });
}

function run(args) {
  return spawnSync(process.execPath, ["scripts/write-tauri-latest-json.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}
