mod config;
mod db;

use db::{TableInfo, TablePage};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

pub struct AppState {
    pub db_manager: Arc<db::DbManager>,
    pub app_config: Mutex<config::AppConfig>,
    pub mcp_server: Mutex<Option<std::process::Child>>,
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

// ── Entry point ────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState {
        db_manager: Arc::new(db::DbManager::new()),
        app_config: Mutex::new(config::load_config()),
        mcp_server: Mutex::new(None),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .setup(|app| {
            // Locate mcp/dist/index.js
            // CARGO_MANIFEST_DIR is src-tauri/ at compile time; project root is one level up.
            let project_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap_or(std::path::Path::new("."));
            let mcp_script = app
                .path()
                .resource_dir()
                .ok()
                .map(|d| d.join("mcp").join("dist").join("index.js"))
                .filter(|p| p.exists())
                .unwrap_or_else(|| project_root.join("mcp").join("dist").join("index.js"));

            if mcp_script.exists() {
                match std::process::Command::new("node")
                    .arg(&mcp_script)
                    .spawn()
                {
                    Ok(child) => {
                        let s = app.state::<AppState>();
                        *s.mcp_server.lock().unwrap() = Some(child);
                        eprintln!("[basedly] MCP server → http://localhost:3456/mcp");
                    }
                    Err(e) => eprintln!("[basedly] MCP server failed to start: {e}"),
                }
            } else {
                eprintln!("[basedly] MCP script not found at {}, skipping", mcp_script.display());
            }

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
        ])
        .build(tauri::generate_context!())
        .expect("error while building Basedly")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                let s = app_handle.state::<AppState>();
                if let Ok(mut guard) = s.mcp_server.lock() {
                    if let Some(mut child) = guard.take() {
                        let _ = child.kill();
                    }
                };
            }
        });
}
