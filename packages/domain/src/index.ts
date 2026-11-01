import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
export function assert(
  ok: unknown,
  code: string,
  message: string,
  status = 409,
): asserts ok {
  if (!ok) throw new DomainError(code, message, status);
}
export function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function passwordValid(password: string, stored: string) {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const a = Buffer.from(key, "hex"),
    b = scryptSync(password, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function allocate(total: number, weights: number[]): number[] {
  assert(
    Number.isSafeInteger(total) &&
      total >= 0 &&
      weights.every((n) => Number.isSafeInteger(n) && n >= 0),
    "INVALID_MONEY",
    "Invalid money",
  );
  const sum = weights.reduce((a, b) => a + BigInt(b), 0n);
  if (!sum) {
    assert(total === 0, "INVALID_MONEY", "Cannot allocate across zero value");
    return weights.map(() => 0);
  }
  const raw = weights.map((w, i) => ({
    i,
    n: (BigInt(total) * BigInt(w)) / sum,
    r: (BigInt(total) * BigInt(w)) % sum,
  }));
  let left = total - raw.reduce((s, x) => s + Number(x.n), 0);
  for (const x of [...raw].sort((a, b) =>
    a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1,
  )) {
    if (left-- <= 0) break;
    x.n++;
  }
  return raw.map((x) => Number(x.n));
}
export function inclusiveTax(amount: number, bps: number) {
  return Number(
    (BigInt(amount) * BigInt(bps) + BigInt(10000 + bps) / 2n) /
      BigInt(10000 + bps),
  );
}
export function exclusiveTax(amount: number, bps: number) {
  return Number((BigInt(amount) * BigInt(bps) + 5000n) / 10000n);
}
export function progress(units: any[]) {
  const u = units.filter((x) => x.cancel_state !== "CANCELLED");
  if (!u.length) return "ALL_CANCELLED";
  if (u.every((x) => x.serve_state === "HANDED_OVER")) return "COLLECTED";
  if (u.some((x) => x.serve_state === "HANDED_OVER"))
    return "PARTIALLY_COLLECTED";
  if (u.every((x) => x.serve_state === "READY_FOR_PICKUP")) return "READY";
  if (u.some((x) => x.serve_state === "READY_FOR_PICKUP"))
    return "PARTIALLY_READY";
  if (u.some((x) => x.prep_state !== "RECEIVED")) return "PREPARING";
  return "RECEIVED";
}
export function transition(unit: any, action: string) {
  assert(
    unit.cancel_state === "ACTIVE",
    "CANCELLATION_HOLD",
    "This item is cancelled or awaiting cancellation",
  );
  const prep = unit.prep_state,
    serve = unit.serve_state;
  switch (action) {
    case "ACKNOWLEDGE":
      assert(
        prep === "RECEIVED",
        "INVALID_TRANSITION",
        "Only received items can be acknowledged",
      );
      return { prep_state: "ACKNOWLEDGED" };
    case "START":
      assert(
        ["RECEIVED", "ACKNOWLEDGED"].includes(prep),
        "INVALID_TRANSITION",
        "Only new items can start",
      );
      return { prep_state: "PREPARING", started_at: new Date() };
    case "COMPLETE":
      assert(
        prep === "PREPARING",
        "INVALID_TRANSITION",
        "Start preparation first",
      );
      return { prep_state: "COMPLETED", completed_at: new Date() };
    case "READY":
      assert(
        prep === "COMPLETED" && serve === "WAITING",
        "INVALID_TRANSITION",
        "Complete preparation before marking ready",
      );
      return { serve_state: "READY_FOR_PICKUP", ready_at: new Date() };
    case "HANDOVER":
      assert(
        serve === "READY_FOR_PICKUP",
        "INVALID_TRANSITION",
        "Mark ready before handover",
      );
      return { serve_state: "HANDED_OVER", handed_at: new Date() };
    default:
      throw new DomainError("INVALID_ACTION", "Unknown action", 400);
  }
}
export const reasons = [
  "CUSTOMER_CHANGED_MIND",
  "ITEM_UNAVAILABLE",
  "DUPLICATE_ORDER",
  "WRONG_ITEM",
  "QUALITY_ISSUE",
  "PAYMENT_DUPLICATE",
  "SERVICE_DELAY",
  "OTHER",
] as const;
export type Grant = {
  role: string;
  venue_id: string;
  outlet_id: string | null;
  station_id: string | null;
  capabilities: string[];
};
export type Principal = {
  id: string;
  organization_id: string;
  name: string;
  email: string;
  grants: Grant[];
};
const permissions: Record<string, string[]> = {
  SUPER_ADMIN: ["*"],
  OWNER: [
    "catalog",
    "configure",
    "hold",
    "orders",
    "refund",
    "report",
    "staff",
    "audit",
  ],
  MANAGER: [
    "catalog",
    "configure",
    "hold",
    "orders",
    "cook",
    "serve",
    "refund",
    "approve",
    "report",
    "staff",
    "audit",
  ],
  BILLING: ["catalog", "checkout", "orders", "refund", "shift", "print"],
  COOK: ["catalog", "orders", "cook", "hold", "incident"],
  SERVER: ["catalog", "orders", "serve", "hold", "incident"],
  KIOSK: ["catalog", "checkout"],
  DISPLAY: ["display"],
};
export function can(
  p: Principal,
  action: string,
  venue: string,
  outlet?: string,
  station?: string,
) {
  return p.grants.some(
    (g) =>
      g.venue_id === venue &&
      (!g.outlet_id || g.outlet_id === outlet) &&
      (!g.station_id || g.station_id === station) &&
      ((permissions[g.role] || []).includes("*") ||
        (permissions[g.role] || []).includes(action) ||
        g.capabilities.includes(action)),
  );
}
export function requirePermission(
  p: Principal,
  action: string,
  venue: string,
  outlet?: string,
  station?: string,
) {
  assert(
    can(p, action, venue, outlet, station),
    "FORBIDDEN",
    "You do not have permission for this action",
    403,
  );
}
