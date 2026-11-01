import { performance } from "node:perf_hooks";
import { writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { buildApp } from "../apps/api/src/app.js";
import { pool } from "../packages/db/src.js";
process.env.NODE_ENV = "test";
const app = await buildApp();
const login = await app.inject({
  method: "POST",
  url: "/v1/auth/login",
  payload: {
    email: "admin@tokenex.local",
    password: process.env.DEMO_PASSWORD,
  },
});
if (login.statusCode !== 200) throw new Error("Seed demo database first");
const cookie = login.cookies[0].name + "=" + login.cookies[0].value;
async function request(path: string, body?: any) {
  const r = await app.inject({
    method: body ? "POST" : "GET",
    url: "/v1" + path,
    headers: { cookie, "idempotency-key": randomUUID() },
    payload: body,
  });
  if (r.statusCode !== 200) throw new Error(r.body);
  return r.json().data;
}
const me = await request("/me"),
  venue = me.venues[0].id,
  cat = await request("/catalog?venueId=" + venue),
  devices = await request("/devices?venueId=" + venue),
  device = devices.find((x: any) => x.kind === "POS").id;
const count = Number(process.env.LOAD_ORDERS || 50),
  times: number[] = [];
const start = performance.now();
const orders = await Promise.all(
  Array.from({ length: count }, async (_, i) => {
    const t = performance.now();
    const q = await request("/quotes", {
      venueId: venue,
      deviceId: device,
      channel: "POS",
      customerAlias: "Load " + i,
      lines: [{ itemId: cat.items[0].id, qty: 1 }],
    });
    const c = await request("/checkouts", {
      quoteId: q.id,
      tender: "DIGITAL",
      checkoutKey: randomUUID(),
    });
    const order = await request(
      "/payments/" + c.paymentIntentId + "/sandbox-capture",
      {},
    );
    times.push(performance.now() - t);
    return order;
  }),
);
times.sort((a, b) => a - b);
if (new Set(orders.map((o) => o.token)).size !== count)
  throw new Error("Duplicate tokens");
const result = {
  runAt: new Date().toISOString(),
  scenario:
    "50 concurrent quote/checkout/capture flows against real PostgreSQL; in-process HTTP injection",
  orders: count,
  elapsedMs: Math.round(performance.now() - start),
  p50EndToEndMs: Math.round(times[Math.floor(count * 0.5)]),
  p95EndToEndMs: Math.round(times[Math.floor(count * 0.95)]),
  uniqueTokens: true,
  note: "Short concurrency smoke test, not the 30-minute capacity or external-network SLA certification.",
};
await mkdir("docs/evidence", { recursive: true });
await writeFile(
  "docs/evidence/concurrency.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(result);
await app.close();
await pool.end();
