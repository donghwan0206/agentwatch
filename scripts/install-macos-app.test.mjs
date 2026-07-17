import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = mkdtempSync(join(tmpdir(), "agentwatch-macos-installer-"));

try {
  const release = join(root, "release");
  const source = join(root, "source");
  const install = join(root, "Applications");
  const mockDitto = join(root, "ditto");
  const mockCodesign = join(root, "codesign");
  mkdirSync(join(source, "AgentWatch.app", "Contents", "MacOS"), { recursive: true });
  mkdirSync(release, { recursive: true });
  mkdirSync(install, { recursive: true });
  writeFileSync(join(source, "AgentWatch.app", "Contents", "MacOS", "agentwatch"), "fixture\n");
  writeFileSync(mockDitto, "#!/usr/bin/env bash\ncp -R \"$1\" \"$2\"\n");
  chmodSync(mockDitto, 0o755);
  writeFileSync(mockCodesign, "#!/usr/bin/env bash\n[[ \"${*: -1}\" == *rollback/AgentWatch.app ]] && exit 1\nexit 0\n");
  chmodSync(mockCodesign, 0o755);

  run("tar", ["-C", source, "-czf", join(release, "AgentWatch.app.tar.gz"), "AgentWatch.app"]);
  const sum = run("shasum", ["-a", "256", join(release, "AgentWatch.app.tar.gz")]).stdout.split(/\s+/)[0];
  writeFileSync(join(release, "AgentWatch.app.tar.gz.sha256"), `${sum}  AgentWatch.app.tar.gz\n`);

  const env = {
    ...process.env,
    AGENTWATCH_ALLOW_NON_MACOS_TEST: "1",
    AGENTWATCH_RELEASE_BASE_URL: `file://${release}`,
    AGENTWATCH_INSTALL_DIR: install,
    AGENTWATCH_DITTO_BIN: mockDitto,
    AGENTWATCH_CODESIGN_BIN: "true",
    AGENTWATCH_XATTR_BIN: "true",
    AGENTWATCH_NO_LAUNCH: "1",
    AGENTWATCH_NO_STOP: "1",
  };
  const installed = run("bash", ["scripts/install-macos-app.sh"], env);
  assert.match(installed.stdout, /AgentWatch installed/);
  assert.equal(existsSync(join(install, "AgentWatch.app", "Contents", "MacOS", "agentwatch")), true);

  writeFileSync(join(release, "AgentWatch.app.tar.gz.sha256"), `${"0".repeat(64)}  AgentWatch.app.tar.gz\n`);
  const rejected = spawnSync("bash", ["scripts/install-macos-app.sh"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...env, AGENTWATCH_INSTALL_DIR: join(root, "rejected") },
  });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /checksum verification failed/);
  assert.equal(existsSync(join(root, "rejected", "AgentWatch.app")), false);

  writeFileSync(join(release, "AgentWatch.app.tar.gz.sha256"), `${sum}  AgentWatch.app.tar.gz\n`);
  const rollback = join(root, "rollback");
  mkdirSync(join(rollback, "AgentWatch.app"), { recursive: true });
  writeFileSync(join(rollback, "AgentWatch.app", "previous-version"), "keep me\n");
  const failedVerification = spawnSync("bash", ["scripts/install-macos-app.sh"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...env,
      AGENTWATCH_INSTALL_DIR: rollback,
      AGENTWATCH_CODESIGN_BIN: mockCodesign,
    },
  });
  assert.notEqual(failedVerification.status, 0);
  assert.equal(readFileSync(join(rollback, "AgentWatch.app", "previous-version"), "utf8"), "keep me\n");

  const guide = readFileSync("docs/macos-installation.md", "utf8");
  assert.match(guide, /install-macos-app\.sh \| bash/);
  assert.match(guide, /xattr -dr com\.apple\.quarantine/);
  console.log("macOS app installer tests ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: process.cwd(), encoding: "utf8", env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}
