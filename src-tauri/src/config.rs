use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::{rngs::OsRng, RngCore};
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
    pub db_type: String,
}

fn default_db_type() -> String {
    "postgres".to_string()
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub workspaces: Vec<WorkspaceConfig>,
}

pub fn config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("basedly")
        .join("config.json")
}

fn key_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("basedly")
        .join(".key")
}

fn load_or_create_key() -> [u8; 32] {
    let path = key_path();
    if let Ok(bytes) = fs::read(&path) {
        if bytes.len() == 32 {
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            return key;
        }
    }
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&path, key);
    key
}

const ENC_PREFIX: &str = "enc:v1:";

fn encrypt_str(plaintext: &str) -> String {
    if plaintext.starts_with(ENC_PREFIX) {
        return plaintext.to_string();
    }
    let key_bytes = load_or_create_key();
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    match cipher.encrypt(nonce, plaintext.as_bytes()) {
        Ok(ciphertext) => {
            let mut combined = nonce_bytes.to_vec();
            combined.extend_from_slice(&ciphertext);
            format!("{}{}", ENC_PREFIX, BASE64.encode(&combined))
        }
        Err(_) => plaintext.to_string(),
    }
}

fn decrypt_str(encrypted: &str) -> String {
    if !encrypted.starts_with(ENC_PREFIX) {
        return encrypted.to_string();
    }
    let encoded = &encrypted[ENC_PREFIX.len()..];
    let combined = match BASE64.decode(encoded) {
        Ok(b) => b,
        Err(_) => return encrypted.to_string(),
    };
    if combined.len() < 13 {
        return encrypted.to_string();
    }
    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let key_bytes = load_or_create_key();
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(nonce_bytes);
    match cipher.decrypt(nonce, ciphertext) {
        Ok(plain) => String::from_utf8(plain).unwrap_or_else(|_| encrypted.to_string()),
        Err(_) => encrypted.to_string(),
    }
}

pub fn load_config() -> AppConfig {
    let path = config_path();
    let mut config = fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<AppConfig>(&s).ok())
        .unwrap_or_default();
    for ws in &mut config.workspaces {
        ws.connection_string = decrypt_str(&ws.connection_string);
    }
    config
}

pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut to_save = config.clone();
    for ws in &mut to_save.workspaces {
        ws.connection_string = encrypt_str(&ws.connection_string);
    }
    let data = serde_json::to_string_pretty(&to_save).map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| e.to_string())
}

pub fn mask_connection_string(conn_str: &str) -> String {
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
