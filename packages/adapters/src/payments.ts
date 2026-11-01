import { RazorpayProvider } from "./razorpay.js";
import { transaction, one } from "../../db/src.js";
import { assert } from "../../domain/src/index.js";
export type ProviderResult = {
  reference: string;
  status: "SUCCEEDED" | "PENDING" | "UNKNOWN" | "FAILED";
};
export interface PaymentProvider {
  capture(key: string, amount: number): Promise<ProviderResult>;
  refund(
    key: string,
    amount: number,
    paymentRef?: string,
  ): Promise<ProviderResult>;
  lookup(key: string): Promise<ProviderResult | null>;
}
/** Persistent sandbox, not an actual bank or card processor. No network money movement. */
export class SandboxProvider implements PaymentProvider {
  async perform(
    kind: string,
    key: string,
    amount: number,
  ): Promise<ProviderResult> {
    assert(
      process.env.PAYMENT_PROVIDER === "sandbox" &&
        process.env.NODE_ENV !== "production",
      "PROVIDER_DISABLED",
      "Sandbox is disabled in production",
      503,
    );
    return transaction(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1))", [
        key,
      ]);
      let op = await one(
        db,
        "SELECT * FROM provider_operation WHERE operation_key=$1",
        [key],
      );
      if (op) {
        assert(
          op.amount_minor === amount && op.kind === kind,
          "PROVIDER_CONFLICT",
          "Provider operation conflicts",
        );
      } else
        op = await one(
          db,
          "INSERT INTO provider_operation(operation_key,kind,amount_minor,provider_ref,status) VALUES($1,$2,$3,$4,'SUCCEEDED') RETURNING *",
          [key, kind, amount, "sandbox_" + key],
        );
      return { reference: op.provider_ref, status: op.status };
    });
  }
  capture(key: string, amount: number) {
    return this.perform("CAPTURE", key, amount);
  }
  refund(key: string, amount: number) {
    return this.perform("REFUND", key, amount);
  }
  async lookup(key: string): Promise<ProviderResult | null> {
    return transaction(async (db) => {
      const op = await one(
        db,
        "SELECT * FROM provider_operation WHERE operation_key=$1",
        [key],
      );
      return op ? { reference: op.provider_ref, status: op.status } : null;
    });
  }
}
export function paymentProvider(): PaymentProvider {
  if (process.env.PAYMENT_PROVIDER === "razorpay")
    return new RazorpayProvider();
  assert(
    process.env.PAYMENT_PROVIDER === "sandbox",
    "PROVIDER_NOT_CONFIGURED",
    "Select and implement a verified live provider before production activation",
    503,
  );
  return new SandboxProvider();
}
