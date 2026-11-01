import { pool, transaction } from "./src.js";
import { readdir, readFile } from "node:fs/promises";
await transaction(async (db) => {
  await db.query("SELECT pg_advisory_xact_lock(92710)");
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migration(name text PRIMARY KEY, applied_at timestamptz DEFAULT now())",
  );
  for (const name of (await readdir(new URL("./migrations/", import.meta.url)))
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    if (
      (await db.query("SELECT 1 FROM schema_migration WHERE name=$1", [name]))
        .rowCount
    )
      continue;
    await db.query(
      await readFile(new URL("./migrations/" + name, import.meta.url), "utf8"),
    );
    await db.query("INSERT INTO schema_migration(name) VALUES($1)", [name]);
    console.log("Applied", name);
  }
});
await pool.end();
