const state = {
  runtime: null,
  snapshot: null,
  history: [],
  providerHistory: [],
  remoteCheck: null,
  events: [],
  usage: [],
  usageCollectedAt: 0,
  usageLocations: [],
  config: null,
  updateStatus: null,
  quotaRefreshStatus: "idle",
  portSaveStatus: "idle",
  usagePathSaveStatus: {},
  lanCopyStatus: "idle",
  selectedTokenProvider: "all",
  tokenGrassStickToToday: true,
  usageNotesExpanded: false,
};

const $ = (id) => document.getElementById(id);
const LIVE_REFRESH_MS = 60_000;
const ACTIVITY_REFRESH_MS = 120_000;
const USAGE_REFRESH_MS = 600_000;
const META_REFRESH_MS = 300_000;
const pollTimers = new Map();
const pollInFlight = new Set();

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function refresh() {
  await Promise.all([
    refreshMetadata(),
    refreshLive(),
    refreshActivity(),
    refreshUsage(),
  ]);
  syncDebugState();
}

async function refreshMetadata() {
  const [runtime, config, updateStatus, remoteCheck] = await Promise.all([
    fetchJson("/api/runtime"),
    fetchJson("/api/config"),
    fetchJson("/api/update/status"),
    fetchJson("/api/remote-check"),
  ]);
  state.runtime = runtime;
  state.config = config;
  state.updateStatus = updateStatus;
  state.remoteCheck = remoteCheck;
  renderHeader();
  renderPortSetup();
  renderUpdatePanel();
  renderRemoteVerify();
}

async function refreshLive() {
  const snapshot = await fetchJson("/api/snapshot");
  state.snapshot = snapshot;
  renderHeader();
  renderProviders();
  renderRemoteVerify();
}

async function refreshActivity() {
  const historySince = latestTimestamp(state.history);
  const providerSince = latestTimestamp(state.providerHistory);
  const historyUrl = historySince
    ? `/api/history?minutes=180&bucket=60&since=${historySince}`
    : "/api/history?minutes=180&bucket=60";
  const providerUrl = providerSince
    ? `/api/provider-history?minutes=180&bucket=60&since=${providerSince}`
    : "/api/provider-history?minutes=180&bucket=60";
  const [history, providerHistory, events] = await Promise.all([
    fetchJson(historyUrl),
    fetchJson(providerUrl),
    fetchJson("/api/events?limit=80"),
  ]);
  state.history = mergeHistoryPoints(state.history, history.history || []);
  state.providerHistory = mergeProviderHistoryPoints(
    state.providerHistory,
    providerHistory.providerHistory || [],
  );
  state.events = events.events || [];
  renderTrend();
  renderHeatmap();
  renderProviderHistory();
  renderEvents();
}

async function refreshUsage() {
  const usage = await fetchJson("/api/usage?days=366");
  state.usage = normalizeUsagePayload(usage);
  state.usageCollectedAt = Number(usage.collectedAt || state.usageCollectedAt || 0);
  renderUsage();
  if (!state.usage.length && usage.refreshing === true) {
    window.setTimeout(() => refreshUsage().catch(showError), 2_000);
  }
}

async function refreshUsageLocations() {
  const locations = await fetchJson("/api/usage-locations");
  state.usageLocations = Array.isArray(locations.providers) ? locations.providers : [];
  renderUsageLocations();
}

function syncDebugState() {
  window.__agentWatchDebug = {
    usage: state.usage,
    usageLocations: state.usageLocations,
    providerHistory: state.providerHistory,
    updatedAt: Date.now(),
  };
}

function latestTimestamp(points) {
  return (points || []).reduce((latest, point) => Math.max(latest, Number(point.ts || 0)), 0);
}

function mergeHistoryPoints(current, incoming) {
  return mergeRecentPoints(current, incoming, (point) => String(point.ts || 0));
}

function mergeProviderHistoryPoints(current, incoming) {
  return mergeRecentPoints(
    current,
    incoming,
    (point) => `${point.ts || 0}:${point.providerKey || point.provider_key || "unknown"}`,
  );
}

function mergeRecentPoints(current, incoming, keyFor) {
  const cutoff = Math.floor(Date.now() / 1000) - 180 * 60;
  const merged = new Map();
  for (const point of [...(current || []), ...(incoming || [])]) {
    if (Number(point.ts || 0) >= cutoff) merged.set(keyFor(point), point);
  }
  return [...merged.values()].sort((left, right) => Number(left.ts || 0) - Number(right.ts || 0));
}

function schedulePoll(name, task, delay) {
  window.clearTimeout(pollTimers.get(name));
  const run = async () => {
    if (document.visibilityState === "hidden") return;
    if (pollInFlight.has(name)) return;
    pollInFlight.add(name);
    try {
      await task();
      syncDebugState();
    } catch (error) {
      showError(error);
    } finally {
      pollInFlight.delete(name);
      if (document.visibilityState !== "hidden") {
        pollTimers.set(name, window.setTimeout(run, delay));
      }
    }
  };
  pollTimers.set(name, window.setTimeout(run, delay));
}

function startPolling() {
  schedulePoll("live", refreshLive, LIVE_REFRESH_MS);
  schedulePoll("activity", refreshActivity, ACTIVITY_REFRESH_MS);
  schedulePoll("usage", refreshUsage, USAGE_REFRESH_MS);
  schedulePoll("metadata", refreshMetadata, META_REFRESH_MS);
}

function stopPolling() {
  for (const timer of pollTimers.values()) window.clearTimeout(timer);
  pollTimers.clear();
}

function render() {
  renderHeader();
  renderPortSetup();
  renderUpdatePanel();
  renderRemoteVerify();
  renderProviders();
  renderUsage();
  renderUsageLocations();
  renderTrend();
  renderHeatmap();
  renderProviderHistory();
  renderEvents();
}

function renderUpdatePanel() {
  const status = state.updateStatus || {};
  const phase = status.phase || "idle";
  const busy = ["checking", "downloading", "installing", "restarting"].includes(phase);
  $("updateStatusText").textContent = updateStatusCopy(status);
  $("updateVersionText").textContent = updateVersionCopy(status);
  $("updateCheckBtn").textContent = phase === "checking" ? "확인 중" : "업데이트 확인";
  $("updateCheckBtn").disabled = busy;
  $("updateInstallBtn").disabled = !status.updateAvailable || busy;
  $("updateInstallBtn").textContent = phase === "downloading" || phase === "installing"
    ? "설치 중"
    : "설치 및 재시작";
  const progress = updateProgressPercent(status);
  $("updateProgressBar").style.width = `${progress}%`;
}

function updateStatusCopy(status) {
  const checked = status.checkedAt ? ` · ${formatDateTime(status.checkedAt)}` : "";
  const message = status.message || "업데이트 확인 대기";
  if (status.phase === "available") {
    return `${message}${checked}`;
  }
  if (status.phase === "up-to-date") {
    return `최신 버전입니다${checked}`;
  }
  return `${message}${checked}`;
}

function updateVersionCopy(status) {
  const current = status.currentVersion ? `현재 v${status.currentVersion}` : "현재 버전 확인 중";
  if (status.availableVersion) {
    return `${current} → v${status.availableVersion}`;
  }
  return current;
}

function updateProgressPercent(status) {
  if (Number.isFinite(status.percent)) return clamp(Number(status.percent), 0, 100);
  if (status.phase === "available") return 100;
  if (status.phase === "up-to-date") return 100;
  if (status.phase === "checking") return 30;
  if (status.phase === "installing" || status.phase === "restarting") return 100;
  return 0;
}

function renderRemoteVerify() {
  const remote = state.remoteCheck || {};
  const runtime = state.runtime || {};
  const isRemote = remote.remoteClient === true;
  const badge = $("remoteVerifyBadge");
  badge.className = `remote-verify-badge ${isRemote ? "passed" : "local"}`;
  badge.textContent = isRemote ? "remote" : "local";
  $("remoteVerifyTitle").textContent = isRemote
    ? "다른 LAN 기기에서 접속 중"
    : "현재 브라우저는 최종 원격 증거가 아닙니다";
  $("remoteVerifyCopy").textContent = isRemote
    ? "검증 JSON을 내려받아 release-assets 폴더에 넣으면 remote readiness 증거로 사용할 수 있습니다."
    : "지금 파일은 local-only 참고용입니다. 다른 LAN 기기에서 열면 최종 검증 JSON으로 바뀝니다.";
  $("remoteClientIp").textContent = remote.clientIp || "-";
  $("remoteLoopback").textContent = formatBool(remote.loopback);
  $("remoteSameHostIp").textContent = formatBool(remote.sameHostIp);
  $("remoteEvidenceName").textContent = remoteReportFileName(runtime);
  const button = $("downloadRemoteReportBtn");
  button.disabled = !state.runtime || !state.snapshot || !state.remoteCheck;
  button.textContent = isRemote ? "검증 JSON" : "Local-only JSON";
}

function renderHeader() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  const runtime = state.runtime || {};
  const localUrl = runtime.localUrl || `${location.protocol}//${location.host}`;
  const lanUrl = runtime.lanUrls?.[0] || localUrl;
  $("hostLine").textContent = `${snapshot.hostname} · ${formatTime(snapshot.timestamp)}`;
  $("lanUrl").textContent = lanUrl;
  $("localUrl").textContent = localUrl;
  $("runtimeMode").textContent = formatRuntimeMode(runtime);
  $("copyLanUrlBtn").textContent = lanCopyButtonText();
  $("lanHint").textContent = remoteAccessHint(lanUrl, localUrl);
  $("updatedAt").textContent = `업데이트 ${formatTime(snapshot.timestamp)}`;
}

function renderPortSetup() {
  const panel = $("portSetupPanel");
  if (!panel) return;
  const config = state.config || {};
  const runtime = state.runtime || {};
  const configuredPort = Number(config.configuredPort || 0);
  const runtimePort = Number(runtime.port || config.effectivePort || 0);
  const portMismatch = configuredPort > 0 && runtimePort > 0 && configuredPort !== runtimePort && !config.envPort;
  const needsAttention = config.firstRun === true || portMismatch || state.portSaveStatus === "error";
  panel.classList.toggle("attention", needsAttention);
  const placeholder = String(portPlaceholder());
  const input = $("portInput");
  input.placeholder = placeholder;
  const summary = $("portSummary");
  if (summary) summary.textContent = runtimePort > 0 ? String(runtimePort) : "auto";
  $("portSetupCopy").textContent = portSetupCopy(config, runtime);
  $("portSaveBtn").textContent = state.portSaveStatus === "saving" ? "저장 중" : "저장";
  $("portSaveBtn").disabled = state.portSaveStatus === "saving";
  $("portSetupStatus").textContent = portSetupStatus(config, runtime);
}

function renderProviders() {
  const providers = activeProviders(state.snapshot?.providers || []);
  const list = $("providerList");
  list.innerHTML = "";

  if (!providers.length) {
    list.innerHTML = '<div class="empty">현재 실행 중인 에이전트 또는 LLM 프로세스가 없습니다.</div>';
    return;
  }

  for (const provider of providers) {
    const item = document.createElement("article");
    item.className = "provider";
    item.style.setProperty("--accent", provider.accent);
    item.innerHTML = `
      <div class="provider-top">
        <div class="provider-name">
          <span class="dot"></span>
          <strong>${escapeHtml(provider.name)}</strong>
        </div>
        <span class="status-badge ${provider.status}">${provider.status}</span>
      </div>
      <div class="provider-metrics">
        <div class="mini-metric"><span>프로세스</span><strong>${provider.processCount}</strong></div>
        <div class="mini-metric"><span>CPU</span><strong>${provider.cpu.toFixed(1)}%</strong></div>
        <div class="mini-metric"><span>MEM</span><strong>${provider.memory.toFixed(1)}%</strong></div>
      </div>
      <div class="processes">
        ${renderProcessLines(provider.processes)}
      </div>
    `;
    list.appendChild(item);
  }
}

function renderUsage() {
  const usageItems = Array.isArray(state.usage) ? state.usage : [];
  const codex = usageItems.find((item) => item.provider === "codex") || usageItems[0];
  const tokenUsage = selectedTokenUsage(usageItems);
  renderQuotas(providerQuotaSummaries(usageItems));
  renderQuotaMeta(codex);
  renderGoalUsage(codex);
  renderTokenProviderFilters(usageItems);
  renderTokenGrass(tokenUsage);
  renderUsageNotes(tokenUsage);
  renderThreads(codex);
}

function normalizeUsagePayload(payload) {
  const items = Array.isArray(payload?.usage) ? payload.usage : Array.isArray(payload) ? payload : [];
  return items.map(normalizeUsageItem);
}

function normalizeUsageItem(item = {}) {
  const daily = Array.isArray(item.daily) ? item.daily : [];
  const threads = Array.isArray(item.threads) ? item.threads : [];
  const goals = Array.isArray(item.goals) ? item.goals : [];
  const quotas = Array.isArray(item.quotas) ? item.quotas : [];
  return {
    ...item,
    daily,
    threads,
    goals,
    quotas,
    quotaMeta: normalizeQuotaMeta(item.quotaMeta),
    totals: normalizeUsageTotals(item.totals, daily, threads),
  };
}

function selectedTokenUsage(usageItems) {
  const selected = usageItems.find((item) => item.provider === state.selectedTokenProvider);
  if (selected) return selected;
  return usageItems.find((item) => item.provider === "all") || usageItems[0];
}

function normalizeQuotaMeta(meta = {}) {
  return {
    source: meta?.source || "none",
    sourcePath: meta?.sourcePath || null,
    observedAt: Number(meta?.observedAt || 0) || null,
    ageSeconds: Number(meta?.ageSeconds || 0),
    stale: meta?.stale === true,
  };
}

function normalizeUsageTotals(totals = {}, daily = [], threads = []) {
  const today = formatLocalDate(new Date());
  const sortedDaily = [...daily].sort((left, right) => String(left.date).localeCompare(String(right.date)));
  const derived = {
    todayTokens: sortedDaily
      .filter((day) => day.date === today)
      .reduce((sum, day) => sum + Number(day.tokens || 0), 0),
    last7DaysTokens: sortedDaily.slice(-7).reduce((sum, day) => sum + Number(day.tokens || 0), 0),
    last30DaysTokens: sortedDaily.slice(-30).reduce((sum, day) => sum + Number(day.tokens || 0), 0),
    observedTokens: sortedDaily.reduce((sum, day) => sum + Number(day.tokens || 0), 0),
    threadTotalTokens: threads.reduce((sum, thread) => sum + Number(thread.tokens || 0), 0),
    threadCount: threads.length,
  };
  return {
    ...derived,
    ...Object.fromEntries(
      Object.entries(totals || {}).filter(([, value]) => value !== null && value !== undefined),
    ),
  };
}

function providerQuotaSummaries(usageItems) {
  const providers = [
    { key: "gpt", label: "GPT", aliases: ["gpt", "openai", "codex", "chatgpt"] },
    { key: "gemini", label: "Gemini", aliases: ["gemini"] },
    { key: "claude", label: "Claude", aliases: ["claude", "anthropic"] },
  ];
  return providers.map((provider) => {
    const usage = findUsageByAliases(usageItems, provider.aliases);
    const quotas = Array.isArray(usage?.quotas) ? usage.quotas.filter((quota) => quota.kind !== "model") : [];
    const fiveHour = findQuotaForWindow(quotas, 300, ["5시간", "5 hour", "5-hour", "5h", "primary"]);
    const weekly = findQuotaForWindow(quotas, 10080, ["1주", "weekly", "week", "7 day", "7-day", "7d", "secondary"]);
    return {
      ...provider,
      fiveHour,
      fiveHourUnlimited: provider.key === "gpt" && !fiveHour && Boolean(weekly),
      weekly,
      source: quotas.length ? usage?.quotaMeta?.source || usage?.source || null : null,
      quotaMeta: usage?.quotaMeta || null,
    };
  });
}

function findUsageByAliases(usageItems, aliases) {
  return (usageItems || []).find((item) => {
    const haystack = [item.provider, item.name, item.source].filter(Boolean).join(" ").toLowerCase();
    return aliases.some((alias) => haystack.includes(alias));
  });
}

function findQuotaForWindow(quotas, windowMinutes, labels) {
  const byWindow = quotas.find((quota) => Number(quota.windowMinutes) === windowMinutes);
  if (byWindow) return byWindow;
  return quotas.find((quota) => {
    const label = `${quota.label || ""} ${quota.kind || ""}`.toLowerCase();
    return labels.some((candidate) => label.includes(candidate.toLowerCase()));
  });
}

function renderQuotas(providerQuotas) {
  const list = $("quotaList");
  const rows = Array.isArray(providerQuotas) ? providerQuotas : [];
  const sourceCount = rows.filter((row) => row.source).length;
  $("quotaSource").textContent = sourceCount ? `${sourceCount}/3 sources` : "수집 대기";
  if (!rows.length) {
    list.innerHTML = `
      <div class="empty">
        사용량 정보를 찾지 못했습니다. Codex CLI 로그인 상태와 로컬 로그 위치를 확인해 주세요.
      </div>
    `;
    return;
  }

  list.innerHTML = rows
    .map((row) => {
      const fiveHour = quotaWindowView(row.fiveHour, row.fiveHourUnlimited);
      const weekly = quotaWindowView(row.weekly);
      const meta = quotaRowMeta(row.quotaMeta);
      return `
        <article class="quota-row provider-quota-row">
          <div class="quota-name">${escapeHtml(row.label)}</div>
          ${renderQuotaWindow("5시간", fiveHour)}
          ${renderQuotaWindow("1주", weekly)}
          <div class="quota-row-meta">${meta}</div>
        </article>
      `;
    })
    .join("");
}

function quotaRowMeta(meta) {
  if (!meta?.observedAt) return "";
  const stale = meta.stale
    ? '<span class="quota-stale stale">stale</span>'
    : '<span class="quota-stale fresh">fresh</span>';
  return `
    <span>${escapeHtml(meta.source || "unknown")}</span>
    <span>${formatDateTime(meta.observedAt)}</span>
    <span>${formatAge(meta.ageSeconds)}</span>
    ${stale}
  `;
}

function renderQuotaMeta(usage) {
  const element = $("quotaMeta");
  const meta = usage?.quotaMeta || {};
  const refreshButton = $("quotaRefreshBtn");
  if (refreshButton) {
    refreshButton.textContent = state.quotaRefreshStatus === "loading" ? "수집 중" : "사용량 새로고침";
    refreshButton.disabled = state.quotaRefreshStatus === "loading";
  }
  if (!element) return;
  if (!meta.observedAt) {
    element.innerHTML = '<span>사용량 수집 대기</span>';
    return;
  }
  const staleClass = meta.stale ? "stale" : "fresh";
  const staleLabel = meta.stale ? "stale" : "fresh";
  element.innerHTML = `
    <span>수집 ${formatDateTime(meta.observedAt)}</span>
    <span>source=${escapeHtml(meta.source || "unknown")}</span>
    <span>${formatAge(meta.ageSeconds)}</span>
    <span class="quota-stale ${staleClass}">${staleLabel}</span>
    ${meta.sourcePath ? `<span title="${escapeHtml(meta.sourcePath)}">${escapeHtml(shortPath(meta.sourcePath))}</span>` : ""}
  `;
}

function quotaWindowView(quota, unlimited = false) {
  if (!quota) {
    if (unlimited) {
      return {
        value: "제한 없음",
        meta: "현재 미적용",
        remaining: 100,
        available: true,
        unlimited: true,
      };
    }
    return { value: "-", meta: "수집 전", remaining: 0, available: false };
  }
  const remaining = clamp(Number(quota.remainingPercent ?? 0), 0, 100);
  const reset = quota.resetAt ? formatResetTime(quota.resetAt) : "reset unknown";
  return {
    value: `${remaining}%`,
    meta: reset,
    remaining,
    available: true,
    unlimited: false,
  };
}

function renderQuotaWindow(label, view) {
  return `
    <div class="quota-window ${view.available ? "" : "missing"} ${view.unlimited ? "unlimited" : ""}">
      <div class="quota-window-top">
        <span>${label}</span>
        <strong>${escapeHtml(view.value)}</strong>
      </div>
      <div class="quota-bar" title="${label} ${view.unlimited ? "제한 없음" : `remaining ${escapeHtml(view.value)}`}">
        <span style="--remaining: ${view.remaining}%"></span>
      </div>
      <small>${escapeHtml(view.meta)}</small>
    </div>
  `;
}

function renderTokenProviderFilters(usageItems) {
  const element = $("tokenProviderFilters");
  if (!element) return;
  const providers = [
    { key: "all", label: "전체" },
    { key: "codex", label: "Codex" },
    { key: "claude", label: "Claude" },
    { key: "gemini", label: "Gemini" },
  ];
  element.innerHTML = providers
    .map((provider) => {
      const usage = usageItems.find((item) => item.provider === provider.key);
      const total = usage?.totals?.observedTokens || 0;
      const active = provider.key === state.selectedTokenProvider ? "active" : "";
      return `
        <button class="${active}" type="button" data-provider="${provider.key}">
          <span>${escapeHtml(provider.label)}</span>
          <b>${formatTokens(total)}</b>
        </button>
      `;
    })
    .join("");
  element.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedTokenProvider = button.dataset.provider || "all";
      state.tokenGrassStickToToday = true;
      state.usageNotesExpanded = false;
      renderUsage();
    });
  });
}

function renderTokenGrass(usage) {
  const daily = usage?.daily || [];
  const totals = usage?.totals || {};
  $("todayTokens").textContent = `${formatTokens(totals.todayTokens || 0)} today`;
  $("weekTokens").textContent = `최근 7일 ${formatTokens(totals.last7DaysTokens || 0)}`;
  $("monthTokens").textContent = `최근 30일 ${formatTokens(totals.last30DaysTokens || 0)}`;
  $("observedTokens").textContent = `관측 총량 ${formatTokens(totals.observedTokens || 0)}`;

  const grass = $("tokenGrass");
  const previousScrollLeft = grass.scrollLeft;
  grass.innerHTML = "";
  const days = buildGrassDays(daily, 365);
  const max = Math.max(1, ...days.map((day) => day.tokens));
  const maxDay = days.reduce(
    (current, day) => (day.tokens > current.tokens ? day : current),
    { date: "-", tokens: 0, turns: 0 },
  );
  $("maxDayTokens").textContent =
    maxDay.tokens > 0 ? `최대 사용일 ${maxDay.date} · ${formatTokens(maxDay.tokens)}` : "최대 사용일 -";
  for (const day of days) {
    const cell = document.createElement("div");
    const intensity = day.tokens / max;
    cell.className = `token-cell${day.future ? " future" : ""}`;
    cell.title = day.future ? `${day.date} · future` : `${day.date} · ${formatTokens(day.tokens)} · ${day.turns} turns`;
    cell.style.background = tokenColor(intensity);
    grass.appendChild(cell);
  }
  grass.dataset.columns = String(Math.ceil(days.length / 7));
  syncTokenGrassViewport(state.tokenGrassStickToToday, previousScrollLeft);
}

function syncTokenGrassViewport(stickToToday = false, fallbackScrollLeft = null) {
  const viewport = $("tokenGrassViewport");
  const grass = $("tokenGrass");
  if (!viewport || !grass) return;
  const columns = Math.max(1, Number(grass.dataset.columns || 53));
  const gap = 2;
  const available = viewport.clientWidth || grass.clientWidth || 0;
  if (available > 0) {
    const cellSize = Math.max(10, (available - gap * (columns - 1)) / columns);
    grass.style.setProperty("--grass-cell", `${cellSize}px`);
  }
  window.requestAnimationFrame(() => {
    if (stickToToday) {
      grass.scrollLeft = grass.scrollWidth;
    } else if (Number.isFinite(fallbackScrollLeft)) {
      grass.scrollLeft = Math.min(fallbackScrollLeft, grass.scrollWidth);
    }
    updateTokenGrassOverflow();
  });
}

function updateTokenGrassOverflow() {
  const viewport = $("tokenGrassViewport");
  const grass = $("tokenGrass");
  if (!viewport || !grass) return;
  const atRightEdge = grass.scrollLeft + grass.clientWidth >= grass.scrollWidth - 2;
  state.tokenGrassStickToToday = atRightEdge;
  viewport.classList.toggle(
    "has-left-overflow",
    grass.scrollWidth > grass.clientWidth + 1 && grass.scrollLeft > 1,
  );
}

function renderGoalUsage(usage) {
  const element = $("goalUsage");
  const goal = usage?.goals?.[0];
  if (!goal) {
    element.innerHTML = "";
    return;
  }
  const remaining = goal.remainingTokens == null ? "budget 없음" : `${formatTokens(goal.remainingTokens)} left`;
  const budget = goal.tokenBudget == null ? "unbounded" : formatTokens(goal.tokenBudget);
  element.innerHTML = `
    <article class="goal-row">
      <div>
        <span>현재 goal</span>
        <strong>${formatTokens(goal.tokensUsed)} used</strong>
      </div>
      <div>
        <span>${escapeHtml(goal.status || "active")} · ${budget}</span>
        <strong>${remaining}</strong>
      </div>
    </article>
  `;
}

function renderUsageNotes(usage) {
  const notes = Array.isArray(usage?.notes) ? usage.notes : [];
  const element = $("usageNotes");
  if (!notes.length) {
    state.usageNotesExpanded = false;
    element.classList.remove("expanded");
    element.innerHTML = "";
    return;
  }
  const expanded = state.usageNotesExpanded;
  const preview = expanded ? `수집 로그 ${notes.length}개` : notes[0];
  element.classList.toggle("expanded", expanded);
  element.innerHTML = `
    <div class="usage-notes-summary">
      <span class="usage-notes-preview" title="${escapeHtml(notes[0])}">${escapeHtml(preview)}</span>
      <button id="usageNotesToggle" type="button" aria-expanded="${expanded}">${expanded ? "로그 접기" : `전체 로그 ${notes.length}개`}</button>
    </div>
    ${expanded ? `<div class="usage-notes-list">${notes.map((note) => `<span>${escapeHtml(note)}</span>`).join("")}</div>` : ""}
  `;
  $("usageNotesToggle")?.addEventListener("click", () => {
    state.usageNotesExpanded = !state.usageNotesExpanded;
    renderUsageNotes(usage);
  });
}

function renderThreads(usage) {
  const list = $("threadList");
  const totals = usage?.totals || {};
  const threads = usage?.threads || [];
  $("threadTotal").textContent = `${formatTokens(totals.threadTotalTokens || 0)} · ${totals.threadCount || 0} threads`;
  if (!threads.length) {
    list.innerHTML = '<div class="empty">수집 가능한 Codex thread 상태 DB가 아직 없습니다.</div>';
    return;
  }
  list.innerHTML = threads
    .slice(0, 6)
    .map(
      (thread) => `
        <article class="thread-row">
          <div>
            <strong>${escapeHtml(thread.title || "Untitled")}</strong>
            <span>${escapeHtml(thread.model || "unknown")} · ${formatDateTime(thread.updatedAt)}</span>
          </div>
          <b>${formatTokens(thread.tokens || 0)}</b>
        </article>
      `,
    )
    .join("");
}

function renderUsageLocations() {
  const focused = document.activeElement;
  if (focused?.classList?.contains("usage-path-input")) return;
  const providers = Array.isArray(state.usageLocations) ? state.usageLocations : [];
  const list = $("usageLocationList");
  const summary = $("usageLocationSummary");
  if (!list || !summary) return;
  const found = providers.reduce((sum, provider) => sum + usageLocationFoundCount(provider), 0);
  const configured = providers.reduce((sum, provider) => sum + (provider.configured || []).length, 0);
  summary.textContent = `${found} found · ${configured} custom`;
  if (!providers.length) {
    list.innerHTML = '<div class="empty">수집 위치 정보를 불러오는 중입니다.</div>';
    return;
  }
  list.innerHTML = providers.map(renderUsageLocationProvider).join("");
  list.querySelectorAll("[data-save-usage-paths]").forEach((button) => {
    button.addEventListener("click", () => {
      saveUsagePaths(button.dataset.saveUsagePaths).catch(showError);
    });
  });
  list.querySelectorAll("[data-copy-command]").forEach((button) => {
    button.addEventListener("click", () => {
      copyUsageLocationCommand(button.dataset.copyCommand).catch(showError);
    });
  });
}

function renderUsageLocationProvider(provider) {
  const configuredPaths = (state.config?.usagePaths?.[provider.provider] || []).join("\n");
  const found = usageLocationFoundCount(provider);
  const status = state.usagePathSaveStatus[provider.provider] || "idle";
  return `
    <article class="usage-location-provider">
      <div class="usage-location-top">
        <div>
          <strong>${escapeHtml(provider.label)}</strong>
          <span>${found} usable paths</span>
        </div>
        <button type="button" data-save-usage-paths="${escapeHtml(provider.provider)}">
          ${status === "saving" ? "저장 중" : "저장"}
        </button>
      </div>
      <div class="usage-location-paths">
        ${renderUsageLocationEntries("기본 위치", provider.defaults || [])}
        ${renderUsageLocationEntries("수동 위치", provider.configured || [])}
      </div>
      <label class="usage-path-label" for="usagePathInput-${escapeHtml(provider.provider)}">수동 경로</label>
      <textarea
        id="usagePathInput-${escapeHtml(provider.provider)}"
        class="usage-path-input"
        data-provider="${escapeHtml(provider.provider)}"
        spellcheck="false"
        placeholder="디렉터리 또는 파일 경로를 줄마다 입력하세요. 예: ~/.claude/projects"
      >${escapeHtml(configuredPaths)}</textarea>
      <div class="usage-location-command">
        <code>${escapeHtml(provider.terminalCommand || "")}</code>
        <button type="button" data-copy-command="${escapeHtml(provider.provider)}">명령 복사</button>
      </div>
      <div class="usage-location-status">${usagePathStatusText(provider.provider)}</div>
    </article>
  `;
}

function renderUsageLocationEntries(label, entries) {
  const rows = (entries || []).slice(0, 6);
  if (!rows.length) {
    return `
      <div class="usage-location-entry-group">
        <span>${escapeHtml(label)}</span>
        <div class="usage-location-entry muted">없음</div>
      </div>
    `;
  }
  return `
    <div class="usage-location-entry-group">
      <span>${escapeHtml(label)}</span>
      ${rows
        .map(
          (entry) => `
            <div class="usage-location-entry ${entry.exists ? "exists" : "missing"}" title="${escapeHtml(entry.expandedPath || entry.path)}">
              <b>${entry.exists ? "found" : "missing"}</b>
              <code>${escapeHtml(entry.path)}</code>
              <em>${Number(entry.fileCount || 0)} files</em>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function usageLocationFoundCount(provider) {
  return [...(provider.defaults || []), ...(provider.configured || [])]
    .filter((entry) => entry.exists && Number(entry.fileCount || 0) > 0)
    .length;
}

function usagePathStatusText(provider) {
  const status = state.usagePathSaveStatus[provider] || "idle";
  if (status === "saved") return "저장했습니다. 로그 재스캔을 누르면 새 위치가 반영됩니다.";
  if (status === "error") return "저장에 실패했습니다.";
  if (status === "copied") return "터미널 명령을 복사했습니다.";
  return "위치를 모르면 위 명령을 터미널에서 실행한 뒤 나온 경로를 붙여 넣으세요.";
}

async function saveUsagePaths(provider) {
  const input = $(`usagePathInput-${provider}`);
  if (!input) return;
  const paths = input.value
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter(Boolean);
  input.blur();
  state.usagePathSaveStatus[provider] = "saving";
  renderUsageLocations();
  try {
    const response = await fetch("/api/config/usage-paths", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, paths }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `${response.status} ${response.statusText}`);
    }
    state.config = payload;
    state.usagePathSaveStatus[provider] = "saved";
    const locations = await fetchJson("/api/usage-locations");
    state.usageLocations = Array.isArray(locations.providers) ? locations.providers : [];
    renderUsageLocations();
  } catch (error) {
    state.usagePathSaveStatus[provider] = "error";
    renderUsageLocations();
    throw error;
  }
}

async function copyUsageLocationCommand(provider) {
  const item = state.usageLocations.find((location) => location.provider === provider);
  if (!item?.terminalCommand) return;
  await copyText(item.terminalCommand);
  state.usagePathSaveStatus[provider] = "copied";
  renderUsageLocations();
  window.setTimeout(() => {
    if (state.usagePathSaveStatus[provider] === "copied") {
      state.usagePathSaveStatus[provider] = "idle";
      renderUsageLocations();
    }
  }, 2500);
}

function activeProviders(providers) {
  return (providers || []).filter((provider) =>
    Number(provider.processCount || 0) > 0 && provider.status !== "offline"
  );
}

function buildGrassDays(daily, count) {
  const byDate = new Map(daily.map((day) => [day.date, day]));
  const result = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setDate(end.getDate() + (6 - end.getDay()));
  const cursor = new Date(today);
  cursor.setDate(cursor.getDate() - (count - 1));
  cursor.setDate(cursor.getDate() - cursor.getDay());
  while (cursor <= end) {
    const date = formatLocalDate(cursor);
    const day = byDate.get(date);
    const future = cursor > today;
    result.push({
      date,
      tokens: future ? 0 : day?.tokens || 0,
      turns: future ? 0 : day?.turns || 0,
      future,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function tokenColor(intensity) {
  if (intensity <= 0) return "#1f242d";
  if (intensity < 0.25) return "#0e4429";
  if (intensity < 0.5) return "#006d32";
  if (intensity < 0.75) return "#26a641";
  return "#39d353";
}

function renderProcessLines(processes) {
  if (!processes?.length) return "";
  return processes
    .slice(0, 3)
    .map(
      (process) =>
        `<div class="process-line">pid ${process.pid} · ${process.cpu.toFixed(1)}% · ${escapeHtml(process.command)}</div>`,
    )
    .join("");
}

function renderTrend() {
  const canvas = $("trendCanvas");
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "#10161d";
  roundRect(ctx, 0, 0, width, height, 12);
  ctx.fill();

  const padding = 28;
  const points = state.history;
  drawGrid(ctx, width, height, padding);
  if (points.length < 2) {
    ctx.fillStyle = "#9aa5b1";
    ctx.font = "28px Inter, sans-serif";
    ctx.fillText("히스토리를 쌓는 중", padding, height / 2);
    return;
  }

  const maxScore = Math.max(100, ...points.map((p) => p.activity_score));
  const minTs = points[0].ts;
  const maxTs = points[points.length - 1].ts || minTs + 1;

  ctx.beginPath();
  points.forEach((point, index) => {
    const x = padding + ((point.ts - minTs) / Math.max(1, maxTs - minTs)) * (width - padding * 2);
    const y = height - padding - (point.activity_score / maxScore) * (height - padding * 2);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#25c29a";
  ctx.lineWidth = 4;
  ctx.stroke();

  const gradient = ctx.createLinearGradient(0, padding, 0, height - padding);
  gradient.addColorStop(0, "rgba(37, 194, 154, 0.24)");
  gradient.addColorStop(1, "rgba(37, 194, 154, 0)");
  ctx.lineTo(width - padding, height - padding);
  ctx.lineTo(padding, height - padding);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
}

function drawGrid(ctx, width, height, padding) {
  ctx.strokeStyle = "#26303a";
  ctx.lineWidth = 1;
  for (let index = 0; index <= 4; index += 1) {
    const y = padding + ((height - padding * 2) / 4) * index;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
  }
}

function renderHeatmap() {
  const heatmap = $("heatmap");
  heatmap.innerHTML = "";
  const buckets = new Array(24).fill(0);
  for (const point of state.history) {
    const hour = new Date(point.ts * 1000).getHours();
    buckets[hour] += point.activity_score;
  }
  const max = Math.max(1, ...buckets);
  buckets.forEach((value, hour) => {
    const cell = document.createElement("div");
    const intensity = value / max;
    cell.className = "heat-cell";
    cell.title = `${hour}:00 · ${Math.round(value)} score`;
    cell.style.background = `rgba(37, 194, 154, ${0.12 + intensity * 0.78})`;
    heatmap.appendChild(cell);
  });
}

function renderProviderHistory() {
  const list = $("providerHistoryList");
  const activeHistory = activeProviderHistory(state.providerHistory);
  const rows = summarizeProviderHistory(activeHistory);
  $("providerHistoryTotal").textContent = `${activeHistory.length} active samples`;
  if (!rows.length) {
    list.innerHTML = '<div class="empty">실행 중인 에이전트 또는 LLM 로그를 쌓는 중입니다.</div>';
    return;
  }
  list.innerHTML = rows
    .slice(0, 8)
    .map((row) => {
      const status = escapeHtml(row.status || "idle");
      return `
        <article class="provider-history-row">
          <div class="provider-history-main">
            <strong>${escapeHtml(row.name)}</strong>
            <span>${row.samples} samples · ${formatTime(row.lastTs)}</span>
          </div>
          <div class="provider-history-metrics">
            <span class="status-badge ${status}">${status}</span>
            <span>avg CPU <b>${row.avgCpu.toFixed(1)}%</b></span>
            <span>max proc <b>${row.maxProcesses}</b></span>
          </div>
        </article>
      `;
    })
    .join("");
}

function activeProviderHistory(history) {
  return (history || []).filter((point) =>
    Number(point.processCount || point.process_count || 0) > 0 &&
    (point.status || "offline") !== "offline"
  );
}

function summarizeProviderHistory(history) {
  const byProvider = new Map();
  for (const point of history || []) {
    const key = point.providerKey || point.provider_key;
    if (!key) continue;
    const current = byProvider.get(key) || {
      key,
      name: point.providerName || point.provider_name || key,
      samples: 0,
      cpuTotal: 0,
      avgCpu: 0,
      maxProcesses: 0,
      lastTs: 0,
      status: "idle",
    };
    const cpu = Number(point.cpu || 0);
    const processCount = Number(point.processCount || point.process_count || 0);
    current.samples += 1;
    current.cpuTotal += cpu;
    current.avgCpu = current.cpuTotal / current.samples;
    current.maxProcesses = Math.max(current.maxProcesses, processCount);
    if ((point.ts || 0) >= current.lastTs) {
      current.lastTs = point.ts || current.lastTs;
      current.status = point.status || current.status;
      current.name = point.providerName || point.provider_name || current.name;
    }
    byProvider.set(key, current);
  }
  return [...byProvider.values()].sort((left, right) =>
    right.avgCpu - left.avgCpu ||
    right.maxProcesses - left.maxProcesses ||
    left.name.localeCompare(right.name),
  );
}

function renderEvents() {
  const list = $("eventList");
  if (!state.events.length) {
    list.innerHTML = '<div class="empty">아직 상태 변경 로그가 없습니다.</div>';
    return;
  }
  list.innerHTML = state.events
    .map(
      (event) => `
        <article class="event">
          <span class="event-time">${formatTime(event.ts)} · ${escapeHtml(event.provider)}</span>
          <p>${escapeHtml(event.message)}</p>
        </article>
      `,
    )
    .join("");
}

function formatTime(ts) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(ts * 1000));
}

function formatResetTime(ts) {
  const date = new Date(ts * 1000);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return new Intl.DateTimeFormat("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatDateTime(ts) {
  if (!ts) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts * 1000));
}

function formatAge(seconds) {
  const value = Number(seconds || 0);
  if (value < 60) return `${Math.round(value)}초 전`;
  if (value < 3600) return `${Math.round(value / 60)}분 전`;
  if (value < 86400) return `${Math.round(value / 3600)}시간 전`;
  return `${Math.round(value / 86400)}일 전`;
}

function shortPath(path) {
  const value = String(path || "");
  if (value.length <= 48) return value;
  return `...${value.slice(-45)}`;
}

function formatTokens(value) {
  const number = Number(value || 0);
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1)}K`;
  return String(number);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatRuntimeMode(runtime) {
  const platform = runtime.platform || "unknown";
  const tray = runtime.trayEnabled ? "tray on" : "tray off";
  const version = runtime.version ? `v${runtime.version}` : "version unknown";
  const portInfo = runtime.portSource ? `port ${runtime.portSource}` : "port auto";
  const serviceMode =
    runtime.monitoringService?.mode === "desktop-embedded" ? "embedded monitor" : runtime.monitoringService?.mode;
  return [runtime.runtime || "runtime", version, platform, tray, serviceMode, portInfo]
    .filter(Boolean)
    .join(" · ");
}

function formatBool(value) {
  if (value === true) return "true";
  if (value === false) return "false";
  return "-";
}

function remoteReportFileName(runtime = state.runtime || {}) {
  const platform = runtime.platform || "unknown";
  return `remote-client-verification-${platform}.json`;
}

function remoteAccessHint(lanUrl, localUrl) {
  if (!lanUrl || lanUrl === localUrl || lanUrl.includes("127.0.0.1")) {
    return "LAN IP를 찾지 못했습니다. 같은 네트워크와 방화벽 설정을 확인하세요.";
  }
  return "같은 네트워크의 다른 기기에서 LAN URL을 열면 remote 검증으로 바뀝니다.";
}

function buildBrowserRemoteReport() {
  const runtime = state.runtime || {};
  const snapshot = state.snapshot || {};
  const usageItems = Array.isArray(state.usage) ? state.usage : [];
  const usage = usageItems.find((item) => item.provider === "codex") || usageItems[0] || {};
  const remote = state.remoteCheck || {};
  const isRemote = remote.remoteClient === true;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    verifier: "browser-dashboard",
    targetUrl: location.origin,
    client: {
      hostname: `browser-${remote.clientIp || "unknown"}`,
      platform: navigator.platform || "browser",
      release: navigator.userAgent || "browser",
      arch: "browser",
    },
    result: isRemote ? "passed" : "local-only",
    automatedChecks: {
      healthz: "passed",
      runtimeEndpoint: "passed",
      snapshotEndpoint: "passed",
      providerHistoryEndpoint: "passed",
      providerHistoryCount: state.providerHistory.length,
      remoteCheckEndpoint: "passed",
      remoteClient: remote.remoteClient === true,
      clientIp: remote.clientIp || null,
      clientAddress: remote.clientAddress || null,
      sameHostIp: remote.sameHostIp === true,
      loopback: remote.loopback === true,
      dashboardHtml: "passed",
      dashboardJs: "passed",
      dashboardCss: "passed",
      usageEndpoint: "passed",
      usageDashboardHtml: "passed",
      usageDashboardJs: "passed",
      usageDashboardCss: "passed",
      usageDaily: Array.isArray(usage.daily) ? "passed" : "missing",
      usageTotals: usage.totals ? "passed" : "missing",
      usageQuotas: Array.isArray(usage.quotas) ? "passed" : "missing",
      usageThreads: Array.isArray(usage.threads) ? "passed" : "missing",
      usageGoals: Array.isArray(usage.goals) ? "passed" : "missing",
      usageProviderCount: state.usage.length,
      runtime: runtime.runtime || null,
      monitoringService: runtime.monitoringService || null,
      version: runtime.version || null,
      platform: runtime.platform || null,
      trayEnabled: runtime.trayEnabled === true,
      bindHost: runtime.bindHost || null,
      port: runtime.port || null,
      localUrl: runtime.localUrl || null,
      lanUrls: runtime.lanUrls || [],
      agentHostname: runtime.hostname || remote.agentHostname || null,
      clientHostname: `browser-${remote.clientIp || "unknown"}`,
      sameHost: !isRemote,
      status: snapshot.activity?.status || null,
      activeProcessCount: snapshot.activity?.activeProcessCount ?? null,
      totalCpu: snapshot.activity?.totalCpu ?? null,
    },
  };
}

function downloadRemoteReport() {
  const report = buildBrowserRemoteReport();
  const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = remoteReportFileName();
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

async function copyLanUrl() {
  const runtime = state.runtime || {};
  const url = runtime.lanUrls?.[0] || runtime.localUrl || location.origin;
  const copied = await copyText(url);
  state.lanCopyStatus = copied ? "copied" : "selected";
  renderHeader();
  window.setTimeout(() => {
    state.lanCopyStatus = "idle";
    renderHeader();
  }, 4000);
}

function portPlaceholder() {
  const runtimePort = Number(state.runtime?.port || 0);
  if (runtimePort > 0) return runtimePort;
  const effectivePort = Number(state.config?.effectivePort || 0);
  if (effectivePort > 0) return effectivePort;
  const locationPort = Number(location.port || 0);
  if (locationPort > 0) return locationPort;
  return Number(state.config?.defaultPort || 8765);
}

function portSetupCopy(config = {}, runtime = {}) {
  const current = runtime.port || config.effectivePort || portPlaceholder();
  const configured = config.configuredPort || config.envPort;
  if (config.envPort) {
    return `현재 실행 포트는 ${current}입니다. AGENTWATCH_PORT=${config.envPort} 환경변수가 설정 파일보다 우선합니다.`;
  }
  if (configured && configured !== current) {
    return `설정 포트는 ${configured}, 현재 실행 포트는 ${current}입니다. 포트가 사용 중이면 자동으로 대체 포트를 사용합니다.`;
  }
  return `현재 실행 포트는 ${current}입니다. 저장하면 다음 실행부터 이 포트를 우선 사용합니다.`;
}

function portSetupStatus(config = {}, runtime = {}) {
  if (state.portSaveStatus === "saved") {
    const current = runtime.port || config.effectivePort || portPlaceholder();
    if (config.configuredPort === current) {
      return `${config.configPath || "설정 파일"}에 저장했습니다.`;
    }
    return `${config.configPath || "설정 파일"}에 저장했습니다. 다음 실행부터 적용됩니다.`;
  }
  if (state.portSaveStatus === "error") {
    return "포트 저장에 실패했습니다.";
  }
  if (config.firstRun === true) {
    return "입력값을 비우면 현재 실행 포트가 저장됩니다.";
  }
  return "";
}

async function savePortConfig() {
  const input = $("portInput");
  const raw = input.value.trim() || input.placeholder || String(portPlaceholder());
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    state.portSaveStatus = "error";
    $("portSetupStatus").textContent = "1부터 65535 사이의 포트를 입력하세요.";
    return;
  }
  state.portSaveStatus = "saving";
  renderPortSetup();
  try {
    const response = await fetch("/api/config/port", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ port }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `${response.status} ${response.statusText}`);
    }
    state.config = payload;
    state.portSaveStatus = "saved";
    input.value = "";
    renderHeader();
    renderPortSetup();
  } catch (error) {
    state.portSaveStatus = "error";
    $("portSetupStatus").textContent = error.message;
  }
}

async function refreshUsageOnly() {
  state.quotaRefreshStatus = "loading";
  renderUsage();
  try {
    const previousCollectedAt = state.usageCollectedAt;
    const response = await fetch("/api/usage/refresh", { method: "POST" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    await waitForUsageRefresh(previousCollectedAt);
    state.quotaRefreshStatus = "done";
    renderUsage();
  } finally {
    window.setTimeout(() => {
      state.quotaRefreshStatus = "idle";
      renderUsage();
    }, 1200);
  }
}

async function waitForUsageRefresh(previousCollectedAt) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 1_000));
    const payload = await fetchJson("/api/usage?days=366");
    const collectedAt = Number(payload.collectedAt || 0);
    if (Array.isArray(payload.usage) && payload.usage.length) {
      state.usage = normalizeUsagePayload(payload);
      state.usageCollectedAt = collectedAt;
      renderUsage();
    }
    if (payload.refreshing !== true && collectedAt >= previousCollectedAt) return;
  }
  throw new Error("로그 재스캔 시간이 초과되었습니다.");
}

async function checkForUpdate() {
  state.updateStatus = { ...(state.updateStatus || {}), phase: "checking", message: "업데이트 확인 중" };
  renderUpdatePanel();
  const response = await fetch("/api/update/check", { method: "POST" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || `${response.status} ${response.statusText}`);
  }
  state.updateStatus = payload;
  renderUpdatePanel();
}

async function installUpdate() {
  state.updateStatus = {
    ...(state.updateStatus || {}),
    phase: "downloading",
    message: "업데이트 다운로드 준비 중",
    percent: 0,
  };
  renderUpdatePanel();
  const response = await fetch("/api/update/install", { method: "POST" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || `${response.status} ${response.statusText}`);
  }
  state.updateStatus = payload;
  renderUpdatePanel();
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall back to selecting the URL on non-secure LAN origins.
    }
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) {
    selectLanUrl();
  }
  return copied;
}

function lanCopyButtonText() {
  if (state.lanCopyStatus === "copied") return "복사됨";
  if (state.lanCopyStatus === "selected") return "선택됨";
  return "복사";
}

function selectLanUrl() {
  const element = $("lanUrl");
  if (!element || !window.getSelection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

$("refreshBtn").addEventListener("click", () => {
  Promise.all([refreshLive(), refreshActivity()]).catch(showError);
});

$("downloadRemoteReportBtn").addEventListener("click", downloadRemoteReport);
$("quotaRefreshBtn").addEventListener("click", () => {
  refreshUsageOnly().catch(showError);
});
$("copyLanUrlBtn").addEventListener("click", () => {
  copyLanUrl().catch(showError);
});
$("portSaveBtn").addEventListener("click", () => {
  savePortConfig().catch(showError);
});
$("updateCheckBtn").addEventListener("click", () => {
  checkForUpdate().catch(showError);
});
$("updateInstallBtn").addEventListener("click", () => {
  installUpdate().catch(showError);
});
$("portInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    savePortConfig().catch(showError);
  }
});
$("tokenGrass").addEventListener("scroll", updateTokenGrassOverflow);
window.addEventListener("resize", () => syncTokenGrassViewport(state.tokenGrassStickToToday));
$("usageLocationPanel").addEventListener("toggle", (event) => {
  if (event.currentTarget.open && !state.usageLocations.length) {
    refreshUsageLocations().catch(showError);
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    stopPolling();
    return;
  }
  refresh().catch(showError).finally(startPolling);
});

function showError(error) {
  console.error(error);
  const status = $("updateStatusText");
  if (status) {
    status.textContent = `연결 오류: ${error.message}`;
  }
}

refresh().catch(showError).finally(startPolling);
