import { SESSION_TTL_DAYS } from "@/app/lib/auth/session";

export const SESSION_COOKIE_NAME = "session";
export const CSRF_COOKIE_NAME = "csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

export function shouldUseSecureCookies(): boolean {
  if (process.env.SESSION_COOKIE_SECURE) {
    return process.env.SESSION_COOKIE_SECURE === "true";
  }

  return process.env.NODE_ENV === "production";
}

export function getSessionCookieOptions() {
  const maxAge = SESSION_TTL_DAYS * 24 * 60 * 60;

  return {
    httpOnly: true,
    secure: shouldUseSecureCookies(),
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export function getCsrfCookieOptions() {
  const maxAge = SESSION_TTL_DAYS * 24 * 60 * 60;

  return {
    httpOnly: false,
    secure: shouldUseSecureCookies(),
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
