import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal, X } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import CodeMirror from "@uiw/react-codemirror";
import { sql, PostgreSQL, SQLite, type SQLNamespace } from "@codemirror/lang-sql";
import { EditorView, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { ipc } from "../ipc";
import type { TableInfo } from "../types";

interface Props {
  workspaceId: string;
  schema: TableInfo[];
  dbType?: "postgres" | "sqlite";
  onClose: () => void;
}

const PAGE_SIZE = 200;
const ROW_H = 28;
const COL_W = 200;

// editor theme from app css vars, adapts to light/dark
const editorTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--text-1)", fontSize: "13px" },
  "&.cm-focused": { outline: "none" },
  ".cm-content": { fontFamily: "var(--font-mono)", caretColor: "var(--accent)", padding: "8px 0" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "var(--text-3)" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 12px" },
  ".cm-activeLine": { backgroundColor: "rgba(127,127,127,0.06)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-2)" },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--accent-subtle)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--bg-2)",
    border: "1px solid var(--border-strong)",
    borderRadius: "6px",
    boxShadow: "var(--toast-shadow)",
    overflow: "hidden",
  },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono)", fontSize: "12px", maxHeight: "220px" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "3px 8px", color: "var(--text-2)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent-subtle)",
    color: "var(--text-1)",
  },
  ".cm-completionIcon": { color: "var(--text-3)", paddingRight: "6px" },
  ".cm-completionLabel": { color: "inherit" },
  ".cm-completionDetail": { color: "var(--text-3)", fontStyle: "normal" },
});

// syntax colors
const sqlHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "var(--accent)" },
  { tag: [t.string, t.special(t.string)], color: "var(--green)" },
  { tag: t.number, color: "#b08bf0" },
  { tag: [t.bool, t.null], color: "#b08bf0" },
  { tag: t.comment, color: "var(--text-3)", fontStyle: "italic" },
  { tag: [t.operator, t.punctuation, t.separator], color: "var(--text-2)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#e09a5a" },
  { tag: [t.typeName, t.tagName], color: "#8baab8" },
  { tag: t.propertyName, color: "var(--text-1)" },
]);

function formatVal(v: unknown): string {
  if (v == null) return "null";
  if (typeof v === "object") {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}

// wrap for paging. newline before ) guards trailing -- comments
function pageQuery(base: string, offset: number): string {
  return `SELECT * FROM (\n${base}\n) AS _basedly_q LIMIT ${PAGE_SIZE} OFFSET ${offset}`;
}

function countQuery(base: string): string {
  return `SELECT COUNT(*) AS _basedly_count FROM (\n${base}\n) AS _basedly_q`;
}

export default function SqlConsole({ workspaceId, schema, dbType, onClose }: Props) {
  const [sqlText, setSqlText] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [executed, setExecuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // exact total, null until the count resolves
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [height, setHeight] = useState(300);

  const heightRef = useRef(300);
  const scrollRef = useRef<HTMLDivElement>(null);
  // query we're paging, null if not pageable
  const pagedSqlRef = useRef<string | null>(null);
  const offsetRef = useRef(0);
  const loadingMoreRef = useRef(false);
  // bump per run so a stale count can't overwrite
  const runIdRef = useRef(0);

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
    const base = sqlText.trim().replace(/;+\s*$/, ""); // drop trailing semicolons
    if (!base || running) return;

    setRunning(true);
    setError(null);
    setRows([]);
    setExecuted(false);
    setElapsed(null);
    setHasMore(false);
    setTotalCount(null);
    pagedSqlRef.current = null;
    offsetRef.current = 0;
    const runId = ++runIdRef.current;
    scrollRef.current?.scrollTo({ top: 0 });

    // only a single SELECT/WITH can be paged, everything else runs as-is
    const isSingle = !base.includes(";");
    const isRead = isSingle && /^(with|select)\b/i.test(base);

    const t0 = Date.now();
    try {
      if (isRead) {
        const page = await ipc.executeQuery(workspaceId, pageQuery(base, 0));
        setRows(page);
        pagedSqlRef.current = base;
        offsetRef.current = page.length;
        setHasMore(page.length === PAGE_SIZE);
        // fit in one page, so this is the total
        if (page.length < PAGE_SIZE) {
          setTotalCount(page.length);
        } else {
          // count in the background so it doesn't block the rows
          ipc.executeQuery(workspaceId, countQuery(base))
            .then((r) => {
              const raw = r[0] ? Object.values(r[0])[0] : undefined;
              // Number(null) is 0, so reject null
              const n = raw == null ? NaN : Number(raw);
              if (runIdRef.current === runId && Number.isFinite(n)) setTotalCount(n);
            })
            .catch(() => {});
        }
      } else {
        const all = await ipc.executeQuery(workspaceId, base);
        setRows(all);
        setTotalCount(all.length);
      }
      setExecuted(true);
      setElapsed(Date.now() - t0);
    } catch (e) {
      setError(String(e));
      setElapsed(Date.now() - t0);
    } finally {
      setRunning(false);
    }
  };
  // keep run() ref fresh for the keymap
  const runRef = useRef(run);
  runRef.current = run;

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || !pagedSqlRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await ipc.executeQuery(
        workspaceId,
        pageQuery(pagedSqlRef.current, offsetRef.current),
      );
      setRows((prev) => [...prev, ...page]);
      offsetRef.current += page.length;
      setHasMore(page.length === PAGE_SIZE);
    } catch (e) {
      setError(String(e));
      setHasMore(false);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [workspaceId, hasMore]);

  // dialect highlighting + schema suggestions (accept with Enter/Tab)
  const extensions = useMemo(() => {
    const schemaMap: SQLNamespace = {};
    for (const tbl of schema) {
      schemaMap[tbl.name] = tbl.columns.map((c) => c.name);
    }
    const langExt = sql({
      dialect: dbType === "sqlite" ? SQLite : PostgreSQL,
      schema: schemaMap,
      upperCaseKeywords: true,
    });
    const runKey = Prec.highest(
      keymap.of([{ key: "Mod-Enter", run: () => { runRef.current(); return true; } }]),
    );
    return [langExt, runKey, syntaxHighlighting(sqlHighlight), EditorView.lineWrapping];
  }, [schema, dbType]);

  const cols = rows.length > 0 ? Object.keys(rows[0]) : [];

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });

  // load the next page near the end
  useEffect(() => {
    const items = rowVirtualizer.getVirtualItems();
    if (!items.length) return;
    const last = items[items.length - 1];
    if (last.index >= rows.length - 20 && hasMore && !loadingMoreRef.current) {
      loadMore();
    }
  });

  return (
    <div style={{ background: "var(--bg-1)", display: "flex", flexDirection: "column", height, flexShrink: 0, position: "relative" }}>
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

      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderTop: "2px solid var(--border)", borderBottom: "1px solid var(--border)", background: "var(--bg-2)", flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", display: "flex", alignItems: "center", gap: 5 }}><Terminal size={12} /> SQL Console</span>
        <button
          onClick={onClose}
          style={{ marginLeft: "auto", background: "transparent", border: "none", cursor: "pointer", color: "var(--text-3)", padding: "2px 4px", display: "flex", alignItems: "center" }}
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0, alignItems: "stretch" }}>
        <div style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", background: "var(--bg-2)" }}>
          <CodeMirror
            value={sqlText}
            onChange={setSqlText}
            height="84px"
            theme={editorTheme}
            extensions={extensions}
            placeholder="SELECT * FROM …  (Ctrl+Enter to run · Ctrl+Space for suggestions)"
            basicSetup={{
              lineNumbers: true,
              foldGutter: false,
              highlightActiveLine: true,
              autocompletion: true,
              bracketMatching: true,
              closeBrackets: true,
              highlightSelectionMatches: false,
            }}
          />
        </div>
        <button
          className="btn btn-primary"
          onClick={run}
          disabled={running || !sqlText.trim()}
          style={{ padding: "6px 16px", fontSize: 12, alignSelf: "flex-end", flexShrink: 0 }}
        >
          {running ? "…" : "Run"}
        </button>
      </div>

      {error ? (
        <div style={{ flex: 1, overflow: "auto", padding: "8px 12px", color: "var(--red)", fontSize: 12, fontFamily: "JetBrains Mono, monospace", whiteSpace: "pre-wrap" }}>
          {error}
        </div>
      ) : executed ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ padding: "4px 12px", fontSize: 10, color: "var(--text-3)", borderBottom: "1px solid var(--border)", background: "var(--bg-2)", flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <span>
              {totalCount != null
                ? `${totalCount.toLocaleString()} row${totalCount !== 1 ? "s" : ""}`
                : `${rows.length.toLocaleString()}${hasMore ? "+" : ""} row${rows.length !== 1 ? "s" : ""}`}
            </span>
            {totalCount == null && hasMore && <span style={{ opacity: 0.7 }}>counting…</span>}
            {elapsed != null && <span>{elapsed}ms</span>}
            {loadingMore && <span style={{ color: "var(--accent)" }}>loading…</span>}
            {totalCount == null && hasMore && !loadingMore && <span style={{ color: "var(--text-3)" }}>scroll for more</span>}
          </div>

          {rows.length === 0 ? (
            <div style={{ padding: "12px", fontSize: 12, color: "var(--text-3)" }}>No rows returned.</div>
          ) : (
            <div ref={scrollRef} style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
              <div style={{ minWidth: cols.length * COL_W, fontSize: 12 }}>
                {/* sticky header */}
                <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 1, background: "var(--bg-2)", borderBottom: "1px solid var(--border)" }}>
                  {cols.map((c) => (
                    <div key={c} style={{ width: COL_W, flexShrink: 0, padding: "4px 12px", fontSize: 10, fontWeight: 600, color: "var(--text-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {c}
                    </div>
                  ))}
                </div>

                {/* virtualized rows */}
                <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
                  {rowVirtualizer.getVirtualItems().map((vRow) => {
                    const row = rows[vRow.index];
                    return (
                      <div
                        key={vRow.key}
                        style={{
                          position: "absolute", top: 0, left: 0,
                          transform: `translateY(${vRow.start}px)`,
                          height: ROW_H, display: "flex",
                          width: "100%",
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        {cols.map((c) => {
                          const v = row[c];
                          return (
                            <div
                              key={c}
                              title={formatVal(v)}
                              style={{
                                width: COL_W, flexShrink: 0,
                                padding: "0 12px",
                                display: "flex", alignItems: "center",
                                color: v == null ? "var(--text-3)" : "var(--text-1)",
                                fontStyle: v == null ? "italic" : "normal",
                                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                              }}
                            >
                              {formatVal(v)}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
