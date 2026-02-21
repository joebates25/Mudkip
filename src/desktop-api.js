import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

function addEventListener(eventName, callback) {
  let unlisten = null;

  listen(eventName, (event) => {
    callback(event.payload);
  })
    .then((dispose) => {
      unlisten = dispose;
    })
    .catch((error) => {
      console.error(`Failed to listen for ${eventName}:`, error);
    });

  return () => {
    if (unlisten) {
      unlisten();
    }
  };
}

window.markdownViewerDesktop = {
  async openMarkdownDialog() {
    const payload = await invoke("pick_markdown_file");
    if (!payload) {
      return { canceled: true };
    }
    return { canceled: false, payload };
  },
  readMarkdownFile(filePath) {
    return invoke("read_markdown_file", { path: filePath });
  },
  openInVSCodeAtLine(filePath, line) {
    return invoke("open_in_vscode", { path: filePath, line });
  },
  startAutoRefreshWatch(filePath) {
    return invoke("filewatch_start", { path: filePath });
  },
  stopAutoRefreshWatch() {
    return invoke("filewatch_stop");
  },
  getSystemTheme() {
    return invoke("theme_get_system");
  },
  getStartupOptions() {
    return invoke("app_get_startup_options");
  },
  consumePendingExternalOpenPath() {
    return invoke("file_consume_pending_opened_path");
  },
  onOpenOnLaunch(callback) {
    return addEventListener("file:open-on-launch", callback);
  },
  onExternalFileOpen(callback) {
    return addEventListener("file:opened-external", callback);
  },
  onFileChanged(callback) {
    return addEventListener("file:changed", callback);
  },
  onStartupOptions(callback) {
    return addEventListener("app:startup-options", callback);
  },
};
