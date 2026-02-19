# Markdown Viewer POC

Prototype for a **read-only markdown viewer** with a local file picker and a render surface styled to match **VS Code Markdown Preview** as closely as possible.

## Run (Browser)

```bash
bun install
bun run dev
```

Open the local Vite URL (normally `http://localhost:5173`).

## Run (Cross-platform desktop: macOS, Windows, Linux)

```bash
bun install
bun run desktop
```

This builds the web renderer and starts an Electron desktop window with:

- Native OS file open dialog
- Optional launch-path file opening
- `Table of Contents` drawer (toggle from toolbar)
- `Open in VS Code` at the source line matching current preview scroll position
- `Auto-refresh` toggle to reload when the currently opened markdown file is edited/saved
- macOS external file-open event handling (`Open With` / Finder handoff)

```bash
bun run build
bunx electron . /absolute/path/to/file.md
```

## Package (macOS)

```bash
bun run desktop:dist
```

This produces a packaged macOS app/DMG with markdown file associations (`.md`, `.markdown`, `.mdown`, `.mkd`) for Finder `Open With`.

## What this prototype does

- Opens local markdown files through a file dialog
- Renders markdown read-only in a dedicated preview pane
- Uses VS Code's own markdown preview CSS as the base
- Uses VS Code-like token/theme variables for Dark+ and Light+ modes
- Supports fenced code blocks with highlighting

## Fidelity notes (VS Code parity)

This POC gets close by reusing upstream VS Code markdown preview styles from:

- `extensions/markdown-language-features/media/markdown.css`
- `extensions/markdown-language-features/media/highlight.css`

Remaining differences from true VS Code preview:

- VS Code applies full workbench theme tokens dynamically; this POC hardcodes a subset
- VS Code preview includes extension integrations and webview runtime features (such as command URIs and richer security model)
- Font rendering can differ by platform and browser

## Files

- `index.html`: app shell, toolbar, and preview mount
- `src/main.js`: file open flow and markdown rendering
- `src/styles/vscode-markdown.css`: copied from VS Code source
- `src/styles/vscode-highlight.css`: copied from VS Code source
- `src/styles/app.css`: shell styling and theme variable mapping
- `electron/main.cjs`: cross-platform desktop main process
- `electron/preload.cjs`: secure Electron IPC bridge for open/read actions
