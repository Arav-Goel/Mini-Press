// Run with `bun test`. Uses a scratch data dir so it never touches the
// real session secret / database.
import { test, expect, beforeAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeAll(() => {
  process.env.MINIPRESS_DATA_DIR = mkdtempSync(join(tmpdir(), "minipress-test-"));
});

const { hashPassword, verifyPassword, createSessionCookie, verifySessionCookie, csrfTokenFor, verifyCsrf } =
  await import("../src/auth.js");

test("hashPassword produces a distinct salt each call", () => {
  const a = hashPassword("correct horse battery staple");
  const b = hashPassword("correct horse battery staple");
  expect(a.salt).not.toBe(b.salt);
  expect(a.hash).not.toBe(b.hash); // different salt -> different hash even for same password
});

test("verifyPassword accepts the correct password and rejects a wrong one", () => {
  const { hash, salt } = hashPassword("hunter22");
  expect(verifyPassword("hunter22", hash, salt)).toBe(true);
  expect(verifyPassword("hunter23", hash, salt)).toBe(false);
});

test("session cookie round-trips a valid userId", () => {
  const cookie = createSessionCookie(42);
  const cookieHeader = cookie.split(";")[0]; // strip attributes, as a browser would send it back
  const session = verifySessionCookie(cookieHeader);
  expect(session).toEqual({ userId: 42 });
});

test("tampering with the signed payload invalidates the cookie", () => {
  const cookie = createSessionCookie(42);
  const [name, ...rest] = cookie.split(";")[0].split("=");
  const value = rest.join("=");
  const [payload, sig] = value.split(".");
  const tamperedPayload = Buffer.from('{"uid":999,"exp":9999999999999}').toString("base64url");
  const tampered = `${name}=${tamperedPayload}.${sig}`;
  expect(verifySessionCookie(tampered)).toBeNull();
});

test("missing cookie header returns null, not a throw", () => {
  expect(verifySessionCookie(null)).toBeNull();
  expect(verifySessionCookie(undefined)).toBeNull();
  expect(verifySessionCookie("")).toBeNull();
});

test("expired session is rejected", () => {
  // Construct a cookie with an already-past expiry by monkeypatching Date.now
  // is overkill here; instead we just check the exp field logic directly
  // via a manually built payload using the same encode/sign shape.
  const nowSpy = Date.now;
  Date.now = () => 1_000_000_000_000; // fixed point in the past relative to "later"
  const cookie = createSessionCookie(7);
  Date.now = () => 1_000_000_000_000 + 1000 * 60 * 60 * 24 * 30; // 30 days later
  const cookieHeader = cookie.split(";")[0];
  expect(verifySessionCookie(cookieHeader)).toBeNull();
  Date.now = nowSpy;
});

test("CSRF token is stable for the same session and rejects mismatches", () => {
  const cookie = createSessionCookie(5).split(";")[0];
  const token = csrfTokenFor(cookie);
  expect(token).toBeTruthy();
  expect(verifyCsrf(cookie, token)).toBe(true);
  expect(verifyCsrf(cookie, "wrong-token-entirely")).toBe(false);
  expect(verifyCsrf(cookie, "")).toBe(false);
});
