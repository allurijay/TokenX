import MfaEnrollment from "./screens/MfaEnrollment";
import {
  BarChart3,
  Check,
  ChefHat,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Receipt,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Store,
  Users,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, label } from "./api";
import { Badge } from "./components/ui";
import Audit from "./screens/Audit";
import Board from "./screens/Board";
import Configuration from "./screens/Configuration";
import Display from "./screens/Display";
import Finance from "./screens/Finance";
import Login from "./screens/Login";
import MenuManager from "./screens/MenuManager";
import Orders from "./screens/Orders";
import Overview from "./screens/Overview";
import Pos from "./screens/Pos";
import Refunds from "./screens/Refunds";
import Staff from "./screens/Staff";
import Tracking from "./screens/Tracking";
import VenueSettings from "./screens/VenueSettings";
import type { Row } from "./types";
const routes = [
  ["overview", "Overview", LayoutDashboard],
  ["pos", "Point of sale", ShoppingBag],
  ["kiosk", "Self-service kiosk", Monitor],
  ["kitchen", "KitchQ kitchen", ChefHat],
  ["serving", "Serving counter", UtensilsCrossed],
  ["orders", "Orders & receipts", Receipt],
  ["menu", "Menu & availability", Menu],
  ["finance", "Sales & finance", BarChart3],
  ["refunds", "Cancellations & refunds", RotateCcw],
  ["configuration", "Outlets & stations", Settings],
  ["settings", "Venue settings", Settings],
  ["staff", "Team & access", Users],
  ["audit", "Audit trail", ShieldCheck],
  ["display", "Customer display", Monitor],
] as const;
export default function App() {
  const [me, setMe] = useState<Row | null>(null),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState("overview"),
    [venue, setVenue] = useState(""),
    [cat, setCat] = useState<Row | null>(null),
    [orders, setOrders] = useState<Row[]>([]),
    [queue, setQueue] = useState<Row[]>([]),
    [devices, setDevices] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [connected, setConnected] = useState(false),
    [revision, setRevision] = useState(0);
  const authenticate = useCallback(async () => {
    try {
      const m = await api("/me");
      setMe(m);
      setVenue(m.venues[0].id);
      const role = m.grants[0].role;
      setPage(
        role === "COOK"
          ? "kitchen"
          : role === "SERVER"
            ? "serving"
            : role === "KIOSK"
              ? "kiosk"
              : role === "DISPLAY"
                ? "display"
                : role === "BILLING"
                  ? "pos"
                  : "overview",
      );
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    authenticate();
  }, [authenticate]);
  const refresh = useCallback(async () => {
    if (!venue || !me || (me.mfaRequired && !me.mfa_enabled)) return;
    try {
      const [c, d] = await Promise.all([
        api("/catalog?venueId=" + venue),
        api("/devices?venueId=" + venue),
      ]);
      setCat(c);
      setDevices(d);
      if (!me.grants.every((g: Row) => ["KIOSK", "DISPLAY"].includes(g.role))) {
        const [recent, active] = await Promise.all([
          api("/orders?venueId=" + venue),
          api("/queues?venueId=" + venue),
        ]);
        setOrders(recent);
        setQueue(active);
      }
      setRevision((r) => r + 1);
    } catch (e: any) {
      setError(e.message);
    }
  }, [venue, me]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (!venue || (me?.mfaRequired && !me?.mfa_enabled)) return;
    const stream = new EventSource("/v1/events?venueId=" + venue);
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    stream.addEventListener("change", () => {
      if (scheduled) return;
      scheduled = setTimeout(() => {
        scheduled = undefined;
        void refresh();
      }, 1000);
    });
    const poll = setInterval(refresh, 10000);
    return () => {
      stream.close();
      clearInterval(poll);
      if (scheduled) clearTimeout(scheduled);
    };
  }, [venue, refresh]);
  async function run(fn: () => Promise<any>, message = "Saved") {
    setBusy(true);
    setError("");
    try {
      const result = await fn();
      setToast(message);
      setTimeout(() => setToast(""), 3500);
      await refresh();
      return result;
    } catch (e: any) {
      setError(e.message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  const act = (fn: () => Promise<any>, msg?: string) => {
    void run(fn, msg).catch(() => {});
  };
  if (location.pathname === "/track") return <Tracking />;
  if (loading) return <div className="loading">Opening your workspace…</div>;
  if (!me) return <Login onLogin={authenticate} />;
  if (me.mfaRequired && !me.mfa_enabled)
    return <MfaEnrollment onComplete={authenticate} />;
  const roles = me.grants.map((g: Row) => g.role);
  const has = (...r: string[]) => roles.some((x: string) => r.includes(x));
  const admin = has("SUPER_ADMIN", "MANAGER", "OWNER");
  const allowed = (key: string) =>
    key === "settings"
      ? me.grants.some(
          (g: Row) =>
            g.role === "SUPER_ADMIN" || g.capabilities.includes("finance"),
        )
      : key === "display"
        ? has("SUPER_ADMIN", "DISPLAY")
        : key === "kiosk"
          ? has("SUPER_ADMIN", "BILLING", "KIOSK")
          : key === "pos"
            ? has("SUPER_ADMIN", "MANAGER", "BILLING")
            : ["overview", "finance", "configuration", "staff"].includes(key)
              ? admin
              : key === "audit"
                ? admin
                : key === "refunds"
                  ? admin || has("BILLING")
                  : key === "kitchen"
                    ? admin || has("COOK")
                    : key === "serving"
                      ? has("SUPER_ADMIN", "MANAGER", "SERVER")
                      : key === "orders"
                        ? !has("KIOSK", "DISPLAY")
                        : key === "menu"
                          ? !has("KIOSK", "DISPLAY")
                          : false;
  const activeOrders = orders.filter(
    (o) =>
      !["COLLECTED", "ALL_CANCELLED"].includes(o.progress) &&
      o.status === "PAID",
  );
  const nav = routes.find((r) => r[0] === page);
  const context = {
    me,
    venue,
    cat,
    orders,
    queue,
    devices,
    run,
    act,
    busy,
    revision,
    refresh,
  };
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">
            <UtensilsCrossed size={20} />
          </span>
          tokenex<span className="dot">.</span>
        </div>
        <div className="workspace">
          <span className="workspace-icon">
            <Store size={19} />
          </span>
          <div>
            <select
              aria-label="Venue"
              value={venue}
              onChange={(e) => {
                setVenue(e.target.value);
                setCat(null);
                setOrders([]);
              }}
            >
              {me.venues.map((v: Row) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <small>Food court workspace</small>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {routes
            .filter((r) => allowed(r[0]))
            .map(([key, title, Icon]) => (
              <button
                key={key}
                className={page === key ? "active" : ""}
                onClick={() => {
                  setPage(key);
                  setError("");
                }}
              >
                <Icon size={18} />
                <span>{title}</span>
                {key === "kitchen" && activeOrders.length > 0 && (
                  <i>{activeOrders.length}</i>
                )}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <Badge tone="amber">
            {me.provider === "sandbox" ? "SANDBOX MODE" : "PROVIDER CHECKOUT"}
          </Badge>
          <p>
            {me.provider === "sandbox"
              ? "No real digital money is charged."
              : "Payments verified by the provider."}
          </p>
          <button
            onClick={() =>
              act(async () => {
                await api("/auth/logout", {});
                setMe(null);
              }, "Signed out")
            }
          >
            <LogOut size={17} />
            Sign out
          </button>
        </div>
      </aside>
      <div className="main">
        <header>
          <div className="breadcrumbs">
            Workspace <span>/</span> <b>{nav?.[1]}</b>
          </div>
          <div className="header-right">
            <span className={"connection " + (connected ? "online" : "")}>
              <i />
              {connected ? "Live updates" : "Reconnecting"}
            </span>
            <span className="avatar">{me.name.slice(0, 2).toUpperCase()}</span>
            <div>
              <b>{me.name}</b>
              <small>{label(roles[0])}</small>
            </div>
          </div>
        </header>
        <main className="content">
          <div className="page-title">
            <div>
              <span className="eyebrow">
                {page === "kitchen"
                  ? "KITCHQ · KITCHEN OPERATIONS"
                  : "THE COURTYARD WORKSPACE"}
              </span>
              <h1>
                {page === "overview" ? "A good day starts in sync." : nav?.[1]}
              </h1>
              <p>
                {page === "overview"
                  ? "Your service, your team, and every order — all in one place."
                  : page === "pos"
                    ? "Great food. One checkout. Every cuisine."
                    : page === "kitchen"
                      ? "The right order, at the right station."
                      : page === "serving"
                        ? "Prepared, checked, and ready for your customer."
                        : "Keep every part of your service connected."}
              </p>
            </div>
            <button className="secondary" onClick={refresh}>
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
          {error && (
            <div className="error banner" role="alert">
              {error}
              <button
                className="icon"
                onClick={() => setError("")}
                aria-label="Dismiss error"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {toast && (
            <div className="toast" role="status">
              <Check size={17} />
              {toast}
            </div>
          )}
          {cat &&
            (page === "overview" ? (
              <Overview {...context} navigate={setPage} />
            ) : ["pos", "kiosk"].includes(page) ? (
              <Pos {...context} kiosk={page === "kiosk"} />
            ) : ["kitchen", "serving"].includes(page) ? (
              <Board {...context} orders={queue} serving={page === "serving"} />
            ) : page === "orders" ? (
              <Orders {...context} />
            ) : page === "menu" ? (
              <MenuManager {...context} />
            ) : page === "configuration" ? (
              <Configuration {...context} />
            ) : page === "settings" ? (
              <VenueSettings {...context} />
            ) : page === "staff" ? (
              <Staff {...context} />
            ) : page === "finance" ? (
              <Finance {...context} />
            ) : page === "refunds" ? (
              <Refunds {...context} />
            ) : page === "audit" ? (
              <Audit {...context} />
            ) : page === "display" ? (
              <Display {...context} />
            ) : null)}
        </main>
        <footer>
          Tokenex + KitchQ <span>Every order, in sync.</span>
          <span>
            {me.provider === "sandbox" ? "Sandbox" : "Provider payments"} · INR
            · {new Date().toLocaleDateString("en-IN")}
          </span>
        </footer>
      </div>
    </div>
  );
}
