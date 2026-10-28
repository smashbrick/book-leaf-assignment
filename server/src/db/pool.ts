import pg from "pg";
import { config } from "../config.js";

// Return DATE columns as "YYYY-MM-DD" strings instead of JS Dates shifted into the server's timezone.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  // Managed providers' public endpoints require TLS; local Docker and private networks don't.
  ssl: config.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
});

export type Queryable = Pick<pg.Pool, "query">;

/** Runs `fn` inside a transaction, rolling back if it throws. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
