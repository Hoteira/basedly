import { useCallback, useEffect, useRef, useState } from "react";
import { ipc } from "./ipc";
import type { ColumnInfo, TableInfo, ViewMode, WorkspaceConfig } from "./types";
import AddWorkspaceModal from "./components/AddWorkspaceModal";
import Sidebar from "./components/Sidebar";
import TableView from "./components/TableView";

export default function App() {
  const [workspaces, setWorkspaces] = useState<WorkspaceConfig[]>([]);
  const [activeWsId, setActiveWsId] = useState<string | null>(null);
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [schema, setSchema] = useState<TableInfo[]>([]);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [showAddWs, setShowAddWs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);

  // Load workspaces on mount
  useEffect(() => {
    ipc.getWorkspaces().then(setWorkspaces).catch(console.error);
  }, []);

  const handleSelectWorkspace = useCallback(
    async (ws: WorkspaceConfig) => {
      setActiveWsId(ws.id);
      setActiveTable(null);
      setSchema([]);
      setError(null);

      // Connect if not already
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

      // Load schema
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
        onSelectWorkspace={handleSelectWorkspace}
        onSelectTable={setActiveTable}
        onAddWorkspace={() => setShowAddWs(true)}
        onDeleteWorkspace={handleDeleteWorkspace}
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
            <span>⚠</span>
            <span>{error}</span>
            <button
              className="ml-auto btn-ghost"
              style={{ padding: "2px 6px", fontSize: 11 }}
              onClick={() => setError(null)}
            >
              ✕
            </button>
          </div>
        )}

        {activeWsId && activeTable ? (
          <TableView
            workspaceId={activeWsId}
            tableName={activeTable}
            columns={activeColumns}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
        ) : (
          <EmptyState
            hasWorkspace={!!activeWsId}
            onAddWorkspace={() => setShowAddWs(true)}
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
