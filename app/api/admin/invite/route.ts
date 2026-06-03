import { NextResponse } from "next/server";
import crypto from "crypto";
import { query } from "@/app/lib/db";
import { getSessionUser } from "@/app/lib/auth/session";
import { requireCsrf } from "@/app/lib/auth/csrf";
import { checkRateLimit } from "@/app/lib/auth/rate-limit";
import { getClientIp, readJsonBody } from "@/app/lib/http/request";

export async function POST(req: Request) {
  const csrfError = requireCsrf(req);
  if (csrfError) {
    return NextResponse.json({ error: csrfError }, { status: 403 });
  }

  const userId = await getSessionUser();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await query<{
    id: string;
    is_admin: boolean;
  }>(
    `
    SELECT id, is_admin
    FROM users
    WHERE id = $1
    `,
    [userId]
  );

  if (users.length === 0) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = users[0];

  if (!user.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = await readJsonBody<{ expiresInHours?: number }>(req, {
    maxBytes: 4 * 1024,
  });

  if (parsed.error) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { expiresInHours } = parsed.value ?? {};
  const defaultExpires = Number(process.env.INVITE_DEFAULT_EXPIRES_HOURS ?? 24);
  const fallbackExpires = Number.isFinite(defaultExpires) ? defaultExpires : 24;
  const expirationHours = expiresInHours ?? fallbackExpires;
  if (!Number.isFinite(expirationHours) || expirationHours <= 0) {
    return NextResponse.json({ error: "Invalid expiration" }, { status: 400 });
  }

  const ip = getClientIp(req);
  const rateKey = `invite:${ip}:${userId}`;
  const maxAttempts = Number(process.env.INVITE_RATE_LIMIT_MAX ?? 10);
  const windowMs = Number(process.env.INVITE_RATE_LIMIT_WINDOW_MS ?? 60 * 60 * 1000);
  const blockMs = Number(process.env.INVITE_RATE_LIMIT_BLOCK_MS ?? 60 * 60 * 1000);
  const rate = await checkRateLimit(rateKey, maxAttempts, windowMs, blockMs);

  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many invites" },
      { status: 429, headers: rate.retryAfterSeconds ? { "Retry-After": String(rate.retryAfterSeconds) } : undefined }
    );
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + expirationHours * 60 * 60 * 1000);

  const createdInvites = await query<{ id: string }>(
    `
      INSERT INTO invites (token, created_by, expires_at)
      VALUES ($1, $2, $3)
      RETURNING id
    `,
    [token, user.id, expiresAt]
  );

  const inviteId = createdInvites[0]?.id ?? null;

  await query(
    `
    INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details)
    VALUES ($1, 'admin.invite.create', 'invite', $2, $3)
    `,
    [user.id, inviteId, JSON.stringify({ expiresAt })]
  );

  return NextResponse.json({
    token,
    expiresAt,
  });
}


export async function GET() {
  const userId = await getSessionUser();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await query<{ is_admin: boolean }>(
    `SELECT is_admin FROM users WHERE id = $1`,
    [userId]
  );

  if (users.length === 0 || !users[0].is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const invites = await query(
    `
      SELECT
        id,
        token,
        created_by,
        used_by,
        expires_at,
        used_at,
        created_at
      FROM invites
      ORDER BY created_at DESC
    `
  );

  return NextResponse.json(invites);
}


export async function DELETE(req: Request) {
  const csrfError = requireCsrf(req);
  if (csrfError) {
    return NextResponse.json({ error: csrfError }, { status: 403 });
  }

  const userId = await getSessionUser();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await query<{ is_admin: boolean }>(
    `SELECT is_admin FROM users WHERE id = $1`,
    [userId]
  );

  if (users.length === 0 || !users[0].is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = await readJsonBody<{ inviteId?: string }>(req, { maxBytes: 4 * 1024 });
  if (parsed.error) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { inviteId } = parsed.value ?? {};

  if (!inviteId) {
    return NextResponse.json({ error: "Missing inviteId" }, { status: 400 });
  }

  const deletedInvites = await query<{ id: string }>(
    `
      DELETE FROM invites
      WHERE id = $1
        AND used_at IS NULL
      RETURNING id
    `,
    [inviteId]
  );

  if (deletedInvites.length === 0) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  await query(
    `
    INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details)
    VALUES ($1, 'admin.invite.delete', 'invite', $2, '{}')
    `,
    [userId, inviteId]
  );

  return NextResponse.json({ success: true });
}

export async function PATCH(req: Request) {
  const csrfError = requireCsrf(req);
  if (csrfError) {
    return NextResponse.json({ error: csrfError }, { status: 403 });
  }

  const userId = await getSessionUser();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await query<{ is_admin: boolean }>(
    `SELECT is_admin FROM users WHERE id = $1`,
    [userId]
  );

  if (users.length === 0 || !users[0].is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = await readJsonBody<{ inviteId?: string }>(req, { maxBytes: 4 * 1024 });
  if (parsed.error) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { inviteId } = parsed.value ?? {};

  if (!inviteId) {
    return NextResponse.json({ error: "Missing inviteId" }, { status: 400 });
  }

  const result = await query(
    `
    UPDATE invites
    SET expires_at = NOW()
    WHERE id = $1
      AND used_at IS NULL
    RETURNING id
    `,
    [inviteId]
  );

  if (result.length === 0) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  await query(
    `
    INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details)
    VALUES ($1, 'admin.invite.revoke', 'invite', $2, '{}')
    `,
    [userId, inviteId]
  );

  return NextResponse.json({ success: true });
}
