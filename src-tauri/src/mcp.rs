use axum::{
    extract::State,
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    response::IntoResponse,
    routing::any,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

use crate::db::{self, DbManager};
use crate::AppState;

#[derive(Clone)]
pub struct McpState {
    pub db: Arc<DbManager>,
    pub app_handle: AppHandle,
    pub current_agent: Arc<Mutex<String>>,
}

pub async fn start(state: McpState, port: u16) {
    let app = Router::new()
        .route("/mcp", any(handle_mcp))
        .with_state(state);

    let addr = format!("127.0.0.1:{}", port);
    match tokio::net::TcpListener::bind(&addr).await {
        Ok(listener) => {
            eprintln!("[basedly] MCP server → http://{}/mcp", addr);
            if let Err(e) = axum::serve(listener, app).await {
                eprintln!("[basedly] MCP server crashed: {e}");
            }
        }
        Err(e) => eprintln!("[basedly] MCP server failed to bind {addr}: {e}"),
    }
}

async fn handle_mcp(
    State(state): State<McpState>,
    method: Method,
    body: Option<Json<Value>>,
) -> impl IntoResponse {
    let cors = cors_headers();

    if method == Method::OPTIONS {
        return (StatusCode::NO_CONTENT, cors, Json(Value::Null)).into_response();
    }

    if method == Method::GET {
        // no server-initiated SSE here, events go to the frontend via Tauri emit()
        return (StatusCode::METHOD_NOT_ALLOWED, cors, Json(Value::Null)).into_response();
    }

    let req: JsonRpcRequest = match body.map(|Json(v)| serde_json::from_value(v)) {
        Some(Ok(r)) => r,
        Some(Err(e)) => {
            return (
                StatusCode::OK,
                cors,
                Json(serde_json::to_value(error_response(None, -32700, format!("Parse error: {e}"))).unwrap()),
            )
                .into_response();
        }
        None => {
            return (
                StatusCode::OK,
                cors,
                Json(serde_json::to_value(error_response(None, -32600, "Empty body".into())).unwrap()),
            )
                .into_response();
        }
    };

    let response = dispatch(state, req).await;
    (StatusCode::OK, cors, Json(serde_json::to_value(response).unwrap())).into_response()
}

fn cors_headers() -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert("Access-Control-Allow-Origin", HeaderValue::from_static("*"));
    h.insert(
        "Access-Control-Allow-Methods",
        HeaderValue::from_static("GET, POST, OPTIONS"),
    );
    h.insert(
        "Access-Control-Allow-Headers",
        HeaderValue::from_static("Content-Type, Mcp-Session-Id"),
    );
    h.insert(
        "Mcp-Session-Id",
        HeaderValue::from_static("basedly-local-session"),
    );
    h
}

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    #[allow(dead_code)]
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    jsonrpc: &'static str,
    id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
struct JsonRpcError {
    code: i32,
    message: String,
}

fn error_response(id: Option<Value>, code: i32, message: String) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0",
        id,
        result: None,
        error: Some(JsonRpcError { code, message }),
    }
}

fn ok_response(id: Option<Value>, result: Value) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0",
        id,
        result: Some(result),
        error: None,
    }
}

async fn dispatch(state: McpState, req: JsonRpcRequest) -> JsonRpcResponse {
    let id = req.id.clone();

    match req.method.as_str() {
        "initialize" => {
            if let Some(name) = req
                .params
                .get("clientInfo")
                .and_then(|c| c.get("name"))
                .and_then(|n| n.as_str())
            {
                *state.current_agent.lock().unwrap() = format_agent(name);
            }
            ok_response(
                id,
                json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "basedly", "version": "1.0.0" }
                }),
            )
        }

        "tools/list" => ok_response(id, json!({ "tools": tool_definitions() })),

        "tools/call" => {
            let name = req.params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let args = req.params.get("arguments").cloned().unwrap_or(json!({}));
            match dispatch_tool(&state, name, args).await {
                Ok(content_text) => ok_response(
                    id,
                    json!({ "content": [{ "type": "text", "text": content_text }] }),
                ),
                Err(e) => ok_response(
                    id,
                    json!({
                        "content": [{ "type": "text", "text": format!("Error: {}", e) }],
                        "isError": true,
                    }),
                ),
            }
        }

        m if m.starts_with("notifications/") => ok_response(id, json!({})),

        _ => error_response(id, -32601, format!("Method not found: {}", req.method)),
    }
}

fn tool_definitions() -> Value {
    json!([
        {
            "name": "describe_app",
            "description": "Returns a description of Basedly and how to use this MCP server. Call this first to orient yourself.",
            "inputSchema": { "type": "object", "properties": {}, "required": [] }
        },
        {
            "name": "list_workspaces",
            "description": "List all database connections saved in Basedly.",
            "inputSchema": { "type": "object", "properties": {}, "required": [] }
        },
        {
            "name": "get_schema",
            "description": "Get the full schema for a workspace: tables, columns, types, nullability, PKs, and row counts.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspace_id": { "type": "string", "description": "Workspace ID from list_workspaces" }
                },
                "required": ["workspace_id"]
            }
        },
        {
            "name": "query_table",
            "description": "Fetch rows from a table with optional sorting and pagination.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspace_id": { "type": "string" },
                    "table_name": { "type": "string" },
                    "limit": { "type": "number", "description": "Max rows (default 100, max 1000)" },
                    "offset": { "type": "number", "description": "Row offset (default 0)" },
                    "sort_col": { "type": "string" },
                    "sort_asc": { "type": "boolean" }
                },
                "required": ["workspace_id", "table_name"]
            }
        },
        {
            "name": "execute_sql",
            "description": "Execute any SQL against a workspace database.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspace_id": { "type": "string" },
                    "sql": { "type": "string" }
                },
                "required": ["workspace_id", "sql"]
            }
        },
        {
            "name": "update_row",
            "description": "Update a single cell identified by primary key.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspace_id": { "type": "string" },
                    "table_name": { "type": "string" },
                    "pk_col": { "type": "string" },
                    "pk_val": { "type": "string" },
                    "column": { "type": "string" },
                    "value": { "type": "string" }
                },
                "required": ["workspace_id", "table_name", "pk_col", "pk_val", "column", "value"]
            }
        },
        {
            "name": "delete_row",
            "description": "Delete a row by its primary key.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workspace_id": { "type": "string" },
                    "table_name": { "type": "string" },
                    "pk_col": { "type": "string" },
                    "pk_val": { "type": "string" }
                },
                "required": ["workspace_id", "table_name", "pk_col", "pk_val"]
            }
        }
    ])
}

async fn dispatch_tool(state: &McpState, name: &str, args: Value) -> Result<String, String> {
    match name {
        "describe_app" => Ok(describe_app_text().to_string()),
        "list_workspaces" => list_workspaces(state).await,
        "get_schema" => get_schema_tool(state, args).await,
        "query_table" => query_table_tool(state, args).await,
        "execute_sql" => execute_sql_tool(state, args).await,
        "update_row" => update_row_tool(state, args).await,
        "delete_row" => delete_row_tool(state, args).await,
        _ => Err(format!("Unknown tool: {}", name)),
    }
}

fn describe_app_text() -> &'static str {
    "# Basedly\n\
     \n\
     Basedly is a desktop database GUI (Tauri + Rust + React) for PostgreSQL and SQLite.\n\
     \n\
     ## Tools\n\
     - **list_workspaces** - see all saved connections\n\
     - **get_schema** - inspect tables and columns\n\
     - **query_table** - paginate/sort rows\n\
     - **execute_sql** - run arbitrary SQL\n\
     - **update_row** - update a single cell by PK\n\
     - **delete_row** - delete a row by PK"
}

async fn list_workspaces(state: &McpState) -> Result<String, String> {
    let app_state = state.app_handle.state::<AppState>();
    let cfg = app_state.app_config.lock().map_err(|e| e.to_string())?;
    let list: Vec<Value> = cfg
        .workspaces
        .iter()
        .map(|w| {
            json!({
                "id": w.id,
                "name": w.name,
                "db_type": w.db_type,
                "connection_hint": w.connection_hint,
                "color": w.color,
            })
        })
        .collect();
    serde_json::to_string_pretty(&list).map_err(|e| e.to_string())
}

async fn get_schema_tool(state: &McpState, args: Value) -> Result<String, String> {
    let ws_id = str_arg(&args, "workspace_id")?;
    ensure_connected(state, &ws_id).await?;
    let schema = state.db.get_schema(&ws_id).await?;
    serde_json::to_string_pretty(&schema).map_err(|e| e.to_string())
}

async fn query_table_tool(state: &McpState, args: Value) -> Result<String, String> {
    let ws_id = str_arg(&args, "workspace_id")?;
    let table = str_arg(&args, "table_name")?;
    let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(100).min(1000);
    let offset = args.get("offset").and_then(|v| v.as_i64()).unwrap_or(0);
    let sort_col = args.get("sort_col").and_then(|v| v.as_str()).map(|s| s.to_string());
    let sort_asc = args.get("sort_asc").and_then(|v| v.as_bool()).unwrap_or(true);

    ensure_connected(state, &ws_id).await?;
    let page = state
        .db
        .query_table(&ws_id, &table, offset, limit, sort_col.as_deref(), sort_asc)
        .await?;
    let returned = page.rows.len();

    broadcast(
        state,
        McpEvent {
            event_type: "select",
            workspace_id: &ws_id,
            table_name: Some(&table),
            summary: format!("Queried `{}` · {} of {} rows", table, returned, page.total_count),
            undo_sql: None,
        },
    );

    let body = json!({
        "rows": page.rows,
        "total_count": page.total_count,
        "returned": returned,
        "offset": offset,
        "limit": limit,
    });
    serde_json::to_string_pretty(&body).map_err(|e| e.to_string())
}

async fn execute_sql_tool(state: &McpState, args: Value) -> Result<String, String> {
    let ws_id = str_arg(&args, "workspace_id")?;
    let sql = str_arg(&args, "sql")?;

    ensure_connected(state, &ws_id).await?;

    let event_type = classify_sql(&sql);
    let table = extract_table_name(&sql);
    let undo_sql = build_undo_sql(state, &ws_id, &sql, event_type, table.as_deref()).await;

    let rows = state.db.execute_query(&ws_id, &sql).await?;

    let summary = match event_type {
        "select" => format!("Queried `{}` · {} rows", table.as_deref().unwrap_or("?"), rows.len()),
        "insert" => format!("Inserted into `{}`", table.as_deref().unwrap_or("?")),
        "update" => format!("Updated `{}`", table.as_deref().unwrap_or("?")),
        "delete" => format!("Deleted from `{}`", table.as_deref().unwrap_or("?")),
        "ddl"    => format!("DDL on `{}`", table.as_deref().unwrap_or("database")),
        _        => "Executed SQL".to_string(),
    };

    broadcast(
        state,
        McpEvent {
            event_type,
            workspace_id: &ws_id,
            table_name: table.as_deref(),
            summary,
            undo_sql: undo_sql.as_deref(),
        },
    );

    let body = json!({
        "rows": rows,
        "row_count": rows.len(),
    });
    serde_json::to_string_pretty(&body).map_err(|e| e.to_string())
}

async fn update_row_tool(state: &McpState, args: Value) -> Result<String, String> {
    let ws_id = str_arg(&args, "workspace_id")?;
    let table = str_arg(&args, "table_name")?;
    let pk_col = str_arg(&args, "pk_col")?;
    let pk_val = str_arg(&args, "pk_val")?;
    let col = str_arg(&args, "column")?;
    let val = str_arg(&args, "value")?;

    ensure_connected(state, &ws_id).await?;

    // capture old value for undo
    let old_row = state
        .db
        .fetch_row_by_column(&ws_id, &table, &pk_col, &pk_val)
        .await?
        .unwrap_or_default();
    let old_val = old_row.get(&col).cloned().unwrap_or(Value::Null);

    let undo_sql = format!(
        r#"UPDATE "{}" SET "{}" = {} WHERE "{}" = {}"#,
        table,
        col,
        sql_literal(&old_val),
        pk_col,
        sql_literal(&Value::String(pk_val.clone())),
    );

    state
        .db
        .update_row(
            &ws_id,
            &table,
            &pk_col,
            &pk_val,
            &col,
            &Value::String(val.clone()),
            "text",
        )
        .await?;

    broadcast(
        state,
        McpEvent {
            event_type: "update",
            workspace_id: &ws_id,
            table_name: Some(&table),
            summary: format!(
                "Updated `{}` in {} · row {}\n{} → {}",
                col,
                table,
                pk_val,
                value_to_str(&old_val),
                val
            ),
            undo_sql: Some(&undo_sql),
        },
    );

    Ok("Row updated successfully.".to_string())
}

async fn delete_row_tool(state: &McpState, args: Value) -> Result<String, String> {
    let ws_id = str_arg(&args, "workspace_id")?;
    let table = str_arg(&args, "table_name")?;
    let pk_col = str_arg(&args, "pk_col")?;
    let pk_val = str_arg(&args, "pk_val")?;

    ensure_connected(state, &ws_id).await?;

    let old_row = state
        .db
        .fetch_row_by_column(&ws_id, &table, &pk_col, &pk_val)
        .await?;

    let is_pg = workspace_is_pg(state, &ws_id)?;
    let undo_sql = old_row.as_ref().map(|row| build_insert_undo(&table, row, &pk_col, is_pg));

    state.db.delete_row(&ws_id, &table, &pk_col, &pk_val).await?;

    broadcast(
        state,
        McpEvent {
            event_type: "delete",
            workspace_id: &ws_id,
            table_name: Some(&table),
            summary: format!("Deleted row {} from `{}`", pk_val, table),
            undo_sql: undo_sql.as_deref(),
        },
    );

    Ok("Row deleted successfully.".to_string())
}

struct McpEvent<'a> {
    event_type: &'static str,
    workspace_id: &'a str,
    table_name: Option<&'a str>,
    summary: String,
    undo_sql: Option<&'a str>,
}

fn broadcast(state: &McpState, event: McpEvent) {
    let agent = state.current_agent.lock().unwrap().clone();
    let payload = json!({
        "type": event.event_type,
        "agent": agent,
        "workspaceId": event.workspace_id,
        "tableName": event.table_name,
        "summary": event.summary,
        "undoSql": event.undo_sql,
        "ts": chrono::Utc::now().timestamp_millis(),
    });
    let _ = state.app_handle.emit("mcp-event", payload);
}

fn str_arg(args: &Value, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("Missing required argument: {}", key))
}

async fn ensure_connected(state: &McpState, workspace_id: &str) -> Result<(), String> {
    if state.db.is_connected(workspace_id) {
        return Ok(());
    }
    let conn_str = {
        let app_state = state.app_handle.state::<AppState>();
        let cfg = app_state.app_config.lock().map_err(|e| e.to_string())?;
        cfg.workspaces
            .iter()
            .find(|w| w.id == workspace_id)
            .map(|w| w.connection_string.clone())
            .ok_or_else(|| {
                format!(
                    "Workspace '{}' not found. Use list_workspaces to see available IDs.",
                    workspace_id
                )
            })?
    };
    state.db.connect(workspace_id, &conn_str).await
}

fn workspace_is_pg(state: &McpState, workspace_id: &str) -> Result<bool, String> {
    let app_state = state.app_handle.state::<AppState>();
    let cfg = app_state.app_config.lock().map_err(|e| e.to_string())?;
    cfg.workspaces
        .iter()
        .find(|w| w.id == workspace_id)
        .map(|w| db::is_postgres(&w.connection_string))
        .ok_or_else(|| format!("Workspace '{}' not found", workspace_id))
}

fn format_agent(raw: &str) -> String {
    let l = raw.to_lowercase();
    if l.contains("claude") { return "Claude".into(); }
    if l.contains("gemini") { return "Gemini".into(); }
    if l.contains("cursor") { return "Cursor".into(); }
    if l.contains("copilot") { return "Copilot".into(); }
    if l.contains("gpt") || l.contains("openai") { return "ChatGPT".into(); }
    if l.contains("windsurf") { return "Windsurf".into(); }
    if l.contains("continue") { return "Continue".into(); }
    if l.contains("cody") { return "Cody".into(); }
    if raw.len() < 24 { raw.to_string() } else { "LLM Agent".into() }
}

fn classify_sql(sql: &str) -> &'static str {
    let u = sql.trim_start().to_uppercase();
    if u.starts_with("SELECT") || u.starts_with("WITH") { "select" }
    else if u.starts_with("INSERT") { "insert" }
    else if u.starts_with("UPDATE") { "update" }
    else if u.starts_with("DELETE") { "delete" }
    else if u.starts_with("CREATE") || u.starts_with("ALTER") || u.starts_with("DROP") || u.starts_with("TRUNCATE") { "ddl" }
    else { "other" }
}

fn extract_table_name(sql: &str) -> Option<String> {
    let upper = sql.to_uppercase();
    for keyword in &["FROM", "INTO", "UPDATE"] {
        let prefix = format!("{} ", keyword);
        let leading = format!(" {} ", keyword);
        let start = if upper.starts_with(&prefix) {
            Some(prefix.len())
        } else {
            upper.find(&leading).map(|i| i + leading.len())
        };
        let Some(start) = start else { continue };
        if start >= sql.len() { continue; }
        let after = sql[start..].trim_start_matches(|c: char| c.is_whitespace() || c == '"');
        let end = after
            .find(|c: char| !c.is_alphanumeric() && c != '_')
            .unwrap_or(after.len());
        if end > 0 {
            return Some(after[..end].to_string());
        }
    }
    None
}

async fn build_undo_sql(
    state: &McpState,
    ws_id: &str,
    sql: &str,
    event_type: &str,
    table: Option<&str>,
) -> Option<String> {
    if event_type == "delete" {
        let table = table?;
        // swap DELETE FROM for SELECT * to capture deleted rows
        let upper = sql.trim_start().to_uppercase();
        if !upper.starts_with("DELETE FROM") { return None; }
        let select_sql = format!("SELECT * FROM {}", &sql.trim_start()[12..]);
        let rows = state.db.execute_query(ws_id, &select_sql).await.ok()?;
        if rows.is_empty() || rows.len() > 500 { return None; }
        let is_pg = workspace_is_pg(state, ws_id).ok()?;
        let cols: Vec<String> = rows[0].keys().cloned().collect();
        let col_list = cols.iter().map(|c| format!(r#""{}""#, c)).collect::<Vec<_>>().join(", ");
        let keyword = if is_pg { "INSERT INTO" } else { "INSERT OR REPLACE INTO" };
        let conflict = if is_pg { " ON CONFLICT DO NOTHING" } else { "" };
        let stmts: Vec<String> = rows
            .iter()
            .map(|row| {
                let vals = cols
                    .iter()
                    .map(|c| sql_literal(row.get(c).unwrap_or(&Value::Null)))
                    .collect::<Vec<_>>()
                    .join(", ");
                format!(
                    r#"{} "{}" ({}) VALUES ({}){};"#,
                    keyword, table, col_list, vals, conflict
                )
            })
            .collect();
        return Some(stmts.join("\n"));
    }
    None
}

fn build_insert_undo(
    table: &str,
    row: &HashMap<String, Value>,
    pk_col: &str,
    is_pg: bool,
) -> String {
    let cols: Vec<String> = row.keys().cloned().collect();
    let col_list = cols.iter().map(|c| format!(r#""{}""#, c)).collect::<Vec<_>>().join(", ");
    let vals = cols
        .iter()
        .map(|c| sql_literal(row.get(c).unwrap_or(&Value::Null)))
        .collect::<Vec<_>>()
        .join(", ");
    if is_pg {
        let set_clauses = cols
            .iter()
            .filter(|c| c.as_str() != pk_col)
            .map(|c| format!(r#""{}" = EXCLUDED."{}""#, c, c))
            .collect::<Vec<_>>()
            .join(", ");
        format!(
            r#"INSERT INTO "{}" ({}) VALUES ({}) ON CONFLICT ("{}") DO UPDATE SET {}"#,
            table, col_list, vals, pk_col, set_clauses
        )
    } else {
        format!(r#"INSERT OR REPLACE INTO "{}" ({}) VALUES ({})"#, table, col_list, vals)
    }
}

fn sql_literal(v: &Value) -> String {
    match v {
        Value::Null => "NULL".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => format!("'{}'", s.replace('\'', "''")),
        other => format!("'{}'", other.to_string().replace('\'', "''")),
    }
}

fn value_to_str(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}
