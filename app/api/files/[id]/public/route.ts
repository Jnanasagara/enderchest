import { pool } from "@/app/lib/db/pool";
import { logError } from "@/app/lib/http/logging";
import { fileResponse, type DownloadFile } from "@/app/lib/storage/file-response";
import { verifyPublicFileLink } from "@/app/lib/storage/public-link";
import { objectStorage } from "@/app/lib/storage/s3";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.PRESIGNED_URL_MODE !== "app") return Response.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  const url = new URL(req.url);
  if (!verifyPublicFileLink(id, url.searchParams.get("expires"), url.searchParams.get("signature"), process.env.PUBLIC_LINK_SECRET)) {
    return Response.json({ error: "Invalid or expired link" }, { status: 403 });
  }
  try {
    const result = await pool.query<DownloadFile & { object_key: string }>(
      "SELECT name, object_key, mime_type, size_bytes FROM files WHERE id = $1 AND deleted_at IS NULL", [id]
    );
    const file = result.rows[0];
    if (!file) return Response.json({ error: "File not found" }, { status: 404 });
    return fileResponse(file, await objectStorage.getObject(file.object_key));
  } catch (error) {
    logError("files.public.failed", { error: String(error) });
    return Response.json({ error: "Download failed" }, { status: 500 });
  }
}
