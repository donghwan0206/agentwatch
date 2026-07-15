import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serviceOnly = process.argv.includes("--service-only");

const rustDesktop = serviceOnly ? null : await runBench("benchmark-runtime.mjs");
const rustHeadless = await runBench("benchmark-headless.mjs");
const python = await runBench("benchmark-python.mjs");

const comparison = {
  rustDesktop,
  rustHeadless,
  python,
  delta: {
    desktopVsPython: rustDesktop ? compare(rustDesktop, python) : null,
    headlessVsPython: compare(rustHeadless, python),
    headlessVsDesktop: rustDesktop ? compare(rustHeadless, rustDesktop) : null,
  },
  note:
    serviceOnly
      ? "Negative delta means the left runtime measured lower. Service-only mode compares the Rust monitor server against the Python development server without Tauri desktop overhead."
      : "Negative delta means the left runtime measured lower. Desktop RSS includes the Tauri runtime; headless isolates the Rust monitor server without tray/window overhead.",
};

console.log(JSON.stringify(comparison, null, 2));

async function runBench(scriptName) {
  const { stdout, stderr } = await execFileAsync("node", [`scripts/${scriptName}`], {
    cwd: root,
    env: process.env,
    maxBuffer: 1024 * 1024 * 8,
  });
  if (stderr.trim()) {
    process.stderr.write(stderr);
  }
  return JSON.parse(stdout);
}

function difference(left, right) {
  if (typeof left !== "number" || typeof right !== "number") {
    return null;
  }
  const value = round1(left - right);
  return {
    value,
    percent: right === 0 ? null : round1((value / right) * 100),
  };
}

function compare(left, right) {
  return {
    startupMs: difference(left.startupMs, right.startupMs),
    avgResponseMs: difference(left.avgResponseMs, right.avgResponseMs),
    p95ResponseMs: difference(left.p95ResponseMs, right.p95ResponseMs),
    rssMb: difference(left.rssMb, right.rssMb),
  };
}

function round1(value) {
  return Math.round(value * 10) / 10;
}
