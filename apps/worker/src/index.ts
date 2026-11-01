import { RazorpayProvider } from "../../../packages/adapters/src/razorpay.js";
import { pool, transaction, one } from "../../../packages/db/src.js";
import { paymentProvider } from "../../../packages/adapters/src/payments.js";
import { finishRefund } from "../../api/src/refunds.js";
import { finalizeCapture } from "../../api/src/orders.js";
export async function tick() {
  if (process.env.PAYMENT_PROVIDER === "razorpay") {
    const events = (
      await pool.query(
        "SELECT * FROM webhook_inbox WHERE processed_at IS NULL AND attempts<20 ORDER BY created_at LIMIT 100",
      )
    ).rows;
    for (const e of events) {
      try {
        const provider = new RazorpayProvider();
        const data = e.payload;
        if (data.paymentId) {
          const payment = await provider.request(
            "payments/" + encodeURIComponent(data.paymentId),
          );
          const intent = (
            await pool.query(
              "SELECT * FROM payment_intent WHERE provider_order_id=$1",
              [payment.order_id],
            )
          ).rows[0];
          if (intent)
            await pool.query(
              "INSERT INTO payment_attempt(intent_id,provider_payment_id,status,amount_minor,currency,error_code) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(provider_payment_id) DO UPDATE SET status=CASE WHEN payment_attempt.status='CAPTURED' THEN 'CAPTURED' ELSE EXCLUDED.status END,observed_at=now()",
              [
                intent.id,
                payment.id,
                payment.status.toUpperCase(),
                payment.amount,
                payment.currency,
                payment.error_code || null,
              ],
            );
          if (
            intent &&
            payment.status === "captured" &&
            payment.currency === "INR"
          )
            await transaction((db) =>
              finalizeCapture(db, intent.id, payment.id, payment.amount),
            );
        }
        if (data.refundId) {
          const refund = await provider.request(
            "refunds/" + encodeURIComponent(data.refundId),
          );
          const r = (
            await pool.query(
              "SELECT r.* FROM refund_request r JOIN capture c ON c.id=r.capture_id WHERE r.provider_ref=$1 OR (r.operation_key=$2 AND c.provider_ref=$3)",
              [
                refund.id,
                refund.notes?.tokenex_operation || "",
                refund.payment_id,
              ],
            )
          ).rows[0];
          if (
            r &&
            refund.status === "processed" &&
            r.amount_minor === refund.amount
          )
            await transaction((db) => finishRefund(db, r.id, refund.id));
        }
        await pool.query(
          "UPDATE webhook_inbox SET processed_at=now() WHERE id=$1",
          [e.id],
        );
      } catch (error) {
        await pool.query(
          "UPDATE webhook_inbox SET attempts=attempts+1,last_error=$2 WHERE id=$1",
          [e.id, error instanceof Error ? error.message : "Webhook failed"],
        );
      }
    }
  }

  // Provider calls occur outside application transactions. Replay uses the same permanent operation key.
  const candidates = await pool.query(
    "SELECT r.* FROM refund_request r JOIN customer_order o ON o.id=r.order_id JOIN payment_intent p ON p.order_id=o.id WHERE r.status IN ('APPROVED','SUBMITTING','PENDING','UNKNOWN') AND p.tender='DIGITAL' ORDER BY r.created_at LIMIT 25",
  );
  for (const r of candidates.rows) {
    try {
      await transaction(async (db) => {
        await db.query(
          "UPDATE refund_request SET status='SUBMITTING',updated_at=now() WHERE id=$1 AND status='APPROVED'",
          [r.id],
        );
      });
      const provider = paymentProvider();
      const previous = await provider.lookup(r.operation_key);
      const capture = (
        await pool.query("SELECT provider_ref FROM capture WHERE id=$1", [
          r.capture_id,
        ])
      ).rows[0];
      const result =
        previous ||
        (await provider.refund(
          r.operation_key,
          r.amount_minor,
          capture.provider_ref,
        ));
      if (result.status === "SUCCEEDED")
        await transaction((db) => finishRefund(db, r.id, result.reference));
      else
        await pool.query(
          "UPDATE refund_request SET status=$2,updated_at=now() WHERE id=$1 AND status<>'SUCCEEDED'",
          [r.id, result.status],
        );
    } catch (error) {
      console.error(
        "Refund recovery requires attention",
        r.id,
        error instanceof Error ? error.message : "error",
      );
      await pool.query(
        "UPDATE refund_request SET status='UNKNOWN',updated_at=now() WHERE id=$1 AND status<>'SUCCEEDED'",
        [r.id],
      );
    }
  }
  const pending = (
    await pool.query(
      "SELECT * FROM payment_intent WHERE status IN ('PENDING','UNKNOWN') AND tender='DIGITAL' ORDER BY created_at LIMIT 100",
    )
  ).rows;
  for (const p of pending) {
    const result = await paymentProvider().lookup(p.operation_key);
    if (result?.status === "SUCCEEDED")
      await transaction((db) =>
        finalizeCapture(db, p.id, result.reference, p.amount_minor),
      );
  }
}
if (process.argv[1]?.endsWith("/index.ts")) {
  let stop = false;
  process.on("SIGTERM", () => {
    stop = true;
  });
  process.on("SIGINT", () => {
    stop = true;
  });
  console.log("Tokenex worker started");
  while (!stop) {
    try {
      await tick();
    } catch (e) {
      console.error("Worker tick failed", e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await pool.end();
}
