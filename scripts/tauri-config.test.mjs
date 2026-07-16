import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const plist = readFileSync("src-tauri/Info.plist", "utf8");
const mainRs = readFileSync("src-tauri/src/main.rs", "utf8");
const libRs = readFileSync("src-tauri/src/lib.rs", "utf8");
const trayRs = readFileSync("src-tauri/src/tray.rs", "utf8");
const bundle = config.bundle || {};

assert.equal(config.productName, "AgentWatch");
assert.equal(config.identifier, "app.agentwatch.desktop");
assert.equal(bundle.active, true);
assert.equal(bundle.createUpdaterArtifacts, true);
assert.equal(bundle.targets, "all");
assert.equal(bundle.publisher, "AgentWatch");
assert.equal(bundle.license, "MIT OR Apache-2.0");
assert.equal(bundle.category, "DeveloperTool");
assert.equal(bundle.windows?.allowDowngrades, false);
assert.equal(bundle.windows?.webviewInstallMode?.type, "downloadBootstrapper");
assert.equal(bundle.windows?.webviewInstallMode?.silent, true);
assert.equal(bundle.windows?.nsis?.installMode, "currentUser");
assert.equal(bundle.windows?.nsis?.startMenuFolder, "AgentWatch");
assert.equal(bundle.linux?.deb?.section, "utils");
assert.equal(bundle.linux?.deb?.priority, "optional");
assert.equal(bundle.linux?.rpm?.release, "1");
assert.equal(bundle.macOS?.bundleName, "AgentWatch");
assert.equal(bundle.macOS?.hardenedRuntime, true);
assert.equal(bundle.macOS?.minimumSystemVersion, "11.0");
assert.equal(bundle.macOS?.infoPlist, "Info.plist");
assert.match(config.plugins?.updater?.pubkey || "", /^[A-Za-z0-9+/=]+$/, "updater public key missing");
assert.ok(
  config.plugins?.updater?.endpoints?.includes("https://github.com/donghwan0206/agentwatch/releases/latest/download/latest.json"),
  "GitHub latest.json updater endpoint missing",
);
assert.equal(config.plugins?.updater?.windows?.installMode, "passive");
assert.equal(packageJson.scripts["build:mac"], "tauri build --bundles app");
assert.equal(packageJson.scripts["build:mac:dmg"], "npm run build:mac && npm run build:mac:plain-dmg");
assert.equal(packageJson.scripts["build:mac:release"], "npm run build:mac:dmg");
assert.equal(packageJson.scripts["build:windows"], "tauri build --bundles nsis,msi");
assert.equal(packageJson.scripts["build:linux"], "tauri build --bundles appimage,deb,rpm");
assert.match(plist, /<key>LSUIElement<\/key>\s*<true\/>/);
assert.ok(bundle.icon?.includes("icons/icon.icns"), "macOS icon missing");
assert.ok(bundle.icon?.includes("icons/icon.ico"), "Windows icon missing");
assert.match(
  mainRs,
  /cfg_attr\(\s*all\(target_os = "windows", not\(debug_assertions\)\),\s*windows_subsystem = "windows"\s*\)/,
  "Windows release builds must use the windows subsystem to avoid a console window",
);
assert.match(
  libRs,
  /set_activation_policy\(tauri::ActivationPolicy::Accessory\)/,
  "macOS app must run as an accessory/menu-bar style app",
);
assert.match(libRs, /set_dock_visibility\(false\)/, "macOS dock icon must be hidden");
assert.match(libRs, /CloseRequested[\s\S]*prevent_close\(\)[\s\S]*window\.hide\(\)/, "closing the window must hide it");
assert.match(libRs, /let tray_enabled = !no_tray_mode\(\)/, "tray must be enabled by default");
assert.match(libRs, /if tray_enabled[\s\S]*tray::install/, "tray install must run when tray is enabled");
assert.match(libRs, /Err\(error\)[\s\S]*AgentWatch tray setup failed/, "tray setup failure must not terminate the monitor app");
assert.match(libRs, /show_window_on_start\(\)/, "startup window display must be gated");
assert.match(libRs, /AGENTWATCH_SHOW_WINDOW_ON_START/, "startup window override env var missing");
assert.match(libRs, /tauri_plugin_updater::Builder::new\(\)\.build\(\)/, "Tauri updater plugin must be initialized");
assert.match(libRs, /download_and_install/, "Tauri updater must install available updates");
assert.match(
  libRs,
  /if !tray_installed \|\| show_window_on_start\(\)[\s\S]*window\.show\(\)[\s\S]*window\.set_focus\(\)/,
  "main window must show when tray setup fails or startup display is enabled",
);
assert.match(libRs, /cfg\(target_os = "macos"\)[\s\S]*fn default_show_window_on_start\(\) -> bool[\s\S]*false/, "macOS should keep tray startup hidden by default");
assert.match(libRs, /cfg\(not\(target_os = "macos"\)\)[\s\S]*fn default_show_window_on_start\(\) -> bool[\s\S]*true/, "Windows and Linux should show the settings/dashboard window on launch");
for (const id of ["status", "runtime", "agents", "local_url", "lan_url", "open", "quit"]) {
  assert.match(trayRs, new RegExp(`"${id}"`), `tray menu item ${id} missing`);
}
assert.match(trayRs, /Agents:/, "tray menu must include active agent summary text");
assert.match(trayRs, /fn agent_summary/, "tray menu must derive active agent summary from monitor providers");
assert.match(trayRs, /set_tooltip/, "tray tooltip updates missing");
assert.match(trayRs, /set_title/, "tray title/status updates missing");
assert.match(trayRs, /fn agent_monitor_icon/, "dedicated tray icon helper missing");
assert.match(trayRs, /Image::new_owned/, "tray icon must use a generated template bitmap");
assert.match(trayRs, /cfg\(target_os = "macos"\)[\s\S]*\.icon_as_template\(true\)/, "tray icon must adapt to macOS light and dark modes");
assert.match(trayRs, /cfg\(not\(target_os = "macos"\)\)[\s\S]*Image::from_bytes\(include_bytes!\("\.\.\/icons\/32x32\.png"\)\)/, "Windows and Linux tray icons must use the visible color app icon");
assert.match(trayRs, /show_main_window/, "tray open action missing");

console.log("tauri config tests ok");
