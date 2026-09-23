import { getSessionUser } from "@/app/lib/auth/session";
import { pool } from "@/app/lib/db/pool";
import { logError } from "@/app/lib/http/logging";

export async function GET() {
  const userId = await getSessionUser();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const [folders, files] = await Promise.all([
      pool.query("SELECT f.id, f.name, f.deleted_at FROM folders f LEFT JOIN folders p ON p.id = f.parent_id WHERE f.owner_id = $1 AND f.deleted_at IS NOT NULL AND (p.id IS NULL OR p.deleted_at IS NULL) ORDER BY f.deleted_at DESC", [userId]),
      pool.query("SELECT f.id, f.name, f.size_bytes, f.mime_type, f.deleted_at FROM files f LEFT JOIN folders p ON p.id = f.folder_id WHERE f.owner_id = $1 AND f.deleted_at IS NOT NULL AND (p.id IS NULL OR p.deleted_at IS NULL) ORDER BY f.deleted_at DESC", [userId]),
    ]);
    return Response.json({ folders: folders.rows, files: files.rows.map(({ size_bytes, ...row }) => ({ ...row, size: Number(size_bytes) })) });
  } catch (error) {
    logError("trash.list.failed", { error: String(error) });
    return Response.json({ error: "Could not load trash" }, { status: 500 });
  }
}
