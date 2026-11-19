import { createHmac, timingSafeEqual } from "node:crypto";

/** Signed, expiring tokens for sign-in links and sessions. Stateless: the signature is the proof. */

export type TokenPurpose = "login" | "session";

export const LOGIN_TTL_SECONDS = 20 * 60;
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

interface Payload {
  p: TokenPurpose;
  e: string;
  x: number;
}

const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64url");

export function createToken(purpose: TokenPurpose, email: string, secret: string, ttlSeconds: number, now = Date.now()): string {
  const payload: Payload = { p: purpose, e: email.trim().toLowerCase(), x: Math.floor(now / 1000) + ttlSeconds };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(`${purpose}.${body}`, secret)}`;
}

/** The token's email when it's valid, unexpired and for this purpose; otherwise null. */
export function verifyToken(
  token: string | null | undefined,
  purpose: TokenPurpose,
  secret: string,
  now = Date.now(),
): { email: string } | null {
  if (!token) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(`${purpose}.${body}`, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<Payload>;
    if (payload.p !== purpose || typeof payload.e !== "string" || typeof payload.x !== "number") return null;
    return payload.x > Math.floor(now / 1000) ? { email: payload.e } : null;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = "se_session";

export function sessionCookie(token: string | null, secure: boolean): string {
  const parts = [`${SESSION_COOKIE}=${token ?? ""}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${token ? SESSION_TTL_SECONDS : 0}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function readCookie(header: string | null, name: string): string | null {
  for (const part of header?.split(";") ?? []) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}
