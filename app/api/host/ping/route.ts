import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ ok: true }, {
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
  });
}
