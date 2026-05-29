mod config;
mod db;
mod mcp;

use db::{TableInfo, TablePage};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

pub struct AppState {
    pub db_manager: Arc<db::DbManager>,
    pub app_config: Mutex<config::AppConfig>,
}

// ── Workspace management ───────────────────────────────────────────────────────

#[tauri::command]
async fn get_workspaces(state: State<'_, AppState>) -> Result<Vec<config::WorkspaceConfig>, String> {
    Ok(state.app_config.lock().map_err(|e| e.to_string())?.workspaces.clone())
}

#[tauri::command]
async fn add_workspace(
    state: State<'_, AppState>,
    name: String,
    connection_string: String,
    color: Option<String>,
) -> Result<config::WorkspaceConfig, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let db_type = if db::is_postgres(&connection_string) {
        "postgres".to_string()
    } else {
        "sqlite".to_string()
    };
    let hint = config::mask_connection_string(&connection_string);

    let workspace = config::WorkspaceConfig {
        id: id.clone(),
        name,
        color,
        connection_hint: hint,
        connection_string,
        db_type,
    };

    let mut cfg = state.app_config.lock().map_err(|e| e.to_string())?;
    cfg.workspaces.push(workspace.clone());
    config::save_config(&cfg)?;
    Ok(workspace)
}

#[tauri::command]
async fn delete_workspace(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<(), String> {
    state.db_manager.disconnect(&workspace_id);
    let mut cfg = state.app_config.lock().map_err(|e| e.to_string())?;
    cfg.workspaces.retain(|w| w.id != workspace_id);
    config::save_config(&cfg)
}

#[tauri::command]
async fn connect_workspace(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<(), String> {
    let conn_str = state
        .app_config
        .lock()
        .map_err(|e| e.to_string())?
        .workspaces
        .iter()
        .find(|w| w.id == workspace_id)
        .map(|w| w.connection_string.clone())
        .ok_or_else(|| format!("Workspace '{}' not found", workspace_id))?;
    state.db_manager.connect(&workspace_id, &conn_str).await?;
    if !db::is_postgres(&conn_str) {
        state.db_manager.start_sqlite_watch(&workspace_id, &conn_str, app);
    }
    Ok(())
}

#[tauri::command]
async fn disconnect_workspace(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<(), String> {
    state.db_manager.disconnect(&workspace_id);
    Ok(())
}

#[tauri::command]
async fn is_connected(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<bool, String> {
    Ok(state.db_manager.is_connected(&workspace_id))
}

// ── Schema & data ──────────────────────────────────────────────────────────────

#[tauri::command]
async fn get_schema(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<TableInfo>, String> {
    state.db_manager.get_schema(&workspace_id).await
}

#[tauri::command]
async fn query_table(
    state: State<'_, AppState>,
    workspace_id: String,
    table_name: String,
    offset: i64,
    limit: i64,
    sort_col: Option<String>,
    sort_asc: bool,
) -> Result<TablePage, String> {
    state
        .db_manager
        .query_table(&workspace_id, &table_name, offset, limit, sort_col.as_deref(), sort_asc)
        .await
}

#[tauri::command]
async fn update_row(
    state: State<'_, AppState>,
    workspace_id: String,
    table_name: String,
    pk_col: String,
    pk_val: String,
    update_col: String,
    update_val: Value,
    col_type: String,
) -> Result<(), String> {
    state
        .db_manager
        .update_row(&workspace_id, &table_name, &pk_col, &pk_val, &update_col, &update_val, &col_type)
        .await
}

#[tauri::command]
async fn delete_row(
    state: State<'_, AppState>,
    workspace_id: String,
    table_name: String,
    pk_col: String,
    pk_val: String,
) -> Result<(), String> {
    state
        .db_manager
        .delete_row(&workspace_id, &table_name, &pk_col, &pk_val)
        .await
}

#[tauri::command]
async fn execute_query(
    state: State<'_, AppState>,
    workspace_id: String,
    sql: String,
) -> Result<Vec<HashMap<String, Value>>, String> {
    state.db_manager.execute_query(&workspace_id, &sql).await
}

#[tauri::command]
async fn test_connection(connection_string: String) -> Result<(), String> {
    db::test_connection(&connection_string).await
}

#[tauri::command]
async fn fetch_row_by_column(
    state: State<'_, AppState>,
    workspace_id: String,
    table_name: String,
    column_name: String,
    column_value: String,
) -> Result<Option<HashMap<String, Value>>, String> {
    state.db_manager
        .fetch_row_by_column(&workspace_id, &table_name, &column_name, &column_value)
        .await
}

// ── MCP server management ─────────────────────────────────────────────────────

#[tauri::command]
async fn run_mcp_list(cli: String) -> Result<String, String> {
    #[cfg(windows)]
    let output = std::process::Command::new("cmd")
        .args(["/c", &cli, "mcp", "list"])
        .output()
        .map_err(|e| format!("{} CLI not found: {}", cli, e))?;

    #[cfg(not(windows))]
    let output = std::process::Command::new(&cli)
        .args(["mcp", "list"])
        .output()
        .map_err(|e| format!("{} CLI not found: {}", cli, e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    Ok(stdout + &stderr)
}

#[tauri::command]
async fn run_mcp_add(cli: String, name: String, url: String) -> Result<String, String> {
    #[cfg(windows)]
    let output = std::process::Command::new("cmd")
        .args(["/c", &cli, "mcp", "add", "--transport", "http", &name, &url])
        .output()
        .map_err(|e| format!("{} CLI not found: {}", cli, e))?;

    #[cfg(not(windows))]
    let output = std::process::Command::new(&cli)
        .args(["mcp", "add", "--transport", "http", &name, &url])
        .output()
        .map_err(|e| format!("{} CLI not found: {}", cli, e))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(if stdout.is_empty() { "Added successfully".to_string() } else { stdout })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(if !stderr.is_empty() { stderr } else if !stdout.is_empty() { stdout } else { "Command failed".to_string() })
    }
}

// ── File picker for SQLite ─────────────────────────────────────────────────────

#[tauri::command]
fn pick_sqlite_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let result = app
        .dialog()
        .file()
        .add_filter("SQLite Database", &["db", "sqlite", "sqlite3"])
        .blocking_pick_file();
    Ok(result.map(|p| p.to_string()))
}

#[tauri::command]
async fn save_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

// ── Entry point ────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState {
        db_manager: Arc::new(db::DbManager::new()),
        app_config: Mutex::new(config::load_config()),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .setup(|app| {
            let mcp_state = mcp::McpState {
                db: app.state::<AppState>().db_manager.clone(),
                app_handle: app.handle().clone(),
                current_agent: Arc::new(Mutex::new("LLM Agent".to_string())),
            };
            tauri::async_runtime::spawn(mcp::start(mcp_state, 8453));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_workspaces,
            add_workspace,
            delete_workspace,
            connect_workspace,
            disconnect_workspace,
            is_connected,
            get_schema,
            query_table,
            update_row,
            delete_row,
            execute_query,
            test_connection,
            pick_sqlite_file,
            fetch_row_by_column,
            save_file,
            run_mcp_add,
            run_mcp_list,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Basedly");
}
