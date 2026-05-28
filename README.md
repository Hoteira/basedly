<div align="center">
  <img src="src-tauri/icons/128x128.png" alt="Basedly Logo" width="120" height="120">

# Basedly

**i made a database app lol**

[![Tauri](https://img.shields.io/badge/tauri-v2-blue.svg?style=flat-square)](https://tauri.app)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg?style=flat-square)](#)
[![Built with Rust](https://img.shields.io/badge/built%20with-Rust-orange.svg?style=flat-square)](https://www.rust-lang.org)

</div>

<br>

## what is this

its a desktop app for looking at postgres/sqlite databases. you connect it to your database and it shows you the tables and lets you edit stuff without writing SQL. i built it because i was bored

it also has this thing where you can connect Claude to it and the AI can mess with your database and you can see what its doing in real time which is actually pretty cool ngl

## stuff it can do

- you can see all your table data in a grid and double click cells to edit them
- theres a little side panel that slides out when you click a row
- if you have an enum column it turns into a kanban board and you can drag cards around and it actually saves to the db
- theres a sql console if you want to just type queries
- you can export to csv
- dark mode (obviously)
- the AI thing (MCP) - you can point Claude at it and it can query your databases. it shows you notifications when the AI does something and you can undo deletes which is cool
- passwords are encrypted so theyre not just sitting in a text file

## how to run

need Rust and Node installed

```bash
npm install

# this part is for the AI stuff
cd mcp && npm install && npm run build && cd ..

npm run tauri dev
```

for the Claude integration add this to claude desktop config or whatever MCP thing you use (or you can just use the GUI's menu):

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

## the AI can do these things

| tool | description |
| :--- | :--- |
| `describe_app` | tells the AI what basedly is |
| `list_workspaces` | lists your database connections |
| `get_schema` | gets all the tables and columns |
| `query_table` | fetches rows |
| `execute_sql` | runs any sql |
| `update_row` | updates a cell |
| `delete_row` | deletes a row (saves it first so you can undo) |

## stuff i used

react, typescript, rust, tauri, tailwind. the virtual scrolling is TanStack Virtual so it doesnt die on big tables

---

if something breaks open an issue idk. [issues here](https://github.com/Hoteira/basedly/issues)
