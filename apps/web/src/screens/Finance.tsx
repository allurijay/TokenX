import { Download } from "lucide-react";
import { useState } from "react";
import { api, currency, downloadCsv, label } from "../api";
import { Badge } from "../components/ui";
import { useResource } from "../hooks";
import type { Row } from "../types";
export default function Finance({ venue, revision, cat, act, me }: any) {
  const [tab, setTab] = useState("sales"),
    [from, setFrom] = useState(
      new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
    ),
    [to, setTo] = useState(
      new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    );
  const { data, error } = useResource(
    `/reports/sales?venueId=${venue}&from=${from}&to=${to}`,
    revision,
  );
  const { data: batches } = useResource(
    "/settlement-batches?venueId=" + venue,
    revision,
  );
  const finance = me.grants.some(
    (g: Row) => g.role === "SUPER_ADMIN" || g.capabilities.includes("finance"),
  );
  const { data: recon } = useResource(
    "/reconciliation?venueId=" + venue,
    revision,
  );
  const { data: excess } = useResource(
    "/operations/excess-captures?venueId=" + venue,
    revision,
  );
  const [json, setJson] = useState("");
  return (
    <>
      <div className="toolbar">
        <div className="tabs">
          {["sales", "statements", ...(finance ? ["reconciliation"] : [])].map(
            (x) => (
              <button
                className={tab === x ? "selected" : ""}
                key={x}
                onClick={() => setTab(x)}
              >
                {label(x)}
              </button>
            ),
          )}
        </div>
        <div className="inline">
          <input
            aria-label="Start date"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <input
            aria-label="End date exclusive"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <button
            className="secondary"
            onClick={() => downloadCsv("tokenex-sales.csv", data?.rows || [])}
          >
            <Download size={15} />
            Export
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {tab === "sales" && data && (
        <>
          <div className="stats">
            {[
              ["Net sales", "net_sales"],
              ["Collections", "collections"],
              ["Confirmed refunds", "refunded"],
              ["Owner payable", "balance"],
            ].map(([title, key]) => (
              <div className="stat" key={key}>
                <span>{title}</span>
                <strong>
                  {currency(
                    data.rows.reduce((s: number, r: Row) => s + r[key], 0),
                  )}
                </strong>
                <small>
                  {key === "balance"
                    ? "Current outstanding balance"
                    : "Selected reporting period"}
                </small>
              </div>
            ))}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Outlet</th>
                  <th>Orders</th>
                  <th>Gross sales</th>
                  <th>Discount</th>
                  <th>Tax</th>
                  <th>Refunded</th>
                  <th>Net sales</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r: Row) => (
                  <tr key={r.id}>
                    <td>
                      <b>{r.name}</b>
                    </td>
                    <td>{r.orders}</td>
                    <td>{currency(r.gross)}</td>
                    <td>{currency(r.discounts)}</td>
                    <td>{currency(r.tax)}</td>
                    <td>{currency(r.refunded)}</td>
                    <td>
                      <b>{currency(r.net_sales)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="fine">
            {data.basis}. End date is exclusive. Updated{" "}
            {new Date(data.asOf).toLocaleTimeString()}.
          </p>
          <div className="section-head">
            <h2>Financial journal</h2>
            <Badge>Append-only</Badge>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Entry</th>
                  <th>Account</th>
                  <th>Debit</th>
                  <th>Credit</th>
                </tr>
              </thead>
              <tbody>
                {data.journals.map((r: Row, i: number) => (
                  <tr key={i}>
                    <td>{new Date(r.created_at).toLocaleString()}</td>
                    <td>{r.description}</td>
                    <td>{label(r.account)}</td>
                    <td>{currency(r.debit_minor)}</td>
                    <td>{currency(r.credit_minor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {tab === "statements" && (
        <>
          <div className="notice">
            Owner payouts are recorded with bank evidence. This application does
            not initiate a bank transfer.
          </div>
          {finance && (
            <div className="inline spaced">
              {cat.outlets.map((o: Row) => (
                <button
                  className="secondary"
                  key={o.id}
                  onClick={() => {
                    const amount = prompt(
                      "Payout amount in rupees for " + o.name,
                    );
                    if (amount)
                      act(
                        () =>
                          api("/settlement-batches", {
                            outletId: o.id,
                            amountMinor: Math.round(Number(amount) * 100),
                          }),
                        "Draft payout created",
                      );
                  }}
                >
                  Draft payout · {o.name}
                </button>
              ))}
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Outlet</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Evidence / review</th>
                </tr>
              </thead>
              <tbody>
                {batches?.map((b: Row) => (
                  <tr key={b.id}>
                    <td>{b.outlet_name}</td>
                    <td>{currency(b.amount_minor)}</td>
                    <td>
                      <Badge>{b.status}</Badge>
                    </td>
                    <td>
                      {b.bank_reference ||
                        (finance &&
                          (b.status === "DRAFT" ? (
                            <button
                              className="secondary small"
                              onClick={() =>
                                act(
                                  () =>
                                    api(
                                      "/settlement-batches/" +
                                        b.id +
                                        "/approve",
                                      {},
                                    ),
                                  "Payout approved",
                                )
                              }
                            >
                              Approve
                            </button>
                          ) : b.status === "APPROVED" ? (
                            <button
                              className="secondary small"
                              onClick={() => {
                                const bankReference = prompt(
                                  "Confirmed bank transfer reference",
                                );
                                if (bankReference)
                                  act(
                                    () =>
                                      api(
                                        "/settlement-batches/" +
                                          b.id +
                                          "/record-payment",
                                        { bankReference },
                                      ),
                                    "Bank payment recorded",
                                  );
                              }}
                            >
                              Record bank payment
                            </button>
                          ) : null))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {tab === "reconciliation" && (
        <>
          <div className="panel">
            <h2>Payment exceptions</h2>
            {excess?.map((c: Row) => (
              <div className="section-head" key={c.id}>
                <span>
                  {c.alias}
                  <small>Excess capture · {currency(c.amount_minor)}</small>
                </span>
                <button
                  className="secondary"
                  onClick={() => {
                    const note = prompt(
                      "Finance reason for returning this excess capture",
                    );
                    if (note)
                      act(
                        () =>
                          api("/captures/" + c.id + "/refund-excess", { note }),
                        "Excess-capture refund requested",
                      );
                  }}
                >
                  Request return
                </button>
              </div>
            ))}
            <h2 className="spaced">Import provider evidence</h2>
            <p>
              JSON records with externalId, kind, amountMinor, currency and
              reference. Duplicate imports are safe.
            </p>
            <textarea
              className="code-input"
              aria-label="Provider records JSON"
              placeholder='[{"externalId":"statement-001","kind":"CAPTURE","amountMinor":10000,"currency":"INR","reference":"provider-ref"}]'
              value={json}
              onChange={(e) => setJson(e.target.value)}
            />
            <button
              className="primary"
              onClick={() =>
                act(
                  async () =>
                    api("/reconciliation/imports", {
                      venueId: venue,
                      records: JSON.parse(json),
                    }),
                  "Statement imported",
                )
              }
            >
              Import records
            </button>
          </div>
          <div className="table-wrap spaced">
            <table>
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {recon?.cases.map((c: Row) => (
                  <tr key={c.id}>
                    <td>{c.id.slice(0, 8)}</td>
                    <td>{c.reason}</td>
                    <td>
                      <Badge>{c.status}</Badge>
                    </td>
                    <td>
                      {c.status === "OPEN" && (
                        <button
                          className="secondary small"
                          onClick={() => {
                            const note = prompt(
                              "Finance classification evidence (at least 10 characters)",
                            );
                            if (note)
                              act(
                                () =>
                                  api(
                                    "/reconciliation/cases/" +
                                      c.id +
                                      "/resolve",
                                    { note },
                                  ),
                                "Case classified",
                              );
                          }}
                        >
                          Classify fee / settlement
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
