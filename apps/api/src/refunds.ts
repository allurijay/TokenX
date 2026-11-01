import { type DB, one } from "../../../packages/db/src.js";
import {
  assert,
  requirePermission,
  can,
  type Principal,
  allocate,
} from "../../../packages/domain/src/index.js";
import {
  refundInput,
  decisionInput,
} from "../../../packages/contracts/src/index.js";
import { audit, emit, journal, uid } from "./common.js";
import { venueFor } from "./catalog.js";
export async function requestRefund(
  db: DB,
  p: Principal,
  orderId: string,
  raw: unknown,
) {
  const input = refundInput.parse(raw);
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,2))", [
    p.id,
  ]);
  const o = await one(db, "SELECT * FROM customer_order WHERE id=$1", [
    orderId,
  ]);
  assert(o, "NOT_FOUND", "Order not found", 404);
  const v = await venueFor(db, p, o.venue_id);
  const capture = await one(
    db,
    "SELECT c.* FROM capture c JOIN payment_intent i ON i.id=c.intent_id WHERE i.order_id=$1 AND c.provider_ref=i.provider_ref FOR UPDATE OF c",
    [orderId],
  );
  assert(capture, "NOT_PAID", "Only captured payments can be refunded");
  const ids = input.units.map((u) => u.unitId);
  assert(
    new Set(ids).size === ids.length,
    "INVALID_UNITS",
    "Select each unit only once",
  );
  const units = (
    await db.query(
      "SELECT * FROM work_unit WHERE order_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",
      [orderId, ids],
    )
  ).rows;
  assert(units.length === ids.length, "NOT_FOUND", "Items not found", 404);
  let total = 0;
  const allocations = [];
  let exception = false;
  for (const u of units) {
    requirePermission(p, "refund", o.venue_id, u.outlet_id, u.station_id);
    assert(
      !u.rework_of,
      "INVALID_UNIT",
      "Refund the original sale, not a rework item",
    );
    if (input.mode === "CANCEL_AND_REFUND") {
      assert(
        u.cancel_state === "ACTIVE" && u.serve_state !== "HANDED_OVER",
        "INVALID_TRANSITION",
        "Collected items require a refund-only request",
      );
      exception ||= !["RECEIVED", "ACKNOWLEDGED"].includes(u.prep_state);
    } else exception = true;
    const previous = await one(
      db,
      "SELECT coalesce(sum(a.amount_minor),0)::bigint total,coalesce(sum(a.tax_minor),0)::bigint tax,coalesce(sum(a.commission_minor),0)::bigint commission FROM refund_allocation a JOIN refund_request r ON r.id=a.refund_id WHERE a.unit_id=$1 AND r.status NOT IN ('REJECTED','WITHDRAWN')",
      [u.id],
    );
    const available = u.amount_minor - previous.total;
    const requested = input.units.find((x) => x.unitId === u.id)!;
    const amount = requested.amountMinor ?? available;
    assert(
      amount > 0 && amount <= available,
      "REFUND_LIMIT",
      "Amount exceeds the remaining refundable balance",
    );
    if (input.mode === "CANCEL_AND_REFUND")
      assert(
        amount === available,
        "PARTIAL_CANCEL",
        "Cancellation refunds the remaining unit value; use refund-only for monetary adjustments",
      );
    const tax =
      amount === available
        ? u.tax_minor - previous.tax
        : allocate(amount, [
            u.tax_minor - previous.tax,
            available - (u.tax_minor - previous.tax),
          ])[0];
    const commission =
      amount === available
        ? u.commission_minor - previous.commission
        : allocate(amount, [
            u.commission_minor - previous.commission,
            available - (u.commission_minor - previous.commission),
          ])[0];
    allocations.push({ unit: u, amount, tax, commission });
    total += amount;
  }
  const reserved = await one(
    db,
    "SELECT coalesce(sum(amount_minor),0)::bigint amount FROM refund_request WHERE capture_id=$1 AND status NOT IN ('REJECTED','WITHDRAWN')",
    [capture.id],
  );
  assert(
    total + reserved.amount <= capture.amount_minor,
    "REFUND_LIMIT",
    "Refund exceeds capture balance",
  );
  const day = await one(
    db,
    "SELECT coalesce(sum(amount_minor),0)::bigint amount FROM refund_request WHERE requested_by=$1 AND created_at >= (date_trunc('day',now() AT TIME ZONE $2) AT TIME ZONE $2) AND status NOT IN ('REJECTED','WITHDRAWN')",
    [p.id, v.timezone],
  );
  const auto =
    !exception &&
    total <= v.refund_limit &&
    total + day.amount <= v.refund_daily_limit &&
    can(p, "checkout", o.venue_id);
  const r = await one(
    db,
    "INSERT INTO refund_request(order_id,capture_id,requested_by,mode,amount_minor,reason_code,note,operation_key,policy) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
    [
      orderId,
      capture.id,
      p.id,
      input.mode,
      total,
      input.reasonCode,
      input.note,
      "refund:" + uid(),
      JSON.stringify({
        exception,
        limit: v.refund_limit,
        dailyLimit: v.refund_daily_limit,
      }),
    ],
  );
  for (const a of allocations) {
    await db.query(
      "INSERT INTO refund_allocation(refund_id,unit_id,amount_minor,tax_minor,commission_minor) VALUES($1,$2,$3,$4,$5)",
      [r.id, a.unit.id, a.amount, a.tax, a.commission],
    );
    if (input.mode === "CANCEL_AND_REFUND")
      await db.query(
        "UPDATE work_unit SET cancel_state='CANCEL_REQUESTED',version=version+1 WHERE id=$1",
        [a.unit.id],
      );
    await audit(db, p, o.venue_id, a.unit.outlet_id, "refund.requested", r.id, {
      unitId: a.unit.id,
      amountMinor: a.amount,
      reason: input.reasonCode,
      note: input.note,
    });
    await emit(
      db,
      o.venue_id,
      a.unit.outlet_id,
      orderId,
      "cancellation.requested",
      { unitId: a.unit.id },
    );
  }
  if (auto)
    return approveRefund(
      db,
      p,
      r.id,
      {
        decision: "APPROVE",
        expectedVersion: r.version,
        note: "Within configured cashier limits",
      },
      true,
    );
  return r;
}
export async function approveRefund(
  db: DB,
  p: Principal,
  id: string,
  raw: unknown,
  auto = false,
) {
  const input = decisionInput.parse(raw);
  const initial = await one(db, "SELECT * FROM refund_request WHERE id=$1", [
    id,
  ]);
  assert(initial, "NOT_FOUND", "Refund not found", 404);
  await db.query("SELECT id FROM capture WHERE id=$1 FOR UPDATE", [
    initial.capture_id,
  ]);
  const r = await one(
    db,
    "SELECT * FROM refund_request WHERE id=$1 FOR UPDATE",
    [id],
  );
  const o = await one(db, "SELECT * FROM customer_order WHERE id=$1", [
    r.order_id,
  ]);
  await venueFor(db, p, o.venue_id);
  const allocations = (
    await db.query(
      "SELECT a.*,u.outlet_id,u.station_id FROM refund_allocation a JOIN work_unit u ON u.id=a.unit_id WHERE a.refund_id=$1 ORDER BY u.id FOR UPDATE OF u",
      [id],
    )
  ).rows;
  if (r.policy.excessCapture) requirePermission(p, "finance", o.venue_id);
  for (const a of allocations) {
    requirePermission(
      p,
      auto ? "refund" : "approve",
      o.venue_id,
      a.outlet_id,
      a.station_id,
    );
  }
  assert(
    auto || r.requested_by !== p.id,
    "SELF_APPROVAL",
    "A different authorized person must review this request",
    403,
  );
  assert(
    r.status === "APPROVAL_REQUIRED" && r.version === input.expectedVersion,
    "STALE_VERSION",
    "Refund has already been reviewed",
  );
  const approve = input.decision === "APPROVE";
  const updated = await one(
    db,
    "UPDATE refund_request SET status=$2,approved_by=$3,decision_note=$4,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
    [id, approve ? "APPROVED" : "REJECTED", p.id, input.note],
  );
  for (const a of allocations) {
    if (r.mode === "CANCEL_AND_REFUND")
      await db.query(
        "UPDATE work_unit SET cancel_state=$2,version=version+1 WHERE id=$1",
        [a.unit_id, approve ? "CANCELLED" : "ACTIVE"],
      );
    await audit(
      db,
      p,
      o.venue_id,
      a.outlet_id,
      "refund." + (approve ? "approved" : "rejected"),
      id,
      { amountMinor: a.amount_minor, note: input.note, auto },
    );
    await emit(db, o.venue_id, a.outlet_id, o.id, "refund.status_changed", {
      refundId: id,
      status: updated.status,
    });
  }
  if (r.policy.excessCapture) {
    await audit(db, p, o.venue_id, null, "refund.excess_decided", id, {
      decision: input.decision,
      note: input.note,
    });
    await emit(db, o.venue_id, null, o.id, "refund.status_changed", {
      refundId: id,
      status: updated.status,
    });
  }
  if (approve && !r.policy.excessCapture)
    await journal(
      db,
      o.venue_id,
      o.currency,
      "refund-approved:" + id,
      "Refund obligation",
      allocations.flatMap((a) => [
        {
          outlet: a.outlet_id,
          account: "outlet_payable",
          debit: a.amount_minor,
        },
        {
          outlet: a.outlet_id,
          account: "customer_refund_payable",
          credit: a.amount_minor,
        },
        {
          outlet: a.outlet_id,
          account: "operator_commission",
          debit: a.commission_minor,
        },
        {
          outlet: a.outlet_id,
          account: "outlet_payable",
          credit: a.commission_minor,
        },
      ]),
    );
  return updated;
}
export async function finishRefund(db: DB, id: string, providerRef: string) {
  const initial = await one(db, "SELECT * FROM refund_request WHERE id=$1", [
    id,
  ]);
  assert(initial, "NOT_FOUND", "Refund not found", 404);
  await db.query("SELECT id FROM capture WHERE id=$1 FOR UPDATE", [
    initial.capture_id,
  ]);
  const r = await one(
    db,
    "SELECT * FROM refund_request WHERE id=$1 FOR UPDATE",
    [id],
  );
  if (r.status === "SUCCEEDED") return r;
  assert(
    ["APPROVED", "SUBMITTING", "PENDING", "UNKNOWN", "FAILED"].includes(
      r.status,
    ),
    "INVALID_TRANSITION",
    "Refund was not approved",
  );
  const o = await one(
    db,
    "SELECT o.*,i.tender FROM customer_order o JOIN payment_intent i ON i.order_id=o.id WHERE o.id=$1",
    [r.order_id],
  );
  const allocations = (
    await db.query(
      "SELECT a.*,u.outlet_id FROM refund_allocation a JOIN work_unit u ON u.id=a.unit_id WHERE a.refund_id=$1",
      [id],
    )
  ).rows;
  await journal(
    db,
    o.venue_id,
    o.currency,
    "refund-success:" + id,
    "Customer refund",
    r.policy.excessCapture
      ? [
          { account: "customer_refund_payable", debit: r.amount_minor },
          {
            account: o.tender === "CASH" ? "cash" : "provider_receivable",
            credit: r.amount_minor,
          },
        ]
      : allocations.flatMap((a) => [
          {
            outlet: a.outlet_id,
            account: "customer_refund_payable",
            debit: a.amount_minor,
          },
          {
            outlet: a.outlet_id,
            account: o.tender === "CASH" ? "cash" : "provider_receivable",
            credit: a.amount_minor,
          },
        ]),
  );
  const result = await one(
    db,
    "UPDATE refund_request SET status='SUCCEEDED',provider_ref=$2,succeeded_at=now(),updated_at=now(),version=version+1 WHERE id=$1 RETURNING *",
    [id, providerRef],
  );
  if (r.policy.excessCapture) {
    await audit(db, null, o.venue_id, null, "refund.excess_succeeded", id, {
      providerRef,
      amountMinor: r.amount_minor,
    });
    await emit(db, o.venue_id, null, o.id, "refund.status_changed", {
      refundId: id,
      status: "SUCCEEDED",
    });
  }
  for (const a of allocations) {
    await audit(db, null, o.venue_id, a.outlet_id, "refund.succeeded", id, {
      providerRef,
      amountMinor: a.amount_minor,
    });
    await emit(db, o.venue_id, a.outlet_id, o.id, "refund.status_changed", {
      refundId: id,
      status: "SUCCEEDED",
    });
  }
  return result;
}

export async function requestExcessRefund(
  db: DB,
  p: Principal,
  captureId: string,
  raw: unknown,
) {
  const note = zNote(raw);
  const c = await one(
    db,
    "SELECT c.*,i.order_id,o.venue_id,o.currency FROM capture c JOIN payment_intent i ON i.id=c.intent_id JOIN customer_order o ON o.id=i.order_id WHERE c.id=$1 FOR UPDATE OF c",
    [captureId],
  );
  assert(c, "NOT_FOUND", "Capture not found", 404);
  await venueFor(db, p, c.venue_id);
  requirePermission(p, "finance", c.venue_id);
  const first = await one(
    db,
    "SELECT c.id FROM capture c JOIN payment_intent i ON i.id=c.intent_id WHERE c.intent_id=$1 AND c.provider_ref=i.provider_ref",
    [c.intent_id],
  );
  assert(
    first.id !== c.id,
    "NOT_EXCESS",
    "Use the ordinary item refund for the original capture",
  );
  const previous = await one(
    db,
    "SELECT id FROM refund_request WHERE capture_id=$1 AND status NOT IN ('REJECTED','WITHDRAWN')",
    [c.id],
  );
  assert(!previous, "REFUND_LIMIT", "An excess-capture refund already exists");
  const r = await one(
    db,
    "INSERT INTO refund_request(order_id,capture_id,requested_by,mode,amount_minor,reason_code,note,operation_key,policy) VALUES($1,$2,$3,'REFUND_ONLY',$4,'PAYMENT_DUPLICATE',$5,$6,$7) RETURNING *",
    [
      c.order_id,
      c.id,
      p.id,
      c.amount_minor,
      note,
      "refund:" + uid(),
      JSON.stringify({ excessCapture: true }),
    ],
  );
  await audit(db, p, c.venue_id, null, "refund.excess_requested", r.id, {
    captureId: c.id,
    amountMinor: c.amount_minor,
    note,
  });
  await emit(db, c.venue_id, null, c.order_id, "refund.status_changed", {
    refundId: r.id,
  });
  return r;
}
function zNote(raw: any) {
  assert(
    typeof raw?.note === "string" &&
      raw.note.trim().length >= 10 &&
      raw.note.length <= 1000,
    "INVALID_NOTE",
    "Provide a detailed finance note",
    400,
  );
  return raw.note.trim();
}
