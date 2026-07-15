use crate::config;
use chrono::{DateTime, Local, TimeZone};
use rusqlite::{params, Connection, OpenFlags};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageResponse {
    provider: String,
    name: String,
    source: String,
    updated_at: i64,
    quota_meta: QuotaMeta,
    totals: UsageTotals,
    daily: Vec<DailyUsage>,
    quotas: Vec<Quota>,
    threads: Vec<ThreadUsage>,
    goals: Vec<GoalUsage>,
    notes: Vec<String>,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct QuotaMeta {
    source: String,
    source_path: Option<String>,
    observed_at: Option<i64>,
    age_seconds: Option<i64>,
    stale: bool,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct UsageTotals {
    today_tokens: i64,
    last7_days_tokens: i64,
    last30_days_tokens: i64,
    observed_tokens: i64,
    thread_total_tokens: i64,
    thread_count: i64,
}

#[derive(Clone, Serialize)]
struct DailyUsage {
    date: String,
    tokens: i64,
    turns: i64,
    models: BTreeMap<String, i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Quota {
    label: String,
    kind: String,
    plan_type: String,
    used_percent: i64,
    remaining_percent: i64,
    window_minutes: Option<i64>,
    reset_at: Option<i64>,
    reset_after_seconds: Option<i64>,
    limit_reached: bool,
    allowed: bool,
    observed_at: i64,
}

struct QuotaSnapshot {
    source: String,
    source_path: PathBuf,
    observed_at: i64,
    quotas: Vec<Quota>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadUsage {
    id: String,
    title: String,
    model: String,
    tokens: i64,
    updated_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GoalUsage {
    thread_id: String,
    objective: String,
    status: String,
    tokens_used: i64,
    token_budget: Option<i64>,
    remaining_tokens: Option<i64>,
    updated_at: i64,
}

#[cfg(test)]
struct TurnUsage {
    id: String,
    ts: i64,
    date: String,
    model: String,
    tokens: i64,
}

struct TokenEvent {
    provider: String,
    source_id: String,
    ts: i64,
    date: String,
    model: String,
    tokens: i64,
    source_path: PathBuf,
}

struct SourceCandidate {
    provider: &'static str,
    path: PathBuf,
    format: SourceFormat,
}

#[derive(Clone, Copy)]
enum SourceFormat {
    CodexSqlite,
    CodexJsonl,
    ClaudeJsonl,
    GenericJson,
    GenericJsonl,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageLocationProvider {
    provider: &'static str,
    label: &'static str,
    terminal_command: String,
    defaults: Vec<UsageLocationEntry>,
    configured: Vec<UsageLocationEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageLocationEntry {
    path: String,
    expanded_path: String,
    source: &'static str,
    exists: bool,
    file_count: usize,
}

pub fn collect_all(days: i64) -> Vec<UsageResponse> {
    let now = Local::now().timestamp();
    let log_db = first_existing(&codex_log_db_candidates());
    let state_db = first_existing(&codex_state_db_candidates());
    let goals_db = first_existing(&codex_goals_db_candidates());
    let days = days.clamp(1, 366);
    let mut notes = Vec::new();
    let cache_path = sync_usage_cache(&mut notes);

    let mut responses = vec![
        usage_response("all", "전체", now, cache_path.as_ref(), &notes),
        usage_response("codex", "OpenAI Codex", now, cache_path.as_ref(), &notes),
        usage_response("claude", "Claude", now, cache_path.as_ref(), &notes),
        usage_response("gemini", "Gemini", now, cache_path.as_ref(), &notes),
    ];

    if let Some(path) = cache_path.as_ref() {
        if let Ok(conn) = Connection::open(path) {
            for response in &mut responses {
                let provider = (response.provider != "all").then_some(response.provider.as_str());
                response.daily = collect_cached_daily(&conn, provider, days);
                apply_daily_totals(response, now);
                if response.provider != "all" && response.totals.observed_tokens == 0 {
                    response.notes.push(format!(
                        "{} token logs were not found or did not contain parseable usage fields.",
                        response.name
                    ));
                }
            }
        }
    }

    let Some(codex) = responses.iter_mut().find(|item| item.provider == "codex") else {
        return responses;
    };

    if log_db.is_none() {
        codex
            .notes
            .push("Codex log database was not found.".to_string());
    }
    if let Some(ref path) = log_db {
        codex.source = display_path(path);
    }

    if let Some(snapshot) = collect_latest_quota_snapshot(log_db.as_ref()) {
        codex.quota_meta = quota_meta_from_snapshot(&snapshot, now);
        codex.quotas = snapshot.quotas;
    } else {
        codex.quota_meta = QuotaMeta {
            source: "none".to_string(),
            ..QuotaMeta::default()
        };
    }

    if let Some(path) = state_db {
        let (thread_total, thread_count, threads) = collect_threads(&path);
        codex.totals.thread_total_tokens = thread_total;
        codex.totals.thread_count = thread_count;
        codex.threads = threads;
    } else {
        codex
            .notes
            .push("Codex state database was not found.".to_string());
    }

    if let Some(path) = goals_db {
        codex.goals = collect_goals(&path);
    } else {
        codex
            .notes
            .push("Codex goal database was not found.".to_string());
    }

    responses
}

fn usage_response(
    provider: &str,
    name: &str,
    now: i64,
    cache_path: Option<&PathBuf>,
    notes: &[String],
) -> UsageResponse {
    UsageResponse {
        provider: provider.to_string(),
        name: name.to_string(),
        source: cache_path
            .map(display_path)
            .unwrap_or_else(|| "not_found".to_string()),
        updated_at: now,
        quota_meta: QuotaMeta::default(),
        totals: UsageTotals::default(),
        daily: Vec::new(),
        quotas: Vec::new(),
        threads: Vec::new(),
        goals: Vec::new(),
        notes: notes.to_vec(),
    }
}

fn apply_daily_totals(response: &mut UsageResponse, now: i64) {
    let today = local_day(now);
    response.totals.today_tokens = response
        .daily
        .iter()
        .filter(|day| day.date == today)
        .map(|day| day.tokens)
        .sum();
    response.totals.last7_days_tokens = response.daily.iter().rev().take(7).map(|d| d.tokens).sum();
    response.totals.last30_days_tokens =
        response.daily.iter().rev().take(30).map(|d| d.tokens).sum();
    response.totals.observed_tokens = response.daily.iter().map(|d| d.tokens).sum();
}

#[cfg(test)]
fn collect_daily(path: &PathBuf, since: i64) -> Vec<DailyUsage> {
    let Ok(conn) = open_readonly(path) else {
        return Vec::new();
    };
    let Ok(mut stmt) = conn.prepare(
        "SELECT ts, feedback_log_body FROM logs
         WHERE ts >= ?1
           AND target = 'codex_core::session::turn'
           AND feedback_log_body LIKE '%total_usage_tokens=%'
           AND feedback_log_body NOT LIKE '%ToolCall:%'
         ORDER BY ts ASC
         LIMIT 50000",
    ) else {
        return Vec::new();
    };

    let rows = stmt
        .query_map([since], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .ok();
    let Some(rows) = rows else {
        return Vec::new();
    };

    let mut by_turn: HashMap<String, TurnUsage> = HashMap::new();
    for row in rows.flatten() {
        let (ts, body) = row;
        let Some(turn_id) = extract_after(&body, "turn_id=") else {
            continue;
        };
        let Some(tokens) =
            extract_after(&body, "total_usage_tokens=").and_then(|value| value.parse::<i64>().ok())
        else {
            continue;
        };
        let model = extract_after(&body, "model=").unwrap_or_else(|| "unknown".to_string());
        let current = by_turn.get(&turn_id).map(|item| item.tokens).unwrap_or(-1);
        if tokens > current {
            by_turn.insert(
                turn_id,
                TurnUsage {
                    id: body
                        .split("turn_id=")
                        .nth(1)
                        .and_then(|value| {
                            value
                                .split(|ch: char| ch.is_whitespace() || ch == '}' || ch == ',')
                                .next()
                        })
                        .unwrap_or("unknown")
                        .trim_matches('"')
                        .to_string(),
                    ts,
                    date: local_day(ts),
                    model,
                    tokens,
                },
            );
        }
    }

    let mut by_day: BTreeMap<String, DailyUsage> = BTreeMap::new();
    for item in by_turn.into_values() {
        let _ = (&item.id, item.ts);
        let day = by_day
            .entry(item.date.clone())
            .or_insert_with(|| DailyUsage {
                date: item.date,
                tokens: 0,
                turns: 0,
                models: BTreeMap::new(),
            });
        day.tokens += item.tokens;
        day.turns += 1;
        *day.models.entry(item.model).or_insert(0) += item.tokens;
    }
    by_day.into_values().collect()
}

fn sync_usage_cache(notes: &mut Vec<String>) -> Option<PathBuf> {
    let path = home_path(".agentwatch/usage.sqlite");
    if let Some(parent) = path.parent() {
        if let Err(error) = fs::create_dir_all(parent) {
            notes.push(format!(
                "AgentWatch usage cache directory could not be created: {error}"
            ));
            return None;
        }
    }
    let Ok(mut conn) = Connection::open(&path) else {
        notes.push("AgentWatch usage cache could not be opened.".to_string());
        return None;
    };
    if let Err(error) = init_usage_cache(&conn) {
        notes.push(format!(
            "AgentWatch usage cache could not be initialized: {error}"
        ));
        return None;
    }

    for source in usage_source_candidates() {
        let Some(signature) = source_signature(&source.path) else {
            continue;
        };
        if source_already_scanned(&conn, &source.provider, &source.path, &signature) {
            continue;
        }
        match collect_source_events(&source) {
            Ok(events) => {
                if let Err(error) = upsert_token_events(&mut conn, &events) {
                    notes.push(format!(
                        "{} token cache update failed for {}: {error}",
                        source.provider,
                        display_path(&source.path)
                    ));
                    continue;
                }
                let _ = mark_source_scanned(&conn, &source.provider, &source.path, &signature);
            }
            Err(error) => notes.push(format!(
                "{} token log scan failed for {}: {error}",
                source.provider,
                display_path(&source.path)
            )),
        }
    }
    Some(path)
}

fn init_usage_cache(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS token_events (
            provider TEXT NOT NULL,
            source_id TEXT NOT NULL,
            ts INTEGER NOT NULL,
            date TEXT NOT NULL,
            model TEXT NOT NULL,
            tokens INTEGER NOT NULL,
            source_path TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (provider, source_id)
        );
        CREATE INDEX IF NOT EXISTS idx_token_events_provider_date
            ON token_events(provider, date);
        CREATE INDEX IF NOT EXISTS idx_token_events_date
            ON token_events(date);
        CREATE TABLE IF NOT EXISTS token_sources (
            provider TEXT NOT NULL,
            path TEXT NOT NULL,
            signature TEXT NOT NULL,
            scanned_at INTEGER NOT NULL,
            PRIMARY KEY (provider, path)
        );",
    )
}

fn usage_source_candidates() -> Vec<SourceCandidate> {
    let mut sources = Vec::new();
    for path in codex_log_db_candidates() {
        if path.exists() {
            sources.push(SourceCandidate {
                provider: "codex",
                path,
                format: SourceFormat::CodexSqlite,
            });
            break;
        }
    }
    for path in collect_files_with_extensions(&codex_session_roots(), &["jsonl"], 500) {
        sources.push(SourceCandidate {
            provider: "codex",
            path,
            format: SourceFormat::CodexJsonl,
        });
    }
    for path in collect_files_with_extensions(&claude_usage_roots(), &["jsonl"], 1500) {
        sources.push(SourceCandidate {
            provider: "claude",
            path,
            format: SourceFormat::ClaudeJsonl,
        });
    }
    for path in
        collect_files_with_extensions(&gemini_usage_roots(), &["json", "jsonl", "log"], 1000)
    {
        let format = if path.extension().and_then(|value| value.to_str()) == Some("jsonl") {
            SourceFormat::GenericJsonl
        } else {
            SourceFormat::GenericJson
        };
        sources.push(SourceCandidate {
            provider: "gemini",
            path,
            format,
        });
    }
    sources.extend(configured_usage_source_candidates());
    dedupe_source_candidates(sources)
}

pub fn usage_locations() -> Vec<UsageLocationProvider> {
    let config = config::read_config();
    [
        ("codex", "Codex"),
        ("claude", "Claude"),
        ("gemini", "Gemini"),
    ]
    .into_iter()
    .map(|(provider, label)| UsageLocationProvider {
        provider,
        label,
        terminal_command: terminal_discovery_command(provider),
        defaults: default_usage_roots(provider)
            .into_iter()
            .map(|path| usage_location_entry(provider, path, "default"))
            .collect(),
        configured: config
            .usage_paths
            .paths_for(provider)
            .into_iter()
            .map(|path| {
                usage_location_entry(provider, config::expand_user_path(&path), "configured")
            })
            .collect(),
    })
    .collect()
}

fn configured_usage_source_candidates() -> Vec<SourceCandidate> {
    let config = config::read_config();
    let mut sources = Vec::new();
    for provider in ["codex", "claude", "gemini"] {
        for path in config.usage_paths.paths_for(provider) {
            sources.extend(source_candidates_for_configured_path(
                provider,
                config::expand_user_path(&path),
            ));
        }
    }
    sources
}

fn source_candidates_for_configured_path(
    provider: &'static str,
    path: PathBuf,
) -> Vec<SourceCandidate> {
    if path.is_file() {
        return source_candidate_for_file(provider, path)
            .into_iter()
            .collect();
    }
    if !path.is_dir() {
        return Vec::new();
    }
    match provider {
        "codex" => {
            let mut sources = Vec::new();
            for db_path in [
                path.join("logs_2.sqlite"),
                path.join("sqlite/logs_2.sqlite"),
            ] {
                if db_path.exists() {
                    sources.push(SourceCandidate {
                        provider,
                        path: db_path,
                        format: SourceFormat::CodexSqlite,
                    });
                    break;
                }
            }
            for file in collect_files_with_extensions(&[path], &["jsonl"], 1000) {
                sources.push(SourceCandidate {
                    provider,
                    path: file,
                    format: SourceFormat::CodexJsonl,
                });
            }
            sources
        }
        "claude" => collect_files_with_extensions(&[path], &["jsonl"], 1500)
            .into_iter()
            .map(|file| SourceCandidate {
                provider,
                path: file,
                format: SourceFormat::ClaudeJsonl,
            })
            .collect(),
        "gemini" => collect_files_with_extensions(&[path], &["json", "jsonl", "log"], 1000)
            .into_iter()
            .map(|file| {
                let format = if file.extension().and_then(|value| value.to_str()) == Some("jsonl") {
                    SourceFormat::GenericJsonl
                } else {
                    SourceFormat::GenericJson
                };
                SourceCandidate {
                    provider,
                    path: file,
                    format,
                }
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn source_candidate_for_file(provider: &'static str, path: PathBuf) -> Option<SourceCandidate> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let format = match provider {
        "codex" if extension == "sqlite" => SourceFormat::CodexSqlite,
        "codex" if extension == "jsonl" => SourceFormat::CodexJsonl,
        "claude" if extension == "jsonl" => SourceFormat::ClaudeJsonl,
        "gemini" if extension == "jsonl" => SourceFormat::GenericJsonl,
        "gemini" if matches!(extension, "json" | "log") => SourceFormat::GenericJson,
        _ => return None,
    };
    Some(SourceCandidate {
        provider,
        path,
        format,
    })
}

fn dedupe_source_candidates(sources: Vec<SourceCandidate>) -> Vec<SourceCandidate> {
    let mut seen = std::collections::HashSet::new();
    sources
        .into_iter()
        .filter(|source| seen.insert((source.provider, display_path(&source.path))))
        .collect()
}

fn usage_location_entry(provider: &str, path: PathBuf, source: &'static str) -> UsageLocationEntry {
    UsageLocationEntry {
        path: display_path(&path),
        expanded_path: path.display().to_string(),
        source,
        exists: path.exists(),
        file_count: matching_usage_file_count(provider, &path),
    }
}

fn matching_usage_file_count(provider: &str, path: &Path) -> usize {
    if path.is_file() {
        return 1;
    }
    if !path.is_dir() {
        return 0;
    }
    let extensions = match provider {
        "codex" | "claude" => vec!["jsonl"],
        "gemini" => vec!["json", "jsonl", "log"],
        _ => Vec::new(),
    };
    let mut count = collect_files_with_extensions(&[path.to_path_buf()], &extensions, 2000).len();
    if provider == "codex" {
        count += [
            path.join("logs_2.sqlite"),
            path.join("sqlite/logs_2.sqlite"),
        ]
        .into_iter()
        .filter(|candidate| candidate.exists())
        .count();
    }
    count
}

fn default_usage_roots(provider: &str) -> Vec<PathBuf> {
    match provider {
        "codex" => codex_log_db_candidates()
            .into_iter()
            .chain(codex_session_roots())
            .collect(),
        "claude" => claude_usage_roots(),
        "gemini" => gemini_usage_roots(),
        _ => Vec::new(),
    }
}

fn codex_home() -> PathBuf {
    std::env::var("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home_path(".codex"))
}

fn codex_log_db_candidates() -> Vec<PathBuf> {
    let root = codex_home();
    vec![
        root.join("logs_2.sqlite"),
        root.join("sqlite/logs_2.sqlite"),
    ]
}

fn codex_state_db_candidates() -> Vec<PathBuf> {
    let root = codex_home();
    vec![
        root.join("state_5.sqlite"),
        root.join("sqlite/state_5.sqlite"),
    ]
}

fn codex_goals_db_candidates() -> Vec<PathBuf> {
    let root = codex_home();
    vec![
        root.join("goals_1.sqlite"),
        root.join("sqlite/goals_1.sqlite"),
    ]
}

fn codex_session_roots() -> Vec<PathBuf> {
    vec![codex_home().join("sessions")]
}

fn claude_home() -> PathBuf {
    std::env::var("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home_path(".claude"))
}

fn claude_usage_roots() -> Vec<PathBuf> {
    let root = claude_home();
    vec![
        root.join("projects"),
        root.join("tasks"),
        root.join("sessions"),
        home_path("Library/Application Support/Claude/claude-code-sessions"),
        home_path("Library/Application Support/Claude Code"),
        home_path(".config/claude"),
        home_path("AppData/Roaming/Claude"),
    ]
}

fn gemini_home() -> PathBuf {
    std::env::var("GEMINI_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home_path(".gemini"))
}

fn gemini_usage_roots() -> Vec<PathBuf> {
    vec![
        gemini_home(),
        home_path(".config/gemini"),
        home_path("Library/Application Support/com.google.GeminiMacOS"),
        home_path("Library/Application Support/Gemini"),
        home_path("AppData/Roaming/Gemini"),
    ]
}

fn terminal_discovery_command(provider: &str) -> String {
    if cfg!(target_os = "windows") {
        return match provider {
            "codex" => "powershell -NoProfile -Command \"Get-ChildItem $env:USERPROFILE\\\\.codex -Recurse -File -Include logs_2.sqlite,*.jsonl -ErrorAction SilentlyContinue | Select-Object -First 50 -ExpandProperty FullName\"".to_string(),
            "claude" => "powershell -NoProfile -Command \"Get-ChildItem $env:USERPROFILE\\\\.claude,$env:APPDATA\\\\Claude -Recurse -File -Include *.jsonl -ErrorAction SilentlyContinue | Select-Object -First 50 -ExpandProperty FullName\"".to_string(),
            "gemini" => "powershell -NoProfile -Command \"Get-ChildItem $env:USERPROFILE\\\\.gemini,$env:APPDATA\\\\Gemini -Recurse -File -Include *.json,*.jsonl,*.log -ErrorAction SilentlyContinue | Select-Object -First 50 -ExpandProperty FullName\"".to_string(),
            _ => String::new(),
        };
    }
    match provider {
        "codex" => "find \"${CODEX_HOME:-$HOME/.codex}\" -type f \\( -name 'logs_2.sqlite' -o -name '*.jsonl' \\) -print 2>/dev/null | head -50".to_string(),
        "claude" => "find \"${CLAUDE_CONFIG_DIR:-$HOME/.claude}\" \"$HOME/Library/Application Support/Claude\" \"$HOME/Library/Application Support/Claude Code\" \"$HOME/.config/claude\" -type f -name '*.jsonl' -print 2>/dev/null | head -50".to_string(),
        "gemini" => "find \"${GEMINI_CONFIG_DIR:-$HOME/.gemini}\" \"$HOME/.config/gemini\" \"$HOME/Library/Application Support/com.google.GeminiMacOS\" \"$HOME/Library/Application Support/Gemini\" -type f \\( -name '*.json' -o -name '*.jsonl' -o -name '*.log' \\) -print 2>/dev/null | head -50".to_string(),
        _ => String::new(),
    }
}

fn collect_files_with_extensions(
    roots: &[PathBuf],
    extensions: &[&str],
    limit: usize,
) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for root in roots {
        collect_files(root, extensions, &mut files);
    }
    files.sort_by_key(|path| {
        fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .ok()
    });
    files.reverse();
    files.truncate(limit);
    files
}

fn collect_files(dir: &Path, extensions: &[&str], files: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files(&path, extensions, files);
        } else if path
            .extension()
            .and_then(|value| value.to_str())
            .map(|extension| extensions.iter().any(|candidate| candidate == &extension))
            .unwrap_or(false)
        {
            files.push(path);
        }
    }
}

fn source_signature(path: &Path) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let mut signature = format!("{}:{modified}", metadata.len());
    let wal = PathBuf::from(format!("{}-wal", path.display()));
    if let Ok(wal_metadata) = fs::metadata(wal) {
        let wal_modified = wal_metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        signature.push_str(&format!(":{}:{wal_modified}", wal_metadata.len()));
    }
    Some(signature)
}

fn source_already_scanned(conn: &Connection, provider: &str, path: &Path, signature: &str) -> bool {
    conn.query_row(
        "SELECT signature FROM token_sources WHERE provider = ?1 AND path = ?2",
        params![provider, path.display().to_string()],
        |row| row.get::<_, String>(0),
    )
    .map(|existing| existing == signature)
    .unwrap_or(false)
}

fn mark_source_scanned(
    conn: &Connection,
    provider: &str,
    path: &Path,
    signature: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO token_sources (provider, path, signature, scanned_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(provider, path) DO UPDATE SET
            signature = excluded.signature,
            scanned_at = excluded.scanned_at",
        params![
            provider,
            path.display().to_string(),
            signature,
            Local::now().timestamp()
        ],
    )?;
    Ok(())
}

fn collect_source_events(source: &SourceCandidate) -> Result<Vec<TokenEvent>, String> {
    match source.format {
        SourceFormat::CodexSqlite => collect_codex_sqlite_events(&source.path),
        SourceFormat::CodexJsonl => collect_codex_jsonl_events(&source.path),
        SourceFormat::ClaudeJsonl => collect_claude_jsonl_events(&source.path),
        SourceFormat::GenericJson => collect_generic_json_events(source.provider, &source.path),
        SourceFormat::GenericJsonl => collect_generic_jsonl_events(source.provider, &source.path),
    }
}

fn collect_codex_sqlite_events(path: &PathBuf) -> Result<Vec<TokenEvent>, String> {
    let conn = open_readonly(path).map_err(|error| error.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT ts, feedback_log_body FROM logs
             WHERE target = 'codex_core::session::turn'
               AND feedback_log_body LIKE '%total_usage_tokens=%'
               AND feedback_log_body NOT LIKE '%ToolCall:%'
             ORDER BY ts ASC
             LIMIT 100000",
        )
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;
    let mut by_turn: HashMap<String, TokenEvent> = HashMap::new();
    for row in rows.flatten() {
        let (ts, body) = row;
        let Some(turn_id) = extract_after(&body, "turn_id=") else {
            continue;
        };
        let Some(tokens) =
            extract_after(&body, "total_usage_tokens=").and_then(|value| value.parse::<i64>().ok())
        else {
            continue;
        };
        let model = extract_after(&body, "model=").unwrap_or_else(|| "unknown".to_string());
        let source_id = format!("sqlite:{turn_id}");
        let current = by_turn
            .get(&source_id)
            .map(|event| event.tokens)
            .unwrap_or(-1);
        if tokens > current {
            by_turn.insert(
                source_id.clone(),
                TokenEvent {
                    provider: "codex".to_string(),
                    source_id,
                    ts,
                    date: local_day(ts),
                    model,
                    tokens,
                    source_path: path.clone(),
                },
            );
        }
    }
    Ok(by_turn.into_values().collect())
}

fn collect_codex_jsonl_events(path: &PathBuf) -> Result<Vec<TokenEvent>, String> {
    let file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut events = Vec::new();
    for (index, line) in BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .enumerate()
    {
        if !line.contains("token_count") && !line.contains("last_token_usage") {
            continue;
        }
        let Ok(json) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let Some(payload) = json.get("payload") else {
            continue;
        };
        if payload.get("type").and_then(Value::as_str) != Some("token_count") {
            continue;
        }
        let Some(tokens) = payload
            .pointer("/info/last_token_usage/total_tokens")
            .and_then(number_value_as_i64)
            .or_else(|| {
                payload
                    .pointer("/info/total_token_usage/total_tokens")
                    .and_then(number_value_as_i64)
            })
        else {
            continue;
        };
        let ts = json
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(parse_timestamp)
            .unwrap_or_else(|| file_modified_ts(path));
        let model = payload
            .pointer("/info/model")
            .and_then(Value::as_str)
            .unwrap_or("codex")
            .to_string();
        events.push(TokenEvent {
            provider: "codex".to_string(),
            source_id: format!("jsonl:{}:{index}", path.display()),
            ts,
            date: local_day(ts),
            model,
            tokens,
            source_path: path.clone(),
        });
    }
    Ok(events)
}

fn collect_claude_jsonl_events(path: &PathBuf) -> Result<Vec<TokenEvent>, String> {
    let file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut events = Vec::new();
    for (index, line) in BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .enumerate()
    {
        if !line.contains("\"usage\"") {
            continue;
        }
        let Ok(json) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let Some(usage) = json.pointer("/message/usage") else {
            continue;
        };
        let Some(tokens) = tokens_from_usage_value(usage) else {
            continue;
        };
        let ts = json
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(parse_timestamp)
            .unwrap_or_else(|| file_modified_ts(path));
        let model = json
            .pointer("/message/model")
            .and_then(Value::as_str)
            .unwrap_or("claude")
            .to_string();
        let source_id = json
            .pointer("/message/id")
            .and_then(Value::as_str)
            .map(|id| format!("message:{id}"))
            .unwrap_or_else(|| format!("jsonl:{}:{index}", path.display()));
        events.push(TokenEvent {
            provider: "claude".to_string(),
            source_id,
            ts,
            date: local_day(ts),
            model,
            tokens,
            source_path: path.clone(),
        });
    }
    Ok(events)
}

fn collect_generic_json_events(provider: &str, path: &PathBuf) -> Result<Vec<TokenEvent>, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() > 10 * 1024 * 1024 {
        return Ok(Vec::new());
    }
    let body = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let Ok(json) = serde_json::from_str::<Value>(&body) else {
        return Ok(Vec::new());
    };
    let mut events = Vec::new();
    collect_json_usage_values(
        provider,
        path,
        "$",
        &json,
        file_modified_ts(path),
        &mut events,
    );
    Ok(events)
}

fn collect_generic_jsonl_events(provider: &str, path: &PathBuf) -> Result<Vec<TokenEvent>, String> {
    let file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut events = Vec::new();
    for (index, line) in BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .enumerate()
    {
        if !line.to_ascii_lowercase().contains("token") {
            continue;
        }
        let Ok(json) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let ts = json_timestamp(&json).unwrap_or_else(|| file_modified_ts(path));
        collect_json_usage_values(
            provider,
            path,
            &format!("line-{index}"),
            &json,
            ts,
            &mut events,
        );
    }
    Ok(events)
}

fn collect_json_usage_values(
    provider: &str,
    path: &PathBuf,
    pointer: &str,
    value: &Value,
    inherited_ts: i64,
    events: &mut Vec<TokenEvent>,
) {
    if let Some(tokens) = tokens_from_usage_value(value) {
        let ts = json_timestamp(value).unwrap_or(inherited_ts);
        let model = value
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or(provider)
            .to_string();
        events.push(TokenEvent {
            provider: provider.to_string(),
            source_id: format!("json:{}:{pointer}", path.display()),
            ts,
            date: local_day(ts),
            model,
            tokens,
            source_path: path.clone(),
        });
        return;
    }
    match value {
        Value::Object(map) => {
            let ts = json_timestamp(value).unwrap_or(inherited_ts);
            for (key, child) in map {
                collect_json_usage_values(
                    provider,
                    path,
                    &format!("{pointer}/{key}"),
                    child,
                    ts,
                    events,
                );
            }
        }
        Value::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                collect_json_usage_values(
                    provider,
                    path,
                    &format!("{pointer}/{index}"),
                    child,
                    inherited_ts,
                    events,
                );
            }
        }
        _ => {}
    }
}

fn tokens_from_usage_value(value: &Value) -> Option<i64> {
    let object = value.as_object()?;
    for key in [
        "total_tokens",
        "totalTokens",
        "totalTokenCount",
        "total_token_count",
    ] {
        if let Some(tokens) = object.get(key).and_then(number_value_as_i64) {
            return (tokens > 0).then_some(tokens);
        }
    }
    let sum: i64 = [
        "input_tokens",
        "output_tokens",
        "cache_creation_input_tokens",
        "cache_read_input_tokens",
        "promptTokenCount",
        "candidatesTokenCount",
        "thoughtsTokenCount",
        "cachedContentTokenCount",
        "prompt_token_count",
        "candidates_token_count",
        "thoughts_token_count",
        "cached_content_token_count",
    ]
    .into_iter()
    .filter_map(|key| object.get(key).and_then(number_value_as_i64))
    .sum();
    (sum > 0).then_some(sum)
}

fn json_timestamp(value: &Value) -> Option<i64> {
    for key in ["timestamp", "created_at", "createdAt", "time"] {
        if let Some(ts) = value
            .get(key)
            .and_then(Value::as_str)
            .and_then(parse_timestamp)
        {
            return Some(ts);
        }
        if let Some(ts) = value.get(key).and_then(number_value_as_i64) {
            return Some(if ts > 10_000_000_000 { ts / 1000 } else { ts });
        }
    }
    None
}

fn number_value_as_i64(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|number| i64::try_from(number).ok()))
        .or_else(|| value.as_f64().map(|number| number.round() as i64))
}

fn file_modified_ts(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_else(|| Local::now().timestamp())
}

fn upsert_token_events(conn: &mut Connection, events: &[TokenEvent]) -> rusqlite::Result<()> {
    if events.is_empty() {
        return Ok(());
    }
    let tx = conn.transaction()?;
    for event in events {
        tx.execute(
            "INSERT INTO token_events
             (provider, source_id, ts, date, model, tokens, source_path, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(provider, source_id) DO UPDATE SET
                ts = CASE WHEN excluded.tokens >= token_events.tokens THEN excluded.ts ELSE token_events.ts END,
                date = CASE WHEN excluded.tokens >= token_events.tokens THEN excluded.date ELSE token_events.date END,
                model = CASE WHEN excluded.tokens >= token_events.tokens THEN excluded.model ELSE token_events.model END,
                tokens = MAX(token_events.tokens, excluded.tokens),
                source_path = excluded.source_path,
                updated_at = excluded.updated_at",
            params![
                event.provider,
                event.source_id,
                event.ts,
                event.date,
                event.model,
                event.tokens,
                display_path(&event.source_path),
                Local::now().timestamp()
            ],
        )?;
    }
    tx.commit()
}

fn collect_cached_daily(conn: &Connection, provider: Option<&str>, days: i64) -> Vec<DailyUsage> {
    let since = local_day(Local::now().timestamp() - days * 86400);
    let sql = if provider.is_some() {
        "SELECT date, COALESCE(SUM(tokens), 0), COUNT(*)
         FROM token_events
         WHERE provider = ?1 AND date >= ?2
         GROUP BY date
         ORDER BY date ASC"
    } else {
        "SELECT date, COALESCE(SUM(tokens), 0), COUNT(*)
         FROM token_events
         WHERE date >= ?1
         GROUP BY date
         ORDER BY date ASC"
    };
    let Ok(mut stmt) = conn.prepare(sql) else {
        return Vec::new();
    };
    if let Some(provider) = provider {
        stmt.query_map(params![provider, since], |row| {
            Ok(DailyUsage {
                date: row.get(0)?,
                tokens: row.get(1)?,
                turns: row.get(2)?,
                models: BTreeMap::new(),
            })
        })
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
    } else {
        stmt.query_map(params![since], |row| {
            Ok(DailyUsage {
                date: row.get(0)?,
                tokens: row.get(1)?,
                turns: row.get(2)?,
                models: BTreeMap::new(),
            })
        })
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
    }
}

fn collect_latest_quota_snapshot(log_db: Option<&PathBuf>) -> Option<QuotaSnapshot> {
    let sqlite = log_db.and_then(collect_sqlite_quota_snapshot);
    let jsonl = collect_session_quota_snapshot();
    match (sqlite, jsonl) {
        (Some(left), Some(right)) => Some(if left.observed_at >= right.observed_at {
            left
        } else {
            right
        }),
        (Some(snapshot), None) | (None, Some(snapshot)) => Some(snapshot),
        (None, None) => None,
    }
}

fn quota_meta_from_snapshot(snapshot: &QuotaSnapshot, now: i64) -> QuotaMeta {
    let age_seconds = (now - snapshot.observed_at).max(0);
    QuotaMeta {
        source: snapshot.source.clone(),
        source_path: Some(display_path(&snapshot.source_path)),
        observed_at: Some(snapshot.observed_at),
        age_seconds: Some(age_seconds),
        stale: age_seconds > 10 * 60,
    }
}

fn collect_sqlite_quota_snapshot(path: &PathBuf) -> Option<QuotaSnapshot> {
    let Ok(conn) = open_readonly(path) else {
        return None;
    };
    let Ok(mut stmt) = conn.prepare(
        "SELECT ts, feedback_log_body FROM logs
         WHERE feedback_log_body LIKE '%rate_limits%'
         ORDER BY ts DESC, ts_nanos DESC
         LIMIT 200",
    ) else {
        return None;
    };
    let Ok(mut rows) = stmt.query([]) else {
        return None;
    };
    let mut latest: Option<QuotaSnapshot> = None;
    while let Ok(Some(row)) = rows.next() {
        let ts: i64 = row.get(0).unwrap_or(0);
        let body: String = row.get(1).unwrap_or_default();
        let quotas = quotas_from_message(&body, ts);
        if !quotas.is_empty() {
            let snapshot = QuotaSnapshot {
                source: "sqlite".to_string(),
                source_path: path.clone(),
                observed_at: ts,
                quotas,
            };
            if latest
                .as_ref()
                .map(|current| snapshot.observed_at > current.observed_at)
                .unwrap_or(true)
            {
                latest = Some(snapshot);
            }
        }
    }
    latest
}

fn quotas_from_message(body: &str, ts: i64) -> Vec<Quota> {
    let Some(start) = body.find('{') else {
        return Vec::new();
    };
    let Ok(json) = serde_json::from_str::<Value>(&body[start..]) else {
        return Vec::new();
    };
    let Some(rate_limits) = json.get("rate_limits") else {
        return Vec::new();
    };
    let mut quotas = normalize_rate_limits(
        rate_limits,
        ts,
        json.get("plan_type").and_then(Value::as_str),
    );
    append_additional_limits(
        &mut quotas,
        json.get("additional_rate_limits"),
        ts,
        json.get("plan_type")
            .and_then(Value::as_str)
            .unwrap_or("unknown"),
    );
    quotas
}

fn collect_session_quota_snapshot() -> Option<QuotaSnapshot> {
    let mut files = Vec::new();
    for session_dir in codex_session_roots() {
        collect_jsonl_files(&session_dir, &mut files);
    }
    for path in config::read_config().usage_paths.paths_for("codex") {
        let expanded = config::expand_user_path(&path);
        if expanded.is_dir() {
            collect_jsonl_files(&expanded, &mut files);
        } else if expanded.extension().and_then(|value| value.to_str()) == Some("jsonl") {
            files.push(expanded);
        }
    }
    files.sort_by_key(|path| {
        fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .ok()
    });
    files.reverse();

    let mut latest: Option<QuotaSnapshot> = None;
    for path in files.into_iter().take(80) {
        let Ok(file) = fs::File::open(&path) else {
            continue;
        };
        for line in BufReader::new(file).lines().map_while(Result::ok) {
            if !line.contains("\"rate_limits\"") {
                continue;
            }
            let Some((observed_at, quotas)) = quotas_from_session_line(&line) else {
                continue;
            };
            if !quotas.is_empty() {
                let snapshot = QuotaSnapshot {
                    source: "jsonl".to_string(),
                    source_path: path.clone(),
                    observed_at,
                    quotas,
                };
                if latest
                    .as_ref()
                    .map(|current| snapshot.observed_at > current.observed_at)
                    .unwrap_or(true)
                {
                    latest = Some(snapshot);
                }
            }
        }
    }
    latest
}

fn collect_jsonl_files(dir: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl_files(&path, files);
        } else if path.extension().and_then(|value| value.to_str()) == Some("jsonl") {
            files.push(path);
        }
    }
}

fn quotas_from_session_line(line: &str) -> Option<(i64, Vec<Quota>)> {
    let json = serde_json::from_str::<Value>(line).ok()?;
    let rate_limits = json.pointer("/payload/rate_limits")?;
    let observed_at = json
        .get("timestamp")
        .and_then(Value::as_str)
        .and_then(parse_timestamp)
        .unwrap_or_else(|| Local::now().timestamp());
    let quotas = normalize_rate_limits(
        rate_limits,
        observed_at,
        rate_limits.get("plan_type").and_then(Value::as_str),
    );
    Some((observed_at, quotas))
}

fn parse_timestamp(value: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|timestamp| timestamp.timestamp())
}

fn normalize_rate_limits(rate_limits: &Value, ts: i64, plan_type: Option<&str>) -> Vec<Quota> {
    let plan_type = plan_type.unwrap_or("unknown").to_string();
    let mut quotas = Vec::new();
    if let Some(primary) = rate_limits.get("primary") {
        quotas.push(normalize_limit("5시간", "primary", primary, ts, &plan_type));
    }
    if let Some(secondary) = rate_limits.get("secondary") {
        quotas.push(normalize_limit(
            "1주",
            "secondary",
            secondary,
            ts,
            &plan_type,
        ));
    }
    append_additional_limits(
        &mut quotas,
        rate_limits.get("additional_rate_limits"),
        ts,
        &plan_type,
    );
    quotas
}

fn append_additional_limits(
    quotas: &mut Vec<Quota>,
    additional: Option<&Value>,
    ts: i64,
    plan_type: &str,
) {
    if let Some(additional) = additional.and_then(Value::as_object) {
        for (name, value) in additional {
            if let Some(primary) = value.get("primary") {
                quotas.push(normalize_limit(name, "model", primary, ts, plan_type));
            }
        }
    }
}

fn normalize_limit(
    label: &str,
    kind: &str,
    value: &Value,
    observed_at: i64,
    plan_type: &str,
) -> Quota {
    let used_percent = number_as_i64(value.get("used_percent")).unwrap_or(0);
    let reset_at =
        number_as_i64(value.get("reset_at")).or_else(|| number_as_i64(value.get("resets_at")));
    Quota {
        label: label.to_string(),
        kind: kind.to_string(),
        plan_type: plan_type.to_string(),
        used_percent,
        remaining_percent: (100 - used_percent).max(0),
        window_minutes: value.get("window_minutes").and_then(Value::as_i64),
        reset_at,
        reset_after_seconds: reset_at.map(|reset| (reset - observed_at).max(0)),
        limit_reached: value
            .get("limit_reached")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        allowed: value
            .get("allowed")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        observed_at,
    }
}

fn number_as_i64(value: Option<&Value>) -> Option<i64> {
    value.and_then(|value| {
        value
            .as_i64()
            .or_else(|| value.as_f64().map(|number| number.round() as i64))
    })
}

fn collect_threads(path: &PathBuf) -> (i64, i64, Vec<ThreadUsage>) {
    let Ok(conn) = open_readonly(path) else {
        return (0, 0, Vec::new());
    };
    let (total, count) = conn
        .query_row(
            "SELECT COALESCE(SUM(tokens_used), 0), COUNT(*) FROM threads WHERE model_provider = 'openai'",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .unwrap_or((0, 0));

    let Ok(mut stmt) = conn.prepare(
        "SELECT id, title, model, tokens_used, updated_at
         FROM threads
         WHERE model_provider = 'openai'
         ORDER BY updated_at DESC
         LIMIT 8",
    ) else {
        return (total, count, Vec::new());
    };
    let threads = stmt
        .query_map([], |row| {
            Ok(ThreadUsage {
                id: row.get(0)?,
                title: row
                    .get::<_, Option<String>>(1)?
                    .unwrap_or_else(|| "Untitled".to_string()),
                model: row
                    .get::<_, Option<String>>(2)?
                    .unwrap_or_else(|| "unknown".to_string()),
                tokens: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default();
    (total, count, threads)
}

fn collect_goals(path: &PathBuf) -> Vec<GoalUsage> {
    let Ok(conn) = open_readonly(path) else {
        return Vec::new();
    };
    let Ok(mut stmt) = conn.prepare(
        "SELECT thread_id, objective, status, tokens_used, token_budget, updated_at_ms
         FROM thread_goals
         WHERE status IN ('active', 'paused', 'usage_limited', 'budget_limited')
         ORDER BY updated_at_ms DESC
         LIMIT 6",
    ) else {
        return Vec::new();
    };
    stmt.query_map([], |row| {
        let tokens_used = row.get::<_, i64>(3)?;
        let token_budget = row.get::<_, Option<i64>>(4)?;
        Ok(GoalUsage {
            thread_id: row.get(0)?,
            objective: row.get(1)?,
            status: row.get(2)?,
            tokens_used,
            token_budget,
            remaining_tokens: token_budget.map(|budget| (budget - tokens_used).max(0)),
            updated_at: row.get::<_, i64>(5)? / 1000,
        })
    })
    .map(|rows| rows.flatten().collect())
    .unwrap_or_default()
}

fn open_readonly(path: &PathBuf) -> rusqlite::Result<Connection> {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
}

fn extract_after(body: &str, marker: &str) -> Option<String> {
    let start = body.find(marker)? + marker.len();
    let value = body[start..]
        .split(|ch: char| ch.is_whitespace() || ch == '}' || ch == ',')
        .next()?
        .trim_matches('"')
        .to_string();
    (!value.is_empty()).then_some(value)
}

fn first_existing(paths: &[PathBuf]) -> Option<PathBuf> {
    paths.iter().find(|path| path.exists()).cloned()
}

fn home_path(relative: &str) -> PathBuf {
    home_dir().join(relative)
}

fn display_path(path: &PathBuf) -> String {
    let home = home_dir();
    let value = path.display().to_string();
    let home = home.display().to_string();
    if home == "." {
        value
    } else {
        value.replace(&home, "~")
    }
}

fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn local_day(ts: i64) -> String {
    Local
        .timestamp_opt(ts, 0)
        .single()
        .unwrap_or_else(Local::now)
        .format("%Y-%m-%d")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn extract_after_stops_at_common_log_delimiters() {
        assert_eq!(
            extract_after(
                r#"turn.id=abc model="gpt-5.4", total_usage_tokens=12345}"#,
                "model=",
            ),
            Some("gpt-5.4".to_string()),
        );
        assert_eq!(
            extract_after(
                "total_usage_tokens=12345 token_limit_reached=false",
                "total_usage_tokens="
            ),
            Some("12345".to_string()),
        );
        assert_eq!(extract_after("no marker", "total_usage_tokens="), None);
    }

    #[test]
    fn quotas_from_rate_limit_message_reports_remaining_windows() {
        let body = r#"Received message {"type":"codex.rate_limits","plan_type":"prolite","rate_limits":{"primary":{"used_percent":5,"window_minutes":300,"reset_at":2000,"limit_reached":false,"allowed":true},"secondary":{"used_percent":31,"window_minutes":10080,"reset_at":9000,"limit_reached":false,"allowed":true}},"additional_rate_limits":{"GPT-5.3-Codex-Spark":{"primary":{"used_percent":0,"window_minutes":300,"reset_at":2100,"limit_reached":false,"allowed":true}}}}"#;

        let quotas = quotas_from_message(body, 1000);

        assert_eq!(quotas.len(), 3);
        assert_eq!(quotas[0].label, "5시간");
        assert_eq!(quotas[0].kind, "primary");
        assert_eq!(quotas[0].plan_type, "prolite");
        assert_eq!(quotas[0].remaining_percent, 95);
        assert_eq!(quotas[0].reset_after_seconds, Some(1000));
        assert_eq!(quotas[1].label, "1주");
        assert_eq!(quotas[1].remaining_percent, 69);
        assert_eq!(quotas[2].kind, "model");
        assert_eq!(quotas[2].label, "GPT-5.3-Codex-Spark");
    }

    #[test]
    fn quotas_from_rate_limit_message_accepts_traced_prefixes() {
        let body = r#"session_loop:receiving_stream:handle_responses: Received message {"type":"codex.rate_limits","plan_type":"pro","rate_limits":{"primary":{"used_percent":14,"window_minutes":300,"reset_at":2200,"limit_reached":false,"allowed":true},"secondary":{"used_percent":21,"window_minutes":10080,"reset_at":9200,"limit_reached":false,"allowed":true}}}"#;

        let quotas = quotas_from_message(body, 1000);

        assert_eq!(quotas.len(), 2);
        assert_eq!(quotas[0].label, "5시간");
        assert_eq!(quotas[0].remaining_percent, 86);
        assert_eq!(quotas[1].label, "1주");
        assert_eq!(quotas[1].remaining_percent, 79);
    }

    #[test]
    fn quotas_from_session_token_count_reads_jsonl_rate_limits() {
        let line = r#"{"timestamp":"2026-07-07T12:25:07.229Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"total_tokens":100}},"rate_limits":{"limit_id":"codex","primary":{"used_percent":20.0,"window_minutes":300,"resets_at":1783442607},"secondary":{"used_percent":34.0,"window_minutes":10080,"resets_at":1783994776},"plan_type":"prolite"}}}"#;

        let (observed_at, quotas) = quotas_from_session_line(line).expect("session quota line");

        assert_eq!(observed_at, 1783427107);
        assert_eq!(quotas.len(), 2);
        assert_eq!(quotas[0].label, "5시간");
        assert_eq!(quotas[0].remaining_percent, 80);
        assert_eq!(quotas[0].reset_at, Some(1783442607));
        assert_eq!(quotas[0].reset_after_seconds, Some(15500));
        assert_eq!(quotas[1].label, "1주");
        assert_eq!(quotas[1].remaining_percent, 66);
        assert_eq!(quotas[1].plan_type, "prolite");
    }

    #[test]
    fn collect_daily_keeps_highest_seen_total_for_each_turn() {
        let db_path = temp_db_path("agentwatch-usage-daily");
        {
            let conn = Connection::open(&db_path).expect("open temp usage db");
            conn.execute_batch(
                "CREATE TABLE logs (ts INTEGER, target TEXT, feedback_log_body TEXT);
                 INSERT INTO logs VALUES
                   (1700000000, 'codex_core::session::turn', 'turn.id=aaa turn_id=turn-a model=gpt-5.4 total_usage_tokens=100 estimated_token_count=Some(99)'),
                   (1700000001, 'codex_core::session::turn', 'turn.id=aaa turn_id=turn-a model=gpt-5.4 total_usage_tokens=250 estimated_token_count=Some(240)'),
                   (1700000002, 'codex_core::session::turn', 'turn.id=bbb turn_id=turn-b model=gpt-5.4-mini total_usage_tokens=75 estimated_token_count=Some(70)'),
                   (1700000003, 'codex_core::session::turn', 'ToolCall: turn_id=tool total_usage_tokens=999 model=gpt-5.4');",
            )
            .expect("seed usage logs");
        }

        let daily = collect_daily(&db_path, 0);
        let _ = fs::remove_file(&db_path);

        assert_eq!(daily.len(), 1);
        assert_eq!(daily[0].tokens, 325);
        assert_eq!(daily[0].turns, 2);
        assert_eq!(daily[0].models.get("gpt-5.4"), Some(&250));
        assert_eq!(daily[0].models.get("gpt-5.4-mini"), Some(&75));
    }

    #[test]
    fn token_usage_parser_sums_claude_and_gemini_shapes() {
        let claude = serde_json::json!({
            "input_tokens": 10,
            "cache_creation_input_tokens": 20,
            "cache_read_input_tokens": 30,
            "output_tokens": 40
        });
        let gemini = serde_json::json!({
            "promptTokenCount": 11,
            "candidatesTokenCount": 22,
            "thoughtsTokenCount": 33,
            "cachedContentTokenCount": 44
        });
        let total = serde_json::json!({ "totalTokenCount": 123 });

        assert_eq!(tokens_from_usage_value(&claude), Some(100));
        assert_eq!(tokens_from_usage_value(&gemini), Some(110));
        assert_eq!(tokens_from_usage_value(&total), Some(123));
    }

    #[test]
    fn collect_claude_jsonl_reads_message_usage() {
        let path = temp_db_path("agentwatch-claude-usage-jsonl").with_extension("jsonl");
        fs::write(
            &path,
            r#"{"timestamp":"2026-07-10T12:00:00Z","message":{"id":"msg_1","model":"claude-opus","usage":{"input_tokens":5,"cache_creation_input_tokens":7,"cache_read_input_tokens":11,"output_tokens":13}}}"#,
        )
        .expect("write temp claude jsonl");

        let events = collect_claude_jsonl_events(&path).expect("collect claude usage");
        let _ = fs::remove_file(&path);

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].provider, "claude");
        assert_eq!(events[0].source_id, "message:msg_1");
        assert_eq!(events[0].model, "claude-opus");
        assert_eq!(events[0].tokens, 36);
        assert_eq!(events[0].date, "2026-07-10");
    }

    #[test]
    fn collect_goals_reports_remaining_budget_when_present() {
        let db_path = temp_db_path("agentwatch-usage-goals");
        {
            let conn = Connection::open(&db_path).expect("open temp goals db");
            conn.execute_batch(
                "CREATE TABLE thread_goals (
                    thread_id TEXT,
                    objective TEXT,
                    status TEXT,
                    tokens_used INTEGER,
                    token_budget INTEGER,
                    updated_at_ms INTEGER
                 );
                 INSERT INTO thread_goals VALUES
                   ('thread-a', 'watch agents', 'active', 1200, 5000, 1700000000123),
                   ('thread-b', 'done work', 'complete', 100, 200, 1700000000999);",
            )
            .expect("seed goals");
        }

        let goals = collect_goals(&db_path);
        let _ = fs::remove_file(&db_path);

        assert_eq!(goals.len(), 1);
        assert_eq!(goals[0].thread_id, "thread-a");
        assert_eq!(goals[0].tokens_used, 1200);
        assert_eq!(goals[0].token_budget, Some(5000));
        assert_eq!(goals[0].remaining_tokens, Some(3800));
        assert_eq!(goals[0].updated_at, 1700000000);
    }

    fn temp_db_path(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        std::env::temp_dir().join(format!("{label}-{nanos}.sqlite3"))
    }
}
