# mini-press

A tiny social publishing platform. Create an account, write posts in Markdown, upload a cover photo that
gets auto-resized, publish, readers comment, everyone gets an RSS feed, and
the editor shows a live preview as you type — all on **one runtime, zero
installed packages**.

Track F (Open/Wildcard). Built on **Bun** (bun.sh), because Bun 1.4 ships
enough built-in machinery — SQLite, image resizing, a web server, WebSockets —
to make this realistic without a single `bun install`.

## Run it

You need **Bun >= 1.4.0**. Install it once from https://bun.sh (that's the
*runtime*, not a dependency of the project — same category as installing
Node or Python itself).

```bash
# 1. start the server
make run
# then create an account at http://localhost:3000/signup

# 2. open it
# public site:  http://localhost:3000
# account signup: http://localhost:3000/signup
```

Run the tests: `make test` (or `bun test`).

## What it actually does

- **Accounts** — anyone can sign up and log in; passwords are hashed with Bun's built-in `Bun.password`, and sessions are
  a signed cookie (no session database table needed).
- **Write a post** — every post belongs to its author, and Markdown is rendered live in a side panel
  as you type, via a WebSocket round-trip to the server.
- **Upload a cover photo** — dropped into the post form, resized server-side
  into thumbnail / medium / large `.webp` variants.
- **Publish** — flips a post from draft to live on the public site.
- **Readers comment** — only signed-in accounts can comment, always under their account name.
- **RSS feed** — `/feed.xml`, works in any real feed reader.
- **Persistence** — everything lives in a real SQLite file (`data/minipress.sqlite`),
  survives restarts.

## What it deliberately doesn't do (be honest about limits)

- **This branch has a breaking password migration.** Existing scrypt-hashed
  accounts cannot log in after moving to `Bun.password`; recreate or reset
  those accounts from the SQLite backup made before the migration.

- **No roles or moderation tools.** Every account can create its own posts;
  there is no privileged administrator role.
- **No comment moderation queue.** Comments post immediately, no spam
  filter, no approve/reject UI. If you ship this for real, add a
  `comments.approved` flag and gate the public view on it — the column
  layout in `src/db.js` was left easy to extend that way.
- **No password reset / email at all.** There is no email sending anywhere
  in this project (nothing in any language's standard library sends email
  without a package — see STDLIB.md). Forgot your password: reset it
  directly in the SQLite file, or create another account through the signup page.
- **No rate limiting on login or signup.** A determined attacker can brute-force an
  account password with unlimited attempts. Fine for a hackathon demo behind
  a strong password; not fine for a real deployment — add a login attempt
  counter before you'd trust this with real user data.
- **http, not https, out of the box.** `Bun.serve()` here isn't wired to
  TLS. Put it behind a reverse proxy (Caddy, nginx) for real deployment, or
  see Bun's docs for passing TLS options directly to `Bun.serve`.
- **Markdown is a hand-rolled subset**, not full CommonMark. No tables, no
  nested lists, no footnotes. It covers what most blog posts actually need
  (headers, bold/italic, links, images, code blocks, quotes, lists) and
  every user-supplied character is HTML-escaped before it touches the page
  — that escaping is deliberately non-negotiable, see `src/markdown.js`.

## Concurrency model (Track C-style honesty, applied here too)

Bun's request handler runs on one JS thread per process, same event-loop
model as Node: I/O (database reads, file reads, network) doesn't block
other in-flight requests, but CPU-bound work briefly does. The place that
matters here is **image encoding** during upload — resizing a large photo
will pause other requests for the duration of that encode. For a
single-author blog this is a non-issue; if you wanted this to serve real
concurrent traffic during uploads, the fix is moving image processing to a
Worker (Bun supports `Worker` natively) so it doesn't share the main
thread's event loop.

## Durability (Track D-style honesty, applied here too)

SQLite is opened in **WAL mode** (`PRAGMA journal_mode = WAL`). That means:
writes are appended to a `-wal` file and only periodically checkpointed
into the main database file, so a crash mid-write doesn't corrupt existing
data — SQLite replays the WAL on next open. Uploaded images are written with
`Bun.write()`, which is not explicitly `fsync`'d in this codebase; on a real
crash (not just a process restart) a very recently uploaded image variant
could theoretically be lost even though the database row referencing it
survived. Documented, not hidden.

## Security notes (threat model)

**What this defends against:**
- **SQL injection** — every query in `src/db.js` uses parameterized
  statements (`?` placeholders), never string concatenation.
- **XSS** — every piece of user-supplied text (post titles, markdown
  content, comment author/body) is HTML-escaped before rendering. The
  markdown renderer escapes first, then applies formatting — raw HTML in a
  post body or comment can never execute as HTML.
- **Password cracking if the DB leaks** — passwords are hashed with Bun's
  built-in password API, never stored in plaintext or behind a fast hash
  like bare SHA-256.
- **Cookie forgery/tampering** — session cookies are HMAC-SHA256 signed
  with a server-only secret generated on first run
  (`data/.session-secret`, `chmod 600`). A forged or edited cookie fails
  signature verification and is treated as logged-out.
- **CSRF** on state-changing account actions and comments — a token derived from the
  session (via HMAC) is embedded in every form and re-verified on submit.
- **Path traversal** on the `/uploads/:filename` route — filenames
  containing `..` or `/` are rejected before touching the filesystem.
- **Timing attacks** on all secret comparisons (password hash, session
  signature, CSRF token) — `crypto.timingSafeEqual` throughout, never `===`
  on secret material.

**What this does NOT defend against** (documented, not silently absent):
- Login brute-forcing (no rate limit — see above).
- XSS via a compromised session secret file or server-level access.
- Anything requiring HTTPS in transit — that's the deploy environment's job.
- Large-file DoS on image upload — there's no upload size cap in this MVP.
  Add one (check `Content-Length` / stream size before decoding) before
  exposing this publicly.

## Project layout

```
mini-press/
  src/
    server.js      entry point: routes + auth checks + wiring
    router.js       tiny URLPattern-based router (~40 lines)
    db.js            bun:sqlite schema + queries
    auth.js           password hashing, signed sessions, CSRF
    markdown.js        hand-rolled markdown -> HTML renderer
    images.js           Bun.Image resize pipeline
    rss.js               hand-rolled RSS 2.0 XML
    render.js             HTML page templates (template literals)
    scripts/create-user.js
  public/
    site.css, account.css, editor.js (live preview client)
  tests/            bun:test suites for markdown, auth, rss, router
  data/             created at runtime: sqlite db + uploaded images (gitignored)
  README.md, STDLIB.md, CLAUDE.md, Makefile, package.json, deps-proof.txt
```

## The image API — now verified against real Bun docs, not guessed

`src/images.js` was originally written blind (no Bun runtime in the dev
sandbox) and shipped with a wrong guess at the `Bun.Image` call shape —
it failed on first run with `Bun.Image.decode is not a function`. That's
been fixed and re-verified against the official docs at
https://bun.com/docs/runtime/image and https://bun.com/blog/bun-v1.3.14.
The real API is a chainable pipeline from a constructor:

```js
await new Bun.Image(buffer)
  .resize(width, undefined, { fit: "inside", withoutEnlargement: true })
  .webp({ quality: 82 })
  .write(path);
```

`verifyImageSupport()` still runs a real 1x1-PNG round-trip through that
exact chain at server boot, so if Bun's API moves again in some future
version, you get a clear error at startup instead of a silent broken
upload. If it ever throws, `pipeline()` and `resizeStep()` near the top of
`src/images.js` are the two functions to check.
