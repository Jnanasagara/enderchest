import crypto from "crypto";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, SESSION_COOKIE_NAME } from "@/app/lib/auth/cookies";
import { getCookieValue } from "@/app/lib/http/request";

export function createCsrfToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function requireCsrf(req: Request): string | null {
  const sessionId = getCookieValue(req, SESSION_COOKIE_NAME);
  if (!sessionId) {
    return null;
  }

  const csrfCookie = getCookieValue(req, CSRF_COOKIE_NAME);
  const csrfHeader = req.headers.get(CSRF_HEADER_NAME);

  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    return "CSRF validation failed";
  }

  return null;
}
