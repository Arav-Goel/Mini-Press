// render.js — replaces ejs/handlebars/pug with plain template literals.
// escapeHtml is applied everywhere user data is interpolated; the only
// unescaped interpolations are values we generated ourselves (rendered
// markdown HTML, which markdown.js already escaped at the source).

import { escapeHtml, renderMarkdown, excerpt } from "./markdown.js";
import { imageVariantPaths } from "./images.js";

function layout({ title, body, head = "", user = null, csrfToken = null }) {
  const accountLink = user
    ? `<a class="feed-link" href="/account">@${escapeHtml(user.username)}</a>
       <form method="post" action="/logout" class="header-form"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button>Log out</button></form>`
    : `<a class="feed-link" href="/login">Log in</a><a class="feed-link" href="/signup">Create account</a>`;
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
    ${accountLink}
  </header>
  <main>${body}</main>
  <footer class="site-footer">Built zero-dependency for the Zero Dependency Hackathon.</footer>
</body>
</html>`;
}

export function renderHome(posts, user = null) {
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

  return layout({ title: "mini-press", body: `<h1>Latest posts</h1><div class="post-list">${items}</div>`, user });
}

export function renderPost(post, comments, user = null, csrfToken = null) {
  const cover = imageVariantPaths(post.cover_image);
  const coverHtml = cover ? `<img class="post-cover" src="${cover.large}" alt="">` : "";
  const commentsHtml = comments.map((c) => `
    <li class="comment">
      <strong>${escapeHtml(c.username)}</strong>
      <time>${escapeHtml(c.created_at)}</time>
      <p>${escapeHtml(c.body)}</p>
    </li>`).join("") || `<li class="empty">No comments yet. Be the first.</li>`;

  const commentForm = user
    ? `<form method="post" action="/post/${encodeURIComponent(post.slug)}/comments" class="comment-form">
        <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
        <p>Commenting as <strong>${escapeHtml(user.username)}</strong></p>
        <label>Comment<br><textarea name="body" required maxlength="2000" rows="4"></textarea></label>
        <button type="submit">Post comment</button>
      </form>`
    : `<p class="empty"><a href="/login">Log in</a> or <a href="/signup">create an account</a> to comment.</p>`;

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
      ${commentForm}
    </section>`;

  return layout({ title: post.title, body, user, csrfToken });
}

const ACCOUNT_HEAD = `<link rel="stylesheet" href="/account.css">`;

export function renderLogin({ error } = {}) {
  const errorHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  const body = `
    <h1>Log in</h1>
    ${errorHtml}
    <form method="post" action="/login" class="login-form">
      <label>Username<br><input name="username" required autofocus></label>
      <label>Password<br><input type="password" name="password" required></label>
      <button type="submit">Log in</button>
    </form>
    <p>New here? <a href="/signup">Create an account</a>.</p>`;
  return layout({ title: "Log in — mini-press", body, head: ACCOUNT_HEAD });
}

export function renderSignup({ error } = {}) {
  const errorHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  const body = `
    <h1>Create account</h1>
    ${errorHtml}
    <form method="post" action="/signup" class="login-form">
      <label>Username<br><input name="username" required minlength="3" maxlength="40" pattern="[A-Za-z0-9_-]+" autofocus></label>
      <label>Password<br><input type="password" name="password" required minlength="8"></label>
      <button type="submit">Create account</button>
    </form>
    <p>Already have an account? <a href="/login">Log in</a>.</p>`;
  return layout({ title: "Create account — mini-press", body, head: ACCOUNT_HEAD });
}

export function renderDashboard(posts, user, csrfToken) {
  const rows = posts.map((post) => `
    <tr>
      <td><a href="/account/posts/${post.id}/edit">${escapeHtml(post.title)}</a></td>
      <td>${post.published ? "Published" : "Draft"}</td>
      <td>${escapeHtml(post.updated_at)}</td>
    </tr>`).join("");

  const body = `
    <div class="account-bar">
      <h1>${escapeHtml(user.username)}’s posts</h1>
      <a class="button" href="/account/new">New post</a>
    </div>
    <table class="post-table">
      <thead><tr><th>Title</th><th>Status</th><th>Updated</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3">No posts yet.</td></tr>`}</tbody>
    </table>`;
  return layout({ title: "My posts — mini-press", body, head: ACCOUNT_HEAD, user, csrfToken });
}

// The editor page ships a WebSocket-driven live preview: as you type, the
// markdown is sent to /account/preview-ws and the server renders it with the
// exact same renderMarkdown() the public site uses, so the preview is never
// out of sync with what actually gets published.
export function renderEditor(post, csrfToken, user) {
  const isNew = !post.id;
  const action = isNew ? "/account/posts" : `/account/posts/${post.id}`;
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
  return layout({ title: isNew ? "New post" : `Edit — ${post.title}`, body, head: ACCOUNT_HEAD, user, csrfToken });
}
