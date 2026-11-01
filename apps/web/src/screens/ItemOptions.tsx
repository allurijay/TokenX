import { useState } from "react";
import { api, currency } from "../api";
import { Modal } from "../components/ui";
import type { Row } from "../types";
export default function ItemOptions({ item, stations, run, onClose }: any) {
  const [groups, setGroups] = useState<Row[]>(
      item.modifier_groups.map((g: Row) => ({
        name: g.name,
        minSelect: g.min_select,
        maxSelect: g.max_select,
        options: g.options.map((o: Row) => ({
          name: o.name,
          priceMinor: o.price_minor,
        })),
      })),
    ),
    [variant, setVariant] = useState({
      name: "",
      price_minor: item.price_minor,
      station_id: item.resolved_station_id,
    });
  return (
    <Modal title={"Options · " + item.name} onClose={onClose}>
      <h3>Variants</h3>
      {item.variants.map((v: Row) => (
        <p key={v.id}>
          {v.name} · {currency(v.price_minor ?? item.price_minor)}
        </p>
      ))}
      <div className="form-grid">
        <label>
          Variant name
          <input
            value={variant.name}
            onChange={(e) => setVariant({ ...variant, name: e.target.value })}
          />
        </label>
        <label>
          Price (rupees)
          <input
            type="number"
            min="0"
            step=".01"
            value={variant.price_minor / 100}
            onChange={(e) =>
              setVariant({
                ...variant,
                price_minor: Math.round(Number(e.target.value) * 100),
              })
            }
          />
        </label>
      </div>
      <label>
        Variant station
        <select
          value={variant.station_id}
          onChange={(e) =>
            setVariant({ ...variant, station_id: e.target.value })
          }
        >
          {stations
            .filter((s: Row) => s.outlet_id === item.outlet_id)
            .map((s: Row) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
      </label>
      <button
        className="secondary"
        disabled={!variant.name}
        onClick={() =>
          void run(
            () =>
              api("/variants", { item_id: item.id, ...variant, active: true }),
            "Variant created",
          )
            .then(onClose)
            .catch(() => {})
        }
      >
        Add variant
      </button>
      <h3 className="spaced">Modifier groups</h3>
      {groups.map((g, index) => (
        <fieldset key={index}>
          <label>
            Group name
            <input
              value={g.name}
              onChange={(e) =>
                setGroups(
                  groups.map((x, i) =>
                    i === index ? { ...x, name: e.target.value } : x,
                  ),
                )
              }
            />
          </label>
          <div className="form-grid">
            {["minSelect", "maxSelect"].map((k) => (
              <label key={k}>
                {k === "minSelect" ? "Minimum choices" : "Maximum choices"}
                <input
                  type="number"
                  min="0"
                  value={g[k]}
                  onChange={(e) =>
                    setGroups(
                      groups.map((x, i) =>
                        i === index ? { ...x, [k]: Number(e.target.value) } : x,
                      ),
                    )
                  }
                />
              </label>
            ))}
          </div>
          {g.options.map((o: Row, j: number) => (
            <div className="form-grid" key={j}>
              <label>
                Option name
                <input
                  value={o.name}
                  onChange={(e) =>
                    setGroups(
                      groups.map((x, i) =>
                        i === index
                          ? {
                              ...x,
                              options: x.options.map((v: Row, n: number) =>
                                n === j ? { ...v, name: e.target.value } : v,
                              ),
                            }
                          : x,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Extra price (rupees)
                <input
                  type="number"
                  min="0"
                  step=".01"
                  value={o.priceMinor / 100}
                  onChange={(e) =>
                    setGroups(
                      groups.map((x, i) =>
                        i === index
                          ? {
                              ...x,
                              options: x.options.map((v: Row, n: number) =>
                                n === j
                                  ? {
                                      ...v,
                                      priceMinor: Math.round(
                                        Number(e.target.value) * 100,
                                      ),
                                    }
                                  : v,
                              ),
                            }
                          : x,
                      ),
                    )
                  }
                />
              </label>
            </div>
          ))}
          <button
            className="secondary"
            onClick={() =>
              setGroups(
                groups.map((x, i) =>
                  i === index
                    ? {
                        ...x,
                        options: [...x.options, { name: "", priceMinor: 0 }],
                      }
                    : x,
                ),
              )
            }
          >
            Add option
          </button>
        </fieldset>
      ))}
      <div className="inline spaced">
        <button
          className="secondary"
          onClick={() =>
            setGroups([
              ...groups,
              {
                name: "",
                minSelect: 0,
                maxSelect: 1,
                options: [{ name: "", priceMinor: 0 }],
              },
            ])
          }
        >
          Add modifier group
        </button>
        <button
          className="primary"
          onClick={() =>
            void run(
              () =>
                api("/menu-items/" + item.id + "/options", {
                  groups,
                  version: item.version,
                }),
              "Options saved",
            )
              .then(onClose)
              .catch(() => {})
          }
        >
          Save modifier groups
        </button>
      </div>
    </Modal>
  );
}
