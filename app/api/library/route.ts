import { getSessionUser } from "@/app/lib/auth/session";
import { pool } from "@/app/lib/db/pool";
import { logError } from "@/app/lib/http/logging";

export async function GET(req: Request) {
  const userId = await getSessionUser();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const search = (params.get("q") ?? "").trim().slice(0, 100);
  try {
    const [quota, files, folders] = await Promise.all([
      pool.query("SELECT allocated_bytes, used_bytes FROM quotas WHERE user_id = $1", [userId]),
      pool.query("SELECT id, name, folder_id, size_bytes, mime_type, updated_at FROM files WHERE owner_id = $1 AND deleted_at IS NULL AND ($2 = '' OR name ILIKE '%' || $2 || '%') ORDER BY updated_at DESC LIMIT 200", [userId, search]),
      search ? pool.query("SELECT id, name, parent_id, updated_at FROM folders WHERE owner_id = $1 AND parent_id IS NOT NULL AND deleted_at IS NULL AND name ILIKE '%' || $2 || '%' ORDER BY name LIMIT 100", [userId, search]) : Promise.resolve({ rows: [] }),
    ]);
    return Response.json({
      quota: quota.rows[0] ?? { allocated_bytes: 0, used_bytes: 0 },
      files: files.rows.map(({ size_bytes, ...file }) => ({ ...file, size: Number(size_bytes) })),
      folders: folders.rows,
    });
  } catch (error) {
    logError("library.failed", { error: String(error) });
    return Response.json({ error: "Could not load files" }, { status: 500 });
  }
}
