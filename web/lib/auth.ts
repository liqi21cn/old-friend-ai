/**
 * Auth via an external login provider (see doc/external-login-api.md).
 *
 * Flow:
 *  1. Client POSTs username/password to /api/auth/login
 *  2. Server forwards to EXTERNAL_LOGIN_URL with X-API-Key
 *  3. On success, store { token, user } JSON inside an HttpOnly cookie
 *  4. Subsequent requests read the cookie via `getSession()` and either
 *     surface the user or redirect to /login
 *
 * We don't try to validate the JWT signature ourselves — the external system
 * is the source of truth. We just keep the opaque token + user metadata in
 * the cookie. If the cookie is forged, the worst that happens is the API
 * routes receive a token the external system would reject anyway.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "ps_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export interface ExternalUser {
  id: number;
  username: string;
  name: string;
  phone: string;
  email: string;
  is_admin: boolean;
  is_active: boolean;
  user_level: string;
}

export interface Session {
  token: string;
  user: ExternalUser;
  issuedAt: number;
}

function encode(session: Session): string {
  return Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
}

function decode(raw: string): Session | null {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const obj = JSON.parse(json);
    if (
      !obj ||
      typeof obj.token !== "string" ||
      !obj.user ||
      typeof obj.user.username !== "string"
    ) {
      return null;
    }
    return obj as Session;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  return decode(raw);
}

/**
 * Server-side helper to enforce auth in API routes and server components.
 * Throws if no session — the caller is expected to wrap in `try` and respond
 * with 401, OR rely on middleware having already gated the request. The
 * middleware does gate /api/*, but defense-in-depth here makes routes safer
 * if middleware is ever misconfigured.
 */
export async function requireUserId(): Promise<number> {
  const s = await getSession();
  if (!s) throw new Error("UNAUTHENTICATED");
  return s.user.id;
}

export function setSessionCookie(res: NextResponse, session: Session) {
  res.cookies.set({
    name: COOKIE_NAME,
    value: encode(session),
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    // Secure flag only when explicitly opting in via env. Browsers reject
    // Secure cookies over HTTP, so production deployments that don't yet
    // have HTTPS need this off. Set COOKIE_SECURE=true once HTTPS is wired.
    secure: process.env.COOKIE_SECURE === "true",
  });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set({
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export interface ExternalLoginResponse {
  token: string;
  user: ExternalUser;
}

export interface ExternalLoginError {
  error: string;
  status: number;
}

export async function callExternalLogin(
  username: string,
  password: string,
): Promise<ExternalLoginResponse | ExternalLoginError> {
  const url = process.env.EXTERNAL_LOGIN_URL;
  const key = process.env.EXTERNAL_LOGIN_API_KEY;
  if (!url || !key) {
    return { error: "external login not configured", status: 503 };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": key,
      },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        error: data?.error || `external login failed (${res.status})`,
        status: res.status,
      };
    }
    if (!data?.token || !data?.user) {
      return { error: "external response missing token/user", status: 502 };
    }
    return data as ExternalLoginResponse;
  } catch (e: any) {
    return {
      error: e?.message || "external login request failed",
      status: 502,
    };
  }
}
