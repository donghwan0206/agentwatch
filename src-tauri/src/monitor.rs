use chrono::Local;
use serde::Serialize;
use std::{
    collections::BTreeMap,
    net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket},
    sync::{Arc, OnceLock, RwLock},
};
use sysinfo::{Pid, Process, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

#[derive(Clone)]
struct AgentRule {
    key: &'static str,
    name: &'static str,
    accent: &'static str,
    patterns: &'static [&'static str],
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub timestamp: i64,
    pub hostname: String,
    pub local_ips: Vec<String>,
    pub activity: Activity,
    pub providers: Vec<Provider>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub score: i64,
    pub status: String,
    pub active_process_count: usize,
    pub total_cpu: f32,
    pub total_memory: f32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub key: String,
    pub name: String,
    pub accent: String,
    pub status: String,
    pub process_count: usize,
    pub cpu: f32,
    pub memory: f32,
    pub processes: Vec<ProcessRow>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessRow {
    pub pid: String,
    pub cpu: f32,
    pub memory: f32,
    pub elapsed: String,
    pub command: String,
}

pub type SharedSnapshot = Arc<RwLock<Option<Snapshot>>>;

pub struct Sampler {
    system: System,
}

const RULES: &[AgentRule] = &[
    AgentRule {
        key: "openclaw",
        name: "OpenClaw",
        accent: "#f59e0b",
        patterns: &["openclaw", "open-claw", "openclo"],
    },
    AgentRule {
        key: "hermes",
        name: "Hermes",
        accent: "#ef4444",
        patterns: &["hermes"],
    },
    AgentRule {
        key: "codex",
        name: "OpenAI Codex",
        accent: "#10a37f",
        patterns: &["codex", "@openai/codex", "@openai/codex-cli"],
    },
    AgentRule {
        key: "claude",
        name: "Claude Code",
        accent: "#c15f3c",
        patterns: &["claude", "anthropic"],
    },
    AgentRule {
        key: "gemini",
        name: "Gemini CLI",
        accent: "#4f7cff",
        patterns: &["gemini", "@google/gemini-cli", "gemini-cli"],
    },
    AgentRule {
        key: "chatgpt",
        name: "ChatGPT",
        accent: "#22b8cf",
        patterns: &["chatgpt"],
    },
    AgentRule {
        key: "opencode",
        name: "OpenCode",
        accent: "#8b5cf6",
        patterns: &["opencode", "open-code"],
    },
    AgentRule {
        key: "aider",
        name: "Aider",
        accent: "#14b8a6",
        patterns: &["aider --", "aider-chat", " -m aider", "/aider", "\\aider"],
    },
    AgentRule {
        key: "goose",
        name: "Goose",
        accent: "#f97316",
        patterns: &[
            "@block/goose",
            "goose run",
            "goose --",
            "goose.exe",
            "/goose",
            "\\goose",
        ],
    },
    AgentRule {
        key: "cursor-agent",
        name: "Cursor Agent",
        accent: "#facc15",
        patterns: &["cursor-agent", "cursor agent", "cursor --agent"],
    },
    AgentRule {
        key: "qwen-code",
        name: "Qwen Code",
        accent: "#06b6d4",
        patterns: &["qwen-code", "@qwen-code/qwen-code", "qwen code"],
    },
    AgentRule {
        key: "ollama",
        name: "Ollama",
        accent: "#111827",
        patterns: &["ollama"],
    },
    AgentRule {
        key: "lmstudio",
        name: "LM Studio",
        accent: "#ec4899",
        patterns: &["lm studio", "lm-studio", "lmstudio"],
    },
    AgentRule {
        key: "llamacpp",
        name: "llama.cpp",
        accent: "#84cc16",
        patterns: &["llama.cpp", "llama-server", "llama-cli"],
    },
];

impl Sampler {
    pub fn new() -> Self {
        let mut system = System::new();
        system.refresh_memory();
        system.refresh_processes_specifics(ProcessesToUpdate::All, true, process_refresh_kind());
        Self { system }
    }

    pub fn snapshot(&mut self) -> Snapshot {
        self.system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            process_refresh_kind(),
        );
        snapshot_from_system(&self.system)
    }
}

fn process_refresh_kind() -> ProcessRefreshKind {
    ProcessRefreshKind::nothing()
        .with_cpu()
        .with_memory()
        .with_cmd(UpdateKind::OnlyIfNotSet)
}

pub fn fast_snapshot() -> Snapshot {
    let mut sampler = Sampler::new();
    sampler.snapshot()
}

fn snapshot_from_system(system: &System) -> Snapshot {
    let total_memory = system.total_memory().max(1) as f32;
    let mut providers = empty_providers();
    for (pid, process) in system.processes() {
        if let Some(rule) = detect_provider(process) {
            let provider = providers.get_mut(rule.key).expect("provider exists");
            let cpu = round1(process.cpu_usage());
            let memory = round1((process.memory() as f32 / total_memory) * 100.0);
            provider.process_count += 1;
            provider.cpu = round1(provider.cpu + cpu);
            provider.memory = round1(provider.memory + memory);
            provider.processes.push(ProcessRow {
                pid: pid_to_string(*pid),
                cpu,
                memory,
                elapsed: format_elapsed(process.run_time()),
                command: sanitize_command(&command_line(process)),
            });
        }
    }

    let mut visible: Vec<Provider> = providers.into_values().collect();
    for provider in &mut visible {
        provider.processes.sort_by(|a, b| b.cpu.total_cmp(&a.cpu));
        provider.status = provider_status(provider).to_string();
    }
    visible.sort_by(|a, b| {
        (a.status == "offline")
            .cmp(&(b.status == "offline"))
            .then_with(|| b.cpu.total_cmp(&a.cpu))
            .then_with(|| a.name.cmp(&b.name))
    });

    let total_cpu = round1(visible.iter().map(|p| p.cpu).sum());
    let total_memory = round1(visible.iter().map(|p| p.memory).sum());
    let active_process_count = visible.iter().map(|p| p.process_count).sum();
    let score = ((total_cpu * 1.8) as i64 + active_process_count as i64 * 8).min(100);

    Snapshot {
        timestamp: Local::now().timestamp(),
        hostname: hostname(),
        local_ips: local_ips(),
        activity: Activity {
            score,
            status: activity_status(score, active_process_count).to_string(),
            active_process_count,
            total_cpu,
            total_memory,
        },
        providers: visible,
    }
}

fn empty_providers() -> BTreeMap<&'static str, Provider> {
    RULES
        .iter()
        .map(|rule| {
            (
                rule.key,
                Provider {
                    key: rule.key.to_string(),
                    name: rule.name.to_string(),
                    accent: rule.accent.to_string(),
                    status: "offline".to_string(),
                    process_count: 0,
                    cpu: 0.0,
                    memory: 0.0,
                    processes: Vec::new(),
                },
            )
        })
        .collect()
}

fn detect_provider(process: &Process) -> Option<&'static AgentRule> {
    let haystack = format!(
        "{} {}",
        process.name().to_string_lossy(),
        process
            .cmd()
            .iter()
            .map(|part| part.to_string_lossy())
            .collect::<Vec<_>>()
            .join(" ")
    )
    .to_lowercase();
    detect_rule_in_lowercase(&haystack)
}

#[cfg(test)]
fn detect_rule_in_text(value: &str) -> Option<&'static AgentRule> {
    let haystack = value.to_lowercase();
    detect_rule_in_lowercase(&haystack)
}

fn detect_rule_in_lowercase(haystack: &str) -> Option<&'static AgentRule> {
    RULES.iter().find(|rule| {
        rule.patterns
            .iter()
            .any(|pattern| haystack.contains(pattern))
    })
}

fn command_line(process: &Process) -> String {
    let cmd = process
        .cmd()
        .iter()
        .map(|part| part.to_string_lossy())
        .collect::<Vec<_>>()
        .join(" ");
    if cmd.trim().is_empty() {
        process.name().to_string_lossy().to_string()
    } else {
        cmd
    }
}

fn sanitize_command(value: &str) -> String {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    sanitize_command_with_home(value, home.as_str())
}

fn sanitize_command_with_home(value: &str, home: &str) -> String {
    let mut safe = if home.is_empty() {
        value.to_string()
    } else {
        value.replace(&home, "~")
    };
    for marker in [
        "api_key=",
        "token=",
        "secret=",
        "password=",
        "authorization=",
        "bearer=",
    ] {
        safe = redact_marker(&safe, marker);
    }
    let compact = safe.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.len() > 220 {
        format!("{}...", &compact[..217])
    } else {
        compact
    }
}

fn redact_marker(value: &str, marker: &str) -> String {
    let mut out = Vec::new();
    for part in value.split_whitespace() {
        if part.to_lowercase().starts_with(marker) {
            let key = part.split_once('=').map(|(key, _)| key).unwrap_or(marker);
            out.push(format!("{key}=<redacted>"));
        } else {
            out.push(part.to_string());
        }
    }
    out.join(" ")
}

fn provider_status(provider: &Provider) -> &'static str {
    if provider.process_count == 0 {
        "offline"
    } else if provider.cpu >= 15.0 {
        "busy"
    } else if provider.cpu >= 1.0 {
        "active"
    } else {
        "idle"
    }
}

fn activity_status(score: i64, active_count: usize) -> &'static str {
    if active_count == 0 {
        "quiet"
    } else if score >= 55 {
        "busy"
    } else if score >= 18 {
        "active"
    } else {
        "idle"
    }
}

fn hostname() -> String {
    static HOSTNAME: OnceLock<String> = OnceLock::new();
    HOSTNAME.get_or_init(detect_hostname).clone()
}

fn detect_hostname() -> String {
    std::env::var("HOSTNAME")
        .ok()
        .filter(|value| !value.is_empty())
        .or_else(|| {
            std::process::Command::new("hostname")
                .output()
                .ok()
                .and_then(|out| String::from_utf8(out.stdout).ok())
                .map(|value| value.trim().to_string())
        })
        .unwrap_or_else(|| "localhost".to_string())
}

fn local_ips() -> Vec<String> {
    let mut ips = Vec::new();
    if let Ok(sock) = UdpSocket::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 0)) {
        let _ = sock.connect("8.8.8.8:80");
        if let Ok(addr) = sock.local_addr() {
            if let IpAddr::V4(ip) = addr.ip() {
                if !ip.is_loopback() {
                    ips.push(ip.to_string());
                }
            }
        }
    }
    ips.sort();
    ips.dedup();
    ips
}

fn pid_to_string(pid: Pid) -> String {
    pid.as_u32().to_string()
}

fn format_elapsed(seconds: u64) -> String {
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    let secs = seconds % 60;
    if hours > 0 {
        format!("{hours:02}:{minutes:02}:{secs:02}")
    } else {
        format!("{minutes:02}:{secs:02}")
    }
}

fn round1(value: f32) -> f32 {
    (value * 10.0).round() / 10.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_supported_agent_patterns() {
        let cases = [
            ("node /usr/bin/openclaw", "openclaw"),
            ("open-claw worker", "openclaw"),
            ("python -m hermes daemon", "hermes"),
            ("npx @openai/codex-cli", "codex"),
            ("codex --model gpt-5.4", "codex"),
            ("claude --continue", "claude"),
            ("node @google/gemini-cli", "gemini"),
            ("ChatGPT Helper", "chatgpt"),
            ("opencode run", "opencode"),
            ("open-code serve", "opencode"),
            ("python -m aider --model sonnet", "aider"),
            ("npx @block/goose run", "goose"),
            ("cursor-agent --workspace .", "cursor-agent"),
            ("npx @qwen-code/qwen-code", "qwen-code"),
            ("ollama serve", "ollama"),
            ("LM Studio Helper", "lmstudio"),
            ("llama-server -m model.gguf", "llamacpp"),
        ];

        for (text, expected_key) in cases {
            let rule = detect_rule_in_text(text).expect("detect agent rule");
            assert_eq!(rule.key, expected_key, "{text}");
        }
    }

    #[test]
    fn leaves_unrelated_processes_unmatched() {
        assert!(detect_rule_in_text("postgres server").is_none());
        assert!(detect_rule_in_text("node vite dev server").is_none());
        assert!(detect_rule_in_text("openai embeddings worker").is_none());
        assert!(detect_rule_in_text("node raider worker").is_none());
        assert!(detect_rule_in_text("node mongoose worker").is_none());
    }

    #[test]
    fn sanitizes_command_secrets_and_whitespace() {
        let command = sanitize_command(
            "codex   api_key=sk-test   token=abc123 secret=s1 password=p1 authorization=bearer bearer=raw",
        );

        assert_eq!(
            command,
            "codex api_key=<redacted> token=<redacted> secret=<redacted> password=<redacted> authorization=<redacted> bearer=<redacted>"
        );
    }

    #[test]
    fn sanitizes_userprofile_when_home_is_unset() {
        let command = sanitize_command_with_home(
            "C:\\Users\\green\\project\\codex token=abc123",
            "C:\\Users\\green",
        );

        assert_eq!(command, "~\\project\\codex token=<redacted>");
    }

    #[test]
    fn truncates_long_commands() {
        let command = sanitize_command(&format!("codex {}", "x".repeat(260)));

        assert_eq!(command.len(), 220);
        assert!(command.ends_with("..."));
    }
}
