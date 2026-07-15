use crate::monitor;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::{path::PathBuf, sync::Mutex};

const DEFAULT_RETENTION_DAYS: i64 = 30;
const MIN_RETENTION_DAYS: i64 = 1;
const MAX_RETENTION_DAYS: i64 = 366;
const SECONDS_PER_DAY: i64 = 86_400;

#[derive(Clone, Serialize)]
pub struct HistoryPoint {
    pub ts: i64,
    pub activity_score: i64,
    pub activity_status: String,
    pub active_process_count: usize,
    pub total_cpu: f32,
    pub total_memory: f32,
}

#[derive(Clone, Serialize)]
pub struct EventRow {
    pub ts: i64,
    pub level: String,
    pub provider: String,
    pub message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHistoryPoint {
    pub ts: i64,
    pub provider_key: String,
    pub provider_name: String,
    pub status: String,
    pub process_count: usize,
    pub cpu: f32,
    pub memory: f32,
}

pub struct ActivityLog {
    conn: Mutex<Connection>,
    retention_seconds: i64,
}

impl ActivityLog {
    pub fn open_default() -> rusqlite::Result<Self> {
        let path = default_db_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        Self::open(path)
    }

    pub fn open(path: PathBuf) -> rusqlite::Result<Self> {
        Self::open_with_retention_seconds(path, retention_seconds_from_env())
    }

    fn open_with_retention_seconds(
        path: PathBuf,
        retention_seconds: i64,
    ) -> rusqlite::Result<Self> {
        let conn = Connection::open(&path)?;
        init_schema(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
            retention_seconds,
        })
    }

    pub fn record_snapshot(&self, snapshot: &monitor::Snapshot) -> rusqlite::Result<()> {
        let point = history_point(snapshot);
        let mut conn = self.conn.lock().expect("activity log lock");
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO snapshots
             (ts, activity_score, activity_status, active_process_count, total_cpu, total_memory)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                point.ts,
                point.activity_score,
                point.activity_status,
                point.active_process_count as i64,
                point.total_cpu,
                point.total_memory
            ],
        )?;
        for provider in snapshot
            .providers
            .iter()
            .filter(|provider| provider.process_count > 0)
        {
            tx.execute(
                "INSERT INTO provider_snapshots
                 (ts, provider_key, provider_name, status, process_count, cpu, memory)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    snapshot.timestamp,
                    &provider.key,
                    &provider.name,
                    &provider.status,
                    provider.process_count as i64,
                    provider.cpu,
                    provider.memory
                ],
            )?;
        }
        let cutoff = snapshot.timestamp - self.retention_seconds;
        tx.execute("DELETE FROM snapshots WHERE ts < ?1", [cutoff])?;
        tx.execute("DELETE FROM provider_snapshots WHERE ts < ?1", [cutoff])?;
        tx.execute("DELETE FROM events WHERE ts < ?1", [cutoff])?;
        tx.commit()?;
        Ok(())
    }

    pub fn record_event(&self, event: &EventRow) -> rusqlite::Result<()> {
        let conn = self.conn.lock().expect("activity log lock");
        conn.execute(
            "INSERT INTO events (ts, level, provider, message) VALUES (?1, ?2, ?3, ?4)",
            params![event.ts, event.level, event.provider, event.message],
        )?;
        Ok(())
    }

    pub fn history_since(&self, since: i64) -> rusqlite::Result<Vec<HistoryPoint>> {
        let conn = self.conn.lock().expect("activity log lock");
        let mut stmt = conn.prepare(
            "SELECT ts, activity_score, activity_status, active_process_count, total_cpu, total_memory
             FROM snapshots
             WHERE ts >= ?1
             ORDER BY ts ASC
             LIMIT 20000",
        )?;
        let rows = stmt.query_map([since], |row| {
            Ok(HistoryPoint {
                ts: row.get(0)?,
                activity_score: row.get(1)?,
                activity_status: row.get(2)?,
                active_process_count: row.get::<_, i64>(3)? as usize,
                total_cpu: row.get(4)?,
                total_memory: row.get(5)?,
            })
        })?;
        Ok(rows.flatten().collect())
    }

    pub fn events(&self, limit: usize) -> rusqlite::Result<Vec<EventRow>> {
        let conn = self.conn.lock().expect("activity log lock");
        let mut stmt = conn.prepare(
            "SELECT ts, level, provider, message
             FROM events
             ORDER BY ts DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map([limit as i64], |row| {
            Ok(EventRow {
                ts: row.get(0)?,
                level: row.get(1)?,
                provider: row.get(2)?,
                message: row.get(3)?,
            })
        })?;
        Ok(rows.flatten().collect())
    }

    pub fn provider_history_since(
        &self,
        since: i64,
        limit: usize,
    ) -> rusqlite::Result<Vec<ProviderHistoryPoint>> {
        let conn = self.conn.lock().expect("activity log lock");
        let mut stmt = conn.prepare(
            "SELECT ts, provider_key, provider_name, status, process_count, cpu, memory
             FROM provider_snapshots
             WHERE ts >= ?1
             ORDER BY ts ASC, provider_key ASC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![since, limit as i64], |row| {
            Ok(ProviderHistoryPoint {
                ts: row.get(0)?,
                provider_key: row.get(1)?,
                provider_name: row.get(2)?,
                status: row.get(3)?,
                process_count: row.get::<_, i64>(4)? as usize,
                cpu: row.get(5)?,
                memory: row.get(6)?,
            })
        })?;
        Ok(rows.flatten().collect())
    }
}

pub fn history_point(snapshot: &monitor::Snapshot) -> HistoryPoint {
    HistoryPoint {
        ts: snapshot.timestamp,
        activity_score: snapshot.activity.score,
        activity_status: snapshot.activity.status.clone(),
        active_process_count: snapshot.activity.active_process_count,
        total_cpu: snapshot.activity.total_cpu,
        total_memory: snapshot.activity.total_memory,
    }
}

fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts INTEGER NOT NULL,
            activity_score INTEGER NOT NULL,
            activity_status TEXT NOT NULL,
            active_process_count INTEGER NOT NULL,
            total_cpu REAL NOT NULL,
            total_memory REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_snapshots_ts ON snapshots(ts);
        CREATE TABLE IF NOT EXISTS provider_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts INTEGER NOT NULL,
            provider_key TEXT NOT NULL,
            provider_name TEXT NOT NULL,
            status TEXT NOT NULL,
            process_count INTEGER NOT NULL,
            cpu REAL NOT NULL,
            memory REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_provider_snapshots_ts
            ON provider_snapshots(ts, provider_key);
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts INTEGER NOT NULL,
            level TEXT NOT NULL,
            provider TEXT NOT NULL,
            message TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
        ",
    )
}

fn default_db_path() -> PathBuf {
    if let Ok(value) = std::env::var("AGENTWATCH_DB") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home)
        .join(".agentwatch")
        .join("agentwatch.sqlite3")
}

fn retention_seconds_from_env() -> i64 {
    let days = std::env::var("AGENTWATCH_RETENTION_DAYS")
        .ok()
        .and_then(|value| value.trim().parse::<i64>().ok())
        .unwrap_or(DEFAULT_RETENTION_DAYS)
        .clamp(MIN_RETENTION_DAYS, MAX_RETENTION_DAYS);
    days * SECONDS_PER_DAY
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::monitor::{Activity, ProcessRow, Provider, Snapshot};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEMP_DB_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn records_history_and_events() {
        let path = temp_db_path();
        let log = ActivityLog::open(path.clone()).expect("open activity log");
        log.record_snapshot(&snapshot_at(90))
            .expect("record snapshot");
        log.record_event(&EventRow {
            ts: 100,
            level: "info".to_string(),
            provider: "Codex".to_string(),
            message: "Codex changed from idle to active".to_string(),
        })
        .expect("record event");

        let event_rows = log.events(10).expect("read events");
        assert_eq!(event_rows.len(), 1);
        assert_eq!(event_rows[0].provider, "Codex");

        let history = log.history_since(80).expect("read history");
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].activity_status, "active");

        let provider_history = log
            .provider_history_since(80, 10)
            .expect("read provider history");
        assert_eq!(provider_history.len(), 1);
        assert_eq!(provider_history[0].provider_key, "codex");
        assert_eq!(provider_history[0].process_count, 1);

        drop(log);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn prunes_old_rows_after_snapshot_record() {
        let path = temp_db_path();
        let log =
            ActivityLog::open_with_retention_seconds(path.clone(), 10).expect("open activity log");

        log.record_snapshot(&snapshot_at(100))
            .expect("record old snapshot");
        log.record_event(&EventRow {
            ts: 100,
            level: "info".to_string(),
            provider: "Codex".to_string(),
            message: "old event".to_string(),
        })
        .expect("record old event");
        log.record_snapshot(&snapshot_at(120))
            .expect("record new snapshot");

        let history = log.history_since(0).expect("read pruned history");
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].ts, 120);

        let provider_history = log
            .provider_history_since(0, 10)
            .expect("read pruned provider history");
        assert_eq!(provider_history.len(), 1);
        assert_eq!(provider_history[0].ts, 120);

        let event_rows = log.events(10).expect("read pruned events");
        assert!(event_rows.is_empty());

        drop(log);
        let _ = std::fs::remove_file(path);
    }

    fn temp_db_path() -> PathBuf {
        std::env::temp_dir().join(format!(
            "agentwatch-test-{}-{}-{}.sqlite3",
            std::process::id(),
            TEMP_DB_COUNTER.fetch_add(1, Ordering::Relaxed),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time")
                .as_nanos()
        ))
    }

    fn snapshot_at(timestamp: i64) -> Snapshot {
        Snapshot {
            timestamp,
            hostname: "agent-host".to_string(),
            local_ips: vec!["192.168.50.93".to_string()],
            activity: Activity {
                score: 30,
                status: "active".to_string(),
                active_process_count: 1,
                total_cpu: 4.2,
                total_memory: 1.1,
            },
            providers: vec![
                Provider {
                    key: "codex".to_string(),
                    name: "OpenAI Codex".to_string(),
                    accent: "#10a37f".to_string(),
                    status: "active".to_string(),
                    process_count: 1,
                    cpu: 4.2,
                    memory: 1.1,
                    processes: vec![ProcessRow {
                        pid: "123".to_string(),
                        cpu: 4.2,
                        memory: 1.1,
                        elapsed: "00:01".to_string(),
                        command: "codex".to_string(),
                    }],
                },
                Provider {
                    key: "gemini".to_string(),
                    name: "Gemini CLI".to_string(),
                    accent: "#4f7cff".to_string(),
                    status: "offline".to_string(),
                    process_count: 0,
                    cpu: 0.0,
                    memory: 0.0,
                    processes: Vec::new(),
                },
            ],
        }
    }
}
