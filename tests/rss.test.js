import { test, expect } from "bun:test";
import { buildRssFeed } from "../src/rss.js";

const basePost = {
  slug: "hello-world",
  title: "Hello, World & <Friends>",
  body_markdown: "Some **content** here.",
  created_at: "2026-08-29 12:00:00",
};

test("produces well-formed channel metadata", () => {
  const xml = buildRssFeed({
    siteTitle: "My Blog",
    siteUrl: "https://example.com",
    siteDescription: "A test blog",
    posts: [],
  });
  expect(xml).toContain("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
  expect(xml).toContain("<title>My Blog</title>");
  expect(xml).toContain("<link>https://example.com</link>");
});

test("escapes special characters in titles (XML injection safety)", () => {
  const xml = buildRssFeed({
    siteTitle: "Blog", siteUrl: "https://example.com", siteDescription: "d",
    posts: [basePost],
  });
  expect(xml).toContain("Hello, World &amp; &lt;Friends&gt;");
  expect(xml).not.toContain("<Friends>");
});

test("wraps rendered post HTML in a CDATA section so markdown HTML isn't double-escaped", () => {
  const xml = buildRssFeed({
    siteTitle: "Blog", siteUrl: "https://example.com", siteDescription: "d",
    posts: [basePost],
  });
  expect(xml).toContain("<content:encoded><![CDATA[");
  expect(xml).toContain("<strong>content</strong>");
});

test("builds a valid permalink from siteUrl and slug", () => {
  const xml = buildRssFeed({
    siteTitle: "Blog", siteUrl: "https://example.com", siteDescription: "d",
    posts: [basePost],
  });
  expect(xml).toContain("https://example.com/post/hello-world");
});

test("handles zero posts without producing malformed XML", () => {
  const xml = buildRssFeed({
    siteTitle: "Blog", siteUrl: "https://example.com", siteDescription: "d",
    posts: [],
  });
  expect(xml).toContain("<channel>");
  expect(xml).toContain("</channel>");
  expect(xml).toContain("</rss>");
});
