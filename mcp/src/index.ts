import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import pg from "pg";
import Database from "better-sqlite3";

// ── Config directory (mirrors Rust dirs::config_dir()) ─────────────────────────

function configDir(): string {
  if (process.platform === "win32") {
    return path.join(process.env["APPDATA"] ?? os.homedir(), "basedly");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "basedly");
  }
  return path.join(process.env["XDG_CONFIG_HOME"] ?? path.join(os.homedir(), ".config"), "basedly");
}

// ── AES-256-GCM decryption (same scheme as Rust aes-gcm crate) ────────────────
// Stored format: "enc:v1:" + base64(nonce[12] + ciphertext + tag[16])

const ENC_PREFIX = "enc:v1:";

function loadKey(): Buffer {
  return fs.readFileSync(path.join(configDir(), ".key"));
}

function decrypt(value: string): string {
  if (!value.startsWith(ENC_PREFIX)) return value;
  const combined = Buffer.from(value.slice(ENC_PREFIX.length), "base64");
  if (combined.length < 29) return value; // 12 nonce + 1 data + 16 tag minimum
  const nonce = combined.subarray(0, 12);
  const tag = combined.subarray(combined.length - 16);
  const ciphertext = combined.subarray(12, combined.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", loadKey(), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// ── Workspace config ───────────────────────────────────────────────────────────

interface Workspace {
  id: string;
  name: string;
  connection_hint: string;
  connection_string: string;
  db_type: string;
  color?: string;
}

function loadWorkspaces(): Workspace[] {
  const raw = fs.readFileSync(path.join(configDir(), "config.json"), "utf8");
  const config = JSON.parse(raw) as { workspaces?: Workspace[] };
  return (config.workspaces ?? []).map(ws => ({
    ...ws,
    db_type: ws.db_type ?? "postgres",
    connection_string: decrypt(ws.connection_string),
  }));
}

function findWorkspace(id: string): Workspace {
  const ws = loadWorkspaces().find(w => w.id === id);
  if (!ws) throw new Error(`Workspace '${id}' not found. Use list_workspaces to see available IDs.`);
  return ws;
}

// ── Connection management ──────────────────────────────────────────────────────

const pgPools = new Map<string, pg.Pool>();
const sqliteDbs = new Map<string, Database.Database>();

function normalizeSqlitePath(connStr: string): string {
  for (const prefix of ["sqlite:///", "sqlite://", "sqlite:"]) {
    if (connStr.startsWith(prefix)) return connStr.slice(prefix.length);
  }
  return connStr;
}

type Conn =
  | { kind: "pg"; pool: pg.Pool }
  | { kind: "sqlite"; db: Database.Database };

function getConn(ws: Workspace): Conn {
  if (ws.db_type === "sqlite") {
    if (!sqliteDbs.has(ws.id)) {
      sqliteDbs.set(ws.id, new Database(normalizeSqlitePath(ws.connection_string)));
    }
    return { kind: "sqlite", db: sqliteDbs.get(ws.id)! };
  }
  if (!pgPools.has(ws.id)) {
    pgPools.set(ws.id, new pg.Pool({ connectionString: ws.connection_string }));
  }
  return { kind: "pg", pool: pgPools.get(ws.id)! };
}

// ── Schema helpers ─────────────────────────────────────────────────────────────

interface ColInfo { name: string; type: string; nullable: boolean; pk: boolean }
interface TableSchema { name: string; columns: ColInfo[]; row_count: number }

async function schemaPg(pool: pg.Pool): Promise<TableSchema[]> {
  const { rows: tables } = await pool.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name"
  );
  return Promise.all(tables.map(async ({ table_name }) => {
    const { rows: cols } = await pool.query<{ column_name: string; data_type: string; is_nullable: string }>(
      "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
      [table_name]
    );
    const { rows: pkRows } = await pool.query<{ column_name: string }>(
      `SELECT kcu.column_name FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
       WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_schema='public' AND tc.table_name=$1`,
      [table_name]
    );
    const pks = new Set(pkRows.map(r => r.column_name));
    const { rows: [{ count }] } = await pool.query<{ count: string }>(`SELECT COUNT(*) as count FROM "${table_name}"`);
    return {
      name: table_name,
      columns: cols.map(c => ({ name: c.column_name, type: c.data_type, nullable: c.is_nullable === "YES", pk: pks.has(c.column_name) })),
      row_count: parseInt(count, 10),
    };
  }));
}

function schemaSqlite(db: Database.Database): TableSchema[] {
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all() as { name: string }[];
  return tables.map(({ name }) => {
    const cols = db.prepare(`PRAGMA table_info("${name}")`).all() as {
      name: string; type: string; notnull: number; pk: number;
    }[];
    const count = (db.prepare(`SELECT COUNT(*) as c FROM "${name}"`).get() as { c: number }).c;
    return {
      name,
      columns: cols.map(c => ({ name: c.name, type: c.type || "TEXT", nullable: c.notnull === 0, pk: c.pk > 0 })),
      row_count: count,
    };
  });
}

// ── Execute arbitrary SQL ──────────────────────────────────────────────────────

async function execSql(
  ws: Workspace,
  sql: string
): Promise<{ rows: Record<string, unknown>[]; affected?: number }> {
  const conn = getConn(ws);
  if (conn.kind === "pg") {
    const result = await conn.pool.query(sql);
    return { rows: result.rows, affected: result.rowCount ?? undefined };
  }
  // SQLite: use all() for read statements, run() for mutations
  const upper = sql.trimStart().toUpperCase();
  const isRead = upper.startsWith("SELECT") || upper.startsWith("WITH")
    || upper.startsWith("PRAGMA") || upper.startsWith("EXPLAIN");
  const stmt = conn.db.prepare(sql);
  if (isRead) {
    return { rows: stmt.all() as Record<string, unknown>[] };
  }
  const info = stmt.run();
  return { rows: [], affected: info.changes };
}

// ── MCP Server ─────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "basedly", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "describe_app",
      description: "Returns a description of Basedly and how to use this MCP server. Call this first to orient yourself.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "list_workspaces",
      description: "List all database connections saved in Basedly. Returns workspace IDs (needed for all other tools), display names, database type (postgres/sqlite), and a masked connection hint.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "get_schema",
      description: "Get the full schema for a workspace: all tables with their column names, data types, nullability, and primary-key flags, plus row counts.",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace ID from list_workspaces" },
        },
        required: ["workspace_id"],
      },
    },
    {
      name: "query_table",
      description: "Fetch rows from a table with optional sorting and pagination.",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          table_name: { type: "string" },
          limit: { type: "number", description: "Max rows to return (default 100, max 1000)" },
          offset: { type: "number", description: "Row offset for pagination (default 0)" },
          sort_col: { type: "string", description: "Column name to sort by" },
          sort_asc: { type: "boolean", description: "Sort ascending when true (default true)" },
        },
        required: ["workspace_id", "table_name"],
      },
    },
    {
      name: "execute_sql",
      description: "Execute any SQL against a workspace database. Works for SELECT, INSERT, UPDATE, DELETE, CREATE TABLE, etc. Returns rows for SELECT or the number of affected rows for mutations.",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          sql: { type: "string", description: "SQL to execute" },
        },
        required: ["workspace_id", "sql"],
      },
    },
    {
      name: "update_row",
      description: "Update a single cell identified by primary key.",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          table_name: { type: "string" },
          pk_col: { type: "string", description: "Name of the primary key column" },
          pk_val: { type: "string", description: "Primary key value (as string)" },
          column: { type: "string", description: "Column to update" },
          value: { type: "string", description: "New value (as string)" },
        },
        required: ["workspace_id", "table_name", "pk_col", "pk_val", "column", "value"],
      },
    },
    {
      name: "delete_row",
      description: "Delete a row by its primary key.",
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string" },
          table_name: { type: "string" },
          pk_col: { type: "string", description: "Name of the primary key column" },
          pk_val: { type: "string", description: "Primary key value (as string)" },
        },
        required: ["workspace_id", "table_name", "pk_col", "pk_val"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;

  try {
    // ── describe_app ──────────────────────────────────────────────────────────
    if (name === "describe_app") {
      return {
        content: [{
          type: "text",
          text: [
            "# Basedly",
            "",
            "Basedly is a desktop database GUI (Tauri + React) for PostgreSQL and SQLite.",
            "It lets users browse tables, edit cells inline, run SQL queries, and view data in grid or Kanban layout.",
            "",
            "## What this MCP server exposes",
            "",
            "- **list_workspaces** — see all saved database connections",
            "- **get_schema** — inspect tables and columns for a connection",
            "- **query_table** — paginate/sort rows from any table",
            "- **execute_sql** — run arbitrary SQL (SELECT, INSERT, UPDATE, DELETE, DDL)",
            "- **update_row** — update a single cell by primary key",
            "- **delete_row** — delete a row by primary key",
            "",
            "## Typical workflow",
            "",
            "1. Call `list_workspaces` to find workspace IDs.",
            "2. Call `get_schema` with a workspace ID to see available tables and columns.",
            "3. Use `query_table` or `execute_sql` to read data.",
            "4. Use `update_row`, `delete_row`, or `execute_sql` to write data.",
            "",
            "Connection strings are read directly from the Basedly config file and decrypted automatically.",
          ].join("\n"),
        }],
      };
    }

    // ── list_workspaces ───────────────────────────────────────────────────────
    if (name === "list_workspaces") {
      const list = loadWorkspaces().map(({ id, name, db_type, connection_hint, color }) => ({
        id, name, db_type, connection_hint, color,
      }));
      return { content: [{ type: "text", text: JSON.stringify(list, null, 2) }] };
    }

    // ── get_schema ────────────────────────────────────────────────────────────
    if (name === "get_schema") {
      const ws = findWorkspace(String(a["workspace_id"]));
      const conn = getConn(ws);
      const schema = conn.kind === "pg" ? await schemaPg(conn.pool) : schemaSqlite(conn.db);
      return { content: [{ type: "text", text: JSON.stringify(schema, null, 2) }] };
    }

    // ── query_table ───────────────────────────────────────────────────────────
    if (name === "query_table") {
      const ws = findWorkspace(String(a["workspace_id"]));
      const table = String(a["table_name"]);
      const limit = Math.min(Number(a["limit"] ?? 100), 1000);
      const offset = Number(a["offset"] ?? 0);
      const sortCol = a["sort_col"] ? String(a["sort_col"]) : null;
      const sortAsc = a["sort_asc"] !== false;
      const order = sortCol ? ` ORDER BY "${sortCol}" ${sortAsc ? "ASC" : "DESC"}` : "";
      const conn = getConn(ws);
      let rows: Record<string, unknown>[];
      let total: number;
      if (conn.kind === "pg") {
        const r = await conn.pool.query(`SELECT * FROM "${table}"${order} LIMIT $1 OFFSET $2`, [limit, offset]);
        rows = r.rows;
        const t = await conn.pool.query<{ count: string }>(`SELECT COUNT(*) as count FROM "${table}"`);
        total = parseInt(t.rows[0].count, 10);
      } else {
        rows = conn.db.prepare(`SELECT * FROM "${table}"${order} LIMIT ? OFFSET ?`).all(limit, offset) as Record<string, unknown>[];
        total = (conn.db.prepare(`SELECT COUNT(*) as c FROM "${table}"`).get() as { c: number }).c;
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ rows, total_count: total, returned: rows.length, offset, limit }, null, 2),
        }],
      };
    }

    // ── execute_sql ───────────────────────────────────────────────────────────
    if (name === "execute_sql") {
      const ws = findWorkspace(String(a["workspace_id"]));
      const result = await execSql(ws, String(a["sql"]));
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    // ── update_row ────────────────────────────────────────────────────────────
    if (name === "update_row") {
      const ws = findWorkspace(String(a["workspace_id"]));
      const table = String(a["table_name"]);
      const pkCol = String(a["pk_col"]);
      const pkVal = String(a["pk_val"]);
      const col = String(a["column"]);
      const val = String(a["value"]);
      const conn = getConn(ws);
      if (conn.kind === "pg") {
        await conn.pool.query(`UPDATE "${table}" SET "${col}" = $1 WHERE "${pkCol}" = $2`, [val, pkVal]);
      } else {
        conn.db.prepare(`UPDATE "${table}" SET "${col}" = ? WHERE "${pkCol}" = ?`).run(val, pkVal);
      }
      return { content: [{ type: "text", text: "Row updated successfully." }] };
    }

    // ── delete_row ────────────────────────────────────────────────────────────
    if (name === "delete_row") {
      const ws = findWorkspace(String(a["workspace_id"]));
      const table = String(a["table_name"]);
      const pkCol = String(a["pk_col"]);
      const pkVal = String(a["pk_val"]);
      const conn = getConn(ws);
      if (conn.kind === "pg") {
        await conn.pool.query(`DELETE FROM "${table}" WHERE "${pkCol}" = $1`, [pkVal]);
      } else {
        conn.db.prepare(`DELETE FROM "${table}" WHERE "${pkCol}" = ?`).run(pkVal);
      }
      return { content: [{ type: "text", text: "Row deleted successfully." }] };
    }

    throw new Error(`Unknown tool: ${name}`);

  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
  }
});

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // stateless — no session bookkeeping needed
});

const app = createMcpExpressApp();
app.use(express.json());
app.all("/mcp", async (req, res) => {
  await transport.handleRequest(req, res, req.body);
});

await server.connect(transport);

const PORT = parseInt(process.env["PORT"] ?? "3456", 10);
app.listen(PORT, "127.0.0.1", () => {
  console.error(`Basedly MCP running at http://localhost:${PORT}/mcp`);
});
