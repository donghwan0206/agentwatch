import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/package.yml", "utf8");

assert.match(workflow, /workflow_dispatch:[\s\S]*include_desktop:[\s\S]*type: boolean/, "manual desktop package toggle missing");
assert.match(workflow, /name: \$\{\{ matrix\.name \}\}[\s\S]*macOS service[\s\S]*Windows service[\s\S]*Linux service/, "service-only matrix missing");
assert.match(workflow, /libglib2\.0-dev/, "Linux service build must install GLib development headers required by Tauri dependencies");
assert.match(workflow, /libgtk-3-dev/, "Linux service build must install GTK development headers required by Tauri dependencies");
assert.match(workflow, /libwebkit2gtk-4\.1-dev/, "Linux service build must install WebKitGTK development headers required by Tauri dependencies");
assert.match(workflow, /npm run bench:report:service -- release-assets-service/, "service-only performance report missing");
assert.match(workflow, /Dry-run macOS service installer/, "macOS service installer dry-run missing");
assert.match(workflow, /AGENTWATCH_SERVICE_DRY_RUN: "1"/, "service installer dry-run env missing");
assert.match(workflow, /Dry-run Linux service installer/, "Linux service installer dry-run missing");
assert.match(workflow, /Dry-run Windows service installer/, "Windows service installer dry-run missing");
assert.match(workflow, /install-service-windows\.ps1 -Binary src-tauri\\target\\release\\agentwatch-server\.exe -DryRun/, "Windows service installer dry-run command missing");
assert.match(
  workflow,
  /npm run release:collect -- release-assets-service --service-only[\s\S]*npm run release:finalize -- release-assets-service --service-only[\s\S]*npm run release:manifest -- release-assets-service/,
  "service-only assets must be finalized before manifest generation",
);
assert.match(
  workflow,
  /npm run release:readiness -- release-assets-service --service-only --automated-only --platform \$\{\{ matrix\.platform \}\}/,
  "service-only automated readiness gate missing",
);
assert.match(
  workflow,
  /npm run release:status -- release-assets-service --service-only --platform \$\{\{ matrix\.platform \}\} --json --output release-assets-service\/release-status\.json[\s\S]*npm run release:status -- release-assets-service --service-only --platform \$\{\{ matrix\.platform \}\} --output release-assets-service\/release-status\.md[\s\S]*npm run release:finalize -- release-assets-service --checksums-only --service-only[\s\S]*npm run release:readiness -- release-assets-service --service-only --automated-only --platform \$\{\{ matrix\.platform \}\}/,
  "service-only status reports and checksums must be refreshed before readiness/upload",
);
assert.match(
  workflow,
  /npm run release:next-steps -- --assets release-assets-service --service-only --output release-assets-service\/release-next-steps\.md[\s\S]*npm run release:finalize -- release-assets-service --checksums-only --service-only/,
  "service-only next-steps report must be generated before final checksums",
);
assert.match(workflow, /agentwatch-service-release-\$\{\{ runner\.os \}\}/, "service-only artifact upload missing");
assert.match(workflow, /package:[\s\S]*if: github\.event_name == 'workflow_dispatch' && inputs\.include_desktop/, "desktop package job must be manual opt-in");
assert.match(workflow, /release:[\s\S]*name: GitHub Service Release[\s\S]*needs:[\s\S]*- service/, "release job must wait for service job");
assert.doesNotMatch(workflow, /\n  release:\n[\s\S]*?needs:[\s\S]*?- package[\s\S]*?if: startsWith\(github\.ref, 'refs\/tags\/'\)/, "service release job must not depend on desktop package job");
assert.match(
  workflow,
  /Checkout release scripts[\s\S]*Download service release assets/,
  "release job must checkout before downloading service artifacts",
);
assert.doesNotMatch(workflow, /Download release assets[\s\S]*pattern: agentwatch-release-\*/, "service release job must not download desktop release assets");
assert.match(workflow, /pattern: agentwatch-service-release-\*/, "service release artifact download missing");
assert.match(workflow, /path: service-release-assets/, "service release artifact download path missing");
assert.match(workflow, /npm run release:bundle-service -- --input service-release-assets --output release-assets/, "service release archive step missing");
assert.match(workflow, /npm run release:verify-service-archives -- release-assets/, "service release archive verification step missing");
assert.match(
  workflow,
  /shasum -a 256 release-assets\/\*\.tar\.gz > release-assets\/SHA256SUMS\.txt/,
  "service release archive checksum step missing",
);
assert.match(workflow, /macos-latest[\s\S]*platform: macos[\s\S]*npm run build:mac:release/, "optional macOS desktop build missing");
assert.match(workflow, /windows-latest[\s\S]*platform: windows[\s\S]*npm run build:windows/, "optional Windows desktop package build missing");
assert.match(workflow, /ubuntu-24\.04[\s\S]*platform: linux[\s\S]*npm run build:linux/, "optional Linux desktop package build missing");
assert.match(workflow, /npm run build:server/, "headless server build missing");
assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY: \$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY \}\}/, "Tauri updater signing secret missing");
assert.match(workflow, /npm run smoke:headless/, "headless smoke test missing");
assert.match(
  workflow,
  /AGENTWATCH_HEADLESS_SMOKE_LAN_PREFLIGHT_REPORT: release-assets-service\/lan-preflight-\$\{\{ matrix\.platform \}\}\.json/,
  "service job LAN preflight report generation missing",
);
assert.match(
  workflow,
  /AGENTWATCH_HEADLESS_SMOKE_LAN_PREFLIGHT_REPORT: release-assets\/lan-preflight-\$\{\{ matrix\.platform \}\}\.json/,
  "package job LAN preflight report generation missing",
);
assert.match(workflow, /npm run smoke(\s|$)/, "packaged app smoke test missing");
assert.match(workflow, /npm run smoke:fallback/, "fallback-port smoke test missing");
assert.match(
  workflow,
  /Verify tray config[\s\S]*if: runner\.os != 'Linux'[\s\S]*node scripts\/verify-tray-config\.mjs --output-dir release-assets/,
  "packaged app tray config verification missing",
);
assert.match(workflow, /dbus-run-session -- xvfb-run -a npm run smoke/, "Linux DBus/Xvfb packaged smoke missing");
assert.match(workflow, /dbus-user-session/, "Linux DBus user session dependency missing");
assert.match(
  workflow,
  /Verify Linux tray config under Xvfb[\s\S]*if: runner\.os == 'Linux'[\s\S]*dbus-run-session -- xvfb-run -a node scripts\/verify-tray-config\.mjs --output-dir release-assets/,
  "Linux tray config verification under Xvfb missing",
);
assert.match(workflow, /npm run bench:report -- release-assets/, "performance report generation missing");
assert.match(
  workflow,
  /dbus-run-session -- xvfb-run -a npm run bench:report -- release-assets/,
  "Linux DBus/Xvfb performance report generation missing",
);
assert.match(
  workflow,
  /npm run release:collect -- release-assets[\s\S]*npm run release:finalize -- release-assets[\s\S]*npm run release:manifest -- release-assets[\s\S]*npm run release:status -- release-assets --platform \$\{\{ matrix\.platform \}\} --json --output release-assets\/release-status\.json[\s\S]*npm run release:status -- release-assets --platform \$\{\{ matrix\.platform \}\} --output release-assets\/release-status\.md[\s\S]*npm run release:finalize -- release-assets --checksums-only/,
  "optional desktop release assets must be finalized, manifested, statused, and checksummed before readiness",
);
assert.match(
  workflow,
  /npm run release:tauri-latest --[\s\S]*--input release-assets[\s\S]*--platform \$\{\{ matrix\.platform \}\}[\s\S]*--arch \$\{\{ runner\.arch \}\}[\s\S]*--fragment release-assets\/updater-fragment\.json/,
  "desktop package job must write updater fragments",
);
assert.match(
  workflow,
  /npm run release:next-steps -- --assets release-assets --output release-assets\/release-next-steps\.md[\s\S]*npm run release:finalize -- release-assets --checksums-only/,
  "optional desktop next-steps report must be generated before final checksums",
);
assert.match(
  workflow,
  /npm run release:finalize -- release-assets --checksums-only[\s\S]*npm run release:readiness -- release-assets --automated-only --platform \$\{\{ matrix\.platform \}\}/,
  "automated release readiness gate missing",
);
assert.match(
  workflow,
  /desktop-release:[\s\S]*name: Desktop Release Archives[\s\S]*needs:[\s\S]*- package/,
  "manual desktop archive job must wait for desktop package job",
);
assert.match(
  workflow,
  /Download desktop release assets[\s\S]*pattern: agentwatch-release-\*[\s\S]*path: desktop-release-assets/,
  "desktop archive job must download per-platform desktop release assets",
);
assert.match(
  workflow,
  /npm run release:bundle-desktop -- --input desktop-release-assets --output desktop-archives/,
  "desktop archive bundling step missing",
);
assert.match(
  workflow,
  /npm run release:verify-desktop-archives -- desktop-archives/,
  "desktop archive verification step missing",
);
assert.match(
  workflow,
  /npm run release:desktop-status -- --archives desktop-archives --json --output desktop-archives\/desktop-release-status\.json[\s\S]*npm run release:desktop-status -- --archives desktop-archives --output desktop-archives\/desktop-release-status\.md/,
  "desktop archive status report generation missing",
);
assert.match(
  workflow,
  /\(cd desktop-archives && shasum -a 256 \*\.tar\.gz desktop-release-status\.json desktop-release-status\.md > SHA256SUMS\.txt\)/,
  "desktop archive checksum step must include status reports",
);
assert.match(workflow, /name: agentwatch-desktop-release-archives/, "desktop release archive upload missing");
assert.match(
  workflow,
  /desktop-github-release:[\s\S]*name: GitHub Desktop Release[\s\S]*github\.event_name == 'workflow_dispatch' && inputs\.include_desktop && startsWith\(github\.ref, 'refs\/tags\/'\)[\s\S]*needs:[\s\S]*- desktop-release[\s\S]*- release/,
  "desktop GitHub release job must run for manual tagged desktop releases after service release",
);
assert.match(
  workflow,
  /Download desktop release archives[\s\S]*name: agentwatch-desktop-release-archives[\s\S]*path: desktop-archives/,
  "desktop GitHub release job must download desktop archive artifact",
);
assert.match(
  workflow,
  /Download desktop updater assets[\s\S]*pattern: agentwatch-release-\*[\s\S]*path: desktop-release-assets/,
  "desktop GitHub release job must download updater assets",
);
assert.match(
  workflow,
  /npm run release:verify-desktop-archives -- desktop-archives --require-final[\s\S]*npm run release:desktop-status -- --archives desktop-archives --check[\s\S]*\(cd desktop-archives && shasum -a 256 -c SHA256SUMS\.txt\)[\s\S]*npm run release:tauri-latest --[\s\S]*--fragments desktop-release-assets[\s\S]*--output desktop-updater-assets\/latest\.json[\s\S]*gh release upload "\$\{GITHUB_REF_NAME\}" "\$\{files\[@\]\}" --clobber/,
  "desktop GitHub release job must require final desktop readiness and publish updater assets before uploading",
);
assert.match(workflow, /verify-tray-windows\.ps1/, "Windows tray verifier syntax check missing");
assert.match(workflow, /verify-tray-windows-capture\.ps1/, "Windows tray capture helper syntax check missing");
assert.match(workflow, /verify-tray-config\.mjs/, "tray config verifier syntax check missing");
assert.match(workflow, /verify-tray-macos-capture\.sh/, "macOS tray capture helper check missing");
assert.match(workflow, /verify-tray-linux\.sh/, "Linux tray verifier helper check missing");
assert.match(workflow, /verify-tray-linux-capture\.sh/, "Linux tray capture helper check missing");
assert.match(workflow, /verify-service\.mjs/, "service verifier syntax check missing");
assert.match(workflow, /verify-service-lifecycle\.mjs/, "service lifecycle verifier syntax check missing");
assert.match(workflow, /verify-remote-client\.mjs/, "remote client verifier syntax check missing");
assert.match(workflow, /verify-remote-macos\.sh/, "macOS remote verifier helper check missing");
assert.match(workflow, /verify-remote-linux\.sh/, "Linux remote verifier helper check missing");
assert.match(workflow, /verify-remote-windows\.ps1/, "Windows remote verifier syntax check missing");
assert.match(workflow, /bundle-service-release\.mjs/, "service bundle syntax check missing");
assert.match(workflow, /archive-service-release\.mjs/, "service archive syntax check missing");
assert.match(workflow, /verify-service-archives\.mjs/, "service archive verifier syntax check missing");
assert.match(workflow, /verify-desktop-archives\.mjs/, "desktop archive verifier syntax check missing");
assert.match(workflow, /release-audit\.mjs/, "completion audit syntax check missing");
assert.match(workflow, /release-remote-guide\.mjs/, "remote guide syntax check missing");
assert.match(workflow, /release-tray-guide\.mjs/, "tray guide syntax check missing");
assert.match(workflow, /release-manifest\.mjs/, "release manifest syntax check missing");
assert.match(workflow, /release-summary\.mjs/, "release summary syntax check missing");
assert.match(workflow, /release-status\.mjs/, "release status syntax check missing");
assert.match(workflow, /desktop-release-status\.mjs/, "desktop release status syntax check missing");
assert.match(workflow, /write-tauri-latest-json\.mjs/, "Tauri updater latest.json helper syntax check missing");
assert.match(workflow, /release-next-steps\.mjs/, "release next steps syntax check missing");
assert.match(workflow, /service-status\.mjs/, "service status syntax check missing");
assert.match(workflow, /lan-preflight\.mjs/, "LAN preflight syntax check missing");
assert.match(workflow, /import-remote-report\.mjs/, "remote report import syntax check missing");
assert.match(workflow, /import-tray-report\.mjs/, "tray report import syntax check missing");
assert.match(workflow, /tray-manual-report\.mjs/, "tray manual report helper syntax check missing");
assert.match(workflow, /verify-service-macos\.sh/, "macOS service verifier helper check missing");
assert.match(workflow, /verify-service-linux\.sh/, "Linux service verifier helper check missing");
assert.match(workflow, /verify-service-windows\.ps1/, "Windows service verifier syntax check missing");
assert.match(workflow, /install-service-macos\.sh/, "macOS service installer syntax check missing");
assert.match(workflow, /uninstall-service-macos\.sh/, "macOS service uninstaller syntax check missing");
assert.match(workflow, /install-service-linux\.sh/, "Linux service installer syntax check missing");
assert.match(workflow, /uninstall-service-linux\.sh/, "Linux service uninstaller syntax check missing");
assert.match(workflow, /install-service-windows\.ps1/, "Windows service installer syntax check missing");
assert.match(workflow, /uninstall-service-windows\.ps1/, "Windows service uninstaller syntax check missing");

console.log("ci workflow tests ok");
