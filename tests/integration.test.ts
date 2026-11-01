import { finalizeCapture } from "../apps/api/src/orders.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../apps/api/src/app.js";
import { transaction, pool } from "../packages/db/src.js";
import { tick } from "../apps/worker/src/index.js";
process.env.NODE_ENV = "test";
let app: Awaited<ReturnType<typeof buildApp>>;
const cookies: Record<string, string> = {};
let venue: string, device: string, items: any[], stations: any[];
async function call(
  user: string,
  method: string,
  path: string,
  body?: any,
  key: string = randomUUID(),
) {
  const response = await app.inject({
    method: method as any,
    url: "/v1" + path,
    headers: {
      cookie: cookies[user] || "",
      origin: process.env.APP_ORIGIN!,
      "idempotency-key": key,
    },
    payload: body,
  });
  return {
    status: response.statusCode,
    json: response.json(),
    data: response.json().data,
  };
}
async function ok(
  user: string,
  method: string,
  path: string,
  body?: any,
  key?: string,
) {
  const r = await call(user, method, path, body, key);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.data;
}
async function order(qty = 2, discountMinor = 0) {
  const q = await ok("admin", "POST", "/quotes", {
    venueId: venue,
    deviceId: device,
    channel: "POS",
    customerAlias: "Test " + randomUUID().slice(0, 5),
    discountMinor,
    lines: [
      { itemId: items.find((i) => i.name === "Masala dosa").id, qty },
      { itemId: items.find((i) => i.name === "Idli plate").id, qty: 1 },
      {
        itemId: items.find((i) => i.name === "Vegetable fried rice").id,
        qty: 1,
      },
    ],
  });
  const checkout = await ok("admin", "POST", "/checkouts", {
    quoteId: q.id,
    tender: "DIGITAL",
    checkoutKey: randomUUID(),
  });
  const paid = await ok(
    "admin",
    "POST",
    `/payments/${checkout.paymentIntentId}/sandbox-capture`,
    {},
  );
  return { ...checkout, ...paid };
}
before(async () => {
  app = await buildApp();
  for (const name of [
    "admin",
    "manager",
    "owner",
    "wok-owner",
    "cook",
    "billing",
    "server",
    "kiosk",
  ]) {
    const r = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: name + "@tokenex.local",
        password: process.env.DEMO_PASSWORD,
      },
    });
    assert.equal(r.statusCode, 200, r.body);
    cookies[name] = r.cookies[0].name + "=" + r.cookies[0].value;
  }
  const me = await ok("admin", "GET", "/me");
  venue = me.venues[0].id;
  device = (await ok("admin", "GET", "/devices?venueId=" + venue)).find(
    (d: any) => d.kind === "POS",
  ).id;
  const c = await ok("admin", "GET", "/catalog?venueId=" + venue);
  items = c.items;
  stations = c.stations;
});
after(async () => {
  await app.close();
  await pool.end();
});
test("AT-02 mixed order has one capture, two outlet suborders, three tickets and four units", async () => {
  const o = await order(2, 4000);
  assert.equal(o.units.length, 4);
  assert.equal(o.total_minor, 36000);
  assert.equal(new Set(o.units.map((u: any) => u.outlet_id)).size, 2);
  assert.equal(new Set(o.units.map((u: any) => u.ticket_id)).size, 3);
  assert.equal(
    o.units.find((u: any) => u.name === "Masala dosa").amount_minor,
    9000,
  );
  assert.ok(o.token);
  const c = await pool.query(
    "SELECT count(*)::int n FROM capture WHERE intent_id=$1",
    [o.paymentIntentId],
  );
  assert.equal(c.rows[0].n, 1);
});
test("AT-03 cook -> completed -> serving ready -> pickup are independent", async () => {
  const o = await order(1);
  let u = o.units.find((u: any) => u.name === "Masala dosa");
  let r = await ok("cook", "POST", "/units/transition", {
    unitIds: [u.id],
    expectedVersions: { [u.id]: u.version },
    action: "START",
  });
  u = r.units[0];
  r = await ok("cook", "POST", "/units/transition", {
    unitIds: [u.id],
    expectedVersions: { [u.id]: u.version },
    action: "COMPLETE",
  });
  u = r.units[0];
  assert.equal(u.serve_state, "WAITING");
  const forbidden = await call("cook", "POST", "/units/transition", {
    unitIds: [u.id],
    expectedVersions: { [u.id]: u.version },
    action: "READY",
  });
  assert.equal(forbidden.status, 403);
  r = await ok("server", "POST", "/units/transition", {
    unitIds: [u.id],
    expectedVersions: { [u.id]: u.version },
    action: "READY",
  });
  u = r.units[0];
  r = await ok("server", "POST", "/units/transition", {
    unitIds: [u.id],
    expectedVersions: { [u.id]: u.version },
    action: "HANDOVER",
    pickupCode: o.pickupCode,
  });
  assert.equal(r.units[0].serve_state, "HANDED_OVER");
  assert.equal(
    (await ok("admin", "GET", "/orders/" + o.id)).progress,
    "PARTIALLY_COLLECTED",
  );
});
test("AT-04 hold invalidates cart quote; owner hold cannot be cleared by cook", async () => {
  const item = items.find((i) => i.name === "Masala dosa");
  const h = await ok("owner", "POST", "/availability-holds", {
    outletId: item.outlet_id,
    itemId: item.id,
    reason: "Test replenishment",
  });
  const r = await call("admin", "POST", "/quotes", {
    venueId: venue,
    deviceId: device,
    channel: "POS",
    lines: [{ itemId: item.id, qty: 1 }],
  });
  assert.equal(r.status, 409);
  assert.equal(
    (await call("cook", "POST", "/availability-holds/" + h.id + "/release", {}))
      .status,
    403,
  );
  await ok("owner", "POST", "/availability-holds/" + h.id + "/release", {});
});
test("AT-05 ten concurrent repeated checkout commands dispatch only once", async () => {
  const q = await ok("admin", "POST", "/quotes", {
    venueId: venue,
    deviceId: device,
    channel: "POS",
    lines: [{ itemId: items[0].id, qty: 1 }],
  });
  const key: string = randomUUID(),
    body = { quoteId: q.id, tender: "DIGITAL", checkoutKey: randomUUID() };
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      ok("admin", "POST", "/checkouts", body, key),
    ),
  );
  assert.equal(new Set(results.map((r) => r.orderId)).size, 1);
  const paid = await Promise.all(
    Array.from({ length: 10 }, () =>
      ok(
        "admin",
        "POST",
        `/payments/${results[0].paymentIntentId}/sandbox-capture`,
        {},
      ),
    ),
  );
  assert.equal(new Set(paid.map((r) => r.token)).size, 1);
  const changed = await call(
    "admin",
    "POST",
    "/checkouts",
    { ...body, tender: "CASH" },
    key,
  );
  assert.equal(changed.status, 409);
});
test("AT-07 partial refund reserves amount, requires another approver and posts balanced ledger", async () => {
  const o = await order(2, 4000),
    u = o.units.find((u: any) => u.name === "Masala dosa");
  const r = await ok("billing", "POST", `/orders/${o.id}/refund-requests`, {
    units: [{ unitId: u.id }],
    mode: "CANCEL_AND_REFUND",
    reasonCode: "ITEM_UNAVAILABLE",
    note: "Dosa batter exhausted",
  });
  assert.equal(r.amount_minor, 9000);
  assert.equal(r.status, "APPROVAL_REQUIRED");
  assert.equal(
    (
      await call("billing", "POST", `/refund-requests/${r.id}/decision`, {
        decision: "APPROVE",
        expectedVersion: r.version,
        note: "Approve refund",
      })
    ).status,
    403,
  );
  await ok("admin", "POST", `/refund-requests/${r.id}/decision`, {
    decision: "APPROVE",
    expectedVersion: r.version,
    note: "Confirmed unavailable",
  });
  await tick();
  const check = await pool.query(
    "SELECT status FROM refund_request WHERE id=$1",
    [r.id],
  );
  assert.equal(check.rows[0].status, "SUCCEEDED");
  const duplicate = await call(
    "billing",
    "POST",
    `/orders/${o.id}/refund-requests`,
    {
      units: [{ unitId: u.id }],
      mode: "REFUND_ONLY",
      reasonCode: "OTHER",
      note: "Duplicate return attempt",
    },
  );
  assert.equal(duplicate.status, 409);
  const balance = await pool.query(
    "SELECT transaction_id,sum(debit_minor-credit_minor)::bigint difference FROM journal_line GROUP BY transaction_id HAVING sum(debit_minor-credit_minor)<>0",
  );
  assert.equal(balance.rowCount, 0);
});
test("AT-09 refund requests race without over-reserving unit value", async () => {
  const o = await order(1),
    u = o.units.find((u: any) => u.name === "Masala dosa");
  const body = {
    units: [{ unitId: u.id }],
    mode: "REFUND_ONLY",
    reasonCode: "QUALITY_ISSUE",
    note: "Quality issue reported",
  };
  const results = await Promise.all([
    call("billing", "POST", `/orders/${o.id}/refund-requests`, body),
    call("manager", "POST", `/orders/${o.id}/refund-requests`, body),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
});
test("AT-10 owner mixed-order projection excludes other outlets; cook sees no money", async () => {
  const o = await order(1);
  const own = await ok("owner", "GET", "/orders/" + o.id);
  assert.equal(own.units.length, 2);
  assert.ok(own.units.every((u: any) => u.outlet_name === "Dhaara Tiffins"));
  assert.equal(own.total_minor, 15000);
  const cook = await ok("cook", "GET", "/orders/" + o.id);
  assert.equal(cook.units.length, 1);
  assert.equal(cook.total_minor, undefined);
  assert.equal(cook.units[0].amount_minor, undefined);
  assert.equal(cook.units[0].commission_minor, undefined);
  const reports = await ok("owner", "GET", "/reports/sales?venueId=" + venue);
  assert.equal(reports.rows.length, 1);
  assert.equal(reports.rows[0].name, "Dhaara Tiffins");
  assert.equal(
    (await call("kiosk", "GET", "/orders?venueId=" + venue)).status,
    403,
  );
});
test("AT-11 repeated provider import does not duplicate records", async () => {
  const o = await order(1);
  const capture = (
    await pool.query("SELECT * FROM capture WHERE intent_id=$1", [
      o.paymentIntentId,
    ])
  ).rows[0];
  const body = {
    venueId: venue,
    records: [
      {
        externalId: "test-" + capture.id,
        kind: "CAPTURE",
        amountMinor: o.total_minor,
        currency: "INR",
        reference: capture.provider_ref,
      },
    ],
  };
  assert.equal(
    (await ok("admin", "POST", "/reconciliation/imports", body)).imported,
    1,
  );
  assert.equal(
    (await ok("admin", "POST", "/reconciliation/imports", body)).imported,
    0,
  );
});
test("tracking secret grants only matching order and does not reveal internal reasons", async () => {
  const o = await order(1);
  const r = await app.inject({
    method: "POST",
    url: "/v1/tracking/session",
    payload: { secret: o.trackingSecret },
  });
  assert.equal(r.statusCode, 200);
  const result = await app.inject({
    method: "GET",
    url: "/v1/tracking",
    headers: { cookie: r.cookies[0].name + "=" + r.cookies[0].value },
  });
  assert.equal(result.json().data.id, o.id);
  assert.equal(result.json().data.tracking_hash, undefined);
  assert.equal(result.json().data.pickup_hash, undefined);
});
test("append-only audit cannot be altered", async () => {
  await assert.rejects(
    pool.query(
      "UPDATE audit_event SET action='tamper' WHERE id=(SELECT min(id) FROM audit_event)",
    ),
    /Append-only/,
  );
});
test("cash sale and full cash refund reconcile cashier shift", async () => {
  const d = await ok("admin", "POST", "/devices", {
    venue_id: venue,
    name: "Test POS " + randomUUID().slice(0, 6),
    kind: "POS",
    active: true,
  });
  const shift = await ok("billing", "POST", "/shifts", {
    venueId: venue,
    deviceId: d.id,
    floatMinor: 5000,
  });
  const q = await ok("billing", "POST", "/quotes", {
    venueId: venue,
    deviceId: d.id,
    channel: "POS",
    lines: [{ itemId: items.find((i) => i.name === "Idli plate").id, qty: 1 }],
  });
  const c = await ok("billing", "POST", "/checkouts", {
    quoteId: q.id,
    tender: "CASH",
    checkoutKey: randomUUID(),
  });
  const o = await ok(
    "billing",
    "POST",
    `/payments/${c.paymentIntentId}/confirm-cash`,
    { shiftId: shift.id, receivedMinor: 10000 },
  );
  const r = await ok("billing", "POST", `/orders/${o.id}/refund-requests`, {
    units: o.units.map((u: any) => ({ unitId: u.id })),
    mode: "CANCEL_AND_REFUND",
    reasonCode: "CUSTOMER_CHANGED_MIND",
    note: "Customer requested cancellation",
  });
  await ok("admin", "POST", `/refund-requests/${r.id}/decision`, {
    decision: "APPROVE",
    expectedVersion: r.version,
    note: "Approved cash return",
  });
  await ok("billing", "POST", `/refund-requests/${r.id}/confirm-cash`, {
    shiftId: shift.id,
    disbursed: true,
  });
  const closed = await ok("billing", "POST", `/shifts/${shift.id}/close`, {
    countedMinor: 5000,
  });
  assert.equal(closed.variance_minor, 0);
});
test("late capture of an unavailable item stages refundable units but blocks cooking", async () => {
  const item = items.find((i) => i.name === "Masala dosa");
  const q = await ok("admin", "POST", "/quotes", {
    venueId: venue,
    deviceId: device,
    channel: "POS",
    lines: [{ itemId: item.id, qty: 1 }],
  });
  const c = await ok("admin", "POST", "/checkouts", {
    quoteId: q.id,
    tender: "DIGITAL",
    checkoutKey: randomUUID(),
  });
  await pool.query(
    "UPDATE customer_order SET lease_expires_at=now()-interval '1 hour' WHERE id=$1",
    [c.orderId],
  );
  const h = await ok("owner", "POST", "/availability-holds", {
    outletId: item.outlet_id,
    itemId: item.id,
    reason: "Closed for maintenance",
  });
  const o = await ok(
    "admin",
    "POST",
    `/payments/${c.paymentIntentId}/sandbox-capture`,
    {},
  );
  assert.equal(o.status, "PAYMENT_REVIEW");
  assert.equal(o.units.length, 1);
  const u = o.units[0];
  assert.equal(
    (
      await call("cook", "POST", "/units/transition", {
        unitIds: [u.id],
        expectedVersions: { [u.id]: u.version },
        action: "START",
      })
    ).status,
    409,
  );
  await ok("billing", "POST", `/orders/${o.id}/refund-requests`, {
    units: [{ unitId: u.id }],
    mode: "CANCEL_AND_REFUND",
    reasonCode: "ITEM_UNAVAILABLE",
    note: "Late capture after kitchen closed",
  });
  await ok("owner", "POST", "/availability-holds/" + h.id + "/release", {});
});
test("stale staff updates conflict and cook never receives refund amounts", async () => {
  const o = await order(1),
    u = o.units.find((u: any) => u.name === "Masala dosa");
  await ok("billing", "POST", `/orders/${o.id}/refund-requests`, {
    units: [{ unitId: u.id }],
    mode: "CANCEL_AND_REFUND",
    reasonCode: "OTHER",
    note: "Testing cancellation hold",
  });
  const view = await ok("cook", "GET", "/orders/" + o.id);
  assert.ok(view.refunds.length);
  assert.equal(view.refunds[0].amount_minor, undefined);
  assert.equal(view.refunds[0].note, undefined);
  const r = await call("cook", "POST", "/units/transition", {
    unitIds: [u.id],
    expectedVersions: { [u.id]: u.version },
    action: "START",
  });
  assert.equal(r.status, 409);
});
test("kiosk sees all of its receipt items, never another checkout", async () => {
  const d = (await ok("kiosk", "GET", "/devices?venueId=" + venue)).find(
    (d: any) => d.kind === "KIOSK",
  );
  const q = await ok("kiosk", "POST", "/quotes", {
    venueId: venue,
    deviceId: d.id,
    channel: "KIOSK",
    lines: [{ itemId: items[0].id, qty: 1 }],
  });
  const c = await ok("kiosk", "POST", "/checkouts", {
    quoteId: q.id,
    tender: "DIGITAL",
    checkoutKey: randomUUID(),
  });
  const o = await ok(
    "kiosk",
    "POST",
    `/payments/${c.paymentIntentId}/sandbox-capture`,
    {},
  );
  assert.equal(o.units.length, 1);
  const other = await order(1);
  assert.equal((await call("kiosk", "GET", "/orders/" + other.id)).status, 404);
});

test("excess provider capture refunds separately without reducing owner earnings or dispatching twice", async () => {
  const o = await order(1);
  const ref = "extra:" + randomUUID();
  await transaction((db) =>
    finalizeCapture(db, o.paymentIntentId, ref, o.total_minor),
  );
  const c = (
    await pool.query("SELECT * FROM capture WHERE provider_ref=$1", [ref])
  ).rows[0];
  const before = (
    await pool.query(
      "SELECT coalesce(sum(credit_minor-debit_minor),0)::bigint n FROM journal_line WHERE account='outlet_payable'",
    )
  ).rows[0].n;
  const r = await ok("admin", "POST", "/captures/" + c.id + "/refund-excess", {
    note: "Confirmed duplicate external capture",
  });
  await ok("manager", "POST", "/refund-requests/" + r.id + "/decision", {
    decision: "APPROVE",
    expectedVersion: r.version,
    note: "Verified extra payment evidence",
  });
  await tick();
  const after = (
    await pool.query(
      "SELECT coalesce(sum(credit_minor-debit_minor),0)::bigint n FROM journal_line WHERE account='outlet_payable'",
    )
  ).rows[0].n;
  assert.equal(after, before);
  assert.equal(
    (await pool.query("SELECT status FROM refund_request WHERE id=$1", [r.id]))
      .rows[0].status,
    "SUCCEEDED",
  );
  assert.equal((await ok("admin", "GET", "/orders/" + o.id)).units.length, 3);
});
test("production elevated sessions can enroll MFA but cannot skip enrollment", async () => {
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const me = await ok("admin", "GET", "/me");
    assert.equal(me.mfaRequired, true);
    assert.equal(
      (await call("admin", "GET", "/catalog?venueId=" + venue)).status,
      403,
    );
  } finally {
    process.env.NODE_ENV = old;
  }
});
