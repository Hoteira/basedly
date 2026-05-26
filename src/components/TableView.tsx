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

  const nonPkCols = columns.filter(c => !c.is_primary_key);
  const groupCol = nonPkCols.find(c => c.name === kanbanColName) ?? nonPkCols[0];

  const btnStyle = (active: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 5,
    padding: "3px 10px", borderRadius: 4, border: "none", cursor: "pointer",
    fontSize: 11, fontWeight: 500,
    background: active ? "var(--bg-1)" : "transparent",
    color: active ? "var(--text-1)" : "var(--text-3)",
    transition: "background 0.12s, color 0.12s",
  });

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Toolbar — fixed 40px to match sidebar header */}
      <div style={{
        height: 40, flexShrink: 0,
        display: "flex", alignItems: "center", gap: 10, padding: "0 16px",
        borderBottom: "1px solid var(--border)", background: "var(--bg-1)",
      }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-1)" }}>{tableName}</span>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {/* Segmented toggle */}
          <div style={{ display: "flex", background: "var(--bg-3)", borderRadius: 6, padding: 2 }}>
            <button onClick={() => onViewModeChange("grid")} style={btnStyle(viewMode === "grid")}>
              <LayoutGrid size={11} /> Grid
            </button>
            <button onClick={() => onViewModeChange("kanban")} style={btnStyle(viewMode === "kanban")}>
              <Columns3 size={11} /> Kanban
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {viewMode === "grid" || !groupCol ? (
          <DataGrid
            key={tableName}
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
            groupCol={groupCol}
            onCardOpen={setPeekRow}
            onGroupColChange={(col) => setKanbanColName(col.name)}
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
