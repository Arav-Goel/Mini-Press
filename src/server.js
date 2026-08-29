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
  renderHome, renderPost, renderLogin, renderDashboard, renderEditor,
} from "./render.js";

const PORT = Number(process.env.PORT || 3000);
const SITE_URL = process.env.SITE_URL || `http://localhost:${PORT}`;

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

function requireAuth(req) {
  const session = auth.verifySessionCookie(req.headers.get("cookie"));
  return session; // null if not authenticated
}

const router = new Router();

// ---------- public site ----------

router.get("/", async () => {
  const posts = db.listPublishedPosts.all(50);
  return html(renderHome(posts));
});

router.get("/post/:slug", async (req, { params }) => {
  const post = db.getPostBySlug.get(params.slug);
  if (!post || !post.published) return notFound();
  const comments = db.listCommentsForPost.all(post.id);
  return html(renderPost(post, comments));
});

router.post("/post/:slug/comments", async (req, { params }) => {
  const post = db.getPostBySlug.get(params.slug);
  if (!post || !post.published) return notFound();

  const form = await req.formData();
  const author = String(form.get("author") || "").trim().slice(0, 80);
  const body = String(form.get("body") || "").trim().slice(0, 2000);
  if (!author || !body) return redirect(`/post/${params.slug}`);

  db.insertComment.run(post.id, author, body);
  return redirect(`/post/${params.slug}#comments`);
});

router.get("/feed.xml", async () => {
  const posts = db.listPublishedPosts.all(50);
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

router.get("/site.css", async () => new Response(Bun.file("./public/site.css")));
router.get("/admin.css", async () => new Response(Bun.file("./public/admin.css")));
router.get("/editor.js", async () => new Response(Bun.file("./public/editor.js")));

// ---------- admin auth ----------

router.get("/admin/login", async (req) => {
  if (requireAuth(req)) return redirect("/admin");
  return html(renderLogin());
});

router.post("/admin/login", async (req) => {
  const form = await req.formData();
  const username = String(form.get("username") || "");
  const password = String(form.get("password") || "");

  const user = db.getUserByUsername.get(username);
  const ok = user && auth.verifyPassword(password, user.password_hash, user.salt);
  if (!ok) return html(renderLogin({ error: "Invalid username or password." }), { status: 401 });

  return redirect("/admin", { "set-cookie": auth.createSessionCookie(user.id) });
});

router.post("/admin/logout", async () => {
  return redirect("/admin/login", { "set-cookie": auth.clearSessionCookie() });
});

// ---------- admin, all routes below require a session ----------

router.get("/admin", async (req) => {
  const session = requireAuth(req);
  if (!session) return redirect("/admin/login");
  return html(renderDashboard(db.listAllPosts.all()));
});

router.get("/admin/new", async (req) => {
  const session = requireAuth(req);
  if (!session) return redirect("/admin/login");
  const token = auth.csrfTokenFor(req.headers.get("cookie"));
  return html(renderEditor({}, token));
});

router.get("/admin/posts/:id/edit", async (req, { params }) => {
  const session = requireAuth(req);
  if (!session) return redirect("/admin/login");
  const post = db.getPostById.get(Number(params.id));
  if (!post) return notFound();
  const token = auth.csrfTokenFor(req.headers.get("cookie"));
  return html(renderEditor(post, token));
});

async function handleSavePost(req, existingId) {
  const session = requireAuth(req);
  if (!session) return redirect("/admin/login");

  const form = await req.formData();
  if (!auth.verifyCsrf(req.headers.get("cookie"), String(form.get("csrf") || ""))) {
    return new Response("Invalid CSRF token", { status: 403 });
  }

  const title = String(form.get("title") || "").trim().slice(0, 200);
  const markdown = String(form.get("markdown") || "");
  if (!title) return new Response("Title is required", { status: 400 });

  let postId = existingId;
  if (postId) {
    db.updatePost.run(title, markdown, postId);
  } else {
    const slug = slugify(title);
    const result = db.insertPost.run(slug, title, markdown, 0);
    postId = Number(result.lastInsertRowid);
  }

  const cover = form.get("cover");
  if (cover && typeof cover === "object" && cover.size > 0) {
    const buffer = Buffer.from(await cover.arrayBuffer());
    const stem = await processUpload(buffer, postId);
    db.setPostCoverImage.run(stem, postId);
  }

  return redirect(`/admin/posts/${postId}/edit`);
}

router.post("/admin/posts", async (req) => handleSavePost(req, null));
router.post("/admin/posts/:id", async (req, { params }) => handleSavePost(req, Number(params.id)));

router.post("/admin/posts/:id/publish", async (req, { params }) => {
  const session = requireAuth(req);
  if (!session) return redirect("/admin/login");
  const form = await req.formData();
  const published = String(form.get("published") || "0") === "1" ? 1 : 0;
  db.setPostPublished.run(published, Number(params.id));
  return redirect(`/admin/posts/${params.id}/edit`);
});

router.post("/admin/posts/:id/delete", async (req, { params }) => {
  const session = requireAuth(req);
  if (!session) return redirect("/admin/login");
  db.deletePost.run(Number(params.id));
  return redirect("/admin");
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
      "No admin user exists yet. Run: bun src/scripts/create-admin.js <username> <password>"
    );
  }

  Bun.serve({
    port: PORT,
    async fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/admin/preview-ws") {
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
