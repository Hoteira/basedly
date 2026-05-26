import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Maximize2, Minimize2, Minus, X } from "lucide-react";

const appWindow = getCurrentWindow();

export default function TitleBar() {
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
        const full = await appWindow.isFullscreen().catch(() => false);
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
        style={{ flex: 1, height: "100%", cursor: "default" }}
        onMouseDown={(e) => { if (e.button === 0) appWindow.startDragging().catch(() => {}); }}
        onDoubleClick={() => isMaximized ? appWindow.unmaximize() : appWindow.maximize()}
      />

      {/* Minimize */}
      <button
        style={btnBase}
        onClick={() => appWindow.minimize()}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-3)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
        title="Minimize"
      >
        <Minus size={12} />
      </button>

      {/* Maximize / Restore */}
      <button
        style={btnBase}
        onClick={() => isMaximized ? appWindow.unmaximize() : appWindow.maximize()}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-3)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
        title={isMaximized ? "Restore" : "Maximize"}
      >
        {isMaximized ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
      </button>

      {/* Close */}
      <button
        style={btnBase}
        onClick={() => appWindow.close()}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = "#c42b1c";
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
