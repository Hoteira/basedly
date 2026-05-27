import { useState } from "react";
import { Check, X } from "lucide-react";
import { SiPostgresql, SiSqlite } from "react-icons/si";
import { ipc } from "../ipc";
import type { WorkspaceConfig } from "../types";

const COLORS = [
  "#818cf8", "#f472b6", "#34d399", "#fb923c",
  "#60a5fa", "#a78bfa", "#e879f9", "#2dd4bf",
];

type DbMode = "postgres" | "sqlite";

interface Props {
  onAdd: (ws: WorkspaceConfig) => void;
  onClose: () => void;
}

export default function AddWorkspaceModal({ onAdd, onClose }: Props) {
  const [mode, setMode] = useState<DbMode>("postgres");
  const [name, setName] = useState("");
  const [connStr, setConnStr] = useState("");
  const [sqlitePath, setSqlitePath] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "error" | null>(null);
  const [testError, setTestError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const effectiveConnStr = mode === "sqlite" ? sqlitePath : connStr;

  const handlePickFile = async () => {
    const path = await ipc.pickSqliteFile();
    if (path) {
      setSqlitePath(path);
      setTestResult(null);
      // Auto-fill name from filename if empty
      if (!name) {
        const parts = path.replace(/\\/g, "/").split("/");
        const filename = parts[parts.length - 1].replace(/\.(db|sqlite|sqlite3)$/i, "");
        setName(filename);
      }
    }
  };

  const handleTest = async () => {
    const cs = effectiveConnStr.trim();
    if (!cs) return;
    setTesting(true);
    setTestResult(null);
    setTestError("");
    try {
      await ipc.testConnection(cs);
      setTestResult("ok");
    } catch (e) {
      setTestResult("error");
      setTestError(String(e));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    const cs = effectiveConnStr.trim();
    if (!name.trim() || !cs) {
      setError("Name and connection are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const ws = await ipc.addWorkspace(name.trim(), cs, color);
      onAdd(ws);
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: "var(--bg-2)", border: "1px solid var(--border)",
          borderRadius: 12, padding: 24, width: 460,
          display: "flex", flexDirection: "column", gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Add connection</h2>
          <button className="btn btn-ghost" style={{ padding: "4px 8px" }} onClick={onClose}><X size={14} /></button>
        </div>

        <div
          style={{
            display: "flex", background: "var(--bg-3)",
            borderRadius: 8, padding: 3, gap: 2,
          }}
        >
          {(["postgres", "sqlite"] as DbMode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setTestResult(null); }}
              style={{
                flex: 1, padding: "6px 0", borderRadius: 6, border: "none",
                cursor: "pointer", fontSize: 12, fontWeight: 500,
                background: mode === m ? "var(--bg-1)" : "transparent",
                color: mode === m ? "var(--text-1)" : "var(--text-3)",
                transition: "all 0.15s",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              {m === "postgres"
                ? <><SiPostgresql size={14} color="#336791" /> PostgreSQL</>
                : <><SiSqlite size={14} color="#003B57" /> SQLite / File</>
              }
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 12, color: "var(--text-2)" }}>Display name</label>
          <input
            className="input"
            placeholder="e.g. Production DB"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        {mode === "postgres" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, color: "var(--text-2)" }}>Connection string</label>
            <input
              className="input"
              type="password"
              placeholder="postgres://user:pass@host:5432/db"
              value={connStr}
              onChange={(e) => { setConnStr(e.target.value); setTestResult(null); }}
              style={{ fontFamily: "monospace", fontSize: 12 }}
            />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, color: "var(--text-2)" }}>Database file</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="input"
                placeholder="/path/to/database.db"
                value={sqlitePath}
                onChange={(e) => { setSqlitePath(e.target.value); setTestResult(null); }}
                style={{ fontFamily: "monospace", fontSize: 12 }}
              />
              <button
                className="btn btn-ghost"
                style={{ flexShrink: 0, border: "1px solid var(--border)", padding: "0 12px" }}
                onClick={handlePickFile}
              >
                Browse
              </button>
            </div>
            <p style={{ fontSize: 11, color: "var(--text-3)" }}>
              Supports .db · .sqlite · .sqlite3
            </p>
          </div>
        )}

        {/* Test - only for Postgres; SQLite just needs the file path */}
        {mode === "postgres" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: "4px 10px", border: "1px solid var(--border)" }}
              onClick={handleTest}
              disabled={testing || !effectiveConnStr.trim()}
            >
              {testing ? "Testing…" : "Test connection"}
            </button>
            {testResult === "ok" && (
              <span style={{ fontSize: 11, color: "var(--green)", display: "flex", alignItems: "center", gap: 4 }}><Check size={12} /> Connected</span>
            )}
            {testResult === "error" && (
              <span
                style={{ fontSize: 11, color: "var(--red)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={testError}
              >
                ✗ {testError.slice(0, 60)}
              </span>
            )}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ fontSize: 12, color: "var(--text-2)" }}>Color</label>
          <div style={{ display: "flex", gap: 8 }}>
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                style={{
                  width: 20, height: 20, borderRadius: "50%", background: c,
                  border: color === c ? "2px solid var(--text-1)" : "2px solid transparent",
                  cursor: "pointer",
                }}
              />
            ))}
          </div>
        </div>

        {error && <p style={{ fontSize: 11, color: "var(--red)" }}>{error}</p>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save connection"}
          </button>
        </div>
      </div>
    </div>
  );
}
