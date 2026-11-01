import { CheckCircle2, Receipt, X } from "lucide-react";
import QRCode from "qrcode";
import React, { useEffect, useState } from "react";
import { currency, label } from "../api";
import type { Row } from "../types";
export function Badge({
  children,
  tone = "",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={"badge " + tone}>{children}</span>;
}

export function Empty({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="empty">
      <CheckCircle2 size={32} />
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="overlay" role="presentation">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="section-head">
          <h2>{title}</h2>
          <button className="icon" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function OrderCard({ order, children }: any) {
  return (
    <article className="order-card">
      <div className="section-head">
        <strong className="token">{order.token || "Pending"}</strong>
        <Badge tone={order.progress === "READY" ? "green" : ""}>
          {label(order.progress)}
        </Badge>
      </div>
      <h3>{order.alias}</h3>
      <small>
        {new Date(order.created_at).toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
        })}{" "}
        · {order.units.length} items
      </small>
      <div className="order-items">
        {order.units.map((u: Row) => (
          <div key={u.id}>
            <span>
              {u.name}
              <small>
                {u.outlet_name} · {u.modifiers}
              </small>
            </span>
            <Badge>
              {label(
                u.cancel_state !== "ACTIVE"
                  ? u.cancel_state
                  : u.serve_state === "WAITING"
                    ? u.prep_state
                    : u.serve_state,
              )}
            </Badge>
          </div>
        ))}
      </div>
      {children}
    </article>
  );
}

export function ReceiptView({ order }: any) {
  const [qr, setQr] = useState("");
  const link = location.origin + "/track#" + (order.trackingSecret || "");
  useEffect(() => {
    if (order.trackingSecret)
      QRCode.toDataURL(link, { width: 180, margin: 1 }).then(setQr);
  }, [link]);
  return (
    <div className="receipt">
      <Badge tone="green">PAYMENT CONFIRMED</Badge>
      <h2>{order.token}</h2>
      <p>
        {order.alias} · {new Date(order.created_at).toLocaleString("en-IN")}
      </p>
      <strong>Pickup code: {order.pickupCode || "On original receipt"}</strong>
      {qr && (
        <a href={link} target="_blank" rel="noreferrer">
          <img src={qr} alt="Scan to track your order" />
        </a>
      )}
      <OrderCard order={order} />
      <div className="cart-total">
        <span>Total paid</span>
        <strong>{currency(order.total_minor)}</strong>
      </div>
      <button className="secondary wide" onClick={() => window.print()}>
        <Receipt size={16} />
        Print receipt
      </button>
      <small>
        Order receipt · tax invoice configuration requires finance approval
      </small>
    </div>
  );
}
