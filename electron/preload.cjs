const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("markdownViewerDesktop", {
  openMarkdownDialog: () => ipcRenderer.invoke("dialog:open-markdown"),
  readMarkdownFile: (filePath) => ipcRenderer.invoke("file:read-markdown", filePath),
  getSystemTheme: () => ipcRenderer.invoke("theme:get-system"),
  onOpenOnLaunch: (callback) => {
    const listener = (_, filePath) => callback(filePath);
    ipcRenderer.on("file:open-on-launch", listener);
    return () => ipcRenderer.removeListener("file:open-on-launch", listener);
  },
});
