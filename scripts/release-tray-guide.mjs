import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const serviceOnly = args.includes("--service-only");
const assetDir = resolve(args.find((arg) => !arg.startsWith("--")) || "release-assets");
const outputPath = join(assetDir, "tray-verification.md");
const files = readFiles(assetDir);

const platforms = [
  {
    name: "macos",
    label: "macOS",
    appPath: "/Applications/AgentWatch.app",
    report: "tray-verification-macos.json",
    screenshot: "screenshots/macos-menu-bar.png",
    indicatorTarget: "macos-menu-bar",
    command: (target) => `./verify-tray-macos-capture.sh "${target}"`,
  },
  {
    name: "windows",
    label: "Windows",
    appPath: "C:\\Program Files\\AgentWatch\\agentwatch.exe",
    report: "tray-verification-windows.json",
    screenshot: "screenshots\\windows-tray.png",
    indicatorTarget: "windows-notification-area",
    command: (target) => `powershell -ExecutionPolicy Bypass -File .\\verify-tray-windows-capture.ps1 "${target}"`,
  },
  {
    name: "linux",
    label: "Linux",
    appPath: packageFor((file) => file.endsWith(".AppImage")) || "./AgentWatch.AppImage",
    report: "tray-verification-linux.json",
    screenshot: "screenshots/linux-tray.png",
    indicatorTarget: "linux-tray",
    command: (target) => `./verify-tray-linux-capture.sh "${target}"`,
  },
];

mkdirSync(assetDir, { recursive: true });
writeFileSync(outputPath, renderGuide());
console.log(`tray verification guide written: ${outputPath}`);

function renderGuide() {
  const lines = [
    "# AgentWatch Tray/Menu-Bar Verification",
    "",
    serviceOnly
      ? "Service-only releases do not require tray/menu-bar reports, but the optional desktop wrapper still uses this checklist before desktop release readiness can pass."
      : "Run these commands on each real target desktop after installing or unpacking the app package.",
    "",
    "A final release-valid report must include `manualResult: \"passed\"`, all structured manual checks marked `passed` including hidden-window startup, and at least one screenshot with byte/hash evidence.",
    "",
  ];

  for (const platform of platforms) {
    lines.push(`## ${platform.label}`, "");
    lines.push(`Expected report: \`${platform.report}\``);
    lines.push(`Screenshot evidence: \`${platform.screenshot}\``);
    lines.push(`App path: \`${platform.appPath}\``);
    lines.push(`Expected runtime indicator target: \`${platform.indicatorTarget}\``);
    lines.push("");
    lines.push(platform.name === "windows" ? "```powershell" : "```bash");
    lines.push(platform.command(platform.appPath));
    lines.push("```");
    lines.push("");
    lines.push("After checking each item on the real desktop, record the manual result explicitly:");
    lines.push("");
    lines.push(platform.name === "windows" ? "```powershell" : "```bash");
    if (platform.name === "windows") {
      lines.push(`node .\\agentwatch-tray-manual-report.mjs --source .\\${platform.report} --output .\\${platform.report} --check startsHidden=passed --check trayIconVisible=passed --check trayMenuItems=passed --check trayTooltip=passed --check openDashboard=passed --check closeKeepsHealthz=passed --check quitExitsApp=passed --check lanUrlReachable=passed --check windowsNoConsole=passed --screenshot .\\${platform.screenshot} --manual-notes "Verified on the target desktop session."`);
    } else {
      lines.push(`node ./agentwatch-tray-manual-report.mjs --source ./${platform.report} --output ./${platform.report} --check startsHidden=passed --check trayIconVisible=passed --check trayMenuItems=passed --check trayTooltip=passed --check openDashboard=passed --check closeKeepsHealthz=passed --check quitExitsApp=passed --check lanUrlReachable=passed --screenshot ./${platform.screenshot} --manual-notes "Verified on the target desktop session."`);
    }
    lines.push("```");
    lines.push("");
  }

  lines.push("Every passed tray report must include the same expected value in both `automatedChecks.indicatorTarget` and `automatedChecks.runtimeIndicatorTarget`. The latter is read from `/api/runtime`, so it proves the running app reported the correct OS tray/menu-bar target.");
  lines.push("Screenshot paths are validated during import and should keep the target-specific names above, such as `macos-menu-bar.png`, `windows-tray.png`, or `linux-tray.png`.");
  lines.push("");
  lines.push("After generating a tray report on the target desktop, import it into the release folder and refresh evidence from a source checkout:");
  lines.push("");
  lines.push("```bash");
  lines.push(serviceOnly
    ? "npm run release:readiness -- <this-release-folder> --service-only --platform <platform>"
    : "npm run release:import-tray -- --report /path/to/tray-verification-<platform>.json --assets <this-release-folder> --platform <platform>");
  if (!serviceOnly) {
    lines.push("npm run release:refresh -- <this-release-folder> --platform <platform> --check");
  }
  lines.push("```");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function packageFor(predicate) {
  return files.find(predicate) || null;
}

function readFiles(directory) {
  try {
    return readdirSync(directory).sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}
