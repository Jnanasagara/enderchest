import { minioClient } from "@/app/lib/minio";
import { getSessionUser } from "@/app/lib/auth/session";
import { v4 as uuidv4 } from "uuid";
import { NextRequest } from "next/server";
import { pool } from "@/app/lib/db/pool";

export async function POST(req: NextRequest) {
  try {
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

    const buffer = Buffer.from(await file.arrayBuffer());

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
    await pool.query(
      `
      INSERT INTO files (id, folder_id, owner_id, object_key, size_bytes, mime_type)
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [fileId, folderId, userId, objectKey, buffer.length, file.type]
    );

    return Response.json({
      success: true,
      fileId,
      objectKey,
    });

  } catch (err) {
    return Response.json({
      error: String(err),
    });
  }
}