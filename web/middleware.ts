/**
 * Auth gate. Block every request unless:
 *  - it's a public path (/login, /api/auth/*)
 *  - or the user has a session cookie
 *
 * Cookie validation is shallow (just "does the cookie exist?") — full decode
 * happens in lib/auth.ts. We can't run the Node base64url decode from edge
 * runtime cleanly, but presence-of-cookie is enough for the route gate.
 * Server components / API routes still verify via getSession().
 */
import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "ps_session";

// Paths anyone can reach without a session.
const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
  "/api/external/", // proxied / external probes
  "/api/avatars/", // public character portraits — served via custom handler
                    // so runtime-added files don't need a container restart
  "/_next/",
  "/favicon",
  "/logo.",
  "/icon.",
  "/apple-touch-icon",
  "/robots.txt",
];

// File extensions that should always be served unauthenticated (anything in
// /public/ — Next.js routes them at the site root).
const PUBLIC_EXTENSIONS = /\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|css|js|map|txt|xml|webmanifest)$/i;

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  if (PUBLIC_EXTENSIONS.test(pathname)) {
    return NextResponse.next();
  }
  const hasCookie = req.cookies.has(COOKIE_NAME);
  if (hasCookie) return NextResponse.next();

  // For API routes return a JSON 401, for page routes redirect to /login
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "not authenticated" },
      { status: 401 },
    );
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("from", pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  // Match every page + API route. Static assets are already excluded by Next.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
