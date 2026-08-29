// markdown.js — replaces marked/markdown-it/remark with a hand-rolled
// subset renderer. This is deliberately NOT calling Bun.markdown even
// though Bun 1.4 reportedly ships one: I couldn't verify Bun.markdown's
// exact method signature from documentation while building this (no
// network access to bun.sh docs in the dev sandbox), and shipping a call
// to an unverified API is worse than shipping a slower one I know works.
// Swapping this module out for Bun.markdown later is a one-file change —
// see STDLIB.md.
//
// Supported: # .. ###### headers, **bold**, *italic*, `code`, fenced
// ``` code blocks, [text](url) links, ![alt](url) images, > blockquotes,
// - / * unordered lists, 1. ordered lists, paragraphs, blank-line breaks.
// Not supported: tables, nested lists, footnotes, HTML passthrough (by
// design — see escapeHtml below, this is also our XSS defense).

export function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// URL group allows one level of nested parens (`javascript:alert(1)`,
// `en.wikipedia.org/wiki/Foo_(bar)`) without swallowing or truncating —
// the naive `[^)\s]+` either eats a trailing `)` it shouldn't or stops at
// the first `)` inside the URL itself. Caught by actually running this
// against `[bad](javascript:alert(1))` during development.
const URL_GROUP = String.raw`((?:[^()\s]|\([^()]*\))+)`;

// Inline-level: bold, italic, code, links, images. Operates on
// already-escaped text so raw HTML in the source can never leak through.
//
// Code spans are extracted to placeholders FIRST and restored LAST, so
// that bold/italic markers *inside* inline code (e.g. `` `**not bold**` ``)
// are never reprocessed as formatting. Without this, the code-span HTML
// gets emitted before the bold/italic pass runs and the pass corrupts it
// — caught the same way, by actually running the renderer.
function renderInline(text) {
  let out = escapeHtml(text);

  const codeSpans = [];
  out = out.replace(/`([^`]+)`/g, (_, code) => {
    const token = `\u0000CODE${codeSpans.length}\u0000`;
    codeSpans.push(code);
    return token;
  });

  // Images before links (both use [ ]( ) but images have a leading !).
  out = out.replace(new RegExp(`!\\[([^\\]]*)\\]\\(${URL_GROUP}\\)`, "g"), (_, alt, url) => {
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy">`;
  });
  out = out.replace(new RegExp(`\\[([^\\]]+)\\]\\(${URL_GROUP}\\)`, "g"), (_, label, url) => {
    const safeUrl = /^https?:\/\//.test(url) || url.startsWith("/") ? url : "#";
    return `<a href="${escapeHtml(safeUrl)}" rel="noopener noreferrer">${label}</a>`;
  });

  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  out = out.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => `<code>${codeSpans[Number(i)]}</code>`);

  return out;
}

export function renderMarkdown(source) {
  const lines = (source || "").replaceAll("\r\n", "\n").split("\n");
  const html = [];
  let i = 0;
  let paragraphBuf = [];
  let listBuf = null; // { type: 'ul'|'ol', items: [] }

  function flushParagraph() {
    if (paragraphBuf.length) {
      html.push(`<p>${renderInline(paragraphBuf.join(" "))}</p>`);
      paragraphBuf = [];
    }
  }
  function flushList() {
    if (listBuf) {
      const tag = listBuf.type;
      const items = listBuf.items.map((it) => `<li>${renderInline(it)}</li>`).join("");
      html.push(`<${tag}>${items}</${tag}>`);
      listBuf = null;
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.trim().startsWith("```")) {
      flushParagraph();
      flushList();
      const lang = line.trim().slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : "";
      html.push(`<pre><code${langAttr}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    // Headers
    const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      flushParagraph();
      flushList();
      const level = headerMatch[1].length;
      html.push(`<h${level}>${renderInline(headerMatch[2])}</h${level}>`);
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith(">")) {
      flushParagraph();
      flushList();
      const quoteLines = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      html.push(`<blockquote><p>${renderInline(quoteLines.join(" "))}</p></blockquote>`);
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^[-*]\s+(.*)$/);
    if (ulMatch) {
      flushParagraph();
      if (!listBuf || listBuf.type !== "ul") { flushList(); listBuf = { type: "ul", items: [] }; }
      listBuf.items.push(ulMatch[1]);
      i++;
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^\d+\.\s+(.*)$/);
    if (olMatch) {
      flushParagraph();
      if (!listBuf || listBuf.type !== "ol") { flushList(); listBuf = { type: "ol", items: [] }; }
      listBuf.items.push(olMatch[1]);
      i++;
      continue;
    }

    // Blank line: paragraph/list break
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      i++;
      continue;
    }

    // Plain text line -> accumulate into current paragraph
    flushList();
    paragraphBuf.push(line.trim());
    i++;
  }

  flushParagraph();
  flushList();
  return html.join("\n");
}

// Very small excerpt helper for RSS/listing pages: strips markdown syntax
// down to plain text and truncates. Not meant to be a full parser.
export function excerpt(markdownSource, maxLen = 220) {
  const plain = (markdownSource || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[#>*`_[\]!]/g, "")
    .replace(/\(([^)]+)\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > maxLen ? plain.slice(0, maxLen).trimEnd() + "…" : plain;
}
