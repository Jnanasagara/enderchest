import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";

import { query } from "@/app/lib/db";
import { getSessionUser } from "@/app/lib/auth/session";

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get("session")?.value;

    if (!sessionId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = await getSessionUser(sessionId);

    if (!userId) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const body = await req.json();
    const { name, folderId, size, mimeType } = body;

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
        object_key,
        size_bytes,
        mime_type,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING id, object_key, size_bytes, mime_type
      `,
      [fileId, userId, folderId, objectKey, size, mimeType]
    );

    return NextResponse.json(files[0]);

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}