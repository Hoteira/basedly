import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { ipc, rowPkValue } from "../ipc";
import type { ColumnInfo } from "../types";
import StatusBar from "./StatusBar";

interface Props {
  workspaceId: string;
  tableName: string;
  columns: ColumnInfo[];
  groupCol: ColumnInfo;
  onCardOpen: (row: Record<string, unknown>) => void;
  onGroupColChange: (col: ColumnInfo) => void;
}

const CardContent = memo(function CardContent({
  row,
  columns,
  onOpen,
}: {
  row: Record<string, unknown>;
  columns: ColumnInfo[];
  onOpen: () => void;
}) {
  const displayCols = columns.filter((c) => !c.is_primary_key).slice(0, 3);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {displayCols.map((col) => {
        const val = row[col.name];
        return (
          <div key={col.name}>
            <div style={{ fontSize: 9, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>
              {col.name}
            </div>
            <div style={{ fontSize: 12, color: val == null ? "var(--text-3)" : "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontStyle: val == null ? "italic" : "normal" }}>
              {val == null ? "null" : String(val).slice(0, 60)}
            </div>
          </div>
        );
      })}
      <button
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        style={{ alignSelf: "flex-end", background: "transparent", border: "none", cursor: "pointer", color: "var(--text-3)", fontSize: 10, padding: "2px 0" }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 3 }}><ArrowUpRight size={11} /> open</span>
      </button>
    </div>
  );
});

function DraggableCard({
  id,
  row,
  columns,
  onCardOpen,
}: {
  id: string;
  row: Record<string, unknown>;
  columns: ColumnInfo[];
  onCardOpen: (row: Record<string, unknown>) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  const onOpen = useCallback(() => onCardOpen(row), [onCardOpen, row]);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className="kanban-card"
      style={{ opacity: isDragging ? 0 : 1, touchAction: "none" }}
    >
      <CardContent row={row} columns={columns} onOpen={onOpen} />
    </div>
  );
}

function DroppableLane({
  id,
  lane,
  count,
  children,
}: {
  id: string;
  lane: string;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        minWidth: 260,
        maxWidth: 260,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "var(--bg-2)",
        borderRadius: 10,
        padding: 14,
        border: `1px solid ${isOver ? "var(--accent)" : "var(--border)"}`,
        transition: "border-color 0.12s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>{lane}</span>
        <span style={{ fontSize: 10, color: "var(--text-3)", background: "var(--bg-3)", borderRadius: 10, padding: "1px 7px" }}>
          {count}
        </span>
      </div>
      {children}
    </div>
  );
}

const measuring = {
  droppable: { strategy: MeasuringStrategy.BeforeDragging },
};

export default function KanbanBoard({
  workspaceId,
  tableName,
  columns,
  groupCol,
  onCardOpen,
  onGroupColChange,
}: Props) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  const nonPkCols = useMemo(() => columns.filter(c => !c.is_primary_key), [columns]);
  const pkCol = columns.find((c) => c.is_primary_key);

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) closeMenu();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen, closeMenu]);

  const laneValues = useMemo(() => {
    if (groupCol.enum_values?.length) return groupCol.enum_values;
    const seen = new Set<string>();
    const result: string[] = [];
    for (const row of rows) {
      const v = String(row[groupCol.name] ?? "");
      if (v && !seen.has(v)) { seen.add(v); result.push(v); }
    }
    return result.sort();
  }, [rows, groupCol]);

  useEffect(() => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    ipc
      .queryTable(workspaceId, tableName, 0, 500)
      .then((page) => { setRows(page.rows); setTotalCount(page.total_count); })
      .catch(console.error)
      .finally(() => { loadingRef.current = false; setLoading(false); });
  }, [workspaceId, tableName]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const getRowId = useCallback(
    (row: Record<string, unknown>) => pkCol ? String(row[pkCol.name] ?? "") : "",
    [pkCol]
  );

  const activeRow = useMemo(
    () => activeId ? rows.find((r) => getRowId(r) === activeId) ?? null : null,
    [activeId, rows, getRowId]
  );

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setActiveId(String(e.active.id));
  }, []);

  const handleDragEnd = useCallback(async (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over || !pkCol) return;

    const overId = String(over.id);
    const targetLane = laneValues.find((v) => `lane-${v}` === overId);
    if (!targetLane) return;

    const draggedRow = rows.find((r) => getRowId(r) === String(active.id));
    if (!draggedRow) return;
    if (String(draggedRow[groupCol.name]) === targetLane) return;

    const pk = rowPkValue(draggedRow, columns);

    setRows((prev) =>
      prev.map((r) => getRowId(r) === String(active.id) ? { ...r, [groupCol.name]: targetLane } : r)
    );

    try {
      await ipc.updateRow(workspaceId, tableName, pkCol.name, pk, groupCol.name, targetLane, groupCol.data_type);
    } catch (e) {
      setRows((prev) =>
        prev.map((r) => getRowId(r) === String(active.id) ? { ...r, [groupCol.name]: draggedRow[groupCol.name] } : r)
      );
      console.error(e);
    }
  }, [pkCol, laneValues, rows, getRowId, groupCol, columns, workspaceId, tableName]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-3)", fontSize: 12 }}>
        Loading board…
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      measuring={measuring}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 16, padding: 20, overflow: "auto", alignItems: "flex-start" }}>
          {laneValues.map((lane) => {
            const laneRows = rows.filter((r) => String(r[groupCol.name] ?? "") === lane);

            return (
              <DroppableLane key={lane} id={`lane-${lane}`} lane={lane} count={laneRows.length}>
                {laneRows.map((row) => {
                  const id = getRowId(row);
                  return (
                    <DraggableCard
                      key={id}
                      id={id}
                      row={row}
                      columns={columns}
                      onCardOpen={onCardOpen}
                    />
                  );
                })}
                {laneRows.length === 0 && (
                  <div style={{ fontSize: 11, color: "var(--text-3)", textAlign: "center", padding: "12px 0", borderRadius: 6, border: "1px dashed var(--border)" }}>
                    Drop cards here
                  </div>
                )}
              </DroppableLane>
            );
          })}
        </div>

        <StatusBar>
          <span>{rows.length} / {totalCount} rows · grouped by</span>

          <div ref={menuRef} style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
            <button
              onClick={() => setMenuOpen(v => !v)}
              style={{ background: "transparent", border: "1px solid var(--border)", cursor: "pointer", color: "var(--accent)", fontSize: 11, padding: "3px 8px", borderRadius: 4 }}
            >
              {groupCol.name} ▴
            </button>

            {menuOpen && (
              <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, background: "var(--bg-2)", border: "1px solid var(--border-strong)", borderRadius: 7, padding: "4px 0", minWidth: 180, maxHeight: 240, overflowY: "auto", zIndex: 200, boxShadow: "0 6px 20px rgba(0,0,0,0.35)" }}>
                {nonPkCols.map(col => (
                  <button
                    key={col.name}
                    onClick={() => { onGroupColChange(col); closeMenu(); }}
                    style={{ display: "flex", alignItems: "center", width: "100%", textAlign: "left", padding: "6px 12px", background: col.name === groupCol.name ? "var(--bg-3)" : "transparent", border: "none", cursor: "pointer", color: col.name === groupCol.name ? "var(--text-1)" : "var(--text-2)", fontSize: 12, gap: 8 }}
                  >
                    {col.name === groupCol.name && <span style={{ color: "var(--accent)", fontSize: 9 }}>✓</span>}
                    {col.name !== groupCol.name && <span style={{ width: 12 }} />}
                    {col.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {totalCount > 500 && (
            <span style={{ marginLeft: 4, color: "var(--yellow)", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <AlertTriangle size={11} /> showing first 500
            </span>
          )}
        </StatusBar>
      </div>

      <DragOverlay>
        {activeRow && (
          <div className="kanban-card" style={{ opacity: 0.95, boxShadow: "0 8px 24px rgba(0,0,0,0.5)", cursor: "grabbing" }}>
            <CardContent row={activeRow} columns={columns} onOpen={() => {}} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
