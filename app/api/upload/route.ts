import { minioClient } from "@/app/lib/minio";
import { getSessionUser } from "@/app/lib/auth/session";
import { v4 as uuidv4 } from "uuid";
import { NextRequest } from "next/server";
import { pool } from "@/app/lib/db/pool";
import { createHash } from "crypto";
import { extname } from "path";
import { hasPostgresCode } from "@/app/lib/db/errors";
import { requireCsrf } from "@/app/lib/auth/csrf";
import { logError } from "@/app/lib/http/logging";

export async function POST(req: NextRequest) {
  try {
    const csrfError = requireCsrf(req);
    if (csrfError) {
      return Response.json({ error: csrfError }, { status: 403 });
    }

    const userId = await getSessionUser();
    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const folderId = formData.get("folderId") as string;

    if (!file) {
      return Response.json({ error: "No file uploaded" }, { status: 400 });
    }

    const maxBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 50 * 1024 * 1024);
    if (Number.isFinite(maxBytes) && file.size > maxBytes) {
      return Response.json({ error: "File too large" }, { status: 413 });
    }

    if (!folderId) {
      return Response.json({ error: "Missing folderId" }, { status: 400 });
    }

    const folders = await pool.query(
      `
      SELECT id
      FROM folders
      WHERE id = $1
        AND owner_id = $2
        AND deleted_at IS NULL
      `,
      [folderId, userId]
    );

    if (folders.rows.length === 0) {
      return Response.json({ error: "Folder not found" }, { status: 404 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const checksum = createHash("sha256").update(buffer).digest("hex");
    const extension = extname(file.name).slice(1).toLowerCase() || null;

    const fileId = uuidv4();
    const objectKey = `${userId}/${fileId}`;

    // Upload to MinIO
    await minioClient.putObject(
      "enderchest",
      objectKey,
      buffer,
      buffer.length,
      {
        "Content-Type": file.type,
      }
    );

    // Save metadata in DB
    try {
      await pool.query(
        `
        INSERT INTO files (
          id,
          folder_id,
          owner_id,
          name,
          object_key,
          size_bytes,
          mime_type,
          checksum_sha256,
          extension
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          fileId,
          folderId,
          userId,
          file.name,
          objectKey,
          buffer.length,
          file.type,
          checksum,
          extension,
        ]
      );
    } catch (error) {
      await minioClient.removeObject("enderchest", objectKey);

      if (hasPostgresCode(error, "23505")) {
        return Response.json(
          { error: "A file with that name already exists" },
          { status: 409 }
        );
      }

      throw error;
    }

    return Response.json({
      success: true,
      fileId,
      objectKey,
    });

  } catch (err) {
    logError("upload.failed", { error: String(err) });
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
