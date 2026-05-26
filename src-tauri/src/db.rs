use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::postgres::PgRow;
use sqlx::{Column, PgPool, Row, TypeInfo};
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

pub struct DbManager {
    pools: Mutex<HashMap<String, PgPool>>,
}

impl DbManager {
    pub fn new() -> Self {
        DbManager {
            pools: Mutex::new(HashMap::new()),
        }
    }

    pub async fn connect(&self, workspace_id: &str, conn_str: &str) -> Result<(), String> {
        let pool = PgPool::connect(conn_str)
            .await
            .map_err(|e| e.to_string())?;
        self.pools
            .lock()
            .map_err(|e| e.to_string())?
            .insert(workspace_id.to_string(), pool);
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

    pub fn get_pool(&self, workspace_id: &str) -> Result<PgPool, String> {
        self.pools
            .lock()
            .map_err(|e| e.to_string())?
            .get(workspace_id)
            .cloned()
            .ok_or_else(|| format!("No active connection for workspace '{}'", workspace_id))
    }
}

pub async fn get_schema(pool: &PgPool) -> Result<Vec<TableInfo>, String> {
    let table_names: Vec<String> = sqlx::query_scalar(
        "SELECT table_name FROM information_schema.tables \
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE' \
         ORDER BY table_name",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut tables = Vec::new();
    for name in &table_names {
        let columns = get_columns(pool, name).await?;
        let row_count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM \"{}\"", name))
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?;
        tables.push(TableInfo {
            name: name.clone(),
            columns,
            row_count,
        });
    }
    Ok(tables)
}

async fn get_columns(pool: &PgPool, table: &str) -> Result<Vec<ColumnInfo>, String> {
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
        SELECT
            kcu.column_name,
            ccu.table_name  AS foreign_table_name,
            ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
          AND tc.table_name = $1
        "#,
    )
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut fk_map: HashMap<String, ForeignKeyInfo> = HashMap::new();
    for row in &fk_rows {
        let col: String = row.get("column_name");
        let ft: String = row.get("foreign_table_name");
        let fc: String = row.get("foreign_column_name");
        fk_map.insert(
            col.clone(),
            ForeignKeyInfo {
                column_name: col,
                foreign_table: ft,
                foreign_column: fc,
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
            get_enum_values(pool, &udt_name).await.ok()
        } else {
            None
        };

        let display_type = if data_type == "USER-DEFINED" {
            udt_name.clone()
        } else {
            data_type.clone()
        };

        columns.push(ColumnInfo {
            foreign_key: fk_map.remove(&name),
            name,
            data_type: display_type,
            nullable: is_nullable == "YES",
            is_primary_key,
            enum_values,
        });
    }
    Ok(columns)
}

async fn get_enum_values(pool: &PgPool, type_name: &str) -> Result<Vec<String>, String> {
    sqlx::query_scalar(
        "SELECT enumlabel::text FROM pg_enum e \
         JOIN pg_type t ON t.oid = e.enumtypid \
         WHERE t.typname = $1 \
         ORDER BY e.enumsortorder",
    )
    .bind(type_name)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

pub async fn table_exists(pool: &PgPool, table: &str) -> Result<bool, String> {
    sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM information_schema.tables \
         WHERE table_schema='public' AND table_name=$1)",
    )
    .bind(table)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())
}

pub async fn query_table(
    pool: &PgPool,
    table: &str,
    offset: i64,
    limit: i64,
    sort_col: Option<&str>,
    sort_asc: bool,
) -> Result<TablePage, String> {
    if !table_exists(pool, table).await? {
        return Err(format!("Table '{}' not found", table));
    }

    let order = match sort_col {
        Some(col) if is_safe_identifier(col) => format!(
            r#" ORDER BY "{}" {}"#,
            col,
            if sort_asc { "ASC" } else { "DESC" }
        ),
        _ => String::new(),
    };

    let sql = format!(r#"SELECT * FROM "{}"{} LIMIT $1 OFFSET $2"#, table, order);
    let rows = sqlx::query(&sql)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    let total_count: i64 =
        sqlx::query_scalar(&format!("SELECT COUNT(*) FROM \"{}\"", table))
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?;

    Ok(TablePage {
        rows: rows.iter().map(pg_row_to_map).collect(),
        total_count,
    })
}

pub async fn update_row(
    pool: &PgPool,
    table: &str,
    pk_col: &str,
    pk_val: &str,
    update_col: &str,
    update_val: &Value,
    col_type: &str,
) -> Result<(), String> {
    if !table_exists(pool, table).await? {
        return Err(format!("Table '{}' not found", table));
    }
    if !is_safe_identifier(pk_col) || !is_safe_identifier(update_col) {
        return Err("Invalid column name".to_string());
    }

    let cast = type_cast(col_type);
    let sql = format!(
        r#"UPDATE "{}" SET "{}" = $1{} WHERE "{}" = $2"#,
        table, update_col, cast, pk_col
    );

    let val_str: Option<String> = match update_val {
        Value::Null => None,
        Value::String(s) => Some(s.clone()),
        Value::Bool(b) => Some(b.to_string()),
        Value::Number(n) => Some(n.to_string()),
        other => Some(other.to_string()),
    };

    sqlx::query(&sql)
        .bind(val_str)
        .bind(pk_val)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

pub async fn delete_row(
    pool: &PgPool,
    table: &str,
    pk_col: &str,
    pk_val: &str,
) -> Result<(), String> {
    if !table_exists(pool, table).await? {
        return Err(format!("Table '{}' not found", table));
    }
    if !is_safe_identifier(pk_col) {
        return Err("Invalid column name".to_string());
    }

    let sql = format!(r#"DELETE FROM "{}" WHERE "{}" = $1"#, table, pk_col);
    sqlx::query(&sql)
        .bind(pk_val)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

pub async fn execute_query(
    pool: &PgPool,
    sql: &str,
) -> Result<Vec<HashMap<String, Value>>, String> {
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
            (name, extract_value(row, idx, &type_name))
        })
        .collect()
}

fn extract_value(row: &PgRow, idx: usize, type_name: &str) -> Value {
    match type_name {
        "INT2" => row
            .try_get::<Option<i16>, _>(idx)
            .ok()
            .flatten()
            .map(|v| Value::Number(v.into()))
            .unwrap_or(Value::Null),
        "INT4" | "INT" => row
            .try_get::<Option<i32>, _>(idx)
            .ok()
            .flatten()
            .map(|v| Value::Number(v.into()))
            .unwrap_or(Value::Null),
        "INT8" | "BIGINT" => row
            .try_get::<Option<i64>, _>(idx)
            .ok()
            .flatten()
            .map(|v| Value::Number(v.into()))
            .unwrap_or(Value::Null),
        "FLOAT4" | "REAL" => row
            .try_get::<Option<f32>, _>(idx)
            .ok()
            .flatten()
            .and_then(|v| serde_json::Number::from_f64(v as f64))
            .map(Value::Number)
            .unwrap_or(Value::Null),
        "FLOAT8" | "FLOAT" => row
            .try_get::<Option<f64>, _>(idx)
            .ok()
            .flatten()
            .and_then(|v| serde_json::Number::from_f64(v))
            .map(Value::Number)
            .unwrap_or(Value::Null),
        "BOOL" => row
            .try_get::<Option<bool>, _>(idx)
            .ok()
            .flatten()
            .map(Value::Bool)
            .unwrap_or(Value::Null),
        "JSONB" | "JSON" => row
            .try_get::<Option<Value>, _>(idx)
            .ok()
            .flatten()
            .unwrap_or(Value::Null),
        "UUID" => row
            .try_get::<Option<Uuid>, _>(idx)
            .ok()
            .flatten()
            .map(|v| Value::String(v.to_string()))
            .unwrap_or(Value::Null),
        "TIMESTAMPTZ" => row
            .try_get::<Option<DateTime<Utc>>, _>(idx)
            .ok()
            .flatten()
            .map(|v| Value::String(v.to_rfc3339()))
            .unwrap_or(Value::Null),
        "TIMESTAMP" => row
            .try_get::<Option<NaiveDateTime>, _>(idx)
            .ok()
            .flatten()
            .map(|v| Value::String(v.to_string()))
            .unwrap_or(Value::Null),
        "DATE" => row
            .try_get::<Option<NaiveDate>, _>(idx)
            .ok()
            .flatten()
            .map(|v| Value::String(v.to_string()))
            .unwrap_or(Value::Null),
        _ => row
            .try_get::<Option<String>, _>(idx)
            .ok()
            .flatten()
            .map(Value::String)
            .unwrap_or(Value::Null),
    }
}

fn type_cast(col_type: &str) -> &'static str {
    let t = col_type.to_lowercase();
    if t.contains("int") {
        "::bigint"
    } else if t.contains("float") || t.contains("double") || t == "numeric" || t == "decimal" || t == "real" {
        "::numeric"
    } else if t == "boolean" || t == "bool" {
        "::boolean"
    } else if t == "jsonb" {
        "::jsonb"
    } else if t == "json" {
        "::json"
    } else if t == "uuid" {
        "::uuid"
    } else if t == "date" {
        "::date"
    } else if t.contains("timestamp") {
        "::timestamptz"
    } else {
        ""
    }
}

fn is_safe_identifier(s: &str) -> bool {
    !s.is_empty() && s.len() <= 63 && s.chars().all(|c| c.is_alphanumeric() || c == '_')
}
