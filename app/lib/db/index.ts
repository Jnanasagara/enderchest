import { pool } from "./pool";

/**
 * Typed DB query wrapper.
 * This is the ONLY allowed way to talk to Postgres.
 */
export async function query<T = unknown>(
  text: string,
  params?: readonly unknown[]
): Promise<T[]> {
  try {
    let result;

    if (params === undefined) {
      result = await pool.query(text);
    } else {
      // pg overloads REQUIRE a mutable array type
      result = await pool.query(text, params as any[]);
    }

    return result.rows as T[];
  } catch (error) {
    console.error("DB query failed", {
      text,
      params,
      error,
    });
    throw error;
  }
}
