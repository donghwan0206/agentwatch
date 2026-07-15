import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const releaseAssets = resolve("release-assets");
const serviceAssets = resolve("service-assets");

assert.deepEqual(dryRun("release-assets", "--platform", "macos"), [
  `npm run release:finalize -- ${releaseAssets}`,
  `npm run release:manifest -- ${releaseAssets}`,
  `npm run release:status -- ${releaseAssets} --platform macos --json --output ${releaseAssets}/release-status.json`,
  `npm run release:status -- ${releaseAssets} --platform macos --output ${releaseAssets}/release-status.md`,
  `npm run release:next-steps -- --assets ${releaseAssets} --output ${releaseAssets}/release-next-steps.md`,
  `npm run release:finalize -- ${releaseAssets} --checksums-only`,
]);

assert.deepEqual(dryRun("service-assets", "--service-only", "--platform", "linux", "--check"), [
  `npm run release:finalize -- ${serviceAssets} --service-only`,
  `npm run release:manifest -- ${serviceAssets}`,
  `npm run release:status -- ${serviceAssets} --service-only --platform linux --json --output ${serviceAssets}/release-status.json`,
  `npm run release:status -- ${serviceAssets} --service-only --platform linux --output ${serviceAssets}/release-status.md`,
  `npm run release:next-steps -- --assets ${serviceAssets} --output ${serviceAssets}/release-next-steps.md --service-only`,
  `npm run release:finalize -- ${serviceAssets} --checksums-only --service-only`,
  `npm run release:readiness -- ${serviceAssets} --service-only --platform linux`,
]);

console.log("refresh release evidence tests ok");

function dryRun(...extraArgs) {
  const result = spawnSync(
    process.execPath,
    ["scripts/refresh-release-evidence.mjs", "--dry-run", ...extraArgs],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split(/\r?\n/).filter(Boolean);
}
