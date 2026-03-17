import { NextResponse } from "next/server";
import { query } from "@/app/lib/db";
import { hashPassword } from "@/app/lib/auth/password";

export async function POST(req: Request) {
  const body = await req.json();
  const { email, password, inviteToken } = body;

  if (!email || !password || !inviteToken) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const invites = await query<{
    id: string;
    expires_at: Date;
    used_at: Date | null;
  }>(
    `
      SELECT id, expires_at, used_at
      FROM invites
      WHERE token = $1
    `,
    [inviteToken]
  );

  if (invites.length === 0) {
    return NextResponse.json({ error: "Invalid invite" }, { status: 400 });
  }

  const invite = invites[0];

  if (invite.used_at) {
    return NextResponse.json({ error: "Invite already used" }, { status: 400 });
  }

  if (new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: "Invite expired" }, { status: 400 });
  }

  const existingUsers = await query(
    `SELECT id FROM users WHERE email = $1`,
    [email]
  );

  if (existingUsers.length > 0) {
    return NextResponse.json({ error: "Email already registered" }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);

  const newUsers = await query<{ id: string }>(
    `
      INSERT INTO users (email, password_hash, status, is_admin)
      VALUES ($1, $2, 'active', false)
      RETURNING id
    `,
    [email, passwordHash]
  );

  const newUserId = newUsers[0].id;

  const rootFolderId = crypto.randomUUID();

  await query(
    `
    INSERT INTO folders (id, owner_id, parent_id, name, created_at, updated_at)
    VALUES ($1, $2, NULL, 'root', NOW(), NOW())
    `,
    [rootFolderId, newUserId]
  );

  await query(
    `
      UPDATE invites
      SET used_at = NOW(), used_by = $1
      WHERE id = $2
    `,
    [newUserId, invite.id]
  );

  return NextResponse.json({ success: true });
}
