import { Plus } from "lucide-react";
import { useState } from "react";
import { api, currency, label } from "../api";
import { Badge, Modal } from "../components/ui";
import type { Row } from "../types";
import ItemOptions from "./ItemOptions";
export default function MenuManager({ cat, act, run, me }: any) {
  const [editing, setEditing] = useState<Row | null>(null),
    [optionsItem, setOptionsItem] = useState<Row | null>(null);
  const manage = me.grants.some((g: Row) =>
    ["SUPER_ADMIN", "OWNER", "MANAGER"].includes(g.role),
  );
  return (
    <>
      <div className="section-head">
        <div>
          <h2>A menu worth coming back for.</h2>
          <p>
            Update items, route preparation, and keep availability accurate.
          </p>
        </div>
        {manage && (
          <button
            className="primary"
            onClick={() =>
              setEditing({
                outlet_id: cat.outlets[0]?.id,
                station_id: cat.stations[0]?.id,
                name: "",
                description: "",
                price_minor: 0,
                published: false,
                active: true,
                image_url: "/images/placeholder.svg",
                tax_bps: 0,
                tax_inclusive: true,
              })
            }
          >
            <Plus size={17} />
            New item
          </button>
        )}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Outlet / station</th>
              <th>Price</th>
              <th>Availability</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {cat.items.map((i: Row) => (
              <tr key={i.id}>
                <td>
                  <div className="item-cell">
                    <img src={i.image_url} alt="" />
                    <div>
                      <b>{i.name}</b>
                      <small>{i.published ? "Published" : "Draft"}</small>
                    </div>
                  </div>
                </td>
                <td>
                  {i.outlet_name}
                  <small>{i.station_name || "Not routed"}</small>
                </td>
                <td>{currency(i.price_minor)}</td>
                <td>
                  <Badge tone={i.available ? "green" : "amber"}>
                    {i.available ? "Available" : "Unavailable"}
                  </Badge>
                </td>
                <td>
                  <div className="inline">
                    {manage && (
                      <>
                        <button
                          className="secondary small"
                          onClick={() => setEditing(i)}
                        >
                          Edit
                        </button>
                        <button
                          className="secondary small"
                          onClick={() => setOptionsItem(i)}
                        >
                          Options
                        </button>
                      </>
                    )}
                    {cat.holds.filter((h: Row) => h.item_id === i.id).length ? (
                      cat.holds
                        .filter((h: Row) => h.item_id === i.id)
                        .map((h: Row) => (
                          <button
                            className="secondary small"
                            key={h.id}
                            onClick={() =>
                              act(
                                () =>
                                  api(
                                    "/availability-holds/" + h.id + "/release",
                                    {},
                                  ),
                                "Item resumed",
                              )
                            }
                          >
                            Resume
                          </button>
                        ))
                    ) : (
                      <button
                        className="secondary small"
                        onClick={() => {
                          const reason = prompt(
                            "Why is this item unavailable?",
                          );
                          if (reason)
                            act(
                              () =>
                                api("/availability-holds", {
                                  outletId: i.outlet_id,
                                  itemId: i.id,
                                  reason,
                                }),
                              "Item held",
                            );
                        }}
                      >
                        Hold
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {optionsItem && (
        <ItemOptions
          item={optionsItem}
          stations={cat.stations}
          run={run}
          onClose={() => setOptionsItem(null)}
        />
      )}{" "}
      {editing && (
        <Modal
          title={editing.id ? "Edit menu item" : "New menu item"}
          onClose={() => setEditing(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () =>
                  api(
                    "/menu-items" + (editing.id ? "/" + editing.id : ""),
                    editing,
                    editing.id ? "PUT" : "POST",
                  ),
                "Menu saved",
              )
                .then(() => setEditing(null))
                .catch(() => {});
            }}
          >
            <label>
              Item name
              <input
                required
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
            </label>
            <label>
              Description
              <textarea
                value={editing.description}
                onChange={(e) =>
                  setEditing({ ...editing, description: e.target.value })
                }
              />
            </label>
            <div className="form-grid">
              <label>
                Outlet
                <select
                  disabled={!!editing.id}
                  value={editing.outlet_id}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      outlet_id: e.target.value,
                      station_id: cat.stations.find(
                        (s: Row) => s.outlet_id === e.target.value,
                      )?.id,
                    })
                  }
                >
                  {cat.outlets.map((o: Row) => (
                    <option value={o.id} key={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Preparation station
                <select
                  required
                  value={editing.station_id || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, station_id: e.target.value })
                  }
                >
                  <option value="">Select station</option>
                  {cat.stations
                    .filter((s: Row) => s.outlet_id === editing.outlet_id)
                    .map((s: Row) => (
                      <option value={s.id} key={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Price (rupees)
                <input
                  required
                  min="0"
                  type="number"
                  step="0.01"
                  value={editing.price_minor / 100}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      price_minor: Math.round(Number(e.target.value) * 100),
                    })
                  }
                />
              </label>
              <label>
                Tax rate (%)
                <input
                  min="0"
                  max="100"
                  type="number"
                  step="0.01"
                  value={editing.tax_bps / 100}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      tax_bps: Math.round(Number(e.target.value) * 100),
                    })
                  }
                />
              </label>
            </div>
            <label>
              Image
              <select
                value={editing.image_url}
                onChange={(e) =>
                  setEditing({ ...editing, image_url: e.target.value })
                }
              >
                {editing.image_url?.startsWith("/v1/media/") && (
                  <option value={editing.image_url}>Uploaded image</option>
                )}
                {[
                  "placeholder",
                  "dosa",
                  "idli",
                  "rice",
                  "noodles",
                  "coffee",
                ].map((x) => (
                  <option key={x} value={"/images/" + x + ".svg"}>
                    {label(x)}
                  </option>
                ))}
              </select>
            </label>
            {editing.id && (
              <label>
                Upload photo (JPEG, PNG, WebP · 5 MB max)
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const form = new FormData();
                    form.append("image", file);
                    void run(async () => {
                      const r = await fetch(
                        "/v1/menu-items/" + editing.id + "/image",
                        {
                          method: "POST",
                          body: form,
                          credentials: "same-origin",
                        },
                      );
                      const j = await r.json();
                      if (!r.ok)
                        throw new Error(j.error?.message || "Upload failed");
                      setEditing({
                        ...editing,
                        image_url: j.data.path,
                        version: editing.version + 1,
                      });
                    }, "Image uploaded").catch(() => {});
                  }}
                />
              </label>
            )}
            <label>
              Allergen declarations
              <textarea
                value={editing.allergens || ""}
                onChange={(e) =>
                  setEditing({ ...editing, allergens: e.target.value })
                }
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={editing.tax_inclusive}
                onChange={(e) =>
                  setEditing({ ...editing, tax_inclusive: e.target.checked })
                }
              />
              Price includes tax
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={editing.published}
                onChange={(e) =>
                  setEditing({ ...editing, published: e.target.checked })
                }
              />
              Published to POS and kiosks
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={editing.active}
                onChange={(e) =>
                  setEditing({ ...editing, active: e.target.checked })
                }
              />
              Active (uncheck to archive)
            </label>
            <button className="primary wide">Save menu item</button>
          </form>
        </Modal>
      )}
    </>
  );
}
