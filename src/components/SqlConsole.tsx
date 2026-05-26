import { useState, useRef } from "react";
import { Terminal, X } from "lucide-react";
import { ipc } from "../ipc";

interface Props {
  workspaceId: string;
  onClose: () => void;
}

export default function SqlConsole({ workspaceId, onClose }: Props) {
  const [sql, setSql] = useState("");
  const [results, setResults] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [height, setHeight] = useState(300);
  const heightRef = useRef(300);

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = heightRef.current;
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(160, Math.min(800, startH + (startY - ev.clientY)));
      heightRef.current = next;
      setHeight(next);
    };
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const run = async () => {
    if (!sql.trim() || running) return;
    setRunning(true);
    setError(null);
    setResults(null);
    const t0 = Date.now();
    try {
      const rows = await ipc.executeQuery(workspaceId, sql);
      setResults(rows);
      setElapsed(Date.now() - t0);
    } catch (e) {
      setError(String(e));
      setElapsed(Date.now() - t0);
    } finally {
      setRunning(false);
    }
  };

  const cols = results && results.length > 0 ? Object.keys(results[0]) : [];

  return (
    <div style={{ background: "var(--bg-1)", display: "flex", flexDirection: "column", height, flexShrink: 0, position: "relative" }}>
      {/* Resize handle */}
      <div
        onMouseDown={handleResizeMouseDown}
        style={{
          position: "absolute",
          top: 0, left: 0, right: 0,
          height: 5,
          cursor: "ns-resize",
          zIndex: 10,
          background: "transparent",
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--accent)"; (e.currentTarget as HTMLElement).style.opacity = "0.4"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.opacity = "1"; }}
      />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderTop: "2px solid var(--border)", borderBottom: "1px solid var(--border)", background: "var(--bg-2)", flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", display: "flex", alignItems: "center", gap: 5 }}><Terminal size={12} /> SQL Console</span>
        <button
          onClick={onClose}
          style={{ marginLeft: "auto", background: "transparent", border: "none", cursor: "pointer", color: "var(--text-3)", padding: "2px 4px", display: "flex", alignItems: "center" }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Editor */}
      <div style={{ display: "flex", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <textarea
          value={sql}
          onChange={e => setSql(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              run();
            }
          }}
          style={{
            flex: 1, fontFamily: "JetBrains Mono, monospace", fontSize: 12,
            resize: "none", height: 68, background: "var(--bg-2)",
            border: "1px solid var(--border)", borderRadius: 6,
            padding: "8px 10px", color: "var(--text-1)", outline: "none",
          }}
          placeholder="SELECT * FROM ...  (Ctrl+Enter to run)"
          spellCheck={false}
        />
        <button
          className="btn btn-primary"
          onClick={run}
          disabled={running || !sql.trim()}
          style={{ padding: "6px 16px", fontSize: 12, alignSelf: "flex-end", flexShrink: 0 }}
        >
          {running ? "…" : "Run"}
        </button>
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {error && (
          <div style={{ padding: "8px 12px", color: "var(--red)", fontSize: 12, fontFamily: "JetBrains Mono, monospace", whiteSpace: "pre-wrap" }}>
            {error}
          </div>
        )}
        {results !== null && !error && (
          <>
            <div style={{ padding: "4px 12px", fontSize: 10, color: "var(--text-3)", borderBottom: "1px solid var(--border)", background: "var(--bg-2)" }}>
              {results.length} row{results.length !== 1 ? "s" : ""}
              {elapsed != null && <span style={{ marginLeft: 8 }}>{elapsed}ms</span>}
            </div>
            {results.length === 0 ? (
              <div style={{ padding: "12px", fontSize: 12, color: "var(--text-3)" }}>No rows returned.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "var(--bg-2)" }}>
                    {cols.map(c => (
                      <th key={c} style={{ padding: "4px 12px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "var(--text-2)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap", position: "sticky", top: 0, background: "var(--bg-2)" }}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((row, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                      {cols.map(c => (
                        <td key={c} style={{ padding: "4px 12px", color: row[c] == null ? "var(--text-3)" : "var(--text-1)", fontStyle: row[c] == null ? "italic" : "normal", whiteSpace: "nowrap", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {row[c] == null ? "null" : typeof row[c] === "object" ? JSON.stringify(row[c]) : String(row[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}
