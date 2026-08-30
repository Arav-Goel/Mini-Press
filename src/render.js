// render.js — replaces ejs/handlebars/pug with plain template literals.
// escapeHtml is applied everywhere user data is interpolated; the only
// unescaped interpolations are values we generated ourselves (rendered
// markdown HTML, which markdown.js already escaped at the source).

import { escapeHtml, renderMarkdown, excerpt } from "./markdown.js";
import { imageVariantPaths } from "./images.js";

function layout({ title, body, head = "", user = null, csrfToken = null, activeTab = "", query = "" }) {
  const accountLink = user
    ? `<a class="site-tab ${activeTab === "account" ? "is-active" : ""}" href="/account">@${escapeHtml(user.username)}</a>`
    : `<a class="site-tab ${activeTab === "login" ? "is-active" : ""}" href="/login">Log in</a>
       <a class="site-tab" href="/signup">Create account</a>`;
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
    <nav class="site-tabs" aria-label="Primary navigation">
      <a class="site-tab ${activeTab === "home" ? "is-active" : ""}" href="/">Home</a>
      <form class="site-search" method="get" action="/" role="search">
        <label class="sr-only" for="site-search-input">Search posts</label>
        <input id="site-search-input" name="q" value="${escapeHtml(query)}" placeholder="Search posts" maxlength="100">
        <button type="submit">Search</button>
      </form>
      ${accountLink}
    </nav>
  </header>
  <main>${body}</main>
  <footer class="site-footer">Built zero-dependency for the Zero Dependency Hackathon.</footer>
</body>
</html>`;
}

function readingTime(markdown) {
  const words = String(markdown || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

function pageLink(page, query, label, current = false) {
  const params = new URLSearchParams({ page: String(page) });
  if (query) params.set("q", query);
  return `<a class="page-link${current ? " is-current" : ""}" href="/?${params}">${label}</a>`;
}

export function renderHome({ posts, user = null, query = "", page = 1, totalPages = 1, total = 0 }) {
  const items = posts.map((post) => {
    const cover = imageVariantPaths(post.cover_image);
    const coverHtml = cover
      ? `<img class="post-thumb" src="${cover.thumb}" alt="">`
      : `<div class="post-thumb post-thumb-placeholder" aria-hidden="true">MP</div>`;
    return `
    <article class="post-card">
      <a class="post-thumb-link" href="/post/${encodeURIComponent(post.slug)}" aria-label="Read ${escapeHtml(post.title)}">${coverHtml}</a>
      <div class="post-card-copy">
        <h2><a href="/post/${encodeURIComponent(post.slug)}">${escapeHtml(post.title)}</a></h2>
        <p class="post-excerpt">${escapeHtml(excerpt(post.markdown))}</p>
        <p class="post-meta"><span>By @${escapeHtml(post.author_username || "unknown")}</span><span aria-hidden="true">·</span><time datetime="${post.created_at}">${escapeHtml(post.created_at)}</time><span aria-hidden="true">·</span>${readingTime(post.markdown)} min read</p>
      </div>
    </article>`;
  }).join("") || `<p class="empty">${query ? `No published posts match “${escapeHtml(query)}”.` : "No posts yet."}</p>`;

  const heading = query ? `Search results for “${escapeHtml(query)}”` : "Latest posts";
  const pagination = totalPages > 1 ? `
    <nav class="pagination" aria-label="Post pages">
      ${page > 1 ? pageLink(page - 1, query, "← Newer") : ""}
      ${Array.from({ length: totalPages }, (_, index) => pageLink(index + 1, query, String(index + 1), index + 1 === page)).join("")}
      ${page < totalPages ? pageLink(page + 1, query, "Older →") : ""}
    </nav>` : "";

  const resultCount = query ? `<p class="feed-summary">${total} ${total === 1 ? "post" : "posts"} found</p>` : "";
  return layout({ title: query ? `Search — mini-press` : "mini-press", body: `<section class="feed-heading"><h1>${heading}</h1>${resultCount}</section><div class="post-list">${items}</div>${pagination}`, user, activeTab: "home", query });
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
      <p class="post-byline">By <strong>@${escapeHtml(post.author_username || "unknown")}</strong> <span aria-hidden="true">·</span> <time datetime="${post.created_at}">${escapeHtml(post.created_at)}</time> <span aria-hidden="true">·</span> ${readingTime(post.markdown)} min read</p>
      <div class="post-body">${renderMarkdown(post.markdown)}</div>
    </article>
    <section class="comments">
      <h2>Comments</h2>
      <ul class="comment-list">${commentsHtml}</ul>
      ${commentForm}
    </section>`;

  return layout({ title: post.title, body, user, csrfToken, query: "" });
}

const ACCOUNT_HEAD = `<link rel="stylesheet" href="/account.css">`;

export function renderLogin({ error } = {}) {
  const errorHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  const body = `<section class="auth-shell"><div class="auth-card">
    <p class="eyebrow">Welcome back</p><h1>Log in</h1><p class="auth-intro">Pick up where you left off.</p>
    ${errorHtml}
    <form method="post" action="/login" class="login-form">
      <label>Username<input name="username" required autofocus></label>
      <label>Password<input type="password" name="password" required></label>
      <button type="submit">Log in</button>
    </form>
    <p class="auth-switch">New here? <a href="/signup">Create an account</a>.</p>
  </div></section>`;
  return layout({ title: "Log in — mini-press", body, head: ACCOUNT_HEAD, activeTab: "login" });
}

export function renderSignup({ error } = {}) {
  const errorHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  const body = `<section class="auth-shell"><div class="auth-card">
    <p class="eyebrow">Join the conversation</p><h1>Create account</h1><p class="auth-intro">Share posts and comment under your own name.</p>
    ${errorHtml}
    <form method="post" action="/signup" class="login-form">
      <label>Username<input name="username" required minlength="3" maxlength="40" pattern="[A-Za-z0-9_-]+" autofocus></label>
      <label>Password<input type="password" name="password" required minlength="8"></label>
      <button type="submit">Create account</button>
    </form>
    <p class="auth-switch">Already have an account? <a href="/login">Log in</a>.</p>
  </div></section>`;
  return layout({ title: "Create account — mini-press", body, head: ACCOUNT_HEAD });
}

export function renderDashboard(posts, user, csrfToken) {
  const rows = posts.map((post) => `
    <tr>
      <td><a href="/account/posts/${post.id}/edit">${escapeHtml(post.title)}</a></td>
      <td>${post.published ? "Published" : "Draft"}</td>
      <td>${escapeHtml(post.updated_at)}</td>
      <td class="post-actions"><a href="/account/posts/${post.id}/edit">Edit</a><form method="post" action="/account/posts/${post.id}/delete"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button class="text-danger" onclick="return confirm('Delete this post?')">Delete</button></form></td>
    </tr>`).join("");

  const body = `
    <section class="account-hero">
      <div><p class="eyebrow">Your space</p><h1>@${escapeHtml(user.username)}</h1><p>Manage your drafts and published writing in one place.</p></div>
      <div class="account-hero-actions"><a class="button" href="/account/new">Write a post</a>${user.is_admin ? `<a class="button secondary-button" href="/account/admin">Manage users</a>` : ""}</div>
    </section>
    <section class="account-panel">
      <div class="account-panel-heading"><h2>Your posts</h2><span>${posts.length} ${posts.length === 1 ? "post" : "posts"}</span></div>
    <table class="post-table">
      <thead><tr><th>Title</th><th>Status</th><th>Updated</th><th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="4">No posts yet.</td></tr>`}</tbody>
    </table></section>`;
  const accountBody = `${body}<form method="post" action="/logout" class="account-logout"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button>Log out</button></form>`;
  return layout({ title: "My posts — mini-press", body: accountBody, head: ACCOUNT_HEAD, user, csrfToken, activeTab: "account" });
}

export function renderAdminUsers(users, user, csrfToken) {
  const rows = users.map((account) => `
    <tr>
      <td><strong>@${escapeHtml(account.username)}</strong>${account.is_admin ? `<span class="role-label">Administrator</span>` : ""}</td>
      <td>${account.post_count}</td>
      <td>${account.comment_count}</td>
      <td>${escapeHtml(account.created_at)}</td>
      <td>${account.id === user.id || account.is_admin ? "" : `<form method="post" action="/account/admin/users/${account.id}/delete"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button class="text-danger" onclick="return confirm('Delete @${escapeHtml(account.username)} and all of their posts and comments?')">Delete user</button></form>`}</td>
    </tr>`).join("");
  const body = `<section class="account-hero admin-hero"><div><p class="eyebrow">Administrator</p><h1>People on mini-press</h1><p>Deleting an account permanently removes its authored posts and comments.</p></div><a class="button secondary-button" href="/account">Back to account</a></section>
    <section class="account-panel"><div class="account-panel-heading"><h2>Accounts</h2><span>${users.length} total</span></div>
      <table class="post-table admin-table"><thead><tr><th>Account</th><th>Posts</th><th>Comments</th><th>Joined</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows}</tbody></table>
    </section>`;
  return layout({ title: "Manage users — mini-press", body, head: ACCOUNT_HEAD, user, csrfToken, activeTab: "account" });
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
