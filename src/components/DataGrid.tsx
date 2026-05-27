import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Download, Plus } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { save } from "@tauri-apps/plugin-dialog";
import { ipc, rowPkValue } from "../ipc";
import type { ColumnInfo } from "../types";
import InsertRowModal from "./InsertRowModal";

const ROW_H = 38;
const PAGE_SIZE = 100;
const COL_MIN = 120;

interface Props {
  workspaceId: string;
  tableName: string;
  columns: ColumnInfo[];
  refreshKey: number;
  onRowOpen: (row: Record<string, unknown>) => void;
  filterCol?: string;
  filterVal?: string;
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
    try { return JSON.stringify(value).slice(0, 120); } catch { return String(value); }
  }
  return String(value);
}

function buildWhere(filterCol: string, filterVal: string): string {
  const safe = filterVal.replace(/'/g, "''").toLowerCase();
  return `WHERE LOWER(CAST("${filterCol}" AS TEXT)) LIKE '%${safe}%'`;
}

function csvEscape(s: string): string {
  return s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")
    ? `"${s.replace(/"/g, '""')}'`
    : s;
}

// Build a SQL literal from a string value + column type, used for composite-PK updates.
function toSqlLiteral(value: string, dataType: string): string {
  if (value === "") return "NULL";
  const t = dataType.toLowerCase();
  if (
    t.includes("int") || t.includes("float") || t === "numeric" ||
    t === "decimal" || t === "real" || t.includes("double")
  ) {
    const n = Number(value);
    return isNaN(n) ? `'${value.replace(/'/g, "''")}'` : String(n);
  }
  if (t === "boolean" || t === "bool") {
    return ["true", "1", "yes"].includes(value.toLowerCase()) ? "TRUE" : "FALSE";
  }
  return `'${value.replace(/'/g, "''")}'`;
}

export default function DataGrid({
  workspaceId,
  tableName,
  columns,
  refreshKey,
  onRowOpen,
  filterCol,
  filterVal,
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
  const [exporting, setExporting] = useState(false);
  const [showInsert, setShowInsert] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const offsetRef = useRef(0);

  // Resizable columns
  const [widths, setWidths] = useState<number[]>(() => columns.map(colWidth));
  const containerWidthRef = useRef(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const initializedRef = useRef(false);

  // Column resize hover/active tracking - drives column-wide border highlight
  const [hoverResizeCol, setHoverResizeCol] = useState<number | null>(null);
  const [resizingCol, setResizingCol] = useState<number | null>(null);

  // Primary key info
  const pkCols = useMemo(() => columns.filter((c) => c.is_primary_key), [columns]);
  const hasPk = pkCols.length > 0;

  const loadPage = useCallback(
    async (offset: number, reset: boolean) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        if (filterVal && filterCol) {
          const where = buildWhere(filterCol, filterVal);
          const order = sortCol ? ` ORDER BY "${sortCol}" ${sortAsc ? "ASC" : "DESC"}` : "";
          const [counts, data] = await Promise.all([
            ipc.executeQuery(workspaceId, `SELECT COUNT(*) as c FROM "${tableName}" ${where}`),
            ipc.executeQuery(workspaceId, `SELECT * FROM "${tableName}" ${where}${order} LIMIT ${PAGE_SIZE} OFFSET ${offset}`),
          ]);
          const total = Number(counts[0]?.c ?? 0);
          if (reset) setRows(data);
          else setRows((p) => [...p, ...data]);
          setTotalCount(total);
          offsetRef.current = offset + data.length;
        } else {
          const page = await ipc.queryTable(workspaceId, tableName, offset, PAGE_SIZE, sortCol, sortAsc);
          if (reset) setRows(page.rows);
          else setRows((p) => [...p, ...page.rows]);
          setTotalCount(page.total_count);
          offsetRef.current = offset + page.rows.length;
        }
      } catch (e) {
        console.error(e);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [workspaceId, tableName, sortCol, sortAsc, filterCol, filterVal]
  );

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

  useEffect(() => {
    const items = rowVirtualizer.getVirtualItems();
    if (!items.length) return;
    const last = items[items.length - 1];
    if (last.index >= rows.length - 10 && rows.length < totalCount && !loadingRef.current) {
      loadPage(offsetRef.current, false);
    }
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (editing) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA") return;
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

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const cw = entry.contentRect.width;
      containerWidthRef.current = cw;
      setContainerWidth(cw);
      if (!initializedRef.current && cw > 0) {
        initializedRef.current = true;
        const natural = columns.map(colWidth);
        const sum = natural.reduce((a, b) => a + b, 0);
        const available = cw - 48;
        if (available > 0 && sum < available) {
          setWidths(natural.map((w) => Math.floor(w * (available / sum))));
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const adjustedWidths = useMemo(() => {
    if (!widths.length) return widths;
    const sum = widths.reduce((a, b) => a + b, 0);
    const available = containerWidth - 48;
    if (containerWidth > 0 && sum < available) {
      const extra = available - sum;
      return widths.map((w, i) => (i === widths.length - 1 ? w + extra : w));
    }
    return widths;
  }, [widths, containerWidth]);

  const handleResizeMouseDown = (e: React.MouseEvent, targetIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widths[targetIdx];
    setResizingCol(targetIdx);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      const newW = Math.max(COL_MIN, startW + (ev.clientX - startX));
      setWidths((prev) => prev.map((w, i) => (i === targetIdx ? newW : w)));
    };
    const onUp = () => {
      setResizingCol(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startEdit = (rowIdx: number, colName: string, currentVal: unknown) => {
    setEditing({ rowIdx, colName });
    setEditVal(currentVal == null ? "" : String(currentVal));
    setTimeout(() => editInputRef.current?.focus(), 0);
  };

  const commitEdit = async () => {
    if (!editing) return;
    const row = rows[editing.rowIdx];
    const col = columns.find((c) => c.name === editing.colName);
    if (!col || !hasPk) { setEditing(null); return; }

    const oldVal = row[editing.colName];
    if (String(oldVal) === editVal) { setEditing(null); return; }

    setRows((prev) =>
      prev.map((r, i) => (i === editing.rowIdx ? { ...r, [editing.colName]: editVal } : r))
    );
    try {
      if (pkCols.length === 1) {
        const pk = rowPkValue(row, columns);
        await ipc.updateRow(workspaceId, tableName, pkCols[0].name, pk, editing.colName, editVal, col.data_type);
      } else {
        // Composite PK - build raw SQL
        const where = pkCols
          .map((pk) => `"${pk.name}" = ${toSqlLiteral(String(row[pk.name] ?? ""), pk.data_type)}`)
          .join(" AND ");
        const newLiteral = toSqlLiteral(editVal, col.data_type);
        await ipc.executeQuery(
          workspaceId,
          `UPDATE "${tableName}" SET "${editing.colName}" = ${newLiteral} WHERE ${where}`
        );
      }
    } catch (e) {
      setRows((prev) =>
        prev.map((r, i) => (i === editing.rowIdx ? { ...r, [editing.colName]: oldVal } : r))
      );
      console.error(e);
    }
    setEditing(null);
  };

  const handleSort = (colName: string) => {
    if (sortCol === colName) setSortAsc((prev) => !prev);
    else { setSortCol(colName); setSortAsc(true); }
  };

  const handleExport = async () => {
    const path = await save({
      filters: [{ name: "CSV", extensions: ["csv"] }],
      defaultPath: `${tableName}.csv`,
    });
    if (!path) return;
    setExporting(true);
    try {
      const where = filterVal && filterCol ? buildWhere(filterCol, filterVal) : "";
      const order = sortCol ? ` ORDER BY "${sortCol}" ${sortAsc ? "ASC" : "DESC"}` : "";
      const allRows = await ipc.executeQuery(
        workspaceId,
        `SELECT * FROM "${tableName}" ${where}${order} LIMIT 100000`
      );
      const header = columns.map((c) => csvEscape(c.name)).join(",");
      const body = allRows
        .map((row) =>
          columns.map((c) => (row[c.name] == null ? "" : csvEscape(String(row[c.name])))).join(",")
        )
        .join("\n");
      await ipc.saveFile(path, "﻿" + header + "\n" + body);
    } catch (e) {
      console.error(e);
    } finally {
      setExporting(false);
    }
  };

  const totalWidth = Math.max(
    containerWidth || 0,
    48 + (adjustedWidths.length ? adjustedWidths.reduce((a, b) => a + b, 0) : 0)
  );

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, width: "100%", position: "relative" }}>
        <div
          ref={scrollRef}
          style={{ overflow: "auto", flex: 1, width: "100%", position: "relative" }}
        >
          <table style={{ borderCollapse: "collapse", tableLayout: "fixed", width: totalWidth }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
              <tr style={{ background: "var(--bg-1)" }}>
                <th style={{ width: 48, minWidth: 48 }} />
                {columns.map((col, i) => {
                  const colActive = hoverResizeCol === i || resizingCol === i;
                  return (
                    <th
                      key={col.name}
                      style={{
                        width: adjustedWidths[i] ?? COL_MIN,
                        padding: "8px 10px", textAlign: "left",
                        fontWeight: 500, fontSize: 11, color: "var(--text-2)",
                        borderBottom: "1px solid var(--border-strong)",
                        borderRight: colActive ? "1px solid var(--accent)" : "1px solid var(--border)",
                        cursor: "pointer", userSelect: "none",
                        whiteSpace: "nowrap", overflow: "hidden", position: "relative",
                        transition: "border-color 0.08s",
                      }}
                      onClick={() => handleSort(col.name)}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {col.is_primary_key && (
                          <span title="Primary key" style={{ fontSize: 9, color: "var(--yellow)", fontWeight: 700 }}>PK</span>
                        )}
                        <span>{col.name}</span>
                        <span className={typeBadgeClass(col.data_type)}>{col.data_type.slice(0, 12)}</span>
                        {sortCol === col.name && (
                          <span style={{ fontSize: 9, color: "var(--accent)" }}>{sortAsc ? "▲" : "▼"}</span>
                        )}
                      </span>
                      {i < columns.length - 1 && (
                        <div
                          onMouseDown={(e) => handleResizeMouseDown(e, i)}
                          onClick={(e) => e.stopPropagation()}
                          onMouseEnter={() => setHoverResizeCol(i)}
                          onMouseLeave={() => setHoverResizeCol(null)}
                          style={{
                            position: "absolute", right: 0, top: 0, bottom: 0,
                            width: 5, cursor: "col-resize", zIndex: 2,
                          }}
                        />
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {rowVirtualizer.getVirtualItems().length > 0 && (
                <tr style={{ height: rowVirtualizer.getVirtualItems()[0].start }} />
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
                        ? "var(--bg-2)"
                        : "transparent",
                      borderBottom: "1px solid var(--border)",
                      cursor: "default",
                    }}
                  >
                    <td style={{ width: 48, textAlign: "center", borderRight: "1px solid var(--border)" }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); onRowOpen(row); }}
                        title="Open row"
                        style={{
                          background: "transparent", border: "none", cursor: "pointer",
                          color: "var(--text-3)", fontSize: 12, padding: "2px 6px", borderRadius: 3,
                        }}
                        onMouseOver={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--accent)")}
                        onMouseOut={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text-3)")}
                      >
                        <ArrowUpRight size={13} />
                      </button>
                    </td>

                    {columns.map((col, ci) => {
                      const isEditing = editing?.rowIdx === vRow.index && editing?.colName === col.name;
                      const val = row[col.name];
                      const isPk = col.is_primary_key;
                      const isBool = col.data_type === "boolean" || col.data_type === "bool";
                      const colActive = hoverResizeCol === ci || resizingCol === ci;

                      return (
                        <td
                          key={col.name}
                          onDoubleClick={() => hasPk && !isPk && startEdit(vRow.index, col.name, val)}
                          style={{
                            width: adjustedWidths[ci] ?? COL_MIN,
                            maxWidth: adjustedWidths[ci] ?? COL_MIN,
                            padding: "0 10px", fontSize: 12,
                            color: val === null || val === undefined ? "var(--text-3)" : "var(--text-1)",
                            borderRight: colActive ? "1px solid var(--accent)" : "1px solid var(--border)",
                            overflow: "hidden",
                            textOverflow: isEditing ? "clip" : "ellipsis",
                            whiteSpace: "nowrap",
                            fontFamily:
                              col.data_type === "uuid" || col.data_type === "jsonb" || col.data_type === "json"
                                ? "var(--font-mono, monospace)"
                                : "inherit",
                            cursor: hasPk && !isPk ? "text" : "default",
                            position: "relative",
                            transition: "border-color 0.08s",
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
                                width: "100%", background: "var(--bg-3)",
                                border: "1px solid var(--accent)", borderRadius: 3,
                                color: "var(--text-1)", fontSize: 12,
                                padding: "2px 4px", outline: "none",
                              }}
                            />
                          ) : isBool ? (
                            <span style={{
                              display: "inline-block", width: 14, height: 14,
                              borderRadius: 3, border: "1px solid var(--bg-4)",
                              background: val ? "var(--accent)" : "transparent",
                              verticalAlign: "middle",
                            }} />
                          ) : val === null || val === undefined ? (
                            <span style={{ fontStyle: "italic", opacity: 0.4 }}>null</span>
                          ) : (
                            formatCell(val, col.data_type)
                          )}
                          {ci < columns.length - 1 && (
                            <div
                              onMouseDown={(e) => handleResizeMouseDown(e, ci)}
                              onClick={(e) => e.stopPropagation()}
                              onMouseEnter={() => setHoverResizeCol(ci)}
                              onMouseLeave={() => setHoverResizeCol(null)}
                              style={{
                                position: "absolute", right: 0, top: 0, bottom: 0,
                                width: 5, cursor: "col-resize", zIndex: 2,
                              }}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

              {rowVirtualizer.getVirtualItems().length > 0 && (
                <tr style={{
                  height:
                    rowVirtualizer.getTotalSize() -
                    (rowVirtualizer.getVirtualItems().at(-1)?.end ?? 0),
                }} />
              )}
            </tbody>
          </table>
        </div>

        {hasPk && (
          <button
            onClick={() => setShowInsert(true)}
            title="Insert new row"
            style={{
              position: "absolute", bottom: 54, right: 24, zIndex: 20,
              display: "flex", alignItems: "center", gap: 5,
              background: "#5b9cf6", color: "#fff",
              border: "none", borderRadius: 7,
              fontSize: 12, fontWeight: 600,
              padding: "8px 16px", cursor: "pointer",
              boxShadow: "0 4px 16px rgba(91,156,246,0.35)",
              transition: "background 0.12s, transform 0.1s, box-shadow 0.1s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "#4a8de6";
              (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
              (e.currentTarget as HTMLElement).style.boxShadow = "0 6px 20px rgba(91,156,246,0.45)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "#5b9cf6";
              (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
              (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px rgba(91,156,246,0.35)";
            }}
          >
            <Plus size={11} /> New row
          </button>
        )}

        <div style={{
          flexShrink: 0, background: "var(--bg-1)", borderTop: "1px solid var(--border)",
          padding: "9px 14px", fontSize: 11, color: "var(--text-3)",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <span>{rows.length.toLocaleString()} / {totalCount.toLocaleString()} rows</span>
          {!hasPk && (
            <span style={{ color: "var(--yellow)", fontSize: 10 }}>no primary key - read-only</span>
          )}
          {pkCols.length > 1 && (
            <span style={{ color: "var(--text-3)", fontSize: 10 }}>composite PK</span>
          )}
          {filterVal && <span style={{ color: "var(--accent)" }}>filtered</span>}
          {loading && <span style={{ color: "var(--accent)" }}>Loading…</span>}

          <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
            <button
              onClick={handleExport}
              disabled={exporting}
              title="Export to CSV (max 100 000 rows)"
              style={{
                display: "flex", alignItems: "center", gap: 5,
                background: "transparent", border: "1px solid var(--border)",
                color: exporting ? "var(--text-3)" : "var(--text-2)",
                borderRadius: 4, fontSize: 11, padding: "2px 8px",
                cursor: exporting ? "default" : "pointer",
                transition: "border-color 0.1s, color 0.1s",
              }}
              onMouseEnter={(e) => {
                if (!exporting) {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)";
                  (e.currentTarget as HTMLElement).style.color = "var(--accent)";
                }
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
                (e.currentTarget as HTMLElement).style.color = exporting ? "var(--text-3)" : "var(--text-2)";
              }}
            >
              <Download size={11} />
              {exporting ? "Exporting…" : "Export CSV"}
            </button>
          </div>
        </div>
      </div>

      {showInsert && (
        <InsertRowModal
          workspaceId={workspaceId}
          tableName={tableName}
          columns={columns}
          onClose={() => setShowInsert(false)}
          onInserted={() => { offsetRef.current = 0; loadPage(0, true); }}
        />
      )}
    </>
  );
}
