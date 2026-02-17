import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { query } from "@/app/lib/db";
import { getSessionUser } from "@/app/lib/auth/session";

export async function GET() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("session")?.value;

  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = await getSessionUser(sessionId);

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminCheck = await query<{ is_admin: boolean }>(
    `SELECT is_admin FROM users WHERE id = $1`,
    [userId]
  );

  if (adminCheck.length === 0 || !adminCheck[0].is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await query(
    `
      SELECT
        id,
        email,
        status,
        is_admin
      FROM users
      ORDER BY email ASC
    `
  );

  return NextResponse.json(users);
}


export async function PATCH(req: Request) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("session")?.value;

  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = await getSessionUser(sessionId);

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminCheck = await query<{ is_admin: boolean }>(
    `SELECT is_admin FROM users WHERE id = $1`,
    [userId]
  );

  if (adminCheck.length === 0 || !adminCheck[0].is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { userIdToUpdate, status } = body;

  if (!userIdToUpdate || !status) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  await query(
    `
      UPDATE users
      SET status = $1
      WHERE id = $2
    `,
    [status, userIdToUpdate]
  );

  return NextResponse.json({ success: true });
}
