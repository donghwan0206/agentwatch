use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

const CONFIG_RELATIVE_PATH: &str = ".agentwatch/config.json";

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentWatchConfig {
    pub port: Option<u16>,
    #[serde(default)]
    pub usage_paths: UsagePathConfig,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsagePathConfig {
    #[serde(default)]
    pub codex: Vec<String>,
    #[serde(default)]
    pub claude: Vec<String>,
    #[serde(default)]
    pub gemini: Vec<String>,
}

impl UsagePathConfig {
    pub fn paths_for(&self, provider: &str) -> Vec<String> {
        match provider {
            "codex" => self.codex.clone(),
            "claude" => self.claude.clone(),
            "gemini" => self.gemini.clone(),
            _ => Vec::new(),
        }
    }

    pub fn set_paths_for(&mut self, provider: &str, paths: Vec<String>) -> bool {
        let cleaned = paths
            .into_iter()
            .map(|path| path.trim().to_string())
            .filter(|path| !path.is_empty())
            .collect::<Vec<_>>();
        match provider {
            "codex" => self.codex = cleaned,
            "claude" => self.claude = cleaned,
            "gemini" => self.gemini = cleaned,
            _ => return false,
        }
        true
    }
}

pub fn config_path() -> PathBuf {
    home_dir().join(CONFIG_RELATIVE_PATH)
}

pub fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn read_config() -> AgentWatchConfig {
    let path = config_path();
    let Ok(contents) = fs::read_to_string(path) else {
        return AgentWatchConfig::default();
    };
    serde_json::from_str(&contents).unwrap_or_default()
}

pub fn write_config(config: &AgentWatchConfig) -> std::io::Result<()> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let body = serde_json::to_string_pretty(config)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    fs::write(path, format!("{body}\n"))
}

pub fn config_path_display() -> String {
    let path = config_path();
    let home = home_dir();
    path.strip_prefix(&home)
        .ok()
        .map(|relative| format!("~/{}", relative.display()))
        .unwrap_or_else(|| path.display().to_string())
}

pub fn expand_user_path(value: &str) -> PathBuf {
    let trimmed = value.trim();
    if trimmed == "~" {
        return home_dir();
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        return home_dir().join(rest);
    }
    PathBuf::from(trimmed)
}
