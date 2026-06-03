import crypto from "crypto";

export type JsonParseResult<T> = {
  value?: T;
  error?: string;
};

const DEFAULT_MAX_JSON_BYTES = 32 * 1024;

export function getRequestId(req: Request): string {
  const headerId = req.headers.get("x-request-id");
  return headerId && headerId.trim().length > 0 ? headerId : crypto.randomUUID();
}

export function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  const realIp = req.headers.get("x-real-ip");
  if (realIp && realIp.trim().length > 0) {
    return realIp.trim();
  }

  return "unknown";
}

export function getCookieValue(req: Request, name: string): string | null {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";");
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.trim().split("=");
    if (key === name) {
      return rest.join("=");
    }
  }

  return null;
}

export async function readJsonBody<T>(
  req: Request,
  options?: { maxBytes?: number }
): Promise<JsonParseResult<T>> {
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_JSON_BYTES;
  const contentType = req.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return { error: "Expected application/json" };
  }

  const contentLength = req.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    return { error: "Request body too large" };
  }

  try {
    const text = await req.text();
    if (text.length > maxBytes) {
      return { error: "Request body too large" };
    }

    if (!text) {
      return { error: "Empty request body" };
    }

    return { value: JSON.parse(text) as T };
  } catch {
    return { error: "Invalid JSON" };
  }
}
