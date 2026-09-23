import { randomUUID } from "crypto";
import { getSessionUser } from "@/app/lib/auth/session";
import { requireCsrf } from "@/app/lib/auth/csrf";
import { readJsonBody } from "@/app/lib/http/request";
import { pool } from "@/app/lib/db/pool";
import { objectStorage } from "@/app/lib/storage/s3";
import { hasPostgresCode } from "@/app/lib/db/errors";
import { logError } from "@/app/lib/http/logging";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = requireCsrf(req);
  if (csrfError) return Response.json({ error: csrfError }, { status: 403 });
  const userId = await getSessionUser();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Invalid file" }, { status: 400 });
  const parsed = await readJsonBody<{ name?: string; folderId?: string }>(req, { maxBytes: 4096 });
  if (parsed.error) return Response.json({ error: parsed.error }, { status: 400 });
  const name = parsed.value?.name?.trim();
  const folderId = parsed.value?.folderId;
  if (!name || name.length > 255 || !folderId || !/^[0-9a-f-]{36}$/i.test(folderId)) return Response.json({ error: "Name and folder are required" }, { status: 400 });
  const client = await pool.connect();
  const fileId = randomUUID(), key = `${userId}/${fileId}`;
  let copied = false;
  try {
    await client.query("BEGIN");
    const quota = await client.query<{ allocated_bytes: string; used_bytes: string }>("SELECT allocated_bytes, used_bytes FROM quotas WHERE user_id = $1 FOR UPDATE", [userId]);
    const source = await client.query<{ object_key: string; size_bytes: string; mime_type: string; checksum_sha256: string; extension: string }>("SELECT object_key, size_bytes, mime_type, checksum_sha256, extension FROM files WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL", [id, userId]);
    if (!source.rows[0]) { await client.query("ROLLBACK"); return Response.json({ error: "File not found" }, { status: 404 }); }
    const folder = await client.query("SELECT id FROM folders WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL", [folderId, userId]);
    if (!folder.rowCount) { await client.query("ROLLBACK"); return Response.json({ error: "Folder not found" }, { status: 404 }); }
    const file = source.rows[0];
    if (!quota.rows[0] || BigInt(quota.rows[0].used_bytes) + BigInt(file.size_bytes) > BigInt(quota.rows[0].allocated_bytes)) {
      await client.query("ROLLBACK"); return Response.json({ error: "Storage quota exceeded" }, { status: 413 });
    }
    await objectStorage.copyObject(key, file.object_key);
    copied = true;
    await client.query("INSERT INTO files (id, owner_id, folder_id, name, object_key, size_bytes, mime_type, checksum_sha256, extension) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [fileId, userId, folderId, name, key, file.size_bytes, file.mime_type, file.checksum_sha256, file.extension]);
    await client.query("UPDATE quotas SET used_bytes = used_bytes + $1 WHERE user_id = $2", [file.size_bytes, userId]);
    await client.query("COMMIT");
    return Response.json({ id: fileId, name });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (copied) await objectStorage.removeObject(key).catch(cleanupError => logError("copy.cleanup.failed", { error: String(cleanupError) }));
    if (hasPostgresCode(error, "23505")) return Response.json({ error: "A file with that name already exists" }, { status: 409 });
    logError("files.copy.failed", { error: String(error) });
    return Response.json({ error: "Copy failed" }, { status: 500 });
  } finally { client.release(); }
}
