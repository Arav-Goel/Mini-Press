// server.js — the entry point. Bun.serve() is our "web server framework"
// (replaces express/fastify/koa). One process, one file that wires
// routing + auth + db + rendering together. Concurrency model: Bun.serve
// handles each request on its own async task backed by libuv's event
// loop (same model as Node) — requests don't block each other on I/O,
// but this process is single-threaded JS, so CPU-bound work (image
// encode) does briefly block the event loop. Documented, not hidden:
// see README "Concurrency model".

import { Router } from "./router.js";
import * as db from "./db.js";
import * as auth from "./auth.js";
import { renderMarkdown } from "./markdown.js";
import { processUpload, verifyImageSupport } from "./images.js";
import { buildRssFeed } from "./rss.js";
import {
  renderHome, renderPost, renderLogin, renderSignup, renderDashboard, renderEditor,
  renderAdminUsers, renderProfile, renderConnections, renderFollowing, renderCategories, renderBoards, renderBoard,
  renderEvents, renderEvent, renderAdminContent,
} from "./render.js";

const PORT = Number(process.env.PORT || 3000);
const SITE_URL = process.env.SITE_URL || `http://localhost:${PORT}`;
const POSTS_PER_PAGE = 5;

function slugify(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `post-${Date.now()}`;
}

function html(body, init = {}) {
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" }, ...init });
}
function redirect(location, extraHeaders = {}) {
  return new Response(null, { status: 303, headers: { location, ...extraHeaders } });
}
function notFound() {
  return new Response("Not found", { status: 404 });
}

function likePattern(query) {
  return `%${query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}
function pageWithPosts(render, req, posts, extra = {}) {
  const user = currentUser(req);
  const token = user ? auth.csrfTokenFor(req.headers.get("cookie")) : null;
  return html(render({ posts, user, csrfToken: token, ...extra }));
}

function requireAuth(req) {
  const session = auth.verifySessionCookie(req.headers.get("cookie"));
  return session; // null if not authenticated
}

function currentUser(req) {
  const session = requireAuth(req);
  return session ? db.getUserById.get(session.userId) : null;
}

function requireAdmin(req) {
  const user = currentUser(req);
  return user?.is_admin ? user : null;
}

const router = new Router();

// ---------- public site ----------

router.get("/", async (req) => {
  const url = new URL(req.url);
  const query = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const requestedPage = Number.parseInt(url.searchParams.get("page") || "1", 10);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const pattern = likePattern(query);
  const total = query
    ? Number(db.countSearchPublishedPosts.get(pattern, pattern).n)
    : Number(db.countPublishedPosts.get().n);
  const totalPages = Math.max(1, Math.ceil(total / POSTS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * POSTS_PER_PAGE;
  const posts = query
    ? db.searchPublishedPostsPage.all(pattern, pattern, POSTS_PER_PAGE, offset)
    : db.listPublishedPostsPage.all(POSTS_PER_PAGE, offset);
  return html(renderHome({ posts, user: currentUser(req), query, page: safePage, totalPages, total }));
});

router.get("/post/:slug", async (req, { params }) => {
  const post = db.getPostBySlug.get(params.slug);
  if (!post || !post.published) return notFound();
  const comments = db.listCommentsForPost.all(post.id);
  const user = currentUser(req);
  const csrfToken = user ? auth.csrfTokenFor(req.headers.get("cookie")) : null;
  post.viewer_liked = user ? Boolean(db.getPostLike.get(post.id, user.id)) : false;
  return html(renderPost(post, comments, user, csrfToken));
});

router.post("/post/:slug/like", async (req, { params }) => {
  const user = currentUser(req);
  if (!user) return redirect("/login");
  const post = db.getPostBySlug.get(params.slug);
  if (!post || !post.published) return notFound();
  const form = await req.formData();
  if (!auth.verifyCsrf(req.headers.get("cookie"), String(form.get("csrf") || ""))) return new Response("Invalid CSRF token", { status: 403 });
  if (db.getPostLike.get(post.id, user.id)) db.removePostLike.run(post.id, user.id);
  else db.addPostLike.run(post.id, user.id);
  return redirect(`/post/${params.slug}`);
});

router.get("/following", async (req) => {
  const user = currentUser(req);
  if (!user) return redirect("/login");
  return pageWithPosts(renderFollowing, req, db.listFollowingPosts.all(user.id, 50));
});

router.get("/categories", async (req) => {
  return html(renderCategories(db.listCategories.all(), currentUser(req), auth.csrfTokenFor(req.headers.get("cookie"))));
});
router.get("/categories/:slug", async (req, { params }) => {
  const category = db.getCategoryBySlug.get(params.slug);
  if (!category) return notFound();
  return pageWithPosts(renderFollowing, req, db.listCategoryPosts.all(params.slug), { heading: category.name, description: category.description, activeTab: "categories" });
});

router.get("/boards", async (req) => {
  const user = currentUser(req);
  const query = (new URL(req.url).searchParams.get("q") || "").trim().slice(0, 100);
  const pattern = likePattern(query);
  const boards = query ? db.searchBoards.all(pattern, pattern) : db.listBoards.all();
  return html(renderBoards(boards, user, user ? auth.csrfTokenFor(req.headers.get("cookie")) : null, query));
});
router.post("/boards", async (req) => {
  const user = currentUser(req);
  if (!user) return redirect("/login");
  const form = await req.formData();
  if (!auth.verifyCsrf(req.headers.get("cookie"), String(form.get("csrf") || ""))) return new Response("Invalid CSRF token", { status: 403 });
  const name = String(form.get("name") || "").trim().slice(0, 60);
  const description = String(form.get("description") || "").trim().slice(0, 300);
  if (!name) return redirect("/boards");
  const slug = slugify(name);
  try {
    const result = db.insertBoard.run(slug, name, description, user.id);
    const board = db.getBoardById.get(Number(result.lastInsertRowid));
    db.joinBoard.run(board.id, user.id);
    return redirect(`/boards/${board.slug}`);
  } catch { return redirect("/boards"); }
});
router.get("/boards/:slug", async (req, { params }) => {
  const board = db.getBoardBySlug.get(params.slug);
  if (!board) return notFound();
  const user = currentUser(req);
  const joined = user ? Boolean(db.getBoardMembership.get(board.id, user.id)) : false;
  return html(renderBoard(board, db.listBoardPosts.all(params.slug), user, user ? auth.csrfTokenFor(req.headers.get("cookie")) : null, joined));
});
router.post("/boards/:slug/membership", async (req, { params }) => {
  const user = currentUser(req);
  if (!user) return redirect("/login");
  const board = db.getBoardBySlug.get(params.slug);
  if (!board) return notFound();
  const form = await req.formData();
  if (!auth.verifyCsrf(req.headers.get("cookie"), String(form.get("csrf") || ""))) return new Response("Invalid CSRF token", { status: 403 });
  if (db.getBoardMembership.get(board.id, user.id)) db.leaveBoard.run(board.id, user.id);
  else db.joinBoard.run(board.id, user.id);
  return redirect(`/boards/${params.slug}`);
});

router.get("/events", async (req) => {
  const user = currentUser(req);
  return html(renderEvents(db.listEvents.all(), user, user ? auth.csrfTokenFor(req.headers.get("cookie")) : null));
});
router.post("/events", async (req) => {
  const user = currentUser(req);
  if (!user) return redirect("/login");
  const form = await req.formData();
  if (!auth.verifyCsrf(req.headers.get("cookie"), String(form.get("csrf") || ""))) return new Response("Invalid CSRF token", { status: 403 });
  const title = String(form.get("title") || "").trim().slice(0, 120);
  const description = String(form.get("description") || "").trim().slice(0, 3000);
  const date = String(form.get("event_date") || "");
  const time = String(form.get("event_time") || "");
  const location = String(form.get("location") || "").trim().slice(0, 160);
  const eligibility = String(form.get("eligibility") || "Everyone").trim().slice(0, 160);
  const capacityInput = String(form.get("capacity") || "").trim();
  const capacity = capacityInput ? Number(capacityInput) : null;
  if (!title || !description || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !location || (capacity !== null && (!Number.isSafeInteger(capacity) || capacity < 1))) return new Response("Please complete the required event details.", { status: 400 });
  const slug = `${slugify(title)}-${Date.now()}`;
  const result = db.insertEvent.run(slug, user.id, title, description, date, time, location, eligibility || "Everyone", capacity);
  const eventId = Number(result.lastInsertRowid);
  const image = form.get("image");
  if (image && typeof image === "object" && image.size > 0) {
    const stem = await processUpload(Buffer.from(await image.arrayBuffer()), `event-${eventId}`);
    db.setEventImage.run(stem, eventId, user.id);
  }
  return redirect(`/events/${slug}`);
});
router.get("/events/:slug", async (req, { params }) => {
  const event = db.getEventBySlug.get(params.slug);
  if (!event) return notFound();
  const user = currentUser(req);
  const joined = user ? Boolean(db.getEventAttendance.get(event.id, user.id)) : false;
  return html(renderEvent(event, user, user ? auth.csrfTokenFor(req.headers.get("cookie")) : null, joined, db.listEventAttendees.all(event.id)));
});
router.post("/events/:slug/attendance", async (req, { params }) => {
  const user = currentUser(req);
  if (!user) return redirect("/login");
  const event = db.getEventBySlug.get(params.slug);
  if (!event) return notFound();
  const form = await req.formData();
  if (!auth.verifyCsrf(req.headers.get("cookie"), String(form.get("csrf") || ""))) return new Response("Invalid CSRF token", { status: 403 });
  if (db.getEventAttendance.get(event.id, user.id)) db.leaveEvent.run(event.id, user.id);
  else if (!db.joinEventIfAvailable(event.id, user.id)) return new Response("This event is full.", { status: 409 });
  return redirect(`/events/${params.slug}`);
});
router.post("/events/:slug/delete", async (req, { params }) => {
  const user = currentUser(req);
  if (!user) return redirect("/login");
  const event = db.getEventBySlug.get(params.slug);
  if (!event) return notFound();
  const form = await req.formData();
  if (!auth.verifyCsrf(req.headers.get("cookie"), String(form.get("csrf") || ""))) return new Response("Invalid CSRF token", { status: 403 });
  if (event.creator_id === user.id) db.deleteEventForCreator.run(event.id, user.id);
  else if (user.is_admin) db.deleteEventForAdmin.run(event.id);
  else return notFound();
  return redirect("/events");
});

router.get("/@:username", async (req, { params }) => {
  const profile = db.getPublicUser.get(params.username);
  if (!profile) return notFound();
  const user = currentUser(req);
  const isFollowing = user ? Boolean(db.getFollow.get(user.id, profile.id)) : false;
  const vote = user ? db.getUserVote.get(user.id, profile.id)?.value ?? 0 : 0;
  return html(renderProfile(profile, db.listProfilePosts.all(params.username), user, user ? auth.csrfTokenFor(req.headers.get("cookie")) : null, isFollowing, vote));
});
router.get("/@:username/followers", async (req, { params }) => {
  const profile = db.getPublicUser.get(params.username);
  if (!profile) return notFound();
  return html(renderConnections(profile, db.listFollowersForUser.all(profile.id), "followers", currentUser(req)));
});
router.get("/@:username/following", async (req, { params }) => {
  const profile = db.getPublicUser.get(params.username);
  if (!profile) return notFound();
  return html(renderConnections(profile, db.listFollowingForUser.all(profile.id), "following", currentUser(req)));
});
router.post("/@:username/follow", async (req, { params }) => {
  const user = currentUser(req);
  if (!user) return redirect("/login");
  const profile = db.getPublicUser.get(params.username);
  if (!profile || profile.id === user.id) return notFound();
  const form = await req.formData();
  if (!auth.verifyCsrf(req.headers.get("cookie"), String(form.get("csrf") || ""))) return new Response("Invalid CSRF token", { status: 403 });
  if (db.getFollow.get(user.id, profile.id)) db.unfollowUser.run(user.id, profile.id);
  else db.followUser.run(user.id, profile.id);
  return redirect(`/@${params.username}`);
});
router.post("/@:username/vote", async (req, { params }) => {
  const user = currentUser(req);
  if (!user) return redirect("/login");
  const profile = db.getPublicUser.get(params.username);
  if (!profile || profile.id === user.id) return notFound();
  const form = await req.formData();
  if (!auth.verifyCsrf(req.headers.get("cookie"), String(form.get("csrf") || ""))) return new Response("Invalid CSRF token", { status: 403 });
  const value = Number(form.get("value"));
  if (value !== 1 && value !== -1) return new Response("Invalid vote", { status: 400 });
  const existing = db.getUserVote.get(user.id, profile.id);
  if (existing?.value === value) db.clearUserVote.run(user.id, profile.id);
  else db.setUserVote.run(user.id, profile.id, value);
  return redirect(`/@${params.username}`);
});

router.post("/post/:slug/comments", async (req, { params }) => {
  const user = currentUser(req);
  if (!user) return redirect("/login");
  const post = db.getPostBySlug.get(params.slug);
  if (!post || !post.published) return notFound();

  const form = await req.formData();
  if (!auth.verifyCsrf(req.headers.get("cookie"), String(form.get("csrf") || ""))) {
    return new Response("Invalid CSRF token", { status: 403 });
  }
  const body = String(form.get("body") || "").trim().slice(0, 2000);
  if (!body) return redirect(`/post/${params.slug}`);

  // The displayed name comes from the signed-in account, never a form field.
  db.insertComment.run(post.id, user.id, user.username, body);
  return redirect(`/post/${params.slug}#comments`);
});

router.get("/feed.xml", async () => {
  const posts = db.listPublishedPostsPage.all(50, 0);
  const feed = buildRssFeed({
    siteTitle: "mini-press",
    siteUrl: SITE_URL,
    siteDescription: "A zero-dependency blog.",
    posts,
  });
  return new Response(feed, { headers: { "content-type": "application/rss+xml; charset=utf-8" } });
});

router.get("/uploads/:filename", async (req, { params }) => {
  // Reject path traversal before ever touching the filesystem.
  if (params.filename.includes("..") || params.filename.includes("/")) return notFound();
  const path = `${process.env.MINIPRESS_DATA_DIR || "./data"}/uploads/${params.filename}`;
  const file = Bun.file(path);
  if (!(await file.exists())) return notFound();
  return new Response(file);
});

// Serves a static file from ./public, returning a real 404 (not a thrown
// ENOENT that becomes a 500) when it's missing — same existence check the
// /uploads/:filename route already did correctly.
async function staticFile(path) {
  const file = Bun.file(path);
  if (!(await file.exists())) return notFound();
  return new Response(file);
}

router.get("/site.css", async () => staticFile("./public/site.css"));
router.get("/account.css", async () => staticFile("./public/account.css"));
router.get("/editor.js", async () => staticFile("./public/editor.js"));
router.get("/theme.js", async () => staticFile("./public/theme.js"));
router.get("/social.js", async () => staticFile("./public/social.js"));

// ---------- accounts ----------

router.get("/login", async (req) => {
  if (currentUser(req)) return redirect("/account");
  return html(renderLogin());
});

router.post("/login", async (req) => {
  const form = await req.formData();
  const username = String(form.get("username") || "");
  const password = String(form.get("password") || "");

  const user = db.getUserByUsername.get(username);
  const ok = user && auth.verifyPassword(password, user.password_hash, user.salt);
  if (!ok) return html(renderLogin({ error: "Invalid username or password." }), { status: 401 });

  return redirect("/account", { "set-cookie": auth.createSessionCookie(user.id) });
});

router.get("/signup", async (req) => {
  if (currentUser(req)) return redirect("/account");
  return html(renderSignup());
});

router.post("/signup", async (req) => {
  const form = await req.formData();
  const username = String(form.get("username") || "").trim();
  const password = String(form.get("password") || "");
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(username)) {
    return html(renderSignup({ error: "Use 3–40 letters, numbers, underscores, or hyphens for your username." }), { status: 400 });
  }
  if (password.length < 8) {
    return html(renderSignup({ error: "Password must be at least 8 characters." }), { status: 400 });
  }
  if (db.getUserByUsername.get(username)) {
    return html(renderSignup({ error: "That username is already taken." }), { status: 409 });
  }
  const { hash, salt } = auth.hashPassword(password);
  const result = db.insertUser.run(username, hash, salt);
  if (username === "adminjs") db.promoteUsernameToAdmin.run(username);
  return redirect("/account", { "set-cookie": auth.createSessionCookie(Number(result.lastInsertRowid)) });
});

router.post("/logout", async (req) => {
  const session = requireAuth(req);
  if (!session) return redirect("/");
  const form = await req.formData();
  if (!auth.verifyCsrf(req.headers.get("cookie"), String(form.get("csrf") || ""))) {
    return new Response("Invalid CSRF token", { status: 403 });
  }
  return redirect("/", { "set-cookie": auth.clearSessionCookie() });
});

// ---------- account, all routes below require the post owner ----------

router.get("/account", async (req) => {
  const user = currentUser(req);
  if (!user) return redirect("/login");
  const token = auth.csrfTokenFor(req.headers.get("cookie"));
  return html(renderDashboard(db.listPostsForUser.all(user.id), user, token, db.getPublicUser.get(user.username)));
});

router.get("/account/admin", async (req) => {
  const user = requireAdmin(req);
  if (!user) return notFound();
  const token = auth.csrfTokenFor(req.headers.get("cookie"));
  return html(renderAdminUsers(db.listUsersForAdmin.all(), user, token));
});

router.post("/account/admin/users/:id/delete", async (req, { params }) => {
  const user = requireAdmin(req);
  if (!user) return notFound();
  const form = await req.formData();
  if (!auth.verifyCsrf(req.headers.get("cookie"), String(form.get("csrf") || ""))) {
    return new Response("Invalid CSRF token", { status: 403 });
  }
  const targetId = Number(params.id);
  if (!Number.isSafeInteger(targetId) || targetId === user.id) return new Response("Cannot delete this account", { status: 400 });
  db.deleteUserAndContent(targetId);
  return redirect("/account/admin");
});

router.get("/account/admin/content", async (req) => {
  const user = requireAdmin(req);
  if (!user) return notFound();
  const csrfToken = auth.csrfTokenFor(req.headers.get("cookie"));
  return html(renderAdminContent({ user, csrfToken, posts: db.listPostsForAdmin.all(), boards: db.listBoards.all(), categories: db.listCategories.all(), events: db.listEvents.all() }));
});
router.post("/account/admin/categories", async (req) => {
  const user = requireAdmin(req);
  if (!user) return notFound();
  const form = await req.formData();
  if (!auth.verifyCsrf(req.headers.get("cookie"), String(form.get("csrf") || ""))) return new Response("Invalid CSRF token", { status: 403 });
  const name = String(form.get("name") || "").trim().slice(0, 60);
  const description = String(form.get("description") || "").trim().slice(0, 300);
  if (!name) return redirect("/account/admin/content");
  try { db.insertCategory.run(slugify(name), name, description); } catch { /* A duplicate returns to the manager. */ }
  return redirect("/account/admin/content");
});
router.post("/account/admin/:kind/:id/delete", async (req, { params }) => {
  const user = requireAdmin(req);
  if (!user) return notFound();
  const form = await req.formData();
  if (!auth.verifyCsrf(req.headers.get("cookie"), String(form.get("csrf") || ""))) return new Response("Invalid CSRF token", { status: 403 });
  const id = Number(params.id);
  if (!Number.isSafeInteger(id)) return notFound();
  if (params.kind === "posts") db.deletePostForAdmin.run(id);
  else if (params.kind === "boards") db.deleteBoardForAdmin(id);
  else if (params.kind === "categories") db.deleteCategoryForAdmin(id);
  else if (params.kind === "events") db.deleteEventForAdmin.run(id);
  else return notFound();
  return redirect("/account/admin/content");
});

router.get("/account/new", async (req) => {
  const user = currentUser(req);
  if (!user) return redirect("/login");
  const token = auth.csrfTokenFor(req.headers.get("cookie"));
  return html(renderEditor({}, token, user, db.listCategories.all(), db.listBoards.all()));
});

router.get("/account/posts/:id/edit", async (req, { params }) => {
  const user = currentUser(req);
  if (!user) return redirect("/login");
  const post = db.getPostByIdForUser.get(Number(params.id), user.id);
  if (!post) return notFound();
  const token = auth.csrfTokenFor(req.headers.get("cookie"));
  return html(renderEditor(post, token, user, db.listCategories.all(), db.listBoards.all()));
});

async function handleSavePost(req, existingId) {
  const user = currentUser(req);
  if (!user) return redirect("/login");

  const form = await req.formData();
  if (!auth.verifyCsrf(req.headers.get("cookie"), String(form.get("csrf") || ""))) {
    return new Response("Invalid CSRF token", { status: 403 });
  }

  const title = String(form.get("title") || "").trim().slice(0, 200);
  const markdown = String(form.get("markdown") || "");
  const categoryId = Number(form.get("category_id")) || null;
  const boardId = Number(form.get("board_id")) || null;
  if (!title) return new Response("Title is required", { status: 400 });
  if (categoryId && !db.getCategoryById.get(categoryId)) return new Response("Invalid category", { status: 400 });
  if (boardId && !db.getBoardById.get(boardId)) return new Response("Invalid board", { status: 400 });

  let postId = existingId;
  if (postId) {
    if (db.updatePost.run(title, markdown, categoryId, boardId, postId, user.id).changes === 0) return notFound();
  } else {
    const slug = slugify(title);
    const result = db.insertPost.run(user.id, slug, title, markdown, 0, categoryId, boardId);
    postId = Number(result.lastInsertRowid);
  }

  const cover = form.get("cover");
  if (cover && typeof cover === "object" && cover.size > 0) {
    const buffer = Buffer.from(await cover.arrayBuffer());
    const stem = await processUpload(buffer, postId);
    db.setPostCoverImage.run(stem, postId, user.id);
  }

  return redirect(`/account/posts/${postId}/edit`);
}

router.post("/account/posts", async (req) => handleSavePost(req, null));
router.post("/account/posts/:id", async (req, { params }) => handleSavePost(req, Number(params.id)));

router.post("/account/posts/:id/publish", async (req, { params }) => {
  const user = currentUser(req);
  if (!user) return redirect("/login");
  const form = await req.formData();
  if (!auth.verifyCsrf(req.headers.get("cookie"), String(form.get("csrf") || ""))) {
    return new Response("Invalid CSRF token", { status: 403 });
  }
  const published = String(form.get("published") || "0") === "1" ? 1 : 0;
  if (db.setPostPublished.run(published, Number(params.id), user.id).changes === 0) return notFound();
  return redirect(`/account/posts/${params.id}/edit`);
});

router.post("/account/posts/:id/delete", async (req, { params }) => {
  const user = currentUser(req);
  if (!user) return redirect("/login");
  const form = await req.formData();
  if (!auth.verifyCsrf(req.headers.get("cookie"), String(form.get("csrf") || ""))) {
    return new Response("Invalid CSRF token", { status: 403 });
  }
  if (db.deletePost.run(Number(params.id), user.id).changes === 0) return notFound();
  return redirect("/account");
});

// ---------- websocket: live markdown preview ----------
// A tiny protocol: client sends raw markdown text as a message, server
// replies with the rendered HTML. No JSON envelope needed for something
// this small — the whole payload IS the content.

const wsHandlers = {
  message(ws, message) {
    try {
      ws.send(renderMarkdown(String(message)));
    } catch {
      ws.send("<p class='error'>Preview error.</p>");
    }
  },
};

async function main() {
  await verifyImageSupport();

  if (db.countUsers.get().n === 0) {
    console.log(
      "No accounts exist yet. Create one at /signup."
    );
  }

  Bun.serve({
    port: PORT,
    async fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/account/preview-ws") {
        const session = requireAuth(req);
        if (!session) return new Response("Unauthorized", { status: 401 });
        if (server.upgrade(req)) return; // hands off to wsHandlers
        return new Response("Upgrade failed", { status: 400 });
      }

      const response = await router.handle(req, {});
      return response ?? notFound();
    },
    websocket: wsHandlers,
  });

  console.log(`mini-press running at ${SITE_URL}`);
}

main().catch((err) => {
  console.error("Failed to start mini-press:");
  console.error(err);
  process.exit(1);
});
