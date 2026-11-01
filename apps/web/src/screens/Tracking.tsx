import { UtensilsCrossed } from "lucide-react";
import { useEffect, useState } from "react";
import { api, currency, label } from "../api";
import { OrderCard } from "../components/ui";
import type { Row } from "../types";
export default function Tracking() {
  const [order, setOrder] = useState<Row | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    async function update() {
      try {
        if (location.hash) {
          await api("/tracking/session", { secret: location.hash.slice(1) });
          history.replaceState(null, "", "/track");
        }
        setOrder(await api("/tracking"));
        setError("");
      } catch (e: any) {
        setError(e.message);
      }
    }
    void update();
    const timer = setInterval(update, 2000);
    return () => clearInterval(timer);
  }, []);
  return (
    <main className="tracking">
      <div className="brand">
        <span className="logo">
          <UtensilsCrossed />
        </span>
        tokenex.
      </div>
      <h1>Good food is on its way.</h1>
      <p>Your order updates automatically.</p>
      {error && <p className="error">{error}</p>}
      {order && (
        <>
          <OrderCard order={order} />
          {order.refunds.length > 0 && (
            <section className="panel">
              <h2>Refund updates</h2>
              {order.refunds.map((r: Row, i: number) => (
                <p key={i}>
                  {currency(r.amount_minor)} · {label(r.status)}
                </p>
              ))}
            </section>
          )}
          <p className="fine">
            Last updated {new Date().toLocaleTimeString()} · Keep your pickup
            code from the receipt.
          </p>
        </>
      )}
    </main>
  );
}
