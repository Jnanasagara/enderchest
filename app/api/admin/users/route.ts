import { NextResponse } from "next/server";
import { query } from "@/app/lib/db";
import { pool } from "@/app/lib/db/pool";
import { getSessionUser, deleteUserSessions } from "@/app/lib/auth/session";
import { requireCsrf } from "@/app/lib/auth/csrf";
import { readJsonBody } from "@/app/lib/http/request";

export async function GET() {
  const userId = await getSessionUser();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminCheck = await query<{ is_admin: boolean }>(
    `SELECT is_admin FROM users WHERE id = $1`,
    [userId]
  );

  if (adminCheck.length === 0 || !adminCheck[0].is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await query(
    `
      SELECT
        id,
        email,
        status,
        is_admin
      FROM users
      ORDER BY email ASC
    `
  );

  return NextResponse.json(users);
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

  const adminCheck = await query<{ is_admin: boolean }>(
    `SELECT is_admin FROM users WHERE id = $1`,
    [userId]
  );

  if (adminCheck.length === 0 || !adminCheck[0].is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = await readJsonBody<{
    userIdToUpdate?: string;
    status?: string;
    isAdmin?: boolean;
  }>(req, {
    maxBytes: 4 * 1024,
  });

  if (parsed.error) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { userIdToUpdate, status, isAdmin } = parsed.value ?? {};

  if (!userIdToUpdate || (status === undefined && isAdmin === undefined)) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  if (status !== undefined && !["active", "disabled"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const adminCheck = await client.query<{ is_admin: boolean }>(
      "SELECT is_admin FROM users WHERE id = $1",
      [userId]
    );

    if (adminCheck.rowCount === 0 || !adminCheck.rows[0].is_admin) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const target = await client.query<{ is_admin: boolean }>(
      "SELECT is_admin FROM users WHERE id = $1",
      [userIdToUpdate]
    );

    if (target.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const targetIsAdmin = target.rows[0].is_admin;
    const removingAdmin = targetIsAdmin && isAdmin === false;
    const disablingAdmin = targetIsAdmin && status === "disabled";

    if (removingAdmin || disablingAdmin) {
      const otherAdmins = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM users WHERE is_admin = true AND id <> $1",
        [userIdToUpdate]
      );

      if (Number(otherAdmins.rows[0]?.count ?? "0") === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Cannot remove or suspend the last admin" },
          { status: 409 }
        );
      }
    }

    if (status !== undefined && isAdmin !== undefined) {
      await client.query(
        "UPDATE users SET status = $1, is_admin = $2 WHERE id = $3",
        [status, isAdmin, userIdToUpdate]
      );
    } else if (status !== undefined) {
      await client.query(
        "UPDATE users SET status = $1 WHERE id = $2",
        [status, userIdToUpdate]
      );
    } else if (isAdmin !== undefined) {
      await client.query(
        "UPDATE users SET is_admin = $1 WHERE id = $2",
        [isAdmin, userIdToUpdate]
      );
    }

    await client.query(
      `
      INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details)
      VALUES ($1, 'admin.user.update', 'user', $2, $3)
      `,
      [
        userId,
        userIdToUpdate,
        JSON.stringify({ status, isAdmin }),
      ]
    );

    await client.query("COMMIT");

    if (status === "disabled") {
      await deleteUserSessions(userIdToUpdate);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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

  const parsed = await readJsonBody<{ userIdToDelete?: string }>(req, {
    maxBytes: 4 * 1024,
  });

  if (parsed.error) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { userIdToDelete } = parsed.value ?? {};

  if (!userIdToDelete) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const adminCheck = await client.query<{ is_admin: boolean }>(
      "SELECT is_admin FROM users WHERE id = $1",
      [userId]
    );

    if (adminCheck.rowCount === 0 || !adminCheck.rows[0].is_admin) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const target = await client.query<{ is_admin: boolean }>(
      "SELECT is_admin FROM users WHERE id = $1",
      [userIdToDelete]
    );

    if (target.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (target.rows[0].is_admin) {
      const otherAdmins = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM users WHERE is_admin = true AND id <> $1",
        [userIdToDelete]
      );

      if (Number(otherAdmins.rows[0]?.count ?? "0") === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Cannot delete the last admin" },
          { status: 409 }
        );
      }
    }

    await client.query(
      `
      INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details)
      VALUES ($1, 'admin.user.delete', 'user', $2, '{}')
      `,
      [userId, userIdToDelete]
    );

    await client.query("DELETE FROM users WHERE id = $1", [userIdToDelete]);
    await client.query("COMMIT");

    return NextResponse.json({ success: true });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
