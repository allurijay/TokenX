import { ChefHat, Plus, Store } from "lucide-react";
import { useState } from "react";
import { api, label } from "../api";
import { Badge, Modal } from "../components/ui";
import type { Row } from "../types";
export default function Configuration({ cat, run, act, venue, me }: any) {
  const [editing, setEditing] = useState<Row | null>(null),
    [kind, setKind] = useState("outlets");
  return (
    <>
      <div className="section-head">
        <h2>Every kitchen has its place.</h2>
        <div className="inline">
          <button
            className="secondary"
            onClick={() => {
              setKind("stations");
              setEditing({
                outlet_id: cat.outlets[0]?.id,
                name: "",
                kind: "PREP",
                active: true,
              });
            }}
          >
            <Plus size={16} />
            Add station
          </button>
          {me.grants.some(
            (g: Row) =>
              g.venue_id === venue &&
              !g.outlet_id &&
              ["SUPER_ADMIN", "MANAGER"].includes(g.role),
          ) && (
            <button
              className="primary"
              onClick={() => {
                setKind("outlets");
                setEditing({
                  venue_id: venue,
                  name: "",
                  cuisine: "",
                  collection_point: "",
                  active: true,
                });
              }}
            >
              <Plus size={16} />
              Add outlet
            </button>
          )}
        </div>
      </div>
      <div className="outlet-grid">
        {cat.outlets.map((o: Row) => (
          <section className="config-card" key={o.id}>
            <div className="section-head">
              <span className="outlet-icon">
                <Store />
              </span>
              <Badge tone={o.active ? "green" : "amber"}>
                {o.active ? "Open" : "Archived"}
              </Badge>
            </div>
            <h2>{o.name}</h2>
            <p>
              {o.cuisine} · {o.collection_point}
            </p>
            <div className="station-list">
              {cat.stations
                .filter((s: Row) => s.outlet_id === o.id)
                .map((s: Row) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setKind("stations");
                      setEditing(s);
                    }}
                  >
                    <ChefHat size={18} />
                    <span>
                      {s.name}
                      <small>{label(s.kind)}</small>
                    </span>
                    <Badge>{s.active ? "Active" : "Archived"}</Badge>
                  </button>
                ))}
            </div>
            <div className="inline">
              <button
                className="secondary"
                onClick={() => {
                  setKind("outlets");
                  setEditing(o);
                }}
              >
                Edit outlet
              </button>
              <button
                className="secondary"
                onClick={() =>
                  act(
                    () => api("/menus/publish", { outletId: o.id }),
                    "Menu published",
                  )
                }
              >
                Publish menu
              </button>
            </div>
          </section>
        ))}
      </div>
      {editing && (
        <Modal
          title={
            (editing.id ? "Edit " : "New ") +
            (kind === "outlets" ? "outlet" : "station")
          }
          onClose={() => setEditing(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(() =>
                api(
                  "/" + kind + (editing.id ? "/" + editing.id : ""),
                  editing,
                  editing.id ? "PUT" : "POST",
                ),
              )
                .then(() => setEditing(null))
                .catch(() => {});
            }}
          >
            <label>
              Name
              <input
                required
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
            </label>
            {kind === "outlets" ? (
              <>
                <label>
                  Cuisine
                  <input
                    required
                    value={editing.cuisine}
                    onChange={(e) =>
                      setEditing({ ...editing, cuisine: e.target.value })
                    }
                  />
                </label>
                <label>
                  Collection point
                  <input
                    required
                    value={editing.collection_point}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        collection_point: e.target.value,
                      })
                    }
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  Outlet
                  <select
                    disabled={!!editing.id}
                    value={editing.outlet_id}
                    onChange={(e) =>
                      setEditing({ ...editing, outlet_id: e.target.value })
                    }
                  >
                    {cat.outlets.map((o: Row) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Station type
                  <select
                    value={editing.kind}
                    onChange={(e) =>
                      setEditing({ ...editing, kind: e.target.value })
                    }
                  >
                    <option>PREP</option>
                    <option>QUICK_SERVICE</option>
                  </select>
                </label>
              </>
            )}
            <label className="checkbox">
              <input
                type="checkbox"
                checked={editing.active}
                onChange={(e) =>
                  setEditing({ ...editing, active: e.target.checked })
                }
              />
              Active
            </label>
            <button className="primary wide">Save configuration</button>
          </form>
        </Modal>
      )}
    </>
  );
}
