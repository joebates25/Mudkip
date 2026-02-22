import "./desktop-api.js";
import MarkdownIt from "markdown-it";
import markdownItTaskLists from "markdown-it-task-lists";
import markdownItFootnote from "markdown-it-footnote";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdownLanguage from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import DOMPurify from "dompurify";

import "./styles/vscode-markdown.css";
import "./styles/vscode-highlight.css";
import "./styles/app.css";

const desktopAPI = window.markdownViewerDesktop ?? null;

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdownLanguage);
hljs.registerLanguage("md", markdownLanguage);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("text", plaintext);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);

const previewEl = document.getElementById("preview");
const appShellEl = document.querySelector(".app-shell");
const openFileControlsEl = document.querySelector(".open-file-controls");
const openFileButton = document.getElementById("open-file-button");
const openFileOptionsButton = document.getElementById("open-file-options-button");
const openFileOptionsMenu = document.getElementById("open-file-options-menu");
const openFolderButton = document.getElementById("open-folder-button");
const toggleTOCButton = document.getElementById("toggle-toc-button");
const toggleFolderPanelButton = document.getElementById("toggle-folder-panel-button");
const toggleThemeButton = document.getElementById("toggle-theme-button");
const openVSCodeButton = document.getElementById("open-vscode-button");
const toggleAutoRefreshButton = document.getElementById("toggle-autorefresh-button");
const fileInput = document.getElementById("file-input");
const fileNameEl = document.getElementById("file-name");
const tocDrawerEl = document.getElementById("toc-drawer");
const tocListEl = document.getElementById("toc-list");
const tocEmptyEl = document.getElementById("toc-empty");
const folderFilesDrawerEl = document.getElementById("folder-files-drawer");
const folderFilesListEl = document.getElementById("folder-files-list");
const folderFilesEmptyEl = document.getElementById("folder-files-empty");

let currentFilePath = null;
let currentFolderPath = null;
let currentOpenMode = "single-file";
let folderFiles = [];
let autoRefreshEnabled = true;

function markdownSourceLinePlugin(md) {
  md.core.ruler.after("block", "attach_source_lines", (state) => {
    for (const token of state.tokens) {
      if (!token.map || token.nesting !== 1 || !token.type.endsWith("_open")) {
        continue;
      }

      const [startLine, endLine] = token.map;
      token.attrSet("data-source-line", String(startLine + 1));
      token.attrSet("data-source-line-end", String(Math.max(startLine + 1, endLine)));
    }
  });
}

const markdown = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight(str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
    }
    return `<pre class="hljs"><code>${hljs.highlightAuto(str).value}</code></pre>`;
  },
})
  .use(markdownItTaskLists, { enabled: true, label: true })
  .use(markdownItFootnote)
  .use(markdownSourceLinePlugin);

const defaultMarkdown = `# Mudkip

Read-only preview tuned to match VS Code Markdown Preview.

- Native file open dialog in desktop app
- Table of contents drawer from headings
- "Open in VS Code" at current scroll position
- Auto-refresh on save for opened files

Use **Open File** to load a local markdown file.
`;

function closeOpenFileOptionsMenu() {
  openFileControlsEl.classList.remove("open");
  openFileOptionsButton.setAttribute("aria-expanded", "false");
}

function toggleOpenFileOptionsMenu() {
  const nextOpenState = !openFileControlsEl.classList.contains("open");
  openFileControlsEl.classList.toggle("open", nextOpenState);
  openFileOptionsButton.setAttribute("aria-expanded", String(nextOpenState));
}

function updateThemeToggleButton() {
  const isDarkTheme = document.body.classList.contains("vscode-dark");

  if (isDarkTheme) {
    toggleThemeButton.innerHTML = "&#9728;";
    toggleThemeButton.title = "Switch to Light theme";
    toggleThemeButton.setAttribute("aria-label", "Switch to Light theme");
    return;
  }

  toggleThemeButton.innerHTML = "&#9790;";
  toggleThemeButton.title = "Switch to Dark theme";
  toggleThemeButton.setAttribute("aria-label", "Switch to Dark theme");
}

function setTheme(themeClass) {
  document.body.classList.remove("vscode-dark", "vscode-light");
  document.body.classList.add(themeClass);
  updateThemeToggleButton();
}

function isThemeClass(value) {
  return value === "vscode-dark" || value === "vscode-light";
}

function setTOCOpen(isOpen) {
  appShellEl.classList.toggle("toc-open", isOpen);
  toggleTOCButton.setAttribute("aria-expanded", String(isOpen));
  tocDrawerEl.setAttribute("aria-hidden", String(!isOpen));
}

function setFolderPanelOpen(isOpen) {
  const canShowPanel = !toggleFolderPanelButton.hidden;
  const shouldOpen = canShowPanel && isOpen;

  appShellEl.classList.toggle("folder-files-open", shouldOpen);
  toggleFolderPanelButton.setAttribute("aria-expanded", String(shouldOpen));
  folderFilesDrawerEl.setAttribute("aria-hidden", String(!shouldOpen));
}

function setFolderPanelVisible(isVisible) {
  toggleFolderPanelButton.hidden = !isVisible;
  if (!isVisible) {
    setFolderPanelOpen(false);
  }
}

async function applyThemeFromSystemPreference() {
  if (!desktopAPI || typeof desktopAPI.getSystemTheme !== "function") {
    setTheme("vscode-dark");
    return;
  }

  try {
    const systemTheme = await desktopAPI.getSystemTheme();
    if (isThemeClass(systemTheme)) {
      setTheme(systemTheme);
      return;
    }
  } catch {
    // Fall back to Dark+ below.
  }

  setTheme("vscode-dark");
}

function applyStartupOptions(options, config = {}) {
  if (!options || typeof options !== "object") {
    return;
  }

  const syncWatcher = config.syncWatcher !== false;

  if (isThemeClass(options.theme)) {
    setTheme(options.theme);
  }

  if (typeof options.tocOpen === "boolean") {
    setTOCOpen(options.tocOpen);
  }

  if (typeof options.autoRefresh === "boolean") {
    autoRefreshEnabled = options.autoRefresh;
    updateAutoRefreshButton();

    if (syncWatcher) {
      syncAutoRefreshWatcher().catch((error) => {
        console.error("Failed to sync auto-refresh watcher:", error);
      });
    }
  }
}

function slugifyHeading(text) {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "section"
  );
}

function rebuildTableOfContents() {
  const headings = Array.from(previewEl.querySelectorAll("h1, h2, h3, h4, h5, h6"));
  const seenIds = new Map();
  tocListEl.innerHTML = "";

  if (headings.length === 0) {
    tocEmptyEl.hidden = false;
    return;
  }

  tocEmptyEl.hidden = true;

  for (const heading of headings) {
    const text = heading.textContent?.trim();
    if (!text) {
      continue;
    }

    const level = Number.parseInt(heading.tagName.slice(1), 10);
    const baseSlug = slugifyHeading(text);
    const currentCount = seenIds.get(baseSlug) ?? 0;
    seenIds.set(baseSlug, currentCount + 1);
    const id = currentCount === 0 ? baseSlug : `${baseSlug}-${currentCount + 1}`;
    heading.id = id;

    const item = document.createElement("li");
    item.className = "toc-item";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "toc-link";
    button.textContent = text;
    button.dataset.targetId = id;
    button.style.paddingLeft = `${12 + Math.max(0, level - 1) * 14}px`;

    item.append(button);
    tocListEl.append(item);
  }
}

function setBaseHref(baseHref) {
  let baseEl = document.getElementById("markdown-base-href");
  if (!baseEl) {
    baseEl = document.createElement("base");
    baseEl.id = "markdown-base-href";
    document.head.appendChild(baseEl);
  }
  baseEl.setAttribute("href", baseHref ?? "./");
}

function renderMarkdown(source, options = {}) {
  setBaseHref(options.baseHref);
  const rendered = markdown.render(source);
  previewEl.innerHTML = DOMPurify.sanitize(rendered);
  rebuildTableOfContents();
}

function getPreviewScrollRatio() {
  const maxScroll = previewEl.scrollHeight - previewEl.clientHeight;
  if (maxScroll <= 0) {
    return 0;
  }
  return previewEl.scrollTop / maxScroll;
}

function restorePreviewScrollRatio(ratio) {
  const maxScroll = previewEl.scrollHeight - previewEl.clientHeight;
  if (maxScroll <= 0) {
    previewEl.scrollTop = 0;
    return;
  }
  previewEl.scrollTop = Math.max(0, Math.min(maxScroll, maxScroll * ratio));
}

async function syncAutoRefreshWatcher() {
  if (!desktopAPI) {
    return;
  }

  if (!autoRefreshEnabled || !currentFilePath || typeof desktopAPI.startAutoRefreshWatch !== "function") {
    if (typeof desktopAPI.stopAutoRefreshWatch === "function") {
      await desktopAPI.stopAutoRefreshWatch();
    }
    return;
  }

  await desktopAPI.startAutoRefreshWatch(currentFilePath);
}

async function syncFolderWatcher() {
  if (!desktopAPI) {
    return;
  }

  if (currentOpenMode !== "folder" || !currentFolderPath || typeof desktopAPI.startFolderWatch !== "function") {
    if (typeof desktopAPI.stopFolderWatch === "function") {
      await desktopAPI.stopFolderWatch();
    }
    return;
  }

  await desktopAPI.startFolderWatch(currentFolderPath);
}

function syncFolderWatcherWithLogging() {
  syncFolderWatcher().catch((error) => {
    console.error("Failed to sync folder watcher:", error);
  });
}

function updateFolderFilesList(files, selectedPath = null) {
  folderFiles = Array.isArray(files) ? files : [];
  folderFilesListEl.innerHTML = "";

  if (folderFiles.length === 0) {
    folderFilesEmptyEl.hidden = false;
    return { hasFiles: false, hasSelection: false };
  }

  folderFilesEmptyEl.hidden = true;

  let hasSelection = false;

  for (const file of folderFiles) {
    if (!file?.filePath) {
      continue;
    }

    const item = document.createElement("li");
    item.className = "toc-item";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "folder-file-link";
    button.dataset.filePath = file.filePath;
    button.textContent = file.fileName || file.filePath;

    if (selectedPath && file.filePath === selectedPath) {
      button.setAttribute("aria-current", "true");
      hasSelection = true;
    }

    item.append(button);
    folderFilesListEl.append(item);
  }

  if (folderFilesListEl.children.length === 0) {
    folderFilesEmptyEl.hidden = false;
    return { hasFiles: false, hasSelection: false };
  }

  return { hasFiles: true, hasSelection };
}

function renderFolderEmptyState() {
  renderMarkdown("## No Markdown files found\n\nThis folder does not currently contain markdown files.");
  fileNameEl.textContent = "No Markdown files in folder";
  currentFilePath = null;
  openVSCodeButton.disabled = true;

  syncAutoRefreshWatcher().catch((error) => {
    console.error("Failed to stop auto-refresh watcher:", error);
  });
}

function renderFolderSelectionPrompt() {
  renderMarkdown("## Select a Markdown file\n\nUse the folder files panel on the right to pick a file.");
  fileNameEl.textContent = "No file selected";
  currentFilePath = null;
  openVSCodeButton.disabled = true;

  syncAutoRefreshWatcher().catch((error) => {
    console.error("Failed to stop auto-refresh watcher:", error);
  });
}

function enterSingleFileMode() {
  currentOpenMode = "single-file";
  currentFolderPath = null;
  updateFolderFilesList([], null);
  setFolderPanelVisible(false);
  syncFolderWatcherWithLogging();
}

function applyFolderPayload(payload, options = {}) {
  if (!payload || typeof payload !== "object") {
    return;
  }

  currentOpenMode = "folder";
  currentFolderPath = payload.folderPath ?? null;
  setFolderPanelVisible(true);

  const preferredSelection =
    options.selectedFilePath ??
    (options.preserveSelection !== false && currentFilePath ? currentFilePath : null);

  const { hasFiles, hasSelection } = updateFolderFilesList(payload.files, preferredSelection);
  syncFolderWatcherWithLogging();

  if (hasSelection) {
    if (options.openPanel === true) {
      setFolderPanelOpen(true);
    }
    return;
  }

  if (!hasFiles) {
    renderFolderEmptyState();
    setFolderPanelOpen(true);
    return;
  }

  renderFolderSelectionPrompt();
  setFolderPanelOpen(true);
}

function updateAutoRefreshButton() {
  toggleAutoRefreshButton.textContent = `Auto-refresh: ${autoRefreshEnabled ? "On" : "Off"}`;
}

async function openFileFromBrowser(file) {
  if (!file) {
    return;
  }

  const contents = await file.text();
  enterSingleFileMode();
  renderMarkdown(contents);
  fileNameEl.textContent = file.name;
  currentFilePath = null;
  openVSCodeButton.disabled = true;

  syncAutoRefreshWatcher().catch((error) => {
    console.error("Failed to stop auto-refresh watcher:", error);
  });
}

function renderDesktopPayload(payload, options = {}) {
  if (!payload) {
    return;
  }

  const previousScrollRatio = options.preserveScroll ? getPreviewScrollRatio() : null;

  renderMarkdown(payload.content, { baseHref: payload.baseHref });

  if (previousScrollRatio !== null) {
    requestAnimationFrame(() => {
      restorePreviewScrollRatio(previousScrollRatio);
    });
  }

  fileNameEl.textContent = payload.fileName ?? "Unknown";
  currentFilePath = payload.filePath ?? null;
  openVSCodeButton.disabled = !currentFilePath;

  if (options.syncWatcher !== false) {
    syncAutoRefreshWatcher().catch((error) => {
      console.error("Failed to sync auto-refresh watcher:", error);
    });
  }
}

async function openDesktopFileDialog() {
  if (!desktopAPI) {
    return;
  }

  const result = await desktopAPI.openMarkdownDialog();
  if (result?.canceled || !result?.payload) {
    return;
  }

  enterSingleFileMode();
  renderDesktopPayload(result.payload);
}

async function openDesktopFolderDialog() {
  if (!desktopAPI || typeof desktopAPI.openMarkdownFolderDialog !== "function") {
    return;
  }

  const result = await desktopAPI.openMarkdownFolderDialog();
  if (result?.canceled || !result?.payload) {
    return;
  }

  applyFolderPayload(result.payload, { preserveSelection: false, openPanel: true });
}

async function openDesktopFileByPath(filePath, options = {}) {
  if (!desktopAPI || !filePath) {
    return;
  }

  if (options.mode !== "folder") {
    enterSingleFileMode();
  }

  const payload = await desktopAPI.readMarkdownFile(filePath);
  renderDesktopPayload(payload);

  if (options.mode === "folder") {
    updateFolderFilesList(folderFiles, payload.filePath ?? null);
  }
}

async function openDesktopFolderByPath(folderPath) {
  if (!desktopAPI || !folderPath || typeof desktopAPI.readMarkdownFolder !== "function") {
    return;
  }

  const payload = await desktopAPI.readMarkdownFolder(folderPath);
  applyFolderPayload(payload, { preserveSelection: false, openPanel: true });
}

function normalizeOpenTarget(target) {
  if (!target) {
    return null;
  }

  if (typeof target === "string") {
    return { targetType: "file", path: target };
  }

  if (typeof target !== "object") {
    return null;
  }

  const targetType = target.targetType;
  const targetPath = target.path;
  if ((targetType === "file" || targetType === "folder") && typeof targetPath === "string") {
    return { targetType, path: targetPath };
  }

  return null;
}

async function openDesktopTarget(target) {
  const normalized = normalizeOpenTarget(target);
  if (!normalized || !normalized.path) {
    return;
  }

  if (normalized.targetType === "folder") {
    await openDesktopFolderByPath(normalized.path);
    return;
  }

  await openDesktopFileByPath(normalized.path, { mode: "single-file" });
}

async function bindExternalOpenEvents() {
  if (!desktopAPI) {
    return;
  }

  if (typeof desktopAPI.consumePendingExternalOpenTarget === "function") {
    const pendingTarget = await desktopAPI.consumePendingExternalOpenTarget();
    if (pendingTarget) {
      await openDesktopTarget(pendingTarget);
    }
  }

  if (typeof desktopAPI.onExternalFileOpen === "function") {
    desktopAPI.onExternalFileOpen((target) => {
      openDesktopTarget(target).catch((error) => {
        console.error("Failed to open externally provided target:", error);
      });
    });
  }

  if (typeof desktopAPI.onFileChanged === "function") {
    desktopAPI.onFileChanged((payload) => {
      if (!payload || !payload.filePath || payload.filePath !== currentFilePath) {
        return;
      }
      renderDesktopPayload(payload, { preserveScroll: true, syncWatcher: false });
    });
  }

  if (typeof desktopAPI.onFolderChanged === "function") {
    desktopAPI.onFolderChanged((payload) => {
      if (!payload || !payload.folderPath || currentOpenMode !== "folder" || payload.folderPath !== currentFolderPath) {
        return;
      }

      applyFolderPayload(payload, { preserveSelection: true });
    });
  }
}

function getScrollContainer() {
  if (previewEl.scrollHeight > previewEl.clientHeight + 1) {
    return previewEl;
  }
  return document.scrollingElement || document.documentElement;
}

function getViewportTop(scrollContainer) {
  if (scrollContainer === previewEl) {
    return previewEl.getBoundingClientRect().top + 1;
  }
  return 1;
}

function getCurrentSourceLine() {
  const sourceNodes = previewEl.querySelectorAll("[data-source-line]");
  if (sourceNodes.length === 0) {
    return 1;
  }

  const scrollContainer = getScrollContainer();
  const viewportTop = getViewportTop(scrollContainer);

  let containingCandidate = null;
  let firstBelowCandidate = null;

  for (const node of sourceNodes) {
    const rect = node.getBoundingClientRect();
    if (rect.bottom <= viewportTop) {
      continue;
    }

    if (rect.top <= viewportTop) {
      if (!containingCandidate || rect.top > containingCandidate.rect.top) {
        containingCandidate = { node, rect };
      }
      continue;
    }

    if (!firstBelowCandidate || rect.top < firstBelowCandidate.rect.top) {
      firstBelowCandidate = { node, rect };
    }
  }

  const candidate = containingCandidate || firstBelowCandidate;
  if (!candidate) {
    return 1;
  }

  const startLine = Number.parseInt(candidate.node.getAttribute("data-source-line") ?? "1", 10);
  const endLineRaw = Number.parseInt(candidate.node.getAttribute("data-source-line-end") ?? `${startLine}`, 10);
  const endLine = Number.isFinite(endLineRaw) ? Math.max(startLine, endLineRaw) : startLine;

  if (!containingCandidate || endLine <= startLine || candidate.rect.height <= 0) {
    return startLine;
  }

  const progress = Math.max(0, Math.min(1, (viewportTop - candidate.rect.top) / candidate.rect.height));
  const mappedLine = startLine + Math.round(progress * (endLine - startLine));
  return Math.max(startLine, Math.min(endLine, mappedLine));
}

async function openInVSCodeAtCurrentPosition() {
  if (!desktopAPI || !currentFilePath || typeof desktopAPI.openInVSCodeAtLine !== "function") {
    return;
  }

  const line = getCurrentSourceLine();
  await desktopAPI.openInVSCodeAtLine(currentFilePath, line);
}

openFileButton.addEventListener("click", () => {
  closeOpenFileOptionsMenu();

  if (desktopAPI) {
    openDesktopFileDialog().catch((error) => {
      console.error("Failed to open markdown file:", error);
    });
    return;
  }

  fileInput.click();
});

openFileOptionsButton.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleOpenFileOptionsMenu();
});

openFolderButton.addEventListener("click", () => {
  closeOpenFileOptionsMenu();
  if (!desktopAPI) {
    return;
  }

  openDesktopFolderDialog().catch((error) => {
    console.error("Failed to open markdown folder:", error);
  });
});

toggleTOCButton.addEventListener("click", () => {
  const isOpen = appShellEl.classList.contains("toc-open");
  setTOCOpen(!isOpen);
});

toggleFolderPanelButton.addEventListener("click", () => {
  const isOpen = appShellEl.classList.contains("folder-files-open");
  setFolderPanelOpen(!isOpen);
});

folderFilesListEl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-file-path]");
  if (!button) {
    return;
  }

  const selectedFilePath = button.dataset.filePath;
  if (!selectedFilePath) {
    return;
  }

  openDesktopFileByPath(selectedFilePath, { mode: "folder" }).catch((error) => {
    console.error("Failed to open markdown file from folder:", error);
  });
});

document.addEventListener("click", (event) => {
  if (!openFileControlsEl.classList.contains("open")) {
    return;
  }

  if (
    openFileOptionsMenu.contains(event.target) ||
    openFileOptionsButton.contains(event.target)
  ) {
    return;
  }

  closeOpenFileOptionsMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeOpenFileOptionsMenu();
  }
});

tocListEl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-target-id]");
  if (!button) {
    return;
  }

  const heading = previewEl.querySelector(`#${CSS.escape(button.dataset.targetId)}`);
  if (!heading) {
    return;
  }

  heading.scrollIntoView({ behavior: "smooth", block: "start" });
});

openVSCodeButton.addEventListener("click", () => {
  openInVSCodeAtCurrentPosition().catch((error) => {
    console.error("Unable to open VS Code:", error);
  });
});

toggleAutoRefreshButton.addEventListener("click", () => {
  autoRefreshEnabled = !autoRefreshEnabled;
  updateAutoRefreshButton();
  syncAutoRefreshWatcher().catch((error) => {
    console.error("Failed to toggle auto-refresh watcher:", error);
  });
});

toggleThemeButton.addEventListener("click", () => {
  const isDarkTheme = document.body.classList.contains("vscode-dark");
  setTheme(isDarkTheme ? "vscode-light" : "vscode-dark");
});

fileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  await openFileFromBrowser(file);
  fileInput.value = "";
});

renderMarkdown(defaultMarkdown);
setTOCOpen(false);
setTheme("vscode-dark");
setFolderPanelVisible(false);
updateFolderFilesList([], null);
openVSCodeButton.disabled = true;
updateAutoRefreshButton();
closeOpenFileOptionsMenu();

if (!desktopAPI) {
  toggleAutoRefreshButton.disabled = true;
  openFolderButton.disabled = true;
  openFolderButton.title = "Open Folder is available in the desktop app";
  toggleFolderPanelButton.hidden = true;
}

async function initializeDesktopStartupOptions() {
  if (!desktopAPI || typeof desktopAPI.getStartupOptions !== "function") {
    return null;
  }

  try {
    return await desktopAPI.getStartupOptions();
  } catch (error) {
    console.error("Failed to load startup options:", error);
    return null;
  }
}

async function initializeApp() {
  let startupOptions = null;

  if (desktopAPI) {
    startupOptions = await initializeDesktopStartupOptions();
  }

  applyStartupOptions(startupOptions, { syncWatcher: false });

  if (!isThemeClass(startupOptions?.theme)) {
    await applyThemeFromSystemPreference();
  }

  if (desktopAPI) {
    if (typeof desktopAPI.onStartupOptions === "function") {
      desktopAPI.onStartupOptions((options) => {
        applyStartupOptions(options);
      });
    }

    if (typeof desktopAPI.onOpenOnLaunch === "function") {
      desktopAPI.onOpenOnLaunch((target) => {
        openDesktopTarget(target).catch((error) => {
          console.error("Failed to open launch target:", error);
        });
      });
    }
  }

  await bindExternalOpenEvents();
}

initializeApp().catch((error) => {
  console.error("Unable to initialize app:", error);
});
