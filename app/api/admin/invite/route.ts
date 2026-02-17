import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { query } from "@/app/lib/db";
import { getSessionUser } from "@/app/lib/auth/session";

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("session")?.value;

  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = await getSessionUser(sessionId);

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await query<{
    id: string;
    is_admin: boolean;
  }>(
    `
    SELECT id, is_admin
    FROM users
    WHERE id = $1
    `,
    [userId]
  );

  if (users.length === 0) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = users[0];

  if (!user.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { expiresInHours } = body;

  const expirationHours = expiresInHours ?? 24;

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + expirationHours * 60 * 60 * 1000);

  await query(
    `
      INSERT INTO invites (token, created_by, expires_at)
      VALUES ($1, $2, $3)
    `,
    [token, user.id, expiresAt]
  );

  return NextResponse.json({
    token,
    expiresAt,
  });
}


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

  const users = await query<{ is_admin: boolean }>(
    `SELECT is_admin FROM users WHERE id = $1`,
    [userId]
  );

  if (users.length === 0 || !users[0].is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const invites = await query(
    `
      SELECT
        id,
        token,
        created_by,
        used_by,
        expires_at,
        used_at,
        created_at
      FROM invites
      ORDER BY created_at DESC
    `
  );

  return NextResponse.json(invites);
}


export async function DELETE(req: Request) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("session")?.value;

  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = await getSessionUser(sessionId);

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await query<{ is_admin: boolean }>(
    `SELECT is_admin FROM users WHERE id = $1`,
    [userId]
  );

  if (users.length === 0 || !users[0].is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { inviteId } = body;

  if (!inviteId) {
    return NextResponse.json({ error: "Missing inviteId" }, { status: 400 });
  }

  await query(
    `
      DELETE FROM invites
      WHERE id = $1
        AND used_at IS NULL
    `,
    [inviteId]
  );

  return NextResponse.json({ success: true });
}
