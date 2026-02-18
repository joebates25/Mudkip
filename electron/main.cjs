const { app, BrowserWindow, dialog, ipcMain, nativeTheme } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdown", ".mkd", ".txt"]);

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
  const content = await fs.readFile(filePath, "utf8");
  return {
    filePath,
    fileName: path.basename(filePath),
    baseHref: normalizeBaseHref(filePath),
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

function createMainWindow(launchFilePath) {
  const mainWindow = new BrowserWindow({
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

  if (launchFilePath) {
    mainWindow.webContents.once("did-finish-load", () => {
      mainWindow.webContents.send("file:open-on-launch", launchFilePath);
    });
  }

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

ipcMain.handle("theme:get-system", () => {
  return nativeTheme.shouldUseDarkColors ? "vscode-dark" : "vscode-light";
});

app.whenReady().then(() => {
  const launchFilePath = resolveLaunchPath();
  createMainWindow(launchFilePath);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(resolveLaunchPath());
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
