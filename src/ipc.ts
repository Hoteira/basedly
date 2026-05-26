import { invoke } from "@tauri-apps/api/core";
import type {
  ColumnInfo,
  TableInfo,
  TablePage,
  WorkspaceConfig,
} from "./types";

export const ipc = {
  getWorkspaces: () =>
    invoke<WorkspaceConfig[]>("get_workspaces"),

  addWorkspace: (name: string, connectionString: string, color?: string) =>
    invoke<WorkspaceConfig>("add_workspace", {
      name,
      connectionString,
      color,
    }),

  deleteWorkspace: (workspaceId: string) =>
    invoke<void>("delete_workspace", { workspaceId }),

  connectWorkspace: (workspaceId: string) =>
    invoke<void>("connect_workspace", { workspaceId }),

  disconnectWorkspace: (workspaceId: string) =>
    invoke<void>("disconnect_workspace", { workspaceId }),

  isConnected: (workspaceId: string) =>
    invoke<boolean>("is_connected", { workspaceId }),

  getSchema: (workspaceId: string) =>
    invoke<TableInfo[]>("get_schema", { workspaceId }),

  queryTable: (
    workspaceId: string,
    tableName: string,
    offset: number,
    limit: number,
    sortCol?: string,
    sortAsc = true
  ) =>
    invoke<TablePage>("query_table", {
      workspaceId,
      tableName,
      offset,
      limit,
      sortCol,
      sortAsc,
    }),

  updateRow: (
    workspaceId: string,
    tableName: string,
    pkCol: string,
    pkVal: string,
    updateCol: string,
    updateVal: unknown,
    colType: string
  ) =>
    invoke<void>("update_row", {
      workspaceId,
      tableName,
      pkCol,
      pkVal,
      updateCol,
      updateVal,
      colType,
    }),

  deleteRow: (
    workspaceId: string,
    tableName: string,
    pkCol: string,
    pkVal: string
  ) =>
    invoke<void>("delete_row", { workspaceId, tableName, pkCol, pkVal }),

  executeQuery: (workspaceId: string, sql: string) =>
    invoke<Record<string, unknown>[]>("execute_query", { workspaceId, sql }),

  testConnection: (connectionString: string) =>
    invoke<void>("test_connection", { connectionString }),

  pickSqliteFile: () =>
    invoke<string | null>("pick_sqlite_file"),

  saveFile: (path: string, content: string) =>
    invoke<void>("save_file", { path, content }),

  fetchRowByColumn: (
    workspaceId: string,
    tableName: string,
    columnName: string,
    columnValue: string
  ) =>
    invoke<Record<string, unknown> | null>("fetch_row_by_column", {
      workspaceId,
      tableName,
      columnName,
      columnValue,
    }),
};

export function getPrimaryKey(columns: ColumnInfo[]): ColumnInfo | undefined {
  return columns.find((c) => c.is_primary_key);
}

export function rowPkValue(
  row: Record<string, unknown>,
  columns: ColumnInfo[]
): string {
  const pk = getPrimaryKey(columns);
  if (!pk) return "";
  const val = row[pk.name];
  return val == null ? "" : String(val);
}
