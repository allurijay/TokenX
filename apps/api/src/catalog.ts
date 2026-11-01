import { type DB, one } from "../../../packages/db/src.js";
import {
  assert,
  can,
  requirePermission,
  type Principal,
} from "../../../packages/domain/src/index.js";
export async function venueFor(db: DB, p: Principal, id: string) {
  const v = await one(
    db,
    "SELECT * FROM venue WHERE id=$1 AND organization_id=$2",
    [id, p.organization_id],
  );
  assert(v, "NOT_FOUND", "Venue not found", 404);
  assert(
    p.grants.some((g) => g.venue_id === id),
    "FORBIDDEN",
    "Venue is outside your access",
    403,
  );
  return v;
}
export async function catalog(db: DB, p: Principal, venueId: string) {
  const venue = await venueFor(db, p, venueId);
  const outlets = (
    await db.query("SELECT * FROM outlet WHERE venue_id=$1 ORDER BY name", [
      venueId,
    ])
  ).rows.filter((o) =>
    p.grants.some(
      (g) => g.venue_id === venueId && (!g.outlet_id || g.outlet_id === o.id),
    ),
  );
  const stations = (
    await db.query(
      "SELECT s.* FROM station s JOIN outlet o ON o.id=s.outlet_id WHERE o.venue_id=$1 ORDER BY s.name",
      [venueId],
    )
  ).rows.filter((s) =>
    p.grants.some(
      (g) =>
        g.venue_id === venueId &&
        (!g.outlet_id || g.outlet_id === s.outlet_id) &&
        (!g.station_id || g.station_id === s.id),
    ),
  );
  const items = (
    await db.query(
      `SELECT i.*,o.name outlet_name,o.collection_point,o.cuisine,coalesce(i.station_id,c.station_id,o.default_station_id) resolved_station_id,s.name station_name,
 (i.active AND i.published AND o.active AND s.active AND NOT EXISTS(SELECT 1 FROM availability_hold h WHERE h.outlet_id=i.outlet_id AND h.released_at IS NULL AND (h.expires_at IS NULL OR h.expires_at>now()) AND (h.item_id IS NULL OR h.item_id=i.id) AND (h.station_id IS NULL OR h.station_id=s.id))) available
 FROM menu_item i JOIN outlet o ON o.id=i.outlet_id LEFT JOIN category c ON c.id=i.category_id LEFT JOIN station s ON s.id=coalesce(i.station_id,c.station_id,o.default_station_id) WHERE o.venue_id=$1 ORDER BY o.name,i.name`,
      [venueId],
    )
  ).rows.filter((i) =>
    can(p, "catalog", venueId, i.outlet_id, i.resolved_station_id),
  );
  for (const i of items) {
    i.variants = (
      await db.query("SELECT * FROM variant WHERE item_id=$1 AND active", [
        i.id,
      ])
    ).rows;
    i.modifier_groups = (
      await db.query(
        "SELECT g.*,coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'price_minor',m.price_minor)) FILTER(WHERE m.id IS NOT NULL),'[]') options FROM modifier_group g LEFT JOIN modifier_option m ON m.group_id=g.id WHERE g.item_id=$1 GROUP BY g.id",
        [i.id],
      )
    ).rows;
  }
  const holds = (
    await db.query(
      "SELECT * FROM availability_hold WHERE venue_id=$1 AND released_at IS NULL AND (expires_at IS NULL OR expires_at>now())",
      [venueId],
    )
  ).rows.filter((h) =>
    p.grants.some(
      (g) =>
        g.venue_id === venueId &&
        (!g.outlet_id || g.outlet_id === h.outlet_id) &&
        (!g.station_id ||
          g.station_id === h.station_id ||
          items.some((i) => i.id === h.item_id)),
    ),
  );
  const customer = p.grants.every((g) => ["KIOSK", "DISPLAY"].includes(g.role));
  return {
    venue,
    menuVersion: venue.menu_version,
    outlets,
    stations: customer ? [] : stations,
    items: customer ? items.filter((i) => i.published && i.active) : items,
    holds: customer ? [] : holds,
  };
}
export async function checkItem(db: DB, itemId: string, variantId?: string) {
  const item = await one(
    db,
    `SELECT i.*,o.venue_id,o.active outlet_active,o.default_station_id,c.station_id category_station FROM menu_item i JOIN outlet o ON o.id=i.outlet_id LEFT JOIN category c ON c.id=i.category_id WHERE i.id=$1`,
    [itemId],
  );
  assert(item, "NOT_FOUND", "Menu item not found", 404);
  const variant = variantId
    ? await one(
        db,
        "SELECT * FROM variant WHERE id=$1 AND item_id=$2 AND active",
        [variantId, itemId],
      )
    : null;
  if (variantId) assert(variant, "INVALID_VARIANT", "Variant unavailable");
  const stationId =
    variant?.station_id ||
    item.station_id ||
    item.category_station ||
    item.default_station_id;
  const station = await one(
    db,
    "SELECT * FROM station WHERE id=$1 AND outlet_id=$2",
    [stationId, item.outlet_id],
  );
  assert(
    station?.active && item.active && item.published && item.outlet_active,
    "ITEM_UNAVAILABLE",
    `${item.name} is unavailable`,
  );
  const held = await one(
    db,
    "SELECT id FROM availability_hold WHERE outlet_id=$1 AND (station_id IS NULL OR station_id=$2) AND (item_id IS NULL OR item_id=$3) AND released_at IS NULL AND (expires_at IS NULL OR expires_at>now())",
    [item.outlet_id, station.id, item.id],
  );
  assert(!held, "ITEM_UNAVAILABLE", `${item.name} is temporarily unavailable`);
  const schedules = (
    await db.query("SELECT * FROM operating_schedule WHERE outlet_id=$1", [
      item.outlet_id,
    ])
  ).rows;
  if (schedules.length) {
    const time = await one(
      db,
      "SELECT extract(dow FROM now() AT TIME ZONE timezone)::int day,(now() AT TIME ZONE timezone)::time clock FROM venue WHERE id=$1",
      [item.venue_id],
    );
    assert(
      schedules.some(
        (s) =>
          s.day === time.day && time.clock >= s.opens && time.clock < s.closes,
      ),
      "OUTLET_CLOSED",
      "Outlet is outside operating hours",
    );
  }
  return {
    ...item,
    station_id: station.id,
    variant,
    price_minor: variant?.price_minor ?? item.price_minor,
  };
}
