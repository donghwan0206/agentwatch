import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "agentwatch-lan-preflight-test-"));
let runtimeOverrides = {};
let advertisedLanUrls = [];

const server = createServer((request, response) => {
  response.setHeader("content-type", request.url?.endsWith(".css") ? "text/css" : "application/json");
  if (request.url === "/healthz") {
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (request.url === "/api/runtime") {
    response.end(JSON.stringify({
      name: "agentwatch",
      version: "0.2.0",
      runtime: "rust-headless",
      platform: "macos",
      bindHost: "0.0.0.0",
      trayEnabled: false,
      localUrl: "http://127.0.0.1:8765",
      lanUrls: advertisedLanUrls,
      ...runtimeOverrides,
    }));
    return;
  }
  if (request.url === "/api/remote-check") {
    response.end(JSON.stringify({
      clientIp: "127.0.0.1",
      loopback: true,
      sameHostIp: false,
      remoteClient: false,
    }));
    return;
  }
  if (request.url === "/") {
    response.setHeader("content-type", "text/html");
    response.end("<!doctype html><title>AgentWatch</title><button id=\"copyLanUrlBtn\">copy</button>");
    return;
  }
  if (request.url === "/app.js") {
    response.setHeader("content-type", "text/javascript");
    response.end("fetch('/api/remote-check');");
    return;
  }
  if (request.url === "/styles.css") {
    response.setHeader("content-type", "text/css");
    response.end(".copy-url-btn{}");
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: "not found" }));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

try {
  const url = `http://127.0.0.1:${server.address().port}`;
  advertisedLanUrls = [url];
  const reportPath = join(root, "lan-preflight.json");
  const ok = await runPreflight(url, "--json", "--report", reportPath, "--allow-loopback-lan-url");
  assert.equal(ok.status, 0, ok.stderr);
  const data = JSON.parse(ok.stdout);
  assert.equal(data.readyForRemoteViewer, true);
  assert.equal(data.remoteEvidenceSatisfied, false);
  assert.equal(data.runtime.lanUrls[0], url);
  assert.equal(data.checks.lanHealthz.ok, true);
  assert.equal(existsSync(reportPath), true);
  assert.equal(JSON.parse(readFileSync(reportPath, "utf8")).readyForRemoteViewer, true);

  runtimeOverrides = { bindHost: "127.0.0.1" };
  const badBind = await runPreflight(url, "--json", "--allow-loopback-lan-url");
  assert.notEqual(badBind.status, 0, "loopback bind host should fail LAN preflight");
  assert.equal(JSON.parse(badBind.stdout).readyForRemoteViewer, false);

  runtimeOverrides = { bindHost: "0.0.0.0", lanUrls: ["http://127.0.0.1:8765"] };
  const missingLan = await runPreflight(url, "--json");
  assert.notEqual(missingLan.status, 0, "missing LAN URL should fail LAN preflight");
  assert.equal(JSON.parse(missingLan.stdout).checks.lanUrl.ok, false);

  runtimeOverrides = { bindHost: "0.0.0.0", lanUrls: ["http://127.0.0.1:9"] };
  const blockedLan = await runPreflight(url, "--json", "--allow-loopback-lan-url", "--timeout-ms", "500");
  assert.notEqual(blockedLan.status, 0, "unreachable LAN healthz should fail LAN preflight");
  const blockedReport = JSON.parse(blockedLan.stdout);
  assert.equal(blockedReport.checks.lanUrl.ok, true);
  assert.equal(blockedReport.checks.lanHealthz.ok, false);

  console.log("lan preflight tests ok");
} finally {
  await new Promise((resolve) => server.close(resolve));
  rmSync(root, { recursive: true, force: true });
}

function runPreflight(url, ...extraArgs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      "scripts/lan-preflight.mjs",
      "--url",
      url,
      ...extraArgs,
    ], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}
