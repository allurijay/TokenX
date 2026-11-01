import { Clock } from "lucide-react";
import { useState } from "react";
import { api, label } from "../api";
import { Badge, Empty } from "../components/ui";
import type { Row } from "../types";
export default function Board({ orders, cat, act, busy, serving }: any) {
  const [station, setStation] = useState("all");
  const visible = orders
    .filter((o: Row) => o.status === "PAID")
    .map((o: Row) => ({
      ...o,
      units: o.units.filter(
        (u: Row) =>
          u.cancel_state !== "CANCELLED" &&
          (station === "all" || u.station_id === station) &&
          (serving
            ? u.prep_state === "COMPLETED" && u.serve_state !== "HANDED_OVER"
            : u.prep_state !== "COMPLETED"),
      ),
    }))
    .filter((o: Row) => o.units.length);
  const transition = (u: Row, action: string) => {
    const pickupCode =
      action === "HANDOVER" ? prompt("Customer pickup code") || "" : undefined;
    act(
      () =>
        api("/units/transition", {
          unitIds: [u.id],
          expectedVersions: { [u.id]: u.version },
          action,
          pickupCode,
        }),
      action === "HANDOVER" ? "Handed over" : "Kitchen updated",
    );
  };
  return (
    <>
      <div className="toolbar">
        <div className="tabs">
          <button
            className={station === "all" ? "selected" : ""}
            onClick={() => setStation("all")}
          >
            All stations
          </button>
          {cat.stations.map((s: Row) => (
            <button
              key={s.id}
              className={station === s.id ? "selected" : ""}
              onClick={() => setStation(s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>
        <Badge tone="green">{visible.length} active orders</Badge>
      </div>
      {!visible.length ? (
        <Empty
          title={serving ? "Your counter is clear" : "All caught up"}
          description={
            serving
              ? "Completed kitchen items appear here for packing and pickup."
              : "New paid orders will appear automatically at their assigned stations."
          }
        />
      ) : (
        <div className="board-grid">
          {visible.map((o: Row) => (
            <article className="ticket" key={o.id}>
              <div className="ticket-head">
                <div>
                  <strong>{o.token}</strong>
                  <span>{o.alias}</span>
                </div>
                <Badge>
                  <Clock size={12} />
                  {Math.max(
                    0,
                    Math.floor((Date.now() - Date.parse(o.paid_at)) / 60000),
                  )}{" "}
                  min
                </Badge>
              </div>
              {o.units.map((u: Row) => (
                <div className="ticket-item" key={u.id}>
                  <small>
                    {u.station_name} · {u.collection_point}
                  </small>
                  <h3>{u.name}</h3>
                  <button
                    className="icon"
                    aria-label={"Report issue with " + u.name}
                    onClick={() => {
                      const reason = prompt("Describe the issue for billing");
                      if (reason)
                        act(
                          () =>
                            api("/incidents", {
                              outletId: u.outlet_id,
                              orderId: o.id,
                              reason,
                            }),
                          "Billing incident recorded",
                        );
                    }}
                  >
                    Report issue
                  </button>
                  {u.modifiers && <p>{u.modifiers}</p>}
                  <div className="ticket-actions">
                    <Badge
                      tone={
                        u.cancel_state === "CANCEL_REQUESTED"
                          ? "amber"
                          : "green"
                      }
                    >
                      {label(
                        u.cancel_state === "CANCEL_REQUESTED"
                          ? u.cancel_state
                          : serving
                            ? u.serve_state
                            : u.prep_state,
                      )}
                    </Badge>
                    {u.cancel_state === "ACTIVE" && (
                      <button
                        className="primary small"
                        disabled={busy}
                        onClick={() =>
                          transition(
                            u,
                            serving
                              ? u.serve_state === "WAITING"
                                ? "READY"
                                : "HANDOVER"
                              : u.prep_state === "PREPARING"
                                ? "COMPLETE"
                                : "START",
                          )
                        }
                      >
                        {serving
                          ? u.serve_state === "WAITING"
                            ? "Ready for pickup"
                            : "Hand over"
                          : u.prep_state === "PREPARING"
                            ? "Complete"
                            : "Start preparing"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
