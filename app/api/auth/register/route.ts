import { NextResponse } from "next/server";
import crypto from "crypto";
import { hashPassword } from "@/app/lib/auth/password";
import { hasPostgresCode } from "@/app/lib/db/errors";
import { pool } from "@/app/lib/db/pool";
import { getDefaultQuotaBytes } from "@/app/lib/storage/quota";
import { normalizeEmail, isValidEmail, validatePassword } from "@/app/lib/auth/validation";
import { checkRateLimit } from "@/app/lib/auth/rate-limit";
import { getClientIp, readJsonBody } from "@/app/lib/http/request";
import { logError } from "@/app/lib/http/logging";

export async function POST(req: Request) {
  const parsed = await readJsonBody<{
    email?: string;
    password?: string;
    inviteToken?: string;
  }>(req, { maxBytes: 8 * 1024 });

  if (parsed.error) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { password, inviteToken } = parsed.value ?? {};
  const email = parsed.value?.email ? normalizeEmail(parsed.value.email) : "";

  if (!email || !password || !inviteToken) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 });
  }

  const ip = getClientIp(req);
  const rateKey = `register:${ip}:${email}`;
  const maxAttempts = Number(process.env.REGISTER_RATE_LIMIT_MAX ?? 5);
  const windowMs = Number(process.env.REGISTER_RATE_LIMIT_WINDOW_MS ?? 30 * 60 * 1000);
  const blockMs = Number(process.env.REGISTER_RATE_LIMIT_BLOCK_MS ?? 30 * 60 * 1000);
  const rate = await checkRateLimit(rateKey, maxAttempts, windowMs, blockMs);

  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many registration attempts" },
      { status: 429, headers: rate.retryAfterSeconds ? { "Retry-After": String(rate.retryAfterSeconds) } : undefined }
    );
  }

  const passwordHash = await hashPassword(password);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const invites = await client.query<{
      id: string;
      expires_at: Date;
      used_at: Date | null;
    }>(
      `
      SELECT id, expires_at, used_at
      FROM invites
      WHERE token = $1
      FOR UPDATE
      `,
      [inviteToken]
    );

    if (invites.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Invalid invite" }, { status: 400 });
    }

    const invite = invites.rows[0];

    if (invite.used_at) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Invite already used" }, { status: 400 });
    }

    if (new Date(invite.expires_at) < new Date()) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Invite expired" }, { status: 400 });
    }

    const existingUsers = await client.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    if (existingUsers.rows.length > 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 400 }
      );
    }

    const newUserId = crypto.randomUUID();

    await client.query(
      `
      INSERT INTO users (id, email, password_hash, status, is_admin)
      VALUES ($1, $2, $3, 'active', false)
      `,
      [newUserId, email, passwordHash]
    );

    await client.query(
      `
      INSERT INTO quotas (user_id, allocated_bytes)
      VALUES ($1, $2)
      `,
      [newUserId, getDefaultQuotaBytes()]
    );

    await client.query(
      `
      INSERT INTO folders (id, owner_id, parent_id, name)
      VALUES ($1, $2, NULL, 'root')
      `,
      [crypto.randomUUID(), newUserId]
    );

    await client.query(
      `
      UPDATE invites
      SET used_at = NOW(), used_by = $1
      WHERE id = $2
      `,
      [newUserId, invite.id]
    );

    await client.query(
      `
      INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id)
      VALUES ($1, 'user.register', 'user', $1)
      `,
      [newUserId]
    );

    await client.query("COMMIT");
    return NextResponse.json({ success: true });
  } catch (error) {
    await client.query("ROLLBACK");

    if (hasPostgresCode(error, "23505")) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 409 }
      );
    }

    logError("register.failed", { error: String(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    client.release();
  }
}
