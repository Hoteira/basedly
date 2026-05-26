import { useEffect, useState } from "react";
import { ArrowRight, Check, ChevronLeft, Copy, Pencil, X } from "lucide-react";
import { ipc, rowPkValue } from "../ipc";
import type { ColumnInfo, ForeignKeyInfo, TableInfo } from "../types";

interface NavEntry {
  row: Record<string, unknown>;
  columns: ColumnInfo[];
  tableName: string;
}

interface Props {
  row: Record<string, unknown> | null;
  columns: ColumnInfo[];
  tableName: string;
  workspaceId: string;
  schema: TableInfo[];
  onClose: () => void;
}

function renderValue(col: ColumnInfo, val: unknown): React.ReactNode {
  if (val === null || val === undefined)
    return <span style={{ color: "var(--text-3)", fontStyle: "italic", fontSize: 12 }}>null</span>;

  const t = col.data_type.toLowerCase();

  if (t === "boolean" || t === "bool")
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: val ? "var(--green)" : "var(--text-3)" }}>
        <span style={{ width: 14, height: 14, borderRadius: 3, background: val ? "var(--green)" : "var(--bg-4)", border: "1px solid var(--border)", display: "inline-block" }} />
        {String(val)}
      </span>
    );

  if (t === "jsonb" || t === "json") {
    let txt = "";
    try { txt = JSON.stringify(val, null, 2); } catch { txt = String(val); }
    return (
      <pre style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "var(--yellow)", background: "var(--bg-3)", padding: "8px 10px", borderRadius: 6, overflow: "auto", maxHeight: 200, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
        {txt}
      </pre>
    );
  }

  if (t === "uuid")
    return <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "var(--text-2)", wordBreak: "break-all" }}>{String(val)}</span>;

  if (t.includes("timestamp") || t === "date") {
    const d = new Date(String(val));
    return <span style={{ fontSize: 12 }}>{isNaN(d.getTime()) ? String(val) : d.toLocaleString()}</span>;
  }

  return <span style={{ fontSize: 12, wordBreak: "break-word" }}>{String(val)}</span>;
}

export default function SidePeek({ row, columns, tableName, workspaceId, schema, onClose }: Props) {
  const [stack, setStack] = useState<NavEntry[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [fkLoading, setFkLoading] = useState<string | null>(null);

  const isOpen = row !== null;

  // Reset stack whenever a new root row is opened
  useEffect(() => { setStack([]); setEditingField(null); }, [row]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (editingField) return;
      if (e.key === "Escape") {
        if (stack.length > 0) setStack(s => s.slice(0, -1));
        else onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, editingField, stack, onClose]);

  const current: NavEntry = stack.length > 0
    ? stack[stack.length - 1]
    : { row: row!, columns, tableName };

  const copy = (val: unknown, key: string) => {
    const text = val == null ? "" : typeof val === "object" ? JSON.stringify(val) : String(val);
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const startEdit = (col: ColumnInfo, val: unknown) => {
    setEditingField(col.name);
    setEditVal(val == null ? "" : String(val));
  };

  const commitEdit = async (col: ColumnInfo) => {
    const pkCol = current.columns.find(c => c.is_primary_key);
    const pk = pkCol ? String(current.row[pkCol.name] ?? "") : "";
    if (!pkCol || !pk) { setEditingField(null); return; }
    const oldVal = current.row[col.name];
    if (String(oldVal) !== editVal) {
      try {
        await ipc.updateRow(workspaceId, current.tableName, pkCol.name, pk, col.name, editVal, col.data_type);
        current.row[col.name] = editVal;
      } catch (e) { console.error(e); }
    }
    setEditingField(null);
  };

  const navigateToFk = async (fk: ForeignKeyInfo, val: unknown) => {
    if (val == null) return;
    const key = `${fk.foreign_table}.${fk.foreign_column}`;
    setFkLoading(key);
    try {
      const linked = await ipc.fetchRowByColumn(workspaceId, fk.foreign_table, fk.foreign_column, String(val));
      if (!linked) return;
      const linkedColumns = schema.find(t => t.name === fk.foreign_table)?.columns ?? [];
      setStack(s => [...s, { row: linked, columns: linkedColumns, tableName: fk.foreign_table }]);
    } catch (e) { console.error(e); }
    finally { setFkLoading(null); }
  };

  // Breadcrumb: root table → fk table → ...
  const breadcrumb: string[] = [tableName, ...stack.map(e => e.tableName)];

  return (
    <>
      {isOpen && (
        <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 40 }} />
      )}

      <div className={`peek-panel ${isOpen ? "open" : ""}`}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          {/* Breadcrumb */}
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 4, overflow: "hidden" }}>
            {breadcrumb.map((name, i) => (
              <span key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {i > 0 && <span style={{ color: "var(--text-3)", fontSize: 11 }}>›</span>}
                <button
                  onClick={() => {
                    if (i < breadcrumb.length - 1) setStack(s => s.slice(0, i));
                  }}
                  style={{
                    background: "transparent", border: "none", cursor: i < breadcrumb.length - 1 ? "pointer" : "default",
                    color: i === breadcrumb.length - 1 ? "var(--text-1)" : "var(--accent)",
                    fontWeight: i === breadcrumb.length - 1 ? 600 : 400,
                    fontSize: 13, padding: 0,
                  }}
                >
                  {name}
                </button>
              </span>
            ))}
          </div>
          {stack.length > 0 && (
            <button className="btn btn-ghost" style={{ padding: "3px 8px", fontSize: 11, display: "flex", alignItems: "center", gap: 3 }} onClick={() => setStack(s => s.slice(0, -1))}>
              <ChevronLeft size={13} /> back
            </button>
          )}
          <button className="btn btn-ghost" style={{ padding: "4px 8px" }} onClick={onClose}><X size={14} /></button>
        </div>

        {/* Fields */}
        <div style={{ flex: 1, overflow: "auto", padding: "8px 0" }}>
          {row && current.columns.map(col => {
            const val = current.row[col.name];
            const isPk = col.is_primary_key;
            const isBool = col.data_type === "boolean" || col.data_type === "bool";
            const isJson = col.data_type === "jsonb" || col.data_type === "json";
            const isEditing = editingField === col.name;
            const fkKey = col.foreign_key ? `${col.foreign_key.foreign_table}.${col.foreign_key.foreign_column}` : null;

            return (
              <div key={col.name} style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
                {/* Field header */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-2)" }}>{col.name}</span>
                  {isPk && <span style={{ fontSize: 9, color: "var(--yellow)", fontWeight: 700 }}>PK</span>}

                  {/* FK badge — clickable */}
                  {col.foreign_key && (
                    <button
                      onClick={() => navigateToFk(col.foreign_key!, val)}
                      disabled={val == null || fkLoading === fkKey}
                      title={`Open linked ${col.foreign_key.foreign_table} row`}
                      style={{
                        background: "rgba(129,140,248,0.12)", border: "none", borderRadius: 4,
                        color: "var(--accent)", fontSize: 9, fontWeight: 500,
                        padding: "1px 6px", cursor: val == null ? "default" : "pointer",
                        opacity: val == null ? 0.4 : 1,
                      }}
                    >
                      {fkLoading === fkKey
                        ? "…"
                        : <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><ArrowRight size={9} />{col.foreign_key.foreign_table}</span>
                      }
                    </button>
                  )}

                  <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                    <button onClick={() => copy(val, col.name)} title="Copy" style={{ background: "transparent", border: "none", cursor: "pointer", color: copied === col.name ? "var(--green)" : "var(--text-3)", padding: "2px 4px", display: "flex", alignItems: "center" }}>
                      {copied === col.name ? <Check size={11} /> : <Copy size={11} />}
                    </button>
                    {!isPk && !isBool && !isJson && (
                      <button
                        onClick={() => isEditing ? commitEdit(col) : startEdit(col, val)}
                        title={isEditing ? "Save" : "Edit"}
                        style={{ background: "transparent", border: "none", cursor: "pointer", color: isEditing ? "var(--green)" : "var(--text-3)", padding: "2px 4px", display: "flex", alignItems: "center" }}
                      >
                        {isEditing ? <Check size={11} /> : <Pencil size={11} />}
                      </button>
                    )}
                  </div>
                </div>

                {/* Value */}
                {isEditing
                  ? <input autoFocus className="input" value={editVal} onChange={e => setEditVal(e.target.value)} onBlur={() => commitEdit(col)} onKeyDown={e => { if (e.key === "Enter") commitEdit(col); if (e.key === "Escape") setEditingField(null); }} style={{ fontSize: 12 }} />
                  : renderValue(col, val)
                }
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
