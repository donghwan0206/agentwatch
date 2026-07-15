import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const root = mkdtempSync(join(tmpdir(), "agentwatch-service-test-"));

try {
  const fakeBinary = join(root, "space dir", "agentwatch-server");
  writeFileSyncRecursive(fakeBinary, "#!/usr/bin/env bash\n");
  chmodSync(fakeBinary, 0o755);

  const macHome = join(root, "mac-home");
  const macResult = run("bash", ["scripts/install-service-macos.sh"], {
    HOME: macHome,
    AGENTWATCH_BINARY: fakeBinary,
    AGENTWATCH_PORT: "8876",
    AGENTWATCH_DB: join(root, "db path", "agentwatch.sqlite3"),
    AGENTWATCH_LAUNCHD_LABEL: "com.agentwatch.test",
    AGENTWATCH_SERVICE_DRY_RUN: "1",
  });
  assert.equal(macResult.status, 0, macResult.stderr);
  assert.match(macResult.stdout, /LaunchAgent dry run/);
  const plistPath = join(macHome, "Library", "LaunchAgents", "com.agentwatch.test.plist");
  assert.equal(existsSync(plistPath), true, "macOS plist was not written");
  const installedMacBinary = join(macHome, "Library", "Application Support", "AgentWatch", "agentwatch-server");
  assert.equal(existsSync(installedMacBinary), true, "macOS service binary was not copied");
  const plist = readFileSync(plistPath, "utf8");
  assert.match(plist, /<string>com\.agentwatch\.test<\/string>/);
  assert.match(plist, new RegExp(escapeRegExp(`<string>${installedMacBinary}</string>`)));
  assert.match(plist, /<key>AGENTWATCH_PORT<\/key>\s*<string>8876<\/string>/);
  assert.match(plist, /<key>HOME<\/key>/);
  assert.match(plist, /<key>AGENTWATCH_DB<\/key>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);

  const macAutoHome = join(root, "mac-auto-home");
  const macAutoResult = run("bash", ["scripts/install-service-macos.sh"], {
    HOME: macAutoHome,
    AGENTWATCH_BINARY: fakeBinary,
    AGENTWATCH_PORT: "",
    AGENTWATCH_LAUNCHD_LABEL: "com.agentwatch.auto",
    AGENTWATCH_SERVICE_DRY_RUN: "1",
  });
  assert.equal(macAutoResult.status, 0, macAutoResult.stderr);
  assert.match(macAutoResult.stdout, /selected automatically/);
  const autoPlist = readFileSync(
    join(macAutoHome, "Library", "LaunchAgents", "com.agentwatch.auto.plist"),
    "utf8",
  );
  assert.doesNotMatch(autoPlist, /<key>AGENTWATCH_PORT<\/key>/);

  const linuxConfig = join(root, "linux config");
  const linuxData = join(root, "linux data");
  const linuxResult = run("bash", ["scripts/install-service-linux.sh"], {
    XDG_CONFIG_HOME: linuxConfig,
    XDG_DATA_HOME: linuxData,
    AGENTWATCH_BINARY: fakeBinary,
    AGENTWATCH_PORT: "8877",
    AGENTWATCH_DB: join(root, "linux db", "agentwatch.sqlite3"),
    AGENTWATCH_SERVICE_DRY_RUN: "1",
  });
  assert.equal(linuxResult.status, 0, linuxResult.stderr);
  assert.match(linuxResult.stdout, /systemd user service dry run/);
  assert.match(linuxResult.stdout, /Installed binary:/);
  const installedLinuxBinary = join(linuxData, "agentwatch", "agentwatch-server");
  assert.equal(existsSync(installedLinuxBinary), true, "Linux service binary was not copied");
  const unitPath = join(linuxConfig, "systemd", "user", "agentwatch.service");
  assert.equal(existsSync(unitPath), true, "Linux systemd unit was not written");
  const unit = readFileSync(unitPath, "utf8");
  assert.match(unit, /\[Unit\]/);
  assert.match(unit, /Description=AgentWatch Rust monitor server/);
  assert.match(unit, new RegExp(escapeRegExp(`WorkingDirectory="${join(linuxData, "agentwatch")}"`)));
  assert.match(unit, new RegExp(escapeRegExp(`ExecStart="${installedLinuxBinary}"`)));
  assert.match(unit, /Restart=always/);
  assert.match(unit, /Environment="AGENTWATCH_PORT=8877"/);
  assert.match(unit, /Environment="AGENTWATCH_DB=.*agentwatch\.sqlite3"/);
  assert.match(unit, /WantedBy=default\.target/);

  const linuxAutoConfig = join(root, "linux auto config");
  const linuxAutoData = join(root, "linux auto data");
  const linuxAutoResult = run("bash", ["scripts/install-service-linux.sh"], {
    XDG_CONFIG_HOME: linuxAutoConfig,
    XDG_DATA_HOME: linuxAutoData,
    AGENTWATCH_BINARY: fakeBinary,
    AGENTWATCH_PORT: "",
    AGENTWATCH_SERVICE_DRY_RUN: "1",
  });
  assert.equal(linuxAutoResult.status, 0, linuxAutoResult.stderr);
  assert.match(linuxAutoResult.stdout, /selected automatically/);
  const autoUnit = readFileSync(join(linuxAutoConfig, "systemd", "user", "agentwatch.service"), "utf8");
  assert.doesNotMatch(autoUnit, /AGENTWATCH_PORT=/);

  const packageJson = readFileSync("package.json", "utf8");
  assert.match(packageJson, /service:install:windows/, "Windows install npm script missing");
  const windowsInstall = readFileSync("scripts/install-service-windows.ps1", "utf8");
  assert.match(windowsInstall, /\[Nullable\[int\]\]\$Port = \$null/, "Windows port parameter must be optional");
  assert.match(windowsInstall, /New-ScheduledTaskAction/, "Windows scheduled task action missing");
  assert.match(windowsInstall, /Copy-Item -Force -Path \$Binary -Destination \$ServiceBinary/, "Windows installer must copy the server binary into a stable user install path");
  assert.match(windowsInstall, /Installed binary: \$ServiceBinary/, "Windows dry-run output must report installed binary");
  assert.match(windowsInstall, /Quote-PowerShellSingle \$ServiceBinary/, "Windows scheduled task must run the installed binary copy");
  assert.match(windowsInstall, /-WindowStyle Hidden/, "Windows hidden PowerShell action missing");
  assert.match(windowsInstall, /if \(\$null -ne \$Port\)[\s\S]*AGENTWATCH_PORT/, "Windows port environment must be conditional");
  assert.match(windowsInstall, /\[switch\]\$DryRun/, "Windows dry-run switch missing");
  assert.match(windowsInstall, /AgentWatch scheduled task dry run/, "Windows dry-run output missing");
  assert.match(windowsInstall, /if \(\$DryRun\)[\s\S]*exit 0/, "Windows dry-run must exit before registration");
  const windowsUninstall = readFileSync("scripts/uninstall-service-windows.ps1", "utf8");
  assert.match(windowsUninstall, /Remove-Item -Force -ErrorAction SilentlyContinue \$ServiceBinary/, "Windows uninstaller must remove the installed binary copy");

  for (const script of [
    "scripts/verify-tray-macos-capture.sh",
    "scripts/verify-tray-linux-capture.sh",
  ]) {
    const content = readFileSync(script, "utf8");
    assert.match(content, /HAS_REPORT=0/, `${script} must detect user-provided --report`);
    assert.match(content, /HAS_SCREENSHOT=0/, `${script} must detect user-provided --screenshot`);
    assert.match(content, /ARGS=\(/, `${script} must build argument arrays without duplicate default report precedence`);
    assert.match(content, /SCREENSHOT="\$\{USER_ARGS\[/, `${script} must capture to user-provided --screenshot path`);
  }
  for (const script of [
    "scripts/verify-tray-macos.sh",
    "scripts/verify-tray-linux.sh",
  ]) {
    const content = readFileSync(script, "utf8");
    assert.match(content, /HAS_REPORT=0/, `${script} must detect user-provided --report`);
    assert.match(content, /ARGS=\(/, `${script} must build argument arrays without duplicate default report precedence`);
  }
  for (const script of [
    "scripts/verify-tray-windows.ps1",
    "scripts/verify-tray-windows-capture.ps1",
  ]) {
    const content = readFileSync(script, "utf8");
    assert.match(content, /\$RemainingArgs -notcontains "--report"/, `${script} must honor user-provided --report`);
  }
  const windowsCapture = readFileSync("scripts/verify-tray-windows-capture.ps1", "utf8");
  assert.match(windowsCapture, /\$RemainingArgs\[\$index\] -eq "--screenshot"/, "Windows capture helper must honor user-provided --screenshot");

  console.log("service installer tests ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function run(command, args, env) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function writeFileSyncRecursive(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
