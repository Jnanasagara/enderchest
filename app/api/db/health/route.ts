import { NextResponse } from "next/server";
import { pool } from "@/app/lib/db/pool";

export async function GET() {
  const result = await pool.query("SELECT 1");

  return NextResponse.json({
    ok: true,
    result: result.rows[0],
  });
}
