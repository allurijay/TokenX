import { type DB, one } from "../../../packages/db/src.js";
import {
  assert,
  can,
  requirePermission,
  type Principal,
} from "../../../packages/domain/src/index.js";
import { venueFor } from "./catalog.js";
export async function report(
  db: DB,
  p: Principal,
  venue: string,
  from: string,
  to: string,
) {
  await venueFor(db, p, venue);
  assert(
    !isNaN(Date.parse(from)) &&
      !isNaN(Date.parse(to)) &&
      new Date(from) < new Date(to),
    "INVALID_RANGE",
    "Choose a valid date range",
    400,
  );
  const outlets = (
    await db.query("SELECT * FROM outlet WHERE venue_id=$1 ORDER BY name", [
      venue,
    ])
  ).rows.filter((o) => can(p, "report", venue, o.id));
  assert(
    outlets.length,
    "FORBIDDEN",
    "Financial reporting is not available for this account",
    403,
  );
  const rows = [];
  for (const o of outlets) {
    const sales = await one(
      db,
      `SELECT count(DISTINCT u.order_id)::int orders,count(*)::int units,coalesce(sum(u.gross_minor),0)::bigint gross,coalesce(sum(u.discount_minor),0)::bigint discounts,coalesce(sum(u.tax_minor),0)::bigint tax,coalesce(sum(u.amount_minor),0)::bigint collections FROM work_unit u JOIN customer_order r ON r.id=u.order_id WHERE u.outlet_id=$1 AND u.rework_of IS NULL AND r.paid_at >= $2 AND r.paid_at < $3`,
      [o.id, from, to],
    );
    const refunds = await one(
      db,
      `SELECT coalesce(sum(a.amount_minor) FILTER(WHERE r.status='SUCCEEDED' AND r.succeeded_at >= $2 AND r.succeeded_at < $3),0)::bigint refunded,coalesce(sum(a.tax_minor) FILTER(WHERE r.status='SUCCEEDED' AND r.succeeded_at >= $2 AND r.succeeded_at < $3),0)::bigint refund_tax,coalesce(sum(a.amount_minor) FILTER(WHERE r.status NOT IN ('SUCCEEDED','REJECTED','WITHDRAWN')),0)::bigint pending FROM refund_allocation a JOIN refund_request r ON r.id=a.refund_id JOIN work_unit u ON u.id=a.unit_id WHERE u.outlet_id=$1`,
      [o.id, from, to],
    );
    const balance = await one(
      db,
      "SELECT coalesce(sum(l.credit_minor-l.debit_minor),0)::bigint amount FROM journal_line l WHERE l.outlet_id=$1 AND l.account='outlet_payable'",
      [o.id],
    );
    const cancelled = await one(
      db,
      "SELECT coalesce(sum(amount_minor),0)::bigint amount FROM work_unit WHERE outlet_id=$1 AND cancel_state='CANCELLED'",
      [o.id],
    );
    rows.push({
      ...o,
      ...sales,
      ...refunds,
      net_sales:
        sales.collections - sales.tax - refunds.refunded + refunds.refund_tax,
      balance: balance.amount,
      cancelled: cancelled.amount,
    });
  }
  const ids = outlets.map((o) => o.id);
  const journals = (
    await db.query(
      "SELECT t.*,l.outlet_id,l.account,l.debit_minor,l.credit_minor FROM journal_line l JOIN journal_transaction t ON t.id=l.transaction_id WHERE l.outlet_id=ANY($1::uuid[]) ORDER BY t.created_at DESC LIMIT 200",
      [ids],
    )
  ).rows;
  return {
    rows,
    journals,
    asOf: new Date().toISOString(),
    basis:
      "Sales by paid_at; refunds by succeeded_at; pending refunds/balance/cancelled are lifetime snapshots",
    from,
    to,
  };
}
export async function availableBalance(db: DB, outlet: string) {
  return (
    await one(
      db,
      "SELECT coalesce(sum(credit_minor-debit_minor),0)::bigint amount FROM journal_line WHERE outlet_id=$1 AND account='outlet_payable'",
      [outlet],
    )
  ).amount as number;
}
