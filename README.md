# Mudkip

Read-only markdown viewer built with **Tauri + Vite**, styled to match **VS Code Markdown Preview**.

## Run (Desktop)

```bash
bun install
bun run desktop
```

## Build Release Bundles

```bash
bun run desktop:dist
```

## Features

- Native markdown file picker
- Launch-path and external file-open handling
- Table of contents drawer
- Open current source location in VS Code
- Auto-refresh while the opened file changes on disk
- Dark+/Light+ theme toggle aligned with system preference on launch

## Project Layout

- `index.html`: app shell
- `src/main.js`: renderer behavior
- `src/desktop-api.js`: Tauri desktop bridge for renderer
- `src-tauri/src/lib.rs`: native commands/events/state
- `src-tauri/tauri.conf.json`: Tauri app and bundling config
- `benchmark/summary.md`: latest performance snapshot summary
