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

  CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT UNIQUE NOT NULL,
    name        TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS boards (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT UNIQUE NOT NULL,
    name        TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    creator_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS board_members (
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (board_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS follows (
    follower_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (follower_id, following_id),
    CHECK (follower_id != following_id)
  );

  CREATE TABLE IF NOT EXISTS user_votes (
    voter_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    value     INTEGER NOT NULL CHECK (value IN (-1, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (voter_id, target_id),
    CHECK (voter_id != target_id)
  );

  CREATE TABLE IF NOT EXISTS post_likes (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (post_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT UNIQUE NOT NULL,
    creator_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT NOT NULL,
    image_stem  TEXT,
    event_date  TEXT NOT NULL,
    event_time  TEXT NOT NULL,
    location    TEXT NOT NULL,
    eligibility TEXT NOT NULL DEFAULT 'Everyone',
    capacity    INTEGER CHECK (capacity IS NULL OR capacity > 0),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS event_attendees (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (event_id, user_id)
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
if (!hasColumn("posts", "category_id")) {
  db.exec("ALTER TABLE posts ADD COLUMN category_id INTEGER REFERENCES categories(id)");
}
if (!hasColumn("posts", "board_id")) {
  db.exec("ALTER TABLE posts ADD COLUMN board_id INTEGER REFERENCES boards(id)");
}

// The requested site administrator is explicitly named, rather than inferred
// from registration order. This remains safe when the account does not exist:
// the update simply affects zero rows until adminjs signs up.
export const promoteUsernameToAdmin = db.prepare(`UPDATE users SET is_admin = 1 WHERE username = ?`);
promoteUsernameToAdmin.run("adminjs");

db.exec("CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, created_at)");
db.exec("CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category_id, created_at)");
db.exec("CREATE INDEX IF NOT EXISTS idx_posts_board ON posts(board_id, created_at)");
db.exec("CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date, event_time)");

const seedCategory = db.prepare(`INSERT OR IGNORE INTO categories (slug, name, description) VALUES (?, ?, ?)`);
for (const [slug, name, description] of [
  ["question", "Question?", "Ask the community and find useful answers."],
  ["discussion", "Discussion", "Start a thoughtful conversation."],
  ["reflection", "Reflection", "Share ideas, lessons, and perspectives."],
  ["guide", "Guide", "Practical how-tos and explainers."],
  ["showcase", "Showcase", "Present work worth seeing."],
  ["review", "Review", "Consider and evaluate something closely."],
  ["hot-take", "Hot Take", "A concise, opinionated point of view."],
  ["announcements", "Announcements", "News and important updates."],
  ["others", "Others", "Everything that does not fit elsewhere."],
]) seedCategory.run(slug, name, description);

// --- users ---
export const insertUser = db.prepare(
  `INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)`
);
export const getUserByUsername = db.prepare(
  `SELECT * FROM users WHERE username = ?`
);
export const getUserById = db.prepare(`SELECT * FROM users WHERE id = ?`);
export const countUsers = db.prepare(`SELECT COUNT(*) AS n FROM users`);
export const getPublicUser = db.prepare(`
  SELECT users.id, users.username, users.created_at,
    (SELECT COUNT(*) FROM follows WHERE following_id = users.id) AS follower_count,
    (SELECT COUNT(*) FROM follows WHERE follower_id = users.id) AS following_count,
    (SELECT COALESCE(SUM(value), 0) FROM user_votes WHERE target_id = users.id) AS score,
    (SELECT COUNT(*) FROM posts WHERE user_id = users.id AND published = 1) AS post_count
  FROM users WHERE username = ?
`);
export const getFollow = db.prepare(`SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?`);
export const followUser = db.prepare(`INSERT OR IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)`);
export const unfollowUser = db.prepare(`DELETE FROM follows WHERE follower_id = ? AND following_id = ?`);
export const listFollowersForUser = db.prepare(`
  SELECT users.id, users.username, users.created_at,
    (SELECT COUNT(*) FROM follows WHERE following_id = users.id) AS follower_count,
    (SELECT COUNT(*) FROM follows WHERE follower_id = users.id) AS following_count,
    (SELECT COALESCE(SUM(value), 0) FROM user_votes WHERE target_id = users.id) AS score
  FROM follows JOIN users ON users.id = follows.follower_id
  WHERE follows.following_id = ? ORDER BY users.username COLLATE NOCASE ASC
`);
export const listFollowingForUser = db.prepare(`
  SELECT users.id, users.username, users.created_at,
    (SELECT COUNT(*) FROM follows WHERE following_id = users.id) AS follower_count,
    (SELECT COUNT(*) FROM follows WHERE follower_id = users.id) AS following_count,
    (SELECT COALESCE(SUM(value), 0) FROM user_votes WHERE target_id = users.id) AS score
  FROM follows JOIN users ON users.id = follows.following_id
  WHERE follows.follower_id = ? ORDER BY users.username COLLATE NOCASE ASC
`);
export const getUserVote = db.prepare(`SELECT value FROM user_votes WHERE voter_id = ? AND target_id = ?`);
export const setUserVote = db.prepare(`
  INSERT INTO user_votes (voter_id, target_id, value) VALUES (?, ?, ?)
  ON CONFLICT(voter_id, target_id) DO UPDATE SET value = excluded.value
`);
export const clearUserVote = db.prepare(`DELETE FROM user_votes WHERE voter_id = ? AND target_id = ?`);
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
  // A departing creator may own boards used by other authors. Detach those
  // posts and memberships before the user-row cascade removes the boards.
  const ownedBoards = db.query(`SELECT id FROM boards WHERE creator_id = ?`).all(userId);
  for (const board of ownedBoards) {
    db.prepare(`UPDATE posts SET board_id = NULL WHERE board_id = ?`).run(board.id);
    db.prepare(`DELETE FROM board_members WHERE board_id = ?`).run(board.id);
    db.prepare(`DELETE FROM boards WHERE id = ?`).run(board.id);
  }
  return deleteUser.run(userId);
});

// --- posts ---
export const insertPost = db.prepare(
  `INSERT INTO posts (user_id, slug, title, markdown, published, category_id, board_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
);
export const updatePost = db.prepare(`
  UPDATE posts SET title = ?, markdown = ?, category_id = ?, board_id = ?, updated_at = datetime('now')
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
  SELECT posts.*, users.username AS author_username, categories.name AS category_name,
    categories.slug AS category_slug, boards.name AS board_name, boards.slug AS board_slug,
    (SELECT COUNT(*) FROM post_likes WHERE post_id = posts.id) AS like_count
  FROM posts LEFT JOIN users ON users.id = posts.user_id
  LEFT JOIN categories ON categories.id = posts.category_id
  LEFT JOIN boards ON boards.id = posts.board_id WHERE posts.slug = ?
`);
export const listPostsForUser = db.prepare(
  `SELECT * FROM posts WHERE user_id = ? ORDER BY created_at DESC`
);
export const listPublishedPostsPage = db.prepare(
  `SELECT posts.*, users.username AS author_username, categories.name AS category_name,
   categories.slug AS category_slug, boards.name AS board_name, boards.slug AS board_slug,
   (SELECT COUNT(*) FROM post_likes WHERE post_id = posts.id) AS like_count
   FROM posts LEFT JOIN users ON users.id = posts.user_id
   LEFT JOIN categories ON categories.id = posts.category_id LEFT JOIN boards ON boards.id = posts.board_id
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
export const listProfilePosts = db.prepare(`
  SELECT posts.*, users.username AS author_username, categories.name AS category_name,
    categories.slug AS category_slug, boards.name AS board_name, boards.slug AS board_slug,
    (SELECT COUNT(*) FROM post_likes WHERE post_id = posts.id) AS like_count
  FROM posts JOIN users ON users.id = posts.user_id
  LEFT JOIN categories ON categories.id = posts.category_id LEFT JOIN boards ON boards.id = posts.board_id
  WHERE users.username = ? AND posts.published = 1 ORDER BY posts.created_at DESC
`);
export const listFollowingPosts = db.prepare(`
  SELECT posts.*, users.username AS author_username, categories.name AS category_name,
    categories.slug AS category_slug, boards.name AS board_name, boards.slug AS board_slug,
    (SELECT COUNT(*) FROM post_likes WHERE post_id = posts.id) AS like_count
  FROM follows JOIN posts ON posts.user_id = follows.following_id
  JOIN users ON users.id = posts.user_id
  LEFT JOIN categories ON categories.id = posts.category_id LEFT JOIN boards ON boards.id = posts.board_id
  WHERE follows.follower_id = ? AND posts.published = 1 ORDER BY posts.created_at DESC LIMIT ?
`);
export const getPostLike = db.prepare(`SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?`);
export const addPostLike = db.prepare(`INSERT OR IGNORE INTO post_likes (post_id, user_id) VALUES (?, ?)`);
export const removePostLike = db.prepare(`DELETE FROM post_likes WHERE post_id = ? AND user_id = ?`);

// --- categories and boards ---
export const listCategories = db.prepare(`
  SELECT categories.*, (SELECT COUNT(*) FROM posts WHERE category_id = categories.id AND published = 1) AS post_count
  FROM categories ORDER BY name
`);
export const getCategoryById = db.prepare(`SELECT * FROM categories WHERE id = ?`);
export const getCategoryBySlug = db.prepare(`SELECT * FROM categories WHERE slug = ?`);
export const listCategoryPosts = db.prepare(`
  SELECT posts.*, users.username AS author_username, categories.name AS category_name, categories.slug AS category_slug,
    boards.name AS board_name, boards.slug AS board_slug, (SELECT COUNT(*) FROM post_likes WHERE post_id = posts.id) AS like_count
  FROM posts JOIN users ON users.id = posts.user_id JOIN categories ON categories.id = posts.category_id
  LEFT JOIN boards ON boards.id = posts.board_id WHERE categories.slug = ? AND posts.published = 1 ORDER BY posts.created_at DESC
`);
export const insertBoard = db.prepare(`INSERT INTO boards (slug, name, description, creator_id) VALUES (?, ?, ?, ?)`);
export const listBoards = db.prepare(`
  SELECT boards.*, users.username AS creator_username,
    (SELECT COUNT(*) FROM board_members WHERE board_id = boards.id) AS member_count,
    (SELECT COUNT(*) FROM posts WHERE board_id = boards.id AND published = 1) AS post_count
  FROM boards JOIN users ON users.id = boards.creator_id ORDER BY boards.created_at DESC
`);
export const getBoardBySlug = db.prepare(`
  SELECT boards.*, users.username AS creator_username,
    (SELECT COUNT(*) FROM board_members WHERE board_id = boards.id) AS member_count
  FROM boards JOIN users ON users.id = boards.creator_id WHERE boards.slug = ?
`);
export const getBoardById = db.prepare(`SELECT * FROM boards WHERE id = ?`);
export const listBoardPosts = db.prepare(`
  SELECT posts.*, users.username AS author_username, categories.name AS category_name, categories.slug AS category_slug,
    boards.name AS board_name, boards.slug AS board_slug, (SELECT COUNT(*) FROM post_likes WHERE post_id = posts.id) AS like_count
  FROM posts JOIN users ON users.id = posts.user_id JOIN boards ON boards.id = posts.board_id
  LEFT JOIN categories ON categories.id = posts.category_id WHERE boards.slug = ? AND posts.published = 1 ORDER BY posts.created_at DESC
`);
export const getBoardMembership = db.prepare(`SELECT 1 FROM board_members WHERE board_id = ? AND user_id = ?`);
export const joinBoard = db.prepare(`INSERT OR IGNORE INTO board_members (board_id, user_id) VALUES (?, ?)`);
export const leaveBoard = db.prepare(`DELETE FROM board_members WHERE board_id = ? AND user_id = ?`);
export const searchBoards = db.prepare(`
  SELECT boards.*, users.username AS creator_username,
    (SELECT COUNT(*) FROM board_members WHERE board_id = boards.id) AS member_count,
    (SELECT COUNT(*) FROM posts WHERE board_id = boards.id AND published = 1) AS post_count
  FROM boards JOIN users ON users.id = boards.creator_id
  WHERE boards.name LIKE ? ESCAPE '\\' OR boards.description LIKE ? ESCAPE '\\'
  ORDER BY boards.created_at DESC
`);

// --- events ---
export const insertEvent = db.prepare(`
  INSERT INTO events (slug, creator_id, title, description, event_date, event_time, location, eligibility, capacity)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
export const setEventImage = db.prepare(`UPDATE events SET image_stem = ? WHERE id = ? AND creator_id = ?`);
export const listEvents = db.prepare(`
  SELECT events.*, users.username AS creator_username,
    (SELECT COUNT(*) FROM event_attendees WHERE event_id = events.id) AS attendee_count
  FROM events JOIN users ON users.id = events.creator_id ORDER BY events.event_date ASC, events.event_time ASC
`);
export const getEventBySlug = db.prepare(`
  SELECT events.*, users.username AS creator_username,
    (SELECT COUNT(*) FROM event_attendees WHERE event_id = events.id) AS attendee_count
  FROM events JOIN users ON users.id = events.creator_id WHERE events.slug = ?
`);
export const getEventAttendance = db.prepare(`SELECT 1 FROM event_attendees WHERE event_id = ? AND user_id = ?`);
export const listEventAttendees = db.prepare(`
  SELECT users.id, users.username, event_attendees.created_at
  FROM event_attendees JOIN users ON users.id = event_attendees.user_id
  WHERE event_attendees.event_id = ?
  ORDER BY event_attendees.created_at ASC, users.username ASC
`);
const countEventAttendees = db.prepare(`SELECT COUNT(*) AS n FROM event_attendees WHERE event_id = ?`);
const addEventAttendee = db.prepare(`INSERT OR IGNORE INTO event_attendees (event_id, user_id) VALUES (?, ?)`);
export const joinEventIfAvailable = db.transaction((eventId, userId) => {
  const event = db.query(`SELECT capacity FROM events WHERE id = ?`).get(eventId);
  if (!event) return false;
  if (event.capacity && countEventAttendees.get(eventId).n >= event.capacity) return false;
  addEventAttendee.run(eventId, userId);
  return true;
});
export const leaveEvent = db.prepare(`DELETE FROM event_attendees WHERE event_id = ? AND user_id = ?`);

// --- administrator content management ---
export const listPostsForAdmin = db.prepare(`
  SELECT posts.id, posts.title, posts.slug, posts.published, users.username AS author_username FROM posts
  LEFT JOIN users ON users.id = posts.user_id ORDER BY posts.created_at DESC
`);
export const insertCategory = db.prepare(`INSERT INTO categories (slug, name, description) VALUES (?, ?, ?)`);
const clearBoardFromPosts = db.prepare(`UPDATE posts SET board_id = NULL WHERE board_id = ?`);
const clearCategoryFromPosts = db.prepare(`UPDATE posts SET category_id = NULL WHERE category_id = ?`);
const deleteBoardMembers = db.prepare(`DELETE FROM board_members WHERE board_id = ?`);
const deleteBoard = db.prepare(`DELETE FROM boards WHERE id = ?`);
const deleteCategory = db.prepare(`DELETE FROM categories WHERE id = ?`);
const deleteEvent = db.prepare(`DELETE FROM events WHERE id = ?`);
const deleteAnyPost = db.prepare(`DELETE FROM posts WHERE id = ?`);
export const deleteBoardForAdmin = db.transaction((id) => { clearBoardFromPosts.run(id); deleteBoardMembers.run(id); return deleteBoard.run(id); });
export const deleteCategoryForAdmin = db.transaction((id) => { clearCategoryFromPosts.run(id); return deleteCategory.run(id); });
export const deleteEventForAdmin = db.prepare(`DELETE FROM events WHERE id = ?`);
export const deleteEventForCreator = db.prepare(`DELETE FROM events WHERE id = ? AND creator_id = ?`);
export const deletePostForAdmin = db.prepare(`DELETE FROM posts WHERE id = ?`);

// --- comments ---
export const insertComment = db.prepare(
  `INSERT INTO comments (post_id, user_id, author, body) VALUES (?, ?, ?, ?)`
);
export const listCommentsForPost = db.prepare(
  `SELECT comments.*, COALESCE(users.username, comments.author) AS username
   FROM comments LEFT JOIN users ON users.id = comments.user_id
   WHERE comments.post_id = ? ORDER BY comments.created_at ASC`
);
