import { redirect } from "next/navigation";
import { getSessionUser } from "@/app/lib/auth/session";
import { pool } from "@/app/lib/db/pool";
import { publicAppUrl } from "@/app/lib/public-url";
import AdminClient from "./admin-client";

export default async function AdminPage() {
  const userId = await getSessionUser();
  if (!userId) redirect("/login");
  const user = await pool.query<{ is_admin: boolean }>("SELECT is_admin FROM users WHERE id = $1", [userId]);
  if (!user.rows[0]?.is_admin) redirect("/");
  return <AdminClient publicAppUrl={publicAppUrl(process.env.PUBLIC_APP_URL)} />;
}
