import { invoke } from "@tauri-apps/api/core";
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
const openFileButton = document.getElementById("open-file-button");
const openVSCodeButton = document.getElementById("open-vscode-button");
const fileNameEl = document.getElementById("file-name");
const themeSelect = document.getElementById("theme-select");
let currentFilePath = null;

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

const defaultMarkdown = `# Markdown Viewer (Tauri)

Read-only preview styled as close to VS Code Markdown Preview as possible.

- Native file open dialog (Rust side)
- Markdown rendering in the app window
- VS Code-like markdown CSS + code highlighting

Use **Open Markdown File** to load a local file.
`;

function setTheme(themeClass) {
  document.body.classList.remove("vscode-dark", "vscode-light");
  document.body.classList.add(themeClass);
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
}

function renderPayload(payload) {
  if (!payload) {
    return;
  }
  renderMarkdown(payload.content, { baseHref: payload.baseHref });
  fileNameEl.textContent = payload.fileName ?? "Unknown";
  currentFilePath = payload.filePath ?? null;
  openVSCodeButton.disabled = !currentFilePath;
}

async function openFileFromNativeDialog() {
  try {
    const payload = await invoke("pick_markdown_file");
    renderPayload(payload);
  } catch (error) {
    console.error("Unable to open file:", error);
  }
}

async function openLaunchFileIfPresent() {
  try {
    const launchPath = await invoke("get_launch_markdown_path");
    if (!launchPath) {
      return;
    }
    const payload = await invoke("read_markdown_file", { path: launchPath });
    renderPayload(payload);
  } catch (error) {
    console.error("Unable to read launch file:", error);
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
  if (!currentFilePath) {
    return;
  }

  const line = getCurrentSourceLine();
  await invoke("open_in_vscode", { path: currentFilePath, line });
}

openFileButton.addEventListener("click", () => {
  openFileFromNativeDialog();
});

openVSCodeButton.addEventListener("click", () => {
  openInVSCodeAtCurrentPosition().catch((error) => {
    console.error("Unable to open VS Code:", error);
  });
});

themeSelect.addEventListener("change", (event) => {
  setTheme(event.target.value);
});

const preferredTheme = window.matchMedia("(prefers-color-scheme: light)").matches
  ? "vscode-light"
  : "vscode-dark";
themeSelect.value = preferredTheme;
setTheme(preferredTheme);
renderMarkdown(defaultMarkdown);
openVSCodeButton.disabled = true;
openLaunchFileIfPresent();
