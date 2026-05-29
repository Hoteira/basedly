import { useEffect, useRef, useState } from "react";
import { Columns3, LayoutGrid, Search, X } from "lucide-react";
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

  const [filterOpen, setFilterOpen] = useState(false);
  const [filterCol, setFilterCol] = useState(columns[0]?.name ?? "");
  const [filterInput, setFilterInput] = useState("");
  const [filterVal, setFilterVal] = useState("");
  const filterInputRef = useRef<HTMLInputElement>(null);

  // Reset filter whenever the active table changes
  useEffect(() => {
    setFilterOpen(false);
    setFilterInput("");
    setFilterVal("");
    setFilterCol(columns[0]?.name ?? "");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableName]);

  // Debounce: only push a new filterVal 350 ms after the user stops typing
  useEffect(() => {
    const t = setTimeout(() => setFilterVal(filterInput), 350);
    return () => clearTimeout(t);
  }, [filterInput]);

  // Auto-focus the text input when the bar opens
  useEffect(() => {
    if (filterOpen) setTimeout(() => filterInputRef.current?.focus(), 40);
  }, [filterOpen]);

  // Ctrl+F - toggle the filter bar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === "f" || e.key === "F") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setFilterOpen((v) => {
          if (v) { setFilterInput(""); setFilterVal(""); }
          return !v;
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const closeFilter = () => {
    setFilterOpen(false);
    setFilterInput("");
    setFilterVal("");
  };

  const nonPkCols = columns.filter((c) => !c.is_primary_key);
  const groupCol = nonPkCols.find((c) => c.name === kanbanColName) ?? nonPkCols[0];

  const btnStyle = (active: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 5,
    padding: "3px 10px", borderRadius: 4, border: "none", cursor: "pointer",
    fontSize: 11, fontWeight: 500,
    background: active ? "var(--accent-subtle)" : "transparent",
    color: active ? "var(--accent)" : "var(--text-3)",
    transition: "background 0.12s var(--ease-snap), color 0.12s var(--ease-snap), transform 0.16s var(--ease-spring)",
  });

  const iconBtnStyle = (active: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 4,
    padding: "3px 8px", borderRadius: 4, border: "none", cursor: "pointer",
    fontSize: 11, fontWeight: 500,
    background: active ? "var(--accent-subtle)" : "transparent",
    color: active ? "var(--accent)" : "var(--text-3)",
    transition: "background 0.12s var(--ease-snap), color 0.12s var(--ease-snap), transform 0.16s var(--ease-spring)",
  });

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

      <div style={{
        height: 40, flexShrink: 0,
        display: "flex", alignItems: "center", gap: 10, padding: "0 16px",
        borderBottom: "1px solid var(--border)", background: "var(--bg-1)",
      }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-1)" }}>{tableName}</span>

        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <button
            className="tactile"
            onClick={() => filterOpen ? closeFilter() : setFilterOpen(true)}
            title="Filter (Ctrl+F)"
            style={iconBtnStyle(filterOpen || !!filterVal)}
          >
            <Search size={11} />
            {filterVal && (
              <span style={{
                background: "var(--accent)", color: "#fff",
                borderRadius: 8, fontSize: 9, padding: "1px 5px", lineHeight: 1.4,
              }}>
                on
              </span>
            )}
          </button>

          <div style={{ display: "flex", background: "var(--bg-3)", borderRadius: 6, padding: 2 }}>
            <button className="tactile" onClick={() => onViewModeChange("grid")} style={btnStyle(viewMode === "grid")}>
              <LayoutGrid size={11} /> Grid
            </button>
            <button className="tactile" onClick={() => onViewModeChange("kanban")} style={btnStyle(viewMode === "kanban")}>
              <Columns3 size={11} /> Kanban
            </button>
          </div>
        </div>
      </div>

      {filterOpen && (
        <div style={{
          flexShrink: 0, height: 38,
          display: "flex", alignItems: "center", gap: 8, padding: "0 14px",
          borderBottom: "1px solid var(--border)", background: "var(--bg-2)",
        }}>
          <Search size={11} style={{ color: "var(--text-3)", flexShrink: 0 }} />

          <select
            value={filterCol}
            onChange={(e) => setFilterCol(e.target.value)}
            style={{
              background: "var(--bg-3)", border: "1px solid var(--border)",
              color: "var(--text-1)", borderRadius: 6, fontSize: 11,
              padding: "2px 6px", cursor: "pointer", flexShrink: 0, maxWidth: 150,
              outline: "none",
            }}
          >
            {columns.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>

          <input
            ref={filterInputRef}
            value={filterInput}
            onChange={(e) => setFilterInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") closeFilter(); }}
            placeholder="Search…"
            style={{
              flex: 1, background: "var(--bg-3)", border: "1px solid var(--border-strong)",
              color: "var(--text-1)", borderRadius: 4, fontSize: 11,
              padding: "3px 8px", outline: "none",
              transition: "border-color 0.1s",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border-strong)"; }}
          />

          {filterInput && (
            <button
              onClick={() => { setFilterInput(""); setFilterVal(""); filterInputRef.current?.focus(); }}
              title="Clear"
              style={{
                background: "transparent", border: "none", cursor: "pointer",
                color: "var(--text-3)", padding: "2px 4px", borderRadius: 3,
                display: "flex", alignItems: "center",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-1)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-3)"; }}
            >
              <X size={11} />
            </button>
          )}

          <button
            onClick={closeFilter}
            title="Close filter (Esc)"
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              color: "var(--text-3)", padding: "2px 6px", borderRadius: 3,
              display: "flex", alignItems: "center", fontSize: 10,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-1)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-3)"; }}
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflow: "hidden", position: "relative", display: "flex", flexDirection: "column" }}>
        <div
          key={`${tableName}:${viewMode}`}
          className="content-enter"
          style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
        >
          {viewMode === "grid" || !groupCol ? (
            <DataGrid
              key={tableName}
              workspaceId={workspaceId}
              tableName={tableName}
              columns={columns}
              refreshKey={refreshKey}
              onRowOpen={setPeekRow}
              filterCol={filterVal ? filterCol : undefined}
              filterVal={filterVal || undefined}
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
        </div>

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
