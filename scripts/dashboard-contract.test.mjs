import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync("static/index.html", "utf8");
const js = readFileSync("static/app.js", "utf8");
const css = readFileSync("static/styles.css", "utf8");
const server = readFileSync("src-tauri/src/server.rs", "utf8");
const monitorCollector = readFileSync("src-tauri/src/monitor.rs", "utf8");
const usageCollector = readFileSync("src-tauri/src/usage.rs", "utf8");

for (const marker of [
  "브라우저 원격 검증",
  "copyLanUrlBtn",
  "lanHint",
  "downloadRemoteReportBtn",
  "remoteVerifyBadge",
  "remoteVerifyTitle",
  "remoteClientIp",
  "remoteLoopback",
  "remoteSameHostIp",
  "remoteEvidenceName",
  "topbar-tools",
  "header-actions",
  "top-menu",
  "portSummary",
  "observedTokens",
  "maxDayTokens",
  "tokenProviderFilters",
  "thread-details",
  "일별 토큰 잔디",
  "남은 사용량",
  "portSetupPanel",
  "portInput",
  "대시보드 포트 설정",
  "usageLocationPanel",
  "usageLocationList",
  "토큰 로그 위치",
]) {
  assert.match(html, new RegExp(escapeRegExp(marker)), `dashboard HTML missing ${marker}`);
}

for (const marker of [
  "status-grid",
  "현재 활동",
  "activityTitle",
  "activityCopy",
  "processCount",
  "cpuTotal",
]) {
  assert.doesNotMatch(html, new RegExp(escapeRegExp(marker)), `dashboard HTML should not include ${marker}`);
}

assert.ok(
  html.indexOf('class="panel trend-panel"') < html.indexOf('class="panel thread-panel thread-details"'),
  "thread token panel must be placed under the recent activity panel",
);

for (const marker of [
  'fetchJson("/api/config")',
  'fetchJson("/api/usage-locations")',
  'fetch("/api/config/port"',
  'fetch("/api/config/usage-paths"',
  'fetchJson("/api/remote-check")',
  'fetchJson("/api/usage?days=366")',
  "renderPortSetup",
  "renderUsageLocations",
  "saveUsagePaths",
  "copyUsageLocationCommand",
  "terminalCommand",
  "savePortConfig",
  "portPlaceholder",
  "portSetupCopy",
  "portSetupStatus",
  "portSummary",
  "renderRemoteVerify",
  "copyLanUrl",
  "copyText",
  "selectLanUrl",
  "lanCopyButtonText",
  "remoteAccessHint",
  "buildBrowserRemoteReport",
  "downloadRemoteReport",
  "normalizeUsagePayload",
  "normalizeUsageItem",
  "normalizeUsageTotals",
  "providerQuotaSummaries",
  "fiveHourUnlimited",
  "findQuotaForWindow",
  "renderTokenGrass",
  "renderTokenProviderFilters",
  "selectedTokenUsage",
  "syncTokenGrassViewport",
  "updateTokenGrassOverflow",
  "buildGrassDays(daily, 365)",
  "end.setDate(end.getDate() + (6 - end.getDay()))",
  "cursor.setDate(cursor.getDate() - cursor.getDay())",
  "activeProviders",
  "activeProviderHistory",
  "GPT",
  "Gemini",
  "Claude",
  "selectedTokenProvider",
  "usageNotesExpanded",
  "usageNotesToggle",
  "전체 로그",
  "5시간",
  "1주",
  "제한 없음",
  "현재 미적용",
  "observedTokens",
  "maxDayTokens",
  "observedTokens || 0",
  "Codex CLI 로그인 상태",
  "remote-client-verification-${platform}.json",
  'verifier: "browser-dashboard"',
  'result: isRemote ? "passed" : "local-only"',
  "remoteCheckEndpoint: \"passed\"",
  "remoteClient: remote.remoteClient === true",
  "sameHost: !isRemote",
  "지금 파일은 local-only 참고용입니다",
  "최종 검증 JSON으로 바뀝니다",
  "remote 검증으로 바뀝니다",
  "선택됨",
  "schedulePoll",
  "refreshLive",
  "refreshActivity",
  "refreshUsage",
  "visibilitychange",
  "document.visibilityState",
  "LIVE_REFRESH_MS",
  "ACTIVITY_REFRESH_MS",
  "USAGE_REFRESH_MS",
  'fetch("/api/usage/refresh"',
  "mergeHistoryPoints",
  "mergeProviderHistoryPoints",
]) {
  assert.match(js, new RegExp(escapeRegExp(marker)), `dashboard JS missing ${marker}`);
}

assert.doesNotMatch(
  js,
  /setInterval\(\(\) => refresh\(\)/,
  "dashboard must not launch overlapping full refreshes",
);

for (const marker of [
  "const LIVE_REFRESH_MS = 60_000",
  "const ACTIVITY_REFRESH_MS = 120_000",
  "const USAGE_REFRESH_MS = 600_000",
  "const META_REFRESH_MS = 300_000",
  "minutes=180&bucket=60",
]) {
  assert.match(js, new RegExp(escapeRegExp(marker)), `dashboard low-frequency polling missing ${marker}`);
}

for (const marker of [
  "MONITOR_SAMPLE_INTERVAL_SECONDS: u64 = 60",
  "USAGE_REFRESH_INTERVAL_SECONDS: u64 = 600",
]) {
  assert.match(server, new RegExp(escapeRegExp(marker)), `server low-power interval missing ${marker}`);
}

for (const marker of [
  "System::new()",
  "refresh_processes_specifics",
  "ProcessRefreshKind::nothing()",
  "with_cpu()",
  "with_memory()",
  "with_cmd(UpdateKind::OnlyIfNotSet)",
]) {
  assert.match(monitorCollector, new RegExp(escapeRegExp(marker)), `process refresh scope missing ${marker}`);
}
assert.doesNotMatch(monitorCollector, /System::new_all\(\)/, "monitor must not initialize unused system metrics");

for (const marker of [
  "usage_cache: RwLock<Option<CachedUsage>>",
  "compare_exchange(false, true",
  "spawn_blocking(|| usage::collect_all(366))",
  'route("/api/usage/refresh", post(refresh_usage_route))',
  "state.usage_payload(days)",
]) {
  assert.match(server, new RegExp(escapeRegExp(marker)), `server missing usage cache contract: ${marker}`);
}
assert.doesNotMatch(
  server,
  /async fn usage_route[\s\S]{0,600}usage::collect_all/,
  "usage API route must not scan logs synchronously",
);

for (const marker of [
  "cursor INTEGER NOT NULL DEFAULT 0",
  "collect_codex_sqlite_events_from",
  "collect_codex_jsonl_events_from",
  "collect_claude_jsonl_events_from",
  "SeekFrom::Start(cursor)",
  "ORDER BY rowid DESC",
  "LIMIT 5000",
  '"account/rateLimits/read"',
  '"codex-app-server"',
  '"CODEX_CLI_PATH"',
  "codex-x86_64-pc-windows-msvc.exe",
  "OpenAI.Codex_",
  "Duration::from_secs(8)",
]) {
  assert.match(
    usageCollector,
    new RegExp(escapeRegExp(marker)),
    `usage collector missing incremental contract: ${marker}`,
  );
}
assert.doesNotMatch(
  js,
  /Promise\.all\(\[[\s\S]*usage\?days=366[\s\S]*provider-history\?minutes=180/,
  "heavy usage and activity requests must not share the live refresh cycle",
);

for (const marker of [
  "renderSummary",
  "statusLabels",
  "activityTitle",
  "activityCopy",
]) {
  assert.doesNotMatch(js, new RegExp(escapeRegExp(marker)), `dashboard JS should not include ${marker}`);
}

assert.doesNotMatch(js, /\$\(["']processCount["']\)/, "dashboard JS should not render the removed process count card");
assert.doesNotMatch(js, /\$\(["']cpuTotal["']\)/, "dashboard JS should not render the removed CPU total card");

assert.doesNotMatch(
  js,
  /버튼이 활성화됩니다/,
  "local-only copy must not claim the JSON button is disabled until remote",
);

for (const marker of [
  ".topbar-tools",
  ".header-actions",
  ".top-menu",
  ".top-menu-body",
  ".top-menu.attention",
  ".compact-head",
  ".remote-verify-badge.passed",
  ".remote-verify-badge.local",
  ".remote-verify-facts",
  ".lan-row",
  ".copy-url-btn",
  ".lan-hint",
  ".port-menu",
  ".port-setup-form",
  ".port-setup-status",
  ".usage-location-panel",
  ".usage-location-summary",
  ".usage-location-provider",
  ".usage-path-input",
  ".usage-location-command",
  ".token-grass-viewport",
  ".token-provider-filters",
  ".token-provider-filters button.active",
  ".token-grass-viewport.has-left-overflow::before",
  ".token-grass",
  ".token-cell.future",
  ".token-stats",
  ".usage-notes-summary",
  ".usage-notes-preview",
  ".usage-notes-list",
  ".thread-summary",
  ".thread-details[open]",
  "grid-column: 2",
  "grid-row: 2",
  ".quota-row",
  ".provider-quota-row",
  ".quota-window",
  ".quota-window.unlimited",
  "grid-template-rows: repeat(7, var(--grass-cell))",
  "grid-auto-columns: var(--grass-cell)",
  "scrollbar-color",
  "overflow-x: auto",
  ".goal-row",
  "max-width: 100%",
  "overflow-wrap: anywhere",
  "grid-template-columns: repeat(24, minmax(0, 1fr))",
]) {
  assert.match(css, new RegExp(escapeRegExp(marker)), `dashboard CSS missing ${marker}`);
}

console.log("dashboard contract tests ok");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
