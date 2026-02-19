const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("markdownViewerDesktop", {
  openMarkdownDialog: () => ipcRenderer.invoke("dialog:open-markdown"),
  readMarkdownFile: (filePath) => ipcRenderer.invoke("file:read-markdown", filePath),
  openInVSCodeAtLine: (filePath, line) => ipcRenderer.invoke("editor:open-in-vscode", { filePath, line }),
  getSystemTheme: () => ipcRenderer.invoke("theme:get-system"),
  consumePendingExternalOpenPath: () => ipcRenderer.invoke("file:consume-pending-opened-path"),
  onOpenOnLaunch: (callback) => {
    const listener = (_, filePath) => callback(filePath);
    ipcRenderer.on("file:open-on-launch", listener);
    return () => ipcRenderer.removeListener("file:open-on-launch", listener);
  },
  onExternalFileOpen: (callback) => {
    const listener = (_, filePath) => callback(filePath);
    ipcRenderer.on("file:opened-external", listener);
    return () => ipcRenderer.removeListener("file:opened-external", listener);
  },
});
