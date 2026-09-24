import { readdir, stat, statfs } from "node:fs/promises";
import { join } from "node:path";

export type DiskStatus =
  | { status: "ok"; totalBytes: string; availableBytes: string }
  | { status: "unavailable"; totalBytes: null; availableBytes: null };

export type BackupStatus =
  | { status: "found"; lastCompletedAt: string }
  | { status: "none" | "unavailable"; lastCompletedAt: null };

export async function readStorageDisk(path = "/status/storage"): Promise<DiskStatus> {
  try {
    const disk = await statfs(path, { bigint: true });
    return {
      status: "ok",
      totalBytes: (disk.blocks * disk.bsize).toString(),
      availableBytes: (disk.bavail * disk.bsize).toString(),
    };
  } catch {
    return { status: "unavailable", totalBytes: null, availableBytes: null };
  }
}

export async function readLatestBackup(path = "/status/backups"): Promise<BackupStatus> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    const candidates = entries.filter(entry => entry.isDirectory() && /^enderchest-\d{8}T\d{6}Z$/.test(entry.name));
    const markers = await Promise.all(candidates.map(async entry => {
      try {
        const marker = await stat(join(path, entry.name, "backup-complete.json"));
        return marker.isFile() ? marker.mtimeMs : null;
      } catch {
        return null;
      }
    }));
    const latest = Math.max(...markers.filter((value): value is number => value !== null));
    return Number.isFinite(latest)
      ? { status: "found", lastCompletedAt: new Date(latest).toISOString() }
      : { status: "none", lastCompletedAt: null };
  } catch {
    return { status: "unavailable", lastCompletedAt: null };
  }
}
