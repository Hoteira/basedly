export interface WorkspaceConfig {
  id: string;
  name: string;
  color?: string;
  connection_hint: string;
}

export interface ForeignKeyInfo {
  column_name: string;
  foreign_table: string;
  foreign_column: string;
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  nullable: boolean;
  is_primary_key: boolean;
  foreign_key?: ForeignKeyInfo;
  enum_values?: string[];
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  row_count: number;
}

export interface TablePage {
  rows: Record<string, unknown>[];
  total_count: number;
}

export type ViewMode = "grid" | "kanban";
