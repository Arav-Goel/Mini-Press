// rss.js — no RSS package exists in any stdlib for any language (checked
// the whole cheat sheet). This is XML string templating plus correct
// entity escaping. RFC 822 dates via Date.prototype.toUTCString, which
// happens to already be RFC 822/1123 format — no date library needed.

import { renderMarkdown, excerpt } from "./markdown.js";

function xmlEscape(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildRssFeed({ siteTitle, siteUrl, siteDescription, posts }) {
  const items = posts
    .map((post) => {
      const link = `${siteUrl}/post/${post.slug}`;
      const pubDate = new Date(post.created_at + "Z").toUTCString();
      const html = renderMarkdown(post.markdown);
      return `
    <item>
      <title>${xmlEscape(post.title)}</title>
      <link>${xmlEscape(link)}</link>
      <guid isPermaLink="true">${xmlEscape(link)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${xmlEscape(excerpt(post.markdown))}</description>
      <content:encoded><![CDATA[${html}]]></content:encoded>
    </item>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${xmlEscape(siteTitle)}</title>
    <link>${xmlEscape(siteUrl)}</link>
    <description>${xmlEscape(siteDescription)}</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>${items}
  </channel>
</rss>`;
}
