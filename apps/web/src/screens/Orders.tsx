import { ArrowRight, Search } from "lucide-react";
import { useState } from "react";
import { api, label } from "../api";
import { Empty, Modal, OrderCard, ReceiptView } from "../components/ui";
import type { Row } from "../types";
export default function Orders({ orders, act, cat, me, run, venue }: any) {
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState<Row | null>(null),
    [older, setOlder] = useState<Row[]>([]);
  const all = [
    ...orders,
    ...older.filter((o: Row) => !orders.some((x: Row) => x.id === o.id)),
  ];
  const manager = me.grants.some((g: Row) =>
    ["SUPER_ADMIN", "MANAGER"].includes(g.role),
  );
  return (
    <>
      <div className="search">
        <Search size={18} />
        <input
          placeholder="Search name, token, or order reference"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="cards spaced">
        {all
          .filter((o: Row) =>
            (o.alias + " " + o.token + " " + o.id)
              .toLowerCase()
              .includes(search.toLowerCase()),
          )
          .map((o: Row) => (
            <OrderCard key={o.id} order={o}>
              <button className="secondary wide" onClick={() => setSelected(o)}>
                View order details <ArrowRight size={16} />
              </button>
            </OrderCard>
          ))}
      </div>
      {all.length > 0 && (
        <button
          className="secondary spaced"
          onClick={() =>
            void run(
              () =>
                api(
                  "/orders?venueId=" +
                    venue +
                    "&before=" +
                    encodeURIComponent(all[all.length - 1].created_at),
                ),
              "Older orders loaded",
            )
              .then((rows: Row[]) => setOlder([...older, ...rows]))
              .catch(() => {})
          }
        >
          Load older orders
        </button>
      )}
      {!orders.length && (
        <Empty
          title="No orders yet"
          description="Paid and pending orders will appear here."
        />
      )}
      {selected && (
        <Modal
          title={"Order " + (selected.token || selected.id.slice(0, 8))}
          onClose={() => setSelected(null)}
        >
          <ReceiptView order={selected} />
          <small>Reference: {selected.id}</small>
          {manager && selected.status === "PAYMENT_REVIEW" && (
            <button
              className="secondary wide spaced"
              onClick={() => {
                const reason = prompt(
                  "Confirm availability and explain release",
                );
                if (reason)
                  act(
                    () =>
                      api("/orders/" + selected.id + "/release", { reason }),
                    "Order released to kitchen",
                  );
              }}
            >
              Release after payment review
            </button>
          )}
          {manager && (
            <section className="panel spaced">
              <h3>Fulfillment corrections</h3>
              {selected.units.map((u: Row) => (
                <div className="spaced" key={u.id}>
                  <b>{u.name}</b>
                  <small>
                    {label(u.prep_state)} · {u.station_name}
                  </small>
                  <div className="inline">
                    {["RECEIVED", "ACKNOWLEDGED"].includes(u.prep_state) && (
                      <select
                        aria-label={"Reassign " + u.name}
                        value={u.station_id}
                        onChange={(e) => {
                          const reason = prompt("Reason for reassignment");
                          if (reason)
                            act(
                              () =>
                                api("/units/reassign", {
                                  unitId: u.id,
                                  stationId: e.target.value,
                                  expectedVersion: u.version,
                                  reason,
                                }),
                              "Unit reassigned",
                            );
                        }}
                      >
                        {cat.stations
                          .filter((s: Row) => s.outlet_id === u.outlet_id)
                          .map((s: Row) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                      </select>
                    )}
                    {u.prep_state === "COMPLETED" && (
                      <button
                        className="secondary small"
                        onClick={() => {
                          const reason = prompt("Reason for no-charge rework");
                          if (reason)
                            act(
                              () =>
                                api("/units/rework", {
                                  unitId: u.id,
                                  expectedVersion: u.version,
                                  reason,
                                }),
                              "Rework ticket created",
                            );
                        }}
                      >
                        Create rework
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </section>
          )}
        </Modal>
      )}
    </>
  );
}
