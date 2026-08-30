import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Set this before importing db.js, which opens SQLite at module load.
process.env.MINIPRESS_DATA_DIR = mkdtempSync(join(tmpdir(), "minipress-accounts-"));

const db = await import("../src/db.js");
const { hashPassword } = await import("../src/auth.js");

function createUser(username) {
  const { hash, salt } = hashPassword("password-123");
  return Number(db.insertUser.run(username, hash, salt).lastInsertRowid);
}

test("posts belong to one account and cannot be changed by another", () => {
  const arav = createUser("arav");
  const moksh = createUser("moksh");
  const postId = Number(db.insertPost.run(arav, "owned-post", "Owned post", "body", 0, null, null).lastInsertRowid);

  expect(db.getPostByIdForUser.get(postId, arav).title).toBe("Owned post");
  expect(db.getPostByIdForUser.get(postId, moksh)).toBeNull();
  expect(db.updatePost.run("Changed", "body", null, null, postId, moksh).changes).toBe(0);
  expect(db.getPostByIdForUser.get(postId, arav).title).toBe("Owned post");
  expect(db.getPostBySlug.get("owned-post").author_username).toBe("arav");
});

test("comments retain the authenticated account identity", () => {
  const author = createUser("author");
  const commenter = createUser("commenter");
  const postId = Number(db.insertPost.run(author, "commented-post", "Commented post", "body", 1, null, null).lastInsertRowid);

  db.insertComment.run(postId, commenter, "commenter", "A signed-in comment");
  const comment = db.listCommentsForPost.all(postId)[0];
  expect(comment.user_id).toBe(commenter);
  expect(comment.username).toBe("commenter");
});

test("adminjs is the only predesignated administrator and user deletion removes authored content", () => {
  const admin = createUser("adminjs");
  const member = createUser("member-to-delete");
  db.promoteUsernameToAdmin.run("adminjs");
  const postId = Number(db.insertPost.run(member, "deleted-member-post", "Delete me", "body", 1, null, null).lastInsertRowid);
  db.insertComment.run(postId, member, "member-to-delete", "My comment");

  expect(db.getUserById.get(admin).is_admin).toBe(1);
  expect(db.deleteUserAndContent(member).changes).toBe(1);
  expect(db.getUserById.get(member)).toBeNull();
  expect(db.getPostById.get(postId)).toBeNull();
  expect(db.deleteUserAndContent(admin).changes).toBe(0);
});

test("published posts can be paginated independently from drafts", () => {
  const user = createUser("publisher");
  const before = Number(db.countPublishedPosts.get().n);
  for (let i = 0; i < 6; i++) {
    db.insertPost.run(user, `page-post-${i}`, `Page post ${i}`, "published body", 1, null, null);
  }
  db.insertPost.run(user, "hidden-draft", "Hidden draft", "draft body", 0, null, null);

  const total = before + 6;
  expect(db.countPublishedPosts.get().n).toBe(total);
  expect(db.listPublishedPostsPage.all(5, 0)).toHaveLength(Math.min(5, total));
  expect(db.listPublishedPostsPage.all(5, 5)).toHaveLength(Math.min(5, total - 5));
});

test("social relationships, reputation, categories, boards, and likes persist by identity", () => {
  const author = createUser("social-author");
  const reader = createUser("social-reader");
  const category = db.getCategoryBySlug.get("technology");
  const boardId = Number(db.insertBoard.run("test-board", "Test board", "A test community", author).lastInsertRowid);
  const postId = Number(db.insertPost.run(author, "social-post", "Social post", "body", 1, category.id, boardId).lastInsertRowid);

  db.followUser.run(reader, author);
  db.setUserVote.run(reader, author, 1);
  db.joinBoard.run(boardId, reader);
  db.addPostLike.run(postId, reader);

  const profile = db.getPublicUser.get("social-author");
  expect(profile.follower_count).toBe(1);
  expect(profile.score).toBe(1);
  expect(db.listFollowingPosts.all(reader, 10)[0].id).toBe(postId);
  expect(db.listCategoryPosts.all("technology").some((post) => post.id === postId)).toBe(true);
  expect(db.listBoardPosts.all("test-board")[0].like_count).toBe(1);
  expect(db.getBoardMembership.get(boardId, reader)).toBeTruthy();
});
