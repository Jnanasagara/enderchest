import { getSessionUser } from "@/app/lib/auth/session";
import { requireCsrf } from "@/app/lib/auth/csrf";
import { pool } from "@/app/lib/db/pool";
import { readJsonBody } from "@/app/lib/http/request";
import { hasPostgresCode } from "@/app/lib/db/errors";
import { logError } from "@/app/lib/http/logging";

type Context = { params: Promise<{ id: string }> };
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function PATCH(req: Request, { params }: Context) {
  const csrfError = requireCsrf(req);
  if (csrfError) return Response.json({ error: csrfError }, { status: 403 });
  const userId = await getSessionUser();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const parsed = await readJsonBody<{ name?: string; parentId?: string }>(req, { maxBytes: 4096 });
  if (parsed.error) return Response.json({ error: parsed.error }, { status: 400 });
  const { name, parentId } = parsed.value ?? {};
  if (!isUuid(id) || (name === undefined && parentId === undefined) || (name !== undefined && (typeof name !== "string" || !name.trim() || name.trim().length > 255)) || (parentId !== undefined && (typeof parentId !== "string" || !isUuid(parentId)))) {
    return Response.json({ error: "Invalid folder update" }, { status: 400 });
  }
  try {
    const current = await pool.query<{ parent_id: string | null }>("SELECT parent_id FROM folders WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL", [id, userId]);
    if (!current.rows[0]) return Response.json({ error: "Folder not found" }, { status: 404 });
    if (!current.rows[0].parent_id) return Response.json({ error: "Root folder cannot be changed" }, { status: 403 });
    if (parentId) {
      const target = await pool.query("SELECT id FROM folders WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL", [parentId, userId]);
      if (!target.rowCount) return Response.json({ error: "Destination not found" }, { status: 404 });
      const descendants = await pool.query("WITH RECURSIVE tree AS (SELECT id FROM folders WHERE id = $1 UNION ALL SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id) SELECT id FROM tree WHERE id = $2", [id, parentId]);
      if (descendants.rowCount) return Response.json({ error: "Cannot move a folder into itself" }, { status: 409 });
    }
    await pool.query("UPDATE folders SET name = COALESCE($1, name), parent_id = COALESCE($2, parent_id) WHERE id = $3 AND owner_id = $4", [name?.trim() ?? null, parentId ?? null, id, userId]);
    return Response.json({ success: true });
  } catch (error) {
    if (hasPostgresCode(error, "23505")) return Response.json({ error: "A folder with that name already exists" }, { status: 409 });
    logError("folders.update.failed", { error: String(error) });
    return Response.json({ error: "Update failed" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: Context) {
  const csrfError = requireCsrf(req);
  if (csrfError) return Response.json({ error: csrfError }, { status: 403 });
  const userId = await getSessionUser();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "Invalid folder" }, { status: 400 });
  try {
    const result = await pool.query("UPDATE folders SET deleted_at = NOW() WHERE id = $1 AND owner_id = $2 AND parent_id IS NOT NULL AND deleted_at IS NULL RETURNING id", [id, userId]);
    if (!result.rowCount) return Response.json({ error: "Folder not found" }, { status: 404 });
    return Response.json({ success: true });
  } catch (error) {
    logError("folders.delete.failed", { error: String(error) });
    return Response.json({ error: "Delete failed" }, { status: 500 });
  }
}
