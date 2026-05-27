import type { ReactNode } from "react";

export default function StatusBar({ children }: { children: ReactNode }) {
  return (
    <div style={{
      flexShrink: 0, background: "var(--bg-1)", borderTop: "1px solid var(--border)",
      padding: "9px 14px", fontSize: 11, color: "var(--text-3)",
      display: "flex", alignItems: "center", gap: 12,
    }}>
      {children}
    </div>
  );
}
