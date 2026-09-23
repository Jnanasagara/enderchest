import { getSessionUser } from "@/app/lib/auth/session";
import { pool } from "@/app/lib/db/pool";
import { objectStorage } from "@/app/lib/storage/s3";
import { fileResponse } from "@/app/lib/storage/file-response";
import { logError } from "@/app/lib/http/logging";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getSessionUser();
    if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const result = await pool.query<{ name: string; object_key: string; mime_type: string; size_bytes: string }>(
      "SELECT name, object_key, mime_type, size_bytes FROM files WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL", [id, userId]
    );
    const file = result.rows[0];
    if (!file) return Response.json({ error: "File not found" }, { status: 404 });
    const stream = await objectStorage.getObject(file.object_key);
    return fileResponse(file, stream, new URL(req.url).searchParams.get("inline") === "1");
  } catch (error) {
    logError("files.download.failed", { error: String(error) });
    return Response.json({ error: "Download failed" }, { status: 500 });
  }
}
