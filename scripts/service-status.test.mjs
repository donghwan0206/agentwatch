import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

let serviceReady = true;

const server = createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.url === "/healthz") {
    if (!serviceReady) {
      response.statusCode = 503;
      response.end(JSON.stringify({ ok: false }));
      return;
    }
    response.end(JSON.stringify({ ok: true, time: 1783435200 }));
    return;
  }
  if (request.url === "/api/runtime") {
    if (!serviceReady) {
      response.statusCode = 503;
      response.end(JSON.stringify({ ok: false }));
      return;
    }
    response.end(JSON.stringify({
      name: "agentwatch",
      version: "0.2.0",
      runtime: "rust-headless",
      platform: "macos",
      bindHost: "0.0.0.0",
      trayEnabled: false,
      localUrl: "http://127.0.0.1:8765",
      lanUrls: ["http://192.168.50.93:8765"],
    }));
    return;
  }
  if (request.url === "/api/snapshot") {
    response.end(JSON.stringify({
      activity: {
        status: "busy",
        activeProcessCount: 2,
        totalCpu: 4.2,
        totalMemory: 128,
      },
    }));
    return;
  }
  if (request.url === "/api/usage?days=14") {
    response.end(JSON.stringify({ days: [] }));
    return;
  }
  if (request.url === "/api/remote-check") {
    response.end(JSON.stringify({
      clientIp: "127.0.0.1",
      loopback: true,
      remoteClient: false,
      sameHostIp: false,
    }));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: "not found" }));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

try {
  const port = server.address().port;
  const status = await runStatus(`http://127.0.0.1:${port}`, "--json");
  assert.equal(status.status, 0, status.stderr);
  const data = JSON.parse(status.stdout);
  assert.equal(data.reachable, true);
  assert.equal(data.runtime.runtime, "rust-headless");
  assert.equal(data.runtime.bindHost, "0.0.0.0");
  assert.equal(data.runtime.trayEnabled, false);
  assert.deepEqual(data.runtime.lanUrls, ["http://192.168.50.93:8765"]);
  assert.equal(data.snapshot.status, "busy");
  assert.equal(data.remoteCheck.remoteClient, false);

  const human = await runStatus(`http://127.0.0.1:${port}`);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /AgentWatch service: reachable/);
  assert.match(human.stdout, /LAN URL: http:\/\/192\.168\.50\.93:8765/);

  serviceReady = false;
  setTimeout(() => {
    serviceReady = true;
  }, 250);
  const delayed = await runStatus(`http://127.0.0.1:${port}`, "--json", "--wait-ms", "2000", "--interval-ms", "100");
  assert.equal(delayed.status, 0, delayed.stderr);
  assert.equal(JSON.parse(delayed.stdout).reachable, true);

  const down = await runStatus("http://127.0.0.1:9", "--json");
  assert.notEqual(down.status, 0, "down service should fail status check");
  const downData = JSON.parse(down.stdout);
  assert.equal(downData.reachable, false);

  console.log("service status tests ok");
} finally {
  await new Promise((resolve) => server.close(resolve));
}

function runStatus(url, ...extraArgs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      "scripts/service-status.mjs",
      "--url",
      url,
      "--skip-service-check",
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
