import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ipc, rowPkValue } from "../ipc";
import type { ColumnInfo } from "../types";

const ROW_H = 38;
const PAGE_SIZE = 100;
const COL_MIN = 120;
const COL_MAX = 320;

interface Props {
  workspaceId: string;
  tableName: string;
  columns: ColumnInfo[];
  refreshKey: number;
  onRowOpen: (row: Record<string, unknown>) => void;
}

function colWidth(col: ColumnInfo): number {
  const t = col.data_type.toLowerCase();
  if (t === "uuid") return 300;
  if (t.includes("timestamp")) return 220;
  if (t === "boolean" || t === "bool") return 90;
  if (t.includes("int") || t.includes("float") || t === "numeric") return 110;
  if (t === "jsonb" || t === "json") return 200;
  return 160;
}

function typeBadgeClass(dt: string): string {
  const t = dt.toLowerCase();
  if (t === "boolean" || t === "bool") return "type-badge type-boolean";
  if (t.includes("int") || t.includes("float") || t === "numeric" || t === "decimal") return "type-badge type-number";
  if (t.includes("timestamp") || t === "date") return "type-badge type-date";
  if (t === "jsonb" || t === "json") return "type-badge type-json";
  if (t === "uuid") return "type-badge type-uuid";
  if (t === "text" || t.includes("char") || t === "varchar") return "type-badge type-text";
  return "type-badge type-default";
}

function formatCell(value: unknown, dt: string): string {
  if (value === null || value === undefined) return "";
  const t = dt.toLowerCase();
  if (t === "boolean" || t === "bool") return value ? "true" : "false";
  if (t === "jsonb" || t === "json") {
    try {
      return JSON.stringify(value).slice(0, 120);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export default function DataGrid({
  workspaceId,
  tableName,
  columns,
  refreshKey,
  onRowOpen,
}: Props) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sortCol, setSortCol] = useState<string | undefined>();
  const [sortAsc, setSortAsc] = useState(true);
  const [editing, setEditing] = useState<{ rowIdx: number; colName: string } | null>(null);
  const [editVal, setEditVal] = useState("");
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const offsetRef = useRef(0);

  const colWidths = columns.map(colWidth);

  const loadPage = useCallback(
    async (offset: number, reset: boolean) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const page = await ipc.queryTable(
          workspaceId,
          tableName,
          offset,
          PAGE_SIZE,
          sortCol,
          sortAsc
        );
        if (reset) {
          setRows(page.rows);
        } else {
          setRows((prev) => [...prev, ...page.rows]);
        }
        setTotalCount(page.total_count);
        offsetRef.current = offset + page.rows.length;
      } catch (e) {
        console.error(e);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [workspaceId, tableName, sortCol, sortAsc]
  );

  // Reload when table/sort changes or external file change detected
  useEffect(() => {
    offsetRef.current = 0;
    setRows([]);
    setSelectedRow(null);
    loadPage(0, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, tableName, sortCol, sortAsc, loadPage, refreshKey]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 8,
  });

  // Infinite scroll
  useEffect(() => {
    const items = rowVirtualizer.getVirtualItems();
    if (!items.length) return;
    const last = items[items.length - 1];
    if (
      last.index >= rows.length - 10 &&
      rows.length < totalCount &&
      !loadingRef.current
    ) {
      loadPage(offsetRef.current, false);
    }
  });

  // Keyboard nav
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (editing) return;
      if (e.key === "ArrowDown" && selectedRow !== null) {
        setSelectedRow(Math.min(selectedRow + 1, rows.length - 1));
      } else if (e.key === "ArrowUp" && selectedRow !== null) {
        setSelectedRow(Math.max(selectedRow - 1, 0));
      } else if (e.key === "Escape") {
        setSelectedRow(null);
      } else if (e.key === "Enter" && selectedRow !== null) {
        onRowOpen(rows[selectedRow]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editing, selectedRow, rows, onRowOpen]);

  const startEdit = (rowIdx: number, colName: string, currentVal: unknown) => {
    setEditing({ rowIdx, colName });
    setEditVal(currentVal == null ? "" : String(currentVal));
    setTimeout(() => editInputRef.current?.focus(), 0);
  };

  const commitEdit = async () => {
    if (!editing) return;
    const row = rows[editing.rowIdx];
    const col = columns.find((c) => c.name === editing.colName);
    if (!col) {
      setEditing(null);
      return;
    }
    const pk = rowPkValue(row, columns);
    const pkCol = columns.find((c) => c.is_primary_key);
    if (!pkCol || !pk) {
      setEditing(null);
      return;
    }
    const oldVal = row[editing.colName];
    if (String(oldVal) !== editVal) {
      // Optimistic update
      setRows((prev) =>
        prev.map((r, i) =>
          i === editing.rowIdx ? { ...r, [editing.colName]: editVal } : r
        )
      );
      try {
        await ipc.updateRow(
          workspaceId,
          tableName,
          pkCol.name,
          pk,
          editing.colName,
          editVal,
          col.data_type
        );
      } catch (e) {
        // Rollback
        setRows((prev) =>
          prev.map((r, i) =>
            i === editing.rowIdx ? { ...r, [editing.colName]: oldVal } : r
          )
        );
        console.error(e);
      }
    }
    setEditing(null);
  };

  const handleSort = (colName: string) => {
    if (sortCol === colName) {
      setSortAsc((prev) => !prev);
    } else {
      setSortCol(colName);
      setSortAsc(true);
    }
  };

  const totalWidth = 48 + colWidths.reduce((a, b) => a + b, 0);

  return (
    <div
      ref={scrollRef}
      style={{
        overflow: "auto",
        height: "100%",
        width: "100%",
        position: "relative",
      }}
    >
      <table
        style={{
          borderCollapse: "collapse",
          minWidth: totalWidth,
          tableLayout: "fixed",
          width: totalWidth,
        }}
      >
        {/* Sticky header */}
        <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
          <tr style={{ background: "var(--bg-1)" }}>
            {/* Row actions col */}
            <th style={{ width: 48, minWidth: 48 }} />
            {columns.map((col, i) => (
              <th
                key={col.name}
                style={{
                  width: colWidths[i],
                  padding: "8px 10px",
                  textAlign: "left",
                  fontWeight: 500,
                  fontSize: 11,
                  color: "var(--text-2)",
                  borderBottom: "1px solid var(--border-strong)",
                  borderRight: "1px solid var(--border)",
                  cursor: "pointer",
                  userSelect: "none",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                }}
                onClick={() => handleSort(col.name)}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {col.is_primary_key && (
                    <span
                      title="Primary key"
                      style={{
                        fontSize: 9,
                        color: "var(--yellow)",
                        fontWeight: 700,
                      }}
                    >
                      PK
                    </span>
                  )}
                  <span>{col.name}</span>
                  <span className={typeBadgeClass(col.data_type)}>
                    {col.data_type.slice(0, 12)}
                  </span>
                  {sortCol === col.name && (
                    <span style={{ fontSize: 9, color: "var(--accent)" }}>
                      {sortAsc ? "▲" : "▼"}
                    </span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>

        {/* Virtual rows */}
        <tbody>
          {/* Spacer before visible rows */}
          {rowVirtualizer.getVirtualItems().length > 0 && (
            <tr
              style={{
                height:
                  rowVirtualizer.getVirtualItems()[0].start,
              }}
            />
          )}

          {rowVirtualizer.getVirtualItems().map((vRow) => {
            const row = rows[vRow.index];
            const isSelected = selectedRow === vRow.index;

            return (
              <tr
                key={vRow.key}
                data-index={vRow.index}
                onClick={() => setSelectedRow(vRow.index)}
                onMouseEnter={() => setHoveredRow(vRow.index)}
                onMouseLeave={() => setHoveredRow(null)}
                style={{
                  height: ROW_H,
                  background: isSelected
                    ? "var(--accent-subtle)"
                    : hoveredRow === vRow.index
                    ? "rgba(255,255,255,0.025)"
                    : "transparent",
                  borderBottom: "1px solid var(--border)",
                  cursor: "default",
                }}
              >
                {/* Open button */}
                <td
                  style={{
                    width: 48,
                    textAlign: "center",
                    borderRight: "1px solid var(--border)",
                  }}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRowOpen(row);
                    }}
                    title="Open row"
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--text-3)",
                      fontSize: 12,
                      padding: "2px 6px",
                      borderRadius: 3,
                    }}
                    onMouseOver={(e) =>
                      ((e.currentTarget as HTMLElement).style.color =
                        "var(--accent)")
                    }
                    onMouseOut={(e) =>
                      ((e.currentTarget as HTMLElement).style.color =
                        "var(--text-3)")
                    }
                  >
                    <ArrowUpRight size={13} />
                  </button>
                </td>

                {columns.map((col, ci) => {
                  const isEditing =
                    editing?.rowIdx === vRow.index &&
                    editing?.colName === col.name;
                  const val = row[col.name];
                  const isPk = col.is_primary_key;
                  const isBool =
                    col.data_type === "boolean" ||
                    col.data_type === "bool";

                  return (
                    <td
                      key={col.name}
                      onDoubleClick={() =>
                        !isPk && startEdit(vRow.index, col.name, val)
                      }
                      style={{
                        width: colWidths[ci],
                        maxWidth: colWidths[ci],
                        padding: "0 10px",
                        fontSize: 12,
                        color:
                          val === null || val === undefined
                            ? "var(--text-3)"
                            : "var(--text-1)",
                        borderRight: "1px solid var(--border)",
                        overflow: "hidden",
                        textOverflow: isEditing ? "clip" : "ellipsis",
                        whiteSpace: "nowrap",
                        fontFamily:
                          col.data_type === "uuid" ||
                          col.data_type === "jsonb" ||
                          col.data_type === "json"
                            ? "var(--font-mono, monospace)"
                            : "inherit",
                        cursor: isPk ? "default" : "text",
                      }}
                    >
                      {isEditing ? (
                        <input
                          ref={editInputRef}
                          value={editVal}
                          onChange={(e) => setEditVal(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitEdit();
                            if (e.key === "Escape") setEditing(null);
                          }}
                          style={{
                            width: "100%",
                            background: "var(--bg-3)",
                            border: "1px solid var(--accent)",
                            borderRadius: 3,
                            color: "var(--text-1)",
                            fontSize: 12,
                            padding: "2px 4px",
                            outline: "none",
                          }}
                        />
                      ) : isBool ? (
                        <span
                          style={{
                            display: "inline-block",
                            width: 14,
                            height: 14,
                            borderRadius: 3,
                            border: "1px solid var(--bg-4)",
                            background: val ? "var(--accent)" : "transparent",
                            verticalAlign: "middle",
                          }}
                        />
                      ) : val === null || val === undefined ? (
                        <span style={{ fontStyle: "italic", opacity: 0.4 }}>
                          null
                        </span>
                      ) : (
                        formatCell(val, col.data_type)
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}

          {/* Spacer after visible rows */}
          {rowVirtualizer.getVirtualItems().length > 0 && (
            <tr
              style={{
                height:
                  rowVirtualizer.getTotalSize() -
                  (rowVirtualizer.getVirtualItems().at(-1)?.end ?? 0),
              }}
            />
          )}
        </tbody>
      </table>

      {/* Status bar */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          left: 0,
          background: "var(--bg-1)",
          borderTop: "1px solid var(--border)",
          padding: "5px 14px",
          fontSize: 11,
          color: "var(--text-3)",
          display: "flex",
          gap: 12,
        }}
      >
        <span>
          {rows.length.toLocaleString()} / {totalCount.toLocaleString()} rows
        </span>
        {loading && <span style={{ color: "var(--accent)" }}>Loading…</span>}
      </div>
    </div>
  );
}
