import { useEffect, useState } from "react";
import { ipc, rowPkValue } from "../ipc";
import type { ColumnInfo } from "../types";

interface Props {
  row: Record<string, unknown> | null;
  columns: ColumnInfo[];
  workspaceId: string;
  tableName: string;
  onClose: () => void;
}

function renderFieldValue(
  col: ColumnInfo,
  val: unknown
): React.ReactNode {
  if (val === null || val === undefined) {
    return (
      <span style={{ color: "var(--text-3)", fontStyle: "italic", fontSize: 12 }}>
        null
      </span>
    );
  }

  const t = col.data_type.toLowerCase();

  if (t === "boolean" || t === "bool") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: val ? "var(--green)" : "var(--text-3)",
        }}
      >
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: 3,
            background: val ? "var(--green)" : "var(--bg-4)",
            border: "1px solid var(--border)",
            display: "inline-block",
          }}
        />
        {String(val)}
      </span>
    );
  }

  if (t === "jsonb" || t === "json") {
    let formatted = "";
    try {
      formatted = JSON.stringify(val, null, 2);
    } catch {
      formatted = String(val);
    }
    return (
      <pre
        style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 11,
          color: "var(--yellow)",
          background: "var(--bg-3)",
          padding: "8px 10px",
          borderRadius: 6,
          overflow: "auto",
          maxHeight: 240,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        {formatted}
      </pre>
    );
  }

  if (t === "uuid") {
    return (
      <span
        style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 11,
          color: "var(--text-2)",
          wordBreak: "break-all",
        }}
      >
        {String(val)}
      </span>
    );
  }

  if (t.includes("timestamp") || t === "date") {
    const s = String(val);
    const d = new Date(s);
    return (
      <span style={{ fontSize: 12, color: "var(--text-1)" }}>
        {isNaN(d.getTime()) ? s : d.toLocaleString()}
      </span>
    );
  }

  return (
    <span style={{ fontSize: 12, color: "var(--text-1)", wordBreak: "break-word" }}>
      {String(val)}
    </span>
  );
}

export default function SidePeek({
  row,
  columns,
  workspaceId,
  tableName,
  onClose,
}: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");

  const isOpen = row !== null;

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !editingField) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, editingField, onClose]);

  const copyField = (val: unknown, fieldName: string) => {
    const text = val == null ? "" : typeof val === "object" ? JSON.stringify(val) : String(val);
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(fieldName);
    setTimeout(() => setCopied(null), 1500);
  };

  const startEdit = (col: ColumnInfo, val: unknown) => {
    setEditingField(col.name);
    setEditVal(val == null ? "" : String(val));
  };

  const commitEdit = async (col: ColumnInfo) => {
    if (!row) return;
    const pkCol = columns.find((c) => c.is_primary_key);
    const pk = rowPkValue(row, columns);
    if (!pkCol || !pk) {
      setEditingField(null);
      return;
    }
    const oldVal = row[col.name];
    if (String(oldVal) !== editVal) {
      try {
        await ipc.updateRow(
          workspaceId,
          tableName,
          pkCol.name,
          pk,
          col.name,
          editVal,
          col.data_type
        );
        (row as Record<string, unknown>)[col.name] = editVal;
      } catch (e) {
        console.error(e);
      }
    }
    setEditingField(null);
  };

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.3)",
            zIndex: 40,
          }}
        />
      )}

      <div className={`peek-panel ${isOpen ? "open" : ""}`}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 14 }}>Row details</span>
          <button
            className="btn btn-ghost"
            style={{ padding: "4px 8px" }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Fields */}
        <div style={{ flex: 1, overflow: "auto", padding: "12px 0" }}>
          {row &&
            columns.map((col) => {
              const val = row[col.name];
              const isPk = col.is_primary_key;
              const isEditing = editingField === col.name;
              const isBool = col.data_type === "boolean" || col.data_type === "bool";
              const isJson = col.data_type === "jsonb" || col.data_type === "json";

              return (
                <div
                  key={col.name}
                  style={{
                    padding: "10px 16px",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginBottom: 6,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        color: "var(--text-2)",
                      }}
                    >
                      {col.name}
                    </span>
                    {isPk && (
                      <span
                        style={{
                          fontSize: 9,
                          color: "var(--yellow)",
                          fontWeight: 700,
                        }}
                      >
                        PK
                      </span>
                    )}
                    {col.foreign_key && (
                      <span
                        style={{
                          fontSize: 9,
                          color: "var(--accent)",
                          fontWeight: 500,
                        }}
                      >
                        → {col.foreign_key.foreign_table}
                      </span>
                    )}
                    <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                      <button
                        onClick={() => copyField(val, col.name)}
                        title="Copy value"
                        style={{
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          color:
                            copied === col.name
                              ? "var(--green)"
                              : "var(--text-3)",
                          fontSize: 10,
                          padding: "2px 4px",
                        }}
                      >
                        {copied === col.name ? "✓ copied" : "copy"}
                      </button>
                      {!isPk && !isBool && !isJson && (
                        <button
                          onClick={() =>
                            isEditing
                              ? commitEdit(col)
                              : startEdit(col, val)
                          }
                          style={{
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            color: isEditing
                              ? "var(--green)"
                              : "var(--text-3)",
                            fontSize: 10,
                            padding: "2px 4px",
                          }}
                        >
                          {isEditing ? "save" : "edit"}
                        </button>
                      )}
                    </div>
                  </div>

                  {isEditing ? (
                    <input
                      autoFocus
                      className="input"
                      value={editVal}
                      onChange={(e) => setEditVal(e.target.value)}
                      onBlur={() => commitEdit(col)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit(col);
                        if (e.key === "Escape") setEditingField(null);
                      }}
                      style={{ fontSize: 12 }}
                    />
                  ) : (
                    renderFieldValue(col, val)
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </>
  );
}
