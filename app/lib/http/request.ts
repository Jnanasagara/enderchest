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
    if (!req.body) return { error: "Empty request body" };
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return { error: "Request body too large" };
      }
      chunks.push(value);
    }
    const text = new TextDecoder().decode(Buffer.concat(chunks));

    if (!text) {
      return { error: "Empty request body" };
    }

    return { value: JSON.parse(text) as T };
  } catch {
    return { error: "Invalid JSON" };
  }
}
