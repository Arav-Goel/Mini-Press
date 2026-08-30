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

function requireAuth(req) {
  const session = auth.verifySessionCookie(req.headers.get("cookie"));
  return session; // null if not authenticated
}

function currentUser(req) {
  const session = requireAuth(req);
  return session ? db.getUserById.get(session.userId) : null;
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
  return html(renderPost(post, comments, user, csrfToken));
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
  return html(renderDashboard(db.listPostsForUser.all(user.id), user, token));
});

router.get("/account/new", async (req) => {
  const user = currentUser(req);
  if (!user) return redirect("/login");
  const token = auth.csrfTokenFor(req.headers.get("cookie"));
  return html(renderEditor({}, token, user));
});

router.get("/account/posts/:id/edit", async (req, { params }) => {
  const user = currentUser(req);
  if (!user) return redirect("/login");
  const post = db.getPostByIdForUser.get(Number(params.id), user.id);
  if (!post) return notFound();
  const token = auth.csrfTokenFor(req.headers.get("cookie"));
  return html(renderEditor(post, token, user));
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
  if (!title) return new Response("Title is required", { status: 400 });

  let postId = existingId;
  if (postId) {
    if (db.updatePost.run(title, markdown, postId, user.id).changes === 0) return notFound();
  } else {
    const slug = slugify(title);
    const result = db.insertPost.run(user.id, slug, title, markdown, 0);
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
