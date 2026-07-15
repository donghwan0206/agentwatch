import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

if (process.platform === "win32") {
  console.log("release asset tests skipped on Windows");
  process.exit(0);
}

const root = mkdtempSync(join(tmpdir(), "agentwatch-release-assets-test-"));

try {
  writeFixtureProject(root);
  const env = writeMockTools(root);

  const macosAssets = join(root, "macos-assets");
  assert.equal(run("node", ["scripts/collect-release-assets.mjs", macosAssets], {
    ...env,
    AGENTWATCH_RELEASE_ROOT: root,
    RUNNER_OS: "macOS",
  }).status, 0);
  assertFiles(macosAssets, [
    "AgentWatch-macOS.app.zip",
    "AgentWatch.app.tar.gz",
    "AgentWatch.app.tar.gz.sig",
    "AgentWatch_0.2.0_aarch64.dmg",
    "agentwatch-server-macOS",
  ]);

  const macosServiceAssets = join(root, "macos-service-assets");
  assert.equal(run("node", ["scripts/collect-release-assets.mjs", macosServiceAssets, "--service-only"], {
    ...env,
    AGENTWATCH_RELEASE_ROOT: root,
    RUNNER_OS: "macOS",
  }).status, 0);
  assertFiles(macosServiceAssets, ["agentwatch-server-macOS"]);
  assert.equal(existsSync(join(macosServiceAssets, "AgentWatch-macOS.app.zip")), false);
  assert.equal(existsSync(join(macosServiceAssets, "AgentWatch_0.2.0_aarch64.dmg")), false);

  const windowsAssets = join(root, "windows-assets");
  assert.equal(run("node", ["scripts/collect-release-assets.mjs", windowsAssets], {
    ...env,
    AGENTWATCH_RELEASE_ROOT: root,
    RUNNER_OS: "Windows",
  }).status, 0);
  assertFiles(windowsAssets, [
    "AgentWatch_0.2.0_x64-setup.exe",
    "AgentWatch_0.2.0_x64-setup.nsis.zip",
    "AgentWatch_0.2.0_x64-setup.nsis.zip.sig",
    "AgentWatch_0.2.0_x64_en-US.msi",
    "AgentWatch_0.2.0_x64_en-US.msi.zip",
    "AgentWatch_0.2.0_x64_en-US.msi.zip.sig",
    "agentwatch-server-Windows.exe",
  ]);
  assert.equal(existsSync(join(windowsAssets, "agentwatch-server-helper.exe")), false);

  const linuxAssets = join(root, "linux-assets");
  assert.equal(run("node", ["scripts/collect-release-assets.mjs", linuxAssets], {
    ...env,
    AGENTWATCH_RELEASE_ROOT: root,
    RUNNER_OS: "Linux",
  }).status, 0);
  assertFiles(linuxAssets, [
    "AgentWatch_0.2.0_amd64.AppImage",
    "AgentWatch_0.2.0_amd64.AppImage.tar.gz",
    "AgentWatch_0.2.0_amd64.AppImage.tar.gz.sig",
    "agentwatch_0.2.0_amd64.deb",
    "agentwatch-0.2.0-1.x86_64.rpm",
    "agentwatch-server-Linux",
  ]);

  const missingWindowsMsiAssets = join(root, "missing-windows-msi-assets");
  rmSync(join(root, "src-tauri", "target", "release", "bundle", "msi", "AgentWatch_0.2.0_x64_en-US.msi"), { force: true });
  const missingWindowsMsi = run("node", ["scripts/collect-release-assets.mjs", missingWindowsMsiAssets], {
    ...env,
    AGENTWATCH_RELEASE_ROOT: root,
    RUNNER_OS: "Windows",
  });
  assert.notEqual(missingWindowsMsi.status, 0, "missing Windows MSI should fail collection");
  assert.match(missingWindowsMsi.stderr, /Windows MSI installer missing/);
  write(join(root, "src-tauri", "target", "release", "bundle", "msi", "AgentWatch_0.2.0_x64_en-US.msi"), "windows msi");

  const missingLinuxRpmAssets = join(root, "missing-linux-rpm-assets");
  rmSync(join(root, "src-tauri", "target", "release", "bundle", "rpm", "agentwatch-0.2.0-1.x86_64.rpm"), { force: true });
  const missingLinuxRpm = run("node", ["scripts/collect-release-assets.mjs", missingLinuxRpmAssets], {
    ...env,
    AGENTWATCH_RELEASE_ROOT: root,
    RUNNER_OS: "Linux",
  });
  assert.notEqual(missingLinuxRpm.status, 0, "missing Linux rpm should fail collection");
  assert.match(missingLinuxRpm.stderr, /Linux rpm package missing/);
  write(join(root, "src-tauri", "target", "release", "bundle", "rpm", "agentwatch-0.2.0-1.x86_64.rpm"), "linux rpm");

  writeFileSync(join(linuxAssets, "release-status.json"), "{\"overall\":\"ready\"}\n");
  writeFileSync(join(linuxAssets, "release-status.md"), "# status\n");
  assert.equal(run("node", ["scripts/finalize-release-assets.mjs", linuxAssets], {
    ...env,
    AGENTWATCH_RELEASE_ROOT: root,
  }).status, 0);
  assertFiles(linuxAssets, [
    "SHA256SUMS.txt",
    "completion-audit.json",
    "completion-audit.md",
    "agentwatch-verify-remote-client.mjs",
    "agentwatch-import-remote-report.mjs",
    "agentwatch-import-tray-report.mjs",
    "agentwatch-tray-manual-report.mjs",
    "agentwatch-release-audit.mjs",
    "agentwatch-release-readiness.mjs",
    "agentwatch-release-status.mjs",
    "agentwatch-release-next-steps.mjs",
    "agentwatch-refresh-release-evidence.mjs",
    "agentwatch-verify-service-lifecycle.mjs",
    "agentwatch-service-status.mjs",
    "agentwatch-lan-preflight.mjs",
    "agentwatch-verify-service.mjs",
    "agentwatch-verify-tray.mjs",
    "agentwatch-verify-tray-config.mjs",
    "release-verification.md",
    "service-quickstart.md",
    "release-summary.md",
    "release-status.json",
    "release-status.md",
    "remote-verification.md",
    "tray-verification.md",
    "verify-remote-macos.sh",
    "verify-remote-linux.sh",
    "verify-remote-windows.cmd",
    "verify-remote-windows.ps1",
    "verify-service-macos.sh",
    "verify-service-linux.sh",
    "verify-service-windows.cmd",
    "verify-service-windows.ps1",
    "verify-tray-macos-capture.sh",
    "verify-tray-linux.sh",
    "verify-tray-linux-capture.sh",
    "verify-tray-macos.sh",
    "verify-tray-windows.cmd",
    "verify-tray-windows.ps1",
    "verify-tray-windows-capture.ps1",
    "install-service-macos.sh",
    "uninstall-service-macos.sh",
    "install-service-linux.sh",
    "uninstall-service-linux.sh",
    "install-service-windows.ps1",
    "uninstall-service-windows.ps1",
  ]);
  const sums = readFileSync(join(linuxAssets, "SHA256SUMS.txt"), "utf8");
  assert.match(sums, /^[a-f0-9]{64}  AgentWatch_0\.2\.0_amd64\.AppImage/m);
  assert.match(sums, /^[a-f0-9]{64}  agentwatch-server-Linux/m);
  assert.match(sums, /^[a-f0-9]{64}  completion-audit\.json/m);
  assert.match(sums, /^[a-f0-9]{64}  completion-audit\.md/m);
  assert.match(sums, /^[a-f0-9]{64}  remote-verification\.md/m);
  assert.match(sums, /^[a-f0-9]{64}  tray-verification\.md/m);
  assert.match(sums, /^[a-f0-9]{64}  screenshots\/linux-tray\.png/m);
  assert.match(sums, /^[a-f0-9]{64}  release-summary\.md/m);
  assert.match(sums, /^[a-f0-9]{64}  release-status\.json/m);
  assert.match(sums, /^[a-f0-9]{64}  release-status\.md/m);

  const serviceOnlyFinalize = join(root, "service-only-finalize");
  mkdirSync(serviceOnlyFinalize, { recursive: true });
  writeFileSync(join(serviceOnlyFinalize, "agentwatch-server-Linux"), "server");
  writeFileSync(
    join(serviceOnlyFinalize, "lan-preflight-linux.json"),
    JSON.stringify({
      checks: {
        lanUrl: { value: "http://192.168.50.93:8893" },
        lanHealthz: { url: "http://192.168.50.93:8893/healthz" },
      },
      runtime: {
        lanUrls: ["http://192.168.50.93:8893"],
      },
    }),
  );
  assert.equal(run("node", ["scripts/finalize-release-assets.mjs", serviceOnlyFinalize, "--service-only"], {
    ...env,
    AGENTWATCH_RELEASE_ROOT: root,
  }).status, 0);
  const serviceOnlySummary = readFileSync(join(serviceOnlyFinalize, "release-summary.md"), "utf8");
  const serviceOnlyAudit = readFileSync(join(serviceOnlyFinalize, "completion-audit.md"), "utf8");
  const serviceOnlyRemoteGuide = readFileSync(join(serviceOnlyFinalize, "remote-verification.md"), "utf8");
  assert.match(serviceOnlySummary, /not required/);
  assert.match(serviceOnlySummary, /Service-only readiness does not require desktop app packages or tray reports/);
  assert.match(serviceOnlyAudit, /Service-only release/);
  assert.match(serviceOnlyAudit, /Tray\/menu-bar indicator is not required for service-only release/);
  assert.match(serviceOnlyRemoteGuide, /AgentWatch Remote Browser Verification/);
  assert.match(serviceOnlyRemoteGuide, /Target URL: `http:\/\/192\.168\.50\.93:8893`/);
  assert.match(serviceOnlyRemoteGuide, /verify-remote-linux\.sh --url http:\/\/192\.168\.50\.93:8893/);
  assert.match(serviceOnlyRemoteGuide, /release:import-remote -- .* --service-only/);
  assert.match(serviceOnlyRemoteGuide, /release:refresh -- .* --service-only --platform linux --check/);
  assert.equal(readFileSync(join(serviceOnlyFinalize, "install-service-linux.sh"), "utf8").includes("\r"), false);
  assert.equal(existsSync(join(serviceOnlyFinalize, "tray-verification.md")), false);
  assert.equal(existsSync(join(serviceOnlyFinalize, "agentwatch-verify-tray.mjs")), false);
  assert.equal(existsSync(join(serviceOnlyFinalize, "agentwatch-verify-tray-config.mjs")), false);
  assert.equal(existsSync(join(serviceOnlyFinalize, "agentwatch-import-tray-report.mjs")), false);
  assert.equal(existsSync(join(serviceOnlyFinalize, "verify-tray-macos.sh")), false);
  assert.equal(existsSync(join(serviceOnlyFinalize, "verify-tray-windows.ps1")), false);
  writeFileSync(join(serviceOnlyFinalize, "completion-audit.md"), "audit sentinel\n");
  writeFileSync(join(serviceOnlyFinalize, "release-status.json"), "{\"overall\":\"incomplete\"}\n");
  writeFileSync(join(serviceOnlyFinalize, "release-status.md"), "# status\n");
  assert.equal(run("node", ["scripts/finalize-release-assets.mjs", serviceOnlyFinalize, "--checksums-only", "--service-only"], {
    ...env,
    AGENTWATCH_RELEASE_ROOT: root,
  }).status, 0);
  assert.equal(readFileSync(join(serviceOnlyFinalize, "completion-audit.md"), "utf8"), "audit sentinel\n");
  const serviceOnlySums = readFileSync(join(serviceOnlyFinalize, "SHA256SUMS.txt"), "utf8");
  assert.match(serviceOnlySums, /^[a-f0-9]{64}  release-status\.json/m);
  assert.match(serviceOnlySums, /^[a-f0-9]{64}  release-status\.md/m);

  const serviceArtifacts = join(root, "service-artifacts");
  const bundledServiceAssets = join(root, "bundled-service-assets");
  writeServiceArtifact(join(serviceArtifacts, "agentwatch-service-release-macOS"), "agentwatch-server-macOS");
  const bundleResult = run("node", [
    "scripts/bundle-service-release.mjs",
    "--input",
    serviceArtifacts,
    "--output",
    bundledServiceAssets,
  ], env);
  assert.equal(bundleResult.status, 0, bundleResult.stderr);
  const archivePath = join(bundledServiceAssets, "agentwatch-service-release-macOS.tar.gz");
  assert.equal(existsSync(archivePath), true, "service release archive missing");
  const archiveList = run("tar", ["-tzf", archivePath], env);
  assert.equal(archiveList.status, 0, archiveList.stderr);
  assert.match(archiveList.stdout, /agentwatch-server-macOS/);
  assert.match(archiveList.stdout, /install-service-macos\.sh/);
  assert.match(archiveList.stdout, /uninstall-service-macos\.sh/);
  assert.match(archiveList.stdout, /install-service-linux\.sh/);
  assert.match(archiveList.stdout, /uninstall-service-linux\.sh/);
  assert.match(archiveList.stdout, /install-service-windows\.ps1/);
  assert.match(archiveList.stdout, /uninstall-service-windows\.ps1/);
  assert.match(archiveList.stdout, /remote-verification\.md/);
  assert.match(archiveList.stdout, /release-next-steps\.md/);
  assert.match(archiveList.stdout, /service-quickstart\.md/);
  assert.match(archiveList.stdout, /verify-remote-macos\.sh/);
  assert.match(archiveList.stdout, /agentwatch-service-status\.mjs/);
  assert.match(archiveList.stdout, /agentwatch-lan-preflight\.mjs/);
  assert.match(archiveList.stdout, /agentwatch-import-remote-report\.mjs/);
  assert.doesNotMatch(archiveList.stdout, /tray-verification\.md/);
  assert.doesNotMatch(archiveList.stdout, /verify-tray-/);
  assert.doesNotMatch(archiveList.stdout, /agentwatch-verify-tray/);

  const incompleteServiceArtifacts = join(root, "incomplete-service-artifacts");
  const incompleteServiceDir = join(incompleteServiceArtifacts, "agentwatch-service-release-Linux");
  writeServiceArtifact(incompleteServiceDir, "agentwatch-server-Linux");
  rmSync(join(incompleteServiceDir, "remote-verification.md"), { force: true });
  const incompleteBundle = run("node", [
    "scripts/bundle-service-release.mjs",
    "--input",
    incompleteServiceArtifacts,
    "--output",
    join(root, "incomplete-bundled-service-assets"),
  ], env);
  assert.notEqual(incompleteBundle.status, 0, "incomplete service bundle should fail");
  assert.match(incompleteBundle.stderr, /remote-verification\.md/);

  const missingServerAssets = join(root, "missing-server-assets");
  rmSync(join(root, "src-tauri", "target", "release", "agentwatch-server.exe"), { force: true });
  const missing = run("node", ["scripts/collect-release-assets.mjs", missingServerAssets], {
    ...env,
    AGENTWATCH_RELEASE_ROOT: root,
    RUNNER_OS: "Windows",
  });
  assert.notEqual(missing.status, 0, "missing Windows headless server should fail collection");
  assert.match(missing.stderr, /required release asset missing/);

  console.log("release asset tests ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function writeFixtureProject(projectRoot) {
  write(join(projectRoot, "src-tauri", "target", "release", "bundle", "macos", "AgentWatch.app", "Contents", "MacOS", "AgentWatch"), "macos app");
  write(join(projectRoot, "src-tauri", "target", "release", "bundle", "macos", "AgentWatch.app.tar.gz"), "macos update");
  write(join(projectRoot, "src-tauri", "target", "release", "bundle", "macos", "AgentWatch.app.tar.gz.sig"), "macos signature");
  write(join(projectRoot, "src-tauri", "target", "release", "bundle", "dmg", "AgentWatch_0.2.0_aarch64.dmg"), "macos dmg");
  write(join(projectRoot, "src-tauri", "target", "release", "bundle", "nsis", "AgentWatch_0.2.0_x64-setup.exe"), "windows installer");
  write(join(projectRoot, "src-tauri", "target", "release", "bundle", "nsis", "AgentWatch_0.2.0_x64-setup.nsis.zip"), "windows nsis update");
  write(join(projectRoot, "src-tauri", "target", "release", "bundle", "nsis", "AgentWatch_0.2.0_x64-setup.nsis.zip.sig"), "windows nsis signature");
  write(join(projectRoot, "src-tauri", "target", "release", "bundle", "nsis", "agentwatch-server-helper.exe"), "ignore helper");
  write(join(projectRoot, "src-tauri", "target", "release", "bundle", "msi", "AgentWatch_0.2.0_x64_en-US.msi"), "windows msi");
  write(join(projectRoot, "src-tauri", "target", "release", "bundle", "msi", "AgentWatch_0.2.0_x64_en-US.msi.zip"), "windows msi update");
  write(join(projectRoot, "src-tauri", "target", "release", "bundle", "msi", "AgentWatch_0.2.0_x64_en-US.msi.zip.sig"), "windows msi signature");
  write(join(projectRoot, "src-tauri", "target", "release", "bundle", "appimage", "AgentWatch_0.2.0_amd64.AppImage"), "linux appimage");
  write(join(projectRoot, "src-tauri", "target", "release", "bundle", "appimage", "AgentWatch_0.2.0_amd64.AppImage.tar.gz"), "linux update");
  write(join(projectRoot, "src-tauri", "target", "release", "bundle", "appimage", "AgentWatch_0.2.0_amd64.AppImage.tar.gz.sig"), "linux signature");
  write(join(projectRoot, "src-tauri", "target", "release", "bundle", "deb", "agentwatch_0.2.0_amd64.deb"), "linux deb");
  write(join(projectRoot, "src-tauri", "target", "release", "bundle", "rpm", "agentwatch-0.2.0-1.x86_64.rpm"), "linux rpm");
  write(join(projectRoot, "src-tauri", "target", "release", "agentwatch-server.exe"), "windows server");
  write(join(projectRoot, "src-tauri", "target", "release", "agentwatch-server"), "linux server");
  write(join(projectRoot, "docs", "release-verification.md"), "# release verification\n");
  write(join(projectRoot, "docs", "service-quickstart.md"), "# service quickstart\n");
  write(join(projectRoot, "scripts", "verify-service.mjs"), "console.log('verify service');\n");
  write(join(projectRoot, "scripts", "verify-service-lifecycle.mjs"), "console.log('verify service lifecycle');\n");
  write(join(projectRoot, "scripts", "service-status.mjs"), "console.log('service status');\n");
  write(join(projectRoot, "scripts", "lan-preflight.mjs"), "console.log('lan preflight');\n");
  write(join(projectRoot, "scripts", "verify-remote-client.mjs"), "console.log('verify remote');\n");
  write(join(projectRoot, "scripts", "import-remote-report.mjs"), "console.log('import remote');\n");
  write(join(projectRoot, "scripts", "import-tray-report.mjs"), "console.log('import tray');\n");
  write(join(projectRoot, "scripts", "tray-manual-report.mjs"), "console.log('tray manual');\n");
  write(join(projectRoot, "scripts", "release-audit.mjs"), "console.log('release audit');\n");
  write(join(projectRoot, "scripts", "release-readiness.mjs"), "console.log('release readiness');\n");
  write(join(projectRoot, "scripts", "release-status.mjs"), "console.log('release status');\n");
  write(join(projectRoot, "scripts", "release-next-steps.mjs"), "console.log('release next steps');\n");
  write(join(projectRoot, "scripts", "refresh-release-evidence.mjs"), "console.log('refresh release evidence');\n");
  write(join(projectRoot, "scripts", "verify-remote-macos.sh"), "#!/usr/bin/env bash\n");
  write(join(projectRoot, "scripts", "verify-remote-linux.sh"), "#!/usr/bin/env bash\n");
  write(join(projectRoot, "scripts", "verify-remote-windows.cmd"), "@echo off\r\npowershell -ExecutionPolicy Bypass -File \"%~dp0verify-remote-windows.ps1\" %*\r\n");
  write(join(projectRoot, "scripts", "verify-remote-windows.ps1"), "Write-Output verify-remote\n");
  write(join(projectRoot, "scripts", "verify-service-macos.sh"), "#!/usr/bin/env bash\n");
  write(join(projectRoot, "scripts", "verify-service-linux.sh"), "#!/usr/bin/env bash\n");
  write(join(projectRoot, "scripts", "verify-service-windows.cmd"), "@echo off\r\npowershell -ExecutionPolicy Bypass -File \"%~dp0verify-service-windows.ps1\" %*\r\n");
  write(join(projectRoot, "scripts", "verify-service-windows.ps1"), "Write-Output verify-service\n");
  write(join(projectRoot, "scripts", "verify-tray.mjs"), "console.log('verify');\n");
  write(join(projectRoot, "scripts", "verify-tray-config.mjs"), "console.log('verify tray config');\n");
  write(join(projectRoot, "scripts", "verify-tray-macos.sh"), "#!/usr/bin/env bash\n");
  write(join(projectRoot, "scripts", "verify-tray-macos-capture.sh"), "#!/usr/bin/env bash\n");
  write(join(projectRoot, "scripts", "verify-tray-linux.sh"), "#!/usr/bin/env bash\n");
  write(join(projectRoot, "scripts", "verify-tray-linux-capture.sh"), "#!/usr/bin/env bash\n");
  write(join(projectRoot, "scripts", "verify-tray-windows.cmd"), "@echo off\r\n");
  write(join(projectRoot, "scripts", "verify-tray-windows.ps1"), "Write-Output verify\n");
  write(join(projectRoot, "scripts", "verify-tray-windows-capture.ps1"), "Write-Output capture\n");
  write(join(projectRoot, "linux-assets", "screenshots", "linux-tray.png"), "linux tray screenshot\n");
  write(join(projectRoot, "scripts", "install-service-macos.sh"), "#!/usr/bin/env bash\n");
  write(join(projectRoot, "scripts", "uninstall-service-macos.sh"), "#!/usr/bin/env bash\n");
  write(join(projectRoot, "scripts", "install-service-linux.sh"), "#!/usr/bin/env bash\r\necho install\r\n");
  write(join(projectRoot, "scripts", "uninstall-service-linux.sh"), "#!/usr/bin/env bash\n");
  write(join(projectRoot, "scripts", "install-service-windows.ps1"), "Write-Output install\n");
  write(join(projectRoot, "scripts", "uninstall-service-windows.ps1"), "Write-Output uninstall\n");
}

function writeServiceArtifact(targetDir, serverName) {
  for (const file of [
    serverName,
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
  ]) {
    write(join(targetDir, file), file);
  }
}

function writeMockTools(projectRoot) {
  const bin = join(projectRoot, "mock-bin");
  const nodeScript = join(bin, "ditto-node.js");
  write(nodeScript, [
    "const { writeFileSync } = require('node:fs');",
    "const out = process.argv.at(-1);",
    "writeFileSync(out, 'mock zip');",
  ].join("\n"));
  const unixDitto = join(bin, "ditto");
  write(unixDitto, "#!/usr/bin/env node\nrequire(`${__dirname}/ditto-node.js`);\n");
  chmodSync(unixDitto, 0o755);
  write(join(bin, "ditto.cmd"), "@echo off\r\nnode \"%~dp0ditto-node.js\" %*\r\n");
  return {
    PATH: `${bin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH || ""}`,
  };
}

function run(command, args, env) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function assertFiles(directory, files) {
  for (const file of files) {
    assert.equal(existsSync(join(directory, file)), true, `${file} missing from ${directory}`);
  }
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}
