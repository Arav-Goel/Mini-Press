// Uses bun:test — Bun's built-in test runner (equivalent role to
// node:test). Run with `bun test`. No jest/mocha/vitest installed.
import { test, expect, describe } from "bun:test";
import { renderMarkdown, escapeHtml, excerpt } from "../src/markdown.js";

describe("escapeHtml", () => {
  test("escapes all five special characters", () => {
    expect(escapeHtml(`<script>alert('x')</script> & "quotes"`)).toBe(
      "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;quotes&quot;"
    );
  });
});

describe("renderMarkdown — headers", () => {
  test("renders h1 through h6", () => {
    for (let level = 1; level <= 6; level++) {
      const hashes = "#".repeat(level);
      expect(renderMarkdown(`${hashes} Title`)).toBe(`<h${level}>Title</h${level}>`);
    }
  });
});

describe("renderMarkdown — inline", () => {
  test("bold and italic", () => {
    expect(renderMarkdown("**bold** and *italic*")).toContain("<strong>bold</strong>");
    expect(renderMarkdown("**bold** and *italic*")).toContain("<em>italic</em>");
  });

  test("inline code is not further processed for markdown syntax", () => {
    const out = renderMarkdown("`**not bold**`");
    expect(out).toBe("<p><code>**not bold**</code></p>");
  });

  test("bold/italic outside code spans still work when code spans are present", () => {
    const out = renderMarkdown("mix of `code` and **bold** and *italic* together");
    expect(out).toBe(
      "<p>mix of <code>code</code> and <strong>bold</strong> and <em>italic</em> together</p>"
    );
  });

  test("links only allow http(s) or root-relative URLs", () => {
    expect(renderMarkdown("[safe](https://example.com)")).toContain('href="https://example.com"');
    expect(renderMarkdown("[safe](/local)")).toContain('href="/local"');
    expect(renderMarkdown("[bad](javascript:alert(1))")).toBe(
      `<p><a href="#" rel="noopener noreferrer">bad</a></p>`
    );
  });

  test("URLs with one level of nested parens are matched in full, not truncated", () => {
    const out = renderMarkdown("[wiki](https://en.wikipedia.org/wiki/Foo_(bar))");
    expect(out).toContain('href="https://en.wikipedia.org/wiki/Foo_(bar)"');
  });

  test("images render with alt text", () => {
    expect(renderMarkdown("![a cat](/cat.png)")).toBe(
      `<p><img src="/cat.png" alt="a cat" loading="lazy"></p>`
    );
  });
});

describe("renderMarkdown — XSS safety (the whole point of this file)", () => {
  test("raw HTML in source is escaped, never executed", () => {
    const out = renderMarkdown("<img src=x onerror=alert(1)>");
    expect(out).not.toContain("<img src=x onerror");
    expect(out).toContain("&lt;img");
  });

  test("script tags inside a paragraph are escaped", () => {
    const out = renderMarkdown("hello <script>alert(1)</script> world");
    expect(out).not.toContain("<script>");
  });

  test("comment author/body fields go through the same escape path", () => {
    // render.js escapes comment fields directly with escapeHtml — this
    // test locks the underlying primitive so a future refactor can't
    // accidentally drop it.
    expect(escapeHtml("<b>hi</b>")).toBe("&lt;b&gt;hi&lt;/b&gt;");
  });
});

describe("renderMarkdown — blocks", () => {
  test("fenced code blocks preserve whitespace and escape content", () => {
    const out = renderMarkdown("```js\nconst x = 1;\n```");
    expect(out).toBe(`<pre><code data-lang="js">const x = 1;</code></pre>`);
  });

  test("blockquotes", () => {
    expect(renderMarkdown("> quoted text")).toBe("<blockquote><p>quoted text</p></blockquote>");
  });

  test("unordered and ordered lists", () => {
    expect(renderMarkdown("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
    expect(renderMarkdown("1. a\n2. b")).toBe("<ol><li>a</li><li>b</li></ol>");
  });

  test("blank lines separate paragraphs", () => {
    const out = renderMarkdown("first para\n\nsecond para");
    expect(out).toBe("<p>first para</p>\n<p>second para</p>");
  });

  test("malformed/unterminated fenced code block does not crash", () => {
    expect(() => renderMarkdown("```js\nconst x = 1;")).not.toThrow();
  });

  test("empty input renders nothing", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown(undefined)).toBe("");
  });
});

describe("excerpt", () => {
  test("strips markdown syntax to plain text", () => {
    expect(excerpt("# Title\n\n**bold** and [a link](url)")).toBe("Title bold and a link");
  });

  test("truncates long text with an ellipsis", () => {
    const long = "word ".repeat(100);
    const out = excerpt(long, 20);
    expect(out.length).toBeLessThanOrEqual(21);
    expect(out.endsWith("…")).toBe(true);
  });
});
