import { providerRoutes } from "./provider-routes.js";
import { mediaRoutes } from "./media.js";
import { encrypt, totp, verifyOtp } from "./security.js";
import { extraRoutes } from "./extras.js";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { pool, transaction, one, type DB } from "../../../packages/db/src.js";
import {
  assert,
  hash,
  passwordValid,
  DomainError,
  requirePermission,
  can,
  type Principal,
} from "../../../packages/domain/src/index.js";
import { id, money } from "../../../packages/contracts/src/index.js";
import { principal } from "./auth.js";
import { catalog, venueFor, checkItem } from "./catalog.js";
import {
  makeQuote,
  checkout,
  finalizeCapture,
  orderView,
  moveUnits,
  dispatch,
} from "./orders.js";
import {
  requestRefund,
  approveRefund,
  finishRefund,
  requestExcessRefund,
} from "./refunds.js";
import { configSchemas, saveConfig, addStaff } from "./configuration.js";
import { audit, emit, idempotent, journal } from "./common.js";
import { report, availableBalance } from "./finance.js";
import { paymentProvider } from "../../../packages/adapters/src/payments.js";
export async function buildApp() {
  const app = Fastify({
    logger:
      process.env.NODE_ENV !== "test"
        ? {
            redact: [
              "req.headers.cookie",
              "req.headers.authorization",
              "req.body.password",
              "res.headers.set-cookie",
            ],
          }
        : false,
    bodyLimit: 1024 * 1024,
  });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy:
      process.env.NODE_ENV === "production"
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "https://checkout.razorpay.com"],
              styleSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://fonts.googleapis.com",
              ],
              fontSrc: ["'self'", "https://fonts.gstatic.com"],
              imgSrc: ["'self'", "data:"],
              connectSrc: [
                "'self'",
                "https://api.razorpay.com",
                "https://checkout.razorpay.com",
                "https://lumberjack.razorpay.com",
              ],
              frameSrc: [
                "https://api.razorpay.com",
                "https://checkout.razorpay.com",
              ],
              objectSrc: ["'none'"],
              baseUri: ["'self'"],
              frameAncestors: ["'none'"],
            },
          }
        : false,
  });
  await app.register(rateLimit, {
    max: 600,
    timeWindow: "1 minute",
    keyGenerator: (req) => hash(req.cookies.tokenex_session || req.ip),
  });
  await app.register(swagger, {
    openapi: {
      info: { title: "Tokenex API", version: "0.1.0" },
      components: {
        securitySchemes: {
          session: { type: "apiKey", in: "cookie", name: "tokenex_session" },
        },
      },
    },
  });
  await app.register(swaggerUI, { routePrefix: "/api-docs" });
  app.addHook("onRequest", async (req) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers.origin)
      assert(
        req.headers.origin === process.env.APP_ORIGIN,
        "INVALID_ORIGIN",
        "Request origin is not allowed",
        403,
      );
  });
  app.setErrorHandler((error: any, req, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: {
          code: "VALIDATION",
          message: "Check the submitted fields",
          fieldErrors: error.flatten(),
          retryable: false,
        },
        requestId: req.id,
      });
    const status =
      error instanceof DomainError
        ? error.status
        : error.code === "23505"
          ? 409
          : error.statusCode || 500;
    const code =
      error instanceof DomainError
        ? error.code
        : error.code === "23505"
          ? "CONFLICT"
          : status === 500
            ? "INTERNAL_ERROR"
            : "REQUEST_ERROR";
    if (status === 500) req.log.error(error);
    return reply.code(status).send({
      error: {
        code,
        message:
          status === 500 ? "The request could not be completed" : error.message,
        retryable: status >= 500,
      },
      requestId: req.id,
    });
  });
  function get(
    path: string,
    fn: (db: DB, p: Principal, req: any) => Promise<any>,
  ) {
    app.get("/v1" + path, async (req, reply) => ({
      data: await transaction(async (db) =>
        fn(db, await principal(db, req), req),
      ),
      meta: { requestId: req.id },
    }));
  }
  function post(
    path: string,
    fn: (db: DB, p: Principal, req: any) => Promise<any>,
    method: "POST" | "PUT" | "DELETE" = "POST",
  ) {
    app.route({
      method,
      url: "/v1" + path,
      schema: { summary: path, security: [{ session: [] }] },
      handler: async (req) => ({
        data: await transaction(async (db) => {
          const p = await principal(db, req);
          return idempotent(
            db,
            p,
            method + req.url,
            req.headers["idempotency-key"],
            req.body,
            () => fn(db, p, req),
          );
        }),
        meta: { requestId: req.id },
      }),
    });
  }
  app.get("/health", async () => {
    await pool.query("SELECT 1");
    return { status: "ok", provider: process.env.PAYMENT_PROVIDER };
  });
  app.post(
    "/v1/auth/login",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
          keyGenerator: (req: any) => req.ip,
        },
      },
    },
    async (req, reply) => {
      const b = z
        .object({
          email: z.email(),
          password: z.string().max(200),
          otp: z.string().optional(),
        })
        .parse(req.body);
      const result = await transaction(async (db) => {
        const u = await one(
          db,
          "SELECT * FROM app_user WHERE email=$1 AND active",
          [b.email.toLowerCase()],
        );
        assert(
          u && passwordValid(b.password, u.password_hash),
          "INVALID_LOGIN",
          "Email or password is incorrect",
          401,
        );
        if (u.mfa_enabled)
          assert(
            b.otp && verifyOtp(u.email, u.mfa_secret, b.otp),
            "MFA_REQUIRED",
            "Enter the code from your authenticator app",
            401,
          );
        const token = randomBytes(32).toString("base64url");
        await db.query(
          "INSERT INTO session(id_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')",
          [hash(token), u.id],
        );
        return { token };
      });
      reply.setCookie("tokenex_session", result.token, {
        path: "/",
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        maxAge: 43200,
      });
      return { data: { signedIn: true } };
    },
  );
  app.post("/v1/auth/logout", async (req, reply) => {
    if (req.cookies.tokenex_session)
      await pool.query("DELETE FROM session WHERE id_hash=$1", [
        hash(req.cookies.tokenex_session),
      ]);
    reply.clearCookie("tokenex_session", { path: "/" });
    return { data: { signedOut: true } };
  });
  get("/me", async (db, p) => ({
    ...p,
    provider: process.env.PAYMENT_PROVIDER || "sandbox",
    mfaRequired:
      process.env.NODE_ENV === "production" &&
      p.grants.some(
        (g) => g.role === "SUPER_ADMIN" || g.capabilities.includes("finance"),
      ),
    venues: (
      await db.query("SELECT * FROM venue WHERE id=ANY($1::uuid[])", [
        p.grants.map((g) => g.venue_id),
      ])
    ).rows,
  }));
  get("/catalog", async (db, p, req) =>
    catalog(db, p, id.parse(req.query.venueId)),
  );
  get("/devices", async (db, p, req) => {
    const v = await venueFor(db, p, id.parse(req.query.venueId));
    return (
      await db.query(
        "SELECT id,venue_id,name,kind,active,version FROM device WHERE venue_id=$1 ORDER BY name",
        [v.id],
      )
    ).rows;
  });
  post("/quotes", (db, p, req) => makeQuote(db, p, req.body));
  post("/checkouts", (db, p, req) => checkout(db, p, req.body));
  get("/orders", async (db, p, req) => {
    const v = await venueFor(db, p, id.parse(req.query.venueId));
    assert(
      p.grants.some(
        (g) => g.venue_id === v.id && !["KIOSK", "DISPLAY"].includes(g.role),
      ),
      "FORBIDDEN",
      "Order list is restricted",
      403,
    );
    const rows = (
      await db.query(
        "SELECT id FROM customer_order WHERE venue_id=$1 AND created_at < $2 ORDER BY created_at DESC,id DESC LIMIT 100",
        [v.id, req.query.before || "9999-01-01"],
      )
    ).rows;
    const result = [];
    for (const r of rows) {
      try {
        result.push(await orderView(db, p, r.id));
      } catch (e) {
        if (!(e instanceof DomainError && e.status === 404)) throw e;
      }
    }
    return result;
  });
  get("/queues", async (db, p, req) => {
    const v = await venueFor(db, p, id.parse(req.query.venueId));
    assert(
      p.grants.some(
        (g) => g.venue_id === v.id && !["KIOSK", "DISPLAY"].includes(g.role),
      ),
      "FORBIDDEN",
      "Staff access required",
      403,
    );
    const rows = (
      await db.query(
        "SELECT o.id FROM customer_order o WHERE o.venue_id=$1 AND o.status='PAID' AND EXISTS(SELECT 1 FROM work_unit u WHERE u.order_id=o.id AND u.cancel_state<>'CANCELLED' AND u.serve_state<>'HANDED_OVER') ORDER BY o.paid_at,o.id",
        [v.id],
      )
    ).rows;
    const result = [];
    for (const r of rows) {
      try {
        const o = await orderView(db, p, r.id);
        if (
          o.units.some(
            (u: any) =>
              u.cancel_state !== "CANCELLED" && u.serve_state !== "HANDED_OVER",
          )
        )
          result.push(o);
      } catch (e) {
        if (!(e instanceof DomainError && e.status === 404)) throw e;
      }
    }
    return result;
  });
  get("/orders/:id", (db, p, req) => orderView(db, p, id.parse(req.params.id)));
  post("/payments/:id/confirm-cash", async (db, p, req) => {
    const b = z.object({ shiftId: id, receivedMinor: money }).parse(req.body);
    const intent = await one(
      db,
      "SELECT i.*,o.venue_id,o.device_id FROM payment_intent i JOIN customer_order o ON o.id=i.order_id WHERE i.id=$1 FOR UPDATE OF i",
      [id.parse(req.params.id)],
    );
    assert(intent, "NOT_FOUND", "Payment not found", 404);
    await venueFor(db, p, intent.venue_id);
    requirePermission(p, "checkout", intent.venue_id);
    assert(
      intent.tender === "CASH" && intent.status === "PENDING",
      "INVALID_TENDER",
      "Not a pending cash payment",
    );
    const shift = await one(
      db,
      "SELECT * FROM cash_shift WHERE id=$1 AND closed_at IS NULL FOR UPDATE",
      [b.shiftId],
    );
    assert(
      shift && shift.actor_id === p.id && shift.device_id === intent.device_id,
      "SHIFT_REQUIRED",
      "Open your shift on this POS",
    );
    assert(
      b.receivedMinor >= intent.amount_minor,
      "INSUFFICIENT_CASH",
      "Received amount is insufficient",
    );
    await db.query(
      "UPDATE payment_intent SET shift_id=$2,received_minor=$3,change_minor=$4 WHERE id=$1",
      [
        intent.id,
        shift.id,
        b.receivedMinor,
        b.receivedMinor - intent.amount_minor,
      ],
    );
    await finalizeCapture(
      db,
      intent.id,
      "cash:" + intent.id,
      intent.amount_minor,
    );
    return orderView(db, p, intent.order_id);
  });
  // This separate endpoint is deliberately sandbox-only. It cannot activate a real payment.
  app.post("/v1/payments/:id/sandbox-capture", async (req) => {
    assert(
      process.env.PAYMENT_PROVIDER === "sandbox",
      "PROVIDER_DISABLED",
      "Sandbox is disabled",
      503,
    );
    const paymentId = id.parse((req.params as any).id);
    const intent = await transaction(async (db) => {
      const p = await principal(db, req);
      const i = await one(
        db,
        "SELECT i.*,o.actor_id,o.venue_id FROM payment_intent i JOIN customer_order o ON o.id=i.order_id WHERE i.id=$1",
        [paymentId],
      );
      assert(i, "NOT_FOUND", "Payment not found", 404);
      await venueFor(db, p, i.venue_id);
      requirePermission(p, "checkout", i.venue_id);
      assert(
        i.actor_id === p.id || can(p, "approve", i.venue_id),
        "FORBIDDEN",
        "This checkout belongs to another session",
        403,
      );
      assert(
        i.tender === "DIGITAL",
        "INVALID_TENDER",
        "Digital payment required",
      );
      return i;
    });
    const result = await paymentProvider().capture(
      intent.operation_key,
      intent.amount_minor,
    );
    const data = await transaction(async (db) => {
      await finalizeCapture(
        db,
        intent.id,
        result.reference,
        intent.amount_minor,
      );
      return orderView(db, await principal(db, req), intent.order_id);
    });
    return { data };
  });
  post("/orders/:id/cancel-checkout", async (db, p, req) => {
    const o = await one(
      db,
      "SELECT * FROM customer_order WHERE id=$1 FOR UPDATE",
      [id.parse(req.params.id)],
    );
    assert(o && o.actor_id === p.id, "NOT_FOUND", "Checkout not found", 404);
    const i = await one(
      db,
      "SELECT * FROM payment_intent WHERE order_id=$1 FOR UPDATE",
      [o.id],
    );
    assert(
      o.status === "PENDING" && i.status === "PENDING",
      "PAYMENT_UNRESOLVED",
      "Payment already resolved or needs review",
    );
    assert(
      i.tender !== "DIGITAL",
      "PAYMENT_UNRESOLVED",
      "Verify digital payment before cancelling; ask a manager",
    );
    await db.query("UPDATE customer_order SET status='CANCELLED' WHERE id=$1", [
      o.id,
    ]);
    await db.query("UPDATE payment_intent SET status='CANCELLED' WHERE id=$1", [
      i.id,
    ]);
    return { cancelled: true };
  });
  post("/units/transition", (db, p, req) => moveUnits(db, p, req.body));
  post("/orders/:id/refund-requests", (db, p, req) =>
    requestRefund(db, p, id.parse(req.params.id), req.body),
  );
  post("/refund-requests/:id/decision", (db, p, req) =>
    approveRefund(db, p, id.parse(req.params.id), req.body),
  );
  get("/refund-requests", async (db, p, req) => {
    const v = await venueFor(db, p, id.parse(req.query.venueId));
    const rows = (
      await db.query(
        "SELECT r.*,o.alias,o.token_seq,i.tender FROM refund_request r JOIN customer_order o ON o.id=r.order_id JOIN payment_intent i ON i.order_id=o.id WHERE o.venue_id=$1 ORDER BY r.created_at DESC LIMIT 100",
        [v.id],
      )
    ).rows;
    const result = [];
    for (const r of rows) {
      const allocations = (
        await db.query(
          "SELECT a.*,u.outlet_id,u.station_id,u.name FROM refund_allocation a JOIN work_unit u ON u.id=a.unit_id WHERE a.refund_id=$1",
          [r.id],
        )
      ).rows;
      const scoped = allocations.filter((a) =>
        can(p, "refund", v.id, a.outlet_id, a.station_id),
      );
      if (r.policy.excessCapture && can(p, "finance", v.id)) {
        result.push({ ...r, allocations: [], canApprove: true });
        continue;
      }
      if (scoped.length) {
        result.push({
          ...r,
          note:
            scoped.length === allocations.length
              ? r.note
              : "Mixed-outlet request",
          amount_minor: scoped.reduce((s, a) => s + a.amount_minor, 0),
          allocations: scoped,
          canApprove:
            scoped.length === allocations.length &&
            scoped.every((a) =>
              can(p, "approve", v.id, a.outlet_id, a.station_id),
            ),
        });
      }
    }
    return result;
  });
  get("/operations/excess-captures", async (db, p, req) => {
    const v = await venueFor(db, p, id.parse(req.query.venueId));
    requirePermission(p, "finance", v.id);
    return (
      await db.query(
        "SELECT c.*,o.id order_id,o.alias FROM capture c JOIN payment_intent i ON i.id=c.intent_id JOIN customer_order o ON o.id=i.order_id WHERE o.venue_id=$1 AND c.provider_ref<>i.provider_ref AND NOT EXISTS(SELECT 1 FROM refund_request r WHERE r.capture_id=c.id AND r.status NOT IN ('REJECTED','WITHDRAWN')) ORDER BY c.confirmed_at",
        [v.id],
      )
    ).rows;
  });
  post("/captures/:id/refund-excess", (db, p, req) =>
    requestExcessRefund(db, p, id.parse(req.params.id), req.body),
  );
  post("/refund-requests/:id/confirm-cash", async (db, p, req) => {
    const r = await one(
      db,
      "SELECT r.*,o.venue_id,i.tender FROM refund_request r JOIN customer_order o ON o.id=r.order_id JOIN payment_intent i ON i.order_id=o.id WHERE r.id=$1",
      [id.parse(req.params.id)],
    );
    assert(r, "NOT_FOUND", "Refund not found", 404);
    requirePermission(p, "checkout", r.venue_id);
    assert(
      r.tender === "CASH" && r.status === "APPROVED",
      "INVALID_TENDER",
      "Cash refund must be approved",
    );
    const b = z
      .object({ shiftId: id, disbursed: z.literal(true) })
      .parse(req.body);
    const shift = await one(
      db,
      "SELECT * FROM cash_shift WHERE id=$1 AND actor_id=$2 AND venue_id=$3 AND closed_at IS NULL FOR UPDATE",
      [b.shiftId, p.id, r.venue_id],
    );
    assert(shift, "SHIFT_REQUIRED", "Open your cash shift");
    await db.query(
      "INSERT INTO cash_movement(shift_id,amount_minor,reason,actor_id) VALUES($1,$2,$3,$4)",
      [shift.id, -r.amount_minor, "refund:" + r.id, p.id],
    );
    return finishRefund(db, r.id, "cash-refund:" + r.id);
  });
  post("/availability-holds", async (db, p, req) => {
    const b = z
      .object({
        outletId: id,
        stationId: id.optional(),
        itemId: id.optional(),
        reason: z.string().min(3).max(500),
        expiresAt: z.iso.datetime().optional(),
      })
      .parse(req.body);
    const o = await one(db, "SELECT * FROM outlet WHERE id=$1", [b.outletId]);
    assert(o, "NOT_FOUND", "Outlet not found", 404);
    await venueFor(db, p, o.venue_id);
    let station = b.stationId;
    if (b.itemId) {
      const i = await one(
        db,
        "SELECT * FROM menu_item WHERE id=$1 AND outlet_id=$2",
        [b.itemId, o.id],
      );
      assert(i, "INVALID_SCOPE", "Item not in outlet");
      station = i.station_id || o.default_station_id;
    }
    if (station)
      assert(
        await one(db, "SELECT id FROM station WHERE id=$1 AND outlet_id=$2", [
          station,
          o.id,
        ]),
        "INVALID_SCOPE",
        "Station not in outlet",
      );
    requirePermission(p, "hold", o.venue_id, o.id, station);
    await db.query("SELECT id FROM venue WHERE id=$1 FOR UPDATE", [o.venue_id]);
    const r = await one(
      db,
      "INSERT INTO availability_hold(venue_id,outlet_id,station_id,item_id,actor_id,reason,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [
        o.venue_id,
        o.id,
        b.itemId ? null : station || null,
        b.itemId || null,
        p.id,
        b.reason,
        b.expiresAt || null,
      ],
    );
    await audit(db, p, o.venue_id, o.id, "availability.held", r.id, b);
    await emit(db, o.venue_id, o.id, null, "availability.changed", {});
    return r;
  });
  post("/availability-holds/:id/release", async (db, p, req) => {
    const h = await one(
      db,
      "SELECT * FROM availability_hold WHERE id=$1 FOR UPDATE",
      [id.parse(req.params.id)],
    );
    assert(h, "NOT_FOUND", "Hold not found", 404);
    await venueFor(db, p, h.venue_id);
    let station = h.station_id;
    if (h.item_id) {
      const i = await one(db, "SELECT station_id FROM menu_item WHERE id=$1", [
        h.item_id,
      ]);
      station = i.station_id;
    }
    requirePermission(p, "hold", h.venue_id, h.outlet_id, station);
    assert(
      h.actor_id === p.id || can(p, "configure", h.venue_id, h.outlet_id),
      "FORBIDDEN",
      "Only the creator or manager can release this hold",
      403,
    );
    await db.query(
      "UPDATE availability_hold SET released_at=now() WHERE id=$1",
      [h.id],
    );
    await audit(db, p, h.venue_id, h.outlet_id, "availability.resumed", h.id);
    await emit(db, h.venue_id, h.outlet_id, null, "availability.changed", {});
    return { released: true };
  });
  for (const kind of Object.keys(
    configSchemas,
  ) as (keyof typeof configSchemas)[]) {
    post("/" + kind, (db, p, req) => saveConfig(db, p, kind, req.body));
    post(
      "/" + kind + "/:id",
      (db, p, req) =>
        saveConfig(db, p, kind, req.body, id.parse(req.params.id)),
      "PUT",
    );
  }
  post("/menus/publish", async (db, p, req) => {
    const b = z.object({ outletId: id }).parse(req.body);
    const o = await one(db, "SELECT * FROM outlet WHERE id=$1", [b.outletId]);
    assert(o, "NOT_FOUND", "Outlet not found", 404);
    await venueFor(db, p, o.venue_id);
    requirePermission(p, "configure", o.venue_id, o.id);
    const items = (
      await db.query(
        "SELECT i.*,coalesce(i.station_id,c.station_id,$2::uuid) resolved FROM menu_item i LEFT JOIN category c ON c.id=i.category_id WHERE i.outlet_id=$1 AND i.active",
        [o.id, o.default_station_id],
      )
    ).rows;
    for (const i of items)
      assert(
        await one(
          db,
          "SELECT id FROM station WHERE id=$1 AND outlet_id=$2 AND active",
          [i.resolved, o.id],
        ),
        "INVALID_ROUTE",
        `${i.name} needs an active station`,
      );
    await db.query(
      "UPDATE menu_item SET published=true,version=version+1 WHERE outlet_id=$1 AND active",
      [o.id],
    );
    await db.query("UPDATE venue SET menu_version=menu_version+1 WHERE id=$1", [
      o.venue_id,
    ]);
    await audit(db, p, o.venue_id, o.id, "menu.published", o.id);
    await emit(db, o.venue_id, o.id, null, "menu.published", {});
    return { published: items.length };
  });
  post("/staff", (db, p, req) => addStaff(db, p, req.body));
  get("/staff", async (db, p, req) => {
    const v = await venueFor(db, p, id.parse(req.query.venueId));
    return (
      await db.query(
        "SELECT u.id,u.email,u.name,u.active,g.role,g.outlet_id,g.station_id FROM app_user u JOIN role_assignment g ON g.user_id=u.id WHERE g.venue_id=$1 ORDER BY u.name",
        [v.id],
      )
    ).rows.filter((u) => can(p, "staff", v.id, u.outlet_id, u.station_id));
  });
  post("/staff/:id/revoke", async (db, p, req) => {
    const userId = id.parse(req.params.id);
    assert(
      userId !== p.id,
      "SELF_REVOKE",
      "Use another administrator to revoke your account",
    );
    const grants = (
      await db.query("SELECT * FROM role_assignment WHERE user_id=$1", [userId])
    ).rows;
    assert(grants.length, "NOT_FOUND", "Staff not found", 404);
    for (const g of grants) {
      await venueFor(db, p, g.venue_id);
      requirePermission(p, "staff", g.venue_id, g.outlet_id, g.station_id);
      assert(
        g.role !== "SUPER_ADMIN",
        "PRIVILEGE_CEILING",
        "Super-admin revocation requires identity administration",
      );
    }
    await db.query("UPDATE app_user SET active=false WHERE id=$1", [userId]);
    await db.query("DELETE FROM session WHERE user_id=$1", [userId]);
    for (const g of grants)
      await audit(db, p, g.venue_id, g.outlet_id, "staff.revoked", userId);
    return { revoked: true };
  });
  post("/shifts", async (db, p, req) => {
    const b = z
      .object({ venueId: id, deviceId: id, floatMinor: money })
      .parse(req.body);
    await venueFor(db, p, b.venueId);
    requirePermission(p, "shift", b.venueId);
    assert(
      await one(
        db,
        "SELECT id FROM device WHERE id=$1 AND venue_id=$2 AND kind='POS' AND active",
        [b.deviceId, b.venueId],
      ),
      "INVALID_DEVICE",
      "Active POS required",
    );
    return one(
      db,
      "INSERT INTO cash_shift(venue_id,device_id,actor_id,float_minor) VALUES($1,$2,$3,$4) RETURNING *",
      [b.venueId, b.deviceId, p.id, b.floatMinor],
    );
  });
  get("/shifts", async (db, p, req) => {
    const v = await venueFor(db, p, id.parse(req.query.venueId));
    requirePermission(p, "shift", v.id);
    return (
      await db.query(
        "SELECT * FROM cash_shift WHERE venue_id=$1 AND actor_id=$2 ORDER BY opened_at DESC LIMIT 50",
        [v.id, p.id],
      )
    ).rows;
  });
  post("/shifts/:id/close", async (db, p, req) => {
    const b = z.object({ countedMinor: money }).parse(req.body);
    const s = await one(
      db,
      "SELECT * FROM cash_shift WHERE id=$1 AND actor_id=$2 AND closed_at IS NULL FOR UPDATE",
      [id.parse(req.params.id), p.id],
    );
    assert(s, "NOT_FOUND", "Open shift not found", 404);
    requirePermission(p, "shift", s.venue_id);
    const total = await one(
      db,
      "SELECT coalesce(sum(amount_minor),0)::bigint amount FROM payment_intent WHERE shift_id=$1 AND status='CAPTURED'",
      [s.id],
    );
    const movements = await one(
      db,
      "SELECT coalesce(sum(amount_minor),0)::bigint amount FROM cash_movement WHERE shift_id=$1",
      [s.id],
    );
    const variance =
      b.countedMinor - s.float_minor - total.amount - movements.amount;
    await audit(db, p, s.venue_id, null, "shift.closed", s.id, {
      counted: b.countedMinor,
      variance,
    });
    return one(
      db,
      "UPDATE cash_shift SET closed_at=now(),counted_minor=$2,variance_minor=$3 WHERE id=$1 RETURNING *",
      [s.id, b.countedMinor, variance],
    );
  });
  get("/reports/sales", (db, p, req) =>
    report(
      db,
      p,
      id.parse(req.query.venueId),
      req.query.from || new Date(Date.now() - 30 * 86400000).toISOString(),
      req.query.to || new Date().toISOString(),
    ),
  );
  get("/audit-events", async (db, p, req) => {
    const v = await venueFor(db, p, id.parse(req.query.venueId));
    return (
      await db.query(
        "SELECT a.*,u.name actor_name FROM audit_event a LEFT JOIN app_user u ON u.id=a.actor_id WHERE a.venue_id=$1 AND a.id<$2 ORDER BY a.id DESC LIMIT 200",
        [v.id, req.query.before || Number.MAX_SAFE_INTEGER],
      )
    ).rows.filter(
      (a) => can(p, "audit", v.id, a.outlet_id) || a.actor_id === p.id,
    );
  });
  get("/settlement-batches", async (db, p, req) => {
    const v = await venueFor(db, p, id.parse(req.query.venueId));
    return (
      await db.query(
        "SELECT b.*,o.name outlet_name FROM settlement_batch b JOIN outlet o ON o.id=b.outlet_id WHERE b.venue_id=$1 ORDER BY b.created_at DESC LIMIT 100",
        [v.id],
      )
    ).rows.filter((b) => can(p, "report", v.id, b.outlet_id));
  });
  post("/settlement-batches", async (db, p, req) => {
    const b = z
      .object({ outletId: id, amountMinor: money.positive() })
      .parse(req.body);
    const o = await one(db, "SELECT * FROM outlet WHERE id=$1 FOR UPDATE", [
      b.outletId,
    ]);
    assert(o, "NOT_FOUND", "Outlet not found", 404);
    await venueFor(db, p, o.venue_id);
    requirePermission(p, "finance", o.venue_id);
    assert(
      b.amountMinor <= (await availableBalance(db, o.id)),
      "INSUFFICIENT_BALANCE",
      "Payout exceeds owner balance",
    );
    const r = await one(
      db,
      "INSERT INTO settlement_batch(venue_id,outlet_id,amount_minor,created_by) VALUES($1,$2,$3,$4) RETURNING *",
      [o.venue_id, o.id, b.amountMinor, p.id],
    );
    await db.query(
      "INSERT INTO settlement_line(batch_id,journal_line_id) SELECT $1,l.id FROM journal_line l JOIN journal_transaction t ON t.id=l.transaction_id WHERE l.outlet_id=$2 AND l.account='outlet_payable' AND t.created_at<=$3",
      [r.id, o.id, r.cutoff_at],
    );
    await audit(db, p, o.venue_id, o.id, "settlement.created", r.id, b);
    return r;
  });
  post("/settlement-batches/:id/approve", async (db, p, req) => {
    const b = await one(
      db,
      "SELECT * FROM settlement_batch WHERE id=$1 FOR UPDATE",
      [id.parse(req.params.id)],
    );
    assert(b, "NOT_FOUND", "Batch not found", 404);
    await venueFor(db, p, b.venue_id);
    requirePermission(p, "finance", b.venue_id);
    assert(
      b.created_by !== p.id,
      "SELF_APPROVAL",
      "A different finance approver must approve",
      403,
    );
    assert(b.status === "DRAFT", "INVALID_TRANSITION", "Batch is not a draft");
    const v = await one(db, "SELECT currency FROM venue WHERE id=$1", [
      b.venue_id,
    ]);
    await db.query("SELECT id FROM outlet WHERE id=$1 FOR UPDATE", [
      b.outlet_id,
    ]);
    assert(
      b.amount_minor <= (await availableBalance(db, b.outlet_id)),
      "INSUFFICIENT_BALANCE",
      "Owner balance has changed",
    );
    await journal(
      db,
      b.venue_id,
      v.currency,
      "payout-reserve:" + b.id,
      "Reserve approved payout",
      [
        {
          outlet: b.outlet_id,
          account: "outlet_payable",
          debit: b.amount_minor,
        },
        {
          outlet: b.outlet_id,
          account: "payout_payable",
          credit: b.amount_minor,
        },
      ],
    );
    await audit(db, p, b.venue_id, b.outlet_id, "settlement.approved", b.id);
    return one(
      db,
      "UPDATE settlement_batch SET status='APPROVED',approved_by=$2,version=version+1 WHERE id=$1 RETURNING *",
      [b.id, p.id],
    );
  });
  post("/settlement-batches/:id/record-payment", async (db, p, req) => {
    const input = z
      .object({ bankReference: z.string().min(6).max(120) })
      .parse(req.body);
    const b = await one(
      db,
      "SELECT * FROM settlement_batch WHERE id=$1 FOR UPDATE",
      [id.parse(req.params.id)],
    );
    assert(b, "NOT_FOUND", "Batch not found", 404);
    await venueFor(db, p, b.venue_id);
    requirePermission(p, "finance", b.venue_id);
    assert(
      b.status === "APPROVED",
      "INVALID_TRANSITION",
      "Approve batch before recording evidence",
    );
    const v = await one(db, "SELECT currency FROM venue WHERE id=$1", [
      b.venue_id,
    ]);
    await journal(
      db,
      b.venue_id,
      v.currency,
      "payout-paid:" + b.id,
      "Bank-confirmed owner payout",
      [
        {
          outlet: b.outlet_id,
          account: "payout_payable",
          debit: b.amount_minor,
        },
        { outlet: b.outlet_id, account: "bank", credit: b.amount_minor },
      ],
    );
    await audit(db, p, b.venue_id, b.outlet_id, "settlement.paid", b.id, input);
    return one(
      db,
      "UPDATE settlement_batch SET status='PAID',bank_reference=$2,version=version+1 WHERE id=$1 RETURNING *",
      [b.id, input.bankReference],
    );
  });
  get("/reconciliation", async (db, p, req) => {
    const v = await venueFor(db, p, id.parse(req.query.venueId));
    requirePermission(p, "finance", v.id);
    return {
      records: (
        await db.query(
          "SELECT * FROM provider_record WHERE venue_id=$1 ORDER BY created_at DESC LIMIT 100",
          [v.id],
        )
      ).rows,
      cases: (
        await db.query(
          "SELECT * FROM reconciliation_case WHERE venue_id=$1 ORDER BY created_at DESC LIMIT 100",
          [v.id],
        )
      ).rows,
    };
  });
  post("/reconciliation/imports", async (db, p, req) => {
    const b = z
      .object({
        venueId: id,
        records: z
          .array(
            z.object({
              externalId: z.string().min(1),
              kind: z.enum(["CAPTURE", "REFUND", "FEE", "SETTLEMENT"]),
              amountMinor: money,
              currency: z.string().length(3),
              reference: z.string().min(1),
            }),
          )
          .max(500),
      })
      .parse(req.body);
    const v = await venueFor(db, p, b.venueId);
    requirePermission(p, "finance", v.id);
    let imported = 0;
    for (const r of b.records) {
      assert(
        r.currency === v.currency,
        "CURRENCY_MISMATCH",
        "Currency must match venue",
      );
      const record = await one(
        db,
        "INSERT INTO provider_record(venue_id,external_id,kind,amount_minor,currency,reference,evidence_hash) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(venue_id,external_id) DO NOTHING RETURNING *",
        [
          v.id,
          r.externalId,
          r.kind,
          r.amountMinor,
          r.currency,
          r.reference,
          hash(JSON.stringify(r)),
        ],
      );
      if (!record) {
        const old = await one(
          db,
          "SELECT * FROM provider_record WHERE venue_id=$1 AND external_id=$2",
          [v.id, r.externalId],
        );
        assert(
          old.evidence_hash === hash(JSON.stringify(r)),
          "IMPORT_CONFLICT",
          "Provider record changed; investigate before import",
        );
        continue;
      }
      imported++;
      let match;
      if (r.kind === "CAPTURE")
        match = await one(
          db,
          "SELECT c.id FROM capture c JOIN payment_intent i ON i.id=c.intent_id JOIN customer_order o ON o.id=i.order_id WHERE c.provider_ref=$1 AND c.amount_minor=$2 AND o.venue_id=$3",
          [r.reference, r.amountMinor, v.id],
        );
      if (r.kind === "REFUND")
        match = await one(
          db,
          "SELECT r.id FROM refund_request r JOIN customer_order o ON o.id=r.order_id WHERE r.provider_ref=$1 AND r.amount_minor=$2 AND r.status='SUCCEEDED' AND o.venue_id=$3",
          [r.reference, r.amountMinor, v.id],
        );
      if (match)
        await db.query("UPDATE provider_record SET matched=true WHERE id=$1", [
          record.id,
        ]);
      else
        await db.query(
          "INSERT INTO reconciliation_case(record_id,venue_id,reason) VALUES($1,$2,$3)",
          [
            record.id,
            v.id,
            r.kind === "FEE" || r.kind === "SETTLEMENT"
              ? "Requires finance classification"
              : "Missing reference or amount mismatch",
          ],
        );
    }
    await audit(db, p, v.id, null, "reconciliation.imported", v.id, {
      imported,
    });
    return { imported };
  });
  post("/reconciliation/cases/:id/resolve", async (db, p, req) => {
    const b = z.object({ note: z.string().min(10).max(1000) }).parse(req.body);
    const c = await one(
      db,
      "SELECT c.*,r.kind,r.amount_minor,r.currency FROM reconciliation_case c JOIN provider_record r ON r.id=c.record_id WHERE c.id=$1 FOR UPDATE OF c",
      [id.parse(req.params.id)],
    );
    assert(c, "NOT_FOUND", "Case not found", 404);
    await venueFor(db, p, c.venue_id);
    requirePermission(p, "finance", c.venue_id);
    assert(c.status === "OPEN", "INVALID_TRANSITION", "Case resolved");
    assert(
      ["FEE", "SETTLEMENT"].includes(c.kind),
      "UNRESOLVED_PAYMENT",
      "Refresh payment/refund evidence; cannot manually mark money successful",
    );
    await journal(db, c.venue_id, c.currency, "recon:" + c.record_id, b.note, [
      {
        account: c.kind === "FEE" ? "provider_fee_expense" : "bank",
        debit: c.amount_minor,
      },
      { account: "provider_receivable", credit: c.amount_minor },
    ]);
    await db.query(
      "UPDATE reconciliation_case SET status='RESOLVED',resolution=$2,resolved_by=$3 WHERE id=$1",
      [c.id, b.note, p.id],
    );
    await db.query("UPDATE provider_record SET matched=true WHERE id=$1", [
      c.record_id,
    ]);
    await audit(db, p, c.venue_id, null, "reconciliation.resolved", c.id, b);
    return { resolved: true };
  });
  post("/incidents", async (db, p, req) => {
    const b = z
      .object({
        outletId: id,
        orderId: id.optional(),
        reason: z.string().min(5).max(1000),
      })
      .parse(req.body);
    const o = await one(db, "SELECT * FROM outlet WHERE id=$1", [b.outletId]);
    assert(o, "NOT_FOUND", "Outlet not found", 404);
    await venueFor(db, p, o.venue_id);
    assert(
      p.grants.some(
        (g) =>
          g.venue_id === o.venue_id && (!g.outlet_id || g.outlet_id === o.id),
      ),
      "FORBIDDEN",
      "Outside scope",
      403,
    );
    if (b.orderId)
      assert(
        await one(
          db,
          "SELECT id FROM customer_order WHERE id=$1 AND venue_id=$2",
          [b.orderId, o.venue_id],
        ),
        "INVALID_SCOPE",
        "Order outside venue",
      );
    return one(
      db,
      "INSERT INTO incident(venue_id,outlet_id,order_id,actor_id,reason) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [o.venue_id, o.id, b.orderId || null, p.id, b.reason],
    );
  });
  post("/orders/:id/print", async (db, p, req) => {
    const view = await orderView(db, p, id.parse(req.params.id));
    requirePermission(p, "print", view.venue_id);
    const prior = await one(db, "SELECT id FROM print_job WHERE order_id=$1", [
      view.id,
    ]);
    return one(
      db,
      "INSERT INTO print_job(order_id,actor_id,copy,status) VALUES($1,$2,$3,'BROWSER_READY') RETURNING *",
      [view.id, p.id, !!prior],
    );
  });
  // Tracking secret is exchanged in a POST body, then stored in a short-lived HttpOnly cookie.
  app.post("/v1/tracking/session", async (req, reply) => {
    const b = z.object({ secret: z.string().min(24).max(100) }).parse(req.body);
    const o = await pool.query(
      "SELECT id FROM customer_order WHERE tracking_hash=$1 AND tracking_expires_at>now()",
      [hash(b.secret)],
    );
    assert(o.rows[0], "NOT_FOUND", "Tracking link expired or invalid", 404);
    reply.setCookie("tokenex_tracking", b.secret, {
      path: "/v1/tracking",
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: 86400,
    });
    return { data: { orderId: o.rows[0].id } };
  });
  app.get("/v1/tracking", async (req) => ({
    data: await transaction(async (db) => {
      const secret = req.cookies.tokenex_tracking;
      assert(secret, "UNAUTHENTICATED", "Open your receipt tracking link", 401);
      const o = await one(
        db,
        "SELECT id FROM customer_order WHERE tracking_hash=$1 AND tracking_expires_at>now()",
        [hash(secret)],
      );
      assert(o, "NOT_FOUND", "Tracking link expired", 404);
      return orderView(db, null, o.id, true);
    }),
  }));
  get("/display", async (db, p, req) => {
    const v = await venueFor(db, p, id.parse(req.query.venueId));
    requirePermission(p, "display", v.id);
    return (
      await db.query(
        "SELECT o.token_seq,v.token_prefix,left(o.alias,1)||'…' alias,t.name outlet,u.prep_state,u.serve_state,count(*)::int quantity FROM work_unit u JOIN customer_order o ON o.id=u.order_id JOIN venue v ON v.id=o.venue_id JOIN outlet t ON t.id=u.outlet_id WHERE o.venue_id=$1 AND u.cancel_state='ACTIVE' AND u.serve_state<>'HANDED_OVER' AND o.paid_at>now()-interval '1 day' GROUP BY o.token_seq,v.token_prefix,o.alias,t.name,u.prep_state,u.serve_state ORDER BY o.token_seq",
        [v.id],
      )
    ).rows;
  });
  // SSE payloads are invalidations only. Clients fetch scoped snapshots, never cross-owner raw order data.
  app.get("/v1/events", async (req, reply) => {
    let last = Number(
      req.headers["last-event-id"] || (req.query as any).after || 0,
    );
    if (!Number.isSafeInteger(last) || last < 0) last = 0;
    const venue = id.parse((req.query as any).venueId);
    await transaction(async (db) => {
      const p = await principal(db, req);
      await venueFor(db, p, venue);
    });
    const fresh =
      !req.headers["last-event-id"] && (req.query as any).after === undefined;
    const latest = (
      await pool.query(
        "SELECT coalesce(max(id),0)::bigint id FROM outbox WHERE venue_id=$1",
        [venue],
      )
    ).rows[0].id;
    if (fresh || last > latest) last = latest;
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(
      `retry: 3000\nid: ${last}\nevent: change\ndata: {"type":"snapshot.required"}\n\n`,
    );
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const page = await transaction(async (db) => {
          const p = await principal(db, req);
          await venueFor(db, p, venue);
          const rows = (
            await db.query(
              "SELECT id,event_id,venue_id,outlet_id,type,created_at FROM outbox WHERE venue_id=$1 AND id>$2 ORDER BY id LIMIT 100",
              [venue, last],
            )
          ).rows;
          return {
            cursor: rows.at(-1)?.id ?? last,
            visible: rows.filter(
              (e) =>
                !e.outlet_id ||
                p.grants.some(
                  (g) =>
                    g.venue_id === venue &&
                    (!g.outlet_id || g.outlet_id === e.outlet_id),
                ),
            ),
          };
        });
        const data = page.visible;
        for (const e of data) {
          last = e.id;
          reply.raw.write(
            `id: ${e.id}\nevent: change\ndata: ${JSON.stringify({ eventId: e.event_id, type: e.type, occurredAt: e.created_at })}\n\n`,
          );
        }
        last = page.cursor;
        if (!data.length)
          reply.raw.write(`id: ${last}\nevent: checkpoint\ndata: {}\n\n`);
      } catch {
        clearInterval(timer);
        reply.raw.end();
      } finally {
        busy = false;
      }
    }, 750);
    req.raw.on("close", () => clearInterval(timer));
  });
  post("/auth/mfa/enroll", async (db, p) => {
    const otp = totp(p.email);
    await db.query("UPDATE app_user SET mfa_pending_secret=$2 WHERE id=$1", [
      p.id,
      encrypt(otp.secret.base32),
    ]);
    return { uri: otp.toString(), secret: otp.secret.base32 };
  });
  post("/auth/mfa/confirm", async (db, p, req) => {
    const b = z.object({ otp: z.string().regex(/^\d{6}$/) }).parse(req.body);
    const u = await one(db, "SELECT * FROM app_user WHERE id=$1 FOR UPDATE", [
      p.id,
    ]);
    assert(
      u.mfa_pending_secret && verifyOtp(p.email, u.mfa_pending_secret, b.otp),
      "INVALID_OTP",
      "The authenticator code is incorrect",
      400,
    );
    await db.query(
      "UPDATE app_user SET mfa_secret=mfa_pending_secret,mfa_pending_secret=NULL,mfa_enabled=true WHERE id=$1",
      [p.id],
    );
    for (const g of p.grants)
      await audit(db, p, g.venue_id, g.outlet_id, "security.mfa_enabled", p.id);
    return { enabled: true };
  });
  extraRoutes(get, post);
  await mediaRoutes(app);
  await providerRoutes(app);
  return app;
}
