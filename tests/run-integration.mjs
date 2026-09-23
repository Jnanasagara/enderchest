import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import bcrypt from "bcrypt";

const email = `integration-${randomUUID()}@example.invalid`;
const password = randomBytes(24).toString("base64url");
const id = randomUUID();
const client = new pg.Client({
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
});

await client.connect();
try {
  await client.query("BEGIN");
  await client.query("INSERT INTO users (id, email, password_hash, is_admin, status) VALUES ($1,$2,$3,true,'active')", [id, email, await bcrypt.hash(password, 12)]);
  await client.query("INSERT INTO quotas (user_id, allocated_bytes) VALUES ($1, $2)", [id, 1024 ** 3]);
  await client.query("INSERT INTO folders (id, owner_id, parent_id, name) VALUES ($1,$2,NULL,'root')", [randomUUID(), id]);
  await client.query("COMMIT");
  let failed = false;
  for (const file of ["tests/admin-api.test.mjs", "tests/storage-api.test.mjs"]) {
    const result = spawnSync(process.execPath, ["--test", file], {
      stdio: "inherit",
      env: { ...process.env, TEST_ADMIN_EMAIL: email, TEST_ADMIN_PASSWORD: password, TEST_FETCH_PRESIGNED: "false" },
    });
    if (result.status !== 0) failed = true;
  }
  if (failed) process.exitCode = 1;
} finally {
  await client.query("DELETE FROM users WHERE id = $1", [id]);
  await client.end();
}
