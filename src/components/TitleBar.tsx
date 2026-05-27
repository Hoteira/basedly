import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Maximize2, Minimize2, Minus, X } from "lucide-react";

const appWindow = getCurrentWindow();

interface Props {
  mcpConnected?: boolean;
}

export default function TitleBar({ mcpConnected = false }: Props) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const syncState = () => {
      appWindow.isMaximized().then(setIsMaximized).catch(() => {});
      appWindow.isFullscreen().then(setIsFullscreen).catch(() => {});
    };
    syncState();

    let unlisten: (() => void) | undefined;
    appWindow.onResized(syncState).then((fn) => { unlisten = fn; }).catch(() => {});

    const onKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        const [full, max] = await Promise.all([
          appWindow.isFullscreen().catch(() => false),
          appWindow.isMaximized().catch(() => false),
        ]);
        if (!full && max) await appWindow.unmaximize().catch(() => {});
        appWindow.setFullscreen(!full).catch(() => {});
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      unlisten?.();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  if (isFullscreen) return null;

  const btnBase: React.CSSProperties = {
    width: 46,
    height: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "none",
    background: "transparent",
    color: "var(--text-2)",
    cursor: "pointer",
    flexShrink: 0,
    transition: "background 0.1s, color 0.1s",
    outline: "none",
  };

  return (
    <div
      style={{
        height: 32,
        display: "flex",
        alignItems: "center",
        background: "var(--bg-1)",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {/* Drag region fills all available space to the left of buttons */}
      <div
        style={{ flex: 1, height: "100%", cursor: "default", display: "flex", alignItems: "center", paddingLeft: 12 }}
        onMouseDown={(e) => { if (e.button === 0) appWindow.startDragging().catch(() => {}); }}
        onDoubleClick={() => isMaximized ? appWindow.unmaximize() : appWindow.maximize()}
      >
        <div
          title={mcpConnected ? "MCP sidecar connected" : "MCP sidecar offline"}
          style={{
            width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
            background: mcpConnected ? "#4caf78" : "var(--bg-4)",
            boxShadow: mcpConnected ? "0 0 0 2px rgba(76,175,120,0.25)" : "none",
            transition: "background 0.3s, box-shadow 0.3s",
          }}
        />
      </div>

      <button
        style={btnBase}
        onClick={() => appWindow.minimize()}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-3)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
        title="Minimize"
      >
        <Minus size={12} />
      </button>

      <button
        style={btnBase}
        onClick={() => isMaximized ? appWindow.unmaximize() : appWindow.maximize()}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-3)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
        title={isMaximized ? "Restore" : "Maximize"}
      >
        {isMaximized ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
      </button>

      <button
        style={btnBase}
        onClick={() => appWindow.close()}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = "var(--red)";
          (e.currentTarget as HTMLElement).style.color = "#fff";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = "transparent";
          (e.currentTarget as HTMLElement).style.color = "var(--text-2)";
        }}
        title="Close"
      >
        <X size={13} />
      </button>
    </div>
  );
}
