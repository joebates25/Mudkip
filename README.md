# Mudkip

<img src="src-tauri/icons/icon.png" alt="Mudkip icon" width="128" />

Read-only markdown viewer built with **Tauri + Vite**, styled to match **VS Code Markdown Preview**.

## Motiviation

I liked how markdown files looked in VS Code Preview mode but didn't like having to open VS Code to view them. 

## Run (Desktop)

```bash
bun install
bun run desktop
```

## Run With CLI Options

```bash
# Open file in Light+ theme, TOC open, auto-refresh enabled
bun run desktop -- --theme light --toc-open --watch ./notes.md
```

Supported options:

- `--theme <dark|light>` (aliases: `--dark`, `--light`)
- `--toc-open` / `--toc-closed` (or `--toc`, `--toc=closed`)
- `--watch` / `--no-watch` (or `--watch=off`)
- `-h`, `--help`
- `-V`, `--version`

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
- Startup CLI overrides for theme, TOC open state, and file watching

## Project Layout

- `index.html`: app shell
- `src/main.js`: renderer behavior
- `src/desktop-api.js`: Tauri desktop bridge for renderer
- `src-tauri/src/lib.rs`: native commands/events/state
- `src-tauri/tauri.conf.json`: Tauri app and bundling config
- `benchmark/summary.md`: latest performance snapshot summary
