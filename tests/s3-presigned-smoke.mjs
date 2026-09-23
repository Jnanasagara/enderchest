import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import storageModule from "../app/lib/storage/s3.ts";

const { objectStorage } = storageModule;

const listing = await objectStorage.listObjects();
const key = listing.Contents?.[0]?.Key;
assert.ok(key, "The configured bucket must contain an object to test signed access");
const hash = createHash("sha256");
for await (const chunk of await objectStorage.getObject(key)) hash.update(chunk);

const url = await objectStorage.presignGetObject(key);
const signed = await fetch(url);
assert.equal(signed.status, 200, "Signed download must succeed without an app session");
assert.equal(createHash("sha256").update(Buffer.from(await signed.arrayBuffer())).digest("hex"), hash.digest("hex"));

const origin = process.env.S3_TEST_ORIGIN ?? "http://localhost:3000";
const preflight = await fetch(url, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET" } });
assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
process.stdout.write(`Signed GET and CORS passed for ${key}.\n`);
