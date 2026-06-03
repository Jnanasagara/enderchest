import { NextResponse } from "next/server";
import { query } from "@/app/lib/db";
import { getSessionUser } from "@/app/lib/auth/session";

export async function GET(req: Request) {
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

  const { searchParams } = new URL(req.url);
  const limitParam = Number(searchParams.get("limit") ?? 100);
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), 500)
    : 100;

  const logs = await query(
    `
    SELECT
      id,
      actor_user_id,
      action,
      entity_type,
      entity_id,
      details,
      created_at
    FROM audit_logs
    ORDER BY created_at DESC
    LIMIT $1
    `,
    [limit]
  );

  return NextResponse.json(logs);
}
