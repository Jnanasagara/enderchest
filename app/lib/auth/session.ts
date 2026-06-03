import crypto from "crypto";
import { query } from "@/app/lib/db";
import { cookies } from "next/headers";

export const SESSION_TTL_DAYS = 7;
const PRUNE_PROBABILITY = 0.02;

async function maybePruneExpiredSessions(): Promise<void> {
  if (Math.random() > PRUNE_PROBABILITY) return;
  await deleteExpiredSessions();
}

export async function createSession(userId: string): Promise<string> {
  const sessionId = crypto.randomUUID();

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_TTL_DAYS);

  await maybePruneExpiredSessions();

  await query(
    `
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES ($1, $2, $3)
    `,
    [sessionId, userId, expiresAt]
  );

  return sessionId;
}


export async function getSessionUser(sessionId?: string) {
  // If session not provided → read from cookies
  if (!sessionId) {
    const cookieStore = await cookies();
    sessionId = cookieStore.get("session")?.value;
  }

  if (!sessionId) return null;

  await maybePruneExpiredSessions();

  const sessions = await query<{ user_id: string }>(
    `
    SELECT sessions.user_id
    FROM sessions
    INNER JOIN users ON users.id = sessions.user_id
    WHERE sessions.id = $1
      AND sessions.expires_at > now()
      AND users.status = 'active'
    `,
    [sessionId]
  );

  if (sessions.length === 0) return null;

  return sessions[0].user_id;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await query(
    `
    DELETE FROM sessions
    WHERE id = $1
    `,
    [sessionId]
  );
}

export async function deleteUserSessions(userId: string): Promise<void> {
  await query(
    `
    DELETE FROM sessions
    WHERE user_id = $1
    `,
    [userId]
  );
}


export async function deleteExpiredSessions(): Promise<void> {
  await query(
    `
    DELETE FROM sessions
    WHERE expires_at <= now()
    `
  );
}
