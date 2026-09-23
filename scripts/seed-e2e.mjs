import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import pg from "pg";

if (process.env.E2E_ISOLATED !== "yes") throw new Error("Refusing to seed outside an explicitly isolated test stack");
const email = `e2e-${randomUUID()}@example.invalid`;
const password = randomBytes(24).toString("base64url");
const id = randomUUID();
const db = new pg.Client({
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
});
await db.connect();
try {
  await db.query("BEGIN");
  await db.query("INSERT INTO users (id, email, password_hash, is_admin, status) VALUES ($1,$2,$3,true,'active')", [id, email, await bcrypt.hash(password, 12)]);
  await db.query("INSERT INTO quotas (user_id, allocated_bytes) VALUES ($1, $2)", [id, 1024 ** 3]);
  await db.query("INSERT INTO folders (id, owner_id, parent_id, name) VALUES ($1,$2,NULL,'root')", [randomUUID(), id]);
  await db.query("COMMIT");
  process.stdout.write(JSON.stringify({ email, password }) + "\n");
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  await db.end();
}
