import { useState } from "react";
import { ipc } from "../ipc";
import type { WorkspaceConfig } from "../types";

const COLORS = [
  "#818cf8",
  "#f472b6",
  "#34d399",
  "#fb923c",
  "#60a5fa",
  "#a78bfa",
  "#e879f9",
  "#2dd4bf",
];

interface Props {
  onAdd: (ws: WorkspaceConfig) => void;
  onClose: () => void;
}

export default function AddWorkspaceModal({ onAdd, onClose }: Props) {
  const [name, setName] = useState("");
  const [connStr, setConnStr] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "error" | null>(null);
  const [testError, setTestError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleTest = async () => {
    if (!connStr.trim()) return;
    setTesting(true);
    setTestResult(null);
    setTestError("");
    try {
      await ipc.testConnection(connStr.trim());
      setTestResult("ok");
    } catch (e) {
      setTestResult("error");
      setTestError(String(e));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !connStr.trim()) {
      setError("Name and connection string are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const ws = await ipc.addWorkspace(name.trim(), connStr.trim(), color);
      onAdd(ws);
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: "var(--bg-2)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 24,
          width: 440,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h2 style={{ fontSize: 15, fontWeight: 600 }}>Add connection</h2>
          <button
            className="btn btn-ghost"
            style={{ padding: "4px 8px" }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ fontSize: 12, color: "var(--text-2)" }}>
            Display name
          </label>
          <input
            className="input"
            placeholder="e.g. Production DB"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ fontSize: 12, color: "var(--text-2)" }}>
            Connection string
          </label>
          <input
            className="input"
            type="password"
            placeholder="postgres://user:pass@host:5432/db"
            value={connStr}
            onChange={(e) => {
              setConnStr(e.target.value);
              setTestResult(null);
            }}
            style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              className="btn btn-ghost"
              style={{
                fontSize: 11,
                padding: "4px 10px",
                border: "1px solid var(--border)",
              }}
              onClick={handleTest}
              disabled={testing || !connStr.trim()}
            >
              {testing ? "Testing…" : "Test connection"}
            </button>
            {testResult === "ok" && (
              <span style={{ fontSize: 11, color: "var(--green)" }}>
                ✓ Connected
              </span>
            )}
            {testResult === "error" && (
              <span
                style={{
                  fontSize: 11,
                  color: "var(--red)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: 200,
                }}
                title={testError}
              >
                ✗ {testError.slice(0, 50)}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ fontSize: 12, color: "var(--text-2)" }}>Color</label>
          <div style={{ display: "flex", gap: 8 }}>
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: c,
                  border:
                    color === c
                      ? "2px solid var(--text-1)"
                      : "2px solid transparent",
                  cursor: "pointer",
                }}
              />
            ))}
          </div>
        </div>

        {error && (
          <p style={{ fontSize: 11, color: "var(--red)" }}>{error}</p>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save connection"}
          </button>
        </div>
      </div>
    </div>
  );
}
