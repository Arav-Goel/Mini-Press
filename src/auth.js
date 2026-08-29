// auth.js — the "login system" package you'd normally npm install
// (passport, bcrypt, jsonwebtoken...) replaced with node:crypto, composed
// carefully, never inventing our own primitives.
//
// Passwords: scryptSync (memory-hard, purpose-built for password storage —
//   this is the stdlib's actual recommended password-hashing function,
//   not a bare SHA-256).
// Sessions: stateless, HMAC-SHA256-signed cookies. No session table, no
//   server-side session store to go stale — the cookie IS the session,
//   and it can't be forged without the server secret.
//
// Threat model (see README "Security notes" for the full version):
//   - Protects against: password DB theft (scrypt is slow to brute-force),
//     cookie tampering/forgery (HMAC), timing attacks on comparisons
//     (timingSafeEqual throughout).
//   - Does NOT protect against: XSS stealing a valid cookie (mitigate with
//     httpOnly, which we set), an attacker with server-side access to the
//     session secret file, or brute-forcing a weak admin password (no rate
//     limiting in this MVP — documented gap, see README).

import { scryptSync, randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";

const SECRET_PATH = `${process.env.MINIPRESS_DATA_DIR || "./data"}/.session-secret`;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function loadOrCreateSecret() {
  if (existsSync(SECRET_PATH)) return readFileSync(SECRET_PATH, "utf8").trim();
  const secret = randomBytes(32).toString("hex");
  writeFileSync(SECRET_PATH, secret, { mode: 0o600 });
  try { chmodSync(SECRET_PATH, 0o600); } catch { /* best-effort on non-POSIX */ }
  return secret;
}

const SECRET = loadOrCreateSecret();

// --- password hashing ---

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  const candidate = scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, "hex");
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

// --- base64url helpers (session payload encoding) ---

function b64urlEncode(str) {
  return Buffer.from(str, "utf8").toString("base64url");
}
function b64urlDecode(str) {
  return Buffer.from(str, "base64url").toString("utf8");
}

function sign(payloadB64) {
  return createHmac("sha256", SECRET).update(payloadB64).digest("base64url");
}

// --- session cookies ---

export function createSessionCookie(userId) {
  const payload = JSON.stringify({ uid: userId, exp: Date.now() + SESSION_TTL_MS });
  const payloadB64 = b64urlEncode(payload);
  const sig = sign(payloadB64);
  const value = `${payloadB64}.${sig}`;
  // httpOnly: JS can't read it (XSS mitigation). SameSite=Lax: basic CSRF
  // mitigation for the cookie itself. Secure omitted here so it also works
  // over plain http://localhost in local dev — flip it on behind real TLS.
  return `mp_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export function clearSessionCookie() {
  return `mp_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

// Returns { userId } if the cookie is present, correctly signed, and not
// expired. Returns null otherwise — callers treat null as "not logged in".
export function verifySessionCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/mp_session=([^;]+)/);
  if (!match) return null;
  const [payloadB64, sig] = match[1].split(".");
  if (!payloadB64 || !sig) return null;

  const expectedSig = sign(payloadB64);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(b64urlDecode(payloadB64));
    if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
    return { userId: payload.uid };
  } catch {
    return null;
  }
}

// --- CSRF token, derived from the session (double-submit style) ---
// A form on an authenticated page embeds this token; on submit we recompute
// it from the request's own session cookie and compare. An attacker who
// can't read the httpOnly cookie can't produce a matching token.

export function csrfTokenFor(cookieHeader) {
  const session = verifySessionCookie(cookieHeader);
  if (!session) return null;
  return createHmac("sha256", SECRET).update(`csrf:${session.userId}`).digest("hex");
}

export function verifyCsrf(cookieHeader, submittedToken) {
  const expected = csrfTokenFor(cookieHeader);
  if (!expected || !submittedToken) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(submittedToken);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
