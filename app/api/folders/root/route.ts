import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { query } from "@/app/lib/db";
import { getSessionUser } from "@/app/lib/auth/session";

export async function GET() {
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

    const folders = await query<{
      id: string;
      name: string;
    }>(
      `
      SELECT id, name
      FROM folders
      WHERE owner_id = $1
        AND parent_id IS NULL
        AND deleted_at IS NULL
      LIMIT 1
      `,
      [userId]
    );

    if (folders.length === 0) {
      return NextResponse.json({ error: "Root folder not found" }, { status: 404 });
    }

    return NextResponse.json(folders[0]);

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}