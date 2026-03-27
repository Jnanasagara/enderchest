import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";

import { query } from "@/app/lib/db";
import { getSessionUser } from "@/app/lib/auth/session";


export async function GET(req: Request) {
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
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}


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
    const { name, parentId } = body;

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
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}