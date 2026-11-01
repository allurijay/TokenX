import { Plus, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { api, label } from "../api";
import { Badge, Modal } from "../components/ui";
import { useResource } from "../hooks";
import type { Row } from "../types";
export default function Staff({ venue, cat, revision, run, act }: any) {
  const { data, error } = useResource("/staff?venueId=" + venue, revision);
  const [form, setForm] = useState<Row | null>(null),
    [mfa, setMfa] = useState<Row | null>(null),
    [otp, setOtp] = useState("");
  return (
    <>
      <div className="section-head">
        <div>
          <h2>A place for every team member</h2>
          <p>Individual logins. The right access. Clear responsibility.</p>
        </div>
        <button
          className="primary"
          onClick={() =>
            setForm({
              venueId: venue,
              name: "",
              email: "",
              password: "",
              role: "COOK",
              outletId: cat.outlets[0]?.id,
            })
          }
        >
          <Plus size={16} />
          Add team member
        </button>
      </div>
      <div className="inline spaced">
        <button
          className="secondary"
          onClick={() =>
            void run(
              () => api("/auth/mfa/enroll", {}),
              "Authenticator enrollment started",
            )
              .then(setMfa)
              .catch(() => {})
          }
        >
          <ShieldCheck size={16} />
          Protect my account with MFA
        </button>
      </div>
      {mfa && (
        <Modal title="Set up an authenticator app" onClose={() => setMfa(null)}>
          <p>
            Add this secret to your authenticator, then enter its six-digit
            code.
          </p>
          <code>{mfa.secret}</code>
          <label>
            Verification code
            <input
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              inputMode="numeric"
              maxLength={6}
            />
          </label>
          <button
            className="primary wide"
            onClick={() =>
              void run(() => api("/auth/mfa/confirm", { otp }), "MFA enabled")
                .then(() => setMfa(null))
                .catch(() => {})
            }
          >
            Confirm MFA
          </button>
        </Modal>
      )}
      {error && <p className="error">{error}</p>}
      <div className="table-wrap spaced">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Scope</th>
              <th>Access</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((u: Row, i: number) => (
              <tr key={u.id + i}>
                <td>
                  <b>{u.name}</b>
                </td>
                <td>{u.email}</td>
                <td>
                  <Badge>{label(u.role)}</Badge>
                </td>
                <td>
                  {cat.outlets.find((o: Row) => o.id === u.outlet_id)?.name ||
                    "Venue-wide"}
                </td>
                <td>
                  {u.active ? (
                    <button
                      className="secondary small"
                      onClick={() => {
                        if (confirm("Revoke access for " + u.name + "?"))
                          act(
                            () => api("/staff/" + u.id + "/revoke", {}),
                            "Access revoked",
                          );
                      }}
                    >
                      Revoke
                    </button>
                  ) : (
                    <Badge>Revoked</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && (
        <Modal title="Add team member" onClose={() => setForm(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api("/staff", form), "Team member created")
                .then(() => setForm(null))
                .catch(() => {});
            }}
          >
            {["name", "email", "password"].map((f) => (
              <label key={f}>
                {label(f)}
                <input
                  required
                  type={
                    f === "password"
                      ? "password"
                      : f === "email"
                        ? "email"
                        : "text"
                  }
                  minLength={f === "password" ? 12 : 1}
                  value={form[f]}
                  onChange={(e) => setForm({ ...form, [f]: e.target.value })}
                />
              </label>
            ))}
            <label>
              Role
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                {[
                  "OWNER",
                  "MANAGER",
                  "BILLING",
                  "COOK",
                  "SERVER",
                  "KIOSK",
                  "DISPLAY",
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Outlet scope
              <select
                value={form.outletId || ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    outletId: e.target.value || undefined,
                    stationId: undefined,
                  })
                }
              >
                <option value="">Venue-wide</option>
                {cat.outlets.map((o: Row) => (
                  <option value={o.id} key={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Station scope
              <select
                value={form.stationId || ""}
                onChange={(e) =>
                  setForm({ ...form, stationId: e.target.value || undefined })
                }
              >
                <option value="">All in scope</option>
                {cat.stations
                  .filter((s: Row) => s.outlet_id === form.outletId)
                  .map((s: Row) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
            <button className="primary wide">Create account</button>
          </form>
        </Modal>
      )}
    </>
  );
}
