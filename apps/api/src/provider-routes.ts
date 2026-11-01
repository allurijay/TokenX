import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { transaction, one, pool } from "../../../packages/db/src.js";
import {
  assert,
  requirePermission,
  can,
} from "../../../packages/domain/src/index.js";
import {
  RazorpayProvider,
  signatureValid,
} from "../../../packages/adapters/src/razorpay.js";
import { principal } from "./auth.js";
import { venueFor } from "./catalog.js";
import { finalizeCapture, orderView } from "./orders.js";
import { id } from "../../../packages/contracts/src/index.js";
export async function providerRoutes(app: FastifyInstance) {
  async function authorized(req: any) {
    return transaction(async (db) => {
      const p = await principal(db, req);
      const intent = await one(
        db,
        "SELECT i.*,o.venue_id,o.actor_id FROM payment_intent i JOIN customer_order o ON o.id=i.order_id WHERE i.id=$1",
        [id.parse(req.params.id)],
      );
      assert(intent, "NOT_FOUND", "Payment not found", 404);
      await venueFor(db, p, intent.venue_id);
      requirePermission(p, "checkout", intent.venue_id);
      assert(
        intent.actor_id === p.id || can(p, "approve", intent.venue_id),
        "FORBIDDEN",
        "Checkout belongs to another session",
        403,
      );
      assert(
        intent.tender === "DIGITAL",
        "INVALID_TENDER",
        "Digital payment required",
      );
      return intent;
    });
  }
  app.post("/v1/payments/:id/hosted-checkout", async (req) => {
    assert(
      process.env.PAYMENT_PROVIDER === "razorpay",
      "PROVIDER_DISABLED",
      "Razorpay is not configured",
      503,
    );
    const intent = await authorized(req);
    const provider = new RazorpayProvider();
    const previous = await provider.lookup(intent.operation_key);
    if (previous?.status === "SUCCEEDED") {
      await transaction((db) =>
        finalizeCapture(db, intent.id, previous.reference, intent.amount_minor),
      );
      return { data: { paid: true, orderId: intent.order_id } };
    }
    const order = await provider.ensureOrder(intent);
    await pool.query(
      "UPDATE payment_intent SET provider_order_id=$2 WHERE id=$1",
      [intent.id, order.id],
    );
    return {
      data: {
        key: process.env.RAZORPAY_KEY_ID,
        order_id: order.id,
        amount: intent.amount_minor,
        currency: "INR",
        name: "Tokenex",
        description: "Food court order",
      },
    };
  });
  app.post("/v1/payments/:id/verify", async (req) => {
    assert(
      process.env.PAYMENT_PROVIDER === "razorpay",
      "PROVIDER_DISABLED",
      "Razorpay is not configured",
      503,
    );
    const b = z
      .object({
        razorpay_payment_id: z.string().regex(/^pay_[a-zA-Z0-9]+$/),
        razorpay_order_id: z.string(),
        razorpay_signature: z.string(),
      })
      .parse(req.body);
    const intent = await authorized(req);
    assert(
      intent.provider_order_id === b.razorpay_order_id,
      "PROVIDER_MISMATCH",
      "Order reference mismatch",
    );
    assert(
      signatureValid(
        intent.provider_order_id + "|" + b.razorpay_payment_id,
        b.razorpay_signature,
        process.env.RAZORPAY_KEY_SECRET!,
      ),
      "INVALID_SIGNATURE",
      "Invalid payment signature",
      400,
    );
    const payment = await new RazorpayProvider().request(
      "payments/" + b.razorpay_payment_id,
    );
    assert(
      payment.order_id === intent.provider_order_id &&
        payment.status === "captured" &&
        payment.currency === "INR" &&
        payment.amount === intent.amount_minor,
      "PAYMENT_PENDING",
      "Payment is not yet captured. Recovery will verify it",
    );
    return {
      data: await transaction(async (db) => {
        await finalizeCapture(db, intent.id, payment.id, payment.amount);
        return orderView(db, await principal(db, req), intent.order_id);
      }),
    };
  });
  await app.register(async (scope) => {
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_req, body, done) => done(null, body),
    );
    scope.post("/v1/webhooks/razorpay", async (req) => {
      assert(
        process.env.PAYMENT_PROVIDER === "razorpay" &&
          process.env.RAZORPAY_WEBHOOK_SECRET,
        "PROVIDER_DISABLED",
        "Webhook is not configured",
        503,
      );
      const raw = req.body as Buffer;
      const signature = String(req.headers["x-razorpay-signature"] || "");
      assert(
        signatureValid(raw, signature, process.env.RAZORPAY_WEBHOOK_SECRET),
        "INVALID_SIGNATURE",
        "Invalid webhook signature",
        400,
      );
      const event = JSON.parse(raw.toString("utf8"));
      const eventId = String(req.headers["x-razorpay-event-id"] || "");
      assert(
        eventId && eventId.length < 200,
        "INVALID_EVENT",
        "Missing provider event ID",
        400,
      );
      // Persist only identifiers needed for authoritative API verification, not customer payment data.
      const payment = event.payload?.payment?.entity,
        refund = event.payload?.refund?.entity;
      const safe = {
        event: event.event,
        paymentId: payment?.id,
        orderId: payment?.order_id,
        refundId: refund?.id,
      };
      await pool.query(
        "INSERT INTO webhook_inbox(provider,event_id,payload) VALUES('razorpay',$1,$2) ON CONFLICT(provider,event_id) DO NOTHING",
        [eventId, JSON.stringify(safe)],
      );
      return { received: true };
    });
  });
}
