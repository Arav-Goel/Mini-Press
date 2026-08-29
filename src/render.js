// render.js — replaces ejs/handlebars/pug with plain template literals.
// escapeHtml is applied everywhere user data is interpolated; the only
// unescaped interpolations are values we generated ourselves (rendered
// markdown HTML, which markdown.js already escaped at the source).

import { escapeHtml, renderMarkdown, excerpt } from "./markdown.js";
import { imageVariantPaths } from "./images.js";

function layout({ title, body, head = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/site.css">
  <link rel="alternate" type="application/rss+xml" title="RSS Feed" href="/feed.xml">
  ${head}
</head>
<body>
  <header class="site-header">
    <a class="brand" href="/">mini-press</a>
    <a class="feed-link" href="/feed.xml">RSS</a>
  </header>
  <main>${body}</main>
  <footer class="site-footer">Built zero-dependency for the Zero Dependency Hackathon.</footer>
</body>
</html>`;
}

export function renderHome(posts) {
  const items = posts.map((post) => {
    const cover = imageVariantPaths(post.cover_image);
    const coverHtml = cover ? `<img class="post-thumb" src="${cover.thumb}" alt="">` : "";
    return `
    <article class="post-card">
      ${coverHtml}
      <h2><a href="/post/${encodeURIComponent(post.slug)}">${escapeHtml(post.title)}</a></h2>
      <p class="post-excerpt">${escapeHtml(excerpt(post.markdown))}</p>
      <time datetime="${post.created_at}">${escapeHtml(post.created_at)}</time>
    </article>`;
  }).join("") || `<p class="empty">No posts yet.</p>`;

  return layout({ title: "mini-press", body: `<h1>Latest posts</h1><div class="post-list">${items}</div>` });
}

export function renderPost(post, comments) {
  const cover = imageVariantPaths(post.cover_image);
  const coverHtml = cover ? `<img class="post-cover" src="${cover.large}" alt="">` : "";
  const commentsHtml = comments.map((c) => `
    <li class="comment">
      <strong>${escapeHtml(c.author)}</strong>
      <time>${escapeHtml(c.created_at)}</time>
      <p>${escapeHtml(c.body)}</p>
    </li>`).join("") || `<li class="empty">No comments yet. Be the first.</li>`;

  const body = `
    <article class="post">
      ${coverHtml}
      <h1>${escapeHtml(post.title)}</h1>
      <time datetime="${post.created_at}">${escapeHtml(post.created_at)}</time>
      <div class="post-body">${renderMarkdown(post.markdown)}</div>
    </article>
    <section class="comments">
      <h2>Comments</h2>
      <ul class="comment-list">${commentsHtml}</ul>
      <form method="post" action="/post/${encodeURIComponent(post.slug)}/comments" class="comment-form">
        <label>Name<br><input name="author" required maxlength="80"></label>
        <label>Comment<br><textarea name="body" required maxlength="2000" rows="4"></textarea></label>
        <button type="submit">Post comment</button>
      </form>
    </section>`;

  return layout({ title: post.title, body });
}

const ADMIN_HEAD = `<link rel="stylesheet" href="/admin.css">`;

export function renderLogin({ error } = {}) {
  const errorHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  const body = `
    <h1>Admin login</h1>
    ${errorHtml}
    <form method="post" action="/admin/login" class="login-form">
      <label>Username<br><input name="username" required autofocus></label>
      <label>Password<br><input type="password" name="password" required></label>
      <button type="submit">Log in</button>
    </form>`;
  return layout({ title: "Log in — mini-press", body, head: ADMIN_HEAD });
}

export function renderDashboard(posts) {
  const rows = posts.map((post) => `
    <tr>
      <td><a href="/admin/posts/${post.id}/edit">${escapeHtml(post.title)}</a></td>
      <td>${post.published ? "Published" : "Draft"}</td>
      <td>${escapeHtml(post.updated_at)}</td>
    </tr>`).join("");

  const body = `
    <div class="admin-bar">
      <h1>Dashboard</h1>
      <a class="button" href="/admin/new">New post</a>
      <form method="post" action="/admin/logout" style="display:inline"><button>Log out</button></form>
    </div>
    <table class="post-table">
      <thead><tr><th>Title</th><th>Status</th><th>Updated</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3">No posts yet.</td></tr>`}</tbody>
    </table>`;
  return layout({ title: "Dashboard — mini-press", body, head: ADMIN_HEAD });
}

// The editor page ships a WebSocket-driven live preview: as you type, the
// markdown is sent to /admin/preview-ws and the server renders it with the
// exact same renderMarkdown() the public site uses, so the preview is never
// out of sync with what actually gets published.
export function renderEditor(post, csrfToken) {
  const isNew = !post.id;
  const action = isNew ? "/admin/posts" : `/admin/posts/${post.id}`;
  const cover = imageVariantPaths(post.cover_image);
  const coverPreview = cover ? `<img src="${cover.medium}" class="cover-preview" alt="">` : "";

  const body = `
    <h1>${isNew ? "New post" : "Edit post"}</h1>
    <div class="editor-grid">
      <form method="post" action="${action}" enctype="multipart/form-data" class="editor-form">
        <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
        <label>Title<br><input name="title" id="title" value="${escapeHtml(post.title || "")}" required></label>
        <label>Cover image<br><input type="file" name="cover" accept="image/*"></label>
        ${coverPreview}
        <label>Markdown<br>
          <textarea name="markdown" id="markdown" rows="20">${escapeHtml(post.markdown || "")}</textarea>
        </label>
        <div class="editor-actions">
          <button type="submit">Save</button>
          ${!isNew ? `<button type="submit" formaction="${action}/publish" name="published" value="${post.published ? 0 : 1}">${post.published ? "Unpublish" : "Publish"}</button>` : ""}
          ${!isNew ? `<button type="submit" formaction="${action}/delete" class="danger" onclick="return confirm('Delete this post?')">Delete</button>` : ""}
        </div>
      </form>
      <div class="preview-pane">
        <h2>Live preview</h2>
        <div id="preview-output" class="post-body"></div>
      </div>
    </div>
    <script src="/editor.js"></script>`;
  return layout({ title: isNew ? "New post" : `Edit — ${post.title}`, body, head: ADMIN_HEAD });
}
