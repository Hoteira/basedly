import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { ipc, rowPkValue } from "../ipc";
import type { ColumnInfo } from "../types";

interface Props {
  workspaceId: string;
  tableName: string;
  columns: ColumnInfo[];
  groupCol: ColumnInfo;
  onCardOpen: (row: Record<string, unknown>) => void;
  onGroupColChange: (col: ColumnInfo) => void;
}

function CardContent({
  row,
  columns,
  onOpen,
}: {
  row: Record<string, unknown>;
  columns: ColumnInfo[];
  onOpen: () => void;
}) {
  // Show first 3 non-PK, non-enum fields
  const displayCols = columns.filter((c) => !c.is_primary_key).slice(0, 3);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {displayCols.map((col) => {
        const val = row[col.name];
        return (
          <div key={col.name}>
            <div
              style={{
                fontSize: 9,
                color: "var(--text-3)",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 2,
              }}
            >
              {col.name}
            </div>
            <div
              style={{
                fontSize: 12,
                color: val == null ? "var(--text-3)" : "var(--text-1)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontStyle: val == null ? "italic" : "normal",
              }}
            >
              {val == null ? "null" : String(val).slice(0, 60)}
            </div>
          </div>
        );
      })}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        style={{
          alignSelf: "flex-end",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--text-3)",
          fontSize: 10,
          padding: "2px 0",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 3 }}><ArrowUpRight size={11} /> open</span>
      </button>
    </div>
  );
}

function SortableCard({
  id,
  row,
  columns,
  onOpen,
}: {
  id: string;
  row: Record<string, unknown>;
  columns: ColumnInfo[];
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`kanban-card${isDragging ? " dragging" : ""}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      <CardContent row={row} columns={columns} onOpen={onOpen} />
    </div>
  );
}

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

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) closeMenu();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen, closeMenu]);

  const pkCol = columns.find((c) => c.is_primary_key);

  // Use declared enum values if available; otherwise derive from loaded rows
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
      .then((page) => {
        setRows(page.rows);
        setTotalCount(page.total_count);
      })
      .catch(console.error)
      .finally(() => {
        loadingRef.current = false;
        setLoading(false);
      });
  }, [workspaceId, tableName]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const getRowId = (row: Record<string, unknown>) =>
    pkCol ? String(row[pkCol.name] ?? "") : "";

  const activeRow = activeId
    ? rows.find((r) => getRowId(r) === activeId)
    : null;

  const handleDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;

    const overId = String(over.id);
    // Check if dropped on a lane (enum value) rather than a card
    const targetLane = laneValues.find((v) => `lane-${v}` === overId);
    const cardLane = targetLane ?? (() => {
      // Find which lane the over-card belongs to
      const overRow = rows.find((r) => getRowId(r) === overId);
      return overRow ? String(overRow[groupCol.name] ?? "") : null;
    })();

    if (!cardLane) return;

    const draggedRow = rows.find((r) => getRowId(r) === String(active.id));
    if (!draggedRow) return;
    if (String(draggedRow[groupCol.name]) === cardLane) return;

    if (!pkCol) return;
    const pk = rowPkValue(draggedRow, columns);

    // Optimistic update
    setRows((prev) =>
      prev.map((r) =>
        getRowId(r) === String(active.id)
          ? { ...r, [groupCol.name]: cardLane }
          : r
      )
    );

    try {
      await ipc.updateRow(
        workspaceId,
        tableName,
        pkCol.name,
        pk,
        groupCol.name,
        cardLane,
        groupCol.data_type
      );
    } catch (e) {
      // Rollback
      setRows((prev) =>
        prev.map((r) =>
          getRowId(r) === String(active.id)
            ? { ...r, [groupCol.name]: draggedRow[groupCol.name] }
            : r
        )
      );
      console.error(e);
    }
  };

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "var(--text-3)",
          fontSize: 12,
        }}
      >
        Loading board…
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          flex: 1,
          display: "flex",
          gap: 16,
          padding: 20,
          overflow: "auto",
          alignItems: "flex-start",
        }}
      >
        {laneValues.map((lane) => {
          const laneRows = rows.filter(
            (r) => String(r[groupCol.name] ?? "") === lane
          );
          const ids = laneRows.map(getRowId);

          return (
            <div
              key={lane}
              id={`lane-${lane}`}
              style={{
                minWidth: 260,
                maxWidth: 260,
                display: "flex",
                flexDirection: "column",
                gap: 10,
                background: "var(--bg-2)",
                borderRadius: 10,
                padding: 14,
                border: "1px solid var(--border)",
              }}
            >
              {/* Lane header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text-1)",
                  }}
                >
                  {lane}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: "var(--text-3)",
                    background: "var(--bg-3)",
                    borderRadius: 10,
                    padding: "1px 7px",
                  }}
                >
                  {laneRows.length}
                </span>
              </div>

              {/* Cards */}
              <SortableContext
                items={ids}
                strategy={verticalListSortingStrategy}
              >
                {laneRows.map((row) => {
                  const id = getRowId(row);
                  return (
                    <SortableCard
                      key={id}
                      id={id}
                      row={row}
                      columns={columns}
                      onOpen={() => onCardOpen(row)}
                    />
                  );
                })}
              </SortableContext>

              {laneRows.length === 0 && (
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-3)",
                    textAlign: "center",
                    padding: "12px 0",
                    borderRadius: 6,
                    border: "1px dashed var(--border)",
                  }}
                >
                  Drop cards here
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer — flex child, always visible at bottom */}
      <div
        style={{
          flexShrink: 0,
          background: "var(--bg-1)",
          borderTop: "1px solid var(--border)",
          padding: "5px 14px",
          fontSize: 11,
          color: "var(--text-3)",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <span>{rows.length} / {totalCount} rows · grouped by</span>

        {/* Clickable column name — opens upward picker */}
        <div ref={menuRef} style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
          <button
            onClick={() => setMenuOpen(v => !v)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--accent)",
              fontSize: 11,
              padding: "0 2px",
              borderRadius: 3,
              lineHeight: 1,
            }}
          >
            {groupCol.name} ▴
          </button>

          {menuOpen && (
            <div
              style={{
                position: "absolute",
                bottom: "calc(100% + 6px)",
                left: 0,
                background: "var(--bg-2)",
                border: "1px solid var(--border-strong)",
                borderRadius: 7,
                padding: "4px 0",
                minWidth: 180,
                maxHeight: 240,
                overflowY: "auto",
                zIndex: 200,
                boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
              }}
            >
              {nonPkCols.map(col => (
                <button
                  key={col.name}
                  onClick={() => { onGroupColChange(col); closeMenu(); }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    width: "100%",
                    textAlign: "left",
                    padding: "6px 12px",
                    background: col.name === groupCol.name ? "var(--bg-3)" : "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: col.name === groupCol.name ? "var(--text-1)" : "var(--text-2)",
                    fontSize: 12,
                    gap: 8,
                  }}
                >
                  {col.name === groupCol.name && (
                    <span style={{ color: "var(--accent)", fontSize: 9 }}>✓</span>
                  )}
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
      </div>
      </div>

      <DragOverlay>
        {activeRow && (
          <div
            className="kanban-card"
            style={{ opacity: 0.9, boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}
          >
            <CardContent
              row={activeRow}
              columns={columns}
              onOpen={() => {}}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
