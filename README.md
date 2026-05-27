<div align="center">
  <img src="src-tauri/icons/128x128.png" alt="Basedly Logo" width="120" height="120">

# Basedly

**The No-Nonsense, Local-First Database Workspace**

[![Tauri](https://img.shields.io/badge/tauri-v2-blue.svg?style=flat-square)](https://tauri.app)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg?style=flat-square)](#)
[![Built with Rust](https://img.shields.io/badge/built%20with-Rust-orange.svg?style=flat-square)](https://www.rust-lang.org)

</div>

<br>

## Overview

**Basedly** is a local-first desktop database GUI built with Tauri v2 and React. It turns a raw PostgreSQL or SQLite schema into an interactive, Notion-style workspace - with inline editing, row insertion, Kanban boards, and a full SQL console. Data never leaves your machine, setup takes under 30 seconds, and a virtual rendering engine handles millions of rows at hardware speed.

It also ships a built-in **MCP server** (Model Context Protocol) so AI assistants like Claude can query and operate your databases directly - with real-time toast notifications in the UI showing exactly what the agent did and an undo button for destructive operations.

## Features

- **Grid View** - Infinitely scrolling virtual data grid with inline cell editing, resizable columns, and server-side filtering (Ctrl+F). TanStack Virtual keeps RAM usage flat regardless of table size.
- **Insert Row** - Floating `+ New row` button opens a type-aware form. Primary key fields are optional (auto-assigned by the DB); required fields are validated before submit.
- **Composite & No-PK Tables** - Tables with composite primary keys use a full multi-column `WHERE` clause for updates. Tables with no primary key are shown read-only with a clear status indicator.
- **Page View (Side-Peek)** - Click any row for a Notion-style detail panel with type-aware field renderers: toggles for booleans, expandable JSON, FK link navigation.
- **Board View (Kanban)** - Any enum column becomes a drag-and-drop Kanban board. Moving a card fires a live `UPDATE` via the Rust backend.
- **SQL Console** - Built-in query editor with live results, error display, and affected-row counts.
- **Export CSV** - Native OS save dialog, respects active sort and filter, up to 100 000 rows with UTF-8 BOM.
- **MCP Server** - Exposes your workspace to AI models via a local HTTP+WebSocket server on `localhost:8453`. Tools include schema inspection, table queries, arbitrary SQL, and row-level mutations.
- **AI Activity Toasts** - Real-time notifications when an AI agent mutates the DB: color-coded by operation type (green SELECT, amber UPDATE, red DELETE, orange DDL), showing the agent name. DELETE and DDL toasts persist until dismissed and include a one-click **Undo** button.
- **Multi-Database** - Native support for PostgreSQL and SQLite. Switch between connections in a single workspace.
- **Zero-Trust Security** - Connection strings are AES-256-GCM encrypted at rest. Keys live in the OS keyring, never in plain config files.
- **Light / Dark Theme** - Adaptive title bar, system-aware theme switch.

## Quick Start

```bash
# Prerequisites: Rust toolchain, Node 18+, a PostgreSQL or SQLite connection

npm install
npm run tauri dev
```

The MCP server starts automatically alongside the app. To connect an AI assistant, add this to your MCP client config:

```json
{
  "mcpServers": {
    "basedly": {
      "type": "http",
      "url": "http://localhost:8453/mcp"
    }
  }
}
```

## MCP Tools

| Tool | Description |
| :--- | :--- |
| `describe_app` | Returns an orientation guide for the server |
| `list_workspaces` | Lists all saved database connections with IDs |
| `get_schema` | Full table/column schema with types and row counts |
| `query_table` | Paginated, sortable row fetching |
| `execute_sql` | Run arbitrary SQL (SELECT, INSERT, UPDATE, DELETE, DDL) |
| `update_row` | Update a single cell by primary key |
| `delete_row` | Delete a row by primary key - captures the full row first for undo |

## Performance Goals

- Cold boot: < 1.5 s
- Idle RAM: < 50 MB
- 5M-row table scroll: constant ~40 MB DOM footprint via virtual rendering

---

Built with Rust + React. [Report issues](https://github.com/Hoteira/basedly/issues).
