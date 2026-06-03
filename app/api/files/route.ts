import { NextResponse } from "next/server";
import crypto from "crypto";

import { query } from "@/app/lib/db";
import { hasPostgresCode } from "@/app/lib/db/errors";
import { getSessionUser } from "@/app/lib/auth/session";
import { requireCsrf } from "@/app/lib/auth/csrf";
import { readJsonBody } from "@/app/lib/http/request";
import { logError } from "@/app/lib/http/logging";

export async function POST(req: Request) {
  try {
    const csrfError = requireCsrf(req);
    if (csrfError) {
      return NextResponse.json({ error: csrfError }, { status: 403 });
    }

    const userId = await getSessionUser();

    if (!userId) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const parsed = await readJsonBody<{
      name?: string;
      folderId?: string;
      size?: number;
      mimeType?: string;
    }>(req, { maxBytes: 16 * 1024 });

    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { name, folderId, size, mimeType } = parsed.value ?? {};

    if (!name || !folderId || !size || !mimeType) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // Verify folder belongs to user
    const folderCheck = await query<{ id: string }>(
      `
      SELECT id
      FROM folders
      WHERE id = $1
        AND owner_id = $2
        AND deleted_at IS NULL
      `,
      [folderId, userId]
    );

    if (folderCheck.length === 0) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }

    const fileId = crypto.randomUUID();

    // Generate object key (userId + uuid)
    const objectKey = `${userId}/${crypto.randomUUID()}`;

    const files = await query<{
      id: string;
      object_key: string;
      size_bytes: number;
      mime_type: string;
    }>(
      `
      INSERT INTO files (
        id,
        owner_id,
        folder_id,
        name,
        object_key,
        size_bytes,
        mime_type,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING id, object_key, size_bytes, mime_type
      `,
      [fileId, userId, folderId, name, objectKey, size, mimeType]
    );

    return NextResponse.json(files[0]);

  } catch (error) {
    if (hasPostgresCode(error, "23505")) {
      return NextResponse.json(
        { error: "A file with that name already exists" },
        { status: 409 }
      );
    }

    logError("files.create.failed", { error: String(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
