import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const serviceMacos = [
  "npm run build:server",
  "AGENTWATCH_HEADLESS_SMOKE_LAN_PREFLIGHT_REPORT=/tmp/assets/lan-preflight-macos.json npm run smoke:headless",
  "npm run bench:report:service -- /tmp/assets",
  "npm run release:collect -- /tmp/assets --service-only",
  "npm run release:finalize -- /tmp/assets --service-only",
  "npm run release:manifest -- /tmp/assets",
  "npm run release:status -- /tmp/assets --platform macos --json --output /tmp/assets/release-status.json --service-only",
  "npm run release:status -- /tmp/assets --platform macos --output /tmp/assets/release-status.md --service-only",
  "npm run release:next-steps -- --assets /tmp/assets --output /tmp/assets/release-next-steps.md --service-only",
  "npm run release:manifest -- /tmp/assets",
  "npm run release:finalize -- /tmp/assets --checksums-only --service-only",
];

assert.deepEqual(dryRun("macos"), serviceMacos);
assert.deepEqual(dryRun("macos", "--service-only"), serviceMacos);

assert.deepEqual(dryRun("linux", "--skip-build"), [
  "AGENTWATCH_HEADLESS_SMOKE_LAN_PREFLIGHT_REPORT=/tmp/assets/lan-preflight-linux.json npm run smoke:headless",
  "npm run bench:report:service -- /tmp/assets",
  "npm run release:collect -- /tmp/assets --service-only",
  "npm run release:finalize -- /tmp/assets --service-only",
  "npm run release:manifest -- /tmp/assets",
  "npm run release:status -- /tmp/assets --platform linux --json --output /tmp/assets/release-status.json --service-only",
  "npm run release:status -- /tmp/assets --platform linux --output /tmp/assets/release-status.md --service-only",
  "npm run release:next-steps -- --assets /tmp/assets --output /tmp/assets/release-next-steps.md --service-only",
  "npm run release:manifest -- /tmp/assets",
  "npm run release:finalize -- /tmp/assets --checksums-only --service-only",
]);

assert.deepEqual(dryRun("macos", "--desktop"), [
  "npm run build:server",
  "npm run build:mac",
  "AGENTWATCH_HEADLESS_SMOKE_LAN_PREFLIGHT_REPORT=/tmp/assets/lan-preflight-macos.json npm run smoke:headless",
  "npm run bench:report -- /tmp/assets",
  "node scripts/verify-tray-config.mjs --output-dir /tmp/assets",
  "npm run release:collect -- /tmp/assets",
  "npm run release:finalize -- /tmp/assets",
  "npm run release:manifest -- /tmp/assets",
  "npm run release:status -- /tmp/assets --platform macos --json --output /tmp/assets/release-status.json",
  "npm run release:status -- /tmp/assets --platform macos --output /tmp/assets/release-status.md",
  "npm run release:next-steps -- --assets /tmp/assets --output /tmp/assets/release-next-steps.md",
  "npm run release:manifest -- /tmp/assets",
  "npm run release:finalize -- /tmp/assets --checksums-only",
]);

assert.deepEqual(dryRun("macos", "--desktop", "--dmg"), [
  "npm run build:server",
  "npm run build:mac:release",
  "AGENTWATCH_HEADLESS_SMOKE_LAN_PREFLIGHT_REPORT=/tmp/assets/lan-preflight-macos.json npm run smoke:headless",
  "npm run bench:report -- /tmp/assets",
  "node scripts/verify-tray-config.mjs --output-dir /tmp/assets",
  "npm run release:collect -- /tmp/assets",
  "npm run release:finalize -- /tmp/assets",
  "npm run release:manifest -- /tmp/assets",
  "npm run release:status -- /tmp/assets --platform macos --json --output /tmp/assets/release-status.json",
  "npm run release:status -- /tmp/assets --platform macos --output /tmp/assets/release-status.md",
  "npm run release:next-steps -- --assets /tmp/assets --output /tmp/assets/release-next-steps.md",
  "npm run release:manifest -- /tmp/assets",
  "npm run release:finalize -- /tmp/assets --checksums-only",
]);

assert.deepEqual(dryRun("windows", "--desktop"), [
  "npm run build:server",
  "npm run build:windows",
  "AGENTWATCH_HEADLESS_SMOKE_LAN_PREFLIGHT_REPORT=/tmp/assets/lan-preflight-windows.json npm run smoke:headless",
  "npm run bench:report -- /tmp/assets",
  "node scripts/verify-tray-config.mjs --output-dir /tmp/assets",
  "npm run release:collect -- /tmp/assets",
  "npm run release:finalize -- /tmp/assets",
  "npm run release:manifest -- /tmp/assets",
  "npm run release:status -- /tmp/assets --platform windows --json --output /tmp/assets/release-status.json",
  "npm run release:status -- /tmp/assets --platform windows --output /tmp/assets/release-status.md",
  "npm run release:next-steps -- --assets /tmp/assets --output /tmp/assets/release-next-steps.md",
  "npm run release:manifest -- /tmp/assets",
  "npm run release:finalize -- /tmp/assets --checksums-only",
]);

assert.deepEqual(dryRun("linux", "--desktop"), [
  "npm run build:server",
  "npm run build:linux",
  "AGENTWATCH_HEADLESS_SMOKE_LAN_PREFLIGHT_REPORT=/tmp/assets/lan-preflight-linux.json npm run smoke:headless",
  "npm run bench:report -- /tmp/assets",
  "npm run release:collect -- /tmp/assets",
  "npm run release:finalize -- /tmp/assets",
  "npm run release:manifest -- /tmp/assets",
  "npm run release:status -- /tmp/assets --platform linux --json --output /tmp/assets/release-status.json",
  "npm run release:status -- /tmp/assets --platform linux --output /tmp/assets/release-status.md",
  "npm run release:next-steps -- --assets /tmp/assets --output /tmp/assets/release-next-steps.md",
  "npm run release:manifest -- /tmp/assets",
  "npm run release:finalize -- /tmp/assets --checksums-only",
]);

assertFailure(/--dmg requires --desktop/, "macos", "--dmg");
assertFailure(/--desktop and --service-only cannot be used together/, "macos", "--desktop", "--service-only");

console.log("package-local tests ok");

function dryRun(platform, ...extraArgs) {
  const result = spawnSync(
    "node",
    ["scripts/package-local.mjs", "--dry-run", "--assets", "/tmp/assets", "--platform", platform, ...extraArgs],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split(/\r?\n/).filter(Boolean);
}

function assertFailure(pattern, platform, ...extraArgs) {
  const result = spawnSync(
    "node",
    ["scripts/package-local.mjs", "--dry-run", "--assets", "/tmp/assets", "--platform", platform, ...extraArgs],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0, "command should fail");
  assert.match(result.stderr, pattern);
}
