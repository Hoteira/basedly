import { useState } from "react";
import { Columns3, LayoutGrid } from "lucide-react";
import type { ColumnInfo, TableInfo, ViewMode } from "../types";
import DataGrid from "./DataGrid";
import KanbanBoard from "./KanbanBoard";
import SidePeek from "./SidePeek";

interface Props {
  workspaceId: string;
  tableName: string;
  columns: ColumnInfo[];
  schema: TableInfo[];
  viewMode: ViewMode;
  refreshKey: number;
  onViewModeChange: (mode: ViewMode) => void;
}

export default function TableView({
  workspaceId,
  tableName,
  columns,
  schema,
  viewMode,
  refreshKey,
  onViewModeChange,
}: Props) {
  const [peekRow, setPeekRow] = useState<Record<string, unknown> | null>(null);
  const [kanbanColName, setKanbanColName] = useState("");

  const enumCols = columns.filter(c => c.enum_values && c.enum_values.length > 0);
  const canKanban = enumCols.length > 0;
  const kanbanCol = enumCols.find(c => c.name === kanbanColName) ?? enumCols[0];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg-1)", flexShrink: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text-1)" }}>{tableName}</span>

        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          {viewMode === "kanban" && canKanban && enumCols.length > 1 && (
            <select
              value={kanbanCol?.name ?? ""}
              onChange={e => setKanbanColName(e.target.value)}
              className="input"
              style={{ padding: "3px 8px", fontSize: 11, height: 28 }}
            >
              {enumCols.map(c => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          )}
          <button
            className={`btn ${viewMode === "grid" ? "btn-primary" : "btn-ghost"}`}
            style={{ padding: "4px 10px", fontSize: 11 }}
            onClick={() => onViewModeChange("grid")}
          >
            <LayoutGrid size={12} /> Grid
          </button>
          {canKanban && (
            <button
              className={`btn ${viewMode === "kanban" ? "btn-primary" : "btn-ghost"}`}
              style={{ padding: "4px 10px", fontSize: 11 }}
              onClick={() => onViewModeChange("kanban")}
            >
              <Columns3 size={12} /> Board
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {viewMode === "grid" || !canKanban ? (
          <DataGrid
            workspaceId={workspaceId}
            tableName={tableName}
            columns={columns}
            refreshKey={refreshKey}
            onRowOpen={setPeekRow}
          />
        ) : (
          <KanbanBoard
            workspaceId={workspaceId}
            tableName={tableName}
            columns={columns}
            enumCol={kanbanCol!}
            onCardOpen={setPeekRow}
          />
        )}

        <SidePeek
          row={peekRow}
          columns={columns}
          workspaceId={workspaceId}
          tableName={tableName}
          schema={schema}
          onClose={() => setPeekRow(null)}
        />
      </div>
    </div>
  );
}
