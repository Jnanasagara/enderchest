import { minioClient } from "@/app/lib/minio";
import { logError } from "@/app/lib/http/logging";

export async function GET() {
  try {
    const buckets = await minioClient.listBuckets();

    return Response.json({
      success: true,
      buckets,
    });
  } catch (err) {
    logError("minio.test.failed", { error: String(err) });
    return Response.json({ success: false }, { status: 500 });
  }
}