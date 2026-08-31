# Mini-press

> A full social publishing platform built with Bun and platform APIs—zero
> installed dependencies.

Mini-press is a real community product, not a minimal proof-of-concept. People
can create accounts, publish Markdown writing, join boards, follow and vote on
profiles, RSVP to events, and subscribe through RSS. It includes persistent
SQLite data, image processing, signed sessions, CSRF protection, and live
WebSocket previews—all without `npm install`.

> **Zero Dependency Hackathon — Track F (Open/Wildcard)**
>
> **Bonus claim: 20+ library replacements.** A typical version of this product
> would install a framework, router, ORM, auth/session packages, Markdown and
> image tooling, a WebSocket library, an RSS generator, and a test runner.
> Mini-press replaces 20+ such categories with Bun/JavaScript built-ins or
> compact, project-owned code. See [STDLIB.md](STDLIB.md) for the audited
> dependency ledger.

## Run it

### Prerequisite

- [Bun](https://bun.sh) **1.4.0 or newer**. Bun is the runtime, not a project
  dependency, so do **not** run `bun install`.

### One command

```bash
make run
```

Open <http://localhost:3000>. A populated, sanitized demo database is included
for immediate exploration; create another account at
<http://localhost:3000/signup> to test the full writing flow. Pointing
`MINIPRESS_DATA_DIR` to a new directory creates an independent SQLite
database, upload directory, and local session-signing secret automatically.

Useful commands:

```bash
make test      # run the built-in Bun test suite
make proof     # regenerate the zero-dependency proof
make dev       # restart automatically while editing source
```

Configuration is optional:

| Variable | Default | Use |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listen port |
| `SITE_URL` | `http://localhost:$PORT` | Canonical URL used in RSS links |
| `MINIPRESS_DATA_DIR` | `./data` | Database, upload, and session-secret directory |

For example: `PORT=8787 SITE_URL=https://press.example.com make run`.

## What is included

- **Accounts and ownership.** Anyone can sign up and log in. Posts, comments,
  likes, follows, votes, board membership, and event attendance are tied to an
  authenticated account—not an editable display-name field.
- **Writing workflow.** Authors create drafts, edit or delete only their own
  posts, select a category and board, upload a cover image, and publish. The
  editor sends Markdown over a WebSocket for a live server-rendered preview.
- **Discovery.** The home feed has post search and five-post pagination.
  Posts show a cover thumbnail, author, category/board, reading-time estimate,
  likes, and share controls.
- **Community.** Public profiles show reputation and totals. Follow/following
  lists are opened deliberately by clicking their counts; member cards link
  back to public profiles. Following feed, up/down votes, and contributor
  badges make activity visible.
- **Boards and categories.** Users can create, join, and search boards by
  name or description. Posts can be grouped under the nine seeded categories:
  Question?, Discussion, Reflection, Guide, Showcase, Review, Hot Take,
  Announcements, and Others.
- **Events.** Signed-in users can host dated events with a location,
  eligibility, optional capacity, and image. RSVPs are capacity-safe,
  attendee lists are public, and creators can delete their own events.
- **Administration.** The account named `adminjs` is promoted to site admin.
  It can manage users, posts, boards, categories, and events. This is an
  explicit role, not a hidden first-user rule.
- **Five visual themes.** Light, dark, a purple futuristic grid theme, an
  environmental editorial theme, and a dark marine Ocean theme are available
  from the persistent theme toggle.
- **RSS.** `/feed.xml` provides a standards-friendly feed of published posts.

## Judge quick-start

```bash
make proof  # verifies the empty dependency maps and absence of install artifacts
make test   # runs the built-in test suite
make run    # starts the complete application
```

Then open the app, create a second account, and use the demo flow below. No
package installation, API key, hosted database, or background service is
required.

## Architecture at a glance

| Concern | Implementation |
| --- | --- |
| Server and WebSockets | `Bun.serve()` in `src/server.js` |
| Routes | a small `URLPattern` router in `src/router.js` |
| Persistence | `bun:sqlite` with WAL mode in `src/db.js` |
| Passwords and sessions | `node:crypto` scrypt + HMAC-signed HTTP-only cookies |
| CSRF | HMAC token derived from the authenticated session |
| HTML | template literals with explicit escaping in `src/render.js` |
| Markdown | hand-written, XSS-safe subset renderer in `src/markdown.js` |
| Images | `Bun.Image` resize → WebP pipeline in `src/images.js` |
| Tests | Bun's built-in `bun:test` runner |

## Project layout

```text
src/
  server.js       routes, auth checks, static files, and WebSocket preview
  db.js           SQLite schema, migrations, prepared queries, transactions
  auth.js         scrypt passwords, signed sessions, CSRF validation
  render.js       escaped HTML template literals
  markdown.js     hand-written Markdown subset and safe HTML escaping
  images.js       Bun.Image smoke test and WebP variants
  rss.js          RSS 2.0 XML generation
  router.js       minimal URLPattern route dispatcher
public/           CSS plus browser-side editor/theme/social enhancements
tests/            built-in Bun tests for auth, ownership, Markdown, RSS, routes
data/             checkpointed demo database and uploads; local runtime state ignored
```

### Demo data and local state

The checked-in `data/minipress.sqlite` and image variants are deliberate demo
assets, not a hosted service or a package dependency. They only contain
hackathon demonstration content. SQLite's `-wal` and `-shm` sidecars are
runtime-only files and are intentionally ignored: committing or replacing them
while Bun has the database open can cause macOS `SQLITE_IOERR_VNODE` errors.
`data/.session-secret` is also ignored, so every installation gets its own
signing key. To start with an empty site, point `MINIPRESS_DATA_DIR` at a new
directory.

## Security and correctness choices

- SQL uses prepared statements throughout; no user value is concatenated into
  a query.
- Passwords use a fresh random salt and `scryptSync`; comparisons use
  `timingSafeEqual`.
- Sessions are HMAC-SHA256 signed, seven-day, `HttpOnly`, and `SameSite=Lax`.
  State-changing forms are CSRF checked.
- User content is escaped before Markdown formatting. Raw HTML never executes.
- Upload names are generated by the server, and the upload route rejects path
  traversal patterns.
- Event capacity is enforced in a SQLite transaction, not merely in the UI.
- SQLite runs in WAL mode. A crash can lose a just-written image variant
  because image writes are not explicitly `fsync`ed, but the database remains
  recoverable through normal WAL replay.

## Honest limits

Mini-press is ready for a hackathon demo and local use, not a hardened public
hosting service. Before internet-facing deployment, add:

- HTTPS and a `Secure` session-cookie flag (use a reverse proxy or Bun TLS);
- rate limiting and abuse/moderation tools for authentication, comments, and
  uploads;
- upload size/type limits and asynchronous image work for large files;
- password reset/email verification and account recovery;
- a fuller CommonMark implementation if your audience needs tables, nested
  lists, footnotes, or other unsupported syntax;
- a multi-process deployment strategy. SQLite WAL works well for this one
  process, but it is not a distributed database.

## Concurrency model

`Bun.serve()` handles requests asynchronously on one JavaScript event loop.
Network/file waiting does not block unrelated requests; synchronous SQLite
queries and CPU work do. The `Bun.Image` pipeline is explicitly smoke-tested at
boot and the image API performs its image work outside normal JS execution,
but large uploads still deserve queuing or a worker in a production service.

## Zero-dependency proof

`package.json` deliberately contains:

```json
"dependencies": {},
"devDependencies": {}
```

There is no lockfile and no `node_modules` directory in the shipped project.
The repository includes a demo SQLite dataset and images so judges can explore
the product immediately. `data/.session-secret` is excluded because it is
generated per installation and signing material must not be public.

Run `make proof` immediately before submission to regenerate
[deps-proof.txt](deps-proof.txt) from the real manifest and checkout. The full
replacement inventory—and the 20+ replacement bonus claim—is documented in
[STDLIB.md](STDLIB.md).

## Suggested five-minute demo

1. Show `package.json`, `deps-proof.txt`, and [STDLIB.md](STDLIB.md), then run
   `make test` and `make run`.
3. Sign up, create a Markdown draft, watch live preview, add a cover image,
   choose a category/board, and publish it.
4. In a second account, follow the author, vote, like, and comment; show the
   following feed and profile list links.
5. Create an event, RSVP from the other account, and show the attendee list.
6. Sign in as `adminjs` and show user/content moderation.

## License

MIT. See [LICENSE](LICENSE).
