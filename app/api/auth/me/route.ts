import { NextResponse } from "next/server";
import { query } from "@/app/lib/db";
import { getSessionUser } from "@/app/lib/auth/session";

export async function GET(req: Request) {
  const sessionId = req.headers
    .get("cookie")
    ?.split("; ")
    .find((c) => c.startsWith("session="))
    ?.split("=")[1];

  if (!sessionId) {
    return NextResponse.json({ user: null });
  }

  const userId = await getSessionUser(sessionId);

  if (!userId) {
    return NextResponse.json({ user: null });
  }

  const users = await query<{
    id: string;
    email: string;
    is_admin: boolean
  }>(
    `
    SELECT id, email, is_admin
    FROM users
    WHERE id = $1
    `,
    [userId]
  );

  if(users.length === 0){
    return NextResponse.json({ user: null });
  }

  return NextResponse.json({ user: users[0] });
}
