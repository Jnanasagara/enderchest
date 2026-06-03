import { NextRequest } from "next/server";
import { minioClient } from "@/app/lib/minio";
import { getSessionUser } from "@/app/lib/auth/session";
import { pool } from "@/app/lib/db/pool";
import { logError } from "@/app/lib/http/logging";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getSessionUser();

    if (!userId) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: fileId } = await params;

    // Step 1: Get file from DB
    const result = await pool.query(
      `
      SELECT object_key, mime_type
      FROM files
      WHERE id = $1
        AND owner_id = $2
        AND deleted_at IS NULL
      `,
      [fileId, userId]
    );

    if (result.rows.length === 0) {
      return Response.json({ error: "File not found" }, { status: 404 });
    }

    const file = result.rows[0];

    // Step 2: Get file from MinIO
    const stream = await minioClient.getObject(
      "enderchest",
      file.object_key
    );

    // Step 3: Convert stream → buffer
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const fileBuffer = Buffer.concat(chunks);

    // Step 4: Return file
    return new Response(fileBuffer, {
      headers: {
        "Content-Type": file.mime_type,
        "Content-Disposition": "attachment",
      },
    });

  } catch (error: unknown) {
    logError("files.download.failed", { error: String(error) });
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
