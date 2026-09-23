import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

if (process.env.S3_ENDPOINT !== "http://localhost:3902" || !process.env.ENDER_STORAGE_ROOT?.includes("setup-garage-probe")) {
  throw new Error("Bind-mount probe must target the isolated Garage service and test folder");
}
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
});
const bucket = process.env.S3_BUCKET;
const key = `setup-probe/${randomUUID()}`;
const contents = randomBytes(128 * 1024);
try {
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: contents, ContentType: "application/octet-stream" }));
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  assert.deepEqual(Buffer.from(await response.Body.transformToByteArray()), contents);
  assert.ok((await readdir(path.join(process.env.ENDER_STORAGE_ROOT, "objects"))).length > 0, "Garage did not write to the selected host folder");
  process.stdout.write("Garage read/write succeeded on the selected host folder.\n");
} finally {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  client.destroy();
}
