import { getSessionUser } from "@/app/lib/auth/session";
import { pool } from "@/app/lib/db/pool";

export async function GET() {
  const userId = await getSessionUser();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const result = await pool.query("SELECT id, name, parent_id FROM folders WHERE owner_id = $1 AND deleted_at IS NULL ORDER BY name", [userId]);
  return Response.json(result.rows);
}
