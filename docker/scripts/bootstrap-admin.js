/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { Pool } = require("pg");

const SALT_ROUNDS = 12;

function validatePassword(password) {
  if (password.length < 12) {
    return "BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters.";
  }

  if (password.length > 128) {
    return "BOOTSTRAP_ADMIN_PASSWORD must be at most 128 characters.";
  }

  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  const strengthCount = [hasLower, hasUpper, hasNumber, hasSymbol].filter(Boolean)
    .length;

  if (strengthCount < 3) {
    return "BOOTSTRAP_ADMIN_PASSWORD must include at least three of: lowercase, uppercase, number, symbol.";
  }

  return null;
}

function getDefaultQuotaBytes() {
  const quota = Number(process.env.DEFAULT_QUOTA_BYTES ?? "10737418240");

  if (!Number.isSafeInteger(quota) || quota < 0) {
    throw new Error("DEFAULT_QUOTA_BYTES must be a non-negative integer.");
  }

  return quota;
}

async function bootstrapAdmin() {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
  });
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    const existingAdmins = await client.query(
      "SELECT id FROM users WHERE is_admin = true LIMIT 1"
    );

    if (existingAdmins.rowCount > 0) {
      console.log("Admin bootstrap skipped; an admin account already exists.");
      return;
    }

    const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

    if (!email || !password) {
      throw new Error(
        "Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD to create the first admin."
      );
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      throw new Error(passwordError);
    }

    const quota = getDefaultQuotaBytes();
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    await client.query("BEGIN");
    transactionStarted = true;

    const existingUsers = await client.query(
      "SELECT id FROM users WHERE email = $1 FOR UPDATE",
      [email]
    );

    let userId;

    if (existingUsers.rowCount > 0) {
      userId = existingUsers.rows[0].id;
      await client.query(
        "UPDATE users SET is_admin = true, status = 'active' WHERE id = $1",
        [userId]
      );
    } else {
      userId = crypto.randomUUID();
      await client.query(
        `
        INSERT INTO users (id, email, password_hash, is_admin, status)
        VALUES ($1, $2, $3, true, 'active')
        `,
        [userId, email, passwordHash]
      );
    }

    await client.query(
      `
      INSERT INTO quotas (user_id, allocated_bytes)
      VALUES ($1, $2)
      ON CONFLICT (user_id) DO NOTHING
      `,
      [userId, quota]
    );

    const rootFolders = await client.query(
      `
      SELECT id
      FROM folders
      WHERE owner_id = $1
        AND parent_id IS NULL
        AND deleted_at IS NULL
      LIMIT 1
      `,
      [userId]
    );

    if (rootFolders.rowCount === 0) {
      await client.query(
        `
        INSERT INTO folders (id, owner_id, parent_id, name)
        VALUES ($1, $2, NULL, 'root')
        `,
        [crypto.randomUUID(), userId]
      );
    }

    await client.query(
      `
      INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id)
      VALUES ($1, 'admin.bootstrap', 'user', $1)
      `,
      [userId]
    );

    await client.query("COMMIT");
    transactionStarted = false;
    console.log(`Initial admin ready: ${email}`);
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK");
    }

    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

bootstrapAdmin().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
