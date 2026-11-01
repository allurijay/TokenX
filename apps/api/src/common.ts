import { encrypt, decrypt } from "./security.js";
import { randomUUID } from "node:crypto";
import { type DB, one } from "../../../packages/db/src.js";
import {
  type Principal,
  hash,
  assert,
} from "../../../packages/domain/src/index.js";
export async function audit(
  db: DB,
  p: Principal | null,
  venue: string,
  outlet: string | null,
  action: string,
  id: string,
  details: unknown = {},
) {
  await db.query(
    "INSERT INTO audit_event(venue_id,outlet_id,actor_id,action,resource_id,details) VALUES($1,$2,$3,$4,$5,$6)",
    [venue, outlet, p?.id, action, id, JSON.stringify(details)],
  );
}
export async function emit(
  db: DB,
  venue: string,
  outlet: string | null,
  order: string | null,
  type: string,
  payload: unknown = {},
) {
  await db.query(
    "INSERT INTO outbox(venue_id,outlet_id,order_id,type,payload) VALUES($1,$2,$3,$4,$5)",
    [venue, outlet, order, type, JSON.stringify(payload)],
  );
}
export async function journal(
  db: DB,
  venue: string,
  currency: string,
  key: string,
  description: string,
  lines: {
    outlet?: string;
    account: string;
    debit?: number;
    credit?: number;
  }[],
) {
  const nonzero = lines.filter((x) => x.debit || x.credit);
  assert(
    nonzero.reduce((s, x) => s + (x.debit || 0) - (x.credit || 0), 0) === 0,
    "UNBALANCED",
    "Journal does not balance",
  );
  const t = await one(
    db,
    "INSERT INTO journal_transaction(venue_id,currency,source_key,description) VALUES($1,$2,$3,$4) ON CONFLICT(source_key) DO NOTHING RETURNING id",
    [venue, currency, key, description],
  );
  if (!t) return;
  for (const l of nonzero)
    await db.query(
      "INSERT INTO journal_line(transaction_id,outlet_id,account,debit_minor,credit_minor) VALUES($1,$2,$3,$4,$5)",
      [t.id, l.outlet || null, l.account, l.debit || 0, l.credit || 0],
    );
}
function canonical(v: any): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object")
    return (
      "{" +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(v);
}
export async function idempotent(
  db: DB,
  p: Principal,
  endpoint: string,
  key: unknown,
  body: unknown,
  fn: () => Promise<any>,
) {
  assert(
    typeof key === "string" && key.length >= 8 && key.length <= 160,
    "IDEMPOTENCY_REQUIRED",
    "Send an Idempotency-Key of 8–160 characters",
    400,
  );
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    p.id + endpoint + key,
  ]);
  const digest = hash(canonical(body ?? {}));
  const previous = await one(
    db,
    "SELECT * FROM idempotency_record WHERE principal_id=$1 AND endpoint=$2 AND key=$3",
    [p.id, endpoint, key],
  );
  if (previous) {
    assert(
      previous.request_hash === digest,
      "IDEMPOTENCY_CONFLICT",
      "Key was used with different input",
    );
    return previous.response.encrypted
      ? JSON.parse(decrypt(previous.response.encrypted))
      : previous.response;
  }
  const response = await fn();
  await db.query(
    "INSERT INTO idempotency_record(principal_id,endpoint,key,request_hash,response) VALUES($1,$2,$3,$4,$5)",
    [
      p.id,
      endpoint,
      key,
      digest,
      JSON.stringify({ encrypted: encrypt(JSON.stringify(response ?? {})) }),
    ],
  );
  return response ?? {};
}
export function uid() {
  return randomUUID();
}
