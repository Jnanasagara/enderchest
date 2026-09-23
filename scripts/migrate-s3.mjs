import { createHash } from "node:crypto";
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function connection(prefix) {
  const bucket = required(`${prefix}BUCKET`);
  const client = new S3Client({
    endpoint: required(`${prefix}ENDPOINT`),
    region: required(`${prefix}REGION`),
    forcePathStyle: true,
    credentials: {
      accessKeyId: required(`${prefix}ACCESS_KEY_ID`),
      secretAccessKey: required(`${prefix}SECRET_ACCESS_KEY`),
    },
  });
  return { client, bucket };
}

async function* objects({ client, bucket }) {
  let token;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    for (const item of page.Contents ?? []) if (item.Key !== undefined) yield item.Key;
    token = page.NextContinuationToken;
  } while (token);
}

async function digest({ client, bucket }, key) {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) throw new Error(`No body for ${key}`);
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of response.Body) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { sha256: hash.digest("hex"), size };
}

async function head({ client, bucket }, key) {
  try {
    return await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

function metadata(response) {
  return JSON.stringify({
    contentType: response.ContentType ?? null,
    contentDisposition: response.ContentDisposition ?? null,
    contentEncoding: response.ContentEncoding ?? null,
    contentLanguage: response.ContentLanguage ?? null,
    cacheControl: response.CacheControl ?? null,
    custom: Object.fromEntries(Object.entries(response.Metadata ?? {}).sort(([a], [b]) => a.localeCompare(b))),
  });
}

async function copy(source, target, key, size) {
  const response = await source.client.send(new GetObjectCommand({ Bucket: source.bucket, Key: key }));
  if (!response.Body) throw new Error(`No body for ${key}`);
  const params = {
    Bucket: target.bucket,
    Key: key,
    Body: size === 0 ? new Uint8Array() : response.Body,
    ContentLength: size,
    ContentType: response.ContentType,
    ContentDisposition: response.ContentDisposition,
    ContentEncoding: response.ContentEncoding,
    ContentLanguage: response.ContentLanguage,
    CacheControl: response.CacheControl,
    Metadata: response.Metadata,
  };
  if (size === 0) await target.client.send(new PutObjectCommand(params));
  else await new Upload({ client: target.client, params, leavePartsOnError: false }).done();
}

const verifyOnly = process.argv.includes("--verify");
const source = connection("SOURCE_S3_");
const target = connection("S3_");
let copied = 0, verified = 0;
try {
  for await (const key of objects(source)) {
    const original = await digest(source, key);
    const originalHead = await head(source, key);
    let targetHead = await head(target, key);
    if (targetHead) {
      const current = await digest(target, key);
      if (current.size !== original.size || current.sha256 !== original.sha256) {
        throw new Error(`Destination has different bytes for ${key}; refusing to overwrite`);
      }
    } else {
      if (verifyOnly) throw new Error(`Destination is missing ${key}`);
      await copy(source, target, key, original.size);
      copied++;
      const current = await digest(target, key);
      if (current.size !== original.size || current.sha256 !== original.sha256) {
        throw new Error(`Verification failed for ${key}`);
      }
      targetHead = await head(target, key);
    }
    if (metadata(originalHead) !== metadata(targetHead)) throw new Error(`Destination metadata differs for ${key}; refusing to overwrite`);
    verified++;
    process.stdout.write(`Verified ${key}\n`);
  }
  process.stdout.write(`Done: ${copied} copied, ${verified} byte-verified; source unchanged.\n`);
} finally {
  source.client.destroy();
  target.client.destroy();
}
