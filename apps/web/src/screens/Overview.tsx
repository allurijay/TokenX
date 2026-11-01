import {
  ArrowRight,
  CheckCircle2,
  ChefHat,
  ShoppingBag,
  Store,
} from "lucide-react";
import { Badge, Empty, OrderCard } from "../components/ui";
import type { Row } from "../types";
export default function Overview({ cat, orders, navigate }: any) {
  const paid = orders.filter((o: Row) => o.status === "PAID"),
    units = paid.flatMap((o: Row) => o.units),
    ready = units.filter(
      (u: Row) => u.serve_state === "READY_FOR_PICKUP",
    ).length;
  return (
    <>
      <div className="hero">
        <div>
          <Badge tone="light">BUILT FOR BETTER SERVICE</Badge>
          <h2>
            Many kitchens.
            <br />
            One connected rhythm.
          </h2>
          <p>Keep the counter moving and your customers in the loop.</p>
          <button onClick={() => navigate("orders")}>
            See live orders <ArrowRight size={17} />
          </button>
        </div>
        <div className="hero-graphic">
          <div className="orbit o1">
            <ChefHat size={30} />
          </div>
          <div className="orbit o2">
            <ShoppingBag size={28} />
          </div>
          <div className="orbit o3">
            <CheckCircle2 size={30} />
          </div>
          <div className="center-token">
            <small>YOUR ORDER</small>
            <strong>{paid[0]?.token || "A-001"}</strong>
            <span>Always in sync</span>
          </div>
        </div>
      </div>
      <div className="stats">
        {[
          ["Paid orders", paid.length, "Across your visible orders"],
          [
            "In preparation",
            units.filter((u: Row) => u.prep_state === "PREPARING").length,
            "Items being freshly made",
          ],
          ["Ready for pickup", ready, "Waiting at the serving counter"],
          [
            "Active outlets",
            cat.outlets.filter((o: Row) => o.active).length,
            "Connected to your workspace",
          ],
        ].map(([title, value, hint]) => (
          <div className="stat" key={title}>
            <span>{title}</span>
            <strong>{value}</strong>
            <small>{hint}</small>
          </div>
        ))}
      </div>
      <div className="section-head">
        <div>
          <h2>Live service</h2>
          <p>A little visibility makes a big difference.</p>
        </div>
        <Badge>{paid.length} paid orders</Badge>
      </div>
      {!paid.length ? (
        <Empty
          title="Ready for your first order"
          description="Create an order at the point of sale to bring your kitchen to life."
        />
      ) : (
        <div className="cards">
          {paid.slice(0, 6).map((o: Row) => (
            <OrderCard key={o.id} order={o} />
          ))}
        </div>
      )}
      <div className="section-head">
        <h2>Your kitchens</h2>
      </div>
      <div className="outlet-grid">
        {cat.outlets.map((o: Row) => (
          <article className="outlet-card" key={o.id}>
            <span className="outlet-icon">
              <Store />
            </span>
            <div>
              <h3>{o.name}</h3>
              <p>
                {o.cuisine} · {o.collection_point}
              </p>
            </div>
            <Badge tone={o.active ? "green" : "amber"}>
              {o.active ? "Open" : "Paused"}
            </Badge>
          </article>
        ))}
      </div>
    </>
  );
}
