// Optional local bootstrap utility: `bun src/scripts/create-user.js alice hunter2`.
// The web sign-up page is the normal path; this is useful for local setup.

import { insertUser, getUserByUsername } from "../db.js";
import { hashPassword } from "../auth.js";

const [, , username, password] = process.argv;

if (!username || !password) {
  console.error("Usage: bun src/scripts/create-user.js <username> <password>");
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]{3,40}$/.test(username)) {
  console.error("Username must be 3–40 letters, numbers, underscores, or hyphens.");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}
if (getUserByUsername.get(username)) {
  console.error(`User "${username}" already exists.`);
  process.exit(1);
}

const { hash, salt } = hashPassword(password);
insertUser.run(username, hash, salt);
console.log(`Created user "${username}". Log in at /login.`);
