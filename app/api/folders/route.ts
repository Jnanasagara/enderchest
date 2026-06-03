import { NextResponse } from "next/server";
import crypto from "crypto";

import { query } from "@/app/lib/db";
import { hasPostgresCode } from "@/app/lib/db/errors";
import { getSessionUser } from "@/app/lib/auth/session";
import { requireCsrf } from "@/app/lib/auth/csrf";
import { readJsonBody } from "@/app/lib/http/request";
import { logError } from "@/app/lib/http/logging";


export async function GET(req: Request) {
  try {
    const userId = await getSessionUser();

    if (!userId) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const parentId = searchParams.get("parentId");

    if (!parentId) {
      return NextResponse.json({ error: "Missing parentId" }, { status: 400 });
    }

    // Step 1: Verify parent folder belongs to user
    const parentCheck = await query<{ id: string }>(
      `
      SELECT id
      FROM folders
      WHERE id = $1
        AND owner_id = $2
        AND deleted_at IS NULL
      `,
      [parentId, userId]
    );

    if (parentCheck.length === 0) {
      return NextResponse.json({ error: "Parent folder not found" }, { status: 404 });
    }

    // Step 2: Fetch child folders
    const folders = await query<{
      id: string;
      name: string;
    }>(
      `
      SELECT id, name
      FROM folders
      WHERE parent_id = $1
        AND owner_id = $2
        AND deleted_at IS NULL
      ORDER BY name
      `,
      [parentId, userId]
    );

    // Step 3: Fetch files (empty for now, but structure ready)
    const files = await query<{
      id: string;
      name: string;
      size_bytes: number;
    }>(
      `
      SELECT id, name, size_bytes
      FROM files
      WHERE folder_id = $1
        AND owner_id = $2
        AND deleted_at IS NULL
      ORDER BY created_at DESC
      `,
      [parentId, userId]
    );

    return NextResponse.json({
      folders,
      files: files.map(file => ({
        id: file.id,
        name: file.name,
        size: file.size_bytes,
        downloadUrl: `/api/files/${file.id}/download`
      }))
    });

  } catch (error) {
    logError("folders.list.failed", { error: String(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}


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

    const parsed = await readJsonBody<{ name?: string; parentId?: string }>(req, {
      maxBytes: 8 * 1024,
    });

    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { name, parentId } = parsed.value ?? {};

    if (!name || !parentId) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // Verify parent folder belongs to the user
    const parentFolders = await query<{ id: string }>(
      `
      SELECT id
      FROM folders
      WHERE id = $1
        AND owner_id = $2
        AND deleted_at IS NULL
      `,
      [parentId, userId]
    );

    if (parentFolders.length === 0) {
      return NextResponse.json({ error: "Parent folder not found" }, { status: 404 });
    }

    const folderId = crypto.randomUUID();

    const folders = await query<{
      id: string;
      name: string;
      parent_id: string;
    }>(
      `
      INSERT INTO folders (id, owner_id, parent_id, name, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      RETURNING id, name, parent_id
      `,
      [folderId, userId, parentId, name]
    );

    return NextResponse.json(folders[0]);
  } catch (error) {
    if (hasPostgresCode(error, "23505")) {
      return NextResponse.json(
        { error: "A folder with that name already exists" },
        { status: 409 }
      );
    }

    logError("folders.create.failed", { error: String(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
