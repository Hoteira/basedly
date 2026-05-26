# Basedly

**The No-Nonsense, Local-First Database Workspace**

Basedly converts a raw PostgreSQL schema into an immediate, beautiful, interactive Notion-style canvas. Data never leaves your local machine, setup takes under 30 seconds, and virtual rendering processes millions of rows at hardware speeds.

## Features

- **Grid View** — Infinitely scrolling virtual data grid with inline editing. TanStack Virtual keeps RAM usage flat regardless of table size.
- **Page View (Side-Peek)** — Click any row for a Notion-style detail panel with type-aware field renderers (toggles for booleans, expandable JSON, FK link navigation).
- **Board View (Kanban)** — Any enum column becomes a drag-and-drop Kanban board. Moving a card fires a live `UPDATE` query via the Rust core.
- **Zero-Trust Security** — Connection strings stored in the OS secure keyring (Windows Credential Manager / Linux Secret Service), never in plain config files.

## Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri v2 (Rust) |
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS |
| Virtual scroll | TanStack Virtual v3 |
| Drag-and-drop | dnd-kit |
| Database driver | SQLx 0.8 (async Rust, PostgreSQL) |
| Credentials | OS Keyring (keyring-rs v3) |

## Quick Start

```bash
# Prerequisites: Rust, Node 18+, PostgreSQL connection string

npm install
npm run tauri dev
```

## Performance Goals

- Cold boot: < 1.5 s
- Idle RAM: < 50 MB
- 5M-row table scroll: constant ~40 MB DOM footprint via virtual rendering

## Pricing

| Tier | Price | What's included |
|---|---|---|
| Indie | Free | Full local app, unlimited DB scale, all views |
| Professional | $79 lifetime | Multi-env dashboards, inline AI SQL assistant |
| Enterprise | $12/user/mo | Encrypted shared vaults, audit logging, team spaces |

---

Built with Rust + React. [Report issues](https://github.com/Hoteira/basedly/issues).
