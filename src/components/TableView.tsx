import { useState } from "react";
import type { ColumnInfo, ViewMode } from "../types";
import DataGrid from "./DataGrid";
import KanbanBoard from "./KanbanBoard";
import SidePeek from "./SidePeek";

interface Props {
  workspaceId: string;
  tableName: string;
  columns: ColumnInfo[];
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

export default function TableView({
  workspaceId,
  tableName,
  columns,
  viewMode,
  onViewModeChange,
}: Props) {
  const [peekRow, setPeekRow] = useState<Record<string, unknown> | null>(null);

  // Find an enum column for kanban grouping
  const enumCols = columns.filter(
    (c) => c.enum_values && c.enum_values.length > 0
  );

  const canKanban = enumCols.length > 0;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 16px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-1)",
          flexShrink: 0,
        }}
      >
        <span
          style={{ fontWeight: 600, fontSize: 14, color: "var(--text-1)" }}
        >
          {tableName}
        </span>

        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <button
            className={`btn ${viewMode === "grid" ? "btn-primary" : "btn-ghost"}`}
            style={{ padding: "4px 10px", fontSize: 11 }}
            onClick={() => onViewModeChange("grid")}
          >
            ▦ Grid
          </button>
          {canKanban && (
            <button
              className={`btn ${viewMode === "kanban" ? "btn-primary" : "btn-ghost"}`}
              style={{ padding: "4px 10px", fontSize: 11 }}
              onClick={() => onViewModeChange("kanban")}
            >
              ⬜ Board
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
            onRowOpen={setPeekRow}
          />
        ) : (
          <KanbanBoard
            workspaceId={workspaceId}
            tableName={tableName}
            columns={columns}
            enumCol={enumCols[0]}
            onCardOpen={setPeekRow}
          />
        )}

        <SidePeek
          row={peekRow}
          columns={columns}
          workspaceId={workspaceId}
          tableName={tableName}
          onClose={() => setPeekRow(null)}
        />
      </div>
    </div>
  );
}
