use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceConfig {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub connection_hint: String,
    pub connection_string: String,
    #[serde(default = "default_db_type")]
    pub db_type: String, // "postgres" | "sqlite"
}

fn default_db_type() -> String {
    "postgres".to_string()
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct AppConfig {
    pub workspaces: Vec<WorkspaceConfig>,
}

pub fn config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("basedly")
        .join("config.json")
}

pub fn load_config() -> AppConfig {
    let path = config_path();
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| e.to_string())
}

pub fn mask_connection_string(conn_str: &str) -> String {
    // postgres://user:PASSWORD@host:port/db  →  postgres://user:****@host:port/db
    let scheme_end = conn_str.find("://").map(|i| i + 3).unwrap_or(0);
    if let Some(at_pos) = conn_str[scheme_end..].find('@') {
        let at_abs = scheme_end + at_pos;
        if let Some(colon_pos) = conn_str[scheme_end..at_abs].rfind(':') {
            let colon_abs = scheme_end + colon_pos;
            return format!("{}:****{}", &conn_str[..colon_abs], &conn_str[at_abs..]);
        }
    }
    conn_str.to_string()
}
