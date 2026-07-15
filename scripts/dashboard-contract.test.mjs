import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync("static/index.html", "utf8");
const js = readFileSync("static/app.js", "utf8");
const css = readFileSync("static/styles.css", "utf8");

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
  "5시간",
  "1주",
  "observedTokens",
  "maxDayTokens",
  "observedTokens || 0",
  "rate-limit 또는 quota 메시지",
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
]) {
  assert.match(js, new RegExp(escapeRegExp(marker)), `dashboard JS missing ${marker}`);
}

assert.doesNotMatch(
  js,
  /버튼이 활성화됩니다/,
  "local-only copy must not claim the JSON button is disabled until remote",
);

for (const marker of [
  ".remote-verify-panel",
  ".remote-verify-body",
  ".remote-verify-badge.passed",
  ".remote-verify-badge.local",
  ".remote-verify-facts",
  ".lan-row",
  ".copy-url-btn",
  ".lan-hint",
  ".port-setup-panel",
  ".port-setup-panel.hidden",
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
  ".thread-summary",
  ".thread-details[open]",
  "grid-column: 2",
  "grid-row: 2",
  ".quota-row",
  ".provider-quota-row",
  ".quota-window",
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
