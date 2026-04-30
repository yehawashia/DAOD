import { Pool } from "pg";

declare global {
  // Prevent multiple Pool instances in Next.js hot-reload
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

// In development, reuse the pool across hot reloads
const pool: Pool =
  process.env.NODE_ENV === "production"
    ? createPool()
    : (global.__pgPool ?? (global.__pgPool = createPool()));

export default pool;

/** Convenience wrapper — runs a query and returns rows */
export async function query<T extends Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}
