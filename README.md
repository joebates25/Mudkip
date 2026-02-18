# Markdown Viewer POC

Prototype for a **read-only markdown viewer** with a local file picker and a render surface styled to match **VS Code Markdown Preview** as closely as possible.

## Run

```bash
npm install
npm run dev
```

Open the local Vite URL (normally `http://localhost:5173`).

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
