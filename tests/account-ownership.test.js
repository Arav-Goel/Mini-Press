import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Set this before importing db.js, which opens SQLite at module load.
process.env.MINIPRESS_DATA_DIR = mkdtempSync(join(tmpdir(), "minipress-accounts-"));

const db = await import("../src/db.js");
const { hashPassword } = await import("../src/auth.js");

async function createUser(username) {
  const hash = await hashPassword("password-123");
  return Number(db.insertUser.run(username, hash).lastInsertRowid);
}

test("the current schema uses Bun.password hashes and body_markdown", () => {
  const userColumns = db.db.query("PRAGMA table_info(users)").all().map((column) => column.name);
  const postColumns = db.db.query("PRAGMA table_info(posts)").all().map((column) => column.name);

  expect(userColumns).toContain("password_hash");
  expect(userColumns).not.toContain("salt");
  expect(postColumns).toContain("body_markdown");
  expect(postColumns).toContain("cover_image");
});

test("posts belong to one account and cannot be changed by another", async () => {
  const arav = await createUser("arav");
  const moksh = await createUser("moksh");
  const postId = Number(db.insertPost.run(arav, "owned-post", "Owned post", "body", 0).lastInsertRowid);

  expect(db.getPostByIdForUser.get(postId, arav).title).toBe("Owned post");
  expect(db.getPostByIdForUser.get(postId, moksh)).toBeNull();
  expect(db.updatePost.run("Changed", "body", postId, moksh).changes).toBe(0);
  expect(db.getPostByIdForUser.get(postId, arav).title).toBe("Owned post");
});

test("comments retain the authenticated account identity", async () => {
  const author = await createUser("author");
  const commenter = await createUser("commenter");
  const postId = Number(db.insertPost.run(author, "commented-post", "Commented post", "body", 1).lastInsertRowid);

  db.insertComment.run(postId, commenter, "commenter", "A signed-in comment");
  const comment = db.listCommentsForPost.all(postId)[0];
  expect(comment.user_id).toBe(commenter);
  expect(comment.username).toBe("commenter");
});
