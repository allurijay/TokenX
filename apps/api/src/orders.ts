import { randomBytes } from "node:crypto";
import { type DB, one } from "../../../packages/db/src.js";
import {
  assert,
  requirePermission,
  can,
  type Principal,
  allocate,
  inclusiveTax,
  exclusiveTax,
  hash,
  progress,
  transition,
} from "../../../packages/domain/src/index.js";
import {
  quoteInput,
  checkoutInput,
  transitionInput,
} from "../../../packages/contracts/src/index.js";
import { checkItem, venueFor } from "./catalog.js";
import { audit, emit, journal, uid } from "./common.js";
export async function makeQuote(db: DB, p: Principal, raw: unknown) {
  const input = quoteInput.parse(raw);
  const v = await venueFor(db, p, input.venueId);
  requirePermission(p, "checkout", v.id);
  assert(v.active, "VENUE_CLOSED", "Venue is closed");
  const device = await one(
    db,
    "SELECT * FROM device WHERE id=$1 AND venue_id=$2 AND active",
    [input.deviceId, v.id],
  );
  assert(
    device && device.kind === input.channel,
    "INVALID_DEVICE",
    "Choose an active device matching this channel",
  );
  if (p.grants.every((g) => g.role === "KIOSK"))
    assert(
      input.channel === "KIOSK",
      "FORBIDDEN",
      "Kiosk may only create kiosk orders",
      403,
    );
  if (input.discountMinor) requirePermission(p, "configure", v.id);
  const units: any[] = [];
  for (const [index, line] of input.lines.entries()) {
    const item = await checkItem(db, line.itemId, line.variantId);
    assert(
      item.venue_id === v.id,
      "INVALID_SCOPE",
      "Items must belong to this venue",
    );
    const selected = [...new Set(line.modifierIds)];
    assert(
      selected.length === line.modifierIds.length,
      "INVALID_MODIFIERS",
      "Duplicate modifier",
    );
    const groups = (
      await db.query("SELECT * FROM modifier_group WHERE item_id=$1", [item.id])
    ).rows;
    const opts = selected.length
      ? (
          await db.query(
            "SELECT m.* FROM modifier_option m JOIN modifier_group g ON g.id=m.group_id WHERE m.id=ANY($1::uuid[]) AND g.item_id=$2",
            [selected, item.id],
          )
        ).rows
      : [];
    assert(
      opts.length === selected.length,
      "INVALID_MODIFIERS",
      "Unknown modifier",
    );
    for (const g of groups) {
      const count = opts.filter((o) => o.group_id === g.id).length;
      assert(
        count >= g.min_select && count <= g.max_select,
        "INVALID_MODIFIERS",
        `Select ${g.min_select}-${g.max_select} options for ${g.name}`,
      );
    }
    const base = item.price_minor + opts.reduce((s, o) => s + o.price_minor, 0);
    for (let ordinal = 0; ordinal < line.qty; ordinal++)
      units.push({
        id: uid(),
        lineIndex: index,
        ordinal,
        itemId: item.id,
        variantId: line.variantId,
        outletId: item.outlet_id,
        stationId: item.station_id,
        name: item.name + (item.variant ? " · " + item.variant.name : ""),
        modifiers: opts.map((o) => o.name).join(", "),
        baseMinor: base,
        taxBps: item.tax_bps,
        taxInclusive: item.tax_inclusive,
        itemVersion: item.version,
        routeVersion: v.menu_version,
      });
  }
  const bases = units.map((u) => u.baseMinor);
  assert(
    input.discountMinor <= bases.reduce((a, b) => a + b, 0),
    "INVALID_DISCOUNT",
    "Discount exceeds subtotal",
  );
  const discounts = allocate(input.discountMinor, bases);
  units.forEach((u, i) => {
    const net = u.baseMinor - discounts[i];
    u.discountMinor = discounts[i];
    u.taxMinor = u.taxInclusive
      ? inclusiveTax(net, u.taxBps)
      : exclusiveTax(net, u.taxBps);
    u.amountMinor = u.taxInclusive ? net : net + u.taxMinor;
    u.grossMinor = u.taxInclusive
      ? u.baseMinor - inclusiveTax(u.baseMinor, u.taxBps)
      : u.baseMinor;
    u.discountMinor = u.grossMinor - (u.amountMinor - u.taxMinor);
  });
  const total = units.reduce((s, u) => s + u.amountMinor, 0);
  assert(
    Number.isSafeInteger(total) && total <= 100_000_000,
    "INVALID_TOTAL",
    "Order is too large",
  );
  return one(
    db,
    "INSERT INTO quote(venue_id,actor_id,device_id,channel,alias,menu_version,units,total_minor,discount_minor,currency,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+interval '2 minutes') RETURNING *",
    [
      v.id,
      p.id,
      input.deviceId,
      input.channel,
      input.customerAlias,
      v.menu_version,
      JSON.stringify(units),
      total,
      input.discountMinor,
      v.currency,
    ],
  );
}
export async function checkout(db: DB, p: Principal, raw: unknown) {
  const input = checkoutInput.parse(raw);
  const q = await one(db, "SELECT * FROM quote WHERE id=$1 FOR UPDATE", [
    input.quoteId,
  ]);
  assert(q && q.actor_id === p.id, "NOT_FOUND", "Quote not found", 404);
  requirePermission(p, "checkout", q.venue_id);
  assert(
    new Date(q.expires_at) > new Date(),
    "QUOTE_EXPIRED",
    "Your quote expired. Review the latest prices",
  );
  await db.query("SELECT id FROM venue WHERE id=$1 FOR SHARE", [q.venue_id]);
  const v = await venueFor(db, p, q.venue_id);
  assert(
    v.active && q.menu_version === v.menu_version,
    "QUOTE_CHANGED",
    "Menu changed. Review your cart",
  );
  for (const u of q.units) {
    const item = await checkItem(db, u.itemId, u.variantId);
    assert(
      item.version === u.itemVersion && item.station_id === u.stationId,
      "QUOTE_CHANGED",
      "Item changed. Review your cart",
    );
  }
  assert(
    !(q.channel === "KIOSK" && input.tender === "CASH"),
    "INVALID_TENDER",
    "Kiosk accepts digital payment only",
  );
  const tracking = randomBytes(24).toString("base64url"),
    pickup = randomBytes(3).toString("hex").toUpperCase();
  const order = await one(
    db,
    "INSERT INTO customer_order(venue_id,actor_id,device_id,quote_id,checkout_key,channel,alias,currency,total_minor,tracking_hash,pickup_hash,lease_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()+interval '10 minutes') RETURNING *",
    [
      q.venue_id,
      p.id,
      q.device_id,
      q.id,
      input.checkoutKey,
      q.channel,
      q.alias,
      q.currency,
      q.total_minor,
      hash(tracking),
      hash(pickup),
    ],
  );
  const intent = await one(
    db,
    "INSERT INTO payment_intent(order_id,amount_minor,tender,operation_key) VALUES($1,$2,$3,$4) RETURNING *",
    [
      order.id,
      order.total_minor,
      order.total_minor === 0 ? "ZERO" : input.tender,
      "pay:" + order.id,
    ],
  );
  await audit(db, p, q.venue_id, null, "checkout.created", order.id);
  if (order.total_minor === 0)
    await finalizeCapture(db, intent.id, "zero:" + intent.id, 0);
  return {
    orderId: order.id,
    paymentIntentId: intent.id,
    amountMinor: order.total_minor,
    tender: intent.tender,
    trackingSecret: tracking,
    pickupCode: pickup,
    leaseExpiresAt: order.lease_expires_at,
    provider: process.env.PAYMENT_PROVIDER || "sandbox",
  };
}
export async function finalizeCapture(
  db: DB,
  intentId: string,
  providerRef: string,
  amount: number,
) {
  const intent = await one(
    db,
    "SELECT * FROM payment_intent WHERE id=$1 FOR UPDATE",
    [intentId],
  );
  assert(intent, "NOT_FOUND", "Payment not found", 404);
  const order = await one(
    db,
    "SELECT * FROM customer_order WHERE id=$1 FOR UPDATE",
    [intent.order_id],
  );
  const existing = await one(
    db,
    "SELECT * FROM capture WHERE provider_ref=$1",
    [providerRef],
  );
  if (existing) {
    assert(
      existing.intent_id === intent.id && existing.amount_minor === amount,
      "PAYMENT_CONFLICT",
      "Provider capture conflicts",
    );
    return order;
  }
  assert(
    amount === intent.amount_minor,
    "PAYMENT_MISMATCH",
    "Captured amount does not match",
  );
  await db.query(
    "INSERT INTO payment_attempt(intent_id,provider_payment_id,status,amount_minor,currency) VALUES($1,$2,'CAPTURED',$3,$4) ON CONFLICT(provider_payment_id) DO UPDATE SET status='CAPTURED',observed_at=now()",
    [intent.id, providerRef, amount, order.currency],
  );
  const captures = (
    await db.query("SELECT * FROM capture WHERE intent_id=$1", [intent.id])
  ).rows;
  const c = await one(
    db,
    "INSERT INTO capture(intent_id,provider_ref,amount_minor) VALUES($1,$2,$3) RETURNING *",
    [intent.id, providerRef, amount],
  );
  if (captures.length) {
    await journal(
      db,
      order.venue_id,
      order.currency,
      "excess:" + c.id,
      "Duplicate external capture",
      [
        { account: "provider_receivable", debit: amount },
        { account: "customer_refund_payable", credit: amount },
      ],
    );
    await audit(
      db,
      null,
      order.venue_id,
      null,
      "payment.duplicate_capture",
      order.id,
      { captureId: c.id },
    );
    await emit(db, order.venue_id, null, order.id, "payment.exception", {
      code: "DUPLICATE_CAPTURE",
    });
    return order;
  }
  await db.query(
    "UPDATE payment_intent SET status='CAPTURED',provider_ref=$2 WHERE id=$1",
    [intent.id, providerRef],
  );
  await db.query(
    "UPDATE customer_order SET status='PAID',paid_at=now(),version=version+1 WHERE id=$1",
    [order.id],
  );
  const q = await one(db, "SELECT * FROM quote WHERE id=$1", [order.quote_id]);
  const byOutlet = new Map<string, number>();
  for (const u of q.units)
    byOutlet.set(u.outletId, (byOutlet.get(u.outletId) || 0) + u.amountMinor);
  await journal(
    db,
    order.venue_id,
    order.currency,
    "capture:" + c.id,
    "Customer payment",
    [
      {
        account: intent.tender === "CASH" ? "cash" : "provider_receivable",
        debit: amount,
      },
      ...[...byOutlet].map(([outlet, total]) => ({
        outlet,
        account: "outlet_payable",
        credit: total,
      })),
    ],
  );
  if (
    new Date(order.lease_expires_at) < new Date() ||
    order.status === "CANCELLED"
  ) {
    let valid = order.status !== "CANCELLED";
    try {
      for (const u of q.units) await checkItem(db, u.itemId, u.variantId);
    } catch {
      valid = false;
    }
    if (!valid) {
      await dispatch(db, order, q, false);
      await db.query(
        "UPDATE customer_order SET status='PAYMENT_REVIEW' WHERE id=$1",
        [order.id],
      );
      await emit(db, order.venue_id, null, order.id, "payment.exception", {
        code: "LATE_CAPTURE",
      });
      return { ...order, status: "PAYMENT_REVIEW" };
    }
  }
  return dispatch(db, order, q);
}
export async function dispatch(db: DB, order: any, q: any, release = true) {
  if (order.dispatched_at) return order;
  const v = await one(db, "SELECT * FROM venue WHERE id=$1", [order.venue_id]);
  const date = await one(
    db,
    "SELECT ((now() AT TIME ZONE $1)-make_interval(hours=>$2))::date::text business_date",
    [v.timezone, v.day_cutoff],
  );
  const counter = await one(
    db,
    "INSERT INTO token_counter(venue_id,business_date,next_value) VALUES($1,$2,1) ON CONFLICT(venue_id,business_date) DO UPDATE SET next_value=token_counter.next_value+1 RETURNING next_value",
    [v.id, date.business_date],
  );
  const policy = await one(
    db,
    "SELECT * FROM financial_policy WHERE venue_id=$1 AND effective_at<=now() ORDER BY effective_at DESC LIMIT 1",
    [v.id],
  );
  const commissionLines: any[] = [];
  const lines = new Map<number, string>();
  for (const u of q.units) {
    const sub = await one(
      db,
      "INSERT INTO outlet_suborder(order_id,outlet_id) VALUES($1,$2) ON CONFLICT(order_id,outlet_id) DO UPDATE SET order_id=EXCLUDED.order_id RETURNING id",
      [order.id, u.outletId],
    );
    const ticket = await one(
      db,
      "INSERT INTO station_ticket(order_id,outlet_id,station_id,route_version) VALUES($1,$2,$3,$4) ON CONFLICT(order_id,station_id,route_version) DO UPDATE SET order_id=EXCLUDED.order_id RETURNING id",
      [order.id, u.outletId, u.stationId, u.routeVersion],
    );
    if (!lines.has(u.lineIndex)) {
      const line = await one(
        db,
        "INSERT INTO order_line(suborder_id,item_id,snapshot,quantity) VALUES($1,$2,$3,$4) RETURNING id",
        [
          sub.id,
          u.itemId,
          JSON.stringify(u),
          q.units.filter((x: any) => x.lineIndex === u.lineIndex).length,
        ],
      );
      lines.set(u.lineIndex, line.id);
    }
    await db.query(
      "INSERT INTO work_unit(id,line_id,order_id,outlet_id,station_id,ticket_id,ordinal,name,modifiers,amount_minor,gross_minor,discount_minor,tax_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      [
        u.id,
        lines.get(u.lineIndex),
        order.id,
        u.outletId,
        u.stationId,
        ticket.id,
        u.ordinal,
        u.name,
        u.modifiers,
        u.amountMinor,
        u.grossMinor,
        u.discountMinor,
        u.taxMinor,
      ],
    );
    if (policy?.enabled) {
      const commission = exclusiveTax(
        u.amountMinor - u.taxMinor,
        policy.commission_bps,
      );
      await db.query("UPDATE work_unit SET commission_minor=$2 WHERE id=$1", [
        u.id,
        commission,
      ]);
      if (commission)
        commissionLines.push(
          { outlet: u.outletId, account: "outlet_payable", debit: commission },
          {
            outlet: u.outletId,
            account: "operator_commission",
            credit: commission,
          },
        );
    }
  }
  await journal(
    db,
    v.id,
    v.currency,
    "commission:" + order.id,
    "Operator commission",
    commissionLines,
  );
  const updated = await one(
    db,
    "UPDATE customer_order SET token_seq=$2,business_date=$3,dispatched_at=now(),status=$4,version=version+1 WHERE id=$1 RETURNING *",
    [
      order.id,
      counter.next_value,
      date.business_date,
      release ? "PAID" : "PAYMENT_REVIEW",
    ],
  );
  await audit(
    db,
    null,
    v.id,
    null,
    release ? "order.dispatched" : "order.staged_for_review",
    order.id,
    { token: counter.next_value },
  );
  await emit(
    db,
    v.id,
    null,
    order.id,
    release ? "order.dispatched" : "payment.review_required",
    {},
  );
  return updated;
}
export async function orderView(
  db: DB,
  p: Principal | null,
  id: string,
  tracking = false,
) {
  const o = await one(
    db,
    "SELECT o.*,v.token_prefix FROM customer_order o JOIN venue v ON v.id=o.venue_id WHERE o.id=$1",
    [id],
  );
  assert(o, "NOT_FOUND", "Order not found", 404);
  if (p) await venueFor(db, p, o.venue_id);
  const all = (
    await db.query(
      "SELECT u.*,s.name station_name,t.name outlet_name,t.collection_point FROM work_unit u JOIN station s ON s.id=u.station_id JOIN outlet t ON t.id=u.outlet_id WHERE u.order_id=$1 ORDER BY u.ordinal,u.id",
      [id],
    )
  ).rows;
  let units = all;
  const creator = p?.id === o.actor_id;
  const full = tracking || creator || (!!p && can(p, "orders", o.venue_id));
  if (p && !full) {
    units = all.filter((u) =>
      can(p, "orders", o.venue_id, u.outlet_id, u.station_id),
    );
    assert(units.length || creator, "NOT_FOUND", "Order not found", 404);
  }
  const finance =
    tracking ||
    (!!p &&
      (can(p, "refund", o.venue_id) ||
        units.some((u) =>
          can(p, "report", o.venue_id, u.outlet_id, u.station_id),
        ))) ||
    creator;
  const refunds = (
    await db.query(
      "SELECT r.id,r.status,r.reason_code,r.note,r.amount_minor,r.mode,r.version,r.requested_by,r.created_at,r.succeeded_at,a.unit_id,a.amount_minor allocation_amount FROM refund_request r JOIN refund_allocation a ON a.refund_id=r.id WHERE r.order_id=$1",
      [id],
    )
  ).rows.filter((r) => full || units.some((u) => u.id === r.unit_id));
  const result: any = {
    id: o.id,
    venue_id: o.venue_id,
    alias: o.alias,
    token: o.token_seq
      ? `${o.token_prefix}-${String(o.token_seq).padStart(3, "0")}`
      : null,
    created_at: o.created_at,
    paid_at: o.paid_at,
    business_date: o.business_date,
    status: o.status,
    progress: units.length ? progress(units) : o.status,
    version: o.version,
    currency: o.currency,
    units: units.map(({ commission_minor, ...u }) =>
      finance
        ? u
        : (({
            amount_minor,
            gross_minor,
            discount_minor,
            tax_minor,
            ...safe
          }) => safe)(u),
    ),
    refunds: refunds.map((r) =>
      !finance
        ? { id: r.id, status: r.status, unit_id: r.unit_id }
        : tracking
          ? {
              id: r.id,
              status: r.status,
              unit_id: r.unit_id,
              amount_minor: r.allocation_amount,
            }
          : {
              ...r,
              amount_minor: r.allocation_amount,
              note: full ? r.note : "Refund for this outlet",
            },
    ),
  };
  if (finance)
    result.total_minor =
      full || creator
        ? o.total_minor
        : units.reduce((s, u) => s + u.amount_minor, 0);
  if (p && (full || creator)) {
    const intent = await one(
      db,
      "SELECT id,tender,status FROM payment_intent WHERE order_id=$1",
      [id],
    );
    result.payment = intent;
  }
  return result;
}
export async function moveUnits(db: DB, p: Principal, raw: unknown) {
  const input = transitionInput.parse(raw);
  assert(
    new Set(input.unitIds).size === input.unitIds.length,
    "INVALID_UNITS",
    "Duplicate units",
  );
  const units = (
    await db.query(
      "SELECT u.*,o.venue_id,o.pickup_hash FROM work_unit u JOIN customer_order o ON o.id=u.order_id WHERE u.id=ANY($1::uuid[]) ORDER BY u.id FOR UPDATE OF u",
      [input.unitIds],
    )
  ).rows;
  assert(
    units.length === input.unitIds.length,
    "NOT_FOUND",
    "Items not found",
    404,
  );
  for (const u of units) {
    assert(
      (
        await one(db, "SELECT status FROM customer_order WHERE id=$1", [
          u.order_id,
        ])
      ).status === "PAID",
      "ORDER_REVIEW",
      "Order requires manager review before fulfillment",
    );
    requirePermission(
      p,
      ["READY", "HANDOVER"].includes(input.action) ? "serve" : "cook",
      u.venue_id,
      u.outlet_id,
      u.station_id,
    );
    assert(
      u.version === input.expectedVersions[u.id],
      "STALE_VERSION",
      "Refresh this item before changing its status",
    );
    if (input.action === "HANDOVER") {
      if (
        !input.pickupCode ||
        hash(input.pickupCode.toUpperCase()) !== u.pickup_hash
      ) {
        requirePermission(p, "approve", u.venue_id, u.outlet_id);
        assert(
          input.overrideReason,
          "PICKUP_VERIFICATION",
          "A valid pickup code or manager override reason is required",
        );
      }
    }
    const change = transition(u, input.action);
    const keys = Object.keys(change);
    await db.query(
      `UPDATE work_unit SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(",")},version=version+1 WHERE id=$1`,
      [u.id, ...Object.values(change)],
    );
    await audit(
      db,
      p,
      u.venue_id,
      u.outlet_id,
      "unit." + input.action.toLowerCase(),
      u.id,
      {
        from: { prep: u.prep_state, serve: u.serve_state },
        ...change,
        reason: input.overrideReason,
      },
    );
    await emit(db, u.venue_id, u.outlet_id, u.order_id, "unit.changed", {
      unitId: u.id,
      version: u.version + 1,
    });
  }
  return {
    units: (
      await db.query(
        "SELECT id,prep_state,serve_state,cancel_state,version FROM work_unit WHERE id=ANY($1::uuid[])",
        [input.unitIds],
      )
    ).rows,
  };
}
