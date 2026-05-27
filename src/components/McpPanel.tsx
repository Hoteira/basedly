import { useEffect, useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import { ipc } from "../ipc";

const BASEDLY_MCP_URL = "http://localhost:8453/mcp";

interface Preset {
  id: string;
  name: string;
  description: string;
  cli: string;
}

const PRESETS: Preset[] = [
  {
    id: "claude",
    name: "Claude",
    description: "Adds basedly to Claude via claude mcp add",
    cli: "claude",
  },
  {
    id: "gemini",
    name: "Gemini",
    description: "Adds basedly to Gemini via gemini mcp add",
    cli: "gemini",
  },
];

interface Props {
  onClose: () => void;
}

export default function McpPanel({ onClose }: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const results = await Promise.allSettled(
        PRESETS.map(p => ipc.runMcpList(p.cli))
      );
      if (cancelled) return;
      const found = new Set<string>();
      results.forEach((r, i) => {
        if (r.status === "fulfilled" && r.value.toLowerCase().includes("basedly")) {
          found.add(PRESETS[i].id);
        }
      });
      setDone(found);
      setChecking(false);
    };
    check();
    return () => { cancelled = true; };
  }, []);

  const runAdd = async (id: string, cli: string) => {
    if (loading) return;
    setLoading(id);
    setError(null);
    try {
      await ipc.runMcpAdd(cli, "basedly", BASEDLY_MCP_URL);
      setDone(prev => new Set(prev).add(id));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(null);
    }
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 200 }}
      />

      <div style={{
        position: "fixed",
        top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        width: 460,
        background: "var(--bg-1)",
        border: "1px solid var(--border-strong)",
        borderRadius: 12,
        zIndex: 201,
        boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
        overflow: "hidden",
      }}>

        <div style={{ display: "flex", alignItems: "center", padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-1)" }}>MCP Servers</span>
          <button
            onClick={onClose}
            className="btn-ghost"
            style={{ marginLeft: "auto", display: "flex", alignItems: "center", padding: "3px 5px", borderRadius: 4 }}
          >
            <X size={13} />
          </button>
        </div>

        <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          {PRESETS.map(p => {
            const isDone = done.has(p.id);
            const isLoading = loading === p.id;
            const isClickable = !isDone && !isLoading && !checking;
            return (
              <div
                key={p.id}
                onClick={() => isClickable && runAdd(p.id, p.cli)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 12px",
                  background: "var(--bg-2)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  cursor: isClickable ? "pointer" : "default",
                  opacity: isLoading ? 0.6 : 1,
                  transition: "opacity 0.15s",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>
                    {checking ? "Checking…" : isLoading ? "Adding…" : p.description}
                  </div>
                </div>
                {isDone && !checking && (
                  <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--green)", fontWeight: 600, flexShrink: 0 }}>
                    <Check size={10} /> active
                  </span>
                )}
              </div>
            );
          })}

          {error && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 11, color: "var(--red)", fontFamily: "var(--font-mono)", padding: "4px 2px" }}>
              <AlertTriangle size={11} style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ wordBreak: "break-word" }}>{error}</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
