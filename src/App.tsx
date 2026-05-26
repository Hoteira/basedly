import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Image as TauriImage } from "@tauri-apps/api/image";
import { ipc } from "./ipc";
import type { ColumnInfo, TableInfo, ViewMode, WorkspaceConfig } from "./types";
import AddWorkspaceModal from "./components/AddWorkspaceModal";
import Sidebar from "./components/Sidebar";
import SqlConsole from "./components/SqlConsole";
import TableView from "./components/TableView";

// Draws the isometric cube (no background) onto a canvas and returns PNG bytes.
// These are the same parallelogram faces as the SVG, computed analytically.
function drawCubeIcon(size: number, strokeColor: string, bgColor: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const s = size / 512;
  const face = (tx: number, ty: number, fill: string | null) => {
    ctx.beginPath();
    ctx.moveTo(tx * s,               ty * s);
    ctx.lineTo((tx + 129.904) * s,   (ty + 75) * s);
    ctx.lineTo(tx * s,               (ty + 150) * s);
    ctx.lineTo((tx - 129.904) * s,   (ty + 75) * s);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = Math.max(1, 21 * s);
    ctx.stroke();
  };
  face(255.904, 240, null);       // bottom — no fill
  face(255.904, 179, bgColor);    // middle face hides bottom edges
  face(255.904, 122, bgColor);    // top face hides middle edges
  return canvas;
}

async function applyWindowIcon(isDark: boolean) {
  try {
    const stroke = isDark ? "#e8e8e5" : "#37352f";
    const bg     = isDark ? "#202020" : "#f7f7f5";
    const canvas = drawCubeIcon(32, stroke, bg);
    const bytes  = await new Promise<Uint8Array>((res) =>
      canvas.toBlob((b) => b!.arrayBuffer().then((buf) => res(new Uint8Array(buf))), "image/png")
    );
    const img = await TauriImage.fromBytes(bytes);
    await getCurrentWindow().setIcon(img);
  } catch (e) {
    console.warn("window icon update failed:", e);
  }
}

export default function App() {
  const [workspaces, setWorkspaces] = useState<WorkspaceConfig[]>([]);
  const [activeWsId, setActiveWsId] = useState<string | null>(null);
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [schema, setSchema] = useState<TableInfo[]>([]);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [showAddWs, setShowAddWs] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("theme");
    return saved === "light" ? "light" : "dark";
  });
  const [showConsole, setShowConsole] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);

  useEffect(() => {
    ipc.getWorkspaces().then(setWorkspaces).catch(console.error);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
    applyWindowIcon(theme === "dark");
  }, [theme]);

  // Live reload when SQLite file changes on disk
  useEffect(() => {
    if (!activeWsId) return;
    const wsId = activeWsId;
    let unlisten: (() => void) | undefined;
    listen<string>("db-file-changed", (event) => {
      if (event.payload !== wsId) return;
      setRefreshKey((k) => k + 1);
      ipc.getSchema(wsId).then(setSchema).catch(console.error);
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [activeWsId]);

  const handleSelectWorkspace = useCallback(
    async (ws: WorkspaceConfig) => {
      setActiveWsId(ws.id);
      setActiveTable(null);
      setSchema([]);
      setError(null);

      const alreadyConnected = connected[ws.id];
      if (!alreadyConnected) {
        try {
          await ipc.connectWorkspace(ws.id);
          setConnected((prev) => ({ ...prev, [ws.id]: true }));
        } catch (e) {
          setError(String(e));
          return;
        }
      }

      setSchemaLoading(true);
      try {
        const tables = await ipc.getSchema(ws.id);
        setSchema(tables);
        if (tables.length > 0) setActiveTable(tables[0].name);
      } catch (e) {
        setError(String(e));
      } finally {
        setSchemaLoading(false);
      }
    },
    [connected]
  );

  const handleAddWorkspace = useCallback(async (ws: WorkspaceConfig) => {
    setWorkspaces((prev) => [...prev, ws]);
    setShowAddWs(false);
  }, []);

  const handleDeleteWorkspace = useCallback(
    async (id: string) => {
      await ipc.deleteWorkspace(id);
      setWorkspaces((prev) => prev.filter((w) => w.id !== id));
      if (activeWsId === id) {
        setActiveWsId(null);
        setSchema([]);
        setActiveTable(null);
        setShowConsole(false);
      }
      setConnected((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [activeWsId]
  );

  const activeColumns: ColumnInfo[] =
    schema.find((t) => t.name === activeTable)?.columns ?? [];

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        workspaces={workspaces}
        activeWsId={activeWsId}
        connected={connected}
        schema={schema}
        activeTable={activeTable}
        schemaLoading={schemaLoading}
        showConsole={showConsole}
        theme={theme}
        onSelectWorkspace={handleSelectWorkspace}
        onSelectTable={setActiveTable}
        onAddWorkspace={() => setShowAddWs(true)}
        onDeleteWorkspace={handleDeleteWorkspace}
        onToggleConsole={() => setShowConsole(v => !v)}
        onToggleTheme={() => setTheme(t => t === "dark" ? "light" : "dark")}
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        {error && (
          <div
            className="flex items-center gap-2 px-4 py-2 text-xs"
            style={{
              background: "rgba(248,113,113,0.08)",
              borderBottom: "1px solid rgba(248,113,113,0.2)",
              color: "var(--red)",
            }}
          >
            <AlertTriangle size={13} />
            <span>{error}</span>
            <button
              className="ml-auto btn-ghost"
              style={{ padding: "2px 6px", display: "flex", alignItems: "center" }}
              onClick={() => setError(null)}
            >
              <X size={12} />
            </button>
          </div>
        )}

        {activeWsId && activeTable ? (
          <TableView
            workspaceId={activeWsId}
            tableName={activeTable}
            columns={activeColumns}
            schema={schema}
            viewMode={viewMode}
            refreshKey={refreshKey}
            onViewModeChange={setViewMode}
          />
        ) : (
          <EmptyState
            hasWorkspace={!!activeWsId}
            onAddWorkspace={() => setShowAddWs(true)}
          />
        )}

        {showConsole && activeWsId && (
          <SqlConsole
            workspaceId={activeWsId}
            onClose={() => setShowConsole(false)}
          />
        )}
      </main>

      {showAddWs && (
        <AddWorkspaceModal
          onAdd={handleAddWorkspace}
          onClose={() => setShowAddWs(false)}
        />
      )}
    </div>
  );
}

function EmptyState({
  hasWorkspace,
  onAddWorkspace,
}: {
  hasWorkspace: boolean;
  onAddWorkspace: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4">
      <div
        style={{
          fontSize: 48,
          opacity: 0.12,
          fontWeight: 700,
          letterSpacing: "-0.04em",
        }}
      >
        basedly
      </div>
      <p style={{ color: "var(--text-3)", fontSize: 13 }}>
        {hasWorkspace
          ? "Select a table from the sidebar"
          : "Connect a PostgreSQL database to get started"}
      </p>
      {!hasWorkspace && (
        <button className="btn btn-primary" onClick={onAddWorkspace}>
          + Add connection
        </button>
      )}
    </div>
  );
}
