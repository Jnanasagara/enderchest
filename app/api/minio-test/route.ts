import { minioClient } from "@/app/lib/minio";

export async function GET() {
  try {
    const buckets = await minioClient.listBuckets();

    return Response.json({
      success: true,
      buckets,
    });
  } catch (err) {
    return Response.json({
      success: false,
      error: String(err),
    });
  }
}