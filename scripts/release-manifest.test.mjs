import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "agentwatch-manifest-test-"));

try {
  writeFileSync(join(dir, "AgentWatch-macOS.app.zip"), "app");
  writeFileSync(join(dir, "agentwatch-server-macOS"), "server");
  writeFileSync(join(dir, "agentwatch-verify-service.mjs"), "service verifier");
  writeFileSync(join(dir, "agentwatch-verify-service-lifecycle.mjs"), "service lifecycle verifier");
  writeFileSync(join(dir, "agentwatch-verify-remote-client.mjs"), "remote verifier");
  writeFileSync(join(dir, "agentwatch-import-remote-report.mjs"), "import remote");
  writeFileSync(join(dir, "agentwatch-lan-preflight.mjs"), "lan preflight");
  writeFileSync(join(dir, "agentwatch-service-status.mjs"), "service status");
  writeFileSync(join(dir, "agentwatch-verify-tray-config.mjs"), "tray config verifier");
  writeFileSync(join(dir, "verify-service-macos.sh"), "service launcher");
  writeFileSync(join(dir, "service-verification-macos.json"), "{}");
  writeFileSync(join(dir, "service-lifecycle-macos.json"), "{}");
  writeFileSync(join(dir, "remote-client-verification-macos.json"), "{}");
  writeFileSync(join(dir, "agentwatch-verify-tray.mjs"), "verifier");
  writeFileSync(join(dir, "verify-tray-macos.sh"), "launcher");
  writeFileSync(join(dir, "tray-verification-macos.json"), "{}");
  writeFileSync(join(dir, "release-verification.md"), "docs");
  writeFileSync(join(dir, "release-summary.md"), "summary");
  writeFileSync(join(dir, "release-status.json"), "{}");
  writeFileSync(join(dir, "release-status.md"), "# status");
  writeFileSync(join(dir, "SHA256SUMS.txt"), "stale");

  const output = join(dir, "agentwatch-release-manifest-macos.json");
  const result = spawnSync("node", ["scripts/release-manifest.mjs", dir], {
    encoding: "utf8",
    env: {
      ...process.env,
      RUNNER_OS: "macOS",
      AGENTWATCH_RELEASE_MANIFEST: output,
    },
  });
  assert.equal(result.status, 0, result.stderr);

  const manifest = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(manifest.build.platform, "macos");
  assert.deepEqual(manifest.assets.map((asset) => asset.name).sort(), [
    "AgentWatch-macOS.app.zip",
    "agentwatch-server-macOS",
  ]);
  assert.deepEqual(
    manifest.assets.map((asset) => asset.sha256).sort(),
    [sha256("app"), sha256("server")].sort(),
  );
  for (const gate of [
    "headless Rust monitor build",
    "headless smoke test",
    "LAN preflight against advertised LAN /healthz",
    "Rust-vs-Python performance comparison",
    "release readiness automated gate",
  ]) {
    assert.ok(manifest.automatedGates.includes(gate), `${gate} gate missing`);
  }

  console.log("release-manifest tests ok");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}
