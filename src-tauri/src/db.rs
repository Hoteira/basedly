use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::postgres::{PgPool, PgRow};
use sqlx::sqlite::{SqlitePool, SqliteRow};
use sqlx::{Column, Row, TypeInfo};
use std::collections::HashMap;
use std::sync::Mutex;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForeignKeyInfo {
    pub column_name: String,
    pub foreign_table: String,
    pub foreign_column: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub is_primary_key: bool,
    pub foreign_key: Option<ForeignKeyInfo>,
    pub enum_values: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
    pub columns: Vec<ColumnInfo>,
    pub row_count: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TablePage {
    pub rows: Vec<HashMap<String, Value>>,
    pub total_count: i64,
}

pub enum PoolKind {
    Postgres(PgPool),
    Sqlite(SqlitePool),
}

impl Clone for PoolKind {
    fn clone(&self) -> Self {
        match self {
            PoolKind::Postgres(p) => PoolKind::Postgres(p.clone()),
            PoolKind::Sqlite(p) => PoolKind::Sqlite(p.clone()),
        }
    }
}

pub struct DbManager {
    pools: Mutex<HashMap<String, PoolKind>>,
}

impl DbManager {
    pub fn new() -> Self {
        DbManager {
            pools: Mutex::new(HashMap::new()),
        }
    }

    pub async fn connect(&self, workspace_id: &str, conn_str: &str) -> Result<(), String> {
        let kind = if is_postgres(conn_str) {
            let pool = PgPool::connect(conn_str).await.map_err(|e| e.to_string())?;
            PoolKind::Postgres(pool)
        } else {
            let normalized = normalize_sqlite(conn_str);
            let pool = SqlitePool::connect(&normalized)
                .await
                .map_err(|e| e.to_string())?;
            PoolKind::Sqlite(pool)
        };
        self.pools
            .lock()
            .map_err(|e| e.to_string())?
            .insert(workspace_id.to_string(), kind);
        Ok(())
    }

    pub fn disconnect(&self, workspace_id: &str) {
        if let Ok(mut pools) = self.pools.lock() {
            pools.remove(workspace_id);
        }
    }

    pub fn is_connected(&self, workspace_id: &str) -> bool {
        self.pools
            .lock()
            .map(|p| p.contains_key(workspace_id))
            .unwrap_or(false)
    }

    fn get_kind(&self, workspace_id: &str) -> Result<PoolKind, String> {
        self.pools
            .lock()
            .map_err(|e| e.to_string())?
            .get(workspace_id)
            .cloned()
            .ok_or_else(|| not_connected(workspace_id))
    }

    pub async fn get_schema(&self, workspace_id: &str) -> Result<Vec<TableInfo>, String> {
        match self.get_kind(workspace_id)? {
            PoolKind::Postgres(p) => get_schema_pg(&p).await,
            PoolKind::Sqlite(p) => get_schema_sqlite(&p).await,
        }
    }

    pub async fn query_table(
        &self,
        workspace_id: &str,
        table: &str,
        offset: i64,
        limit: i64,
        sort_col: Option<&str>,
        sort_asc: bool,
    ) -> Result<TablePage, String> {
        match self.get_kind(workspace_id)? {
            PoolKind::Postgres(p) => query_table_pg(&p, table, offset, limit, sort_col, sort_asc).await,
            PoolKind::Sqlite(p) => query_table_sqlite(&p, table, offset, limit, sort_col, sort_asc).await,
        }
    }

    pub async fn update_row(
        &self,
        workspace_id: &str,
        table: &str,
        pk_col: &str,
        pk_val: &str,
        update_col: &str,
        update_val: &Value,
        col_type: &str,
    ) -> Result<(), String> {
        match self.get_kind(workspace_id)? {
            PoolKind::Postgres(p) => update_row_pg(&p, table, pk_col, pk_val, update_col, update_val, col_type).await,
            PoolKind::Sqlite(p) => update_row_sqlite(&p, table, pk_col, pk_val, update_col, update_val).await,
        }
    }

    pub async fn delete_row(
        &self,
        workspace_id: &str,
        table: &str,
        pk_col: &str,
        pk_val: &str,
    ) -> Result<(), String> {
        match self.get_kind(workspace_id)? {
            PoolKind::Postgres(p) => delete_row_pg(&p, table, pk_col, pk_val).await,
            PoolKind::Sqlite(p) => delete_row_sqlite(&p, table, pk_col, pk_val).await,
        }
    }

    pub async fn execute_query(
        &self,
        workspace_id: &str,
        sql: &str,
    ) -> Result<Vec<HashMap<String, Value>>, String> {
        match self.get_kind(workspace_id)? {
            PoolKind::Postgres(p) => exec_pg(&p, sql).await,
            PoolKind::Sqlite(p) => exec_sqlite(&p, sql).await,
        }
    }

    pub async fn fetch_row_by_column(
        &self,
        workspace_id: &str,
        table: &str,
        column: &str,
        value: &str,
    ) -> Result<Option<HashMap<String, Value>>, String> {
        if !is_safe_identifier(table) || !is_safe_identifier(column) {
            return Err("Invalid identifier".into());
        }
        match self.get_kind(workspace_id)? {
            PoolKind::Postgres(p) => {
                let sql = format!(r#"SELECT * FROM "{}" WHERE "{}" = $1 LIMIT 1"#, table, column);
                let rows = sqlx::query(&sql).bind(value).fetch_all(&p).await.map_err(|e| e.to_string())?;
                Ok(rows.first().map(pg_row_to_map))
            }
            PoolKind::Sqlite(p) => {
                let sql = format!(r#"SELECT * FROM "{}" WHERE "{}" = ? LIMIT 1"#, table, column);
                let rows = sqlx::query(&sql).bind(value).fetch_all(&p).await.map_err(|e| e.to_string())?;
                Ok(rows.first().map(sqlite_row_to_map))
            }
        }
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

fn not_connected(id: &str) -> String {
    format!("No active connection for workspace '{}'", id)
}

pub fn is_postgres(conn_str: &str) -> bool {
    conn_str.starts_with("postgres://") || conn_str.starts_with("postgresql://")
}

pub fn normalize_sqlite(path: &str) -> String {
    if path.starts_with("sqlite:") {
        return path.to_string();
    }
    // Windows backslashes → forward slashes, prefix with sqlite:
    let forward = path.replace('\\', "/");
    // On Windows absolute paths look like C:/... — sqlx needs sqlite://C:/...
    if forward.len() >= 2 && forward.chars().nth(1) == Some(':') {
        format!("sqlite:///{}", forward)
    } else {
        format!("sqlite://{}", forward)
    }
}

pub fn is_safe_identifier(s: &str) -> bool {
    !s.is_empty() && s.len() <= 63 && s.chars().all(|c| c.is_alphanumeric() || c == '_')
}

fn val_to_str(v: &Value) -> Option<String> {
    match v {
        Value::Null => None,
        Value::String(s) => Some(s.clone()),
        Value::Bool(b) => Some(b.to_string()),
        Value::Number(n) => Some(n.to_string()),
        other => Some(other.to_string()),
    }
}

// ── PostgreSQL schema ──────────────────────────────────────────────────────────

async fn get_schema_pg(pool: &PgPool) -> Result<Vec<TableInfo>, String> {
    let names: Vec<String> = sqlx::query_scalar(
        "SELECT table_name FROM information_schema.tables \
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE' \
         ORDER BY table_name",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut tables = Vec::new();
    for name in &names {
        let columns = get_columns_pg(pool, name).await?;
        let row_count: i64 =
            sqlx::query_scalar(&format!("SELECT COUNT(*) FROM \"{}\"", name))
                .fetch_one(pool)
                .await
                .map_err(|e| e.to_string())?;
        tables.push(TableInfo { name: name.clone(), columns, row_count });
    }
    Ok(tables)
}

async fn get_columns_pg(pool: &PgPool, table: &str) -> Result<Vec<ColumnInfo>, String> {
    let rows = sqlx::query(
        r#"
        SELECT
            c.column_name,
            c.data_type,
            c.udt_name,
            c.is_nullable,
            COALESCE((
                SELECT true
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                  AND tc.table_schema = kcu.table_schema
                WHERE tc.constraint_type = 'PRIMARY KEY'
                  AND tc.table_schema = 'public'
                  AND tc.table_name = $1
                  AND kcu.column_name = c.column_name
                LIMIT 1
            ), false) AS is_primary_key
        FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = $1
        ORDER BY c.ordinal_position
        "#,
    )
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let fk_rows = sqlx::query(
        r#"
        SELECT kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public' AND tc.table_name = $1
        "#,
    )
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut fk_map: HashMap<String, ForeignKeyInfo> = HashMap::new();
    for row in &fk_rows {
        let col: String = row.get("column_name");
        fk_map.insert(
            col.clone(),
            ForeignKeyInfo {
                column_name: col,
                foreign_table: row.get("foreign_table_name"),
                foreign_column: row.get("foreign_column_name"),
            },
        );
    }

    let mut columns = Vec::new();
    for row in &rows {
        let name: String = row.get("column_name");
        let data_type: String = row.get("data_type");
        let udt_name: String = row.get("udt_name");
        let is_nullable: String = row.get("is_nullable");
        let is_primary_key: bool = row.get("is_primary_key");

        let enum_values = if data_type == "USER-DEFINED" {
            get_enum_values_pg(pool, &udt_name).await.ok()
        } else {
            None
        };

        columns.push(ColumnInfo {
            foreign_key: fk_map.remove(&name),
            name,
            data_type: if data_type == "USER-DEFINED" { udt_name } else { data_type },
            nullable: is_nullable == "YES",
            is_primary_key,
            enum_values,
        });
    }
    Ok(columns)
}

async fn get_enum_values_pg(pool: &PgPool, type_name: &str) -> Result<Vec<String>, String> {
    sqlx::query_scalar(
        "SELECT enumlabel::text FROM pg_enum e \
         JOIN pg_type t ON t.oid = e.enumtypid \
         WHERE t.typname = $1 ORDER BY e.enumsortorder",
    )
    .bind(type_name)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

async fn table_exists_pg(pool: &PgPool, table: &str) -> Result<bool, String> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM information_schema.tables \
         WHERE table_schema='public' AND table_name=$1)",
    )
    .bind(table)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())
}

// ── PostgreSQL queries ─────────────────────────────────────────────────────────

async fn query_table_pg(
    pool: &PgPool,
    table: &str,
    offset: i64,
    limit: i64,
    sort_col: Option<&str>,
    sort_asc: bool,
) -> Result<TablePage, String> {
    if !table_exists_pg(pool, table).await? {
        return Err(format!("Table '{}' not found", table));
    }
    let order = order_clause(sort_col, sort_asc);
    let sql = format!("SELECT * FROM \"{}\"{} LIMIT $1 OFFSET $2", table, order);
    let rows = sqlx::query(&sql)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    let total: i64 =
        sqlx::query_scalar(&format!("SELECT COUNT(*) FROM \"{}\"", table))
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?;
    Ok(TablePage {
        rows: rows.iter().map(pg_row_to_map).collect(),
        total_count: total,
    })
}

async fn update_row_pg(
    pool: &PgPool,
    table: &str,
    pk_col: &str,
    pk_val: &str,
    update_col: &str,
    update_val: &Value,
    col_type: &str,
) -> Result<(), String> {
    if !table_exists_pg(pool, table).await? {
        return Err(format!("Table '{}' not found", table));
    }
    if !is_safe_identifier(pk_col) || !is_safe_identifier(update_col) {
        return Err("Invalid column name".into());
    }
    let cast = pg_type_cast(col_type);
    let sql = format!(
        r#"UPDATE "{}" SET "{}" = $1{} WHERE "{}" = $2"#,
        table, update_col, cast, pk_col
    );
    sqlx::query(&sql)
        .bind(val_to_str(update_val))
        .bind(pk_val)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn delete_row_pg(
    pool: &PgPool,
    table: &str,
    pk_col: &str,
    pk_val: &str,
) -> Result<(), String> {
    if !is_safe_identifier(pk_col) {
        return Err("Invalid column name".into());
    }
    sqlx::query(&format!(r#"DELETE FROM "{}" WHERE "{}" = $1"#, table, pk_col))
        .bind(pk_val)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn exec_pg(pool: &PgPool, sql: &str) -> Result<Vec<HashMap<String, Value>>, String> {
    let rows = sqlx::query(sql)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows.iter().map(pg_row_to_map).collect())
}

fn pg_row_to_map(row: &PgRow) -> HashMap<String, Value> {
    row.columns()
        .iter()
        .map(|col| {
            let name = col.name().to_string();
            let type_name = col.type_info().name().to_uppercase();
            let idx = col.ordinal();
            (name, extract_pg(row, idx, &type_name))
        })
        .collect()
}

fn extract_pg(row: &PgRow, idx: usize, type_name: &str) -> Value {
    match type_name {
        "INT2" => row.try_get::<Option<i16>, _>(idx).ok().flatten().map(|v| Value::Number(v.into())).unwrap_or(Value::Null),
        "INT4" | "INT" => row.try_get::<Option<i32>, _>(idx).ok().flatten().map(|v| Value::Number(v.into())).unwrap_or(Value::Null),
        "INT8" | "BIGINT" => row.try_get::<Option<i64>, _>(idx).ok().flatten().map(|v| Value::Number(v.into())).unwrap_or(Value::Null),
        "FLOAT4" | "REAL" => row.try_get::<Option<f32>, _>(idx).ok().flatten().and_then(|v| serde_json::Number::from_f64(v as f64)).map(Value::Number).unwrap_or(Value::Null),
        "FLOAT8" => row.try_get::<Option<f64>, _>(idx).ok().flatten().and_then(serde_json::Number::from_f64).map(Value::Number).unwrap_or(Value::Null),
        "BOOL" => row.try_get::<Option<bool>, _>(idx).ok().flatten().map(Value::Bool).unwrap_or(Value::Null),
        "JSONB" | "JSON" => row.try_get::<Option<Value>, _>(idx).ok().flatten().unwrap_or(Value::Null),
        "UUID" => row.try_get::<Option<Uuid>, _>(idx).ok().flatten().map(|v| Value::String(v.to_string())).unwrap_or(Value::Null),
        "TIMESTAMPTZ" => row.try_get::<Option<DateTime<Utc>>, _>(idx).ok().flatten().map(|v| Value::String(v.to_rfc3339())).unwrap_or(Value::Null),
        "TIMESTAMP" => row.try_get::<Option<NaiveDateTime>, _>(idx).ok().flatten().map(|v| Value::String(v.to_string())).unwrap_or(Value::Null),
        "DATE" => row.try_get::<Option<NaiveDate>, _>(idx).ok().flatten().map(|v| Value::String(v.to_string())).unwrap_or(Value::Null),
        _ => row.try_get::<Option<String>, _>(idx).ok().flatten().map(Value::String).unwrap_or(Value::Null),
    }
}

fn pg_type_cast(col_type: &str) -> &'static str {
    let t = col_type.to_lowercase();
    if t.contains("int") { "::bigint" }
    else if t.contains("float") || t.contains("double") || t == "numeric" || t == "decimal" || t == "real" { "::numeric" }
    else if t == "boolean" || t == "bool" { "::boolean" }
    else if t == "jsonb" { "::jsonb" }
    else if t == "json" { "::json" }
    else if t == "uuid" { "::uuid" }
    else if t == "date" { "::date" }
    else if t.contains("timestamp") { "::timestamptz" }
    else { "" }
}

// ── SQLite schema ──────────────────────────────────────────────────────────────

async fn get_schema_sqlite(pool: &SqlitePool) -> Result<Vec<TableInfo>, String> {
    let names: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut tables = Vec::new();
    for name in &names {
        let columns = get_columns_sqlite(pool, name).await?;
        let row_count: i64 =
            sqlx::query_scalar(&format!("SELECT COUNT(*) FROM \"{}\"", name))
                .fetch_one(pool)
                .await
                .map_err(|e| e.to_string())?;
        tables.push(TableInfo { name: name.clone(), columns, row_count });
    }
    Ok(tables)
}

async fn get_columns_sqlite(pool: &SqlitePool, table: &str) -> Result<Vec<ColumnInfo>, String> {
    let fk_rows = sqlx::query(&format!("PRAGMA foreign_key_list(\"{}\")", table))
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut fk_map: HashMap<String, ForeignKeyInfo> = HashMap::new();
    for row in &fk_rows {
        let col: String = row.get("from");
        fk_map.insert(
            col.clone(),
            ForeignKeyInfo {
                column_name: col,
                foreign_table: row.get("table"),
                foreign_column: row.get("to"),
            },
        );
    }

    let rows = sqlx::query(&format!("PRAGMA table_info(\"{}\")", table))
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    let columns = rows
        .iter()
        .map(|row| {
            let name: String = row.get("name");
            let type_str: String = row.try_get("type").unwrap_or_default();
            let notnull: i64 = row.try_get("notnull").unwrap_or(0);
            let pk: i64 = row.try_get("pk").unwrap_or(0);
            let fk = fk_map.get(&name).cloned();
            ColumnInfo {
                name: name.clone(),
                data_type: if type_str.is_empty() { "TEXT".into() } else { type_str.to_uppercase() },
                nullable: notnull == 0,
                is_primary_key: pk > 0,
                foreign_key: fk,
                enum_values: None,
            }
        })
        .collect();

    Ok(columns)
}

async fn table_exists_sqlite(pool: &SqlitePool, table: &str) -> Result<bool, String> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?)",
    )
    .bind(table)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())
}

// ── SQLite queries ─────────────────────────────────────────────────────────────

async fn query_table_sqlite(
    pool: &SqlitePool,
    table: &str,
    offset: i64,
    limit: i64,
    sort_col: Option<&str>,
    sort_asc: bool,
) -> Result<TablePage, String> {
    if !table_exists_sqlite(pool, table).await? {
        return Err(format!("Table '{}' not found", table));
    }
    let order = order_clause(sort_col, sort_asc);
    let sql = format!("SELECT * FROM \"{}\"{} LIMIT ? OFFSET ?", table, order);
    let rows = sqlx::query(&sql)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    let total: i64 =
        sqlx::query_scalar(&format!("SELECT COUNT(*) FROM \"{}\"", table))
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?;
    Ok(TablePage {
        rows: rows.iter().map(sqlite_row_to_map).collect(),
        total_count: total,
    })
}

async fn update_row_sqlite(
    pool: &SqlitePool,
    table: &str,
    pk_col: &str,
    pk_val: &str,
    update_col: &str,
    update_val: &Value,
) -> Result<(), String> {
    if !table_exists_sqlite(pool, table).await? {
        return Err(format!("Table '{}' not found", table));
    }
    if !is_safe_identifier(pk_col) || !is_safe_identifier(update_col) {
        return Err("Invalid column name".into());
    }
    let sql = format!("UPDATE \"{}\" SET \"{}\" = ? WHERE \"{}\" = ?", table, update_col, pk_col);
    sqlx::query(&sql)
        .bind(val_to_str(update_val))
        .bind(pk_val)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn delete_row_sqlite(
    pool: &SqlitePool,
    table: &str,
    pk_col: &str,
    pk_val: &str,
) -> Result<(), String> {
    if !is_safe_identifier(pk_col) {
        return Err("Invalid column name".into());
    }
    sqlx::query(&format!("DELETE FROM \"{}\" WHERE \"{}\" = ?", table, pk_col))
        .bind(pk_val)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn exec_sqlite(pool: &SqlitePool, sql: &str) -> Result<Vec<HashMap<String, Value>>, String> {
    let rows = sqlx::query(sql)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows.iter().map(sqlite_row_to_map).collect())
}

fn sqlite_row_to_map(row: &SqliteRow) -> HashMap<String, Value> {
    row.columns()
        .iter()
        .map(|col| {
            let name = col.name().to_string();
            let type_name = col.type_info().name().to_uppercase();
            let idx = col.ordinal();
            (name, extract_sqlite(row, idx, &type_name))
        })
        .collect()
}

fn extract_sqlite(row: &SqliteRow, idx: usize, type_name: &str) -> Value {
    match type_name {
        "INTEGER" | "INT" | "BIGINT" | "INT2" | "INT4" | "INT8" | "TINYINT" | "SMALLINT"
        | "MEDIUMINT" | "UNSIGNED BIG INT" => row
            .try_get::<Option<i64>, _>(idx)
            .ok()
            .flatten()
            .map(|v| Value::Number(v.into()))
            .unwrap_or(Value::Null),
        "REAL" | "FLOAT" | "DOUBLE" | "DOUBLE PRECISION" | "NUMERIC" | "DECIMAL" => row
            .try_get::<Option<f64>, _>(idx)
            .ok()
            .flatten()
            .and_then(serde_json::Number::from_f64)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        "BOOLEAN" | "BOOL" => row
            .try_get::<Option<bool>, _>(idx)
            .ok()
            .flatten()
            .map(Value::Bool)
            .unwrap_or(Value::Null),
        _ => {
            if let Ok(Some(s)) = row.try_get::<Option<String>, _>(idx) {
                // Auto-parse JSON stored as text
                if s.starts_with('{') || s.starts_with('[') {
                    if let Ok(v) = serde_json::from_str(&s) {
                        return v;
                    }
                }
                Value::String(s)
            } else {
                Value::Null
            }
        }
    }
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

fn order_clause(sort_col: Option<&str>, sort_asc: bool) -> String {
    match sort_col {
        Some(col) if is_safe_identifier(col) => {
            format!(" ORDER BY \"{}\" {}", col, if sort_asc { "ASC" } else { "DESC" })
        }
        _ => String::new(),
    }
}

// ── test_connection (used by add-workspace modal) ──────────────────────────────

pub async fn test_connection(conn_str: &str) -> Result<(), String> {
    if is_postgres(conn_str) {
        let pool = PgPool::connect(conn_str).await.map_err(|e| e.to_string())?;
        pool.close().await;
    } else {
        let normalized = normalize_sqlite(conn_str);
        let pool = SqlitePool::connect(&normalized).await.map_err(|e| e.to_string())?;
        pool.close().await;
    }
    Ok(())
}
