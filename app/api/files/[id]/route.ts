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
  const parsed = await readJsonBody<{ name?: string; folderId?: string }>(req, { maxBytes: 4096 });
  if (parsed.error) return Response.json({ error: parsed.error }, { status: 400 });
  const { name, folderId } = parsed.value ?? {};
  if (!isUuid(id) || (name === undefined && folderId === undefined) || (name !== undefined && (typeof name !== "string" || !name.trim() || name.trim().length > 255)) || (folderId !== undefined && (typeof folderId !== "string" || !isUuid(folderId)))) {
    return Response.json({ error: "Invalid file update" }, { status: 400 });
  }
  try {
    if (folderId) {
      const folder = await pool.query("SELECT id FROM folders WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL", [folderId, userId]);
      if (!folder.rowCount) return Response.json({ error: "Destination not found" }, { status: 404 });
    }
    const result = await pool.query("UPDATE files SET name = COALESCE($1, name), folder_id = COALESCE($2, folder_id) WHERE id = $3 AND owner_id = $4 AND deleted_at IS NULL RETURNING id", [name?.trim() ?? null, folderId ?? null, id, userId]);
    if (!result.rowCount) return Response.json({ error: "File not found" }, { status: 404 });
    return Response.json({ success: true });
  } catch (error) {
    if (hasPostgresCode(error, "23505")) return Response.json({ error: "A file with that name already exists" }, { status: 409 });
    logError("files.update.failed", { error: String(error) });
    return Response.json({ error: "Update failed" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: Context) {
  const csrfError = requireCsrf(req);
  if (csrfError) return Response.json({ error: csrfError }, { status: 403 });
  const userId = await getSessionUser();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "Invalid file" }, { status: 400 });
  try {
    const result = await pool.query("UPDATE files SET deleted_at = NOW() WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL RETURNING id", [id, userId]);
    if (!result.rowCount) return Response.json({ error: "File not found" }, { status: 404 });
    return Response.json({ success: true });
  } catch (error) {
    logError("files.delete.failed", { error: String(error) });
    return Response.json({ error: "Delete failed" }, { status: 500 });
  }
}
