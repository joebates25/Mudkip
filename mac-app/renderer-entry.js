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
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import DOMPurify from "dompurify";

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
hljs.registerLanguage("swift", swift);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);

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
  .use(markdownItFootnote);

function decodeBase64Utf8(value) {
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function setBaseHref(baseHref) {
  let baseEl = document.getElementById("doc-base");
  if (!baseEl) {
    baseEl = document.createElement("base");
    baseEl.id = "doc-base";
    document.head.appendChild(baseEl);
  }
  baseEl.setAttribute("href", baseHref ?? "./");
}

function setTheme(theme) {
  document.body.classList.remove("vscode-dark", "vscode-light");
  document.body.classList.add(theme === "vscode-light" ? "vscode-light" : "vscode-dark");
}

window.renderMarkdown = function renderMarkdown(payload) {
  const source = decodeBase64Utf8(payload.markdownBase64 ?? "");
  setBaseHref(payload.baseHref);
  setTheme(payload.theme);
  document.title = payload.fileName || "Markdown Viewer";

  const rendered = markdown.render(source);
  const safeHtml = DOMPurify.sanitize(rendered);
  const preview = document.getElementById("preview");
  preview.innerHTML = safeHtml;
};
