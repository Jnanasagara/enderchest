import { pool } from "@/app/lib/db/pool";

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number | null;
};

export async function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number,
  blockMs: number
): Promise<RateLimitResult> {
  const client = await pool.connect();
  const now = new Date();

  try {
    await client.query("BEGIN");

    const existing = await client.query<{
      window_start: Date;
      attempts: number;
      blocked_until: Date | null;
    }>(
      "SELECT window_start, attempts, blocked_until FROM rate_limits WHERE key = $1 FOR UPDATE",
      [key]
    );

    if (existing.rows.length === 0) {
      await client.query(
        "INSERT INTO rate_limits (key, window_start, attempts) VALUES ($1, $2, $3)",
        [key, now, 1]
      );
      await client.query("COMMIT");
      return { allowed: true, retryAfterSeconds: null };
    }

    const row = existing.rows[0];

    if (row.blocked_until && row.blocked_until > now) {
      await client.query("COMMIT");
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(
          (row.blocked_until.getTime() - now.getTime()) / 1000
        ),
      };
    }

    const windowElapsedMs = now.getTime() - row.window_start.getTime();
    const windowExpired = windowElapsedMs >= windowMs;
    const nextAttempts = windowExpired ? 1 : row.attempts + 1;
    const nextWindowStart = windowExpired ? now : row.window_start;

    let blockedUntil: Date | null = null;
    if (nextAttempts > maxAttempts) {
      blockedUntil = new Date(now.getTime() + blockMs);
    }

    await client.query(
      "UPDATE rate_limits SET window_start = $1, attempts = $2, blocked_until = $3 WHERE key = $4",
      [nextWindowStart, nextAttempts, blockedUntil, key]
    );

    await client.query("COMMIT");

    if (blockedUntil) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(blockMs / 1000),
      };
    }

    return { allowed: true, retryAfterSeconds: null };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
