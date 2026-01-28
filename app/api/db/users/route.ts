import { NextResponse } from "next/server";
import { query } from "@/app/lib/db";

export async function GET() {
  const users = await query(
    "SELECT id, email FROM users LIMIT 5"
  );

  return NextResponse.json({
    ok: true,
    count: users.length,
    users,
  });
}
