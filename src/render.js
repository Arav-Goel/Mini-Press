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
       <a class="site-tab" href="/signup">Sign up</a>`;
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
  <div class="site-loader" data-site-loader role="status" aria-live="polite" aria-label="Loading Mini-Press">
    <div class="site-loader-mark">
      <span class="site-loader-name">mini-press</span>
      <span class="site-loader-line" aria-hidden="true"></span>
      <span class="sr-only">Loading Mini-Press</span>
    </div>
  </div>
  <header class="site-header">
    <a class="brand" href="/">mini-press</a>
    <nav class="site-tabs" aria-label="Primary navigation">
      <a class="site-tab ${activeTab === "home" ? "is-active" : ""}" href="/">Home</a>
      <a class="site-tab ${activeTab === "following" ? "is-active" : ""}" href="/following">Following</a>
      <a class="site-tab ${activeTab === "boards" ? "is-active" : ""}" href="/boards">Boards</a>
      <a class="site-tab ${activeTab === "categories" ? "is-active" : ""}" href="/categories">Categories</a>
      <a class="site-tab ${activeTab === "events" ? "is-active" : ""}" href="/events">Events</a>
      <form class="site-search" method="get" action="/" role="search">
        <label class="sr-only" for="site-search-input">Search posts</label>
        <span class="search-icon" aria-hidden="true">⌕</span><input id="site-search-input" name="q" value="${escapeHtml(query)}" placeholder="Search posts" maxlength="100" autocomplete="off">
        <button type="submit">Search</button>
      </form>
      ${accountLink}
      <button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch to dark mode" title="Switch theme"><span aria-hidden="true">◐</span></button>
    </nav>
  </header>
  <main>${body}</main>
  <footer class="site-footer">Built zero-dependency for the Zero Dependency Hackathon by Arav Goel and Moksh Kardam.</footer>
  <script src="/theme.js"></script>
  <script src="/loader.js"></script>
  <script src="/social.js"></script>
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

function renderPostCards(posts) {
  return posts.map((post) => {
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
        <p class="post-meta"><a href="/@${encodeURIComponent(post.author_username || "unknown")}">By @${escapeHtml(post.author_username || "unknown")}</a><span aria-hidden="true">·</span><time datetime="${post.created_at}">${escapeHtml(post.created_at)}</time><span aria-hidden="true">·</span>${readingTime(post.markdown)} min read<span aria-hidden="true">·</span>♥ ${post.like_count || 0}</p>
        ${post.category_name ? `<p class="post-tags"><a href="/categories/${encodeURIComponent(post.category_slug)}">${escapeHtml(post.category_name)}</a>${post.board_name ? ` <a href="/boards/${encodeURIComponent(post.board_slug)}">b/${escapeHtml(post.board_name)}</a>` : ""}</p>` : ""}
        <a class="post-read-more" href="/post/${encodeURIComponent(post.slug)}">Read more <span aria-hidden="true">→</span></a>
      </div>
    </article>`;
  }).join("");
}

export function renderHome({ posts, user = null, query = "", page = 1, totalPages = 1, total = 0 }) {
  const items = renderPostCards(posts) || `<p class="empty">${query ? `No published posts match “${escapeHtml(query)}”.` : "No posts yet."}</p>`;

  const heading = query ? `Search results for “${escapeHtml(query)}”` : "Latest posts";
  const pagination = totalPages > 1 ? `
    <nav class="pagination" aria-label="Post pages">
      ${page > 1 ? pageLink(page - 1, query, "← Newer") : ""}
      ${Array.from({ length: totalPages }, (_, index) => pageLink(index + 1, query, String(index + 1), index + 1 === page)).join("")}
      ${page < totalPages ? pageLink(page + 1, query, "Older →") : ""}
    </nav>` : "";

  const resultCount = query ? `<p class="feed-summary">${total} ${total === 1 ? "post" : "posts"} found</p>` : "";
  const oceanCta = user ? `<a class="button" href="/account/new">Write a story</a>` : `<a class="button" href="/signup">Join the conversation</a>`;
  const oceanHero = query ? "" : `<section class="ocean-hero"><p class="eyebrow">Mini-press presents</p><h1>Ocean stories</h1><p>Dive deeper. Think bigger. Explore our blue planet and the life that depends on it.</p>${oceanCta}</section>`;
  const homeListClass = query ? "post-list" : "post-list post-list--feature-grid";
  return layout({ title: query ? `Search — mini-press` : "mini-press", body: `${oceanHero}<section class="feed-heading"><h1>${heading}</h1>${resultCount}</section><div class="${homeListClass}">${items}</div>${pagination}`, user, activeTab: "home", query });
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
      <p class="post-byline">By <strong><a href="/@${encodeURIComponent(post.author_username || "unknown")}">@${escapeHtml(post.author_username || "unknown")}</a></strong> <span aria-hidden="true">·</span> <time datetime="${post.created_at}">${escapeHtml(post.created_at)}</time> <span aria-hidden="true">·</span> ${readingTime(post.markdown)} min read</p>
      <div class="post-body">${renderMarkdown(post.markdown)}</div>
      <div class="post-social-actions">
        ${user ? `<form method="post" action="/post/${encodeURIComponent(post.slug)}/like"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button class="social-action ${post.viewer_liked ? "is-active" : ""}">${post.viewer_liked ? "♥ Liked" : "♡ Like"} <span>${post.like_count || 0}</span></button></form>` : `<a class="social-action" href="/login">♡ Like ${post.like_count || 0}</a>`}
        <button class="social-action" type="button" data-share-url="${escapeHtml(`/post/${post.slug}`)}">↗ Share</button>
      </div>
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

export function renderDashboard(posts, user, csrfToken, profile = null) {
  const rows = posts.map((post) => `
    <tr>
      <td><a href="/account/posts/${post.id}/edit">${escapeHtml(post.title)}</a></td>
      <td>${post.published ? "Published" : "Draft"}</td>
      <td>${escapeHtml(post.updated_at)}</td>
      <td class="post-actions"><a href="/account/posts/${post.id}/edit">Edit</a><form method="post" action="/account/posts/${post.id}/delete"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button class="text-danger" onclick="return confirm('Delete this post?')">Delete</button></form></td>
    </tr>`).join("");

  const body = `
    <section class="account-hero">
      <div><p class="eyebrow">${profile ? badgeFor(profile.score) : "Your space"}</p><h1>@${escapeHtml(user.username)}</h1><p>Manage your drafts and published writing in one place.</p>${profile ? `<div class="profile-stats account-stats"><a href="/@${encodeURIComponent(user.username)}/followers" title="View your followers"><strong>${profile.follower_count}</strong> followers</a><a href="/@${encodeURIComponent(user.username)}/following" title="View accounts you follow"><strong>${profile.following_count}</strong> following</a><span><strong>${profile.score}</strong> popularity</span><span><strong>${profile.post_count}</strong> posts</span></div><a class="account-profile-link" href="/@${encodeURIComponent(user.username)}">View public profile</a>` : ""}</div>
      <div class="account-hero-actions"><a class="button" href="/account/new">Write a post</a>${user.is_admin ? `<a class="button secondary-button" href="/account/admin">Manage users</a><a class="button secondary-button" href="/account/admin/content">Manage content</a>` : ""}</div>
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

export function renderFollowing({ posts, user, csrfToken, heading = "Following", description = "The latest writing from people you follow.", activeTab = "following" }) {
  const empty = `<p class="empty">No posts here yet. Follow people from their profiles to build your feed.</p>`;
  const body = `<section class="feed-heading"><div><p class="eyebrow">Your feed</p><h1>${escapeHtml(heading)}</h1><p class="feed-description">${escapeHtml(description)}</p></div></section><div class="post-list">${renderPostCards(posts) || empty}</div>`;
  return layout({ title: `${heading} — mini-press`, body, user, csrfToken, activeTab });
}

function badgeFor(score) {
  if (score >= 25) return "Gold contributor";
  if (score >= 10) return "Rising voice";
  if (score >= 1) return "Community member";
  return "New voice";
}

export function renderProfile(profile, posts, user, csrfToken, isFollowing, vote) {
  const ownProfile = user?.id === profile.id;
  const actions = ownProfile ? `<a class="button" href="/account">Manage account</a>` : user ? `
    <form method="post" action="/@${encodeURIComponent(profile.username)}/follow"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button class="button">${isFollowing ? "Following" : "Follow"}</button></form>
    <form method="post" action="/@${encodeURIComponent(profile.username)}/vote"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button class="vote-button ${vote === 1 ? "is-active" : ""}" name="value" value="1">▲</button><button class="vote-button ${vote === -1 ? "is-active" : ""}" name="value" value="-1">▼</button></form>` : `<a class="button" href="/login">Log in to follow</a>`;
  const body = `<section class="profile-hero"><div><p class="eyebrow">${badgeFor(profile.score)}</p><h1>@${escapeHtml(profile.username)}</h1><p>Joined ${escapeHtml(profile.created_at)}</p></div><div class="profile-stats"><a href="/@${encodeURIComponent(profile.username)}/followers"><strong>${profile.follower_count}</strong> followers</a><a href="/@${encodeURIComponent(profile.username)}/following"><strong>${profile.following_count}</strong> following</a><span><strong>${profile.score}</strong> score</span><span><strong>${profile.post_count}</strong> posts</span></div><div class="profile-actions">${actions}</div></section><section class="feed-heading"><h2>Posts by @${escapeHtml(profile.username)}</h2></section><div class="post-list">${renderPostCards(posts) || `<p class="empty">No published posts yet.</p>`}</div>`;
  return layout({ title: `@${profile.username} — mini-press`, body, user, csrfToken });
}

export function renderConnections(profile, people, kind, user = null) {
  const isFollowers = kind === "followers";
  const heading = isFollowers ? "Followers" : "Following";
  const description = isFollowers
    ? `People following @${profile.username}.`
    : `People @${profile.username} follows.`;
  const members = people.map((person) => `<a class="connection-card" href="/@${encodeURIComponent(person.username)}"><span class="connection-avatar" aria-hidden="true">${escapeHtml(person.username.slice(0, 1).toUpperCase())}</span><span><strong>@${escapeHtml(person.username)}</strong><small>${person.follower_count} followers · ${person.following_count} following · ${person.score} score</small></span><span class="connection-arrow" aria-hidden="true">→</span></a>`).join("") || `<p class="empty">${isFollowers ? "No followers yet." : "Not following anyone yet."}</p>`;
  const body = `<section class="connection-heading"><a class="back-link" href="/@${encodeURIComponent(profile.username)}">← Back to @${escapeHtml(profile.username)}</a><p class="eyebrow">Community</p><h1>${heading}</h1><p>${escapeHtml(description)}</p><div class="connection-tabs"><a class="${isFollowers ? "is-active" : ""}" href="/@${encodeURIComponent(profile.username)}/followers">${profile.follower_count} followers</a><a class="${!isFollowers ? "is-active" : ""}" href="/@${encodeURIComponent(profile.username)}/following">${profile.following_count} following</a></div></section><div class="connection-list">${members}</div>`;
  return layout({ title: `${heading} — @${profile.username} — mini-press`, body, user });
}

export function renderCategories(categories, user, csrfToken) {
  const cards = categories.map((category) => `<a class="category-card" href="/categories/${encodeURIComponent(category.slug)}"><h2>${escapeHtml(category.name)}</h2><p>${escapeHtml(category.description)}</p><span>${category.post_count} ${category.post_count === 1 ? "post" : "posts"}</span></a>`).join("");
  const body = `<section class="feed-heading"><div><p class="eyebrow">Discover</p><h1>Categories</h1><p class="feed-description">Find writing by topic.</p></div></section><div class="category-grid">${cards}</div>`;
  return layout({ title: "Categories — mini-press", body, user, csrfToken, activeTab: "categories" });
}

export function renderBoards(boards, user, csrfToken, query = "") {
  const create = user ? `<details class="board-create"><summary>Create a board</summary><form method="post" action="/boards"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><label>Name<input name="name" maxlength="60" placeholder="e.g. Climate Futures" required></label><label>Description<textarea name="description" maxlength="300" rows="3" placeholder="What will people share here?"></textarea></label><button>Create board</button></form></details>` : `<a class="button" href="/login">Log in to create a board</a>`;
  const cards = boards.map((board) => `<a class="board-card" href="/boards/${encodeURIComponent(board.slug)}"><p class="eyebrow">b/${escapeHtml(board.name)}</p><h2>${escapeHtml(board.name)}</h2><p>${escapeHtml(board.description || "A community board.")}</p><span>${board.member_count} members · ${board.post_count} posts · by @${escapeHtml(board.creator_username)}</span></a>`).join("") || `<p class="empty">No boards yet.</p>`;
  const search = `<form class="board-search" method="get" action="/boards" role="search"><label class="sr-only" for="board-search-input">Search boards</label><span class="search-icon" aria-hidden="true">⌕</span><input id="board-search-input" name="q" value="${escapeHtml(query)}" placeholder="Search board name or description" maxlength="100" autocomplete="off"><button>Search boards</button></form>`;
  const body = `<section class="feed-heading"><div><p class="eyebrow">Communities</p><h1>Boards</h1><p class="feed-description">Join focused spaces for shared interests.</p></div>${create}</section>${search}${query ? `<p class="feed-summary">${boards.length} ${boards.length === 1 ? "board" : "boards"} found</p>` : ""}<div class="board-grid">${cards}</div>`;
  return layout({ title: "Boards — mini-press", body, user, csrfToken, activeTab: "boards" });
}

export function renderBoard(board, posts, user, csrfToken, joined) {
  const membership = user ? `<form method="post" action="/boards/${encodeURIComponent(board.slug)}/membership"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button class="button">${joined ? "Joined" : "Join board"}</button></form>` : `<a class="button" href="/login">Log in to join</a>`;
  const body = `<section class="profile-hero"><div><p class="eyebrow">b/${escapeHtml(board.name)}</p><h1>${escapeHtml(board.name)}</h1><p>${escapeHtml(board.description || "A community board.")}</p></div><div class="profile-stats"><span><strong>${board.member_count}</strong> members</span><span>Created by <strong>@${escapeHtml(board.creator_username)}</strong></span></div><div class="profile-actions">${membership}</div></section><section class="feed-heading"><h2>Board posts</h2></section><div class="post-list">${renderPostCards(posts) || `<p class="empty">No published posts in this board yet.</p>`}</div>`;
  return layout({ title: `${board.name} — mini-press`, body, user, csrfToken, activeTab: "boards" });
}

export function renderEvents(events, user, csrfToken) {
  const create = user ? `<details class="event-create"><summary><span>Host an event</span><small>Set the details, capacity, and audience</small></summary><form method="post" action="/events" enctype="multipart/form-data"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><p class="event-form-intro">Create a clear listing so people know exactly what they are joining.</p><fieldset><legend>About the event</legend><label>Title<input name="title" maxlength="120" placeholder="e.g. Film club screening" required></label><label>Description<textarea name="description" rows="4" maxlength="3000" placeholder="What will happen?" required></textarea></label></fieldset><fieldset><legend>When and where</legend><div class="event-form-grid"><label>Date<input type="date" name="event_date" required></label><label>Time<input type="time" name="event_time" required></label></div><label>Location<input name="location" maxlength="160" placeholder="Online, venue, or city" required></label></fieldset><fieldset><legend>Attendance</legend><label>Who can apply?<input name="eligibility" maxlength="160" placeholder="Everyone" value="Everyone"></label><label>Capacity <small>(optional — leave empty for unlimited)</small><input type="number" name="capacity" min="1" placeholder="Unlimited"></label></fieldset><label class="event-image-input">Event image <small>(optional)</small><input type="file" name="image" accept="image/*"></label><button>Publish event</button></form></details>` : `<a class="button" href="/login">Log in to host an event</a>`;
  const cards = events.map((event) => `<a class="event-card" href="/events/${encodeURIComponent(event.slug)}">${event.image_stem ? `<img src="${imageVariantPaths(event.image_stem).thumb}" alt="">` : `<div class="event-image-placeholder">Event</div>`}<div><p class="eyebrow">${escapeHtml(event.event_date)} · ${escapeHtml(event.event_time)}</p><h2>${escapeHtml(event.title)}</h2><p>${escapeHtml(event.description)}</p><span>${escapeHtml(event.location)} · ${event.attendee_count}${event.capacity ? `/${event.capacity}` : ""} attending · by @${escapeHtml(event.creator_username)}</span></div></a>`).join("") || `<p class="empty">No events scheduled yet.</p>`;
  const body = `<section class="feed-heading"><div><p class="eyebrow">Sequential event timeline</p><h1>Events</h1><p class="feed-description">Find something to join, or bring people together.</p></div>${create}</section><div class="event-list">${cards}</div>`;
  return layout({ title: "Events — mini-press", body, user, csrfToken, activeTab: "events" });
}

export function renderEvent(event, user, csrfToken, joined, attendees = []) {
  const image = event.image_stem ? `<img class="event-cover" src="${imageVariantPaths(event.image_stem).large}" alt="">` : "";
  const full = event.capacity && event.attendee_count >= event.capacity;
  const remaining = event.capacity ? Math.max(0, event.capacity - event.attendee_count) : null;
  const action = user ? `<form method="post" action="/events/${encodeURIComponent(event.slug)}/attendance"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button class="button" ${full && !joined ? "disabled" : ""}>${joined ? "You’re attending" : full ? "Event full" : "Join event"}</button></form>` : `<a class="button" href="/login">Log in to join</a>`;
  const attendeesHtml = attendees.length ? `<ul class="event-attendee-list">${attendees.map((attendee) => `<li><a href="/@${encodeURIComponent(attendee.username)}">@${escapeHtml(attendee.username)}</a></li>`).join("")}</ul>` : `<p class="empty">No one has joined yet.</p>`;
  const deletion = user && (user.id === event.creator_id || user.is_admin) ? `<form method="post" action="/events/${encodeURIComponent(event.slug)}/delete" class="event-delete"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button class="text-danger" onclick="return confirm('Delete this event?')">Delete event</button></form>` : "";
  const body = `<article class="event-detail">${image}<p class="eyebrow">${escapeHtml(event.event_date)} · ${escapeHtml(event.event_time)}</p><h1>${escapeHtml(event.title)}</h1><p class="event-host">Hosted by <a href="/@${encodeURIComponent(event.creator_username)}">@${escapeHtml(event.creator_username)}</a></p><dl class="event-details"><div><dt>Location</dt><dd>${escapeHtml(event.location)}</dd></div><div><dt>Who can apply</dt><dd>${escapeHtml(event.eligibility)}</dd></div><div><dt>Attendance</dt><dd>${event.attendee_count}${event.capacity ? ` / ${event.capacity}` : " attendees"}<small>${remaining === null ? "Unlimited capacity" : remaining ? `${remaining} spot${remaining === 1 ? "" : "s"} left` : "No spots left"}</small></dd></div></dl><div class="post-body">${renderMarkdown(event.description)}</div><section class="event-attendees"><div><p class="eyebrow">Community</p><h2>Attendees (${event.attendee_count})</h2></div>${attendeesHtml}</section><div class="profile-actions">${action}${deletion}</div></article>`;
  return layout({ title: `${event.title} — mini-press`, body, user, csrfToken, activeTab: "events" });
}

export function renderAdminContent({ user, csrfToken, posts, boards, categories, events }) {
  const deleteForm = (kind, id, label) => `<form method="post" action="/account/admin/${kind}/${id}/delete"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><button class="text-danger" onclick="return confirm('Delete this ${label}?')">Delete</button></form>`;
  const list = (items, kind, label) => items.map((item) => `<li><span>${escapeHtml(item.title || item.name || item.slug)}${item.author_username ? ` <small>by @${escapeHtml(item.author_username)}</small>` : ""}</span>${deleteForm(kind, item.id, label)}</li>`).join("") || `<li class="empty">None yet.</li>`;
  const body = `<section class="account-hero admin-hero"><div><p class="eyebrow">Administrator</p><h1>Content control</h1><p>Manage site-wide posts, boards, categories, and events.</p></div><a class="button secondary-button" href="/account">Back to account</a></section><section class="admin-content-grid"><div class="account-panel admin-create-category"><div class="account-panel-heading"><h2>Create category</h2></div><form method="post" action="/account/admin/categories"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}"><label>Name<input name="name" maxlength="60" required></label><label>Description<textarea name="description" maxlength="300" rows="3"></textarea></label><button>Add category</button></form></div><div class="account-panel"><div class="account-panel-heading"><h2>Categories</h2><span>${categories.length}</span></div><ul class="admin-content-list">${list(categories, "categories", "category")}</ul></div><div class="account-panel"><div class="account-panel-heading"><h2>Boards</h2><span>${boards.length}</span></div><ul class="admin-content-list">${list(boards, "boards", "board")}</ul></div><div class="account-panel"><div class="account-panel-heading"><h2>Events</h2><span>${events.length}</span></div><ul class="admin-content-list">${list(events, "events", "event")}</ul></div><div class="account-panel"><div class="account-panel-heading"><h2>Posts</h2><span>${posts.length}</span></div><ul class="admin-content-list">${list(posts, "posts", "post")}</ul></div></section>`;
  return layout({ title: "Manage content — mini-press", body, head: ACCOUNT_HEAD, user, csrfToken, activeTab: "account" });
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
export function renderEditor(post, csrfToken, user, categories = [], boards = []) {
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
        <label>Category<select name="category_id"><option value="">No category</option>${categories.map((category) => `<option value="${category.id}" ${post.category_id === category.id ? "selected" : ""}>${escapeHtml(category.name)}</option>`).join("")}</select></label>
        <label>Board<select name="board_id"><option value="">No board</option>${boards.map((board) => `<option value="${board.id}" ${post.board_id === board.id ? "selected" : ""}>b/${escapeHtml(board.name)}</option>`).join("")}</select></label>
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
