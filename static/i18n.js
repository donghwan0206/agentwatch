(function exposeAgentWatchI18n(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.AgentWatchI18n = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createAgentWatchI18n() {
  const STORAGE_KEY = "agentwatch.locale";
  const DEFAULT_LOCALE = "en";
  const locales = [
    { code: "en", label: "EN", name: "English", intl: "en-US" },
    { code: "ko", label: "한국어", name: "한국어", intl: "ko-KR" },
    { code: "ja", label: "日本語", name: "日本語", intl: "ja-JP" },
    { code: "zh", label: "中文", name: "简体中文", intl: "zh-CN" },
  ];

  const messages = {
    "language.selector": {
      en: "Dashboard language",
      ko: "대시보드 언어",
      ja: "ダッシュボードの言語",
      zh: "仪表板语言",
    },
    "github.open": {
      en: "Open AgentWatch on GitHub",
      ko: "AgentWatch GitHub 저장소 열기",
      ja: "AgentWatch の GitHub リポジトリを開く",
      zh: "打开 AgentWatch GitHub 仓库",
    },
    "host.waiting": {
      en: "Waiting for the agent machine",
      ko: "에이전트 머신 연결 대기 중",
      ja: "エージェントマシンを待機中",
      zh: "正在等待智能体主机",
    },
    "action.copy": { en: "Copy", ko: "복사", ja: "コピー", zh: "复制" },
    "action.save": { en: "Save", ko: "저장", ja: "保存", zh: "保存" },
    "action.refresh": { en: "Refresh", ko: "새로고침", ja: "更新", zh: "刷新" },
    "action.checkUpdate": {
      en: "Check for updates",
      ko: "업데이트 확인",
      ja: "更新を確認",
      zh: "检查更新",
    },
    "action.installRestart": {
      en: "Install and restart",
      ko: "설치 및 재시작",
      ja: "インストールして再起動",
      zh: "安装并重启",
    },
    "action.verificationJson": {
      en: "Verification JSON",
      ko: "검증 JSON",
      ja: "検証 JSON",
      zh: "验证 JSON",
    },
    "action.refreshQuota": {
      en: "Refresh usage",
      ko: "사용량 새로고침",
      ja: "使用量を更新",
      zh: "刷新用量",
    },
    "action.copyCommand": {
      en: "Copy command",
      ko: "명령 복사",
      ja: "コマンドをコピー",
      zh: "复制命令",
    },
    "lan.defaultHint": {
      en: "Open the LAN URL from another device on the same network.",
      ko: "같은 네트워크의 다른 기기에서 LAN URL을 여세요.",
      ja: "同じネットワーク上の別の端末で LAN URL を開いてください。",
      zh: "请在同一网络中的其他设备上打开 LAN URL。",
    },
    "menu.port": { en: "Port", ko: "포트", ja: "ポート", zh: "端口" },
    "menu.update": { en: "Update", ko: "업데이트", ja: "更新", zh: "更新" },
    "menu.remote": { en: "Remote", ko: "원격", ja: "リモート", zh: "远程" },
    "port.title": {
      en: "Dashboard port",
      ko: "대시보드 포트 설정",
      ja: "ダッシュボードのポート設定",
      zh: "仪表板端口设置",
    },
    "port.intro": {
      en: "Save the current port to prefer it the next time AgentWatch starts.",
      ko: "처음 실행한 포트를 저장하면 다음 실행부터 같은 포트를 우선 사용합니다.",
      ja: "現在のポートを保存すると、次回起動時から優先して使用します。",
      zh: "保存当前端口后，下次启动时将优先使用该端口。",
    },
    "port.label": { en: "Port", ko: "포트", ja: "ポート", zh: "端口" },
    "update.title": {
      en: "Over-the-air update",
      ko: "온에어 업데이트",
      ja: "オンライン更新",
      zh: "在线更新",
    },
    "update.checkingStatus": {
      en: "Checking update status",
      ko: "업데이트 상태 확인 중",
      ja: "更新状態を確認中",
      zh: "正在检查更新状态",
    },
    "remote.title": {
      en: "Remote browser verification",
      ko: "브라우저 원격 검증",
      ja: "ブラウザのリモート検証",
      zh: "浏览器远程验证",
    },
    "remote.checkingTitle": {
      en: "Checking remote access",
      ko: "원격 접속 확인 중",
      ja: "リモート接続を確認中",
      zh: "正在检查远程访问",
    },
    "remote.checkingCopy": {
      en: "Checking whether this browser is on a different LAN device from the agent machine.",
      ko: "이 브라우저가 에이전트 머신과 다른 LAN 기기인지 확인하고 있습니다.",
      ja: "このブラウザがエージェントマシンとは別の LAN 端末か確認しています。",
      zh: "正在确认此浏览器是否位于不同于智能体主机的 LAN 设备上。",
    },
    "quota.title": { en: "Remaining usage", ko: "남은 사용량", ja: "残りの使用量", zh: "剩余用量" },
    "tokens.title": {
      en: "Daily token history",
      ko: "일별 토큰 잔디",
      ja: "日別トークン履歴",
      zh: "每日令牌记录",
    },
    "tokens.filterAria": {
      en: "Token provider filter",
      ko: "토큰 제공자 필터",
      ja: "トークンプロバイダーフィルター",
      zh: "令牌提供商筛选器",
    },
    "tokens.grassAria": {
      en: "Daily token usage",
      ko: "일별 토큰 사용량",
      ja: "日別トークン使用量",
      zh: "每日令牌用量",
    },
    "tokens.last7Initial": { en: "Last 7 days 0", ko: "최근 7일 0", ja: "直近7日 0", zh: "最近7天 0" },
    "tokens.last30Initial": { en: "Last 30 days 0", ko: "최근 30일 0", ja: "直近30日 0", zh: "最近30天 0" },
    "tokens.observedInitial": { en: "Observed total 0", ko: "관측 총량 0", ja: "観測合計 0", zh: "观测总量 0" },
    "tokens.maxDayInitial": { en: "Peak day -", ko: "최대 사용일 -", ja: "最大使用日 -", zh: "最高使用日 -" },
    "sources.title": {
      en: "Token log locations",
      ko: "토큰 로그 위치",
      ja: "トークンログの場所",
      zh: "令牌日志位置",
    },
    "sources.checking": {
      en: "Checking default locations",
      ko: "기본 위치 확인 중",
      ja: "既定の場所を確認中",
      zh: "正在检查默认位置",
    },
    "providers.title": {
      en: "Running agents",
      ko: "실행 중인 에이전트",
      ja: "実行中のエージェント",
      zh: "运行中的智能体",
    },
    "activity.title": { en: "Last 3 hours", ko: "최근 3시간", ja: "直近3時間", zh: "最近3小时" },
    "activity.trendAria": {
      en: "Activity trend",
      ko: "활동 추이",
      ja: "アクティビティ推移",
      zh: "活动趋势",
    },
    "threads.title": {
      en: "Recent Codex thread tokens",
      ko: "최근 Codex 스레드 토큰",
      ja: "最近の Codex スレッドトークン",
      zh: "最近的 Codex 线程令牌",
    },
    "heatmap.title": { en: "Snapshot density", ko: "스냅샷 밀도", ja: "スナップショット密度", zh: "快照密度" },
    "heatmap.aria": { en: "Snapshot heatmap", ko: "스냅샷 히트맵", ja: "スナップショットヒートマップ", zh: "快照热图" },
    "providerLogs.title": {
      en: "Recent logs by provider",
      ko: "Provider별 최근 로그",
      ja: "プロバイダー別の最新ログ",
      zh: "按提供商查看最近日志",
    },
    "events.title": { en: "Status change log", ko: "상태 변경 로그", ja: "状態変更ログ", zh: "状态变更日志" },
    "update.actionChecking": { en: "Checking", ko: "확인 중", ja: "確認中", zh: "检查中" },
    "update.actionInstalling": { en: "Installing", ko: "설치 중", ja: "インストール中", zh: "安装中" },
    "update.idle": { en: "Ready to check for updates", ko: "업데이트 확인 대기", ja: "更新確認待ち", zh: "等待检查更新" },
    "update.checking": { en: "Checking for updates", ko: "업데이트 확인 중", ja: "更新を確認中", zh: "正在检查更新" },
    "update.latest": { en: "You are up to date", ko: "최신 버전입니다", ja: "最新バージョンです", zh: "当前已是最新版本" },
    "update.available": { en: "v{version} is available", ko: "v{version} 업데이트 가능", ja: "v{version} を利用できます", zh: "v{version} 可用" },
    "update.downloading": { en: "Downloading update", ko: "업데이트 다운로드 중", ja: "更新をダウンロード中", zh: "正在下载更新" },
    "update.downloadingProgress": { en: "Downloading update {percent}%", ko: "업데이트 다운로드 중 {percent}%", ja: "更新をダウンロード中 {percent}%", zh: "正在下载更新 {percent}%" },
    "update.installing": { en: "Installing update", ko: "업데이트 설치 중", ja: "更新をインストール中", zh: "正在安装更新" },
    "update.restarting": { en: "Restarting after update", ko: "업데이트 후 재시작 중", ja: "更新後に再起動中", zh: "更新后正在重启" },
    "update.failed": { en: "Update failed", ko: "업데이트 실패", ja: "更新に失敗しました", zh: "更新失败" },
    "update.current": { en: "Current v{version}", ko: "현재 v{version}", ja: "現在 v{version}", zh: "当前 v{version}" },
    "update.currentUnknown": { en: "Checking current version", ko: "현재 버전 확인 중", ja: "現在のバージョンを確認中", zh: "正在检查当前版本" },
    "remote.connectedTitle": { en: "Connected from another LAN device", ko: "다른 LAN 기기에서 접속 중", ja: "別の LAN 端末から接続中", zh: "正从其他 LAN 设备连接" },
    "remote.localTitle": { en: "This browser is not final remote evidence", ko: "현재 브라우저는 최종 원격 증거가 아닙니다", ja: "このブラウザは最終的なリモート証跡ではありません", zh: "此浏览器不是最终远程证据" },
    "remote.connectedCopy": { en: "Download the verification JSON and place it in release-assets to use it as remote readiness evidence.", ko: "검증 JSON을 내려받아 release-assets 폴더에 넣으면 remote readiness 증거로 사용할 수 있습니다.", ja: "検証 JSON をダウンロードして release-assets に置くと、リモート準備状況の証跡として使用できます。", zh: "下载验证 JSON 并放入 release-assets 文件夹，可将其用作远程就绪证据。" },
    "remote.localCopy": { en: "This file is for local reference only. Open the dashboard from another LAN device to produce final verification JSON.", ko: "지금 파일은 local-only 참고용입니다. 다른 LAN 기기에서 열면 최종 검증 JSON으로 바뀝니다.", ja: "このファイルはローカル参照用です。別の LAN 端末で開くと最終検証 JSON になります。", zh: "当前文件仅供本地参考。从其他 LAN 设备打开后将生成最终验证 JSON。" },
    "remote.localJson": { en: "Local-only JSON", ko: "로컬 전용 JSON", ja: "ローカル専用 JSON", zh: "仅本地 JSON" },
    "header.updated": { en: "Updated {time}", ko: "업데이트 {time}", ja: "更新 {time}", zh: "更新于 {time}" },
    "port.saving": { en: "Saving", ko: "저장 중", ja: "保存中", zh: "保存中" },
    "providers.empty": { en: "No agent or LLM processes are currently running.", ko: "현재 실행 중인 에이전트 또는 LLM 프로세스가 없습니다.", ja: "現在実行中のエージェントまたは LLM プロセスはありません。", zh: "当前没有运行中的智能体或 LLM 进程。" },
    "providers.processes": { en: "Processes", ko: "프로세스", ja: "プロセス", zh: "进程" },
    "status.active": { en: "active", ko: "활성", ja: "稼働中", zh: "活跃" },
    "status.idle": { en: "idle", ko: "대기", ja: "待機", zh: "空闲" },
    "status.busy": { en: "busy", ko: "바쁨", ja: "高負荷", zh: "繁忙" },
    "status.offline": { en: "offline", ko: "오프라인", ja: "オフライン", zh: "离线" },
    "quota.sourceCount": { en: "{count}/3 sources", ko: "{count}/3 소스", ja: "{count}/3 ソース", zh: "{count}/3 个来源" },
    "quota.sourceWaiting": { en: "Waiting for data", ko: "수집 대기", ja: "データ待ち", zh: "等待数据" },
    "quota.empty": { en: "No usage data found. Check the Codex CLI sign-in and local log locations.", ko: "사용량 정보를 찾지 못했습니다. Codex CLI 로그인 상태와 로컬 로그 위치를 확인해 주세요.", ja: "使用量データが見つかりません。Codex CLI のログイン状態とローカルログの場所を確認してください。", zh: "未找到用量数据。请检查 Codex CLI 登录状态和本地日志位置。" },
    "quota.collecting": { en: "Collecting", ko: "수집 중", ja: "収集中", zh: "采集中" },
    "quota.waiting": { en: "Waiting for usage data", ko: "사용량 수집 대기", ja: "使用量データ待ち", zh: "等待用量数据" },
    "quota.collected": { en: "Collected {time}", ko: "수집 {time}", ja: "収集 {time}", zh: "采集于 {time}" },
    "quota.fiveHour": { en: "5 hours", ko: "5시간", ja: "5時間", zh: "5小时" },
    "quota.week": { en: "1 week", ko: "1주", ja: "1週間", zh: "1周" },
    "quota.unlimited": { en: "No limit", ko: "제한 없음", ja: "上限なし", zh: "无限制" },
    "quota.notApplied": { en: "Not currently applied", ko: "현재 미적용", ja: "現在は未適用", zh: "当前未启用" },
    "quota.notCollected": { en: "Not collected", ko: "수집 전", ja: "未収集", zh: "未采集" },
    "quota.resetUnknown": { en: "Reset unknown", ko: "초기화 시각 미확인", ja: "リセット時刻不明", zh: "重置时间未知" },
    "quota.remainingTitle": { en: "{label} remaining {value}", ko: "{label} 잔여 {value}", ja: "{label} 残り {value}", zh: "{label} 剩余 {value}" },
    "tokens.all": { en: "All", ko: "전체", ja: "すべて", zh: "全部" },
    "tokens.today": { en: "{value} today", ko: "오늘 {value}", ja: "今日 {value}", zh: "今日 {value}" },
    "tokens.last7": { en: "Last 7 days {value}", ko: "최근 7일 {value}", ja: "直近7日 {value}", zh: "最近7天 {value}" },
    "tokens.last30": { en: "Last 30 days {value}", ko: "최근 30일 {value}", ja: "直近30日 {value}", zh: "最近30天 {value}" },
    "tokens.observed": { en: "Observed total {value}", ko: "관측 총량 {value}", ja: "観測合計 {value}", zh: "观测总量 {value}" },
    "tokens.maxDay": { en: "Peak day {date} · {value}", ko: "최대 사용일 {date} · {value}", ja: "最大使用日 {date} · {value}", zh: "最高使用日 {date} · {value}" },
    "tokens.maxDayNone": { en: "Peak day -", ko: "최대 사용일 -", ja: "最大使用日 -", zh: "最高使用日 -" },
    "tokens.future": { en: "future", ko: "미래", ja: "未来", zh: "未来" },
    "tokens.turns": { en: "{count} turns", ko: "{count}턴", ja: "{count} ターン", zh: "{count} 轮" },
    "goal.noBudget": { en: "No budget", ko: "budget 없음", ja: "予算なし", zh: "无预算" },
    "goal.left": { en: "{value} left", ko: "{value} 남음", ja: "残り {value}", zh: "剩余 {value}" },
    "goal.current": { en: "Current goal", ko: "현재 goal", ja: "現在のゴール", zh: "当前目标" },
    "goal.used": { en: "{value} used", ko: "{value} 사용", ja: "{value} 使用", zh: "已使用 {value}" },
    "goal.unbounded": { en: "unbounded", ko: "무제한", ja: "無制限", zh: "无限" },
    "notes.collected": { en: "{count} collection logs", ko: "수집 로그 {count}개", ja: "収集ログ {count}件", zh: "{count} 条采集日志" },
    "notes.collapse": { en: "Collapse logs", ko: "로그 접기", ja: "ログを閉じる", zh: "收起日志" },
    "notes.all": { en: "All {count} logs", ko: "전체 로그 {count}개", ja: "全 {count} 件のログ", zh: "全部 {count} 条日志" },
    "threads.summary": { en: "{tokens} · {count} threads", ko: "{tokens} · 스레드 {count}개", ja: "{tokens} · {count} スレッド", zh: "{tokens} · {count} 个线程" },
    "threads.empty": { en: "No collectible Codex thread database is available yet.", ko: "수집 가능한 Codex thread 상태 DB가 아직 없습니다.", ja: "収集可能な Codex スレッドデータベースはまだありません。", zh: "尚无可采集的 Codex 线程数据库。" },
    "sources.summary": { en: "{found} found · {custom} custom", ko: "{found}개 발견 · {custom}개 수동", ja: "{found} 件検出 · {custom} 件手動", zh: "发现 {found} 个 · 手动 {custom} 个" },
    "sources.loading": { en: "Loading collection locations.", ko: "수집 위치 정보를 불러오는 중입니다.", ja: "収集場所を読み込んでいます。", zh: "正在加载采集位置。" },
    "sources.usablePaths": { en: "{count} usable paths", ko: "사용 가능 경로 {count}개", ja: "使用可能なパス {count} 件", zh: "{count} 个可用路径" },
    "sources.defaultPaths": { en: "Default locations", ko: "기본 위치", ja: "既定の場所", zh: "默认位置" },
    "sources.customPaths": { en: "Custom locations", ko: "수동 위치", ja: "手動の場所", zh: "手动位置" },
    "sources.manualPath": { en: "Custom paths", ko: "수동 경로", ja: "手動パス", zh: "手动路径" },
    "sources.pathPlaceholder": { en: "Enter one directory or file path per line. Example: ~/.claude/projects", ko: "디렉터리 또는 파일 경로를 줄마다 입력하세요. 예: ~/.claude/projects", ja: "ディレクトリまたはファイルパスを1行ずつ入力してください。例: ~/.claude/projects", zh: "每行输入一个目录或文件路径。例如：~/.claude/projects" },
    "sources.none": { en: "None", ko: "없음", ja: "なし", zh: "无" },
    "sources.found": { en: "found", ko: "발견", ja: "検出", zh: "已找到" },
    "sources.missing": { en: "missing", ko: "없음", ja: "未検出", zh: "缺失" },
    "sources.files": { en: "{count} files", ko: "파일 {count}개", ja: "{count} ファイル", zh: "{count} 个文件" },
    "sources.saved": { en: "Saved. Rescan usage to apply the new locations.", ko: "저장했습니다. 로그 재스캔을 누르면 새 위치가 반영됩니다.", ja: "保存しました。使用量を再スキャンすると新しい場所が反映されます。", zh: "已保存。重新扫描用量后将应用新位置。" },
    "sources.saveFailed": { en: "Could not save.", ko: "저장에 실패했습니다.", ja: "保存に失敗しました。", zh: "保存失败。" },
    "sources.copied": { en: "Terminal command copied.", ko: "터미널 명령을 복사했습니다.", ja: "ターミナルコマンドをコピーしました。", zh: "已复制终端命令。" },
    "sources.help": { en: "If you do not know the location, run the command above in a terminal and paste the returned paths.", ko: "위치를 모르면 위 명령을 터미널에서 실행한 뒤 나온 경로를 붙여 넣으세요.", ja: "場所が不明な場合は、上のコマンドをターミナルで実行し、表示されたパスを貼り付けてください。", zh: "如果不知道位置，请在终端运行上方命令并粘贴返回的路径。" },
    "trend.loading": { en: "Building history", ko: "히스토리를 쌓는 중", ja: "履歴を蓄積中", zh: "正在积累历史记录" },
    "history.activeSamples": { en: "{count} active samples", ko: "활성 샘플 {count}개", ja: "アクティブサンプル {count} 件", zh: "{count} 个活跃样本" },
    "history.empty": { en: "Collecting logs from running agents and LLMs.", ko: "실행 중인 에이전트 또는 LLM 로그를 쌓는 중입니다.", ja: "実行中のエージェントまたは LLM のログを収集中です。", zh: "正在采集运行中智能体或 LLM 的日志。" },
    "history.samples": { en: "{count} samples", ko: "샘플 {count}개", ja: "{count} サンプル", zh: "{count} 个样本" },
    "history.averageCpu": { en: "avg CPU", ko: "평균 CPU", ja: "平均 CPU", zh: "平均 CPU" },
    "history.maxProcesses": { en: "max proc", ko: "최대 프로세스", ja: "最大プロセス", zh: "最大进程数" },
    "events.empty": { en: "No status changes yet.", ko: "아직 상태 변경 로그가 없습니다.", ja: "状態変更ログはまだありません。", zh: "尚无状态变更日志。" },
    "lan.missing": { en: "No LAN IP found. Check the network and firewall settings.", ko: "LAN IP를 찾지 못했습니다. 같은 네트워크와 방화벽 설정을 확인하세요.", ja: "LAN IP が見つかりません。ネットワークとファイアウォールの設定を確認してください。", zh: "未找到 LAN IP。请检查网络和防火墙设置。" },
    "lan.remoteHint": { en: "Open the LAN URL from another device on the same network to switch to remote verification.", ko: "같은 네트워크의 다른 기기에서 LAN URL을 열면 remote 검증으로 바뀝니다.", ja: "同じネットワーク上の別の端末で LAN URL を開くと、リモート検証に切り替わります。", zh: "从同一网络中的其他设备打开 LAN URL 后，将切换为远程验证。" },
    "port.currentEnv": { en: "The current port is {current}. AGENTWATCH_PORT={env} overrides the saved configuration.", ko: "현재 실행 포트는 {current}입니다. AGENTWATCH_PORT={env} 환경변수가 설정 파일보다 우선합니다.", ja: "現在のポートは {current} です。AGENTWATCH_PORT={env} は保存済み設定より優先されます。", zh: "当前端口为 {current}。AGENTWATCH_PORT={env} 的优先级高于已保存配置。" },
    "port.currentMismatch": { en: "The saved port is {configured}, while the current port is {current}. If a port is busy, AgentWatch selects another one automatically.", ko: "설정 포트는 {configured}, 현재 실행 포트는 {current}입니다. 포트가 사용 중이면 자동으로 대체 포트를 사용합니다.", ja: "保存済みポートは {configured}、現在のポートは {current} です。使用中の場合は自動的に別のポートを使用します。", zh: "已保存端口为 {configured}，当前端口为 {current}。如果端口被占用，AgentWatch 会自动选择其他端口。" },
    "port.current": { en: "The current port is {current}. Save it to prefer this port on the next launch.", ko: "현재 실행 포트는 {current}입니다. 저장하면 다음 실행부터 이 포트를 우선 사용합니다.", ja: "現在のポートは {current} です。保存すると次回起動時から優先して使用します。", zh: "当前端口为 {current}。保存后下次启动将优先使用此端口。" },
    "port.saved": { en: "Saved to {path}.", ko: "{path}에 저장했습니다.", ja: "{path} に保存しました。", zh: "已保存至 {path}。" },
    "port.savedNext": { en: "Saved to {path}. It will apply on the next launch.", ko: "{path}에 저장했습니다. 다음 실행부터 적용됩니다.", ja: "{path} に保存しました。次回起動時から適用されます。", zh: "已保存至 {path}。将在下次启动时应用。" },
    "port.configFile": { en: "configuration file", ko: "설정 파일", ja: "設定ファイル", zh: "配置文件" },
    "port.error": { en: "Could not save the port.", ko: "포트 저장에 실패했습니다.", ja: "ポートを保存できませんでした。", zh: "无法保存端口。" },
    "port.firstRun": { en: "Leave the field blank to save the current port.", ko: "입력값을 비우면 현재 실행 포트가 저장됩니다.", ja: "空欄のままにすると現在のポートが保存されます。", zh: "留空即可保存当前端口。" },
    "port.invalid": { en: "Enter a port between 1 and 65535.", ko: "1부터 65535 사이의 포트를 입력하세요.", ja: "1 から 65535 のポートを入力してください。", zh: "请输入 1 到 65535 之间的端口。" },
    "usage.scanTimeout": { en: "Usage rescan timed out.", ko: "로그 재스캔 시간이 초과되었습니다.", ja: "使用量の再スキャンがタイムアウトしました。", zh: "用量重新扫描超时。" },
    "copy.copied": { en: "Copied", ko: "복사됨", ja: "コピー済み", zh: "已复制" },
    "copy.selected": { en: "Selected", ko: "선택됨", ja: "選択済み", zh: "已选中" },
    "errors.connection": { en: "Connection error: {message}", ko: "연결 오류: {message}", ja: "接続エラー: {message}", zh: "连接错误：{message}" },
  };

  function normalizeLocale(value) {
    const language = String(value || "").trim().toLowerCase().replaceAll("_", "-");
    if (!language) return null;
    return locales.find((locale) => language === locale.code || language.startsWith(`${locale.code}-`))?.code || null;
  }

  function detectLocale(languages) {
    for (const language of languages || []) {
      const locale = normalizeLocale(language);
      if (locale) return locale;
    }
    return DEFAULT_LOCALE;
  }

  function readStoredLocale(storage) {
    try {
      return normalizeLocale(storage?.getItem(STORAGE_KEY));
    } catch {
      return null;
    }
  }

  function initialLocale(storage, navigatorLike = {}) {
    const stored = readStoredLocale(storage);
    if (stored) return stored;
    const languages = Array.isArray(navigatorLike.languages) && navigatorLike.languages.length
      ? navigatorLike.languages
      : [navigatorLike.language];
    return detectLocale(languages);
  }

  function saveLocale(storage, locale) {
    const normalized = normalizeLocale(locale);
    if (!normalized) return false;
    try {
      storage?.setItem(STORAGE_KEY, normalized);
      return true;
    } catch {
      return false;
    }
  }

  function translate(locale, key, variables = {}) {
    const normalized = normalizeLocale(locale) || DEFAULT_LOCALE;
    const template = messages[key]?.[normalized] || messages[key]?.[DEFAULT_LOCALE] || key;
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name]) : match,
    );
  }

  function intlLocale(locale) {
    const normalized = normalizeLocale(locale) || DEFAULT_LOCALE;
    return locales.find((item) => item.code === normalized)?.intl || "en-US";
  }

  return {
    DEFAULT_LOCALE,
    STORAGE_KEY,
    detectLocale,
    initialLocale,
    intlLocale,
    locales,
    messages,
    normalizeLocale,
    readStoredLocale,
    saveLocale,
    translate,
  };
});
