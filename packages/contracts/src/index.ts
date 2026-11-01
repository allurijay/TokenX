import { z } from "zod";
import { reasons } from "../../domain/src/index.js";
export const id = z.uuid();
export const money = z.number().int().min(0).max(100_000_000);
export const quoteInput = z.object({
  venueId: id,
  deviceId: id,
  channel: z.enum(["POS", "KIOSK"]),
  customerAlias: z.string().trim().min(1).max(40).default("Guest"),
  discountMinor: money.default(0),
  lines: z
    .array(
      z.object({
        itemId: id,
        variantId: id.optional(),
        qty: z.number().int().min(1).max(50),
        modifierIds: z.array(id).max(20).default([]),
      }),
    )
    .min(1)
    .max(100),
});
export const checkoutInput = z.object({
  quoteId: id,
  tender: z.enum(["CASH", "DIGITAL"]),
  checkoutKey: z.string().min(8).max(160),
});
export const transitionInput = z.object({
  unitIds: z.array(id).min(1).max(100),
  expectedVersions: z.record(id, z.number().int()),
  action: z.enum(["ACKNOWLEDGE", "START", "COMPLETE", "READY", "HANDOVER"]),
  pickupCode: z.string().optional(),
  overrideReason: z.string().min(8).max(500).optional(),
});
export const refundInput = z.object({
  units: z
    .array(z.object({ unitId: id, amountMinor: money.optional() }))
    .min(1)
    .max(100),
  mode: z.enum(["CANCEL_AND_REFUND", "REFUND_ONLY"]),
  reasonCode: z.enum(reasons),
  note: z.string().trim().min(5).max(1000),
});
export const decisionInput = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  expectedVersion: z.number().int(),
  note: z.string().min(5).max(1000),
});
export const eventSchema = z.object({
  eventId: id,
  type: z.string(),
  aggregateVersion: z.number().int().optional(),
  occurredAt: z.iso.datetime(),
  scope: z.object({ venueId: id, outletId: id.nullable() }),
  data: z.unknown(),
});
