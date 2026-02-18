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
const fileInput = document.getElementById("file-input");
const fileNameEl = document.getElementById("file-name");
const themeSelect = document.getElementById("theme-select");

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

const defaultMarkdown = `# Markdown Viewer POC

This prototype is tuned to look like **VS Code Markdown Preview**.

## Features

- Read-only rendering
- File picker for local \`.md\` files
- VS Code style typography and spacing
- Syntax-highlighted fenced code blocks

### Code

\`\`\`ts
type User = {
  id: string;
  email: string;
};

const format = (user: User) => \`\${user.id}: \${user.email}\`;
console.log(format({ id: "42", email: "dev@example.com" }));
\`\`\`

> Open a markdown file to replace this content.
`;

function setTheme(themeClass) {
  document.body.classList.remove("vscode-dark", "vscode-light");
  document.body.classList.add(themeClass);
}

function renderMarkdown(source) {
  const rendered = markdown.render(source);
  previewEl.innerHTML = DOMPurify.sanitize(rendered);
}

async function openFile(file) {
  if (!file) {
    return;
  }

  const contents = await file.text();
  renderMarkdown(contents);
  fileNameEl.textContent = file.name;
}

openFileButton.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  await openFile(file);
  fileInput.value = "";
});

themeSelect.addEventListener("change", (event) => {
  setTheme(event.target.value);
});

setTheme("vscode-dark");
renderMarkdown(defaultMarkdown);
