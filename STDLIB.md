# STDLIB.md — the dependency ledger

Mini-press intentionally ships with an empty `dependencies` and
`devDependencies` manifest. This is not source copied from third-party
libraries: the small replacements below were written for this project using
Bun and JavaScript platform APIs.

| What a typical app installs | Built-in or handwritten replacement | Where | Trade-off / rationale |
| --- | --- | --- |
| Express, Fastify, Hono | `Bun.serve()` | `src/server.js` | Bun handles HTTP and WebSockets natively. We own route composition, error policy, and operational limits instead of inheriting a framework. |
| `path-to-regexp`, `itty-router` | `URLPattern` + 39-line router | `src/router.js` | Web-standard matching and named parameters, with no route middleware abstraction. |
| `better-sqlite3`, Prisma, an ORM | `bun:sqlite` + prepared SQL | `src/db.js` | Bun's built-in embedded database gives real persistence and transactions. Queries are explicit and synchronous rather than ORM-generated. |
| `bcrypt`, `argon2` | `node:crypto` `scryptSync` | `src/auth.js` | scrypt is memory-hard and standard-library available. Argon2 would be stronger in some deployments but would violate the empty-manifest rule here. |
| Passport, `express-session`, Redis session store | signed HMAC cookie | `src/auth.js` | Stateless seven-day session cookie avoids a session table/service. It cannot be centrally revoked without rotating the local signing secret. |
| `jsonwebtoken` | `createHmac("sha256")` + base64url payload | `src/auth.js` | There is no algorithm field or external JWT parser; only this app's HMAC format is accepted. The format is intentionally narrow. |
| `csurf` | HMAC-derived per-session CSRF token | `src/auth.js`, form renderers | Every state-changing form submits a value recomputed from the signed cookie. This covers browser form CSRF, not a general API-token scheme. |
| `marked`, `markdown-it`, `remark` | hand-written Markdown parser | `src/markdown.js` | A small, test-covered subset supports the writing UI and escapes before rendering. It is deliberately not full CommonMark. |
| EJS, Pug, Handlebars | template literals + `escapeHtml()` | `src/render.js` | The project owns escaping discipline. This is concise but demands care at every interpolation site. |
| Sharp, Jimp | `Bun.Image` | `src/images.js` | Built-in decode, resize, and WebP encoding create three variants. A boot smoke test catches an unavailable/changed image API early. |
| Multer, Formidable | Fetch `Request.formData()` | `src/server.js` | Bun parses multipart fields and files directly. Application code still needs future size/type limits. |
| `cookie` | narrow cookie-header regex | `src/auth.js` | Only one signed cookie is needed. A full RFC cookie parser would be needless surface area here. |
| `ws`, Socket.IO | Bun WebSocket upgrade + native WebSocket | `src/server.js`, `public/editor.js` | A tiny WebSocket endpoint carries Markdown to the server for preview. No rooms, reconnect protocol, or message broker. |
| `feed`, `rss` | hand-written XML + `Date#toUTCString()` | `src/rss.js` | The app emits RSS 2.0 with explicit XML escaping and CDATA. There is no dependency-free RSS builder to hide behind. |
| `slugify` | small local `slugify()` function | `src/server.js` | Enough for current ASCII titles. It needs a collision strategy and Unicode policy before large-scale use. |
| Lodash / date helper for reading time | plain JS word count and `Math.ceil` | `src/render.js` | A transparent 200 words/minute estimate; it is approximate by design. |
| Nodemon | `bun --watch` | `package.json`, `Makefile` | Bun provides the development restart loop itself. |
| Jest, Vitest, Mocha | `bun:test` | `tests/` | Built into Bun; no dev dependency or separate test runner is installed. |
| `dotenv` | environment variables supplied by shell | `src/server.js`, README | `PORT`, `SITE_URL`, and `MINIPRESS_DATA_DIR` work without a config loader. |

## Built-in APIs that make the project viable

- `bun:sqlite` is a Bun runtime API, permitted by the hackathon's explicit
  Bun-built-in ruling. It provides the persistent store, prepared statements,
  foreign keys, WAL mode, and capacity transaction.
- `Bun.Image` is likewise a Bun runtime API, not a native package dependency.
  Its self-test runs before the HTTP server starts so the demo fails clearly
  instead of failing on the first upload.
- `Bun.serve`, `Bun.file`, `Bun.write`, WebSocket upgrade support, and Fetch
  `Request.formData()` replace the usual HTTP/upload/WebSocket stack.
- `node:crypto`, `node:fs`, `node:os`, and `node:path` are standard runtime
  modules. They supply password/session primitives, filesystem handling, and
  isolated test data directories.

## Deliberate gaps

- **Email/password recovery:** no email provider or SMTP client is added.
- **Full CommonMark:** nested/complex syntax remains intentionally unsupported.
- **Login rate limits and moderation:** not appropriate to hand-wave into a
  public internet deployment; they remain documented future work.
- **Upload limits and distributed storage:** local files are right for this
  standalone demo, not for unbounded files or many application instances.
- **Cookie revocation:** sessions are stateless; rotating `data/.session-secret`
  invalidates all sessions.

## Submission proof

Run `make proof` to regenerate [deps-proof.txt](deps-proof.txt). A judge can
confirm the constraint in seconds: `package.json` has empty dependency maps,
and the project ships no lockfile or `node_modules` directory.
