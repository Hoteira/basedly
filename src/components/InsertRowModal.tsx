import { useState } from "react";
import { X } from "lucide-react";
import type { ColumnInfo } from "../types";
import { ipc } from "../ipc";

interface Props {
  workspaceId: string;
  tableName: string;
  columns: ColumnInfo[];
  onClose: () => void;
  onInserted: () => void;
}

function toSqlLiteral(value: string, dataType: string): string {
  if (value === "") return "NULL";
  const t = dataType.toLowerCase();
  if (
    t.includes("int") || t.includes("float") || t === "numeric" ||
    t === "decimal" || t === "real" || t.includes("double") || t === "money"
  ) {
    const n = Number(value);
    return isNaN(n) ? `'${value.replace(/'/g, "''")}'` : String(n);
  }
  if (t === "boolean" || t === "bool") {
    return ["true", "1", "yes"].includes(value.toLowerCase()) ? "TRUE" : "FALSE";
  }
  return `'${value.replace(/'/g, "''")}'`;
}

export default function InsertRowModal({ workspaceId, tableName, columns, onClose, onInserted }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (col: string, val: string) =>
    setValues((prev) => ({ ...prev, [col]: val }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    for (const col of columns) {
      if (!col.nullable && !col.is_primary_key && !(values[col.name] ?? "")) {
        setError(`"${col.name}" is required`);
        return;
      }
    }

    const included = columns.filter((col) => {
      const v = values[col.name] ?? "";
      if (col.is_primary_key && v === "") return false;
      if (col.nullable && v === "") return false;
      return true;
    });

    if (!included.length) { setError("No values provided"); return; }

    const colList = included.map((c) => `"${c.name}"`).join(", ");
    const valList = included.map((c) => toSqlLiteral(values[c.name] ?? "", c.data_type)).join(", ");
    const sql = `INSERT INTO "${tableName}" (${colList}) VALUES (${valList})`;

    setSaving(true);
    try {
      await ipc.executeQuery(workspaceId, sql);
      onInserted();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 200,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "var(--bg-1)", border: "1px solid var(--border-strong)",
        borderRadius: 12, width: 460, maxWidth: "92vw", maxHeight: "80vh",
        display: "flex", flexDirection: "column",
        boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", padding: "14px 16px",
          borderBottom: "1px solid var(--border)", flexShrink: 0,
        }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-1)" }}>
            Insert row - {tableName}
          </span>
          <button
            onClick={onClose}
            style={{
              marginLeft: "auto", background: "none", border: "none", cursor: "pointer",
              color: "var(--text-3)", display: "flex", alignItems: "center",
              padding: 4, borderRadius: 4,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-1)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-3)"; }}
          >
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            {columns.map((col) => {
              const isPk = col.is_primary_key;
              const isRequired = !col.nullable && !isPk;
              const isBool = col.data_type === "boolean" || col.data_type === "bool";

              return (
                <div key={col.name} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label style={{ fontSize: 11, color: "var(--text-2)", display: "flex", alignItems: "center", gap: 5 }}>
                    <span>{col.name}</span>
                    <span style={{
                      fontSize: 9, color: "var(--text-3)", fontFamily: "var(--font-mono)",
                      background: "var(--bg-3)", padding: "1px 5px", borderRadius: 3,
                    }}>
                      {col.data_type.slice(0, 14)}
                    </span>
                    {isPk && <span style={{ fontSize: 9, color: "var(--yellow)", fontWeight: 700 }}>PK</span>}
                    {isRequired && <span style={{ color: "var(--red)", fontSize: 11, lineHeight: 1 }}>*</span>}
                  </label>

                  {isBool ? (
                    <select
                      value={values[col.name] ?? ""}
                      onChange={(e) => set(col.name, e.target.value)}
                      style={{
                        background: "var(--bg-3)", border: "1px solid var(--border-strong)",
                        color: "var(--text-1)", borderRadius: 5, padding: "6px 8px",
                        fontSize: 12, outline: "none",
                      }}
                    >
                      {col.nullable && <option value="">null</option>}
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={values[col.name] ?? ""}
                      onChange={(e) => set(col.name, e.target.value)}
                      placeholder={isPk ? "auto" : col.nullable ? "null" : ""}
                      className="input"
                      style={{ fontSize: 12, padding: "6px 8px" }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border-strong)"; }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {error && (
            <div style={{
              margin: "0 16px 8px",
              padding: "7px 10px", borderRadius: 6,
              background: "rgba(223,92,92,0.10)", color: "var(--red)", fontSize: 11,
            }}>
              {error}
            </div>
          )}

          <div style={{
            display: "flex", gap: 8, justifyContent: "flex-end",
            padding: "12px 16px", borderTop: "1px solid var(--border)", flexShrink: 0,
          }}>
            <button type="button" onClick={onClose} className="btn btn-ghost" style={{ fontSize: 12 }}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn btn-primary" style={{ fontSize: 12 }}>
              {saving ? "Inserting…" : "Insert row"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
