import { NextRequest, NextResponse } from "next/server";

const AUTH_COOKIE = "crmrebs_token";
const PUBLIC_PATHS = ["/login"];
const PUBLIC_FILE = /\.(.*)$/;

function isJwtExpired(token: string): boolean {
  try {
    const [, payload] = token.split(".");
    if (!payload) return true;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const decoded = JSON.parse(atob(padded));
    if (!decoded?.exp) return false;
    return decoded.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/static") ||
    pathname === "/favicon.ico" ||
    PUBLIC_FILE.test(pathname)
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(AUTH_COOKIE)?.value;
  const loginUrl = new URL("/login", request.url);
  const dashboardUrl = new URL("/", request.url);

  if (!token) {
    if (PUBLIC_PATHS.includes(pathname)) {
      return NextResponse.next();
    }
    return NextResponse.redirect(loginUrl);
  }

  if (isJwtExpired(token)) {
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete(AUTH_COOKIE);
    return response;
  }

  if (pathname === "/login") {
    return NextResponse.redirect(dashboardUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|api|static|favicon.ico).*)"],
};





