import { Readable } from "node:stream";
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function config() {
  return {
    bucket: required("S3_BUCKET"),
    region: required("S3_REGION"),
    credentials: {
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    },
  };
}

let client: S3Client | undefined;
function connection() {
  const settings = config();
  client ??= new S3Client({ endpoint: required("S3_ENDPOINT"), region: settings.region, credentials: settings.credentials, forcePathStyle: true });
  return { client, bucket: settings.bucket };
}

export const objectStorage = {
  async checkHealth() {
    const { client, bucket } = connection();
    await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }), {
      abortSignal: AbortSignal.timeout(5000),
    });
  },

  async putObject(key: string, body: Readable, size: number, contentType: string) {
    const { client, bucket } = connection();
    if (size === 0) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: new Uint8Array(), ContentType: contentType }));
      return;
    }
    await new Upload({
      client,
      params: { Bucket: bucket, Key: key, Body: body, ContentLength: size, ContentType: contentType },
      leavePartsOnError: false,
    }).done();
  },

  async getObject(key: string): Promise<Readable> {
    const { client, bucket } = connection();
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!response.Body) throw new Error("Object response has no body");
    return response.Body as Readable;
  },

  async copyObject(destinationKey: string, sourceKey: string) {
    const { client, bucket } = connection();
    await client.send(new CopyObjectCommand({ Bucket: bucket, Key: destinationKey, CopySource: `${bucket}/${sourceKey.split("/").map(encodeURIComponent).join("/")}` }));
  },

  async removeObject(key: string) {
    const { client, bucket } = connection();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  },

  async listObjects(prefix = "", continuationToken?: string) {
    const { client, bucket } = connection();
    return client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }));
  },

  async presignGetObject(key: string, expiresIn = 300) {
    const { bucket, region, credentials } = config();
    const endpoint = required("S3_PUBLIC_ENDPOINT");
    const publicClient = new S3Client({ endpoint, region, credentials, forcePathStyle: true });
    try {
      return await getSignedUrl(publicClient, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
    } finally {
      publicClient.destroy();
    }
  },
};
