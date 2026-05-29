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

<div align="center">

[<video src="https://github.com/Hoteira/basedly/blob/1960b9f61894da9bacee6728ce422e203b25b21f/video.mp4" controls width="480" height="270"></video>
](https://github.com/user-attachments/assets/c77d902a-dceb-4140-9b25-ffd077de9497)

</div>

<br>

## What is this

Not supposed to be a super enterprise serious project, just hope somebody finds it useful.

Its a desktop database client for postgres + sqlite (others coming). Two things make it different from the 47 other ones:

1. You can point Claude or Gemini at it and watch the AI edit your db live, with one-click undo when it inevitably screws something up. GUI notifications for every action the AI does so y'all can fix the mess after posting on X.
2. It doesnt look like it was designed in 2008. Rows open into notion-style pages, enum columns turn into kanban boards, dark mode obviously.

I built it because i was bored and fatigued by everything having a subscription for no reason. You can write SQL if you want but it's not a constraint.

## Stuff it can do

- MCP - point Claude or Gemini at it and watch what it does to your db live, with notifications + undo on deletes
- rows open into a notion-style side panel — booleans become toggles, json gets pretty-printed, etc
- enum columns turn into a kanban board and dragging cards actually saves to the db
- normal grid view with double-click cell editing for when you just need to fix a value
- sql console if you want to type queries
- csv export
- dark mode (obviously)
- passwords go in the OS keyring not a config file

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

## Stuff i used

react, typescript, rust, tauri, tailwind. the virtual scrolling is TanStack Virtual so it doesnt die on big tables

---

if something breaks open an issue idk. [issues here](https://github.com/Hoteira/basedly/issues)
