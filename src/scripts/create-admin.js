// create-admin.js — run once: `bun src/scripts/create-admin.js alice hunter2`
// This is dev tooling, not part of the served runtime artifact, but it's
// still plain stdlib (node:crypto via auth.js) — no CLI framework used,
// just process.argv.

import { insertUser, getUserByUsername } from "../db.js";
import { hashPassword } from "../auth.js";

const [, , username, password] = process.argv;

if (!username || !password) {
  console.error("Usage: bun src/scripts/create-admin.js <username> <password>");
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
console.log(`Created admin user "${username}". Log in at /admin/login.`);
