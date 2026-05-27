import { useEffect, useRef } from "react";
import { X, Undo2 } from "lucide-react";

export interface McpEvent {
  type: "select" | "update" | "delete" | "insert" | "ddl" | "other";
  agent: string;
  workspaceId: string;
  tableName?: string;
  summary: string;
  undoSql?: string;
  ts: number;
}

export interface McpToast extends McpEvent {
  id: string;
}

interface Props {
  toast: McpToast;
  onDismiss: (id: string) => void;
  onUndo: (toast: McpToast) => void;
}

const COLORS: Record<McpEvent["type"], { bg: string; bar: string; label: string; labelColor: string }> = {
  select: { bg: "rgba(76,175,120,0.10)",  bar: "#4caf78", label: "SELECT", labelColor: "#4caf78" },
  update: { bg: "rgba(200,155,18,0.10)",  bar: "#c89b12", label: "UPDATE", labelColor: "#c89b12" },
  delete: { bg: "rgba(223,92,92,0.12)",   bar: "#df5c5c", label: "DELETE", labelColor: "#df5c5c" },
  insert: { bg: "rgba(91,156,246,0.10)",  bar: "#5b9cf6", label: "INSERT", labelColor: "#5b9cf6" },
  ddl:    { bg: "rgba(230,120,40,0.10)",  bar: "#e6782a", label: "DDL",    labelColor: "#e6782a" },
  other:  { bg: "rgba(255,255,255,0.04)", bar: "#525250", label: "QUERY",  labelColor: "#525250" },
};

const DISMISS_MS: Record<McpEvent["type"], number | null> = {
  select: 8_000,
  other:  8_000,
  insert: 60_000,
  update: 60_000,
  ddl:    null,   // stays until manually dismissed
  delete: null,   // stays until manually dismissed
};

export default function McpToastItem({ toast, onDismiss, onUndo }: Props) {
  const c = COLORS[toast.type];
  const duration = DISMISS_MS[toast.type];
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (duration !== null) {
      timerRef.current = setTimeout(() => onDismiss(toast.id), duration);
      return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }
  }, [duration, toast.id, onDismiss]);

  return (
    <div
      className="mcp-toast"
      style={{
        position: "relative",
        width: 310,
        background: "var(--bg-2)",
        border: `1px solid ${c.bar}33`,
        borderLeft: `3px solid ${c.bar}`,
        borderRadius: 8,
        overflow: "hidden",
        boxShadow: "var(--toast-shadow)",
      }}
    >
      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
            color: c.labelColor, fontFamily: "var(--font-mono)",
          }}>
            {c.label}
          </span>
          {toast.tableName && (
            <span style={{ fontSize: 10, color: "var(--text-2)", fontFamily: "var(--font-mono)" }}>
              {toast.tableName}
            </span>
          )}
          <span style={{
            marginLeft: "auto", fontSize: 10, fontWeight: 600,
            color: "var(--text-1)", maxWidth: 110,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {toast.agent}
          </span>
          <button
            onClick={() => onDismiss(toast.id)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--text-3)", display: "flex", alignItems: "center",
              padding: 2, borderRadius: 3,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-1)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--text-3)"; }}
          >
            <X size={11} />
          </button>
        </div>

        <p style={{
          fontSize: 11, color: "var(--text-2)", margin: 0,
          lineHeight: 1.4, wordBreak: "break-word",
        }}>
          {toast.summary}
        </p>

        {toast.undoSql && (
          <button
            onClick={() => onUndo(toast)}
            style={{
              marginTop: 2,
              alignSelf: "flex-start",
              display: "flex", alignItems: "center", gap: 4,
              background: "transparent",
              border: `1px solid ${c.bar}55`,
              borderRadius: 5,
              color: c.labelColor,
              fontSize: 10, fontWeight: 600,
              padding: "3px 8px", cursor: "pointer",
              transition: "background 0.1s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${c.bar}18`; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <Undo2 size={10} /> Undo
          </button>
        )}
      </div>

      {/* Progress bar (auto-dismiss toasts only) */}
      {duration !== null && (
        <div style={{
          position: "absolute", bottom: 0, left: 0,
          height: 2, background: c.bar,
          animation: `toastProgress ${duration}ms linear forwards`,
        }} />
      )}
    </div>
  );
}
