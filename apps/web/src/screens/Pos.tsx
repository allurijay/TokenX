import { ArrowRight, Minus, Plus, Search, ShoppingBag } from "lucide-react";
import { useEffect, useState } from "react";
import { api, currency } from "../api";
import { Badge, Modal, ReceiptView } from "../components/ui";
import { hostedPayment } from "../hosted-payment";
import type { Row } from "../types";
export default function Pos({
  cat,
  devices,
  venue,
  run,
  act,
  busy,
  kiosk,
  me,
}: any) {
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [cart, setCart] = useState<Row[]>([]),
    [alias, setAlias] = useState(""),
    [device, setDevice] = useState(""),
    [tender, setTender] = useState("DIGITAL"),
    [pending, setPending] = useState<Row | null>(() =>
      JSON.parse(sessionStorage.getItem("tokenexCheckout") || "null"),
    ),
    [receipt, setReceipt] = useState<Row | null>(null),
    [itemModal, setItemModal] = useState<Row | null>(null),
    [variant, setVariant] = useState(""),
    [mods, setMods] = useState<string[]>([]),
    [quote, setQuote] = useState<Row | null>(null),
    [shift, setShift] = useState<Row | null>(null);
  const [idleWarning, setIdleWarning] = useState(false);
  useEffect(() => {
    if (!kiosk) return;
    let last = Date.now();
    const touch = () => {
      last = Date.now();
      setIdleWarning(false);
    };
    window.addEventListener("pointerdown", touch);
    window.addEventListener("keydown", touch);
    const timer = setInterval(() => {
      if (pending) return;
      const idle = Date.now() - last;
      if (idle > 120000) {
        setCart([]);
        setAlias("");
        setQuote(null);
        setReceipt(null);
        setIdleWarning(false);
        last = Date.now();
      } else if (idle > 90000) setIdleWarning(true);
    }, 1000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
    };
  }, [kiosk, pending]);
  const choices = devices.filter(
    (d: Row) => d.active && d.kind === (kiosk ? "KIOSK" : "POS"),
  );
  useEffect(() => {
    setDevice(choices[0]?.id || "");
    setQuote(null);
  }, [kiosk, devices.length]);
  useEffect(() => {
    if (!kiosk)
      api("/shifts?venueId=" + venue)
        .then((s) =>
          setShift(
            s.find((x: Row) => !x.closed_at && x.device_id === device) || null,
          ),
        )
        .catch(() => {});
  }, [device, venue, kiosk]);
  useEffect(() => {
    sessionStorage.setItem("tokenexCheckout", JSON.stringify(pending));
  }, [pending]);
  const add = (item: Row, variantId = "", modifierIds: string[] = []) => {
    const key = [item.id, variantId, ...modifierIds.sort()].join(":");
    setCart((prev) => {
      const found = prev.find((x) => x.key === key);
      return found
        ? prev.map((x) => (x.key === key ? { ...x, qty: x.qty + 1 } : x))
        : [...prev, { key, item, variantId, modifierIds, qty: 1 }];
    });
    setQuote(null);
  };
  async function review() {
    const q = await run(
      () =>
        api("/quotes", {
          venueId: venue,
          deviceId: device,
          channel: kiosk ? "KIOSK" : "POS",
          customerAlias: alias.trim() || "Guest",
          lines: cart.map((x) => ({
            itemId: x.item.id,
            qty: x.qty,
            variantId: x.variantId || undefined,
            modifierIds: x.modifierIds,
          })),
        }),
      "Prices reviewed",
    );
    setQuote(q);
  }
  async function pay() {
    if (!quote) return;
    let checkout = pending;
    if (!checkout) {
      checkout = await run(
        () =>
          api("/checkouts", {
            quoteId: quote.id,
            tender,
            checkoutKey: crypto.randomUUID(),
          }),
        "Checkout created",
      );
      setPending(checkout);
    }
    await complete(checkout!);
  }
  async function complete(c: Row) {
    const order = await run(async () => {
      if (c.tender === "ZERO") return api("/orders/" + c.orderId);
      if (c.tender === "CASH") {
        if (!shift) throw new Error("Open a cash shift first");
        const received = prompt(
          "Cash received (rupees)",
          String(c.amountMinor / 100),
        );
        if (received === null) throw new Error("Payment remains pending");
        return api(
          `/payments/${c.paymentIntentId}/confirm-cash`,
          {
            shiftId: shift.id,
            receivedMinor: Math.round(Number(received) * 100),
          },
          "POST",
          "cash-" + c.paymentIntentId,
        );
      }
      return c.provider === "razorpay"
        ? hostedPayment(c)
        : api(`/payments/${c.paymentIntentId}/sandbox-capture`, {});
    }, "Payment confirmed");
    setReceipt({ ...order, ...c });
    setPending(null);
    setCart([]);
    setQuote(null);
  }
  const itemPrice = (x: Row) =>
    (x.item.variants.find((v: Row) => v.id === x.variantId)?.price_minor ??
      x.item.price_minor) +
    x.item.modifier_groups
      .flatMap((g: Row) => g.options)
      .filter((o: Row) => x.modifierIds.includes(o.id))
      .reduce((s: number, o: Row) => s + o.price_minor, 0);
  const total = cart.reduce((s, x) => s + x.qty * itemPrice(x), 0);
  return (
    <>
      {idleWarning && (
        <div className="notice">
          Are you still ordering? Tap anywhere to keep this cart. It will clear
          after 30 seconds of inactivity.
        </div>
      )}
      <div className="checkout-layout">
        <section>
          <div className="toolbar">
            <div className="search">
              <Search size={18} />
              <input
                placeholder="Find a favourite…"
                aria-label="Search menu"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              aria-label="Ordering device"
              value={device}
              onChange={(e) => setDevice(e.target.value)}
            >
              {choices.map((d: Row) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="tabs">
            <button
              className={filter === "all" ? "selected" : ""}
              onClick={() => setFilter("all")}
            >
              All cuisines
            </button>
            {cat.outlets.map((o: Row) => (
              <button
                key={o.id}
                className={filter === o.id ? "selected" : ""}
                onClick={() => setFilter(o.id)}
              >
                {o.name}
              </button>
            ))}
          </div>
          <div className="food-grid">
            {cat.items
              .filter(
                (i: Row) =>
                  i.published &&
                  i.active &&
                  (filter === "all" || i.outlet_id === filter) &&
                  i.name.toLowerCase().includes(search.toLowerCase()),
              )
              .map((item: Row) => (
                <article
                  className={
                    "food-card " + (!item.available ? "unavailable" : "")
                  }
                  key={item.id}
                >
                  <img
                    src={item.image_url}
                    alt={item.image_alt}
                    onError={(e) => {
                      e.currentTarget.src = "/images/placeholder.svg";
                    }}
                  />
                  <div className="food-info">
                    <small>{item.outlet_name}</small>
                    <h3>{item.name}</h3>
                    <p>{item.description}</p>
                    <div className="food-bottom">
                      <strong>{currency(item.price_minor)}</strong>
                      <button
                        className="add"
                        aria-label={"Add " + item.name}
                        disabled={!item.available || !!pending}
                        onClick={() => {
                          if (
                            item.variants.length ||
                            item.modifier_groups.length
                          ) {
                            setItemModal(item);
                            setVariant("");
                            setMods([]);
                          } else add(item);
                        }}
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                    {!item.available && (
                      <Badge tone="amber">Temporarily unavailable</Badge>
                    )}
                  </div>
                </article>
              ))}
          </div>
        </section>
        <aside className="cart">
          <div className="section-head">
            <h2>Your order</h2>
            <Badge>{cart.reduce((s, x) => s + x.qty, 0)} items</Badge>
          </div>
          <label>
            Customer name
            <input
              value={alias}
              onChange={(e) => {
                setAlias(e.target.value);
                setQuote(null);
              }}
              placeholder="Guest"
              maxLength={40}
            />
          </label>
          {!cart.length ? (
            <div className="cart-empty">
              <ShoppingBag size={36} />
              <h3>Something delicious awaits</h3>
              <p>Add items from any cuisine to one order.</p>
            </div>
          ) : (
            <div className="cart-lines">
              {cart.map((x) => (
                <div key={x.key}>
                  <div>
                    <b>{x.item.name}</b>
                    <small>{x.item.outlet_name}</small>
                    <div className="quantity">
                      <button
                        aria-label={"Remove one " + x.item.name}
                        onClick={() => {
                          setCart(
                            cart
                              .map((c) =>
                                c.key === x.key ? { ...c, qty: c.qty - 1 } : c,
                              )
                              .filter((c) => c.qty > 0),
                          );
                          setQuote(null);
                        }}
                      >
                        <Minus size={13} />
                      </button>
                      <span>{x.qty}</span>
                      <button
                        aria-label={"Add one " + x.item.name}
                        onClick={() => add(x.item, x.variantId, x.modifierIds)}
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                  </div>
                  <strong>{currency(x.qty * itemPrice(x))}</strong>
                </div>
              ))}
            </div>
          )}
          {!kiosk && (
            <label>
              Payment method
              <select
                value={tender}
                onChange={(e) => setTender(e.target.value)}
              >
                <option value="DIGITAL">Digital payment</option>
                <option value="CASH">Cash at counter</option>
              </select>
            </label>
          )}
          {!kiosk && tender === "CASH" && !shift && (
            <button
              className="secondary wide"
              onClick={() =>
                act(async () => {
                  const s = await api("/shifts", {
                    venueId: venue,
                    deviceId: device,
                    floatMinor: 0,
                  });
                  setShift(s);
                }, "Cash shift opened")
              }
            >
              Open cash shift
            </button>
          )}
          <div className="cart-total">
            <span>{quote ? "Confirmed total" : "Estimated total"}</span>
            <strong>{currency(quote?.total_minor ?? total)}</strong>
          </div>
          {quote && (
            <p className="fine">
              Includes{" "}
              {currency(
                quote.units.reduce((s: number, u: Row) => s + u.taxMinor, 0),
              )}{" "}
              tax. Quote valid for 2 minutes.
            </p>
          )}
          {pending ? (
            <div className="notice vertical">
              <b>Payment needs confirmation</b>
              <small>{pending.orderId}</small>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void complete(pending).catch(() => {})}
              >
                Recover payment
              </button>
            </div>
          ) : (
            <button
              className="primary wide"
              disabled={!cart.length || busy || !device}
              onClick={() => void (quote ? pay() : review()).catch(() => {})}
            >
              {busy
                ? "Please wait…"
                : quote
                  ? tender === "CASH"
                    ? "Confirm cash payment"
                    : me.provider === "sandbox"
                      ? "Pay in sandbox"
                      : "Continue to payment"
                  : "Review & continue"}
              <ArrowRight size={18} />
            </button>
          )}
          <p className="fine center">
            One order. Separate kitchen tickets.{" "}
            {me.provider === "sandbox"
              ? "No real digital charge."
              : "Secure hosted checkout."}
          </p>
          {shift && !kiosk && (
            <button
              className="secondary wide"
              onClick={() => {
                const amount = prompt("Counted cash in drawer (rupees)");
                if (amount !== null)
                  act(async () => {
                    await api("/shifts/" + shift.id + "/close", {
                      countedMinor: Math.round(Number(amount) * 100),
                    });
                    setShift(null);
                  }, "Cash shift closed");
              }}
            >
              Close cash shift
            </button>
          )}
        </aside>
      </div>
      {itemModal && (
        <Modal title={itemModal.name} onClose={() => setItemModal(null)}>
          <p>
            {itemModal.allergens ||
              "Ask staff about allergies before ordering."}
          </p>
          {!!itemModal.variants.length && (
            <label>
              Variant
              <select
                value={variant}
                onChange={(e) => setVariant(e.target.value)}
              >
                <option value="">Standard</option>
                {itemModal.variants.map((v: Row) => (
                  <option value={v.id} key={v.id}>
                    {v.name} ·{" "}
                    {currency(v.price_minor ?? itemModal.price_minor)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {itemModal.modifier_groups.map((g: Row) => (
            <fieldset key={g.id}>
              <legend>
                {g.name} (choose {g.min_select}–{g.max_select})
              </legend>
              {g.options.map((o: Row) => (
                <label className="checkbox" key={o.id}>
                  <input
                    type="checkbox"
                    checked={mods.includes(o.id)}
                    onChange={(e) =>
                      setMods(
                        e.target.checked
                          ? [...mods, o.id]
                          : mods.filter((x) => x !== o.id),
                      )
                    }
                  />
                  {o.name} +{currency(o.price_minor)}
                </label>
              ))}
            </fieldset>
          ))}
          <button
            className="primary wide"
            onClick={() => {
              add(itemModal, variant, mods);
              setItemModal(null);
            }}
          >
            Add to order
          </button>
        </Modal>
      )}
      {receipt && (
        <Modal title="Your order is in!" onClose={() => setReceipt(null)}>
          <ReceiptView order={receipt} />
        </Modal>
      )}
    </>
  );
}
