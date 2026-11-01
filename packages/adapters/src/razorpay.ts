import { createHmac, timingSafeEqual } from "node:crypto";
import { transaction, one, pool } from "../../db/src.js";
import { assert, hash } from "../../domain/src/index.js";
import type { PaymentProvider, ProviderResult } from "./payments.js";
export function signatureValid(
  body: string | Buffer,
  signature: string,
  secret: string,
) {
  const expected = createHmac("sha256", secret).update(body).digest();
  const supplied = Buffer.from(signature, "hex");
  return (
    supplied.length === expected.length && timingSafeEqual(expected, supplied)
  );
}
export class RazorpayProvider implements PaymentProvider {
  constructor() {
    assert(
      process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET,
      "PROVIDER_CONFIG",
      "Configure Razorpay credentials",
      503,
    );
    if (!process.env.RAZORPAY_KEY_ID.startsWith("rzp_test_"))
      assert(
        process.env.LIVE_PAYMENTS_APPROVED === "true",
        "LAUNCH_GATE",
        "Live payments are disabled until launch decisions and certification are approved",
        503,
      );
  }
  async request(
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const r = await fetch("https://api.razorpay.com/v1/" + path, {
      method,
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            process.env.RAZORPAY_KEY_ID + ":" + process.env.RAZORPAY_KEY_SECRET,
          ).toString("base64"),
        "Content-Type": "application/json",
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const data: any = await r.json();
    assert(
      r.ok,
      "PROVIDER_REQUEST",
      data.error?.description || "Provider request failed",
      502,
    );
    return data;
  }
  async ensureOrder(intent: any) {
    const receipt = intent.order_id;
    const claim = await transaction(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1))", [
        intent.operation_key,
      ]);
      const old = await one(
        db,
        "SELECT * FROM provider_operation WHERE operation_key=$1",
        [intent.operation_key],
      );
      if (old) return { op: old, fresh: false };
      return {
        op: await one(
          db,
          "INSERT INTO provider_operation(operation_key,kind,amount_minor,provider_ref,status) VALUES($1,'ORDER',$2,$3,'SUBMITTING') RETURNING *",
          [
            intent.operation_key,
            intent.amount_minor,
            "pending_" + hash(intent.operation_key),
          ],
        ),
        fresh: true,
      };
    });
    if (!claim.fresh) {
      if (claim.op.provider_ref.startsWith("order_"))
        return { id: claim.op.provider_ref };
      const list = await this.request(
        "orders?receipt=" + encodeURIComponent(receipt),
      );
      const found = list.items?.find(
        (o: any) =>
          o.receipt === receipt &&
          o.amount === intent.amount_minor &&
          o.currency === "INR",
      );
      assert(
        found,
        "PROVIDER_UNKNOWN",
        "Provider order is unresolved. Retry recovery later; no second order will be submitted",
        409,
      );
      await pool.query(
        "UPDATE provider_operation SET provider_ref=$2,status='PENDING' WHERE operation_key=$1",
        [intent.operation_key, found.id],
      );
      return found;
    }
    try {
      const order = await this.request("orders", "POST", {
        amount: intent.amount_minor,
        currency: "INR",
        receipt,
        notes: { tokenex_order_id: intent.order_id },
      });
      await pool.query(
        "UPDATE provider_operation SET provider_ref=$2,status='PENDING' WHERE operation_key=$1",
        [intent.operation_key, order.id],
      );
      return order;
    } catch (error) {
      await pool.query(
        "UPDATE provider_operation SET status='UNKNOWN',last_error=$2 WHERE operation_key=$1",
        [
          intent.operation_key,
          error instanceof Error ? error.message : "Provider error",
        ],
      );
      throw error;
    }
  }
  async capture(): Promise<ProviderResult> {
    throw new Error(
      "Razorpay charges must be completed through hosted checkout and verified server-side",
    );
  }
  async refund(
    key: string,
    amount: number,
    paymentRef?: string,
  ): Promise<ProviderResult> {
    assert(
      typeof paymentRef === "string" && paymentRef.startsWith("pay_"),
      "PROVIDER_REFERENCE",
      "Original payment reference is required",
    );
    await pool.query(
      "INSERT INTO provider_operation(operation_key,kind,amount_minor,provider_ref,parent_reference,status) VALUES($1,'REFUND',$2,$3,$4,'SUBMITTING') ON CONFLICT(operation_key) DO NOTHING",
      [key, amount, "pending_" + hash(key), paymentRef],
    );
    const result = await this.request(
      "payments/" + encodeURIComponent(paymentRef) + "/refund",
      "POST",
      { amount, notes: { tokenex_operation: key } },
      { "X-Refund-Idempotency": hash(key) },
    );
    const status =
      result.status === "processed"
        ? "SUCCEEDED"
        : result.status === "failed"
          ? "FAILED"
          : "PENDING";
    await pool.query(
      "UPDATE provider_operation SET provider_ref=$2,status=$3 WHERE operation_key=$1",
      [key, result.id, status],
    );
    return { reference: result.id, status };
  }
  async lookup(key: string): Promise<ProviderResult | null> {
    const op = (
      await pool.query(
        "SELECT * FROM provider_operation WHERE operation_key=$1",
        [key],
      )
    ).rows[0];
    if (!op) return null;
    if (op.kind === "ORDER") {
      if (!op.provider_ref.startsWith("order_"))
        return { reference: op.provider_ref, status: "UNKNOWN" };
      const payments = await this.request(
        "orders/" + encodeURIComponent(op.provider_ref) + "/payments",
      );
      const paid = payments.items?.find(
        (p: any) =>
          p.status === "captured" &&
          p.amount === op.amount_minor &&
          p.currency === "INR",
      );
      return paid
        ? { reference: paid.id, status: "SUCCEEDED" }
        : { reference: op.provider_ref, status: "PENDING" };
    }
    if (op.provider_ref.startsWith("rfnd_")) {
      const refund = await this.request(
        "refunds/" + encodeURIComponent(op.provider_ref),
      );
      return {
        reference: refund.id,
        status:
          refund.status === "processed"
            ? "SUCCEEDED"
            : refund.status === "failed"
              ? "FAILED"
              : "PENDING",
      };
    }
    // Refund requests have an operation-specific idempotency guarantee; replay uses the permanent key.
    return this.refund(key, op.amount_minor, op.parent_reference);
  }
}
