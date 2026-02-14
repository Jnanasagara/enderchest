import { NextResponse } from "next/server";
import { query } from "@/app/lib/db";

export async function GET() {
  const rows = await query("SELECT 1");

  return NextResponse.json({
    ok: true,
    result: rows[0],
  });
}
