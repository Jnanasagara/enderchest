import { randomUUID } from "crypto";
import { extname } from "path";
import { getSessionUser } from "@/app/lib/auth/session";
import { requireCsrf } from "@/app/lib/auth/csrf";
import { pool } from "@/app/lib/db/pool";
import { hasPostgresCode } from "@/app/lib/db/errors";
import { objectStorage } from "@/app/lib/storage/s3";
import { parseUpload, type StagedUpload } from "@/app/lib/storage/parse-upload";
import { logError } from "@/app/lib/http/logging";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const csrfError = requireCsrf(req);
  if (csrfError) return Response.json({ error: csrfError }, { status: 403 });
  const userId = await getSessionUser();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const maxBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 50 * 1024 * 1024);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) return Response.json({ error: "Upload limit is misconfigured" }, { status: 500 });
  let upload: StagedUpload;
  try { upload = await parseUpload(req, maxBytes); }
  catch (error) {
    const message = error instanceof Error ? error.message : "Invalid upload";
    return Response.json({ error: message === "File too large" ? message : "Invalid upload" }, { status: message === "File too large" ? 413 : 400 });
  }

  let client;
  try { client = await pool.connect(); }
  catch (error) {
    await upload.cleanup().catch(() => {});
    logError("upload.db.failed", { error: String(error) });
    return Response.json({ error: "Upload failed" }, { status: 500 });
  }
  const fileId = randomUUID(), objectKey = `${userId}/${fileId}`;
  let attemptedStore = false;
  try {
    await client.query("BEGIN");
    const quota = await client.query<{ allocated_bytes: string; used_bytes: string }>(
      "SELECT allocated_bytes, used_bytes FROM quotas WHERE user_id = $1 FOR UPDATE", [userId]
    );
    if (!quota.rows[0]) { await client.query("ROLLBACK"); return Response.json({ error: "Quota not found" }, { status: 500 }); }
    if (BigInt(quota.rows[0].used_bytes) + BigInt(upload.size) > BigInt(quota.rows[0].allocated_bytes)) {
      await client.query("ROLLBACK"); return Response.json({ error: "Storage quota exceeded" }, { status: 413 });
    }
    const folder = await client.query("SELECT id FROM folders WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL", [upload.folderId, userId]);
    if (!folder.rowCount) { await client.query("ROLLBACK"); return Response.json({ error: "Folder not found" }, { status: 404 }); }

    attemptedStore = true;
    await objectStorage.putObject(objectKey, upload.stream(), upload.size, upload.mimeType);
    await client.query(
      "INSERT INTO files (id, owner_id, folder_id, name, object_key, size_bytes, mime_type, checksum_sha256, extension) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [fileId, userId, upload.folderId, upload.name, objectKey, upload.size, upload.mimeType, upload.checksum, extname(upload.name).slice(1).toLowerCase() || null]
    );
    await client.query("UPDATE quotas SET used_bytes = used_bytes + $1 WHERE user_id = $2", [upload.size, userId]);
    await client.query("COMMIT");
    return Response.json({ id: fileId, name: upload.name, size: upload.size });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (attemptedStore) await objectStorage.removeObject(objectKey).catch(cleanupError => logError("upload.cleanup.failed", { error: String(cleanupError), objectKey }));
    if (hasPostgresCode(error, "23505")) return Response.json({ error: "A file with that name already exists" }, { status: 409 });
    logError("upload.failed", { error: String(error) });
    return Response.json({ error: "Upload failed" }, { status: 500 });
  } finally { client.release(); await upload.cleanup().catch(() => {}); }
}
