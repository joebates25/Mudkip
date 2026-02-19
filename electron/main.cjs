const { app, BrowserWindow, dialog, ipcMain, nativeTheme } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdown", ".mkd", ".txt"]);

let mainWindow = null;
const pendingExternalOpenPaths = [];

function isMarkdownPath(candidatePath) {
  const ext = path.extname(candidatePath).toLowerCase();
  return MARKDOWN_EXTENSIONS.has(ext);
}

function normalizeBaseHref(filePath) {
  const directory = path.dirname(filePath);
  const directoryWithSlash = path.join(directory, path.sep);
  return pathToFileURL(directoryWithSlash).href;
}

async function readMarkdownPayload(filePath) {
  const resolvedPath = path.resolve(filePath);
  const content = await fs.readFile(resolvedPath, "utf8");
  return {
    filePath: resolvedPath,
    fileName: path.basename(resolvedPath),
    baseHref: normalizeBaseHref(resolvedPath),
    content,
  };
}

function resolveLaunchPath() {
  const argv = process.argv.slice(1);
  for (const arg of argv) {
    if (!arg || arg.startsWith("-")) {
      continue;
    }
    const candidate = path.resolve(arg);
    if (isMarkdownPath(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveRendererURL() {
  const devURL = process.env.MARKDOWN_VIEWER_DEV_URL;
  if (devURL) {
    return devURL;
  }
  return null;
}

function trySpawnDetached(command, args) {
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function openInVSCodeAtLine(filePath, line) {
  const lineNumber = Number.isFinite(line) ? Math.max(1, Math.floor(line)) : 1;
  const target = `${path.resolve(filePath)}:${lineNumber}`;

  if (process.platform === "darwin") {
    if (trySpawnDetached("code", ["-n", "-g", target])) {
      return;
    }
    if (trySpawnDetached("open", ["-a", "Visual Studio Code", "--args", "-n", "-g", target])) {
      return;
    }
    throw new Error("Unable to launch VS Code. Install `code` or ensure VS Code is installed.");
  }

  if (trySpawnDetached("code", ["-n", "-g", target])) {
    return;
  }
  throw new Error("Unable to launch VS Code using `code`.");
}

function flushPendingExternalOpens() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  while (pendingExternalOpenPaths.length > 0) {
    const filePath = pendingExternalOpenPaths.shift();
    mainWindow.webContents.send("file:opened-external", filePath);
  }
}

function queueExternalOpen(filePath) {
  if (!filePath || typeof filePath !== "string") {
    return;
  }

  const resolvedPath = path.resolve(filePath);
  if (!isMarkdownPath(resolvedPath)) {
    return;
  }

  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.send("file:opened-external", resolvedPath);
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  pendingExternalOpenPaths.push(resolvedPath);
}

function createMainWindow(launchFilePath) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 760,
    minHeight: 500,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const rendererURL = resolveRendererURL();
  if (rendererURL) {
    mainWindow.loadURL(rendererURL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.once("did-finish-load", () => {
    if (launchFilePath) {
      mainWindow.webContents.send("file:open-on-launch", launchFilePath);
    }
    flushPendingExternalOpens();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

ipcMain.handle("dialog:open-markdown", async () => {
  const result = await dialog.showOpenDialog({
    title: "Open Markdown File",
    properties: ["openFile"],
    filters: [
      { name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd", "txt"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];
  const payload = await readMarkdownPayload(filePath);
  return { canceled: false, payload };
});

ipcMain.handle("file:read-markdown", async (_, filePath) => {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("Invalid file path.");
  }
  return readMarkdownPayload(path.resolve(filePath));
});

ipcMain.handle("file:consume-pending-opened-path", () => {
  return pendingExternalOpenPaths.shift() ?? null;
});

ipcMain.handle("editor:open-in-vscode", (_, payload) => {
  if (!payload || typeof payload.filePath !== "string") {
    throw new Error("Invalid VS Code request payload.");
  }

  openInVSCodeAtLine(payload.filePath, payload.line);
  return true;
});

ipcMain.handle("theme:get-system", () => {
  return nativeTheme.shouldUseDarkColors ? "vscode-dark" : "vscode-light";
});

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  queueExternalOpen(filePath);

  if (app.isReady() && (!mainWindow || mainWindow.isDestroyed())) {
    createMainWindow(null);
  }
});

app.whenReady().then(() => {
  const launchFilePath = resolveLaunchPath();
  createMainWindow(launchFilePath);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(null);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
