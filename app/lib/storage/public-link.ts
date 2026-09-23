import { createHmac, timingSafeEqual } from "node:crypto";

const LINK_TTL_SECONDS = 300;

function signingKey(secret: string | undefined): string {
  if (!secret || secret.length < 32) throw new Error("PUBLIC_LINK_SECRET must be at least 32 characters");
  return secret;
}

function signature(fileId: string, expires: number, secret: string): Buffer {
  return createHmac("sha256", secret).update(`file:v1:${fileId}:${expires}`).digest();
}

export function createPublicFileLink(origin: string, fileId: string, secret: string | undefined, now = Date.now()): string {
  const expires = Math.floor(now / 1000) + LINK_TTL_SECONDS;
  const url = new URL(`/api/files/${encodeURIComponent(fileId)}/public`, origin);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", signature(fileId, expires, signingKey(secret)).toString("hex"));
  return url.toString();
}

export function verifyPublicFileLink(fileId: string, expiresValue: string | null, signatureValue: string | null, secret: string | undefined, now = Date.now()): boolean {
  if (!/^[0-9a-f-]{36}$/i.test(fileId) || !expiresValue || !/^\d{10}$/.test(expiresValue) || !signatureValue || !/^[a-f0-9]{64}$/.test(signatureValue)) return false;
  const expires = Number(expiresValue);
  const current = Math.floor(now / 1000);
  if (expires < current || expires > current + LINK_TTL_SECONDS) return false;
  const expected = signature(fileId, expires, signingKey(secret));
  return timingSafeEqual(expected, Buffer.from(signatureValue, "hex"));
}
