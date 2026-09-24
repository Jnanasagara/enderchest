import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import hostStatus from "../app/lib/host-status.ts";

test("disk status reports capacity and handles missing mounts", async () => {
  const root = await mkdtemp(join(tmpdir(), "enderchest-host-"));
  try {
    const available = await hostStatus.readStorageDisk(root);
    assert.equal(available.status, "ok");
    assert.ok(BigInt(available.totalBytes) > 0n);
    assert.ok(BigInt(available.availableBytes) >= 0n);
    assert.equal((await hostStatus.readStorageDisk(join(root, "missing"))).status, "unavailable");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("only completed backups contribute to latest backup time", async () => {
  const root = await mkdtemp(join(tmpdir(), "enderchest-backup-status-"));
  try {
    assert.deepEqual(await hostStatus.readLatestBackup(root), { status: "none", lastCompletedAt: null });
    await mkdir(join(root, "enderchest-20260101T000000Z"));
    assert.equal((await hostStatus.readLatestBackup(root)).status, "none");
    await writeFile(join(root, "enderchest-20260101T000000Z", "backup-complete.json"), "{}");
    const complete = await hostStatus.readLatestBackup(root);
    assert.equal(complete.status, "found");
    assert.ok(Date.parse(complete.lastCompletedAt) > 0);
    await mkdir(join(root, "enderchest-20260102T000000Z"));
    assert.deepEqual(await hostStatus.readLatestBackup(root), complete);
    assert.equal((await hostStatus.readLatestBackup(join(root, "missing"))).status, "unavailable");
  } finally { await rm(root, { recursive: true, force: true }); }
});
