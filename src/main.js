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
const openFileButton = document.getElementById("open-file-button");
const toggleTOCButton = document.getElementById("toggle-toc-button");
const openVSCodeButton = document.getElementById("open-vscode-button");
const toggleAutoRefreshButton = document.getElementById("toggle-autorefresh-button");
const fileInput = document.getElementById("file-input");
const fileNameEl = document.getElementById("file-name");
const themeSelect = document.getElementById("theme-select");
const tocDrawerEl = document.getElementById("toc-drawer");
const tocListEl = document.getElementById("toc-list");
const tocEmptyEl = document.getElementById("toc-empty");
let currentFilePath = null;
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

Use **Open Markdown File** to load a local file.
`;

function setTheme(themeClass) {
  document.body.classList.remove("vscode-dark", "vscode-light");
  document.body.classList.add(themeClass);
}

function isThemeClass(value) {
  return value === "vscode-dark" || value === "vscode-light";
}

function setTOCOpen(isOpen) {
  appShellEl.classList.toggle("toc-open", isOpen);
  toggleTOCButton.setAttribute("aria-expanded", String(isOpen));
  tocDrawerEl.setAttribute("aria-hidden", String(!isOpen));
}

async function applyThemeFromSystemPreference() {
  if (!desktopAPI || typeof desktopAPI.getSystemTheme !== "function") {
    themeSelect.value = "vscode-dark";
    setTheme("vscode-dark");
    return;
  }

  try {
    const systemTheme = await desktopAPI.getSystemTheme();
    if (isThemeClass(systemTheme)) {
      themeSelect.value = systemTheme;
      setTheme(systemTheme);
      return;
    }
  } catch {
    // Fall back to Dark+ below.
  }

  themeSelect.value = "vscode-dark";
  setTheme("vscode-dark");
}

function applyStartupOptions(options, config = {}) {
  if (!options || typeof options !== "object") {
    return;
  }

  const syncWatcher = config.syncWatcher !== false;

  if (isThemeClass(options.theme)) {
    themeSelect.value = options.theme;
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

function updateAutoRefreshButton() {
  toggleAutoRefreshButton.textContent = `Auto-refresh: ${autoRefreshEnabled ? "On" : "Off"}`;
}

async function openFileFromBrowser(file) {
  if (!file) {
    return;
  }

  const contents = await file.text();
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

  renderDesktopPayload(result.payload);
}

async function openDesktopFileByPath(filePath) {
  if (!desktopAPI || !filePath) {
    return;
  }

  const payload = await desktopAPI.readMarkdownFile(filePath);
  renderDesktopPayload(payload);
}

async function bindExternalOpenEvents() {
  if (!desktopAPI) {
    return;
  }

  if (typeof desktopAPI.consumePendingExternalOpenPath === "function") {
    const pendingPath = await desktopAPI.consumePendingExternalOpenPath();
    if (pendingPath) {
      await openDesktopFileByPath(pendingPath);
    }
  }

  if (typeof desktopAPI.onExternalFileOpen === "function") {
    desktopAPI.onExternalFileOpen((filePath) => {
      openDesktopFileByPath(filePath).catch((error) => {
        console.error("Failed to open externally provided file:", error);
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
  if (desktopAPI) {
    openDesktopFileDialog().catch((error) => {
      console.error("Failed to open markdown file:", error);
    });
    return;
  }

  fileInput.click();
});

toggleTOCButton.addEventListener("click", () => {
  const isOpen = appShellEl.classList.contains("toc-open");
  setTOCOpen(!isOpen);
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

fileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  await openFileFromBrowser(file);
  fileInput.value = "";
});

themeSelect.addEventListener("change", (event) => {
  setTheme(event.target.value);
});

renderMarkdown(defaultMarkdown);
setTOCOpen(false);
openVSCodeButton.disabled = true;
updateAutoRefreshButton();

if (!desktopAPI) {
  toggleAutoRefreshButton.disabled = true;
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
      desktopAPI.onOpenOnLaunch((filePath) => {
        openDesktopFileByPath(filePath).catch((error) => {
          console.error("Failed to open launch file:", error);
        });
      });
    }
  }

  await bindExternalOpenEvents();
}

initializeApp().catch((error) => {
  console.error("Unable to initialize app:", error);
});
