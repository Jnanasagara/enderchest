import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const mode = process.argv[2];
const directory = process.argv[3];
if (!directory || !["backup", "restore"].includes(mode)) throw new Error("Usage: node storage-archive.mjs <backup|restore> <directory>");
function required(name) {
  if (!process.env[name]) throw new Error(`${name} is required`);
  return process.env[name];
}
const bucket = required("S3_BUCKET");
const client = new S3Client({
  endpoint: required("S3_ENDPOINT"),
  region: required("S3_REGION"),
  forcePathStyle: true,
  credentials: { accessKeyId: required("S3_ACCESS_KEY_ID"), secretAccessKey: required("S3_SECRET_ACCESS_KEY") },
});

async function* objects() {
  let token;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    for (const item of page.Contents ?? []) if (item.Key !== undefined) yield item.Key;
    token = page.NextContinuationToken;
  } while (token);
}

async function digestStream(body) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of body) { hash.update(chunk); size += chunk.length; }
  return { sha256: hash.digest("hex"), size };
}

async function remoteDigest(key) {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) throw new Error(`No body for ${key}`);
  return digestStream(response.Body);
}

async function backup() {
  await mkdir(directory, { recursive: true });
  if ((await readdir(directory)).length) throw new Error("Backup directory must be empty to avoid stale objects");
  const manifest = { version: 1, bucket, objects: [] };
  for await (const key of objects()) {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!response.Body) throw new Error(`No body for ${key}`);
    const filename = `${createHash("sha256").update(key).digest("hex")}.bin`;
    const hash = createHash("sha256");
    let size = 0;
    await pipeline(response.Body, new Transform({
      transform(chunk, _encoding, callback) { hash.update(chunk); size += chunk.length; callback(null, chunk); },
    }), createWriteStream(join(directory, filename), { flags: "wx" }));
    manifest.objects.push({ key, filename, size, sha256: hash.digest("hex"), contentType: response.ContentType, metadata: response.Metadata ?? {} });
  }
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
  process.stdout.write(`Backed up ${manifest.objects.length} objects.\n`);
}

async function legacyItems(root, dir = root) {
  const items = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) items.push(...await legacyItems(root, path));
    else if (entry.isFile()) items.push({ key: relative(root, path).replaceAll("\\", "/"), filename: relative(root, path), contentType: "application/octet-stream" });
  }
  return items;
}

async function restore() {
  let items;
  try {
    const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
    if (manifest.version !== 1 || !Array.isArray(manifest.objects)) throw new Error("Invalid backup manifest");
    items = manifest.objects;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    items = await legacyItems(directory);
    process.stdout.write("Legacy backup has no metadata manifest; restoring object bytes only.\n");
  }
  let restored = 0;
  for (const item of items) {
    const path = join(directory, item.filename);
    const local = await digestStream(createReadStream(path));
    if (item.sha256 && (item.sha256 !== local.sha256 || item.size !== local.size)) throw new Error(`Backup is corrupt: ${item.key}`);
    let current;
    try { current = await remoteDigest(item.key); }
    catch (error) { if (error?.$metadata?.httpStatusCode !== 404) throw error; }
    if (current) {
      if (current.sha256 !== local.sha256 || current.size !== local.size) throw new Error(`Destination differs: ${item.key}; refusing to overwrite`);
      continue;
    }
    const params = { Bucket: bucket, Key: item.key, Body: local.size ? createReadStream(path) : new Uint8Array(), ContentLength: local.size, ContentType: item.contentType, Metadata: item.metadata ?? {} };
    if (local.size === 0) await client.send(new PutObjectCommand(params));
    else await new Upload({ client, params, leavePartsOnError: false }).done();
    const copied = await remoteDigest(item.key);
    if (copied.sha256 !== local.sha256 || copied.size !== local.size) throw new Error(`Restore verification failed: ${item.key}`);
    restored++;
  }
  process.stdout.write(`Restored ${restored} objects; verified ${items.length}; existing objects were not overwritten.\n`);
}

try { if (mode === "backup") await backup(); else await restore(); }
finally { client.destroy(); }
