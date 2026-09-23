import { getSessionUser } from "@/app/lib/auth/session";
import { pool } from "@/app/lib/db/pool";
import { objectStorage } from "@/app/lib/storage/s3";
import { publicAppUrl } from "@/app/lib/public-url";
import { createPublicFileLink } from "@/app/lib/storage/public-link";
import { logError } from "@/app/lib/http/logging";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUser();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Invalid file" }, { status: 400 });
  try {
    const file = await pool.query<{ object_key: string }>(
      "SELECT object_key FROM files WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL", [id, userId]
    );
    if (!file.rows[0]) return Response.json({ error: "File not found" }, { status: 404 });
    const origin = publicAppUrl(process.env.PUBLIC_APP_URL);
    const url = process.env.PRESIGNED_URL_MODE === "app"
      ? createPublicFileLink(origin ?? "", id, process.env.PUBLIC_LINK_SECRET)
      : await objectStorage.presignGetObject(file.rows[0].object_key);
    return Response.json({ url, expiresIn: 300 }, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    logError("files.presign.failed", { error: String(error) });
    return Response.json({ error: "Could not create link" }, { status: 500 });
  }
}
