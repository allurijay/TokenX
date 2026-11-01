import { z } from "zod";
import { type DB, one } from "../../../packages/db/src.js";
import {
  assert,
  requirePermission,
  can,
  type Principal,
  hash,
  passwordHash,
} from "../../../packages/domain/src/index.js";
import { id, money } from "../../../packages/contracts/src/index.js";
import { audit, emit, uid } from "./common.js";
import { venueFor } from "./catalog.js";
import { orderView, dispatch } from "./orders.js";
type Handler = (db: DB, p: Principal, req: any) => Promise<any>;
export function extraRoutes(
  get: (path: string, fn: Handler) => void,
  post: (path: string, fn: Handler, method?: "POST" | "PUT" | "DELETE") => void,
) {
  post("/venues", async (db, p, req) => {
    assert(
      p.grants.some((g) => g.role === "SUPER_ADMIN"),
      "FORBIDDEN",
      "Super-admin required",
      403,
    );
    const b = z
      .object({
        name: z.string().min(2).max(120),
        timezone: z.string().default("Asia/Kolkata"),
        currency: z.literal("INR").default("INR"),
        tokenPrefix: z
          .string()
          .regex(/^[A-Z0-9]{1,6}$/)
          .default("A"),
        dayCutoff: z.number().int().min(0).max(23).default(0),
      })
      .parse(req.body);
    try {
      new Intl.DateTimeFormat("en", { timeZone: b.timezone }).format();
    } catch {
      assert(false, "INVALID_TIMEZONE", "Choose an IANA timezone", 400);
    }
    const v = await one(
      db,
      "INSERT INTO venue(organization_id,name,timezone,currency,token_prefix,day_cutoff) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [
        p.organization_id,
        b.name,
        b.timezone,
        b.currency,
        b.tokenPrefix,
        b.dayCutoff,
      ],
    );
    await db.query(
      "INSERT INTO role_assignment(user_id,venue_id,role) VALUES($1,$2,'SUPER_ADMIN')",
      [p.id, v.id],
    );
    await audit(db, p, v.id, null, "venue.created", v.id, b);
    return v;
  });
  post("/venues/:id/policy", async (db, p, req) => {
    const v = await venueFor(db, p, id.parse(req.params.id));
    requirePermission(p, "finance", v.id);
    const b = z
      .object({
        version: z.number().int(),
        refundLimit: money,
        refundDailyLimit: money,
        active: z.boolean(),
        commissionBps: z.number().int().min(0).max(10000).default(0),
        commissionEnabled: z.boolean().default(false),
      })
      .parse(req.body);
    assert(b.version === v.version, "STALE_VERSION", "Venue policy changed");
    assert(
      b.refundDailyLimit >= b.refundLimit,
      "INVALID_POLICY",
      "Daily limit must be at least the per-action limit",
    );
    await db.query(
      "UPDATE venue SET refund_limit=$2,refund_daily_limit=$3,active=$4,version=version+1 WHERE id=$1",
      [v.id, b.refundLimit, b.refundDailyLimit, b.active],
    );
    await db.query(
      "INSERT INTO financial_policy(venue_id,commission_bps,enabled,created_by) VALUES($1,$2,$3,$4)",
      [v.id, b.commissionBps, b.commissionEnabled, p.id],
    );
    await audit(db, p, v.id, null, "policy.updated", v.id, b);
    await emit(db, v.id, null, null, "menu.changed", {});
    return { updated: true };
  });
  post("/units/cancel-zero", async (db, p, req) => {
    const b = z
      .object({
        unitId: id,
        expectedVersion: z.number().int(),
        reason: z.string().min(5).max(500),
      })
      .parse(req.body);
    const u = await one(
      db,
      "SELECT u.*,o.venue_id FROM work_unit u JOIN customer_order o ON o.id=u.order_id WHERE u.id=$1 FOR UPDATE OF u",
      [b.unitId],
    );
    assert(u, "NOT_FOUND", "Unit not found", 404);
    await venueFor(db, p, u.venue_id);
    requirePermission(p, "refund", u.venue_id, u.outlet_id);
    assert(u.version === b.expectedVersion, "STALE_VERSION", "Item changed");
    assert(
      u.amount_minor === 0 &&
        u.cancel_state === "ACTIVE" &&
        u.serve_state !== "HANDED_OVER",
      "INVALID_TRANSITION",
      "Only uncollected zero-price items use this action",
    );
    if (!["RECEIVED", "ACKNOWLEDGED"].includes(u.prep_state))
      requirePermission(p, "approve", u.venue_id, u.outlet_id);
    await db.query(
      "UPDATE work_unit SET cancel_state='CANCELLED',version=version+1 WHERE id=$1",
      [u.id],
    );
    await audit(db, p, u.venue_id, u.outlet_id, "unit.zero_cancelled", u.id, b);
    await emit(db, u.venue_id, u.outlet_id, u.order_id, "unit.cancelled", {});
    return { cancelled: true };
  });
  post("/units/reassign", async (db, p, req) => {
    const b = z
      .object({
        unitId: id,
        stationId: id,
        expectedVersion: z.number().int(),
        reason: z.string().min(5).max(500),
      })
      .parse(req.body);
    const u = await one(
      db,
      "SELECT u.*,o.venue_id FROM work_unit u JOIN customer_order o ON o.id=u.order_id WHERE u.id=$1 FOR UPDATE OF u",
      [b.unitId],
    );
    assert(u, "NOT_FOUND", "Unit not found", 404);
    await venueFor(db, p, u.venue_id);
    requirePermission(p, "configure", u.venue_id, u.outlet_id);
    assert(u.version === b.expectedVersion, "STALE_VERSION", "Item changed");
    assert(
      u.cancel_state === "ACTIVE" &&
        ["RECEIVED", "ACKNOWLEDGED"].includes(u.prep_state),
      "INVALID_TRANSITION",
      "Only unstarted active items can be reassigned",
    );
    const s = await one(
      db,
      "SELECT * FROM station WHERE id=$1 AND outlet_id=$2 AND active",
      [b.stationId, u.outlet_id],
    );
    assert(s, "INVALID_ROUTE", "Choose an active station in the same outlet");
    const ticket = await one(
      db,
      "INSERT INTO station_ticket(order_id,outlet_id,station_id,route_version) VALUES($1,$2,$3,$4) ON CONFLICT(order_id,station_id,route_version) DO UPDATE SET order_id=EXCLUDED.order_id RETURNING id",
      [u.order_id, u.outlet_id, s.id, u.version + 1],
    );
    await db.query(
      "UPDATE work_unit SET station_id=$2,ticket_id=$3,version=version+1 WHERE id=$1",
      [u.id, s.id, ticket.id],
    );
    await audit(db, p, u.venue_id, u.outlet_id, "unit.reassigned", u.id, {
      from: u.station_id,
      to: s.id,
      reason: b.reason,
    });
    await emit(db, u.venue_id, u.outlet_id, u.order_id, "unit.reassigned", {
      unitId: u.id,
    });
    return { reassigned: true };
  });
  post("/units/rework", async (db, p, req) => {
    const b = z
      .object({
        unitId: id,
        expectedVersion: z.number().int(),
        reason: z.string().min(5).max(500),
      })
      .parse(req.body);
    const u = await one(
      db,
      "SELECT u.*,o.venue_id FROM work_unit u JOIN customer_order o ON o.id=u.order_id WHERE u.id=$1 FOR UPDATE OF u",
      [b.unitId],
    );
    assert(u, "NOT_FOUND", "Unit not found", 404);
    await venueFor(db, p, u.venue_id);
    requirePermission(p, "approve", u.venue_id, u.outlet_id);
    assert(
      u.version === b.expectedVersion &&
        u.prep_state === "COMPLETED" &&
        u.cancel_state === "ACTIVE",
      "INVALID_TRANSITION",
      "Select a completed active unit",
    );
    const line = await one(db, "SELECT * FROM order_line WHERE id=$1", [
      u.line_id,
    ]);
    const fresh = await one(
      db,
      "INSERT INTO order_line(suborder_id,item_id,snapshot,quantity) VALUES($1,$2,$3,1) RETURNING id",
      [
        line.suborder_id,
        line.item_id,
        JSON.stringify({ ...line.snapshot, reworkReason: b.reason }),
      ],
    );
    const result = await one(
      db,
      "INSERT INTO work_unit(line_id,order_id,outlet_id,station_id,ticket_id,ordinal,name,modifiers,amount_minor,gross_minor,rework_of) VALUES($1,$2,$3,$4,$5,0,$6,$7,0,0,$8) RETURNING *",
      [
        fresh.id,
        u.order_id,
        u.outlet_id,
        u.station_id,
        u.ticket_id,
        u.name + " (rework)",
        u.modifiers,
        u.id,
      ],
    );
    await audit(
      db,
      p,
      u.venue_id,
      u.outlet_id,
      "unit.rework_created",
      result.id,
      { original: u.id, reason: b.reason },
    );
    await emit(
      db,
      u.venue_id,
      u.outlet_id,
      u.order_id,
      "unit.rework_created",
      {},
    );
    return result;
  });
  post("/menu-items/:id/options", async (db, p, req) => {
    const b = z
      .object({
        groups: z
          .array(
            z.object({
              name: z.string().min(1).max(120),
              minSelect: z.number().int().min(0).max(20),
              maxSelect: z.number().int().min(1).max(20),
              options: z
                .array(
                  z.object({
                    name: z.string().min(1).max(120),
                    priceMinor: money,
                  }),
                )
                .min(1)
                .max(20),
            }),
          )
          .max(10),
        version: z.number().int(),
      })
      .parse(req.body);
    const i = await one(
      db,
      "SELECT i.*,o.venue_id FROM menu_item i JOIN outlet o ON o.id=i.outlet_id WHERE i.id=$1 FOR UPDATE OF i",
      [id.parse(req.params.id)],
    );
    assert(i, "NOT_FOUND", "Item not found", 404);
    await venueFor(db, p, i.venue_id);
    requirePermission(p, "configure", i.venue_id, i.outlet_id);
    assert(i.version === b.version, "STALE_VERSION", "Item changed");
    await db.query(
      "DELETE FROM modifier_option WHERE group_id IN (SELECT id FROM modifier_group WHERE item_id=$1)",
      [i.id],
    );
    await db.query("DELETE FROM modifier_group WHERE item_id=$1", [i.id]);
    for (const g of b.groups) {
      assert(
        g.minSelect <= g.maxSelect && g.maxSelect <= g.options.length,
        "INVALID_MODIFIERS",
        "Modifier bounds exceed options",
      );
      const group = await one(
        db,
        "INSERT INTO modifier_group(item_id,name,min_select,max_select) VALUES($1,$2,$3,$4) RETURNING id",
        [i.id, g.name, g.minSelect, g.maxSelect],
      );
      for (const o of g.options)
        await db.query(
          "INSERT INTO modifier_option(group_id,name,price_minor) VALUES($1,$2,$3)",
          [group.id, o.name, o.priceMinor],
        );
    }
    await db.query("UPDATE menu_item SET version=version+1 WHERE id=$1", [
      i.id,
    ]);
    await db.query("UPDATE venue SET menu_version=menu_version+1 WHERE id=$1", [
      i.venue_id,
    ]);
    await audit(db, p, i.venue_id, i.outlet_id, "modifiers.updated", i.id, b);
    await emit(db, i.venue_id, i.outlet_id, null, "menu.changed", {});
    return { updated: true };
  });
  post("/outlets/:id/schedule", async (db, p, req) => {
    const b = z
      .object({
        days: z
          .array(
            z.object({
              day: z.number().int().min(0).max(6),
              opens: z.string().regex(/^\d{2}:\d{2}$/),
              closes: z.string().regex(/^\d{2}:\d{2}$/),
            }),
          )
          .max(21),
      })
      .parse(req.body);
    const o = await one(db, "SELECT * FROM outlet WHERE id=$1", [
      id.parse(req.params.id),
    ]);
    assert(o, "NOT_FOUND", "Outlet not found", 404);
    await venueFor(db, p, o.venue_id);
    requirePermission(p, "configure", o.venue_id, o.id);
    await db.query("DELETE FROM operating_schedule WHERE outlet_id=$1", [o.id]);
    for (const d of b.days) {
      assert(
        d.opens < d.closes,
        "INVALID_SCHEDULE",
        "Use separate day entries for overnight hours",
      );
      await db.query(
        "INSERT INTO operating_schedule(outlet_id,day,opens,closes) VALUES($1,$2,$3,$4)",
        [o.id, d.day, d.opens, d.closes],
      );
    }
    await db.query("UPDATE venue SET menu_version=menu_version+1 WHERE id=$1", [
      o.venue_id,
    ]);
    await audit(db, p, o.venue_id, o.id, "schedule.updated", o.id, b);
    await emit(db, o.venue_id, o.id, null, "menu.changed", {});
    return { updated: true };
  });
  post("/shifts/:id/movements", async (db, p, req) => {
    const b = z
      .object({
        amountMinor: z.number().int().min(-100_000_000).max(100_000_000),
        reason: z.string().min(5).max(500),
      })
      .parse(req.body);
    const s = await one(
      db,
      "SELECT * FROM cash_shift WHERE id=$1 AND actor_id=$2 AND closed_at IS NULL FOR UPDATE",
      [id.parse(req.params.id), p.id],
    );
    assert(s, "NOT_FOUND", "Open shift not found", 404);
    requirePermission(p, "shift", s.venue_id);
    await db.query(
      "INSERT INTO cash_movement(shift_id,amount_minor,reason,actor_id) VALUES($1,$2,$3,$4)",
      [s.id, b.amountMinor, b.reason, p.id],
    );
    await audit(db, p, s.venue_id, null, "cash.movement", s.id, b);
    return { recorded: true };
  });
  get("/incidents", async (db, p, req) => {
    const v = await venueFor(db, p, id.parse(req.query.venueId));
    const rows = (
      await db.query(
        "SELECT * FROM incident WHERE venue_id=$1 ORDER BY created_at DESC LIMIT 100",
        [v.id],
      )
    ).rows;
    return rows.filter(
      (r) => can(p, "refund", v.id, r.outlet_id) || r.actor_id === p.id,
    );
  });
  post("/incidents/:id/resolve", async (db, p, req) => {
    const i = await one(db, "SELECT * FROM incident WHERE id=$1", [
      id.parse(req.params.id),
    ]);
    assert(i, "NOT_FOUND", "Incident not found", 404);
    await venueFor(db, p, i.venue_id);
    requirePermission(p, "refund", i.venue_id, i.outlet_id);
    await db.query("UPDATE incident SET status='RESOLVED' WHERE id=$1", [i.id]);
    await audit(db, p, i.venue_id, i.outlet_id, "incident.resolved", i.id);
    return { resolved: true };
  });
  get("/operations/health", async (db, p, req) => {
    const v = await venueFor(db, p, id.parse(req.query.venueId));
    requirePermission(p, "finance", v.id);
    return {
      unknownPayments: (
        await db.query(
          "SELECT i.id,i.status,i.created_at FROM payment_intent i JOIN customer_order o ON o.id=i.order_id WHERE o.venue_id=$1 AND (i.status='UNKNOWN' OR o.status='PAYMENT_REVIEW')",
          [v.id],
        )
      ).rows,
      agedRefunds: (
        await db.query(
          "SELECT r.id,r.status,r.created_at FROM refund_request r JOIN customer_order o ON o.id=r.order_id WHERE o.venue_id=$1 AND r.status IN ('UNKNOWN','FAILED','PENDING','SUBMITTING','APPROVED') AND r.created_at<now()-interval '30 minutes'",
          [v.id],
        )
      ).rows,
      missingDispatch: (
        await db.query(
          "SELECT id,status FROM customer_order WHERE venue_id=$1 AND paid_at IS NOT NULL AND dispatched_at IS NULL",
          [v.id],
        )
      ).rows,
    };
  });
  post("/orders/:id/release", async (db, p, req) => {
    const o = await one(
      db,
      "SELECT * FROM customer_order WHERE id=$1 FOR UPDATE",
      [id.parse(req.params.id)],
    );
    assert(o, "NOT_FOUND", "Order not found", 404);
    await venueFor(db, p, o.venue_id);
    requirePermission(p, "approve", o.venue_id);
    assert(
      o.status === "PAYMENT_REVIEW" && o.paid_at,
      "INVALID_TRANSITION",
      "Only paid orders awaiting review can be released",
    );
    const note = z
      .object({ reason: z.string().min(10).max(500) })
      .parse(req.body);
    const q = await one(db, "SELECT * FROM quote WHERE id=$1", [o.quote_id]);
    await dispatch(db, o, q);
    await db.query(
      "UPDATE customer_order SET status='PAID',version=version+1 WHERE id=$1",
      [o.id],
    );
    await emit(db, o.venue_id, null, o.id, "order.released", {});
    await audit(db, p, o.venue_id, null, "order.manually_released", o.id, note);
    return orderView(db, p, o.id);
  });
  post("/staff/:id/password", async (db, p, req) => {
    const b = z
      .object({ password: z.string().min(12).max(200) })
      .parse(req.body);
    const userId = id.parse(req.params.id);
    const grants = (
      await db.query("SELECT * FROM role_assignment WHERE user_id=$1", [userId])
    ).rows;
    assert(grants.length, "NOT_FOUND", "Staff not found", 404);
    for (const g of grants) {
      await venueFor(db, p, g.venue_id);
      requirePermission(p, "staff", g.venue_id, g.outlet_id, g.station_id);
      assert(
        g.role !== "SUPER_ADMIN" || userId === p.id,
        "FORBIDDEN",
        "Cannot reset another super-admin password here",
        403,
      );
    }
    await db.query("UPDATE app_user SET password_hash=$2 WHERE id=$1", [
      userId,
      passwordHash(b.password),
    ]);
    await db.query("DELETE FROM session WHERE user_id=$1", [userId]);
    for (const g of grants)
      await audit(
        db,
        p,
        g.venue_id,
        g.outlet_id,
        "staff.password_reset",
        userId,
      );
    return { reset: true };
  });
}
