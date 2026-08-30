import { test, expect } from "bun:test";
import { Router } from "../src/router.js";

test("matches an exact path", async () => {
  const router = new Router();
  router.get("/", async () => new Response("home"));
  const res = await router.handle(new Request("http://x/"), {});
  expect(await res.text()).toBe("home");
});

test("extracts a single :param", async () => {
  const router = new Router();
  router.get("/post/:slug", async (req, { params }) => new Response(params.slug));
  const res = await router.handle(new Request("http://x/post/hello-world"), {});
  expect(await res.text()).toBe("hello-world");
});

test("respects HTTP method", async () => {
  const router = new Router();
  router.get("/thing", async () => new Response("get"));
  router.post("/thing", async () => new Response("post"));
  const getRes = await router.handle(new Request("http://x/thing", { method: "GET" }), {});
  const postRes = await router.handle(new Request("http://x/thing", { method: "POST" }), {});
  expect(await getRes.text()).toBe("get");
  expect(await postRes.text()).toBe("post");
});

test("returns null when nothing matches, instead of throwing", async () => {
  const router = new Router();
  router.get("/only-this", async () => new Response("ok"));
  const res = await router.handle(new Request("http://x/nothing-here"), {});
  expect(res).toBeNull();
});

test("multiple params in one path", async () => {
  const router = new Router();
  router.post("/account/posts/:id/publish", async (req, { params }) => new Response(params.id));
  const res = await router.handle(new Request("http://x/account/posts/42/publish", { method: "POST" }), {});
  expect(await res.text()).toBe("42");
});
