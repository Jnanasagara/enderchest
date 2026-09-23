import assert from "node:assert/strict";
import { test } from "node:test";
import publicLinkModule from "../app/lib/storage/public-link.ts";

const { createPublicFileLink, verifyPublicFileLink } = publicLinkModule;
const id = "9a5f669e-326a-44b1-8daa-83dff41710ce";
const secret = "a".repeat(64);
const now = 1_800_000_000_000;

test("app file link is valid for five minutes and contains no storage key", () => {
  const url = new URL(createPublicFileLink("https://host.ts.net", id, secret, now));
  assert.equal(url.origin, "https://host.ts.net");
  assert.equal(url.pathname, `/api/files/${id}/public`);
  assert.equal(url.searchParams.has("key"), false);
  const expires = url.searchParams.get("expires");
  const signature = url.searchParams.get("signature");
  assert.equal(verifyPublicFileLink(id, expires, signature, secret, now), true);
  assert.equal(verifyPublicFileLink(id, expires, signature, secret, now + 301_000), false);
  assert.equal(verifyPublicFileLink("0".repeat(36), expires, signature, secret, now), false);
  assert.equal(verifyPublicFileLink(id, expires, "0".repeat(64), secret, now), false);
  assert.equal(verifyPublicFileLink(id, expires, signature, "b".repeat(64), now), false);
  assert.equal(verifyPublicFileLink(id, "9999999999", signature, secret, now), false);
  assert.throws(() => createPublicFileLink("https://host.ts.net", id, "short", now));
});
