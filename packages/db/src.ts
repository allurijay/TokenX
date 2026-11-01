import "dotenv/config";
import pg from "pg";
pg.types.setTypeParser(20, (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error("Integer overflow");
  return n;
});
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
});
export type DB = pg.PoolClient;
export async function transaction<T>(fn: (db: DB) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const result = await fn(db);
      await db.query("COMMIT");
      return result;
    } catch (error: any) {
      await db.query("ROLLBACK");
      if (["40001", "40P01"].includes(error.code) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
        continue;
      }
      throw error;
    } finally {
      db.release();
    }
  }
}
export async function one<T = any>(
  db: DB,
  sql: string,
  args: unknown[] = [],
): Promise<T> {
  const r = await db.query(sql, args);
  return r.rows[0];
}
