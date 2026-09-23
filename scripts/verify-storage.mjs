import { createHash } from "node:crypto";
import pg from "pg";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

const db = new pg.Client({
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
});
const bucket = process.env.S3_BUCKET;
const storage = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
});

await db.connect();
try {
  const keys = new Set();
  let token;
  do {
    const page = await storage.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    for (const item of page.Contents ?? []) if (item.Key) keys.add(item.Key);
    token = page.NextContinuationToken;
  } while (token);
  const files = await db.query("SELECT object_key, name, size_bytes, checksum_sha256 FROM files");
  let verified = 0;
  let legacyIncomplete = 0;
  for (const file of files.rows) {
    if (!keys.has(file.object_key)) {
      if (file.name === "" && file.checksum_sha256 == null) {
        process.stderr.write(`Legacy incomplete row has no object: ${file.object_key}\n`);
        legacyIncomplete++;
        continue;
      }
      throw new Error(`Missing object: ${file.object_key}`);
    }
    const response = await storage.send(new GetObjectCommand({ Bucket: bucket, Key: file.object_key }));
    if (!response.Body) throw new Error(`Empty response: ${file.object_key}`);
    const hash = createHash("sha256");
    let size = 0n;
    for await (const chunk of response.Body) { hash.update(chunk); size += BigInt(chunk.length); }
    const digest = hash.digest("hex");
    if (size !== BigInt(file.size_bytes) || (file.checksum_sha256 && digest !== file.checksum_sha256)) {
      throw new Error(`Checksum or size mismatch: ${file.object_key}`);
    }
    verified++;
  }
  process.stdout.write(`Verified ${verified} database files against ${keys.size} stored objects; ${legacyIncomplete} preserved legacy incomplete rows.\n`);
} finally {
  storage.destroy();
  await db.end();
}
