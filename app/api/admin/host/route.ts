import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/lib/auth/session";
import { query } from "@/app/lib/db";
import { readLatestBackup, readStorageDisk } from "@/app/lib/host-status";
import { objectStorage } from "@/app/lib/storage/s3";

export async function GET() {
  const userId = await getSessionUser();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = await query<{ is_admin: boolean }>("SELECT is_admin FROM users WHERE id = $1", [userId]);
  if (!admin[0]?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [garage, disk, backup] = await Promise.all([
    objectStorage.checkHealth().then(() => "healthy" as const).catch(() => "unhealthy" as const),
    readStorageDisk(),
    readLatestBackup(),
  ]);
  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    services: { app: "healthy", database: "healthy", garage },
    disk,
    backup,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
