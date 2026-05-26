import { useState } from "react";
import type { TableInfo, WorkspaceConfig } from "../types";

function BrandIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" fill="none" style={{ display: "block", flexShrink: 0 }}>
      {/* Bottom face — no fill, just outline */}
      <path d="M255.904 240 L385.808 315 L255.904 390 L126 315 Z" stroke="currentColor" strokeWidth="21" />
      {/* Middle face — fill hides bottom-face edges behind it */}
      <path d="M255.904 179 L385.808 254 L255.904 329 L126 254 Z" className="brand-face-fill" stroke="currentColor" strokeWidth="21" />
      {/* Top face — fill hides middle-face edges behind it */}
      <path d="M255.904 122 L385.808 197 L255.904 272 L126 197 Z" className="brand-face-fill" stroke="currentColor" strokeWidth="21" />
    </svg>
  );
}

interface Props {
  workspaces: WorkspaceConfig[];
  activeWsId: string | null;
  connected: Record<string, boolean>;
  schema: TableInfo[];
  activeTable: string | null;
  schemaLoading: boolean;
  showConsole: boolean;
  theme: "dark" | "light";
  onSelectWorkspace: (ws: WorkspaceConfig) => void;
  onSelectTable: (name: string) => void;
  onAddWorkspace: () => void;
  onDeleteWorkspace: (id: string) => void;
  onToggleConsole: () => void;
  onToggleTheme: () => void;
}

const COLORS = [
  "#818cf8",
  "#f472b6",
  "#34d399",
  "#fb923c",
  "#60a5fa",
  "#a78bfa",
];

export default function Sidebar({
  workspaces,
  activeWsId,
  connected,
  schema,
  activeTable,
  schemaLoading,
  showConsole,
  theme,
  onSelectWorkspace,
  onSelectTable,
  onAddWorkspace,
  onDeleteWorkspace,
  onToggleConsole,
  onToggleTheme,
}: Props) {
  const [hoveredWs, setHoveredWs] = useState<string | null>(null);

  return (
    <aside
      style={{
        width: 220,
        minWidth: 220,
        background: "var(--bg-1)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 12px 10px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--text-1)" }}>
          <BrandIcon size={18} />
          <span style={{ fontWeight: 700, fontSize: 13.5, letterSpacing: "-0.03em" }}>
            basedly
          </span>
        </div>
        <button
          onClick={onToggleTheme}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          style={{
            background: "transparent", border: "none", cursor: "pointer",
            color: "var(--text-3)", fontSize: 14, padding: "2px 4px",
            borderRadius: 4, lineHeight: 1,
          }}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </div>

      {/* Workspaces */}
      <div style={{ padding: "10px 8px 6px" }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--text-3)",
            padding: "0 6px 6px",
          }}
        >
          Connections
        </div>
        {workspaces.map((ws, i) => {
          const color = ws.color ?? COLORS[i % COLORS.length];
          const isActive = ws.id === activeWsId;
          const isConn = connected[ws.id];
          return (
            <div
              key={ws.id}
              style={{ position: "relative" }}
              onMouseEnter={() => setHoveredWs(ws.id)}
              onMouseLeave={() => setHoveredWs(null)}
            >
              <button
                onClick={() => onSelectWorkspace(ws)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  borderRadius: 6,
                  background: isActive ? "var(--bg-3)" : "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: isActive ? "var(--text-1)" : "var(--text-2)",
                  fontSize: 12,
                  fontWeight: isActive ? 500 : 400,
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: isConn ? color : "var(--bg-4)",
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {ws.name}
                </span>
                <span
                  title={ws.db_type === "sqlite" ? "SQLite" : "PostgreSQL"}
                  style={{ fontSize: 9, color: "var(--text-3)", flexShrink: 0 }}
                >
                  {ws.db_type === "sqlite" ? "sq" : "pg"}
                </span>
              </button>
              {hoveredWs === ws.id && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteWorkspace(ws.id);
                  }}
                  title="Remove connection"
                  style={{
                    position: "absolute",
                    right: 6,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--text-3)",
                    fontSize: 12,
                    padding: "2px 4px",
                    borderRadius: 4,
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}

        <button
          onClick={onAddWorkspace}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 8px",
            borderRadius: 6,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--text-3)",
            fontSize: 12,
            marginTop: 2,
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
          <span>New connection</span>
        </button>
      </div>

      {/* Tables */}
      {activeWsId && (
        <div
          style={{
            flex: 1,
            overflow: "hidden auto",
            borderTop: "1px solid var(--border)",
            padding: "10px 8px",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--text-3)",
              padding: "0 6px 6px",
            }}
          >
            Tables
          </div>

          {schemaLoading ? (
            <div
              style={{
                padding: "8px 8px",
                color: "var(--text-3)",
                fontSize: 11,
              }}
            >
              Loading…
            </div>
          ) : (
            schema.map((t) => (
              <button
                key={t.name}
                onClick={() => onSelectTable(t.name)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "5px 8px",
                  borderRadius: 5,
                  background:
                    t.name === activeTable ? "var(--bg-3)" : "transparent",
                  border: "none",
                  cursor: "pointer",
                  color:
                    t.name === activeTable
                      ? "var(--text-1)"
                      : "var(--text-2)",
                  fontSize: 12,
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t.name}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: "var(--text-3)",
                    flexShrink: 0,
                    marginLeft: 4,
                  }}
                >
                  {t.row_count > 999
                    ? `${(t.row_count / 1000).toFixed(0)}k`
                    : t.row_count}
                </span>
              </button>
            ))
          )}
        </div>
      )}

      {/* SQL Console toggle */}
      {activeWsId && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "6px 8px", flexShrink: 0 }}>
          <button
            onClick={onToggleConsole}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 8px",
              borderRadius: 6,
              background: showConsole ? "var(--bg-3)" : "transparent",
              border: "none",
              cursor: "pointer",
              color: showConsole ? "var(--text-1)" : "var(--text-3)",
              fontSize: 12,
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            <span style={{ fontSize: 11 }}>&gt;_</span>
            <span>SQL Console</span>
          </button>
        </div>
      )}
    </aside>
  );
}
