import { PutBucketCorsCommand, S3Client } from "@aws-sdk/client-s3";

const origins = (process.env.S3_CORS_ORIGINS ?? "").split(",").map(value => value.trim()).filter(Boolean);
if (origins.length) {
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
  });
  try {
    await client.send(new PutBucketCorsCommand({
      Bucket: process.env.S3_BUCKET,
      CORSConfiguration: { CORSRules: [{ AllowedOrigins: origins, AllowedMethods: ["GET", "HEAD"], AllowedHeaders: ["*"], ExposeHeaders: ["ETag"], MaxAgeSeconds: 3600 }] },
    }));
    process.stdout.write(`Configured S3 CORS for ${origins.join(", ")}.\n`);
  } finally { client.destroy(); }
}
