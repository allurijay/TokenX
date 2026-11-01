import { useState } from "react";
import { api } from "../api";
import { Badge } from "../components/ui";
import type { Row } from "../types";
export default function VenueSettings({
  cat,
  devices,
  venue,
  run,
  act,
  me,
}: any) {
  const [form, setForm] = useState({
      refundLimit: cat.venue.refund_limit,
      refundDailyLimit: cat.venue.refund_daily_limit,
      active: cat.venue.active,
      commissionBps: 0,
      commissionEnabled: false,
      version: cat.venue.version,
    }),
    [device, setDevice] = useState({ name: "", kind: "KIOSK" }),
    [newVenue, setNewVenue] = useState("");
  const admin = me.grants.some((g: Row) => g.role === "SUPER_ADMIN");
  return (
    <div className="outlet-grid">
      <section className="panel">
        <h2>Operating policy</h2>
        <p>
          Changes apply to future operations. Existing financial history stays
          intact.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () => api("/venues/" + venue + "/policy", form),
              "Policy updated",
            ).catch(() => {});
          }}
        >
          <label>
            Cashier refund limit (rupees)
            <input
              type="number"
              min="0"
              value={form.refundLimit / 100}
              onChange={(e) =>
                setForm({
                  ...form,
                  refundLimit: Math.round(Number(e.target.value) * 100),
                })
              }
            />
          </label>
          <label>
            Cashier daily refund limit (rupees)
            <input
              type="number"
              min="0"
              value={form.refundDailyLimit / 100}
              onChange={(e) =>
                setForm({
                  ...form,
                  refundDailyLimit: Math.round(Number(e.target.value) * 100),
                })
              }
            />
          </label>
          <label>
            Operator commission (%)
            <input
              type="number"
              min="0"
              max="100"
              step=".01"
              value={form.commissionBps / 100}
              onChange={(e) =>
                setForm({
                  ...form,
                  commissionBps: Math.round(Number(e.target.value) * 100),
                })
              }
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.commissionEnabled}
              onChange={(e) =>
                setForm({ ...form, commissionEnabled: e.target.checked })
              }
            />
            Apply commission to new orders
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            Venue accepting new orders
          </label>
          <button className="primary wide">Save policy</button>
        </form>
      </section>
      <section className="panel">
        <h2>Registered devices</h2>
        <p>Add kiosks and counters as your venue grows.</p>
        {devices.map((d: Row) => (
          <div className="section-head" key={d.id}>
            <span>
              {d.name}
              <small>{d.kind}</small>
            </span>
            <Badge>{d.active ? "Active" : "Revoked"}</Badge>
          </div>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act(
              () =>
                api("/devices", { venue_id: venue, ...device, active: true }),
              "Device registered",
            );
          }}
        >
          <label>
            Device name
            <input
              required
              value={device.name}
              onChange={(e) => setDevice({ ...device, name: e.target.value })}
            />
          </label>
          <label>
            Device type
            <select
              value={device.kind}
              onChange={(e) => setDevice({ ...device, kind: e.target.value })}
            >
              {["POS", "KIOSK", "KITCHEN", "SERVING", "DISPLAY"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <button className="secondary wide">Add device</button>
        </form>
        {admin && (
          <>
            <h3 className="spaced">Add another venue</h3>
            <label>
              Venue name
              <input
                value={newVenue}
                onChange={(e) => setNewVenue(e.target.value)}
              />
            </label>
            <button
              className="secondary wide"
              disabled={!newVenue}
              onClick={() =>
                act(async () => {
                  await api("/venues", { name: newVenue });
                  location.reload();
                }, "Venue created")
              }
            >
              Create venue
            </button>
          </>
        )}
      </section>
    </div>
  );
}
