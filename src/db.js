// db.js — bun:sqlite is our entire "database layer".
// No ORM, no query builder, no better-sqlite3. Just parameterized SQL
// (always parameterized — this is our SQL-injection defense, not an
// afterthought) and a thin set of query functions the rest of the app calls.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";

const DATA_DIR = process.env.MINIPRESS_DATA_DIR || "./data";
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(`${DATA_DIR}/uploads`, { recursive: true });

export const db = new Database(`${DATA_DIR}/minipress.sqlite`);

// WAL mode: readers don't block the writer, and we survive a crash mid-write
// without corrupting the file (the -wal file replays on next open).
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,   -- hex scrypt output
    salt          TEXT NOT NULL,   -- hex, unique per user
    is_admin      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS posts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER REFERENCES users(id),
    slug         TEXT UNIQUE NOT NULL,
    title        TEXT NOT NULL,
    markdown     TEXT NOT NULL DEFAULT '',
    published    INTEGER NOT NULL DEFAULT 0,
    cover_image  TEXT,             -- filename stem, sizes derived from it
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES users(id),
    author     TEXT NOT NULL,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(published, created_at);
  CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
`);

// Existing installations predate account-owned posts and comments. SQLite
// cannot add a column through CREATE TABLE IF NOT EXISTS, so migrate those
// databases in place. Legacy rows remain readable, but only posts with an
// owner can be changed through the account UI.
function hasColumn(table, column) {
  return db.query(`PRAGMA table_info(${table})`).all().some((entry) => entry.name === column);
}

if (!hasColumn("posts", "user_id")) {
  db.exec("ALTER TABLE posts ADD COLUMN user_id INTEGER REFERENCES users(id)");
}
if (!hasColumn("comments", "user_id")) {
  db.exec("ALTER TABLE comments ADD COLUMN user_id INTEGER REFERENCES users(id)");
}
if (!hasColumn("users", "is_admin")) {
  db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
}

// The requested site administrator is explicitly named, rather than inferred
// from registration order. This remains safe when the account does not exist:
// the update simply affects zero rows until adminjs signs up.
export const promoteUsernameToAdmin = db.prepare(`UPDATE users SET is_admin = 1 WHERE username = ?`);
promoteUsernameToAdmin.run("adminjs");

db.exec("CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, created_at)");
db.exec("CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id)");

// --- users ---
export const insertUser = db.prepare(
  `INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)`
);
export const getUserByUsername = db.prepare(
  `SELECT * FROM users WHERE username = ?`
);
export const getUserById = db.prepare(`SELECT * FROM users WHERE id = ?`);
export const countUsers = db.prepare(`SELECT COUNT(*) AS n FROM users`);
export const listUsersForAdmin = db.prepare(`
  SELECT users.id, users.username, users.created_at, users.is_admin,
    (SELECT COUNT(*) FROM posts WHERE posts.user_id = users.id) AS post_count,
    (SELECT COUNT(*) FROM comments WHERE comments.user_id = users.id) AS comment_count
  FROM users ORDER BY users.is_admin DESC, users.created_at ASC
`);
const deleteCommentsByUser = db.prepare(`DELETE FROM comments WHERE user_id = ?`);
const deletePostsByUser = db.prepare(`DELETE FROM posts WHERE user_id = ?`);
const deleteUser = db.prepare(`DELETE FROM users WHERE id = ? AND is_admin = 0`);
export const deleteUserAndContent = db.transaction((userId) => {
  // Remove authored comments first, then owned posts (whose comments cascade),
  // so foreign-key constraints never leave orphaned identities behind.
  deleteCommentsByUser.run(userId);
  deletePostsByUser.run(userId);
  return deleteUser.run(userId);
});

// --- posts ---
export const insertPost = db.prepare(
  `INSERT INTO posts (user_id, slug, title, markdown, published) VALUES (?, ?, ?, ?, ?)`
);
export const updatePost = db.prepare(`
  UPDATE posts SET title = ?, markdown = ?, updated_at = datetime('now')
  WHERE id = ? AND user_id = ?
`);
export const setPostPublished = db.prepare(
  `UPDATE posts SET published = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`
);
export const setPostCoverImage = db.prepare(
  `UPDATE posts SET cover_image = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`
);
export const deletePost = db.prepare(`DELETE FROM posts WHERE id = ? AND user_id = ?`);
export const getPostById = db.prepare(`SELECT * FROM posts WHERE id = ?`);
export const getPostByIdForUser = db.prepare(`SELECT * FROM posts WHERE id = ? AND user_id = ?`);
export const getPostBySlug = db.prepare(`
  SELECT posts.*, users.username AS author_username
  FROM posts LEFT JOIN users ON users.id = posts.user_id WHERE posts.slug = ?
`);
export const listPostsForUser = db.prepare(
  `SELECT * FROM posts WHERE user_id = ? ORDER BY created_at DESC`
);
export const listPublishedPostsPage = db.prepare(
  `SELECT posts.*, users.username AS author_username
   FROM posts LEFT JOIN users ON users.id = posts.user_id
   WHERE posts.published = 1 ORDER BY posts.created_at DESC LIMIT ? OFFSET ?`
);
export const countPublishedPosts = db.prepare(
  `SELECT COUNT(*) AS n FROM posts WHERE published = 1`
);
export const searchPublishedPostsPage = db.prepare(
  `SELECT posts.*, users.username AS author_username FROM posts
   LEFT JOIN users ON users.id = posts.user_id
   WHERE posts.published = 1 AND (posts.title LIKE ? ESCAPE '\\' OR posts.markdown LIKE ? ESCAPE '\\')
   ORDER BY posts.created_at DESC LIMIT ? OFFSET ?`
);
export const countSearchPublishedPosts = db.prepare(
  `SELECT COUNT(*) AS n FROM posts
   WHERE published = 1 AND (title LIKE ? ESCAPE '\\' OR markdown LIKE ? ESCAPE '\\')`
);

// --- comments ---
export const insertComment = db.prepare(
  `INSERT INTO comments (post_id, user_id, author, body) VALUES (?, ?, ?, ?)`
);
export const listCommentsForPost = db.prepare(
  `SELECT comments.*, COALESCE(users.username, comments.author) AS username
   FROM comments LEFT JOIN users ON users.id = comments.user_id
   WHERE comments.post_id = ? ORDER BY comments.created_at ASC`
);
