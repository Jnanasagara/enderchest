import { getSessionUser, deleteUserSessions } from "@/app/lib/auth/session";
import { requireCsrf } from "@/app/lib/auth/csrf";
import { verifyPassword, hashPassword } from "@/app/lib/auth/password";
import { validatePassword } from "@/app/lib/auth/validation";
import { readJsonBody } from "@/app/lib/http/request";
import { pool } from "@/app/lib/db/pool";
import { logError } from "@/app/lib/http/logging";

export async function POST(req: Request) {
  const csrfError = requireCsrf(req);
  if (csrfError) return Response.json({ error: csrfError }, { status: 403 });
  const userId = await getSessionUser();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = await readJsonBody<{ currentPassword?: string; newPassword?: string }>(req, { maxBytes: 4096 });
  if (parsed.error) return Response.json({ error: parsed.error }, { status: 400 });
  const { currentPassword, newPassword } = parsed.value ?? {};
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") return Response.json({ error: "Missing password" }, { status: 400 });
  const validation = validatePassword(newPassword);
  if (validation) return Response.json({ error: validation }, { status: 400 });
  try {
    const user = await pool.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [userId]);
    if (!user.rows[0] || !await verifyPassword(currentPassword, user.rows[0].password_hash)) return Response.json({ error: "Current password is incorrect" }, { status: 403 });
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [await hashPassword(newPassword), userId]);
    await deleteUserSessions(userId);
    return Response.json({ success: true });
  } catch (error) {
    logError("password.change.failed", { error: String(error) });
    return Response.json({ error: "Could not change password" }, { status: 500 });
  }
}
