// router.js — a ~40-line replacement for express/hono/itty-router.
// Built on nothing but URLPattern (Web-standard API, listed as a Bun 1.4
// global built-in per the cheat sheet) and Array.prototype. This is the
// whole "routing framework". Note: URLPattern is NOT global in the Node
// version this codebase was developed against (v22.22.2, no flag makes it
// available) — this module is Bun-only by design, matching package.json's
// engines.bun requirement. If porting to plain Node, swap URLPattern for
// a small hand-rolled `:param` matcher instead.

export class Router {
  #routes = [];

  #add(method, pattern, handler) {
    // URLPattern gives us :param matching for free — no path-to-regexp needed.
    const compiled = new URLPattern({ pathname: pattern });
    this.#routes.push({ method, compiled, handler });
    return this;
  }

  get(pattern, handler) { return this.#add("GET", pattern, handler); }
  post(pattern, handler) { return this.#add("POST", pattern, handler); }

  // Matches a request to a handler. Returns a Response, or null if nothing matched
  // (caller is expected to fall back to a 404).
  async handle(req, ctx) {
    const url = new URL(req.url);
    for (const route of this.#routes) {
      if (route.method !== req.method) continue;
      const match = route.compiled.exec({ pathname: url.pathname });
      if (!match) continue;
      const params = {};
      for (const [key, value] of Object.entries(match.pathname.groups)) {
        params[key] = value;
      }
      return route.handler(req, { ...ctx, params, url });
    }
    return null;
  }
}
