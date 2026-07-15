import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const appJs = readFileSync("static/app.js", "utf8");
const script = appJs.slice(0, appJs.indexOf('$("refreshBtn")'));

const context = {
  console,
  location: { origin: "http://192.168.50.93:8765" },
  navigator: {
    platform: "BrowserTest",
    userAgent: "AgentWatchBrowserTest/1.0",
  },
};
vm.createContext(context);
vm.runInContext(script, context);

vm.runInContext(`
  state.runtime = {
    runtime: "rust-headless",
    version: "0.2.0",
    platform: "macos",
    trayEnabled: false,
    bindHost: "0.0.0.0",
    port: 8765,
    localUrl: "http://127.0.0.1:8765",
    lanUrls: ["http://192.168.50.93:8765"],
    hostname: "agent-host"
  };
  state.snapshot = {
    activity: {
      status: "busy",
      activeProcessCount: 12,
      totalCpu: 42.5
    }
  };
  state.providerHistory = [{ provider: "OpenAI Codex" }];
  state.usage = [{
    provider: "codex",
    daily: [{ date: "2026-07-07", tokens: 1000, turns: 1 }],
    totals: { observedTokens: 1000 },
    quotas: [],
    threads: [],
    goals: []
  }];
`, context);

vm.runInContext(`
  state.remoteCheck = {
    remoteClient: true,
    clientIp: "192.168.50.20",
    clientAddress: "192.168.50.20:51982",
    sameHostIp: false,
    loopback: false,
    agentHostname: "agent-host"
  };
`, context);
const remoteReport = vm.runInContext("buildBrowserRemoteReport()", context);

assert.equal(remoteReport.schemaVersion, 1);
assert.equal(remoteReport.verifier, "browser-dashboard");
assert.equal(remoteReport.targetUrl, "http://192.168.50.93:8765");
assert.equal(remoteReport.result, "passed");
assert.equal(remoteReport.automatedChecks.runtime, "rust-headless");
assert.equal(remoteReport.automatedChecks.trayEnabled, false);
assert.equal(remoteReport.automatedChecks.bindHost, "0.0.0.0");
assert.equal(remoteReport.automatedChecks.remoteCheckEndpoint, "passed");
assert.equal(remoteReport.automatedChecks.remoteClient, true);
assert.equal(remoteReport.automatedChecks.sameHostIp, false);
assert.equal(remoteReport.automatedChecks.loopback, false);
assert.equal(remoteReport.automatedChecks.sameHost, false);
assert.equal(remoteReport.automatedChecks.usageProviderCount, 1);
assert.equal(remoteReport.automatedChecks.providerHistoryCount, 1);

vm.runInContext(`
  state.remoteCheck = {
    remoteClient: false,
    clientIp: "127.0.0.1",
    clientAddress: "127.0.0.1:51982",
    sameHostIp: true,
    loopback: true
  };
`, context);
const localReport = vm.runInContext("buildBrowserRemoteReport()", context);

assert.equal(localReport.result, "local-only");
assert.equal(localReport.automatedChecks.remoteClient, false);
assert.equal(localReport.automatedChecks.sameHostIp, true);
assert.equal(localReport.automatedChecks.loopback, true);
assert.equal(localReport.automatedChecks.sameHost, true);

const normalizedUsage = vm.runInContext(`
  (() => {
    const today = formatLocalDate(new Date());
    return normalizeUsagePayload({
      usage: [{
        provider: "codex",
        source: "~/.codex/logs_2.sqlite",
        daily: [
          { date: "2026-07-07", tokens: 1000, turns: 1 },
          { date: today, tokens: 2500, turns: 2 }
        ],
        threads: [{ tokens: 50 }, { tokens: 75 }]
      }]
    })[0];
  })()
`, context);

assert.equal(normalizedUsage.provider, "codex");
assert.equal(Array.isArray(normalizedUsage.quotas), true);
assert.equal(normalizedUsage.quotas.length, 0);
assert.equal(Array.isArray(normalizedUsage.goals), true);
assert.equal(normalizedUsage.goals.length, 0);
assert.equal(normalizedUsage.totals.todayTokens, 2500);
assert.equal(normalizedUsage.totals.last7DaysTokens, 3500);
assert.equal(normalizedUsage.totals.last30DaysTokens, 3500);
assert.equal(normalizedUsage.totals.observedTokens, 3500);
assert.equal(normalizedUsage.totals.threadTotalTokens, 125);
assert.equal(normalizedUsage.totals.threadCount, 2);

console.log("browser remote report tests ok");
