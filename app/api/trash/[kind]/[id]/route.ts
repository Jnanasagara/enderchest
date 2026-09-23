import { getSessionUser } from "@/app/lib/auth/session";
import { requireCsrf } from "@/app/lib/auth/csrf";
import { pool } from "@/app/lib/db/pool";
import { objectStorage } from "@/app/lib/storage/s3";
import { hasPostgresCode } from "@/app/lib/db/errors";
import { logError } from "@/app/lib/http/logging";

type Context = { params: Promise<{ kind: string; id: string }> };
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

async function handle(req: Request, context: Context, action: "restore" | "purge") {
  const csrfError = requireCsrf(req);
  if (csrfError) return Response.json({ error: csrfError }, { status: 403 });
  const userId = await getSessionUser();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { kind, id } = await context.params;
  if (!isUuid(id) || !["file", "folder"].includes(kind)) return Response.json({ error: "Invalid item" }, { status: 400 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT user_id FROM quotas WHERE user_id = $1 FOR UPDATE", [userId]);
    if (kind === "file") {
      const result = await client.query<{ folder_id: string; object_key: string; size_bytes: string }>("SELECT folder_id, object_key, size_bytes FROM files WHERE id = $1 AND owner_id = $2 AND deleted_at IS NOT NULL FOR UPDATE", [id, userId]);
      const file = result.rows[0];
      if (!file) { await client.query("ROLLBACK"); return Response.json({ error: "File not found in trash" }, { status: 404 }); }
      if (action === "restore") {
        const parent = await client.query("SELECT id FROM folders WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL", [file.folder_id, userId]);
        if (!parent.rowCount) { await client.query("ROLLBACK"); return Response.json({ error: "Restore the parent folder first" }, { status: 409 }); }
        await client.query("UPDATE files SET deleted_at = NULL WHERE id = $1", [id]);
      } else {
        await objectStorage.removeObject(file.object_key);
        await client.query("DELETE FROM files WHERE id = $1", [id]);
        await client.query("UPDATE quotas SET used_bytes = GREATEST(0, used_bytes - $1) WHERE user_id = $2", [file.size_bytes, userId]);
      }
    } else {
      const root = await client.query<{ parent_id: string }>("SELECT parent_id FROM folders WHERE id = $1 AND owner_id = $2 AND parent_id IS NOT NULL AND deleted_at IS NOT NULL FOR UPDATE", [id, userId]);
      if (!root.rows[0]) { await client.query("ROLLBACK"); return Response.json({ error: "Folder not found in trash" }, { status: 404 }); }
      if (action === "restore") {
        const parent = await client.query("SELECT id FROM folders WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL", [root.rows[0].parent_id, userId]);
        if (!parent.rowCount) { await client.query("ROLLBACK"); return Response.json({ error: "Restore the parent folder first" }, { status: 409 }); }
        // Only rows trashed with this folder are restored; older deleted children stay in trash.
        await client.query("WITH RECURSIVE tree AS (SELECT id FROM folders WHERE id = $1 UNION ALL SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id WHERE f.deleted_at = (SELECT deleted_at FROM folders WHERE id = $1)) UPDATE files SET deleted_at = NULL WHERE folder_id IN (SELECT id FROM tree) AND deleted_at = (SELECT deleted_at FROM folders WHERE id = $1)", [id]);
        await client.query("WITH RECURSIVE tree AS (SELECT id FROM folders WHERE id = $1 UNION ALL SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id WHERE f.deleted_at = (SELECT deleted_at FROM folders WHERE id = $1)) UPDATE folders SET deleted_at = NULL WHERE id IN (SELECT id FROM tree)", [id]);
      } else {
        const files = await client.query<{ id: string; object_key: string; size_bytes: string }>("WITH RECURSIVE tree AS (SELECT id FROM folders WHERE id = $1 UNION ALL SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id) SELECT id, object_key, size_bytes FROM files WHERE folder_id IN (SELECT id FROM tree) AND owner_id = $2", [id, userId]);
        for (const file of files.rows) await objectStorage.removeObject(file.object_key);
        await client.query("DELETE FROM files WHERE id = ANY($1::uuid[])", [files.rows.map((file) => file.id)]);
        await client.query("DELETE FROM folders WHERE id = $1", [id]);
        const removedBytes = files.rows.reduce((sum, file) => sum + BigInt(file.size_bytes), BigInt(0));
        await client.query("UPDATE quotas SET used_bytes = GREATEST(0, used_bytes - $1) WHERE user_id = $2", [removedBytes.toString(), userId]);
      }
    }
    await client.query("COMMIT");
    return Response.json({ success: true });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (hasPostgresCode(error, "23505")) return Response.json({ error: "An item with that name already exists at its original location" }, { status: 409 });
    logError(`trash.${action}.failed`, { error: String(error) });
    return Response.json({ error: `${action === "restore" ? "Restore" : "Permanent deletion"} failed` }, { status: 500 });
  } finally { client.release(); }
}

export async function POST(req: Request, context: Context) { return handle(req, context, "restore"); }
export async function DELETE(req: Request, context: Context) { return handle(req, context, "purge"); }
