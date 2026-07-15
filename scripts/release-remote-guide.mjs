import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const serviceOnly = args.includes("--service-only");
const assetDir = resolve(args.find((arg) => !arg.startsWith("--")) || "release-assets");
const outputPath = join(assetDir, "remote-verification.md");
const files = readFiles(assetDir);

const platforms = [
  {
    name: "macos",
    label: "macOS",
    headless: "agentwatch-server-macOS",
  },
  {
    name: "windows",
    label: "Windows",
    headless: "agentwatch-server-Windows.exe",
  },
  {
    name: "linux",
    label: "Linux",
    headless: "agentwatch-server-Linux",
  },
];

const targets = platforms
  .filter((platform) => hasFile(platform.headless) || findJson(`agentwatch-release-manifest-${platform.name}`))
  .map((platform) => ({
    ...platform,
    url: remoteUrlFor(platform.name),
  }));

mkdirSync(assetDir, { recursive: true });
writeFileSync(outputPath, renderGuide(targets));
console.log(`remote verification guide written: ${outputPath}`);

function renderGuide(targetRows) {
  const lines = [
    "# AgentWatch Remote Browser Verification",
    "",
    "Run these commands from the browser/viewer machine on the same LAN, not from the agent machine running AgentWatch.",
    "",
    "A final release-valid report must use the agent machine LAN IP, must not target localhost/127.0.0.1, and must report `sameHost: false` plus `remoteClient: true` from `/api/remote-check`.",
    "",
  ];

  if (targetRows.length === 0) {
    lines.push("No platform server binary or manifest was found in this release folder.");
    lines.push("");
    return `${lines.join("\n")}\n`;
  }

  for (const target of targetRows) {
    const report = `remote-client-verification-${target.name}.json`;
    lines.push(`## ${target.label} Agent Machine`, "");
    lines.push(`Target URL: \`${target.url}\``, "");
    lines.push("Browser-only viewer:");
    lines.push("");
    lines.push("1. Open the target URL in a browser on a different LAN device.");
    lines.push("2. Confirm the Remote Verify panel shows `remote`.");
    lines.push(`3. Click \`검증 JSON\` and save it as \`${report}\`.`);
    lines.push("");
    lines.push("macOS viewer:");
    lines.push("");
    lines.push("```bash");
    lines.push(`./verify-remote-macos.sh --url ${target.url} --report ${report}`);
    lines.push("```");
    lines.push("");
    lines.push("Linux viewer:");
    lines.push("");
    lines.push("```bash");
    lines.push(`./verify-remote-linux.sh --url ${target.url} --report ${report}`);
    lines.push("```");
    lines.push("");
    lines.push("Windows viewer:");
    lines.push("");
    lines.push("```powershell");
    lines.push(`.\\verify-remote-windows.cmd -Url ${target.url} -Report ${report}`);
    lines.push(`powershell -ExecutionPolicy Bypass -File .\\verify-remote-windows.ps1 -Url ${target.url} -Report ${report}`);
    lines.push("```");
    lines.push("");
    lines.push(`Import \`${report}\` back into this release folder, then rerun readiness:`);
    lines.push("");
    lines.push("```bash");
    lines.push(`npm run release:import-remote -- --report /path/to/${report} --assets <this-release-folder> --platform ${target.name}${serviceOnly ? " --service-only" : ""}`);
    lines.push(`npm run release:refresh -- <this-release-folder>${serviceOnly ? " --service-only" : ""} --platform ${target.name} --check`);
    lines.push("```");
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function remoteUrlFor(platformName) {
  const service = findJson(`service-verification-${platformName}`);
  const checks = service?.data?.automatedChecks || {};
  const preflight = findJson(`lan-preflight-${platformName}`);
  const preflightChecks = preflight?.data?.checks || {};
  const preflightRuntime = preflight?.data?.runtime || {};
  const serviceCandidates = [
    checks.lanUrlChecked,
    ...(Array.isArray(checks.lanUrls) ? checks.lanUrls : []),
  ].filter(Boolean);
  const serviceUrl = firstLanUrl(serviceCandidates);
  if (serviceUrl) return serviceUrl;

  const preflightCandidates = [
    preflightChecks.lanUrl?.value,
    preflightChecks.lanHealthz?.url,
    ...(Array.isArray(preflightRuntime.lanUrls) ? preflightRuntime.lanUrls : []),
  ].filter(Boolean);
  const preflightUrl = firstLanUrl(preflightCandidates);
  if (serviceOnly && preflightUrl) {
    return preflightUrl;
  }
  return preflightUrl || "http://<agent-machine-ip>:<selected-port>";
}

function firstLanUrl(candidates) {
  return candidates
    .map(baseHttpUrl)
    .find((url) => /^http:\/\/[^/]+:\d+/i.test(url) && !isLoopbackUrl(url));
}

function baseHttpUrl(value) {
  try {
    const url = new URL(value);
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return String(value || "").replace(/\/+$/, "");
  }
}

function withPort(value, port) {
  try {
    const url = new URL(value);
    url.port = port;
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value;
  }
}

function isLoopbackUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.startsWith("127.");
  } catch {
    return false;
  }
}

function readFiles(directory) {
  try {
    return readdirSync(directory).sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

function hasFile(file) {
  return files.includes(file);
}

function findJson(prefix) {
  const file = files.find((candidate) => candidate.startsWith(prefix) && candidate.endsWith(".json"));
  if (!file) return null;
  try {
    return { file, data: JSON.parse(readFileSync(join(assetDir, file), "utf8")) };
  } catch {
    return null;
  }
}
