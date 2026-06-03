import { Pool } from "pg";
import { dbEnv } from "./env";

/**
 * Global cache to prevent multiple pools
 * during Next.js hot reloads (dev) and
 * module re-evaluation.
 */
declare global {
  var __pgPool: Pool | undefined;
}

export const pool: Pool =
  global.__pgPool ??
  new Pool({
    host: dbEnv.host,
    port: dbEnv.port,
    database: dbEnv.database,
    user: dbEnv.user,
    password: dbEnv.password,

    // conservative defaults
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 2_000,
  });

if (process.env.NODE_ENV !== "production") {
  global.__pgPool = pool;
}
