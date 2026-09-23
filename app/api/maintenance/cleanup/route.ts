import { timingSafeEqual } from "crypto";
import { pool } from "@/app/lib/db/pool";
import { objectStorage } from "@/app/lib/storage/s3";
import { logError } from "@/app/lib/http/logging";

export async function POST(req: Request) {
  const expected = process.env.MAINTENANCE_TOKEN;
  const supplied = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected ?? "");
  if (!expected || expected.length < 32 || suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const days = Number(process.env.TRASH_RETENTION_DAYS ?? 30);
  if (!Number.isInteger(days) || days < 1) return Response.json({ error: "Invalid retention setting" }, { status: 500 });
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const files = await client.query<{ id: string; owner_id: string; object_key: string; size_bytes: string }>(
      "SELECT id, owner_id, object_key, size_bytes FROM files WHERE deleted_at < $1 ORDER BY deleted_at LIMIT 100 FOR UPDATE SKIP LOCKED", [cutoff]
    );
    for (const file of files.rows) {
      await objectStorage.removeObject(file.object_key);
      await client.query("DELETE FROM files WHERE id = $1", [file.id]);
      await client.query("UPDATE quotas SET used_bytes = GREATEST(0, used_bytes - $1) WHERE user_id = $2", [file.size_bytes, file.owner_id]);
    }
    let foldersRemoved = 0;
    for (;;) {
      const deleted = await client.query(
        "DELETE FROM folders f WHERE f.deleted_at < $1 AND f.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM files x WHERE x.folder_id = f.id) AND NOT EXISTS (SELECT 1 FROM folders child WHERE child.parent_id = f.id) RETURNING id", [cutoff]
      );
      foldersRemoved += deleted.rowCount ?? 0;
      if (!deleted.rowCount) break;
    }
    await client.query("COMMIT");
    return Response.json({ filesRemoved: files.rowCount, foldersRemoved });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    logError("maintenance.cleanup.failed", { error: String(error) });
    return Response.json({ error: "Cleanup failed" }, { status: 500 });
  } finally { client.release(); }
}
