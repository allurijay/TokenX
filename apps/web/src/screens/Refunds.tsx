import { Plus } from "lucide-react";
import { useState } from "react";
import { api, currency, label } from "../api";
import { Badge, Empty, Modal } from "../components/ui";
import { useResource } from "../hooks";
import type { Row } from "../types";
export default function Refunds({
  orders,
  venue,
  revision,
  run,
  act,
  me,
}: any) {
  const { data: refunds, error } = useResource(
    "/refund-requests?venueId=" + venue,
    revision,
  );
  const [form, setForm] = useState<Row | null>(null);
  const order = orders.find((o: Row) => o.id === form?.orderId);
  return (
    <>
      <div className="section-head">
        <div>
          <h2>Make it right, with a clear record.</h2>
          <p>Cancellation and money returned are tracked separately.</p>
        </div>
        <button
          className="primary"
          onClick={() =>
            setForm({
              orderId: orders.find((o: Row) =>
                ["PAID", "PAYMENT_REVIEW"].includes(o.status),
              )?.id,
              unitIds: [],
              mode: "CANCEL_AND_REFUND",
              reasonCode: "ITEM_UNAVAILABLE",
              note: "",
              amountMinor: "",
            })
          }
        >
          <Plus size={16} />
          New request
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {!refunds?.length ? (
        <Empty
          title="No refund requests"
          description="Every request, approval, and payment result will be recorded here."
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order / reason</th>
                <th>Amount</th>
                <th>Mode</th>
                <th>Status</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {refunds.map((r: Row) => (
                <tr key={r.id}>
                  <td>
                    <b>
                      {r.alias} · #{r.token_seq}
                    </b>
                    <small>{label(r.reason_code)}</small>
                    <small>{r.note}</small>
                  </td>
                  <td>{currency(r.amount_minor)}</td>
                  <td>{label(r.mode)}</td>
                  <td>
                    <Badge tone={r.status === "SUCCEEDED" ? "green" : "amber"}>
                      {label(r.status)}
                    </Badge>
                  </td>
                  <td>
                    {r.status === "APPROVAL_REQUIRED" &&
                    r.canApprove &&
                    r.requested_by !== me.id ? (
                      <div className="inline">
                        {["APPROVE", "REJECT"].map((decision) => (
                          <button
                            key={decision}
                            className="secondary small"
                            onClick={() => {
                              const note = prompt(
                                "Review note (at least 5 characters)",
                              );
                              if (note)
                                act(
                                  () =>
                                    api(
                                      "/refund-requests/" + r.id + "/decision",
                                      {
                                        decision,
                                        expectedVersion: r.version,
                                        note,
                                      },
                                    ),
                                  "Review recorded",
                                );
                            }}
                          >
                            {label(decision)}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div>
                        <small>
                          {r.requested_by === me.id &&
                          r.status === "APPROVAL_REQUIRED"
                            ? "Another approver required"
                            : "Original payment method"}
                        </small>
                        {r.status === "APPROVED" && r.tender === "CASH" && (
                          <button
                            className="secondary small"
                            onClick={() =>
                              act(async () => {
                                const shifts = await api(
                                  "/shifts?venueId=" + venue,
                                );
                                const shift = shifts.find(
                                  (s: Row) => !s.closed_at,
                                );
                                if (!shift)
                                  throw new Error(
                                    "Open your cash shift at the POS first",
                                  );
                                if (
                                  !confirm(
                                    "Confirm physical cash disbursement of " +
                                      currency(r.amount_minor) +
                                      "?",
                                  )
                                )
                                  return;
                                await api(
                                  "/refund-requests/" + r.id + "/confirm-cash",
                                  { shiftId: shift.id, disbursed: true },
                                );
                              }, "Cash refund recorded")
                            }
                          >
                            Confirm cash return
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {form && (
        <Modal
          title="Cancellation / refund request"
          onClose={() => setForm(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () =>
                  api("/orders/" + form.orderId + "/refund-requests", {
                    mode: form.mode,
                    reasonCode: form.reasonCode,
                    note: form.note,
                    units: form.unitIds.map((unitId: string) => ({
                      unitId,
                      ...(form.mode === "REFUND_ONLY" &&
                      form.unitIds.length === 1 &&
                      form.amountMinor !== ""
                        ? {
                            amountMinor: Math.round(
                              Number(form.amountMinor) * 100,
                            ),
                          }
                        : {}),
                    })),
                  }),
                "Request recorded",
              )
                .then(() => setForm(null))
                .catch(() => {});
            }}
          >
            <label>
              Paid order
              <select
                value={form.orderId || ""}
                onChange={(e) =>
                  setForm({ ...form, orderId: e.target.value, unitIds: [] })
                }
              >
                {orders
                  .filter((o: Row) =>
                    ["PAID", "PAYMENT_REVIEW"].includes(o.status),
                  )
                  .map((o: Row) => (
                    <option key={o.id} value={o.id}>
                      {o.token} · {o.alias}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Action
              <select
                value={form.mode}
                onChange={(e) => setForm({ ...form, mode: e.target.value })}
              >
                <option value="CANCEL_AND_REFUND">
                  Cancel selected items and refund
                </option>
                <option value="REFUND_ONLY">
                  Refund only (retain fulfillment history)
                </option>
              </select>
            </label>
            <fieldset>
              <legend>Select individual units</legend>
              {order?.units
                .filter((u: Row) => !u.rework_of)
                .map((u: Row) => (
                  <label className="checkbox" key={u.id}>
                    <input
                      type="checkbox"
                      checked={form.unitIds.includes(u.id)}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          unitIds: e.target.checked
                            ? [...form.unitIds, u.id]
                            : form.unitIds.filter((x: string) => x !== u.id),
                        })
                      }
                    />
                    <span>
                      {u.name} · {currency(u.amount_minor)}
                      <small>
                        {u.outlet_name} · {label(u.prep_state)} /{" "}
                        {label(u.serve_state)}
                      </small>
                    </span>
                  </label>
                ))}
            </fieldset>
            <label>
              Partial refund amount (rupees, optional; select one unit)
              <input
                type="number"
                min="0.01"
                step="0.01"
                disabled={
                  form.mode !== "REFUND_ONLY" || form.unitIds.length !== 1
                }
                value={form.amountMinor || ""}
                onChange={(e) =>
                  setForm({ ...form, amountMinor: e.target.value })
                }
              />
            </label>
            <label>
              Reason
              <select
                value={form.reasonCode}
                onChange={(e) =>
                  setForm({ ...form, reasonCode: e.target.value })
                }
              >
                {[
                  "CUSTOMER_CHANGED_MIND",
                  "ITEM_UNAVAILABLE",
                  "DUPLICATE_ORDER",
                  "WRONG_ITEM",
                  "QUALITY_ISSUE",
                  "PAYMENT_DUPLICATE",
                  "SERVICE_DELAY",
                  "OTHER",
                ].map((x) => (
                  <option key={x} value={x}>
                    {label(x)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Details
              <textarea
                required
                minLength={5}
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </label>
            <p className="notice">
              The server calculates the remaining refundable amount. Exceptions
              require approval from another authorized person.
            </p>
            <button className="primary wide" disabled={!form.unitIds.length}>
              Submit request
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
