use crate::{activity_log, config, monitor, update, usage};
use axum::{
    extract::{ConnectInfo, Query, State},
    http::{header, HeaderValue, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use std::{
    collections::{BTreeMap, VecDeque},
    net::{IpAddr, SocketAddr, TcpListener as StdTcpListener},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, RwLock,
    },
    thread,
    time::Duration,
};
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;

const DEFAULT_PORT: u16 = 8765;
const FALLBACK_PORT_END: u16 = 8799;
const MONITOR_SAMPLE_INTERVAL_SECONDS: u64 = 60;
const USAGE_REFRESH_INTERVAL_SECONDS: u64 = 600;
const INDEX_HTML: &str = include_str!("../../static/index.html");
const I18N_JS: &str = include_str!("../../static/i18n.js");
const APP_JS: &str = include_str!("../../static/app.js");
const STYLES_CSS: &str = include_str!("../../static/styles.css");

#[derive(Clone, Copy, PartialEq, Eq)]
enum PortSource {
    Env,
    Config,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PortConfigRequest {
    port: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsagePathsRequest {
    provider: String,
    paths: Vec<String>,
}

#[derive(Deserialize)]
struct UsageQuery {
    days: Option<i64>,
}

#[derive(Deserialize)]
struct HistoryQuery {
    minutes: Option<i64>,
    since: Option<i64>,
    bucket: Option<i64>,
}

#[derive(Deserialize)]
struct EventsQuery {
    limit: Option<usize>,
}

struct MonitorStore {
    data: RwLock<MonitorData>,
    activity_log: Option<activity_log::ActivityLog>,
    shared_snapshot: monitor::SharedSnapshot,
    update_state: update::SharedUpdateState,
    port: u16,
    tray_enabled: bool,
    runtime: &'static str,
    usage_cache: RwLock<Option<CachedUsage>>,
    usage_refreshing: AtomicBool,
}

struct CachedUsage {
    collected_at: i64,
    responses: Vec<usage::UsageResponse>,
}

struct MonitorData {
    snapshot: monitor::Snapshot,
    history: VecDeque<activity_log::HistoryPoint>,
    events: VecDeque<activity_log::EventRow>,
    previous_statuses: BTreeMap<String, String>,
}

pub struct ServerHandle {
    pub port: u16,
}

#[allow(dead_code)]
pub fn spawn_server(
    shared_snapshot: monitor::SharedSnapshot,
    tray_enabled: bool,
    update_state: update::SharedUpdateState,
) -> std::io::Result<ServerHandle> {
    spawn_server_with_runtime(shared_snapshot, tray_enabled, "tauri-rust", update_state)
}

#[allow(dead_code)]
pub fn spawn_headless_server(
    shared_snapshot: monitor::SharedSnapshot,
) -> std::io::Result<ServerHandle> {
    spawn_server_with_runtime(
        shared_snapshot,
        false,
        "rust-headless",
        update::UpdateState::unavailable(),
    )
}

fn spawn_server_with_runtime(
    shared_snapshot: monitor::SharedSnapshot,
    tray_enabled: bool,
    runtime_name: &'static str,
    update_state: update::SharedUpdateState,
) -> std::io::Result<ServerHandle> {
    let listener = bind_listener()?;
    let port = listener.local_addr()?.port();
    listener.set_nonblocking(true)?;

    thread::spawn(move || {
        let runtime = tokio::runtime::Runtime::new().expect("create tokio runtime");
        runtime.block_on(async move {
            let state = Arc::new(MonitorStore::new(
                shared_snapshot,
                update_state,
                port,
                tray_enabled,
                runtime_name,
            ));
            spawn_monitor_loop(Arc::clone(&state));
            request_usage_refresh(Arc::clone(&state));
            spawn_usage_loop(Arc::clone(&state));
            let app = Router::new()
                .route("/", get(index))
                .route("/i18n.js", get(i18n_js))
                .route("/app.js", get(app_js))
                .route("/styles.css", get(styles_css))
                .route("/api/runtime", get(runtime_route))
                .route("/api/config", get(config_route))
                .route("/api/config/port", post(save_port_config_route))
                .route("/api/config/usage-paths", post(save_usage_paths_route))
                .route("/api/update/status", get(update_status_route))
                .route("/api/update/check", post(update_check_route))
                .route("/api/update/install", post(update_install_route))
                .route("/api/snapshot", get(snapshot))
                .route("/api/usage", get(usage_route))
                .route("/api/usage/refresh", post(refresh_usage_route))
                .route("/api/usage-locations", get(usage_locations_route))
                .route("/api/history", get(history))
                .route("/api/provider-history", get(provider_history))
                .route("/api/remote-check", get(remote_check))
                .route("/api/events", get(events))
                .route("/healthz", get(healthz))
                .layer(CorsLayer::permissive())
                .with_state(state);
            let listener = TcpListener::from_std(listener).expect("attach AgentWatch listener");
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await
            .expect("run AgentWatch server");
        });
    });

    Ok(ServerHandle { port })
}

fn bind_listener() -> std::io::Result<StdTcpListener> {
    if let Some((port, source)) = configured_port_source() {
        if source == PortSource::Env {
            return StdTcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port)));
        }
        return bind_configured_or_fallback(port);
    }

    bind_first_available(DEFAULT_PORT..=FALLBACK_PORT_END)
}

fn bind_configured_or_fallback(port: u16) -> std::io::Result<StdTcpListener> {
    match StdTcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port))) {
        Ok(listener) => Ok(listener),
        Err(first_error) => {
            bind_first_available(DEFAULT_PORT..=FALLBACK_PORT_END).or(Err(first_error))
        }
    }
}

fn bind_first_available(ports: impl IntoIterator<Item = u16>) -> std::io::Result<StdTcpListener> {
    let mut first_error = None;
    for port in ports {
        match StdTcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port))) {
            Ok(listener) => return Ok(listener),
            Err(error) => {
                first_error.get_or_insert(error);
            }
        }
    }
    Err(first_error.unwrap_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::AddrNotAvailable, "no candidate ports")
    }))
}

fn configured_port_source() -> Option<(u16, PortSource)> {
    if let Some(port) = parse_configured_port(std::env::var("AGENTWATCH_PORT").ok()) {
        return Some((port, PortSource::Env));
    }
    config::read_config()
        .port
        .map(|port| (port, PortSource::Config))
}

fn parse_configured_port(value: Option<String>) -> Option<u16> {
    let value = value?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    trimmed.parse::<u16>().ok()
}

fn port_source_label(source: Option<PortSource>) -> &'static str {
    match source {
        Some(PortSource::Env) => "env",
        Some(PortSource::Config) => "config",
        None => "auto",
    }
}

fn port_config_payload(effective_port: u16) -> serde_json::Value {
    let config = config::read_config();
    let env_port = parse_configured_port(std::env::var("AGENTWATCH_PORT").ok());
    let source = if env_port.is_some() {
        Some(PortSource::Env)
    } else if config.port.is_some() {
        Some(PortSource::Config)
    } else {
        None
    };
    json!({
        "configuredPort": config.port,
        "effectivePort": effective_port,
        "defaultPort": DEFAULT_PORT,
        "fallbackPortEnd": FALLBACK_PORT_END,
        "envPort": env_port,
        "portSource": port_source_label(source),
        "firstRun": env_port.is_none() && config.port.is_none(),
        "configPath": config::config_path_display(),
        "usagePaths": config.usage_paths,
        "restartRequired": source != Some(PortSource::Env) && config.port.is_some() && config.port != Some(effective_port),
    })
}

impl MonitorStore {
    fn new(
        shared_snapshot: monitor::SharedSnapshot,
        update_state: update::SharedUpdateState,
        port: u16,
        tray_enabled: bool,
        runtime: &'static str,
    ) -> Self {
        let snapshot = monitor::fast_snapshot();
        update_shared_snapshot(&shared_snapshot, &snapshot);
        let mut previous_statuses = BTreeMap::new();
        for provider in &snapshot.providers {
            previous_statuses.insert(provider.key.clone(), provider.status.clone());
        }
        let activity_log = activity_log::ActivityLog::open_default().ok();
        if let Some(log) = &activity_log {
            let _ = log.record_snapshot(&snapshot);
        }

        let mut history = VecDeque::new();
        history.push_back(activity_log::history_point(&snapshot));
        Self {
            data: RwLock::new(MonitorData {
                snapshot,
                history,
                events: VecDeque::new(),
                previous_statuses,
            }),
            activity_log,
            shared_snapshot,
            update_state,
            port,
            tray_enabled,
            runtime,
            usage_cache: RwLock::new(None),
            usage_refreshing: AtomicBool::new(false),
        }
    }

    fn record(&self, snapshot: monitor::Snapshot) {
        let mut data = self.data.write().expect("monitor state lock");
        for provider in &snapshot.providers {
            let previous = data
                .previous_statuses
                .insert(provider.key.clone(), provider.status.clone());
            if let Some(previous) = previous {
                if previous != provider.status {
                    let event = activity_log::EventRow {
                        ts: snapshot.timestamp,
                        level: event_level(&provider.status).to_string(),
                        provider: provider.name.clone(),
                        message: format!(
                            "{} changed from {} to {}",
                            provider.name, previous, provider.status
                        ),
                    };
                    if let Some(log) = &self.activity_log {
                        let _ = log.record_event(&event);
                    }
                    data.events.push_front(event);
                }
            }
        }
        if let Some(log) = &self.activity_log {
            let _ = log.record_snapshot(&snapshot);
        }
        data.history
            .push_back(activity_log::history_point(&snapshot));
        while data.history.len() > 6 * 60 * 24 {
            data.history.pop_front();
        }
        while data.events.len() > 500 {
            data.events.pop_back();
        }
        update_shared_snapshot(&self.shared_snapshot, &snapshot);
        data.snapshot = snapshot;
    }

    fn snapshot(&self) -> monitor::Snapshot {
        self.data
            .read()
            .expect("monitor state lock")
            .snapshot
            .clone()
    }

    fn history_since(&self, since: i64, bucket_seconds: i64) -> Vec<activity_log::HistoryPoint> {
        if let Some(log) = &self.activity_log {
            if let Ok(history) = log.history_since(since, bucket_seconds) {
                return history;
            }
        }
        self.data
            .read()
            .expect("monitor state lock")
            .history
            .iter()
            .filter(|point| point.ts >= since)
            .cloned()
            .collect()
    }

    fn events(&self, limit: usize) -> Vec<activity_log::EventRow> {
        if let Some(log) = &self.activity_log {
            if let Ok(events) = log.events(limit) {
                return events;
            }
        }
        self.data
            .read()
            .expect("monitor state lock")
            .events
            .iter()
            .take(limit)
            .cloned()
            .collect()
    }

    fn provider_history_since(
        &self,
        since: i64,
        bucket_seconds: i64,
        limit: usize,
    ) -> Vec<activity_log::ProviderHistoryPoint> {
        if let Some(log) = &self.activity_log {
            if let Ok(history) = log.provider_history_since(since, bucket_seconds, limit) {
                return history;
            }
        }
        Vec::new()
    }

    fn usage_payload(&self, days: i64) -> serde_json::Value {
        let refreshing = self.usage_refreshing.load(Ordering::Acquire);
        let cache = self.usage_cache.read().expect("usage cache lock");
        match cache.as_ref() {
            Some(cache) => json!({
                "usage": usage::limit_days(&cache.responses, days),
                "cached": true,
                "refreshing": refreshing,
                "collectedAt": cache.collected_at,
            }),
            None => json!({
                "usage": [],
                "cached": false,
                "refreshing": refreshing,
                "collectedAt": null,
            }),
        }
    }
}

fn update_shared_snapshot(shared_snapshot: &monitor::SharedSnapshot, snapshot: &monitor::Snapshot) {
    if let Ok(mut current) = shared_snapshot.write() {
        *current = Some(snapshot.clone());
    }
}

fn spawn_monitor_loop(state: Arc<MonitorStore>) {
    tokio::spawn(async move {
        let mut sampler = monitor::Sampler::new();
        tokio::time::sleep(Duration::from_secs(1)).await;
        state.record(sampler.snapshot());
        let mut interval =
            tokio::time::interval(Duration::from_secs(MONITOR_SAMPLE_INTERVAL_SECONDS));
        interval.tick().await;
        loop {
            interval.tick().await;
            state.record(sampler.snapshot());
        }
    });
}

fn spawn_usage_loop(state: Arc<MonitorStore>) {
    tokio::spawn(async move {
        let mut interval =
            tokio::time::interval(Duration::from_secs(USAGE_REFRESH_INTERVAL_SECONDS));
        interval.tick().await;
        loop {
            interval.tick().await;
            request_usage_refresh(Arc::clone(&state));
        }
    });
}

fn request_usage_refresh(state: Arc<MonitorStore>) -> bool {
    if state
        .usage_refreshing
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return false;
    }
    tokio::spawn(async move {
        let collected = tokio::task::spawn_blocking(|| usage::collect_all(366)).await;
        if let Ok(responses) = collected {
            let mut cache = state.usage_cache.write().expect("usage cache lock");
            *cache = Some(CachedUsage {
                collected_at: chrono::Local::now().timestamp(),
                responses,
            });
        }
        state.usage_refreshing.store(false, Ordering::Release);
    });
    true
}

fn event_level(status: &str) -> &'static str {
    match status {
        "busy" => "high",
        "active" => "info",
        "offline" => "low",
        _ => "normal",
    }
}

async fn index() -> Html<&'static str> {
    Html(INDEX_HTML)
}

async fn i18n_js() -> Response {
    with_content_type(I18N_JS, "application/javascript; charset=utf-8")
}

async fn app_js() -> Response {
    with_content_type(APP_JS, "application/javascript; charset=utf-8")
}

async fn styles_css() -> Response {
    with_content_type(STYLES_CSS, "text/css; charset=utf-8")
}

async fn runtime_route(State(state): State<Arc<MonitorStore>>) -> Json<serde_json::Value> {
    let snapshot = state.snapshot();
    Json(runtime_payload(
        state.port,
        state.tray_enabled,
        state.runtime,
        &snapshot,
    ))
}

async fn config_route(State(state): State<Arc<MonitorStore>>) -> Json<serde_json::Value> {
    Json(port_config_payload(state.port))
}

async fn save_port_config_route(
    State(state): State<Arc<MonitorStore>>,
    Json(payload): Json<PortConfigRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    if payload.port == 0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "port must be between 1 and 65535" })),
        );
    }

    let mut config = config::read_config();
    config.port = Some(payload.port);
    match config::write_config(&config) {
        Ok(()) => (StatusCode::OK, Json(port_config_payload(state.port))),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        ),
    }
}

async fn save_usage_paths_route(
    State(state): State<Arc<MonitorStore>>,
    Json(payload): Json<UsagePathsRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    let provider = payload.provider.trim().to_ascii_lowercase();
    let mut config = config::read_config();
    if !config.usage_paths.set_paths_for(&provider, payload.paths) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "provider must be codex, claude, or gemini" })),
        );
    }
    match config::write_config(&config) {
        Ok(()) => (StatusCode::OK, Json(port_config_payload(state.port))),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error.to_string() })),
        ),
    }
}

async fn update_status_route(State(state): State<Arc<MonitorStore>>) -> Json<update::UpdateStatus> {
    Json(state.update_state.status())
}

async fn update_check_route(State(state): State<Arc<MonitorStore>>) -> Json<update::UpdateStatus> {
    Json(state.update_state.check().await)
}

async fn update_install_route(
    State(state): State<Arc<MonitorStore>>,
) -> Json<update::UpdateStatus> {
    Json(state.update_state.install().await)
}

async fn snapshot(State(state): State<Arc<MonitorStore>>) -> Json<monitor::Snapshot> {
    Json(state.snapshot())
}

async fn usage_route(
    State(state): State<Arc<MonitorStore>>,
    Query(query): Query<UsageQuery>,
) -> Json<serde_json::Value> {
    let days = query.days.unwrap_or(91);
    for _ in 0..100 {
        if state
            .usage_cache
            .read()
            .expect("usage cache lock")
            .is_some()
            || !state.usage_refreshing.load(Ordering::Acquire)
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Json(state.usage_payload(days))
}

async fn refresh_usage_route(State(state): State<Arc<MonitorStore>>) -> Json<serde_json::Value> {
    let started = request_usage_refresh(Arc::clone(&state));
    Json(json!({
        "started": started,
        "refreshing": state.usage_refreshing.load(Ordering::Acquire),
    }))
}

async fn usage_locations_route() -> Json<serde_json::Value> {
    let providers = tokio::task::spawn_blocking(usage::usage_locations)
        .await
        .unwrap_or_default();
    Json(json!({ "providers": providers }))
}

async fn history(
    State(state): State<Arc<MonitorStore>>,
    Query(query): Query<HistoryQuery>,
) -> Json<serde_json::Value> {
    let minutes = query.minutes.unwrap_or(180).clamp(1, 24 * 60);
    let floor = chrono::Local::now().timestamp() - minutes * 60;
    let since = query.since.unwrap_or(floor).max(floor);
    let bucket = query.bucket.unwrap_or(30).clamp(10, 300);
    let history = state.history_since(since, bucket);
    Json(json!({ "history": history, "since": since, "bucketSeconds": bucket }))
}

async fn provider_history(
    State(state): State<Arc<MonitorStore>>,
    Query(query): Query<HistoryQuery>,
) -> Json<serde_json::Value> {
    let minutes = query.minutes.unwrap_or(180).clamp(1, 24 * 60);
    let floor = chrono::Local::now().timestamp() - minutes * 60;
    let since = query.since.unwrap_or(floor).max(floor);
    let bucket = query.bucket.unwrap_or(30).clamp(10, 300);
    let history = state.provider_history_since(since, bucket, 20000);
    Json(json!({
        "providerHistory": history,
        "since": since,
        "bucketSeconds": bucket,
    }))
}

async fn remote_check(
    State(state): State<Arc<MonitorStore>>,
    ConnectInfo(client_addr): ConnectInfo<SocketAddr>,
) -> Json<serde_json::Value> {
    let snapshot = state.snapshot();
    Json(remote_check_payload(client_addr, state.port, &snapshot))
}

async fn events(
    State(state): State<Arc<MonitorStore>>,
    Query(query): Query<EventsQuery>,
) -> Json<serde_json::Value> {
    let limit = query.limit.unwrap_or(80).clamp(1, 500);
    Json(json!({ "events": state.events(limit) }))
}

async fn healthz() -> Json<serde_json::Value> {
    Json(json!({ "ok": true, "time": chrono::Local::now().timestamp() }))
}

fn runtime_payload(
    port: u16,
    tray_enabled: bool,
    runtime: &'static str,
    snapshot: &monitor::Snapshot,
) -> serde_json::Value {
    let port_config = port_config_payload(port);
    let lan_urls = snapshot
        .local_ips
        .iter()
        .map(|ip| format!("http://{ip}:{port}"))
        .collect::<Vec<_>>();
    json!({
        "port": port,
        "bindHost": "0.0.0.0",
        "localUrl": format!("http://127.0.0.1:{port}"),
        "lanUrls": lan_urls,
        "platform": std::env::consts::OS,
        "runtime": runtime,
        "monitoringService": monitoring_service_payload(runtime, tray_enabled),
        "name": env!("CARGO_PKG_NAME"),
        "version": env!("CARGO_PKG_VERSION"),
        "trayEnabled": tray_enabled,
        "indicatorTarget": indicator_target(tray_enabled),
        "configuredPort": port_config["configuredPort"].clone(),
        "defaultPort": port_config["defaultPort"].clone(),
        "envPort": port_config["envPort"].clone(),
        "portSource": port_config["portSource"].clone(),
        "configPath": port_config["configPath"].clone(),
        "hostname": snapshot.hostname,
        "timestamp": snapshot.timestamp,
    })
}

fn monitoring_service_payload(runtime: &'static str, tray_enabled: bool) -> serde_json::Value {
    let embedded = runtime == "tauri-rust";
    json!({
        "mode": if embedded { "desktop-embedded" } else { "headless" },
        "embedded": embedded,
        "processOwner": if embedded { "desktop-app" } else { "agentwatch-server" },
        "closeKeepsRunning": embedded && tray_enabled,
        "quitStopsMonitoring": true,
    })
}

fn indicator_target(tray_enabled: bool) -> Option<&'static str> {
    indicator_target_for(std::env::consts::OS, tray_enabled)
}

fn indicator_target_for(platform: &str, tray_enabled: bool) -> Option<&'static str> {
    if !tray_enabled {
        return None;
    }
    Some(match platform {
        "macos" => "macos-menu-bar",
        "windows" => "windows-notification-area",
        "linux" => "linux-tray",
        _ => "desktop-tray",
    })
}

fn remote_check_payload(
    client_addr: SocketAddr,
    port: u16,
    snapshot: &monitor::Snapshot,
) -> serde_json::Value {
    let client_ip = normalize_ip(client_addr.ip());
    let local_ips = snapshot
        .local_ips
        .iter()
        .map(|ip| ip.to_string())
        .collect::<Vec<_>>();
    let is_loopback = client_addr.ip().is_loopback();
    let same_host_ip = local_ips.iter().any(|ip| ip == &client_ip);
    json!({
        "clientAddress": client_addr.to_string(),
        "clientIp": client_ip,
        "clientPort": client_addr.port(),
        "agentHostname": snapshot.hostname,
        "agentLanUrls": snapshot
            .local_ips
            .iter()
            .map(|ip| format!("http://{ip}:{port}"))
            .collect::<Vec<_>>(),
        "agentLocalIps": local_ips,
        "sameHostIp": same_host_ip,
        "loopback": is_loopback,
        "remoteClient": !is_loopback && !same_host_ip,
    })
}

fn normalize_ip(ip: IpAddr) -> String {
    match ip {
        IpAddr::V4(value) => value.to_string(),
        IpAddr::V6(value) => value
            .to_ipv4_mapped()
            .map_or_else(|| value.to_string(), |mapped| mapped.to_string()),
    }
}

fn with_content_type(body: &'static str, content_type: &'static str) -> Response {
    let mut response = (StatusCode::OK, body).into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::monitor::{Activity, Snapshot};

    #[test]
    fn parses_configured_port_only_when_valid() {
        assert_eq!(parse_configured_port(Some("9000".to_string())), Some(9000));
        assert_eq!(
            parse_configured_port(Some(" 9001 ".to_string())),
            Some(9001)
        );
        assert_eq!(parse_configured_port(Some("".to_string())), None);
        assert_eq!(parse_configured_port(Some("not-a-port".to_string())), None);
        assert_eq!(parse_configured_port(None), None);
    }

    #[test]
    fn bind_first_available_skips_busy_ports() {
        let busy = StdTcpListener::bind(SocketAddr::from(([0, 0, 0, 0], 0)))
            .expect("bind occupied test port");
        let busy_port = busy.local_addr().expect("busy test addr").port();

        let listener = bind_first_available([busy_port, 0]).expect("bind fallback test port");
        let selected = listener.local_addr().expect("selected test addr").port();

        assert_ne!(selected, busy_port);
        assert!(selected > 0);
    }

    #[test]
    fn runtime_payload_reports_selected_port_and_lan_urls() {
        let snapshot = test_snapshot();

        let value = runtime_payload(8766, true, "tauri-rust", &snapshot);

        assert_eq!(value["port"], 8766);
        assert_eq!(value["bindHost"], "0.0.0.0");
        assert_eq!(value["localUrl"], "http://127.0.0.1:8766");
        assert_eq!(value["lanUrls"][0], "http://192.168.50.93:8766");
        assert_eq!(value["lanUrls"][1], "http://10.0.0.4:8766");
        assert_eq!(value["platform"], std::env::consts::OS);
        assert_eq!(value["runtime"], "tauri-rust");
        assert_eq!(value["monitoringService"]["mode"], "desktop-embedded");
        assert_eq!(value["monitoringService"]["embedded"], true);
        assert_eq!(value["monitoringService"]["processOwner"], "desktop-app");
        assert_eq!(value["monitoringService"]["closeKeepsRunning"], true);
        assert_eq!(value["monitoringService"]["quitStopsMonitoring"], true);
        assert_eq!(value["name"], "agentwatch");
        assert_eq!(value["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(value["trayEnabled"], true);
        assert_eq!(value["indicatorTarget"], indicator_target(true).unwrap());
        assert_eq!(value["hostname"], "agent-host");
        assert_eq!(value["timestamp"], 123);
    }

    #[test]
    fn runtime_payload_omits_indicator_target_for_headless_runtime() {
        let value = runtime_payload(8766, false, "rust-headless", &test_snapshot());

        assert_eq!(value["trayEnabled"], false);
        assert_eq!(value["indicatorTarget"], serde_json::Value::Null);
        assert_eq!(value["monitoringService"]["mode"], "headless");
        assert_eq!(value["monitoringService"]["embedded"], false);
        assert_eq!(
            value["monitoringService"]["processOwner"],
            "agentwatch-server"
        );
        assert_eq!(value["monitoringService"]["closeKeepsRunning"], false);
        assert_eq!(value["monitoringService"]["quitStopsMonitoring"], true);
    }

    #[test]
    fn indicator_target_maps_supported_desktop_platforms() {
        assert_eq!(indicator_target_for("macos", true), Some("macos-menu-bar"));
        assert_eq!(
            indicator_target_for("windows", true),
            Some("windows-notification-area")
        );
        assert_eq!(indicator_target_for("linux", true), Some("linux-tray"));
        assert_eq!(indicator_target_for("freebsd", true), Some("desktop-tray"));
        assert_eq!(indicator_target_for("windows", false), None);
    }

    #[test]
    fn remote_check_marks_non_local_lan_client_as_remote() {
        let value = remote_check_payload(
            SocketAddr::from(([192, 168, 50, 24], 53124)),
            8765,
            &test_snapshot(),
        );

        assert_eq!(value["clientIp"], "192.168.50.24");
        assert_eq!(value["loopback"], false);
        assert_eq!(value["sameHostIp"], false);
        assert_eq!(value["remoteClient"], true);
        assert_eq!(value["agentLanUrls"][0], "http://192.168.50.93:8765");
    }

    #[test]
    fn remote_check_rejects_loopback_and_same_host_lan_ip() {
        let loopback = remote_check_payload(
            SocketAddr::from(([127, 0, 0, 1], 53124)),
            8765,
            &test_snapshot(),
        );
        assert_eq!(loopback["loopback"], true);
        assert_eq!(loopback["remoteClient"], false);

        let same_host = remote_check_payload(
            SocketAddr::from(([192, 168, 50, 93], 53124)),
            8765,
            &test_snapshot(),
        );
        assert_eq!(same_host["sameHostIp"], true);
        assert_eq!(same_host["remoteClient"], false);
    }

    fn test_snapshot() -> Snapshot {
        Snapshot {
            timestamp: 123,
            hostname: "agent-host".to_string(),
            local_ips: vec!["192.168.50.93".to_string(), "10.0.0.4".to_string()],
            activity: Activity {
                score: 0,
                status: "quiet".to_string(),
                active_process_count: 0,
                total_cpu: 0.0,
                total_memory: 0.0,
            },
            providers: Vec::new(),
        }
    }
}
