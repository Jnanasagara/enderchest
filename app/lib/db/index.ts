import { QueryResultRow } from "pg";
import { pool } from "./pool";

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: readonly unknown[]
): Promise<T[]> {
  try {
    const result = params
      ? await pool.query<T>(text, params as any[])
      : await pool.query<T>(text);

    return result.rows;
  } catch (error) {
    console.error("DB query failed", { text, params, error });
    throw error;
  }
}
