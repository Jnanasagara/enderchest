import { NextResponse } from "next/server";
import { query } from "@/app/lib/db";
import { getSessionUser } from "@/app/lib/auth/session";
import { requireCsrf } from "@/app/lib/auth/csrf";
import { readJsonBody } from "@/app/lib/http/request";

export async function GET() {
  const userId = await getSessionUser();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminCheck = await query<{ is_admin: boolean }>(
    "SELECT is_admin FROM users WHERE id = $1",
    [userId]
  );

  if (adminCheck.length === 0 || !adminCheck[0].is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await query(
    `
    SELECT
      users.id AS user_id,
      users.email,
      quotas.allocated_bytes,
      quotas.used_bytes,
      quotas.updated_at
    FROM users
    INNER JOIN quotas ON quotas.user_id = users.id
    ORDER BY users.email ASC
    `
  );

  return NextResponse.json(rows);
}

export async function PATCH(req: Request) {
  const csrfError = requireCsrf(req);
  if (csrfError) {
    return NextResponse.json({ error: csrfError }, { status: 403 });
  }

  const userId = await getSessionUser();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminCheck = await query<{ is_admin: boolean }>(
    "SELECT is_admin FROM users WHERE id = $1",
    [userId]
  );

  if (adminCheck.length === 0 || !adminCheck[0].is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = await readJsonBody<{ userId?: string; allocatedBytes?: number }>(req, {
    maxBytes: 4 * 1024,
  });

  if (parsed.error) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { userId: targetUserId, allocatedBytes } = parsed.value ?? {};

  if (!targetUserId || allocatedBytes === undefined) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  if (!Number.isSafeInteger(allocatedBytes) || allocatedBytes < 0) {
    return NextResponse.json({ error: "Invalid quota" }, { status: 400 });
  }

  const result = await query(
    `
    UPDATE quotas
    SET allocated_bytes = $1
    WHERE user_id = $2
    RETURNING user_id
    `,
    [allocatedBytes, targetUserId]
  );

  if (result.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  await query(
    `
    INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details)
    VALUES ($1, 'admin.quota.update', 'quota', $2, $3)
    `,
    [userId, targetUserId, JSON.stringify({ allocatedBytes })]
  );

  return NextResponse.json({ success: true });
}
