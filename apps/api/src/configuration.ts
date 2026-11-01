import { z } from "zod";
import { type DB, one } from "../../../packages/db/src.js";
import {
  assert,
  requirePermission,
  type Principal,
  passwordHash,
} from "../../../packages/domain/src/index.js";
import { id, money } from "../../../packages/contracts/src/index.js";
import { audit, emit } from "./common.js";
import { venueFor } from "./catalog.js";
const text = z.string().trim().min(1).max(120),
  optionalId = id.nullable().optional();
export const configSchemas = {
  outlets: z.object({
    venue_id: id,
    name: text,
    cuisine: text,
    collection_point: text,
    active: z.boolean().default(true),
    default_station_id: optionalId,
  }),
  stations: z.object({
    outlet_id: id,
    name: text,
    kind: z.enum(["PREP", "QUICK_SERVICE"]),
    active: z.boolean().default(true),
  }),
  "menu-items": z.object({
    outlet_id: id,
    category_id: optionalId,
    station_id: optionalId,
    name: text,
    description: z.string().max(1000).default(""),
    image_url: z
      .string()
      .regex(
        /^(\/images\/[a-zA-Z0-9_-]+\.(svg|png|webp|jpg)|\/v1\/media\/[a-f0-9-]{36}\.webp)$/,
      )
      .default("/images/placeholder.svg"),
    image_alt: text.default("Menu item"),
    price_minor: money,
    tax_bps: z.number().int().min(0).max(10000).default(0),
    tax_inclusive: z.boolean().default(true),
    allergens: z.string().max(500).default(""),
    dietary: text.default("Vegetarian"),
    published: z.boolean().default(false),
    active: z.boolean().default(true),
  }),
  categories: z.object({
    outlet_id: id,
    name: text,
    station_id: optionalId,
    active: z.boolean().default(true),
  }),
  variants: z.object({
    item_id: id,
    name: text,
    price_minor: money.nullable().optional(),
    station_id: optionalId,
    active: z.boolean().default(true),
  }),
  devices: z.object({
    venue_id: id,
    name: text,
    kind: z.enum(["POS", "KIOSK", "KITCHEN", "SERVING", "DISPLAY"]),
    active: z.boolean().default(true),
  }),
};
const tables: Record<string, string> = {
  outlets: "outlet",
  stations: "station",
  "menu-items": "menu_item",
  categories: "category",
  variants: "variant",
  devices: "device",
};
export async function saveConfig(
  db: DB,
  p: Principal,
  kind: keyof typeof configSchemas,
  raw: any,
  resourceId?: string,
) {
  const body = configSchemas[kind].parse(raw);
  const table = tables[kind];
  const old = resourceId
    ? await one(db, `SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [
        resourceId,
      ])
    : null;
  if (resourceId) assert(old, "NOT_FOUND", "Record not found", 404);
  let outletId = (body as any).outlet_id;
  let venueId = (body as any).venue_id;
  if (kind === "variants") {
    const item = await one(db, "SELECT * FROM menu_item WHERE id=$1", [
      (body as any).item_id,
    ]);
    assert(item, "NOT_FOUND", "Item not found", 404);
    outletId = item.outlet_id;
  }
  if (outletId) {
    const o = await one(db, "SELECT * FROM outlet WHERE id=$1", [outletId]);
    assert(o, "NOT_FOUND", "Outlet not found", 404);
    venueId = o.venue_id;
  }
  await venueFor(db, p, venueId);
  requirePermission(
    p,
    kind === "devices" ? "staff" : "configure",
    venueId,
    kind === "outlets" ? resourceId : outletId,
  );
  if (old) {
    for (const field of ["venue_id", "outlet_id", "item_id"])
      if (field in body)
        assert(
          old[field] === (body as any)[field],
          "IMMUTABLE_SCOPE",
          "Cannot move a record between scopes",
        );
    assert(
      Number(raw.version) === old.version,
      "STALE_VERSION",
      "This record changed. Refresh and retry",
    );
  }
  if (kind === "menu-items" && (body as any).image_url.startsWith("/v1/media/"))
    assert(
      await one(
        db,
        "SELECT id FROM media_asset WHERE path=$1 AND outlet_id=$2",
        [(body as any).image_url, outletId],
      ),
      "INVALID_IMAGE",
      "Image is outside this outlet",
    );
  const stationId =
    (body as any).station_id || (body as any).default_station_id;
  if (stationId) {
    const s = await one(db, "SELECT * FROM station WHERE id=$1", [stationId]);
    assert(
      s &&
        s.outlet_id === (kind === "outlets" ? resourceId : outletId) &&
        s.active,
      "INVALID_ROUTE",
      "Station must be active in the same outlet",
    );
  }
  if ((body as any).category_id) {
    const c = await one(db, "SELECT * FROM category WHERE id=$1", [
      (body as any).category_id,
    ]);
    assert(
      c && c.outlet_id === outletId,
      "INVALID_CATEGORY",
      "Category must belong to the same outlet",
    );
  }
  if (
    old &&
    (body as any).active === false &&
    ["stations", "outlets"].includes(kind)
  ) {
    const active = await one(
      db,
      `SELECT id FROM work_unit WHERE ${kind === "stations" ? "station_id" : "outlet_id"}=$1 AND cancel_state<>'CANCELLED' AND serve_state<>'HANDED_OVER' LIMIT 1`,
      [resourceId],
    );
    assert(
      !active,
      "ACTIVE_WORK",
      "Resolve or reassign active work before archiving",
    );
  }
  if (kind === "menu-items" && (body as any).published) {
    const route = await one(
      db,
      "SELECT coalesce($1::uuid,c.station_id,o.default_station_id) id FROM outlet o LEFT JOIN category c ON c.id=$2 WHERE o.id=$3",
      [
        (body as any).station_id || null,
        (body as any).category_id || null,
        outletId,
      ],
    );
    assert(
      route?.id &&
        (await one(
          db,
          "SELECT id FROM station WHERE id=$1 AND outlet_id=$2 AND active",
          [route.id, outletId],
        )),
      "INVALID_ROUTE",
      "A published item needs one active preparation station",
    );
  }
  const keys = Object.keys(body),
    values = Object.values(body);
  const result = old
    ? await one(
        db,
        `UPDATE ${table} SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(",")},version=version+1 WHERE id=$${keys.length + 1} RETURNING *`,
        [...values, resourceId],
      )
    : await one(
        db,
        `INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING *`,
        values,
      );
  await db.query("UPDATE venue SET menu_version=menu_version+1 WHERE id=$1", [
    venueId,
  ]);
  await audit(db, p, venueId, outletId || null, kind + ".saved", result.id, {
    before: old,
    after: result,
  });
  await emit(db, venueId, outletId || null, null, "menu.changed", {});
  return result;
}
export async function addStaff(db: DB, p: Principal, raw: unknown) {
  const b = z
    .object({
      venueId: id,
      outletId: id.optional(),
      stationId: id.optional(),
      name: text,
      email: z.email(),
      password: z.string().min(12).max(200),
      role: z.enum([
        "OWNER",
        "MANAGER",
        "BILLING",
        "COOK",
        "SERVER",
        "KIOSK",
        "DISPLAY",
      ]),
    })
    .parse(raw);
  const v = await venueFor(db, p, b.venueId);
  requirePermission(p, "staff", v.id, b.outletId, b.stationId);
  const admin = p.grants.some(
    (g) => g.venue_id === v.id && g.role === "SUPER_ADMIN",
  );
  if (!admin)
    assert(
      b.outletId && ["MANAGER", "COOK", "SERVER"].includes(b.role),
      "PRIVILEGE_CEILING",
      "Only outlet managers, cooks and servers can be created here",
      403,
    );
  if (b.outletId)
    assert(
      await one(db, "SELECT id FROM outlet WHERE id=$1 AND venue_id=$2", [
        b.outletId,
        v.id,
      ]),
      "INVALID_SCOPE",
      "Outlet is outside venue",
    );
  if (b.stationId)
    assert(
      await one(db, "SELECT id FROM station WHERE id=$1 AND outlet_id=$2", [
        b.stationId,
        b.outletId,
      ]),
      "INVALID_SCOPE",
      "Station is outside outlet",
    );
  const user = await one(
    db,
    "INSERT INTO app_user(organization_id,email,name,password_hash) VALUES($1,$2,$3,$4) RETURNING id,email,name,active",
    [
      v.organization_id,
      b.email.toLowerCase(),
      b.name,
      passwordHash(b.password),
    ],
  );
  await db.query(
    "INSERT INTO role_assignment(user_id,venue_id,outlet_id,station_id,role) VALUES($1,$2,$3,$4,$5)",
    [user.id, v.id, b.outletId || null, b.stationId || null, b.role],
  );
  await audit(db, p, v.id, b.outletId || null, "staff.created", user.id, {
    role: b.role,
  });
  return user;
}
