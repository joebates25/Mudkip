# Tauri Markdown Viewer Prototype

Cross-platform prototype using Rust + Tauri while keeping other prototypes unchanged.

## Run

```bash
cd /Users/josephbates/dev/markdown-viewer-poc/tauri-app
npm install
npm run tauri:dev
```

## Launch with a file

```bash
cd /Users/josephbates/dev/markdown-viewer-poc/tauri-app
npm run tauri:dev -- /Users/josephbates/dev/tinycc/study_guide/04_parsing_symbols.md
```

Inside the app, click `Open Markdown File` to open another markdown document.

After opening a file, `Open in VS Code` will open that same file in VS Code at the source line corresponding to the current scroll position in the markdown preview.
