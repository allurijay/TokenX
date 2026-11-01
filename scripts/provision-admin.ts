import { pool, transaction, one } from "../packages/db/src.js";
import { assert, passwordHash } from "../packages/domain/src/index.js";
import { z } from "zod";
const email = z.email().parse(process.env.ADMIN_EMAIL);
const password = z.string().min(16).parse(process.env.ADMIN_PASSWORD);
const name = process.env.ADMIN_NAME || "Administrator";
assert(
  process.env.PROVISION_INITIAL_ADMIN === "true",
  "DISABLED",
  "Explicitly set PROVISION_INITIAL_ADMIN=true for controlled first-admin setup",
);
await transaction(async (db) => {
  await db.query("SELECT pg_advisory_xact_lock(92711)");
  assert(
    !(await one(
      db,
      "SELECT id FROM role_assignment WHERE role='SUPER_ADMIN' LIMIT 1",
    )),
    "ALREADY_PROVISIONED",
    "An administrator already exists; use authorized staff management instead",
  );
  const org = await one(
    db,
    "INSERT INTO organization(name) VALUES($1) RETURNING id",
    [process.env.ORGANIZATION_NAME || "Tokenex"],
  );
  const v = await one(
    db,
    "INSERT INTO venue(organization_id,name) VALUES($1,$2) RETURNING id",
    [org.id, process.env.VENUE_NAME || "Main venue"],
  );
  const u = await one(
    db,
    "INSERT INTO app_user(organization_id,email,name,password_hash) VALUES($1,$2,$3,$4) RETURNING id",
    [org.id, email.toLowerCase(), name, passwordHash(password)],
  );
  await db.query(
    "INSERT INTO role_assignment(user_id,venue_id,role) VALUES($1,$2,'SUPER_ADMIN')",
    [u.id, v.id],
  );
  console.log(
    "Initial administrator provisioned. Complete authenticator enrollment before using production operations.",
  );
});
await pool.end();
