import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allocate,
  inclusiveTax,
  exclusiveTax,
  transition,
  progress,
  can,
} from "../packages/domain/src/index.js";
test("largest-remainder allocation preserves every minor unit, deterministic ties", () => {
  assert.deepEqual(
    allocate(4000, [10000, 10000, 5000, 15000]),
    [1000, 1000, 500, 1500],
  );
  assert.deepEqual(allocate(2, [1, 1, 1]), [1, 1, 0]);
  for (let n = 1; n < 200; n++) {
    const w = Array.from({ length: (n % 13) + 1 }, (_, i) => i * 7 + n);
    const a = allocate(n, w);
    assert.equal(
      a.reduce((a, b) => a + b, 0),
      n,
    );
    assert.ok(a.every(Number.isSafeInteger));
  }
});
test("tax arithmetic uses integer rounding", () => {
  assert.equal(inclusiveTax(10500, 500), 500);
  assert.equal(exclusiveTax(10000, 500), 500);
  assert.equal(inclusiveTax(0, 500), 0);
});
test("cooking completion never implies serving ready", () => {
  const u = {
    prep_state: "PREPARING",
    serve_state: "WAITING",
    cancel_state: "ACTIVE",
  };
  assert.deepEqual(Object.keys(transition(u, "COMPLETE")).sort(), [
    "completed_at",
    "prep_state",
  ]);
  assert.throws(() => transition(u, "READY"));
  assert.equal(progress([{ ...u, prep_state: "COMPLETED" }]), "PREPARING");
  assert.equal(
    progress([{ ...u, serve_state: "READY_FOR_PICKUP" }, u]),
    "PARTIALLY_READY",
  );
});
test("cancellation hold prevents preparation or pickup", () => {
  for (const action of ["START", "COMPLETE", "READY", "HANDOVER"])
    assert.throws(() =>
      transition(
        {
          prep_state: "PREPARING",
          serve_state: "READY_FOR_PICKUP",
          cancel_state: "CANCEL_REQUESTED",
        },
        action,
      ),
    );
});
test("outlet/station scopes do not grant venue-wide access", () => {
  const p: any = {
    grants: [
      {
        role: "OWNER",
        venue_id: "v",
        outlet_id: "a",
        station_id: null,
        capabilities: [],
      },
    ],
  };
  assert.equal(can(p, "report", "v", "a"), true);
  assert.equal(can(p, "report", "v", "b"), false);
  assert.equal(can(p, "report", "v"), false);
  assert.equal(can(p, "checkout", "v", "a"), false);
});
